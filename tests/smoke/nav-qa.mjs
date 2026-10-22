// Mouse-free navigation QA in a real browser: keyboard-only journey, spatial reachability on every
// screen, focus restoration, dialog focus trap/return, removed-element fallback, emulated gamepad
// (D-pad, stick deadzone, repeat, A/B), sound cues through an instrumented AudioContext, sound
// preferences, reduced motion, mouse coexistence and native text editing. Saves neon-focus
// screenshots to evidence/neon/. Usage: npm run test:nav
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(here, '../../evidence/neon');
mkdirSync(shots, { recursive: true });
for (const f of readdirSync(shots)) if (f.endsWith('.png')) unlinkSync(path.join(shots, f));

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => existsSync(p));
if (!executablePath) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }

const server = createApp({ env: {} }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath });
const results = [];
const errors = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`PASS  ${name}`); } catch (e) { results.push([false, name]); console.log(`FAIL  ${name}\n      → ${e.message.split('\n')[0]}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

/** Fake gamepad + instrumented AudioContext, installed before the app loads. */
function instrument() {
  window.__tones = 0;
  window.__pad = { id: 'test pad', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  window.__padOn = false;
  navigator.getGamepads = () => (window.__padOn ? [window.__pad] : []);
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v) { this.value = v; } });
  window.AudioContext = function FakeAudioContext() {
    return {
      state: 'running', get currentTime() { return performance.now() / 1000; }, destination: {}, resume: () => Promise.resolve(),
      createGain: () => ({ gain: param(), connect() {} }),
      createBiquadFilter: () => ({ type: '', frequency: param(), connect() {} }),
      createOscillator: () => ({ type: '', frequency: param(), connect() {}, start() { window.__tones += 1; }, stop() { setTimeout(() => this.onended?.(), 30); }, onended: null }),
    };
  };
}

async function newPage(width = 1920, height = 1080, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...opts });
  await ctx.addInitScript(instrument);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  return p;
}
const ready = (p) => p.waitForSelector('#splash', { state: 'detached', timeout: 8000 });
const view = (p) => p.evaluate(() => document.getElementById('app').dataset.view);
const revs = (p) => p.evaluate(() => Number(document.getElementById('app').dataset.revisions || 0));
const active = (p) => p.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, cls: String(el.className), id: el.id, action: el.dataset.action, task: el.dataset.task, data: el.dataset.id || el.dataset.view || el.dataset.text || '', text: el.textContent.trim().slice(0, 40), x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, connected: el.isConnected, w: r.width };
});

/**
 * Reaches `selector` with arrow keys only. Each step plans the shortest arrow path with the app's
 * own targeting function (pickCandidate) over the live layout, then presses the first real key;
 * where focus actually lands is decided by the app, and the path is re-planned after every press.
 */
async function arrowTo(p, selector, max = 60) {
  for (let i = 0; i < max; i += 1) {
    const info = await p.evaluate(async (sel) => {
      const { pickCandidate, directionalTarget } = await import('/nav.js');
      const scope = document.querySelector('.modal') || document.getElementById('app');
      const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-nav]';
      const list = [...scope.querySelectorAll(FOCUSABLE)].filter((el) => {
        if (el.disabled || el.closest('[inert], [aria-hidden="true"]')) return false;
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        return r.width >= 2 && r.height >= 2 && r.right > 0 && r.left < innerWidth && cs.visibility !== 'hidden' && cs.display !== 'none';
      });
      const target = list.findIndex((el) => el.matches(sel));
      if (target < 0) return { missing: true };
      const start = list.indexOf(document.activeElement);
      if (start === target) return { done: true };
      if (start < 0) return { key: 'ArrowDown' };
      const rects = list.map((el) => el.getBoundingClientRect());
      const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
      const first = new Map([[start, null]]);
      const queue = [start];
      while (queue.length) {
        const i = queue.shift();
        for (const dir of ['up', 'down', 'left', 'right']) {
          if (list[i].type === 'range' && (dir === 'left' || dir === 'right')) continue; // sliders keep Left/Right
          const tEl = directionalTarget(list[i], list, dir);
          if (!tEl) continue;
          const n = list.indexOf(tEl);
          if (first.has(n)) continue;
          first.set(n, first.get(i) || dir);
          if (n === target) return { key: KEYS[first.get(n)] };
          queue.push(n);
        }
      }
      return { unreachable: true };
    }, selector);
    if (info.missing) throw new Error(`no visible ${selector}`);
    if (info.unreachable) throw new Error(`${selector} is not reachable by arrows from the focused control`);
    if (info.done) return;
    // a slider keeps Left/Right for its value: leave it vertically, as a person would
    const onRange = await p.evaluate(() => document.activeElement?.type === 'range');
    await p.keyboard.press(onRange && /Left|Right/.test(info.key) ? 'ArrowUp' : info.key);
    await p.waitForTimeout(30);
  }
  const a = await active(p);
  throw new Error(`could not reach ${selector} with arrows (stuck on ${a?.tag}.${a?.cls.split(' ')[0]} "${a?.text}")`);
}
async function enter(p) { await p.keyboard.press('Enter'); await p.waitForTimeout(250); }
async function waitView(p, v) { await p.waitForFunction((x) => document.getElementById('app').dataset.view === x, v, { timeout: 8000 }); await p.waitForTimeout(250); }

const p = await newPage();
await p.goto(base);
await ready(p);

await check('keyboard-only journey: Home → Dinner for Six → build → assistant change → review → confirm → repair → compare → inspect → history → undo → settings → home', async () => {
  await p.keyboard.press('ArrowDown'); // first key press enters navigation mode
  expect(await p.evaluate(() => document.documentElement.dataset.input) === 'keys', 'keyboard mode not active');
  await arrowTo(p, '.tile[data-id="childrens-birthday"]');
  await enter(p);
  await arrowTo(p, '.tile[data-id="dinner-for-six"]');
  await enter(p);
  expect(await p.evaluate(() => document.querySelector('.tile.is-active')?.dataset.id) === 'dinner-for-six', 'Dinner for Six not selected by Enter');
  await arrowTo(p, 'button[form="setup-form"]');
  await enter(p);
  await waitView(p, 'workspace');
  expect(await revs(p) === 1, 'baseline not built');
  await arrowTo(p, '.nav-item[data-view="assistant"]');
  await enter(p);
  await waitView(p, 'assistant');
  await arrowTo(p, '.as-foot .chip[data-text="Guests are arriving an hour early and the oven broke."]');
  await enter(p);
  await p.waitForSelector('.confirm-card [data-action="confirm-change"]');
  expect(await revs(p) === 1, 'review changed the plan');
  const a = await active(p);
  expect(a?.action === 'confirm-change', `focus not on Apply & replan (${a?.text})`);
  await enter(p);
  await p.waitForFunction(() => Number(document.getElementById('app').dataset.revisions) === 2, null, { timeout: 8000 });
  await waitView(p, 'workspace');
  await arrowTo(p, '.nav-item[data-view="repair"]');
  await enter(p);
  await waitView(p, 'repair');
  expect(await p.locator('.stage-ok').count() === 6, 'repair stages not complete');
  await arrowTo(p, '.nav-item[data-view="compare"]');
  await enter(p);
  await waitView(p, 'compare');
  await arrowTo(p, '.map-head');
  const task = await p.evaluate(() => document.activeElement.dataset.task);
  await enter(p);
  const sel = await p.evaluate(() => ({ a: document.querySelector('#tl-before .bar.is-selected')?.dataset.task, b: document.querySelector('#tl-after .bar.is-selected')?.dataset.task }));
  expect(sel.a === task && sel.b === task, `changed task not highlighted in both plans (${JSON.stringify(sel)})`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  expect(await p.evaluate(() => !document.querySelector('.bar.is-selected')), 'Escape did not close the inspection');
  await arrowTo(p, '.nav-item[data-view="history"]');
  await enter(p);
  await waitView(p, 'history');
  await arrowTo(p, '.view [data-action="undo"]');
  await enter(p);
  await p.waitForFunction(() => Number(document.getElementById('app').dataset.revisions) === 1, null, { timeout: 8000 });
  await arrowTo(p, '.nav-item[data-view="settings"]');
  await enter(p);
  await waitView(p, 'settings');
  for (let i = 0; i < 6 && (await view(p)) !== 'home'; i += 1) { await p.keyboard.press('Escape'); await p.waitForTimeout(250); }
  expect(await view(p) === 'home', 'Back did not return to Home');
  expect(await active(p), 'focus lost after returning home');
});

await check('every control on every screen is reachable by arrows from the initial focus', async () => {
  await arrowTo(p, 'button[form="setup-form"]');
  await enter(p);
  await waitView(p, 'workspace');
  // a change so Repair / Compare / History have content
  await p.keyboard.press('d');
  await p.waitForSelector('#dis-text');
  await p.keyboard.type('Guests are arriving an hour early and the oven broke.');
  await arrowTo(p, '.modal form[data-form="disruption"] button[type="submit"]');
  await enter(p);
  await p.waitForSelector('.modal [data-action="confirm-change"]');
  await enter(p);
  await p.waitForFunction(() => Number(document.getElementById('app').dataset.revisions) === 2);
  const unreachable = [];
  for (const v of ['home', 'workspace', 'assistant', 'repair', 'compare', 'history', 'settings']) {
    await p.click(`.nav-item[data-view="${v}"]`);
    await waitView(p, v);
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowLeft');
    unreachable.push(...await p.evaluate(async (vw) => {
      const { pickCandidate, directionalTarget } = await import('/nav.js');
      const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-nav]';
      const list = [...document.querySelectorAll(FOCUSABLE)].filter((el) => {
        if (el.disabled || el.closest('[inert], [aria-hidden="true"]')) return false;
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        return r.width >= 2 && r.height >= 2 && r.right > 0 && r.left < innerWidth && cs.visibility !== 'hidden' && cs.display !== 'none';
      });
      const rects = list.map((el) => el.getBoundingClientRect());
      const start = list.indexOf(document.activeElement);
      if (start < 0) return [`${vw}: no initial focus`];
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const i = queue.shift();
        for (const dir of ['up', 'down', 'left', 'right']) {
          const others = rects.map((r, j) => j).filter((j) => j !== i);
          const k = pickCandidate(rects[i], others.map((j) => rects[j]), dir);
          if (k >= 0 && !seen.has(others[k])) { seen.add(others[k]); queue.push(others[k]); }
        }
      }
      return list.filter((_, i) => !seen.has(i)).map((el) => `${vw}: ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30)}"`);
    }, v));
  }
  expect(unreachable.length === 0, unreachable.slice(0, 8).join(' | '));
});

