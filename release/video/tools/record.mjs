// Records the real PlanB Orchestra app following A2_VIDEO_STORYBOARD.md, at real speed.
// Frames come from Chrome's screencast of the live page (1920×1080 viewport, 1.5× pixel density);
// the only addition is a visual cursor that mirrors the real mouse events Playwright sends
// (headless Chrome draws no pointer). Every click, keystroke and result is the real application.
// Output: <out>/frames/*.jpg + frames.json (timestamps) + events.json (beat starts, UI-sound moments).
// Usage: node release/video/tools/record.mjs <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../../../server/app.js';

const out = path.resolve(process.argv[2] || 'release/video/work');
rmSync(path.join(out, 'frames'), { recursive: true, force: true });
mkdirSync(path.join(out, 'frames'), { recursive: true });

const DSF = 1.5;
const server = createApp({ env: {} }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DSF });

// Visual cursor (harness only): an arrow that follows real mouse events, with a soft click ring.
await ctx.addInitScript(() => {
  const install = () => {
    if (document.getElementById('__rec_cursor')) return;
    const c = document.createElement('div');
    c.id = '__rec_cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.6 L11.7 15.1 L18.6 15.1 Z" fill="#fff" stroke="#0b0e18" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))';
    const ring = document.createElement('div');
    ring.id = '__rec_ring';
    ring.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(255,255,255,.85);z-index:2147483646;pointer-events:none;opacity:0;transform:scale(.4)';
    document.documentElement.append(ring, c);
    const pos = window.__recPos || { x: 960, y: 540 };
    c.style.left = `${pos.x}px`; c.style.top = `${pos.y}px`;
    document.addEventListener('mousemove', (e) => { window.__recPos = { x: e.clientX, y: e.clientY }; c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    document.addEventListener('mousedown', (e) => {
      ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`;
      ring.animate([{ opacity: 0.9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.35)' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
});

const p = await ctx.newPage();
await p.goto(base);
await p.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(400);

// ---------- screencast capture ----------
const frames = [];
let lastSaved = -1;
let cdp;
let t0 = null;
async function startCast() {
  cdp = await ctx.newCDPSession(p);
  cdp.on('Page.screencastFrame', async (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const ts = f.metadata.timestamp;
    if (t0 === null) t0 = ts;
    if (ts - lastSaved < 1 / 31) return; // ≤ ~31 fps stored; the edit renders 30 fps
    lastSaved = ts;
    const name = `f${String(frames.length).padStart(6, '0')}.jpg`;
    frames.push({ name, t: ts - t0, ts });
    writeFileSync(path.join(out, 'frames', name), Buffer.from(f.data, 'base64'));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920 * DSF, maxHeight: 1080 * DSF, everyNthFrame: 1 });
}
await startCast();
const wall0 = Date.now();
const now = () => (Date.now() - wall0) / 1000;
const events = [];
const mark = (type, extra = {}) => { events.push({ type, t: +now().toFixed(3), epoch: Date.now() / 1000, ...extra }); };

// ---------- direction helpers ----------
let cur = { x: 760, y: 560 };
await p.mouse.move(cur.x, cur.y);
const at = async (sec) => { const w = sec - now(); if (w > 0) await p.waitForTimeout(w * 1000); };
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
async function glide(x, y, ms = 900) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...cur };
  const start = Date.now();
  for (let i = 1; i <= steps; i += 1) {
    const k = ease(i / steps);
    await p.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
    const due = start + (ms * i) / steps;
    const w = due - Date.now();
    if (w > 0) await p.waitForTimeout(w);
  }
  cur = { x, y };
}
async function box(sel, nth = 0) {
  const loc = p.locator(sel).nth(nth);
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  await loc.scrollIntoViewIfNeeded();
  return loc.boundingBox();
}
async function to(sel, { ms = 900, dx = 0.5, dy = 0.5, nth = 0 } = {}) {
  const b = await box(sel, nth);
  await glide(Math.round(b.x + b.width * dx), Math.round(b.y + b.height * dy), ms);
}
async function click(sel, opts = {}) {
  await to(sel, opts);
  await p.waitForTimeout(140);
  await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up();
}

// ================= BEAT 1 · 0:00–0:15 · Scenarios & Home (hover only) =================
mark('beat', { n: 1 });
await at(0.8); await to('.tile[data-id="dinner-for-six"]', { ms: 1600, dy: 0.4 });
await at(4.2); await to('.constraints-card [data-out="deadline"]', { ms: 1400 });
await at(6.2); await to('[data-field="budget"]', { ms: 1100, dx: 0.3 });
await at(8.0); await to('.constraints-card .switch-row', { ms: 1100, dx: 0.25 });
await glide(cur.x, cur.y + 70, 1300);
await at(10.8); await to('.constraints-card .switch-row', { ms: 1100, dx: 0.25, nth: 3 });
await glide(cur.x, cur.y + 70, 1100);
await at(13.0); await to('.hero-stats .hs', { ms: 1300, nth: 2 });

// ================= BEAT 2 · 0:15–0:45 · Plan Workspace =================
await at(15.0); mark('beat', { n: 2 });
await click('button[form="setup-form"]', { ms: 1100 });
mark('sound', { cue: 'success' }); // build plays the success cue in the app
await p.waitForSelector('.workspace');
await at(19.5); await click('#tl-main .bar[data-task="roast"]', { ms: 1500, dx: 0.35 });
await at(22.5); await to('.rpanel .ins-grid', { ms: 1200, dx: 0.3 });
await at(24.5); await to('.rpanel .ins-block', { ms: 1100, dx: 0.2, nth: 0 });
await at(26.0); await to('.rpanel .ins-block', { ms: 1000, dx: 0.2, nth: 1 });
await at(27.5); await to('.rpanel .ins-block', { ms: 1000, dx: 0.2, nth: 3 });
// slow pan across the people lanes, then the equipment lanes
await at(29.5); await to('#tl-main .lane-label', { ms: 1200, dx: 0.6, nth: 0 });
await glide(cur.x + 520, cur.y, 1800);
await to('#tl-main .lane-label', { ms: 1000, dx: 0.6, nth: 1 });
await to('#tl-main .lane-label', { ms: 900, dx: 0.6, nth: 2 });
await to('#tl-main .lane-label', { ms: 900, dx: 0.6, nth: 3 });
await at(36.0); await to('#tl-main .res-label', { ms: 1000, dx: 0.5, nth: 0 });
await glide(cur.x + 600, cur.y, 1600);
await to('#tl-main .res-label', { ms: 900, dx: 0.5, nth: 2 });
await at(40.0); await click('#tl-main .bar[data-task="roast"]', { ms: 1100, dx: 0.35 }); // close the inspection (toggle)
await at(41.6); await to('.kpis .kpi', { ms: 1000, nth: 0 });
await to('.kpis .kpi', { ms: 900, nth: 1 });
await to('.kpis .kpi', { ms: 900, nth: 2, dy: 0.45 });

// ================= BEAT 3 · 0:45–1:25 · Simulate disruption: Describe → Review → Replan =================
await at(45.0); mark('beat', { n: 3 });
await click('.topbar [data-action="open-disruption"]', { ms: 1000 });
mark('sound', { cue: 'open' });
await p.waitForSelector('#dis-text');
await at(47.4); await to('#dis-text', { ms: 600, dx: 0.3, dy: 0.4 });
await p.locator('#dis-text').focus();
mark('typing-start');
await p.keyboard.type('Guests are arriving an hour early and the oven broke.', { delay: 62 });
await at(51.4); await click('form[data-form="disruption"] button[type="submit"]', { ms: 900 });
await p.waitForSelector('.modal [data-action="confirm-change"]');
mark('review-shown');
const review = await p.locator('.modal').innerText();
// HOLD on the review (what was understood, the constraint changes, the dry run)
await at(53.6); await to('.modal .cc-list', { ms: 1300, dx: 0.15 });
await glide(cur.x + 20, cur.y + 28, 1300);
await at(57.6); await to('.modal .cc-deltas', { ms: 1300, dx: 0.3 });
await glide(cur.x + 300, cur.y + 20, 1600);
await at(61.4); await to('.modal .cc-impact', { ms: 1300, dx: 0.3 });
await glide(cur.x + 280, cur.y, 1500);
await at(64.6); await to('.modal [data-action="confirm-change"]', { ms: 1200 });
await at(66.2);
await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up();
mark('confirm-1');
await p.waitForFunction(() => document.getElementById('app').dataset.revisions === '2', null, { timeout: 10000 });
mark('sound', { cue: 'success' });
await at(70.0); await to('#tl-main .bar[data-task="roast"]', { ms: 1400, dx: 0.4 });
await at(72.6); await to('#tl-main .ghost', { ms: 1300, dx: 0.5, nth: 0 });
await at(75.2); await to('#tl-main .bar[data-task="serve"]', { ms: 1300 });
await at(78.0); await to('.kpis .kpi', { ms: 1200, nth: 1 });
await at(81.0); await to('.recovery', { ms: 1200, dx: 0.3 });

// ================= BEAT 4 · 1:25–2:00 · Timeline Compare =================
await at(85.0); mark('beat', { n: 4 });
await click('.nav-item[data-view="compare"]', { ms: 1100 });
await p.waitForSelector('.map-row');
await at(88.0); await to('.map-row', { ms: 1200, dx: 0.4, nth: 0 });
await at(90.6); await to('.map-row', { ms: 1200, dx: 0.4, nth: 1 });
await at(93.2); await to('.map-row', { ms: 1200, dx: 0.4, nth: 2 });
await at(95.8); await to('.map-row', { ms: 1200, dx: 0.4, nth: 3 });
await at(98.6); await click('#tl-after .bar[data-task="roast"]', { ms: 1500, dx: 0.4 });
mark('compare-select');
await at(102.6); await to('.map-row.is-selected .reasons li', { ms: 1200, dx: 0.35, nth: 0 });
await glide(cur.x, cur.y + 26, 900);
await glide(cur.x, cur.y + 26, 900);
await at(106.0); await to('.cmp-summary .kpi', { ms: 1100, nth: 2 }); // Finish
await at(108.4); await to('.cmp-summary .kpi', { ms: 1000, nth: 3 }); // Buffer
await at(111.0); await to('.cmp-summary .kpi', { ms: 1000, nth: 4 }); // Total cost
await at(114.0); await to('.cmp-summary .kpi', { ms: 1200, nth: 0 }); // Result

// ================= BEAT 5 · 2:00–2:25 · Assistant: second shock, reload, history =================
await at(120.0); mark('beat', { n: 5 });
await click('.nav-item[data-view="assistant"]', { ms: 1000 });
await p.waitForSelector('#cmd');
await at(122.0); await click('#cmd', { ms: 800, dx: 0.2 });
await p.keyboard.type("Sam can't help", { delay: 70 });
await at(124.3); await p.keyboard.press('Enter');
await p.waitForSelector('.confirm-card [data-action="confirm-change"]');
mark('review-2');
await at(125.2); await to('.confirm-card .cc-list', { ms: 1000, dx: 0.2 });
await at(126.6); await to('.confirm-card .cc-impact', { ms: 900, dx: 0.3 });
await at(127.6); await click('.confirm-card [data-action="confirm-change"]', { ms: 800 });
mark('confirm-2');
await p.waitForFunction(() => document.getElementById('app').dataset.revisions === '3', null, { timeout: 10000 });
mark('sound', { cue: 'success' });
await at(131.4);
mark('reload');
const beforeReload = frames.length;
await p.reload();
await p.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(150);
if (frames.length === beforeReload) await startCast(); // screencast is per document on some builds
await p.mouse.move(cur.x, cur.y);
mark('reloaded', { revisions: await p.evaluate(() => document.getElementById('app').dataset.revisions) });
await at(135.2); await click('.nav-item[data-view="history"]', { ms: 1000 });
await p.waitForSelector('.rev-card');
await at(137.4); await to('.rev-card', { ms: 900, dx: 0.3, nth: 0 });
await at(139.2); await to('.rev-card', { ms: 900, dx: 0.3, nth: 1 });
await at(141.0); await to('.rev-card', { ms: 900, dx: 0.3, nth: 2 });
await at(143.0); await to('.rev-card', { ms: 1000, dx: 0.3, nth: 0 });

// ================= BEAT 6 · 2:25–2:45 · Impossible budget, transparency, close =================
await at(145.0); mark('beat', { n: 6 });
await click('.topbar [data-action="open-disruption"]', { ms: 1000 });
mark('sound', { cue: 'open' });
await p.waitForSelector('[data-field="m-type"]');
await at(147.0); await click('[data-field="m-type"]', { ms: 900, dx: 0.4 });
await p.selectOption('[data-field="m-type"]', 'budget_reduced');
await p.waitForSelector('[data-field="m-cap"]');
await at(149.0); await click('[data-field="m-cap"]', { ms: 700, dx: 0.6 });
await p.locator('[data-field="m-cap"]').fill('');
await p.keyboard.type('30', { delay: 110 });
await at(150.6); await click('form[data-form="manual"] button[type="submit"]', { ms: 700 });
await p.waitForSelector('.modal [data-action="confirm-change"]');
mark('review-3');
mark('sound', { cue: 'error' });
const review3 = await p.locator('.modal').innerText();
await at(152.0); await to('.modal .cc-impact', { ms: 1100, dx: 0.3 });
await glide(cur.x + 340, cur.y, 1800);
await at(156.4); await click('.modal [data-action="confirm-change"]', { ms: 800 }); // Record & show options
await p.waitForSelector('.crisis');
mark('crisis');
mark('sound', { cue: 'error' }); // recording an infeasible change plays the error cue
const crisis = await p.locator('.crisis').innerText();
await at(157.6); await to('.crisis .proof', { ms: 900, dx: 0.5 });
await at(159.0); await to('.crisis [data-action="apply-option"]', { ms: 900 });
await at(160.4); await click('.nav-item[data-view="settings"]', { ms: 800 });
await at(162.6); await click('.nav-item[data-view="home"]', { ms: 800 });
await glide(1100, 640, 900);
await at(166.0);
mark('end');

await cdp.send('Page.stopScreencast');
const finalState = await p.evaluate(() => ({ revisions: document.getElementById('app').dataset.revisions, view: document.getElementById('app').dataset.view }));
writeFileSync(path.join(out, 'frames.json'), JSON.stringify(frames));
writeFileSync(path.join(out, 'events.json'), JSON.stringify({ events, review, review3, crisis, finalState, dsf: DSF }, null, 2));
console.log(`Recorded ${frames.length} frames over ${frames.at(-1).t.toFixed(1)} s; events ${events.length}; final ${JSON.stringify(finalState)}`);
await browser.close();
server.close();
