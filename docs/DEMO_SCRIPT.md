# Demo script — target 2:45 (must stay under 3:00)

Film the real app. Every number below was produced by the current build on this exact sequence; if anything
differs on recording day, narrate what the screen shows, not this script.

## Before recording

1. `npm start`, open http://localhost:5173 in a 1440×900 (or 1920×1080) window at 100% zoom.
2. If a previous session is restored, click **New session** in the app bar so you start on the Home dashboard.
3. Reload once more right before recording so the splash is captured. Close notifications.
4. No third-party music; your own voice or silence plus captions.
5. Optional dry run: `npm test` (80 pass) and `npm run test:smoke` (18 pass).

## Storyboard

| Time | On screen (real action) | Voiceover |
|---|---|---|
| 0:00–0:06 | Reload: splash with the PlanB mark, progress ring and status lines ending "Ready — 171 baseline checks passed". | "PlanB Orchestra." |
| 0:06–0:20 | Home dashboard: Dinner for Six selected; live preview timeline; drag the deadline slider or set budget to $40 → preview turns *No feasible baseline*; set it back to $100 → *Feasible baseline, 66 checks*. Click **Build Feasible Plan**. | "Most assistants make plans. PlanB repairs them. Even the preview is the real planner, re-checked on every change." |
| 0:20–0:30 | Command center: KPIs (✓ Feasible, finish 6:50 PM, $82 / $100), the timeline with lanes for Alex, Sam, Leila, hands-free roast, equipment rows. | "People, equipment, budget and the deadline — validated by an independent checker." |
| 0:30–1:00 | **Type** in the dock: "Guests are arriving an hour early and the oven broke." → bars animate to new slots, dashed outlines mark old positions, deadline marker slides 7:00 → 6:00 PM, oven row hatched, banner *Plan B ready — r1*. Open the reply's **Agent steps**: Intent detected → Constraints changed → Scheduling performed → Validation passed (65 checks) → Differences explained → Plan committed. | "Two changes in one sentence. The agent shows what it understood, what it changed, that it planned and validated, and what moved." |
| 1:00–1:20 | **Changes** tab: roast → *Pan-sear chicken thighs*, tart → *Fruit & yogurt cups* (*Alternative used*, *Equipment down*); *Plate & serve* (*Dependency moved*). Click **Before / After**, then **Plan B**. Finish 5:55 PM, $86 / $100. | "Every change carries a reason code and evidence — no guessed explanations." |
| 1:20–1:48 | Chip **Advance clock 40 min** (clock 4:40 PM). Chip **Sam can't help** → banner r2; Cook rice → Alex (*Person unavailable*). Then **type** "Leila is running 10 minutes late" → r3, Prep & marinate → Alex (*Arrives late*), still 5:55 PM. | "Consecutive changes in my own words. Started work stays fixed; nobody is invented." |
| 1:48–2:18 | Press **F5** — splash, then the same session (r3, 4:40 PM). Chip **Budget is now $80** → red crisis panel *No feasible plan — nothing was changed*: proven bound "Cheapest valid plan costs $86 ($73 already committed)", two verified options. **Apply** *Skip "Pick up fresh bread"* → $79 / $80, r4. | "The session persists. Impossible requests are rejected with the reason, and only verified options are offered — nothing changes until I choose." |
| 2:18–2:45 | **Undo** in the app bar → r3; open the **History** tab. Cut to terminal: `npm test` (80 pass), `npm run test:smoke` (18 pass). End on the app bar badges "Simulated Alexa+ experience · demo" and "Parser: limited local rules (not an LLM)". | "A simulated Alexa+ experience for trustworthy household orchestration — deterministic, validated, and honest about what it can't do." |

## Other phrasings that work with the local parser

"Alex has to leave at 5 PM" · "The car is in the shop" · "Good news, the oven is fixed" · "We only have $60 left" ·
"Spend no more than 90 dollars" · "Cooking the rice will take 10 more minutes" · "Forget the candles" ·
"Push dinner back 30 minutes" · "Can we still make it?" · "Go back" · "Start over".
Birthday: "The aunt is running 30 minutes late" · "The babysitter cancelled". Outing: "We need to be at the lake by 11" ·
"My partner got called into work".

Unsupported phrasing gets "I couldn't map that to a supported change" — do not present the local parser as AI. Only
mention the LLM path if `LLM_API_KEY` is configured, the app bar badge says "Parser: LLM", and you have watched it work.
