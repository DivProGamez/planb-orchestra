// Before/after diff generated from two plan states, with reason codes derived from the
// constraint changes that actually happened between the two states.

import { indexById, formatClock, getVariant, personName, resourceName, orderingPreds } from './model.js';

function constraintChanges(prev, next) {
  const ps = prev.scenario;
  const ns = next.scenario;
  const prevPeople = indexById(ps.people);
  const prevRes = indexById(ps.resources);
  const prevTasks = indexById(ps.tasks);
  return {
    deadlineDelta: ns.deadlineMin - ps.deadlineMin,
    budgetDelta: ns.budgetCap - ps.budgetCap,
    peopleLost: ns.people.filter((p) => prevPeople.get(p.id) && p.availableTo < prevPeople.get(p.id).availableTo).map((p) => p.id),
    resourcesDown: ns.resources.filter((r) => !r.available && prevRes.get(r.id)?.available).map((r) => r.id),
    longer: ns.tasks.filter((t) => prevTasks.get(t.id) && t.durationMin > prevTasks.get(t.id).durationMin).map((t) => t.id),
    skipped: ns.tasks.filter((t) => t.status === 'dropped' && prevTasks.get(t.id)?.status !== 'dropped').map((t) => t.id),
  };
}

function snapshot(st) {
  if (!st) return null;
  return {
    personId: st.personId, startMin: st.startMin, endMin: st.endMin, durationMin: st.durationMin,
    variantId: st.variantId, title: st.title, cost: st.actualCost, resources: st.resources,
  };
}

/**
 * Builds the per-task diff between the previous and the next plan.
 * Returns { entries, changed, counts, turnCodes }.
 */
