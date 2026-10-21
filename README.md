# PlanB Orchestra

**When life breaks the plan, the plan repairs itself.**

A simulated Alexa+-style web experience: a household planning agent that schedules people, deadlines,
equipment and budget. When something changes, you tell it in plain words — "Guests are arriving an hour early
and the oven broke", "Alex has to leave at 5 PM", "the oven works again". It recomputes a feasible plan, shows a
before/after change map, explains every change with factual reason codes, and shows each agent step it took.

> **Demo simulation.** Not an Amazon product, not affiliated with or endorsed by Amazon, and not connected to any
> Alexa device, account or API. Typed requests are read by a **limited local rule parser** unless the optional
> server-side LLM adapter is configured. The header badge always shows which one is active.

## Quick start

Requires Node.js 20+. Everything below works offline.

```bash
npm install
```

```bash
npm start
```

Open http://localhost:5173. To run the tests:

```bash
npm test
```

```bash
npm run test:smoke
```

`npm run test:smoke` drives the real UI in an installed Chrome or Edge (`CHROME_PATH` overrides detection) and
writes screenshots to `evidence/`. `node scripts/check-fixtures.mjs` prints each scenario's demo story through the
real engine.

## Interface

A full-screen app shell (no page scrolling on desktop ≥ 1100×640; panels scroll internally):

- **Splash** (1.2–2.5 s): original PlanB mark, progress ring and bar. Its status lines describe the real boot work —
  loading the engine, validating the three scenarios (it reports the actual number of checks), checking which parser is
  available, restoring a saved session.
- **App bar:** logo, Home › scenario breadcrumb with the current revision, both disclosure badges (simulated Alexa+,
  parser in use), simulation clock, Undo / Restore / New session.
- **Home dashboard:** scenario cards, a **live preview** (timeline or task table) that re-plans as you change the
  deadline, budget, helpers or equipment, and the setup form with the list of guarantees the validator checks.
- **Command center:** conversation dock with per-reply agent steps; KPI strip; recovery banner after each change;
  the timeline as the centerpiece (rows sized to fill the space, animated task moves, dashed previous positions,
  moving deadline marker, sweep highlight); crisis panel for impossible requests; tabbed side panel (Changes,
  Constraints + structured form, History, Agent log).
- Responsive down to phone width; respects `prefers-reduced-motion`.

## What it does (tested — see `docs/TEST_REPORT.md`)

**Planning engine**
- Three seeded scenarios (Dinner for Six, Children's Birthday, Weekend Outing), 8–10 tasks each, feasible at baseline.
- Deterministic scheduler: hard and ordering-only dependencies, people availability and eligibility, equipment
  capacity and outages, deadline, budget including money already committed, frozen started/completed work.
- Repair order: keep previous choices → compress (5-minute steps, never below minimum) → explicitly listed
  alternatives → drop optional tasks. Must/should tasks are never dropped without user confirmation.
- An independent `validatePlan()` re-checks every result. A randomized audit replays 500 random change sequences and
  checks each plan with that validator and a separate minute-by-minute brute-force checker.

**Changes it understands** (typed, quick command, structured form, or optional LLM)
- Deadline earlier/later ("dinner is now at 6:15", "push dinner back 30 minutes", "be at the lake by 11").
- Someone unavailable now or from a time ("Sam is sick", "Alex has to leave at 5 PM", "Leila can only stay until 5:30").
- Someone late or back ("the aunt is running 30 minutes late", "Sam is back").
- Equipment down or fixed ("the car is in the shop", "no kitchen today", "the oven works again").
- Budget ("we only have $60 left", "spend no more than 90 dollars", "budget dropped by $15").
- Task overruns ("rice will take 10 more minutes"), skips ("forget the candles"), status questions, undo, restore.
- Several changes in one message. Anything the parser cannot map is reported, never guessed.

**Agent experience**
- Every reply lists its steps from real engine data: *Intent detected → Constraints changed → Scheduling performed →
  Validation passed/failed → Differences explained → Plan committed* (or *Options verified → Nothing committed*).
- Before/After timeline with animated moves, dashed previous positions, and a "Why it changed" panel with reason
  codes and evidence for every moved, reassigned, shortened, replaced or removed task.
- Impossible requests: `feasible:false`, violations labelled *proven* or *bounded search*, and only options the
  planner has re-planned and validated (move the deadline, set the budget, skip a non-essential task).
- Undo, restore, simulation clock, versioned localStorage persistence that survives reloads.

## Optional LLM intent parsing

`server/llm-adapter.js` can parse free text with Claude (`claude-opus-5-5`) through the official Anthropic SDK and
structured output. The API key is read **only on the server** from `LLM_API_KEY`; the browser never sees it.
Model output is re-validated against the same allowlisted shock schema (unknown ids, fields or types are rejected)
and any failure — no key, timeout, refusal, invalid output — falls back to the local parser, which the reply states.

```bash
npm install @anthropic-ai/sdk zod
```

Then set `LLM_API_KEY` (see `.env.example`) and restart `npm start`.

**Verification status:** the request shape, schema re-validation, fallbacks and the `/api/intent` endpoint are
tested offline with a stub client (`tests/llm-adapter.test.js`). **No live model request has been made** — no API key
was available — so nothing is claimed about real-model accuracy.

## Layout

```
server/   app.js (Express: /api/health, /api/intent, static), llm-adapter.js, schema.js
src/      index.html, styles.css, app.js (UI state), components.js (views), persistence.js
src/engine/  model, validate, scheduler, shocks, diff, reasons, session, parser, agent
src/data/scenarios.js   seeded fixtures (deep-frozen)
tests/    unit, integration, scenario stories, phrasing corpus, LLM adapter (offline), randomized audit, smoke/ (18 browser checks)
docs/     ARCHITECTURE, DEMO_SCRIPT, DEVPOST_SUBMISSION, TEST_REPORT, PRODUCT_FEEDBACK, FRICTION_LOG, COMPETITION_CHECKLIST
```

## License

MIT — see `LICENSE`.
