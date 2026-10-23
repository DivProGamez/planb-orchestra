// "Create your own plan" in a real browser: build a plan from scratch through the form, catch an
// invalid plan and an infeasible one, then load the 20-task / 6-person example, save it, build it,
// and run the existing journey on it (review → confirm → Before/After → impossible budget → undo →
// reload → history), plus export/import, edit and delete. Screenshots in evidence/create/.
// Usage: npm run test:create
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(here, '../../evidence/create');
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true]); console.log(`PASS  ${name}`); } catch (e) { results.push([false]); console.log(`FAIL  ${name}\n      → ${e.message.split('\n')[0]}`); }
}
const expect = (c, m) => { if (!c) throw new Error(String(m).replace(/\s+/g, ' ')); };
const revs = () => p.evaluate(() => Number(document.getElementById('app').dataset.revisions || 0));
const view = () => p.evaluate(() => document.getElementById('app').dataset.view);
const verdict = () => p.locator('#builder-side').innerText();
const settle = () => p.waitForTimeout(450);
async function arrowTo(selector, max = 80) {
  for (let i = 0; i < max; i += 1) {
    const info = await p.evaluate(async (sel) => {
      const { directionalTarget } = await import('/nav.js');
      const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-nav]';
      const list = [...document.getElementById('app').querySelectorAll(FOCUSABLE)].filter((el) => { if (el.disabled || el.closest('[inert], [aria-hidden="true"]')) return false; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width >= 2 && b.height >= 2 && b.right > 0 && b.left < innerWidth && cs.visibility !== 'hidden' && cs.display !== 'none'; });
      const target = list.findIndex((el) => el.matches(sel));
      if (target < 0) return { missing: true };
      const start = list.indexOf(document.activeElement);
      if (start === target) return { done: true };
      if (start < 0) return { key: 'ArrowDown' };
      const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
      const first = new Map([[start, null]]); const q = [start];
      while (q.length) { const k = q.shift(); for (const d of ['up', 'down', 'left', 'right']) { if (['range', 'time'].includes(list[k].type) && (d === 'left' || d === 'right')) continue; const tEl = directionalTarget(list[k], list, d); if (!tEl) continue; const n = list.indexOf(tEl); if (n < 0 || first.has(n)) continue; first.set(n, first.get(k) || d); if (n === target) return { key: KEYS[first.get(n)] }; q.push(n); } }
      return { unreachable: true };
    }, selector);
    if (info.missing || info.unreachable) throw new Error(`${selector} ${info.missing ? 'missing' : 'not reachable by arrows'}`);
    if (info.done) return;
    await p.keyboard.press(info.key);
    await p.waitForTimeout(30);
  }
  throw new Error(`could not reach ${selector}`);
} // input → debounced engine check (180 ms) + render

await p.goto(base);
await p.waitForSelector('#splash', { state: 'detached' });

await check('sidebar and Home open the builder; built-in scenarios still listed', async () => {
  await p.click('.nav-item[data-view="create"]');
  expect(await view() === 'create', 'builder did not open');
  await p.click('.nav-item[data-view="home"]');
  expect(await p.locator('.tile').count() === 3, 'built-in scenarios missing');
  await p.click('.section-head [data-view="create"]');
  expect(await view() === 'create', 'Home button did not open the builder');
});

await check('a plan typed from scratch is validated and planned by the engine', async () => {
  await p.click('[data-action="b-new"]');
  expect((await verdict()).includes('problem'), 'empty plan not reported as invalid');
  await p.fill('#b-name', 'Move to the new flat');
  await p.fill('#b-start', '09:00');
  await p.fill('#b-deadline', '13:00');
  await p.fill('#b-budget', '150');
  await p.locator('[data-b="people.0.name"]').fill('Nadia');
  await p.click('[data-action="b-add"][data-list="people"]');
  await p.locator('[data-b="people.1.name"]').fill('Hamza');
  await p.click('[data-action="b-add"][data-list="resources"]');
  await p.locator('[data-b="resources.0.name"]').fill('Van');
  await p.locator('[data-b="tasks.0.title"]').fill('Pack boxes');
  await p.locator('[data-b="tasks.0.duration"]').fill('60');
  await p.locator('[data-b="tasks.0.minDuration"]').fill('45');
  await settle();
  expect((await verdict()).includes('pick who can do it'), 'task without people/equipment not flagged');
  await p.click('[data-action="b-toggle"][data-list="people"] >> nth=0');
  await p.click('[data-action="b-toggle"][data-list="people"] >> nth=1');
  await p.click('[data-action="b-add"][data-list="tasks"]');
  await p.locator('[data-b="tasks.1.title"]').fill('Drive boxes over');
  await p.locator('[data-b="tasks.1.duration"]').fill('40');
  await p.locator('[data-b="tasks.1.minDuration"]').fill('40');
  await p.locator('[data-b="tasks.1.cost"]').fill('35');
  await p.click('.b-task >> nth=1 >> [data-action="b-toggle"][data-list="people"] >> nth=1');
  await p.click('.b-task >> nth=1 >> [data-action="b-toggle"][data-list="resources"]');
  await p.click('.b-task >> nth=1 >> summary');
  await p.click('.b-task >> nth=1 >> [data-action="b-toggle"][data-list="dependsOn"]');
  await settle();
  const v = await verdict();
  expect(v.includes('Feasible baseline') && v.includes('2 of 2 tasks scheduled'), `not feasible: ${v.slice(0, 200)}`);
  const order = await p.evaluate(() => { const bars = [...document.querySelectorAll('#tl-builder .bar')].map((b) => [b.getAttribute('aria-label').split(',')[0], b.getBoundingClientRect().left]); return Object.fromEntries(bars); });
  expect(order['Drive boxes over'] > order['Pack boxes'], 'dependency not respected in the preview');
  await p.screenshot({ path: path.join(shots, '01-from-scratch.png') });
});

