// Browser smoke test: drives the real UI in an installed Chrome/Edge via playwright-core,
// asserts the demo journey across every screen, and saves screenshots to evidence/.
// Usage: npm run test:smoke   (set CHROME_PATH to override browser detection)

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, '../../evidence');
mkdirSync(evidence, { recursive: true });
for (const f of readdirSync(evidence)) if (f.endsWith('.png')) unlinkSync(path.join(evidence, f));

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
    console.log(`FAIL  ${name}\n      ${err.message.split('\n')[0]}`);
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

// One context so pages share localStorage, like tabs in one browser profile.
const context = await browser.newContext({ reducedMotion: 'no-preference' });
// Record every splash status line, since the splash only lasts as long as real start-up work.
await context.addInitScript(() => {
  window.__splash = [];
  new MutationObserver(() => {
    const t = document.getElementById('splash-status')?.textContent;
    if (t && window.__splash[window.__splash.length - 1] !== t) window.__splash.push(t);
  }).observe(document, { subtree: true, childList: true, characterData: true });
});
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
const ready = (p) => p.waitForSelector('#splash', { state: 'detached', timeout: 6000 });
const revs = (p) => p.evaluate(() => Number(document.getElementById('app').dataset.revisions || 0));
const waitRevs = (p, n) => p.waitForFunction((x) => document.getElementById('app').dataset.revisions === String(x), n, { timeout: 8000 });
const pageScroll = (p) => p.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }));
const nav = async (p, view) => { await p.click(`.nav-item[data-view="${view}"]`); await p.waitForFunction((v) => document.getElementById('app').dataset.view === v, view); await p.waitForTimeout(350); };
/** Labels of pills/tags/buttons that stick out of their card (should be none). */
const spills = (p) => p.evaluate(() => [...document.querySelectorAll('.card')].flatMap((card) => {
  const c = card.getBoundingClientRect();
  return [...card.querySelectorAll('.pill, .tag, .btn')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > c.right + 1 || r.left < c.left - 1); }).map((el) => el.textContent.trim().slice(0, 40));
}));
const settle = (p) => p.waitForTimeout(1500); // transitions are 260–560 ms; staggered items finish within ~1.4 s

/** Types into the assistant; reviews and confirms the change when a review card appears. */
async function say(p, text, { confirm = true } = {}) {
  if ((await p.evaluate(() => document.getElementById('app').dataset.view)) !== 'assistant') await nav(p, 'assistant');
  await p.fill('#cmd', text);
  await p.press('#cmd', 'Enter');
  await p.waitForFunction(() => document.querySelector('#confirm-card, .confirm-card') || !document.querySelector('#cmd')?.disabled, null, { timeout: 8000 });
  const card = await p.locator('.confirm-card').count();
  if (card && confirm) {
    await p.click('[data-action="confirm-change"]');
    await p.waitForFunction(() => !document.querySelector('.confirm-card') && document.getElementById('app').dataset.view === 'workspace', null, { timeout: 8000 });
    await settle(p);
  }
}

