/* Phase 6 pacing: deterministic headless bots play the first game days through the public API and the economy must meet eight targets
   (FABLE_PLAN.md Phase 6; the tuned constants and their before/after values are in game/notes/flaw-repro.md, "Phase 6 tuning").
   Bots live in bot.mjs. Classic = seed 14692, canyon = seeds 4242 / 99 / 31337. No clock, no randomness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Sim, CLASSIC, CANYON, start, runToDay} from './helpers.mjs';
import * as B from './bot.mjs';

const C = Sim.CONFIG;
const f = (x, d = 0) => (typeof x === 'number' ? +x.toFixed(d) : x);
const play = (setup, daily, days = 30, opts = CLASSIC, speed = 2) => { const g = B.newBotGame(opts, setup, speed); const log = B.newLog(g); B.play(log, days, daily); return log; };
const cache = {};
const memo = (k, fn) => (cache[k] || (cache[k] = fn()));
const defaultRun = () => memo('default', () => play([], B.defaultBot));
const greedyRun = () => memo('greedy', () => play([], B.greedyDaily));

test('1. classic, default rules: the first game day ends in real profit, and $10k by day 30', () => {
  const l = defaultRun();
  assert.ok(l.days[0].profit > 0, 'day 0 real profit $' + f(l.days[0].profit));
  assert.ok(B.cumProfit(l) >= 10000, 'day 30 cumulative real profit $' + f(B.cumProfit(l)));
  assert.equal(l.g.state.fin.subsidy, 0, 'default rules never take a subsidy');
});

test('2. quotes are honest and worth it: a 0.5-4 year payback in every family, none under 0.5, realised within 40% of quoted', () => {
  const g = B.newBotGame(CLASSIC); const snap = g.getSnapshot(); const rows = [];
  for (const kind of ['solar', 'wind', 'battery']) {
    let good = false;
    for (let tier = 0; tier < 3; tier++) {
      const q = Sim.quote(snap, 0, kind === 'battery' ? 9 : 5, kind, tier); assert.ok(q.ok);
      assert.ok(q.payback >= 0.5, kind + tier + ' payback ' + f(q.payback, 2) + ' years is under 0.5');
      if (q.npv > 0 && q.payback <= 4) good = true; rows.push(kind[0] + (tier + 1) + ' ' + f(q.payback, 1) + 'y');
    }
    assert.ok(good, 'no ' + kind + ' tier has positive NPV and payback <= 4 years (' + rows.join(' ') + ')');
  }
  // realised: two identical 30-day runs, one with the asset; the cash difference plus its price, per day, against the quote's annual / 360 (both net of the asset's own O&M)
  const bad = [];
  for (const [kind, tile] of [['solar', 5], ['wind', 2], ['battery', 9]]) for (let tier = 0; tier < 3; tier++) {
    const a = start(CLASSIC, [], 2), b = start(CLASSIC, [], 2); a.state.cash = b.state.cash = 5e7;
    const q = Sim.quote(a.state, 0, tile, kind, tier); const r = b.dispatch({type: 'BUILD', kind, tile, tier}); assert.ok(r.ok);
    runToDay(a, 30); runToDay(b, 30); const real = (b.state.cash - a.state.cash + r.cost) / 30, quoted = q.annual / C.time.daysPerYear;
    if (Math.abs(real / quoted - 1) > 0.4) bad.push(kind + tier + ' realised $' + f(real, 1) + '/d vs quoted $' + f(quoted, 1) + '/d (x' + f(real / quoted, 2) + ')');
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

test('3. greedy bot: builds, earns 15% more than the default bot, and decides whenever cash allows', () => {
  const l = greedyRun(), d = defaultRun();
  const builds = l.builds.length, gi = B.tailMean(l, 10), di = B.tailMean(d, 10);
  assert.ok(builds >= 2, 'builds by day 30: ' + builds + ' (' + l.builds.map((b) => 'day ' + b.day + ' ' + b.kind + (b.tier + 1)).join(', ') + ')');
  assert.ok(gi >= 1.15 * di, 'day-30 daily real income (last 10 days) greedy $' + f(gi) + ' vs default $' + f(di) + ' (x' + f(gi / di, 2) + ')');
  // "a build decision at least every ~3 game days while cash allows": of the days on which a positive-NPV option was affordable, at least a third carry a decision
  assert.ok(l.opportunity > 0 && l.buildDays.length >= l.opportunity / 3, 'decision days ' + l.buildDays.length + ' of ' + l.opportunity + ' days with an affordable positive-NPV option');
});

test('4. reserve is not dominant: the reserve-max bot earns at most 35% of its revenue from reserve', () => {
  const l = play([], B.reserveDaily); const share = l.reserveRevenue / l.revenue;
  assert.ok(l.reserveRevenue > 0, 'the bot did offer reserve'); assert.ok(share <= 0.35, 'reserve revenue $' + f(l.reserveRevenue) + ' of $' + f(l.revenue) + ' = ' + f(100 * share, 1) + '%');
});

test('5. assisted mode is not dominant in honest terms: real income <= 1.5x the greedy bot; the subsidy is reported apart', () => {
  const l = play(B.assistedSetup, null), st = l.g.state, gr = greedyRun();
  const ai = B.tailMean(l, 10), gi = B.tailMean(gr, 10);
  assert.ok(ai <= 1.5 * gi, 'assisted real income $' + f(ai) + '/d vs greedy $' + f(gi) + '/d (x' + f(ai / gi, 2) + ')');
  assert.ok(st.fin.subsidy >= 0 && Math.abs(Sim.realCash(st) - (st.cash - st.fin.subsidy)) < 1e-6, 'subsidy $' + f(st.fin.subsidy) + ' is its own ledger line');
  assert.ok(Math.abs(B.cumProfit(l) - st.fin.lifetime) < 1e-6, 'logged real profit excludes the subsidy');
});

test('6. canyon (4242 / 99 / 31337): $400k loan + 12 m dam on day 0 is profitable by day 10 and never bankrupt in 30 days', () => {
  for (const sd of [4242, 99, 31337]) {
    const l = play(B.canyonSetup, B.defaultBot, 30, CANYON[sd]); const c10 = B.sum(l.days.slice(0, 10), (x) => x.profit), t3 = B.sum(l.days.slice(7, 10), (x) => x.profit) / 3;
    assert.ok(c10 > 0 && t3 > 0, 'seed ' + sd + ': cumulative real profit at day 10 $' + f(c10) + ', last three days $' + f(t3) + '/d');
    assert.ok(l.days.every((x) => !x.bankrupt && x.cash > C.fin.bankrupt), 'seed ' + sd + ' went bankrupt'); assert.equal(l.days.length, 30);
  }
});

test('7. stakes are real but cozy: a reckless bot reaches the restructure state within 400 days; a refinance is profitable again within 60', () => {
  const g = B.newBotGame(CLASSIC, [], 5), log = B.newLog(g); B.play(log, 400, B.recklessDaily, {stopWhen: (st) => st.bankrupt});
  const st = g.state; assert.ok(st.bankrupt && st.day <= 400, 'not bankrupt after ' + st.day + ' days (cash $' + f(st.cash) + ', loans $' + f(st.loans) + ')');
  assert.ok(Sim.restructureOptions(st).bankrupt);
  assert.ok(g.dispatch({type: 'RESTRUCTURE', plan: 'refinance'}).ok); assert.ok(g.dispatch({type: 'SET_RULES', enabled: true}).ok);
  const l2 = B.newLog(g); B.play(l2, 60, B.defaultBot);
  assert.equal(st.bankrupt, false); assert.ok(B.cumProfit(l2) > 0 && B.sum(l2.days.slice(0, 30), (x) => x.profit) > 0, 'real profit in the 60 days after refinancing: $' + f(B.cumProfit(l2)));
});

test('8. grid emergencies are telegraphed: every emergency in 60 days was announced at least 2 h ahead, with a delivery reward', () => {
  const g = B.newBotGame(CLASSIC, [], 5), st = g.state, seen = new Map(); let n = 0;
  while (st.day < 60 && n++ < 400000) {
    if (Sim.step(st) === 0) break; const w = st.gridWarning;
    if (w) { const key = w.day + ':' + w.start; if (!seen.has(key)) seen.set(key, {firstSeenH: st.H, w: Object.assign({}, w), began: null}); }
    const e = st.market.emergency; if (e && e.day === st.day && st.hour >= e.start && st.hour < e.start + e.dur) { const r = seen.get(e.day + ':' + e.start); if (r && r.began === null) r.began = st.H; else if (!r) assert.fail('emergency on day ' + e.day + ' started with no warning in the state'); }
  }
  assert.ok(seen.size >= 3, 'emergencies in 60 days: ' + seen.size);
  for (const [k, r] of seen) {
    assert.ok(r.w.startsAt - r.firstSeenH >= 2, 'emergency ' + k + ' announced ' + (r.w.startsAt - r.firstSeenH) + ' h ahead');
    assert.equal(r.began, r.w.startsAt, 'emergency ' + k + ': the announced start ' + r.w.startsAt + ' is not the real start ' + r.began);
    assert.ok(r.w.hours >= 2 && r.w.mwShort > 0 && r.w.bonusPerMWh === C.market.emergBonus && r.w.bonusPerMWh > 0 && r.w.priceMult > 1, 'warning carries hours, MW short and the reward');
  }
  assert.equal(st.gridWarning === null || st.gridWarning.startsAt + st.gridWarning.hours > st.H, true, 'an expired warning is cleared');
});
