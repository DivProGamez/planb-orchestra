// UI state machine and event handling. All planning happens in the engine modules;
// this file only routes user actions, persists state and renders views.

import { SCENARIOS, getScenario } from './data/scenarios.js';
import { createSession, currentRevision } from './engine/session.js';
import { formatClock } from './engine/model.js';
import { parseCommand } from './engine/parser.js';
import { runAgentTurn, applyOption } from './engine/agent.js';
import { saveState, loadState, clearState, memoryStorage } from './persistence.js';
import {
  renderHeader, renderWelcome, renderSetup, renderGantt, renderKpis, renderToolbar, renderInfeasible,
  renderConstraints, renderWhy, renderTimeline, renderDock, manualParam, esc, renderTaskDetail,
} from './components.js';

const root = document.getElementById('app');

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

const ui = {
  screen: 'welcome',
  session: null,
  view: 'plan',
  ghosts: true,
  selectedTaskId: null,
  status: 'idle',
  proposal: null,
  animateRevisionId: null,
  setup: null,
  notice: '',
  draft: '',
  parser: { mode: 'local', reason: 'Checking server…' },
};

/* ---------- Persistence ---------- */

function persist() {
  if (!ui.session) return;
  saveState(storage, { session: ui.session, ui: { view: ui.view, selectedTaskId: ui.selectedTaskId, ghosts: ui.ghosts } });
}

function restore() {
  const res = loadState(storage);
  if (res.ok) {
    ui.session = res.session;
    ui.screen = 'workspace';
    ui.view = res.ui.view === 'compare' && res.session.revisions.length > 1 ? 'compare' : 'plan';
    ui.selectedTaskId = res.ui.selectedTaskId || null;
    ui.ghosts = res.ui.ghosts !== false;
    ui.notice = '';
  } else if (res.reason !== 'empty') {
    ui.notice = res.message || 'Saved session could not be restored.';
  }
}

/* ---------- Parser selection (LLM only when the server reports it verified-enabled) ---------- */

async function detectParser() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    const health = await res.json();
    ui.parser = health.llm?.enabled
      ? { mode: 'llm', model: health.llm.model }
      : { mode: 'local', reason: health.llm?.reason || 'LLM not configured' };
  } catch {
    ui.parser = { mode: 'local', reason: 'Server unreachable — running fully offline' };
  }
  render();
}

async function parseText(text, source) {
  const head = currentRevision(ui.session);
  const state = { ...head.state, nowMin: ui.session.nowMin };
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
    } catch {
      // Fall through to the labelled local parser.
    }
  }
  return { ...parseCommand(text, state), source };
}

/* ---------- Actions ---------- */

function setStatus(status) {
  ui.status = status;
  const el = root.querySelector('.dock-status');
  if (el) render();
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
    ui.view = 'plan';
  }
  if (ui.session.revisions.length < before) ui.selectedTaskId = null;
  persist();
  render();
  if (ui.proposal) root.querySelector('#infeasible')?.focus();
}

function chooseOption(index) {
  const option = ui.proposal?.options[index];
  if (!option) return;
  const result = applyOption(ui.session, ui.proposal, option, { now: Date.now() });
  ui.session = result.session;
  ui.proposal = null;
  ui.status = result.reply.tone === 'done' ? 'done' : 'failure';
  ui.animateRevisionId = currentRevision(ui.session).id;
  persist();
  render();
}

function buildPlan() {
  const scenario = getScenario(ui.setup.scenarioId);
  const f = ui.setup.form;
  const overrides = {
    deadlineMin: f.deadlineMin,
    budgetCap: f.budgetCap,
    people: Object.fromEntries(scenario.people.map((p) => [p.id, { participating: f.people[p.id] !== false }])),
    resources: Object.fromEntries(scenario.resources.map((r) => [r.id, { available: f.resources[r.id] !== false }])),
  };
  const res = createSession(scenario, { overrides, now: Date.now() });
  if (!res.ok) {
    ui.setup.error = res.errors.map((e) => e.message).join(' · ');
    render();
    return;
  }
  ui.session = res.session;
  ui.screen = 'workspace';
  ui.view = 'plan';
  ui.selectedTaskId = null;
  ui.proposal = null;
  ui.status = 'idle';
  ui.setup = null;
  persist();
  render();
}

function openSetup(id) {
  const s = getScenario(id);
  ui.setup = {
    scenarioId: id,
    form: { deadlineMin: s.deadlineMin, budgetCap: s.budgetCap, people: {}, resources: {} },
    error: '',
  };
  ui.screen = 'setup';
  render();
  root.querySelector('[data-field="deadline"]')?.focus();
}

