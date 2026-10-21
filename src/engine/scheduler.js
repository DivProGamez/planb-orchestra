// Deterministic, bounded list scheduler.
// Search order (per the engine contract): keep previous/base variants and full durations,
// then try compression, then listed alternatives, then dropping optional tasks.
// Every candidate result is re-checked by the independent validatePlan().

import { PRIORITY_RANK, indexById, getVariants, formatClock, personName, resourceName, orderingPreds } from './model.js';
import { validateScenario, validatePlan } from './validate.js';

export const COMPRESSION_LEVELS = 4;
export const SEARCH_LIMIT = 8000;
// Priority rules for picking the next ready task; tried in this order at every compression level.
const ORDERINGS = ['priority', 'critical', 'fixture'];
const MAX_COMBOS = 96;
const MAX_DROP_CANDIDATES = 6;

const nowMs = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/** Duration of a variant at a global compression level (0 = full, 4 = minimum). */
export function compressedDuration(variant, level) {
  if (!variant.compressible || level <= 0) return variant.durationMin;
  const span = variant.durationMin - variant.minDurationMin;
  if (level >= COMPRESSION_LEVELS) return variant.minDurationMin;
  // Cuts are rounded to 5-minute steps so plans read naturally (45 → 40, not 45 → 43).
  const cut = Math.min(span, Math.round((span * level) / COMPRESSION_LEVELS / 5) * 5);
  return variant.durationMin - cut;
}

function buildContext(state) {
  const s = state.scenario;
  const successors = new Map(s.tasks.map((t) => [t.id, []]));
  for (const t of s.tasks) for (const d of orderingPreds(t)) successors.get(d)?.push(t.id);
  return {
    s,
    nowMin: state.nowMin ?? s.startMin,
    peopleById: indexById(s.people),
    resById: indexById(s.resources),
    taskById: indexById(s.tasks),
    taskIndex: new Map(s.tasks.map((t, i) => [t.id, i])),
    committedList: Object.values(state.committed || {}),
    pending: s.tasks.filter((t) => t.status === 'todo'),
    userDropped: new Set(s.tasks.filter((t) => t.status === 'dropped').map((t) => t.id)),
    successors,
  };
}

/** Why a variant cannot be used at all under the current constraints (empty = usable). */
export function variantBlockers(ctx, variant) {
  const blockers = [];
  for (const rid of variant.resources) {
    if (!ctx.resById.get(rid)?.available) blockers.push({ kind: 'resource', resourceId: rid });
  }
  if (variant.eligiblePeople.length > 0) {
    const need = variant.compressible ? variant.minDurationMin : variant.durationMin;
    const someone = variant.eligiblePeople.some((pid) => {
      const p = ctx.peopleById.get(pid);
      if (!p) return false;
      const from = Math.max(p.availableFrom, ctx.nowMin, ctx.s.startMin);
      const to = Math.min(p.availableTo, ctx.s.deadlineMin);
      return to - from >= need;
    });
    if (!someone) blockers.push({ kind: 'people', people: variant.eligiblePeople });
  }
  return blockers;
}

function orderedLegalVariants(ctx, task, preferVariantId) {
  const legal = getVariants(ctx.s, task).filter((v) => variantBlockers(ctx, v).length === 0);
  const i = legal.findIndex((v) => v.variantId === preferVariantId);
  if (i > 0) legal.unshift(legal.splice(i, 1)[0]);
  return legal;
}

function variantCombos(choices) {
  let combos = [[]];
  for (const c of choices) {
    const next = [];
    for (const combo of combos) for (let i = 0; i < c.variants.length; i++) next.push([...combo, i]);
    combos = next;
    if (combos.length > 4096) break;
  }
  const nonZero = (c) => c.filter((x) => x > 0).length;
  const sum = (c) => c.reduce((a, b) => a + b, 0);
  combos.sort((a, b) => nonZero(a) - nonZero(b) || sum(a) - sum(b) || a.join(',').localeCompare(b.join(',')));
  return combos.slice(0, MAX_COMBOS);
}

function dropSubsets(candidates) {
  const n = Math.min(candidates.length, MAX_DROP_CANDIDATES);
  const subsets = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const ids = [];
    let value = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        ids.push(candidates[i].id);
        value += candidates[i].value ?? 5;
      }
    }
    subsets.push({ ids, value, mask });
  }
  subsets.sort((a, b) => a.ids.length - b.ids.length || a.value - b.value || a.mask - b.mask);
  return subsets;
}

