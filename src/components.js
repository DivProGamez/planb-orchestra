// View functions: pure (data → HTML string). All dynamic text is escaped.

import {
  formatClock, formatDuration, formatSigned, personName, resourceName,
} from './engine/model.js';
import { REASONS, reasonLabel } from './engine/reasons.js';
import { liveStatus } from './engine/session.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const KIND_CLASS = {
  Moved: 'k-moved', Reassigned: 'k-reassigned', Shortened: 'k-shortened', Lengthened: 'k-lengthened',
  Replaced: 'k-replaced', Removed: 'k-removed', Restored: 'k-restored', Unchanged: 'k-unchanged',
};

const STATUS_LABEL = {
  idle: 'Ready', parsing: 'Parsing request…', planning: 'Planning…', done: 'Done', failure: 'Needs attention',
};

/* ---------- Header ---------- */

export function renderHeader({ scenario, nowMin, parser, screen }) {
  const parserBadge = parser.mode === 'llm'
    ? `<span class="badge badge-accent" title="Natural language is parsed by ${esc(parser.model)} on the server, then schema-validated">Parser: LLM (${esc(parser.model)}) + schema check</span>`
    : `<span class="badge badge-warn" title="${esc(parser.reason || 'No LLM configured')}">Parser: limited local rules (not an LLM)</span>`;
  return `
  <header class="topbar" role="banner">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <div class="brand-name">PlanB Orchestra</div>
        <div class="brand-sub">When life breaks the plan, the plan repairs itself</div>
      </div>
    </div>
    <div class="topbar-badges">
      <span class="badge badge-sim" title="Demo simulation. Not an Amazon product, not connected to any Alexa device or account.">Simulated Alexa+ experience · demo</span>
      ${parserBadge}
    </div>
    <div class="topbar-right">
      ${scenario && screen === 'workspace' ? `
        <div class="scenario-chip"><span aria-hidden="true">${esc(scenario.emoji)}</span> ${esc(scenario.name)}</div>
        <div class="clock" aria-label="Simulation clock ${esc(formatClock(scenario, nowMin))}">
          <span class="clock-label">Clock</span> <strong>${esc(formatClock(scenario, nowMin))}</strong>
        </div>
        <button class="btn btn-ghost" data-action="new-session">New session</button>` : ''}
    </div>
  </header>`;
}

/* ---------- Welcome & setup ---------- */

export function renderWelcome(scenarios, notice) {
  const tiles = scenarios.map((s) => {
    const window = s.deadlineMin - s.startMin;
    return `
    <button class="tile" data-action="choose-scenario" data-id="${esc(s.id)}">
      <span class="tile-emoji" aria-hidden="true">${esc(s.emoji)}</span>
      <span class="tile-name">${esc(s.name)}</span>
      <span class="tile-tag">${esc(s.tagline)}</span>
      <span class="tile-stats">
        <span>${s.people.length} people</span><span>${s.tasks.length} tasks</span>
        <span>${esc(formatDuration(window))}</span><span>$${s.budgetCap}</span>
      </span>
      <span class="tile-cta">Set up plan →</span>
    </button>`;
  }).join('');
  return `
  <main class="welcome" id="main">
    ${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}
    <section class="hero">
      <h1>Most assistants make plans. <span class="accent">PlanB repairs them.</span></h1>
      <p>A household planning agent that schedules people, deadlines, equipment and budget — and, when something breaks,
      recomputes a feasible plan, shows exactly what changed, and proves why. Every plan is checked by an independent validator.</p>
    </section>
    <section aria-label="Scenario gallery" class="tiles">${tiles}</section>
    <section class="how" aria-label="How it works">
      <ol class="how-steps">
        <li><span class="how-n">1</span><div><strong>Plan</strong><p>Pick a household event. A deterministic scheduler builds a feasible plan across people, equipment, budget and the deadline.</p></div></li>
        <li><span class="how-n">2</span><div><strong>Tell it what changed</strong><p>Type it the way you would say it, combine several changes, or use the structured form.</p></div></li>
        <li><span class="how-n">3</span><div><strong>Repair &amp; prove</strong><p>The agent replans unfinished work, validates every constraint, and explains each moved, reassigned or dropped task.</p></div></li>
      </ol>
      <div class="try">
        <h2>Things you can say</h2>
        <ul class="try-list">
          <li>“Guests are arriving an hour early and the oven broke.”</li>
          <li>“Alex has to leave at 5 PM.”</li>
          <li>“Leila is running 20 minutes late.”</li>
          <li>“We only have $60 left.”</li>
          <li>“The oven works again.”</li>
          <li>“Skip the bread.” · “Can we still make it?” · “Undo.”</li>
        </ul>
        <p class="muted small">Without an LLM key these are read by a limited local rule parser; anything it cannot map is reported, never guessed.</p>
      </div>
    </section>
    <p class="fineprint">Simulated Alexa+-style web experience for a hackathon demo. Not affiliated with or endorsed by Amazon.
    All planning runs locally in your browser with a deterministic engine.</p>
  </main>`;
}

