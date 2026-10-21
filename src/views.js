// Screen views of the desktop app. Pure functions: (context) → HTML string.
// Every value is read from the session, the scenario fixtures or engine output.

import {
  esc, icon, logoSvg, scenarioIcon, avatar, parserPill, reasonBadges, renderTimeline, kpiCard, delta,
  formatWindow, formatClock, formatDuration, formatSigned, personName, resourceName, liveStatus,
  KIND_CLASS, MANUAL_TYPES, manualParam,
} from './components.js';
import { COMPRESSION_LEVELS, SEARCH_LIMIT } from './engine/scheduler.js';

export const VIEWS = [
  { id: 'home', label: 'Scenarios & Home', icon: 'home', section: 'Orchestration canvas' },
  { id: 'workspace', label: 'Plan Workspace', icon: 'workspace', section: 'Orchestration canvas', needsSession: true },
  { id: 'assistant', label: 'Assistant & Copilot', icon: 'sparkle', section: 'Orchestration canvas', needsSession: true },
  { id: 'repair', label: 'Repair Workflow', icon: 'repair', section: 'Orchestration canvas', needsSession: true },
  { id: 'compare', label: 'Timeline Compare', icon: 'compare', section: 'Orchestration canvas', needsSession: true },
  { id: 'history', label: 'History & Revisions', icon: 'history', section: 'Orchestration canvas', needsSession: true },
  { id: 'settings', label: 'Settings & Transparency', icon: 'settings', section: 'Configuration' },
];

const STATUS_LABEL = {
  idle: 'Ready', parsing: 'Reading your request…', planning: 'Replanning…', done: 'Plan up to date', failure: 'Needs your attention',
};

/* ---------- Shell ---------- */

export function renderSidebar({ view, session, head }) {
  const sections = [...new Set(VIEWS.map((v) => v.section))].map((section) => `
    <div class="nav-section">${esc(section)}</div>
    ${VIEWS.filter((v) => v.section === section).map((v) => {
      const waiting = v.needsSession && !session;
      return `<button class="nav-item ${view === v.id ? 'is-active' : ''} ${waiting ? 'needs-plan' : ''}" data-action="nav" data-view="${v.id}" ${waiting ? 'title="Opens once a plan is built — you can build it from there"' : ''} ${view === v.id ? 'aria-current="page"' : ''}>
        ${icon(v.icon, 18)}<span>${esc(v.label)}</span>${v.id === 'history' && session ? `<span class="nav-count">${session.revisions.length}</span>` : ''}</button>`;
    }).join('')}`).join('');
  const s = head?.state.scenario;
  const card = session && s ? `
    <div class="session-card">
      <div class="sc-top">${scenarioIcon(session.scenarioId, 20)}<div><div class="sc-name">${esc(s.name)}</div><div class="sc-sub mono">${esc(head.id)} · clock ${esc(formatClock(s, session.nowMin))}</div></div></div>
      <div class="sc-row"><span class="dot dot-ok"></span><span>Validated · ${head.plan.validation.checks} checks · 0 violations</span></div>
    </div>`
    : '<div class="session-card is-empty"><div class="sc-sub">No active session</div><div class="sc-row muted">Pick a scenario and build a plan.</div></div>';
  return `
  <nav class="sidebar" aria-label="Primary">
    <div class="brand">
      ${logoSvg(38, 'side')}
      <div><div class="brand-name">PlanB Orchestra</div><div class="brand-sub mono">Deterministic engine</div></div>
    </div>
    <div class="nav">${sections}</div>
    <div class="sidebar-foot">
      ${card}
      <p class="sidebar-note">Simulated Alexa+ experience · demo. Not affiliated with or endorsed by Amazon.</p>
    </div>
  </nav>`;
}

export function renderTopbar({ view, session, head, parser }) {
  const current = VIEWS.find((v) => v.id === view);
  const s = head?.state.scenario;
  return `
  <header class="topbar" role="banner">
    <div class="crumbs">
      <span class="muted">Orchestra</span><span class="crumb-sep">›</span>
      ${s ? `<span class="crumb-chip" title="${esc(s.name)} — current revision ${esc(head.id)}">${scenarioIcon(session.scenarioId, 16)}<span class="crumb-name">${esc(s.name)}</span><span class="crumb-rev mono">${esc(head.id)}</span></span>
      <span class="crumb-state" title="The current plan passed the independent validator (${head.plan.validation.checks} checks, 0 violations)"><span class="dot dot-ok"></span>Validated</span>` : ''}
      ${s ? '' : `<span class="crumb-current">${esc(current?.label || '')}</span>`}
    </div>
    <div class="topbar-pills">
      <span class="pill pill-sim" title="Demo simulation. Not an Amazon product, not connected to any Alexa device or account. Details in Settings &amp; Transparency."><span class="dot"></span>Simulated Alexa+ demo</span>
      ${parserPill(parser, true)}
    </div>
    ${session ? `<form class="topcmd" data-form="topcmd" role="search">
      ${icon('search', 15)}<label for="topcmd" class="sr-only">Tell PlanB what changed</label>
      <input id="topcmd" autocomplete="off" maxlength="500" placeholder="Tell PlanB what changed…">
      <kbd title="Focus with /">/</kbd>
    </form>` : ''}
    <div class="topbar-actions">
      ${session ? `
        <span class="clock" aria-label="Simulation clock ${esc(formatClock(s, session.nowMin))}">${icon('clock', 15)}<strong>${esc(formatClock(s, session.nowMin))}</strong></span>
        <button class="btn btn-quiet btn-undo" data-action="undo" ${session.revisions.length > 1 ? '' : 'disabled'} title="Undo the last change" aria-label="Undo the last change">${icon('undo', 16)}<span>Undo</span></button>
        <button class="btn btn-danger" data-action="open-disruption" title="Describe something that changed (D)">${icon('alert', 16)}<span>Simulate disruption</span><kbd>D</kbd></button>`
    : ''}
    </div>
  </header>`;
}

function pageHead({ eyebrow, title, sub, actions = '' }) {
  return `
  <div class="page-head">
    <div class="ph-text">
      <div class="eyebrow"><span class="dot"></span>${eyebrow}</div>
      <h1>${title}</h1>
      ${sub ? `<p class="ph-sub">${sub}</p>` : ''}
    </div>
    <div class="ph-actions">${actions}</div>
  </div>`;
}

/** Shown when a plan-based screen is opened before any plan exists. */
export function renderNeedsPlan({ view, scenario }) {
  const def = VIEWS.find((v) => v.id === view);
  return `
  <div class="view view-needs" id="main">
    ${pageHead({ eyebrow: 'No active plan yet', title: esc(def?.label || ''), sub: 'This screen works on a validated plan. Build one first — it takes a moment and nothing is invented.' })}
    <section class="card needs-card">
      <span class="needs-icon">${icon(def?.icon || 'workspace', 34)}</span>
      <h2>Build a plan to open ${esc(def?.label || 'this screen')}</h2>
      <p class="muted">Selected scenario: <strong>${esc(scenario.name)}</strong> — ${esc(scenario.tagline)}</p>
      <div class="needs-actions">
        <button class="btn btn-primary btn-lg" data-action="build-from" data-view="${esc(view)}">${icon('play', 16)}<span>Build feasible plan</span></button>
        <button class="btn btn-quiet btn-lg" data-action="nav" data-view="home">${icon('home', 16)}<span>Choose another scenario</span></button>
      </div>
    </section>
  </div>`;
}

/* ---------- Home ---------- */

