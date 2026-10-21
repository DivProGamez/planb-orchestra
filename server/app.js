// Express server: serves the static web client and the optional intent endpoint.
// The planner runs entirely in the browser; this server is never required for planning.

import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { validateIntentRequest } from './schema.js';
import { llmStatus, parseWithLlm } from './llm-adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

export function createApp({ env = process.env, adapter = { llmStatus, parseWithLlm } } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', express.json({ limit: '64kb' }));

  app.get('/api/health', async (req, res) => {
    const llm = await adapter.llmStatus(env);
    res.json({ ok: true, name: pkg.name, version: pkg.version, planner: 'deterministic (client-side)', llm });
  });

  app.post('/api/intent', async (req, res) => {
    const check = validateIntentRequest(req.body);
    if (!check.ok) return res.status(400).json({ ok: false, error: check.error });
    const status = await adapter.llmStatus(env);
    if (!status.enabled) return res.status(503).json({ ok: false, error: 'llm_unavailable', reason: status.reason, fallback: 'local' });
    const result = await adapter.parseWithLlm(check.text, check.state, { env });
    if (!result.ok) return res.status(502).json({ ok: false, error: 'llm_rejected', reason: result.error, fallback: 'local' });
    return res.json({ ok: true, parsed: result.parsed });
  });

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'not_found' }));
  app.use(express.static(path.join(root, 'src'), { extensions: ['html'] }));

  // Malformed JSON and other errors → JSON 400/500 instead of an HTML stack trace.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.type === 'entity.parse.failed' || err.type === 'entity.too.large' ? 400 : 500;
    res.status(status).json({ ok: false, error: status === 400 ? 'bad_request' : 'server_error' });
  });
  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 5173;
  createApp().listen(port, () => {
    console.log(`PlanB Orchestra running at http://localhost:${port}`);
  });
}