export function renderSetup(scenario, form, error) {
  const clock = (m) => formatClock(scenario, m);
  const people = scenario.people.map((p) => {
    const on = form.people[p.id] !== false;
    return `<label class="check"><input type="checkbox" data-field="person" data-id="${esc(p.id)}" ${on ? 'checked' : ''}>
      <span>${esc(p.name)} <small>available from ${esc(clock(p.availableFrom))}</small></span></label>`;
  }).join('');
  const resources = scenario.resources.map((r) => {
    const on = form.resources[r.id] !== false;
    return `<label class="check"><input type="checkbox" data-field="resource" data-id="${esc(r.id)}" ${on ? 'checked' : ''}>
      <span>${esc(r.name)} <small>capacity ${r.capacity}</small></span></label>`;
  }).join('');
  const rows = scenario.tasks.map((t) => `
    <tr>
      <td>${esc(t.title)}</td>
      <td><span class="prio prio-${esc(t.priority)}">${esc(t.priority)}</span></td>
      <td class="num">${t.durationMin} min${t.compressible && t.minDurationMin < t.durationMin ? `<small> · min ${t.minDurationMin}</small>` : ''}</td>
      <td class="num">$${t.cost}</td>
      <td>${esc([...t.resources.map((r) => resourceName(scenario, r)), t.eligiblePeople.length ? '' : 'hands-free'].filter(Boolean).join(', ') || '—')}</td>
      <td class="small">${esc([...t.dependsOn, ...(t.softDependsOn || [])].map((d) => scenario.tasks.find((x) => x.id === d)?.title).join(', ') || '—')}</td>
      <td>${t.alternatives.length ? esc(t.alternatives.map((a) => scenario.alternatives.find((x) => x.id === a)?.title).join(', ')) : '—'}</td>
    </tr>`).join('');
  return `
  <main class="setup" id="main">
    <button class="btn btn-ghost back" data-action="back-to-gallery">← Scenarios</button>
    <div class="setup-grid">
      <section class="card">
        <h1><span aria-hidden="true">${esc(scenario.emoji)}</span> ${esc(scenario.name)}</h1>
        <p class="muted">${esc(scenario.tagline)}</p>
        <form data-form="setup" class="setup-form">
          <label class="field">
            <span>Deadline (${esc(scenario.deadlineLabel)}) <output data-out="deadline">${esc(clock(form.deadlineMin))}</output></span>
            <input type="range" min="60" max="480" step="15" value="${form.deadlineMin}" data-field="deadline" aria-describedby="deadline-help">
            <small id="deadline-help">Start ${esc(clock(scenario.startMin))} · window ${esc(formatDuration(form.deadlineMin - scenario.startMin))}</small>
          </label>
          <label class="field">
            <span>Budget cap ($)</span>
            <input type="number" min="0" max="1000" step="5" value="${form.budgetCap}" data-field="budget" inputmode="numeric">
          </label>
          <fieldset class="field"><legend>Who is helping</legend>${people}</fieldset>
          <fieldset class="field"><legend>Equipment available</legend>${resources}</fieldset>
          ${error ? `<div class="alert alert-bad" role="alert"><strong>No feasible baseline.</strong> ${esc(error)}</div>` : ''}
          <button class="btn btn-primary btn-lg" type="submit">Build Feasible Plan</button>
        </form>
      </section>
      <section class="card">
        <h2>Tasks in this scenario</h2>
        <div class="table-wrap"><table class="tasks">
          <thead><tr><th>Task</th><th>Priority</th><th class="num">Duration</th><th class="num">Cost</th><th>Needs</th><th>After</th><th>Listed fallback</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="muted small">Only the listed fallbacks can replace a task — the planner never invents helpers, equipment or recipes.</p>
      </section>
    </div>
  </main>`;
}

/* ---------- Gantt ---------- */

const ROW_H = 46;
const RES_H = 22;

function axisFor(states, plans) {
  const s = states[0].scenario;
  const start = s.startMin;
  let end = Math.max(...states.map((x) => x.scenario.deadlineMin), ...plans.filter(Boolean).map((p) => p.endMin || 0));
  end = Math.ceil((end + 10) / 30) * 30;
  return { start, end, span: end - start };
}

function packHandsFree(entries) {
  // Interval partitioning for tasks that need no person (they may overlap).
  const rows = [];
  const placement = new Map();
  for (const st of [...entries].sort((a, b) => a.startMin - b.startMin)) {
    let row = rows.findIndex((endMin) => endMin <= st.startMin);
    if (row === -1) { row = rows.length; rows.push(0); }
    rows[row] = st.endMin;
    placement.set(st.taskId, row);
  }
  return { count: Math.max(1, rows.length), placement };
}

