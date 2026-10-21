import { saveState, loadState, memoryStorage, STORAGE_KEY } from '../src/persistence.js';

/** Serializes a session through the real persistence layer, as a page reload would. */
export function persistRoundTrip(session) {
  const first = memoryStorage();
  saveState(first, { session, ui: {} });
  const res = loadState(memoryStorage({ [STORAGE_KEY]: first.getItem(STORAGE_KEY) }));
  if (!res.ok) throw new Error(`reload failed: ${res.reason}`);
  return res.session;
}
