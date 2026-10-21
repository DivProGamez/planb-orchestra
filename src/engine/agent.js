// Agent loop: parsed intent → validated shocks → plan tool → validate tool → diff/explain →
// commit or ask the user to choose a relaxation. Every step is recorded in the activity log.
// Replies are composed only from plan data and reason codes.

import { formatClock, formatDuration, personName } from './model.js';
import { reasonLabel } from './reasons.js';
import {
  currentRevision, proposeShocks, commitProposal, recordRejected, undoLast, restoreBaseline,
  advanceClock, appendLog, liveStatus,
} from './session.js';
import { freezeAt, validateShocks } from './shocks.js';

const nowMs = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

function stepper() {
  const steps = [];
  return {
    steps,
    run(tool, fn, detailFn) {
      const t0 = nowMs();
      try {
        const result = fn();
        steps.push({ tool, status: 'ok', ms: Math.round((nowMs() - t0) * 10) / 10, detail: detailFn ? detailFn(result) : '' });
        return result;
      } catch (err) {
        steps.push({ tool, status: 'error', ms: Math.round((nowMs() - t0) * 10) / 10, detail: err.message });
        throw err;
      }
    },
    note(tool, status, detail) {
      steps.push({ tool, status, ms: 0, detail });
    },
  };
}

export function statusAnswer(session) {
  const head = currentRevision(session);
  const s = head.state.scenario;
  const plan = head.plan;
  const clock = (m) => formatClock(s, m);
  const last = [...plan.scheduled].sort((a, b) => b.endMin - a.endMin)[0];
  const remaining = plan.scheduled.filter((st) => liveStatus(st, session.nowMin) !== 'done');
  const label = s.deadlineLabel || 'the deadline';
  return `Yes — the current plan is validated (${plan.validation.checks} checks, 0 violations). `
    + `The last task, "${last.title}", ends ${clock(last.endMin)}, ${formatDuration(s.deadlineMin - last.endMin)} before ${label} at ${clock(s.deadlineMin)}. `
    + `${remaining.length} task${remaining.length === 1 ? '' : 's'} remain; spend is $${plan.totalCost} of $${s.budgetCap}.`;
}

export function explainCommit(proposal) {
  const s = proposal.state.scenario;
  const clock = (m) => formatClock(s, m);
  const changed = proposal.diff.changed;
  const parts = [`Replanned for: ${proposal.descriptions.join('; ')}.`];
  if (changed.length === 0) parts.push('No task needed to change.');
  else {
    const top = changed.slice(0, 3).map((e) => {
      const codes = e.reasons.map((r) => reasonLabel(r.code).toLowerCase()).join(', ');
      if (e.kind === 'Replaced') return `"${e.beforeTitle}" → "${e.title}" (${codes})`;
      if (e.kind === 'Removed') return `dropped "${e.title}" (${codes})`;
      if (e.kind === 'Reassigned') return `"${e.title}" → ${personName(s, e.after.personId)} (${codes})`;
      return `"${e.title}" ${e.kind.toLowerCase()} (${codes})`;
    });
    parts.push(`${changed.length} task${changed.length === 1 ? '' : 's'} changed: ${top.join('; ')}${changed.length > 3 ? '; …' : ''}.`);
  }
  parts.push(`Everything finishes ${clock(proposal.plan.endMin)} (deadline ${clock(s.deadlineMin)}), $${proposal.plan.totalCost} of $${s.budgetCap}. Independently validated: ${proposal.plan.validation.checks} checks passed.`);
  return parts.join(' ');
}

export function explainRejection(proposal) {
  const lines = proposal.plan.violations.slice(0, 3).map((v) => `${v.message}.`);
  const opts = proposal.options.length
    ? `I verified ${proposal.options.length} option${proposal.options.length === 1 ? '' : 's'} that would work — nothing changes until you pick one.`
    : 'None of the single relaxations I can check restores feasibility. Your current plan is unchanged.';
  return `No feasible plan for: ${proposal.descriptions.join('; ')}. ${lines.join(' ')} ${opts}`;
}

const HELP = 'I can replan when the deadline moves earlier, someone becomes unavailable, equipment breaks, the budget shrinks, or a task runs long. '
  + 'Try: "Guests will arrive 60 minutes earlier. The oven is broken.", "Sam cannot help anymore.", "Our budget is now $55.", '
  + '"Advance the clock 30 minutes", "Can we still serve on time?", or "Undo the last change."';

/**
 * Runs one agent turn. `parsed` comes from the local parser or the validated LLM adapter.
 * Returns { session, reply: {text, tone}, steps, proposal }.
 */