export function buildLayout(state, plans) {
  const s = state.scenario;
  const lanes = s.people.map((p) => ({ id: p.id, label: p.name, kind: 'person', person: p, rows: 1 }));
  const handsByPlan = plans.map((p) => packHandsFree((p?.scheduled || []).filter((st) => !st.personId)));
  const handsRows = Math.max(0, ...handsByPlan.map((h, i) => ((plans[i]?.scheduled || []).some((st) => !st.personId) ? h.count : 0)));
  if (handsRows > 0) lanes.push({ id: '__hands', label: 'Hands-free', kind: 'hands', rows: handsRows });
  let top = 0;
  for (const lane of lanes) { lane.top = top; lane.height = lane.rows * ROW_H; top += lane.height; }
  const resTop = top;
  return { lanes, handsByPlan, resTop, height: resTop + s.resources.length * RES_H };
}

function pct(axis, m) {
  return ((m - axis.start) / axis.span) * 100;
}

function barBox(layout, axis, st, planIndex) {
  const lane = st.personId ? layout.lanes.find((l) => l.id === st.personId) : layout.lanes.find((l) => l.id === '__hands');
  const row = st.personId ? 0 : layout.handsByPlan[planIndex]?.placement.get(st.taskId) || 0;
  return {
    left: pct(axis, st.startMin), width: pct(axis, st.endMin) - pct(axis, st.startMin),
    top: (lane?.top || 0) + row * ROW_H + 5,
  };
}

/**
 * opts: { state, plan, prevPlan, prevState, axis, nowMin, atMin, selectedTaskId, changed (Map taskId→kind),
 *         ghosts (bool), animate (bool), title, id }
 */
export function renderGantt(opts) {
  const { state, plan, prevPlan, axis, nowMin, selectedTaskId, changed = new Map(), ghosts, animate, title, id } = opts;
  const s = state.scenario;
  const clock = (m) => formatClock(s, m);
  const plans = [plan, prevPlan];
  const layout = buildLayout(state, plans);
  const step = axis.span > 330 ? 60 : 30;
  const ticks = [];
  for (let m = axis.start; m <= axis.end; m += step) ticks.push(m);

  const laneHtml = layout.lanes.map((lane) => {
    let shade = '';
    if (lane.kind === 'person') {
      const p = lane.person;
      const blocks = [];
      if (p.availableFrom > axis.start) blocks.push([axis.start, Math.min(p.availableFrom, axis.end)]);
      if (p.availableTo < axis.end) blocks.push([Math.max(p.availableTo, axis.start), axis.end]);
      shade = blocks.map(([a, b]) => `<div class="unavail" style="left:${pct(axis, a)}%;width:${pct(axis, b) - pct(axis, a)}%" title="${esc(p.name)} unavailable ${esc(clock(a))}–${esc(clock(b))}"><span>unavailable</span></div>`).join('');
    }
    return `<div class="lane ${lane.kind === 'hands' ? 'lane-hands' : ''}" style="top:${lane.top}px;height:${lane.height}px">${shade}</div>`;
  }).join('');
  const labels = layout.lanes.map((lane) => `<div class="lane-label" style="top:${lane.top}px;height:${lane.height}px">${esc(lane.label)}${lane.kind === 'person' && lane.person.availableTo < axis.end ? ` <small>until ${esc(clock(lane.person.availableTo))}</small>` : ''}</div>`).join('')
    + s.resources.map((r, i) => `<div class="lane-label res-label" style="top:${layout.resTop + i * RES_H}px;height:${RES_H}px">${esc(r.name)}${r.available ? '' : ' <em>down</em>'}</div>`).join('');

  const resRows = s.resources.map((r, i) => {
    const top = layout.resTop + i * RES_H;
    const uses = plan.scheduled.filter((st) => st.resources.includes(r.id)).map((st) => `<div class="res-use" style="left:${pct(axis, st.startMin)}%;width:${pct(axis, st.endMin) - pct(axis, st.startMin)}%" title="${esc(r.name)}: ${esc(st.title)} ${esc(clock(st.startMin))}–${esc(clock(st.endMin))}"></div>`).join('');
    const down = r.available ? '' : `<div class="res-down" style="left:${pct(axis, opts.atMin ?? axis.start)}%;right:0" title="${esc(r.name)} unavailable"></div>`;
    return `<div class="res-row" style="top:${top}px;height:${RES_H}px">${down}${uses}</div>`;
  }).join('');

  const prevById = new Map((prevPlan?.scheduled || []).map((st) => [st.taskId, st]));
  const bars = plan.scheduled.map((st) => {
    const box = barBox(layout, axis, st, 0);
    const status = liveStatus(st, nowMin);
    const kind = changed.get(st.taskId);
    const prev = prevById.get(st.taskId);
    const from = animate && prev ? barBox(layout, axis, prev, 1) : null;
    const task = s.tasks.find((t) => t.id === st.taskId);
    const cls = [
      'bar', `st-${status}`, `prio-${task?.priority}`, st.variantId !== 'base' ? 'is-alt' : '',
      st.durationMin < st.fullDurationMin ? 'is-compressed' : '', !st.personId ? 'is-hands' : '',
      kind && kind !== 'Unchanged' ? `is-changed ${KIND_CLASS[kind]}` : '', selectedTaskId === st.taskId ? 'is-selected' : '',
    ].filter(Boolean).join(' ');
    const label = `${st.title}, ${clock(st.startMin)} to ${clock(st.endMin)}, ${personName(s, st.personId)}, ${status.replace('_', ' ')}${kind && kind !== 'Unchanged' ? `, ${kind}` : ''}`;
    const res = st.resources.map((r) => resourceName(s, r)).join(', ');
    return `<button class="${cls}" data-action="select-task" data-task="${esc(st.taskId)}"
      style="left:${box.left}%;width:${box.width}%;top:${box.top}px"
      ${from ? `data-from-left="${from.left}" data-from-width="${from.width}" data-from-top="${from.top}"` : ''}
      aria-label="${esc(label)}" title="${esc(label)}${res ? ` · uses ${esc(res)}` : ''}${st.actualCost ? ` · $${st.actualCost}` : ''}">
      <span class="bar-title">${status === 'done' ? '✓ ' : ''}${esc(st.title)}</span>
      <span class="bar-meta">${esc(clock(st.startMin))}–${esc(clock(st.endMin))}${st.durationMin < st.fullDurationMin ? ` · ${st.fullDurationMin}→${st.durationMin}m` : ''}${res ? ` · ${esc(res)}` : ''}</span>
    </button>`;
  }).join('');

  const ghostHtml = ghosts && prevPlan ? [...changed.entries()]
    .filter(([, kind]) => kind !== 'Unchanged' && kind !== 'Restored')
    .map(([taskId, kind]) => {
      const prev = prevById.get(taskId);
      if (!prev) return '';
      const box = barBox(layout, axis, prev, 1);
      return `<div class="ghost ${KIND_CLASS[kind]}" style="left:${box.left}%;width:${box.width}%;top:${box.top}px" aria-hidden="true"><span>${kind === 'Removed' ? 'removed: ' : 'was: '}${esc(prev.title)}</span></div>`;
    }).join('') : '';

  const deadline = `<div class="marker marker-deadline ${pct(axis, s.deadlineMin) > 80 ? 'flip' : ''}" style="left:${pct(axis, s.deadlineMin)}%" title="Deadline ${esc(clock(s.deadlineMin))}"><span>${esc(s.deadlineLabel || 'deadline')} ${esc(clock(s.deadlineMin))}</span></div>`;
  const prevDeadline = opts.prevState && opts.prevState.scenario.deadlineMin !== s.deadlineMin
    ? `<div class="marker marker-old" style="left:${pct(axis, opts.prevState.scenario.deadlineMin)}%"><span>was ${esc(clock(opts.prevState.scenario.deadlineMin))}</span></div>` : '';
  const now = nowMin > axis.start && nowMin < axis.end ? `<div class="marker marker-now" style="left:${pct(axis, nowMin)}%"><span>now</span></div>` : '';

  return `
  <figure class="gantt" ${id ? `id="${esc(id)}"` : ''} aria-label="${esc(title)}">
    ${title ? `<figcaption class="gantt-title">${esc(title)}</figcaption>` : ''}
    <div class="gantt-grid">
      <div class="gantt-labels" style="height:${layout.height + 26}px"><div class="axis-spacer"></div><div class="labels-body" style="height:${layout.height}px">${labels}</div></div>
      <div class="gantt-main">
        <div class="axis">${ticks.map((m) => `<span style="left:${pct(axis, m)}%">${esc(clock(m))}</span>`).join('')}</div>
        <div class="gantt-body" style="height:${layout.height}px">
          ${ticks.map((m) => `<div class="tick" style="left:${pct(axis, m)}%"></div>`).join('')}
          ${laneHtml}${resRows}${ghostHtml}${bars}${prevDeadline}${deadline}${now}
        </div>
      </div>
    </div>
  </figure>`;
}

