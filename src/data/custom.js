// User-defined plans ("Create your own plan"). A draft uses wall-clock times and stable row keys so it
// is easy to edit; buildScenario() turns it into a regular scenario object that the existing engine,
// validator, parser and persistence use unchanged. Nothing here plans or validates schedules itself.

import { validateScenario } from '../engine/validate.js';

export const CUSTOM_KEY = 'planb-orchestra.custom';
export const CUSTOM_VERSION = 1;
export const CUSTOM_PREFIX = 'custom-';
export const PRIORITY_OPTIONS = ['must', 'should', 'optional'];
export const LIMITS = { people: 12, resources: 12, tasks: 40, title: 60, name: 40, budget: 100000 };

/* ---------- time helpers ---------- */

/** "16:30" → 990; returns null when malformed. */
export function parseClock(text) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function clockText(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/* ---------- drafts ---------- */

let seq = 0;
export const newKey = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyDraft() {
  return {
    id: null,
    name: '',
    tagline: '',
    start: '09:00',
    deadline: '12:00',
    deadlineLabel: 'deadline',
    budget: 100,
    people: [{ key: newKey('p'), name: '', from: '09:00', to: '12:00' }],
    resources: [],
    tasks: [{ key: newKey('t'), title: '', duration: 30, minDuration: 30, cost: 0, priority: 'must', people: [], resources: [], dependsOn: [] }],
  };
}

const slug = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 32) || 'item';

function uniqueIds(rows, label) {
  const used = new Set();
  return new Map(rows.map((r) => {
    let base = slug(label(r));
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return [r.key, id];
  }));
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'set', 'get', 'make', 'a', 'an', 'of', 'to', 'up', 'on', 'in', 'at', 'by', 'or']);
function keywordsFor(title) {
  return [...new Set(String(title).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 6);
}

const intOr = (v, fallback) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.round(Number(v)) : fallback);

/**
 * Draft → scenario. Returns { ok, scenario, errors } where errors combine form problems (times, names)
 * with the engine's own validateScenario() results. The scenario is only usable when ok is true.
 */
