// Shock schema (allowlisted), validation/normalisation and application to a cloned state.
// Shared by the browser, the local parser and the server-side LLM response validator.

import { clone, indexById, isInt, formatClock, COMMITTED_STATUSES } from './model.js';

/** Unexpected events plus user-confirmed relaxations offered after an infeasible result. */
export const SHOCK_TYPES = {
  deadline_earlier: { fields: ['minutes'], label: 'Deadline earlier' },
  person_unavailable: { fields: ['personId'], optional: ['fromMin'], label: 'Person unavailable' },
  person_delayed: { fields: ['personId', 'minutes'], label: 'Person arrives late' },
  resource_unavailable: { fields: ['resourceId'], label: 'Equipment unavailable' },
  budget_reduced: { fields: ['newCap'], label: 'Budget reduced' },
  duration_increase: { fields: ['taskId', 'extraMin'], label: 'Task takes longer' },
  deadline_extended: { fields: ['minutes'], label: 'Deadline extended', relaxation: true },
  budget_increased: { fields: ['newCap'], label: 'Budget increased', relaxation: true },
  task_skipped: { fields: ['taskId'], label: 'Task skipped', relaxation: true },
  resource_restored: { fields: ['resourceId'], label: 'Equipment available again', relaxation: true },
  person_available: { fields: ['personId'], label: 'Person available again', relaxation: true },
};

export const MAX_SHOCKS_PER_TURN = 4;

function requiredDependents(scenario, taskId) {
  return scenario.tasks.filter((t) => t.dependsOn.includes(taskId) && t.priority !== 'optional' && t.status !== 'dropped');
}

/**
 * Validates one shock against the current constraint state and returns a normalised copy.
 * Unknown types, unknown fields, unknown ids and non-integer values are rejected.
 */
export function normalizeShock(shock, state) {
  const s = state.scenario;
  const fail = (message) => ({ ok: false, error: message });
  if (!shock || typeof shock !== 'object' || Array.isArray(shock)) return fail('Shock must be an object');
  const spec = SHOCK_TYPES[shock.type];
  if (!spec) return fail(`Unsupported shock type "${shock.type}"`);
  const payload = shock.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail(`${shock.type}: payload must be an object`);
  const allowed = [...spec.fields, ...(spec.optional || [])];
  const extra = Object.keys(payload).filter((k) => !allowed.includes(k));
  if (extra.length) return fail(`${shock.type}: unexpected field(s) ${extra.join(', ')}`);
  for (const f of spec.fields) if (!(f in payload)) return fail(`${shock.type}: missing field ${f}`);

  const people = indexById(s.people);
  const resources = indexById(s.resources);
  const tasks = indexById(s.tasks);
  const intIn = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;

  switch (shock.type) {
    case 'deadline_earlier':
    case 'deadline_extended':
      if (!intIn(payload.minutes, 1, 720)) return fail(`${shock.type}: minutes must be an integer from 1 to 720`);
      if (shock.type === 'deadline_earlier' && s.deadlineMin - payload.minutes <= Math.max(state.nowMin, s.startMin)) {
        return fail(`Moving the deadline ${payload.minutes} min earlier would put it at ${formatClock(s, s.deadlineMin - payload.minutes)}, which is not after the current time ${formatClock(s, state.nowMin)}`);
      }
      break;
    case 'person_unavailable': {
      const p = people.get(payload.personId);
      if (!p) return fail(`Unknown person "${payload.personId}"`);
      if (p.availableTo <= Math.max(state.nowMin, p.availableFrom)) return fail(`${p.name} is already unavailable`);
      if ('fromMin' in payload) {
        if (!intIn(payload.fromMin, state.nowMin, 10000)) return fail(`${p.name}: the leaving time must not be before the current time ${formatClock(s, state.nowMin)}`);
        if (payload.fromMin >= p.availableTo) return fail(`${p.name} is already gone by ${formatClock(s, p.availableTo)}`);
      }
      break;
    }
    case 'person_delayed': {
      const p = people.get(payload.personId);
      if (!p) return fail(`Unknown person "${payload.personId}"`);
      if (!intIn(payload.minutes, 1, 480)) return fail('person_delayed: minutes must be an integer from 1 to 480');
      if (p.availableTo <= Math.max(state.nowMin, p.availableFrom)) return fail(`${p.name} is already unavailable`);
      break;
    }
    case 'person_available': {
      const p = people.get(payload.personId);
      if (!p) return fail(`Unknown person "${payload.personId}"`);
      if (p.baseAvailableTo === undefined && p.baseAvailableFrom === undefined) return fail(`${p.name} was not marked unavailable or late`);
      break;
    }
    case 'resource_restored': {
      const r = resources.get(payload.resourceId);
      if (!r) return fail(`Unknown equipment "${payload.resourceId}"`);
      if (r.available) return fail(`${r.name} is already available`);
      break;
    }
    case 'resource_unavailable': {
      const r = resources.get(payload.resourceId);
      if (!r) return fail(`Unknown equipment "${payload.resourceId}"`);
      if (!r.available) return fail(`${r.name} is already unavailable`);
      break;
    }
    case 'budget_reduced':
      if (!intIn(payload.newCap, 0, 100000)) return fail('budget_reduced: newCap must be a non-negative integer');
      if (payload.newCap >= s.budgetCap) return fail(`New budget $${payload.newCap} is not lower than the current $${s.budgetCap}`);
      break;
    case 'budget_increased':
      if (!intIn(payload.newCap, 0, 100000)) return fail('budget_increased: newCap must be a non-negative integer');
      if (payload.newCap <= s.budgetCap) return fail(`New budget $${payload.newCap} is not higher than the current $${s.budgetCap}`);
      break;
    case 'duration_increase': {
      const t = tasks.get(payload.taskId);
      if (!t) return fail(`Unknown task "${payload.taskId}"`);
      if (t.status !== 'todo') return fail(`"${t.title}" has already started or finished; its duration is frozen`);
      if (!intIn(payload.extraMin, 1, 240)) return fail('duration_increase: extraMin must be an integer from 1 to 240');
      break;
    }
    case 'task_skipped': {
      const t = tasks.get(payload.taskId);
      if (!t) return fail(`Unknown task "${payload.taskId}"`);
      if (t.status !== 'todo') return fail(`"${t.title}" has already started, finished or been skipped`);
      if (t.priority === 'must') return fail(`"${t.title}" is a must-do task and cannot be skipped`);
      if (requiredDependents(s, t.id).length) return fail(`Other required tasks depend on "${t.title}"`);
      break;
    }
    default:
      return fail(`Unsupported shock type "${shock.type}"`);
  }
  const normalized = { type: shock.type, payload: Object.fromEntries(allowed.filter((f) => f in payload).map((f) => [f, payload[f]])) };
  return { ok: true, shock: normalized };
}

