// Bundler skeleton (spec §11.1, §14.1): checks src/sim purity, bundles src/main entry
// to one IIFE with esbuild, inlines vendor/three.iife.js + CSS into hydropower-tycoon.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /\b(document|window|THREE|canvas)\b|Math\.random/; // §11.1
function walk(d) {
  return readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function checkSim() {
  const bad = [];
  if (existsSync('src/sim')) for (const f of walk('src/sim').filter(f => f.endsWith('.js'))) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (FORBIDDEN.test(l)) bad.push(`${f}:${i + 1}: ${l.trim()}`); });
  }
  if (bad.length) { console.error('FORBIDDEN WORD in src/sim (§11.1):\n' + bad.join('\n')); process.exit(1); }
}
checkSim();
if (process.argv.includes('--check')) { console.log('src/sim check OK'); process.exit(0); }

const entry = 'src/main.js';
if (!existsSync(entry)) { console.error(`No ${entry} yet; nothing to bundle (check passed).`); process.exit(0); }
const js = (await build({ entryPoints: [entry], bundle: true, format: 'iife', minify: false, target: 'es2020', write: false, legalComments: 'none' })).outputFiles[0].text;
const three = readFileSync('vendor/three.iife.js', 'utf8');
const css = existsSync('src/style.css') ? readFileSync('src/style.css', 'utf8') : '';
const safe = s => s.replace(/<\/script/gi, '<\\/script');
writeFileSync('hydropower-tycoon.html',
`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Hydropower Tycoon</title>\n<style>${css}</style></head>\n<body>\n<script>${safe(three)}</script>\n<script>${safe(js)}</script>\n</body></html>\n`);
console.log('wrote hydropower-tycoon.html');
