// Release QA: functional edge cases and accessibility checks in a real browser.
// Corrupted storage, cancelled and unsupported changes, impossible budgets with verified options,
// consecutive disruptions, displayed figures vs saved state, undo/restore, keyboard and focus,
// accessible names, modal fit, reduced motion. Usage: npm run test:qa
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createApp } from '../../server/app.js';

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
  try { await fn(); results.push([true, name]); console.log(`PASS  ${name}`); } catch (e) { results.push([false, name]); console.log(`FAIL  ${name}\n      → ${e.message}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function newPage(width = 1440, height = 900, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  return p;
}
const ready = (p) => p.waitForSelector('#splash', { state: 'detached', timeout: 8000 });
const revs = (p) => p.evaluate(() => Number(document.getElementById('app').dataset.revisions || 0));
const nav = async (p, v) => { await p.click(`.nav-item[data-view="${v}"]`); await p.waitForFunction((x) => document.getElementById('app').dataset.view === x, v); await p.waitForTimeout(250); };
async function ask(p, text) {
  if (await p.evaluate(() => document.getElementById('app').dataset.view) !== 'assistant') await nav(p, 'assistant');
  await p.fill('#cmd', text);
  await p.press('#cmd', 'Enter');
  await p.waitForFunction(() => document.querySelector('.confirm-card') || !document.querySelector('#cmd')?.disabled, null, { timeout: 8000 });
  await p.waitForTimeout(200);
}
async function confirm(p) {
  const before = await revs(p);
  await p.click('[data-action="confirm-change"]');
  await p.waitForFunction((b) => Number(document.getElementById('app').dataset.revisions) > b || document.querySelector('.crisis'), before, { timeout: 8000 });
  await p.waitForTimeout(300);
}
/** Saved session as the app stored it (the single source of truth for displayed figures). */
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('planb-orchestra.state')).session);

const p = await newPage();

await check('corrupted saved state: app starts clean, explains, and stays usable', async () => {
  await p.goto(base);
  await p.evaluate(() => localStorage.setItem('planb-orchestra.state', '{not json'));
  await p.reload();
  await ready(p);
  expect(await p.evaluate(() => document.getElementById('app').dataset.view) === 'home', 'not on home');
  expect(await p.getByText('could not be read and was cleared').count() > 0, 'no notice about the cleared session');
  await p.evaluate(() => localStorage.setItem('planb-orchestra.state', JSON.stringify({ version: 2, session: { version: 999 } })));
  await p.reload();
  await ready(p);
  expect(await p.getByText('failed validation and was cleared').count() > 0, 'invalid session not reported');
  await p.click('button[form="setup-form"]');
  await p.waitForSelector('.workspace');
  expect(await revs(p) === 1, 'baseline not built after recovery');
});

await check('displayed figures match the saved session (header, KPIs, sidebar)', async () => {
  const s = await saved(p);
  const head = s.revisions[s.revisions.length - 1];
  const shown = await p.evaluate(async (h) => {
    const { formatClock } = await import('/components.js');
    const sc = h.state.scenario;
    const kpis = document.querySelector('.kpis').innerText;
    return {
      finish: kpis.includes(formatClock(sc, h.plan.endMin)),
      cost: kpis.includes(`$${h.plan.totalCost}`),
      checks: kpis.includes(`${h.plan.validation.checks} independent checks`),
      rev: document.querySelector('.crumb-rev')?.textContent === h.id,
      side: document.querySelector('.session-card').innerText.includes(`${h.plan.validation.checks} checks`),
    };
  }, head);
  for (const [k, v] of Object.entries(shown)) expect(v, `${k} does not match the saved plan`);
});

await check('cancelled preview and unsupported phrasing never change the plan', async () => {
  const before = await revs(p);
  await ask(p, 'Guests are arriving an hour early and the oven broke.');
  expect(await p.locator('.confirm-card').count() === 1, 'no review card');
  expect(await revs(p) === before, 'preview changed the plan');
  await p.click('[data-action="cancel-change"]');
  await p.waitForTimeout(200);
  expect(await revs(p) === before, 'cancel changed the plan');
  await ask(p, 'Please teleport the turkey to Mars');
  expect(await revs(p) === before, 'unsupported command changed the plan');
  expect(await p.getByText(/couldn.t map that/i).count() > 0, 'no unsupported-command feedback');
});

await check('consecutive disruptions: each is validated and recorded (r1 → r3)', async () => {
  await ask(p, 'Guests are arriving an hour early and the oven broke.');
  await confirm(p);
  await ask(p, 'Sam cannot help anymore.');
  await confirm(p);
  await ask(p, 'Leila is running 10 minutes late');
  await confirm(p);
  const s = await saved(p);
  expect(s.revisions.length === 4, `expected 4 revisions, got ${s.revisions.length}`);
  expect(s.revisions.every((r) => r.plan.feasible && r.plan.validation.checks > 0), 'a stored revision is not validated');
});

await check('narrow bars: each short label is a whole word of that task (title or keyword)', async () => {
  await p.setViewportSize({ width: 1280, height: 720 });
  await nav(p, 'workspace');
  await p.waitForTimeout(400);
  const bad = await p.evaluate(() => [...document.querySelectorAll('.bar')].filter((b) => getComputedStyle(b.querySelector('.bar-short')).display !== 'none').filter((b) => {
    const short = b.querySelector('.bar-short').textContent.trim().toLowerCase();
    const words = b.getAttribute('aria-label').toLowerCase().split(/[\s&,/]+/);
    return !short || !words.includes(short);
  }).map((b) => `${b.querySelector('.bar-short').textContent} ← ${b.querySelector('.bar-title').textContent}`));
  expect(bad.length === 0, bad.join(' | '));
  await p.setViewportSize({ width: 1440, height: 900 });
});

await check('Before/After: selecting a change highlights that task in Plan A and Plan B', async () => {
  await nav(p, 'compare');
  const row = p.locator('.map-row .map-head').nth(1);
  const task = await row.getAttribute('data-task');
  await row.click();
  await p.waitForTimeout(300);
  const sel = await p.evaluate(() => ({ a: [...document.querySelectorAll('#tl-before .bar.is-selected')].map((b) => b.dataset.task), b: [...document.querySelectorAll('#tl-after .bar.is-selected')].map((b) => b.dataset.task), row: document.querySelector('.map-row.is-selected .map-head')?.dataset.task }));
  expect(sel.a.length === 1 && sel.a[0] === task, `Plan A highlight: ${sel.a}`);
  expect(sel.b.length === 1 && sel.b[0] === task, `Plan B highlight: ${sel.b}`);
  expect(sel.row === task, 'change-map row not marked as selected');
  await row.click();
});

await check('impossible budget: nothing committed until a verified option is chosen', async () => {
  const before = await revs(p);
  await ask(p, 'Our budget is now $40.');
  expect(await p.getByText(/No feasible plan/i).count() > 0, 'review does not report infeasibility');
  await confirm(p);
  expect(await revs(p) === before, 'an infeasible plan was committed');
  expect(await p.locator('.crisis').count() === 1, 'no crisis panel');
  const options = await p.locator('[data-action="apply-option"]').count();
  expect(options > 0, 'no verified options offered');
  await p.locator('[data-action="apply-option"]').first().click();
  await p.waitForFunction((b) => Number(document.getElementById('app').dataset.revisions) > b, before, { timeout: 8000 });
  const s = await saved(p);
  const head = s.revisions[s.revisions.length - 1];
  expect(head.plan.feasible && head.plan.totalCost <= head.state.scenario.budgetCap, 'applied option is not within the budget');
});

await check('undo and restore original keep history consistent and survive reload', async () => {
  const before = await revs(p);
  await p.click('.topbar [data-action="undo"]');
  await p.waitForFunction((b) => Number(document.getElementById('app').dataset.revisions) === b - 1, before, { timeout: 8000 });
  await p.reload();
  await ready(p);
  expect(await revs(p) === before - 1, 'undo lost on reload');
  await nav(p, 'history');
  await p.click('[data-action="restore"]');
  await p.waitForFunction(() => Number(document.getElementById('app').dataset.revisions) === 1, null, { timeout: 8000 });
  const s = await saved(p);
  expect(s.revisions.length === 1 && s.revisions[0].id === 'r0', 'restore did not return to r0');
});

await check('keyboard: D opens the dialog with focus in the text box, Escape closes it, focus ring visible', async () => {
  await nav(p, 'workspace');
  await p.locator('body').click({ position: { x: 5, y: 600 } });
  await p.keyboard.press('d');
  await p.waitForSelector('.modal');
  expect(await p.evaluate(() => document.activeElement?.id) === 'dis-text', 'focus is not in the description box');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.modal', { state: 'detached' });
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return el !== document.body && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
  expect(ring, 'keyboard focus has no visible outline');
});

await check('every button, link and field has an accessible name (all screens)', async () => {
  const missing = [];
  for (const v of ['home', 'workspace', 'assistant', 'repair', 'compare', 'history', 'settings']) {
    await nav(p, v);
    missing.push(...await p.evaluate((view) => [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => {
      if (el.type === 'hidden' || el.closest('[aria-hidden="true"]')) return false;
      const name = el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || el.closest('label')?.textContent.trim() || el.getAttribute('placeholder');
      return !name;
    }).map((el) => `${view}: <${el.tagName.toLowerCase()} class="${el.className}">`), v));
  }
  expect(missing.length === 0, missing.slice(0, 6).join(' | '));
});

await check('disruption dialog fits with its actions visible at 1280×720 and 1440×900', async () => {
  for (const [w, h] of [[1280, 720], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(300);
    await p.click('.topbar [data-action="open-disruption"]');
    await p.fill('#dis-text', 'Guests are arriving an hour early and the oven broke.');
    await p.click('form[data-form="disruption"] button[type="submit"]');
    await p.waitForSelector('.modal [data-action="confirm-change"]');
    const fit = await p.evaluate(() => {
      const m = document.querySelector('.modal').getBoundingClientRect();
      const b = document.querySelector('.modal [data-action="confirm-change"]').getBoundingClientRect();
      return m.top >= 0 && m.bottom <= innerHeight && b.bottom <= innerHeight && b.right <= innerWidth;
    });
    expect(fit, `dialog or its actions outside the viewport at ${w}×${h}`);
    await p.keyboard.press('Escape');
    await p.waitForSelector('.modal', { state: 'detached' });
  }
  expect(await revs(p) === 1, 'closing the dialog changed the plan');
});

await check('reduced motion (system setting): changes apply without animations', async () => {
  const rm = await newPage(1440, 900, { reducedMotion: 'reduce' });
  await rm.goto(base);
  await ready(rm);
  await rm.click('button[form="setup-form"]');
  await rm.waitForSelector('.workspace');
  await rm.click('.topbar [data-action="open-disruption"]');
  await rm.fill('#dis-text', 'Sam cannot help anymore.');
  await rm.click('form[data-form="disruption"] button[type="submit"]');
  await rm.click('.modal [data-action="confirm-change"]');
  await rm.waitForFunction(() => Number(document.getElementById('app').dataset.revisions) === 2);
  const animated = await rm.evaluate(() => [...document.querySelectorAll('.bar, .stage, .marker')].some((el) => { const cs = getComputedStyle(el); return parseFloat(cs.transitionDuration) > 0.01 || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.01); }));
  expect(!animated, 'animations still run with reduced motion');
});

await check('Home Live preview: Timeline ↔ Tasks keeps the layout stable; every task row and column reachable inside the table', async () => {
  const geo = (pg) => pg.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height) }; };
    const host = document.querySelector('.view-host');
    return { preview: r('.preview'), constraints: r('.constraints-card'), tile: r('.tile'), page: host.scrollHeight };
  });
  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [768, 1024]]) {
    const pg = await newPage(w, h);
    await pg.goto(base);
    await ready(pg);
    await pg.waitForTimeout(300);
    const a = await geo(pg);
    await pg.click('[data-action="home-tab"][data-tab="tasks"]');
    await pg.waitForTimeout(300);
    const b = await geo(pg);
    const jump = (x, y) => Math.abs(x - y);
    if (w >= 1101) {
      expect(jump(a.preview.h, b.preview.h) <= 4, `${w}×${h}: preview height ${a.preview.h} → ${b.preview.h}`);
      expect(jump(a.constraints.top, b.constraints.top) <= 4, `${w}×${h}: Constraints moved ${a.constraints.top} → ${b.constraints.top}`);
      expect(jump(a.page, b.page) <= 4, `${w}×${h}: page height ${a.page} → ${b.page}`);
    } else {
      expect(b.preview.h <= a.preview.h + 140, `${w}×${h}: stacked preview grew ${a.preview.h} → ${b.preview.h}`);
    }
    expect(jump(a.tile.h, b.tile.h) <= 2, `${w}×${h}: scenario cards stretched ${a.tile.h} → ${b.tile.h}`);
    const reach = await pg.evaluate(() => {
      const wrap = document.querySelector('.table-wrap');
      const rows = wrap.querySelectorAll('tbody tr').length;
      wrap.scrollTop = wrap.scrollHeight; wrap.scrollLeft = wrap.scrollWidth;
      const wr = wrap.getBoundingClientRect();
      const last = wrap.querySelector('tbody tr:last-child').getBoundingClientRect();
      const lastCol = wrap.querySelector('thead th:last-child').getBoundingClientRect();
      const head = wrap.querySelector('thead th').getBoundingClientRect();
      return { rows, lastRow: last.bottom <= wr.bottom + 1 && last.top >= wr.top - 1, lastCol: lastCol.right <= wr.right + 1, sticky: head.top >= wr.top - 1 && head.top <= wr.top + 2, noPageX: document.documentElement.scrollWidth <= innerWidth };
    });
    const tasks = await pg.evaluate(() => document.querySelectorAll('.tile.is-active').length && Number(document.querySelector('.tile.is-active .tile-facts span:nth-child(2)').textContent.replace(/\D/g, '')));
    expect(reach.rows === tasks, `${w}×${h}: table shows ${reach.rows} of ${tasks} tasks`);
    expect(reach.lastRow && reach.lastCol, `${w}×${h}: last row or last column not reachable`);
    expect(reach.sticky, `${w}×${h}: column headers not sticky`);
    expect(reach.noPageX, `${w}×${h}: page scrolls horizontally`);
    // keyboard: the table region scrolls with Up/Down, then focus moves on
    await pg.evaluate(() => { const wr = document.querySelector('.table-wrap'); wr.scrollTop = 0; });
    await pg.locator('.table-wrap').focus();
    await pg.keyboard.press('ArrowDown');
    await pg.waitForTimeout(350);
    expect(await pg.evaluate(() => document.activeElement.classList.contains('table-wrap') && document.querySelector('.table-wrap').scrollTop > 0) || reach.rows < 6, `${w}×${h}: ArrowDown did not scroll the table`);
    await pg.click('[data-action="home-tab"][data-tab="timeline"]');
    await pg.waitForTimeout(300);
    const c = await geo(pg);
    expect(jump(a.preview.h, c.preview.h) <= 4 && jump(a.tile.h, c.tile.h) <= 2, `${w}×${h}: back to Timeline changed the layout`);
    await pg.context().close();
  }
});

await check('no console errors, warnings or uncaught exceptions', async () => {
  expect(errors.length === 0, errors.slice(0, 5).join(' | '));
});

await browser.close();
server.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\nRelease QA: ${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
