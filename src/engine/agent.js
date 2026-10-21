// Agent loop: parsed intent → validated shocks → plan tool → validate tool → diff/explain →
// commit or ask the user to choose a relaxation. Every step is recorded in the activity log.
// Replies are composed only from plan data and reason codes.

import { formatClock, formatDuration, personName } from './model.js';
import { reasonLabel } from './reasons.js';
import {
  currentRevision, proposeShocks, commitProposal, recordRejected, undoLast, restoreBaseline,
  advanceClock, appendLog, liveStatus,
} from './session.js';
import { freezeAt, validateShocks, SHOCK_TYPES } from './shocks.js';

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

const PARSER_LABEL = { llm: 'LLM adapter, schema-validated', form: 'structured form', local: 'local rule parser (limited)' };
const INTENT_LABEL = {
  shocks: 'change request', undo: 'undo', restore: 'restore the original plan', advance: 'advance the clock',
  status: 'status question', help: 'help request', unknown: 'not understood', empty: 'empty input',
};

function intentStep(parsed) {
  const changes = (parsed.shocks || []).map((sh) => SHOCK_TYPES[sh.type]?.label || sh.type);
  return {
    step: 'Intent detected',
    status: parsed.intent === 'unknown' || parsed.intent === 'empty' ? 'fail' : 'ok',
    detail: `${INTENT_LABEL[parsed.intent] || parsed.intent} via ${PARSER_LABEL[parsed.parser] || PARSER_LABEL.local}${parsed.fallback ? ` (LLM not used: ${parsed.fallback})` : ''}${changes.length ? ` — ${changes.join(' + ')}` : ''}`,
  };
}

function schedulingStep(plan) {
  const facts = [];
  if (plan.feasible) {
    const alts = plan.search.alternativesUsed?.length || 0;
    const comp = plan.search.compressedTasks?.length || 0;
    const dropped = plan.dropped.filter((d) => d.cause !== 'user').length;
    if (alts) facts.push(`${alts} listed alternative${alts === 1 ? '' : 's'} in use`);
    if (comp) facts.push(`${comp} task${comp === 1 ? '' : 's'} compressed`);
    if (dropped) facts.push(`${dropped} optional task${dropped === 1 ? '' : 's'} dropped`);
  }
  return {
    step: 'Scheduling performed',
    status: plan.feasible ? 'ok' : 'warn',
    detail: `${plan.search.configsTried} configuration${plan.search.configsTried === 1 ? '' : 's'} searched in ${plan.search.ms} ms → ${plan.feasible ? 'feasible' : 'no feasible plan'}${facts.length ? ` (${facts.join(', ')})` : ''}`,
  };
}

