// UI state machine and event handling. All planning happens in the engine modules;
// this file only routes user actions, persists state and renders views.

import { SCENARIOS, getScenario } from './data/scenarios.js';
import { createSession, currentRevision } from './engine/session.js';
import { validateScenario } from './engine/validate.js';
import { formatClock, formatDuration } from './engine/model.js';
import { parseCommand } from './engine/parser.js';
import { runAgentTurn, applyOption } from './engine/agent.js';
import { saveState, loadState, clearState, memoryStorage } from './persistence.js';
import {
  renderAppBar, renderHome, renderHomePreview, renderGantt, renderKpis, renderToolbar, renderInfeasible,
  renderRecoveryBanner, renderSidePanel, renderDock, manualParam, esc, renderTaskDetail, fitRowHeight,
} from './components.js';

const root = document.getElementById('app');
const reduceMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

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

function defaultForm(id) {
  const s = getScenario(id);
  return { deadlineMin: s.deadlineMin, budgetCap: s.budgetCap, people: {}, resources: {} };
}

const ui = {
  screen: 'home',
  session: null,
  view: 'plan',
  ghosts: true,
  sideTab: 'changes',
  selectedTaskId: null,
  status: 'idle',
  proposal: null,
  animateRevisionId: null,
  bannerRevisionId: null,
  home: { scenarioId: SCENARIOS[0].id, form: defaultForm(SCENARIOS[0].id), error: '', tab: 'timeline' },
  preview: null,
  rowH: null,
  previewRowH: null,
  notice: '',
  draft: '',
  parser: { mode: 'local', reason: 'Checking server…' },
};

/* ---------- Persistence ---------- */

function persist() {
  if (!ui.session) return;
  saveState(storage, { session: ui.session, ui: { view: ui.view, selectedTaskId: ui.selectedTaskId, ghosts: ui.ghosts, sideTab: ui.sideTab } });
}

function restore() {
  const res = loadState(storage);
  if (res.ok) {
    ui.session = res.session;
    ui.screen = 'workspace';
    ui.view = res.ui.view === 'compare' && res.session.revisions.length > 1 ? 'compare' : 'plan';
    ui.selectedTaskId = res.ui.selectedTaskId || null;
    ui.ghosts = res.ui.ghosts !== false;
    ui.sideTab = ['changes', 'constraints', 'history', 'log'].includes(res.ui.sideTab) ? res.ui.sideTab : 'changes';
    if (getScenario(res.session.scenarioId)) selectScenario(res.session.scenarioId);
    ui.notice = '';
  } else if (res.reason !== 'empty') {
    ui.notice = res.message || 'Saved session could not be restored.';
  }
  return res.ok;
}

/* ---------- Parser selection (LLM only when the server reports it enabled) ---------- */

async function detectParser(timeoutMs = 2500) {
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

/** Updates only the preview and the form's live outputs, so sliders keep their drag/focus. */
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
}

/* ---------- Actions ---------- */

function setStatus(status) {
  ui.status = status;
  if (ui.screen === 'workspace') render();
}

async function submitCommand(text, source = 'typed') {
  const trimmed = text.trim();
  if (!trimmed || ui.status === 'parsing' || ui.status === 'planning') return;
  ui.draft = '';
  setStatus('parsing');
  const parsed = await parseText(trimmed, source);
  setStatus('planning');
  await new Promise((r) => setTimeout(r, 60)); // let the busy state paint before the synchronous planner runs
  runTurn(trimmed, parsed);
}

function runTurn(input, parsed) {
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
    ui.view = 'plan';
    ui.sideTab = 'changes';
  }
  if (ui.session.revisions.length < before) {
    ui.selectedTaskId = null;
    ui.bannerRevisionId = null;
  }
  persist();
  render();
  if (ui.proposal) {
    root.querySelector('.timeline-card')?.classList.add('crisis');
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
  ui.sideTab = 'changes';
  persist();
  render();
}

function buildPlan() {
  const scenario = getScenario(ui.home.scenarioId);
  const res = createSession(scenario, { overrides: overridesFor(scenario, ui.home.form), now: Date.now() });
  if (!res.ok) {
    ui.home.error = res.errors.map((e) => e.message).join(' · ');
    render();
    return;
  }
  Object.assign(ui, {
    session: res.session, screen: 'workspace', view: 'plan', sideTab: 'changes', selectedTaskId: null,
    proposal: null, status: 'idle', bannerRevisionId: null, notice: '',
  });
  ui.home.error = '';
  persist();
  render();
}

