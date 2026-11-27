/* Phase 1, batch 1 (sim fixes A1, A2, A3, A8-A10, A12b, A13, A14, A15): tests the per-ID flaws.test.mjs does not cover.
   Restructure flow end to end, subsidy kept out of earned figures and the win check, dam programme discount, route price band, replay with a restructure in the log.
   Deterministic: fixed seeds, no clock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Sim, createGame, start, runToDay, CLASSIC, CANYON, CANYON_SETUP} from './helpers.mjs';
import {measureDamPrices, bankruptGame} from './measure.mjs';

const C = Sim.CONFIG;
const must = (g, a) => { const r = g.dispatch(a); assert.ok(r.ok, 'action rejected: ' + JSON.stringify(a) + ' -> ' + r.reason); return r; };
const no = (g, a, re) => { const r = g.dispatch(a); assert.equal(r.ok, false, 'should be rejected: ' + JSON.stringify(a)); assert.ok(typeof r.reason === 'string' && r.reason.length > 3, 'a reason is required'); if (re) assert.match(r.reason, re); return r; };
const drain = (st) => { let n = 0; while (st.jobs.length && n++ < 300000) Sim.step(st); assert.equal(st.jobs.length, 0); };

/* ---------------------------------------------------------------- restructure (A13b, decisions D6) */
test('bankrupt: the sim stops, offers a way out, and runs on after a refinance', () => {
  const g = bankruptGame(); const st = g.state; assert.ok(st.bankrupt); const tick = st.tick;
  assert.equal(Sim.step(st), 0, 'a bankrupt sim waits for the player');
  const opt = Sim.restructureOptions(st); assert.ok(opt.bankrupt && opt.refinance.rate > C.fin.loanRate && opt.sell.total > 0);
  no(g, {type: 'RESTRUCTURE', plan: 'nonsense'}, /plan/i);
  const loans0 = st.loans; must(g, {type: 'RESTRUCTURE', plan: 'refinance'});
  assert.equal(st.bankrupt, false); assert.ok(st.cash >= C.fin.refiCash - 1e-6, 'working capital restored'); assert.ok(st.loans > loans0, 'overdraft rolled into the loan'); assert.equal(st.loanRate, C.fin.refiRate); assert.equal(st.loanBook.length, 1);
  no(g, {type: 'TAKE_LOAN', amount: 1000}, /credit limit/i); // credit limit is cut for 30 days
  assert.ok(Sim.step(st) > 0 && st.tick > tick, 'the sim runs on');
  no(g, {type: 'RESTRUCTURE', plan: 'refinance'}, /bankrupt/i);
  // recovery: automation on, 60 days. The plant earns and the game does not freeze again.
  must(g, {type: 'SET_RULES', enabled: true}); const cashA = st.cash; assert.ok(runToDay(g, st.day + 60), 'stalled again'); assert.equal(st.bankrupt, false);
  assert.ok(st.cash > cashA - 20000, 'cash does not collapse (from ' + Math.round(cashA) + ' to ' + Math.round(st.cash) + ')');
  assert.ok(Number.isFinite(st.cash) && Math.abs(st.loans - st.loanBook.reduce((a, x) => a + x.amt, 0)) < 1e-6, 'loan book matches loans');
});
test('bankrupt: selling tiles at 50% of cost is the other way out', () => {
  const g = bankruptGame(); const st = g.state; const s = st.sites[0]; st.cash = -30000; // a shallow overdraft: the starter array's 50% sale value ($37,500) clears it
  no(g, {type: 'RESTRUCTURE', plan: 'sell', tiles: []}, /at least one/i);
  no(g, {type: 'RESTRUCTURE', plan: 'sell', tiles: [5]}, /nothing to sell/i);
  const eq = C.solar.tiers[1].kWp * C.solar.tiers[1].costKW, want = C.fin.sellFrac * (eq + C.land.tileCost);
  const cash0 = st.cash, loans0 = st.loans; const r = must(g, {type: 'RESTRUCTURE', plan: 'sell', tiles: [0]});
  assert.ok(Math.abs(r.proceeds - want) < 1e-6, 'proceeds ' + r.proceeds + ' vs ' + want); assert.ok(Math.abs(st.cash - (cash0 + want)) < 1e-6); assert.equal(st.loans, loans0, 'debt is untouched');
  assert.equal(s.tiles[0].solar, null); assert.equal(st.bankrupt, false); assert.ok(Sim.step(st) > 0);
  no(g, {type: 'RESTRUCTURE', plan: 'sell', tiles: [0]}, /bankrupt/i);
});
test('bankrupt: a sale that cannot clear the overdraft is refused with a reason, nothing changes', () => {
  const g = bankruptGame(); const st = g.state; const s = st.sites[0]; s.tiles[0].solar.tier = 0; st.cash = -900000; const snap = JSON.stringify(st.sites[0].tiles);
  no(g, {type: 'RESTRUCTURE', plan: 'sell', tiles: [0]}, /not enough/i); assert.equal(JSON.stringify(st.sites[0].tiles), snap); assert.ok(st.bankrupt);
});
test('EMERGENCY_CREDIT: refused at the credit limit with a pointer to restructure; replay with a restructure in the log reproduces the hash', () => {
  const g = bankruptGame(); const st = g.state; no(g, {type: 'EMERGENCY_CREDIT'}, /restructure/i); assert.ok(st.loans <= C.fin.maxLoan);
  must(g, {type: 'RESTRUCTURE', plan: 'refinance'}); must(g, {type: 'SET_RULES', enabled: true}); assert.ok(runToDay(g, st.day + 20));
  const sv = g.makeSave(); assert.equal(Sim.validateSave(sv), null); const rp = Sim.replay(sv.init, sv.log, sv.state.tick);
  assert.equal(Sim.hashState(rp), Sim.hashState(st), 'replay == live across a bankruptcy and a restructure');
});
test('loan term: a loan past its term is paid down from cash above the reserve and the rest extended', () => {
  const g = start(CLASSIC, [{type: 'TAKE_LOAN', amount: 100000}], 5); const st = g.state; assert.equal(st.loanBook.length, 1); assert.equal(st.loanBook[0].due, C.fin.termDays);
  st.cash = 60000; st.day = C.fin.termDays - 1; st.hour = 23; st.secInHour = 3599; let n = 0; while (st.day < C.fin.termDays && n++ < 10) Sim.step(st);
  assert.ok(st.loans < 100000 && st.loans > 50000, 'partly repaid, loans ' + st.loans); assert.ok(st.loanBook[0].due >= st.day + C.fin.extendDays - 1);
});

