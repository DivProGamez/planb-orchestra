// "Create your own plan": draft → scenario conversion, storage, import/export, and a 20-task /
// 6-person custom plan driven through the unchanged engine (shocks, validation, undo, persistence).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, emptyDraft, exampleDraft, exportDraft, importDraft, draftFromScenario, createCustomStore, parseClock, CUSTOM_KEY } from '../src/data/custom.js';
import { createSession, proposeShocks, commitProposal, undoLast, currentRevision } from '../src/engine/session.js';
import { validatePlan } from '../src/engine/validate.js';
import { parseCommand } from '../src/engine/parser.js';
import { saveState, loadState, memoryStorage } from '../src/persistence.js';

const example = () => buildScenario(exampleDraft());

test('the example has 20 tasks and 6 people and plans to a validated baseline', () => {
  const { ok, scenario, errors } = example();
  assert.ok(ok, JSON.stringify(errors));
  assert.equal(scenario.tasks.length, 20);
  assert.equal(scenario.people.length, 6);
  const res = createSession(scenario, { now: 0 });
  assert.ok(res.ok);
  const plan = res.session.revisions[0].plan;
  assert.equal(plan.scheduled.length, 20);
  assert.equal(validatePlan(res.session.revisions[0].state, plan).valid, true, 'independent validator agrees');
  assert.ok(plan.endMin <= scenario.deadlineMin && plan.totalCost <= scenario.budgetCap);
});

test('custom plan: generated quick commands parse into real changes', () => {
  const { scenario } = example();
  const state = currentRevision(createSession(scenario, { now: 0 }).session).state;
  const types = scenario.quickCommands.map((q) => parseCommand(q.text, state)).map((p) => p.shocks?.[0]?.type || p.intent);
  assert.ok(types.includes('person_unavailable'));
  assert.ok(types.includes('resource_unavailable'));
  assert.ok(types.includes('deadline_earlier'));
  assert.ok(types.includes('budget_reduced'));
});

test('custom plan: disruption → validated replan → undo, with nobody invented', () => {
  const { scenario } = example();
  let session = createSession(scenario, { now: 0 }).session;
  const parsed = parseCommand('Maya cannot help anymore.', currentRevision(session).state);
  const proposal = proposeShocks(session, parsed.shocks);
  assert.ok(proposal.ok && proposal.feasible);
  session = commitProposal(session, proposal, { now: 1 });
  const head = currentRevision(session);
  assert.equal(head.id, 'r1');
  assert.ok(head.plan.scheduled.every((st) => st.personId !== 'maya'), 'no task left with Maya');
  assert.ok(validatePlan(head.state, head.plan).valid);
  const undone = undoLast(session);
  session = undone.session || undone;
  assert.equal(currentRevision(session).id, 'r0');
});

test('custom plan: impossible budget is proven, nothing committed, verified option offered', () => {
  const { scenario } = example();
  const session = createSession(scenario, { now: 0 }).session;
  const proposal = proposeShocks(session, [{ type: 'budget_reduced', payload: { newCap: 100 } }]);
  assert.equal(proposal.feasible, false);
  assert.ok(proposal.plan.violations.some((v) => v.code === 'BUDGET_EXCEEDED' && v.proof === 'proven'));
  assert.ok(proposal.options.length > 0);
  assert.equal(session.revisions.length, 1);
});

test('custom plan session survives save/load (persistence)', () => {
  const { scenario } = example();
  const session = createSession(scenario, { now: 0 }).session;
  const storage = memoryStorage();
  saveState(storage, { session, ui: { view: 'workspace' } });
  const back = loadState(storage);
  assert.ok(back.ok);
  assert.equal(back.session.scenarioId, scenario.id);
  assert.equal(back.session.revisions[0].state.scenario.tasks.length, 20);
});

test('form problems are reported in plain words (names, not ids)', () => {
  const d = emptyDraft();
  const r = buildScenario(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /name/.test(e.message)));
  d.name = 'Test'; d.people[0].name = 'Ana'; d.tasks[0].title = 'Cook'; d.tasks[0].people = [d.people[0].key];
  d.deadline = '08:00';
  assert.ok(buildScenario(d).errors.some((e) => /later than the start/.test(e.message)));
  d.deadline = '12:00';
  d.tasks.push({ key: 'tX', title: 'Shop', duration: 20, minDuration: 20, cost: 0, priority: 'optional', people: [d.people[0].key], resources: [], dependsOn: [] });
  d.tasks[0].dependsOn = ['tX'];
  const r2 = buildScenario(d);
  assert.ok(r2.errors.some((e) => e.message.includes('"Cook"') && e.message.includes('"Shop"')), JSON.stringify(r2.errors));
});

test('task needing nobody and no equipment is rejected; hands-free with equipment is allowed', () => {
  const d = emptyDraft();
  d.name = 'X'; d.people[0].name = 'Ana'; d.tasks[0].title = 'Rise dough';
  assert.ok(buildScenario(d).errors.some((e) => /pick who can do it/.test(e.message)));
  d.resources.push({ key: 'r1', name: 'Oven', capacity: 1 });
  d.tasks[0].resources = ['r1'];
  assert.ok(buildScenario(d).ok);
});

test('export → import round-trip keeps people, tasks and dependencies', () => {
  const d = exampleDraft();
  const back = importDraft(exportDraft(d));
  assert.ok(back.ok);
  const a = buildScenario(d).scenario;
  const b = buildScenario(back.draft).scenario;
  assert.deepEqual(b.tasks.map((t) => [t.title, t.dependsOn, t.eligiblePeople]), a.tasks.map((t) => [t.title, t.dependsOn, t.eligiblePeople]));
  assert.equal(importDraft('nope').ok, false);
  assert.equal(importDraft('{"format":"other"}').ok, false);
});

test('scenario → draft → scenario is stable (editing a saved plan)', () => {
  const a = example().scenario;
  const b = buildScenario(draftFromScenario(a)).scenario;
  assert.equal(b.id, a.id);
  assert.deepEqual(b.tasks.map((t) => [t.id, t.durationMin, t.dependsOn]), a.tasks.map((t) => [t.id, t.durationMin, t.dependsOn]));
});

test('store keeps only valid custom scenarios and survives corrupt data', () => {
  const storage = memoryStorage();
  const store = createCustomStore(storage);
  const s = example().scenario;
  assert.ok(store.save(s));
  assert.equal(store.list().length, 1);
  assert.equal(store.get(s.id).name, s.name);
  storage.setItem(CUSTOM_KEY, JSON.stringify({ version: 1, scenarios: [s, { ...s, id: 'custom-bad', tasks: [] }, { id: 'dinner-for-six' }] }));
  assert.deepEqual(store.list().map((x) => x.id), [s.id]);
  storage.setItem(CUSTOM_KEY, '{broken');
  assert.deepEqual(store.list(), []);
  store.save(s);
  store.remove(s.id);
  assert.equal(store.list().length, 0);
});

test('parseClock accepts HH:MM only', () => {
  assert.equal(parseClock('09:30'), 570);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('9.30'), null);
});

test('a plan with no equipment at all is valid and plans normally', () => {
  const d = emptyDraft();
  d.name = 'Study day'; d.people[0].name = 'Ana';
  d.tasks[0].title = 'Read chapter 1'; d.tasks[0].people = [d.people[0].key];
  const r = buildScenario(d);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.scenario.resources, []);
  const res = createSession(r.scenario, { now: 0 });
  assert.ok(res.ok);
  assert.ok(validatePlan(res.session.revisions[0].state, res.session.revisions[0].plan).valid);
});
