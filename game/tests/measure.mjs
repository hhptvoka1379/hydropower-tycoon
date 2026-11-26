/* Scenario measurements shared by record-baseline.mjs (writes baseline.json), baseline.test.mjs (compares to it) and flaws.test.mjs.
   Pure functions of fixed seeds: no Math.random, no Date. Each one drives the real sim through its public API. */
import {Sim, createGame, start, runToDay, runTicks, lakes, round, CLASSIC, CANYON, CANYON_SETUP} from './helpers.mjs';

/* ---------- 1. starts: 10-day and 30-day cash / income / lakes with default rules ---------- */
export const START_CASES = [
  {id: 'classic_14692', opts: CLASSIC, setup: []},
  {id: 'canyon_4242', opts: CANYON[4242], setup: CANYON_SETUP},
  {id: 'canyon_99', opts: CANYON[99], setup: CANYON_SETUP},
  {id: 'canyon_31337', opts: CANYON[31337], setup: CANYON_SETUP}
];
export function measureStarts() {
  const out = {};
  for (const c of START_CASES) {
    const g = start(c.opts, c.setup, 2); const st = g.state; const row = {cash0: st.cash};
    for (const d of [10, 30]) {
      runToDay(g, d); const L = lakes(st);
      row['day' + d] = {cash: st.cash, income: st.fin.lifetime, subsidy: st.fin.subsidy, hU: L.hU, hL: L.hL, genMWh: st.stats.genMWh, head: Sim.grossHead(st.sites[0])};
    }
    out[c.id] = row;
  }
  return out;
}

/* ---------- 2. dam price for a 40 m wall by route ---------- */
/* Total cash spent (sum of the `cost` of every accepted PLACE_DAM / RAISE_DAM) to reach `route`'s final height, buying each leg as its own action. */
export function damRoute(seed, route) {
  const g = createGame(); g.newGame(CANYON[seed]); const st = g.state;
  st.cash = 1e9; st.permits.gravity = true; st.permits.arch = true; // pricing test only: remove cash and permit limits
  g.dispatch({type: 'START'}); g.dispatch({type: 'SET_SPEED', speed: 5});
  let total = 0;
  const act = (a) => { const r = g.dispatch(a); if (!r.ok) throw new Error('damRoute: ' + JSON.stringify(a) + ' rejected: ' + r.reason); total += r.cost; };
  act({type: 'PLACE_DAM', height: route[0]});
  for (const m of route.slice(1)) { act({type: 'RAISE_DAM', meters: m}); while (st.jobs.length) Sim.step(st); }
  return {total, height: st.sites[0].dam.height, value: st.sites[0].dam.value};
}
export const DAM_ROUTES = {
  oneShot: [40],
  staged_32_8: [32, 8],
  steps_32_then_1m_x8: [32, 1, 1, 1, 1, 1, 1, 1, 1],
  steps_5_then_1m_x35: [5].concat(Array(35).fill(1)),
  staged_20_20: [20, 20]
};
export function measureDamPrices(seed = 4242) {
  const out = {};
  for (const k of Object.keys(DAM_ROUTES)) out[k] = damRoute(seed, DAM_ROUTES[k]).total;
  const v = Object.values(out); out.ratioMaxMin = Math.max(...v) / Math.min(...v);
  return out;
}

/* ---------- 3. battery: quoted value vs value realised over 30 days ---------- */
/* Quote (read-only, at game start) vs the cash difference between two identical 30-day runs, one of which bought the battery
   (cash topped up equally so purchases are never blocked; the build cost is added back). All figures are $/day net of battery O&M. */
export function measureBattery() {
  const out = [];
  for (const tier of [0, 1, 2]) {
    const a = start(CLASSIC, []), b = start(CLASSIC, []);
    a.state.cash = b.state.cash = 5e6;
    const q = Sim.quote(a.state, 0, 9, 'battery', tier);
    const r = b.dispatch({type: 'BUILD', kind: 'battery', tile: 9, tier});
    if (!r.ok) throw new Error('battery build rejected: ' + r.reason);
    runToDay(a, 30); runToDay(b, 30);
    const bt = b.state.sites[0].tiles[9].battery;
    out.push({tier, cost: q.cost, quotedPerDay: q.annual / 360, quotedNpv: q.npv, realisedPerDay: (b.state.cash - a.state.cash + r.cost) / 30, throughputMWh: bt.thr});
  }
  return out;
}

