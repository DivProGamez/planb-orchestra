// Phrasing corpus: genuinely different ways people describe the same changes, across all
// three scenarios. Every parse must also pass the shock schema for the state it targets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../src/data/scenarios.js';
import { parseCommand } from '../src/engine/parser.js';
import { validateShocks, applyShockToState } from '../src/engine/shocks.js';
import { stateOf } from './helpers.js';

const sortShocks = (list) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

function stateFor(id, pre = []) {
  let state = stateOf(getScenario(id));
  for (const shock of pre) state = applyShockToState(state, shock, state.nowMin);
  return state;
}

const CASES = [
  // Dinner for Six — start 4:00 PM, guests 7:00 PM, $100
  ['dinner-for-six', 'The guests will be here 45 minutes early', [{ type: 'deadline_earlier', payload: { minutes: 45 } }]],
  ['dinner-for-six', 'Dinner is now at 6:15', [{ type: 'deadline_earlier', payload: { minutes: 45 } }]],
  ['dinner-for-six', 'Our guests are coming at 6:30 pm instead', [{ type: 'deadline_earlier', payload: { minutes: 30 } }]],
  ['dinner-for-six', 'Push dinner back 30 minutes', [{ type: 'deadline_extended', payload: { minutes: 30 } }]],
  ['dinner-for-six', 'The stove is not working', [{ type: 'resource_unavailable', payload: { resourceId: 'stovetop' } }]],
  ['dinner-for-six', 'The car is in the shop', [{ type: 'resource_unavailable', payload: { resourceId: 'car' } }]],
  ['dinner-for-six', 'We lost the car for the afternoon', [{ type: 'resource_unavailable', payload: { resourceId: 'car' } }]],
  ['dinner-for-six', 'Alex has to leave at 5 PM', [{ type: 'person_unavailable', payload: { personId: 'alex', fromMin: 60 } }]],
  ['dinner-for-six', 'Leila can only stay until 5:30', [{ type: 'person_unavailable', payload: { personId: 'leila', fromMin: 90 } }]],
  ['dinner-for-six', 'Sam is sick', [{ type: 'person_unavailable', payload: { personId: 'sam' } }]],
  ['dinner-for-six', "Sam's out today", [{ type: 'person_unavailable', payload: { personId: 'sam' } }]],
  ['dinner-for-six', 'Leila is running 20 minutes late', [{ type: 'person_delayed', payload: { personId: 'leila', minutes: 20 } }]],
  ['dinner-for-six', 'We only have $60 left', [{ type: 'budget_reduced', payload: { newCap: 60 } }]],
  ['dinner-for-six', 'Spend no more than 90 dollars', [{ type: 'budget_reduced', payload: { newCap: 90 } }]],
  ['dinner-for-six', 'Budget dropped by $15', [{ type: 'budget_reduced', payload: { newCap: 85 } }]],
  ['dinner-for-six', 'Cooking the rice will take 10 more minutes', [{ type: 'duration_increase', payload: { taskId: 'sides', extraMin: 10 } }]],
  ['dinner-for-six', 'Shopping is taking 15 minutes longer', [{ type: 'duration_increase', payload: { taskId: 'shop', extraMin: 15 } }]],
  ['dinner-for-six', 'Forget the candles', [{ type: 'task_skipped', payload: { taskId: 'candles' } }]],
  ['dinner-for-six', 'The oven broke and Sam has to go home', [
    { type: 'resource_unavailable', payload: { resourceId: 'oven' } },
    { type: 'person_unavailable', payload: { personId: 'sam' } },
  ]],
  ['dinner-for-six', 'The oven works again', [{ type: 'resource_restored', payload: { resourceId: 'oven' } }], [{ type: 'resource_unavailable', payload: { resourceId: 'oven' } }]],
  ['dinner-for-six', 'Good news, the oven is fixed', [{ type: 'resource_restored', payload: { resourceId: 'oven' } }], [{ type: 'resource_unavailable', payload: { resourceId: 'oven' } }]],
  ['dinner-for-six', 'Sam is back and can help again', [{ type: 'person_available', payload: { personId: 'sam' } }], [{ type: 'person_unavailable', payload: { personId: 'sam' } }]],
  // Children's Birthday — start 1:00 PM, party 5:00 PM, $150
  ['childrens-birthday', 'The aunt is running 30 minutes late', [{ type: 'person_delayed', payload: { personId: 'aunt', minutes: 30 } }]],
  ['childrens-birthday', 'Party moved up by half an hour', [{ type: 'deadline_earlier', payload: { minutes: 30 } }]],
  ['childrens-birthday', 'The babysitter cancelled', [{ type: 'person_unavailable', payload: { personId: 'helper' } }]],
  ['childrens-birthday', 'We can only spend $100', [{ type: 'budget_reduced', payload: { newCap: 100 } }]],
  ['childrens-birthday', 'Skip the goody bags', [{ type: 'task_skipped', payload: { taskId: 'bags' } }]],
  ['childrens-birthday', 'The oven died, and the pizzas will take 10 minutes longer', [
    { type: 'resource_unavailable', payload: { resourceId: 'oven' } },
    { type: 'duration_increase', payload: { taskId: 'pizza', extraMin: 10 } },
  ]],
  // Weekend Outing — start 8:00 AM, arrive 1:00 PM, $120
  ['weekend-outing', 'We need to be at the lake by 11', [{ type: 'deadline_earlier', payload: { minutes: 120 } }]],
  ['weekend-outing', 'Parent A has to leave at 10', [{ type: 'person_unavailable', payload: { personId: 'parent-a', fromMin: 120 } }]],
  ['weekend-outing', 'My partner got called into work', [{ type: 'person_unavailable', payload: { personId: 'parent-b' } }]],
  ['weekend-outing', 'No kitchen today', [{ type: 'resource_unavailable', payload: { resourceId: 'kitchen' } }]],
  ['weekend-outing', 'Packing will take an extra 15 minutes', [{ type: 'duration_increase', payload: { taskId: 'pack', extraMin: 15 } }]],
  ['weekend-outing', 'Budget is $100 now', [{ type: 'budget_reduced', payload: { newCap: 100 } }]],
];

for (const [id, text, expected, pre = []] of CASES) {
  test(`parses "${text}" (${id})`, () => {
    const state = stateFor(id, pre);
    const parsed = parseCommand(text, state);
    assert.equal(parsed.intent, 'shocks', `intent for "${text}": ${parsed.intent} ${parsed.notes.join(' ')}`);
    assert.deepEqual(sortShocks(parsed.shocks), sortShocks(expected));
    const checked = validateShocks(parsed.shocks, state);
    assert.equal(checked.ok, true, `schema rejected: ${checked.errors?.join('; ')}`);
  });
}

test('non-change intents and non-matches', () => {
  const s = stateFor('dinner-for-six');
  assert.equal(parseCommand('Can we still make it?', s).intent, 'status');
  assert.equal(parseCommand("What's left to do?", s).intent, 'status');
  assert.equal(parseCommand('Go back', s).intent, 'undo');
  assert.equal(parseCommand('Start over', s).intent, 'restore');
  assert.equal(parseCommand('hello there', s).intent, 'unknown');
  assert.equal(parseCommand('Sam is happy to help', s).intent, 'unknown');
  assert.equal(parseCommand('The oven is great', s).intent, 'unknown');
});
