/* Headless bots for the pacing pass (Phase 6). Not a test file (no .test.mjs suffix).
   A bot reads the game ONLY through `g.getSnapshot()` (frozen copy) and `Sim.quote / Sim.raiseQuote / Sim.reserveCap` on that snapshot, and acts ONLY through `g.dispatch`.
   The one thing it does outside that API is advance the clock (`Sim.step` on the live state), exactly like the UI's frame loop. Every bot is deterministic: no clock, no randomness. */
import {Sim, createGame, CLASSIC, CANYON} from './helpers.mjs';

const C = Sim.CONFIG;

/* Advance one clock hour and return the settled hour line of site 0 (price, revenue, reserve availability pay, ...). Returns null when the sim cannot advance. */
export function stepHour(g) {
  const st = g.state, h0 = st.H;
  while (st.H === h0) { if (Sim.step(st) === 0) return null; }
  const s = st.sites[0]; return s.hist[s.hist.length - 1];
}

/* A running log of one game: per-day real profit (fin.lifetime, which never contains the assisted-mode subsidy), revenue split, cash and build decisions. */
export function newLog(g) {
  return {g, days: [], revenue: 0, reserveRevenue: 0, builds: [], decisions: [], buildDays: [], lastLife: g.state.fin.lifetime, dayRev: 0, dayReserve: 0};
}
/* Play `days` more game days. `daily(g, log, day)` is the bot's once-a-day decision hook, called at the start of every day (day = whole days played so far). */
export function play(log, days, daily, opts = {}) {
  const g = log.g, st = g.state; const end = st.day + days;
  while (st.day < end) {
    if (daily) daily(g, log, st.day);
    const d0 = st.day;
    while (st.day === d0) {
      const h = stepHour(g); if (!h) return log; // bankrupt / not started
      const rev = h.rev + h.avail; log.revenue += rev; log.reserveRevenue += h.avail; log.dayRev += rev; log.dayReserve += h.avail;
      if (opts.stopWhen && opts.stopWhen(st)) return log;
    }
    log.days.push({day: d0, profit: st.fin.lifetime - log.lastLife, cash: st.cash, loans: st.loans, revenue: log.dayRev, reserve: log.dayReserve, subsidy: st.fin.subsidy, bankrupt: st.bankrupt});
    log.lastLife = st.fin.lifetime; log.dayRev = 0; log.dayReserve = 0;
  }
  return log;
}
export const sum = (a, f = (x) => x) => a.reduce((t, x) => t + f(x), 0);
/* Mean real profit per day over the last n logged days. */
export const tailMean = (log, n) => { const d = log.days.slice(-n); return sum(d, (x) => x.profit) / Math.max(1, d.length); };
export const cumProfit = (log) => sum(log.days, (x) => x.profit);

export function newBotGame(opts = CLASSIC, setup = [], speed = 2) {
  const g = createGame(); g.newGame(opts); // the wrapper turns the default rules on, like the UI
  for (const a of setup) { const r = g.dispatch(a); if (!r.ok) throw new Error('setup rejected: ' + JSON.stringify(a) + ' ' + r.reason); }
  g.dispatch({type: 'SET_SPEED', speed}); g.dispatch({type: 'START'});
  return g;
}

/* ------------------------------------------------------------------ (1) default-rules bot: does nothing */
export const defaultBot = () => null;

/* ------------------------------------------------------------------ (2) greedy bot */
const KINDS = ['solar', 'wind', 'battery'];
const CASH_FLOOR = 40000; // the bot keeps the game's own operating reserve
/* Every build option that is open, affordable and has a positive quoted NPV, best NPV first. */
export function buildOptions(snap, cash = snap.cash - CASH_FLOOR) {
  const out = []; const s = snap.sites[0];
  for (let tile = 0; tile < 48; tile++) {
    const p = Math.floor(tile / 16); if (!s.parcels[p]) continue;
    for (const kind of KINDS) for (let tier = 0; tier < 3; tier++) {
      const q = Sim.quote(snap, 0, tile, kind, tier);
      if (q.ok && q.npv > 0 && q.cost <= cash) out.push({tile, kind, tier, cost: q.cost, npv: q.npv, payback: q.payback});
    }
  }
  return out.sort((a, b) => b.npv - a.npv);
}
/* Does one more metre of wall pay? The energy a day can cycle is the smaller of the stored energy (Sim.storageMWh) and what the turbine can pass in the peak hours; a metre adds to it only while storage is the
   limit, and always adds head (about 1/Hg of the turbine output). Valued at the day's cheap-to-peak spread, RTE, 360 days, over the game's discount horizon, against raiseQuote's price. */
