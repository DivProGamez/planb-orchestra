# Architecture

```
Browser (all planning happens here, works offline)
 ├─ src/app.js            UI state machine, events, persistence calls, FLIP animation
 ├─ src/components.js     pure view functions (data → escaped HTML)
 ├─ src/persistence.js    versioned localStorage envelope + migration, injectable storage
 └─ src/engine/
     ├─ model.js          shared helpers: variants, clock/money formatting, orderingPreds
     ├─ validate.js       validateScenario (schema, references, cycles) + independent validatePlan
     ├─ scheduler.js      bounded deterministic search + list scheduler + infeasibility diagnosis
     ├─ shocks.js         allowlisted shock schema, freezeAt, applyShockToState
     ├─ diff.js           before/after diff + reason derivation from constraint changes
     ├─ reasons.js        reason-code labels/tones
     ├─ session.js        revisions, propose/commit, undo, restore, clock, verified relaxations
     ├─ parser.js         LIMITED local rule parser (not an LLM)
     └─ agent.js          agent turn: parse → validate → plan → validate → explain → commit/ask

Node server (optional for planning; serves static files)
 ├─ server/app.js         Express: GET /api/health, POST /api/intent, static src/
 ├─ server/schema.js      request validation + re-validation of model output via shocks.js
 └─ server/llm-adapter.js optional Claude adapter (lazy-loaded SDK, LLM_API_KEY server-side only)
```

## Data model

Integer minutes from scenario start, integer dollars. A **scenario** has people (availability window), resources
(capacity, available), tasks (duration, minimum duration, cost, priority must/should/optional, `dependsOn`,
optional `softDependsOn`, eligible people — empty means hands-free —, resources, listed alternative ids) and the
alternatives themselves. Fixtures are deep-frozen.

A **state** is `{ scenario, committed, nowMin }`; `committed` holds tasks that were done or in progress when a change
arrived — their slot, assignee, variant and cost are immutable. A **session** is the original scenario plus an
append-only list of revisions `{ id, label, atMin, shocks, state, plan, diff }`.

## Change types (shocks)

One allowlisted schema in `shocks.js`, shared by the local parser, the structured form and the LLM adapter:

| Type | Payload | Effect |
|---|---|---|
| `deadline_earlier` / `deadline_extended` | `minutes` | Moves the event deadline (an earlier deadline must stay after "now"). |
| `person_unavailable` | `personId`, optional `fromMin` | Person leaves now or at a stated time. |
| `person_delayed` | `personId`, `minutes` | Person's availability starts later. |
| `person_available` | `personId` | Restores a person's original window from now on (only if they were marked away/late). |
| `resource_unavailable` / `resource_restored` | `resourceId` | Equipment down / working again; on restore the original task versions are tried first. |
| `budget_reduced` / `budget_increased` | `newCap` | New budget cap. |
| `duration_increase` | `taskId`, `extraMin` | A not-yet-started task takes longer. |
| `task_skipped` | `taskId` | User-confirmed skip of a should/optional task with no required dependents. |

Unknown types, extra fields, unknown ids and non-integers are rejected before planning.

## Planning algorithm (`planSchedule`)

1. `validateScenario`: schema, unique ids, references, no cycles, required tasks never hard-depend on optional ones.
2. For each unfinished task, list its *legal* variants (base + listed alternatives) — resources available, at least one
   eligible person available long enough. A required task with no legal variant ⇒ proven infeasible.
3. Search, in this order, stopping at the first plan that passes:
   drop-sets of optional tasks (smallest, lowest value first) → alternative combinations (fewest changes first,
   previous choices preferred) → compression levels 0–4 (5-minute steps, never below the minimum) →
   three deterministic task orderings (priority, critical path, fixture order).
4. Serial list scheduling: each ready task gets the earliest start where an eligible person and every resource have
   capacity, within the deadline and task window; committed work is pre-booked.
5. Compression is relaxed task by task wherever the plan stays feasible.
6. `validatePlan` re-checks everything; a failing plan is returned as `feasible:false`.
7. If nothing passes: violations are diagnosed — *proven* (budget floor, minimum-duration critical path,
   person-minute capacity, no eligible person available in a task's earliest window, in-progress work past the
   deadline) or *search* (bounded search found no slot; the message lists each eligible person's real availability).

Search limit: 8,000 schedule attempts. The heuristic is not guaranteed optimal; violations from the search (not a
proof) are labelled "Bounded search" in the UI.

## Explanations

`diffPlans` compares two validated states task by task (kinds: Removed, Restored, Replaced, Reassigned, Shortened,
Lengthened, Moved, Unchanged). Reason codes are attached only when the matching constraint actually changed in that
turn (deadline earlier, person lost, resource down, budget cut, duration increase, relaxations), plus structural
causes computed from the new plan (dependency propagation with the predecessor's times; rebalancing naming the
task that occupies the person or resource). Returning to a task's original version after a repair uses its own
*Original version* reason rather than *Alternative used*. Replies in the chat are composed from these records only.

## Agent steps

`runAgentTurn` returns a `trace` stored with each assistant message and rendered under it: *Intent detected*
(parser used, recognised change types, and any LLM fallback reason) → *Constraints changed* (data-derived descriptions,
frozen task count) → *Scheduling performed* (configurations searched, time, alternatives/compression/drops) →
*Validation passed* (checks) or *Validation failed* (codes, proven vs search) → *Differences explained* (kinds and
reason codes) → *Plan committed* or *Options verified* + *Nothing committed*. Every value comes from the engine.

## Optional LLM adapter

`POST /api/intent` validates the request (text ≤ 500 chars, a structurally valid scenario), then — only when
`LLM_API_KEY` is set and the optional SDK is installed — asks Claude for structured output (Zod schema via
`messages.parse`), and passes the result through `validateIntentResult` → `validateShocks`. Refusals, empty or invalid
output, timeouts and provider errors return 502/503 with `fallback: 'local'`; the browser then uses the local parser
and the reply's first step says so. The adapter accepts an injected client, which is how it is tested offline.

## Relaxation options

For an infeasible proposal, `suggestRelaxations` tries — on cloned state — moving the deadline (5-minute steps),
raising the budget (from the proven minimum), and skipping `should` tasks with no required dependents. Only options
for which `planSchedule` returns a validated feasible plan are shown; applying one re-runs the full pipeline.

## Known limitations (by design for the MVP)

- One person per task; hands-free tasks need equipment only.
- A person can leave once and come back once per change; arbitrary multi-interval availability is not modelled.
- `duration_increase` affects the task's base variant, not its alternatives.
- In-progress work is assumed to finish as scheduled even if its equipment later breaks.
- Extending the deadline does not extend people's own availability windows.