export function renderHome({ scenarios, home, preview, session, notice }) {
  const sel = scenarios.find((s) => s.id === home.scenarioId);
  const p = preview.ok ? preview.plan : null;
  const ps = preview.ok ? preview.state.scenario : null;
  const resume = session ? (() => {
    const h = session.revisions[session.revisions.length - 1];
    return `<button class="btn btn-ghost" data-action="nav" data-view="workspace">${icon('play', 14)}<span>Resume ${esc(h.state.scenario.name)} · ${esc(h.id)}</span></button>`;
  })() : '';
  const stats = p ? [
    ['Tasks', `${p.scheduled.length} scheduled`, `${sel.tasks.filter((t) => t.priority === 'must').length} must · ${sel.tasks.filter((t) => t.priority === 'should').length} should · ${sel.tasks.filter((t) => t.priority === 'optional').length} optional`],
    ['Helpers', `${ps.people.filter((x) => x.availableTo > x.availableFrom).length} people`, ps.people.filter((x) => x.availableTo > x.availableFrom).map((x) => x.name).join(', ') || 'none'],
    ['Validator', `${p.validation.checks} checks`, '0 violations'],
    ['Slack', formatDuration(p.slackMin), `ends ${formatClock(ps, p.endMin)} · $${p.totalCost} / $${ps.budgetCap}`],
  ] : [];
  const cards = scenarios.map((s) => {
    const active = s.id === home.scenarioId;
    return `
    <button class="tile ${active ? 'is-active' : ''}" data-action="choose-scenario" data-id="${esc(s.id)}" aria-pressed="${active}">
      <span class="tile-head"><span class="tile-icon">${scenarioIcon(s.id, 22)}</span>${active ? '<span class="tag tag-primary">Selected</span>' : session?.scenarioId === s.id ? '<span class="tag">In session</span>' : ''}</span>
      <span class="tile-name">${esc(s.name)}</span>
      <span class="tile-tag">${esc(s.tagline)}</span>
      <span class="tile-facts mono">
        <span><em>Helpers</em>${s.people.length}</span><span><em>Tasks</em>${s.tasks.length}</span>
        <span><em>Window</em>${esc(formatDuration(s.deadlineMin - s.startMin))}</span><span><em>Budget</em>$${s.budgetCap}</span>
      </span>
    </button>`;
  }).join('');
  return `
  <div class="view view-home" id="main">
    ${pageHead({
    eyebrow: 'Household plan recovery',
    title: 'Plan a household event',
    sub: 'Pick a scenario, set the constraints, and build a validated plan. When life changes, PlanB repairs the plan and shows exactly why.',
    actions: resume,
  })}
    ${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}
    <div class="home-grid">
      <div class="home-main">
      <section class="hero card" aria-labelledby="hero-title">
        <div class="hero-glow" aria-hidden="true"></div>
        <div class="hero-head">
          <span class="tag ${preview.ok ? 'tag-ok' : 'tag-bad'}">${preview.ok ? `${icon('check', 12)} Feasible baseline` : `${icon('alert', 12)} No feasible baseline`}</span>
          <span class="mono muted small">${esc(sel.id)}</span>
        </div>
        <div class="hero-title-row">
          <div><h2 id="hero-title">${esc(sel.name)}</h2><p class="muted">${esc(sel.tagline)}</p></div>
          <div class="hero-deadline"><span class="mono small muted">Deadline · ${esc(sel.deadlineLabel)}</span><strong>${esc(formatClock(sel, home.form.deadlineMin))}</strong></div>
        </div>
        ${preview.ok ? `<div class="hero-stats">${stats.map(([l, v, sub]) => `<div class="hs"><span class="kpi-label">${esc(l)}</span><strong>${esc(v)}</strong><span class="muted small">${esc(sub)}</span></div>`).join('')}</div>`
    : `<ul class="violations">${preview.errors.map((e) => `<li><span class="proof proof-${esc(e.proof || 'proven')}">${e.proof === 'search' ? 'Bounded search' : 'Proven'}</span> ${esc(e.message)}</li>`).join('')}</ul>`}
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" type="submit" form="setup-form">${icon('play', 16)}<span>Build feasible plan</span></button>
          ${session ? '<span class="muted small">Building replaces the current session.</span>' : '<span class="muted small">Runs the deterministic scheduler and the independent validator.</span>'}
        </div>
      </section>
      <section class="scenarios" aria-labelledby="sc-title">
        <div class="section-head"><h2 id="sc-title">${icon('layers', 16)} Available scenarios</h2><span class="muted small">Seeded, feasible household plans</span></div>
        <div class="tiles" role="group" aria-label="Scenarios">${cards}</div>
      </section>
      <section class="how card" aria-label="How PlanB works">
        <div class="how-step"><span class="how-n mono">01</span><div><strong>Build</strong><p class="muted small">A deterministic scheduler plans people, equipment, budget and the deadline.</p></div></div>
        <div class="how-step"><span class="how-n mono">02</span><div><strong>Disrupt</strong><p class="muted small">Say what changed. Review what PlanB understood and a dry-run impact.</p></div></div>
        <div class="how-step"><span class="how-n mono">03</span><div><strong>Repair &amp; prove</strong><p class="muted small">Unfinished work is replanned, every constraint re-validated, every change explained.</p></div></div>
      </section>
      </div>
      <div class="home-side">
        <section class="preview card" id="home-preview" aria-label="Live timeline preview">${renderHomePreview(sel, preview, home.tab)}</section>
        <section class="constraints-card card" aria-labelledby="setup-title">${renderSetupForm(sel, home)}</section>
      </div>
    </div>
  </div>`;
}

export function renderHomePreview(scenario, preview, tab) {
  let body;
  if (tab === 'tasks') body = renderTaskTable(scenario);
  else if (preview.ok) {
    const p = preview.plan;
    const end = Math.ceil((Math.max(preview.state.scenario.deadlineMin, p.endMin) + 10) / 30) * 30;
    const axis = { start: preview.state.scenario.startMin, end, span: end - preview.state.scenario.startMin };
    body = renderTimeline({ state: preview.state, plan: p, axis, nowMin: preview.state.scenario.startMin, compact: true, id: 'tl-preview', rowH: preview.rowH, label: 'Live preview timeline' });
  } else {
    body = '<div class="empty">No feasible baseline for these constraints — the reasons are listed on the left.</div>';
  }
  return `
    <div class="card-head">
      <h2>${icon('workspace', 16)} Live preview</h2>
      <div class="seg" role="group" aria-label="Preview view">
        <button class="seg-btn" data-action="home-tab" data-tab="timeline" aria-pressed="${tab !== 'tasks'}">Timeline</button>
        <button class="seg-btn" data-action="home-tab" data-tab="tasks" aria-pressed="${tab === 'tasks'}">Tasks</button>
      </div>
    </div>
    <div class="preview-body">${body}</div>
    <div class="preview-foot muted small">${icon('info', 13)} Re-planned by the engine every time you change a constraint.</div>`;
}

