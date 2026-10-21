# Demo script — target 2:45 (must stay under 3:00)

Film the real app. Every number below was produced by the current build (`node scripts/check-fixtures.mjs dinner-for-six`);
if anything differs on recording day, narrate what the screen shows, not this script.

## Before recording

1. `npm start`, open http://localhost:5173 in a 1440×900 (or 1920×1080) browser window, zoom 100%.
2. Click **New session** if a previous session is restored (or clear site data) so the gallery is shown.
3. Close other tabs/notifications. No third-party music; use your own voice or silence + captions.
4. Optional dry run: `npm run test:smoke` should report 15 passed.

## Storyboard

| Time | On screen (real action) | Voiceover |
|---|---|---|
| 0:00–0:12 | Gallery → click **Dinner for Six** → setup form → **Build Feasible Plan**. KPI shows ✓ Feasible, 66 checks, ends 6:50 PM, $82 / $100. | "Most assistants make plans. PlanB repairs them when reality changes." |
| 0:12–0:35 | Hover the chart: Alex/Sam/Leila lanes, hands-free roast in the oven, Oven/Stovetop/Car rows, deadline line at 7:00 PM. | "A deterministic engine checks dependencies, people, equipment, budget and the deadline — and an independent validator re-checks every plan." |
| 0:35–1:12 | Type **Guests are arriving an hour early and the oven broke.** → Enter. Bars animate; dashed outlines show old positions; oven row turns hatched; deadline moves 7:00 → 6:00 PM. | "Two constraints change at once. The roast can't use a broken oven, so the listed fallback — pan-searing on the stovetop — is selected. Dessert switches to fruit cups. Dinner is served 5:55 PM." |
| 1:12–1:40 | Right panel **Why it changed**: Replaced / Reassigned / Moved cards with badges *Alternative used*, *Equipment down*, *Dependency moved*. Click **Before / After** for side-by-side, then back to **Plan B**. Point to cost $86 / $100. | "Every change carries a reason code and the evidence behind it — not a guessed explanation." |
| 1:40–2:05 | Click chip **Advance clock 40 min** (clock 4:40 PM), then **Sam can't help**. Started work freezes (✓ done / striped in progress); Cook rice → Alex (*Person unavailable*); Plate & serve → Leila. Show the agent activity log steps. | "Second shock, same session. Finished work stays fixed. No invented helpers — the work is redistributed among people who are actually available." |
| 2:05–2:25 | Press **F5** — session, revision r2 and clock return. Click **Budget is now $80**: red panel *No feasible plan — nothing was changed*, proven bound "Cheapest valid plan costs $86 ($73 already committed)", two verified options. Click **Apply** on *Skip "Pick up fresh bread"* → total $79 / $80. | "The session persists. Impossible requests are rejected transparently, with options the planner has verified — and nothing changes until you choose." |
| 2:25–2:45 | Click **Undo last change**, show Session timeline. Cut to terminal: `npm test` (31 pass) and `npm run test:smoke` (15 pass). End on the header badge "Simulated Alexa+ experience · demo". | "A simulated Alexa+ experience for trustworthy household orchestration. Deterministic, validated, and honest about what it can't do." |

## Typed commands that work with the local parser

- `Guests will arrive 60 minutes earlier. The oven is broken.`
- `Sam cannot help anymore.`
- `Our budget is now $80.`
- `Can we still serve the meal on time?`
- `Shopping is running 20 minutes late`
- `Skip the bread`
- `Undo the last change.` / `Restore the original plan`

Unsupported phrasing is answered with "I couldn't map that to a supported change" — do not present the local
parser as AI. Only mention the LLM path if `LLM_API_KEY` is configured and the header badge says "Parser: LLM".