export function buildScenario(draft) {
  const errors = [];
  const add = (message) => errors.push({ code: 'FORM', message });
  const start = parseClock(draft.start);
  const end = parseClock(draft.deadline);
  if (start === null) add('Start time must look like 09:00.');
  if (end === null) add('Deadline must look like 12:00.');
  if (start !== null && end !== null && end <= start) add('The deadline must be later than the start time (same day).');
  if (!String(draft.name || '').trim()) add('Give the plan a name.');
  const budget = intOr(draft.budget, NaN);
  if (!Number.isInteger(budget) || budget < 0 || budget > LIMITS.budget) add(`Budget must be a whole number from 0 to ${LIMITS.budget}.`);
  if (draft.people.length > LIMITS.people) add(`At most ${LIMITS.people} people.`);
  if (draft.resources.length > LIMITS.resources) add(`At most ${LIMITS.resources} equipment items.`);
  if (draft.tasks.length > LIMITS.tasks) add(`At most ${LIMITS.tasks} tasks.`);
  if (!draft.people.length) add('Add at least one person.');
  if (!draft.tasks.length) add('Add at least one task.');

  const pIds = uniqueIds(draft.people, (p) => p.name);
  const rIds = uniqueIds(draft.resources, (r) => r.name);
  const tIds = uniqueIds(draft.tasks, (t) => t.title);
  const s0 = start ?? 0;
  const span = end !== null && start !== null ? end - start : 0;

  draft.people.forEach((p, i) => {
    if (!String(p.name || '').trim()) add(`Person ${i + 1} needs a name.`);
    const f = parseClock(p.from);
    const t = parseClock(p.to);
    if (f === null || t === null) add(`${p.name || `Person ${i + 1}`}: availability times must look like 09:00.`);
    else if (t < f) add(`${p.name || `Person ${i + 1}`}: available "until" is before "from".`);
  });
  draft.resources.forEach((r, i) => {
    if (!String(r.name || '').trim()) add(`Equipment ${i + 1} needs a name.`);
    const c = intOr(r.capacity, NaN);
    if (!Number.isInteger(c) || c < 1 || c > 20) add(`${r.name || `Equipment ${i + 1}`}: capacity must be 1–20.`);
  });
  draft.tasks.forEach((t, i) => {
    const label = t.title || `Task ${i + 1}`;
    if (!String(t.title || '').trim()) add(`Task ${i + 1} needs a title.`);
    if (!t.people.length && !t.resources.length) add(`${label}: pick who can do it, or the equipment that runs it on its own.`);
  });

  const scenario = {
    id: draft.id || `${CUSTOM_PREFIX}${slug(draft.name)}-${Date.now().toString(36)}`,
    custom: true,
    name: String(draft.name || '').trim().slice(0, LIMITS.name),
    tagline: String(draft.tagline || '').trim() || `Your plan — due ${draft.deadline}.`,
    emoji: '★',
    clockStartMin: s0,
    startMin: 0,
    deadlineMin: span,
    deadlineLabel: String(draft.deadlineLabel || '').trim() || 'deadline',
    budgetCap: Number.isInteger(budget) ? budget : 0,
    people: draft.people.map((p) => {
      const f = parseClock(p.from) ?? s0;
      const t = parseClock(p.to) ?? s0 + span;
      const name = String(p.name || '').trim();
      return { id: pIds.get(p.key), name, availableFrom: Math.max(0, f - s0), availableTo: Math.max(0, t - s0), aliases: name.includes(' ') ? [name.split(' ')[0]] : [] };
    }),
    resources: draft.resources.map((r) => {
      const name = String(r.name || '').trim();
      return { id: rIds.get(r.key), name, capacity: intOr(r.capacity, 1), available: true, aliases: [name.toLowerCase()] };
    }),
    tasks: draft.tasks.map((t) => {
      const duration = intOr(t.duration, 0);
      const minDuration = Math.min(duration, intOr(t.minDuration, duration));
      return {
        id: tIds.get(t.key),
        title: String(t.title || '').trim().slice(0, LIMITS.title),
        durationMin: duration,
        minDurationMin: minDuration,
        compressible: minDuration < duration,
        cost: intOr(t.cost, 0),
        priority: PRIORITY_OPTIONS.includes(t.priority) ? t.priority : 'must',
        ...(t.priority === 'optional' ? { value: 2 } : {}),
        status: 'todo',
        eligiblePeople: t.people.map((k) => pIds.get(k)).filter(Boolean),
        resources: t.resources.map((k) => rIds.get(k)).filter(Boolean),
        dependsOn: t.dependsOn.map((k) => tIds.get(k)).filter(Boolean),
        earliestStartMin: 0,
        latestEndMin: null,
        alternatives: [],
        keywords: keywordsFor(t.title),
      };
    }),
    alternatives: [],
  };
  scenario.quickCommands = quickCommandsFor(scenario);
  if (!errors.length) errors.push(...validateScenario(scenario).errors.map((e) => ({ ...e, message: humanize(e, scenario) })));
  return { ok: errors.length === 0, scenario, errors };
}

/** Engine messages use ids; show the names people typed instead. */
function humanize(e, s) {
  const names = new Map([...s.tasks.map((t) => [t.id, t.title]), ...s.people.map((p) => [p.id, p.name]), ...s.resources.map((r) => [r.id, r.name])]);
  return e.message.replace(/"([^"]+)"/g, (m, id) => (names.has(id) ? `"${names.get(id)}"` : m));
}

/** Quick commands built from this plan's own people, equipment and budget (all supported by the parser). */
export function quickCommandsFor(s) {
  const out = [];
  if (s.people.length > 1) out.push({ label: `${s.people[0].name} can’t help`, text: `${s.people[0].name} cannot help anymore.` });
  if (s.resources.length) out.push({ label: `${s.resources[0].name} broke`, text: `The ${s.resources[0].name.toLowerCase()} broke.` });
  out.push({ label: 'Deadline 30 min earlier', text: 'The deadline is 30 minutes earlier.' });
  if (s.budgetCap > 0) {
    const cut = Math.max(0, Math.round((s.budgetCap * 0.8) / 5) * 5);
    out.push({ label: `Budget is now $${cut}`, text: `Our budget is now $${cut}.` });
  }
  out.push({ label: 'Advance clock 30 min', text: 'Advance the clock 30 minutes.' });
  out.push({ label: 'On time?', text: 'Can we still make it?' });
  out.push({ label: 'Undo', text: 'Undo the last change.' });
  return out;
}

