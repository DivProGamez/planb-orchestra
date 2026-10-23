// UI controller: view routing, events, persistence and rendering. All planning happens in the
// engine modules; this file never computes schedules itself.

import { SCENARIOS, getScenario as getBuiltIn } from './data/scenarios.js';
import { createCustomStore, buildScenario, emptyDraft, exampleDraft, draftFromScenario, exportDraft, importDraft, newKey, LIMITS } from './data/custom.js';
import { createSession, currentRevision, proposeShocks } from './engine/session.js';
import { validateScenario } from './engine/validate.js';
import { formatClock, formatDuration } from './engine/model.js';
import { parseCommand } from './engine/parser.js';
import { runAgentTurn, applyOption } from './engine/agent.js';
import { saveState, loadState, clearState, memoryStorage } from './persistence.js';
import { axisFor, fitRowHeight, manualParam, esc } from './components.js';
import {
  VIEWS, renderSidebar, renderTopbar, renderHome, renderHomePreview, renderWorkspace, renderAssistantView,
  renderRepair, renderCompare, renderHistory, renderSettings, renderDisruptionModal, renderNeedsPlan,
} from './views.js';
import { renderCreate, renderBuilderSide } from './views-create.js';
import { createNavigator } from './nav.js';
import { createSoundManager } from './sound.js';

const root = document.getElementById('app');
const PREFS_KEY = 'planb-orchestra.prefs';

function safeStorage() {
  try {
    const probe = '__planb_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}
const storage = safeStorage();
const customStore = createCustomStore(storage);
/** Built-in scenario or one of the user's saved plans. */
function getScenario(id) {
  return getBuiltIn(id) || customStore.get(id);
}
const allScenarios = () => [...SCENARIOS, ...customStore.list()];
const DRAFT_KEY = 'planb-orchestra.builder-draft';
function loadDraft() {
  try { const d = JSON.parse(storage.getItem(DRAFT_KEY) || 'null'); return d && Array.isArray(d.people) && Array.isArray(d.tasks) && Array.isArray(d.resources) ? d : null; } catch { return null; }
}
function saveDraft() {
  try { storage.setItem(DRAFT_KEY, JSON.stringify(ui.builder.draft)); } catch { /* storage unavailable */ }
}

function loadPrefs() {
  const defaults = { confirm: true, ghosts: true, reduceMotion: false, sound: true, volume: 0.4 };
  try { return { ...defaults, ...JSON.parse(storage.getItem(PREFS_KEY) || '{}') }; } catch { return defaults; }
}
function savePrefs() {
  try { storage.setItem(PREFS_KEY, JSON.stringify(ui.prefs)); } catch { /* storage unavailable */ }
}

function defaultForm(id) {
  const s = getScenario(id);
  return { deadlineMin: s.deadlineMin, budgetCap: s.budgetCap, people: {}, resources: {} };
}

const ui = {
  view: 'home',
  session: null,
  status: 'idle',
  proposal: null,
  pending: null,
  modal: { open: false, step: 'describe', draft: '' },
  animateRevisionId: null,
  bannerRevisionId: null,
  selectedTaskId: null,
  home: { scenarioId: SCENARIOS[0].id, form: defaultForm(SCENARIOS[0].id), error: '', tab: 'timeline' },
  preview: null,
  compareA: null,
  compareB: null,
  historyIndex: null,
  rowH: null,
  previewRowH: null,
  compareRowH: null,
  historyRowH: null,
  openTrace: null, // conversation index of the open "Agent steps" panel (null = newest, -1 = none)
  followChat: false, // set when the user sends: the next render scrolls to the newest message
  notice: '',
  draft: '',
  prefs: loadPrefs(),
  boot: { summary: '' },
  builder: { draft: null, result: null, preview: null, io: null, notice: '', confirmDelete: false, openDeps: null },
  parser: { mode: 'local', reason: 'Checking server…' },
};

const reduceMotion = () => ui.prefs.reduceMotion || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/* ---------- Sound and navigation ---------- */

const sound = createSoundManager({
  createContext: () => new (window.AudioContext || window.webkitAudioContext)(),
  enabled: ui.prefs.sound,
  volume: ui.prefs.volume,
});
// Audio may only start after a user gesture; navigation never waits for it.
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, () => sound.unlock(), { capture: true });

const INITIAL_FOCUS = {
  home: ['button[form="setup-form"]', '.tile.is-active'],
  create: ['#b-name'],
  workspace: ['#tl-main .bar.is-selected', '#tl-main .bar.is-changed', '#tl-main .bar', '.btn-primary'],
  assistant: ['.confirm-card [data-action="confirm-change"]', '.as-foot .chip', '#cmd'],
  repair: ['.ledger-row', '.stage', '[data-action="open-disruption"]'],
  compare: ['.map-row.is-selected .map-head', '.map-head', '#tl-after .bar'],
  history: ['.rev-card[aria-pressed="true"]', '.rev-card'],
  settings: ['.switch', '.view button'],
  modal: ['#dis-text', '.modal [data-action="confirm-change"]', '.modal button'],
};
const viewStack = [];

const nav = createNavigator({
  root,
  scope: () => root.querySelector('.modal') || root,
  view: () => ui.view,
  initialFor: (view) => ['[data-action="build-from"]', ...(INITIAL_FOCUS[view] || [])],
  isReduced: reduceMotion,
  hasPending: () => Boolean(ui.pending || ui.modal.open),
  onMove: () => sound.play('focus'),
  onSelect: () => sound.play('select'),
  onBack: goBack,
});

/** Back (Escape, remote Back, gamepad B): innermost first — dialog, pending change, crisis, inspector, screen. */
function goBack() {
  if (ui.modal.open || ui.pending) { cancelPending(); sound.play('back'); return true; }
  if (ui.proposal) { ui.proposal = null; ui.status = 'idle'; render(); sound.play('back'); return true; }
  if (document.activeElement?.closest?.('.conversation')) {
    // leave the chat history: back to the quick actions under it
    nav.focusEl(root.querySelector('.as-foot .chip') || root.querySelector('#cmd'));
    sound.play('back');
    return true;
  }
  if (ui.selectedTaskId && ['workspace', 'compare', 'repair'].includes(ui.view)) {
    const id = ui.selectedTaskId;
    ui.selectedTaskId = null;
    persist();
    render();
    // back to the task the inspector was showing
    const bar = root.querySelector(`#tl-main .bar[data-task="${CSS.escape(id)}"], #tl-after .bar[data-task="${CSS.escape(id)}"], .map-head[data-task="${CSS.escape(id)}"], .ledger-row[data-task="${CSS.escape(id)}"]`);
    nav.focusEl(bar);
    sound.play('back');
    return true;
  }
  const prev = viewStack.pop();
  if (prev || ui.view !== 'home') { navigate(prev || 'home', { fromBack: true }); sound.play('back'); return true; }
  return false;
}

/* ---------- Persistence ---------- */

function persist() {
  if (!ui.session) return;
  saveState(storage, { session: ui.session, ui: { view: ui.view, selectedTaskId: ui.selectedTaskId } });
}

function restore() {
  const res = loadState(storage);
  if (res.ok) {
    ui.session = res.session;
    ui.view = VIEWS.some((v) => v.id === res.ui.view) ? res.ui.view : 'workspace';
    ui.selectedTaskId = res.ui.selectedTaskId || null;
    if (getScenario(res.session.scenarioId)) selectScenario(res.session.scenarioId);
    else if (!getScenario(ui.home.scenarioId)) selectScenario(SCENARIOS[0].id);
    ui.notice = '';
  } else if (res.reason !== 'empty') {
    ui.notice = res.message || 'Saved session could not be restored.';
  }
  return res.ok;
}

/* ---------- Parser selection (LLM only when the server reports it enabled) ---------- */

async function detectParser(timeoutMs = 2000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    const health = await res.json();
    ui.parser = health.llm?.enabled
      ? { mode: 'llm', model: health.llm.model }
      : { mode: 'local', reason: health.llm?.reason || 'LLM not configured' };
  } catch {
    ui.parser = { mode: 'local', reason: 'Server unreachable — running fully offline' };
  }
}

