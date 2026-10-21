// Prints every seeded scenario's baseline plan and runs its quick-command story through the
// real parser + agent, so fixture behaviour can be inspected before recording a demo.
// Usage: node scripts/check-fixtures.mjs [scenarioId]

import { SCENARIOS } from '../src/data/scenarios.js';
import { createSession, currentRevision } from '../src/engine/session.js';
import { parseCommand } from '../src/engine/parser.js';
import { runAgentTurn } from '../src/engine/agent.js';
import { formatClock, personName } from '../src/engine/model.js';

const only = process.argv[2];

function printPlan(session) {
  const head = currentRevision(session);
  const s = head.state.scenario;
  const c = (m) => formatClock(s, m);
  console.log(`  [${head.id}] deadline ${c(s.deadlineMin)} · budget $${s.budgetCap} · cost $${head.plan.totalCost} · ends ${c(head.plan.endMin)} · checks ${head.plan.validation.checks}`);
  for (const st of head.plan.scheduled) {
    console.log(`    ${c(st.startMin).padStart(8)}–${c(st.endMin).padEnd(8)} ${personName(s, st.personId).padEnd(10)} ${st.title}${st.variantId !== 'base' ? ' [alt]' : ''}${st.durationMin < st.fullDurationMin ? ` [${st.fullDurationMin}→${st.durationMin}]` : ''} (${st.status})`);
  }
  for (const d of head.plan.dropped) console.log(`    DROPPED ${d.title} (${d.cause})`);
}

let failures = 0;
for (const scenario of SCENARIOS) {
  if (only && scenario.id !== only) continue;
  console.log(`\n=== ${scenario.name} ===`);
  const created = createSession(scenario, { now: 0 });
  if (!created.ok) {
    failures++;
    console.log('  BASELINE INFEASIBLE', created.errors);
    continue;
  }
  let session = created.session;
  printPlan(session);
  for (const qc of scenario.quickCommands) {
    const head = currentRevision(session);
    const parsed = { ...parseCommand(qc.text, { ...head.state, nowMin: session.nowMin }), source: 'quick' };
    const turn = runAgentTurn(session, qc.text, parsed, { now: 0 });
    session = turn.session;
    console.log(`\n> ${qc.text}\n  ${turn.reply.tone.toUpperCase()}: ${turn.reply.text}`);
    if (turn.proposal && !turn.proposal.feasible) {
      for (const o of turn.proposal.options) console.log(`  OPTION: ${o.label} — ${o.detail}`);
    }
    if (turn.proposal?.feasible) {
      for (const e of turn.proposal.diff.changed) {
        console.log(`  ${e.kind.padEnd(10)} ${e.title}: ${e.reasons.map((r) => `${r.code}(${r.evidence.join('; ')})`).join(' ')}`);
      }
      printPlan(session);
    }
  }
}
process.exitCode = failures ? 1 : 0;
