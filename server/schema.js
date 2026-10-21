// Request/response validation for the API. LLM output is treated as untrusted input and must
// pass the same allowlisted shock schema (src/engine/shocks.js) as the local parser.

import { validateScenario } from '../src/engine/validate.js';
import { SHOCK_TYPES, validateShocks } from '../src/engine/shocks.js';

export const INTENTS = ['shocks', 'undo', 'restore', 'status', 'help', 'advance', 'unknown'];
export const MAX_TEXT = 500;

/** Validates POST /api/intent bodies: { text, context: { scenario, nowMin, committed? } }. */
export function validateIntentRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object' };
  const { text, context } = body;
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'text must be a non-empty string' };
  if (text.length > MAX_TEXT) return { ok: false, error: `text must be at most ${MAX_TEXT} characters` };
  if (!context || typeof context !== 'object') return { ok: false, error: 'context is required' };
  if (!Number.isInteger(context.nowMin)) return { ok: false, error: 'context.nowMin must be an integer' };
  const structural = validateScenario(context.scenario);
  if (!structural.ok) return { ok: false, error: `context.scenario is invalid: ${structural.errors[0].message}` };
  const state = { scenario: context.scenario, committed: context.committed || {}, nowMin: context.nowMin };
  return { ok: true, text: text.trim(), state };
}

/**
 * Converts raw model output into a parsed intent, rejecting anything outside the schema.
 * raw: { intent, shocks: [{ type, ...fields }], advanceMinutes }
 */
export function validateIntentResult(raw, state) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Model output is not an object' };
  if (!INTENTS.includes(raw.intent)) return { ok: false, error: `Unsupported intent "${raw.intent}"` };
  if (raw.intent === 'advance') {
    const m = raw.advanceMinutes;
    if (!Number.isInteger(m) || m < 1 || m > 600) return { ok: false, error: 'advanceMinutes must be an integer from 1 to 600' };
    return { ok: true, parsed: { intent: 'advance', minutes: m, shocks: [], parser: 'llm' } };
  }
  if (raw.intent !== 'shocks') return { ok: true, parsed: { intent: raw.intent, shocks: [], parser: 'llm' } };
  if (!Array.isArray(raw.shocks) || raw.shocks.length === 0) return { ok: false, error: 'shocks must be a non-empty array' };
  const shocks = [];
  for (const item of raw.shocks) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Each shock must be an object' };
    const spec = SHOCK_TYPES[item.type];
    if (!spec) return { ok: false, error: `Unsupported shock type "${item.type}"` };
    const payload = {};
    for (const f of spec.fields) payload[f] = item[f];
    shocks.push({ type: item.type, payload });
  }
  const checked = validateShocks(shocks, state);
  if (!checked.ok) return { ok: false, error: checked.errors.join('; ') };
  return { ok: true, parsed: { intent: 'shocks', shocks: checked.shocks, parser: 'llm' } };
}