/** Adds optional dependents of dropped tasks; returns null if a required task would be orphaned. */
function closeDrops(ctx, seed) {
  const dropped = new Map([...seed].map((id) => [id, 'search']));
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of ctx.pending) {
      if (dropped.has(t.id)) continue;
      if (t.dependsOn.some((d) => dropped.has(d) || ctx.userDropped.has(d))) {
        if (t.priority !== 'optional') return null;
        dropped.set(t.id, 'dependency');
        changed = true;
      }
    }
  }
  return dropped;
}

function overlapCount(bookings, start, end) {
  // Max concurrent bookings inside [start, end) — bookings are half-open intervals.
  const inside = bookings.filter((b) => b.startMin < end && b.endMin > start);
  if (inside.length <= 1) return inside.length;
  const points = [start, ...inside.map((b) => b.startMin).filter((x) => x > start && x < end)];
  let max = 0;
  for (const p of points) max = Math.max(max, inside.filter((b) => b.startMin <= p && b.endMin > p).length);
  return max;
}

function listSchedule(ctx, cfg) {
  const { s, nowMin } = ctx;
  const personBook = new Map(s.people.map((p) => [p.id, []]));
  const resBook = new Map(s.resources.map((r) => [r.id, []]));
  const endTime = new Map();
  const points = new Set(s.people.map((p) => p.availableFrom));
  for (const c of ctx.committedList) {
    if (c.personId) personBook.get(c.personId)?.push(c);
    for (const rid of c.resources) resBook.get(rid)?.push(c);
    endTime.set(c.taskId, c.endMin);
    points.add(c.endMin);
  }

  const active = ctx.pending.filter((t) => !cfg.dropped.has(t.id));
  const activeIds = new Set(active.map((t) => t.id));
  const tails = new Map();
  const tail = (id) => {
    if (tails.has(id)) return tails.get(id);
    let best = 0;
    for (const succ of ctx.successors.get(id)) if (activeIds.has(succ)) best = Math.max(best, tail(succ));
    const value = cfg.durations.get(id) + best;
    tails.set(id, value);
    return value;
  };
  const rank = (t) => PRIORITY_RANK[t.priority];
  const idx = (t) => ctx.taskIndex.get(t.id);
  const comparators = {
    priority: (a, b) => rank(a) - rank(b) || tail(b.id) - tail(a.id) || idx(a) - idx(b),
    critical: (a, b) => tail(b.id) - tail(a.id) || rank(a) - rank(b) || idx(a) - idx(b),
    fixture: (a, b) => idx(a) - idx(b),
  };
  const cmp = comparators[cfg.ordering];

  const isDone = (depId) => endTime.has(depId) || cfg.dropped.has(depId) || ctx.userDropped.has(depId);
  const remaining = new Set(activeIds);
  const scheduled = [];
  while (remaining.size > 0) {
    const ready = active.filter((t) => remaining.has(t.id) && orderingPreds(t).every(isDone)).sort(cmp);
    if (ready.length === 0) return { ok: false, failure: { kind: 'DEPENDENCY_BLOCKED', taskId: [...remaining][0] } };
    const t = ready[0];
    const variant = cfg.variants.get(t.id);
    const d = cfg.durations.get(t.id);
    const predEnds = orderingPreds(t).filter((dep) => endTime.has(dep)).map((dep) => endTime.get(dep));
    const est = Math.max(nowMin, s.startMin, t.earliestStartMin, ...predEnds);
    const latestEnd = Math.min(s.deadlineMin, t.latestEndMin ?? Infinity);
    const candidates = [...new Set([est, ...[...points].filter((x) => x > est)])].sort((a, b) => a - b);

    let placed = null;
    for (const start of candidates) {
      const end = start + d;
      if (end > latestEnd) break;
      const resourcesFit = variant.resources.every((rid) => {
        const r = ctx.resById.get(rid);
        return r && r.available && overlapCount(resBook.get(rid), start, end) < r.capacity;
      });
      if (!resourcesFit) continue;
      if (variant.eligiblePeople.length === 0) { placed = { personId: null, start, end }; break; }
      const personId = variant.eligiblePeople.find((pid) => {
        const p = ctx.peopleById.get(pid);
        return p && start >= p.availableFrom && end <= p.availableTo && overlapCount(personBook.get(pid), start, end) === 0;
      });
      if (personId) { placed = { personId, start, end }; break; }
    }
    if (!placed) {
      return {
        ok: false,
        failure: { kind: est + d > latestEnd ? 'CHAIN_TOO_LONG' : 'NO_SLOT', taskId: t.id, est, latestEnd, durationMin: d, variant },
      };
    }
    const entry = {
      taskId: t.id,
      title: variant.title,
      variantId: variant.variantId,
      personId: placed.personId,
      startMin: placed.start,
      endMin: placed.end,
      durationMin: d,
      fullDurationMin: variant.durationMin,
      resources: [...variant.resources],
      status: 'todo',
      actualCost: variant.cost,
    };
    if (entry.personId) personBook.get(entry.personId).push(entry);
    for (const rid of entry.resources) resBook.get(rid).push(entry);
    endTime.set(t.id, entry.endMin);
    points.add(entry.endMin);
    remaining.delete(t.id);
    scheduled.push(entry);
  }
  return { ok: true, scheduled };
}

