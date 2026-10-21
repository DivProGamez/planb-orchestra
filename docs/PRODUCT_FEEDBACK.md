# Product feedback

Facts only, from building this project. **No Amazon developer tool, Alexa API, Alexa+ SDK or MCP server was used**
(the project uses the simulated web-experience route), so there is no Amazon product feedback from this build.
If you test official Amazon tooling before submitting, add a section from your own experience — do not invent one.

## Node.js (v24.11.0) — built-in test runner `node:test`

- **Used for:** 31 unit, integration and randomized-audit tests; no test framework dependency.
- **Worked well:** zero install, ESM support, `t.diagnostic()` for reporting audit counts.
- **Would use again:** yes.

## Express 5.1.0

- **Used for:** static hosting, `/api/health`, `/api/intent`, JSON error handling for malformed bodies.
- **Worked well:** small surface; JSON parse errors are catchable in an error handler (`entity.parse.failed`).
- **Would use again:** yes.

## playwright-core 1.56.1 with locally installed Chrome

- **Used for:** 15-check browser smoke test and every screenshot in `evidence/`, without downloading a browser.
- **Worked well:** `executablePath` to an existing Chrome; `route()` to simulate an API outage.
- **Friction (our mistake, worth noting):** each `browser.newContext()` has its own localStorage, so a "reload restores
  the session" check in a new context initially failed; using one context fixed it.
- **Would use again:** yes.

## Anthropic TypeScript SDK 0.137.0 (optional adapter)

- **Used for:** `server/llm-adapter.js` (structured output via `messages.parse` + `zodOutputFormat`).
- **Verified:** the package imports and exposes those functions. **Not verified:** any live request — no API key was
  available, so no claim is made about latency, accuracy or cost.