async function parseText(text, source) {
  const head = currentRevision(ui.session);
  const state = { ...head.state, nowMin: ui.session.nowMin };
  let fallback = null;
  if (ui.parser.mode === 'llm') {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch('/api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, context: { scenario: state.scenario, committed: state.committed, nowMin: state.nowMin } }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const body = await res.json();
      if (res.ok && body.ok) return { ...body.parsed, source: 'llm' };
      fallback = body.reason || body.error || `HTTP ${res.status}`;
    } catch (err) {
      fallback = err.name === 'AbortError' ? 'timed out' : 'server unreachable';
    }
  }
  return { ...parseCommand(text, state), source, ...(fallback ? { fallback } : {}) };
}

/* ---------- Home: scenario selection and live preview ---------- */

function overridesFor(scenario, f) {
  return {
    deadlineMin: f.deadlineMin,
    budgetCap: f.budgetCap,
    people: Object.fromEntries(scenario.people.map((p) => [p.id, { participating: f.people[p.id] !== false }])),
    resources: Object.fromEntries(scenario.resources.map((r) => [r.id, { available: f.resources[r.id] !== false }])),
  };
}

/** Plans the baseline for the current form so the preview always shows real engine output. */
function computePreview() {
  const scenario = getScenario(ui.home.scenarioId);
  const res = createSession(scenario, { overrides: overridesFor(scenario, ui.home.form), now: 0 });
  ui.preview = res.ok
    ? { ok: true, plan: res.session.revisions[0].plan, state: res.session.revisions[0].state }
    : { ok: false, errors: res.errors || [] };
  Object.defineProperty(ui.preview, 'rowH', { get: () => ui.previewRowH, enumerable: false });
}

function selectScenario(id) {
  ui.home = { ...ui.home, scenarioId: id, form: defaultForm(id), error: '' };
  computePreview();
}

/* ---------- Change requests: parse → review (dry run) → confirm → replan ---------- */

function setStatus(status) {
  ui.status = status;
  if (ui.session) render();
}

/**
 * origin: 'chat' (assistant conversation) or 'modal' (disruption dialog / top command box).
 * Non-change intents (undo, status, clock, help, not understood) run immediately.
 */
async function requestChange(text, source, origin) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !ui.session || ui.status === 'parsing' || ui.status === 'planning') return;
  ui.followChat = true;
  ui.openTrace = null;
  ui.draft = '';
  setStatus('parsing');
  const parsed = await parseText(trimmed, source);
  if (parsed.intent !== 'shocks') {
    if (origin === 'modal') {
      ui.status = 'idle';
      ui.pending = { origin, input: trimmed, parsed, preview: { ok: false, errors: [`I couldn't map “${trimmed}” to a supported change${parsed.notes?.length ? ` (${parsed.notes.join(' ')})` : ''}. Try one of the examples, or the structured change.`] } };
      ui.modal = { ...ui.modal, open: true, step: 'review', draft: trimmed };
      render();
      sound.play('error');
      return;
    }
    await runTurn(trimmed, parsed);
    return;
  }
  prepareReview(trimmed, parsed, origin);
}

