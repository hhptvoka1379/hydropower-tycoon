// Exports golden values for the C# port of src/sim/hydraulics.js.
// Usage: node tools/export_hydraulics.mjs
// Writes unity/Packages/com.damgame.sim/Tests/golden/hydraulics.json.
// The JavaScript is the reference; this file only draws inputs and records outputs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { frictionFactor, penstockLoss, turbinePower, pumpPower } from '../src/sim/hydraulics.js';
import { mulberry32Step } from '../src/rng.js';

const SEED = 12345;
const COUNT = 200;
const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../unity/Packages/com.damgame.sim/Tests/golden/hydraulics.json');

// One RNG state threaded through every draw, in function order, one draw per argument.
let state = SEED >>> 0;
function draw() {
  const [next, u] = mulberry32Step(state);
  state = next;
  return u;
}
const uniform = (a, b) => a + (b - a) * draw();
const logUniform = (a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * draw());

const PH = CONFIG.physics;
const HY = CONFIG.hydraulics;
const constants = {
  rho: PH.rho, g: PH.g, nu: PH.nu,
  swameeA: HY.swameeA, swameeB: HY.swameeB, swameeExp: HY.swameeExp,
  f_min: HY.f_min, f_max: HY.f_max, Re_turbulent: HY.Re_turbulent, f_lowRe: HY.f_lowRe,
};

function build(fn, drawArgs, edge) {
  const cases = [];
  for (let i = 0; i < COUNT; i++) {
    const args = drawArgs();
    cases.push({ args, expected: fn(...args) });
  }
  cases.push({ args: edge, expected: fn(...edge) });
  return { cases };
}

const pick = (r) => ({
  A_pipe: r.A_pipe, v: r.v, Re: r.Re, f: r.f,
  Hf_major: r.Hf_major, Hf_minor: r.Hf_minor, Hf: r.Hf, lowRe: r.lowRe,
});

const golden = {
  seed: SEED,
  count: COUNT,
  constants,
  frictionFactor: build(frictionFactor,
    () => [logUniform(1e2, 1e7), uniform(1e-6, 0.05)],
    [0, 0.001]),
  penstockLoss: build((...a) => pick(penstockLoss(...a)),
    () => [uniform(0.01, 10), uniform(0.5, 2.0), uniform(50, 500), uniform(1e-5, 1e-3), uniform(0, 5)],
    [0, 1.0, 100, 0.0002, 2.1]),
  turbinePower: build(turbinePower,
    () => [uniform(1, 200), uniform(0.01, 10), uniform(0.4, 0.95)],
    [0, 1, 0.9]),
  pumpPower: build(pumpPower,
    () => [uniform(0, 200), uniform(0.01, 10), uniform(0.4, 0.9)],
    [10, 0, 0.8]),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(golden, null, 1) + '\n');
console.log(`wrote ${outPath}`);