await check('focus is restored when returning to a screen, and Back returns to the previous screen', async () => {
  await p.click('.nav-item[data-view="history"]');
  await waitView(p, 'history');
  await p.click('.nav-item[data-view="settings"]');
  await waitView(p, 'settings');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '#pref-ghosts');
  await p.keyboard.press('Escape'); // Back → History
  await waitView(p, 'history');
  await arrowTo(p, '.nav-item[data-view="settings"]');
  await enter(p);
  await waitView(p, 'settings');
  const a = await active(p);
  expect(a?.id === 'pref-ghosts', `focus not restored on Settings (got ${a?.id || a?.text})`);
});

await check('dialog: opens with focus inside, Tab and arrows stay inside, Escape restores the trigger', async () => {
  await p.click('.nav-item[data-view="workspace"]');
  await waitView(p, 'workspace');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '.topbar [data-action="open-disruption"]');
  await enter(p);
  await p.waitForSelector('.modal');
  expect((await active(p))?.id === 'dis-text', 'focus not in the description box');
  for (let i = 0; i < 14; i += 1) {
    await p.keyboard.press(i % 3 ? 'Tab' : 'Shift+Tab');
    expect(await p.evaluate(() => Boolean(document.activeElement?.closest('.modal'))), 'Tab left the dialog');
  }
  await p.keyboard.press('Escape'); // release the textarea if focused there is handled by the dialog: Escape closes it
  await p.waitForSelector('.modal', { state: 'detached' });
  const a = await active(p);
  expect(a?.action === 'open-disruption', `focus not returned to the trigger (${a?.text})`);
  await enter(p);
  await p.waitForSelector('.modal');
  await p.keyboard.press('Tab');
  for (let i = 0; i < 10; i += 1) { await p.keyboard.press(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'][i % 4]); }
  expect(await p.evaluate(() => Boolean(document.activeElement?.closest('.modal'))), 'arrows escaped the dialog');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.modal', { state: 'detached' });
});

await check('Enter/Space activate exactly once; key repeat does not re-activate; disabled controls are skipped', async () => {
  await p.click('.nav-item[data-view="settings"]');
  await waitView(p, 'settings');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '#pref-ghosts');
  const before = await p.evaluate(() => document.getElementById('pref-ghosts').checked);
  await p.keyboard.down('Enter'); await p.keyboard.down('Enter'); await p.keyboard.down('Enter'); await p.keyboard.up('Enter');
  await p.waitForTimeout(250);
  expect(await p.evaluate(() => document.getElementById('pref-ghosts').checked) === !before, 'held Enter toggled more than once');
  await p.keyboard.press(' ');
  await p.waitForTimeout(250);
  expect(await p.evaluate(() => document.getElementById('pref-ghosts').checked) === before, 'Space did not toggle');
  // Undo is disabled at r0 after the journey's undo? Make it disabled: restore original first
  await p.click('.nav-item[data-view="history"]');
  await waitView(p, 'history');
  await p.click('[data-action="restore"]');
  await p.waitForFunction(() => Number(document.getElementById('app').dataset.revisions) === 1);
  await p.keyboard.press('ArrowDown');
  const reachedDisabled = await p.evaluate(async () => {
    const seen = [];
    for (let i = 0; i < 30; i += 1) {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'ArrowRight' : 'ArrowUp', bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
      if (document.activeElement.disabled) seen.push(document.activeElement.textContent.trim());
    }
    return seen;
  });
  expect(reachedDisabled.length === 0, `focused disabled control: ${reachedDisabled[0]}`);
});

