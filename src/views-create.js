// "Create your own plan": an editor for a user-defined scenario. Pure view functions; every
// verdict shown here (problems, feasibility, the preview chart) comes from buildScenario(),
// validateScenario() and the real scheduler via the controller.

import { esc, icon, renderTimeline, formatDuration, formatClock } from './components.js';
import { PRIORITY_OPTIONS, LIMITS } from './data/custom.js';

const field = (id, label, input, cls = '') => `<label class="b-field ${cls}" for="${id}"><span class="kpi-label">${label}</span>${input}</label>`;
const chip = (on, attrs, text, title) => `<button type="button" class="b-chip ${on ? 'is-on' : ''}" aria-pressed="${on}" ${attrs} title="${esc(title || text)}">${on ? icon('check', 11) : ''}<span>${esc(text)}</span></button>`;

export function renderCreate(ctx) {
  const b = ctx.ui.builder;
  const d = b.draft;
  const taskLabel = (t, i) => (t.title || `Task ${i + 1}`);
  const people = d.people.map((p, i) => `
    <li class="b-row" data-row="${esc(p.key)}">
      <span class="b-index mono">${i + 1}</span>
      ${field(`b-p-${p.key}-name`, 'Name', `<input id="b-p-${p.key}-name" data-b="people.${i}.name" value="${esc(p.name)}" maxlength="${LIMITS.name}" placeholder="e.g. Sam" autocomplete="off">`, 'grow')}
      ${field(`b-p-${p.key}-from`, 'Available from', `<input type="time" id="b-p-${p.key}-from" data-b="people.${i}.from" value="${esc(p.from)}">`)}
      ${field(`b-p-${p.key}-to`, 'until', `<input type="time" id="b-p-${p.key}-to" data-b="people.${i}.to" value="${esc(p.to)}">`)}
      <button type="button" class="btn btn-quiet btn-icon" data-action="b-remove" data-list="people" data-key="${esc(p.key)}" aria-label="Remove ${esc(p.name || `person ${i + 1}`)}">${icon('trash', 15)}</button>
    </li>`).join('');
  const resources = d.resources.map((r, i) => `
    <li class="b-row" data-row="${esc(r.key)}">
      <span class="b-index mono">${i + 1}</span>
      ${field(`b-r-${r.key}-name`, 'Equipment', `<input id="b-r-${r.key}-name" data-b="resources.${i}.name" value="${esc(r.name)}" maxlength="${LIMITS.name}" placeholder="e.g. Oven" autocomplete="off">`, 'grow')}
      ${field(`b-r-${r.key}-cap`, 'Capacity', `<input type="number" min="1" max="20" id="b-r-${r.key}-cap" data-b="resources.${i}.capacity" value="${esc(r.capacity)}">`, 'narrow')}
      <button type="button" class="btn btn-quiet btn-icon" data-action="b-remove" data-list="resources" data-key="${esc(r.key)}" aria-label="Remove ${esc(r.name || `equipment ${i + 1}`)}">${icon('trash', 15)}</button>
    </li>`).join('');
  const tasks = d.tasks.map((t, i) => {
    const earlier = d.tasks.slice(0, i);
    const deps = earlier.filter((x) => t.dependsOn.includes(x.key));
    return `
    <li class="b-task" data-row="${esc(t.key)}">
      <div class="b-row">
        <span class="b-index mono">${i + 1}</span>
        ${field(`b-t-${t.key}-title`, 'Task', `<input id="b-t-${t.key}-title" data-b="tasks.${i}.title" value="${esc(t.title)}" maxlength="${LIMITS.title}" placeholder="e.g. Buy groceries" autocomplete="off">`, 'grow')}
        ${field(`b-t-${t.key}-dur`, 'Minutes', `<input type="number" min="1" max="600" id="b-t-${t.key}-dur" data-b="tasks.${i}.duration" value="${esc(t.duration)}">`, 'narrow')}
        ${field(`b-t-${t.key}-min`, 'At least', `<input type="number" min="1" max="600" id="b-t-${t.key}-min" data-b="tasks.${i}.minDuration" value="${esc(t.minDuration)}" title="Shortest acceptable duration; equal to Minutes means it cannot be shortened">`, 'narrow')}
        ${field(`b-t-${t.key}-cost`, 'Cost $', `<input type="number" min="0" max="100000" id="b-t-${t.key}-cost" data-b="tasks.${i}.cost" value="${esc(t.cost)}">`, 'narrow')}
        ${field(`b-t-${t.key}-prio`, 'Priority', `<select id="b-t-${t.key}-prio" data-b="tasks.${i}.priority">${PRIORITY_OPTIONS.map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>`, 'narrow')}
        <span class="b-moves">
          <button type="button" class="btn btn-quiet btn-icon" data-action="b-move" data-key="${esc(t.key)}" data-dir="-1" aria-label="Move ${esc(taskLabel(t, i))} up" ${i === 0 ? 'disabled' : ''}>${icon('arrow', 13)}</button>
          <button type="button" class="btn btn-quiet btn-icon" data-action="b-remove" data-list="tasks" data-key="${esc(t.key)}" aria-label="Remove ${esc(taskLabel(t, i))}">${icon('trash', 15)}</button>
        </span>
      </div>
      <div class="b-chips-row"><span class="kpi-label">Who can do it</span>
        ${d.people.map((p, j) => chip(t.people.includes(p.key), `data-action="b-toggle" data-key="${esc(t.key)}" data-list="people" data-ref="${esc(p.key)}"`, p.name || `Person ${j + 1}`)).join('')}
        ${t.people.length ? '' : '<span class="muted small">nobody: runs on its own with its equipment</span>'}
      </div>
      ${d.resources.length ? `<div class="b-chips-row"><span class="kpi-label">Equipment</span>
        ${d.resources.map((r, j) => chip(t.resources.includes(r.key), `data-action="b-toggle" data-key="${esc(t.key)}" data-list="resources" data-ref="${esc(r.key)}"`, r.name || `Equipment ${j + 1}`)).join('')}</div>` : ''}
      ${earlier.length ? `<details class="b-deps" ${b.openDeps === t.key ? 'open' : ''} data-key="${esc(t.key)}">
        <summary>Starts after: ${deps.length ? esc(deps.map((x) => x.title || '?').join(', ')) : '<span class="muted">nothing</span>'}</summary>
        <div class="b-chips-row">${earlier.map((x, j) => chip(t.dependsOn.includes(x.key), `data-action="b-toggle" data-key="${esc(t.key)}" data-list="dependsOn" data-ref="${esc(x.key)}"`, x.title || `Task ${j + 1}`)).join('')}</div>
      </details>` : ''}
    </li>`;
  }).join('');
  return `
  <div class="view view-create" id="main">
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow"><span class="dot"></span>${d.id ? 'Editing your plan' : 'New plan'}</div>
        <h1>Create your own plan</h1>
        <p class="ph-sub">Your people, equipment, tasks, dependencies, budget and deadline — planned and validated by the same engine as the built-in scenarios. Saved in this browser only.</p>
      </div>
      <div class="ph-actions">
        <button class="btn btn-quiet" data-action="b-example">${icon('layers', 15)}<span>Load example (20 tasks · 6 people)</span></button>
        <button class="btn btn-quiet" data-action="b-io" data-mode="import">${icon('upload', 15)}<span>Import</span></button>
        <button class="btn btn-quiet" data-action="b-io" data-mode="export">${icon('download', 15)}<span>Export</span></button>
        <button class="btn btn-quiet" data-action="b-new">${icon('plus', 15)}<span>New</span></button>
      </div>
    </div>
    ${b.io ? renderIo(b) : ''}
    <div class="create-grid">
      <div class="create-main">
        <section class="card" aria-labelledby="b-event">
          <div class="card-head"><h2 id="b-event">${icon('flag', 16)} Event</h2></div>
          <div class="b-grid">
            ${field('b-name', 'Plan name', `<input id="b-name" data-b="name" value="${esc(d.name)}" maxlength="${LIMITS.name}" placeholder="e.g. Grandma’s 80th birthday" autocomplete="off">`, 'span2')}
            ${field('b-tagline', 'One-line description', `<input id="b-tagline" data-b="tagline" value="${esc(d.tagline)}" maxlength="120" placeholder="optional" autocomplete="off">`, 'span2')}
            ${field('b-start', 'Start', `<input type="time" id="b-start" data-b="start" value="${esc(d.start)}">`)}
            ${field('b-deadline', 'Deadline', `<input type="time" id="b-deadline" data-b="deadline" value="${esc(d.deadline)}">`)}
            ${field('b-dlabel', 'Deadline means', `<input id="b-dlabel" data-b="deadlineLabel" value="${esc(d.deadlineLabel)}" maxlength="30" placeholder="e.g. guests arrive" autocomplete="off">`)}
            ${field('b-budget', 'Budget $', `<input type="number" min="0" max="${LIMITS.budget}" id="b-budget" data-b="budget" value="${esc(d.budget)}">`)}
          </div>
        </section>
        <section class="card" aria-labelledby="b-people">
          <div class="card-head"><h2 id="b-people">${icon('people', 16)} People <span class="muted small">${d.people.length}/${LIMITS.people}</span></h2>
            <button class="btn btn-sm" data-action="b-add" data-list="people" ${d.people.length >= LIMITS.people ? 'disabled' : ''}>${icon('plus', 13)}<span>Add person</span></button></div>
          <ol class="b-list">${people || '<li class="muted small">No people yet.</li>'}</ol>
        </section>
        <section class="card" aria-labelledby="b-res">
          <div class="card-head"><h2 id="b-res">${icon('box', 16)} Equipment <span class="muted small">${d.resources.length}/${LIMITS.resources} · optional</span></h2>
            <button class="btn btn-sm" data-action="b-add" data-list="resources" ${d.resources.length >= LIMITS.resources ? 'disabled' : ''}>${icon('plus', 13)}<span>Add equipment</span></button></div>
          <ol class="b-list">${resources || '<li class="muted small">Shared things with limited capacity (an oven, a car, a projector). Optional.</li>'}</ol>
        </section>
        <section class="card" aria-labelledby="b-tasks">
          <div class="card-head"><h2 id="b-tasks">${icon('list', 16)} Tasks <span class="muted small">${d.tasks.length}/${LIMITS.tasks}</span></h2>
            <button class="btn btn-sm" data-action="b-add" data-list="tasks" ${d.tasks.length >= LIMITS.tasks ? 'disabled' : ''}>${icon('plus', 13)}<span>Add task</span></button></div>
          <ol class="b-list b-tasks">${tasks || '<li class="muted small">No tasks yet.</li>'}</ol>
        </section>
      </div>
      <aside class="create-side" id="builder-side">${renderBuilderSide(ctx)}</aside>
    </div>
  </div>`;
}

/** The verdict panel; re-rendered on its own while typing so inputs keep focus. */
export function renderBuilderSide(ctx) {
  const b = ctx.ui.builder;
  const r = b.result;
  const pv = b.preview;
  let status;
  if (!r) status = '';
  else if (!r.ok) {
    status = `<div class="cc-impact bad">${icon('alert', 16)}<div><strong>Fix ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'} to plan</strong>
      <ul class="b-errors">${r.errors.slice(0, 8).map((e) => `<li>${esc(e.message)}</li>`).join('')}${r.errors.length > 8 ? `<li class="muted">…and ${r.errors.length - 8} more</li>` : ''}</ul></div></div>`;
  } else if (pv && !pv.ok) {
    status = `<div class="cc-impact bad">${icon('alert', 16)}<div><strong>No feasible plan for these constraints</strong>
      <ul class="b-errors">${pv.errors.map((e) => `<li><span class="proof proof-${esc(e.proof || 'proven')}">${e.proof === 'search' ? 'Bounded search' : 'Proven'}</span> ${esc(e.message)}</li>`).join('')}</ul></div></div>`;
  } else if (pv) {
    const p = pv.plan;
    const s = pv.state.scenario;
    status = `<div class="cc-impact ok">${icon('check', 16)}<div><strong>Feasible baseline</strong> · ${p.scheduled.length} of ${s.tasks.length} tasks scheduled · ${p.validation.checks} checks pass<br>
      finishes ${esc(formatClock(s, p.endMin))} (${esc(formatDuration(p.slackMin))} before ${esc(s.deadlineLabel)}) · $${p.totalCost} / $${s.budgetCap}${p.dropped.length ? ` · ${p.dropped.length} optional task${p.dropped.length === 1 ? '' : 's'} left out` : ''}</div></div>`;
  }
  const chart = pv && pv.ok ? (() => {
    const s = pv.state.scenario;
    const end = Math.ceil((Math.max(s.deadlineMin, pv.plan.endMin) + 10) / 30) * 30;
    return `<div class="b-preview">${renderTimeline({ state: pv.state, plan: pv.plan, axis: { start: s.startMin, end, span: end - s.startMin }, nowMin: s.startMin, compact: true, id: 'tl-builder', label: 'Preview of your plan' })}</div>`;
  })() : '';
  return `
  <section class="card b-side" aria-labelledby="b-verdict" aria-live="polite">
    <div class="card-head"><h2 id="b-verdict">${icon('shield', 16)} Engine check</h2><span class="muted small">re-planned as you edit</span></div>
    ${status}
    ${chart}
    <div class="b-actions">
      <button class="btn btn-primary btn-lg" data-action="b-save" data-build="1" ${r && r.ok && pv && pv.ok ? '' : 'disabled'}>${icon('play', 16)}<span>Save &amp; build plan</span></button>
      <button class="btn" data-action="b-save" ${r && r.ok ? '' : 'disabled'}>${icon('check', 15)}<span>${b.draft.id ? 'Save changes' : 'Save to my plans'}</span></button>
      ${b.draft.id ? `<button class="btn btn-quiet" data-action="b-delete" data-confirm="${b.confirmDelete ? '1' : ''}">${icon('trash', 15)}<span>${b.confirmDelete ? 'Confirm: delete this plan' : 'Delete plan'}</span></button>` : ''}
    </div>
    ${b.notice ? `<p class="notice small" role="status">${esc(b.notice)}</p>` : ''}
    <p class="muted small">Saved plans appear on Scenarios &amp; Home next to the built-in ones. Changes, Before/After, Undo and history work the same way.</p>
  </section>`;
}

function renderIo(b) {
  const exporting = b.io.mode === 'export';
  return `
  <section class="card b-io" aria-labelledby="b-io-title">
    <div class="card-head"><h2 id="b-io-title">${icon(exporting ? 'download' : 'upload', 16)} ${exporting ? 'Export this plan (JSON)' : 'Import a plan (JSON)'}</h2>
      <button class="btn btn-quiet btn-icon" data-action="b-io" data-mode="close" aria-label="Close">${icon('x', 15)}</button></div>
    <textarea id="b-io-text" rows="8" ${exporting ? 'readonly' : ''} placeholder="Paste a plan exported from PlanB Orchestra">${esc(b.io.text || '')}</textarea>
    ${exporting ? '<p class="muted small">Copy this text to keep or share the plan.</p>' : `<div class="b-actions"><button class="btn btn-primary" data-action="b-import">${icon('upload', 15)}<span>Load into editor</span></button>${b.io.error ? `<span class="notice small" role="alert">${esc(b.io.error)}</span>` : ''}</div>`}
  </section>`;
}
