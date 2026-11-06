// Headless contract check: Test 11 (§12) from CONFIG starting config, plus state invariants.
// package.json is "type":"commonjs"; src/*.js are ES modules, so force ESM format for src/ here.
import { registerHooks } from 'node:module';
registerHooks({
  load(url, context, next) {
    if (url.includes('/src/') && url.endsWith('.js')) return next(url, { ...context, format: 'module' });
    return next(url, context);
  },
});
const { CONFIG } = await import('../src/config.js');
const { createInitialState, frustumVolume, STATE_KEYS } = await import('../src/state.js');
const { nextFloat, createRngState } = await import('../src/rng.js');
const { hashState, countNonFinite } = await import('../src/selftest.js');

const { rho, g } = CONFIG.physics;
const st = CONFIG.start;
const eta = CONFIG.turbines[1].eta_t;
const Vu = frustumVolume(st.upper.A_bot, st.upper.s, st.upper.D_max);
const Vl = frustumVolume(st.lower.A_bot, st.lower.s, st.lower.D_max);
// E = ρ g V H_n, J → MWh (1 MWh = 3.6e9 J)
const Egross = rho * g * Vu * CONFIG.test11.H_n / 3.6e9;
const Enet = Egross * eta;
const s0 = createInitialState(12345);
const site = s0.sites[0];
const Hg = site.reservoirs.upper.z - site.reservoirs.lower.z;

const r = createRngState(7), r2 = createRngState(7);
const seq = [nextFloat(r, 'weather'), nextFloat(r, 'weather')];
const rows = [
  ['V_max upper m³', 217450.56, Vu, 0.01],
  ['V_max lower m³', 385517.5, Vl, 0.05],
  ['E gross MWh', 29.04, Egross, 0.005],
  ['E net MWh', 24.68, Enet, 0.005],
  ['H_g start m', 50, Hg, 1e-9],
  ['z_upper_floor m', 51.5993, site.z_upper_floor, 5e-5],
  ['top-level keys', STATE_KEYS.length, STATE_KEYS.filter(k => k in s0).length, 0],
  ['non-finite count', 0, countNonFinite(s0), 0],
  ['deterministic hash', hashState(createInitialState(12345)), hashState(s0), 0],
  ['rng reproducible', seq[0], nextFloat(r2, 'weather'), 0],
].map(([name, expected, actual, tol]) => ({ name, expected, actual,
  pass: typeof expected === 'string' ? expected === actual : Math.abs(actual - expected) <= tol }));
console.table(rows);
const ok = rows.every(x => x.pass) && Object.keys(s0).length === STATE_KEYS.length;
console.log(ok ? 'CONTRACT CHECK PASS' : 'CONTRACT CHECK FAIL');
process.exit(ok ? 0 : 1);