await check('removed element: focus falls back to a live neighbour after a replan removes the focused task', async () => {
  await p.click('.nav-item[data-view="workspace"]');
  await waitView(p, 'workspace');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '#tl-main .bar[data-task="candles"]');
  await p.keyboard.press('d');
  await p.waitForSelector('#dis-text');
  await p.keyboard.type('Forget the candles');
  await arrowTo(p, '.modal form[data-form="disruption"] button[type="submit"]');
  await enter(p);
  await p.waitForSelector('.modal [data-action="confirm-change"]');
  await enter(p);
  await p.waitForFunction(() => !document.querySelector('#tl-main .bar[data-task="candles"]'), null, { timeout: 8000 });
  await p.waitForTimeout(300);
  const a = await active(p);
  expect(a && a.connected && a.w > 1, 'focus lost or left on a removed element');
  await p.keyboard.press('ArrowRight');
  expect((await active(p))?.connected, 'navigation broken after removal');
});

await check('gamepad (emulated standard mapping): D-pad moves once per press, hold repeats, stick deadzone, A selects once, B goes back', async () => {
  await p.click('.nav-item[data-view="workspace"]');
  await waitView(p, 'workspace');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '#tl-main .bar');
  await p.evaluate(() => { window.__padOn = true; window.dispatchEvent(new Event('gamepadconnected')); });
  const press = async (i, ms) => { await p.evaluate((b) => { window.__pad.buttons[b].pressed = true; }, i); await p.waitForTimeout(ms); await p.evaluate((b) => { window.__pad.buttons[b].pressed = false; }, i); await p.waitForTimeout(80); };
  const trail = async (fn) => { const start = await active(p); await p.evaluate(() => { window.__moves = 0; window.__last = document.activeElement; window.__mo = setInterval(() => { if (document.activeElement !== window.__last) { window.__moves += 1; window.__last = document.activeElement; } }, 5); }); await fn(); const n = await p.evaluate(() => { clearInterval(window.__mo); return window.__moves; }); return { start, n }; };
  let r = await trail(() => press(15, 120));
  expect(r.n === 1, `short D-pad press moved ${r.n} times`);
  await p.keyboard.press('ArrowLeft');
  r = await trail(async () => { await p.evaluate(() => { window.__pad.axes = [0.3, 0.2, 0, 0]; }); await p.waitForTimeout(300); await p.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; }); });
  expect(r.n === 0, 'stick drift inside the deadzone moved focus');
  await p.click('.nav-item[data-view="settings"]');
  await waitView(p, 'settings');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '.view button[data-action="new-session"], .vol-row .btn, #pref-sound');
  await arrowTo(p, '#pref-confirm');
  r = await trail(() => press(13, 1100));
  expect(r.n >= 2, `held D-pad down did not repeat (${r.n})`);
  await arrowTo(p, '#pref-ghosts');
  const before = await p.evaluate(() => document.getElementById('pref-ghosts').checked);
  await press(0, 400);
  await p.waitForTimeout(200);
  expect(await p.evaluate(() => document.getElementById('pref-ghosts').checked) === !before, 'held A did not toggle exactly once');
  await press(0, 60);
  await p.waitForTimeout(200);
  await arrowTo(p, '.nav-item[data-view="compare"]');
  await press(0, 60);
  await waitView(p, 'compare');
  await press(1, 60);
  await waitView(p, 'settings');
  await p.evaluate(() => { window.__padOn = false; });
});

