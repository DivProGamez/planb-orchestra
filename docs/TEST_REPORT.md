# Test report

Generated from one run of every suite on 2026-10-21T18:15Z (Windows 11, Node v24.11.0, installed Google Chrome).
Each block below is copied from that run's output; nothing is hand-written as a result.

## `npm test` (node:test) — engine, validator, parser, persistence, server, offline LLM adapter

Suites: planner (G1 gates), shocks/reasons, parser corpus (34 phrasings + 7 negatives), new change types,
scenario stories (all three), persistence (incl. corrupt/old/newer saved state), integration + server,
offline LLM adapter (stub client), randomized audit.

```
ℹ feasible replans checked: 911; infeasible outcomes checked: 148
ℹ tests 80
ℹ pass 80
ℹ fail 0
```

## `npm run test:smoke` — the demo journey across every screen and viewport

```
PASS  splash walks through the real start-up steps (about 1.2 s) and reports the validated checks
PASS  every sidebar icon opens its screen before a plan exists (with a build action)
PASS  home dashboard: scenarios, live preview reacting to constraints, honest labels, no scroll
PASS  build a validated baseline plan from the hero action
PASS  disruption dialog: describe → review (dry run) → confirm → animated Plan B
PASS  task inspector shows read-only facts and the reasons for the change
PASS  Before / After: synchronized Plan A and Plan B with a change map of real reasons
PASS  repair workflow shows the six recorded pipeline stages
PASS  assistant: agent steps, contextual actions, then a second change confirmed in chat
PASS  refresh restores plan, revisions, clock and screen
PASS  impossible budget: review shows no feasible plan; nothing committed; verified options apply
PASS  undo goes back one revision; restore returns to the original (History screen)
PASS  structured change in the dialog goes through review and the same engine path
PASS  unsupported phrasing fails visibly without changing the plan
PASS  free-form: oven breaks, then is fixed (original version restored); leave-at time understood
PASS  keyboard: D opens the dialog, Escape closes it and dismisses the crisis panel
PASS  settings & transparency shows parser status, engine facts and preferences
PASS  1920×1080: every screen fits without page scrolling
PASS  1500×900 (three-column settings): nothing sticks out of its card on any screen
PASS  1230×908 home: live preview fits its card (no inner scrollbars, no overlapping times, no rows cut), hero not clipped
PASS  1280×720: restored session fits, compact disclosures visible
PASS  1024×768 tablet: stacked layout without horizontal page overflow
PASS  other scenarios build feasible baselines; outing replans a partner leaving
PASS  API outage does not blank the app (falls back to the local parser)
PASS  phone 390×844 and tablet 768×1024: home has no horizontal scroll
PASS  no console errors during the run
Smoke: 26 passed, 0 failed. Screenshots in evidence/
```

## `npm run test:qa` — functional edge cases and accessibility

```
PASS  corrupted saved state: app starts clean, explains, and stays usable
PASS  displayed figures match the saved session (header, KPIs, sidebar)
PASS  cancelled preview and unsupported phrasing never change the plan
PASS  consecutive disruptions: each is validated and recorded (r1 → r3)
PASS  narrow bars: each short label is a whole word of that task (title or keyword)
PASS  Before/After: selecting a change highlights that task in Plan A and Plan B
PASS  impossible budget: nothing committed until a verified option is chosen
PASS  undo and restore original keep history consistent and survive reload
PASS  keyboard: D opens the dialog with focus in the text box, Escape closes it, focus ring visible
PASS  every button, link and field has an accessible name (all screens)
PASS  disruption dialog fits with its actions visible at 1280×720 and 1440×900
PASS  reduced motion (system setting): changes apply without animations
PASS  no console errors, warnings or uncaught exceptions
Release QA: 13 passed, 0 failed.
```

## `npm run audit:screens` — populated screens, all three scenarios, 1920×1080

Build → assistant review (plan unchanged until confirmed) → confirm → workspace, inspector, assistant, repair
(six completed stages), before/after, history → undo → reload (undo persisted), plus settings. Fails on page scroll,
marker or ghost labels over bars, rows cut at the chart edge, controls outside their card, or console errors.

```
Populated audit: 31 screenshots in evidence/populated/, 0 problem(s)
```

Screenshots: `evidence/` (smoke, all viewports), `evidence/populated/` (31 populated screens),
`evidence/story/` (Plan A → disruption → review → repair in motion → Plan B → Repair Workflow → Before/After).

## Not tested

- Live LLM requests (no API key available). The adapter is exercised only with an injected stub client; nothing is
  claimed about a real model's parsing accuracy, latency or cost.
- Real Alexa devices, voice, or Alexa APIs (none are used; this is a simulation).
- Browsers other than desktop Chrome (phone/tablet sizes were emulated by viewport, not real devices).
- Screen readers were not run. Accessible names, focus order/visibility, Escape handling and reduced motion are
  checked automatically (`npm run test:qa`); assistive-technology behaviour itself is unverified.
- Colour contrast was set from token values (secondary text ≥4.5:1 on card surfaces), not measured per element.
