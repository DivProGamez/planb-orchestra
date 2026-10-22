# Competition checklist

Checked = verified in this repository. Unchecked = not done or needs the operator. Deadline: Friday 23 October 2026,
19:00 Casablanca / 12:00 PDT (internal target 15:00 Casablanca).

## Build (verified)

- [x] Running app with plan → shock → replan → diff → second shock → undo → reload → infeasible flow (smoke test, `docs/TEST_REPORT.md`).
- [x] Tests actually executed and copied to `docs/TEST_REPORT.md` from one run: 92 unit tests, 26 journey checks, 14 release QA checks, 14 navigation checks, 14 chat checks, populated-screen audit (31 screenshots), responsive audit (10 viewports), scroll audit (every scroll container, arrows only).
- [x] Production build verified offline (`npm run build`, `npm run verify:dist`).
- [x] Mouse-free navigation (keyboard, remote keys, emulated gamepad), neon focus, interface sounds with mute/volume.
- [x] All three baseline scenarios independently validated; hard and impossible cases tested.
- [x] UI labels the simulated Alexa+ experience and the limited local parser; no Amazon logo or endorsement claim.
- [x] `.env` ignored; `.env.example` contains names only; no keys, passwords or personal data in the repo.
- [x] Screenshots in `evidence/` come from the real app (smoke run).
- [x] MIT `LICENSE`; README commands (`npm install`, `npm start`, `npm test`, all `test:*` / `audit:*` suites, `npm run build`, `npm run verify:dist`) run in this checkout.
- [x] English demo script (`docs/DEMO_SCRIPT.md`) and Devpost draft (`docs/DEVPOST_SUBMISSION.md`).

## Operator actions (not done)

- [ ] Verify README commands on a fresh clone on another machine.
- [ ] Optional: try a real gamepad and a real TV browser / Fire TV remote; until then the docs say these were emulated, not hardware-tested.
- [ ] Optional: configure `LLM_API_KEY`, verify a live request, then update README/Devpost text — otherwise leave the LLM claim out.
- [ ] Create a public GitHub repository (or private + shared per the rules) and push.
- [ ] Record the < 3:00 English video from the running app; upload as **public** on YouTube/Vimeo.
- [ ] Fill every `[TODO]` in `docs/DEVPOST_SUBMISSION.md` (repo URL, video URL, built-with).
- [ ] Add product feedback from your own use of any Amazon tooling, if any; do not reuse the build friction log as Amazon friction.
- [ ] Select the **Alexa+ — simulated web experience** track; upload screenshots/thumbnail.
- [ ] Confirm eligibility details truthfully and submit well before the deadline.