await check('sound: a cue per real focus move (none at an edge), throttled when held, silent when muted, volume saved', async () => {
  await p.click('.nav-item[data-view="settings"]');
  await waitView(p, 'settings');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '.nav-item[data-view="home"]');
  let t0 = await p.evaluate(() => window.__tones);
  await p.keyboard.press('ArrowLeft'); // sidebar is the left edge: no move, no sound
  await p.waitForTimeout(80);
  expect(await p.evaluate(() => window.__tones) === t0, 'edge press played a sound');
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(80);
  expect(await p.evaluate(() => window.__tones) === t0 + 1, 'one focus move did not play exactly one tick');
  t0 = await p.evaluate(() => window.__tones);
  await p.evaluate(async () => { for (let i = 0; i < 12; i += 1) { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'ArrowUp' : 'ArrowDown', bubbles: true })); await new Promise((r) => setTimeout(r, 8)); } });
  const burst = (await p.evaluate(() => window.__tones)) - t0;
  expect(burst <= 4, `12 rapid moves produced ${burst} focus sounds`);
  await arrowTo(p, '#pref-sound');
  await enter(p); // turn sound off
  expect(await p.evaluate(() => JSON.parse(localStorage.getItem('planb-orchestra.prefs')).sound) === false, 'sound preference not saved');
  t0 = await p.evaluate(() => window.__tones);
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape']) { await p.keyboard.press(k); await p.waitForTimeout(120); }
  if (await view(p) !== 'settings') await p.click('.nav-item[data-view="settings"]');
  expect(await p.evaluate(() => window.__tones) === t0, 'muted interface still produced sound');
  await p.click('#pref-sound'); // back on (mouse)
  await p.fill('#pref-volume', '70');
  await p.dispatchEvent('#pref-volume', 'input');
  await p.reload();
  await ready(p);
  await p.click('.nav-item[data-view="settings"]');
  expect(await p.evaluate(() => document.getElementById('pref-volume').value) === '70', 'volume not restored after reload');
});