/** After a feasible compressed schedule is found, restore full durations wherever still feasible. */
function relaxCompression(ctx, cfg, levels, result) {
  let best = result;
  const order = [...levels.keys()].sort((a, b) => ctx.taskIndex.get(a) - ctx.taskIndex.get(b));
  for (const taskId of order) {
    const current = levels.get(taskId);
    for (let lvl = 0; lvl < current; lvl++) {
      const durations = new Map(cfg.durations);
      durations.set(taskId, compressedDuration(cfg.variants.get(taskId), lvl));
      const attempt = listSchedule(ctx, { ...cfg, durations });
      if (attempt.ok) {
        cfg = { ...cfg, durations };
        levels.set(taskId, lvl);
        best = attempt;
        break;
      }
    }
  }
  return { result: best, cfg };
}

function minDurationOf(variant) {
  return variant.compressible ? variant.minDurationMin : variant.durationMin;
}

function diagnose(ctx, info) {
  const { s } = ctx;
  const clock = (m) => formatClock(s, m);
  const violations = [];

  for (const c of ctx.committedList) {
    if (c.endMin > s.deadlineMin) {
      violations.push({
        code: 'DEADLINE_EXCEEDED', proof: 'proven', taskId: c.taskId,
        message: `"${c.title}" is already under way and ends ${clock(c.endMin)}, after the deadline ${clock(s.deadlineMin)}`,
      });
    }
  }
  if (Number.isFinite(info.minCost) && info.minCost > s.budgetCap) {
    violations.push({
      code: 'BUDGET_EXCEEDED', proof: 'proven', minCost: info.minCost,
      message: `Cheapest valid plan costs $${info.minCost} (including $${info.committedCost} already committed); the budget is $${s.budgetCap}`,
    });
  }

  // Lower bound on finish times, ignoring contention: minimum durations, fastest usable variant.
  const lb = new Map();
  for (const c of ctx.committedList) lb.set(c.taskId, c.endMin);
  const required = ctx.pending.filter((t) => t.priority !== 'optional' && info.choice.has(t.id));
  const lower = (t) => {
    if (lb.has(t.id)) return lb.get(t.id);
    const variants = info.choice.get(t.id) || [];
    const minDur = Math.min(...variants.map(minDurationOf));
    const fastest = variants.find((v) => minDurationOf(v) === minDur);
    let est = Math.max(ctx.nowMin, s.startMin, t.earliestStartMin);
    if (fastest && fastest.eligiblePeople.length) {
      est = Math.max(est, Math.min(...fastest.eligiblePeople.map((pid) => ctx.peopleById.get(pid)?.availableFrom ?? Infinity)));
    }
    for (const dep of t.dependsOn) {
      const depTask = ctx.taskById.get(dep);
      if (depTask && (lb.has(dep) || info.choice.has(dep))) est = Math.max(est, lower(depTask));
    }
    const value = est + minDur;
    lb.set(t.id, value);
    return value;
  };
  let worst = null;
  for (const t of required) {
    const end = lower(t);
    const limit = Math.min(s.deadlineMin, t.latestEndMin ?? Infinity);
    if (end > limit && (!worst || end - limit > worst.over)) worst = { t, end, limit, over: end - limit };
  }
  if (worst) {
    violations.push({
      code: 'DEADLINE_EXCEEDED', proof: 'proven', taskId: worst.t.id, earliestEndMin: worst.end,
      message: `"${worst.t.title}" cannot finish before ${clock(worst.end)} even with every task at its minimum duration; it must end by ${clock(worst.limit)}`,
    });
  }

  // Person-minutes bound for required, hands-on work.
  const needMin = required.reduce((sum, t) => {
    const variants = (info.choice.get(t.id) || []).filter((v) => v.eligiblePeople.length > 0);
    if (variants.length !== (info.choice.get(t.id) || []).length || variants.length === 0) return sum;
    return sum + Math.min(...variants.map(minDurationOf));
  }, 0);
  const haveMin = s.people.reduce((sum, p) => {
    const from = Math.max(p.availableFrom, ctx.nowMin, s.startMin);
    const to = Math.min(p.availableTo, s.deadlineMin);
    return sum + Math.max(0, to - from);
  }, 0);
  if (needMin > haveMin) {
    violations.push({
      code: 'CAPACITY_EXCEEDED', proof: 'proven', neededMin: needMin, availableMin: haveMin,
      message: `Required hands-on work needs at least ${needMin} person-minutes, but only ${haveMin} remain before ${clock(s.deadlineMin)}`,
    });
  }

  if (violations.length === 0 && info.lastFailure) {
    const f = info.lastFailure;
    const task = ctx.taskById.get(f.taskId);
    const who = f.variant?.eligiblePeople?.length
      ? f.variant.eligiblePeople.map((pid) => personName(s, pid)).join(', ')
      : 'hands-free';
    const what = f.variant?.resources?.length ? ` using ${f.variant.resources.map((r) => resourceName(s, r)).join(', ')}` : '';
    violations.push({
      code: f.kind === 'CHAIN_TOO_LONG' ? 'DEADLINE_EXCEEDED' : 'NO_FEASIBLE_SLOT',
      proof: 'search', taskId: f.taskId,
      message: `Bounded search (${info.tried} configurations) found no slot for "${f.variant?.title || task?.title}": needs ${f.durationMin} min${what}, can start ${clock(f.est)}, must end by ${clock(f.latestEnd)} (eligible: ${who})`,
    });
  }
  if (violations.length === 0) {
    violations.push({ code: 'NO_FEASIBLE_PLAN', proof: 'search', message: `No feasible plan found within ${info.tried} configurations` });
  }
  return violations;
}

