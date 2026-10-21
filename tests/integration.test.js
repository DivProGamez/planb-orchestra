import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getScenario } from '../src/data/scenarios.js';
import { currentRevision } from '../src/engine/session.js';
import { validatePlan } from '../src/engine/validate.js';
import { applyOption } from '../src/engine/agent.js';
import { newSession, say, stateOf } from './helpers.js';

function assertHeadValid(session) {
  const head = currentRevision(session);
  const check = validatePlan(head.state, head.plan);
  assert.equal(check.valid, true, JSON.stringify(check.violations));
}

test('full dinner journey: two shocks, infeasible budget with verified options, option, undo, restore', () => {
  let session = newSession('dinner-for-six');
  assertHeadValid(session);

  let t = say(session, 'Guests are arriving an hour early and the oven broke.', 'quick');
  assert.equal(t.reply.tone, 'done');
  session = t.session;
  assert.equal(session.revisions.length, 2);
  assert.equal(currentRevision(session).state.scenario.deadlineMin, 120);
  assertHeadValid(session);
  assert.ok(t.steps.some((s) => s.tool === 'validate_plan' && s.status === 'ok'));

  session = say(session, 'Advance the clock 40 minutes.').session;
  t = say(session, 'Sam cannot help anymore.');
  session = t.session;
  assert.equal(session.revisions.length, 3, 'second shock on the same session');
  assertHeadValid(session);
  const head = currentRevision(session);
  assert.ok(head.plan.scheduled.every((st) => st.personId !== 'sam' || head.state.committed[st.taskId]));

  t = say(session, 'Our budget is now $80.');
  assert.equal(t.reply.tone, 'failure');
  assert.equal(t.proposal.feasible, false);
  assert.ok(t.proposal.plan.violations.some((v) => v.code === 'BUDGET_EXCEEDED'));
  assert.ok(t.proposal.options.length >= 2, 'two user-confirmable options');
  assert.equal(t.session.revisions.length, 3, 'nothing committed for an infeasible request');
  assert.equal(currentRevision(t.session).state.scenario.budgetCap, 100, 'constraints unchanged');
  session = t.session;

  const skip = t.proposal.options.find((o) => o.kind === 'skip');
  const applied = applyOption(session, t.proposal, skip, { now: 3 });
  assert.equal(applied.reply.tone, 'done');
  session = applied.session;
  assert.equal(session.revisions.length, 4);
  const h4 = currentRevision(session);
  assert.equal(h4.state.scenario.budgetCap, 80);
  assert.ok(h4.plan.totalCost <= 80);
  assert.ok(h4.plan.dropped.some((d) => d.taskId === 'bread' && d.cause === 'user'));
  assertHeadValid(session);

  // G1.11 undo restores the previous revision, not the original.
  const undone = say(session, 'Undo the last change.').session;
  assert.equal(undone.revisions.length, 3);
  assert.deepEqual(currentRevision(undone).plan.scheduled, currentRevision(t.session).plan.scheduled);
  assert.notDeepEqual(currentRevision(undone).plan.scheduled, undone.revisions[0].plan.scheduled);

  const restored = say(undone, 'Restore the original plan').session;
  assert.equal(restored.revisions.length, 1);
  assert.equal(restored.nowMin, 0);
  assert.ok(restored.shockLog.every((s) => s.undone));
});

test('status question is answered from validated plan data', () => {
  const t = say(newSession('dinner-for-six'), 'Can we still serve the meal on time?');
  assert.match(t.reply.text, /Plate & serve/);
  assert.match(t.reply.text, /0 violations/);
});

test('unknown and invalid commands fail without changing the plan', () => {
  const s = newSession('childrens-birthday');
  const unknown = say(s, 'Order a pony');
  assert.equal(unknown.reply.tone, 'failure');
  assert.equal(unknown.session.revisions.length, 1);
  const invalid = say(s, 'Skip the snacks');
  assert.equal(invalid.reply.tone, 'failure');
  assert.match(invalid.reply.text, /must-do/);
  assert.equal(invalid.session.revisions.length, 1);
});

async function withServer(env, fn) {
  const server = createApp({ env }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('server: health, static client, and LLM endpoint failing closed without a key', async () => {
  await withServer({}, async (base) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.llm.enabled, false);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /PlanB Orchestra/);
    const engine = await fetch(`${base}/engine/scheduler.js`);
    assert.equal(engine.status, 200);

    const context = { scenario: stateOf(getScenario('dinner-for-six')).scenario, nowMin: 0 };
    const noKey = await fetch(`${base}/api/intent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Sam is sick', context }) });
    assert.equal(noKey.status, 503);
    assert.equal((await noKey.json()).fallback, 'local');

    const bad = await fetch(`${base}/api/intent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(bad.status, 400);
    const missing = await fetch(`${base}/api/intent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) });
    assert.equal(missing.status, 400);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });
});

test('server: a configured adapter result is still schema-checked', async () => {
  const adapter = {
    llmStatus: async () => ({ enabled: true, provider: 'test-double', model: 'none' }),
    parseWithLlm: async () => ({ ok: false, error: 'Unknown person "ghost"' }),
  };
  const server = createApp({ env: {}, adapter }).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const context = { scenario: stateOf(getScenario('dinner-for-six')).scenario, nowMin: 0 };
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/intent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Ghost left', context }) });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).fallback, 'local');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