/* ---------- Workspace pieces ---------- */

function kpiDelta(value, unit = '', invert = false) {
  if (value === null || value === undefined || value === 0) return '';
  const good = invert ? value < 0 : value > 0;
  const sign = value > 0 ? '+' : '−';
  return `<span class="delta ${good ? 'good' : 'bad'}">${sign}${unit === '$' ? '$' : ''}${Math.abs(value)}${unit === 'min' ? ' min' : ''}${unit === '%' ? ' pts' : ''}</span>`;
}

export function renderKpis({ head, prev }) {
  const s = head.state.scenario;
  const p = head.plan;
  const clock = (m) => formatClock(s, m);
  const pp = prev?.plan;
  const avgUtil = Math.round(p.utilization.filter((u) => u.windowMin > 0).reduce((a, u) => a + u.pct, 0) / Math.max(1, p.utilization.filter((u) => u.windowMin > 0).length));
  const prevUtil = pp ? Math.round(pp.utilization.filter((u) => u.windowMin > 0).reduce((a, u) => a + u.pct, 0) / Math.max(1, pp.utilization.filter((u) => u.windowMin > 0).length)) : null;
  const committedPct = Math.min(100, (p.committedCost / Math.max(1, s.budgetCap)) * 100);
  const totalPct = Math.min(100, (p.totalCost / Math.max(1, s.budgetCap)) * 100);
  const optionalDropped = p.dropped.filter((d) => d.cause !== 'user');
  const userDropped = p.dropped.filter((d) => d.cause === 'user');
  return `
  <section class="kpis" aria-label="Plan summary">
    <div class="kpi kpi-ok">
      <div class="kpi-label">Feasibility</div>
      <div class="kpi-value">✓ Feasible</div>
      <div class="kpi-sub">validated: ${p.validation.checks} checks, 0 violations</div>
    </div>
    <div class="kpi">
      <div class="kpi-label" title="Last task ends vs ${esc(s.deadlineLabel || 'deadline')}">Finish / deadline</div>
      <div class="kpi-value">${esc(clock(p.endMin))} ${pp ? kpiDelta(p.endMin - pp.endMin, 'min', true) : ''}</div>
      <div class="kpi-sub">deadline ${esc(clock(s.deadlineMin))} · ${esc(formatDuration(p.slackMin))} slack</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Cost vs budget</div>
      <div class="kpi-value">$${p.totalCost} <small>/ $${s.budgetCap}</small></div>
      <div class="meter" role="img" aria-label="Spent or committed $${p.committedCost}, planned $${p.totalCost - p.committedCost}, budget $${s.budgetCap}">
        <span class="meter-committed" style="width:${committedPct}%"></span><span class="meter-planned" style="width:${Math.max(0, totalPct - committedPct)}%"></span>
      </div>
      <div class="kpi-sub">$${p.committedCost} committed · $${p.totalCost - p.committedCost} planned ${pp ? kpiDelta(p.totalCost - pp.totalCost, '$', true) : ''}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Team utilization</div>
      <div class="kpi-value">${avgUtil}% ${prevUtil !== null ? kpiDelta(avgUtil - prevUtil, '%') : ''}</div>
      <div class="kpi-sub">${p.utilization.map((u) => `${esc(personName(s, u.personId))} ${u.pct}%`).join(' · ')}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Excluded</div>
      <div class="kpi-value">${p.dropped.length || 'None'}</div>
      <div class="kpi-sub">${[...optionalDropped.map((d) => `${esc(d.title)} (optional)`), ...userDropped.map((d) => `${esc(d.title)} (skipped by you)`)].join(' · ') || 'Every task is scheduled'}</div>
    </div>
  </section>`;
}