function diffStep(diff) {
  const counts = {};
  for (const e of diff.changed) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${k.toLowerCase()}`);
  const codes = [...new Set(diff.changed.flatMap((e) => e.reasons.map((r) => reasonLabel(r.code).toLowerCase())))];
  return {
    step: 'Differences explained',
    status: 'ok',
    detail: `${diff.changed.length} changed${parts.length ? ` (${parts.join(', ')})` : ''}, ${diff.entries.length - diff.changed.length} unchanged${codes.length ? ` — reasons: ${codes.join(', ')}` : ''}`,
  };
}

const HELP = 'I can replan when the deadline moves, someone leaves, arrives late or comes back, equipment breaks or is fixed, '
  + 'the budget changes, a task runs long, or you want to skip something. Several changes can go in one message. '
  + 'Try: "Guests are arriving an hour early and the oven broke.", "Alex has to leave at 5 PM", "Leila is running 20 minutes late", '
  + '"We only have $60 left", "The oven works again", "Skip the bread", "Can we still make it?", or "Undo".';

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
  const trace = [intentStep(parsed)];

  switch (parsed.intent) {
    case 'shocks': {
      const head = currentRevision(session);
      const check = st.run('validate_shocks', () => validateShocks(parsed.shocks, freezeAt(head.state, head.plan, session.nowMin)),
        (r) => (r.ok ? `${r.shocks.length} change(s) accepted by schema` : r.errors.join('; ')));
      if (!check.ok) {
        trace.push({ step: 'Constraints checked', status: 'fail', detail: `Rejected before planning: ${check.errors.join('; ')}` });
        reply = { tone: 'failure', text: `I can't apply that: ${check.errors.join('; ')}. Your plan is unchanged.` };
        break;
      }
      st.note('inspect_session', 'ok', `Revision ${head.id} · clock ${formatClock(head.state.scenario, session.nowMin)} · ${Object.keys(head.state.committed).length} task(s) already started/done`);
      proposal = st.run('plan_schedule', () => proposeShocks(session, parsed.shocks, { source }),
        (p) => (p.ok ? `${p.plan.search.configsTried} configuration(s) searched in ${p.plan.search.ms} ms → ${p.plan.feasible ? 'feasible' : 'infeasible'}` : p.errors.join('; ')));
      if (!proposal.ok) {
        trace.push({ step: 'Constraints checked', status: 'fail', detail: proposal.errors.join('; ') });
        reply = { tone: 'failure', text: `I can't apply that: ${proposal.errors.join('; ')}.` };
        proposal = null;
        break;
      }
      trace.push({ step: 'Constraints changed', status: 'ok', detail: `${proposal.descriptions.join('; ')} — at ${formatClock(head.state.scenario, proposal.atMin)}, ${Object.keys(proposal.state.committed).length} started/done task(s) frozen` });
      trace.push(schedulingStep(proposal.plan));
      if (proposal.feasible) {
        trace.push({ step: 'Validation passed', status: 'ok', detail: `validatePlan(): ${proposal.plan.validation.checks} independent checks, 0 violations` });
        trace.push(diffStep(proposal.diff));
        st.note('validate_plan', 'ok', `validatePlan(): ${proposal.plan.validation.checks} checks, 0 violations`);
        st.note('explain_diff', 'ok', `${proposal.diff.changed.length} changed · ${proposal.diff.entries.length - proposal.diff.changed.length} unchanged · codes: ${[...new Set(proposal.diff.changed.flatMap((e) => e.reasons.map((r) => r.code)))].join(', ') || 'none'}`);
        next = commitProposal(session, proposal, { now });
        st.note('commit_revision', 'ok', `Committed ${currentRevision(next).id}`);
        trace.push({ step: 'Plan committed', status: 'ok', detail: `Revision ${currentRevision(next).id} saved; undo returns to ${head.id}` });
        reply = { tone: 'done', text: explainCommit(proposal) };
      } else {
        trace.push({ step: 'Validation failed', status: 'fail', detail: proposal.plan.violations.map((v) => `${v.code} (${v.proof === 'proven' ? 'proven' : 'bounded search'})`).join(', ') });
        trace.push({ step: 'Options verified', status: proposal.options.length ? 'ok' : 'warn', detail: proposal.options.length ? `${proposal.options.length} option(s) re-planned and validated: ${proposal.options.map((o) => o.label).join(' | ')}` : 'No single relaxation restores feasibility' });
        trace.push({ step: 'Nothing committed', status: 'skipped', detail: `Plan stays at ${head.id} until you choose` });
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
      trace.push(res.ok
        ? { step: 'Revision undone', status: 'ok', detail: `Removed ${res.removed.id} (${res.removed.label}); current plan is ${currentRevision(next).id}` }
        : { step: 'Nothing to undo', status: 'warn', detail: res.message });
      reply = res.ok
        ? { tone: 'done', text: `Undone: ${res.removed.label}. Back to revision ${currentRevision(next).id}.` }
        : { tone: 'failure', text: res.message };
      break;
    }
    case 'restore': {
      const res = st.run('restore_baseline', () => restoreBaseline(session), (r) => `Removed ${r.removedCount} revision(s)`);
      next = res.session;
      trace.push({ step: 'Original plan restored', status: 'ok', detail: `${res.removedCount} revision(s) removed; history keeps them marked as undone` });
      reply = { tone: 'done', text: `Restored the original plan (${res.removedCount} revision${res.removedCount === 1 ? '' : 's'} removed; the history log keeps them marked as undone).` };
      break;
    }
    case 'advance': {
      next = st.run('advance_clock', () => advanceClock(session, parsed.minutes), (s) => `Clock → ${formatClock(currentRevision(s).state.scenario, s.nowMin)}`);
      const s = currentRevision(next).state.scenario;
      trace.push({ step: 'Clock advanced', status: 'ok', detail: `${formatClock(s, session.nowMin)} → ${formatClock(s, next.nowMin)}; work started by then freezes on the next change` });
      reply = { tone: 'done', text: `Simulation clock is now ${formatClock(s, next.nowMin)}. Tasks that have started will be treated as fixed when the next change arrives.` };
      break;
    }
    case 'status':
      st.note('inspect_session', 'ok', `Revision ${currentRevision(session).id}`);
      trace.push({ step: 'Plan inspected', status: 'ok', detail: `Answer read from validated revision ${currentRevision(session).id}` });
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
  next = appendLog(next, 'conversation', { role: 'assistant', text: reply.text, tone: reply.tone, trace, at: now });
  return { session: next, reply, steps: st.steps, trace, proposal };
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
  const trace = [
    { step: 'Option confirmed by you', status: 'ok', detail: option.label },
    { step: 'Constraints changed', status: 'ok', detail: next.descriptions.join('; ') },
    schedulingStep(next.plan),
    { step: 'Validation passed', status: 'ok', detail: `validatePlan(): ${next.plan.validation.checks} independent checks, 0 violations` },
    diffStep(next.diff),
  ];
  let committed = commitProposal(session, next, { now });
  trace.push({ step: 'Plan committed', status: 'ok', detail: `Revision ${currentRevision(committed).id} saved` });
  st.note('commit_revision', 'ok', `Committed ${currentRevision(committed).id}`);
  const reply = { tone: 'done', text: explainCommit(next) };
  committed = appendLog(committed, 'activity', { at: now, input: `Option: ${option.label}`, source: 'confirm', parser: 'none', intent: 'option', steps: st.steps, tone: 'done' });
  committed = appendLog(committed, 'conversation', { role: 'user', text: `Apply: ${option.label}`, source: 'confirm', at: now });
  committed = appendLog(committed, 'conversation', { role: 'assistant', text: reply.text, tone: reply.tone, trace, at: now });
  return { session: committed, reply, steps: st.steps, trace, proposal: next };
}