function renderTaskTable(scenario) {
  const rows = scenario.tasks.map((t) => `
    <tr>
      <td>${esc(t.title)}</td>
      <td><span class="prio prio-${esc(t.priority)}">${esc(t.priority)}</span></td>
      <td class="num">${t.durationMin}m${t.compressible && t.minDurationMin < t.durationMin ? `<small> · min ${t.minDurationMin}</small>` : ''}</td>
      <td class="num">$${t.cost}</td>
      <td>${esc([...t.resources.map((r) => resourceName(scenario, r)), t.eligiblePeople.length ? '' : 'hands-free'].filter(Boolean).join(', ') || '—')}</td>
      <td class="small muted">${esc([...t.dependsOn, ...(t.softDependsOn || [])].map((d) => scenario.tasks.find((x) => x.id === d)?.title).join(', ') || '—')}</td>
      <td>${t.alternatives.length ? esc(t.alternatives.map((a) => scenario.alternatives.find((x) => x.id === a)?.title).join(', ')) : '—'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="tasks">
      <thead><tr><th>Task</th><th>Priority</th><th class="num">Duration</th><th class="num">Cost</th><th>Needs</th><th>After</th><th>Listed fallback</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function renderSetupForm(scenario, home) {
  const form = home.form;
  const clock = (m) => formatClock(scenario, m);
  const toggle = (id, field, dataId, on, title, sub) => `
    <label class="switch-row" for="${id}">
      <span><span class="sw-title">${esc(title)}</span><span class="sw-sub">${esc(sub)}</span></span>
      <input type="checkbox" class="switch" id="${id}" data-field="${field}" data-id="${esc(dataId)}" ${on ? 'checked' : ''}>
    </label>`;
  return `
    <div class="card-head"><h2 id="setup-title">${icon('settings', 16)} Constraints</h2></div>
    <form data-form="setup" id="setup-form" class="setup-form">
      <label class="field">
        <span class="field-row"><span class="kpi-label">Deadline</span><output data-out="deadline">${esc(clock(form.deadlineMin))}</output></span>
        <input type="range" id="f-deadline" min="60" max="480" step="15" value="${form.deadlineMin}" data-field="deadline" aria-describedby="deadline-help">
        <small id="deadline-help" class="muted" data-out="window">Start ${esc(clock(scenario.startMin))} · window ${esc(formatDuration(form.deadlineMin - scenario.startMin))}</small>
      </label>
      <label class="field">
        <span class="field-row"><span class="kpi-label">Budget cap</span></span>
        <span class="money"><span aria-hidden="true">$</span><input type="number" id="f-budget" min="0" max="1000" step="5" value="${form.budgetCap}" data-field="budget" inputmode="numeric" aria-label="Budget cap in dollars"></span>
      </label>
      <div class="switch-group">
        <div class="kpi-label">Who is helping</div>
        ${scenario.people.map((p) => toggle(`pp-${p.id}`, 'person', p.id, form.people[p.id] !== false, p.name, `available from ${clock(p.availableFrom)}`)).join('')}
      </div>
      <div class="switch-group">
        <div class="kpi-label">Equipment</div>
        ${scenario.resources.map((r) => toggle(`rr-${r.id}`, 'resource', r.id, form.resources[r.id] !== false, r.name, `capacity ${r.capacity}`)).join('')}
      </div>
      ${home.error ? `<div class="alert alert-bad" role="alert"><strong>No feasible baseline.</strong> ${esc(home.error)}</div>` : ''}
    </form>`;
}

/* ---------- Workspace ---------- */

export function renderWorkspace(ctx) {
  const { session, head, prev, ui } = ctx;
  const s = head.state.scenario;
  const p = head.plan;
  const pp = prev?.plan;
  const avg = (plan) => Math.round(plan.utilization.filter((u) => u.windowMin > 0).reduce((a, u) => a + u.pct, 0) / Math.max(1, plan.utilization.filter((u) => u.windowMin > 0).length));
  const committedPct = Math.min(100, (p.committedCost / Math.max(1, s.budgetCap)) * 100);
  const totalPct = Math.min(100, (p.totalCost / Math.max(1, s.budgetCap)) * 100);
  const flash = (cond) => (ctx.animate && cond ? 'flash' : '');
  const kpis = `
  <section class="kpis" aria-label="Plan summary">
    ${kpiCard({ label: 'Deterministic state', iconName: 'shield', tone: 'kpi-ok', value: `${icon('check', 18)} Feasible`, sub: `${p.validation.checks} independent checks · 0 violations` })}
    <div class="${flash(pp && p.endMin !== pp.endMin)}">${kpiCard({ label: `Finish · ${s.deadlineLabel}`, iconName: 'flag', value: `${esc(formatClock(s, p.endMin))} ${pp ? delta(p.endMin - pp.endMin, 'min', true) : ''}`, sub: `deadline ${esc(formatClock(s, s.deadlineMin))} · ${esc(formatDuration(p.slackMin))} slack` })}</div>
    <div class="${flash(pp && p.totalCost !== pp.totalCost)}">${kpiCard({
    label: 'Budget', iconName: 'money', value: `$${p.totalCost} <small>/ $${s.budgetCap}</small> ${pp ? delta(p.totalCost - pp.totalCost, '$', true) : ''}`,
    extra: `<div class="meter" role="img" aria-label="Committed $${p.committedCost}, planned $${p.totalCost - p.committedCost}, budget $${s.budgetCap}"><span class="meter-committed" style="width:${committedPct}%"></span><span class="meter-planned" style="width:${Math.max(0, totalPct - committedPct)}%"></span></div>`,
    sub: `$${p.committedCost} committed · $${p.totalCost - p.committedCost} planned`,
  })}</div>
    <div class="${flash(pp && avg(p) !== avg(pp))}">${kpiCard({ label: 'Utilization', iconName: 'people', value: `${avg(p)}% ${pp ? delta(avg(p) - avg(pp), '%') : ''}`, sub: p.utilization.map((u) => `${esc(personName(s, u.personId))} ${u.pct}%`).join(' · ') })}</div>
    ${kpiCard({ label: 'Excluded', iconName: 'layers', value: p.dropped.length ? String(p.dropped.length) : 'None', sub: p.dropped.map((d) => `${esc(d.title)} (${d.cause === 'user' ? 'skipped by you' : 'optional'})`).join(' · ') || 'Every task is scheduled' })}
  </section>`;
  const title = prev ? `Plan B · ${head.id}` : 'Original plan';
  return `
  <div class="view view-workspace workspace" id="main">
    ${ui.notice ? `<div class="notice" role="status">${esc(ui.notice)}</div>` : ''}
    ${kpis}
    ${ui.proposal ? renderCrisis(ui.proposal, s) : ''}
    ${!ui.proposal && ui.bannerRevisionId === head.id ? renderRecoveryBanner(head) : ''}
    <div class="toolbar-row">
      <div class="seg" role="group" aria-label="View">
        <button class="seg-btn" aria-pressed="true">${prev ? 'Plan B' : 'Plan'}</button>
        <button class="seg-btn" data-action="nav" data-view="compare" aria-pressed="false" ${prev ? '' : 'disabled title="Available after the first change"'}>Before / After</button>
      </div>
      <span class="viewport mono">${icon('clock', 14)} Timeline viewport: ${esc(formatClock(s, ctx.axis.start))} → ${esc(formatClock(s, ctx.axis.end))} (${ctx.axis.span} min)</span>
      <span class="toolbar-spacer"></span>
      ${prev ? `<label class="check-inline"><input type="checkbox" data-action="toggle-ghosts" ${ui.prefs.ghosts ? 'checked' : ''}> Previous positions</label>` : ''}
      <div class="clock-ctrl" role="group" aria-label="Simulation clock"><span class="mono small muted">Clock</span>
        <button class="btn btn-sm" data-action="advance" data-min="10">+10 min</button><button class="btn btn-sm" data-action="advance" data-min="30">+30 min</button></div>
      <button class="btn btn-sm" data-action="nav" data-view="assistant">${icon('sparkle', 14)}<span>Assistant</span></button>
    </div>
    <div class="ws-grid">
      <section class="canvas card ${ui.status === 'planning' ? 'is-replanning' : ''}" aria-labelledby="canvas-title">
        <div class="card-head canvas-head">
          <div class="canvas-title"><h2 id="canvas-title">${icon('workspace', 17)} ${esc(title)}</h2><span class="muted small ellipsis">${esc(prev ? `after: ${head.label}` : 'validated baseline')}</span></div>
          <span class="canvas-status mono small"><span class="dot dot-ok"></span>Validated · ${p.validation.checks} checks · strict ordering</span>
        </div>
        <div class="canvas-body">${renderTimeline({
    state: head.state, plan: head.plan, prevPlan: prev?.plan, prevState: prev?.state, axis: ctx.axis, nowMin: session.nowMin, atMin: head.atMin,
    selectedTaskId: ui.selectedTaskId, changed: ctx.changed, ghosts: ui.prefs.ghosts && Boolean(prev), animate: ctx.animate, rowH: ui.rowH, id: 'tl-main', label: title,
  })}</div>
        <div class="canvas-foot">
          <span class="legend" aria-hidden="true"><span class="lg lg-done">done</span><span class="lg lg-prog">in progress</span><span class="lg lg-alt">alternative</span><span class="lg lg-chg">changed</span>${prev ? '<span class="lg lg-ghost">previous position</span>' : ''}</span>
          <span class="muted small">Select a bar to inspect it.</span>
        </div>
        <div class="replan-veil" aria-hidden="true"><span>${icon('repair', 16)} Replanning…</span></div>
      </section>
      ${renderRightPanel(ctx)}
    </div>
  </div>`;
}

function renderRightPanel(ctx) {
  return `
  <aside class="rpanel card" aria-labelledby="ins-title">
    <div class="card-head"><h2 id="ins-title">${icon('search', 16)} Task inspector</h2>${ctx.ui.selectedTaskId ? '<span class="tag tag-primary">Selected</span>' : '<span class="tag">Read-only</span>'}</div>
    <div class="rp-body">${renderInspector(ctx)}</div>
  </aside>`;
}

/** Assistant & Copilot screen (Stitch screen 07 layout): conversation left, live context right. */
export function renderAssistantView(ctx) {
  const { session, head, ui, parser } = ctx;
  const s = head.state.scenario;
  const p = head.plan;
  const lastTrace = [...session.conversation].reverse().find((m) => m.role === 'assistant' && m.trace)?.trace || [];
  const understood = ui.pending?.preview?.ok
    ? ui.pending.preview.descriptions
    : (lastTrace.find((t) => t.step === 'Constraints changed')?.detail.split(' — ')[0].split('; ') || []);
  return `
  <div class="view view-assistant" id="main">
    ${pageHead({
    eyebrow: `Active context · ${esc(s.name)} · ${esc(head.id)}`,
    title: 'Assistant & copilot',
    sub: 'Describe what changed. PlanB shows what it understood and a dry-run impact before anything is replanned.',
    actions: `<button class="btn btn-quiet" data-action="nav" data-view="workspace">${icon('workspace', 15)}<span>Open timeline</span></button>`,
  })}
    <div class="assistant-grid">
      <section class="card chat-card" aria-label="Conversation">${renderAssistant(ctx)}</section>
      <div class="assistant-side">
        <section class="card" aria-labelledby="und-title">
          <div class="card-head"><h2 id="und-title">${icon('list', 16)} ${ui.pending ? 'Pending change' : 'Last understood change'}</h2>${ui.pending ? '<span class="tag tag-warn">Awaiting review</span>' : ''}</div>
          ${understood.length ? `<ul class="cc-list">${understood.map((d) => `<li>${icon('check', 13)} ${esc(d)}</li>`).join('')}</ul>` : '<div class="empty small">Nothing yet — try a quick command below the conversation.</div>'}
        </section>
        <section class="card" aria-labelledby="ps-title">
          <div class="card-head"><h2 id="ps-title">${icon('shield', 16)} Plan status</h2><span class="tag tag-ok">${icon('check', 12)} Feasible</span></div>
          <div class="status-list">
            <div><span class="muted">Validator</span><strong>${p.validation.checks} checks · 0 violations</strong></div>
            <div><span class="muted">Finishes</span><strong>${esc(formatClock(s, p.endMin))} · ${esc(formatDuration(p.slackMin))} slack</strong></div>
            <div><span class="muted">Budget</span><strong>$${p.totalCost} / $${s.budgetCap}</strong></div>
            <div><span class="muted">Clock</span><strong>${esc(formatClock(s, session.nowMin))} · ${Object.keys(head.state.committed).length} task(s) started or done</strong></div>
          </div>
        </section>
        <section class="card" aria-labelledby="lu-title">
          <div class="card-head"><h2 id="lu-title">${icon('chat', 16)} Language understanding</h2>${parserPill(parser, true)}</div>
          <p class="muted small">${parser.mode === 'llm' ? `Requests go to ${esc(parser.model)} on the local server; the output is re-validated against the allowlisted shock schema.` : 'A limited, deterministic rule parser reads requests in this browser. It is not a language model; unsupported phrasing is reported, never guessed.'}</p>
        </section>
      </div>
    </div>
  </div>`;
}

export function renderRecoveryBanner(head) {
  if (!head.diff) return '';
  const s = head.state.scenario;
  const n = head.diff.changed.length;
  return `
  <div class="recovery" role="status">
    <span class="recovery-icon" aria-hidden="true">${icon('check', 18)}</span>
    <div class="recovery-text">
      <strong>Plan B ready — ${esc(head.id)}</strong>
      <span>${n} task${n === 1 ? '' : 's'} changed · validated ${head.plan.validation.checks} checks · finishes ${esc(formatClock(s, head.plan.endMin))} (${esc(formatDuration(head.plan.slackMin))} slack) · $${head.plan.totalCost} / $${s.budgetCap}</span>
    </div>
    <div class="recovery-actions">
      <button class="btn btn-sm" data-action="nav" data-view="compare">${icon('compare', 14)}<span>See before / after</span></button>
      <button class="btn btn-sm" data-action="nav" data-view="repair">${icon('repair', 14)}<span>Repair stages</span></button>
      <button class="btn btn-quiet btn-icon" data-action="dismiss-banner" aria-label="Dismiss">${icon('x', 14)}</button>
    </div>
  </div>`;
}

export function renderCrisis(proposal, scenario) {
  const violations = proposal.plan.violations.map((v) => `
    <li><span class="proof proof-${esc(v.proof)}">${v.proof === 'proven' ? 'Proven bound' : v.proof === 'search' ? 'Bounded search' : 'Validator'}</span>
      <code>${esc(v.code)}</code> ${esc(v.message)}</li>`).join('');
  const options = proposal.options.map((o, i) => `
    <li class="option">
      <div><strong>${esc(o.label)}</strong><div class="muted small">Re-planned and validated: ${esc(o.detail)}</div></div>
      <button class="btn btn-primary" data-action="apply-option" data-index="${i}">Apply</button>
    </li>`).join('');
  return `
  <section class="crisis" role="alertdialog" aria-labelledby="crisis-title" tabindex="-1" id="infeasible">
    <div class="crisis-head">
      <span class="crisis-icon" aria-hidden="true">${icon('alert', 18)}</span>
      <div><h2 id="crisis-title">No feasible plan — nothing was changed</h2>
        <p class="muted small">Requested: <strong>${esc(proposal.descriptions.join(' + '))}</strong> at ${esc(formatClock(scenario, proposal.atMin))}. Your constraints are untouched until you choose.</p></div>
      <button class="btn btn-quiet" data-action="dismiss-proposal">Keep current plan ${icon('x', 14)}</button>
    </div>
    <div class="crisis-grid">
      <div><div class="kpi-label">Hard constraints that cannot all hold</div><ul class="violations">${violations}</ul></div>
      <div><div class="kpi-label">Options the planner verified</div>${proposal.options.length ? `<ul class="options">${options}</ul>` : '<p class="muted small">No single relaxation restores feasibility. Undo or restore instead.</p>'}</div>
    </div>
  </section>`;
}

/* ---------- Assistant ---------- */

function messageActions(m, session) {
  if (m.role !== 'assistant' || !m.trace) return '';
  const steps = m.trace.map((t) => t.step);
  if (steps.includes('Plan committed')) {
    return `<div class="msg-actions">
      <button class="chip chip-act" data-action="nav" data-view="compare">${icon('compare', 13)} Before / after</button>
      <button class="chip chip-act" data-action="nav" data-view="repair">${icon('repair', 13)} Repair stages</button>
      ${session.revisions.length > 1 ? `<button class="chip chip-act" data-action="undo">${icon('undo', 13)} Undo</button>` : ''}</div>`;
  }
  if (steps.includes('Nothing committed')) {
    return `<div class="msg-actions"><button class="chip chip-act" data-action="nav" data-view="repair">${icon('repair', 13)} See why</button></div>`;
  }
  return '';
}

export function renderConfirmCard(pending, { inModal = false } = {}) {
  const pv = pending.preview;
  if (!pv?.ok) {
    return `<div class="confirm-card is-bad" role="group" aria-label="Change could not be applied">
      <div class="cc-head">${icon('alert', 16)}<strong>I can't apply that</strong></div>
      <ul class="cc-list">${(pv?.errors || ['No supported change was found']).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      <div class="cc-actions"><button class="btn btn-quiet" data-action="cancel-change">Dismiss</button></div></div>`;
  }
  const s0 = pending.before;
  const s1 = pv.state.scenario;
  const clock = (m) => formatClock(s1, m);
  const deltas = [];
  if (s1.deadlineMin !== s0.deadlineMin) deltas.push(['Deadline', clock(s0.deadlineMin), clock(s1.deadlineMin)]);
  if (s1.budgetCap !== s0.budgetCap) deltas.push(['Budget', `$${s0.budgetCap}`, `$${s1.budgetCap}`]);
  for (const p of s1.people) {
    const o = s0.people.find((x) => x.id === p.id);
    if (o && (o.availableFrom !== p.availableFrom || o.availableTo !== p.availableTo)) {
      const fmt = (x) => (x.availableTo <= x.availableFrom ? 'not available' : `${clock(x.availableFrom)}–${x.availableTo >= s1.deadlineMin + 60 ? 'end' : clock(x.availableTo)}`);
      deltas.push([p.name, fmt(o), fmt(p)]);
    }
  }
  for (const r of s1.resources) {
    const o = s0.resources.find((x) => x.id === r.id);
    if (o && o.available !== r.available) deltas.push([r.name, o.available ? 'available' : 'down', r.available ? 'available' : 'down']);
  }
  for (const t of s1.tasks) {
    const o = s0.tasks.find((x) => x.id === t.id);
    if (o && o.durationMin !== t.durationMin) deltas.push([t.title, `${o.durationMin} min`, `${t.durationMin} min`]);
    if (o && o.status !== t.status && t.status === 'dropped') deltas.push([t.title, 'planned', 'skipped']);
  }
  const head = pending.headPlan;
  const impact = pv.feasible
    ? `<div class="cc-impact ok">${icon('check', 15)}<span><strong>Feasible.</strong> ${pv.diff.changed.length} task${pv.diff.changed.length === 1 ? '' : 's'} change · finish ${esc(formatClock(s1, head.endMin))} → <strong>${esc(clock(pv.plan.endMin))}</strong> · $${head.totalCost} → <strong>$${pv.plan.totalCost}</strong> · ${pv.plan.validation.checks} checks pass</span></div>`
    : `<div class="cc-impact bad">${icon('alert', 15)}<span><strong>No feasible plan.</strong> ${esc(pv.plan.violations[0]?.message || '')}${pv.options.length ? ` · ${pv.options.length} verified option${pv.options.length === 1 ? '' : 's'} available` : ''}</span></div>`;
  return `
  <div class="confirm-card" role="group" aria-label="Review this change" ${inModal ? '' : 'id="confirm-card"'}>
    <div class="cc-head">${icon('sparkle', 16)}<strong>Review before I replan</strong><span class="tag">${esc(pending.parsed.parser === 'llm' ? 'LLM + schema check' : pending.parsed.parser === 'form' ? 'structured form' : 'local rule parser')}</span></div>
    <div class="kpi-label">I understood</div>
    <ul class="cc-list">${pv.descriptions.map((d) => `<li>${icon('check', 13)} ${esc(d)}</li>`).join('')}</ul>
    ${deltas.length ? `<div class="kpi-label">Constraint changes</div><table class="cc-deltas">${deltas.map(([k, a, b]) => `<tr><th>${esc(k)}</th><td class="was">${esc(a)}</td><td>${icon('arrow', 12)}</td><td class="now">${esc(b)}</td></tr>`).join('')}</table>` : ''}
    <div class="kpi-label">Predicted impact (dry run, nothing saved yet)</div>
    ${impact}
    <div class="cc-actions">
      <button class="btn btn-quiet" data-action="cancel-change">Cancel</button>
      ${inModal ? '<button class="btn btn-ghost" data-action="modal-back">Edit</button>' : ''}
      <button class="btn btn-primary" data-action="confirm-change">${icon('repair', 15)}<span>${pv.feasible ? 'Apply & replan' : 'Record & show options'}</span></button>
    </div>
  </div>`;
}

function renderAssistant(ctx) {
  const { session, scenario, ui } = ctx;
  const recent = session.conversation.slice(-24);
  const lastAssistant = recent.map((m) => m.role).lastIndexOf('assistant');
  const traceHtml = (m, open) => (m.trace?.length ? `
      <details class="trace-wrap" ${open ? 'open' : ''}>
        <summary>Agent steps (${m.trace.length})</summary>
        <ol class="trace">${m.trace.map((t) => `<li class="tr tr-${esc(t.status)}"><span class="tr-step">${esc(t.step)}</span><span class="tr-detail">${esc(t.detail)}</span></li>`).join('')}</ol>
      </details>` : '');
  const msgs = recent.map((m, i) => `
    <li class="msg msg-${m.role} ${m.tone ? `tone-${m.tone}` : ''}">
      ${m.role === 'assistant' ? `<span class="msg-avatar">${logoSvg(22, `m${i}`)}</span>` : ''}
      <div class="msg-bubble">
        <div class="msg-who">${m.role === 'user' ? `You${m.source && m.source !== 'typed' ? ` · ${esc(m.source)}` : ''}` : 'PlanB'}</div>
        <div class="msg-text">${esc(m.text)}</div>${traceHtml(m, i === lastAssistant)}${messageActions(m, session)}
      </div>
    </li>`).join('');
  const intro = `<li class="msg msg-assistant"><span class="msg-avatar">${logoSvg(22, 'intro')}</span><div class="msg-bubble"><div class="msg-who">PlanB</div><div class="msg-text">Your ${esc(scenario.name.toLowerCase())} plan is ready and validated. Tell me what changed — in your own words — and I'll show you what I understood before replanning.</div></div></li>`;
  const pending = ui.pending && ui.pending.origin === 'chat' ? `<li class="msg msg-assistant msg-pending"><span class="msg-avatar">${logoSvg(22, 'pend')}</span><div class="msg-bubble">${renderConfirmCard(ui.pending)}</div></li>` : '';
  const chips = scenario.quickCommands.map((q) => `<button class="chip" data-action="quick" data-text="${esc(q.text)}" title="${esc(q.text)}">${esc(q.label)}</button>`).join('');
  const busy = ui.status === 'parsing' || ui.status === 'planning';
  return `
  <div class="assistant">
    <div class="as-head">
      <div class="orb orb-${esc(ui.status)}" aria-hidden="true"><span>${logoSvg(24, 'orb')}</span></div>
      <div><div class="as-title">PlanB assistant</div><div class="as-status" role="status" aria-live="polite">${esc(STATUS_LABEL[ui.status] || ui.status)}</div></div>
    </div>
    <ol class="conversation" aria-live="polite" aria-relevant="additions">${intro}${msgs}${pending}</ol>
    <div class="as-foot">
      <div class="chips" role="group" aria-label="Quick commands">${chips}</div>
      <form class="composer" data-form="command">
        <label for="cmd" class="sr-only">Tell PlanB what changed</label>
        <input id="cmd" name="cmd" autocomplete="off" maxlength="500" placeholder="Tell PlanB what changed…" value="${esc(ui.draft || '')}" ${busy || ui.pending ? 'disabled' : ''}>
        <button class="btn btn-primary btn-icon-text" type="submit" ${busy || ui.pending ? 'disabled' : ''}>${icon('arrow', 15)}<span>${busy ? 'Working' : 'Send'}</span></button>
      </form>
      <div class="as-note muted">${ctx.parser.mode === 'llm' ? 'LLM output is re-validated against the shock schema before planning.' : 'Read by a limited local rule parser (not an LLM). Unsupported phrasing is reported, never guessed.'} Press <kbd>/</kbd> to type.</div>
    </div>
  </div>`;
}

/* ---------- Task Inspector (read-only) ---------- */

function renderInspector(ctx) {
  const { head, session, ui } = ctx;
  const s = head.state.scenario;
  const clock = (m) => formatClock(s, m);
  const task = s.tasks.find((t) => t.id === ui.selectedTaskId);
  if (!task) {
    const quick = ctx.scenario.quickCommands.filter((q) => !/^(undo|advance|can we|are we|will we)/i.test(q.text) && !/\?$/.test(q.text));
    const changedList = head.diff?.changed.length ? `
      <div class="ins-changes"><div class="kpi-label">Changed in ${esc(head.id)} · ${head.diff.changed.length} of ${head.diff.entries.length} tasks</div>
        <ul class="ins-change-list">${head.diff.changed.map((e) => `<li><button class="ins-chg" data-action="select-task" data-task="${esc(e.taskId)}">
          <span class="ins-ch-title">${esc(e.title)}</span><span class="kind ${KIND_CLASS[e.kind]}">${esc(e.kind)}${e.deltaMinutes ? ` ${esc(formatSigned(e.deltaMinutes))}` : ''}</span></button></li>`).join('')}</ul></div>` : '';
    return `<div class="empty ${changedList ? 'empty-tight' : ''}">${icon('search', 30)}<p>Select a task on the timeline to inspect it.</p><p class="muted small">Read-only: what the planner decided, and why.</p></div>
      ${changedList}
      <div class="ins-quick"><div class="kpi-label">Simulate a change</div>
        <div class="chips">${quick.map((q) => `<button class="chip" data-action="quick-review" data-text="${esc(q.text)}">${icon('bolt', 12)} ${esc(q.label)}</button>`).join('')}</div></div>`;
  }
  const st = head.plan.scheduled.find((x) => x.taskId === task.id);
  const dropped = head.plan.dropped.find((d) => d.taskId === task.id);
  const entry = head.diff?.entries.find((e) => e.taskId === task.id);
  const dependents = s.tasks.filter((t) => t.dependsOn.includes(task.id) || (t.softDependsOn || []).includes(task.id));
  const alts = task.alternatives.map((a) => s.alternatives.find((x) => x.id === a)).filter(Boolean);
  const cell = (label, value) => `<div class="ins-cell"><span class="kpi-label">${esc(label)}</span><strong>${value}</strong></div>`;
  return `
  <div class="inspector">
    <div class="ins-head">
      <span class="tag mono">${esc(task.id)}</span><span class="prio prio-${esc(task.priority)}">${esc(task.priority)}</span>
      ${st ? `<span class="tag">${esc(liveStatus(st, session.nowMin).replace('_', ' '))}</span>` : `<span class="tag tag-bad">${dropped?.cause === 'user' ? 'skipped by you' : 'dropped'}</span>`}
      <button class="btn btn-quiet btn-icon" data-action="select-task" data-task="${esc(task.id)}" aria-label="Clear selection">${icon('x', 14)}</button>
    </div>
    <h3 class="ins-title">${esc(st?.title || task.title)}</h3>
    ${st && st.variantId !== 'base' ? `<p class="muted small">Listed alternative for “${esc(task.title)}”.</p>` : ''}
    ${st ? `<div class="ins-grid">
      ${cell('Assigned', `${avatar(s, st.personId, 20)} ${esc(personName(s, st.personId))}`)}
      ${cell('Window', esc(formatWindow(s, st.startMin, st.endMin)))}
      ${cell('Duration', `${st.durationMin} min${st.durationMin < st.fullDurationMin ? ` <small class="muted">(of ${st.fullDurationMin})</small>` : ''}`)}
      ${cell('Cost', `$${st.actualCost}`)}
    </div>` : ''}
    <div class="ins-block"><div class="kpi-label">Equipment</div><p>${st && st.resources.length ? st.resources.map((r) => `${icon('box', 13)} ${esc(resourceName(s, r))} <span class="muted">×${s.resources.find((x) => x.id === r)?.capacity}</span>`).join(' · ') : '<span class="muted">none</span>'}</p></div>
    <div class="ins-block"><div class="kpi-label">Depends on</div><p>${[...task.dependsOn, ...(task.softDependsOn || [])].map((d) => esc(s.tasks.find((t) => t.id === d)?.title)).join(', ') || '<span class="muted">nothing</span>'}</p></div>
    <div class="ins-block"><div class="kpi-label">Needed before</div><p>${dependents.map((t) => esc(t.title)).join(', ') || '<span class="muted">nothing</span>'}</p></div>
    <div class="ins-block"><div class="kpi-label">Listed fallbacks</div><p>${alts.length ? alts.map((a) => `${esc(a.title)} <span class="muted">(${a.durationMin}m, $${a.cost})</span>`).join(' · ') : '<span class="muted">none</span>'}</p></div>
    ${entry && entry.kind !== 'Unchanged' ? `
    <div class="ins-block ins-change"><div class="kpi-label">Changed in ${esc(head.id)}</div>
      <p><span class="kind ${KIND_CLASS[entry.kind]}">${esc(entry.kind)}</span> ${entry.before && entry.after ? `${esc(formatWindow(s, entry.before.startMin, entry.before.endMin))} → <strong>${esc(formatWindow(s, entry.after.startMin, entry.after.endMin))}</strong>` : ''}</p>
      <ul class="reasons">${reasonBadges(entry.reasons)}</ul></div>` : ''}
  </div>`;
}

/* ---------- Repair workflow ---------- */

const STAGES = [
  { step: 'Intent detected', title: 'Disruption intake', icon: 'chat' },
  { step: 'Constraints changed', title: 'Constraint update', icon: 'lock', alt: ['Constraints checked'] },
  { step: 'Scheduling performed', title: 'Scheduling search', icon: 'workspace' },
  { step: 'Validation passed', title: 'Independent validation', icon: 'shield', alt: ['Validation failed'] },
  { step: 'Differences explained', title: 'Change explanation', icon: 'list', alt: ['Options verified'] },
  { step: 'Plan committed', title: 'Commit', icon: 'check', alt: ['Nothing committed'] },
];

/** Headline figure for a stage, read from the numbers the agent wrote into that trace step. */
const plural = (n, word) => `${word}${n === '1' ? '' : 's'}`;
const STAGE_METRIC = {
  'Intent detected': (d) => { const n = String((d.split(' — ')[1] || '').split(' + ').filter(Boolean).length); return n !== '0' ? [n, `${plural(n, 'change')} understood`] : null; },
  'Option confirmed by you': () => ['1', 'option chosen by you'],
  'Constraints changed': (d) => { const n = String(d.split(' — ')[0].split('; ').filter(Boolean).length); const f = d.match(/(\d+) started\/done/); return [n, `${plural(n, 'constraint')} updated${f ? ` · ${f[1]} frozen` : ''}`]; },
  'Constraints checked': () => ['0', 'changes accepted'],
  'Scheduling performed': (d) => { const m = d.match(/^([\d,]+) configuration/); const ms = d.match(/in ([\d.]+) ms/); return m ? [m[1], `${plural(m[1], 'configuration')} · ${ms ? ms[1] : '?'} ms`] : null; },
  'Validation passed': (d) => { const m = d.match(/(\d+) independent checks, (\d+) violations/); return m ? [m[1], `checks · ${m[2]} violations`] : null; },
  'Validation failed': (d) => { const n = String(d.split(', ').filter(Boolean).length); return [n, `${plural(n, 'violation')} found`]; },
  'Differences explained': (d) => { const m = d.match(/^(\d+) changed/); const u = d.match(/(\d+) unchanged/); return m ? [m[1], `changed · ${u ? u[1] : 0} unchanged`] : null; },
  'Options verified': (d) => { const m = d.match(/^(\d+) option/); const n = m ? m[1] : '0'; return [n, `verified ${plural(n, 'option')}`]; },
  'Plan committed': (d) => { const m = d.match(/Revision (r\d+)/); return m ? [m[1], 'saved · undo available'] : null; },
  'Nothing committed': (d) => { const m = d.match(/at (r\d+)/); return m ? [m[1], 'kept until you choose'] : null; },
};

/** Duration, cost and equipment differences for one change, read from the diff snapshots. */
function changeFacts(e, s) {
  if (!e.before || !e.after) return '';
  const out = [];
  if (e.before.durationMin !== e.after.durationMin) out.push(`<span>${e.before.durationMin} min ${icon('arrow', 11)} <strong>${e.after.durationMin} min</strong></span>`);
  if (e.before.cost !== e.after.cost) out.push(`<span>$${e.before.cost} ${icon('arrow', 11)} <strong>$${e.after.cost}</strong></span>`);
  const eq = (list) => (list && list.length ? list.map((r) => resourceName(s, r)).join(', ') : 'no equipment');
  if (eq(e.before.resources) !== eq(e.after.resources)) out.push(`<span>${esc(eq(e.before.resources))} ${icon('arrow', 11)} <strong>${esc(eq(e.after.resources))}</strong></span>`);
  return out.join('');
}

/** Before/after position of one task on a shared axis (dashed = before, solid = after). */
function mapTrack(e, axis) {
  const bx = (st) => `left:${((st.startMin - axis.start) / axis.span) * 100}%;width:${((st.endMin - st.startMin) / axis.span) * 100}%`;
  return `<div class="map-track" aria-hidden="true">
        ${e.before ? `<span class="mt-bar mt-before" style="${bx(e.before)}"></span>` : ''}
        ${e.after ? `<span class="mt-bar mt-after ${KIND_CLASS[e.kind]}" style="${bx(e.after)}"></span>` : ''}
      </div>`;
}

export function renderRepair(ctx) {
  const { session, head, ui } = ctx;
  const s = head.state.scenario;
  const clock = (m) => formatClock(s, m);
  const msgs = session.conversation.filter((m) => m.role === 'assistant' && m.trace?.some((t) => t.step === 'Constraints changed' || t.step === 'Constraints checked' || t.step === 'Option confirmed by you'));
  const last = msgs[msgs.length - 1];
  const userMsg = last ? session.conversation[session.conversation.lastIndexOf(last) - 1] : null;
  const committed = Boolean(last?.trace.some((t) => t.step === 'Plan committed'));
  const find = (stage) => last?.trace.find((t) => t.step === stage.step || (stage.alt || []).includes(t.step) || (stage.step === 'Intent detected' && t.step === 'Option confirmed by you'));
  const found = STAGES.map(find);
  const cards = STAGES.map((stage, i) => {
    const t = found[i];
    const status = !t ? 'idle' : t.status === 'ok' ? 'ok' : t.status === 'skipped' ? 'skipped' : t.status === 'warn' ? 'warn' : 'fail';
    const label = { ok: 'Complete', warn: 'Attention', fail: 'Failed', skipped: 'Skipped', idle: 'Not reached' }[status];
    const metric = t ? STAGE_METRIC[t.step]?.(t.detail) : null;
    return `
    <li class="stage stage-${status}" style="--i:${i}">
      <div class="stage-top"><span class="stage-node" aria-hidden="true">${status === 'ok' ? icon('check', 12) : status === 'fail' ? icon('x', 12) : status === 'warn' ? icon('alert', 12) : String(i + 1)}</span><span class="stage-no mono">Stage ${String(i + 1).padStart(2, '0')}</span><span class="stage-status">${label}</span></div>
      <div class="stage-title">${icon(stage.icon, 18)}<strong>${esc(t?.step === 'Option confirmed by you' ? 'Option confirmed' : t?.step && t.step !== stage.step ? t.step : stage.title)}</strong></div>
      ${metric ? `<div class="stage-metric"><strong class="mono">${esc(metric[0])}</strong><span>${esc(metric[1])}</span></div>` : ''}
      <p class="stage-detail" title="${t ? esc(t.detail) : ''}">${t ? esc(t.detail) : '—'}</p>
    </li>`;
  }).join('');
  const done = found.filter((t) => t && t.status === 'ok').length;

  const prev = head.index > 0 ? session.revisions[head.index - 1] : null;
  const axis = prev ? { start: s.startMin, end: Math.max(s.deadlineMin, prev.state.scenario.deadlineMin, head.plan.endMin, prev.plan.endMin) } : null;
  if (axis) axis.span = Math.max(1, axis.end - axis.start);
  const changes = head.diff && committed ? head.diff.changed.map((e, i) => `
    <li class="ledger-row ${ui.selectedTaskId === e.taskId ? 'is-selected' : ''}" data-action="select-task" data-task="${esc(e.taskId)}">
      <div class="lr-top">
        <span class="tag mono">T-${String(i + 1).padStart(2, '0')}</span>
        <strong class="lr-title">${e.kind === 'Replaced' ? `<span class="was">${esc(e.beforeTitle)}</span> → ` : ''}${esc(e.title)}</strong>
        <span class="kind ${KIND_CLASS[e.kind]}">${esc(e.kind)}${e.deltaMinutes ? ` ${esc(formatSigned(e.deltaMinutes))}` : ''}</span>
      </div>
      ${axis ? mapTrack(e, axis) : ''}
      <div class="lr-facts small">
        <span>${e.before ? esc(formatWindow(s, e.before.startMin, e.before.endMin)) : '—'} ${icon('arrow', 11)} <strong>${e.after ? esc(formatWindow(s, e.after.startMin, e.after.endMin)) : 'removed'}</strong></span>
        ${e.before && e.after && e.before.personId !== e.after.personId ? `<span>${esc(personName(s, e.before.personId))} ${icon('arrow', 11)} <strong>${esc(personName(s, e.after.personId))}</strong></span>` : ''}
      </div>
      ${e.reasons.length ? `<ul class="reasons">${reasonBadges(e.reasons)}</ul>` : ''}
    </li>`).join('') : '';

  const row = (label, a, b, d) => `<div class="oc-row"><span class="kpi-label">${esc(label)}</span><span class="oc-val"><span class="was">${a}</span>${icon('arrow', 13)}<strong>${b}</strong>${d}</span></div>`;
  const outcome = prev && committed ? `
    <section class="card outcome" aria-labelledby="oc-title">
      <div class="card-head"><h2 id="oc-title">${icon('shield', 16)} Outcome</h2><span class="muted small">${esc(prev.id)} → ${esc(head.id)} · re-validated</span></div>
      <div class="oc-grid">
        ${row('Finish', esc(clock(prev.plan.endMin)), esc(clock(head.plan.endMin)), delta(head.plan.endMin - prev.plan.endMin, 'min', true))}
        ${row('Deadline', esc(clock(prev.state.scenario.deadlineMin)), esc(clock(s.deadlineMin)), delta(s.deadlineMin - prev.state.scenario.deadlineMin, 'min'))}
        ${row('Slack', esc(formatDuration(prev.plan.slackMin)), esc(formatDuration(head.plan.slackMin)), delta(head.plan.slackMin - prev.plan.slackMin, 'min'))}
        ${row('Cost', `$${prev.plan.totalCost}`, `$${head.plan.totalCost}`, delta(head.plan.totalCost - prev.plan.totalCost, '$', true))}
        ${row('Validator', `${prev.plan.validation.checks}`, `${head.plan.validation.checks} checks`, '<span class="tag tag-ok">0 violations</span>')}
        ${row('Scheduled', `${prev.plan.scheduled.length}`, `${head.plan.scheduled.length} tasks`, `<span class="muted small">${head.diff ? head.diff.changed.length : 0} changed</span>`)}
      </div>
    </section>` : '';

  const log = session.activity.slice(-6).reverse().map((t) => `
    <li><div class="act-in">“${esc(t.input)}” <span class="muted small">${esc(t.source)}</span></div>
      <ol class="steps">${t.steps.map((st) => `<li class="step step-${esc(st.status)}"><code>${esc(st.tool)}</code> <span>${esc(st.detail)}</span>${st.ms ? ` <span class="muted small">${st.ms} ms</span>` : ''}</li>`).join('')}</ol></li>`).join('');
  return `
  <div class="view view-repair" id="main">
    ${pageHead({
    eyebrow: `Repair pipeline · ${esc(head.id)}`,
    title: 'Repair workflow',
    sub: last ? `Latest request: <strong>“${esc(userMsg?.text || '')}”</strong>` : 'No change has been requested yet. Use <strong>Simulate disruption</strong> or tell the assistant what changed.',
    actions: `<button class="btn btn-danger" data-action="open-disruption">${icon('bolt', 16)}<span>Simulate disruption</span></button>`,
  })}
    ${ui.proposal ? renderCrisis(ui.proposal, s) : ''}
    <section class="card pipeline ${last ? '' : 'is-idle'}" aria-labelledby="pl-title">
      <div class="card-head"><h2 id="pl-title">${icon('layers', 16)} Pipeline stages</h2>
        <span class="pl-progress small">${last ? `<strong class="mono">${done}/${STAGES.length}</strong> stages complete · ` : ''}<span class="muted">recorded by the agent for the latest request — real values, not a replay</span></span></div>
      <div class="pl-rail" aria-hidden="true"><span style="width:${(done / STAGES.length) * 100}%"></span></div>
      <ol class="stages">${cards}</ol>
    </section>
    <div class="repair-grid">
      <section class="card ledger-card" aria-labelledby="ledger-title">
        <div class="card-head"><h2 id="ledger-title">${icon('list', 16)} Committed changes</h2>${head.diff && committed ? `<span class="muted small">${esc(head.id)} · ${head.diff.changed.length} changed · ${head.diff.entries.length - head.diff.changed.length} unchanged</span>` : ''}</div>
        ${changes ? `<ol class="ledger">${changes}</ol><button class="btn btn-sm" data-action="nav" data-view="compare">${icon('compare', 14)}<span>Open the before / after comparison</span></button>` : '<div class="empty small">No committed change for the latest request.</div>'}
      </section>
      <div class="repair-side">
        ${outcome}
        <section class="card log-card" aria-labelledby="log-title">
          <div class="card-head"><h2 id="log-title">${icon('workspace', 16)} Agent tool log</h2><span class="muted small">Raw tool calls with timings</span></div>
          <div class="scroll">${log ? `<ol class="act-list">${log}</ol>` : '<div class="empty small">No tool calls yet.</div>'}</div>
        </section>
      </div>
    </div>
  </div>`;
}

/* ---------- Before / After ---------- */

export function renderCompare(ctx) {
  const { session, ui } = ctx;
  const revs = session.revisions;
  const bIndex = Math.min(ui.compareB ?? revs.length - 1, revs.length - 1);
  const aIndex = Math.max(0, Math.min(ui.compareA ?? bIndex - 1, bIndex - 1));
  const A = revs[aIndex];
  const B = revs[bIndex];
  const s = B.state.scenario;
  const clock = (m) => formatClock(s, m);
  if (revs.length < 2) {
    return `<div class="view view-compare" id="main">${pageHead({ eyebrow: 'Timeline compare', title: 'Before / After', sub: 'Make a change first — then the original plan and Plan B appear side by side here.' })}
      <section class="card needs-card"><span class="needs-icon">${icon('compare', 34)}</span><h2>Nothing to compare yet</h2>
        <p class="muted">The plan has not changed since it was built.</p>
        <div class="needs-actions"><button class="btn btn-danger btn-lg" data-action="open-disruption">${icon('alert', 16)}<span>Simulate disruption</span></button></div></section></div>`;
  }
  // Diff between any two revisions: reuse the stored diff for adjacent pairs, otherwise compare snapshots.
  const entries = (bIndex - aIndex === 1 && B.diff) ? B.diff.entries : B.state.scenario.tasks.map((t) => {
    const before = A.plan.scheduled.find((x) => x.taskId === t.id);
    const after = B.plan.scheduled.find((x) => x.taskId === t.id);
    const kinds = [];
    if (before && !after) kinds.push('Removed');
    if (!before && after) kinds.push('Restored');
    if (before && after) {
      if (before.variantId !== after.variantId) kinds.push('Replaced');
      if (before.personId !== after.personId) kinds.push('Reassigned');
      if (before.variantId === after.variantId && after.durationMin !== before.durationMin) kinds.push(after.durationMin < before.durationMin ? 'Shortened' : 'Lengthened');
      if (before.startMin !== after.startMin) kinds.push('Moved');
    }
    return { taskId: t.id, title: after?.title || before?.title || t.title, beforeTitle: before?.title, kind: kinds[0] || 'Unchanged', kinds, before, after, deltaMinutes: before && after ? after.startMin - before.startMin : null, reasons: [] };
  });
  const changedEntries = entries.filter((e) => e.kind !== 'Unchanged');
  const changed = new Map(entries.map((e) => [e.taskId, e]));
  const axis = { start: s.startMin, end: Math.ceil((Math.max(A.state.scenario.deadlineMin, B.state.scenario.deadlineMin, A.plan.endMin, B.plan.endMin) + 10) / 30) * 30 };
  axis.span = axis.end - axis.start;
  const select = (name, value, max, min = 0) => `<select data-action="compare-pick" data-side="${name}" aria-label="Revision ${name}">${revs.slice(min, max + 1).map((r) => `<option value="${r.index}" ${r.index === value ? 'selected' : ''}>${esc(r.id)} · ${esc(r.label.slice(0, 40))}</option>`).join('')}</select>`;
  const stat = (label, a, b, d, iconName) => `
    <div class="kpi"><div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-icon">${icon(iconName, 16)}</span></div>
      <div class="kpi-value cmp-val"><span class="was">${a}</span>${icon('arrow', 14)}<span>${b}</span> ${d}</div></div>`;
  const kindCounts = Object.entries(changedEntries.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] || 0) + 1 }), {}))
    .map(([k, n]) => `<span class="kind ${KIND_CLASS[k]}">${n} ${esc(k)}</span>`).join(' ');
  const rows = changedEntries.map((e, i) => {
    return `
    <li class="map-row ${ui.selectedTaskId === e.taskId ? 'is-selected' : ''}">
      <button class="map-head" data-action="select-task" data-task="${esc(e.taskId)}">
        <span class="tag mono">T-${String(i + 1).padStart(2, '0')}</span>
        <span class="map-title">${e.kind === 'Replaced' ? `<span class="was">${esc(e.beforeTitle)}</span> → ` : ''}${esc(e.title)}</span>
        <span class="kind ${KIND_CLASS[e.kind]}">${esc(e.kind)}${e.deltaMinutes ? ` ${esc(formatSigned(e.deltaMinutes))}` : ''}</span>
      </button>
      ${mapTrack(e, axis)}
      <div class="map-facts small">
        <span>${e.before ? esc(formatWindow(s, e.before.startMin, e.before.endMin)) : '—'} ${icon('arrow', 11)} <strong>${e.after ? esc(formatWindow(s, e.after.startMin, e.after.endMin)) : 'removed'}</strong></span>
        ${e.before && e.after && e.before.personId !== e.after.personId ? `<span>${esc(personName(s, e.before.personId))} ${icon('arrow', 11)} <strong>${esc(personName(s, e.after.personId))}</strong></span>` : ''}
        ${changeFacts(e, s)}
      </div>
      ${e.reasons.length ? `<ul class="reasons">${reasonBadges(e.reasons)}</ul>` : '<p class="muted small">Non-adjacent revisions: per-step reasons are listed on each revision in History.</p>'}
    </li>`;
  }).join('');
  const common = { axis, nowMin: session.nowMin, selectedTaskId: ui.selectedTaskId, changed, rowH: ui.compareRowH, compact: false };
  return `
  <div class="view view-compare" id="main">
    ${pageHead({
    eyebrow: 'Timeline compare',
    title: 'Before / After',
    sub: `${changedEntries.length} task${changedEntries.length === 1 ? '' : 's'} changed between <strong>${esc(A.id)}</strong> and <strong>${esc(B.id)}</strong> ${kindCounts}`,
    actions: `<div class="rev-pick"><span class="pill pill-a">Plan A</span>${select('a', aIndex, bIndex - 1)}${icon('arrow', 14)}<span class="pill pill-b">Plan B</span>${select('b', bIndex, revs.length - 1, 1)}</div>`,
  })}
    <section class="kpis cmp-summary" aria-label="Comparison summary">
      <div class="kpi kpi-ok cmp-verdict"><div class="kpi-top"><span class="kpi-label">Result · ${esc(B.id)}</span><span class="kpi-icon">${icon('shield', 16)}</span></div>
        <div class="kpi-value">${icon('check', 18)} Feasible</div>
        <div class="kpi-sub">${changedEntries.length} of ${entries.length} tasks changed · ${B.plan.validation.checks} checks · 0 violations</div></div>
      ${stat('Deadline', esc(formatClock(s, A.state.scenario.deadlineMin)), `<strong>${esc(clock(B.state.scenario.deadlineMin))}</strong>`, delta(B.state.scenario.deadlineMin - A.state.scenario.deadlineMin, 'min'), 'clock')}
      ${stat('Finish', esc(clock(A.plan.endMin)), `<strong>${esc(clock(B.plan.endMin))}</strong>`, delta(B.plan.endMin - A.plan.endMin, 'min', true), 'flag')}
      ${stat('Buffer before deadline', esc(formatDuration(A.plan.slackMin)), `<strong>${esc(formatDuration(B.plan.slackMin))}</strong>`, delta(B.plan.slackMin - A.plan.slackMin, 'min'), 'clock')}
      ${stat('Total cost', `$${A.plan.totalCost}`, `<strong>$${B.plan.totalCost}</strong>`, delta(B.plan.totalCost - A.plan.totalCost, '$', true), 'money')}
    </section>
    <div class="compare-grid">
      <section class="card dual" aria-label="Synchronized timelines">
        <div class="dual-block">
          <div class="dual-label"><span class="pill pill-a">Plan A · ${esc(A.id)}</span><span class="muted small ellipsis">${esc(A.label)}</span><span class="muted small">ends ${esc(clock(A.plan.endMin))}</span></div>
          ${renderTimeline({ ...common, state: A.state, plan: A.plan, prevPlan: B.plan, markWillChange: true, id: 'tl-before', label: `Plan A ${A.id}` })}
        </div>
        <div class="dual-block">
          <div class="dual-label"><span class="pill pill-b">Plan B · ${esc(B.id)}</span><span class="muted small ellipsis">${esc(B.label)}</span><span class="muted small">ends ${esc(clock(B.plan.endMin))}</span></div>
          ${renderTimeline({ ...common, state: B.state, plan: B.plan, prevPlan: A.plan, prevState: A.state, kindChips: true, ghosts: false, id: 'tl-after', label: `Plan B ${B.id}` })}
        </div>
      </section>
      <section class="card change-map" aria-labelledby="map-title">
        <div class="card-head"><h2 id="map-title">${icon('list', 16)} Change map</h2><span class="muted small">${changedEntries.length} of ${entries.length} tasks</span></div>
        <div class="scroll">${rows ? `<ol class="map">${rows}</ol>` : '<div class="empty small">These revisions schedule every task identically.</div>'}</div>
      </section>
    </div>
  </div>`;
}

