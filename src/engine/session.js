// Session = original scenario + an append-only list of committed revisions.
// All functions are pure: they return new session objects and never mutate inputs.

import { clone, formatClock, PRIORITY_RANK } from './model.js';
import { validateScenario } from './validate.js';
import { planSchedule } from './scheduler.js';
import { validateShocks, freezeAt, applyShockToState, describeShocks } from './shocks.js';
import { diffPlans } from './diff.js';

export const SESSION_VERSION = 1;
const MAX_LOG = 60;

export function currentRevision(session) {
  return session.revisions[session.revisions.length - 1];
}

function preferFrom(plan) {
  return Object.fromEntries((plan?.scheduled || []).map((st) => [st.taskId, st.variantId]));
}

/** Applies user overrides from the setup form (bounded) to a scenario clone. */
export function applyOverrides(scenario, overrides = {}) {
  const s = clone(scenario);
  if (Number.isInteger(overrides.deadlineMin)) s.deadlineMin = overrides.deadlineMin;
  if (Number.isInteger(overrides.budgetCap)) s.budgetCap = overrides.budgetCap;
  for (const p of s.people) {
    const o = overrides.people?.[p.id];
    if (!o) continue;
    if (o.participating === false) { p.availableFrom = s.startMin; p.availableTo = s.startMin; }
    if (Number.isInteger(o.availableFrom)) p.availableFrom = o.availableFrom;
  }
  for (const r of s.resources) {
    const o = overrides.resources?.[r.id];
    if (o && typeof o.available === 'boolean') r.available = o.available;
  }
  return s;
}

export function createSession(scenario, { overrides, now = Date.now() } = {}) {
  const source = applyOverrides(scenario, overrides);
  const structural = validateScenario(source);
  if (!structural.ok) return { ok: false, errors: structural.errors, plan: null };
  const state = { scenario: clone(source), committed: {}, nowMin: source.startMin };
  const plan = planSchedule(state);
  if (!plan.feasible) return { ok: false, errors: plan.violations, plan };
  const session = {
    version: SESSION_VERSION,
    id: `s-${now.toString(36)}`,
    scenarioId: scenario.id,
    createdAt: now,
    originalScenario: clone(source),
    nowMin: source.startMin,
    revisions: [{ index: 0, id: 'r0', label: 'Original plan', atMin: source.startMin, shocks: [], state, plan, diff: null, createdAt: now }],
    shockLog: [],
    rejected: [],
    conversation: [],
    activity: [],
    nextShockSeq: 1,
  };
  return { ok: true, session };
}

/** Plans the consequences of shocks without committing anything. */
export function proposeShocks(session, rawShocks, { source = 'typed' } = {}) {
  const head = currentRevision(session);
  const atMin = session.nowMin;
  const frozen = freezeAt(head.state, head.plan, atMin);
  const checked = validateShocks(rawShocks, frozen);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const shocks = checked.shocks.map((sh, i) => ({ ...sh, id: `k${session.nextShockSeq + i}`, atMin, source }));
  const descriptions = describeShocks(shocks, frozen);
  let nextState = frozen;
  for (const sh of shocks) nextState = applyShockToState(nextState, sh, atMin);
  const plan = planSchedule(nextState, { preferVariants: preferFrom(head.plan) });
  const base = { ok: true, shocks, descriptions, atMin, state: nextState, plan, source };
  if (!plan.feasible) {
    return { ...base, feasible: false, options: suggestRelaxations(session, frozen, shocks, nextState, plan) };
  }
  const diff = diffPlans({ prevState: head.state, prevPlan: head.plan, nextState, nextPlan: plan });
  return { ...base, feasible: true, diff };
}

/** Commits a feasible proposal as a new revision. */
export function commitProposal(session, proposal, { now = Date.now(), label } = {}) {
  if (!proposal?.ok || !proposal.feasible) throw new Error('Only feasible proposals can be committed');
  const next = clone(session);
  const index = next.revisions.length;
  next.revisions.push({
    index,
    id: `r${index}`,
    label: label || proposal.descriptions.join(' + '),
    atMin: proposal.atMin,
    shocks: proposal.shocks,
    state: proposal.state,
    plan: proposal.plan,
    diff: proposal.diff,
    createdAt: now,
  });
  next.shockLog.push(...proposal.shocks.map((sh, i) => ({ ...sh, revisionId: `r${index}`, description: proposal.descriptions[i], undone: false })));
  next.nextShockSeq += proposal.shocks.length;
  next.nowMin = Math.max(next.nowMin, proposal.atMin);
  return next;
}

/** Records a rejected (infeasible) attempt without changing any constraint. */
export function recordRejected(session, proposal, { now = Date.now() } = {}) {
  const next = clone(session);
  next.rejected.push({
    at: now, atMin: proposal.atMin, descriptions: proposal.descriptions,
    violations: proposal.plan.violations.map((v) => ({ code: v.code, message: v.message, proof: v.proof })),
  });
  next.rejected = next.rejected.slice(-MAX_LOG);
  next.nextShockSeq += proposal.shocks.length;
  return next;
}

