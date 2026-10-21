// Offline tests of the optional LLM path with a stub client: no network, no API key.
// They prove the request shape, the strict re-validation of model output and the fallbacks.
// They do NOT prove anything about a real model's accuracy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWithLlm, llmStatus } from '../server/llm-adapter.js';
import { createApp } from '../server/app.js';
import { getScenario } from '../src/data/scenarios.js';
import { runAgentTurn } from '../src/engine/agent.js';
import { currentRevision } from '../src/engine/session.js';
import { stateOf, newSession } from './helpers.js';

const nulls = { minutes: null, personId: null, fromMin: null, resourceId: null, newCap: null, taskId: null, extraMin: null };

function stubClient(responder) {
  const calls = [];
  return {
    calls,
    messages: {
      async parse(params, options) {
        calls.push({ params, options });
        return responder(params);
      },
    },
  };
}

test('adapter is disabled without LLM_API_KEY and never calls a provider', async () => {
  assert.deepEqual(await llmStatus({}), { enabled: false, reason: 'LLM_API_KEY is not set' });
  const res = await parseWithLlm('Sam is sick', stateOf(getScenario('dinner-for-six')), { env: {} });
  assert.equal(res.ok, false);
});

test('request carries the scenario ids and times; valid structured output is accepted', async () => {
  const state = stateOf(getScenario('dinner-for-six'));
  const client = stubClient(() => ({
    stop_reason: 'end_turn',
    parsed_output: {
      intent: 'shocks',
      advanceMinutes: null,
      shocks: [
        { ...nulls, type: 'person_unavailable', personId: 'alex', fromMin: 75 },
        { ...nulls, type: 'resource_unavailable', resourceId: 'oven' },
      ],
    },
  }));
  const res = await parseWithLlm('Alex needs to head out at quarter past five, and the oven is dead', state, { env: {}, client });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.parsed.shocks, [
    { type: 'person_unavailable', payload: { personId: 'alex', fromMin: 75 } },
    { type: 'resource_unavailable', payload: { resourceId: 'oven' } },
  ]);
  assert.equal(res.parsed.parser, 'llm');
  const { params, options } = client.calls[0];
  assert.equal(params.model, 'claude-opus-5-5');
  assert.match(params.system, /"id":"alex"/);
  assert.match(params.system, /Minute 0 is 4:00 PM/);
  assert.equal(params.messages[0].content, 'Alex needs to head out at quarter past five, and the oven is dead');
  assert.ok(options.timeout > 0);
  assert.ok(!JSON.stringify(params).includes('LLM_API_KEY'));
});

test('hallucinated ids, wrong types, refusals, empty output and provider errors all fail closed', async () => {
  const state = stateOf(getScenario('dinner-for-six'));
  const cases = [
    () => ({ stop_reason: 'end_turn', parsed_output: { intent: 'shocks', advanceMinutes: null, shocks: [{ ...nulls, type: 'person_unavailable', personId: 'grandma' }] } }),
    () => ({ stop_reason: 'end_turn', parsed_output: { intent: 'shocks', advanceMinutes: null, shocks: [{ ...nulls, type: 'order_pizza' }] } }),
    () => ({ stop_reason: 'end_turn', parsed_output: { intent: 'shocks', advanceMinutes: null, shocks: [{ ...nulls, type: 'budget_reduced', newCap: 250 }] } }),
    () => ({ stop_reason: 'refusal', parsed_output: null }),
    () => ({ stop_reason: 'end_turn', parsed_output: null }),
    () => { throw new Error('network down'); },
  ];
  for (const responder of cases) {
    const res = await parseWithLlm('anything', state, { env: {}, client: stubClient(responder) });
    assert.equal(res.ok, false);
    assert.equal(typeof res.error, 'string');
  }
});

test('validated LLM output drives the same agent pipeline as the local parser', async () => {
  const session = newSession('childrens-birthday');
  const state = currentRevision(session).state;
  const client = stubClient(() => ({
    stop_reason: 'end_turn',
    parsed_output: { intent: 'shocks', advanceMinutes: null, shocks: [{ ...nulls, type: 'person_delayed', personId: 'aunt', minutes: 45 }] },
  }));
  const res = await parseWithLlm('Auntie texted, traffic is awful, she will be ~45 late', state, { env: {}, client });
  assert.equal(res.ok, true, res.error);
  const turn = runAgentTurn(session, 'Auntie texted, traffic is awful, she will be ~45 late', { ...res.parsed, source: 'llm' }, { now: 1 });
  assert.equal(turn.reply.tone, 'done', turn.reply.text);
  assert.match(turn.trace[0].detail, /LLM adapter, schema-validated/);
  assert.equal(currentRevision(turn.session).state.scenario.people.find((p) => p.id === 'aunt').availableFrom, 105);
});

test('server /api/intent returns validated LLM output when an adapter is enabled', async () => {
  const adapter = {
    llmStatus: async () => ({ enabled: true, provider: 'stub', model: 'stub' }),
    parseWithLlm: (text, state) => parseWithLlm(text, state, {
      env: {},
      client: stubClient(() => ({ stop_reason: 'end_turn', parsed_output: { intent: 'advance', advanceMinutes: 25, shocks: [] } })),
    }),
  };
  const server = createApp({ env: {}, adapter }).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const context = { scenario: stateOf(getScenario('weekend-outing')).scenario, nowMin: 0 };
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/intent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'skip ahead a bit, like 25 min', context }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).parsed, { intent: 'advance', minutes: 25, shocks: [], parser: 'llm' });
  } finally {
    await new Promise((r) => server.close(r));
  }
});
