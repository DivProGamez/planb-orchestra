// Assistant conversation QA: bounded scrolling history, stable composer, one "Agent steps" panel at a
// time, reading position kept when an older panel opens, follow-newest only after sending, and
// keyboard toggling. Runs at 1280×720, 1440×900, 1920×1080; screenshots in evidence/assistant/.
// Usage: npm run test:chat
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(here, '../../evidence/assistant');
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

/** Geometry of the chat: scroll state, open panels, and whether the composer is clear of the history. */
const geometry = (p) => p.evaluate(() => {
  const conv = document.querySelector('.conversation');
  const foot = document.querySelector('.as-foot').getBoundingClientRect();
  const c = conv.getBoundingClientRect();
  const cmd = document.getElementById('cmd').getBoundingClientRect();
  const send = document.querySelector('.composer button[type="submit"]').getBoundingClientRect();
  return {
    top: conv.scrollTop, max: conv.scrollHeight - conv.clientHeight, scrollable: conv.scrollHeight > conv.clientHeight + 4,
    open: [...document.querySelectorAll('details.trace-wrap')].map((d, i) => (d.open ? i : -1)).filter((i) => i >= 0),
    panels: document.querySelectorAll('details.trace-wrap').length,
    clear: c.bottom <= foot.top + 1,
    composer: cmd.bottom <= innerHeight && send.bottom <= innerHeight && cmd.height > 20,
    messages: conv.children.length,
  };
});

async function say(p, text) {
  await p.fill('#cmd', text);
  await p.press('#cmd', 'Enter');
  await p.waitForFunction(() => document.querySelector('.confirm-card') || !document.querySelector('#cmd')?.disabled, null, { timeout: 8000 });
  if (await p.locator('.confirm-card [data-action="confirm-change"]').count()) {
    await p.click('.confirm-card [data-action="confirm-change"]');
    await p.waitForFunction(() => document.getElementById('app').dataset.view === 'workspace', null, { timeout: 8000 });
    await p.click('.nav-item[data-view="assistant"]');
  }
  await p.waitForTimeout(250);
}