function prepareReview(input, parsed, origin) {
  if (!ui.prefs.confirm) { confirmWith({ input, parsed }); return; }
  const head = currentRevision(ui.session);
  const preview = proposeShocks(ui.session, parsed.shocks, { source: parsed.source || 'typed' });
  ui.pending = { origin, input, parsed, preview, before: head.state.scenario, headPlan: head.plan };
  ui.status = 'idle';
  if (origin === 'modal') ui.modal = { ...ui.modal, open: true, step: 'review' };
  render();
  if (!preview.ok) sound.play('error');
  root.querySelector('[data-action="confirm-change"]')?.focus();
}

function confirmWith(pending) {
  ui.pending = null;
  ui.modal = { open: false, step: 'describe', draft: '' };
  ui.view = 'workspace';
  setStatus('planning');
  setTimeout(() => runTurn(pending.input, pending.parsed), reduceMotion() ? 0 : 60);
}

function cancelPending() {
  const wasModal = ui.pending?.origin === 'modal' || ui.modal.open;
  ui.pending = null;
  if (wasModal) ui.modal = { open: false, step: 'describe', draft: '' };
  ui.status = 'idle';
  render();
}

async function runTurn(input, parsed) {
  const before = ui.session.revisions.length;
  let result;
  try {
    result = runAgentTurn(ui.session, input, parsed, { now: Date.now() });
  } catch (err) {
    console.error(err);
    ui.status = 'failure';
    ui.notice = `Unexpected engine error: ${err.message}. Your plan was not changed.`;
    render();
    return;
  }
  ui.session = result.session;
  ui.proposal = result.proposal && !result.proposal.feasible ? result.proposal : null;
  ui.status = result.reply.tone === 'done' ? 'done' : 'failure';
  if (ui.session.revisions.length > before) {
    ui.animateRevisionId = currentRevision(ui.session).id;
    ui.bannerRevisionId = ui.animateRevisionId;
    ui.compareA = null; ui.compareB = null; ui.historyIndex = null;
  }
  if (ui.session.revisions.length < before) {
    ui.selectedTaskId = null;
    ui.bannerRevisionId = null;
    ui.compareA = null; ui.compareB = null; ui.historyIndex = null;
  }
  if (ui.proposal) ui.view = 'workspace';
  persist();
  render();
  sound.play(ui.session.revisions.length < before ? 'undo' : ui.session.revisions.length > before ? 'success' : result.reply.tone === 'done' ? 'select' : 'error');
  if (ui.proposal) {
    root.querySelector('.canvas')?.classList.add('crisis-pulse');
    root.querySelector('#infeasible')?.focus();
  }
}

function chooseOption(index) {
  const option = ui.proposal?.options[index];
  if (!option) return;
  const result = applyOption(ui.session, ui.proposal, option, { now: Date.now() });
  ui.session = result.session;
  ui.proposal = null;
  ui.status = result.reply.tone === 'done' ? 'done' : 'failure';
  ui.animateRevisionId = currentRevision(ui.session).id;
  ui.bannerRevisionId = ui.animateRevisionId;
  ui.compareA = null; ui.compareB = null; ui.historyIndex = null;
  persist();
  render();
  sound.play('success');
}

/* ---------- Create your own plan ---------- */

function checkBuilder() {
  const b = ui.builder;
  b.result = buildScenario(b.draft);
  if (!b.result.ok) { b.preview = null; return; }
  const res = createSession(b.result.scenario, { now: 0 });
  b.preview = res.ok ? { ok: true, plan: res.session.revisions[0].plan, state: res.session.revisions[0].state } : { ok: false, errors: res.errors || [] };
}
let builderTimer = null;
function refreshBuilderSide() {
  checkBuilder();
  const side = root.querySelector('#builder-side');
  if (!side) return;
  nav.beforeRender();
  side.innerHTML = renderBuilderSide(context());
  nav.afterRender();
}
function builderSet(pathText, el) {
  const path = pathText.split('.');
  let target = ui.builder.draft;
  for (const k of path.slice(0, -1)) target = target[/^\d+$/.test(k) ? Number(k) : k];
  const key = path.at(-1);
  target[key] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
  ui.builder.confirmDelete = false;
  saveDraft();
  // names and titles also label the chips below: refresh those without stealing focus
  if (el.tagName === 'SELECT') { checkBuilder(); render(); return; }
  clearTimeout(builderTimer);
  builderTimer = setTimeout(() => {
    if (/(name|title)$/.test(key) && path[0] !== 'name') {
      for (const node of root.querySelectorAll(`[data-ref="${CSS.escape(target.key)}"] span`)) node.textContent = el.value || '…';
    }
    refreshBuilderSide();
  }, 180);
}
function builderAdd(list) {
  const d = ui.builder.draft;
  if (d[list].length >= LIMITS[list]) return;
  const row = list === 'people' ? { key: newKey('p'), name: '', from: d.start, to: d.deadline }
    : list === 'resources' ? { key: newKey('r'), name: '', capacity: 1 }
      : { key: newKey('t'), title: '', duration: 30, minDuration: 30, cost: 0, priority: 'must', people: [], resources: [], dependsOn: [] };
  d[list].push(row);
  saveDraft();
  checkBuilder();
  render();
  root.querySelector(`[data-row="${CSS.escape(row.key)}"] input`)?.focus();
}
function builderRemove(list, key) {
  const d = ui.builder.draft;
  d[list] = d[list].filter((x) => x.key !== key);
  for (const t of d.tasks) for (const f of ['people', 'resources', 'dependsOn']) t[f] = t[f].filter((k) => k !== key);
  saveDraft();
  checkBuilder();
  render();
}
function builderToggle(taskKey, list, ref) {
  const t = ui.builder.draft.tasks.find((x) => x.key === taskKey);
  if (!t) return;
  t[list] = t[list].includes(ref) ? t[list].filter((k) => k !== ref) : [...t[list], ref];
  if (list === 'dependsOn') ui.builder.openDeps = taskKey;
  saveDraft();
  checkBuilder();
  render();
}
function builderMove(key, dir) {
  const ts = ui.builder.draft.tasks;
  const i = ts.findIndex((t) => t.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ts.length) return;
  [ts[i], ts[j]] = [ts[j], ts[i]];
  // a task may only start after tasks listed above it
  for (const [k, t] of ts.entries()) t.dependsOn = t.dependsOn.filter((dk) => ts.findIndex((x) => x.key === dk) < k);
  saveDraft();
  checkBuilder();
  render();
}
function builderSave(build) {
  checkBuilder();
  const b = ui.builder;
  if (!b.result.ok) { render(); return; }
  if (build && !(b.preview && b.preview.ok)) { render(); return; }
  const scenario = b.result.scenario;
  if (!customStore.save(scenario)) { b.notice = 'Could not save: browser storage is unavailable or full.'; render(); return; }
  b.draft.id = scenario.id;
  saveDraft();
  selectScenario(scenario.id);
  if (build) { buildPlan('workspace'); return; }
  b.notice = `Saved "${scenario.name}". It is now listed on Scenarios & Home.`;
  b.confirmDelete = false;
  render();
}