/** Validates a list of shocks sequentially (each against the state produced by the previous ones). */
export function validateShocks(shocks, state) {
  if (!Array.isArray(shocks) || shocks.length === 0) return { ok: false, errors: ['No supported change was found'] };
  if (shocks.length > MAX_SHOCKS_PER_TURN) return { ok: false, errors: [`At most ${MAX_SHOCKS_PER_TURN} changes per turn`] };
  const errors = [];
  const normalized = [];
  let working = state;
  for (const shock of shocks) {
    const res = normalizeShock(shock, working);
    if (!res.ok) { errors.push(res.error); continue; }
    normalized.push(res.shock);
    working = applyShockToState(working, res.shock, working.nowMin);
  }
  return errors.length ? { ok: false, errors } : { ok: true, shocks: normalized };
}

/**
 * Freezes work that has started by atMin: done if it ended, in_progress if it is running.
 * Returns a new state; the input state is not mutated.
 */
export function freezeAt(state, plan, atMin) {
  const next = clone(state);
  next.nowMin = Math.max(state.nowMin, atMin);
  if (!plan || !plan.feasible) return next;
  const tasks = indexById(next.scenario.tasks);
  for (const st of plan.scheduled) {
    if (next.committed[st.taskId]) continue;
    let status = null;
    if (st.endMin <= atMin) status = 'done';
    else if (st.startMin < atMin) status = 'in_progress';
    if (!status) continue;
    next.committed[st.taskId] = { ...st, status };
    tasks.get(st.taskId).status = status;
  }
  for (const [taskId, c] of Object.entries(next.committed)) {
    if (c.status === 'in_progress' && c.endMin <= atMin) {
      next.committed[taskId] = { ...c, status: 'done' };
      tasks.get(taskId).status = 'done';
    }
  }
  return next;
}