/* ---------- 4. god mode on vs off (30 days, default rules) ---------- */
export function measureGod() {
  const out = {};
  for (const c of [START_CASES[0], START_CASES[1]]) {
    const row = {};
    for (const god of [false, true]) {
      const g = start(c.opts, c.setup, 2); if (god) g.dispatch({type: 'SET_GOD', enabled: true, planner: true});
      runToDay(g, 30); const st = g.state;
      row[god ? 'on' : 'off'] = {cash: st.cash, income: st.fin.lifetime, subsidy: st.fin.subsidy, profitDays: st.stats.profitDays};
    }
    out[c.id] = row;
  }
  return out;
}

/* ---------- 5. reserve calls: pass count at each fixed step size ---------- */
/* 48 forced calls on the classic start (rules off), cycling through idle / generating / pumping base states and call sizes 0.4..1.1 x reserveCap.
   The same script is run at dt = 1, 5, 30, 60, 120, 300 s (speed index 0..5). Returns {dt: callsOk}. */
export const RESERVE_SPEEDS = [0, 1, 2, 3, 4, 5];
export function reservePass(speed, n = 48) {
  const g = start(CLASSIC, [], speed); const st = g.state; const s = st.sites[0]; g.dispatch({type: 'SET_RULES', enabled: false});
  const modes = [{mode: 'idle'}, {mode: 'gen', q: 1}, {mode: 'pump', q: 2}, {mode: 'gen', q: 0.6}, {mode: 'pump', q: 1.2}, {mode: 'gen', q: 2.5}];
  let ok = 0;
  for (let i = 0; i < n; i++) {
    g.dispatch(Object.assign({type: 'SET_MODE'}, modes[i % 6]));
    const hs = st.H; while (st.H < hs + 1) Sim.step(st); // run one full hour in the base state
    const mw = Sim.reserveCap(s) / 1e6 * (0.4 + 0.1 * (Math.floor(i / 6) % 8));
    const ok0 = st.reserve.ok; Sim.forceCall(st, 0, mw); while (s.call) Sim.step(st);
    if (st.reserve.ok > ok0) ok++;
  }
  return ok;
}
export function measureReserve() {
  const out = {n: 48};
  for (const sp of RESERVE_SPEEDS) out['dt' + Sim.CONFIG.time.dtBySpeed[sp]] = reservePass(sp);
  return out;
}

/* ---------- misc helpers used by flaw tests ---------- */
/* Sequence of scheduled grid emergencies over 90 days (classic, given seed), with or without a standing reserve offer. */
export function emergencySchedule(seed, offerMW, days = 90) {
  const g = start({seed}, [], 5); const st = g.state; if (offerMW) g.dispatch({type: 'SET_RESERVE_OFFER', mw: offerMW});
  const seen = []; let last = null;
  while (st.day < days) { Sim.step(st); const e = st.market.emergency; if (e) { const k = e.day + ':' + e.start + '+' + e.dur; if (k !== last) { last = k; seen.push(k); } } }
  return seen;
}

/* Volume of water above the drawn terrain, upstream of the dam, inside the canyon corridor, for a lake filled to depth h above the bed at the dam (m3). */
export function floodedVolume(s, h, step = 4) {
  const level = s.upper.bottom + h; let V = 0;
  for (let z = -800; z <= s.station; z += step) {
    const xc = Sim.cX(s.cp, z);
    for (let x = xc - 260; x <= xc + 260; x += step) { const t = Sim.terrainH(s, x, z); if (t < level) V += (level - t) * step * step; }
  }
  return V;
}

/* Bleed a classic game to bankruptcy with real (logged) actions only: max loan, spend everything on non-earning items, idle plant. Returns the game. */
export function bankruptGame() {
  const g = start(CLASSIC, [{type: 'TAKE_LOAN', amount: 800000}], 5); const st = g.state;
  const A = (a) => g.dispatch(a);
  A({type: 'SET_RULES', enabled: false}); A({type: 'SET_MODE', mode: 'idle'});
  A({type: 'BUY_PERMIT', kind: 'parcel', parcel: 1}); A({type: 'BUY_PERMIT', kind: 'parcel', parcel: 2});
  A({type: 'BUY_PERMIT', kind: 'dam', cls: 'gravity'}); A({type: 'BUY_PERMIT', kind: 'dam', cls: 'arch'});
  for (let k = 0; k < 4; k++) { A({type: 'EXCAVATE'}); while (st.jobs.length) Sim.step(st); }
  for (let n = 0; n < 20; n++) { if (!A({type: 'RAISE_DAM', meters: 1}).ok) break; while (st.jobs.length) Sim.step(st); }
  let guard = 0; while (Sim.step(st) > 0) { if (++guard > 2000000) throw new Error('bankruptGame: did not go bankrupt'); } // step returns 0 once bankrupt
  return g;
}
export {runTicks, round};
