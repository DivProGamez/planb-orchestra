import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../src/data/scenarios.js';
import { normalizeShock, validateShocks, applyShocks } from '../src/engine/shocks.js';
import { parseCommand, findDuration } from '../src/engine/parser.js';
import { planSchedule } from '../src/engine/scheduler.js';
import { diffPlans } from '../src/engine/diff.js';
import { validateIntentResult, validateIntentRequest } from '../server/schema.js';
import { stateOf } from './helpers.js';

const dinner = () => stateOf(getScenario('dinner-for-six'));

test('shock schema rejects unknown types, extra fields, bad ids and non-integers', () => {
  const s = dinner();
  assert.equal(normalizeShock({ type: 'meteor', payload: {} }, s).ok, false);
  assert.equal(normalizeShock({ type: 'person_unavailable', payload: { personId: 'zed' } }, s).ok, false);
  assert.equal(normalizeShock({ type: 'resource_unavailable', payload: { resourceId: 'oven', note: 'x' } }, s).ok, false);
  assert.equal(normalizeShock({ type: 'deadline_earlier', payload: { minutes: 12.5 } }, s).ok, false);
  assert.equal(normalizeShock({ type: 'budget_reduced', payload: { newCap: 150 } }, s).ok, false);
  assert.equal(normalizeShock({ type: 'task_skipped', payload: { taskId: 'serve' } }, s).ok, false, 'must task cannot be skipped');
  assert.equal(normalizeShock({ type: 'task_skipped', payload: { taskId: 'salad' } }, s).ok, false, 'salad has a required dependent');
  assert.equal(normalizeShock({ type: 'task_skipped', payload: { taskId: 'bread' } }, s).ok, true);
  const tooEarly = normalizeShock({ type: 'deadline_earlier', payload: { minutes: 180 } }, s);
  assert.equal(tooEarly.ok, false, 'deadline at/before now is rejected in plain language');
  assert.match(tooEarly.error, /not after the current time/);
  assert.equal(validateShocks([], s).ok, false);
  assert.equal(validateShocks(Array(5).fill({ type: 'deadline_earlier', payload: { minutes: 1 } }), s).ok, false);
});

test('two shocks can be combined in one turn and are validated sequentially', () => {
  const s = dinner();
  const ok = validateShocks([
    { type: 'deadline_earlier', payload: { minutes: 60 } },
    { type: 'resource_unavailable', payload: { resourceId: 'oven' } },
  ], s);
  assert.equal(ok.ok, true);
  const dup = validateShocks([
    { type: 'resource_unavailable', payload: { resourceId: 'oven' } },
    { type: 'resource_unavailable', payload: { resourceId: 'oven' } },
  ], s);
  assert.equal(dup.ok, false, 'second outage of the same oven is rejected');
});

test('local parser maps the demo phrases to structured shocks', () => {
  const s = dinner();
  const p1 = parseCommand('Guests are arriving an hour early and the oven broke.', s);
  assert.equal(p1.intent, 'shocks');
  const byType = (list) => [...list].sort((a, b) => a.type.localeCompare(b.type));
  assert.deepEqual(byType(p1.shocks), [
    { type: 'deadline_earlier', payload: { minutes: 60 } },
    { type: 'resource_unavailable', payload: { resourceId: 'oven' } },
  ]);
  assert.equal(p1.parser, 'local');
  const p2 = parseCommand('Guests will arrive 60 minutes earlier. The oven is broken.', s);
  assert.deepEqual(new Set(p2.shocks.map((x) => x.type)), new Set(['deadline_earlier', 'resource_unavailable']));
  assert.deepEqual(parseCommand('Sam cannot help anymore.', s).shocks, [{ type: 'person_unavailable', payload: { personId: 'sam' } }]);
  assert.deepEqual(parseCommand('Our budget is now $55.', s).shocks, [{ type: 'budget_reduced', payload: { newCap: 55 } }]);
  assert.deepEqual(parseCommand('Cut the budget by $20', s).shocks, [{ type: 'budget_reduced', payload: { newCap: 80 } }]);
  assert.equal(parseCommand('Can we still serve the meal on time?', s).intent, 'status');
  assert.equal(parseCommand('Undo the last change.', s).intent, 'undo');
  assert.equal(parseCommand('Restore the original plan', s).intent, 'restore');
  assert.deepEqual(parseCommand('Advance the clock 40 minutes.', s), { ...parseCommand('Advance the clock 40 minutes.', s), intent: 'advance', minutes: 40 });
  assert.deepEqual(parseCommand('Guests now arrive at 6:30 PM', s).shocks, [{ type: 'deadline_earlier', payload: { minutes: 30 } }]);
  assert.deepEqual(parseCommand('Shopping is running 20 minutes late', s).shocks, [{ type: 'duration_increase', payload: { taskId: 'shop', extraMin: 20 } }]);
  assert.deepEqual(parseCommand('Skip the bread', s).shocks, [{ type: 'task_skipped', payload: { taskId: 'bread' } }]);
  assert.deepEqual(parseCommand('Sam and Leila cannot help', s).shocks.map((x) => x.payload.personId), ['sam', 'leila']);
  assert.equal(parseCommand('Please paint the fence purple', s).intent, 'unknown');
  assert.equal(findDuration('an hour and a half earlier'), 90);
  assert.equal(findDuration('half an hour'), 30);
  assert.equal(findDuration('1 hour 15 minutes'), 75);
});

