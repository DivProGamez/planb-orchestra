// Populated-screen audit: for each scenario, builds the baseline, applies one real change through the
// assistant's review → confirm step, visits every screen, undoes, reloads, and saves a 1920×1080
// screenshot of each populated screen to evidence/populated/. Fails on layout or console problems.
// Usage: npm run audit:screens   (set CHROME_PATH to override browser detection)

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../evidence/populated');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.png')) unlinkSync(path.join(out, f));

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => existsSync(p));
if (!executablePath) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }

const FLOWS = [
  ['dinner-for-six', 'dinner', 'Guests are arriving an hour early and the oven broke.'],
  ['childrens-birthday', 'birthday', 'The babysitter cancelled'],
  ['weekend-outing', 'outing', 'My partner got called into work'],
];

const server = createApp({ env: {} }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const problems = [];
const shots = [];
const revs = () => page.evaluate(() => Number(document.getElementById('app').dataset.revisions || 0));
const nav = async (view) => {
  await page.click(`.nav-item[data-view="${view}"]`);
  await page.waitForFunction((v) => document.getElementById('app').dataset.view === v, view);
  await page.waitForTimeout(500);
};

/** Layout checks on the visible screen; every failure is recorded with the screen name. */
async function check(label) {
  const r = await page.evaluate(() => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) issues.push('page scrolls');
    for (const tl of document.querySelectorAll('.tl')) {
      const bars = [...tl.querySelectorAll('.bar')].map((b) => b.getBoundingClientRect());
      // marker labels live in the axis strip and must not cover any bar
      for (const m of tl.querySelectorAll('.am')) {
        const a = m.getBoundingClientRect();
        if (bars.some((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)) issues.push(`marker label over a bar: ${m.textContent.trim()}`);
      }
      // equipment rows and bars stay inside the chart body
      for (const body of tl.querySelectorAll('.tl-body')) {
        const edge = body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).borderBottomWidth);
        for (const e of body.querySelectorAll('.bar, .res-use')) if (e.getBoundingClientRect().bottom > edge + 0.5) issues.push(`cut at chart bottom: ${e.title.slice(0, 30)}`);
      }
      // a visible ghost label must not sit under a bar
      for (const g of tl.querySelectorAll('.ghost span')) {
        const a = g.getBoundingClientRect();
        if (bars.some((b) => a.left < b.right - 1 && b.left + 1 < a.right && a.top < b.bottom && b.top < a.bottom)) issues.push(`ghost label under a bar: ${g.textContent.trim()}`);
      }
    }
    // pills, tags and buttons stay inside their card
    for (const card of document.querySelectorAll('.card')) {
      const c = card.getBoundingClientRect();
      for (const el of card.querySelectorAll('.pill, .tag, .btn')) {
        const r2 = el.getBoundingClientRect();
        if (r2.width && (r2.right > c.right + 1 || r2.left < c.left - 1)) issues.push(`outside its card: ${el.textContent.trim().slice(0, 30)}`);
      }
    }
    return issues;
  });
  for (const i of [...new Set(r)]) problems.push(`${label}: ${i}`);
}
async function shot(name, label) {
  await check(label);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  shots.push(name);
}

await page.goto(base);
await page.waitForSelector('#splash', { state: 'detached', timeout: 10000 });
for (const [id, tag, text] of FLOWS) {
  await nav('home');
  await page.click(`[data-action="choose-scenario"][data-id="${id}"]`);
  await page.waitForTimeout(400);
  await shot(`${tag}-01-home`, `${tag} home`);
  await page.click('button[form="setup-form"]');
  await page.waitForSelector('.workspace');
  await page.waitForTimeout(900);
  await shot(`${tag}-02-workspace-baseline`, `${tag} workspace r0`);
  await nav('assistant');
  const before = await revs();
  await page.fill('#cmd', text);
  await page.press('#cmd', 'Enter');
  await page.waitForSelector('.confirm-card [data-action="confirm-change"]', { timeout: 8000 });
  if (await revs() !== before) problems.push(`${tag}: review step changed the plan before confirmation`);
  await shot(`${tag}-03-assistant-review`, `${tag} review`);
  await page.click('[data-action="confirm-change"]');
  await page.waitForFunction((b) => Number(document.getElementById('app').dataset.revisions) > b, before, { timeout: 8000 });
  await page.waitForTimeout(1700);
  await shot(`${tag}-04-workspace-plan-b`, `${tag} workspace r1`);
  await page.locator('.bar.is-changed').first().click();
  await page.waitForTimeout(400);
  await shot(`${tag}-05-task-inspector`, `${tag} inspector`);
  await nav('assistant');
  await shot(`${tag}-06-assistant-after`, `${tag} assistant`);
  await nav('repair');
  await page.waitForTimeout(600);
  if (await page.locator('.stage-ok').count() !== 6) problems.push(`${tag}: repair workflow does not show six completed stages`);
  await shot(`${tag}-07-repair-workflow`, `${tag} repair`);
  await nav('compare');
  await shot(`${tag}-08-before-after`, `${tag} compare`);
  await nav('history');
  await shot(`${tag}-09-history`, `${tag} history`);
  const r1 = await revs();
  await page.click('.view [data-action="undo"]');
  await page.waitForFunction((b) => Number(document.getElementById('app').dataset.revisions) < b, r1);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('#splash', { state: 'detached', timeout: 10000 });
  await page.waitForTimeout(500);
  if (await revs() !== r1 - 1) problems.push(`${tag}: undo did not survive a reload`);
  await shot(`${tag}-10-after-undo-and-reload`, `${tag} after reload`);
}
await nav('settings');
await shot('settings', 'settings');
for (const e of consoleErrors) problems.push(`console: ${e}`);

writeFileSync(path.join(out, 'audit-results.json'), JSON.stringify({ viewport: '1920x1080', screenshots: shots, problems }, null, 2));
await browser.close();
server.close();
console.log(`Populated audit: ${shots.length} screenshots in evidence/populated/, ${problems.length} problem(s)`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length ? 1 : 0);