export function renderToolbar({ ui, head, scenario, nowMin }) {
  const hasPrev = head.index > 0;
  return `
  <div class="toolbar">
    <div class="seg" role="group" aria-label="View">
      <button class="seg-btn" data-action="view" data-view="plan" aria-pressed="${ui.view === 'plan'}">${hasPrev ? 'Plan B' : 'Plan'}</button>
      <button class="seg-btn" data-action="view" data-view="compare" aria-pressed="${ui.view === 'compare'}" ${hasPrev ? '' : 'disabled title="Available after the first change"'}>Before / After</button>
    </div>
    ${hasPrev && ui.view === 'plan' ? `<label class="check inline"><input type="checkbox" data-action="toggle-ghosts" ${ui.ghosts ? 'checked' : ''}> Show previous positions</label>` : ''}
    <div class="clock-ctrl" role="group" aria-label="Simulation clock">
      <span class="muted">Clock ${esc(formatClock(scenario, nowMin))}</span>
      <button class="btn btn-sm" data-action="advance" data-min="10">+10 min</button>
      <button class="btn btn-sm" data-action="advance" data-min="30">+30 min</button>
    </div>
    <div class="legend" aria-hidden="true">
      <span class="lg lg-done">done</span><span class="lg lg-prog">in progress</span><span class="lg lg-alt">alternative</span><span class="lg lg-chg">changed</span>
    </div>
  </div>`;
}

export function renderInfeasible(proposal, scenario) {
  const violations = proposal.plan.violations.map((v) => `
    <li><span class="proof proof-${esc(v.proof)}">${v.proof === 'proven' ? 'Proven bound' : v.proof === 'search' ? 'Bounded search' : 'Validator'}</span>
      <code>${esc(v.code)}</code> ${esc(v.message)}</li>`).join('');
  const options = proposal.options.map((o, i) => `
    <li class="option">
      <div><strong>${esc(o.label)}</strong><div class="muted small">Verified by the planner: ${esc(o.detail)}</div></div>
      <button class="btn btn-primary" data-action="apply-option" data-index="${i}">Apply this</button>
    </li>`).join('');
  return `
  <section class="infeasible" role="alertdialog" aria-labelledby="inf-title" tabindex="-1" id="infeasible">
    <div class="inf-head">
      <h2 id="inf-title">No feasible plan — nothing was changed</h2>
      <button class="btn btn-ghost btn-sm" data-action="dismiss-proposal" aria-label="Keep current plan and dismiss">Keep current plan ✕</button>
    </div>
    <p>Requested: <strong>${esc(proposal.descriptions.join(' + '))}</strong> at ${esc(formatClock(scenario, proposal.atMin))}.
    Your constraints are untouched until you confirm an option.</p>
    <h3>Hard constraints that cannot all hold</h3>
    <ul class="violations">${violations}</ul>
    ${proposal.options.length ? `<h3>Options I checked that would work</h3><ul class="options">${options}</ul>`
    : '<p class="muted">No single relaxation I can check restores feasibility. Undo or restore the scenario instead.</p>'}
  </section>`;
}

