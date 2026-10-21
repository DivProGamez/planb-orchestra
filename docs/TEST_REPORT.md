# Test report

Generated from real CLI runs on 2026-10-21T15:14Z (Windows 11, Node v24.11.0). Nothing below is hand-written as a result.

## `npm test` (node:test)

Suites: planner (G1 gates), shocks/reasons, parser corpus (34 phrasings + 7 negatives), new change types,
scenario stories (all three), persistence, integration + server, offline LLM adapter (stub client), randomized audit.

```
ℹ feasible replans checked: 911; infeasible outcomes checked: 148
ℹ tests 80
ℹ pass 80
ℹ fail 0
```

## `npm run test:smoke` (playwright-core driving installed Chrome)

```
PASS  splash walks through the real start-up steps (about 2.4 s) and reports the validated checks
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

Screenshots from this run are in `evidence/`; machine-readable results in `evidence/smoke-results.json`.

## Not tested

- Live LLM requests (no API key available). The adapter is exercised only with an injected stub client; nothing is
  claimed about a real model's parsing accuracy, latency or cost.
- Real Alexa devices or APIs (none are used; this is a simulation).
- Browsers other than desktop Chrome (phone/tablet sizes were emulated by viewport, not real devices).
- Screen readers were not tested; ARIA roles and labels are present but unverified with assistive technology.
