// OPTIONAL natural-language adapter (Claude via the official Anthropic SDK).
// Disabled unless LLM_API_KEY is set AND the optional packages are installed:
//   npm install @anthropic-ai/sdk zod
// The model only proposes structured shocks; server/schema.js re-validates every field and
// the deterministic engine does all planning. Any failure falls back to the local parser.

import { SHOCK_TYPES } from '../src/engine/shocks.js';
import { formatClock } from '../src/engine/model.js';
import { validateIntentResult } from './schema.js';

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_TIMEOUT_MS = 12000;

let sdkPromise = null;
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import('@anthropic-ai/sdk'),
      import('zod'),
      import('@anthropic-ai/sdk/helpers/zod'),
    ])
      .then(([sdk, zod, helpers]) => ({ Anthropic: sdk.default, z: zod.z, zodOutputFormat: helpers.zodOutputFormat }))
      .catch(() => null);
  }
  return sdkPromise;
}

export async function llmStatus(env = process.env) {
  if (!env.LLM_API_KEY) return { enabled: false, reason: 'LLM_API_KEY is not set' };
  const sdk = await loadSdk();
  if (!sdk) return { enabled: false, reason: 'Optional packages @anthropic-ai/sdk and zod are not installed' };
  return { enabled: true, provider: 'anthropic', model: env.LLM_MODEL || DEFAULT_MODEL };
}

function buildSchema(z) {
  const shock = z.object({
    type: z.enum(Object.keys(SHOCK_TYPES)),
    minutes: z.number().int().nullable(),
    personId: z.string().nullable(),
    fromMin: z.number().int().nullable(),
    resourceId: z.string().nullable(),
    newCap: z.number().int().nullable(),
    taskId: z.string().nullable(),
    extraMin: z.number().int().nullable(),
  });
  return z.object({
    intent: z.enum(['shocks', 'undo', 'restore', 'status', 'help', 'advance', 'unknown']),
    shocks: z.array(shock),
    advanceMinutes: z.number().int().nullable(),
  });
}

function systemPrompt(state) {
  const s = state.scenario;
  const ids = {
    people: s.people.map((p) => ({ id: p.id, name: p.name })),
    equipment: s.resources.map((r) => ({ id: r.id, name: r.name, available: r.available })),
    tasks: s.tasks.filter((t) => t.status === 'todo').map((t) => ({ id: t.id, title: t.title, priority: t.priority })),
  };
  return [
    'You translate one household-planning message into structured changes for a deterministic scheduler.',
    'Use only the ids listed below. Never invent people, equipment, tasks or amounts.',
    'Shock types: deadline_earlier {minutes}, deadline_extended {minutes}, person_unavailable {personId, fromMin or null for "from now"},',
    'person_delayed {personId, minutes}, person_available {personId}, resource_unavailable {resourceId}, resource_restored {resourceId},',
    'budget_reduced {newCap}, budget_increased {newCap}, duration_increase {taskId, extraMin}, task_skipped {taskId}.',
    'Set every field a type does not use to null. Times are integer minutes since the scenario start.',
    `Minute 0 is ${formatClock(s, 0)}. Now is minute ${state.nowMin} (${formatClock(s, state.nowMin)}). Deadline is minute ${s.deadlineMin} (${formatClock(s, s.deadlineMin)}). Budget: $${s.budgetCap}.`,
    'Use intent "advance" with advanceMinutes when the user moves the clock; "status" for questions about the plan;',
    '"undo", "restore" or "help" when asked; "unknown" when the message does not map to these.',
    `Valid ids: ${JSON.stringify(ids)}`,
  ].join('\n');
}

/**
 * Returns { ok: true, parsed } or { ok: false, error } — never throws.
 * `client` may be injected (tests use an offline stub); otherwise the SDK client is built from LLM_API_KEY.
 */
export async function parseWithLlm(text, state, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, client = null, outputFormat = null } = {}) {
  let model = env.LLM_MODEL || DEFAULT_MODEL;
  let APIError = null;
  if (!client) {
    const status = await llmStatus(env);
    if (!status.enabled) return { ok: false, error: status.reason };
    const { Anthropic, z, zodOutputFormat } = await loadSdk();
    client = new Anthropic({ apiKey: env.LLM_API_KEY, maxRetries: 0 });
    outputFormat = zodOutputFormat(buildSchema(z));
    model = status.model;
    APIError = Anthropic.APIError;
  }
  try {
    const response = await client.messages.parse(
      {
        model,
        max_tokens: 2048,
        output_config: { effort: 'low', format: outputFormat },
        system: systemPrompt(state),
        messages: [{ role: 'user', content: text }],
      },
      { timeout: timeoutMs },
    );
    if (response.stop_reason === 'refusal') return { ok: false, error: 'Model declined the request' };
    if (!response.parsed_output) return { ok: false, error: 'Model output did not match the schema' };
    return validateIntentResult(response.parsed_output, state);
  } catch (err) {
    if (APIError && err instanceof APIError) return { ok: false, error: `Provider error ${err.status ?? ''}`.trim() };
    return { ok: false, error: 'Provider request failed or timed out' };
  }
}

export { systemPrompt };