await check('an impossible budget is reported with the proven reason, and Save & build stays disabled', async () => {
  await p.fill('#b-budget', '20');
  await settle();
  const v = await verdict();
  const disabled = await p.locator('[data-action="b-save"][data-build="1"]').isDisabled();
  await p.fill('#b-budget', '150'); // restore before asserting so later checks start clean
  await settle();
  expect(/No feasible plan/.test(v) && /proven/i.test(v) && /budget is \$20/.test(v), `budget problem not explained: ${v.replace(/\s+/g, ' ').slice(0, 200)}`);
  expect(disabled, 'Save & build enabled for an infeasible plan');
});

await check('a required task cannot depend on an optional one (engine rule shown with task names)', async () => {
  await p.selectOption('[data-b="tasks.0.priority"]', 'optional');
  await settle();
  const v = await verdict();
  expect(v.includes('cannot depend on optional task "Pack boxes"'), `rule not shown: ${v.slice(0, 200)}`);
  await p.selectOption('[data-b="tasks.0.priority"]', 'must');
  await settle();
});

await check('save → listed on Home → build → plan is the custom one', async () => {
  await p.click('[data-action="b-save"]:not([data-build])');
  expect((await verdict()).includes('Saved'), 'no save confirmation');
  await p.click('.nav-item[data-view="home"]');
  expect(await p.locator('.tile', { hasText: 'Move to the new flat' }).count() === 1, 'saved plan not on Home');
  await p.click('button[form="setup-form"]');
  await p.waitForSelector('.workspace');
  expect(await p.locator('#tl-main .bar').count() === 2, 'custom plan not built');
});

await check('the 20-task / 6-person example builds and runs the full journey', async () => {
  await p.click('.nav-item[data-view="create"]');
  await p.click('[data-action="b-example"]');
  await settle();
  const v = await verdict();
  expect(v.includes('Feasible baseline') && v.includes('20 of 20 tasks scheduled'), `example not feasible: ${v.slice(0, 200)}`);
  expect(await p.locator('.b-task').count() === 20 && await p.locator('[data-b$=".name"][data-b^="people"]').count() === 6, 'example size wrong');
  await p.screenshot({ path: path.join(shots, '02-example-builder.png') });
  await p.click('[data-action="b-save"][data-build="1"]');
  await p.waitForSelector('.workspace');
  expect(await revs() === 1, 'not built');
  expect(await p.locator('#tl-main .bar').count() === 20, 'workspace does not show 20 tasks');
  expect(await p.locator('#tl-main .lane-label').count() >= 6, 'people lanes missing');
  await p.screenshot({ path: path.join(shots, '03-example-workspace.png') });
  // disruption through the review step, as for the built-in scenarios
  await p.click('.topbar [data-action="open-disruption"]');
  await p.fill('#dis-text', 'Maya cannot help anymore.');
  await p.click('form[data-form="disruption"] button[type="submit"]');
  await p.waitForSelector('.modal [data-action="confirm-change"]');
  const review = await p.locator('.modal').innerText();
  expect(/Maya unavailable/.test(review) && /Feasible/.test(review), `review did not understand: ${review.replace(/\s+/g, ' ').slice(0, 260)}`);
  expect(await revs() === 1, 'review changed the plan');
  await p.screenshot({ path: path.join(shots, '04-example-review.png') });
  await p.click('.modal [data-action="confirm-change"]');
  await p.waitForFunction(() => document.getElementById('app').dataset.revisions === '2', null, { timeout: 15000 });
  const assigned = await p.evaluate(() => [...document.querySelectorAll('#tl-main .bar')].filter((b) => /, Maya,/.test(b.getAttribute('aria-label'))).length);
  expect(assigned === 0, `${assigned} tasks still assigned to Maya`);
  await p.click('.nav-item[data-view="compare"]');
  expect(await p.locator('.map-row').count() > 0, 'no Before/After changes');
  await p.screenshot({ path: path.join(shots, '05-example-compare.png') });
});