export function diffPlans({ prevState, prevPlan, nextState, nextPlan }) {
  const ns = nextState.scenario;
  const clock = (m) => formatClock(ns, m);
  const ch = constraintChanges(prevState, nextState);
  const prevMap = new Map((prevPlan?.scheduled || []).map((st) => [st.taskId, st]));
  const nextMap = new Map((nextPlan?.scheduled || []).map((st) => [st.taskId, st]));
  const droppedNext = new Map((nextPlan?.dropped || []).map((d) => [d.taskId, d]));
  const prevTasks = indexById(prevState.scenario.tasks);
  const people = indexById(ns.people);

  // Constraint changes that reduce time or capacity, with factual evidence.
  const pressure = [];
  if (ch.deadlineDelta < 0) pressure.push({ code: 'EARLIER_DEADLINE', evidence: `Deadline moved ${clock(prevState.scenario.deadlineMin)} → ${clock(ns.deadlineMin)}` });
  if (ch.peopleLost.length) pressure.push({ code: 'PERSON_UNAVAILABLE', evidence: ch.peopleLost.map((id) => `${personName(ns, id)} unavailable from ${clock(people.get(id).availableTo)}`).join('; ') });
  if (ch.resourcesDown.length) pressure.push({ code: 'RESOURCE_DOWN', evidence: `${ch.resourcesDown.map((id) => resourceName(ns, id)).join(', ')} unavailable` });
  if (ch.longer.length) pressure.push({ code: 'DURATION_INCREASED', evidence: ch.longer.map((id) => `"${ns.tasks.find((t) => t.id === id).title}" takes longer`).join('; ') });
  const relax = [];
  if (ch.deadlineDelta > 0) relax.push({ code: 'DEADLINE_EXTENDED', evidence: `Deadline moved ${clock(prevState.scenario.deadlineMin)} → ${clock(ns.deadlineMin)}` });
  if (ch.budgetDelta > 0) relax.push({ code: 'BUDGET_RAISED', evidence: `Budget $${prevState.scenario.budgetCap} → $${ns.budgetCap}` });
  const budgetCut = ch.budgetDelta < 0 ? { code: 'BUDGET_CUT', evidence: `Budget $${prevState.scenario.budgetCap} → $${ns.budgetCap}` } : null;
  const turnCodes = [...pressure, ...(budgetCut ? [budgetCut] : []), ...relax].map((r) => r.code);

  const busyWith = (personId, startMin, endMin, exceptId) => [...nextMap.values()].find(
    (st) => st.taskId !== exceptId && st.personId === personId && st.startMin < endMin && st.endMin > startMin,
  );

  const entries = ns.tasks.map((task) => {
    const before = prevMap.get(task.id);
    const after = nextMap.get(task.id);
    const frozen = Boolean(nextState.committed?.[task.id]);
    const kinds = [];
    if (before && !after) kinds.push('Removed');
    if (!before && after) kinds.push('Restored');
    if (before && after) {
      if (before.variantId !== after.variantId) kinds.push('Replaced');
      if (before.personId !== after.personId) kinds.push('Reassigned');
      if (before.variantId === after.variantId && after.durationMin < before.durationMin) kinds.push('Shortened');
      if (before.variantId === after.variantId && after.durationMin > before.durationMin) kinds.push('Lengthened');
      if (before.startMin !== after.startMin) kinds.push('Moved');
    }
    const reasons = [];
    const add = (code, evidence) => {
      const existing = reasons.find((r) => r.code === code);
      if (!existing) reasons.push({ code, evidence: [evidence].filter(Boolean) });
      else if (evidence && !existing.evidence.includes(evidence)) existing.evidence.push(evidence);
    };
    const addAll = (list) => list.forEach((r) => add(r.code, r.evidence));
    const turnFallback = () => {
      if (pressure.length) addAll(pressure);
      else if (budgetCut) add(budgetCut.code, budgetCut.evidence);
      else if (relax.length) addAll(relax);
    };

    for (const kind of kinds) {
      if (kind === 'Removed') {
        const d = droppedNext.get(task.id);
        if (d?.cause === 'user') { add('USER_SKIPPED', `You confirmed skipping "${task.title}"`); continue; }
        add('OPTIONAL_DROPPED', `Optional task removed so required tasks still fit`);
        if (d?.cause === 'dependency') {
          const dep = task.dependsOn.find((x) => droppedNext.has(x));
          if (dep) add('DEPENDENCY_PROPAGATION', `Depends on "${ns.tasks.find((t) => t.id === dep).title}", which was removed`);
        }
        const oldVariant = getVariant(prevState.scenario, prevTasks.get(task.id), before.variantId);
        const downRes = (oldVariant?.resources || []).filter((r) => ch.resourcesDown.includes(r));
        if (downRes.length) add('RESOURCE_DOWN', `${downRes.map((r) => resourceName(ns, r)).join(', ')} unavailable`);
        else if (budgetCut && before.actualCost > 0) add('BUDGET_CUT', `${budgetCut.evidence}; frees $${before.actualCost}`);
        else turnFallback();
      } else if (kind === 'Restored') {
        if (relax.length) addAll(relax); else add('SCHEDULE_REBALANCED', 'Fits again in the recomputed plan');
      } else if (kind === 'Replaced') {
        add('ALTERNATIVE_USED', `Now "${after.title}" (was "${before.title}")`);
        const oldVariant = getVariant(prevState.scenario, prevTasks.get(task.id), before.variantId)
          || getVariant(ns, task, before.variantId);
        const downRes = (oldVariant?.resources || []).filter((r) => ch.resourcesDown.includes(r));
        const lostPeople = oldVariant?.eligiblePeople?.length && oldVariant.eligiblePeople.every((pid) => ch.peopleLost.includes(pid));
        if (downRes.length) add('RESOURCE_DOWN', `"${before.title}" needs ${downRes.map((r) => resourceName(ns, r)).join(', ')}, now unavailable`);
        else if (lostPeople) add('PERSON_UNAVAILABLE', `Nobody eligible for "${before.title}" is still available`);
        else if (budgetCut && after.actualCost < before.actualCost) add('BUDGET_CUT', `Saves $${before.actualCost - after.actualCost}; budget now $${ns.budgetCap}`);
        else if (ch.deadlineDelta < 0 && after.durationMin < before.durationMin) add('EARLIER_DEADLINE', `Saves ${before.durationMin - after.durationMin} min; deadline now ${clock(ns.deadlineMin)}`);
        else turnFallback();
      } else if (kind === 'Reassigned') {
        const oldP = before.personId ? people.get(before.personId) : null;
        if (oldP && ch.peopleLost.includes(oldP.id) && oldP.availableTo < after.endMin) {
          add('PERSON_UNAVAILABLE', `${oldP.name} unavailable from ${clock(oldP.availableTo)}`);
        } else if (oldP && kinds.includes('Replaced')) {
          const nv = getVariant(ns, task, after.variantId);
          if (nv && !nv.eligiblePeople.includes(oldP.id)) add('ALTERNATIVE_USED', `${oldP.name} is not listed for "${after.title}"`);
          else add('SCHEDULE_REBALANCED', `Assigned to ${personName(ns, after.personId)} in the recomputed plan`);
        } else if (oldP) {
          const clash = busyWith(oldP.id, after.startMin, after.endMin, task.id);
          add('SCHEDULE_REBALANCED', clash
            ? `${oldP.name} is busy with "${clash.title}" ${clock(clash.startMin)}–${clock(clash.endMin)}`
            : `${personName(ns, after.personId)} is the first eligible person free at ${clock(after.startMin)}`);
        } else {
          add('SCHEDULE_REBALANCED', `Hands-on version needs a person: ${personName(ns, after.personId)} is the first eligible person free`);
        }
      } else if (kind === 'Shortened') {
        const v = getVariant(ns, task, after.variantId);
        add('DURATION_COMPRESSED', `${before.durationMin} → ${after.durationMin} min (minimum ${v?.minDurationMin ?? '?'} min)`);
        turnFallback();
      } else if (kind === 'Lengthened') {
        if (ch.longer.includes(task.id)) add('DURATION_INCREASED', `Now ${after.durationMin} min (was ${before.durationMin} min)`);
        else if (relax.length) addAll(relax);
        else add('SCHEDULE_REBALANCED', `Compression no longer needed (${before.durationMin} → ${after.durationMin} min)`);
      } else if (kind === 'Moved') {
        const predEnds = orderingPreds(task).map((id) => nextMap.get(id)).filter(Boolean);
        const binding = predEnds.sort((a, b) => b.endMin - a.endMin)[0];
        const prevBinding = binding ? prevMap.get(binding.taskId) : null;
        if (binding && after.startMin === binding.endMin && (!prevBinding || prevBinding.endMin !== binding.endMin)) {
          add('DEPENDENCY_PROPAGATION', `Starts when "${binding.title}" ends at ${clock(binding.endMin)}${prevBinding ? ` (was ${clock(prevBinding.endMin)})` : ''}`);
        } else if (before.endMin > ns.deadlineMin) {
          add('EARLIER_DEADLINE', `Old slot ended ${clock(before.endMin)}, after the new deadline ${clock(ns.deadlineMin)}`);
        } else if (after.startMin > before.startMin) {
          const clash = after.personId ? [...nextMap.values()].find((st) => st.taskId !== task.id && st.personId === after.personId && st.endMin === after.startMin) : null;
          const resClash = !clash ? [...nextMap.values()].find((st) => st.taskId !== task.id && st.endMin === after.startMin && st.resources.some((r) => after.resources.includes(r))) : null;
          if (clash) add('SCHEDULE_REBALANCED', `${personName(ns, after.personId)} is busy with "${clash.title}" until ${clock(clash.endMin)}`);
          else if (resClash) add('SCHEDULE_REBALANCED', `${resClash.resources.filter((r) => after.resources.includes(r)).map((r) => resourceName(ns, r)).join(', ')} in use by "${resClash.title}" until ${clock(resClash.endMin)}`);
          else add('SCHEDULE_REBALANCED', `Earliest feasible slot is now ${clock(after.startMin)}`);
        } else {
          add('SCHEDULE_REBALANCED', `An earlier slot opened at ${clock(after.startMin)}`);
        }
      }
    }

    return {
      taskId: task.id,
      title: after?.title || before?.title || task.title,
      beforeTitle: before?.title || null,
      priority: task.priority,
      kind: kinds[0] || 'Unchanged',
      kinds,
      before: snapshot(before),
      after: snapshot(after),
      deltaMinutes: before && after ? after.startMin - before.startMin : null,
      frozen,
      reasons,
    };
  });

  const changed = entries.filter((e) => e.kind !== 'Unchanged');
  const counts = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return { entries, changed, counts, turnCodes };
}