/* ---------------------------------------------------------------- subsidy (A1) */
test('god protect is off by default and a default god run books no subsidy', () => {
  const g = start(CANYON[4242], CANYON_SETUP, 2); assert.equal(g.state.god.protect, false); must(g, {type: 'SET_GOD', enabled: true, planner: true}); assert.ok(runToDay(g, 20)); assert.equal(g.state.fin.subsidy, 0);
});
test('subsidy is excluded from netWorth, quest q19 and the win check, and realCash gives cash without it', () => {
  const g = start(CLASSIC, [], 2); const st = g.state; const nw0 = Sim.netWorth(st);
  st.fin.subsidy = 123456; st.cash += 123456; assert.ok(Math.abs(Sim.realCash(st) - (st.cash - 123456)) < 1e-9); assert.ok(Math.abs(Sim.netWorth(st) - nw0) < 1e-6, 'net worth unchanged by subsidy cash');
  const q19 = Sim.QUESTS.find(q => q.id === 'q19'); st.cash = 800000; st.fin.subsidy = 100000; assert.equal(q19.ok(st), false, 'cash 800k of which 100k subsidy is not "hold $750k"'); st.fin.subsidy = 0; assert.equal(q19.ok(st), true);
  // win check: every quest claimed, cash above the target only because of subsidy
  for (const q of Sim.QUESTS) st.quests[q.id] = {done: true, claimed: true};
  const assets = Sim.netWorth(st) - st.cash + st.loans + st.fin.subsidy; st.cash = C.win.netWorth - 100000 - assets + 300000; st.fin.subsidy = 300000; let n = 0; while (st.hour < 23 && n++ < 5000) Sim.step(st); n = 0; const h0 = st.H; while (st.H === h0 && n++ < 5000) Sim.step(st);
  assert.equal(st.won, false, 'subsidy must not win the game'); st.fin.subsidy = 0; n = 0; const h1 = st.H; while (st.H === h1 && n++ < 5000) Sim.step(st); assert.equal(st.won, true, 'real net worth above the target wins');
});
test('god profit top-up: protect on books to fin.subsidy, never to profitToday', () => {
  const g = start(CANYON[4242], CANYON_SETUP, 2); must(g, {type: 'SET_GOD', enabled: true, planner: true, protect: true}); const st = g.state; assert.ok(runToDay(g, 30));
  assert.ok(st.fin.subsidy > 0);
  const sumDay = st.fin.dayHist.reduce((a, x) => a + x, 0) + st.fin.profitToday; assert.ok(Math.abs(sumDay - st.fin.lifetime) < 1e-3, 'day profits add up to real income only (' + sumDay + ' vs ' + st.fin.lifetime + ')');
});

