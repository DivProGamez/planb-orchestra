// Global remote / gamepad / keyboard scrolling audit.
// On every screen (plus the Tasks tab and the disruption dialog) at six viewports, every scroll
// container that actually overflows is discovered from the live DOM, then — with real key presses
// only — entered, scrolled to its end (vertically and horizontally), and left again (no trap).
// Mouse-wheel scrolling is checked to keep working. Usage: npm run test:scroll
import { chromium } from 'playwright-core';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../evidence/scroll');
mkdirSync(out, { recursive: true });
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => existsSync(p));
if (!executablePath) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }

const VIEWPORTS = [[1920, 1080], [1440, 900], [1280, 720], [1024, 768], [768, 1024], [430, 932]];
const server = createApp({ env: {} }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath });
const problems = [];
let containersTested = 0;

/** Scroll containers that overflow right now, tagged so the test can find them again. */
const discover = () => {
  const found = [];
  let n = 0;
  document.querySelectorAll('[data-scroll-test]').forEach((el) => el.removeAttribute('data-scroll-test')); // no stale tags
  // while a dialog is open only its own content is interactive (the page behind it is inert by design)
  const modal = document.querySelector('.modal');
  for (const el of (modal ? modal.querySelectorAll('*') : document.querySelectorAll('#app *'))) {
    if (el.closest('.tl-body')) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20 || cs.visibility === 'hidden') continue;
    const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
    const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2;
    if (!y && !x) continue;
    el.dataset.scrollTest = String(n);
    found.push({ id: n, y, x, name: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || '(no class)'}` });
    n += 1;
  }
  return found;
};

/** Plans the shortest arrow path with the engine's own targeting and presses real keys. */
async function arrowTo(p, selector, max = 120) {
  for (let i = 0; i < max; i += 1) {
    const info = await p.evaluate(async (sel) => {
      const { directionalTarget } = await import('/nav.js');
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
      const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
      const first = new Map([[start, null]]);
      const q = [start];
      while (q.length) {
        const k = q.shift();
        for (const d of ['up', 'down', 'left', 'right']) {
          if (list[k].type === 'range' && (d === 'left' || d === 'right')) continue; // sliders keep Left/Right
          const t = directionalTarget(list[k], list, d);
          if (!t) continue;
          const nn = list.indexOf(t);
          if (nn < 0 || first.has(nn)) continue;
          first.set(nn, first.get(k) || d);
          if (nn === target) return { key: KEYS[first.get(nn)] };
          q.push(nn);
        }
      }
      return { unreachable: true };
    }, selector);
    if (info.missing) return 'missing';
    if (info.unreachable) return 'unreachable';
    if (info.done) return 'ok';
    const onRange = await p.evaluate(() => document.activeElement?.type === 'range');
    await p.keyboard.press(onRange && /Left|Right/.test(info.key) ? 'ArrowUp' : info.key);
    await p.waitForTimeout(25);
  }
  return 'too far';
}

/** Enter container `id`, scroll it to the end along `axis` with arrows, then check focus can leave. */
async function exercise(p, label, c, axis) {
  const key = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
  const present = await p.evaluate(({ id }) => { const el = document.querySelector(`[data-scroll-test="${id}"]`); if (!el) return false; el.scrollTop = 0; el.scrollLeft = 0; return true; }, c);
  if (!present) return;
  await p.waitForTimeout(60);
  // entry: the container itself when it is a focusable region, else its first visible control
  const entry = await p.evaluate(({ id }) => {
    const el = document.querySelector(`[data-scroll-test="${id}"]`);
    if (!el) return 'gone';
    if (el.matches('[data-scroll-region], [tabindex="0"]')) return `[data-scroll-test="${id}"]`;
    const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-nav]';
    const box = el.getBoundingClientRect();
    const inside = [...el.querySelectorAll(FOCUSABLE)].filter((x) => { const r = x.getBoundingClientRect(); return !x.disabled && r.width > 1 && r.height > 1 && r.bottom > box.top + 2 && r.top < box.bottom - 2 && r.right > box.left + 2 && r.left < box.right - 2; });
    if (!inside.length) return null;
    inside[0].dataset.scrollEntry = '1';
    return '[data-scroll-entry="1"]';
  }, c);
  if (entry === 'gone') return;
  if (!entry) { problems.push(`${label}: ${c.name} has no visible way in (no control, not a focusable region)`); return; }
  const how = await arrowTo(p, entry);
  await p.evaluate(() => document.querySelectorAll('[data-scroll-entry]').forEach((e) => e.removeAttribute('data-scroll-entry')));
  if (how !== 'ok') { problems.push(`${label}: ${c.name} not reachable by arrows (${how})`); return; }
  const state = () => p.evaluate(({ id, ax }) => {
    const el = document.querySelector(`[data-scroll-test="${id}"]`);
    if (!el) return { gone: true };
    const max = ax === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    const pos = ax === 'y' ? el.scrollTop : el.scrollLeft;
    return { atEnd: pos >= max - 2, inside: el.contains(document.activeElement), pos, max };
  }, { id: c.id, ax: axis });
  let s = await state();
  for (let i = 0; i < 160 && !s.atEnd && s.inside; i += 1) {
    await p.keyboard.press(key);
    await p.waitForTimeout(20);
    s = await state();
  }
  if (s.gone) return;
  if (!s.atEnd) { problems.push(`${label}: ${c.name} ${axis === 'y' ? 'vertical' : 'horizontal'} end not reached with ${key} (${Math.round(s.pos)}/${Math.round(s.max)}, focus ${s.inside ? 'inside' : 'left early'})`); return; }
  // no trap: if a control exists beyond the container in that direction, focus gets there
  const beyond = await p.evaluate(({ id, ax }) => {
    const el = document.querySelector(`[data-scroll-test="${id}"]`); if (!el) return false; const b = el.getBoundingClientRect();
    const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-nav]';
    const scope = document.querySelector('.modal') || document.getElementById('app');
    return [...scope.querySelectorAll(FOCUSABLE)].some((x) => { if (el.contains(x) || x.disabled) return false; const r = x.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return ax === 'y' ? r.top >= b.bottom - 2 && r.left < b.right && r.right > b.left : r.left >= b.right - 2 && r.top < b.bottom && r.bottom > b.top; });
  }, { id: c.id, ax: axis });
  if (beyond) {
    let left = false;
    for (let i = 0; i < 4 && !left; i += 1) { await p.keyboard.press(key); await p.waitForTimeout(25); left = !(await state()).inside; }
    if (!left) problems.push(`${label}: focus trapped in ${c.name} after reaching its end`);
  }
  containersTested += 1;
}

async function audit(p, label) {
  const found = await p.evaluate(discover);
  const seen = {};
  const plan = found.map((c) => ({ ...c, ordinal: (seen[c.name] = (seen[c.name] ?? -1) + 1) }));
  for (const k of plan) {
    for (const axis of ['y', 'x']) {
      if (!k[axis]) continue;
      const now = await p.evaluate(discover); // the DOM may have been re-rendered by the previous step
      const c = now.filter((x) => x.name === k.name)[k.ordinal];
      if (!c || !c[axis]) continue; // no longer overflowing
      await exercise(p, label, c, axis);
    }
  }
  // the mouse wheel still scrolls the first vertical container
  const wheel = found.find((c) => c.y);
  if (wheel) {
    const box = await p.evaluate(({ id }) => { const el = document.querySelector(`[data-scroll-test="${id}"]`); if (!el) return null; el.scrollTop = 0; el.scrollIntoView({ block: 'nearest', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 60) }; }, wheel);
    if (box) {
      await p.mouse.move(box.x, box.y);
      await p.mouse.wheel(0, 240);
      await p.waitForTimeout(200);
      const moved = await p.evaluate(({ id }) => document.querySelector(`[data-scroll-test="${id}"]`)?.scrollTop > 0, wheel);
      if (!moved) problems.push(`${label}: mouse wheel does not scroll ${wheel.name}`);
    }
  }
  return found.length;
}

const summary = [];
for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`${w}×${h}: page error ${e.message}`));
  await p.goto(base);
  await p.waitForSelector('#splash', { state: 'detached' });
  const tag = `${w}×${h}`;
  // set-up (not under test): a plan with several real changes so lists, history and chat are long
  await p.click('button[form="setup-form"]');
  await p.waitForSelector('.workspace');
  await p.click('.nav-item[data-view="assistant"]');
  for (const t of ['Guests are arriving an hour early and the oven broke.', 'Sam cannot help anymore.', 'Leila is running 10 minutes late', 'Cooking the rice will take 10 more minutes']) {
    await p.fill('#cmd', t);
    await p.press('#cmd', 'Enter');
    await p.waitForSelector('.confirm-card [data-action="confirm-change"]');
    await p.click('.confirm-card [data-action="confirm-change"]');
    await p.waitForTimeout(300);
    await p.click('.nav-item[data-view="assistant"]');
  }
  await p.keyboard.press('Escape');
  const counts = {};
  for (const v of ['home', 'workspace', 'assistant', 'repair', 'compare', 'history', 'settings']) {
    await p.click(`.nav-item[data-view="${v}"]`);
    await p.waitForFunction((x) => document.getElementById('app').dataset.view === x, v);
    await p.waitForTimeout(250);
    await p.keyboard.press('ArrowRight'); // keyboard mode with the screen's initial focus
    await p.keyboard.press('ArrowLeft');
    counts[v] = await audit(p, `${tag} ${v}`);
    if (v === 'home') {
      await p.click('[data-action="home-tab"][data-tab="tasks"]');
      await p.waitForTimeout(200);
      counts['home tasks'] = await audit(p, `${tag} home tasks`);
      await p.click('[data-action="home-tab"][data-tab="timeline"]');
    }
  }
  await p.click('.nav-item[data-view="workspace"]');
  await p.click('.topbar [data-action="open-disruption"]');
  await p.fill('#dis-text', 'Our budget is now $80.');
  await p.click('form[data-form="disruption"] button[type="submit"]');
  await p.waitForSelector('.modal [data-action="cancel-change"]');
  await p.keyboard.press('ArrowDown');
  counts.dialog = await audit(p, `${tag} dialog`);
  summary.push(`${tag}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  await ctx.close();
}
writeFileSync(path.join(out, 'scroll-results.json'), JSON.stringify({ containersTested, summary, problems }, null, 2));
await browser.close();
server.close();
console.log(`Scroll audit: ${containersTested} scroll directions exercised with arrows only; ${problems.length} problem(s).`);
for (const s of summary) console.log(`  ${s}`);
for (const pr of problems.slice(0, 60)) console.log(`  - ${pr}`);
process.exit(problems.length ? 1 : 0);
