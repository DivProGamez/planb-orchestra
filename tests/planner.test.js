import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, getScenario } from '../src/data/scenarios.js';
import { planSchedule, compressedDuration } from '../src/engine/scheduler.js';
import { validatePlan, validateScenario, findDependencyCycle, maxConcurrent } from '../src/engine/validate.js';
import { applyShocks } from '../src/engine/shocks.js';
import { stateOf, miniScenario } from './helpers.js';

test('every seeded scenario is structurally valid, has 6–9+ tasks and a feasible validated baseline', () => {
  assert.equal(SCENARIOS.length, 3);
  for (const s of SCENARIOS) {
    assert.ok(validateScenario(s).ok, `${s.id} invalid`);
    assert.ok(s.tasks.length >= 6 && s.tasks.length <= 10, `${s.id} task count`);
    const plan = planSchedule(stateOf(s));
    assert.equal(plan.feasible, true, `${s.id} baseline infeasible`);
    const check = validatePlan(stateOf(s), plan);
    assert.equal(check.valid, true, JSON.stringify(check.violations));
    assert.equal(plan.dropped.length, 0, `${s.id} baseline drops tasks`);
    assert.ok(plan.totalCost <= s.budgetCap);
  }
});

test('G1.1 acyclic dependency chain is scheduled in order', () => {
  const plan = planSchedule(stateOf(miniScenario()));
  assert.equal(plan.feasible, true);
  const at = Object.fromEntries(plan.scheduled.map((st) => [st.taskId, st]));
  assert.ok(at.b.startMin >= at.a.endMin);
  assert.ok(at.c.startMin >= at.b.endMin);
});

test('G1.2 dependency cycles are rejected explicitly', () => {
  const s = miniScenario();
  s.tasks = s.tasks.map((t) => (t.id === 'a' ? { ...t, dependsOn: ['c'] } : t));
  assert.ok(findDependencyCycle(s.tasks));
  const res = validateScenario(s);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === 'DEPENDENCY_CYCLE'));
  const plan = planSchedule(stateOf(s));
  assert.equal(plan.feasible, false);
  assert.ok(plan.violations.some((v) => v.code === 'DEPENDENCY_CYCLE'));
});

test('G1.3 no person or resource is used beyond capacity in any scenario', () => {
  for (const s of SCENARIOS) {
    const plan = planSchedule(stateOf(s));
    for (const p of s.people) assert.ok(maxConcurrent(plan.scheduled.filter((x) => x.personId === p.id)) <= 1, `${s.id}/${p.id}`);
    for (const r of s.resources) assert.ok(maxConcurrent(plan.scheduled.filter((x) => x.resources.includes(r.id))) <= r.capacity, `${s.id}/${r.id}`);
  }
});

test('validatePlan catches a hand-made double booking and over-capacity use', () => {
  const s = miniScenario();
  const state = stateOf(s);
  const plan = planSchedule(state);
  const tampered = structuredClone(plan);
  const b = tampered.scheduled.find((x) => x.taskId === 'b');
  const c = tampered.scheduled.find((x) => x.taskId === 'c');
  c.startMin = b.startMin; c.endMin = b.startMin + c.durationMin; c.personId = b.personId;
  const res = validatePlan(state, tampered);
  assert.equal(res.valid, false);
  const codes = res.violations.map((v) => v.code);
  assert.ok(codes.includes('PERSON_DOUBLE_BOOKED'));
  assert.ok(codes.includes('RESOURCE_OVER_CAPACITY'));
  assert.ok(codes.includes('DEPENDENCY_ORDER'));
});