export function renderConstraints({ head, session, original }) {
  const s = head.state.scenario;
  const clock = (m) => formatClock(s, m);
  const changedDeadline = s.deadlineMin !== original.deadlineMin;
  const changedBudget = s.budgetCap !== original.budgetCap;
  const people = s.people.map((p) => {
    const o = original.people.find((x) => x.id === p.id);
    const notIn = p.availableTo <= p.availableFrom;
    const reduced = o && p.availableTo < o.availableTo && !notIn;
    return `<li class="${reduced || notIn ? 'warn' : ''}">${esc(p.name)} <span class="muted">${notIn ? 'not participating' : `${esc(clock(p.availableFrom))}–${reduced ? `${esc(clock(p.availableTo))} (left)` : 'end'}`}</span></li>`;
  }).join('');
  const res = s.resources.map((r) => `<li class="${r.available ? '' : 'warn'}">${esc(r.name)} <span class="muted">×${r.capacity} · ${r.available ? 'available' : 'unavailable'}</span></li>`).join('');
  const typeOptions = [
    ['deadline_earlier', 'Deadline earlier by…'], ['person_unavailable', 'Person becomes unavailable'], ['person_delayed', 'Person arrives late by…'],
    ['resource_unavailable', 'Equipment breaks'], ['resource_restored', 'Equipment works again'], ['budget_reduced', 'Budget reduced to…'], ['duration_increase', 'Task takes longer…'],
  ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  return `
  <section class="card constraints" aria-labelledby="c-title">
    <h2 id="c-title">Current constraints <span class="muted small">revision ${esc(head.id)}</span></h2>
    <div class="c-grid">
      <div><h3>Deadline</h3><p class="${changedDeadline ? 'warn' : ''}">${esc(clock(s.deadlineMin))}${changedDeadline ? ` <span class="muted">(was ${esc(clock(original.deadlineMin))})</span>` : ''}</p>
           <h3>Budget</h3><p class="${changedBudget ? 'warn' : ''}">$${s.budgetCap}${changedBudget ? ` <span class="muted">(was $${original.budgetCap})</span>` : ''}</p></div>
      <div><h3>People</h3><ul class="plain">${people}</ul></div>
      <div><h3>Equipment</h3><ul class="plain">${res}</ul></div>
    </div>
    <form class="manual" data-form="manual" aria-label="Structured change form">
      <h3>Structured change <span class="muted small">(same engine path as typed requests)</span></h3>
      <div class="manual-row">
        <select data-field="m-type" aria-label="Change type">${typeOptions}</select>
        <span data-slot="m-param">${manualParam('deadline_earlier', head, session)}</span>
        <button class="btn" type="submit">Apply change</button>
      </div>
    </form>
  </section>`;
}

export function manualParam(type, head) {
  const s = head.state.scenario;
  switch (type) {
    case 'deadline_earlier':
      return `<input type="number" min="5" max="240" step="5" value="30" data-field="m-minutes" aria-label="Minutes earlier"> <span class="muted">min</span>`;
    case 'person_unavailable':
      return `<select data-field="m-person" aria-label="Person">${s.people.filter((p) => p.availableTo > p.availableFrom).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`;
    case 'resource_unavailable':
      return `<select data-field="m-resource" aria-label="Equipment">${s.resources.filter((r) => r.available).map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`;
    case 'resource_restored': {
      const down = s.resources.filter((r) => !r.available);
      return down.length
        ? `<select data-field="m-resource" aria-label="Equipment">${down.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`
        : '<span class="muted small">No equipment is down</span>';
    }
    case 'person_delayed':
      return `<select data-field="m-person" aria-label="Person">${s.people.filter((p) => p.availableTo > p.availableFrom).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <input type="number" min="5" max="240" step="5" value="20" data-field="m-minutes" aria-label="Minutes late"> <span class="muted">min</span>`;
    case 'budget_reduced':
      return `<span class="muted">$</span><input type="number" min="0" max="${Math.max(0, s.budgetCap - 1)}" step="1" value="${Math.max(0, s.budgetCap - 20)}" data-field="m-cap" aria-label="New budget">`;
    case 'duration_increase':
      return `<select data-field="m-task" aria-label="Task">${s.tasks.filter((t) => t.status === 'todo').map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select>
        <input type="number" min="5" max="120" step="5" value="15" data-field="m-extra" aria-label="Extra minutes"> <span class="muted">min</span>`;
    default:
      return '';
  }
}

export function renderWhy({ head, selectedTaskId }) {
  const s = head.state.scenario;
  const clock = (m) => formatClock(s, m);
  if (!head.diff) {
    return `<section class="card why" aria-labelledby="why-title"><h2 id="why-title">Why it changed</h2>
      <p class="muted">This is the original plan — nothing has changed yet. Try a quick command such as
      “Guests are arriving an hour early and the oven broke.”</p></section>`;
  }
  const d = head.diff;
  const cards = d.changed.map((e) => {
    const b = e.before; const a = e.after;
    const time = b && a ? `${esc(clock(b.startMin))}–${esc(clock(b.endMin))} → <strong>${esc(clock(a.startMin))}–${esc(clock(a.endMin))}</strong>`
      : b ? `${esc(clock(b.startMin))}–${esc(clock(b.endMin))} → <strong>removed</strong>` : `<strong>${esc(clock(a.startMin))}–${esc(clock(a.endMin))}</strong>`;
    const who = b && a && b.personId !== a.personId ? `<div class="why-who">${esc(personName(s, b.personId))} → <strong>${esc(personName(s, a.personId))}</strong></div>` : '';
    const reasons = e.reasons.map((r) => `
      <li><span class="reason tone-${esc(REASONS[r.code]?.tone || 'info')}" title="${esc(r.code)}">${esc(reasonLabel(r.code))}</span>
        <span class="evidence">${esc(r.evidence.join(' · '))}</span></li>`).join('');
    return `
    <li class="why-card ${selectedTaskId === e.taskId ? 'is-selected' : ''}" data-why="${esc(e.taskId)}">
      <button class="why-head" data-action="select-task" data-task="${esc(e.taskId)}" aria-pressed="${selectedTaskId === e.taskId}">
        <span class="kind ${KIND_CLASS[e.kind]}">${esc(e.kind)}</span>
        <span class="why-title">${e.kind === 'Replaced' ? `${esc(e.beforeTitle)} → ` : ''}${esc(e.title)}</span>
        ${e.deltaMinutes ? `<span class="why-delta">${esc(formatSigned(e.deltaMinutes))}</span>` : ''}
      </button>
      <div class="why-time">${time}</div>${who}
      <ul class="reasons">${reasons}</ul>
      <div class="why-id muted small">task <code>${esc(e.taskId)}</code>${e.kinds.length > 1 ? ` · ${esc(e.kinds.join(', '))}` : ''}</div>
    </li>`;
  }).join('');
  const unchanged = d.entries.filter((e) => e.kind === 'Unchanged');
  const frozen = unchanged.filter((e) => e.frozen);
  return `
  <section class="card why" aria-labelledby="why-title">
    <h2 id="why-title">Why it changed <span class="muted small">${d.changed.length} changed · ${unchanged.length} unchanged</span></h2>
    ${d.changed.length ? `<ol class="why-list">${cards}</ol>` : '<p class="muted">The change was absorbed without moving any task.</p>'}
    ${frozen.length ? `<p class="muted small">Frozen (already started or done): ${frozen.map((e) => esc(e.title)).join(', ')}</p>` : ''}
    <p class="muted small">Reasons are generated from reason codes tied to the constraint that changed — no free-text guessing.</p>
  </section>`;
}

export function renderTimeline({ session }) {
  const s = session.revisions[0].state.scenario;
  const clock = (m) => formatClock(s, m);
  const revs = [...session.revisions].reverse().map((r, i) => `
    <li class="rev ${i === 0 ? 'is-current' : ''}">
      <div class="rev-dot" aria-hidden="true"></div>
      <div><div class="rev-title"><code>${esc(r.id)}</code> ${esc(r.label)}</div>
      <div class="muted small">at ${esc(clock(r.atMin))} · ends ${esc(clock(r.plan.endMin))} · $${r.plan.totalCost}${r.shocks.length ? ` · via ${esc([...new Set(r.shocks.map((x) => x.source))].join(', '))}` : ''}${i === 0 ? ' · current' : ''}</div></div>
    </li>`).join('');
  const rejected = session.rejected.slice(-3).reverse().map((r) => `<li><span class="kind k-removed">Rejected</span> ${esc(r.descriptions.join(' + '))} <span class="muted small">at ${esc(clock(r.atMin))} — ${esc(r.violations[0]?.code || '')}</span></li>`).join('');
  const undone = session.shockLog.filter((x) => x.undone).slice(-4).map((x) => `<li><s>${esc(x.description)}</s> <span class="muted small">undone</span></li>`).join('');
  return `
  <section class="card timeline" aria-labelledby="tl-title">
    <h2 id="tl-title">Session timeline</h2>
    <ol class="revs">${revs}</ol>
    ${rejected ? `<h3>Rejected requests</h3><ul class="plain">${rejected}</ul>` : ''}
    ${undone ? `<h3>Undone changes</h3><ul class="plain">${undone}</ul>` : ''}
    <div class="tl-actions">
      <button class="btn" data-action="undo" ${session.revisions.length > 1 ? '' : 'disabled'}>Undo last change</button>
      <button class="btn" data-action="restore" ${session.revisions.length > 1 ? '' : 'disabled'}>Restore scenario</button>
    </div>
    <p class="muted small">Saved in this browser (localStorage). Refresh the page — the session comes back.</p>
  </section>`;
}

export function renderDock({ session, scenario, status, parser, draft }) {
  const recent = session.conversation.slice(-24);
  const lastAssistant = recent.map((m) => m.role).lastIndexOf('assistant');
  const traceHtml = (m, open) => (m.trace?.length ? `
      <details class="trace-wrap" ${open ? 'open' : ''}>
        <summary>Agent steps (${m.trace.length})</summary>
        <ol class="trace">${m.trace.map((t) => `<li class="tr tr-${esc(t.status)}"><span class="tr-step">${esc(t.step)}</span><span class="tr-detail">${esc(t.detail)}</span></li>`).join('')}</ol>
      </details>` : '');
  const msgs = recent.map((m, i) => `
    <li class="msg msg-${m.role} ${m.tone ? `tone-${m.tone}` : ''}">
      <div class="msg-who">${m.role === 'user' ? `You${m.source && m.source !== 'typed' ? ` · ${esc(m.source)}` : ''}` : 'PlanB'}</div>
      <div class="msg-text">${esc(m.text)}</div>${traceHtml(m, i === lastAssistant)}
    </li>`).join('');
  const intro = `<li class="msg msg-assistant"><div class="msg-who">PlanB</div><div class="msg-text">Your ${esc(scenario.name.toLowerCase())} plan is ready and validated. Tell me what changed — or pick a quick command.</div></li>`;
  const chips = scenario.quickCommands.map((q) => `<button class="chip" data-action="quick" data-text="${esc(q.text)}" title="${esc(q.text)}">${esc(q.label)}</button>`).join('');
  const busy = status === 'parsing' || status === 'planning';
  const activity = session.activity.slice(-6).reverse().map((t) => `
    <li><div class="act-in">“${esc(t.input)}” <span class="muted small">${esc(t.source)}</span></div>
      <ol class="steps">${t.steps.map((st) => `<li class="step step-${esc(st.status)}"><code>${esc(st.tool)}</code> <span>${esc(st.detail)}</span>${st.ms ? ` <span class="muted small">${st.ms} ms</span>` : ''}</li>`).join('')}</ol></li>`).join('');
  return `
  <aside class="dock" aria-label="Assistant">
    <div class="dock-head">
      <div class="orb orb-${esc(status)}" aria-hidden="true"><span></span></div>
      <div><div class="dock-title">PlanB assistant</div>
        <div class="dock-status" role="status" aria-live="polite">${esc(STATUS_LABEL[status] || status)}</div></div>
    </div>
    <ol class="conversation" aria-live="polite" aria-relevant="additions">${intro}${msgs}</ol>
    <div class="chips" role="group" aria-label="Quick commands">${chips}</div>
    <form class="composer" data-form="command">
      <label for="cmd" class="sr-only">Tell PlanB what changed</label>
      <input id="cmd" name="cmd" autocomplete="off" maxlength="500" placeholder="e.g. Sam cannot help anymore" value="${esc(draft || '')}" ${busy ? 'disabled' : ''}>
      <button class="btn btn-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Send'}</button>
    </form>
    <div class="parser-note muted small">${parser.mode === 'llm' ? 'LLM output is re-validated against the shock schema before planning.' : 'Typed text is read by a limited local rule parser (not an LLM). Unsupported phrasing is reported, never guessed.'}</div>
    <details class="activity" open>
      <summary>Agent activity log</summary>
      ${activity ? `<ol class="act-list">${activity}</ol>` : '<p class="muted small">Tool steps (parse → validate → plan → validate → explain → commit) appear here.</p>'}
    </details>
  </aside>`;
}
export function renderTaskDetail({ head, taskId, nowMin }) {
  const s = head.state.scenario;
  const clock = (m) => formatClock(s, m);
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return '';
  const st = head.plan.scheduled.find((x) => x.taskId === taskId);
  const dropped = head.plan.dropped.find((d) => d.taskId === taskId);
  const facts = st ? [
    `${esc(clock(st.startMin))}–${esc(clock(st.endMin))} (${st.durationMin} min${st.durationMin < st.fullDurationMin ? `, compressed from ${st.fullDurationMin}` : ''})`,
    esc(personName(s, st.personId)),
    st.resources.length ? esc(st.resources.map((r) => resourceName(s, r)).join(', ')) : 'no equipment',
    `$${st.actualCost}`,
    esc(liveStatus(st, nowMin).replace('_', ' ')),
    st.variantId !== 'base' ? `alternative for "${esc(task.title)}"` : '',
  ].filter(Boolean) : [dropped?.cause === 'user' ? 'skipped by you' : 'dropped (optional)'];
  return `
  <div class="task-detail" role="region" aria-label="Selected task">
    <span class="prio prio-${esc(task.priority)}">${esc(task.priority)}</span>
    <strong>${esc(st?.title || task.title)}</strong>
    <span class="muted">${facts.join(' · ')}</span>
    ${task.dependsOn.length ? `<span class="muted small">after: ${task.dependsOn.map((d) => esc(s.tasks.find((t) => t.id === d)?.title)).join(', ')}</span>` : ''}
    <button class="btn btn-ghost btn-sm" data-action="select-task" data-task="${esc(taskId)}" aria-label="Clear selection">✕</button>
  </div>`;
}