function buildPlan(targetView = 'workspace') {
  const scenario = getScenario(ui.home.scenarioId);
  const res = createSession(scenario, { overrides: overridesFor(scenario, ui.home.form), now: Date.now() });
  if (!res.ok) {
    ui.home.error = res.errors.map((e) => e.message).join(' · ');
    render();
    return;
  }
  Object.assign(ui, {
    session: res.session, view: targetView, selectedTaskId: null, proposal: null, pending: null, status: 'idle',
    bannerRevisionId: null, notice: '', compareA: null, compareB: null, historyIndex: null,
  });
  ui.home.error = '';
  persist();
  render();
  sound.play('success');
}

function newSession() {
  clearState(storage);
  Object.assign(ui, { view: 'home', session: null, proposal: null, pending: null, selectedTaskId: null, status: 'idle', notice: '', bannerRevisionId: null });
  ui.modal = { open: false, step: 'describe', draft: '' };
  selectScenario(ui.home.scenarioId);
  render();
}

function manualParsed(form) {
  const type = form.querySelector('[data-field="m-type"]').value;
  const num = (f) => parseInt(form.querySelector(`[data-field="${f}"]`)?.value, 10);
  const val = (f) => form.querySelector(`[data-field="${f}"]`)?.value;
  const payload = {
    deadline_earlier: () => ({ minutes: num('m-minutes') }),
    person_unavailable: () => ({ personId: val('m-person') }),
    resource_unavailable: () => ({ resourceId: val('m-resource') }),
    budget_reduced: () => ({ newCap: num('m-cap') }),
    duration_increase: () => ({ taskId: val('m-task'), extraMin: num('m-extra') }),
    person_delayed: () => ({ personId: val('m-person'), minutes: num('m-minutes') }),
    resource_restored: () => ({ resourceId: val('m-resource') }),
  }[type]();
  const label = form.querySelector('[data-field="m-type"]').selectedOptions[0].textContent.replace('…', '');
  return { input: `${label} ${Object.values(payload).join(' ')}`.trim(), parsed: { intent: 'shocks', shocks: [{ type, payload }], parser: 'form', source: 'form' } };
}

/* ---------- Rendering ---------- */

function context() {
  const session = ui.session;
  const head = session ? currentRevision(session) : null;
  const prev = head && head.index > 0 ? session.revisions[head.index - 1] : null;
  const scenario = session ? (getScenario(session.scenarioId) || head.state.scenario) : null;
  const ctx = { ui, session, head, prev, scenario, parser: ui.parser, boot: ui.boot, animate: Boolean(head && ui.animateRevisionId === head.id) };
  if (head) {
    ctx.changed = new Map((head.diff?.entries || []).map((e) => [e.taskId, e]));
    ctx.axis = axisFor([head.state, ...(prev ? [prev.state] : []), session.revisions[0].state], [head.plan, prev?.plan]);
  }
  return ctx;
}

function viewHtml(ctx) {
  if (!ctx.session && VIEWS.find((v) => v.id === ui.view)?.needsSession) return renderNeedsPlan({ view: ui.view, scenario: getScenario(ui.home.scenarioId) });
  switch (ui.view) {
    case 'workspace': return renderWorkspace(ctx);
    case 'assistant': return renderAssistantView(ctx);
    case 'repair': return renderRepair(ctx);
    case 'compare': return renderCompare(ctx);
    case 'history': return renderHistory(ctx);
    case 'settings': return renderSettings(ctx);
    case 'create': if (!ui.builder.draft) { ui.builder.draft = loadDraft() || emptyDraft(); } if (!ui.builder.result) checkBuilder(); return renderCreate(ctx);
    default:
      if (!ui.preview) computePreview();
      return renderHome({ scenarios: allScenarios(), home: ui.home, preview: ui.preview, session: ui.session, notice: ui.notice });
  }
}