/* ---------------------------------------------------------------- dam price (A3, D5) */
const PRICE_BAND = 1.15;
test('route price band: every purchase route within 15% of every other (canyon seeds 4242 / 99 / 31337)', () => {
  for (const sd of [4242, 99, 31337]) { const m = measureDamPrices(sd); assert.ok(m.ratioMaxMin <= PRICE_BAND, 'seed ' + sd + ' ratio ' + m.ratioMaxMin.toFixed(3)); }
});
test('route price band: classic wall 30 to 45 m in one step vs one metre at a time', () => {
  const run = (steps) => { const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 1e9; st.permits.gravity = st.permits.arch = true; let t = 0;
    for (const m of steps) { const r = must(g, {type: 'RAISE_DAM', meters: m}); t += r.cost; drain(st); } return t; };
  const one = run([15]), fine = run(Array(15).fill(1)), two = run([8, 7]);
  const hi = Math.max(one, fine, two), lo = Math.min(one, fine, two); assert.ok(hi / lo <= PRICE_BAND, 'classic ratio ' + (hi / lo).toFixed(3) + ' (' + Math.round(one) + ' / ' + Math.round(two) + ' / ' + Math.round(fine) + ')');
});
test('dam price: premium is 8% at most and only for big single steps', () => {
  const g = start(CANYON[4242], [], 5); const st = g.state; st.cash = 1e9; st.permits.gravity = st.permits.arch = true;
  const q = (h0, h1) => Sim.damPrice(st, st.sites[0], null, h0, h1);
  assert.equal(q(0, 5).premium, 0); assert.equal(q(0, 5).cost, q(0, 5).base); assert.ok(Math.abs(q(0, 40).premium - 0.08) < 1e-12); assert.ok(q(0, 22).premium > 0 && q(0, 22).premium < 0.08);
  assert.ok(Math.abs(q(0, 40).base - (q(0, 12).base + q(12, 40).base)) < 1e-6, 'the core is route independent (additive)');
});
test('PLAN_DAM: discount 1.25% per declared stage, max 5%, only with 2 days of lead; validation reasons', () => {
  const play = (offsets, wait) => { const g = createGame(); g.newGame(CANYON[4242]); const st = g.state; st.cash = 1e9; st.permits.gravity = st.permits.arch = true; must(g, {type: 'START'}); must(g, {type: 'SET_SPEED', speed: 5});
    must(g, {type: 'PLACE_DAM', height: 10}); drain(st); if (offsets) must(g, {type: 'PLAN_DAM', stages: offsets.map(([h, d]) => ({h, day: st.day + d}))}); assert.ok(runToDay(g, st.day + wait)); const r = must(g, {type: 'RAISE_DAM', meters: 10}); return {r, st, g}; };
  const base = play(null, 3).r.cost;
  const d = (offsets, wait) => 1 - play(offsets, wait).r.cost / base;
  const four = [[20, 3], [30, 6], [40, 9], [50, 12]];
  assert.ok(Math.abs(d(four, 3) - 0.05) < 1e-9, 'four stages: ' + d(four, 3)); assert.ok(Math.abs(d([[20, 3]], 3) - 0.0125) < 1e-9); assert.ok(Math.abs(d([[20, 3], [30, 6]], 3) - 0.025) < 1e-9);
  assert.ok(Math.abs(d(four.concat([[60, 15]]), 3) - 0.05) < 1e-9, 'never more than 5%');
  assert.ok(Math.abs(d(four, 1)) < 1e-12, 'a raise 1 day after the declaration gets no discount');
  assert.ok(Math.abs(d([[25, 3]], 3)) < 1e-12, 'a raise that matches no declared stage gets no discount');
  const g = play(null, 0).g; const day = g.state.day; no(g, {type: 'PLAN_DAM', stages: [{h: 30, day: day + 1}]}, /days/i); no(g, {type: 'PLAN_DAM', stages: [{h: 8, day: day + 5}]}, /rise/i); no(g, {type: 'PLAN_DAM'}, /stages/i);
  assert.ok(d(four, 3) <= 0.05 + 1e-9);
});

