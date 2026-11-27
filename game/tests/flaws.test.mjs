/* Flaw reproduction tests A1..A15 (section 4A of PROJECT_STATUS.md), run against the extracted pure sim.
   Every test asserts the CORRECT (post-fix) behaviour. Phase 1 is finished: every fix has landed, so no test carries a todo marker any more
   and all of them are enforced by `npm test`. Measured numbers are in game/notes/flaw-repro.md.
   No Math.random, no wall clock; every loop is capped. The only timeout is the child-process guard in A9. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Sim, createGame, start, runToDay, runTicks, ledgerNet, CLASSIC, CANYON, CANYON_SETUP} from './helpers.mjs';
import {measureDamPrices, reservePass, emergencySchedule, floodedVolume, bankruptGame} from './measure.mjs';
/* A11 targets pure functions that the Sim facade does not export (solveQ) or that need exact Re / power inputs (cavitation). */
import {solveQ, genPower, cavitation, hydraulics} from '../sim/hydraulics.js';
import {SC} from '../sim/terrain.js';

const C = Sim.CONFIG;
const must = (g, a) => { const r = g.dispatch(a); assert.ok(r.ok, 'action rejected: ' + JSON.stringify(a) + ' -> ' + r.reason); return r; };
const drain = (st, cap = 200000) => { let n = 0; while (st.jobs.length && n++ < cap) Sim.step(st); assert.ok(st.jobs.length === 0, 'jobs did not finish'); };
const f = (x, d = 2) => (typeof x === 'number' ? +x.toFixed(d) : x);
/* flaw(id, one-line, fn): a plain test, kept as a named wrapper so the ids stay greppable. The `reproduced` argument of the old todo mechanism is ignored. */
function flaw(id, text, fn) { test(id + ': ' + text, fn); }

/* ------------------------------------------------------------------ A1 god-mode profit protection */
/* Same game twice, god planner on, profit protection on vs off. The trajectories are identical except for the top-up (see notes), so
   with the subsidy kept out of earned figures the two runs must agree on netWorth and profitDays. */
const A1 = {};
function godRun(protect) {
  if (A1[protect]) return A1[protect];
  const g = start(CANYON[4242], CANYON_SETUP, 2); must(g, {type: 'SET_GOD', enabled: true, planner: true, protect});
  assert.ok(runToDay(g, 60), 'stalled'); return (A1[protect] = g.state);
}
flaw('A1a', 'god top-up is booked to fin.subsidy and excluded from netWorth', () => {
  const on = godRun(true), off = godRun(false);
  assert.ok(typeof on.fin.subsidy === 'number' && on.fin.subsidy > 0, 'fin.subsidy must hold the top-ups (got ' + on.fin.subsidy + ')');
  assert.ok(Math.abs(Sim.netWorth(on) - Sim.netWorth(off)) < 1, 'netWorth with protection ' + f(Sim.netWorth(on)) + ' vs without ' + f(Sim.netWorth(off)) + ' (subsidy ' + f(on.fin.subsidy) + ')');
});
flaw('A1b', 'god top-up does not create profit days (quest q3 / profitDays)', () => {
  const on = godRun(true), off = godRun(false);
  assert.equal(on.stats.profitDays, off.stats.profitDays, 'profitDays with protection ' + on.stats.profitDays + ' vs without ' + off.stats.profitDays);
});

/* ------------------------------------------------------------------ A2 reserve availability pay vs dead plant */
flaw('A2', 'a dead turbine (reserveCap < offer) earns no reserve availability pay', () => {
  const run = (dead) => {
    const g = start(CLASSIC, [], 2); const st = g.state, s = st.sites[0];
    must(g, {type: 'SET_RESERVE_OFFER', mw: 0.5}); if (dead) s.turbine.health = 0;
    assert.ok(runToDay(g, 10)); return {rev: st.reserve.revenue, cap: Sim.reserveCap(s) / 1e6};
  };
  const live = run(false), dead = run(true);
  assert.ok(live.cap >= 0.5 && live.rev > 0, 'control: a healthy plant that can deliver the offer is paid (rev ' + live.rev + ')');
  assert.ok(dead.cap < 0.5, 'dead plant has no capacity');
  assert.equal(dead.rev, 0, 'dead plant earned $' + f(dead.rev) + ' availability pay');
});