/** Applies one already-normalised shock to a cloned state. */
export function applyShockToState(state, shock, atMin) {
  const next = clone(state);
  const s = next.scenario;
  const p = shock.payload;
  switch (shock.type) {
    case 'deadline_earlier':
      s.deadlineMin -= p.minutes;
      break;
    case 'deadline_extended':
      // People's own availability windows are not stretched; only the event deadline moves.
      s.deadlineMin += p.minutes;
      break;
    case 'person_unavailable': {
      const person = s.people.find((x) => x.id === p.personId);
      if (person.baseAvailableTo === undefined) person.baseAvailableTo = person.availableTo;
      const from = p.fromMin ?? atMin;
      person.availableTo = Math.max(person.availableFrom, Math.min(person.availableTo, from));
      break;
    }
    case 'person_delayed': {
      const person = s.people.find((x) => x.id === p.personId);
      if (person.baseAvailableFrom === undefined) person.baseAvailableFrom = person.availableFrom;
      person.availableFrom = Math.min(person.availableTo, Math.max(person.availableFrom, atMin) + p.minutes);
      break;
    }
    case 'person_available': {
      // Available again from now on, within the original window.
      const person = s.people.find((x) => x.id === p.personId);
      if (person.baseAvailableTo !== undefined) person.availableTo = person.baseAvailableTo;
      if (person.baseAvailableFrom !== undefined) person.availableFrom = Math.max(person.baseAvailableFrom, Math.min(person.availableFrom, atMin));
      delete person.baseAvailableTo;
      delete person.baseAvailableFrom;
      break;
    }
    case 'resource_restored':
      s.resources.find((x) => x.id === p.resourceId).available = true;
      break;
    case 'resource_unavailable':
      s.resources.find((x) => x.id === p.resourceId).available = false;
      break;
    case 'budget_reduced':
    case 'budget_increased':
      s.budgetCap = p.newCap;
      break;
    case 'duration_increase': {
      const t = s.tasks.find((x) => x.id === p.taskId);
      t.durationMin += p.extraMin;
      t.minDurationMin += p.extraMin;
      break;
    }
    case 'task_skipped': {
      const t = s.tasks.find((x) => x.id === p.taskId);
      if (!COMMITTED_STATUSES.has(t.status)) t.status = 'dropped';
      break;
    }
    default:
      throw new Error(`Unsupported shock type ${shock.type}`);
  }
  return next;
}

/** Freeze started work at atMin, then apply each shock in order. */
export function applyShocks(state, plan, shocks, atMin) {
  let next = freezeAt(state, plan, atMin);
  for (const shock of shocks) next = applyShockToState(next, shock, atMin);
  return next;
}

/** Human-readable, data-derived description of a shock (no invented narrative). */
export function describeShock(shock, state) {
  const s = state.scenario;
  const p = shock.payload;
  const clock = (m) => formatClock(s, m);
  switch (shock.type) {
    case 'deadline_earlier': return `Deadline ${p.minutes} min earlier (${clock(s.deadlineMin)} → ${clock(s.deadlineMin - p.minutes)})`;
    case 'deadline_extended': return `Deadline extended ${p.minutes} min (${clock(s.deadlineMin)} → ${clock(s.deadlineMin + p.minutes)})`;
    case 'person_unavailable': return `${s.people.find((x) => x.id === p.personId)?.name || p.personId} unavailable from ${clock(p.fromMin ?? state.nowMin)}`;
    case 'person_delayed': {
      const person = s.people.find((x) => x.id === p.personId);
      return `${person?.name || p.personId} arrives ${p.minutes} min later (from ${clock(Math.max(person?.availableFrom ?? 0, state.nowMin) + p.minutes)})`;
    }
    case 'person_available': return `${s.people.find((x) => x.id === p.personId)?.name || p.personId} available again`;
    case 'resource_restored': return `${s.resources.find((x) => x.id === p.resourceId)?.name || p.resourceId} available again`;
    case 'resource_unavailable': return `${s.resources.find((x) => x.id === p.resourceId)?.name || p.resourceId} unavailable`;
    case 'budget_reduced': return `Budget cut to $${p.newCap} (was $${s.budgetCap})`;
    case 'budget_increased': return `Budget raised to $${p.newCap} (was $${s.budgetCap})`;
    case 'duration_increase': return `"${s.tasks.find((x) => x.id === p.taskId)?.title || p.taskId}" takes ${p.extraMin} min longer`;
    case 'task_skipped': return `Skip "${s.tasks.find((x) => x.id === p.taskId)?.title || p.taskId}"`;
    default: return shock.type;
  }
}

/** Describes a list of shocks, each against the state produced by the previous one. */
export function describeShocks(shocks, state) {
  const parts = [];
  let working = state;
  for (const shock of shocks) {
    parts.push(describeShock(shock, working));
    working = applyShockToState(working, shock, working.nowMin);
  }
  return parts;
}