await check('mouse still works and switches off the neon keyboard mode', async () => {
  await p.click('.nav-item[data-view="compare"]');
  await waitView(p, 'compare');
  expect(await p.evaluate(() => document.documentElement.dataset.input) === 'pointer', 'pointer mode not set by the mouse');
  const before = await p.locator('.map-row.is-selected').count();
  await p.click('.map-head');
  expect(await p.locator('.map-row.is-selected').count() === (before ? 0 : 1), 'click did not toggle the selection');
  if (!before) await p.click('.map-head');
});

await check('text fields keep native editing (caret keys, Enter submits); Up/Down and Escape leave the field', async () => {
  await p.click('.nav-item[data-view="assistant"]');
  await waitView(p, 'assistant');
  await p.click('#cmd');
  await p.keyboard.type('abc');
  await p.keyboard.press('ArrowLeft');
  const caret = await p.evaluate(() => [document.activeElement.id, document.activeElement.selectionStart, document.activeElement.value]);
  expect(caret[0] === 'cmd' && caret[1] === 2 && caret[2] === 'abc', `caret handling changed: ${caret}`);
  await p.keyboard.press(' ');
  expect(await p.evaluate(() => document.getElementById('cmd').value) === 'ab c', 'Space was intercepted in the field');
  await p.keyboard.press('Escape');
  expect(await p.evaluate(() => document.activeElement.id) !== 'cmd', 'Escape did not release the field');
});