/* ------------------------------------------------------------------ A3 dam price route dependence */
flaw('A3', 'total dam cost h0 to h1 differs by <= 12% between cheapest and dearest purchase route', () => {
  for (const seed of [4242, 99]) {
    const m = measureDamPrices(seed);
    assert.ok(m.ratioMaxMin <= 1.12, 'seed ' + seed + ': route ratio ' + f(m.ratioMaxMin, 3) + ' (one-shot $' + Math.round(m.oneShot) + ', 32+8 $' + Math.round(m.staged_32_8) + ', 1 m steps $' + Math.round(m.steps_5_then_1m_x35) + ')');
  }
});

/* ------------------------------------------------------------------ A4 battery NPV quote */
flaw('A4', 'battery NPV quote is within 1.5x of an estimate capped at MWh x cycles x RTE', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 5e6;
  const r = C.fin.discount, af = (1 - Math.pow(1 + r, -C.fin.years)) / r, bad = [];
  for (const day of [0, 40]) {
    assert.ok(runToDay(g, day)); const fc = st.market.forecast; const spread = Math.max(...fc) - Math.min(...fc);
    for (const tier of [0, 1, 2]) {
      const B = C.battery.tiers[tier]; const q = Sim.quote(st, 0, 9, 'battery', tier);
      /* generous ceiling: one full cycle per day (observed: ~0.9), sold at the day's widest spread, RTE once, minus O&M */
      const estAnnual = C.time.daysPerYear * B.MWh * 1 * C.battery.rte * spread - B.om * C.time.hoursPerYear;
      const cap = 1.5 * Math.max(estAnnual, 0) * af, pv = q.npv + q.cost; // pv = annual * af
      if (!(pv <= cap)) bad.push('day ' + day + ' ' + B.name + ': quote PV $' + Math.round(pv) + ' vs cap $' + Math.round(cap) + ' (quote is x' + f(1.5 * pv / cap) + ' the ceiling estimate)');
    }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

/* ------------------------------------------------------------------ A5 wind / solar NPV quotes */
const A5 = (() => { let m = null; return () => { if (m) return m; m = {wind: [], windW3: [], solar: [], days: []};
  const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 5e6;
  for (let i = 0; i < 8; i++) { const d = i * 45; assert.ok(runToDay(g, d)); m.days.push(d);
    m.wind.push(Sim.quote(st, 0, 2, 'wind', 0).npv); m.windW3.push(Sim.quote(st, 0, 2, 'wind', 2).npv); m.solar.push(Sim.quote(st, 0, 3, 'solar', 0).npv); }
  return m; }; })();
const sign = (a) => a.every(x => x > 0) || a.every(x => x < 0);
const k = (a) => a.map(x => Math.round(x / 1000) + 'k').join(' ');
flaw('A5a', 'wind NPV quote keeps its sign on 8 different days', () => {
  const m = A5(); assert.ok(sign(m.wind) && sign(m.windW3), 'W1 ' + k(m.wind) + ' | W3 ' + k(m.windW3));
});
flaw('A5b', 'solar NPV quote keeps its sign on 8 different days', () => {
  const m = A5(); assert.ok(sign(m.solar), 'S1 ' + k(m.solar));
});
flaw('A5c', 'wind quote on a tile that already has solar deducts the shading loss', () => {
  const g = start(CLASSIC, [], 2); const st = g.state; // tile 0 holds the starter solar array, tile 4 (same column, next row) is empty: same wake / wind
  const q0 = Sim.quote(st, 0, 0, 'wind', 0), q4 = Sim.quote(st, 0, 4, 'wind', 0);
  assert.ok(q0.dayRev < q4.dayRev - 0.05, 'dayRev with solar on tile ' + f(q0.dayRev, 3) + ' vs empty tile ' + f(q4.dayRev, 3));
});
flaw('A5d', 'wind / solar NPV quote does not swing more than 50% of its mean across the year', () => {
  const m = A5(), bad = [];
  for (const [n, a] of [['W1', m.wind], ['W3', m.windW3], ['S1', m.solar]]) { const mean = a.reduce((x, y) => x + y, 0) / a.length; const range = Math.max(...a) - Math.min(...a); if (!(range <= 0.5 * Math.abs(mean))) bad.push(n + ' range $' + Math.round(range) + ' vs |mean| $' + Math.round(Math.abs(mean))); }
  assert.equal(bad.length, 0, bad.join('; '));
});

/* ------------------------------------------------------------------ A6 canyon start */
flaw('A6a', 'a 12 m dam costs at most 90% of the canyon start cash on all three seeds', () => {
  const bad = [];
  for (const sd of [4242, 99, 31337]) {
    const g = createGame(); g.newGame(CANYON[sd]); const cash = g.state.cash, q = Sim.damQuote(g.state, 0, undefined, 12);
    if (!(q.cost <= 0.9 * cash)) bad.push('seed ' + sd + ': $' + Math.round(q.cost) + ' is ' + f(100 * q.cost / cash, 1) + '% of $' + Math.round(cash));
    const r = g.dispatch({type: 'PLACE_DAM', height: 12}); if (!r.ok) bad.push('seed ' + sd + ': ' + r.reason);
  }
  assert.equal(bad.length, 0, bad.join('; '));
});
flaw('A6b', 'after 10 days the canyon operating head is > 10 m (and the lower lake is not brimming)', () => {
  const bad = [];
  for (const sd of [4242, 99, 31337]) { const g = start(CANYON[sd], CANYON_SETUP, 2); assert.ok(runToDay(g, 10)); const s = g.state.sites[0]; const h = Sim.grossHead(s), hL = Sim.resLevel(s.lower, s.lower.V);
    if (!(h > 10)) bad.push('seed ' + sd + ': head ' + f(h) + ' m'); if (!(hL < 0.8 * s.lower.hMax)) bad.push('seed ' + sd + ': lower lake at ' + f(hL) + ' of ' + s.lower.hMax + ' m'); }
  assert.equal(bad.length, 0, bad.join('; '));
});

/* ------------------------------------------------------------------ A7 analytic V(h) vs drawn terrain */
flaw('A7', 'procedural upper lake: resVol within 3% of the flooded terrain volume', () => {
  const bad = [];
  for (const sd of [4242, 99, 31337]) {
    const g = createGame(); g.newGame(CANYON[sd]); g.state.cash = 1e9; must(g, {type: 'PLACE_DAM', height: 30}); const s = g.state.sites[0];
    for (const h of [10, 20, 28]) { const a = Sim.resVol(s.upper, h), b = floodedVolume(s, h, 5); if (Math.abs(a / b - 1) > 0.03) bad.push('seed ' + sd + ' h ' + h + ': analytic/terrain ' + f(a / b, 3)); }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

/* ------------------------------------------------------------------ A8 determinism */
flaw('A8a', 'replay hash equals live hash after rejected actions', () => {
  const play = (reject) => { const g = start(CLASSIC, [], 2); assert.ok(runToDay(g, 2)); if (reject) assert.equal(g.dispatch({type: 'RAISE_DAM', meters: 99}).ok, false);
    assert.ok(runToDay(g, 3)); const sv = g.makeSave(); return [Sim.hashState(g.state), Sim.hashState(Sim.replay(sv.init, sv.log, sv.state.tick))]; };
  const [l0, r0] = play(false); assert.equal(r0, l0, 'control (no rejection) must replay exactly');
  const [l1, r1] = play(true); assert.equal(r1, l1, 'replay hash ' + r1 + ' != live hash ' + l1 + ' after one rejected action');
});
flaw('A8b', 'offering reserve does not shift the grid-emergency schedule (seed 3)', () => {
  const a = emergencySchedule(3, 0), b = emergencySchedule(3, 0.05);
  assert.deepEqual(b, a, 'no offer: ' + a.join(' ') + ' | offer 0.05 MW: ' + b.join(' '));
});
flaw('A8c', 'reserve-call pass count is identical at dt 1 / 5 / 30 / 60 / 300', () => {
  const r = {}; for (const sp of [0, 1, 2, 3, 5]) r['dt' + C.time.dtBySpeed[sp]] = reservePass(sp);
  assert.equal(new Set(Object.values(r)).size, 1, JSON.stringify(r) + ' of 48 calls');
});

/* ------------------------------------------------------------------ A9 replay of a bankrupt log */
flaw('A9', 'replay of a log that ends bankrupt terminates', () => {
  const g = bankruptGame(); const st = g.state; assert.ok(st.bankrupt); const sv = g.makeSave();
  const code = "import fs from 'node:fs';const m=await import(process.argv[1]);const d=JSON.parse(fs.readFileSync(0,'utf8'));const s=m.Sim.replay(d.init,d.log,d.until);process.stdout.write(String(s.tick));";
  /* the real Sim.replay runs in a child so a hang cannot hang the test run: the child is killed after 6 s. untilTick lies one hour past the bankruptcy tick. */
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, pathToFileURL(new URL('../sim/index.js', import.meta.url).pathname).href],
    {input: JSON.stringify({init: sv.init, log: sv.log, until: st.tick + 3600}), timeout: 6000, encoding: 'utf8'});
  assert.ok(!(r.error && r.error.code === 'ETIMEDOUT'), 'Sim.replay did not return within 6 s (bankrupt at tick ' + st.tick + ', stuck: step() returns 0 without advancing tick)');
  assert.equal(r.status, 0, 'child failed: ' + r.stderr);
});

/* ------------------------------------------------------------------ A10 year-end bonus */
const A10 = (() => { let m = null; return () => { if (m) return m;
  const g = start(CLASSIC, [], 5); const st = g.state, s = st.sites[0]; st.cash = 1e7; must(g, {type: 'BUILD', kind: 'solar', tile: 5, tier: 2}); must(g, {type: 'BUILD', kind: 'solar', tile: 6, tier: 2});
  assert.ok(runToDay(g, 359)); const before = {eRen: s.yr.eRen, capH: s.yr.capH};
  assert.ok(runToDay(g, 361)); m = {before, bonus1: st.fin.yearBonus, after: {eRen: s.yr.eRen, capH: s.yr.capH}, y1: st.alerts.some(a => /Year-end/.test(a.msg) && a.day === 360)};
  assert.ok(runToDay(g, 721)); m.y2 = st.alerts.some(a => /Year-end/.test(a.msg) && a.day === 720); return m; }; })();
flaw('A10a', 'year-end bonus scales with renewable output (more than the old $100/site cap)', () => {
  const m = A10(); assert.ok(m.bonus1 > 100, 'bonus $' + f(m.bonus1) + ' after ' + Math.round(m.before.eRen) + ' renewable MWh');
});
flaw('A10b', 'year-end bonus fires every year (day 720 as well as 360)', () => {
  const m = A10(); assert.ok(m.y1, 'control: bonus at day 360'); assert.ok(m.y2, 'no year-end bonus at day 720');
});
flaw('A10c', 'yr.eRen and yr.capH are reset at year end', () => {
  const m = A10(); assert.ok(m.after.eRen <= 0.2 * m.before.eRen && m.after.capH <= 0.2 * m.before.capH, 'before ' + JSON.stringify(m.before) + ' after ' + JSON.stringify(m.after));
});

/* ------------------------------------------------------------------ A11 hydraulics */
flaw('A11a', 'friction factor is continuous across Re = 2300 (< 15% jump)', () => {
  const g = createGame(); g.newGame(CLASSIC); const s = g.state.sites[0]; const D = s.penstock.D, A = Math.PI * D * D / 4;
  const fAt = (Re) => hydraulics(s, Re * C.phys.nu * A / D).f;
  const lo = fAt(2299), hi = fAt(2301); assert.ok(Math.abs(hi / lo - 1) < 0.15, 'f(2299) = ' + f(lo, 4) + ', f(2301) = ' + f(hi, 4) + ' (+' + f((hi / lo - 1) * 100, 1) + '%)');
});
flaw('A11b', 'solveQ returns the flow of a reachable power target for a big turbine at low head', () => {
  const g = createGame(); g.newGame(CLASSIC); const s = g.state.sites[0]; s.turbine.tier = 2; const Hg = 10, Pt = 50e3, qmax = C.turbine[2].Qr * C.eff.xMaxT;
  let best = 0; for (let q = 0.05; q <= qmax; q += 0.05) best = Math.max(best, genPower(s, q, Hg).P);
  assert.ok(best > 2 * Pt, 'setup: some flow reaches ' + Math.round(best) + ' W');
  const q = solveQ(genPower, s, Hg, Pt, qmax); const P = genPower(s, q, Hg).P;
  assert.ok(P >= 0.9 * Pt, 'solveQ -> Q ' + f(q) + ' m3/s gives ' + Math.round(P) + ' W for a ' + Pt + ' W target');
});
flaw('A11c', 'cavitation critical sigma (via ns) uses rated, not operating, power', () => {
  const g = createGame(); g.newGame(CLASSIC); const s = g.state.sites[0];
  const a = cavitation(s, 2, 40, 1e5, 1).sigmaC, b = cavitation(s, 2, 40, 8e5, 1).sigmaC;
  assert.ok(Math.abs(a - b) < 1e-9, 'sigmaC ' + f(a, 4) + ' at 100 kW vs ' + f(b, 4) + ' at 800 kW operating power');
});

/* ------------------------------------------------------------------ A12 god planner */
flaw('A12a', 'god planner natural inflow matches the real net inflow of the two-lake system (canyon, 24 h)', () => {
  const g = start(CANYON[4242], CANYON_SETUP, 2); const st = g.state, s = st.sites[0]; const bad = [];
  for (const d of [10, 20, 30]) {
    assert.ok(runToDay(g, d)); const ctx = Sim.godCtx(st, s); const planned = Object.keys(ctx).filter(key => /^natIn/.test(key)).reduce((a, key) => a + ctx[key], 0);
    const L0 = ledgerNet(s), H0 = st.H; let n = 0; while (st.H < H0 + 24 && n++ < 5000) Sim.step(st);
    const actual = (ledgerNet(s) - L0) / 86400; if (Math.abs(planned - actual) > 0.25) bad.push('day ' + d + ': planned ' + f(planned) + ' vs actual ' + f(actual) + ' m3/s');
  }
  assert.equal(bad.length, 0, bad.join('; '));
});
flaw('A12b', 'manual and god curtailment combine multiplicatively in the sim', () => {
  const g = start(CLASSIC, [], 2); const st = g.state, s = st.sites[0]; let n = 0; while (st.hour < 12 && n++ < 5000) Sim.step(st);
  st.god.enabled = true; st.god.curtailNeg = true; s.godCurtail = 0.5; s.curtailSolar = 0.3; for (let i = 0; i < 5; i++) Sim.step(st);
  const t = s.tiles[0].solar; assert.ok(t.avail > 0, 'setup: sun is up');
  assert.ok(Math.abs(t.p / t.avail - 0.35) < 0.01, 'solar delivers ' + f(t.p / t.avail, 3) + ' of available, want (1-0.3)(1-0.5) = 0.35');
});

/* ------------------------------------------------------------------ A13 stakes (thresholds are proposals; see notes) */
flaw('A13a', 'EMERGENCY_CREDIT does not push loans past maxLoan', () => {
  const g = bankruptGame(); const st = g.state; assert.equal(st.loans, C.fin.maxLoan, 'setup: loan already at the limit');
  const r = g.dispatch({type: 'EMERGENCY_CREDIT'}); assert.ok(!r.ok || st.loans <= C.fin.maxLoan, 'loans ' + st.loans + ' > maxLoan ' + C.fin.maxLoan);
});
flaw('A13b', 'a loan has a term: unpaid after 5 game years it is forced down or the game ends', () => {
  const g = start(CLASSIC, [{type: 'TAKE_LOAN', amount: C.fin.maxLoan}], 5); const st = g.state;
  must(g, {type: 'SET_RULES', enabled: false}); must(g, {type: 'SET_MODE', mode: 'idle'}); let n = 0; while (st.day < 1800 && Sim.step(st) > 0 && n++ < 600000);
  assert.ok(st.bankrupt || st.loans < C.fin.maxLoan, 'day ' + st.day + ': loans still $' + st.loans + ', cash $' + Math.round(st.cash) + ', bankrupt ' + st.bankrupt);
});
flaw('A13c', 'a fully damaged dam crack has a consequence', () => {
  const run = (crack) => { const g = start(CLASSIC, [], 5); const st = g.state, s = st.sites[0]; if (crack) s.dam.crack = {elev: 0, damage: 100, w50: true};
    assert.ok(runToDay(g, 30)); return JSON.stringify([st.cash, st.stats.genMWh, s.upper.V, s.lower.V, s.dam.height, st.bankrupt]); };
  assert.notEqual(run(true), run(false), 'cash, energy, lake volumes and dam height are bit-identical with and without a 100%-damaged crack');
});
flaw('A13d', 'turbine wear matters: projected days to 0 health at default operation <= 1500', () => {
  const g = start(CLASSIC, [], 5); assert.ok(runToDay(g, 60)); const h = g.state.sites[0].turbine.health, days = 60 * 100 / (100 - h);
  assert.ok(days <= 1500, 'health ' + f(h, 2) + ' after 60 d -> ' + Math.round(days) + ' days to zero');
});
flaw('A13e', 'efficiency floor at 0 health is <= 0.7 (worn plant is noticeably worse)', () => {
  assert.ok(C.eff.healthFloor <= 0.7, 'healthFloor ' + C.eff.healthFloor);
});

/* ------------------------------------------------------------------ A14 construction / save */
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
flaw('A14a1', 'classic powerhouse position follows the lower basin after excavation', () => {
  const g = start(CLASSIC, [], 5); const st = g.state, s = st.sites[0]; st.cash = 1e8; must(g, {type: 'EXCAVATE'}); drain(st);
  const want = Sim.bowlR(s.lower, s.lower.hMax) + 30, got = dist(s.layout.ph, s.layout.lo); assert.ok(Math.abs(got - want) < 0.5, 'powerhouse ' + f(got) + ' m from the lake centre, basin now needs ' + f(want) + ' m');
});
flaw('A14a2', 'sculpt zone cache follows the lower basin after excavation', () => {
  const g = start(CLASSIC, [], 5); const st = g.state, s = st.sites[0]; st.cash = 1e8; SC.zones(s); must(g, {type: 'EXCAVATE'}); drain(st);
  const want = Sim.bowlR(s.lower, s.lower.hMax) * 1.2 + 34, got = SC.zones(s)[1].r; assert.ok(Math.abs(got - want) < 0.5, 'protected lower-lake radius ' + f(got) + ' m, want ' + f(want) + ' m');
});
flaw('A14a3', 'classic dam ring follows the dam height after a raise', () => {
  const g = start(CLASSIC, [], 5); const st = g.state, s = st.sites[0]; st.cash = 1e8; must(g, {type: 'RAISE_DAM', meters: 2}); drain(st);
  const want = Sim.bowlR(s.upper, s.dam.height - C.res.freeboard) + 15, got = s.layout.dam.r; assert.ok(Math.abs(got - want) < 0.5, 'dam ring r ' + f(got) + ' m after raising to ' + s.dam.height + ' m, want ' + f(want) + ' m');
});
flaw('A14b', 'PLACE_DAM at a new station keeps the upgraded penstock (diameter, material)', () => {
  const g = createGame(); g.newGame({seed: 3, kind: 'proc', bias: 'balanced', river: 'medium'}); const st = g.state, s = st.sites[0]; st.cash = 1e8; must(g, {type: 'START'}); must(g, {type: 'SET_SPEED', speed: 5});
  assert.equal(Sim.chokePoints(s.cp).length, 2, 'setup: seed 3 has two choke points');
  must(g, {type: 'REPLACE_PENSTOCK', D: 1.8, mat: 'hdpe'}); drain(st); assert.equal(s.penstock.mat, 'hdpe');
  must(g, {type: 'PLACE_DAM', station: 135, height: 12});
  assert.ok(s.penstock.mat === 'hdpe' && s.penstock.D === 1.8, 'penstock reset to ' + s.penstock.mat + ' D ' + s.penstock.D);
});
flaw('A14c', 'BUILD rejects a paid downgrade (T3 turbine to T1)', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 1e8; must(g, {type: 'BUILD', kind: 'turbine', tier: 2}); drain(st);
  const cash = st.cash, r = g.dispatch({type: 'BUILD', kind: 'turbine', tier: 0}); assert.equal(r.ok, false, 'downgrade accepted and charged $' + (cash - st.cash));
});
const SAVE_MUTATIONS = {
  market: o => { delete o.state.market; }, fin: o => { delete o.state.fin; }, god: o => { delete o.state.god; }, climate: o => { o.state.climate = null; }, quests: o => { delete o.state.quests; },
  contracts: o => { delete o.state.contracts; }, stats: o => { delete o.state.stats; }, rng: o => { o.state.rng = {}; }, alerts: o => { delete o.state.alerts; }, jobs: o => { delete o.state.jobs; }, queue: o => { delete o.state.queue; },
  turbine: o => { delete o.state.sites[0].turbine; }, pump: o => { delete o.state.sites[0].pump; }, penstock: o => { delete o.state.sites[0].penstock; }, auto: o => { delete o.state.sites[0].auto; },
  hist: o => { delete o.state.sites[0].hist; }, nullTile: o => { o.state.sites[0].tiles[3] = null; }, stringVolume: o => { o.state.sites[0].upper.V = 'x'; }
};
flaw('A14d', 'validateSave rejects truncated / corrupted saves', () => {
  const g = start(CLASSIC, [], 5); assert.ok(runToDay(g, 2)); const base = g.makeSave(); assert.equal(Sim.validateSave(base), null);
  const accepted = Object.keys(SAVE_MUTATIONS).filter(key => { const o = JSON.parse(JSON.stringify(base)); SAVE_MUTATIONS[key](o); return Sim.validateSave(o) === null; });
  assert.equal(accepted.length, 0, accepted.length + ' of ' + Object.keys(SAVE_MUTATIONS).length + ' corrupt saves accepted: ' + accepted.join(', '));
});
flaw('A14e', 'state hash is insensitive to last-bit float noise (cross-engine determinism; quantised hash is one valid fix)', () => {
  const g = start(CLASSIC, [], 5); assert.ok(runToDay(g, 1)); const st = g.state; const h0 = Sim.hashState(st); st.cash *= 1 + 4 * 2.220446049250313e-16;
  assert.equal(Sim.hashState(st), h0, 'a 4-ulp change of cash changes the hash');
});

/* ------------------------------------------------------------------ A15 quests */
flaw('A15a', 'the win asks for 16 of the 20 quests (intended: the four hardest are optional)', () => {
  assert.equal(C.win.quests, 16); assert.ok(Sim.QUESTS.length === 20 && C.win.quests < Sim.QUESTS.length && C.win.quests >= 0.75 * Sim.QUESTS.length, 'win.quests ' + C.win.quests + ' of ' + Sim.QUESTS.length);
});
flaw('A15b', 'q9 "Clockwork" does not complete without a player action', () => {
  const g = createGame(); g.newGame(CLASSIC); must(g, {type: 'SET_SPEED', speed: 2}); must(g, {type: 'START'}); assert.ok(runTicks(g, 240)); // 2 game hours
  assert.equal(g.state.quests.q9.done, false, 'q9 done after ' + g.state.hour + ' h (rulesSet ' + g.state.stats.rulesSet + ') with no player action');
});
flaw('A15c', 'q15 counts clock hours, not contract-hours (two overlapping contracts = 1 per hour)', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; assert.ok(runToDay(g, 14)); must(g, {type: 'SIGN_CONTRACT', id: st.contracts.offers[0].id}); assert.ok(runToDay(g, 15));
  const ev = st.contracts.offers.find(o => /^Evening/.test(o.name)); must(g, {type: 'SIGN_CONTRACT', id: ev.id}); for (const c of st.contracts.active) c.mw = 0.05;
  let n = 0; while (st.hour < 17 && n++ < 5000) Sim.step(st); must(g, {type: 'SET_MODE', mode: 'gen', q: 2});
  const f0 = st.contracts.fulfilledHours, d0 = st.day; n = 0; while (st.hour < 21 && st.day === d0 && n++ < 5000) Sim.step(st);
  assert.equal(st.contracts.active.length, 2, 'setup: two active contracts'); assert.equal(st.contracts.fulfilledHours - f0, 3, 'hours 18, 19, 20 counted ' + (st.contracts.fulfilledHours - f0) + ' times');
});
