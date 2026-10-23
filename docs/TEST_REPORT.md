# Test report

Generated from one run of every suite on 2026-10-23T00:18Z (Windows 11, Node v24.11.0, installed Google Chrome).
Each block below is copied from that run's output; nothing is hand-written as a result.

## `npm test` (node:test) — engine, validator, parser, persistence, server, offline LLM adapter, navigation, sound

Suites: planner (G1 gates), custom plans (a 20-task / 6-person plan through shocks, undo and persistence; import/export; storage), shocks/reasons, parser corpus (34 phrasings + 7 negatives), new change types,
scenario stories (all three), persistence (incl. corrupt/old/newer saved state), integration + server,
offline LLM adapter (stub client), navigation targeting / remote keys / gamepad repeat and debounce, sound manager
(unlock, mute, throttle, missing Web Audio), randomized audit.

```
ℹ feasible replans checked: 911; infeasible outcomes checked: 148
ℹ tests 104
ℹ pass 104
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
PASS  Home Live preview: Timeline ↔ Tasks keeps the layout stable; every task row and column reachable inside the table
PASS  no console errors, warnings or uncaught exceptions
Release QA: 14 passed, 0 failed.
```

## `npm run audit:screens` — populated screens, all three scenarios, 1920×1080

```
Populated audit: 31 screenshots in evidence/populated/, 0 problem(s)
```

## `npm run test:nav` — mouse-free navigation, emulated gamepad, sound, reduced motion

```
PASS  keyboard-only journey: Home → Dinner for Six → build → assistant change → review → confirm → repair → compare → inspect → history → undo → settings → home
PASS  every control on every screen is reachable by arrows from the initial focus
PASS  focus is restored when returning to a screen, and Back returns to the previous screen
PASS  dialog: opens with focus inside, Tab and arrows stay inside, Escape restores the trigger
PASS  Enter/Space activate exactly once; key repeat does not re-activate; disabled controls are skipped
PASS  removed element: focus falls back to a live neighbour after a replan removes the focused task
PASS  gamepad (emulated standard mapping): D-pad moves once per press, hold repeats, stick deadzone, A selects once, B goes back
PASS  sound: a cue per real focus move (none at an edge), throttled when held, silent when muted, volume saved
PASS  mouse still works and switches off the neon keyboard mode
PASS  text fields keep native editing (caret keys, Enter submits); Up/Down and Escape leave the field
PASS  number field: arrows pass through without changing the value; after typing, Up/Down edit natively
PASS  reduced motion: focus has no pulse or scale but keeps the static cyan outline
PASS  neon focus visible at 1920×1080, 1440×900 and 1280×720 (screenshots)
PASS  no console errors, warnings or uncaught exceptions
Navigation QA: 14 passed, 0 failed. Screenshots in evidence/neon/
```

## `npm run test:chat` — assistant history, accordion, remote-only browsing (1920 / 1440 / 1280 / 768)

```
PASS  1280×720: history scrolls inside its region, composer stays visible and clear of it, newest message in view
PASS  1280×720: opening the first panel keeps the reading position, closes the others, and lower messages stay reachable
PASS  1280×720: keyboard only — reach a panel summary with arrows, Enter toggles it, composer reachable
PASS  1440×900: history scrolls inside its region, composer stays visible and clear of it, newest message in view
PASS  1440×900: opening the first panel keeps the reading position, closes the others, and lower messages stay reachable
PASS  1440×900: keyboard only — reach a panel summary with arrows, Enter toggles it, composer reachable
PASS  1920×1080: history scrolls inside its region, composer stays visible and clear of it, newest message in view
PASS  1920×1080: opening the first panel keeps the reading position, closes the others, and lower messages stay reachable
PASS  1920×1080: keyboard only — reach a panel summary with arrows, Enter toggles it, composer reachable
PASS  1920×1080 remote: enter history, oldest ↔ newest, read and toggle agent steps, Back, quick action, scroll buttons, Plan status
PASS  1440×900 remote: enter history, oldest ↔ newest, read and toggle agent steps, Back, quick action, scroll buttons, Plan status
PASS  1280×720 remote: enter history, oldest ↔ newest, read and toggle agent steps, Back, quick action, scroll buttons, Plan status
PASS  768×1024 remote: enter history, oldest ↔ newest, read and toggle agent steps, Back, quick action, scroll buttons, Plan status
PASS  no console errors
Chat QA: 14 passed, 0 failed. Screenshots in evidence/assistant/
```

