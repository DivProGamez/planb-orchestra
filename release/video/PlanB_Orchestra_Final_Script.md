# PlanB Orchestra — final demo script (as delivered)

Source: `A2_VIDEO_STORYBOARD.md` (six beats) and the supplied narration `A2 Voice-over.mp3` (51.8 s, one voice).
The narration is the supplied recording, cut at its natural pauses into six scene files (`audio/voice_0X_*.wav`).
One factual correction was made (see the end of this file). Final length: **2:46** (166.0 s).

| Beat | Video | On screen (real app, recorded at real speed) | Narration (exact words heard) |
|---|---|---|---|
| 1 · The problem | 0:00–0:15 | Scenarios & Home: Dinner for Six selected (Validated preview · Not built yet), cursor passes the card, Constraints (deadline 7:00 PM, budget $100, Alex/Sam/Leila, Oven ×1, Stovetop ×2, Car ×1), ends on the validator figure (66 checks · 0 violations). | "Plans don't fail at planning. They fail at the first surprise." |
| 2 · The plan | 0:15–0:45 | **Build feasible plan** → Plan Workspace. Click "Roast chicken in the oven": Task Inspector (hands-free, 5:05–6:35 PM, 90 min, $0, Oven ×1, depends on Prep & marinate chicken, needed before Plate & serve, fallback Pan-sear chicken thighs). Pan across people lanes, then equipment lanes. KPIs: Feasible · 66 checks · finish 6:50 PM · $82 / $100. | "PlanB schedules a real dinner: owners, dependencies, equipment, a budget — checked by a constraint engine, and re-checked by an independent validator." |
| 3 · The surprise | 0:45–1:25 | **Simulate disruption** → types *Guests are arriving an hour early and the oven broke.* → **Review change**. Review held ~13 s (zoomed): I understood *Deadline 60 min earlier (7:00 PM → 6:00 PM)* and *Oven unavailable*; constraint changes; dry run *Feasible · 4 tasks change · finish 6:50 PM → 5:55 PM · $82 → $86 · 65 checks pass*. **Apply & replan** → bars move, previous positions dashed, banner *Plan B ready — r1*. | "Now the surprise: guests an hour early, and no oven. PlanB first shows what it understood — nothing moves until you confirm." |
| 4 · The repair | 1:25–2:00 | **Timeline Compare**: Plan A over Plan B; change map T-01…T-04. Click the Pan-sear bar → T-02 *Roast chicken in the oven → Pan-sear chicken thighs* with *Alternative used · Equipment down · Rebalanced* (zoomed). Summary: Feasible · 4 of 10 changed · 65 checks; finish 6:50 → 5:55 PM; buffer 10 → 5 min; cost $82 → $86. | "Every change is explained by the constraint that forced it. New finish: five fifty-five — five minutes before the guests walk in." |
| 5 · Memory | 2:00–2:25 | **Assistant & Copilot**: types *Sam can't help* → Review (*Sam unavailable from 4:00 PM* · feasible · 7 tasks change · 64 checks) → **Apply & replan** (r2). Page reload (F5): same session restored. **History & Revisions**: r2 · r1 · r0. | "A second shock, absorbed. And the plan remembers — this session survives a reload." |
| 6 · Honesty | 2:25–2:46 | **Simulate disruption** → structured change *Budget reduced to* **30** → Review: *No feasible plan. Cheapest valid plan costs $59 … the budget is $30 · 1 verified option* → **Record & show options**: *No feasible plan — nothing was changed*, **PROVEN BOUND · BUDGET_EXCEEDED**, verified option *Set the budget to $59 instead* (re-planned and validated: finishes 6:00 PM, total $59). Settings & Transparency, then Scenarios & Home. End card. | "And when no plan exists, PlanB says so — it never invents time, people, or money. In its own audit: zero broken constraints. PlanB Orchestra — a simulated Alexa+ experience." |

End card (text overlay, the only added text besides captions): **PlanB Orchestra** · *The assistant that rebuilds your
plan* · *A simulated Alexa+ experience · not affiliated with or endorsed by Amazon*.

## Narration correction (factual)

The supplied MP3 says "In its own audit: **three hundred random shock sequences**, zero broken constraints." The project's
audit (`tests/audit.test.js`) runs **500** random sequences (911 feasible replans and 148 infeasible outcomes in the
latest run, 0 violations). The phrase "three hundred random shock sequences," was removed at its natural pauses
(MP3 43.60–45.75 s, silence to silence), leaving "In its own audit: zero broken constraints." — true, and in the
narrator's own voice. Nothing else in the narration was changed, re-ordered, stretched or re-timed.

## The $30 budget (verified, not assumed)

The engine reports $30 as **proven** infeasible, not merely "not found": the cheapest valid plan costs $59 (a bound the
planner proves from the required tasks' cheapest versions), so the review and crisis panel label it *PROVEN BOUND*.
The single verified option ($59 budget) was re-planned and validated by the app; it was shown, not applied, so the
recorded session stays at r2 (`raw/recording_events.json` → final revisions 3).

## Voice

The supplied recording was used. A new narration was considered: the only text-to-speech available on this machine is
Windows SAPI (Microsoft David, Zira and Mark), which is clearly lower quality than the supplied voice; no premium voice
service is configured (no keys present). Producing a new voice would therefore have lowered quality.
