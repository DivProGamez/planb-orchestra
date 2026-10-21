import test from 'node:test';
import assert from 'node:assert/strict';
import { saveState, loadState, memoryStorage, STORAGE_KEY, STORAGE_VERSION } from '../src/persistence.js';
import { currentRevision } from '../src/engine/session.js';
import { newSession, say } from './helpers.js';

test('G1.12 reload restores plan, revision trail and UI selection', () => {
  let session = newSession('dinner-for-six');
  session = say(session, 'Guests are arriving an hour early and the oven broke.').session;
  session = say(session, 'Advance the clock 40 minutes.').session;
  session = say(session, 'Sam cannot help anymore.').session;
  const storage = memoryStorage();
  const ui = { view: 'compare', selectedTaskId: 'roast' };
  assert.equal(saveState(storage, { session, ui }).ok, true);

  // Simulate a page reload: only the serialized string survives.
  const reloaded = memoryStorage({ [STORAGE_KEY]: storage.getItem(STORAGE_KEY) });
  const res = loadState(reloaded);
  assert.equal(res.ok, true);
  assert.deepEqual(res.ui, ui);
  assert.equal(res.session.revisions.length, 3);
  assert.deepEqual(res.session.revisions.map((r) => r.id), ['r0', 'r1', 'r2']);
  assert.deepEqual(currentRevision(res.session).plan.scheduled, currentRevision(session).plan.scheduled);
  assert.equal(res.session.nowMin, 40);
  assert.equal(res.session.conversation.length, session.conversation.length);
  // The restored session keeps working: undo goes to r1.
  assert.equal(say(res.session, 'Undo').session.revisions.length, 2);
});

test('corrupt, unversioned and invalid data is cleared safely', () => {
  const corrupt = memoryStorage({ [STORAGE_KEY]: '{not json' });
  assert.equal(loadState(corrupt).reason, 'corrupt');
  assert.equal(corrupt.getItem(STORAGE_KEY), null);

  const noVersion = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ session: {} }) });
  assert.equal(loadState(noVersion).reason, 'corrupt');

  const invalid = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: STORAGE_VERSION, session: { version: 1, revisions: [] } }) });
  assert.equal(loadState(invalid).reason, 'invalid');
  assert.equal(loadState(memoryStorage()).reason, 'empty');
});

test('older storage versions are migrated; newer ones are left untouched', () => {
  const session = newSession('weekend-outing');
  const v1 = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, savedAt: 0, session }) });
  const res = loadState(v1);
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  assert.deepEqual(res.ui, { view: 'plan', selectedTaskId: null });
  assert.equal(JSON.parse(v1.getItem(STORAGE_KEY)).version, STORAGE_VERSION, 'migrated envelope written back');

  const future = JSON.stringify({ version: STORAGE_VERSION + 1, session });
  const newer = memoryStorage({ [STORAGE_KEY]: future });
  assert.equal(loadState(newer).reason, 'newer');
  assert.equal(newer.getItem(STORAGE_KEY), future);
});

test('storage failures are reported, not thrown', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(loadState(broken).reason, 'unavailable');
  assert.equal(saveState(broken, { session: {}, ui: {} }).ok, false);
});
