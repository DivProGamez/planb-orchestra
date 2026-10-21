# PlanB Orchestra

**When life breaks the plan, the plan repairs itself.**

A simulated Alexa+-style web experience: a household planning agent that schedules people, deadlines,
equipment and budget, and — when something changes — recomputes a feasible plan, shows a before/after
change map, and explains every change with factual reason codes.

> **Demo simulation.** Not an Amazon product, not affiliated with or endorsed by Amazon, and not connected
> to any Alexa device, account or API. Typed commands are read by a **limited local rule parser** unless an
> optional LLM adapter is configured (see below).

## Quick start

Requires Node.js 20+.

```bash
npm install
```

```bash
npm start
```

Open http://localhost:5173. Then run the tests:

```bash
npm test
```

```bash
npm run test:smoke
```

`npm run test:smoke` drives the real UI in an installed Chrome or Edge (`CHROME_PATH` overrides detection)
and writes screenshots to `evidence/`.

## What works (all tested — see `docs/TEST_REPORT.md`)

- Three seeded scenarios (Dinner for Six, Children's Birthday, Weekend Outing), 8–10 tasks each, all feasible at baseline.
- Deterministic list scheduler: dependencies (hard + soft ordering), people availability and eligibility, equipment
  capacity/outages, deadline, budget (including committed spend), frozen started/completed work.
- Repair search: keep previous choices → compress (never below minimum) → listed alternatives → drop optional tasks.
  Must/should tasks are never dropped without user confirmation.
- Independent `validatePlan()` re-checks every result; an invalid plan is never shown as success.
- Shocks: earlier deadline, person unavailable, equipment down, budget cut, task overrun; several per turn.
- Before/after diff with kinds (Moved, Reassigned, Shortened, Replaced, Removed, …) and reason codes with evidence.
- Impossible requests: `feasible:false`, proven/searched violations, and planner-verified options (raise budget,
  move deadline, skip a should-task). Nothing changes until the user confirms.
- Undo, restore scenario, simulation clock, versioned localStorage persistence with migration.
- Agent activity log: parse → validate shocks → plan → validate plan → explain diff → commit.

## Optional LLM intent parsing (untested live)

`server/llm-adapter.js` can parse free text with Claude (`claude-opus-5-5`) via the official Anthropic SDK using
structured output. Output is re-validated against the same allowlisted shock schema; any failure falls back to
the local parser. It is **disabled by default** and has **not been tested against the live API** (no key was
available during development). To enable:

```bash
npm install @anthropic-ai/sdk zod
```

Then set `LLM_API_KEY` (server-side only; never in the frontend) and restart. The header badge shows which parser is active.

## Layout

```
server/   app.js (Express, /api/health, /api/intent), llm-adapter.js, schema.js
src/      index.html, styles.css, app.js (UI state), components.js (views), persistence.js
src/engine/  model, validate, scheduler, shocks, diff, reasons, session, parser, agent
src/data/scenarios.js   seeded fixtures (deep-frozen)
tests/    unit, integration, randomized audit, smoke/browser-smoke.mjs
scripts/check-fixtures.mjs   prints every scenario's story through the real engine
```

## License

MIT — see `LICENSE`.
