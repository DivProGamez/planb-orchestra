# Friction log

Only issues actually observed while building. None of them concern Amazon tooling, because none was used
(simulated web experience route). Do not submit these as Amazon product friction.

| # | Task | Steps | Expected | Observed | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|---|
| 1 | Install optional SDK | `npm install --save-exact @anthropic-ai/sdk zod` | Packages installed | `ENOSPC: no space left on device` mid-write; partial `node_modules` left behind (C: had ~50 MB free) | High (blocked install) | Removed partial folders; made the SDK a lazily imported optional add-on so the core app needs only Express | npm could check free space before extracting and roll back partial installs |
| 2 | Browser smoke test | New Playwright context per viewport | Saved session visible on reload | Each context had empty localStorage → 4 checks timed out | Medium (false failures) | One shared context, viewport per page | — (expected behaviour; our harness bug) |
| 3 | Scripted file edits | Node `String.replace` with a replacement containing `$'` | Literal text inserted | `$'` expanded to "text after match", duplicating ~200 lines and breaking the page | High (page crashed) | Detected by `node --check` and smoke test; duplicate block removed (verified identical); fixed with literal edits | Use a function replacement or `split/join` for literal replacements |
| 4 | Impossible deadline | "Guests arrive 3 hours earlier" at 4:00 PM | Plain-language rejection | Internal schema message ("deadlineMin must be an integer after startMin") shown to the user | Medium | Shock validation now rejects deadlines at/before the current time; regression test added | — |
| 5 | Card containment | Gave cards `overflow: hidden` to stop a pill spilling out | Cards keep their height | In a fixed-height grid, an overflow-hidden item's automatic minimum height is 0: Settings cards shrank and cut their own last rows | High (controls hidden) | Removed the clipping, `grid-auto-rows: max-content`; a containment check now runs on every screen at 10 viewports | — (CSS spec behaviour; our mistake) |
| 6 | Agent-steps accordion | Re-render a `<details open>` element | No toggle event | The browser fires `toggle` for re-created open panels too, which was recorded as a user choice and pinned an old panel open | Medium | Only toggles that follow a user click count; state is set synchronously on the click | — |
| 7 | Duplicate-press guard | Second OK on the same remote within 160 ms | Activates | The guard meant for keyboard + gamepad duplicates also swallowed a fast second press from one source (found by an intermittent test) | Medium | Guard applies only across different input sources | — |
| 8 | Number field on a remote | D-pad Down through the Home form | Focus moves on | The budget field kept native Up/Down: focus stuck and the budget silently changed | High (data changed) | Up/Down edit a number only after the user starts editing it (typing, click or OK) | — |