export function raisePays(snap) {
  const s = snap.sites[0]; if (!s.dam.built || s.dam.raising || s.dam.crack) return null;
  const rq = Sim.raiseQuote(snap, 0, 1); if (!rq.ok) return null;
  const Hg = Sim.grossHead(s), T = C.turbine[s.turbine.tier];
  const pTurb = Sim.genPower(s, T.Qr, Hg).P / 1e6 * C.god.peakHours; // MWh a day the turbine can pass at peak
  const st0 = Sim.storageMWh(s, s.dam.height), st1 = Sim.storageMWh(s, s.dam.height + 1);
  const cyc0 = Math.min(st0, pTurb), cyc1 = Math.min(st1, pTurb) * (1 + 1 / Math.max(1, Hg));
  const spread = Math.max(0, snap.market.peak - snap.market.cheap);
  const r = C.fin.discount, af = (1 - Math.pow(1 + r, -C.fin.years)) / r;
  const pv = (cyc1 - cyc0) * spread * C.battery.rte * C.time.daysPerYear * af;
  return pv > rq.cost && rq.cost <= snap.cash - CASH_FLOOR ? {cost: rq.cost, pv} : null;
}
export function greedyDaily(g, log, day) {
  const snap = g.getSnapshot(); const s = snap.sites[0]; let did = 0;
  const rp = raisePays(snap); if (buildOptions(snap).length || rp) log.opportunity = (log.opportunity || 0) + 1; // a day on which cash allowed a positive-NPV decision
  for (const unit of ['turbine', 'pump']) if (s[unit].health < 60 && !s[unit].busy) { const r = g.dispatch({type: 'REPAIR', target: unit}); if (r.ok) log.decisions.push({day, what: 'repair ' + unit}); }
  if (rp) { const r = g.dispatch({type: 'RAISE_DAM', meters: 1}); if (r.ok) { did++; log.decisions.push({day, what: 'raise', cost: r.cost}); } }
  const opts = buildOptions(g.getSnapshot());
  if (opts.length) { const o = opts[0]; const r = g.dispatch({type: 'BUILD', kind: o.kind, tile: o.tile, tier: o.tier}); if (r.ok) { did++; log.builds.push({day, kind: o.kind, tier: o.tier, cost: r.cost, quotedNpv: o.npv, payback: o.payback}); log.decisions.push({day, what: 'build ' + o.kind + o.tier, cost: r.cost}); } }
  if (did) log.buildDays.push(day);
}

/* ------------------------------------------------------------------ (3) reserve-max bot: default rules + always offers the full reserve cap */
export function reserveDaily(g) {
  const st = g.getSnapshot(); const cap = Math.floor(Sim.reserveCap(st.sites[0]) / 1e6 * 1000) / 1000;
  if (cap > 0 && Math.abs(st.sites[0].reserveOffer - cap) > 1e-9) g.dispatch({type: 'SET_RESERVE_OFFER', mw: cap});
}

/* ------------------------------------------------------------------ (4) assisted bot: god mode (planner, protection) on from the start */
export const assistedSetup = [{type: 'SET_GOD', enabled: true, planner: true, protect: true}];

/* ------------------------------------------------------------------ (6) canyon bot: loan <= $400k, 12 m dam on day 0 */
export const canyonSetup = [{type: 'TAKE_LOAN', amount: 400000}, {type: 'PLACE_DAM', height: 12}];

/* ------------------------------------------------------------------ (7) reckless bot: never repairs, spends all cash and every loan on the dearest things it can buy, then ignores the plant */
export function recklessDaily(g, log, day) {
  const snap = g.getSnapshot();
  if (day === 0) { g.dispatch({type: 'TAKE_LOAN', amount: C.fin.maxLoan}); g.dispatch({type: 'SET_RULES', enabled: false}); g.dispatch({type: 'SET_MODE', mode: 'idle'}); }
  let guard = 0;
  while (guard++ < 40) { // dearest affordable purchase first, until nothing is affordable
    const cur = g.getSnapshot(); const s = cur.sites[0]; const cash = cur.cash; const cands = [];
    const add = (cost, act, grp = 0) => { if (cost <= cash && cost > 0) cands.push({cost, act, grp}); }; // grp 1 = renewables: bought last, the bot first buys what a careful owner would not (sites, permits, earthworks)
    if (!cur.permits.gravity) add(C.dam.classes.gravity.permit, {type: 'BUY_PERMIT', kind: 'dam', cls: 'gravity'});
    else if (!cur.permits.arch) add(C.dam.classes.arch.permit, {type: 'BUY_PERMIT', kind: 'dam', cls: 'arch'});
    for (const p of [1, 2]) if (!s.parcels[p]) add(C.land.parcelCost[p], {type: 'BUY_PERMIT', kind: 'parcel', parcel: p});
    for (let i = 0; i < 3; i++) { const sh = cur.shop[i]; if (sh.bought) continue; if (sh.permit) add(C.shop[i].cost, {type: 'BUY_SITE', id: i}); else add(C.shop[i].permit, {type: 'BUY_PERMIT', kind: 'water', id: i}); }
    if (s.lower.excav < C.res.excavStages && !cur.jobs.some((j) => j.kind === 'excavate')) add(C.res.excavCost * (1 + 0.5 * s.lower.excav), {type: 'EXCAVATE'});
    if (s.dam.built && !s.dam.raising && !s.dam.crack) { const rq = Sim.raiseQuote(cur, 0, 1); if (rq.ok) add(rq.cost, {type: 'RAISE_DAM', meters: 1}); }
    for (let tile = 0; tile < 48; tile++) { if (!s.parcels[Math.floor(tile / 16)]) continue; for (const kind of KINDS) { const t = s.tiles[tile]; if (t[kind] || (kind === 'wind' && t.battery) || (kind === 'battery' && t.wind)) continue; const q = Sim.quote(cur, 0, tile, kind, 2); if (q.ok) add(q.cost, {type: 'BUILD', kind, tile, tier: 2}, 1); } }
    if (!cands.length) break;
    cands.sort((a, b) => a.grp - b.grp || b.cost - a.cost); let done = false;
    for (const c of cands) { const r = g.dispatch(c.act); if (r.ok) { done = true; break; } }
    if (!done) break;
  }
}
