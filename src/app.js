// UI controller: view routing, events, persistence and rendering. All planning happens in the
// engine modules; this file never computes schedules itself.

import { SCENARIOS, getScenario } from './data/scenarios.js';
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

function loadPrefs() {
  const defaults = { confirm: true, ghosts: true, reduceMotion: false };
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
  notice: '',
  draft: '',
  prefs: loadPrefs(),
  boot: { summary: '' },
  parser: { mode: 'local', reason: 'Checking server…' },
};

const reduceMotion = () => ui.prefs.reduceMotion || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

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
  ui.draft = '';
  setStatus('parsing');
  const parsed = await parseText(trimmed, source);
  if (parsed.intent !== 'shocks') {
    if (origin === 'modal') {
      ui.status = 'idle';
      ui.pending = { origin, input: trimmed, parsed, preview: { ok: false, errors: [`I couldn't map “${trimmed}” to a supported change${parsed.notes?.length ? ` (${parsed.notes.join(' ')})` : ''}. Try one of the examples, or the structured change.`] } };
      ui.modal = { ...ui.modal, open: true, step: 'review', draft: trimmed };
      render();
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
    default:
      if (!ui.preview) computePreview();
      return renderHome({ scenarios: SCENARIOS, home: ui.home, preview: ui.preview, session: ui.session, notice: ui.notice });
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
  const activeId = document.activeElement?.id;
  const head = ui.session ? currentRevision(ui.session) : null;
  document.documentElement.classList.toggle('reduce-motion', ui.prefs.reduceMotion);
  root.innerHTML = shellHtml();
  if (fitCharts()) root.innerHTML = shellHtml();
  root.dataset.view = ui.view;
  root.dataset.revisions = String(ui.session?.revisions.length || 0);
  const conv = root.querySelector('.conversation');
  if (conv) conv.scrollTop = conv.scrollHeight;
  if (activeId) root.querySelector(`#${CSS.escape(activeId)}`)?.focus();
  if (ui.modal.open && !root.contains(document.activeElement?.closest?.('.modal') || null)) {
    root.querySelector(ui.modal.step === 'review' ? '[data-action="confirm-change"], [data-action="cancel-change"]' : '#dis-text')?.focus();
  }
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
  const fit = (selector, key, plans, state, compact, extra = 0, minRow) => {
    const el = root.querySelector(selector);
    if (!el || !state) return;
    const rowH = fitRowHeight({ state, plans, availablePx: el.clientHeight - 6 - extra, compact, minRow });
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
  }
  if (ui.view === 'home' && ui.preview?.ok && ui.home.tab !== 'tasks') fit('.preview-body', 'previewRowH', [ui.preview.plan], ui.preview.state, true);
  return changed;
}

function refreshPreview() {
  computePreview();
  const box = root.querySelector('#home-preview');
  if (box) {
    box.innerHTML = renderHomePreview(getScenario(ui.home.scenarioId), ui.preview, ui.home.tab);
    if (fitCharts()) box.innerHTML = renderHomePreview(getScenario(ui.home.scenarioId), ui.preview, ui.home.tab);
  }
  const s = getScenario(ui.home.scenarioId);
  const out = root.querySelector('[data-out="deadline"]');
  if (out) out.textContent = formatClock(s, ui.home.form.deadlineMin);
  const win = root.querySelector('[data-out="window"]');
  if (win) win.textContent = `Start ${formatClock(s, s.startMin)} · window ${formatDuration(ui.home.form.deadlineMin - s.startMin)}`;
  // The hero card summarises the same preview; re-render it without touching the form.
  const hero = root.querySelector('.home-main');
  if (hero) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderHome({ scenarios: SCENARIOS, home: ui.home, preview: ui.preview, session: ui.session, notice: ui.notice });
    const fresh = tmp.querySelector('.home-main');
    if (fresh) hero.replaceWith(fresh);
  }
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

function navigate(view) {
  const def = VIEWS.find((v) => v.id === view);
  if (!def) return;
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
    case 'open-disruption': ui.pending = null; ui.modal = { open: true, step: 'describe', draft: '' }; render(); break;
    case 'close-modal': cancelPending(); break;
    case 'modal-back': ui.modal = { ...ui.modal, step: 'describe', draft: ui.pending?.input || ui.modal.draft }; ui.pending = null; render(); break;
    case 'dis-example': { const ta = root.querySelector('#dis-text'); if (ta) { ta.value = el.dataset.text; ta.focus(); } break; }
    case 'confirm-change': if (ui.pending?.preview?.ok) confirmWith(ui.pending); break;
    case 'cancel-change': cancelPending(); break;
    case 'toggle-ghosts': ui.prefs.ghosts = el.checked; savePrefs(); render(); break;
    case 'pref': ui.prefs[el.dataset.pref] = el.checked; savePrefs(); render(); break;
    case 'advance': runTurn(`Advance the clock ${el.dataset.min} minutes`, { intent: 'advance', minutes: Number(el.dataset.min), shocks: [], parser: 'form', source: 'form' }); break;
    case 'select-task': {
      const id = el.dataset.task;
      ui.selectedTaskId = ui.selectedTaskId === id ? null : id;
      persist();
      render();
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
  if (ui.view !== 'home') return;
  const f = ui.home.form;
  if (el.dataset.field === 'deadline') f.deadlineMin = Number(el.value);
  else if (el.dataset.field === 'budget') f.budgetCap = Math.max(0, Math.min(1000, Math.round(Number(el.value) || 0)));
  else return;
  refreshPreview();
});

root.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.field === 'm-type') {
    const slot = el.closest('form')?.querySelector('[data-slot="m-param"]');
    if (slot) slot.innerHTML = manualParam(el.value, currentRevision(ui.session));
    return;
  }
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
  if (ev.key === 'Escape') {
    if (ui.modal.open || ui.pending) { cancelPending(); return; }
    if (ui.proposal) { ui.proposal = null; ui.status = 'idle'; render(); return; }
  }
  if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === '/' && ui.session) {
    ev.preventDefault();
    (root.querySelector('#cmd') || root.querySelector('#topcmd'))?.focus();
  } else if ((ev.key === 'd' || ev.key === 'D') && ui.session && !ui.modal.open) {
    ev.preventDefault();
    ui.pending = null;
    ui.modal = { open: true, step: 'describe', draft: '' };
    render();
  }
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { ui.rowH = null; ui.previewRowH = null; ui.compareRowH = null; if (!document.getElementById('splash')) render(); }, 150);
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

const SPLASH_MIN_MS = 2400; // minimum time on screen, so the start-up steps can be read

async function boot() {
  const t0 = performance.now();
  const minMs = reduceMotion() ? 700 : SPLASH_MIN_MS;
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
