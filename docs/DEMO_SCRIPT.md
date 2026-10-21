# Demo script — target 2:45 (must stay under 3:00)

Film the real app at 1920×1080 (or 1440×900), 100% zoom. Every number below comes from the current build on this
exact sequence; if anything differs on recording day, narrate what the screen shows, not this script.

## Before recording

1. `npm start`, open http://localhost:5173. If a session is restored, open **Settings & Transparency → Clear saved session**.
2. Keep **Settings → Review changes before replanning** on (default).
3. Close notifications. No third-party music; your own voice or silence plus captions.
4. Optional dry run: `npm test` (80 pass) and `npm run test:smoke` (26 pass).

## Storyboard

| Time | On screen (real action) | Voiceover |
|---|---|---|
| 0:00–0:05 | Reload: splash (about 2.4 s) walks through the real start-up steps — "Ready — 171 baseline checks passed". | "PlanB Orchestra." |
| 0:05–0:20 | **Scenarios & Home**: Dinner for Six hero (10 tasks, 3 people, 66 checks, 10 min slack) and live preview. Set budget to 40 → *No feasible baseline* with the reason; back to 100 → *Feasible*. Click **Build feasible plan**. | "Most assistants make plans. PlanB repairs them — even this preview is the real planner." |
| 0:20–0:30 | **Plan Workspace**: KPI row (✓ Feasible, 66 checks, finish 6:50 PM, $82 / $100); the timeline with Alex, Sam, Leila, hands-free roast and Oven/Stovetop/Car lanes. Click the roast bar → Task Inspector. | "People, equipment, budget and the deadline — and an independent validator re-checks every plan." |
| 0:30–0:58 | Click **Simulate disruption** (or press D). Type "Guests are arriving an hour early and the oven broke." → **Review change**: *I understood* Deadline 60 min earlier · Oven unavailable; deltas 7:00 → 6:00 PM, Oven available → down; dry run *Feasible · 4 tasks change · 6:50 → 5:55 PM · $82 → $86*. Click **Apply & replan** → bars animate, outlines show old positions, deadline slides, oven lane hatched, banner *Plan B ready — r1*. | "Before anything changes, PlanB shows what it understood and a dry run. Then it repairs the plan, in front of you." |
| 0:58–1:20 | Banner → **See before / after**: Plan A marks the tasks that change; Plan B shows *Replaced*, *Reassigned*, *Moved* chips; change map: roast → *Pan-sear chicken thighs* (*Alternative used*, *Equipment down*), *Plate & serve* (*Dependency moved*). Then **Repair Workflow**: six completed stages. | "Every change has a reason code with evidence — not a guessed explanation." |
| 1:20–1:48 | **Assistant & Copilot**: chip *Advance clock 40 min* (clock 4:40 PM), chip *Sam can't help* → review card → **Apply & replan** (r2, Cook rice → Alex, *Person unavailable*). Type "Leila is running 10 minutes late" → review → apply (r3, still 5:55 PM). | "Consecutive changes in my own words. Started work stays fixed; nobody is invented." |
| 1:48–2:18 | Press **F5** — same session, r3, 4:40 PM. Assistant chip *Budget is now $80* → review shows *No feasible plan* → **Record & show options** → crisis panel: proven bound "Cheapest valid plan costs $86 ($73 already committed)" and two verified options. **Apply** *Skip "Pick up fresh bread"* → $79 / $80, r4. | "Impossible requests are rejected with the reason, and only options the planner has verified are offered." |
| 2:18–2:45 | **Undo** in the top bar → r3; open **History & Revisions** (revision timeline + snapshot diff). Cut to terminal: `npm test` (80 pass), `npm run test:smoke` (26 pass). End on **Settings & Transparency** (simulated Alexa+, local rule parser, deterministic engine). | "A simulated Alexa+ experience for trustworthy household orchestration — deterministic, validated, and honest about what it can't do." |

## Other phrasings that work with the local parser

"Alex has to leave at 5 PM" · "The car is in the shop" · "Good news, the oven is fixed" · "We only have $60 left" ·
"Spend no more than 90 dollars" · "Cooking the rice will take 10 more minutes" · "Forget the candles" ·
"Push dinner back 30 minutes" · "Can we still make it?" · "Go back" · "Start over".
Birthday: "The aunt is running 30 minutes late" · "The babysitter cancelled". Outing: "We need to be at the lake by 11" ·
"My partner got called into work".

Unsupported phrasing gets "I couldn't map that to a supported change" — do not present the local parser as AI. Only
mention the LLM path if `LLM_API_KEY` is configured, the top bar says "Parser: LLM", and you have watched it work.
