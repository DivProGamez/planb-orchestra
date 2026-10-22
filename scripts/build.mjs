// Production build: copies the client (plain ES modules, no bundler needed) into dist/ and verifies it.
//  - every local import / href / src / url() resolves to a file in dist/
//  - no runtime internet dependency: no http(s) URLs, CDNs or web fonts in any shipped file
//  - writes dist/build-manifest.json (files, sizes, SHA-256)
// Usage: npm run build   (then: npm run start:dist, npm run verify:dist)
import { cpSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
}(dist));

const problems = [];
const refs = {
  '.js': [/\bimport\s[^'"]*?['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g, /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g],
  '.html': [/\b(?:src|href)="(?!#|https?:|data:|mailto:)([^"]+)"/g],
  '.css': [/url\(\s*['"]?(?!data:|#)([^'")]+)['"]?\s*\)/g],
};
for (const file of files) {
  const ext = path.extname(file);
  if (!refs[ext]) continue;
  const text = readFileSync(file, 'utf8');
  // runtime network dependencies are not allowed (the app must work offline)
  for (const m of text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
    const url = m[0];
    if (/xmlns(:\w+)?=['"]?$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue; // XML namespace identifiers are not downloads
    const line = text.slice(0, m.index).split('\n').length;
    const lineText = text.split('\n')[line - 1];
    // a URL inside a comment or plain explanatory text is not a dependency; a load is
    const isLoad = /\b(src|href)=|url\(|import\s|from\s|fetch\(|new\s+Worker\(|@import/.test(lineText) && !/^\s*(\/\/|\*|<!--)/.test(lineText);
    if (isLoad) problems.push(`${path.relative(root, file)}:${line} loads ${url} at runtime`);
  }
  for (const re of refs[ext]) {
    for (const m of text.matchAll(re)) {
      const target = path.resolve(path.dirname(file), m[1].split(/[?#]/)[0]);
      const rel = target.startsWith(dist) ? target : null;
      // absolute paths in index.html are served from dist root
      const resolved = m[1].startsWith('/') ? path.join(dist, m[1]) : rel;
      if (!resolved || !existsSync(resolved)) problems.push(`${path.relative(root, file)} references missing ${m[1]}`);
    }
  }
}

const manifest = {
  name: pkg.name,
  version: pkg.version,
  builtAt: new Date().toISOString(),
  files: files.map((f) => ({
    path: path.relative(dist, f).split(path.sep).join('/'),
    bytes: statSync(f).size,
    sha256: createHash('sha256').update(readFileSync(f)).digest('hex'),
  })),
};
manifest.totalBytes = manifest.files.reduce((n, f) => n + f.bytes, 0);
writeFileSync(path.join(dist, 'build-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Build: ${manifest.files.length} files, ${(manifest.totalBytes / 1024).toFixed(1)} KiB → dist/`);
if (problems.length) {
  for (const pr of problems) console.log(`  - ${pr}`);
  console.log(`Build verification FAILED: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('Build verification passed: all local references resolve; no runtime network dependencies.');
