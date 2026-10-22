# Product feedback

Facts only, from building this project. **No Amazon developer tool, Alexa API, Alexa+ SDK or MCP server was used**
(the project uses the simulated web-experience route), so there is no Amazon product feedback from this build.
If you test official Amazon tooling before submitting, add a section from your own experience — do not invent one.

## Node.js (v24.11.0) — built-in test runner `node:test`

- **Used for:** 92 unit, integration, scenario, parser-corpus, offline LLM-adapter, navigation/sound and randomized-audit tests; no test framework dependency.
- **Worked well:** zero install, ESM support, `t.diagnostic()` for reporting audit counts.
- **Would use again:** yes.

## Express 5.1.0

- **Used for:** static hosting, `/api/health`, `/api/intent`, JSON error handling for malformed bodies.
- **Worked well:** small surface; JSON parse errors are catchable in an error handler (`entity.parse.failed`).
- **Would use again:** yes.

## playwright-core 1.56.1 with locally installed Chrome

- **Used for:** all browser suites (journey, release QA, navigation, chat, responsive, scroll, populated-screen audit), every screenshot in `evidence/`, and the demo-video recording — without downloading a browser.
- **Worked well:** `executablePath` to an existing Chrome; `route()` to simulate an API outage.
- **Friction (our mistake, worth noting):** each `browser.newContext()` has its own localStorage, so a "reload restores
  the session" check in a new context initially failed; using one context fixed it.
- **Would use again:** yes.

## Anthropic TypeScript SDK 0.137.0 (optional adapter)

- **Used for:** `server/llm-adapter.js` (structured output via `messages.parse` + `zodOutputFormat`).
- **Verified:** the package imports and exposes those functions; the adapter logic is tested offline with an injected stub client. **Not verified:** any live request — no API key was
  available, so no claim is made about latency, accuracy or cost.

## Web platform (Chrome 1xx, observed while building remote navigation)

- There is no built-in spatial navigation in browsers; the CSS Spatial Navigation draft is not shipped, so every
  TV-style web app needs its own engine. We wrote a small one (`src/nav.js`) rather than adopt a React-oriented library.
- The Gamepad API only reports controllers after a button press and requires polling; a "gamepad connected" event
  without a press would make first-use feedback easier.
- `<details>` fires `toggle` when an element is created already open, which is easy to mistake for a user action.

## Answers to the submission questions

- **Which developer tools, APIs and SDKs did you use and for what?** Node.js (runtime and `node:test`), Express
  (static server and intent endpoint), playwright-core with an installed Chrome (browser testing, screenshots and the
  demo recording), the browser's Web Audio and Gamepad APIs (interface sounds, controller input), FFmpeg (video edit),
  and the Anthropic SDK in an optional, offline-tested adapter. No Amazon developer tool, Alexa API or MCP server was
  used: this is the simulated Alexa+ web-experience route.
- **What worked well?** Zero-dependency testing with `node:test`; driving an already-installed Chrome with
  playwright-core; Express's small surface.
- **What needs work?** See the sections above (Playwright per-context storage, missing browser spatial navigation,
  Gamepad API discovery, `<details>` toggle events) and `docs/FRICTION_LOG.md`.
- **Onboarding (zero to hello world):** fast for Node.js and Express (minutes). The optional SDK install failed once on
  a full disk, which is why the adapter is lazily imported and optional.
- **Would you build with these again?** Yes: the stack stayed small, offline-capable and fully testable.