function shellHtml() {
  const ctx = context();
  const view = viewHtml(ctx);
  return `<a class="skip" href="#main">Skip to content</a>
    <div class="shell">
      ${renderSidebar({ view: ui.view, session: ctx.session, head: ctx.head })}
      <div class="main">
        ${renderTopbar({ view: ui.view, session: ctx.session, head: ctx.head, parser: ui.parser })}
        <div class="view-host">${view}</div>
      </div>
    </div>
    ${ui.modal.open && ctx.session ? renderDisruptionModal(ctx) : ''}`;
}

function render() {
  nav.beforeRender();
  const oldConv = root.querySelector('.conversation');
  const chat = oldConv ? { top: oldConv.scrollTop, atBottom: oldConv.scrollHeight - oldConv.scrollTop - oldConv.clientHeight < 48, count: oldConv.children.length } : null;
  const head = ui.session ? currentRevision(ui.session) : null;
  document.documentElement.classList.toggle('reduce-motion', ui.prefs.reduceMotion);
  root.innerHTML = shellHtml();
  placeHow();
  if (fitCharts()) { root.innerHTML = shellHtml(); placeHow(); }
  root.dataset.view = ui.view;
  root.dataset.revisions = String(ui.session?.revisions.length || 0);
  const conv = root.querySelector('.conversation');
  if (conv) {
    const grew = !chat || conv.children.length > chat.count;
    // follow the newest message only after the user sent one or was already reading the bottom
    if (!chat || ui.followChat || (grew && chat.atBottom)) conv.scrollTop = conv.scrollHeight;
    else conv.scrollTop = chat.top;
    if (grew) ui.followChat = false;
  }
  if (ui.modal.open && !root.contains(document.activeElement?.closest?.('.modal') || null)) {
    root.querySelector(ui.modal.step === 'review' ? '[data-action="confirm-change"], [data-action="cancel-change"]' : '#dis-text')?.focus();
  }
  syncCompareScroll();
  wireChatNav();
  stabilizePreview();
  nav.afterRender();
  if (ui.animateRevisionId && head && ui.animateRevisionId === head.id && ui.view === 'workspace') {
    playTransition();
    ui.animateRevisionId = null;
  }
}

/**
 * Sizes timeline rows so charts fill their cards on desktop. Returns true when a row height changed
 * and the view must be rendered once more, before any transition plays.
 */
function fitCharts() {
  let changed = false;
  // Rows are fitted only where the layout gives a chart a bounded box; stacked layouts use natural rows.
  if (!window.matchMedia?.('(min-width: 1101px) and (min-height: 700px)').matches) {
    for (const key of ['rowH', 'previewRowH', 'compareRowH', 'historyRowH']) if (ui[key] !== null) { ui[key] = null; changed = true; }
    return changed;
  }
  const fit = (selector, key, plans, state, compact, extra = 0, minRow, maxRow) => {
    const el = root.querySelector(selector);
    if (!el || !state) return;
    const rowH = fitRowHeight({ state, plans, availablePx: el.clientHeight - 6 - extra, compact, minRow, maxRow });
    if (rowH !== ui[key]) { ui[key] = rowH; changed = true; }
  };
  if (ui.session) {
    const head = currentRevision(ui.session);
    const prev = head.index > 0 ? ui.session.revisions[head.index - 1] : null;
    if (ui.view === 'workspace') fit('.canvas-body', 'rowH', [head.plan, prev?.plan], head.state, false);
    if (ui.view === 'compare' && ui.session.revisions.length > 1) {
      const block = root.querySelector('.dual-block');
      if (block) fit('.dual-block', 'compareRowH', [head.plan, prev?.plan], head.state, false, (block.querySelector('.dual-label')?.offsetHeight || 0) + 8, 34);
    }
    if (ui.view === 'history') {
      const R = ui.session.revisions[Math.min(ui.historyIndex ?? ui.session.revisions.length - 1, ui.session.revisions.length - 1)];
      fit('.snap-tl', 'historyRowH', [R.plan], R.state, true, 0, 30, 92);
    }
  }
  if (ui.view === 'home' && ui.preview?.ok && ui.home.tab !== 'tasks') fit('.preview-body', 'previewRowH', [ui.preview.plan], ui.preview.state, true, 0, 30, 80);
  return changed;
}

function refreshPreview() {
  nav.beforeRender();
  computePreview();
  const s = getScenario(ui.home.scenarioId);
  // The hero card summarises the same preview; re-render it without touching the form.
  const hero = root.querySelector('.home-main');
  if (hero) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderHome({ scenarios: allScenarios(), home: ui.home, preview: ui.preview, session: ui.session, notice: ui.notice });
    const fresh = tmp.querySelector('.home-main');
    if (fresh) hero.replaceWith(fresh);
  }
  placeHow();
  const box = root.querySelector('#home-preview');
  if (box) {
    box.innerHTML = renderHomePreview(s, ui.preview, ui.home.tab);
    if (fitCharts()) box.innerHTML = renderHomePreview(s, ui.preview, ui.home.tab);
  }
  const out = root.querySelector('[data-out="deadline"]');
  if (out) out.textContent = formatClock(s, ui.home.form.deadlineMin);
  const win = root.querySelector('[data-out="window"]');
  if (win) win.textContent = `Start ${formatClock(s, s.startMin)} · window ${formatDuration(ui.home.form.deadlineMin - s.startMin)}`;
  stabilizePreview();
  nav.afterRender();
}

