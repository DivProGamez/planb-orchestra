// Engine audit: random shock sequences on every scenario. Each feasible plan must pass the
// independent validator AND a second, minimal brute-force checker written here from scratch;
// committed work must stay frozen; results must be deterministic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../src/data/scenarios.js';
import { planSchedule } from '../src/engine/scheduler.js';
import { validatePlan } from '../src/engine/validate.js';
import { applyShocks, validateShocks } from '../src/engine/shocks.js';
import { getVariant } from '../src/engine/model.js';
import { stateOf } from './helpers.js';

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

function randomShock(r, state) {
  const s = state.scenario;
  const pick = (list) => list[Math.floor(r() * list.length)];
  const kind = pick(['deadline_earlier', 'person_unavailable', 'person_leaves_later', 'person_delayed', 'resource_unavailable',
    'resource_restored', 'person_available', 'budget_reduced', 'duration_increase']);
  switch (kind) {
    case 'deadline_earlier': return { type: kind, payload: { minutes: 5 * (1 + Math.floor(r() * 12)) } };
    case 'person_unavailable': return { type: kind, payload: { personId: pick(s.people).id } };
    case 'person_leaves_later': return { type: 'person_unavailable', payload: { personId: pick(s.people).id, fromMin: state.nowMin + 5 * (1 + Math.floor(r() * 18)) } };
    case 'person_delayed': return { type: kind, payload: { personId: pick(s.people).id, minutes: 5 * (1 + Math.floor(r() * 8)) } };
    case 'resource_restored': return { type: kind, payload: { resourceId: pick(s.resources).id } };
    case 'person_available': return { type: kind, payload: { personId: pick(s.people).id } };
    case 'resource_unavailable': return { type: kind, payload: { resourceId: pick(s.resources).id } };
    case 'budget_reduced': return { type: kind, payload: { newCap: Math.max(0, s.budgetCap - 5 * (1 + Math.floor(r() * 8))) } };
    default: {
      const todo = s.tasks.filter((t) => t.status === 'todo');
      return todo.length ? { type: kind, payload: { taskId: pick(todo).id, extraMin: 5 * (1 + Math.floor(r() * 4)) } } : null;
    }
  }
}

/** Minute-by-minute brute-force check, sharing no code with validate.js. */
function bruteForceCheck(state, plan) {
  const s = state.scenario;
  const errors = [];
  const at = new Map(plan.scheduled.map((st) => [st.taskId, st]));
  for (let m = s.startMin; m < s.deadlineMin + 600; m++) {
    const active = plan.scheduled.filter((st) => st.startMin <= m && m < st.endMin);
    const perPerson = new Map();
    for (const st of active) if (st.personId) perPerson.set(st.personId, (perPerson.get(st.personId) || 0) + 1);
    for (const [pid, n] of perPerson) if (n > 1) errors.push(`${pid} double-booked at ${m}`);
    for (const r of s.resources) {
      const n = active.filter((st) => st.resources.includes(r.id)).length;
      if (n > r.capacity) errors.push(`${r.id} over capacity at ${m}`);
    }
  }
  for (const st of plan.scheduled) {
    const t = s.tasks.find((x) => x.id === st.taskId);
    if (st.endMin > s.deadlineMin) errors.push(`${st.taskId} ends after deadline`);
    for (const d of [...t.dependsOn, ...(t.softDependsOn || [])]) if (at.has(d) && at.get(d).endMin > st.startMin) errors.push(`${st.taskId} before ${d}`);
    for (const d of t.dependsOn) if (!at.has(d)) errors.push(`${st.taskId} orphaned (needs ${d})`);
    if (state.committed[st.taskId]) continue;
    const v = getVariant(s, t, st.variantId);
    if (v.resources.some((rid) => !s.resources.find((r) => r.id === rid).available)) errors.push(`${st.taskId} uses broken equipment`);
    if (st.personId) {
      const p = s.people.find((x) => x.id === st.personId);
      if (st.startMin < p.availableFrom || st.endMin > p.availableTo) errors.push(`${st.taskId} outside ${p.id} availability`);
      if (!v.eligiblePeople.includes(st.personId)) errors.push(`${st.taskId} ineligible person`);
    }
    if (st.startMin < state.nowMin) errors.push(`${st.taskId} starts in the past`);
    if (st.durationMin < v.minDurationMin) errors.push(`${st.taskId} below minimum duration`);
  }
  for (const t of s.tasks) {
    const dropped = plan.dropped.some((d) => d.taskId === t.id);
    if (!at.has(t.id) && !dropped) errors.push(`${t.id} missing`);
    if (dropped && t.priority !== 'optional' && t.status !== 'dropped') errors.push(`${t.id} required but dropped`);
  }
  const cost = plan.scheduled.reduce((a, st) => a + st.actualCost, 0);
  if (cost > s.budgetCap) errors.push(`cost ${cost} > ${s.budgetCap}`);
  return errors;
}

test('audit: 500 random two-to-four-shock sequences keep every hard constraint', (t) => {
  const r = rng(20261021);
  let feasible = 0;
  let infeasible = 0;
  for (let run = 0; run < 500; run++) {
    const scenario = SCENARIOS[run % SCENARIOS.length];
    let state = stateOf(scenario);
    let plan = planSchedule(state);
    const steps = 2 + Math.floor(r() * 3);
    for (let k = 0; k < steps; k++) {
      const at = Math.min(state.scenario.deadlineMin - 5, state.nowMin + Math.floor(r() * 50));
      const frozenState = applyShocks(state, plan, [], at);
      const shock = randomShock(r, frozenState);
      if (!shock || !validateShocks([shock], frozenState).ok) continue;
      const next = applyShocks(state, plan, [shock], at);
      const prefer = Object.fromEntries(plan.scheduled.map((x) => [x.taskId, x.variantId]));
      const nextPlan = planSchedule(next, { preferVariants: prefer });
      const again = planSchedule(next, { preferVariants: prefer });
      assert.deepEqual(nextPlan.scheduled, again.scheduled, 'non-deterministic');
      if (!nextPlan.feasible) {
        infeasible++;
        assert.ok(nextPlan.violations.length > 0, 'infeasible without violations');
        assert.equal(nextPlan.scheduled.length, 0, 'infeasible plan must not return a schedule');
        break; // the session would keep the previous plan
      }
      feasible++;
      const ctx = `${scenario.id} run ${run} step ${k} ${JSON.stringify(shock)}`;
      assert.equal(validatePlan(next, nextPlan).valid, true, `validator: ${ctx}`);
      assert.deepEqual(bruteForceCheck(next, nextPlan), [], `brute force: ${ctx}`);
      for (const [id, c] of Object.entries(next.committed)) {
        const now = nextPlan.scheduled.find((x) => x.taskId === id);
        assert.deepEqual([now.startMin, now.endMin, now.personId, now.actualCost], [c.startMin, c.endMin, c.personId, c.actualCost], `frozen ${id}: ${ctx}`);
      }
      state = next;
      plan = nextPlan;
    }
  }
  t.diagnostic(`feasible replans checked: ${feasible}; infeasible outcomes checked: ${infeasible}`);
  assert.ok(feasible > 100, `only ${feasible} feasible replans exercised`);
  assert.ok(infeasible > 5, `only ${infeasible} infeasible outcomes exercised`);
});