for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${w}: ${m.text()}`); });
  await p.goto(base);
  await p.waitForSelector('#splash', { state: 'detached' });
  await p.click('button[form="setup-form"]');
  await p.waitForSelector('.workspace');
  await p.click('.nav-item[data-view="assistant"]');
  for (const t of ['Guests are arriving an hour early and the oven broke.', 'Sam cannot help anymore.', 'Leila is running 10 minutes late', 'Can we still serve the meal on time?', 'Cooking the rice will take 10 more minutes']) await say(p, t);

  await check(`${w}×${h}: history scrolls inside its region, composer stays visible and clear of it, newest message in view`, async () => {
    const g = await geometry(p);
    expect(g.scrollable, 'conversation does not scroll (history not bounded)');
    expect(g.clear, 'conversation renders under the composer');
    expect(g.composer, 'composer not fully visible');
    expect(g.max - g.top < 8, 'not following the newest message after sending');
    expect(g.open.length === 1 && g.open[0] === g.panels - 1, `newest panel should be the one open (open: ${g.open})`);
  });

  await check(`${w}×${h}: opening the first panel keeps the reading position, closes the others, and lower messages stay reachable`, async () => {
    await p.evaluate(() => { document.querySelector('.conversation').scrollTop = 0; });
    await p.waitForTimeout(100);
    await p.click('details.trace-wrap >> nth=0 >> summary');
    await p.waitForTimeout(250);
    let g = await geometry(p);
    expect(g.open.length === 1 && g.open[0] === 0, `accordion: open panels ${g.open}`);
    expect(g.top < 400, `jumped away from the reading position (scrollTop ${g.top})`);
    const visible = await p.evaluate(() => { const d = document.querySelector('details.trace-wrap').getBoundingClientRect(); const c = document.querySelector('.conversation').getBoundingClientRect(); return d.top >= c.top - 1 && Math.min(d.bottom, c.bottom) - d.top > 60; });
    expect(visible, 'opened steps not visible');
    await p.screenshot({ path: path.join(shots, `${w}x${h}-first-panel-open.png`) });
    await p.evaluate(() => { const c = document.querySelector('.conversation'); c.scrollTop = c.scrollHeight; });
    await p.waitForTimeout(100);
    const last = await p.evaluate(() => { const c = document.querySelector('.conversation'); const m = c.lastElementChild.getBoundingClientRect(); const r = c.getBoundingClientRect(); return m.bottom <= r.bottom + 1 && m.top >= r.top - 1; });
    expect(last, 'last message unreachable after expanding an older panel');
    await p.click('details.trace-wrap >> nth=1 >> summary');
    await p.waitForTimeout(200);
    g = await geometry(p);
    expect(g.open.length === 1 && g.open[0] === 1, `second panel: open panels ${g.open}`);
    await p.click('details.trace-wrap >> nth=1 >> summary');
    await p.waitForTimeout(200);
    expect((await geometry(p)).open.length === 0, 'collapse did not close the panel');
    await p.setViewportSize({ width: w, height: h - 1 }); // forces a full re-render
    await p.waitForTimeout(400);
    expect((await geometry(p)).open.length === 0, 'collapsed state lost on re-render');
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(400);
    await p.click('details.trace-wrap >> nth=2 >> summary');
    await p.waitForTimeout(200);
    expect((await geometry(p)).open.join() === '2', 'reopen failed');
  });

  await check(`${w}×${h}: keyboard only — reach a panel summary with arrows, Enter toggles it, composer reachable`, async () => {
    await p.locator('details.trace-wrap >> nth=0 >> summary').focus();
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowUp');
    const onSummary = await p.evaluate(() => document.activeElement?.tagName === 'SUMMARY');
    expect(onSummary, 'arrows did not land on an Agent steps summary');
    const before = (await geometry(p)).open.join();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(250);
    expect((await geometry(p)).open.join() !== before, 'Enter did not toggle the panel');
    const focusedInView = await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const c = document.querySelector('.conversation').getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; });
    expect(focusedInView, 'focused summary not scrolled into view');
    await p.screenshot({ path: path.join(shots, `${w}x${h}-keyboard-panel.png`) });
    await p.evaluate(() => { const c = document.querySelector('.conversation'); c.scrollTop = c.scrollHeight; });
    await say(p, 'Can we still serve the meal on time?');
    const g = await geometry(p);
    expect(g.max - g.top < 8, 'did not follow the newest message after sending');
    await p.screenshot({ path: path.join(shots, `${w}x${h}-after-send.png`) });
  });
  await ctx.close();
}
/* ---------- TV-remote flow: only Up / Down / Left / Right / OK (Enter) / Back (Escape) ---------- */
const inConv = (p) => p.evaluate(() => Boolean(document.activeElement?.closest('.conversation')));
const act = (p) => p.evaluate(() => {
  const el = document.activeElement;
  return { msg: el.closest('.conversation > li')?.dataset.msg ?? null, summary: el.tagName === 'SUMMARY' ? [...document.querySelectorAll('details.trace-wrap > summary')].indexOf(el) : -1, chip: el.classList.contains('chip') };
});
async function pressUntil(p, key, pred, max = 160) {
  for (let i = 0; i < max; i += 1) { if (await pred()) return true; await p.keyboard.press(key); await p.waitForTimeout(45); }
  return pred();
}
/** Shortest arrow path by the app's own targeting (pickCandidate); re-planned after every key, so scroll steps are fine. */
async function remoteTo(p, selector, max = 160) {
  for (let i = 0; i < max; i += 1) {
    const info = await p.evaluate(async (sel) => {
      const { pickCandidate, directionalTarget } = await import('/nav.js');
      const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-nav]';
      const list = [...document.getElementById('app').querySelectorAll(FOCUSABLE)].filter((el) => {
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
      const q = [start];
      while (q.length) {
        const k = q.shift();
        for (const d of ['up', 'down', 'left', 'right']) {
          if (list[k].type === 'range' && (d === 'left' || d === 'right')) continue; // sliders keep Left/Right
          const tEl = directionalTarget(list[k], list, d);
          if (!tEl) continue;
          const nn = list.indexOf(tEl);
          if (first.has(nn)) continue;
          first.set(nn, first.get(k) || d);
          if (nn === target) return { key: KEYS[first.get(nn)] };
          q.push(nn);
        }
      }
      const dbg = ["up", "down", "left", "right"].map((d) => { const t = directionalTarget(list[start], list, d); return d + ":" + (t ? t.className + "|" + t.textContent.trim().slice(0, 16) : "-"); }).join(" ");
      return { unreachable: true, dbg, n: list.length, seen: first.size };
    }, selector);
    if (info.missing) throw new Error(`no ${selector}`);
    if (info.unreachable) throw new Error(`${selector} unreachable (${info.dbg} list=${info.n} seen=${info.seen}) from ${await p.evaluate(() => { const e = document.activeElement; return e.tagName + "." + e.className + " " + e.textContent.trim().slice(0, 30) + " disabled=" + e.disabled; })}`);
    if (info.done) return;
    await p.keyboard.press(info.key);
    await p.waitForTimeout(40);
  }
  throw new Error(`could not reach ${selector}`);
}
const convTop = (p) => p.evaluate(() => document.querySelector('.conversation').scrollTop);

for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [768, 1024]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`remote ${w}: ${e.message}`));
  await p.goto(base);
  await p.waitForSelector('#splash', { state: 'detached' });
  await p.click('button[form="setup-form"]');
  await p.waitForSelector('.workspace');
  await p.click('.nav-item[data-view="assistant"]');
  for (const t of ['Guests are arriving an hour early and the oven broke.', 'Sam cannot help anymore.', 'Leila is running 10 minutes late', 'Cooking the rice will take 10 more minutes']) await say(p, t);
  // from here on: keyboard only (remote keys)
  await check(`${w}×${h} remote: enter history, oldest ↔ newest, read and toggle agent steps, Back, quick action, scroll buttons, Plan status`, async () => {
    await p.locator('#cmd').focus();
    await p.keyboard.press('Escape'); // leave the text field the way a remote user would
    await remoteTo(p, '.as-foot .chip');
    // 1. enter the history from the quick actions
    expect(await pressUntil(p, 'ArrowUp', () => inConv(p), 6), 'Up from the quick actions did not enter the history');
    // 2. oldest message
    expect(await pressUntil(p, 'ArrowUp', async () => (await act(p)).msg === 'intro'), 'could not reach the oldest message');
    expect(await convTop(p) <= 2, 'history not at the top at the oldest message');
    // 3. newest message
    const lastIdx = await p.evaluate(() => document.querySelector('.conversation > li:last-child').dataset.msg);
    expect(await pressUntil(p, 'ArrowDown', async () => (await act(p)).msg === lastIdx), 'could not reach the newest message');
    // 4. first agent steps: its summary, opened with OK
    expect(await pressUntil(p, 'ArrowUp', async () => (await act(p)).summary === 0), 'could not reach the first Agent steps');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    expect((await geometry(p)).open.join() === '0', 'OK did not open the first Agent steps');
    // 5. read all of it with Down
    const readAll = await pressUntil(p, 'ArrowDown', () => p.evaluate(() => { const d = document.querySelector('details.trace-wrap').getBoundingClientRect(); const c = document.querySelector('.conversation').getBoundingClientRect(); return d.bottom <= c.bottom + 1; }), 30);
    expect(readAll, 'could not scroll to the end of the expanded steps');
    // 6. collapse with OK
    expect(await pressUntil(p, 'ArrowUp', async () => (await act(p)).summary === 0, 40), 'could not return to the summary');
    const pre = JSON.stringify((await geometry(p)).open);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    { const g2 = await geometry(p); expect(g2.open.length === 0, `OK did not collapse (before ${pre}, open ${g2.open}, focus ${JSON.stringify(await act(p))})`); }
    // 7–8. another message; open its steps
    expect(await pressUntil(p, 'ArrowDown', async () => (await act(p)).summary === 1, 40), 'could not reach the second Agent steps');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    expect((await geometry(p)).open.join() === '1', 'second Agent steps did not open');
    await p.screenshot({ path: path.join(shots, `${w}x${h}-remote-steps.png`) });
    // 9. Back leaves the history
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    expect((await act(p)).chip, 'Back did not return to the quick actions');
    // 10–11. a quick action
    const before = (await geometry(p)).messages;
    await remoteTo(p, '.as-foot .chip[data-text^="Advance the clock"]');
    await p.keyboard.press('Enter');
    await p.waitForFunction((b) => document.querySelector('.conversation').children.length > b, before, { timeout: 8000 });
    // 12. back into the history
    await remoteTo(p, '.as-foot .chip');
    expect(await pressUntil(p, 'ArrowUp', () => inConv(p), 6), 'could not return to the history');
    // 13. scroll buttons
    await remoteTo(p, '[data-action="chat-scroll"][data-dir="up"]');
    let t0 = await convTop(p);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    expect(await convTop(p) < t0 || t0 <= 1, 'Scroll up did nothing');
    await remoteTo(p, '[data-action="chat-scroll"][data-dir="down"]');
    t0 = await convTop(p);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    expect(await convTop(p) > t0, 'Scroll down did nothing');
    await remoteTo(p, '[data-action="chat-scroll"][data-dir="latest"]');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
    const g = await geometry(p);
    expect(g.max - g.top < 4, 'Jump to latest did not reach the newest message');
    expect(await p.evaluate(() => document.querySelector('[data-dir="down"]').getAttribute('aria-disabled')) === 'true', 'Scroll down not disabled at the end');
    // 14. right-hand Plan status panel
    await remoteTo(p, '[data-nav="panel"][aria-labelledby="ps-title"]');
    await p.screenshot({ path: path.join(shots, `${w}x${h}-remote-plan-status.png`) });
    // 15. every message can be brought fully into view above the composer
    const hidden = await p.evaluate(() => {
      // scroll only the history (not the page) so each message's top and bottom come into view
      const c = document.querySelector('.conversation'); const out = [];
      for (const li of c.children) {
        let r = c.getBoundingClientRect(); c.scrollTop += li.getBoundingClientRect().top - r.top - 4;
        r = c.getBoundingClientRect(); const top = li.getBoundingClientRect().top;
        c.scrollTop += li.getBoundingClientRect().bottom - r.bottom + 4;
        r = c.getBoundingClientRect(); const bottom = li.getBoundingClientRect().bottom;
        const foot = document.querySelector('.as-foot').getBoundingClientRect();
        if (top < r.top - 1 || bottom > r.bottom + 1 || r.bottom > foot.top + 1) out.push(`${li.dataset.msg} [${Math.round(top)}–${Math.round(bottom)} in ${Math.round(r.top)}–${Math.round(r.bottom)}]`);
      }
      return out;
    });
    expect(hidden.length === 0, `messages not reachable: ${hidden.join(',')}`);
  });
  await ctx.close();
}

await check('no console errors', async () => expect(errors.length === 0, errors.slice(0, 4).join(' | ')));
await browser.close();
server.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\nChat QA: ${results.length - failed} passed, ${failed} failed. Screenshots in evidence/assistant/`);
process.exit(failed ? 1 : 0);
