# Test report

Generated from real CLI runs on 2026-10-21T09:58Z (Windows 11, Node v24.11.0). Nothing below is hand-written as a result.

## `npm test` (node:test — unit, integration, randomized audit)

```
ℹ feasible replans checked: 476; infeasible outcomes checked: 132
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

## `npm run test:smoke` (playwright-core driving installed Chrome)

```
PASS  welcome shows three scenario tiles and the simulation label
PASS  setup form builds a validated baseline plan
PASS  first shock (early guests + broken oven) replans with reasons and animation data
PASS  second shock on the same session after advancing the clock
PASS  refresh restores plan, revisions and clock
PASS  impossible budget is rejected with proven violation and two verified options
PASS  undo goes back one revision; restore returns to the original
PASS  structured change form uses the same engine path
PASS  unsupported phrasing fails visibly without changing the plan
PASS  keyboard: Escape dismisses the infeasible panel
PASS  1280×720: restored session renders without horizontal page overflow
PASS  1024×768 tablet: stacked layout without horizontal page overflow
PASS  other scenarios build feasible baselines
PASS  API outage does not blank the app (falls back to local parser)
PASS  no console errors during the run
Smoke: 15 passed, 0 failed. Screenshots in evidence/
```

Screenshots from this run are in `evidence/`; machine-readable results in `evidence/smoke-results.json`.

## Not tested

- Live LLM requests (no API key available). Only SDK import/shape was checked locally.
- Real Alexa devices or APIs (none are used; this is a simulation).
