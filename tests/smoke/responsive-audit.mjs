// Responsive audit: every screen (plus the disruption dialog) with a real plan and a real change, at
// 480×800, 768×1024, 1280×720, 1440×900 and 1920×1080. Fails on page-level horizontal overflow,
// text cut off outside the timeline, elements past the viewport edge, controls smaller than 24 px,
// and cards overlapping each other. Screenshots go to evidence/responsive/.
// Usage: npm run audit:responsive
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../evidence/responsive');
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

const VIEWPORTS = [[430, 932], [480, 800], [768, 1024], [900, 1440], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1600, 900], [1920, 1080]];
const SCREENS = ['home', 'workspace', 'assistant', 'repair', 'compare', 'history', 'settings'];

const server = createApp({ env: {} }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath });
const problems = [];

/** Layout checks on the visible screen (timeline task bars are exempt from the text check: they have tooltips + inspector). */
const inspect = () => {
  const issues = [];
  const de = document.documentElement;
  if (de.scrollWidth > innerWidth + 1) issues.push(`page scrolls horizontally by ${de.scrollWidth - innerWidth}px`);
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 32)}"`;
  for (const el of document.querySelectorAll('#app *')) {
    if (!visible(el) || el.closest('.tl, .skip, .sr-only, .map-track, [aria-hidden="true"], select, option')) continue;
    const cs = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText && el.scrollWidth > el.clientWidth + 1 && (cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden')) issues.push(`text cut off: ${label(el)}`);
    const r = el.getBoundingClientRect();
    if (ownText && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('.scroll, .conversation, .canvas-body, .dual, .preview-body, .tasks-wrap, .sidebar .nav')) issues.push(`past the viewport edge: ${label(el)}`);
  }
  for (const el of document.querySelectorAll('#app button, #app input:not([type="hidden"]), #app select, #app textarea')) {
    if (!visible(el) || el.closest('.tl, .sr-only') || el.classList.contains('switch')) continue;
    if (el.type === 'checkbox' && el.closest('label')) continue; // the whole label is the target
    if (el.closest('.topcmd')) continue; // the 38 px field box is the target
    const r = el.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) issues.push(`control too small (${Math.round(r.width)}×${Math.round(r.height)}): ${label(el)}`);
  }
  // desktop Home: the timeline preview fits its box (no nested scrollbar)
  const pb = document.querySelector('.view-home .preview-body');
  if (pb && innerWidth >= 1101 && innerHeight >= 700 && !pb.querySelector('.table-wrap') && pb.scrollHeight > pb.clientHeight + 2) issues.push(`timeline preview scrolls inside its box (${pb.scrollHeight} > ${pb.clientHeight})`);
  // timeline: every task bar shows some label (title, one word or a two-letter initial)
  for (const bar of document.querySelectorAll('.tl .bar')) {
    if (!visible(bar)) continue;
    const shown = [...bar.querySelectorAll('.bar-title, .bar-short, .bar-initial')].some((el) => { const rr = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && rr.width > 4 && el.textContent.trim(); });
    if (!shown && bar.getBoundingClientRect().width >= 14) issues.push(`blank task bar (${Math.round(bar.getBoundingClientRect().width)}px): ${bar.getAttribute('aria-label').split(',')[0]}`);
  }
  // containment: every text and control inside a card-like box is fully inside it (scrollable regions excepted)
  const BOXES = '.card, .kpi, .tile, .stage, .ledger-row, .map-row, .rev-card, .hs, .oc-row, .ins-cell, .modal, .msg-bubble, .confirm-card';
  for (const boxEl of document.querySelectorAll(BOXES)) {
    if (!visible(boxEl) || boxEl.closest('.tl')) continue;
    const b = boxEl.getBoundingClientRect();
    for (const el of boxEl.querySelectorAll('*')) {
      if (!visible(el) || el.closest('.tl, .sr-only, [aria-hidden="true"]')) continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!ownText && !el.matches('button, input, select, textarea')) continue;
      let scroller = el.parentElement;
      let scrolled = false;
      while (scroller && scroller !== boxEl) { const o = getComputedStyle(scroller).overflowY; if (o === 'auto' || o === 'scroll') { scrolled = true; break; } scroller = scroller.parentElement; }
      if (scrolled) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > b.bottom + 1 || r.top < b.top - 1 || r.right > b.right + 1 || r.left < b.left - 1) issues.push(`outside its card (${String(boxEl.className).split(' ')[0]}): ${label(el)}`);
    }
  }
  const cards = [...document.querySelectorAll('#app .card, #app .kpi, #app .tile')].filter(visible).map((el) => [el, el.getBoundingClientRect()]);
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const [a, ra] = cards[i]; const [b, rb] = cards[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) issues.push(`cards overlap: ${label(a)} / ${label(b)}`);
    }
  }
  return [...new Set(issues)];
};

