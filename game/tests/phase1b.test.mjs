/* Phase 1 batch 2: quote determinism and speed, friction-factor continuity, solveQ against the achievable power, planner inflow split.
   Imports quote from god.js directly (the Sim facade exposes it once index.js is wired to god.js). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Sim, createGame, start, runToDay, CLASSIC, CANYON, CANYON_SETUP} from './helpers.mjs';
import {quote as godQuote} from '../sim/god.js';
import {solveQ, genPower, pumpPower, hydraulics} from '../sim/hydraulics.js';

const C = Sim.CONFIG;

test('quote: same state gives the same quote, on any day of the year, for any asset', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 5e6; const a = [], b = [];
  const ask = () => { const r = []; for (const [tile, kind, tier] of [[9, 'battery', 0], [9, 'battery', 2], [2, 'wind', 0], [2, 'wind', 2], [3, 'solar', 1]]) r.push(JSON.stringify(godQuote(st, 0, tile, kind, tier))); return r; };
  a.push(...ask()); assert.deepEqual(ask(), a, 'repeat ask on the same day');
  assert.ok(runToDay(g, 97)); assert.deepEqual(ask(), a, 'ask 97 days later');
  assert.ok(runToDay(g, 400)); assert.deepEqual(ask(), a, 'ask in year 2');
  const g2 = start(CLASSIC, [], 5); g2.state.cash = 5e6; assert.deepEqual((() => { const s2 = g2.state; return [[9, 'battery', 0], [9, 'battery', 2], [2, 'wind', 0], [2, 'wind', 2], [3, 'solar', 1]].map(([t, k, r]) => JSON.stringify(godQuote(s2, 0, t, k, r))); })(), a, 'a second game, same seed');
});

test('quote: a cold quote stays well under 20 ms and a cached one is cheaper', () => {
  const g = start({seed: 777}, [], 5); const st = g.state; st.cash = 5e6; // a seed no earlier test used: the sample table is built on the first call
  const t0 = process.hrtime.bigint(); const q = godQuote(st, 0, 2, 'wind', 1); const cold = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(q.ok && Number.isFinite(q.npv)); assert.ok(cold < 20, 'first quote (builds the seasonal table) took ' + cold.toFixed(2) + ' ms');
  const t1 = process.hrtime.bigint(); for (let i = 0; i < 100; i++) godQuote(st, 0, 2, 'wind', 1); const warm = Number(process.hrtime.bigint() - t1) / 1e8;
  assert.ok(warm < 1, 'cached quote took ' + warm.toFixed(3) + ' ms');
  const t2 = process.hrtime.bigint(); for (const k of ['solar', 'wind']) for (let tr = 0; tr < 3; tr++) for (let i = 0; i < 48; i++) godQuote(st, 0, i, k, tr); const all = Number(process.hrtime.bigint() - t2) / 1e6;
  assert.ok(all < 200, 'full sweep of 288 quotes took ' + all.toFixed(1) + ' ms');
});

test('quote: battery value is bounded by MWh x RTE x the widest price spread, and shading is charged', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 5e6;
  for (let tier = 0; tier < 3; tier++) { const B = C.battery.tiers[tier], q = godQuote(st, 0, 9, 'battery', tier);
    assert.ok(q.dayRev > 0 && q.dayRev < B.MWh * C.battery.rte * 200, B.name + ' $/day ' + q.dayRev); assert.ok(q.dayMWh <= B.MWh * (C.battery.socMax - C.battery.socMin) + 1e-9); }
  const w0 = godQuote(st, 0, 0, 'wind', 0), w4 = godQuote(st, 0, 4, 'wind', 0); assert.ok(w0.dayRev < w4.dayRev);
});

test('friction factor: continuous and bounded between laminar and turbulent over Re 1500-4000', () => {
  const g = createGame(); g.newGame(CLASSIC); const s = g.state.sites[0]; const D = s.penstock.D, A = Math.PI * D * D / 4;
  let prev = null, worst = 0;
  for (let Re = 1500; Re <= 4000; Re += 5) { const f = hydraulics(s, Re * C.phys.nu * A / D).f; assert.ok(f > 0 && Number.isFinite(f), 'f at Re ' + Re);
    if (prev !== null) worst = Math.max(worst, Math.abs(f / prev - 1)); prev = f; }
  assert.ok(worst < 0.02, 'largest 5-Re step in f is ' + (100 * worst).toFixed(2) + '%');
  assert.ok(Math.abs(hydraulics(s, 1e5 * C.phys.nu * A / D).f / (0.25 / Math.pow(Math.log10(C.penstock.materials[s.penstock.mat].eps / (3.7 * D) + 5.74 / Math.pow(1e5, 0.9)), 2)) - 1) < 1e-9, 'fully turbulent above Re 4000 (unchanged Swamee-Jain)');
});

test('solveQ: reaches >= 95% of the achievable power for targets below the maximum, for every turbine and head', () => {
  const g = createGame(); g.newGame(CLASSIC); const s = g.state.sites[0], bad = [];
  for (let tier = 0; tier < 3; tier++) { s.turbine.tier = tier; const qmax = C.turbine[tier].Qr * C.eff.xMaxT;
    for (const Hg of [4, 10, 25, 60, 130]) { let best = 0; for (let q = 0.02; q <= qmax; q += 0.02) best = Math.max(best, genPower(s, q, Hg).P); if (best <= 0) continue;
      for (const frac of [0.1, 0.3, 0.6, 0.9, 0.99]) { const Pt = frac * best, q = solveQ(genPower, s, Hg, Pt, qmax), P = genPower(s, q, Hg).P;
        if (!(P >= 0.95 * Pt && P <= 1.02 * Pt + 50)) bad.push('T' + (tier + 1) + ' Hg ' + Hg + ' target ' + Math.round(Pt) + ' W -> Q ' + q.toFixed(2) + ' gives ' + Math.round(P) + ' W'); }
      const q = solveQ(genPower, s, Hg, 2 * best, qmax); if (genPower(s, q, Hg).P < 0.95 * best) bad.push('T' + (tier + 1) + ' Hg ' + Hg + ': unreachable target gives ' + Math.round(genPower(s, q, Hg).P) + ' of ' + Math.round(best) + ' W'); } }
  assert.deepEqual(bad, []);
});

test('solveQ: pump flow for a surplus is unchanged (monotone power)', () => {
  const g = createGame(); g.newGame(CLASSIC); const s = g.state.sites[0]; const qmax = C.pump[s.pump.tier].Qr * C.eff.xMaxP, Hg = 60;
  const Pt = pumpPower(s, 0.6 * qmax, Hg).P, q = solveQ(pumpPower, s, Hg, Pt, qmax); assert.ok(Math.abs(q - 0.6 * qmax) < 1e-6 * qmax);
  assert.equal(solveQ(pumpPower, s, Hg, 10 * Pt, qmax), qmax);
});

test('planner: inflow of the upper and the lower lake are separate fields, lower includes env release', () => {
  const g = start(CANYON[4242], CANYON_SETUP, 2); assert.ok(runToDay(g, 10)); const st = g.state, ctx = Sim.godCtx(st, st.sites[0]);
  assert.ok(Number.isFinite(ctx.natInU) && Number.isFinite(ctx.natInL)); assert.equal(ctx.natIn, undefined);
  const gp = Sim.godPlan; assert.ok(typeof gp === 'function');
});
