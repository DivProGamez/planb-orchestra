# Test report

Generated from real CLI runs on 2026-10-21T11:25Z (Windows 11, Node v24.11.0). Nothing below is hand-written as a result.

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
PASS  splash reports real boot steps and leaves within 2.5–3 s
PASS  welcome shows three scenario tiles and the simulation label
PASS  setup form builds a validated baseline plan
PASS  first shock (early guests + broken oven) replans with reasons and animation data
PASS  second shock on the same session after advancing the clock
PASS  refresh restores plan, revisions and clock
PASS  impossible budget is rejected with proven violation and two verified options
PASS  undo goes back one revision; restore returns to the original
PASS  structured change form uses the same engine path
PASS  unsupported phrasing fails visibly without changing the plan
PASS  free-form requests: equipment breaks, then works again (original version restored)
PASS  keyboard: Escape dismisses the infeasible panel
PASS  1280×720: restored session fits the viewport with no page scroll
PASS  1024×768 tablet: stacked layout without horizontal page overflow
PASS  other scenarios build feasible baselines
PASS  API outage does not blank the app (falls back to local parser)
PASS  phone 390×844 and tablet 768×1024: landing and setup fit without horizontal scroll
PASS  no console errors during the run
Smoke: 18 passed, 0 failed. Screenshots in evidence/
```

Screenshots from this run are in `evidence/`; machine-readable results in `evidence/smoke-results.json`.

## Not tested

- Live LLM requests (no API key available). The adapter is exercised only with an injected stub client; nothing is
  claimed about a real model's parsing accuracy, latency or cost.
- Real Alexa devices or APIs (none are used; this is a simulation).
- Browsers other than desktop Chrome (phone/tablet sizes were emulated by viewport, not real devices).