for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`${w}×${h} pageerror: ${e.message}`));
  await p.goto(base);
  await p.waitForSelector('#splash', { state: 'detached', timeout: 8000 });
  const tag = `${w}x${h}`;
  // home before any plan: the preview state
  await p.waitForTimeout(300);
  for (const i of await p.evaluate(inspect)) problems.push(`${tag} home (preview): ${i}`);
  await p.screenshot({ path: path.join(out, `${tag}-home-preview.png`), fullPage: w < 1101 });
  await p.click('button[form="setup-form"]');
  await p.waitForSelector('.workspace');
  await p.click('.topbar [data-action="open-disruption"]');
  await p.fill('#dis-text', 'Guests are arriving an hour early and the oven broke.');
  await p.click('form[data-form="disruption"] button[type="submit"]');
  await p.waitForSelector('.modal [data-action="confirm-change"]');
  await p.waitForTimeout(200);
  for (const i of await p.evaluate(inspect)) problems.push(`${tag} dialog: ${i}`);
  const fits = await p.evaluate(() => { const m = document.querySelector('.modal').getBoundingClientRect(); const b = document.querySelector('.modal [data-action="confirm-change"]').getBoundingClientRect(); return m.left >= 0 && m.right <= innerWidth && b.bottom <= innerHeight; });
  if (!fits) problems.push(`${tag} dialog: dialog or its confirm button is outside the viewport`);
  await p.screenshot({ path: path.join(out, `${tag}-dialog-review.png`) });
  await p.click('.modal [data-action="confirm-change"]');
  await p.waitForFunction(() => Number(document.getElementById('app').dataset.revisions) === 2);
  for (const v of SCREENS) {
    await p.click(`.nav-item[data-view="${v}"]`);
    await p.waitForFunction((x) => document.getElementById('app').dataset.view === x, v);
    await p.waitForTimeout(300);
    for (const i of await p.evaluate(inspect)) problems.push(`${tag} ${v}: ${i}`);
    if (v === 'workspace') {
      // keyboard focus walking right along a (possibly scrolling) timeline stays visible beside the pinned labels
      // focus the rightmost task through the navigator (Left then Right lands on it and scrolls it into view)
      const id = await p.evaluate(() => { const bars = [...document.querySelectorAll('#tl-main .bar')]; bars.sort((x, y) => y.getBoundingClientRect().right - x.getBoundingClientRect().right); return bars[0].dataset.task; });
      await p.locator(`#tl-main .bar[data-task="${id}"]`).focus();
      await p.keyboard.press('ArrowLeft');
      await p.waitForTimeout(80);
      await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(400);
      const vis = await p.evaluate(() => {
        const el = document.activeElement; const body = document.querySelector('.canvas-body'); if (!el?.classList.contains('bar') || !body) return 'focus left the timeline';
        const r = el.getBoundingClientRect(); const c = body.getBoundingClientRect(); const lab = document.querySelector('#tl-main .tl-labels').getBoundingClientRect();
        const scrolls = body.scrollWidth > body.clientWidth + 1;
        if (r.left < lab.right - 1 && scrolls) return `focused bar hidden under the pinned labels`;
        if (r.right > c.right + 1 || r.left < c.left - 1) return `focused bar outside the visible timeline`;
        return '';
      });
      if (vis) problems.push(`${tag} workspace: ${vis}`);
      const sc = await p.evaluate(() => { const b = document.querySelector('.canvas-body'); return b.scrollWidth > b.clientWidth + 1; });
      if (sc) await p.screenshot({ path: path.join(out, `${tag}-workspace-scrolled.png`) });
    }
    await p.screenshot({ path: path.join(out, `${tag}-${v}.png`), fullPage: w < 1101 });
  }
  await ctx.close();
}
writeFileSync(path.join(out, 'responsive-results.json'), JSON.stringify({ viewports: VIEWPORTS.map(([w, h]) => `${w}x${h}`), problems }, null, 2));
await browser.close();
server.close();
console.log(`Responsive audit: ${VIEWPORTS.length} viewports × ${SCREENS.length + 2} states, ${problems.length} problem(s). Screenshots in evidence/responsive/`);
for (const pr of problems.slice(0, 80)) console.log(`  - ${pr}`);
process.exit(problems.length ? 1 : 0);