function newSession() {
  clearState(storage);
  Object.assign(ui, { screen: 'home', session: null, proposal: null, selectedTaskId: null, status: 'idle', notice: '', bannerRevisionId: null });
  selectScenario(ui.home.scenarioId);
  render();
}

function manualSubmit(form) {
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
  runTurn(`${label} ${Object.values(payload).join(' ')}`.trim(), { intent: 'shocks', shocks: [{ type, payload }], parser: 'form', source: 'form' });
}

/* ---------- Rendering ---------- */

function workspaceHtml() {
  const session = ui.session;
  const head = currentRevision(session);
  const prev = head.index > 0 ? session.revisions[head.index - 1] : null;
  const scenario = getScenario(session.scenarioId) || head.state.scenario;
  const changed = new Map((head.diff?.entries || []).map((e) => [e.taskId, e.kind]));
  const axisStates = [head.state, ...(prev ? [prev.state] : []), session.revisions[0].state];
  const end = Math.ceil((Math.max(...axisStates.map((x) => x.scenario.deadlineMin), head.plan.endMin, prev?.plan.endMin || 0) + 10) / 30) * 30;
  const axis = { start: head.state.scenario.startMin, end, span: end - head.state.scenario.startMin };
  const animate = ui.animateRevisionId === head.id;
  const common = { axis, nowMin: session.nowMin, atMin: head.atMin, selectedTaskId: ui.selectedTaskId };
  const charts = ui.view === 'compare' && prev
    ? `<div class="compare">
        ${renderGantt({ ...common, state: prev.state, plan: prev.plan, title: `Before · ${prev.id} ${prev.label}`, id: 'gantt-before', changed })}
        ${renderGantt({ ...common, state: head.state, plan: head.plan, prevPlan: prev.plan, prevState: prev.state, title: `After · ${head.id} Plan B`, id: 'gantt-after', changed })}
      </div>`
    : renderGantt({
      ...common, state: head.state, plan: head.plan, prevPlan: prev?.plan, prevState: prev?.state,
      changed, ghosts: ui.ghosts && Boolean(prev), animate, id: 'gantt-main', title: '', rowH: ui.rowH,
    });
  const chartTitle = prev ? `Plan B · ${head.id}` : 'Original plan';
  const chartSub = prev ? `after: ${head.label}` : 'validated baseline';
  return `
  <div class="workspace" id="main">
    ${renderDock({ session, scenario, status: ui.status, parser: ui.parser, draft: ui.draft })}
    <main class="center" aria-label="Plan">
      ${ui.notice ? `<div class="notice" role="status">${esc(ui.notice)}</div>` : ''}
      ${renderKpis({ head, prev, animate })}
      ${ui.proposal ? renderInfeasible(ui.proposal, head.state.scenario) : ''}
      ${!ui.proposal && ui.bannerRevisionId === head.id ? renderRecoveryBanner(head) : ''}
      <section class="timeline-card ${ui.status === 'planning' ? 'is-replanning' : ''}" aria-label="Timeline">
        <div class="tc-head">
          <div><h2 class="tc-title">${esc(chartTitle)}</h2><div class="tc-sub muted small">${esc(chartSub)}</div></div>
          ${renderToolbar({ ui, head, scenario: head.state.scenario, nowMin: session.nowMin })}
        </div>
        <div class="tc-body">${charts}</div>
        ${ui.selectedTaskId ? renderTaskDetail({ head, taskId: ui.selectedTaskId, nowMin: session.nowMin }) : `<div class="chart-hint">
          <span class="legend" aria-hidden="true"><span class="lg lg-done">done</span><span class="lg lg-prog">in progress</span><span class="lg lg-alt">alternative</span><span class="lg lg-chg">changed</span>${prev ? '<span class="lg lg-ghost">previous position</span>' : ''}</span>
          <span class="muted small">Select any bar for details.</span></div>`}
        <div class="replan-veil" aria-hidden="true"><span>Replanning…</span></div>
      </section>
    </main>
    ${renderSidePanel({ tab: ui.sideTab, head, session, selectedTaskId: ui.selectedTaskId })}
  </div>`;
}

