# Demo script — target 2:45 (must stay under 3:00)

Film the real app. Every number below was produced by the current build (verified with the engine on the exact
sequence below); if anything differs on recording day, narrate what the screen shows, not this script.

## Before recording

1. `npm start`, open http://localhost:5173 in a 1440×900 (or 1920×1080) window at 100% zoom.
2. Click **New session** if a previous session is restored, so the gallery shows.
3. Close notifications. No third-party music; your own voice or silence plus captions.
4. Optional dry run: `npm test` (80 pass) and `npm run test:smoke` (17 pass).

## Storyboard

| Time | On screen (real action) | Voiceover |
|---|---|---|
| 0:00–0:12 | Gallery → **Dinner for Six** → **Build Feasible Plan**. KPI: ✓ Feasible, 66 checks; finish 6:50 PM; $82 / $100. | "Most assistants make plans. PlanB repairs them when reality changes." |
| 0:12–0:28 | Point at lanes (Alex, Sam, Leila, hands-free roast), Oven/Stovetop/Car rows, deadline line at 7:00 PM. | "A deterministic engine schedules people, equipment, budget and the deadline — and an independent validator re-checks every plan." |
| 0:28–1:00 | **Type** "Guests are arriving an hour early and the oven broke." → Enter. Bars animate, dashed outlines show old positions, oven row hatched, deadline 7:00 → 6:00 PM. Open the reply's **Agent steps**: Intent detected → Constraints changed → Scheduling performed → Validation passed (65 checks) → Differences explained → Plan committed r1. | "Two changes in one sentence. The agent shows each step: what it understood, what changed, that it planned, that the plan passed validation, and what moved." |
| 1:00–1:22 | **Why it changed**: roast → *Pan-sear chicken thighs* and tart → *Fruit & yogurt cups* (badges *Alternative used*, *Equipment down*); *Plate & serve* moved (*Dependency moved*). Click **Before / After**, then **Plan B**. Finish 5:55 PM, $86 / $100. | "Every change has a reason code with evidence — no guessed explanations." |
| 1:22–1:50 | Chip **Advance clock 40 min** (clock 4:40 PM). Chip **Sam can't help** → started work freezes; Cook rice → Alex (*Person unavailable*). Then **type** "Leila is running 10 minutes late" → 4 tasks change, Prep & marinate → Alex (*Arrives late*), still 5:55 PM. | "Consecutive changes on the same session, in my own words. Finished work stays fixed, and nobody is invented." |
| 1:50–2:20 | Press **F5** — revisions r0–r3 and the 4:40 PM clock return. Chip **Budget is now $80** → red panel *No feasible plan — nothing was changed*: proven bound "Cheapest valid plan costs $86 ($73 already committed)", two verified options. Click **Apply** on *Skip "Pick up fresh bread"* → $79 / $80, r4. | "The session persists. Impossible requests are rejected with the reason, and only options the planner has verified are offered. Nothing changes until I choose." |
| 2:20–2:45 | **Undo last change** → back to r3; show Session timeline. Cut to terminal: `npm test` (80 pass) and `npm run test:smoke` (17 pass). End on header badges "Simulated Alexa+ experience · demo" and "Parser: limited local rules (not an LLM)". | "A simulated Alexa+ experience for trustworthy household orchestration — deterministic, validated, and honest about what it can't do." |

## Other phrasings that work with the local parser

"Alex has to leave at 5 PM" · "The car is in the shop" · "Good news, the oven is fixed" · "We only have $60 left" ·
"Spend no more than 90 dollars" · "Cooking the rice will take 10 more minutes" · "Forget the candles" ·
"Push dinner back 30 minutes" · "Can we still make it?" · "Go back" · "Start over".
Birthday: "The aunt is running 30 minutes late" · "The babysitter cancelled". Outing: "We need to be at the lake by 11" ·
"My partner got called into work".

Unsupported phrasing gets "I couldn't map that to a supported change" — do not present the local parser as AI. Only
mention the LLM path if `LLM_API_KEY` is configured, the header badge says "Parser: LLM", and you have watched it work.