await check('impossible budget on the custom plan: nothing committed, verified option offered', async () => {
  await p.click('.nav-item[data-view="assistant"]');
  await p.fill('#cmd', 'Our budget is now $100.');
  await p.press('#cmd', 'Enter');
  await p.waitForSelector('.confirm-card');
  expect((await p.locator('.confirm-card').innerText()).includes('No feasible plan'), 'not reported impossible');
  await p.click('.confirm-card [data-action="confirm-change"]');
  await p.waitForSelector('.crisis');
  expect(await revs() === 2, 'infeasible plan committed');
  expect(await p.locator('[data-action="apply-option"]').count() > 0, 'no verified option');
  await p.click('[data-action="dismiss-proposal"]');
});

await check('undo, reload and history keep the custom plan', async () => {
  await p.click('.topbar [data-action="undo"]');
  await p.waitForFunction(() => document.getElementById('app').dataset.revisions === '1');
  await p.click('.topbar [data-action="open-disruption"]');
  await p.fill('#dis-text', 'The deadline is 30 minutes earlier.');
  await p.click('form[data-form="disruption"] button[type="submit"]');
  await p.click('.modal [data-action="confirm-change"]');
  await p.waitForFunction(() => document.getElementById('app').dataset.revisions === '2');
  await p.reload();
  await p.waitForSelector('#splash', { state: 'detached' });
  expect(await revs() === 2, 'session lost on reload');
  expect(await p.locator('.crumb-name').innerText() === 'Community Fundraiser Lunch', 'wrong plan after reload');
  await p.click('.nav-item[data-view="history"]');
  expect(await p.locator('.rev-card').count() === 2, 'history wrong');
  await p.click('.nav-item[data-view="home"]');
  expect(await p.locator('.tile', { hasText: 'Community Fundraiser Lunch' }).count() === 1, 'saved example missing after reload');
});

await check('export → import round-trip, edit and delete', async () => {
  await p.click('.nav-item[data-view="create"]');
  await p.click('[data-action="b-io"][data-mode="export"]');
  const json = await p.locator('#b-io-text').inputValue();
  expect(JSON.parse(json).tasks.length === 20, 'export incomplete');
  await p.click('[data-action="b-new"]');
  await p.click('[data-action="b-io"][data-mode="import"]');
  await p.fill('#b-io-text', '{"not":"a plan"}');
  await p.click('[data-action="b-import"]');
  expect((await p.locator('.b-io').innerText()).includes('Not a PlanB Orchestra plan'), 'bad import not rejected');
  await p.fill('#b-io-text', json);
  await p.click('[data-action="b-import"]');
  await settle();
  expect((await verdict()).includes('20 of 20 tasks scheduled'), 'import did not reproduce the plan');
  // edit the saved plan from Home, then delete it (two-step)
  await p.click('.nav-item[data-view="home"]');
  await p.locator('.tile', { hasText: 'Move to the new flat' }).click();
  await p.click('[data-action="b-edit"]');
  expect(await p.locator('#b-name').inputValue() === 'Move to the new flat', 'edit did not load the plan');
  await p.click('[data-action="b-delete"]');
  expect(await p.locator('.nav-item[data-view="home"]').count() === 1 && (await p.locator('[data-action="b-delete"]').innerText()).includes('Confirm'), 'delete is not two-step');
  await p.click('[data-action="b-delete"]');
  await p.click('.nav-item[data-view="home"]');
  expect(await p.locator('.tile', { hasText: 'Move to the new flat' }).count() === 0, 'plan not deleted');
  expect(await p.locator('.tile').count() === 4, 'other plans affected by delete');
});

await check('keyboard: the builder is reachable and editable without a mouse', async () => {
  await p.click('.nav-item[data-view="create"]');
  await p.click('[data-action="b-new"]');
  await p.locator('#b-name').focus();
  await p.keyboard.type('Keyboard plan');
  await p.keyboard.press('Escape'); // leave the field
  await arrowTo('[data-action="b-add"][data-list="people"]');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  expect(await p.locator('[data-b^="people."][data-b$=".name"]').count() === 2, 'Enter did not add a person');
  expect(await p.evaluate(() => document.activeElement?.dataset?.b === 'people.1.name'), 'focus did not move to the new row');
  await p.keyboard.type('Rania');
  await p.keyboard.press('Escape');
  await arrowTo('.b-task [data-action="b-toggle"][data-list="people"]');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  expect(await p.locator('.b-task [data-action="b-toggle"][aria-pressed="true"]').count() === 1, 'Enter did not toggle a person chip');
});

await check('no console errors', async () => expect(errors.length === 0, errors.slice(0, 4).join(' | ')));
await browser.close();
server.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\nCreate QA: ${results.length - failed} passed, ${failed} failed. Screenshots in evidence/create/`);
process.exit(failed ? 1 : 0);