/**
 * Stacked Home layout: the Tasks tab reuses the height the timeline actually had, so switching tabs
 * never moves the page (on desktop the flex layout already gives both tabs the same box).
 */
let previewBodyH = 0;
/** "How PlanB works" fills the space under the scenario cards only when it fits without scrolling. */
function placeHow() {
  const how = root.querySelector('.view-home .how');
  const host = root.querySelector('.view-host');
  if (!how || !host) return;
  how.classList.remove('is-hidden');
  if (host.scrollHeight > host.clientHeight + 1) how.classList.add('is-hidden');
}

function stabilizePreview() {
  const body = root.querySelector('.preview-body');
  if (!body) return;
  const stacked = window.matchMedia?.('(max-width: 1100px)').matches;
  if (ui.home.tab !== 'tasks') { body.style.height = ''; previewBodyH = body.offsetHeight; return; }
  if (stacked && previewBodyH) { body.style.height = `${previewBodyH}px`; body.classList.add('is-bounded'); }
}

/** Chat scroll buttons reflect the history's scroll position (aria-disabled keeps focus on them at a limit). */
function wireChatNav() {
  const c = root.querySelector('.conversation');
  if (!c) return;
  const update = () => {
    const atTop = c.scrollTop <= 1;
    const atEnd = c.scrollHeight - c.clientHeight - c.scrollTop <= 1;
    for (const b of root.querySelectorAll('[data-action="chat-scroll"]')) {
      const off = b.dataset.dir === 'up' ? atTop : atEnd;
      b.setAttribute('aria-disabled', String(off));
      b.classList.toggle('is-off', off);
    }
  };
  c.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
}

/** Before/After: Plan A and Plan B scroll sideways together so the same minute stays aligned. */
function syncCompareScroll() {
  const a = root.querySelector('#tl-before');
  const b = root.querySelector('#tl-after');
  if (!a || !b) return;
  let lock = false;
  const link = (src, dst) => src.addEventListener('scroll', () => {
    if (lock) return;
    lock = true;
    dst.scrollLeft = src.scrollLeft;
    requestAnimationFrame(() => { lock = false; });
  }, { passive: true });
  link(a, b);
  link(b, a);
}

/** FLIP: start changed bars (and a moved deadline) at their previous coordinates, then transition. */
function playTransition() {
  const chart = root.querySelector('#tl-main');
  if (!chart || reduceMotion()) return;
  const moving = [...chart.querySelectorAll('[data-from-left]')];
  const targets = moving.map((el) => ({ el, left: el.style.left, width: el.style.width, top: el.style.top }));
  for (const t of targets) {
    t.el.style.transition = 'none';
    t.el.style.left = `${t.el.dataset.fromLeft}%`;
    if (t.el.dataset.fromWidth) t.el.style.width = `${t.el.dataset.fromWidth}%`;
    if (t.el.dataset.fromTop) t.el.style.top = `${t.el.dataset.fromTop}px`;
  }
  chart.classList.add('animating');
  void chart.offsetHeight;
  requestAnimationFrame(() => {
    for (const t of targets) {
      t.el.style.transition = '';
      t.el.style.left = t.left;
      t.el.style.width = t.width;
      t.el.style.top = t.top;
    }
    setTimeout(() => chart.classList.remove('animating'), 1500);
  });
}

/* ---------- Events ---------- */

