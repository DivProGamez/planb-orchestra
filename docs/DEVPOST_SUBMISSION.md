# Devpost submission draft

Replace every `[TODO]` before submitting. Do not add claims that were not verified.

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

If a request is impossible (for example, a budget below what has already been spent plus what is still required),
it says so, shows the hard constraints that conflict, and offers options the planner has verified will work
(raise the budget to the minimum, move the deadline, or skip a non-essential task). Nothing changes until the user
picks one. Sessions, revisions, undo and the simulation clock survive a page reload.

## How we built it

- **Deterministic constraint engine** (plain JavaScript, runs entirely in the browser): a bounded list scheduler that
  first keeps previous choices, then compresses tasks (never below their minimum), then tries explicitly listed
  alternatives, then drops optional tasks — required tasks are never dropped silently.
- **Independent validator** (`validatePlan`) re-derives every rule from scratch; a plan that fails it is never shown as success.
- **Agent loop with an activity log:** parse → validate the change against an allowlisted schema → plan → validate →
  explain from the actual diff → commit, or ask the user to choose.
- **Simulated Alexa+-style UI:** conversation dock, quick commands, swimlane chart with animated transitions and
  previous-position outlines, KPI strip, "Why it changed" panel and session timeline.
- **Natural-language input:** a clearly labelled *limited local rule parser* (not an LLM). [TODO — keep only if you
  configure and verify it: an optional server-side adapter can parse free text with Claude via the Anthropic SDK; its
  output is re-validated against the same schema and falls back to the local parser on any failure.]
- Node.js + Express serve the static app and the optional intent endpoint.

## Challenges we ran into

- **Greedy scheduling made needless compromises.** Our first list scheduler scheduled a must-do task before a
  should-do task and then had to compress a dish by a minute. Trying several deterministic task orderings at each
  compression level before shortening anything removed those artifacts.
- **Optional tasks landed after the end of the event.** "Load bikes" was scheduled after the drive had started,
  because a required task cannot hard-depend on an optional one. We added ordering-only ("soft") dependencies.
- **Honest infeasibility.** Distinguishing what is mathematically proven (budget floor, minimum-duration critical
  path, person-minute capacity) from "the bounded search found no slot" required separate labels in the UI.
- **An impossible deadline leaked an internal schema error** to the user during testing; changes that would put the
  deadline before the current time are now rejected in plain English, with a regression test.

## Accomplishments that we're proud of

- 31 automated tests including a randomized audit: 300 random shock sequences (476 feasible replans, 132 infeasible
  outcomes) checked by the validator and by an independent minute-by-minute brute-force checker — 0 violations.
- 15/15 browser smoke checks in real Chrome at 1440×900, 1280×720 and 1024×768, with no console errors.
- Every explanation is generated from reason codes and plan data; nothing is free-text invention.

## What we learned

Explainability is mostly a data-modelling problem: once every change is a diff between two validated states,
reasons can be derived instead of written.

## What's next

Richer constraint policies (multi-person tasks, partial availability windows), calendar import/export, and official
Alexa+ integration paths if and when they become available to us.

## Built with

JavaScript, Node.js, Express, HTML/CSS, node:test, Playwright (playwright-core) with Chrome for smoke tests.
[TODO — add "Anthropic Claude API" only if the LLM adapter was enabled and verified.]

## Links

- Repository: [TODO public GitHub URL, MIT license]
- Hosted demo: none (runs locally: `npm install && npm start`)
- Video: [TODO public YouTube/Vimeo URL, under 3:00]

## Transparency

This is a **simulated** Alexa+ web experience. It does not use Alexa devices, Alexa accounts, Alexa APIs or MCP,
and it is not affiliated with or endorsed by Amazon.