/** Scenario → editable draft (to edit a saved custom plan). */
export function draftFromScenario(s) {
  const s0 = s.clockStartMin || 0;
  const pKey = new Map(s.people.map((p) => [p.id, newKey('p')]));
  const rKey = new Map(s.resources.map((r) => [r.id, newKey('r')]));
  const tKey = new Map(s.tasks.map((t) => [t.id, newKey('t')]));
  return {
    id: s.custom ? s.id : null,
    name: s.name,
    tagline: s.tagline || '',
    start: clockText(s0 + s.startMin),
    deadline: clockText(s0 + s.deadlineMin),
    deadlineLabel: s.deadlineLabel || 'deadline',
    budget: s.budgetCap,
    people: s.people.map((p) => ({ key: pKey.get(p.id), name: p.name, from: clockText(s0 + p.availableFrom), to: clockText(s0 + p.availableTo) })),
    resources: s.resources.map((r) => ({ key: rKey.get(r.id), name: r.name, capacity: r.capacity })),
    tasks: s.tasks.map((t) => ({
      key: tKey.get(t.id), title: t.title, duration: t.durationMin, minDuration: t.minDurationMin, cost: t.cost, priority: t.priority,
      people: t.eligiblePeople.map((id) => pKey.get(id)).filter(Boolean),
      resources: t.resources.map((id) => rKey.get(id)).filter(Boolean),
      dependsOn: t.dependsOn.map((id) => tKey.get(id)).filter(Boolean),
    })),
  };
}

/* ---------- JSON import / export ---------- */

export function exportDraft(draft) {
  const strip = ({ key, ...rest }) => rest;
  const idx = (list) => new Map(list.map((x, i) => [x.key, i]));
  const pI = idx(draft.people);
  const rI = idx(draft.resources);
  const tI = idx(draft.tasks);
  return JSON.stringify({
    format: 'planb-orchestra.plan', version: CUSTOM_VERSION,
    name: draft.name, tagline: draft.tagline, start: draft.start, deadline: draft.deadline, deadlineLabel: draft.deadlineLabel, budget: draft.budget,
    people: draft.people.map(strip),
    resources: draft.resources.map(strip),
    tasks: draft.tasks.map((t) => ({ ...strip(t), people: t.people.map((k) => pI.get(k)), resources: t.resources.map((k) => rI.get(k)), dependsOn: t.dependsOn.map((k) => tI.get(k)) })),
  }, null, 2);
}

/** Parses an exported plan; references are list positions. Returns { ok, draft, error }. */
export function importDraft(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'That is not valid JSON.' }; }
  if (!data || data.format !== 'planb-orchestra.plan' || !Array.isArray(data.people) || !Array.isArray(data.tasks)) {
    return { ok: false, error: 'Not a PlanB Orchestra plan file (expected format "planb-orchestra.plan").' };
  }
  const people = data.people.map((p) => ({ key: newKey('p'), name: String(p.name ?? ''), from: String(p.from ?? ''), to: String(p.to ?? '') }));
  const resources = (data.resources || []).map((r) => ({ key: newKey('r'), name: String(r.name ?? ''), capacity: intOr(r.capacity, 1) }));
  const tasks = data.tasks.map((t) => ({ key: newKey('t'), title: String(t.title ?? ''), duration: intOr(t.duration, 30), minDuration: intOr(t.minDuration, intOr(t.duration, 30)), cost: intOr(t.cost, 0), priority: PRIORITY_OPTIONS.includes(t.priority) ? t.priority : 'must', _p: t.people, _r: t.resources, _d: t.dependsOn }));
  const pick = (list, refs) => (Array.isArray(refs) ? refs.map((i) => list[i]?.key).filter(Boolean) : []);
  for (const t of tasks) {
    t.people = pick(people, t._p); t.resources = pick(resources, t._r); t.dependsOn = pick(tasks, t._d);
    delete t._p; delete t._r; delete t._d;
  }
  return { ok: true, draft: { id: null, name: String(data.name ?? ''), tagline: String(data.tagline ?? ''), start: String(data.start ?? ''), deadline: String(data.deadline ?? ''), deadlineLabel: String(data.deadlineLabel ?? 'deadline'), budget: data.budget, people, resources, tasks } };
}

/* ---------- storage (scenarios the user saved) ---------- */

