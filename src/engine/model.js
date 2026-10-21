// Core data model helpers shared by the engine and the UI.
// All times are integer minutes relative to the scenario start; money is integer dollars.

export const PRIORITIES = ['must', 'should', 'optional'];
export const PRIORITY_RANK = { must: 0, should: 1, optional: 2 };
export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'dropped'];
export const COMMITTED_STATUSES = new Set(['done', 'in_progress']);
export const BASE_VARIANT = 'base';

export function clone(value) {
  return structuredClone(value);
}

export function indexById(list) {
  return new Map((list || []).map((item) => [item.id, item]));
}

export function isInt(value) {
  return Number.isInteger(value);
}

/**
 * Every task that must finish before `task` starts when both are scheduled:
 * hard dependencies plus soft ones (soft = ordering only; the predecessor may be dropped).
 */
export function orderingPreds(task) {
  return [...task.dependsOn, ...(task.softDependsOn || [])];
}

/** The task as originally specified, expressed as a schedulable variant. */
export function baseVariant(task) {
  return {
    variantId: BASE_VARIANT,
    title: task.title,
    durationMin: task.durationMin,
    minDurationMin: task.minDurationMin,
    cost: task.cost,
    resources: task.resources,
    eligiblePeople: task.eligiblePeople,
    compressible: task.compressible,
  };
}

/** Base variant first, then the explicitly listed fixture alternatives in listed order. */
export function getVariants(scenario, task) {
  const altById = indexById(scenario.alternatives);
  const alts = (task.alternatives || [])
    .map((id) => altById.get(id))
    .filter(Boolean)
    .map((alt) => ({
      variantId: alt.id,
      title: alt.title,
      durationMin: alt.durationMin,
      minDurationMin: alt.minDurationMin,
      cost: alt.cost,
      resources: alt.resources,
      eligiblePeople: alt.eligiblePeople,
      compressible: alt.compressible,
    }));
  return [baseVariant(task), ...alts];
}

export function getVariant(scenario, task, variantId) {
  return getVariants(scenario, task).find((v) => v.variantId === variantId) || null;
}

export function formatClock(scenario, min) {
  const total = (scenario.clockStartMin || 0) + min;
  const dayMin = ((total % 1440) + 1440) % 1440;
  const h24 = Math.floor(dayMin / 60);
  const m = dayMin % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDuration(min) {
  const abs = Math.abs(min);
  const sign = min < 0 ? '−' : '';
  if (abs < 60) return `${sign}${abs} min`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${m} min`;
}

export function formatSigned(min) {
  if (min === 0) return '±0 min';
  return min > 0 ? `+${min} min` : `−${Math.abs(min)} min`;
}

export function formatMoney(amount) {
  return `$${amount}`;
}

export function personName(scenario, personId) {
  if (!personId) return 'Hands-free';
  return scenario.people.find((p) => p.id === personId)?.name || personId;
}

export function resourceName(scenario, resourceId) {
  return scenario.resources.find((r) => r.id === resourceId)?.name || resourceId;
}