try {
  const page = await newPage(1440, 900);
  await page.goto(base);
  await ready(page);
  await page.evaluate(() => localStorage.clear());

  await check('splash walks through the real start-up steps (about 2.4 s) and reports the validated checks', async () => {
    const t0 = Date.now();
    await page.reload();
    await ready(page);
    const elapsed = Date.now() - t0;
    const lines = await page.evaluate(() => window.__splash);
    expect(lines.some((l) => /^Ready — \d+ baseline checks passed/.test(l)), `splash lines: ${lines.join(' | ')}`);
    expect(elapsed >= 2000 && elapsed < 4000, `splash took ${elapsed} ms (expected about 2.4 s)`);
    for (const step of ['Loading planning engine', 'Validating 3 household scenarios', 'Checking assistant parser', 'Restoring your session']) {
      expect(lines.some((l) => l.startsWith(step)), `splash step missing: ${step}`);
    }
    const boot = await page.evaluate(() => document.getElementById('app').dataset.boot);
    expect(/\d+ baseline checks passed across 3 scenarios in \d+ ms/.test(boot), `boot summary: ${boot}`);
  });

  await check('every sidebar icon opens its screen before a plan exists (with a build action)', async () => {
    for (const view of ['workspace', 'assistant', 'repair', 'compare', 'history', 'settings']) {
      await page.click(`.nav-item[data-view="${view}"] svg`);
      await page.waitForFunction((v) => document.getElementById('app').dataset.view === v, view);
      if (view !== 'settings') expect(await page.locator('.view-needs [data-action="build-from"]').count() === 1, `${view}: no build action`);
    }
    await page.click('.nav-item[data-view="home"] svg');
    await page.waitForSelector('.view-home');
  });

  await check('home dashboard: scenarios, live preview reacting to constraints, honest labels, no scroll', async () => {
    expect(await page.locator('.tile').count() === 3, 'expected 3 scenario cards');
    expect(await page.getByText('Simulated Alexa+ demo').count() > 0, 'missing simulation disclosure');
    expect(await page.getByText('not an LLM').count() > 0, 'missing local-parser disclosure');
    expect(await page.locator('#tl-preview .bar').count() > 0, 'live preview timeline missing');
    await page.fill('#f-budget', '40');
    await page.waitForSelector('.hero .tag-bad');
    await page.fill('#f-budget', '100');
    await page.waitForSelector('.hero .tag-ok');
    const sc = await pageScroll(page);
    expect(sc.x <= 0 && sc.y <= 0, `home scrolls at 1440×900 (${sc.x}, ${sc.y})`);
    await shot(page, '01-home-1440x900');
  });

  await check('build a validated baseline plan from the hero action', async () => {
    await page.click('button[form="setup-form"]');
    await page.waitForSelector('.workspace');
    expect(await revs(page) === 1, 'expected revision r0');
    expect((await page.locator('.kpi-ok').textContent()).includes('0 violations'), 'baseline not validated');
    await page.waitForTimeout(400);
    const sc = await pageScroll(page);
    expect(sc.x <= 0 && sc.y <= 0, `workspace scrolls at 1440×900 (${sc.x}, ${sc.y})`);
    await shot(page, '02-workspace-baseline-1440x900');
  });

  await check('disruption dialog: describe → review (dry run) → confirm → animated Plan B', async () => {
    await page.click('[data-action="open-disruption"]');
    await page.fill('#dis-text', 'Guests are arriving an hour early and the oven broke.');
    await page.click('form[data-form="disruption"] button[type="submit"]');
    await page.waitForSelector('.modal .confirm-card');
    const review = await page.locator('.modal .confirm-card').textContent();
    expect(/Deadline 60 min earlier/.test(review) && /Oven unavailable/.test(review), 'review does not list both changes');
    expect(/Feasible\./.test(review) && /nothing saved yet/.test(review), 'dry-run impact missing');
    expect(await revs(page) === 1, 'review must not commit anything');
    await shot(page, '03-disruption-review-1440x900');
    await page.click('[data-action="confirm-change"]');
    await waitRevs(page, 2);
    await settle(page);
    expect(/Plan B ready — r1/.test(await page.locator('.recovery').textContent()), 'recovery banner missing');
    expect(await page.locator('#tl-main .bar:has-text("Pan-sear")').count() === 1, 'pan-sear alternative not on the timeline');
    expect(await page.locator('#tl-main .ghost').count() > 0, 'no previous-position outlines');
    await shot(page, '04-workspace-plan-b-1440x900');
  });

  await check('task inspector shows read-only facts and the reasons for the change', async () => {
    await page.click('#tl-main .bar[data-task="roast"]');
    const ins = await page.locator('.inspector').textContent();
    expect(/Pan-sear chicken thighs/.test(ins) && /Leila/.test(ins) && /Equipment down/i.test(ins), `inspector content: ${ins.slice(0, 120)}`);
    await shot(page, '05-task-inspector-1440x900');
    await page.click('.inspector [data-action="select-task"]');
  });

  await check('Before / After: synchronized Plan A and Plan B with a change map of real reasons', async () => {
    await nav(page, 'compare');
    expect(await page.locator('#tl-before').count() === 1 && await page.locator('#tl-after').count() === 1, 'dual timelines missing');
    const reasons = await page.locator('.change-map .reason').allTextContents();
    expect(reasons.some((r) => /equipment down/i.test(r)) && reasons.some((r) => /alternative used/i.test(r)), `reasons: ${reasons.join(',')}`);
    expect(await page.locator('#tl-before .will-change').count() > 0, 'Plan A does not mark tasks that change');
    const sc = await pageScroll(page);
    expect(sc.y <= 0, `compare scrolls (${sc.y})`);
    await shot(page, '06-before-after-1440x900');
  });

  await check('repair workflow shows the six recorded pipeline stages', async () => {
    await nav(page, 'repair');
    expect(await page.locator('.stage-ok').count() === 6, `expected 6 completed stages, got ${await page.locator('.stage-ok').count()}`);
    await shot(page, '07-repair-workflow-1440x900');
  });

  await check('assistant: agent steps, contextual actions, then a second change confirmed in chat', async () => {
    await nav(page, 'assistant');
    const steps = await page.locator('.trace-wrap[open] .tr-step').allTextContents();
    for (const want of ['Intent detected', 'Constraints changed', 'Scheduling performed', 'Validation passed', 'Differences explained', 'Plan committed']) {
      expect(steps.includes(want), `agent step "${want}" missing (got: ${steps.join(', ')})`);
    }
    expect(await page.locator('.msg-actions [data-view="compare"]').count() > 0, 'contextual actions missing');
    await page.click('.chip[data-text^="Advance"]');
    await page.waitForFunction(() => document.querySelector('.clock strong')?.textContent === '4:40 PM');
    await page.click('.chip[data-text^="Sam"]');
    await page.waitForSelector('#confirm-card');
    await page.waitForTimeout(500);
    await shot(page, '08-assistant-review-1440x900');
    await page.click('[data-action="confirm-change"]');
    await waitRevs(page, 3);
    await settle(page);
    await nav(page, 'compare');
    const reasons = await page.locator('.change-map .reason').allTextContents();
    expect(reasons.some((r) => /person unavailable/i.test(r)), 'no PERSON_UNAVAILABLE reason');
  });

  await check('refresh restores plan, revisions, clock and screen', async () => {
    await page.reload();
    await ready(page);
    expect(await revs(page) === 3, 'revisions lost on reload');
    expect((await page.locator('.clock strong').textContent()) === '4:40 PM', 'clock lost on reload');
    expect((await page.evaluate(() => document.getElementById('app').dataset.view)) === 'compare', 'screen not restored');
  });

  await check('impossible budget: review shows no feasible plan; nothing committed; verified options apply', async () => {
    await nav(page, 'assistant');
    await page.click('.chip[data-text^="Our budget"]');
    await page.waitForSelector('#confirm-card .cc-impact.bad');
    await page.click('[data-action="confirm-change"]');
    await page.waitForSelector('#infeasible');
    expect(await page.locator('#infeasible .violations li').count() >= 1, 'no violations listed');
    expect(await page.locator('#infeasible .option').count() >= 2, 'fewer than two options');
    expect(await revs(page) === 3, 'infeasible request was committed');
    await settle(page);
    await shot(page, '09-impossible-plan-1440x900');
    await page.locator('[data-action="apply-option"]').nth(1).click();
    await waitRevs(page, 4);
  });

  await check('undo goes back one revision; restore returns to the original (History screen)', async () => {
    await page.click('.topbar [data-action="undo"]');
    await waitRevs(page, 3);
    await nav(page, 'history');
    await shot(page, '10-history-1440x900');
    await page.click('.ph-actions [data-action="restore"]');
    await waitRevs(page, 1);
  });

  await check('structured change in the dialog goes through review and the same engine path', async () => {
    await page.click('[data-action="open-disruption"]');
    await page.selectOption('.modal [data-field="m-type"]', 'person_unavailable');
    await page.selectOption('.modal [data-field="m-person"]', 'leila');
    await page.click('.modal form[data-form="manual"] button[type="submit"]');
    await page.waitForSelector('.modal .confirm-card');
    await page.click('[data-action="confirm-change"]');
    await waitRevs(page, 2);
    await nav(page, 'repair');
    const log = await page.locator('.act-list').textContent();
    expect(log.includes('Structured form') && log.includes('validate_plan'), 'tool log missing steps');
  });

  await check('unsupported phrasing fails visibly without changing the plan', async () => {
    await say(page, 'Please repaint the fence purple');
    expect(await revs(page) === 2, 'plan changed on unknown input');
    expect(await page.locator('.msg.tone-failure').count() > 0, 'no failure message');
  });

  await check('free-form: oven breaks, then is fixed (original version restored); leave-at time understood', async () => {
    await say(page, 'The oven broke.');
    await waitRevs(page, 3);
    await say(page, 'Good news, the oven is fixed');
    await waitRevs(page, 4);
    await nav(page, 'compare');
    const reasons = await page.locator('.change-map .reason').allTextContents();
    expect(reasons.some((r) => /original version/i.test(r)) && reasons.some((r) => /equipment back/i.test(r)), `reasons: ${reasons.join(',')}`);
    await say(page, 'Alex has to leave at 5 PM', { confirm: false });
    const card = await page.locator('#confirm-card').textContent();
    expect(/Alex unavailable from 5:00 PM/.test(card), `review: ${card.slice(0, 160)}`);
    await page.click('[data-action="cancel-change"]');
    expect(await revs(page) === 4, 'cancel must not commit');
  });

  await check('keyboard: D opens the dialog, Escape closes it and dismisses the crisis panel', async () => {
    await page.click('.page-head h1');
    await page.keyboard.press('d');
    await page.waitForSelector('.modal');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { state: 'detached' });
    await say(page, 'Guests arrive 2 hours earlier');
    await page.waitForSelector('#infeasible');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#infeasible', { state: 'detached' });
  });

  await check('settings & transparency shows parser status, engine facts and preferences', async () => {
    await nav(page, 'settings');
    const text = await page.locator('.view-settings').textContent();
    expect(/limited local rule parser/.test(text) && /baseline checks passed/.test(text) && /8,000 schedule attempts/.test(text), 'settings facts missing');
    expect(await page.locator('#pref-confirm').isChecked(), 'review preference should default to on');
    const spill = await spills(page);
    expect(spill.length === 0, `elements outside their card: ${spill.join(' | ')}`);
    await shot(page, '11-settings-1440x900');
  });

  const big = await newPage(1920, 1080);
  await check('1920×1080: every screen fits without page scrolling', async () => {
    await big.goto(base);
    await ready(big);
    for (const view of ['workspace', 'assistant', 'repair', 'compare', 'history', 'settings', 'home']) {
      await nav(big, view);
      await big.waitForTimeout(300);
      const sc = await pageScroll(big);
      expect(sc.x <= 0 && sc.y <= 0, `${view} scrolls at 1920×1080 (${sc.x}, ${sc.y})`);
      const spill = await spills(big);
      expect(spill.length === 0, `${view}: elements outside their card: ${spill.join(' | ')}`);
      await shot(big, `20-${view}-1920x1080`);
    }
  });

  await check('1500×900 (three-column settings): nothing sticks out of its card on any screen', async () => {
    await big.setViewportSize({ width: 1500, height: 900 });
    for (const view of ['settings', 'workspace', 'assistant', 'repair', 'compare', 'history', 'home']) {
      await nav(big, view);
      const spill = await spills(big);
      expect(spill.length === 0, `${view}: elements outside their card: ${spill.join(' | ')}`);
    }
    await nav(big, 'settings');
    await shot(big, '21-settings-1500x900');
  });

  await check('1230×908 home: live preview fits its card (no inner scrollbars, no overlapping times, no rows cut), hero not clipped', async () => {
    await big.setViewportSize({ width: 1230, height: 908 });
    await nav(big, 'home');
    await big.waitForTimeout(500); // resize re-render is debounced
    const r = await big.evaluate(() => {
      const body = document.querySelector('.preview-body');
      const card = document.querySelector('.preview').getBoundingClientRect();
      const tl = document.querySelector('#tl-preview').getBoundingClientRect();
      const ax = [...document.querySelectorAll('#tl-preview .tl-axis span')].map((e) => e.getBoundingClientRect());
      const hero = document.querySelector('.hero').getBoundingClientRect();
      const btn = document.querySelector('.hero-actions .btn').getBoundingClientRect();
      return {
        scroll: [body.scrollWidth - body.clientWidth, body.scrollHeight - body.clientHeight],
        inside: tl.right <= card.right + 0.5 && tl.bottom <= card.bottom + 0.5,
        overlap: ax.some((a, i) => i > 0 && a.left < ax[i - 1].right),
        heroGap: hero.bottom - btn.bottom,
        // bars or equipment uses cut off by the bottom edge of the chart
        cut: [...document.querySelectorAll('#tl-preview .tl-body')].flatMap((b) => {
          const edge = b.getBoundingClientRect().bottom - parseFloat(getComputedStyle(b).borderBottomWidth);
          return [...b.querySelectorAll('.bar, .res-use')].filter((e) => e.getBoundingClientRect().bottom > edge + 0.5).map((e) => e.title.slice(0, 40));
        }),
      };
    });
    expect(r.cut.length === 0, `preview rows cut at the bottom: ${r.cut.join(' | ')}`);
    expect(r.scroll[0] <= 1 && r.scroll[1] <= 1, `preview scrolls inside its card (${r.scroll})`);
    expect(r.inside, 'preview timeline extends past its card');
    expect(!r.overlap, 'preview time labels overlap');
    expect(r.heroGap >= 12, `hero button clipped (gap ${r.heroGap}px)`);
    expect((await spills(big)).length === 0, 'element outside its card on home');
    await shot(big, '22-home-1230x908');
  });

  const small = await newPage(1280, 720);
  await check('1280×720: restored session fits, compact disclosures visible', async () => {
    await small.goto(base);
    await ready(small);
    await nav(small, 'workspace');
    const sc = await pageScroll(small);
    expect(sc.x <= 0 && sc.y <= 0, `page scrolls at 1280×720 (${sc.x}, ${sc.y})`);
    expect(await small.getByText('Simulated Alexa+ demo').isVisible(), 'compact simulation disclosure not visible');
    expect(await small.getByText('Local rules · not an LLM').isVisible(), 'compact parser disclosure not visible');
    await shot(small, '12-workspace-1280x720');
  });

  await check('1024×768 tablet: stacked layout without horizontal page overflow', async () => {
    await small.setViewportSize({ width: 1024, height: 768 });
    await small.waitForTimeout(300);
    const sc = await pageScroll(small);
    expect(sc.x <= 0, `horizontal overflow ${sc.x}px`);
    await shot(small, '13-workspace-1024x768');
    await small.setViewportSize({ width: 1280, height: 720 });
  });

  await check('other scenarios build feasible baselines; outing replans a partner leaving', async () => {
    for (const id of ['childrens-birthday', 'weekend-outing']) {
      await nav(small, 'settings');
      await small.click('[data-action="new-session"]');
      await small.click(`.tile[data-id="${id}"]`);
      if (id === 'weekend-outing') {
        // Build from the empty state of a plan-based screen.
        await nav(small, 'workspace');
        await small.click('[data-action="build-from"]');
      } else {
        await small.click('button[form="setup-form"]');
      }
      await small.waitForSelector('.workspace');
      expect(await small.locator('.kpi-ok').count() === 1, `${id} not validated`);
    }
    await say(small, 'Parent B got called into work and is unavailable.');
    await waitRevs(small, 2);
    await shot(small, '14-outing-replan-1280x720');
  });

  await check('API outage does not blank the app (falls back to the local parser)', async () => {
    const offline = await newPage(1280, 720, { expectNetworkErrors: true });
    await offline.route('**/api/**', (route) => route.abort());
    await offline.goto(base);
    await ready(offline);
    await offline.waitForSelector('.workspace');
    expect(await offline.getByText('not an LLM').count() > 0, 'parser disclosure missing offline');
    await say(offline, 'Will we arrive on time?');
    expect(await offline.locator('.msg-assistant').count() >= 2, 'no reply while offline');
  });

  await check('phone 390×844 and tablet 768×1024: home has no horizontal scroll', async () => {
    const fresh = await browser.newContext();
    const p = await fresh.newPage();
    p.on('pageerror', (e) => consoleErrors.push(`mobile: ${e.message}`));
    for (const [w, h] of [[390, 844], [768, 1024]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(base);
      await ready(p);
      await p.waitForSelector('.tile');
      const sc = await pageScroll(p);
      expect(sc.x <= 0, `home overflow ${sc.x}px at ${w}px`);
      await shot(p, `15-home-${w}x${h}`);
    }
    await fresh.close();
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