export function createCustomStore(storage) {
  const read = () => {
    try {
      const env = JSON.parse(storage.getItem(CUSTOM_KEY) || 'null');
      if (!env || env.version !== CUSTOM_VERSION || !Array.isArray(env.scenarios)) return [];
      // only scenarios that still pass the engine's validator are offered
      return env.scenarios.filter((s) => s && s.custom && typeof s.id === 'string' && s.id.startsWith(CUSTOM_PREFIX) && validateScenario(s).ok);
    } catch { return []; }
  };
  const write = (list) => { try { storage.setItem(CUSTOM_KEY, JSON.stringify({ version: CUSTOM_VERSION, scenarios: list })); return true; } catch { return false; } };
  return {
    list: read,
    get: (id) => read().find((s) => s.id === id) || null,
    save(scenario) {
      const list = read().filter((s) => s.id !== scenario.id);
      list.push(scenario);
      return write(list);
    },
    remove(id) { return write(read().filter((s) => s.id !== id)); },
  };
}

/* ---------- example: a 20-task, 6-person community event (a template the user can edit) ---------- */

export function exampleDraft() {
  const P = ['Maya', 'Omar', 'Lina', 'Youssef', 'Sara', 'Karim'].map((name) => ({ key: newKey('p'), name, from: '08:00', to: '14:00' }));
  P[3].from = '09:00';
  P[5].to = '12:30';
  const R = [['Van', 1], ['Kitchen', 2], ['Sound system', 1]].map(([name, capacity]) => ({ key: newKey('r'), name, capacity }));
  const [maya, omar, lina, youssef, sara, karim] = P.map((p) => p.key);
  const [van, kitchen, sound] = R.map((r) => r.key);
  const rows = [
    ['Pick up rented tables', 40, 35, 30, 'must', [omar, karim], [van], []],
    ['Buy food supplies', 50, 40, 120, 'must', [maya, sara], [van], []],
    ['Print signs and flyers', 25, 20, 15, 'should', [lina, youssef], [], []],
    ['Set up tables', 30, 20, 0, 'must', [omar, karim, youssef], [], [0]],
    ['Decorate the hall', 45, 30, 25, 'should', [lina, sara], [], [3]],
    ['Bake bread', 60, 60, 10, 'must', [], [kitchen], [1]],
    ['Prepare salads', 35, 25, 0, 'must', [maya, sara, lina], [kitchen], [1]],
    ['Cook the main course', 70, 60, 0, 'must', [maya, karim], [kitchen], [1]],
    ['Make lemonade', 20, 15, 5, 'should', [youssef, sara], [], [1]],
    ['Set up sound system', 30, 25, 0, 'must', [omar, youssef], [sound], [3]],
    ['Sound check', 15, 10, 0, 'should', [omar, youssef], [sound], [9]],
    ['Arrange donation table', 20, 15, 0, 'must', [lina, karim], [], [3]],
    ['Prepare volunteer badges', 20, 15, 8, 'optional', [sara, youssef], [], [2]],
    ['Set up kids corner', 30, 25, 20, 'optional', [lina, maya], [], [3]],
    ['Brief the volunteers', 15, 10, 0, 'must', [maya, lina], [], [3]],
    ['Plate the starters', 25, 20, 0, 'must', [sara, lina], [], [6, 5]],
    ['Final hall check', 15, 10, 0, 'must', [karim, omar], [], [4, 9, 11]],
    ['Welcome desk setup', 15, 10, 0, 'should', [youssef, sara], [], [2, 11]],
    ['Photo corner', 20, 15, 12, 'optional', [lina, sara], [], [4]],
    ['Load leftovers plan', 10, 10, 0, 'should', [maya, omar], [], [7]],
  ];
  const T = rows.map(([title, duration, minDuration, cost, priority, people, resources]) => ({ key: newKey('t'), title, duration, minDuration, cost, priority, people, resources, dependsOn: [] }));
  rows.forEach((row, i) => { T[i].dependsOn = row[7].map((j) => T[j].key); });
  return { id: null, name: 'Community Fundraiser Lunch', tagline: 'A lunch for the neighbourhood association — doors open at 12:00.', start: '08:00', deadline: '12:00', deadlineLabel: 'doors open', budget: 300, people: P, resources: R, tasks: T };
}
