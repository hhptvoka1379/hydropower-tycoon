// Build pipeline for the game/ workspace.
//   node build/bundle.mjs --check   source checks only (sim purity, no namespace/webgpu import of three)
//   node build/bundle.mjs           checks, then bundle game/main.js -> dist/hydropower-tycoon.html (minified)
//   node build/bundle.mjs --dev     same, unminified (readable output for debugging)
// three is imported by name from 'three' (node_modules); esbuild tree-shakes it into the one app IIFE. A classic
// script, no modules, works from file://. vendor/three.iife.js is NOT inlined any more (a second copy would break
// instanceof and shader caches).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(ROOT, ...a);
const DEV = process.argv.includes('--dev');
const rel = f => f.slice(ROOT.length + 1);

const WARN_BYTES = 1.2 * 1024 * 1024;
const FAIL_BYTES = 1.5 * 1024 * 1024;

// Sim purity (spec §11.1): no DOM, renderer, wall clock or unseeded randomness inside game/sim.
const FORBIDDEN = /\b(document|window|THREE|canvas|Date|performance)\b|Math\.random/;
// three must be imported by name; a namespace import or the WebGPU/TSL builds defeat tree-shaking and size.
const BAD_THREE = /import\s*\*\s*as\s+THREE\b|from\s*['"]three\/(webgpu|tsl)['"]|import\s*\(\s*['"]three|export\s*\*\s*from\s*['"]three['"]/;
const SKIP_DIRS = new Set(['legacy', 'reference', 'notes', 'node_modules']);

function walk(d, skip = new Set()) {
  return readdirSync(d).flatMap(f => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return skip.has(f) ? [] : walk(p, skip);
    return [p];
  });
}

function checkSim() {
  const dir = P('game', 'sim');
  if (!existsSync(dir)) { console.error('game/sim not found'); process.exit(1); }
  const bad = [];
  const files = walk(dir).filter(f => /\.m?js$/.test(f));
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (FORBIDDEN.test(l)) bad.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 160)}`);
    });
  }
  if (bad.length) { console.error('FORBIDDEN WORD in game/sim (§11.1):\n' + bad.join('\n')); process.exit(1); }
  console.log(`game/sim purity check OK (${files.length} files)`);
}

function checkThreeImports() {
  const dir = P('game');
  const bad = [];
  const files = walk(dir, SKIP_DIRS).filter(f => /\.m?js$/.test(f));
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (BAD_THREE.test(l)) bad.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 160)}`);
    });
  }
  if (bad.length) {
    console.error('three must be imported by name (no "import * as THREE", no three/webgpu, tsl or export *):\n' + bad.join('\n'));
    process.exit(1);
  }
  console.log(`three import check OK (${files.length} files scanned)`);
}

checkSim();
checkThreeImports();
if (process.argv.includes('--check')) process.exit(0);

const entry = P('game', 'main.js');
if (!existsSync(entry)) { console.error('game/main.js missing'); process.exit(1); }

const threeVersion = JSON.parse(readFileSync(P('node_modules', 'three', 'package.json'), 'utf8')).version;
const BANNER =
  `/*! three.js r${threeVersion.split('.')[1]} (npm ${threeVersion}), tree-shaken. MIT License, Copyright 2010-2026 three.js authors. ` +
  `https://github.com/mrdoob/three.js/blob/dev/LICENSE */`;

const result = await build({
  entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  minify: !DEV, treeShaking: true, write: false, legalComments: 'none', logLevel: 'warning',
  metafile: true, banner: { js: BANNER }, charset: 'utf8',
});
const js = result.outputFiles[0].text;

// Exactly one copy of three, never the vendored IIFE.
const inputs = Object.keys(result.metafile.inputs).map(k => k.split(sep).join('/'));
const threeInputs = inputs.filter(k => /(^|\/)three(\/|$)/.test(k) && /node_modules\/three\//.test(k));
const vendored = inputs.filter(k => /vendor\/three/.test(k));
const cores = threeInputs.filter(k => /three\.core\.js$/.test(k));
if (vendored.length || cores.length !== 1 || threeInputs.some(k => /examples\/jsm|webgpu|tsl/.test(k))) {
  console.error('three duplication / forbidden three inputs in bundle:\n' + [...vendored, ...threeInputs].join('\n'));
  process.exit(1);
}
const threeBytes = Object.entries(result.metafile.outputs)[0][1].inputs;
let threeOut = 0, appOut = 0;
for (const [k, v] of Object.entries(threeBytes)) { if (/node_modules\/three\//.test(k.split(sep).join('/'))) threeOut += v.bytesInOutput; else appOut += v.bytesInOutput; }

const cssPath = P('game', 'style.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
const safe = s => s.replace(/<\/(script|style)/gi, '<\\/$1');

const html =
`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hydropower Tycoon</title>
<style>${safe(css)}</style></head>
<body>
<script>${safe(js)}</script>
</body></html>
`;
mkdirSync(P('dist'), { recursive: true });
const out = P('dist', 'hydropower-tycoon.html');
writeFileSync(out, html);
const b = Buffer.byteLength(html);
const kb = n => (n / 1024).toFixed(1) + ' KiB';
console.log(`wrote dist/hydropower-tycoon.html (${DEV ? 'dev' : 'minified'}): ${b} bytes = ${(b / 1048576).toFixed(2)} MiB; ` +
  `script ${kb(Buffer.byteLength(js))} (three ${kb(threeOut)}, app ${kb(appOut)}); budget warn ${(WARN_BYTES / 1048576).toFixed(1)} / fail ${(FAIL_BYTES / 1048576).toFixed(1)} MiB`);
if (!DEV && b > FAIL_BYTES) { console.error(`SIZE FAIL: ${b} > ${FAIL_BYTES}`); process.exit(1); }
if (!DEV && b > WARN_BYTES) console.warn(`SIZE WARN: ${b} > ${WARN_BYTES}`);
