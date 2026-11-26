// Build pipeline for the game/ workspace.
//   node build/bundle.mjs --check   purity check on game/sim only
//   node build/bundle.mjs           check, then bundle game/main.js -> dist/hydropower-tycoon.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(ROOT, ...a);

// Sim purity (spec §11.1): no DOM, renderer, wall clock or unseeded randomness inside game/sim.
const FORBIDDEN = /\b(document|window|THREE|canvas|Date|performance)\b|Math\.random/;

function walk(d) {
  return readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function checkSim() {
  const dir = P('game', 'sim');
  if (!existsSync(dir)) { console.error('game/sim not found'); process.exit(1); }
  const bad = [];
  const files = walk(dir).filter(f => /\.(m?js)$/.test(f));
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (FORBIDDEN.test(l)) bad.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${l.trim().slice(0, 160)}`);
    });
  }
  if (bad.length) { console.error('FORBIDDEN WORD in game/sim (§11.1):\n' + bad.join('\n')); process.exit(1); }
  console.log(`game/sim purity check OK (${files.length} files)`);
}

checkSim();
if (process.argv.includes('--check')) process.exit(0);

const entry = P('game', 'main.js');
if (!existsSync(entry)) { console.error('game/main.js missing'); process.exit(1); }

const result = await build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: false, target: 'es2020',
  treeShaking: true, write: false, legalComments: 'none', logLevel: 'warning',
});
const js = result.outputFiles[0].text;
const three = readFileSync(P('vendor', 'three.iife.js'), 'utf8');
const cssPath = P('game', 'style.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
const safe = s => s.replace(/<\/(script|style)/gi, '<\\/$1');

const html =
`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hydropower Tycoon</title>
<style>${safe(css)}</style></head>
<body>
<script>${safe(three)}</script>
<script>${safe(js)}</script>
</body></html>
`;
mkdirSync(P('dist'), { recursive: true });
const out = P('dist', 'hydropower-tycoon.html');
writeFileSync(out, html);
const b = Buffer.byteLength(html);
console.log(`wrote dist/hydropower-tycoon.html (${b} bytes, ${(b / 1048576).toFixed(2)} MiB; game script ${(Buffer.byteLength(js) / 1024).toFixed(1)} KiB)`);