/* ---------- History ---------- */

export function renderHistory(ctx) {
  const { session, ui } = ctx;
  const revs = session.revisions;
  const selIndex = Math.min(ui.historyIndex ?? revs.length - 1, revs.length - 1);
  const R = revs[selIndex];
  const P = selIndex > 0 ? revs[selIndex - 1] : null;
  const s = R.state.scenario;
  const clock = (m) => formatClock(s, m);
  const items = [...revs].reverse().map((r) => `
    <li class="rev-item ${r.index === selIndex ? 'is-selected' : ''} ${r.index === revs.length - 1 ? 'is-head' : ''}">
      <span class="rev-node" aria-hidden="true"></span>
      <button class="rev-card" data-action="history-pick" data-index="${r.index}" aria-pressed="${r.index === selIndex}">
        <span class="rev-top"><span class="mono">${esc(r.id)}</span>${r.index === revs.length - 1 ? '<span class="tag tag-primary">Current</span>' : ''}${r.index === 0 ? '<span class="tag">Baseline</span>' : ''}<span class="muted small mono">at ${esc(clock(r.atMin))}</span></span>
        <strong>${esc(r.label)}</strong>
        <span class="muted small">ends ${esc(clock(r.plan.endMin))} · $${r.plan.totalCost} · ${r.plan.validation.checks} checks${r.shocks.length ? ` · via ${esc([...new Set(r.shocks.map((x) => x.source))].join(', '))}` : ''}</span>
      </button>
    </li>`).join('');
  const rejected = session.rejected.slice(-4).reverse().map((r) => `<li><span class="kind k-removed">Rejected</span> ${esc(r.descriptions.join(' + '))} <span class="muted small">at ${esc(clock(r.atMin))} · ${esc(r.violations[0]?.code || '')}</span></li>`).join('');
  const undone = session.shockLog.filter((x) => x.undone).slice(-4).map((x) => `<li><s>${esc(x.description)}</s> <span class="muted small">undone</span></li>`).join('');
  const diffRows = R.diff ? R.diff.entries.filter((e) => e.kind !== 'Unchanged').map((e) => `
    <tr><td><strong>${esc(e.title)}</strong>${e.kind === 'Replaced' ? `<div class="muted small">was ${esc(e.beforeTitle)}</div>` : ''}</td>
      <td>${e.after ? esc(personName(s, e.after.personId)) : '—'}</td>
      <td class="mono small">${e.before ? esc(formatWindow(s, e.before.startMin, e.before.endMin)) : '—'}</td>
      <td class="mono small">${e.after ? esc(formatWindow(s, e.after.startMin, e.after.endMin)) : 'removed'}</td>
      <td><span class="kind ${KIND_CLASS[e.kind]}">${esc(e.kind)}${e.deltaMinutes ? ` ${esc(formatSigned(e.deltaMinutes))}` : ''}</span></td></tr>`).join('') : '';
  const axis = { start: s.startMin, end: Math.ceil((Math.max(s.deadlineMin, R.plan.endMin) + 10) / 30) * 30 };
  axis.span = axis.end - axis.start;
  return `
  <div class="view view-history" id="main">
    ${pageHead({
    eyebrow: `Session log · ${esc(s.name)}`,
    title: 'History & revisions',
    sub: `${revs.length} revision${revs.length === 1 ? '' : 's'} · ${session.shockLog.filter((x) => !x.undone).length} applied change${session.shockLog.filter((x) => !x.undone).length === 1 ? '' : 's'} · ${session.rejected.length} rejected request${session.rejected.length === 1 ? '' : 's'} · saved in this browser`,
    actions: `<button class="btn btn-quiet" data-action="undo" ${revs.length > 1 ? '' : 'disabled'}>${icon('undo', 15)}<span>Undo last change</span></button>
      <button class="btn btn-quiet" data-action="restore" ${revs.length > 1 ? '' : 'disabled'}>Restore original</button>`,
  })}
    <div class="history-grid">
      <section class="card" aria-labelledby="rt-title">
        <div class="card-head"><h2 id="rt-title">${icon('history', 16)} Revision timeline</h2></div>
        <div class="scroll"><ol class="rev-list">${items}</ol>
          ${rejected ? `<div class="kpi-label">Rejected requests</div><ul class="plain">${rejected}</ul>` : ''}
          ${undone ? `<div class="kpi-label">Undone changes</div><ul class="plain">${undone}</ul>` : ''}</div>
      </section>
      <section class="card snapshot" aria-labelledby="snap-title">
        <div class="card-head"><h2 id="snap-title">${icon('eye', 16)} Snapshot · ${esc(R.id)}</h2><span class="muted small">${P ? `compared with ${esc(P.id)}` : 'baseline'}</span></div>
        <div class="kpis kpis-3">
          ${kpiCard({ label: 'Finish', iconName: 'flag', value: `${esc(clock(R.plan.endMin))} ${P ? delta(R.plan.endMin - P.plan.endMin, 'min', true) : ''}`, sub: `deadline ${esc(clock(s.deadlineMin))}` })}
          ${kpiCard({ label: 'Cost', iconName: 'money', value: `$${R.plan.totalCost} ${P ? delta(R.plan.totalCost - P.plan.totalCost, '$', true) : ''}`, sub: `budget $${s.budgetCap}` })}
          ${kpiCard({ label: 'Changed tasks', iconName: 'layers', value: R.diff ? String(R.diff.changed.length) : '—', sub: R.diff ? `${R.diff.entries.length - R.diff.changed.length} unchanged` : 'original plan' })}
        </div>
        <div class="snap-tl">${renderTimeline({ state: R.state, plan: R.plan, axis, nowMin: R.atMin, compact: true, rowH: ui.historyRowH, id: 'tl-snapshot', label: `Snapshot ${R.id}` })}</div>
        <div class="scroll">${diffRows ? `<table class="diff-table"><thead><tr><th>Task</th><th>Owner</th><th>${esc(P.id)}</th><th>${esc(R.id)}</th><th>Change</th></tr></thead><tbody>${diffRows}</tbody></table>` : '<div class="empty small">The baseline has no changes to list.</div>'}</div>
      </section>
    </div>
  </div>`;
}