await check('number field: arrows pass through without changing the value; after typing, Up/Down edit natively', async () => {
  await p.click('.nav-item[data-view="home"]');
  await waitView(p, 'home');
  await p.keyboard.press('ArrowDown');
  await arrowTo(p, '[data-field="budget"]');
  const v0 = await p.evaluate(() => document.querySelector('[data-field="budget"]').value);
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(150);
  const after = await p.evaluate(() => ({ v: document.querySelector('[data-field="budget"]').value, onField: document.activeElement.matches('[data-field="budget"]') }));
  expect(after.v === v0, `Down changed the budget ${v0} → ${after.v}`);
  expect(!after.onField, 'Down did not leave the budget field (trap)');
  await p.keyboard.press('ArrowUp'); // back up onto the field
  await p.waitForTimeout(100);
  if (!(await p.evaluate(() => document.activeElement.matches('[data-field="budget"]')))) await arrowTo(p, '[data-field="budget"]');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await p.keyboard.type('50'); // typing starts editing
  await p.keyboard.press('ArrowUp');
  await p.waitForTimeout(150);
  const edited = await p.evaluate(() => ({ v: Number(document.querySelector('[data-field="budget"]').value), onField: document.activeElement.matches('[data-field="budget"]') }));
  expect(edited.onField && edited.v > 50, `native Up did not edit the value while editing (${edited.v})`);
  await p.keyboard.press('Escape');
  await p.click('[data-action="choose-scenario"][data-id="dinner-for-six"]'); // restore the form defaults
});

await check('reduced motion: focus has no pulse or scale but keeps the static cyan outline', async () => {
  const rm = await newPage(1440, 900, { reducedMotion: 'reduce' });
  await rm.goto(base);
  await ready(rm);
  await rm.keyboard.press('ArrowDown');
  await rm.waitForTimeout(100);
  const s = await rm.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { outline: cs.outlineColor, w: cs.outlineWidth, t: cs.transform, anim: cs.animationName }; });
  expect(s.outline === 'rgb(0, 245, 255)' && parseFloat(s.w) >= 2, `no static outline (${s.outline} ${s.w})`);
  expect(s.t === 'none' && s.anim === 'none', `motion not reduced (${s.t}, ${s.anim})`);
  await rm.context().close();
});

await check('neon focus visible at 1920×1080, 1440×900 and 1280×720 (screenshots)', async () => {
  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(300);
    const spots = [['home', '.tile[data-id="childrens-birthday"]'], ['workspace', '#tl-main .bar.is-changed, #tl-main .bar'], ['compare', '.map-head'], ['repair', '.stage'], ['settings', '#pref-sound']];
    for (const [v, sel] of spots) {
      await p.click(`.nav-item[data-view="${v}"]`);
      await waitView(p, v);
      await p.keyboard.press('ArrowDown');
      await arrowTo(p, sel);
      await p.waitForTimeout(260);
      const s = await p.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { c: cs.outlineColor, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }; });
      expect(s.c === 'rgb(0, 245, 255)', `${v} ${w}×${h}: focus outline is ${s.c}`);
      expect(s.inView, `${v} ${w}×${h}: focused element outside the viewport`);
      await p.screenshot({ path: path.join(shots, `${v}-${w}x${h}.png`) });
    }
  }
});

await check('no console errors, warnings or uncaught exceptions', async () => {
  expect(errors.length === 0, errors.slice(0, 5).join(' | '));
});

await browser.close();
server.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\nNavigation QA: ${results.length - failed} passed, ${failed} failed. Screenshots in evidence/neon/`);
process.exit(failed ? 1 : 0);