## `npm run audit:responsive` — 10 viewports from 430×932 to 1920×1080, every screen and the dialog

Page overflow, text cut off, elements past the viewport, controls under 24 px, overlapping cards, content outside its
card, blank task bars, nested scrolling in the timeline preview, a focused task hidden in a scrolling timeline.

```
Responsive audit: 10 viewports × 9 states, 0 problem(s). Screenshots in evidence/responsive/
```

## `npm run test:scroll` — every scroll container, arrows only, six viewports

```
Scroll audit: 74 scroll directions exercised with arrows only; 0 problem(s).
  1920×1080: home 0, home tasks 1, workspace 1, assistant 1, repair 2, compare 1, history 1, settings 0, dialog 0
  1440×900: home 0, home tasks 1, workspace 1, assistant 1, repair 3, compare 3, history 1, settings 1, dialog 0
  1280×720: home 1, home tasks 2, workspace 2, assistant 1, repair 3, compare 3, history 2, settings 1, dialog 0
  1024×768: home 1, home tasks 2, workspace 1, assistant 2, repair 2, compare 1, history 2, settings 1, dialog 0
  768×1024: home 1, home tasks 2, workspace 2, assistant 2, repair 2, compare 1, history 2, settings 1, dialog 0
  430×932: home 1, home tasks 1, workspace 1, assistant 1, repair 1, compare 1, history 2, settings 0, dialog 0
```

## `npm run test:create` — Create your own plan (from scratch, 20-task / 6-person example, full journey)

```
PASS  sidebar and Home open the builder; built-in scenarios still listed
PASS  a plan typed from scratch is validated and planned by the engine
PASS  an impossible budget is reported with the proven reason, and Save & build stays disabled
PASS  a required task cannot depend on an optional one (engine rule shown with task names)
PASS  save → listed on Home → build → plan is the custom one
PASS  the 20-task / 6-person example builds and runs the full journey
PASS  impossible budget on the custom plan: nothing committed, verified option offered
PASS  undo, reload and history keep the custom plan
PASS  export → import round-trip, edit and delete
PASS  keyboard: the builder is reachable and editable without a mouse
PASS  no console errors
Create QA: 11 passed, 0 failed. Screenshots in evidence/create/
```

## Production build — `npm run build` + `npm run verify:dist`

```
Build: 20 files, 409.3 KiB → dist/
Build verification passed: all local references resolve; no runtime network dependencies.
Dist: 20 files served (HTTP 200); booted offline from dist/ and built a validated plan (66 checks).
Production build verified.
```

Screenshots: `evidence/` (smoke, all viewports), `evidence/populated/` (31 populated screens),
`evidence/story/` (Plan A → disruption → review → repair in motion → Plan B → Repair Workflow → Before/After),
`evidence/neon/` (focused elements), `evidence/assistant/` (chat), `evidence/responsive/` (10 viewports).

## Not tested

- Live LLM requests (no API key available). The adapter is exercised only with an injected stub client; nothing is
  claimed about a real model's parsing accuracy, latency or cost.
- Real Alexa devices, voice, or Alexa APIs (none are used; this is a simulation).
- Real gamepads, TV browsers and Fire TV remotes were not available: gamepad input was emulated through the Gamepad API
  in Chrome and remote keys through keyboard events. Whether a device's browser delivers its Back key to the page is
  device-specific.
- Browsers other than desktop Chrome (phone/tablet sizes were emulated by viewport, not real devices).
- Screen readers were not run. Accessible names, focus order/visibility, Escape handling and reduced motion are
  checked automatically; assistive-technology behaviour itself is unverified.
- Colour contrast was set from token values (secondary text ≥4.5:1 on card surfaces), not measured per element.
- Sound was verified through an instrumented AudioContext (which cues play, when, throttling, mute); how it sounds on
  real speakers was judged by ear only on the development machine.
