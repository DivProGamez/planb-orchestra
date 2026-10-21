import { clone } from '../src/engine/model.js';
import { getScenario } from '../src/data/scenarios.js';
import { createSession, currentRevision } from '../src/engine/session.js';
import { parseCommand } from '../src/engine/parser.js';
import { runAgentTurn } from '../src/engine/agent.js';

export function stateOf(scenario, extra = {}) {
  return { scenario: clone(scenario), committed: {}, nowMin: scenario.startMin, ...extra };
}

/** A small hand-built scenario for focused tests. */
export function miniScenario(overrides = {}) {
  const base = {
    id: 'mini', name: 'Mini', clockStartMin: 9 * 60, startMin: 0, deadlineMin: 120, budgetCap: 50,
    people: [
      { id: 'ann', name: 'Ann', availableFrom: 0, availableTo: 200 },
      { id: 'bob', name: 'Bob', availableFrom: 0, availableTo: 200 },
    ],
    resources: [{ id: 'oven', name: 'Oven', capacity: 1, available: true }],
    alternatives: [],
    tasks: [
      { id: 'a', title: 'A', durationMin: 20, minDurationMin: 15, cost: 5, status: 'todo', priority: 'must', dependsOn: [], eligiblePeople: ['ann', 'bob'], resources: [], earliestStartMin: 0, latestEndMin: null, alternatives: [], compressible: true },
      { id: 'b', title: 'B', durationMin: 30, minDurationMin: 20, cost: 5, status: 'todo', priority: 'must', dependsOn: ['a'], eligiblePeople: ['ann', 'bob'], resources: ['oven'], earliestStartMin: 0, latestEndMin: null, alternatives: [], compressible: true },
      { id: 'c', title: 'C', durationMin: 30, minDurationMin: 30, cost: 5, status: 'todo', priority: 'must', dependsOn: ['b'], eligiblePeople: ['ann', 'bob'], resources: ['oven'], earliestStartMin: 0, latestEndMin: null, alternatives: [], compressible: false },
    ],
  };
  return { ...base, ...overrides };
}

export function newSession(id) {
  const res = createSession(getScenario(id), { now: 1 });
  if (!res.ok) throw new Error(`baseline infeasible: ${JSON.stringify(res.errors)}`);
  return res.session;
}

/** Runs a typed command through the local parser and agent, like the UI does. */
export function say(session, text, source = 'typed') {
  const head = currentRevision(session);
  const parsed = { ...parseCommand(text, { ...head.state, nowMin: session.nowMin }), source };
  return runAgentTurn(session, text, parsed, { now: 2 });
}