function summarize(ctx, scheduled) {
  const { s } = ctx;
  const endMin = scheduled.reduce((m, st) => Math.max(m, st.endMin), s.startMin);
  const utilization = s.people.map((p) => {
    const from = Math.max(p.availableFrom, s.startMin);
    const to = Math.min(p.availableTo, s.deadlineMin);
    const windowMin = Math.max(0, to - from);
    const busyMin = scheduled.filter((st) => st.personId === p.id).reduce((sum, st) => sum + st.durationMin, 0);
    return { personId: p.id, busyMin, windowMin, pct: windowMin ? Math.round((busyMin / windowMin) * 100) : 0 };
  });
  return { endMin, slackMin: s.deadlineMin - endMin, utilization };
}

/**
 * Plans all unfinished work for a constraint state.
 * options.preferVariants: { taskId: variantId } — keeps previous choices stable when still legal.
 */
export function planSchedule(state, options = {}) {
  const t0 = nowMs();
  const s = state.scenario;
  const base = { budgetCap: s.budgetCap, deadlineMin: s.deadlineMin };
  const structural = validateScenario(s);
  if (!structural.ok) {
    return { ...base, feasible: false, scheduled: [], dropped: [], violations: structural.errors.map((e) => ({ ...e, proof: 'proven' })), search: { configsTried: 0, ms: 0 } };
  }
  const ctx = buildContext(state);
  const prefer = options.preferVariants || {};
  const committedCost = ctx.committedList.reduce((sum, c) => sum + c.actualCost, 0);

  const choice = new Map();
  const forcedDrops = new Set();
  const blocked = [];
  for (const t of ctx.pending) {
    const legal = orderedLegalVariants(ctx, t, prefer[t.id]);
    if (legal.length) choice.set(t.id, legal);
    else if (t.priority === 'optional') forcedDrops.add(t.id);
    else blocked.push(t);
  }
  if (blocked.length) {
    const violations = blocked.map((t) => {
      const reasons = getVariants(s, t).map((v) => variantBlockers(ctx, v)).flat();
      const res = [...new Set(reasons.filter((r) => r.kind === 'resource').map((r) => resourceName(s, r.resourceId)))];
      const ppl = reasons.some((r) => r.kind === 'people');
      const why = [res.length ? `${res.join(', ')} unavailable` : null, ppl ? 'no eligible person available long enough' : null].filter(Boolean).join('; ');
      return { code: 'NO_LEGAL_VARIANT', proof: 'proven', taskId: t.id, message: `"${t.title}" (${t.priority}) has no usable version: ${why}` };
    });
    return { ...base, feasible: false, scheduled: [], dropped: [], violations, committedCost, search: { configsTried: 0, ms: Math.round(nowMs() - t0) } };
  }

  const optional = ctx.pending
    .filter((t) => t.priority === 'optional' && !forcedDrops.has(t.id))
    .sort((a, b) => (a.value ?? 5) - (b.value ?? 5) || ctx.taskIndex.get(a.id) - ctx.taskIndex.get(b.id));
  const subsets = dropSubsets(optional);
  const multi = [...choice.entries()].filter(([, vs]) => vs.length > 1).map(([taskId, variants]) => ({ taskId, variants }));
  const combos = variantCombos(multi);

  let tried = 0;
  let minCost = Infinity;
  let lastFailure = null;
  let limitHit = false;
  outer: for (const subset of subsets) {
    const dropped = closeDrops(ctx, new Set([...forcedDrops, ...subset.ids]));
    if (!dropped) continue;
    for (const fid of forcedDrops) dropped.set(fid, 'no_legal_variant');
    for (const combo of combos) {
      const variants = new Map([...choice].map(([id, vs]) => [id, vs[0]]));
      multi.forEach((m, i) => variants.set(m.taskId, m.variants[combo[i]]));
      const cost = committedCost + ctx.pending.filter((t) => !dropped.has(t.id)).reduce((sum, t) => sum + variants.get(t.id).cost, 0);
      minCost = Math.min(minCost, cost);
      if (cost > s.budgetCap) continue;
      for (let level = 0; level <= COMPRESSION_LEVELS; level++) {
        const levels = new Map();
        const durations = new Map();
        for (const [id, v] of variants) {
          if (dropped.has(id)) continue;
          durations.set(id, compressedDuration(v, level));
          if (level > 0 && v.compressible && v.minDurationMin < v.durationMin) levels.set(id, level);
        }
        for (const ordering of ORDERINGS) {
          if (++tried > SEARCH_LIMIT) { limitHit = true; break outer; }
          const cfg = { dropped, variants, durations, ordering };
          const res = listSchedule(ctx, cfg);
          if (!res.ok) { lastFailure = res.failure; continue; }
          const refined = levels.size ? relaxCompression(ctx, cfg, levels, res) : { result: res, cfg };
          const scheduled = [...ctx.committedList.map((c) => ({ ...c })), ...refined.result.scheduled]
            .sort((a, b) => a.startMin - b.startMin || ctx.taskIndex.get(a.taskId) - ctx.taskIndex.get(b.taskId));
          const droppedList = [
            ...[...dropped].map(([taskId, cause]) => ({ taskId, cause })),
            ...[...ctx.userDropped].map((taskId) => ({ taskId, cause: 'user' })),
          ]
            .map((d) => ({ ...d, title: ctx.taskById.get(d.taskId).title, priority: ctx.taskById.get(d.taskId).priority }))
            .sort((a, b) => ctx.taskIndex.get(a.taskId) - ctx.taskIndex.get(b.taskId));
          const plan = { scheduled, dropped: droppedList };
          const validation = validatePlan(state, plan);
          const search = {
            configsTried: tried, ordering, compressionLevel: level, limitHit,
            alternativesUsed: refined.result.scheduled.filter((x) => x.variantId !== 'base').map((x) => x.taskId),
            compressedTasks: refined.result.scheduled.filter((x) => x.durationMin < x.fullDurationMin).map((x) => x.taskId),
            ms: Math.round(nowMs() - t0),
          };
          if (!validation.valid) {
            return { ...base, feasible: false, scheduled: [], dropped: [], committedCost, violations: validation.violations.map((v) => ({ ...v, code: v.code, proof: 'validator' })), search, validation };
          }
          return {
            ...base, feasible: true, ...plan, totalCost: validation.totalCost, committedCost,
            ...summarize(ctx, scheduled), search, validation,
          };
        }
      }
    }
  }

  const violations = diagnose(ctx, { minCost, committedCost, choice, lastFailure, tried });
  return {
    ...base, feasible: false, scheduled: [], dropped: [], violations, committedCost,
    minCost: Number.isFinite(minCost) ? minCost : null,
    search: { configsTried: Math.min(tried, SEARCH_LIMIT), limitHit, ms: Math.round(nowMs() - t0) },
  };
}