/** Removes the latest revision, restoring the previous one (never the baseline unless it is next). */
export function undoLast(session) {
  if (session.revisions.length <= 1) return { ok: false, session, message: 'Nothing to undo — this is the original plan.' };
  const next = clone(session);
  const removed = next.revisions.pop();
  for (const entry of next.shockLog) if (entry.revisionId === removed.id) entry.undone = true;
  next.nowMin = removed.atMin;
  return { ok: true, session: next, removed };
}

export function restoreBaseline(session) {
  const next = clone(session);
  const removed = next.revisions.slice(1);
  next.revisions = next.revisions.slice(0, 1);
  for (const entry of next.shockLog) entry.undone = true;
  next.nowMin = next.revisions[0].atMin;
  return { ok: true, session: next, removedCount: removed.length };
}

export function advanceClock(session, minutes) {
  const next = clone(session);
  const head = currentRevision(next);
  const limit = head.state.scenario.deadlineMin;
  next.nowMin = Math.min(limit, Math.max(next.nowMin, next.nowMin + minutes));
  return next;
}

/** Derives the display status of a scheduled task at the session clock. */
export function liveStatus(st, nowMin) {
  if (st.status === 'done') return 'done';
  if (st.endMin <= nowMin) return 'done';
  if (st.startMin < nowMin) return 'in_progress';
  return 'todo';
}

function tryRelaxation(frozen, shocks, relaxation, preferVariants) {
  let state = frozen;
  for (const sh of [...shocks, relaxation]) state = applyShockToState(state, sh, frozen.nowMin);
  const plan = planSchedule(state, { preferVariants });
  return plan.feasible ? plan : null;
}

/**
 * Finds user-confirmable relaxations that are verified to restore feasibility.
 * Constraints are never changed here; each option is just a proposal.
 */
export function suggestRelaxations(session, frozen, shocks, nextState, failedPlan) {
  const s = nextState.scenario;
  const prefer = preferFrom(currentRevision(session).plan);
  const options = [];
  const codes = new Set(failedPlan.violations.map((v) => v.code));
  const timeRelated = ['DEADLINE_EXCEEDED', 'NO_FEASIBLE_SLOT', 'CAPACITY_EXCEEDED', 'NO_FEASIBLE_PLAN'].some((c) => codes.has(c));
  const budgetRelated = codes.has('BUDGET_EXCEEDED');

  const describe = (plan) => `Finishes ${formatClock(s, plan.endMin)}, total $${plan.totalCost}`;
  if (timeRelated && !budgetRelated) {
    for (let minutes = 5; minutes <= 180; minutes += 5) {
      const relaxation = { type: 'deadline_extended', payload: { minutes } };
      const plan = tryRelaxation(frozen, shocks, relaxation, prefer);
      if (plan) {
        options.push({
          id: 'extend-deadline', kind: 'deadline',
          label: `Move the deadline to ${formatClock(s, s.deadlineMin + minutes)} (+${minutes} min)`,
          detail: describe(plan), shocks: [relaxation],
        });
        break;
      }
    }
  }
  if (budgetRelated) {
    const start = Math.max(failedPlan.minCost ?? s.budgetCap + 1, s.budgetCap + 1);
    const caps = [...Array.from({ length: 20 }, (_, i) => start + i), ...Array.from({ length: 36 }, (_, i) => start + 20 + i * 5)];
    for (const cap of caps) {
      const relaxation = { type: 'budget_increased', payload: { newCap: cap } };
      const plan = tryRelaxation(frozen, shocks, relaxation, prefer);
      if (plan) {
        options.push({
          id: 'raise-budget', kind: 'budget',
          label: `Set the budget to $${cap} instead`,
          detail: describe(plan), shocks: [relaxation],
        });
        break;
      }
    }
  }
  const skippable = s.tasks
    .filter((t) => t.status === 'todo' && t.priority !== 'must')
    .filter((t) => !s.tasks.some((o) => o.dependsOn.includes(t.id) && o.priority !== 'optional' && o.status !== 'dropped'))
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  for (const t of skippable) {
    if (options.length >= 3) break;
    const relaxation = { type: 'task_skipped', payload: { taskId: t.id } };
    const plan = tryRelaxation(frozen, shocks, relaxation, prefer);
    if (plan) {
      options.push({ id: `skip-${t.id}`, kind: 'skip', label: `Skip "${t.title}"`, detail: describe(plan), shocks: [relaxation] });
    }
  }
  if (timeRelated && budgetRelated && options.length < 2) {
    for (let minutes = 15; minutes <= 120; minutes += 15) {
      const relaxation = { type: 'deadline_extended', payload: { minutes } };
      const plan = tryRelaxation(frozen, shocks, relaxation, prefer);
      if (plan) {
        options.push({ id: 'extend-deadline', kind: 'deadline', label: `Move the deadline to ${formatClock(s, s.deadlineMin + minutes)} (+${minutes} min)`, detail: describe(plan), shocks: [relaxation] });
        break;
      }
    }
  }
  return options.slice(0, 3);
}

export function appendLog(session, key, item) {
  const next = clone(session);
  next[key] = [...(next[key] || []), item].slice(-MAX_LOG);
  return next;
}