test('G1.4 a broken oven is never assigned; the listed alternative is used instead', () => {
  const dinner = getScenario('dinner-for-six');
  const state = applyShocks(stateOf(dinner), null, [{ type: 'resource_unavailable', payload: { resourceId: 'oven' } }], 0);
  const plan = planSchedule(state);
  assert.equal(plan.feasible, true);
  assert.ok(plan.scheduled.every((st) => !st.resources.includes('oven')));
  assert.equal(plan.scheduled.find((st) => st.taskId === 'roast').variantId, 'roast-pan');
  // Without a listed alternative, a must task needing the oven makes the plan infeasible.
  const noAlt = structuredClone(state);
  noAlt.scenario.tasks.find((t) => t.id === 'roast').alternatives = [];
  const res = planSchedule(noAlt);
  assert.equal(res.feasible, false);
  assert.ok(res.violations.some((v) => v.code === 'NO_LEGAL_VARIANT' && v.taskId === 'roast'));
});

test('G1.5 budget cap holds after two shocks, including committed spend', () => {
  const dinner = getScenario('dinner-for-six');
  let state = stateOf(dinner);
  const p0 = planSchedule(state);
  state = applyShocks(state, p0, [{ type: 'deadline_earlier', payload: { minutes: 60 } }, { type: 'resource_unavailable', payload: { resourceId: 'oven' } }], 0);
  const p1 = planSchedule(state);
  assert.equal(p1.feasible, true);
  state = applyShocks(state, p1, [{ type: 'budget_reduced', payload: { newCap: 85 } }], 50);
  const p2 = planSchedule(state);
  const committed = Object.values(state.committed).reduce((s, c) => s + c.actualCost, 0);
  assert.ok(committed > 0, 'some spend is committed');
  if (p2.feasible) {
    assert.ok(p2.totalCost <= 85);
    assert.ok(p2.totalCost >= committed);
  } else {
    assert.ok(p2.violations.some((v) => v.code === 'BUDGET_EXCEEDED'));
  }
});

test('G1.6 started and completed tasks keep their slot and spent cost', () => {
  const dinner = getScenario('dinner-for-six');
  const s0 = stateOf(dinner);
  const p0 = planSchedule(s0);
  const s1 = applyShocks(s0, p0, [{ type: 'person_unavailable', payload: { personId: 'sam' } }], 40);
  const p1 = planSchedule(s1);
  assert.equal(p1.feasible, true);
  assert.ok(Object.keys(s1.committed).length >= 2);
  for (const [id, c] of Object.entries(s1.committed)) {
    const now = p1.scheduled.find((st) => st.taskId === id);
    assert.deepEqual(
      [now.startMin, now.endMin, now.personId, now.actualCost],
      [c.startMin, c.endMin, c.personId, c.actualCost],
    );
    const before = p0.scheduled.find((st) => st.taskId === id);
    assert.equal(before.startMin, c.startMin);
  }
  // Sam's frozen work stays with Sam; nothing new is assigned to Sam after 40.
  assert.ok(p1.scheduled.filter((st) => st.personId === 'sam' && !s1.committed[st.taskId]).length === 0);
});

test('G1.7 mandatory tasks are never silently dropped; the validator flags it', () => {
  for (const s of SCENARIOS) {
    const state = stateOf(s);
    const plan = planSchedule(state);
    const must = s.tasks.find((t) => t.priority === 'must');
    const tampered = structuredClone(plan);
    tampered.scheduled = tampered.scheduled.filter((st) => st.taskId !== must.id);
    tampered.dropped.push({ taskId: must.id });
    const res = validatePlan(state, tampered);
    assert.ok(res.violations.some((v) => v.code === 'MANDATORY_DROPPED'), s.id);
  }
  // Under heavy pressure the planner drops only optional tasks.
  const birthday = getScenario('childrens-birthday');
  const st = applyShocks(stateOf(birthday), null, [{ type: 'budget_reduced', payload: { newCap: 90 } }], 0);
  const plan = planSchedule(st);
  assert.equal(plan.feasible, true);
  assert.ok(plan.dropped.length > 0);
  assert.ok(plan.dropped.every((d) => d.priority === 'optional'));
});

