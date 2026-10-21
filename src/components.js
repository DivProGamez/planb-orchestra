// Shared view primitives: escaping, original SVG icons, badges, and the timeline canvas.
// Pure functions (data → HTML string). Every figure shown comes from engine state.

import { formatClock, formatDuration, formatSigned, personName, resourceName } from './engine/model.js';
import { REASONS, reasonLabel } from './engine/reasons.js';
import { liveStatus } from './engine/session.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const KIND_CLASS = {
  Moved: 'k-moved', Reassigned: 'k-reassigned', Shortened: 'k-shortened', Lengthened: 'k-lengthened',
  Replaced: 'k-replaced', Removed: 'k-removed', Restored: 'k-restored', Unchanged: 'k-unchanged',
};

/* ---------- Brand & icons (original SVG, no icon fonts) ---------- */

/** PlanB mark: a dashed "plan A" route that breaks, and a solid "plan B" curve that reconnects. */
export function logoSvg(size, uid) {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <defs><linearGradient id="lg-${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4cd7f6"/><stop offset="1" stop-color="#8083ff"/></linearGradient></defs>
    <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="#0d1322" stroke="url(#lg-${uid})" stroke-width="2"/>
    <path d="M9 27 H16 L22 14 H31" fill="none" stroke="#f5b041" stroke-width="2.2" stroke-dasharray="2.5 3" stroke-linecap="round" opacity=".85"/>
    <path d="M9 27 C17 27 17.5 21 21 19.5 C24.5 18 25.5 13 31 13" fill="none" stroke="url(#lg-${uid})" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="9" cy="27" r="3" fill="#4cd7f6"/><circle cx="31" cy="13" r="3" fill="#c0c1ff"/>
  </svg>`;
}

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  workspace: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h6M8 16h9"/>',
  repair: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/><path d="M9 12l2 2 4-4"/>',
  compare: '<path d="M7 4v16M17 4v16"/><path d="M3 8h8M13 16h8"/><path d="M9 6l2 2-2 2M15 14l-2 2 2 2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};

export function icon(name, size = 18, cls = '') {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

const SCENARIO_ICONS = {
  'dinner-for-six': '<circle cx="13" cy="13" r="6.5"/><circle cx="13" cy="13" r="3.2"/><path d="M3 3.5v6M5.2 3.5v6M3 7h2.2M4.1 9.5V21M22 3.5c-1.6 1-2.2 3.2-2.2 5.6h2.2V21"/>',
  'childrens-birthday': '<path d="M12 2.8c-3.4 0-6.1 2.7-6.1 6.1 0 3.9 3.4 7.2 6.1 7.2s6.1-3.3 6.1-7.2c0-3.4-2.7-6.1-6.1-6.1z"/><path d="M10.9 16.1l1.1 1.7 1.1-1.7M12 17.8c0 2.2-2.2 2.1-2.2 4.4"/><path d="M9.2 7.2c.4-1.1 1.2-1.9 2.3-2.2"/>',
  'weekend-outing': '<path d="M1.5 18c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4 2-1.4 4-1.4"/><path d="M3.5 13.2l15-4.3 2.2 1.1-15 4.3z"/><path d="M9 11.5l3.5 6"/><circle cx="18.5" cy="4.5" r="2"/>',
};

export function scenarioIcon(id, size = 22) {
  const body = SCENARIO_ICONS[id];
  if (!body) return '';
  return `<svg class="s-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const PERSON_COLORS = ['#8083ff', '#4cd7f6', '#4edea3', '#f5b041', '#f472b6'];
export function personColor(scenario, personId) {
  const i = scenario.people.findIndex((p) => p.id === personId);
  return PERSON_COLORS[(i < 0 ? 0 : i) % PERSON_COLORS.length];
}

export function avatar(scenario, personId, size = 32) {
  const name = personName(scenario, personId);
  const initials = personId ? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '·';
  const color = personId ? personColor(scenario, personId) : '#6b7a99';
  return `<span class="avatar" style="--av:${color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${esc(initials)}</span>`;
}

export function parserPill(parser, compact = false) {
  return parser.mode === 'llm'
    ? `<span class="pill pill-ok" title="Free text is parsed by ${esc(parser.model)} on the server, then re-validated against the shock schema"><span class="dot"></span>Parser: LLM ${compact ? '' : `(${esc(parser.model)}) `}+ schema check</span>`
    : `<span class="pill pill-warn" title="${esc(parser.reason || 'No LLM configured')}"><span class="dot"></span>${compact ? 'Local rules · not an LLM' : 'Parser: local rules (not an LLM)'}</span>`;
}

export function reasonBadges(reasons) {
  return reasons.map((r) => `
    <li><span class="reason tone-${esc(REASONS[r.code]?.tone || 'info')}" title="${esc(r.code)}">${esc(reasonLabel(r.code))}</span>
      <span class="evidence">${esc(r.evidence.join(' · '))}</span></li>`).join('');
}

/* ---------- Timeline canvas ---------- */

const SIZES = {
  full: { row: 58, bar: 42, res: 30, label: 176 },
  compact: { row: 38, bar: 28, res: 18, label: 104 },
};

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

export function buildLayout(state, plans, size = SIZES.full) {
  const s = state.scenario;
  const lanes = s.people.map((p) => ({ id: p.id, label: p.name, kind: 'person', person: p, rows: 1 }));
  const handsByPlan = plans.map((p) => packHandsFree((p?.scheduled || []).filter((st) => !st.personId)));
  const handsRows = Math.max(0, ...handsByPlan.map((h, i) => ((plans[i]?.scheduled || []).some((st) => !st.personId) ? h.count : 0)));
  if (handsRows > 0) lanes.push({ id: '__hands', label: 'Hands-free', kind: 'hands', rows: handsRows });
  let top = 0;
  for (const lane of lanes) { lane.top = top; lane.height = lane.rows * size.row; top += lane.height; }
  const resTop = top;
  return { lanes, handsByPlan, resTop, size, height: resTop + s.resources.length * size.res };
}

/** Row height that makes a chart fill `availablePx` (bounded so bars stay readable). */
export function fitRowHeight({ state, plans, availablePx, compact, minRow }) {
  const base = compact ? SIZES.compact : SIZES.full;
  const lanes = buildLayout(state, plans, base).lanes.reduce((n, l) => n + l.rows, 0);
  const fixed = 34 + state.scenario.resources.length * base.res + 4;
  const fitted = Math.floor((availablePx - fixed) / Math.max(1, lanes));
  return Math.max(minRow ?? base.row, Math.min(compact ? 66 : 104, fitted));
}

function pct(axis, m) {
  return ((m - axis.start) / axis.span) * 100;
}

function barBox(layout, axis, st, planIndex) {
  const lane = st.personId ? layout.lanes.find((l) => l.id === st.personId) : layout.lanes.find((l) => l.id === '__hands');
  const row = st.personId ? 0 : layout.handsByPlan[planIndex]?.placement.get(st.taskId) || 0;
  return {
    left: pct(axis, st.startMin), width: pct(axis, st.endMin) - pct(axis, st.startMin),
    top: (lane?.top || 0) + row * layout.size.row + (layout.size.row - layout.size.bar) / 2,
  };
}

function laneSub(s, lane, axis, clock) {
  if (lane.kind === 'hands') return 'equipment only';
  const p = lane.person;
  if (p.availableTo <= p.availableFrom) return 'not available';
  const parts = [];
  if (p.availableFrom > axis.start) parts.push(`from ${clock(p.availableFrom)}`);
  if (p.availableTo < axis.end) parts.push(`until ${clock(p.availableTo)}`);
  return parts.join(' · ') || 'available';
}

/**
 * opts: { state, plan, prevPlan, prevState, axis, nowMin, atMin, selectedTaskId, changed (Map taskId→entry),
 *         ghosts, animate, compact, rowH, id, kindChips, markWillChange, label }
 */
export function renderTimeline(opts) {
  const { state, plan, prevPlan, axis, nowMin, selectedTaskId, changed = new Map(), ghosts, animate, id } = opts;
  const s = state.scenario;
  const clock = (m) => formatClock(s, m);
  const base = opts.compact ? SIZES.compact : SIZES.full;
  const size = opts.rowH
    ? { ...base, row: opts.rowH, bar: opts.rowH - (opts.rowH >= 64 ? 20 : opts.rowH >= 44 ? 12 : 8), res: opts.rowH < 44 ? 20 : base.res }
    : base;
  const layout = buildLayout(state, [plan, prevPlan], size);
  // Compact charts sit in narrow cards: hourly labels so neighbouring times never collide.
  const step = axis.span > (opts.compact ? 150 : 330) ? 60 : 30;
  const ticks = [];
  for (let m = axis.start; m <= axis.end; m += step) ticks.push(m);

  const shades = layout.lanes.map((lane) => {
    let shade = '';
    if (lane.kind === 'person') {
      const p = lane.person;
      const blocks = [];
      if (p.availableFrom > axis.start) blocks.push([axis.start, Math.min(p.availableFrom, axis.end)]);
      if (p.availableTo < axis.end) blocks.push([Math.max(p.availableTo, axis.start), axis.end]);
      shade = blocks.map(([a, b]) => `<div class="unavail" style="left:${pct(axis, a)}%;width:${pct(axis, b) - pct(axis, a)}%" title="${esc(p.name)} unavailable ${esc(clock(a))}–${esc(clock(b))}">${opts.compact ? '' : '<span>unavailable</span>'}</div>`).join('');
    }
    return `<div class="lane ${lane.kind === 'hands' ? 'lane-hands' : ''}" style="top:${lane.top}px;height:${lane.height}px">${shade}</div>`;
  }).join('');

  const labels = layout.lanes.map((lane) => `
    <div class="lane-label" style="top:${lane.top}px;height:${lane.height}px">
      ${lane.kind === 'person' ? avatar(s, lane.person.id, opts.compact ? 22 : 32) : `<span class="avatar avatar-hands" style="width:${opts.compact ? 22 : 32}px;height:${opts.compact ? 22 : 32}px">${icon('box', opts.compact ? 12 : 16)}</span>`}
      <span class="ll-text"><span class="ll-name">${esc(lane.label)}</span>${opts.compact ? '' : `<span class="ll-sub ${lane.kind === 'person' && (lane.person.availableTo < axis.end || lane.person.availableFrom > axis.start) ? 'warn' : ''}">${esc(laneSub(s, lane, axis, clock))}</span>`}</span>
    </div>`).join('')
    + s.resources.map((r, i) => `
    <div class="lane-label res-label" style="top:${layout.resTop + i * size.res}px;height:${size.res}px">
      ${opts.compact ? '' : icon('box', 13)}<span>${esc(r.name)} <em class="${r.available ? '' : 'down'}">${r.available ? `×${r.capacity}` : 'down'}</em></span>
    </div>`).join('');

  const resRows = s.resources.map((r, i) => {
    const top = layout.resTop + i * size.res;
    const list = plan.scheduled.filter((st) => st.resources.includes(r.id));
    const packed = packHandsFree(list);
    const uses = list.map((st) => `<div class="res-use" style="left:${pct(axis, st.startMin)}%;width:${pct(axis, st.endMin) - pct(axis, st.startMin)}%;top:${(packed.placement.get(st.taskId) / packed.count) * 100 + 8 / packed.count}%;height:${84 / packed.count}%" title="${esc(r.name)}: ${esc(st.title)} ${esc(clock(st.startMin))}–${esc(clock(st.endMin))}">${opts.compact ? '' : `<span>${esc(st.title)}</span>`}</div>`).join('');
    const down = r.available ? '' : `<div class="res-down" style="left:${pct(axis, opts.atMin ?? axis.start)}%;right:0" title="${esc(r.name)} unavailable"></div>`;
    return `<div class="res-row" style="top:${top}px;height:${size.res}px">${down}${uses}</div>`;
  }).join('');

  const prevById = new Map((prevPlan?.scheduled || []).map((st) => [st.taskId, st]));
  const bars = plan.scheduled.map((st) => {
    const box = barBox(layout, axis, st, 0);
    const status = liveStatus(st, nowMin);
    const entry = changed.get(st.taskId);
    const kind = entry?.kind;
    const isChanged = kind && kind !== 'Unchanged';
    const prev = prevById.get(st.taskId);
    const from = animate && prev ? barBox(layout, axis, prev, 1) : null;
    const task = s.tasks.find((t) => t.id === st.taskId);
    const cls = [
      'bar', `st-${status}`, `prio-${task?.priority}`, st.variantId !== 'base' ? 'is-alt' : '',
      st.durationMin < st.fullDurationMin ? 'is-compressed' : '', !st.personId ? 'is-hands' : '',
      isChanged && !opts.markWillChange ? `is-changed ${KIND_CLASS[kind]}` : '', isChanged && opts.markWillChange ? 'will-change' : '',
      selectedTaskId === st.taskId ? 'is-selected' : '', animate && !prev ? 'is-new' : '',
    ].filter(Boolean).join(' ');
    const label = `${st.title}, ${clock(st.startMin)} to ${clock(st.endMin)}, ${personName(s, st.personId)}, ${status.replace('_', ' ')}${isChanged ? `, ${kind}` : ''}`;
    const color = st.personId ? personColor(s, st.personId) : '#6b7a99';
    const chip = opts.kindChips && isChanged && !opts.markWillChange
      ? `<span class="bar-chip ${KIND_CLASS[kind]}">${esc(kind)}${entry.deltaMinutes ? ` ${esc(formatSigned(entry.deltaMinutes))}` : ''}</span>` : '';
    return `<button class="${cls}" data-action="select-task" data-task="${esc(st.taskId)}" style="--lane:${color};left:${box.left}%;width:${box.width}%;top:${box.top}px;height:${size.bar}px"
      ${from ? `data-from-left="${from.left}" data-from-width="${from.width}" data-from-top="${from.top}"` : ''}
      aria-label="${esc(label)}" title="${esc(label)}${st.actualCost ? ` · $${st.actualCost}` : ''}">
      ${chip}<span class="bar-title">${status === 'done' ? '✓ ' : ''}${esc(st.title)}</span>
      ${opts.compact ? '' : `<span class="bar-meta">${esc(clock(st.startMin))} · ${st.durationMin}m${st.durationMin < st.fullDurationMin ? ` (was ${st.fullDurationMin})` : ''}${st.variantId !== 'base' ? ' · alt' : ''}</span>`}
    </button>`;
  }).join('');

  const ghostHtml = ghosts && prevPlan ? [...changed.entries()]
    .filter(([, e]) => e.kind !== 'Unchanged' && e.kind !== 'Restored')
    .map(([taskId, e]) => {
      const prev = prevById.get(taskId);
      if (!prev) return '';
      const box = barBox(layout, axis, prev, 1);
      return `<div class="ghost ${KIND_CLASS[e.kind]}" style="left:${box.left}%;width:${box.width}%;top:${box.top}px;height:${size.bar}px" aria-hidden="true"><span>${e.kind === 'Removed' ? 'removed' : 'was'} · ${esc(prev.title)}</span></div>`;
    }).join('') : '';

  const prevDeadlineMin = opts.prevState && opts.prevState.scenario.deadlineMin !== s.deadlineMin ? opts.prevState.scenario.deadlineMin : null;
  const deadline = `<div class="marker marker-deadline ${pct(axis, s.deadlineMin) > 78 ? 'flip' : ''}" style="left:${pct(axis, s.deadlineMin)}%"
      ${animate && prevDeadlineMin !== null ? `data-from-left="${pct(axis, prevDeadlineMin)}"` : ''}><span>${icon('flag', 11)} ${esc(s.deadlineLabel || 'deadline')} ${esc(clock(s.deadlineMin))}</span></div>`;
  const prevDeadline = prevDeadlineMin !== null && !opts.compact
    ? `<div class="marker marker-old" style="left:${pct(axis, prevDeadlineMin)}%"><span>was ${esc(clock(prevDeadlineMin))}</span></div>` : '';
  const now = nowMin > axis.start && nowMin < axis.end
    ? `<div class="marker marker-now" style="left:${pct(axis, nowMin)}%"><span>${esc(clock(nowMin))} now</span></div>` : '';

  return `
  <figure class="tl ${opts.compact ? 'tl-compact' : ''} ${size.row >= 70 ? 'tall' : ''} ${!opts.compact && size.row < 48 ? 'short' : ''}" ${id ? `id="${esc(id)}"` : ''} aria-label="${esc(opts.label || 'Plan timeline')}" style="--label-w:${size.label}px">
    <div class="tl-grid">
      <div class="tl-labels" style="height:${layout.height + 34}px"><div class="tl-corner">${opts.compact ? '' : 'People &amp; equipment'}</div><div class="tl-labels-body" style="height:${layout.height}px">${labels}</div></div>
      <div class="tl-main">
        <div class="tl-axis">${ticks.map((m) => `<span ${m === axis.end ? 'class="axis-end" ' : ''}style="left:${pct(axis, m)}%">${esc(clock(m))}</span>`).join('')}</div>
        <div class="tl-body" style="height:${layout.height}px">
          ${ticks.map((m) => `<div class="tick" style="left:${pct(axis, m)}%"></div>`).join('')}
          ${shades}${resRows}${ghostHtml}${bars}${prevDeadline}${deadline}${now}
          <div class="sweep" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  </figure>`;
}

/** Time axis covering every state/plan passed in, rounded to half hours. */
export function axisFor(states, plans) {
  const start = states[0].scenario.startMin;
  const end = Math.ceil((Math.max(...states.map((x) => x.scenario.deadlineMin), ...plans.filter(Boolean).map((p) => p.endMin || 0)) + 10) / 30) * 30;
  return { start, end, span: end - start };
}

/* ---------- Structured change form (same engine path as typed requests) ---------- */

export const MANUAL_TYPES = [
  ['deadline_earlier', 'Deadline earlier by…'], ['person_unavailable', 'Person becomes unavailable'], ['person_delayed', 'Person arrives late by…'],
  ['resource_unavailable', 'Equipment breaks'], ['resource_restored', 'Equipment works again'], ['budget_reduced', 'Budget reduced to…'], ['duration_increase', 'Task takes longer…'],
];

export function manualParam(type, head) {
  const s = head.state.scenario;
  const people = s.people.filter((p) => p.availableTo > p.availableFrom).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  switch (type) {
    case 'deadline_earlier':
      return `<input type="number" min="5" max="240" step="5" value="30" data-field="m-minutes" aria-label="Minutes earlier"> <span class="muted">min</span>`;
    case 'person_unavailable':
      return `<select data-field="m-person" aria-label="Person">${people}</select>`;
    case 'resource_unavailable':
      return `<select data-field="m-resource" aria-label="Equipment">${s.resources.filter((r) => r.available).map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`;
    case 'resource_restored': {
      const down = s.resources.filter((r) => !r.available);
      return down.length
        ? `<select data-field="m-resource" aria-label="Equipment">${down.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`
        : '<span class="muted small">No equipment is down</span>';
    }
    case 'person_delayed':
      return `<select data-field="m-person" aria-label="Person">${people}</select>
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

/* ---------- Small shared blocks ---------- */

export function kpiCard({ label, value, sub, iconName, tone = '', extra = '' }) {
  return `
  <div class="kpi ${tone}">
    <div class="kpi-top"><span class="kpi-label">${esc(label)}</span>${iconName ? `<span class="kpi-icon">${icon(iconName, 16)}</span>` : ''}</div>
    <div class="kpi-value">${value}</div>
    ${extra}
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

export function delta(value, unit = '', invert = false) {
  if (value === null || value === undefined || value === 0) return '';
  const good = invert ? value < 0 : value > 0;
  const sign = value > 0 ? '+' : '−';
  return `<span class="delta ${good ? 'good' : 'bad'}">${sign}${unit === '$' ? '$' : ''}${Math.abs(value)}${unit === 'min' ? ' min' : ''}${unit === '%' ? ' pts' : ''}</span>`;
}

export function formatWindow(scenario, a, b) {
  return `${formatClock(scenario, a)}–${formatClock(scenario, b)}`;
}

export { formatClock, formatDuration, formatSigned, personName, resourceName, liveStatus, reasonLabel, REASONS };