function render() {
  const head = ui.session ? currentRevision(ui.session) : null;
  const bar = renderAppBar({ screen: ui.screen, session: ui.session, head, parser: ui.parser });
  let body;
  if (ui.screen === 'workspace' && ui.session) body = workspaceHtml();
  else {
    if (!ui.preview) computePreview();
    body = renderHome({ scenarios: SCENARIOS, home: ui.home, preview: ui.preview, session: ui.session, notice: ui.notice });
  }
  const activeId = document.activeElement?.id;
  root.innerHTML = `<a class="skip" href="#main">Skip to content</a>${bar}${body}`;
  root.dataset.screen = ui.screen;
  const conv = root.querySelector('.conversation');
  if (conv) conv.scrollTop = conv.scrollHeight;
  if (fitCharts()) {
    root.innerHTML = `<a class="skip" href="#main">Skip to content</a>${bar}${ui.screen === 'workspace' && ui.session ? workspaceHtml() : renderHome({ scenarios: SCENARIOS, home: ui.home, preview: ui.preview, session: ui.session, notice: ui.notice })}`;
    const c2 = root.querySelector('.conversation');
    if (c2) c2.scrollTop = c2.scrollHeight;
  }
  if (activeId) root.querySelector(`#${CSS.escape(activeId)}`)?.focus();
  if (ui.animateRevisionId && head && ui.animateRevisionId === head.id) {
    playTransition();
    ui.animateRevisionId = null;
  }
}

/**
 * Sizes timeline rows so the chart fills its card (desktop app shell). Returns true when the
 * row height changed and the view must be rendered once more, before any transition plays.
 */
function fitCharts() {
  let changedSize = false;
  const main = root.querySelector('.tc-body');
  if (main && ui.screen === 'workspace' && ui.view === 'plan') {
    const head = currentRevision(ui.session);
    const prev = head.index > 0 ? ui.session.revisions[head.index - 1] : null;
    const rowH = fitRowHeight({ state: head.state, plans: [head.plan, prev?.plan], availablePx: main.clientHeight - 4, compact: false });
    if (rowH !== ui.rowH) { ui.rowH = rowH; changedSize = true; }
  }
  const pv = root.querySelector('.pv-body');
  if (pv && ui.screen === 'home' && ui.preview?.ok && ui.home.tab !== 'tasks') {
    const rowH = fitRowHeight({ state: ui.preview.state, plans: [ui.preview.plan], availablePx: pv.clientHeight - 4, compact: true });
    if (rowH !== ui.previewRowH) { ui.previewRowH = rowH; changedSize = true; }
  }
  return changedSize;
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { ui.rowH = null; ui.previewRowH = null; if (!document.getElementById('splash')) render(); }, 150);
});

/** FLIP: start changed bars (and a moved deadline) at their previous coordinates, then let CSS transition them. */
function playTransition() {
  const chart = root.querySelector('#gantt-main');
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
    setTimeout(() => chart.classList.remove('animating'), 1400);
  });
}

