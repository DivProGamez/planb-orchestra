# Devpost submission draft

Final text for the submission form. Every figure below is in `docs/TEST_REPORT.md`.

**Project title:** PlanB Orchestra — The Assistant That Rebuilds Your Plan
**Tagline:** An Alexa+-style planning agent that recalculates household plans when life changes — and proves every decision.
**Track:** Alexa+ — simulated web experience

## Inspiration

Plans rarely fail when they are made. They fail when guests arrive early, the oven breaks or a helper cancels.
We wanted a household assistant that responds to those moments with a real, accountable plan rather than generic advice.

## What it does

PlanB Orchestra turns a household event (a dinner for six, a children's birthday, a weekend outing) into a
dependency-aware schedule across the people who are available, shared equipment, a budget and a deadline.
When something changes — "Guests are arriving an hour early and the oven broke" — it freezes the work already
started, recomputes the remaining tasks, animates a before/after change map, and explains each moved, reassigned,
shortened, replaced or dropped task with reason codes tied to the constraint that changed.

People describe changes their own way, so the agent accepts plain sentences and several changes at once —
"Alex has to leave at 5 PM", "Leila is running 10 minutes late", "the car is in the shop", "the oven works again",
"we only have $60 left" — as well as quick commands and a structured form. Each reply lists the agent's steps from
real engine data: intent detected, constraints changed, scheduling performed, validation passed, differences
explained, plan committed.

If a request is impossible (for example, a budget below what has already been spent plus what is still required),
it says so, shows the hard constraints that conflict, and offers options the planner has verified will work
(raise the budget to the minimum, move the deadline, or skip a non-essential task). Nothing changes until the user
picks one. Sessions, revisions, undo and the simulation clock survive a page reload.

## How we built it

- **Deterministic constraint engine** (plain JavaScript, runs entirely in the browser): a bounded list scheduler that
  first keeps previous choices, then compresses tasks (never below their minimum), then tries explicitly listed
  alternatives, then drops optional tasks — required tasks are never dropped silently.
- **Independent validator** (`validatePlan`) re-derives every rule from scratch; a plan that fails it is never shown as success.
- **Agent loop with visible steps:** parse → validate the change against an allowlisted schema → plan → validate →
  explain from the actual diff → commit, or ask the user to choose. Each reply shows these steps with their real
  numbers (configurations searched, checks passed, tasks changed), plus a raw activity log.
- **Change types:** deadline earlier/later, person unavailable now or from a time, person late, person back,
  equipment down or fixed, budget cut or raise, task overrun, skip a task — validated by one shared schema.
- **Simulated Alexa+-style desktop app:** designed from Google Stitch reference screens and rebuilt in local
  HTML/CSS/JS — sidebar navigation across seven screens, a live-preview home, a timeline-centred workspace with a
  read-only task inspector, a disruption dialog that shows what was understood and a dry-run impact before anything is
  replanned, a repair-stage view, synchronized Before/After timelines with a change map, a revision history with
  snapshots, and a settings & transparency screen. All graphics are original SVG/CSS; every figure comes from the engine.
- **Natural-language input:** a clearly labelled *limited local rule parser* (not an LLM), covered by a test corpus of
  34 change phrasings across the three scenarios plus 7 non-change/negative cases. An optional server-side adapter can use Claude through the Anthropic SDK
  (key read only on the server); its output is re-validated against the same schema and any failure falls back to
  the local parser. The adapter is tested offline with a stub client only; the demo and all tests use the local parser.
- **Built for a TV-style remote too:** a small spatial-navigation engine moves focus with arrows, D-pad or a gamepad,
  scrolls long panels step by step so nothing is skipped, and never traps focus; the focused element gets a cyan neon
  outline, and short synthesised interface sounds (off-switch and volume in Settings) confirm moves and results.
- Node.js + Express serve the static app and the optional intent endpoint; `npm run build` produces a verified
  offline build in `dist/`.

## Challenges we ran into

- **Greedy scheduling made needless compromises.** Our first list scheduler scheduled a must-do task before a
  should-do task and then had to compress a dish by a minute. Trying several deterministic task orderings at each
  compression level before shortening anything removed those artifacts.
- **Optional tasks landed after the end of the event.** "Load bikes" was scheduled after the drive had started,
  because a required task cannot hard-depend on an optional one. We added ordering-only ("soft") dependencies.
- **Honest infeasibility.** Distinguishing what is mathematically proven (budget floor, minimum-duration critical
  path, person-minute capacity) from "the bounded search found no slot" required separate labels in the UI.
- **Tests found a scenario with no way out.** With the oven broken, the birthday party became impossible with zero
  options: the pizzas had no listed fallback and the final check hard-depended on them. We added an explicit
  "order pizza delivery" fallback and made that dependency ordering-only, so the planner can now offer real choices.
- **"Back to the original recipe" was labelled "alternative used"** when the oven came back; a scenario test caught
  it and the diff now uses a separate *Original version* reason.
- **An impossible deadline leaked an internal schema error** to the user during testing; changes that would put the
  deadline before the current time are now rejected in plain English, with a regression test.

## Accomplishments that we're proud of

- 92 automated unit/integration tests, including a randomized audit of 500 random change sequences (911 feasible replans and 148
  infeasible outcomes in the latest run) checked by the validator and an independent minute-by-minute brute-force
  checker — 0 violations — and story tests for all three scenarios.
- Also passing in the same run: 14/14 navigation checks, 14/14 assistant-chat checks, a responsive audit at 10
  viewports and a scroll audit (74 scroll directions, arrows only) with 0 problems, and an offline-verified production build.
- Mouse-free navigation tested in Chrome with real key events and an emulated standard gamepad: a keyboard-only journey
  through every screen, every control reachable by arrows, every scroll container scrolled to its end, the assistant
  history browsed with Up/Down/OK/Back only. Not tested on real gamepad or Fire TV hardware.
- 14/14 release QA checks (corrupted saved state, cancelled/unsupported/impossible changes, figures vs saved state,
  undo/restore across reload, keyboard, accessible names, dialog fit, reduced motion) and a populated-screen audit of all
  three scenarios with 0 layout problems.
- 26/26 browser smoke checks in real Chrome at 1920×1080, 1500×900, 1440×900, 1230×908, 1280×720, 1024×768, 768×1024 and 390×844 — every
  desktop screen fits without page scrolling — with no console errors.
- Every explanation is generated from reason codes and plan data; nothing is free-text invention.

## What we learned

Explainability is mostly a data-modelling problem: once every change is a diff between two validated states,
reasons can be derived instead of written.

## What's next

Richer constraint policies (multi-person tasks, partial availability windows), calendar import/export, and official
Alexa+ integration paths if and when they become available to us.

## Built with

JavaScript, Node.js, Express, HTML/CSS, Web Audio API, Gamepad API, node:test, Playwright (playwright-core) with Chrome for browser tests, FFmpeg for the demo video.

## Links

- Repository: https://github.com/DivProGamez/planb-orchestra (MIT license)
- Hosted demo: none (runs locally: `npm install && npm start`)
- Video: https://youtu.be/42Xxeb36k54 (2:46)

## Transparency

This is a **simulated** Alexa+ web experience. It does not use Alexa devices, Alexa accounts, Alexa APIs or MCP,
and it is not affiliated with or endorsed by Amazon.