function newSession() {
  clearState(storage);
  Object.assign(ui, { screen: 'welcome', session: null, proposal: null, selectedTaskId: null, status: 'idle', setup: null, notice: '' });
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
  const states = prev ? [head.state, prev.state] : [head.state];
  const axisStates = [...states, session.revisions[0].state];
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
      changed, ghosts: ui.ghosts && Boolean(prev), animate, id: 'gantt-main',
      title: prev ? `Plan B · ${head.id} — after: ${head.label}` : 'Original plan · validated',
    });
  return `
  <div class="workspace" id="main">
    ${renderDock({ session, scenario, status: ui.status, parser: ui.parser, draft: ui.draft })}
    <main class="center" aria-label="Plan">
      ${ui.notice ? `<div class="notice" role="status">${esc(ui.notice)}</div>` : ''}
      ${renderKpis({ head, prev })}
      ${renderToolbar({ ui, head, scenario: head.state.scenario, nowMin: session.nowMin })}
      ${ui.proposal ? renderInfeasible(ui.proposal, head.state.scenario) : ''}
      <div class="chart-wrap">${charts}${ui.selectedTaskId ? renderTaskDetail({ head, taskId: ui.selectedTaskId, nowMin: session.nowMin }) : '<p class="chart-hint muted small">Select any bar for full details. Dashed outlines show where changed tasks were before.</p>'}</div>
      ${renderConstraints({ head, session, original: session.originalScenario })}
    </main>
    <aside class="side" aria-label="Changes and history">
      ${renderWhy({ head, selectedTaskId: ui.selectedTaskId })}
      ${renderTimeline({ session })}
    </aside>
  </div>`;
}

function render() {
  const head = ui.session ? currentRevision(ui.session) : null;
  const scenario = head ? head.state.scenario : null;
  const header = renderHeader({ scenario, nowMin: ui.session?.nowMin ?? 0, parser: ui.parser, screen: ui.screen });
  let body;
  if (ui.screen === 'workspace' && ui.session) body = workspaceHtml();
  else if (ui.screen === 'setup' && ui.setup) body = renderSetup(getScenario(ui.setup.scenarioId), ui.setup.form, ui.setup.error);
  else body = renderWelcome(SCENARIOS, ui.notice);

  const activeId = document.activeElement?.id;
  root.innerHTML = `<a class="skip" href="#main">Skip to content</a>${header}${body}`;
  const newConv = root.querySelector('.conversation');
  if (newConv) newConv.scrollTop = newConv.scrollHeight;
  if (activeId) root.querySelector(`#${CSS.escape(activeId)}`)?.focus();
  if (ui.animateRevisionId && head && ui.animateRevisionId === head.id) {
    playTransition();
    ui.animateRevisionId = null;
  }
}

/** FLIP: start changed bars at their previous coordinates, then let CSS transition them. */
function playTransition() {
  const bars = [...root.querySelectorAll('#gantt-main .bar[data-from-left]')];
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce || bars.length === 0) return;
  const targets = bars.map((b) => ({ el: b, left: b.style.left, width: b.style.width, top: b.style.top }));
  for (const t of targets) {
    t.el.style.transition = 'none';
    t.el.style.left = `${t.el.dataset.fromLeft}%`;
    t.el.style.width = `${t.el.dataset.fromWidth}%`;
    t.el.style.top = `${t.el.dataset.fromTop}px`;
  }
  root.querySelector('#gantt-main')?.classList.add('animating');
  void root.offsetHeight;
  requestAnimationFrame(() => {
    for (const t of targets) {
      t.el.style.transition = '';
      t.el.style.left = t.left;
      t.el.style.width = t.width;
      t.el.style.top = t.top;
    }
    setTimeout(() => root.querySelector('#gantt-main')?.classList.remove('animating'), 1200);
  });
}

/* ---------- Events ---------- */

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  switch (action) {
    case 'choose-scenario': openSetup(el.dataset.id); break;
    case 'back-to-gallery': ui.screen = 'welcome'; ui.setup = null; render(); break;
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
  if (!ui.setup) return;
  const f = ui.setup.form;
  if (el.dataset.field === 'deadline') {
    f.deadlineMin = Number(el.value);
    const s = getScenario(ui.setup.scenarioId);
    const out = root.querySelector('[data-out="deadline"]');
    if (out) out.textContent = formatClock(s, f.deadlineMin);
  }
  if (el.dataset.field === 'budget') f.budgetCap = Math.max(0, Math.min(1000, Math.round(Number(el.value) || 0)));
});

root.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.field === 'm-type') {
    const slot = root.querySelector('[data-slot="m-param"]');
    if (slot) slot.innerHTML = manualParam(el.value, currentRevision(ui.session));
    return;
  }
  if (!ui.setup) return;
  if (el.dataset.field === 'person') ui.setup.form.people[el.dataset.id] = el.checked;
  if (el.dataset.field === 'resource') ui.setup.form.resources[el.dataset.id] = el.checked;
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ui.proposal) { ui.proposal = null; ui.status = 'idle'; render(); }
  if (ev.key === '/' && ui.screen === 'workspace' && document.activeElement?.tagName !== 'INPUT') {
    ev.preventDefault();
    root.querySelector('#cmd')?.focus();
  }
});

window.addEventListener('error', (e) => {
  ui.notice = `Something went wrong in the page (${e.message}). Your saved plan is unchanged.`;
});

restore();
render();
detectParser();