test('G1.8 impossible plans return feasible:false with specific, proven violations', () => {
  const dinner = getScenario('dinner-for-six');
  const tooEarly = applyShocks(stateOf(dinner), null, [{ type: 'deadline_earlier', payload: { minutes: 120 } }], 0);
  const p = planSchedule(tooEarly);
  assert.equal(p.feasible, false);
  assert.equal(p.scheduled.length, 0);
  const v = p.violations.find((x) => x.code === 'DEADLINE_EXCEEDED');
  assert.ok(v && v.proof === 'proven' && v.taskId);

  const broke = applyShocks(stateOf(dinner), null, [{ type: 'budget_reduced', payload: { newCap: 30 } }], 0);
  const pb = planSchedule(broke);
  assert.equal(pb.feasible, false);
  const vb = pb.violations.find((x) => x.code === 'BUDGET_EXCEEDED');
  assert.ok(vb && vb.minCost > 30);

  const outing = getScenario('weekend-outing');
  const late = applyShocks(stateOf(outing), null, [{ type: 'deadline_earlier', payload: { minutes: 240 } }], 0);
  assert.equal(planSchedule(late).feasible, false);
  const birthday = getScenario('childrens-birthday');
  const poor = applyShocks(stateOf(birthday), null, [{ type: 'budget_reduced', payload: { newCap: 40 } }], 0);
  assert.equal(planSchedule(poor).feasible, false);
});

test('G1.9 same inputs produce identical plans', () => {
  for (const s of SCENARIOS) {
    const a = planSchedule(stateOf(s));
    const b = planSchedule(stateOf(s));
    assert.deepEqual(a.scheduled, b.scheduled);
    assert.deepEqual(a.dropped, b.dropped);
  }
});

test('G1.10 deadline_earlier + person_unavailable result passes independent validation', () => {
  for (const [id, personId] of [['dinner-for-six', 'sam'], ['childrens-birthday', 'helper'], ['weekend-outing', 'parent-b']]) {
    const s = getScenario(id);
    const s0 = stateOf(s);
    const p0 = planSchedule(s0);
    const s1 = applyShocks(s0, p0, [{ type: 'deadline_earlier', payload: { minutes: 30 } }, { type: 'person_unavailable', payload: { personId } }], 20);
    const p1 = planSchedule(s1);
    if (p1.feasible) {
      const check = validatePlan(s1, p1);
      assert.equal(check.valid, true, `${id}: ${JSON.stringify(check.violations)}`);
      assert.ok(p1.endMin <= s1.scenario.deadlineMin);
      assert.ok(p1.scheduled.every((st) => st.personId !== personId || s1.committed[st.taskId]));
    } else {
      assert.ok(p1.violations.length > 0);
    }
  }
});

test('fixtures and prior states are never mutated by planning or shocks', () => {
  const dinner = getScenario('dinner-for-six');
  assert.ok(Object.isFrozen(dinner) && Object.isFrozen(dinner.tasks[0]));
  const s0 = stateOf(dinner);
  const snapshot = JSON.stringify(s0);
  const p0 = planSchedule(s0);
  applyShocks(s0, p0, [{ type: 'resource_unavailable', payload: { resourceId: 'oven' } }], 30);
  assert.equal(JSON.stringify(s0), snapshot);
});

test('compression never goes below minDurationMin and steps in 5-minute cuts', () => {
  const v = { durationMin: 45, minDurationMin: 35, compressible: true };
  // span 10 → cuts of 2.5/5/7.5/10 min rounded to 5-minute steps: 5, 5, 10, 10.
  assert.deepEqual([0, 1, 2, 3, 4].map((l) => compressedDuration(v, l)), [45, 40, 40, 35, 35]);
  assert.equal(compressedDuration({ durationMin: 15, minDurationMin: 15, compressible: false }, 4), 15);
});

test('soft dependencies order optional tasks before the terminal task', () => {
  for (const s of SCENARIOS) {
    const plan = planSchedule(stateOf(s));
    const at = Object.fromEntries(plan.scheduled.map((st) => [st.taskId, st]));
    for (const t of s.tasks) for (const dep of t.softDependsOn || []) {
      if (at[dep] && at[t.id]) assert.ok(at[t.id].startMin >= at[dep].endMin, `${s.id}: ${t.id} after ${dep}`);
    }
  }
});