/* ---------- Settings & transparency ---------- */

export function renderSettings(ctx) {
  const { ui, parser, boot, session } = ctx;
  const sw = (key, title, sub) => `
    <label class="switch-row" for="pref-${key}">
      <span><span class="sw-title">${esc(title)}</span><span class="sw-sub">${esc(sub)}</span></span>
      <input type="checkbox" class="switch" id="pref-${key}" data-action="pref" data-pref="${key}" ${ui.prefs[key] ? 'checked' : ''}>
    </label>`;
  return `
  <div class="view view-settings" id="main">
    ${pageHead({ eyebrow: 'Configuration', title: 'Settings & transparency', sub: 'What this app is, what runs where, and the preferences that only affect this browser.' })}
    <div class="settings-grid">
      <section class="card" aria-labelledby="st-about">
        <div class="card-head"><h2 id="st-about">${icon('info', 16)} About this simulation</h2></div>
        <ul class="facts">
          <li>${icon('check', 14)}<span>A <strong>simulated</strong> Alexa+-style web experience built for a hackathon demo.</span></li>
          <li>${icon('x', 14)}<span>Not an Amazon product. No Alexa device, account, API, MCP server or smart-home device is connected.</span></li>
          <li>${icon('check', 14)}<span>The three household scenarios are fixtures shipped with the app; people and tasks are fictional.</span></li>
          <li>${icon('check', 14)}<span>No voice input; requests are typed, picked from quick commands, or entered in the structured form.</span></li>
        </ul>
      </section>
      <section class="card" aria-labelledby="st-parser">
        <div class="card-head"><h2 id="st-parser">${icon('chat', 16)} Language understanding</h2>${parserPill(parser)}</div>
        <ul class="facts">
          ${parser.mode === 'llm'
    ? `<li>${icon('check', 14)}<span>Free text is sent to the local server, which asks <strong>${esc(parser.model)}</strong> for structured output.</span></li><li>${icon('check', 14)}<span>The result is re-validated against the allowlisted shock schema; any failure falls back to the local rules and the reply says so.</span></li>`
    : `<li>${icon('check', 14)}<span>Requests are read by a <strong>limited local rule parser</strong> — deterministic patterns, not a language model.</span></li><li>${icon('info', 14)}<span>LLM status: ${esc(parser.reason || 'not configured')}.</span></li><li>${icon('info', 14)}<span>To enable the optional LLM: install <code>@anthropic-ai/sdk</code> and <code>zod</code>, set <code>LLM_API_KEY</code> on the server, restart. The key never reaches the browser.</span></li>`}
        </ul>
      </section>
      <section class="card" aria-labelledby="st-engine">
        <div class="card-head"><h2 id="st-engine">${icon('shield', 16)} Planning engine</h2><span class="pill pill-engine"><span class="dot"></span>Deterministic · local</span></div>
        <ul class="facts">
          <li>${icon('check', 14)}<span>Bounded list scheduler: keep previous choices → compress (${COMPRESSION_LEVELS} levels, never below minimum) → listed alternatives → drop optional tasks.</span></li>
          <li>${icon('check', 14)}<span>Search limit: ${SEARCH_LIMIT.toLocaleString('en-US')} schedule attempts. Results not proven impossible are labelled “bounded search”.</span></li>
          <li>${icon('check', 14)}<span>Every plan is re-checked by an independent validator (dependencies, availability, equipment capacity, budget, deadline, frozen work).</span></li>
          <li>${icon('check', 14)}<span>Startup: ${esc(boot.summary || 'pending')}.</span></li>
        </ul>
      </section>
      <section class="card" aria-labelledby="st-prefs">
        <div class="card-head"><h2 id="st-prefs">${icon('settings', 16)} Preferences</h2><span class="muted small">Saved in this browser only</span></div>
        ${sw('confirm', 'Review changes before replanning', 'Show what was understood and a dry-run impact before committing')}
        ${sw('ghosts', 'Show previous positions', 'Dashed outlines where changed tasks used to be')}
        ${sw('reduceMotion', 'Reduce motion', 'Turn off transitions and animations (system setting is also respected)')}
      </section>
      <section class="card" aria-labelledby="st-data">
        <div class="card-head"><h2 id="st-data">${icon('lock', 16)} Data &amp; privacy</h2></div>
        <ul class="facts">
          <li>${icon('check', 14)}<span>The session (revisions, conversation, tool log) is stored in this browser's localStorage only.</span></li>
          <li>${icon('check', 14)}<span>Nothing is sent anywhere unless the optional LLM is configured — then only the request text and scenario constraints go to the server.</span></li>
        </ul>
        <button class="btn btn-quiet" data-action="new-session" ${session ? '' : 'disabled'}>Clear saved session</button>
      </section>
      <section class="card" aria-labelledby="st-keys">
        <div class="card-head"><h2 id="st-keys">${icon('list', 16)} Keyboard</h2></div>
        <table class="keys"><tbody>
          <tr><td><kbd>/</kbd></td><td>Focus the assistant input (workspace)</td></tr>
          <tr><td><kbd>D</kbd></td><td>Open “Simulate disruption”</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Close dialogs, cancel a pending change, dismiss the crisis panel</td></tr>
          <tr><td><kbd>Enter</kbd></td><td>Send / confirm</td></tr>
        </tbody></table>
      </section>
    </div>
  </div>`;
}