/* ---------- Events ---------- */

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  switch (el.dataset.action) {
    case 'choose-scenario':
      selectScenario(el.dataset.id);
      render();
      root.querySelector(`.tile[data-id="${CSS.escape(el.dataset.id)}"]`)?.focus();
      break;
    case 'go-home': ui.screen = 'home'; ui.proposal = null; render(); break;
    case 'go-workspace': if (ui.session) { ui.screen = 'workspace'; render(); } break;
    case 'home-tab': ui.home.tab = el.dataset.tab; refreshPreview(); break;
    case 'side-tab': ui.sideTab = el.dataset.tab; persist(); render(); root.querySelector(`#tab-${el.dataset.tab}`)?.focus(); break;
    case 'new-session': newSession(); break;
    case 'quick': submitCommand(el.dataset.text, 'quick'); break;
    case 'view': ui.view = el.dataset.view; persist(); render(); break;
    case 'toggle-ghosts': ui.ghosts = el.checked; persist(); render(); break;
    case 'advance': runTurn(`Advance the clock ${el.dataset.min} minutes`, { intent: 'advance', minutes: Number(el.dataset.min), shocks: [], parser: 'form', source: 'form' }); break;
    case 'select-task': {
      const id = el.dataset.task;
      ui.selectedTaskId = ui.selectedTaskId === id ? null : id;
      persist();
      render();
      root.querySelector(`[data-why="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    }
    case 'undo': submitCommand('Undo the last change.', 'quick'); break;
    case 'restore': submitCommand('Restore the original plan.', 'quick'); break;
    case 'apply-option': chooseOption(Number(el.dataset.index)); break;
    case 'dismiss-proposal': ui.proposal = null; ui.status = 'idle'; render(); break;
    case 'dismiss-banner': ui.bannerRevisionId = null; render(); break;
    default: break;
  }
});

root.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (form.dataset.form === 'command') submitCommand(form.querySelector('#cmd').value, 'typed');
  else if (form.dataset.form === 'setup') buildPlan();
  else if (form.dataset.form === 'manual') manualSubmit(form);
});

root.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'cmd') { ui.draft = el.value; return; }
  if (ui.screen !== 'home') return;
  const f = ui.home.form;
  if (el.dataset.field === 'deadline') f.deadlineMin = Number(el.value);
  else if (el.dataset.field === 'budget') f.budgetCap = Math.max(0, Math.min(1000, Math.round(Number(el.value) || 0)));
  else return;
  refreshPreview();
});

root.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.field === 'm-type') {
    const slot = root.querySelector('[data-slot="m-param"]');
    if (slot) slot.innerHTML = manualParam(el.value, currentRevision(ui.session));
    return;
  }
  if (ui.screen !== 'home') return;
  if (el.dataset.field === 'person') ui.home.form.people[el.dataset.id] = el.checked;
  else if (el.dataset.field === 'resource') ui.home.form.resources[el.dataset.id] = el.checked;
  else return;
  refreshPreview();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ui.proposal) { ui.proposal = null; ui.status = 'idle'; render(); return; }
  if (ev.key === '/' && ui.screen === 'workspace' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    ev.preventDefault();
    root.querySelector('#cmd')?.focus();
    return;
  }
  // Arrow keys move between side-panel tabs (WAI-ARIA tabs pattern).
  const tab = document.activeElement?.closest?.('[role="tab"]');
  if (tab && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const next = tabs[(tabs.indexOf(tab) + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    ui.sideTab = next.dataset.tab;
    render();
    root.querySelector(`#tab-${ui.sideTab}`)?.focus();
  }
});

window.addEventListener('error', (e) => {
  ui.notice = `Something went wrong in the page (${e.message}). Your saved plan is unchanged.`;
});

/* ---------- Boot with splash (status lines describe real work) ---------- */

function splashStep(fraction, text) {
  const bar = document.getElementById('splash-bar');
  const ring = document.getElementById('splash-ring');
  const status = document.getElementById('splash-status');
  if (bar) bar.style.transform = `scaleX(${fraction})`;
  if (ring) ring.style.strokeDashoffset = String(264 * (1 - fraction));
  if (status) status.textContent = text;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  const t0 = performance.now();
  const minMs = reduceMotion() ? 300 : 1200;
  const maxMs = 2500;
  splashStep(0.15, 'Loading planning engine…');
  await frame();
  splashStep(0.35, `Validating ${SCENARIOS.length} household scenarios…`);
  let checks = 0;
  for (const s of SCENARIOS) {
    if (validateScenario(s).ok) {
      const res = createSession(s, { now: 0 });
      if (res.ok) checks += res.session.revisions[0].plan.validation.checks;
    }
  }
  await frame();
  splashStep(0.6, 'Checking assistant parser…');
  await detectParser(Math.max(400, maxMs - 800 - (performance.now() - t0)));
  splashStep(0.82, 'Restoring your session…');
  const resumed = restore();
  computePreview();
  await frame();
  splashStep(1, `Ready — ${checks} baseline checks passed${resumed ? ' · session restored' : ''}`);
  const wait = Math.min(maxMs, Math.max(minMs, performance.now() - t0)) - (performance.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  render();
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), reduceMotion() ? 0 : 380);
  }
}

boot();