/* ---------------------------------------------------------------- the rest, spot checks */
test('rejections carry a human reason and never change the replayed state', () => {
  const g = start(CLASSIC, [], 2); const st = g.state;
  for (const a of [{type: 'RAISE_DAM', meters: 99}, {type: 'BUILD', kind: 'turbine', tier: 7}, {type: 'TAKE_LOAN', amount: 9e9}, {type: 'RESTRUCTURE', plan: 'sell', tiles: [1]}, {type: 'EMERGENCY_CREDIT', x: 1}, {type: 'NOPE'}, {type: 'PLAN_DAM', stages: 'x'}]) {
    const r = g.dispatch(a); if (a.type !== 'EMERGENCY_CREDIT') { assert.equal(r.ok, false, JSON.stringify(a)); assert.ok(r.reason && r.reason.length > 3); } }
  assert.ok(runToDay(g, 2)); const sv = g.makeSave(); assert.equal(Sim.hashState(Sim.replay(sv.init, sv.log, sv.state.tick)), Sim.hashState(st));
});
test('downgrade is refused with a reason; a same-tier refit of a worn unit is still allowed', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 1e8; must(g, {type: 'BUILD', kind: 'turbine', tier: 2}); drain(st);
  no(g, {type: 'BUILD', kind: 'turbine', tier: 0}, /downgrade/i); st.sites[0].turbine.health = 50; must(g, {type: 'BUILD', kind: 'turbine', tier: 2});
});
test('repair cost scales with damage', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; st.cash = 1e8; const u = st.sites[0].turbine; const T = C.turbine[u.tier].cost;
  u.health = 99; const a = must(g, {type: 'REPAIR', target: 'turbine'}).cost; drain(st); u.health = 40; const b = must(g, {type: 'REPAIR', target: 'turbine'}).cost; drain(st);
  assert.ok(a < 0.04 * T && b > 0.15 * T && b > 4 * a, 'repair $' + Math.round(a) + ' for 1% damage, $' + Math.round(b) + ' for 60%');
});
test('a cracked dam holds less water, and repair lifts the derate', () => {
  const g = start(CLASSIC, [], 5); const st = g.state; const s = st.sites[0]; const c0 = Sim.capU(s);
  s.dam.crack = {elev: 0, damage: 100, w50: true}; assert.ok(Math.abs(Sim.capU(s) - Sim.resVol(s.upper, (s.dam.height - C.res.freeboard) * 0.8)) < 1e-6, 'max level -20% at full damage'); assert.ok(Sim.capU(s) < c0);
  s.dam.crack.damage = 0; assert.ok(Sim.capU(s) < c0 && Sim.capU(s) > Sim.resVol(s.upper, (s.dam.height - C.res.freeboard) * 0.8), 'a fresh crack derates less than a damaged one');
  st.cash = 1e7; must(g, {type: 'REPAIR', target: 'dam'}); drain(st); assert.equal(s.dam.crack, null); assert.ok(Math.abs(Sim.capU(s) - c0) < 1e-6);
});
test('q9 counts only automation actions in a started game (the default rules do not)', () => {
  const g = start(CLASSIC, [], 2); const st = g.state; assert.equal(st.stats.rulesSet, 0); must(g, {type: 'SET_RULES', enabled: false}); must(g, {type: 'SET_RULES', enabled: true}); assert.equal(st.stats.rulesSet, 1);
});
