// End-to-end behaviour of leave-at-a-time, late arrival, and restored equipment/people,
// driven through the local parser and agent exactly like typed requests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { currentRevision } from '../src/engine/session.js';
import { validatePlan } from '../src/engine/validate.js';
import { newSession, say } from './helpers.js';

const head = (s) => currentRevision(s);
const codes = (turn) => new Set(turn.proposal.diff.changed.flatMap((e) => e.reasons.map((r) => r.code)));
function assertValid(session) {
  const h = head(session);
  const res = validatePlan(h.state, h.plan);
  assert.equal(res.valid, true, JSON.stringify(res.violations));
}

test('"Alex has to leave at 5 PM" keeps Alex\'s work before 5:00 PM and explains reassignments', () => {
  const t = say(newSession('dinner-for-six'), 'Alex has to leave at 5 PM');
  assert.equal(t.reply.tone, 'done', t.reply.text);
  const h = head(t.session);
  assert.equal(h.state.scenario.people.find((p) => p.id === 'alex').availableTo, 60);
  assert.ok(h.plan.scheduled.filter((st) => st.personId === 'alex').every((st) => st.endMin <= 60));
  assert.ok(codes(t).has('PERSON_UNAVAILABLE'));
  assertValid(t.session);
});

test('"Leila is running 20 minutes late" shifts Leila\'s work and cites the late arrival', () => {
  const t = say(newSession('dinner-for-six'), 'Leila is running 20 minutes late');
  assert.equal(t.reply.tone, 'done', t.reply.text);
  const h = head(t.session);
  assert.ok(h.plan.scheduled.filter((st) => st.personId === 'leila').every((st) => st.startMin >= 20));
  assert.ok(codes(t).has('PERSON_DELAYED'));
  assertValid(t.session);
});

test('oven breaks, then works again: the original roast comes back with an honest reason', () => {
  let s = say(newSession('dinner-for-six'), 'The oven broke.').session;
  assert.equal(head(s).plan.scheduled.find((st) => st.taskId === 'roast').variantId, 'roast-pan');
  const t = say(s, 'Good news, the oven is fixed');
  assert.equal(t.reply.tone, 'done', t.reply.text);
  s = t.session;
  const roast = t.proposal.diff.entries.find((e) => e.taskId === 'roast');
  assert.equal(head(s).plan.scheduled.find((st) => st.taskId === 'roast').variantId, 'base');
  assert.equal(roast.kind, 'Replaced');
  const rc = roast.reasons.map((r) => r.code);
  assert.ok(rc.includes('ORIGINAL_VERSION') && rc.includes('RESOURCE_RESTORED'), rc.join(','));
  assert.ok(!rc.includes('ALTERNATIVE_USED'));
  assertValid(s);
  assert.equal(say(s, 'The oven works again').reply.tone, 'failure', 'already available is rejected');
});

test('"Sam is back" restores availability; claiming it for someone never gone is rejected', () => {
  let s = say(newSession('dinner-for-six'), 'Sam is sick').session;
  assert.ok(head(s).plan.scheduled.every((st) => st.personId !== 'sam'));
  const back = say(s, 'Sam is back and can help again');
  assert.equal(back.reply.tone, 'done', back.reply.text);
  s = back.session;
  assert.equal(head(s).state.scenario.people.find((p) => p.id === 'sam').availableTo, 300);
  assertValid(s);
  const never = say(newSession('dinner-for-six'), 'Leila is back');
  assert.equal(never.reply.tone, 'failure');
  assert.match(never.reply.text, /not marked unavailable/);
});

test('free-form consecutive requests in one session stay valid; undo walks back one step at a time', () => {
  let s = newSession('weekend-outing');
  const script = [
    'We need to be at the lake by 11',
    'Packing will take an extra 15 minutes',
    'Parent A has to leave at 10',
  ];
  for (const text of script) {
    const t = say(s, text);
    s = t.session;
    if (t.reply.tone === 'done') assertValid(s);
    else assert.ok(t.proposal && !t.proposal.feasible, `unexpected failure: ${t.reply.text}`);
  }
  const committed = s.revisions.length;
  assert.ok(committed >= 3, `expected at least 2 committed changes, got ${committed - 1}`);
  const undone = say(s, 'Go back').session;
  assert.equal(undone.revisions.length, committed - 1);
});