test('G1.13 malformed LLM output and unknown ids are rejected by the server schema', () => {
  const s = dinner();
  assert.equal(validateIntentResult(null, s).ok, false);
  assert.equal(validateIntentResult('{"intent":"shocks"}', s).ok, false, 'raw string is not accepted');
  assert.equal(validateIntentResult({ intent: 'launch_rocket' }, s).ok, false);
  assert.equal(validateIntentResult({ intent: 'shocks', shocks: [] }, s).ok, false);
  assert.equal(validateIntentResult({ intent: 'shocks', shocks: [{ type: 'person_unavailable', personId: 'ghost' }] }, s).ok, false);
  assert.equal(validateIntentResult({ intent: 'shocks', shocks: [{ type: 'resource_unavailable', resourceId: 'microwave' }] }, s).ok, false);
  assert.equal(validateIntentResult({ intent: 'shocks', shocks: [{ type: 'budget_reduced', newCap: '55' }] }, s).ok, false);
  assert.equal(validateIntentResult({ intent: 'advance', advanceMinutes: -5 }, s).ok, false);
  const good = validateIntentResult({ intent: 'shocks', shocks: [{ type: 'person_unavailable', personId: 'sam', minutes: null, resourceId: null }] }, s);
  assert.equal(good.ok, true);
  assert.deepEqual(good.parsed.shocks, [{ type: 'person_unavailable', payload: { personId: 'sam' } }]);
  assert.equal(good.parsed.parser, 'llm');
  assert.equal(validateIntentRequest({ text: '', context: {} }).ok, false);
  assert.equal(validateIntentRequest({ text: 'x'.repeat(501), context: { nowMin: 0, scenario: s.scenario } }).ok, false);
  assert.equal(validateIntentRequest({ text: 'hi', context: { nowMin: 0, scenario: { bogus: true } } }).ok, false);
  assert.equal(validateIntentRequest({ text: 'hi', context: { nowMin: 0, scenario: s.scenario } }).ok, true);
});

function turn(state, plan, shocks, atMin) {
  const next = applyShocks(state, plan, shocks, atMin);
  const nextPlan = planSchedule(next, { preferVariants: Object.fromEntries(plan.scheduled.map((x) => [x.taskId, x.variantId])) });
  return { next, nextPlan, diff: nextPlan.feasible ? diffPlans({ prevState: state, prevPlan: plan, nextState: next, nextPlan }) : null };
}

test('G1.14 reason codes match the constraints that actually changed', () => {
  const s0 = dinner();
  const p0 = planSchedule(s0);
  const oven = turn(s0, p0, [{ type: 'resource_unavailable', payload: { resourceId: 'oven' } }], 0);
  const codes = new Set(oven.diff.changed.flatMap((e) => e.reasons.map((r) => r.code)));
  assert.ok(codes.has('RESOURCE_DOWN'));
  assert.ok(codes.has('ALTERNATIVE_USED'));
  for (const forbidden of ['PERSON_UNAVAILABLE', 'BUDGET_CUT', 'EARLIER_DEADLINE']) assert.ok(!codes.has(forbidden), forbidden);
  const roast = oven.diff.entries.find((e) => e.taskId === 'roast');
  assert.equal(roast.kind, 'Replaced');
  assert.ok(roast.reasons.find((r) => r.code === 'RESOURCE_DOWN').evidence[0].includes('Oven'));

  const sam = turn(s0, p0, [{ type: 'person_unavailable', payload: { personId: 'sam' } }], 40);
  const samCodes = new Set(sam.diff.changed.flatMap((e) => e.reasons.map((r) => r.code)));
  assert.ok(samCodes.has('PERSON_UNAVAILABLE'));
  for (const forbidden of ['RESOURCE_DOWN', 'BUDGET_CUT', 'EARLIER_DEADLINE']) assert.ok(!samCodes.has(forbidden), forbidden);
  for (const e of sam.diff.entries.filter((x) => x.frozen)) assert.equal(e.kind, 'Unchanged', `${e.taskId} frozen but changed`);

  const birthday = stateOf(getScenario('childrens-birthday'));
  const pb = planSchedule(birthday);
  const cut = turn(birthday, pb, [{ type: 'budget_reduced', payload: { newCap: 90 } }], 0);
  const cutCodes = new Set(cut.diff.changed.flatMap((e) => e.reasons.map((r) => r.code)));
  assert.ok(cutCodes.has('BUDGET_CUT'));
  assert.ok(cutCodes.has('OPTIONAL_DROPPED'));
  for (const forbidden of ['RESOURCE_DOWN', 'PERSON_UNAVAILABLE', 'EARLIER_DEADLINE']) assert.ok(!cutCodes.has(forbidden), forbidden);
  assert.deepEqual(cut.diff.turnCodes, ['BUDGET_CUT']);
  // Every entry with reasons is a real change, and every change has at least one reason.
  for (const e of [...oven.diff.entries, ...sam.diff.entries, ...cut.diff.entries]) {
    if (e.kind === 'Unchanged') assert.equal(e.reasons.length, 0);
    else assert.ok(e.reasons.length > 0, `${e.taskId} ${e.kind} has no reason`);
  }
});

test('diff deltas are computed from real schedule coordinates', () => {
  const s0 = dinner();
  const p0 = planSchedule(s0);
  const t = turn(s0, p0, [{ type: 'deadline_earlier', payload: { minutes: 60 } }, { type: 'resource_unavailable', payload: { resourceId: 'oven' } }], 0);
  for (const e of t.diff.entries) {
    if (e.before && e.after) assert.equal(e.deltaMinutes, e.after.startMin - e.before.startMin);
  }
  const serve = t.diff.entries.find((e) => e.taskId === 'serve');
  assert.ok(serve.deltaMinutes < 0, 'serve moves earlier after the faster alternative');
});