export function runAgentTurn(session, input, parsed, { now = Date.now() } = {}) {
  const st = stepper();
  const source = parsed.source || 'typed';
  st.note('parse_intent', parsed.intent === 'unknown' ? 'warn' : 'ok',
    `${{ llm: 'LLM adapter (schema-validated)', form: 'Structured form' }[parsed.parser] || 'Local rule parser (limited)'} → ${parsed.intent}${parsed.shocks?.length ? ` · ${parsed.shocks.map((s) => s.type).join(', ')}` : ''}`);
  let next = session;
  let reply;
  let proposal = null;

  switch (parsed.intent) {
    case 'shocks': {
      const head = currentRevision(session);
      const check = st.run('validate_shocks', () => validateShocks(parsed.shocks, freezeAt(head.state, head.plan, session.nowMin)),
        (r) => (r.ok ? `${r.shocks.length} change(s) accepted by schema` : r.errors.join('; ')));
      if (!check.ok) {
        reply = { tone: 'failure', text: `I can't apply that: ${check.errors.join('; ')}. Your plan is unchanged.` };
        break;
      }
      st.note('inspect_session', 'ok', `Revision ${head.id} · clock ${formatClock(head.state.scenario, session.nowMin)} · ${Object.keys(head.state.committed).length} task(s) already started/done`);
      proposal = st.run('plan_schedule', () => proposeShocks(session, parsed.shocks, { source }),
        (p) => (p.ok ? `${p.plan.search.configsTried} configuration(s) searched in ${p.plan.search.ms} ms → ${p.plan.feasible ? 'feasible' : 'infeasible'}` : p.errors.join('; ')));
      if (!proposal.ok) {
        reply = { tone: 'failure', text: `I can't apply that: ${proposal.errors.join('; ')}.` };
        proposal = null;
        break;
      }
      if (proposal.feasible) {
        st.note('validate_plan', 'ok', `validatePlan(): ${proposal.plan.validation.checks} checks, 0 violations`);
        st.note('explain_diff', 'ok', `${proposal.diff.changed.length} changed · ${proposal.diff.entries.length - proposal.diff.changed.length} unchanged · codes: ${[...new Set(proposal.diff.changed.flatMap((e) => e.reasons.map((r) => r.code)))].join(', ') || 'none'}`);
        next = commitProposal(session, proposal, { now });
        st.note('commit_revision', 'ok', `Committed ${currentRevision(next).id}`);
        reply = { tone: 'done', text: explainCommit(proposal) };
      } else {
        st.note('validate_plan', 'warn', `No plan passed: ${proposal.plan.violations.map((v) => v.code).join(', ')}`);
        st.note('suggest_relaxations', 'ok', `${proposal.options.length} verified option(s): ${proposal.options.map((o) => o.label).join(' | ') || 'none'}`);
        next = recordRejected(session, proposal, { now });
        st.note('commit_revision', 'skipped', 'Nothing committed — waiting for your decision');
        reply = { tone: 'failure', text: explainRejection(proposal) };
      }
      break;
    }
    case 'undo': {
      const res = st.run('undo_revision', () => undoLast(session), (r) => (r.ok ? `Removed ${r.removed.id}` : r.message));
      next = res.session;
      reply = res.ok
        ? { tone: 'done', text: `Undone: ${res.removed.label}. Back to revision ${currentRevision(next).id}.` }
        : { tone: 'failure', text: res.message };
      break;
    }
    case 'restore': {
      const res = st.run('restore_baseline', () => restoreBaseline(session), (r) => `Removed ${r.removedCount} revision(s)`);
      next = res.session;
      reply = { tone: 'done', text: `Restored the original plan (${res.removedCount} revision${res.removedCount === 1 ? '' : 's'} removed; the history log keeps them marked as undone).` };
      break;
    }
    case 'advance': {
      next = st.run('advance_clock', () => advanceClock(session, parsed.minutes), (s) => `Clock → ${formatClock(currentRevision(s).state.scenario, s.nowMin)}`);
      const s = currentRevision(next).state.scenario;
      reply = { tone: 'done', text: `Simulation clock is now ${formatClock(s, next.nowMin)}. Tasks that have started will be treated as fixed when the next change arrives.` };
      break;
    }
    case 'status':
      st.note('inspect_session', 'ok', `Revision ${currentRevision(session).id}`);
      reply = { tone: 'done', text: statusAnswer(session) };
      break;
    case 'help':
      reply = { tone: 'done', text: HELP };
      break;
    case 'empty':
      reply = { tone: 'failure', text: 'Type a change, a question, or pick a quick command.' };
      break;
    default:
      reply = { tone: 'failure', text: `I couldn't map that to a supported change${parsed.notes?.length ? ` (${parsed.notes.join(' ')})` : ''}. ${HELP}` };
  }

  const turn = { at: now, input, source, parser: parsed.parser, intent: parsed.intent, steps: st.steps, tone: reply.tone };
  next = appendLog(next, 'activity', turn);
  next = appendLog(next, 'conversation', { role: 'user', text: input, source, at: now });
  next = appendLog(next, 'conversation', { role: 'assistant', text: reply.text, tone: reply.tone, at: now });
  return { session: next, reply, steps: st.steps, proposal };
}

/** Applies a user-chosen relaxation option: original shocks + relaxation, re-planned and committed. */
export function applyOption(session, proposal, option, { now = Date.now() } = {}) {
  const raw = [...proposal.shocks.map(({ type, payload }) => ({ type, payload })), ...option.shocks];
  const st = stepper();
  st.note('user_confirmed', 'ok', option.label);
  const next = st.run('plan_schedule', () => proposeShocks(session, raw, { source: proposal.source }),
    (p) => (p.ok ? `${p.plan.feasible ? 'feasible' : 'infeasible'}` : p.errors.join('; ')));
  if (!next.ok || !next.feasible) {
    const reply = { tone: 'failure', text: 'That option no longer produces a feasible plan; nothing was changed.' };
    return { session: appendLog(session, 'conversation', { role: 'assistant', text: reply.text, tone: reply.tone, at: now }), reply, steps: st.steps };
  }
  st.note('validate_plan', 'ok', `validatePlan(): ${next.plan.validation.checks} checks, 0 violations`);
  let committed = commitProposal(session, next, { now });
  st.note('commit_revision', 'ok', `Committed ${currentRevision(committed).id}`);
  const reply = { tone: 'done', text: explainCommit(next) };
  committed = appendLog(committed, 'activity', { at: now, input: `Option: ${option.label}`, source: 'confirm', parser: 'none', intent: 'option', steps: st.steps, tone: 'done' });
  committed = appendLog(committed, 'conversation', { role: 'user', text: `Apply: ${option.label}`, source: 'confirm', at: now });
  committed = appendLog(committed, 'conversation', { role: 'assistant', text: reply.text, tone: reply.tone, at: now });
  return { session: committed, reply, steps: st.steps, proposal: next };
}
