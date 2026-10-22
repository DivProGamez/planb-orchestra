// Verifies the production build actually runs: serves dist/ with the real server, fetches every file
// in the manifest (HTTP 200), then boots the app in Chrome with all external network requests
// blocked and checks it reaches a validated plan with no console errors.
// Usage: npm run build && npm run verify:dist
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'dist', 'build-manifest.json');
if (!existsSync(manifestPath)) { console.error('No dist/ build. Run: npm run build'); process.exit(2); }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => existsSync(p));

const server = createApp({ env: {}, staticDir: 'dist' }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const problems = [];

for (const f of manifest.files) {
  const res = await fetch(`${base}/${f.path}`);
  if (res.status !== 200) problems.push(`GET /${f.path} → ${res.status}`);
}
const index = await fetch(`${base}/`);
if (index.status !== 200) problems.push(`GET / → ${index.status}`);

let booted = 'browser check skipped (no Chrome/Edge found)';
if (executablePath) {
  const browser = await chromium.launch({ executablePath });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const external = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    external.push(url);
    return route.abort(); // offline: anything outside the local server is blocked
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base);
  await p.waitForSelector('#splash', { state: 'detached', timeout: 10000 });
  await p.click('button[form="setup-form"]');
  await p.waitForSelector('.workspace');
  const checks = await p.evaluate(() => document.querySelector('.kpis')?.innerText.match(/(\d+) independent checks/)?.[1]);
  if (!checks) problems.push('built app did not reach a validated plan');
  if (external.length) problems.push(`external requests attempted: ${external.join(', ')}`);
  if (errors.length) problems.push(`console errors: ${errors.join(' | ')}`);
  booted = `booted offline from dist/ and built a validated plan (${checks} checks)`;
  await browser.close();
}
server.close();
console.log(`Dist: ${manifest.files.length} files served (HTTP 200); ${booted}.`);
if (problems.length) { for (const pr of problems) console.log(`  - ${pr}`); process.exit(1); }
console.log('Production build verified.');