function navigate(view, { fromBack = false } = {}) {
  const def = VIEWS.find((v) => v.id === view);
  if (!def) return;
  if (view !== ui.view) {
    nav.leaving(ui.view);
    if (!fromBack) { viewStack.push(ui.view); if (viewStack.length > 20) viewStack.shift(); }
  }
  ui.view = view;
  if (view !== 'workspace') ui.animateRevisionId = null;
  persist();
  render();
  root.querySelector('.view-host')?.scrollTo?.(0, 0);
}

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  switch (el.dataset.action) {
    case 'nav': navigate(el.dataset.view); break;
    case 'choose-scenario':
      selectScenario(el.dataset.id);
      render();
      root.querySelector(`.tile[data-id="${CSS.escape(el.dataset.id)}"]`)?.focus();
      break;
    case 'home-tab': ui.home.tab = el.dataset.tab; render(); break;
    case 'new-session': newSession(); break;
    case 'build-from': buildPlan(el.dataset.view === 'compare' || el.dataset.view === 'history' || el.dataset.view === 'repair' ? 'workspace' : el.dataset.view); break;
    case 'quick': requestChange(el.dataset.text, 'quick', 'chat'); break;
    case 'quick-review': ui.modal = { open: true, step: 'describe', draft: el.dataset.text }; requestChange(el.dataset.text, 'quick', 'modal'); break;
    case 'open-disruption': ui.pending = null; ui.modal = { open: true, step: 'describe', draft: '' }; render(); sound.play('open'); break;
    case 'close-modal': cancelPending(); break;
    case 'modal-back': ui.modal = { ...ui.modal, step: 'describe', draft: ui.pending?.input || ui.modal.draft }; ui.pending = null; render(); break;
    case 'dis-example': { const ta = root.querySelector('#dis-text'); if (ta) { ta.value = el.dataset.text; ta.focus(); } break; }
    case 'confirm-change': if (ui.pending?.preview?.ok) confirmWith(ui.pending); break;
    case 'cancel-change': cancelPending(); break;
    case 'toggle-ghosts': ui.prefs.ghosts = el.checked; savePrefs(); render(); break;
    case 'pref': ui.prefs[el.dataset.pref] = el.checked; savePrefs(); if (el.dataset.pref === 'sound') sound.setEnabled(el.checked); render(); break;
    case 'sound-test': sound.play('success'); break;
    case 'advance': runTurn(`Advance the clock ${el.dataset.min} minutes`, { intent: 'advance', minutes: Number(el.dataset.min), shocks: [], parser: 'form', source: 'form' }); break;
    case 'select-task': {
      const id = el.dataset.task;
      ui.selectedTaskId = ui.selectedTaskId === id ? null : id;
      persist();
      render();
      // keep the linked change-map / ledger entry in view
      root.querySelector('.map-row.is-selected, .ledger-row.is-selected')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
      break;
    }
    case 'chat-scroll': {
      const c = root.querySelector('.conversation');
      if (!c || el.getAttribute('aria-disabled') === 'true') break;
      const behavior = reduceMotion() ? 'auto' : 'smooth';
      if (el.dataset.dir === 'latest') c.scrollTo({ top: c.scrollHeight, behavior });
      else c.scrollBy({ top: (el.dataset.dir === 'up' ? -1 : 1) * Math.round(c.clientHeight * 0.75), behavior });
      break;
    }
    case 'b-edit': {
      const s = getScenario(el.dataset.id);
      if (s) { ui.builder = { ...ui.builder, draft: draftFromScenario(s), result: null, preview: null, notice: '', confirmDelete: false, io: null }; saveDraft(); navigate('create'); }
      break;
    }
    case 'b-new': ui.builder = { ...ui.builder, draft: emptyDraft(), result: null, preview: null, notice: '', confirmDelete: false, io: null }; saveDraft(); render(); break;
    case 'b-example': ui.builder = { ...ui.builder, draft: exampleDraft(), result: null, preview: null, notice: 'Loaded the example. It is a template: edit anything, then save it as your own plan.', confirmDelete: false, io: null }; saveDraft(); render(); break;
    case 'b-add': builderAdd(el.dataset.list); break;
    case 'b-remove': builderRemove(el.dataset.list, el.dataset.key); break;
    case 'b-toggle': builderToggle(el.dataset.key, el.dataset.list, el.dataset.ref); break;
    case 'b-move': builderMove(el.dataset.key, Number(el.dataset.dir)); break;
    case 'b-io':
      ui.builder.io = el.dataset.mode === 'close' ? null : { mode: el.dataset.mode, text: el.dataset.mode === 'export' ? exportDraft(ui.builder.draft) : '', error: '' };
      render();
      if (ui.builder.io) root.querySelector('#b-io-text')?.focus();
      break;
    case 'b-import': {
      const res = importDraft(root.querySelector('#b-io-text')?.value || '');
      if (!res.ok) { ui.builder.io = { ...ui.builder.io, text: root.querySelector('#b-io-text')?.value || '', error: res.error }; render(); break; }
      ui.builder = { ...ui.builder, draft: res.draft, io: null, result: null, preview: null, notice: 'Plan imported into the editor. Nothing is saved until you save it.' };
      saveDraft(); render();
      break;
    }
    case 'b-save': builderSave(el.dataset.build === '1'); break;
    case 'b-delete': {
      const id = ui.builder.draft.id;
      if (!id) break;
      if (!ui.builder.confirmDelete) { ui.builder.confirmDelete = true; render(); break; }
      customStore.remove(id);
      if (ui.home.scenarioId === id) selectScenario(SCENARIOS[0].id);
      ui.builder = { ...ui.builder, draft: emptyDraft(), result: null, preview: null, confirmDelete: false, notice: 'Plan deleted. A plan already built from it keeps working until you build another.' };
      saveDraft(); render();
      break;
    }
    case 'history-pick': ui.historyIndex = Number(el.dataset.index); render(); break;
    case 'undo': requestChange('Undo the last change.', 'quick', 'chat'); break;
    case 'restore': requestChange('Restore the original plan.', 'quick', 'chat'); break;
    case 'apply-option': chooseOption(Number(el.dataset.index)); break;
    case 'dismiss-proposal': ui.proposal = null; ui.status = 'idle'; render(); break;
    case 'dismiss-banner': ui.bannerRevisionId = null; render(); break;
    default: break;
  }
});

// Re-rendering an open <details> also fires 'toggle'; only a user's click on its summary changes the accordion.
// The accordion state changes synchronously on the user's click (a re-render in between must not
// undo it); the 'toggle' event that follows only closes the other panels and keeps the opened one in view.
// Re-rendering an open <details> also fires 'toggle', so only toggles that follow a user click count.
let userToggle = false;
root.addEventListener('click', (ev) => {
  const summary = ev.target.closest?.('details.trace-wrap > summary');
  if (!summary) return;
  const d = summary.parentElement;
  userToggle = true;
  const opening = !d.open;
  ui.openTrace = opening ? Number(d.dataset.msg) : -1;
}, true);
root.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('trace-wrap') || !userToggle) return;
  userToggle = false;
  if (!d.open) return;
  for (const other of root.querySelectorAll('details.trace-wrap[open]')) if (other !== d) other.open = false;
  const conv = d.closest('.conversation');
  if (conv) {
    // keep the reading position; only scroll as far as needed to show the opened steps
    const c = conv.getBoundingClientRect();
    const r = d.getBoundingClientRect();
    if (r.bottom > c.bottom) conv.scrollTop += Math.min(r.bottom - c.bottom + 12, r.top - c.top - 8);
  }
}, true);

