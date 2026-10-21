// Story tests for the birthday and outing scenarios (the dinner story is in integration.test.js),
// plus explicit resource-conflict and dependency checks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { currentRevision } from '../src/engine/session.js';
import { validatePlan, maxConcurrent } from '../src/engine/validate.js';
import { planSchedule } from '../src/engine/scheduler.js';
import { applyOption } from '../src/engine/agent.js';
import { persistRoundTrip } from './persist-helper.js';
import { newSession, say, stateOf, miniScenario } from './helpers.js';

const head = (s) => currentRevision(s);
function valid(session) {
  const h = head(session);
  const res = validatePlan(h.state, h.plan);
  assert.equal(res.valid, true, JSON.stringify(res.violations));
}

test("Children's Birthday: budget cut, helper leaves, impossible early party, verified option, undo, reload", () => {
  let s = newSession('childrens-birthday');
  let t = say(s, 'We need to cut the budget to $90.');
  assert.equal(t.reply.tone, 'done', t.reply.text);
  s = t.session;
  const h1 = head(s);
  assert.ok(h1.plan.totalCost <= 90);
  assert.equal(h1.plan.scheduled.find((x) => x.taskId === 'cake').variantId, 'cake-home');
  assert.ok(h1.plan.dropped.every((d) => d.priority === 'optional'));
  const cutCodes = new Set(t.proposal.diff.changed.flatMap((e) => e.reasons.map((r) => r.code)));
  assert.ok(cutCodes.has('BUDGET_CUT') && cutCodes.has('ALTERNATIVE_USED'));
  valid(s);

  s = say(s, 'Advance the clock 60 minutes.').session;
  t = say(s, 'The helper cannot come anymore.');
  assert.equal(t.reply.tone, 'done', t.reply.text);
  s = t.session;
  assert.ok(head(s).plan.scheduled.every((x) => x.personId !== 'helper' || head(s).state.committed[x.taskId]));
  valid(s);

  t = say(s, 'The party starts 2 hours earlier.');
  assert.equal(t.proposal.feasible, false);
  assert.ok(t.proposal.plan.violations.length > 0 && t.proposal.plan.violations.every((v) => ['proven', 'search'].includes(v.proof)));
  assert.ok(t.proposal.options.length >= 2, 'two verified options');
  assert.equal(t.session.revisions.length, 3, 'infeasible request not committed');
  const extend = t.proposal.options.find((o) => o.kind === 'deadline');
  assert.ok(extend, 'deadline option offered');
  const applied = applyOption(t.session, t.proposal, extend, { now: 5 });
  assert.equal(applied.reply.tone, 'done');
  s = applied.session;
  assert.ok(head(s).plan.endMin <= head(s).state.scenario.deadlineMin);
  valid(s);

  s = say(s, 'Undo').session;
  assert.equal(s.revisions.length, 3);
  const reloaded = persistRoundTrip(s);
  assert.deepEqual(head(reloaded).plan.scheduled, head(s).plan.scheduled);
});

test('Weekend Outing: early arrival, partner called away, budget conflict resolved by skipping a should-task', () => {
  let s = newSession('weekend-outing');
  s = say(s, 'We need to arrive 2 hours earlier.').session;
  s = say(s, 'Advance the clock 30 minutes.').session;
  let t = say(s, 'Parent B got called into work and is unavailable.');
  assert.equal(t.reply.tone, 'done', t.reply.text);
  s = t.session;
  const h = head(s);
  assert.ok(h.plan.scheduled.filter((x) => !h.state.committed[x.taskId]).every((x) => x.personId === 'parent-a'));
  const drive = h.plan.scheduled.find((x) => x.taskId === 'drive');
  for (const dep of ['load', 'fuel', 'bikes', 'tickets']) {
    const d = h.plan.scheduled.find((x) => x.taskId === dep);
    if (d) assert.ok(d.endMin <= drive.startMin, `${dep} must finish before the drive`);
  }
  valid(s);

  t = say(s, 'Our budget is now $100.');
  assert.equal(t.proposal.feasible, false);
  assert.ok(t.proposal.plan.violations.some((v) => v.code === 'BUDGET_EXCEEDED' && v.proof === 'proven'));
  const skip = t.proposal.options.find((o) => o.kind === 'skip');
  assert.ok(skip, 'skip option offered');
  const applied = applyOption(t.session, t.proposal, skip, { now: 6 });
  s = applied.session;
  assert.ok(head(s).plan.totalCost <= 100);
  assert.ok(head(s).plan.dropped.some((d) => d.cause === 'user'));
  valid(s);
});

test('resource conflicts: a capacity-1 resource is never double-booked even with idle people', () => {
  const s = miniScenario();
  s.tasks = [
    { ...s.tasks[0], id: 'x', title: 'X', dependsOn: [], resources: ['oven'] },
    { ...s.tasks[0], id: 'y', title: 'Y', dependsOn: [], resources: ['oven'] },
    { ...s.tasks[0], id: 'z', title: 'Z', dependsOn: [], resources: ['oven'] },
  ];
  const plan = planSchedule(stateOf(s));
  assert.equal(plan.feasible, true);
  assert.equal(maxConcurrent(plan.scheduled), 1, 'oven tasks must run one at a time');
  const tight = { ...s, deadlineMin: 40 };
  const res = planSchedule(stateOf(tight));
  assert.equal(res.feasible, false, 'three oven tasks of at least 15 min cannot fit in 40 min');
});

test('dependencies: every scenario keeps successors after predecessors through a two-change replan', () => {
  for (const [id, a, b] of [
    ['dinner-for-six', 'The oven broke.', 'Sam is sick'],
    ['childrens-birthday', 'The oven died', 'The aunt is running 30 minutes late'],
    ['weekend-outing', 'Parent B is running 20 minutes late', 'Packing will take an extra 15 minutes'],
  ]) {
    let s = newSession(id);
    for (const text of [a, b]) {
      const t = say(s, text);
      assert.equal(t.reply.tone, 'done', `${id}: ${text} → ${t.reply.text}`);
      s = t.session;
    }
    const h = head(s);
    const at = new Map(h.plan.scheduled.map((x) => [x.taskId, x]));
    for (const task of h.state.scenario.tasks) {
      for (const dep of [...task.dependsOn, ...(task.softDependsOn || [])]) {
        if (at.has(task.id) && at.has(dep)) assert.ok(at.get(dep).endMin <= at.get(task.id).startMin, `${id}: ${task.id} after ${dep}`);
      }
    }
    valid(s);
  }
});
