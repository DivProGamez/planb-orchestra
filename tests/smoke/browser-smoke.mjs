// Browser smoke test: drives the real UI in an installed Chrome/Edge via playwright-core,
// asserts the demo journey, and saves screenshots to evidence/.
// Usage: npm run test:smoke   (set CHROME_PATH to override browser detection)

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, '../../evidence');
mkdirSync(evidence, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found. Set CHROME_PATH.');
  process.exit(2);
}

const results = [];
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const server = createApp({ env: {} }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath, headless: true });
const consoleErrors = [];

// One context so every page shares localStorage, like tabs in one browser profile.
const context = await browser.newContext({ reducedMotion: 'no-preference' });
async function newPage(width, height, { expectNetworkErrors = false } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (expectNetworkErrors && /Failed to load resource/.test(m.text())) return;
    consoleErrors.push(`${width}x${height}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`${width}x${height}: ${e.message}`));
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(evidence, `${name}.png`) });
const revs = (page) => page.locator('.rev').count();
async function send(page, text, expectRevs) {
  await page.fill('#cmd', text);
  await page.press('#cmd', 'Enter');
  if (expectRevs) await page.waitForFunction((n) => document.querySelectorAll('.rev').length === n, expectRevs, { timeout: 8000 });
  else await page.waitForFunction(() => !document.querySelector('#cmd')?.disabled, null, { timeout: 8000 });
  await page.waitForTimeout(1300); // let the 340 ms transitions and staggered cards finish before capturing
}

try {
  const page = await newPage(1440, 900);
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await check('welcome shows three scenario tiles and the simulation label', async () => {
    expect(await page.locator('.tile').count() === 3, 'expected 3 tiles');
    expect(await page.getByText('Simulated Alexa+ experience').count() > 0, 'missing simulated label');
    expect(await page.getByText('limited local rules (not an LLM)').count() > 0, 'missing local-parser label');
    await shot(page, '01-welcome-1440');
  });

  await check('setup form builds a validated baseline plan', async () => {
    await page.click('.tile[data-id="dinner-for-six"]');
    await page.waitForSelector('form[data-form="setup"]');
    await shot(page, '02-setup-1440');
    await page.click('form[data-form="setup"] button[type="submit"]');
    await page.waitForSelector('.workspace');
    expect(await revs(page) === 1, 'expected revision r0');
    expect((await page.locator('.kpi-ok').textContent()).includes('0 violations'), 'baseline not validated');
    await shot(page, '03-baseline-1440');
  });

  await check('first shock (early guests + broken oven) replans with reasons and animation data', async () => {
    await send(page, 'Guests are arriving an hour early and the oven broke.', 2);
    const reasons = await page.locator('.why-card .reason').allTextContents();
    expect(reasons.some((r) => /equipment down/i.test(r)), 'no RESOURCE_DOWN badge');
    expect(reasons.some((r) => /alternative used/i.test(r)), 'no ALTERNATIVE_USED badge');
    expect(await page.locator('.bar:has-text("Pan-sear")').count() === 1, 'pan-sear alternative not on chart');
    expect(await page.locator('.ghost').count() > 0, 'no previous-position ghosts');
    await shot(page, '04-shock1-plan-b-1440');
    await page.click('[data-view="compare"]');
    expect(await page.locator('.gantt').count() === 2, 'compare view should show two charts');
    await shot(page, '05-before-after-1440');
    await page.click('[data-view="plan"]');
  });

  await check('second shock on the same session after advancing the clock', async () => {
    await page.click('.chip[data-text^="Advance"]');
    await page.waitForFunction(() => document.querySelector('.clock strong')?.textContent === '4:40 PM');
    await send(page, 'Sam cannot help anymore.', 3);
    const reasons = await page.locator('.why-card .reason').allTextContents();
    expect(reasons.some((r) => /person unavailable/i.test(r)), 'no PERSON_UNAVAILABLE badge');
    await shot(page, '06-shock2-1440');
  });

  await check('refresh restores plan, revisions and clock', async () => {
    await page.reload();
    await page.waitForSelector('.workspace');
    expect(await revs(page) === 3, 'revisions lost on reload');
    expect((await page.locator('.clock strong').textContent()) === '4:40 PM', 'clock lost on reload');
    await shot(page, '07-after-reload-1440');
  });

  await check('impossible budget is rejected with proven violation and two verified options', async () => {
    await send(page, 'Our budget is now $80.');
    await page.waitForSelector('#infeasible');
    expect(await page.locator('.violations li').count() >= 1, 'no violations listed');
    expect(await page.locator('#infeasible .option').count() >= 2, 'fewer than two options');
    expect(await revs(page) === 3, 'infeasible request was committed');
    await shot(page, '08-infeasible-1440');
    await page.locator('[data-action="apply-option"]').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('.rev').length === 4);
    await page.waitForTimeout(900);
    await shot(page, '09-option-applied-1440');
  });

  await check('undo goes back one revision; restore returns to the original', async () => {
    await page.click('[data-action="undo"]');
    await page.waitForFunction(() => document.querySelectorAll('.rev').length === 3);
    await page.click('[data-action="restore"]');
    await page.waitForFunction(() => document.querySelectorAll('.rev').length === 1);
  });

  await check('structured change form uses the same engine path', async () => {
    await page.selectOption('[data-field="m-type"]', 'person_unavailable');
    await page.selectOption('[data-field="m-person"]', 'leila');
    await page.click('form[data-form="manual"] button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('.rev').length === 2);
    const log = await page.locator('.activity').textContent();
    expect(log.includes('Structured form') && log.includes('validate_plan'), 'activity log missing steps');
  });

  await check('unsupported phrasing fails visibly without changing the plan', async () => {
    await send(page, 'Please repaint the fence purple');
    expect(await revs(page) === 2, 'plan changed on unknown input');
    expect(await page.locator('.msg.tone-failure').count() > 0, 'no failure message');
  });

  await check('keyboard: Escape dismisses the infeasible panel', async () => {
    await send(page, 'Guests arrive 2 hours earlier');
    await page.waitForSelector('#infeasible');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#infeasible', { state: 'detached' });
  });

  const small = await newPage(1280, 720);
  await check('1280×720: restored session renders without horizontal page overflow', async () => {
    await small.goto(base);
    await small.waitForSelector('.workspace');
    const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 0, `horizontal overflow ${overflow}px`);
    await shot(small, '10-workspace-1280x720');
  });

  await check('1024×768 tablet: stacked layout without horizontal page overflow', async () => {
    await small.setViewportSize({ width: 1024, height: 768 });
    await small.waitForTimeout(300);
    const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 0, `horizontal overflow ${overflow}px`);
    await shot(small, '10b-workspace-1024x768');
    await small.setViewportSize({ width: 1280, height: 720 });
  });

  await check('other scenarios build feasible baselines', async () => {
    for (const id of ['childrens-birthday', 'weekend-outing']) {
      await small.click('[data-action="new-session"]');
      await small.click(`.tile[data-id="${id}"]`);
      await small.click('form[data-form="setup"] button[type="submit"]');
      await small.waitForSelector('.workspace');
      expect(await small.locator('.kpi-ok').count() === 1, `${id} not validated`);
    }
    await send(small, 'Parent B got called into work and is unavailable.', 2);
    await shot(small, '11-outing-shock-1280x720');
  });

  await check('API outage does not blank the app (falls back to local parser)', async () => {
    const offline = await newPage(1280, 720, { expectNetworkErrors: true });
    await offline.route('**/api/**', (route) => route.abort());
    await offline.goto(base);
    await offline.waitForSelector('.workspace');
    await offline.waitForFunction(() => document.body.textContent.includes('not an LLM'));
    await send(offline, 'Can we still arrive on time?');
    expect(await offline.locator('.msg-assistant').count() >= 2, 'no reply while offline');
  });

  await check('no console errors during the run', async () => {
    expect(consoleErrors.length === 0, consoleErrors.join(' | '));
  });
} finally {
  await browser.close();
  server.close();
}

const summary = {
  date: new Date().toISOString(),
  browser: path.basename(executablePath),
  passed: results.filter((r) => r.status === 'PASS').length,
  failed,
  results,
};
writeFileSync(path.join(evidence, 'smoke-results.json'), JSON.stringify(summary, null, 2));
console.log(`\nSmoke: ${summary.passed} passed, ${failed} failed. Screenshots in evidence/`);
process.exitCode = failed ? 1 : 0;