root.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target;
  switch (form.dataset.form) {
    case 'command': requestChange(form.querySelector('#cmd').value, 'typed', 'chat'); break;
    case 'topcmd': {
      const text = form.querySelector('#topcmd').value;
      if (text.trim()) { ui.modal = { open: true, step: 'describe', draft: text }; requestChange(text, 'typed', 'modal'); }
      break;
    }
    case 'disruption': {
      const text = form.querySelector('#dis-text').value;
      ui.modal = { ...ui.modal, draft: text };
      requestChange(text, 'typed', 'modal');
      break;
    }
    case 'manual': {
      const { input, parsed } = manualParsed(form);
      prepareReview(input, parsed, 'modal');
      break;
    }
    case 'setup': buildPlan(); break;
    default: break;
  }
});

root.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'cmd') { ui.draft = el.value; return; }
  if (el.id === 'dis-text') { ui.modal.draft = el.value; return; }
  if (el.dataset.b) { builderSet(el.dataset.b, el); return; }
  if (el.dataset.action === 'pref-volume') {
    ui.prefs.volume = Number(el.value) / 100;
    sound.setVolume(ui.prefs.volume);
    savePrefs();
    const out = root.querySelector('[data-out="volume"]');
    if (out) out.textContent = `${el.value}%`;
    return;
  }
  if (ui.view !== 'home') return;
  const f = ui.home.form;
  if (el.dataset.field === 'deadline') f.deadlineMin = Number(el.value);
  else if (el.dataset.field === 'budget') f.budgetCap = Math.max(0, Math.min(1000, Math.round(Number(el.value) || 0)));
  else return;
  refreshPreview();
});

root.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.b) { builderSet(el.dataset.b, el); return; }
  if (el.dataset.field === 'm-type') {
    const slot = el.closest('form')?.querySelector('[data-slot="m-param"]');
    if (slot) slot.innerHTML = manualParam(el.value, currentRevision(ui.session));
    return;
  }
  if (el.dataset.action === 'pref-volume') { sound.play('focus'); return; }
  if (el.dataset.action === 'compare-pick') {
    const value = Number(el.value);
    if (el.dataset.side === 'a') ui.compareA = value;
    else { ui.compareB = value; if ((ui.compareA ?? value - 1) >= value) ui.compareA = value - 1; }
    render();
    return;
  }
  if (ui.view !== 'home') return;
  if (el.dataset.field === 'person') ui.home.form.people[el.dataset.id] = el.checked;
  else if (el.dataset.field === 'resource') ui.home.form.resources[el.dataset.id] = el.checked;
  else return;
  refreshPreview();
});

document.addEventListener('keydown', (ev) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === '/' && ui.session) {
    ev.preventDefault();
    (root.querySelector('#cmd') || root.querySelector('#topcmd'))?.focus();
  } else if ((ev.key === 'd' || ev.key === 'D') && ui.session && !ui.modal.open) {
    ev.preventDefault();
    ui.pending = null;
    ui.modal = { open: true, step: 'describe', draft: '' };
    render();
    sound.play('open');
  }
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { previewBodyH = 0; ui.rowH = null; ui.previewRowH = null; ui.compareRowH = null; ui.historyRowH = null; if (!document.getElementById('splash')) render(); }, 150);
});

window.addEventListener('error', (e) => {
  ui.notice = `Something went wrong in the page (${e.message}). Your saved plan is unchanged.`;
});

/* ---------- Boot: the splash shows only while real start-up work runs ---------- */

function splashStep(fraction, text) {
  const bar = document.getElementById('splash-bar');
  const ring = document.getElementById('splash-ring');
  const status = document.getElementById('splash-status');
  if (bar) bar.style.transform = `scaleX(${fraction})`;
  if (ring) ring.style.strokeDashoffset = String(264 * (1 - fraction));
  if (status) status.textContent = text;
}

const SPLASH_MIN_MS = 1200; // short floor so the real start-up steps are legible; no extra wait beyond it

async function boot() {
  const t0 = performance.now();
  const minMs = reduceMotion() ? 400 : SPLASH_MIN_MS;
  const pace = async (fraction) => {
    const target = minMs * fraction;
    const wait = target - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
  splashStep(0.12, 'Loading planning engine…');
  await pace(0.2);
  splashStep(0.35, `Validating ${SCENARIOS.length} household scenarios…`);
  // Only the planning work itself is timed; the pacing waits are not counted.
  const v0 = performance.now();
  let checks = 0;
  for (const s of SCENARIOS) {
    if (validateScenario(s).ok) {
      const res = createSession(s, { now: 0 });
      if (res.ok) checks += res.session.revisions[0].plan.validation.checks;
    }
  }
  let workMs = performance.now() - v0;
  await pace(0.45);
  splashStep(0.6, 'Checking assistant parser…');
  await detectParser(1500);
  await pace(0.68);
  splashStep(0.82, 'Restoring your session…');
  const r0 = performance.now();
  const resumed = restore();
  computePreview();
  workMs += performance.now() - r0;
  await pace(0.86);
  ui.boot.summary = `${checks} baseline checks passed across ${SCENARIOS.length} scenarios in ${Math.round(workMs)} ms${resumed ? ' · session restored' : ''}`;
  splashStep(1, `Ready — ${checks} baseline checks passed`);
  root.dataset.boot = ui.boot.summary;
  await pace(1);
  render();
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), reduceMotion() ? 0 : 320);
  }
}

boot();

export { esc };
