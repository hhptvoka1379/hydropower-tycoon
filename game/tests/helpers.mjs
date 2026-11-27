/* Shared helpers for the golden tests and the baseline recorder. Not a test file (no .test.mjs suffix), so `node --test` does not run it.
   Everything here is deterministic: fixed seeds, no Math.random, no Date. The sim is driven only through its public API (game/sim/index.js). */
import Sim, {createGame} from '../sim/index.js';

export {Sim, createGame};

export const CLASSIC = {seed: 14692};
export const CANYON = {
  4242: {seed: 4242, kind: 'proc', bias: 'balanced', river: 'medium'},
  99: {seed: 99, kind: 'proc', bias: 'balanced', river: 'medium'},
  31337: {seed: 31337, kind: 'proc', bias: 'balanced', river: 'medium'}
};
/* Canyon starts begin without a dam: loan + a 12 m dam is the smallest "useful" opening that all three seeds can pay for (see A6). */
export const CANYON_SETUP = [{type: 'TAKE_LOAN', amount: 700000}, {type: 'PLACE_DAM', height: 12}];

/* Game wrapper, new game, optional setup actions (all must be accepted), START at the given speed index (0..5 = dt 1,5,30,60,120,300 s). */
export function start(opts, setup = [], speed = 2) {
  const g = createGame();
  g.newGame(opts); // wrapper dispatches SET_RULES enabled:true (default rules on) exactly like the UI does
  for (const a of setup) {
    const r = g.dispatch(a);
    if (!r.ok) throw new Error('setup action rejected: ' + JSON.stringify(a) + ' -> ' + r.reason);
  }
  g.dispatch({type: 'SET_SPEED', speed});
  g.dispatch({type: 'START'});
  return g;
}

/* Step until st.day >= day (the first step that makes st.day reach `day`, i.e. after `day` whole game days). Returns false if the game stalled (bankrupt). */
export function runToDay(g, day) {
  const st = g.state;
  while (st.day < day) { if (Sim.step(st) === 0) return false; }
  return true;
}
/* Step n ticks. */
export function runTicks(g, n) { const st = g.state; for (let i = 0; i < n; i++) if (Sim.step(st) === 0) return false; return true; }

export const lakes = (st, i = 0) => { const s = st.sites[i]; return {hU: Sim.resLevel(s.upper, s.upper.V), hL: Sim.resLevel(s.lower, s.lower.V)}; };
export const totalV = (st) => st.sites.reduce((a, s) => a + s.upper.V + s.lower.V, 0);

/* Water ledger: every flow the engine books. transfer and spillU move water between the two lakes (net zero); the rest crosses the system boundary.
   Expected change of (upper.V + lower.V) = riverIn + rainU + rainL + runoffU + runoffL - evapU - evapL - env - spillL. */
export function ledgerNet(s) {
  const l = s.ledger;
  return l.riverIn + l.rainU + l.rainL + l.runoffU + l.runoffL - l.evapU - l.evapL - l.env - l.spillL;
}
/* Mass-balance residual in m3 for site i between two snapshots (V0 = upper.V+lower.V, L0 = ledgerNet) taken earlier. */
export function massSnap(st, i = 0) { const s = st.sites[i]; return {V: s.upper.V + s.lower.V, L: ledgerNet(s)}; }
export const massResidual = (st, snap, i = 0) => { const n = massSnap(st, i); return (n.V - snap.V) - (n.L - snap.L); };

/* Recursively find the first non-finite number in a plain object tree (JSON hides NaN as null, so scan the live objects). */
export function findNonFinite(o, path = '$') {
  if (typeof o === 'number') return Number.isFinite(o) ? null : path + '=' + o;
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) { const r = findNonFinite(o[k], path + '.' + k); if (r) return r; }
  }
  return null;
}

export const round = (x, d = 2) => { const m = Math.pow(10, d); return Math.round(x * m) / m; };
