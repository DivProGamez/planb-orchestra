// Structural scenario validation and the independent plan validator.
// validatePlan() deliberately re-derives every rule from the raw state; it shares no
// scheduling logic with scheduler.js so it can catch scheduler bugs.

import {
  PRIORITIES, TASK_STATUSES, COMMITTED_STATUSES, indexById, getVariant, isInt, formatClock, orderingPreds,
} from './model.js';

/** Returns the ids along a dependency cycle, or null when the graph is acyclic. */
export function findDependencyCycle(tasks) {
  const byId = indexById(tasks);
  const color = new Map(); // undefined = white, 1 = grey, 2 = black
  const stack = [];
  const visit = (id) => {
    color.set(id, 1);
    stack.push(id);
    for (const dep of byId.has(id) ? orderingPreds(byId.get(id)) : []) {
      if (!byId.has(dep)) continue;
      if (color.get(dep) === 1) return [...stack.slice(stack.indexOf(dep)), dep];
      if (!color.get(dep)) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };
  for (const t of tasks) {
    if (!color.get(t.id)) {
      const found = visit(t.id);
      if (found) return found;
    }
  }
  return null;
}

function checkVariantShape(add, owner, v, peopleIds, resourceIds) {
  if (typeof v.title !== 'string' || !v.title.trim()) add('SCHEMA', `${owner}: title is required`);
  if (!isInt(v.durationMin) || v.durationMin <= 0) add('SCHEMA', `${owner}: durationMin must be a positive integer`);
  if (!isInt(v.minDurationMin) || v.minDurationMin <= 0 || v.minDurationMin > v.durationMin) {
    add('SCHEMA', `${owner}: minDurationMin must be an integer between 1 and durationMin`);
  }
  if (!isInt(v.cost) || v.cost < 0) add('SCHEMA', `${owner}: cost must be a non-negative integer`);
  if (typeof v.compressible !== 'boolean') add('SCHEMA', `${owner}: compressible must be boolean`);
  if (!Array.isArray(v.eligiblePeople)) add('SCHEMA', `${owner}: eligiblePeople must be an array`);
  else for (const p of v.eligiblePeople) if (!peopleIds.has(p)) add('UNKNOWN_PERSON', `${owner}: unknown person "${p}"`);
  if (!Array.isArray(v.resources)) add('SCHEMA', `${owner}: resources must be an array`);
  else for (const r of v.resources) if (!resourceIds.has(r)) add('UNKNOWN_RESOURCE', `${owner}: unknown resource "${r}"`);
}

export function validateScenario(s) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  if (!s || typeof s !== 'object') return { ok: false, errors: [{ code: 'SCHEMA', message: 'Scenario is missing' }] };

  if (!isInt(s.startMin) || !isInt(s.deadlineMin) || s.deadlineMin <= s.startMin) {
    add('SCHEMA', 'deadlineMin must be an integer after startMin');
  }
  if (!isInt(s.budgetCap) || s.budgetCap < 0) add('SCHEMA', 'budgetCap must be a non-negative integer');
  for (const key of ['people', 'resources', 'tasks']) {
    if (!Array.isArray(s[key]) || s[key].length === 0) add('SCHEMA', `${key} must be a non-empty array`);
  }
  if (errors.length) return { ok: false, errors };

  const uniq = (list, label) => {
    const seen = new Set();
    for (const item of list) {
      if (typeof item.id !== 'string' || !item.id) add('SCHEMA', `${label} id must be a non-empty string`);
      else if (seen.has(item.id)) add('DUPLICATE_ID', `Duplicate ${label} id "${item.id}"`);
      seen.add(item.id);
    }
    return seen;
  };
  const peopleIds = uniq(s.people, 'person');
  const resourceIds = uniq(s.resources, 'resource');
  const taskIds = uniq(s.tasks, 'task');
  const alternatives = s.alternatives || [];
  const altIds = uniq(alternatives, 'alternative');
  for (const id of altIds) if (taskIds.has(id)) add('DUPLICATE_ID', `Alternative id "${id}" collides with a task id`);

  for (const p of s.people) {
    if (!isInt(p.availableFrom) || !isInt(p.availableTo) || p.availableFrom > p.availableTo) {
      add('SCHEMA', `Person "${p.id}": availability window is invalid`);
    }
  }
  for (const r of s.resources) {
    if (!isInt(r.capacity) || r.capacity < 1) add('SCHEMA', `Resource "${r.id}": capacity must be >= 1`);
    if (typeof r.available !== 'boolean') add('SCHEMA', `Resource "${r.id}": available must be boolean`);
  }

  const taskById = indexById(s.tasks);
  for (const t of s.tasks) {
    checkVariantShape(add, `Task "${t.id}"`, t, peopleIds, resourceIds);
    if (!TASK_STATUSES.includes(t.status)) add('SCHEMA', `Task "${t.id}": invalid status`);
    if (!PRIORITIES.includes(t.priority)) add('SCHEMA', `Task "${t.id}": invalid priority`);
    if (!isInt(t.earliestStartMin) || t.earliestStartMin < 0) add('SCHEMA', `Task "${t.id}": earliestStartMin must be >= 0`);
    if (t.latestEndMin !== null && !isInt(t.latestEndMin)) add('SCHEMA', `Task "${t.id}": latestEndMin must be integer or null`);
    if (!Array.isArray(t.dependsOn)) add('SCHEMA', `Task "${t.id}": dependsOn must be an array`);
    else {
      for (const dep of t.dependsOn) {
        if (dep === t.id) add('DEPENDENCY_CYCLE', `Task "${t.id}" depends on itself`);
        else if (!taskIds.has(dep)) add('UNKNOWN_TASK', `Task "${t.id}" depends on unknown task "${dep}"`);
        else if (t.priority !== 'optional' && taskById.get(dep).priority === 'optional') {
          add('REQUIRED_DEPENDS_ON_OPTIONAL', `Required task "${t.id}" cannot depend on optional task "${dep}"`);
        }
      }
    }
    if (t.softDependsOn !== undefined && !Array.isArray(t.softDependsOn)) add('SCHEMA', `Task "${t.id}": softDependsOn must be an array`);
    for (const dep of t.softDependsOn || []) {
      if (dep === t.id) add('DEPENDENCY_CYCLE', `Task "${t.id}" depends on itself`);
      else if (!taskIds.has(dep)) add('UNKNOWN_TASK', `Task "${t.id}" soft-depends on unknown task "${dep}"`);
    }
    for (const altId of t.alternatives || []) {
      const alt = alternatives.find((a) => a.id === altId);
      if (!alt) add('UNKNOWN_ALTERNATIVE', `Task "${t.id}" lists unknown alternative "${altId}"`);
      else if (alt.forTask !== t.id) add('UNKNOWN_ALTERNATIVE', `Alternative "${altId}" belongs to "${alt.forTask}", not "${t.id}"`);
    }
  }
  for (const alt of alternatives) {
    if (!taskIds.has(alt.forTask)) add('UNKNOWN_TASK', `Alternative "${alt.id}" targets unknown task "${alt.forTask}"`);
    checkVariantShape(add, `Alternative "${alt.id}"`, alt, peopleIds, resourceIds);
  }

  if (!errors.some((e) => e.code === 'UNKNOWN_TASK')) {
    const cycle = findDependencyCycle(s.tasks);
    if (cycle) add('DEPENDENCY_CYCLE', `Dependency cycle: ${cycle.join(' → ')}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Maximum number of intervals overlapping at any instant. Intervals are half-open [start, end). */
export function maxConcurrent(intervals) {
  const events = [];
  for (const iv of intervals) {
    events.push([iv.startMin, 1]);
    events.push([iv.endMin, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends before starts at the same minute
  let cur = 0;
  let max = 0;
  for (const [, delta] of events) {
    cur += delta;
    max = Math.max(max, cur);
  }
  return max;
}

/**
 * Independently checks a plan against the constraint state.
 * state: { scenario, committed: {taskId: ScheduledTask}, nowMin }
 * plan:  { scheduled: ScheduledTask[], dropped: [{taskId}] }
 */
export function validatePlan(state, plan) {
  const s = state.scenario;
  const committed = state.committed || {};
  const violations = [];
  let checks = 0;
  const v = (code, message, extra = {}) => violations.push({ code, message, ...extra });
  const clock = (m) => formatClock(s, m);

  const tasks = indexById(s.tasks);
  const people = indexById(s.people);
  const resources = indexById(s.resources);
  const scheduled = new Map();

  for (const st of plan.scheduled || []) {
    checks++;
    if (!tasks.has(st.taskId)) { v('UNKNOWN_TASK', `Unknown task "${st.taskId}" in plan`); continue; }
    if (scheduled.has(st.taskId)) v('DUPLICATE_TASK', `Task "${st.taskId}" is scheduled twice`, { taskId: st.taskId });
    scheduled.set(st.taskId, st);
  }
  const dropped = new Set((plan.dropped || []).map((d) => d.taskId));

  for (const t of s.tasks) {
    checks++;
    const isScheduled = scheduled.has(t.id);
    const isDropped = dropped.has(t.id);
    if (isScheduled && isDropped) v('DUPLICATE_TASK', `"${t.title}" is both scheduled and dropped`, { taskId: t.id });
    if (!isScheduled && !isDropped) v('MISSING_TASK', `"${t.title}" is neither scheduled nor dropped`, { taskId: t.id });
    if (isDropped && t.priority !== 'optional' && t.status !== 'dropped') {
      v('MANDATORY_DROPPED', `"${t.title}" is ${t.priority} and cannot be dropped without user confirmation`, { taskId: t.id });
    }
    if (isScheduled && t.status === 'dropped') v('MANDATORY_DROPPED', `"${t.title}" was skipped by the user but is scheduled`, { taskId: t.id });
    if (isDropped && COMMITTED_STATUSES.has(t.status)) v('COMMITTED_CHANGED', `"${t.title}" already started and cannot be dropped`, { taskId: t.id });
  }

  for (const [taskId, c] of Object.entries(committed)) {
    checks++;
    const st = scheduled.get(taskId);
    const same = st && st.startMin === c.startMin && st.endMin === c.endMin && st.personId === c.personId
      && st.variantId === c.variantId && st.actualCost === c.actualCost;
    if (!same) v('COMMITTED_CHANGED', `Started/completed task "${taskId}" was modified`, { taskId });
  }

  for (const st of scheduled.values()) {
    const t = tasks.get(st.taskId);
    const isCommitted = Boolean(committed[st.taskId]);
    const variant = getVariant(s, t, st.variantId);
    checks++;
    if (!variant) { v('VARIANT_INVALID', `"${t.title}" uses unknown variant "${st.variantId}"`, { taskId: t.id }); continue; }
    if (!isInt(st.startMin) || !isInt(st.endMin) || st.endMin - st.startMin !== st.durationMin || st.durationMin <= 0) {
      v('DURATION_INVALID', `"${t.title}" has inconsistent start/end/duration`, { taskId: t.id });
    }
    if (!isCommitted) {
      checks++;
      const okDuration = variant.compressible
        ? st.durationMin >= variant.minDurationMin && st.durationMin <= variant.durationMin
        : st.durationMin === variant.durationMin;
      if (!okDuration) v('DURATION_INVALID', `"${variant.title}" duration ${st.durationMin} min is outside its allowed range`, { taskId: t.id });
      if (st.actualCost !== variant.cost) v('COST_MISMATCH', `"${variant.title}" cost does not match its variant`, { taskId: t.id });
      if (st.startMin < state.nowMin) v('STARTS_IN_PAST', `"${variant.title}" starts before the current time ${clock(state.nowMin)}`, { taskId: t.id });
      if (st.startMin < s.startMin || st.startMin < t.earliestStartMin) v('WINDOW_VIOLATED', `"${variant.title}" starts before its earliest start`, { taskId: t.id });
      const listed = [...(st.resources || [])].sort().join(',');
      if (listed !== [...variant.resources].sort().join(',')) v('RESOURCE_MISMATCH', `"${variant.title}" resource list does not match its variant`, { taskId: t.id });
      for (const rid of variant.resources) {
        const r = resources.get(rid);
        if (!r) v('RESOURCE_UNKNOWN', `"${variant.title}" uses unknown resource "${rid}"`, { taskId: t.id });
        else if (!r.available) v('RESOURCE_DOWN', `"${variant.title}" needs ${r.name}, which is unavailable`, { taskId: t.id, resourceId: rid });
      }
      if (variant.eligiblePeople.length === 0) {
        if (st.personId !== null) v('PERSON_NOT_ELIGIBLE', `"${variant.title}" is hands-free but has an assignee`, { taskId: t.id });
      } else if (!st.personId) {
        v('PERSON_MISSING', `"${variant.title}" has no assignee`, { taskId: t.id });
      } else if (!people.has(st.personId)) {
        v('PERSON_UNKNOWN', `"${variant.title}" is assigned to unknown person "${st.personId}"`, { taskId: t.id });
      } else if (!variant.eligiblePeople.includes(st.personId)) {
        v('PERSON_NOT_ELIGIBLE', `${people.get(st.personId).name} is not eligible for "${variant.title}"`, { taskId: t.id, personId: st.personId });
      } else {
        const p = people.get(st.personId);
        if (st.startMin < p.availableFrom || st.endMin > p.availableTo) {
          v('PERSON_UNAVAILABLE', `${p.name} is not available ${clock(st.startMin)}–${clock(st.endMin)}`, { taskId: t.id, personId: p.id });
        }
      }
    }
    checks++;
    if (st.endMin > s.deadlineMin) v('DEADLINE_EXCEEDED', `"${variant.title}" ends ${clock(st.endMin)}, after the deadline ${clock(s.deadlineMin)}`, { taskId: t.id });
    if (t.latestEndMin !== null && st.endMin > t.latestEndMin) v('WINDOW_VIOLATED', `"${variant.title}" ends after its latest end`, { taskId: t.id });
    for (const depId of t.dependsOn) {
      checks++;
      const dep = scheduled.get(depId);
      if (dep) {
        if (st.startMin < dep.endMin) v('DEPENDENCY_ORDER', `"${variant.title}" starts before "${tasks.get(depId).title}" finishes`, { taskId: t.id, dependsOn: depId });
      } else if (!isCommitted) {
        v('ORPHAN_TASK', `"${variant.title}" depends on "${tasks.get(depId).title}", which is not scheduled`, { taskId: t.id, dependsOn: depId });
      }
    }
    for (const depId of t.softDependsOn || []) {
      checks++;
      const dep = scheduled.get(depId);
      if (dep && st.startMin < dep.endMin) v('DEPENDENCY_ORDER', `"${variant.title}" starts before "${tasks.get(depId).title}" finishes`, { taskId: t.id, dependsOn: depId });
    }
  }

  const byPerson = new Map();
  const byResource = new Map();
  for (const st of scheduled.values()) {
    if (st.personId) {
      if (!byPerson.has(st.personId)) byPerson.set(st.personId, []);
      byPerson.get(st.personId).push(st);
    }
    for (const rid of st.resources || []) {
      if (!byResource.has(rid)) byResource.set(rid, []);
      byResource.get(rid).push(st);
    }
  }
  for (const [pid, list] of byPerson) {
    checks++;
    if (maxConcurrent(list) > 1) v('PERSON_DOUBLE_BOOKED', `${people.get(pid)?.name || pid} is double-booked`, { personId: pid });
  }
  for (const [rid, list] of byResource) {
    checks++;
    const r = resources.get(rid);
    if (r && maxConcurrent(list) > r.capacity) v('RESOURCE_OVER_CAPACITY', `${r.name} is used beyond its capacity of ${r.capacity}`, { resourceId: rid });
  }

  checks++;
  const totalCost = [...scheduled.values()].reduce((sum, st) => sum + st.actualCost, 0);
  if (totalCost > s.budgetCap) v('BUDGET_EXCEEDED', `Total cost $${totalCost} exceeds the budget of $${s.budgetCap}`);

  return { valid: violations.length === 0, violations, checks, totalCost };
}