/* ---------- Disruption intake dialog ---------- */

export function renderDisruptionModal(ctx) {
  const { ui, head, scenario } = ctx;
  const m = ui.modal;
  const examples = scenario.quickCommands.filter((q) => !/^(undo|advance|can we|are we|will we)/i.test(q.text) && !/\?$/.test(q.text));
  const body = m.step === 'review' && ui.pending
    ? renderConfirmCard(ui.pending, { inModal: true })
    : `
      <form data-form="disruption" class="dis-form">
        <label for="dis-text" class="kpi-label">Describe what changed</label>
        <textarea id="dis-text" rows="3" maxlength="500" placeholder="e.g. Guests are arriving an hour early and the oven broke.">${esc(m.draft || '')}</textarea>
        <div class="chips">${examples.map((q) => `<button type="button" class="chip" data-action="dis-example" data-text="${esc(q.text)}">${esc(q.label)}</button>`).join('')}</div>
        <div class="dis-actions"><span class="muted small">${ctx.parser.mode === 'llm' ? 'Parsed by the LLM, then schema-checked.' : 'Parsed by the local rule parser (not an LLM).'}</span>
          <button class="btn btn-primary" type="submit">${icon('search', 15)}<span>Review change</span></button></div>
      </form>
      <div class="dis-or"><span>or pick a structured change</span></div>
      <form class="manual" data-form="manual" aria-label="Structured change form">
        <select data-field="m-type" aria-label="Change type">${MANUAL_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <span data-slot="m-param" class="manual-param">${manualParam('deadline_earlier', head)}</span>
        <button class="btn" type="submit">Review</button>
      </form>`;
  return `
  <div class="modal-backdrop" data-action="close-modal"></div>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dis-title">
    <div class="modal-head">
      <span class="modal-icon">${icon('bolt', 18)}</span>
      <div><h2 id="dis-title">Simulate a disruption</h2><p class="muted small">${esc(scenario.name)} · ${esc(head.id)} · clock ${esc(formatClock(head.state.scenario, ctx.session.nowMin))}. Work already started will stay fixed.</p></div>
      <button class="btn btn-quiet btn-icon" data-action="close-modal" aria-label="Close">${icon('x', 16)}</button>
    </div>
    <div class="steps-ind" aria-hidden="true"><span class="${m.step !== 'review' ? 'on' : 'done'}">1 Describe</span><span class="${m.step === 'review' ? 'on' : ''}">2 Review</span><span>3 Replan</span></div>
    <div class="modal-body">${body}</div>
  </div>`;
}
