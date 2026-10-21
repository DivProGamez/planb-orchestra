// Versioned localStorage persistence with safe migration. The storage object is injected
// so the same code runs in the browser and in Node tests.

import { SESSION_VERSION } from './engine/session.js';

export const STORAGE_KEY = 'planb-orchestra.state';
export const STORAGE_VERSION = 2;

// v1 envelopes stored the session only; v2 adds UI selection state.
const MIGRATIONS = {
  1: (env) => ({ ...env, version: 2, ui: { view: 'plan', selectedTaskId: null } }),
};

function isValidSession(session) {
  return Boolean(
    session && session.version === SESSION_VERSION && Array.isArray(session.revisions) && session.revisions.length > 0
      && session.revisions.every((r) => r.plan && r.plan.feasible === true && r.state && r.state.scenario)
      && Number.isInteger(session.nowMin),
  );
}

export function saveState(storage, { session, ui }) {
  try {
    const envelope = { version: STORAGE_VERSION, savedAt: Date.now(), session, ui: ui || {} };
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'write_failed', message: err.message };
  }
}

export function loadState(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (err) {
    return { ok: false, reason: 'unavailable', message: err.message };
  }
  if (raw === null || raw === undefined) return { ok: false, reason: 'empty' };
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    clearState(storage);
    return { ok: false, reason: 'corrupt', message: 'Saved session could not be read and was cleared.' };
  }
  if (!env || typeof env !== 'object' || !Number.isInteger(env.version)) {
    clearState(storage);
    return { ok: false, reason: 'corrupt', message: 'Saved session had no version and was cleared.' };
  }
  if (env.version > STORAGE_VERSION) {
    return { ok: false, reason: 'newer', message: 'Saved session was written by a newer version and was left untouched.' };
  }
  let migrated = false;
  while (env.version < STORAGE_VERSION) {
    const step = MIGRATIONS[env.version];
    if (!step) {
      clearState(storage);
      return { ok: false, reason: 'unmigratable', message: `No migration from storage version ${env.version}; saved session cleared.` };
    }
    env = step(env);
    migrated = true;
  }
  if (!isValidSession(env.session)) {
    clearState(storage);
    return { ok: false, reason: 'invalid', message: 'Saved session failed validation and was cleared.' };
  }
  if (migrated) saveState(storage, env);
  return { ok: true, session: env.session, ui: env.ui || {}, savedAt: env.savedAt, migrated };
}

export function clearState(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode); nothing to clear.
  }
}

/** Minimal in-memory Storage implementation for tests and for browsers that block storage. */
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}
