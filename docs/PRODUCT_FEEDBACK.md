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

- **Used for:** 17-check browser smoke test and every screenshot in `evidence/`, without downloading a browser.
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
