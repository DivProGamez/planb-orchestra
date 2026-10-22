// Spatial navigation, input mapping, gamepad repeat/debounce and the sound manager (pure logic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidate, nearestRect, keyToAction, gamepadStep, GAMEPAD } from '../src/nav.js';
import { createSoundManager, CUES } from '../src/sound.js';

const box = (left, top, w = 100, h = 40) => ({ left, top, right: left + w, bottom: top + h });

test('pickCandidate prefers the aligned neighbour in the requested direction', () => {
  const from = box(100, 100);
  const rects = [box(260, 100), box(220, 260), box(100, 260), box(-80, 100), box(100, -60)];
  assert.equal(pickCandidate(from, rects, 'right'), 0);
  assert.equal(pickCandidate(from, rects, 'down'), 2, 'directly below beats diagonal-but-closer');
  assert.equal(pickCandidate(from, rects, 'left'), 3);
  assert.equal(pickCandidate(from, rects, 'up'), 4);
});

test('pickCandidate returns -1 at the edge (focus stays put)', () => {
  assert.equal(pickCandidate(box(500, 100), [box(100, 100), box(300, 100)], 'right'), -1);
  assert.equal(pickCandidate(box(100, 100), [], 'down'), -1);
});

test('pickCandidate moves between timeline lanes to the overlapping task', () => {
  const bar = box(400, 100, 60, 30);
  const lane2 = [box(100, 160, 60, 30), box(420, 160, 80, 30), box(700, 160, 60, 30)];
  assert.equal(pickCandidate(bar, lane2, 'down'), 1);
});

test('nearestRect finds the closest replacement for a removed control', () => {
  assert.equal(nearestRect({ x: 410, y: 120 }, [box(0, 0), box(380, 110), box(800, 500)]), 1);
  assert.equal(nearestRect({ x: 0, y: 0 }, []), -1);
});

test('keyToAction maps keyboard and TV-remote keys', () => {
  assert.equal(keyToAction({ key: 'ArrowLeft' }), 'left');
  assert.equal(keyToAction({ key: 'Enter' }), 'select');
  assert.equal(keyToAction({ key: ' ' }), 'select');
  assert.equal(keyToAction({ key: 'Escape' }), 'back');
  assert.equal(keyToAction({ key: 'GoBack' }), 'back');
  assert.equal(keyToAction({ key: 'Unidentified', keyCode: 10009 }), 'back', 'Tizen remote Back');
  assert.equal(keyToAction({ key: 'Unidentified', keyCode: 461 }), 'back', 'webOS remote Back');
  assert.equal(keyToAction({ key: 'a' }), null);
});

const pad = (pressed = [], axes = [0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });

test('gamepad D-pad: one move per press, repeat only after the hold delay', () => {
  let s = {};
  let r = gamepadStep(s, pad([15]), 0); s = r.state;
  assert.deepEqual(r.actions, ['right']);
  r = gamepadStep(s, pad([15]), 100); s = r.state;
  assert.deepEqual(r.actions, [], 'no repeat before the delay');
  r = gamepadStep(s, pad([15]), GAMEPAD.repeatDelay + 1); s = r.state;
  assert.deepEqual(r.actions, ['right'], 'first repeat');
  r = gamepadStep(s, pad([15]), GAMEPAD.repeatDelay + 50); s = r.state;
  assert.deepEqual(r.actions, [], 'repeat interval respected');
  r = gamepadStep(s, pad([15]), GAMEPAD.repeatDelay + GAMEPAD.repeatInterval + 2); s = r.state;
  assert.deepEqual(r.actions, ['right']);
  r = gamepadStep(s, pad([]), 2000); s = r.state;
  r = gamepadStep(s, pad([15]), 2010);
  assert.deepEqual(r.actions, ['right'], 'release then press moves again immediately');
});

test('gamepad stick: deadzone ignores drift, a full push navigates', () => {
  assert.deepEqual(gamepadStep({}, pad([], [0.3, -0.2]), 0).actions, []);
  assert.deepEqual(gamepadStep({}, pad([], [0, 0.9]), 0).actions, ['down']);
  assert.deepEqual(gamepadStep({}, pad([], [-0.8, 0]), 0).actions, ['left']);
});

test('gamepad A/B fire once per press, never while held', () => {
  let s = {};
  let r = gamepadStep(s, pad([0]), 0); s = r.state;
  assert.deepEqual(r.actions, ['select']);
  for (let t = 16; t < 1000; t += 16) { r = gamepadStep(s, pad([0]), t); s = r.state; assert.deepEqual(r.actions, []); }
  r = gamepadStep(s, pad([]), 1000); s = r.state;
  r = gamepadStep(s, pad([1]), 1016);
  assert.deepEqual(r.actions, ['back']);
});

/* ---------- sound manager with a fake AudioContext ---------- */

function fakeContext(log) {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v) { this.value = v; } });
  return {
    state: 'running', currentTime: 0, destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({ gain: param(), connect() {} }),
    createBiquadFilter: () => ({ type: '', frequency: param(), connect() {} }),
    createOscillator: () => {
      const osc = { type: '', frequency: param(), connect() {}, start() { log.push('start'); }, stop() {}, onended: null };
      return osc;
    },
  };
}

test('sound: silent until a user gesture unlocks audio', () => {
  const log = [];
  let created = 0;
  const sm = createSoundManager({ createContext: () => { created += 1; return fakeContext(log); } });
  assert.equal(sm.play('select'), false);
  assert.equal(created, 0, 'no AudioContext before a gesture');
  sm.unlock();
  assert.equal(sm.play('select'), true);
  assert.equal(log.length, CUES.select.length);
  sm.unlock();
  assert.equal(created, 1, 'context reused, not recreated');
});

test('sound: mute and zero volume are fully silent', () => {
  const log = [];
  const sm = createSoundManager({ createContext: () => fakeContext(log), enabled: false });
  sm.unlock();
  assert.equal(sm.play('focus'), false);
  sm.setEnabled(true);
  sm.setVolume(0);
  assert.equal(sm.play('focus'), false);
  assert.equal(log.length, 0);
  sm.setVolume(0.6);
  assert.equal(sm.volume, 0.6);
  assert.equal(sm.play('focus'), true);
});

test('sound: held-direction focus ticks are throttled and voices are capped', () => {
  const log = [];
  let t = 0;
  const sm = createSoundManager({ createContext: () => fakeContext(log), now: () => t });
  sm.unlock();
  let played = 0;
  for (let i = 0; i < 20; i += 1) { t = i * 10; if (sm.play('focus')) played += 1; }
  assert.ok(played <= 5, `20 ticks in 200 ms → ${played} sounds`);
  for (let i = 0; i < 20; i += 1) sm.play('success'); // no onended in the fake → voices accumulate
  assert.ok(sm.voices <= 6 + CUES.success.length, 'voice cap stops piling up');
});

test('sound: a missing Web Audio API degrades to silence', () => {
  const sm = createSoundManager({ createContext: () => { throw new Error('no audio'); } });
  sm.unlock();
  assert.equal(sm.play('select'), false);
  assert.equal(sm.active, false);
});
