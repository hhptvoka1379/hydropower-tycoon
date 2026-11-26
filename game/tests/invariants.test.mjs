/* Invariants that must hold today and after every fix: water conservation, V(h) inversion, replay / clone / save determinism, finite numbers.
   These are NOT flaw tests: if one fails, something real broke. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Sim, createGame, start, runToDay, lakes, massSnap, massResidual, findNonFinite, CLASSIC, CANYON, CANYON_SETUP} from './helpers.mjs';

const must = (g, a) => { const r = g.dispatch(a); assert.ok(r.ok, 'action rejected: ' + JSON.stringify(a) + ' -> ' + r.reason); return r; };

/* ---------- 1. mass balance: d(upper.V + lower.V) == sum of booked boundary flows, to <= 1 m3 ---------- */
/* actions: {day: [actions]} applied the first time st.day reaches that day (after the setup, whose effects are inside the baseline snapshot). */
function massCase(name, opts, setup, actions, days, speed = 2) {
  test('mass balance ' + name, () => {
    const g = start(opts, setup, speed); const st = g.state;
    const snap = massSnap(st); const V0 = st.sites[0].upper.V + st.sites[0].lower.V;
    for (const d of Object.keys(actions).map(Number).sort((a, b) => a - b)) { assert.ok(runToDay(g, d), 'game stalled'); for (const a of actions[d]) must(g, a); }
    assert.ok(runToDay(g, days), 'game stalled');
    const res = massResidual(st, snap);
    assert.ok(Math.abs(res) <= 1, 'water not conserved: residual ' + res + ' m3 over ' + days + ' days');
    const L = st.sites[0].ledger; // the ledger must actually have moved water, otherwise the check is vacuous
    assert.ok(Math.abs(L.transfer) > 1e3 || L.riverIn > 1e3 || L.rainL > 1e2, 'ledger shows no water movement');
    assert.ok(st.sites[0].upper.V + st.sites[0].lower.V !== V0, 'total volume never changed');
  });
}
massCase('classic, 30 days', CLASSIC, [], {}, 30);
massCase('classic, excavation + dam raise, 30 days', CLASSIC, [{type: 'TAKE_LOAN', amount: 500000}, {type: 'EXCAVATE'}, {type: 'RAISE_DAM', meters: 2}], {15: [{type: 'EXCAVATE'}]}, 30);
massCase('classic, 90 days at dt 300 s (snow, ice, spill)', CLASSIC, [], {}, 90, 5);
massCase('canyon 4242, 30 days', CANYON[4242], CANYON_SETUP, {}, 30);
massCase('canyon 4242, excavation + dam raise, 30 days', CANYON[4242], CANYON_SETUP.concat([{type: 'EXCAVATE'}, {type: 'RAISE_DAM', meters: 4}]), {12: [{type: 'RAISE_DAM', meters: 2}]}, 30);
massCase('canyon 99, 30 days', CANYON[99], CANYON_SETUP, {}, 30);
massCase('canyon 31337, 30 days', CANYON[31337], CANYON_SETUP.concat([{type: 'EXCAVATE'}]), {}, 30);
massCase('canyon 31337, 90 days at dt 300 s', CANYON[31337], CANYON_SETUP, {}, 90, 5);

/* ---------- 2. V(h) <-> h round trip ---------- */
test('resLevel(resVol(h)) == h to 1e-6 on every reservoir', () => {
  const sites = [];
  let g = createGame(); g.newGame(CLASSIC); sites.push(['classic', g.state.sites[0]]);
  g = start(CLASSIC, [], 2); must(g, {type: 'EXCAVATE'}); while (g.state.jobs.length) Sim.step(g.state); sites.push(['classic excavated', g.state.sites[0]]);
  for (const sd of [4242, 99, 31337]) { g = createGame(); g.newGame(CANYON[sd]); g.state.cash = 1e9; must(g, {type: 'PLACE_DAM', height: 30}); sites.push(['canyon ' + sd, g.state.sites[0]]); }
  for (const bias of ['gentle', 'rugged']) { g = createGame(); g.newGame({seed: 4242, kind: 'proc', bias, river: 'small'}); g.state.cash = 1e9; must(g, {type: 'PLACE_DAM', height: 25}); sites.push(['canyon ' + bias, g.state.sites[0]]); }
  let n = 0;
  for (const [name, s] of sites) {
    for (const [which, r, hMax] of [['upper', s.upper, 32], ['lower', s.lower, s.lower.hMax + 2]]) {
      for (let h = 0.05; h <= hMax; h += 0.05) {
        const V = Sim.resVol(r, h); const h2 = Sim.resLevel(r, V); n++;
        assert.ok(Math.abs(h2 - h) < 1e-6, name + ' ' + which + ': h=' + h.toFixed(2) + ' -> V=' + V.toFixed(1) + ' -> h=' + h2);
      }
    }
    assert.equal(Sim.resLevel(s.upper, 0), 0); assert.equal(Sim.resLevel(s.lower, 0), 0);
  }
  assert.ok(n > 4000);
});

/* ---------- 3. replay determinism ---------- */
/* A scripted game that only uses accepted actions (rejections are tracked separately under flaw A8a). */
const SCRIPT = {
  0: [{type: 'TAKE_LOAN', amount: 800000}, {type: 'BUILD', kind: 'solar', tile: 5, tier: 0}, {type: 'BUILD', kind: 'wind', tile: 2, tier: 0}, {type: 'BUILD', kind: 'battery', tile: 9, tier: 0}, {type: 'SET_RESERVE_OFFER', mw: 0.1}, {type: 'SET_CURTAIL', frac: 0.1}],
  2: [{type: 'SIGN_CONTRACT', id: 'c1'}, {type: 'SET_GOD', enabled: true, planner: true}],
  4: [{type: 'RAISE_DAM', meters: 2}, {type: 'EXCAVATE'}],
  6: [{type: 'SET_GOD', enabled: false}, {type: 'SET_MODE', mode: 'gen', q: 3}],
  9: [{type: 'SET_RULES', enabled: true}, {type: 'SET_BATTERY', tile: 9, mode: 'charge'}],
  12: [{type: 'SET_MODE', mode: 'pump', q: 2}, {type: 'SET_SPEED', speed: 3}]
};
function playScript(days, speed = 2) {
  const g = start(CLASSIC, [], speed); const st = g.state;
  for (let d = 0; d <= days; d++) {
    assert.ok(runToDay(g, d), 'stalled'); if (SCRIPT[d]) for (const a of SCRIPT[d]) must(g, a);
  }
  return g;
}
test('replay of the action log reproduces the live state hash', () => {
  const g = playScript(14);
  const save = g.makeSave();
  assert.ok(save.log.length > 10);
  const live = Sim.hashState(g.state);
  const r1 = Sim.replay(save.init, save.log, save.state.tick);
  assert.equal(Sim.hashState(r1), live, 'replay hash != live hash');
  const r2 = Sim.replay(save.init, save.log, save.state.tick);
  assert.equal(Sim.hashState(r2), Sim.hashState(r1), 'two replays of the same log differ');
  assert.equal(r1.tick, g.state.tick);
});
test('same actions, same seed -> same hash (two independent runs)', () => {
  assert.equal(Sim.hashState(playScript(10).state), Sim.hashState(playScript(10).state));
});
test('canyon: replay hash equals live hash (dam placement, raise, excavation)', () => {
  const g = start(CANYON[4242], CANYON_SETUP, 2); const st = g.state;
  runToDay(g, 3); must(g, {type: 'BUILD', kind: 'solar', tile: 4, tier: 0}); runToDay(g, 6); must(g, {type: 'RAISE_DAM', meters: 2}); must(g, {type: 'EXCAVATE'}); runToDay(g, 12);
  const save = g.makeSave();
  assert.equal(Sim.hashState(Sim.replay(save.init, save.log, save.state.tick)), Sim.hashState(st));
});
test('a clone taken mid-run continues identically to the original', () => {
  for (const [opts, setup] of [[CLASSIC, []], [CANYON[4242], CANYON_SETUP]]) {
    const g = start(opts, setup, 2); const st = g.state;
    runToDay(g, 4); must(g, {type: 'SET_GOD', enabled: true, planner: true}); must(g, {type: 'SET_RESERVE_OFFER', mw: 0.05}); runToDay(g, 5);
    const c = Sim.clone(st);
    assert.equal(Sim.hashState(c), Sim.hashState(st));
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 12000; i++) { Sim.step(st); Sim.step(c); }
      assert.equal(Sim.hashState(c), Sim.hashState(st), 'clone diverged after ' + (k + 1) * 12000 + ' ticks');
    }
  }
});

/* ---------- 4. no NaN / Infinity ---------- */
test('no NaN or Infinity in the state or the snapshot after 60 days', () => {
  const cases = [
    [CLASSIC, [], null], [CLASSIC, [], {type: 'SET_GOD', enabled: true, planner: true}],
    [CANYON[4242], CANYON_SETUP, null], [{seed: 99, kind: 'proc', bias: 'rugged', river: 'large', demo: true}, [{type: 'PLACE_DAM', height: 20}], {type: 'SET_GOD', enabled: true, planner: true}],
    [{seed: 31337, kind: 'proc', bias: 'gentle', river: 'small'}, CANYON_SETUP, null]];
  for (const [opts, setup, extra] of cases) {
    const g = start(opts, setup, 3); if (extra) must(g, extra); const st = g.state;
    for (let d = 5; d <= 60; d += 5) {
      assert.ok(runToDay(g, d), 'stalled'); const bad = findNonFinite(st);
      assert.equal(bad, null, JSON.stringify(opts) + ' day ' + d + ': non-finite ' + bad);
    }
    // JSON (hash, save, snapshot) turns NaN/Infinity into null, so every number in the live state must survive as a finite number in the snapshot
    const snap = g.getSnapshot(); const walk = (a, b, p) => { if (typeof a === 'number') assert.ok(typeof b === 'number' && Number.isFinite(b), 'snapshot lost number at ' + p); else if (a && typeof a === 'object') for (const k of Object.keys(a)) walk(a[k], b[k], p + '.' + k); };
    walk(st, snap, '$');
    assert.ok(Number.isFinite(st.cash));
  }
});

/* ---------- 5. save / load ---------- */
test('save -> JSON -> load round trip keeps the hash and the future', () => {
  const g = playScript(8); must(g, {type: 'PAUSE', paused: true}); // loadSave always loads paused, so compare from a paused state
  const save = JSON.parse(JSON.stringify(g.makeSave()));
  assert.equal(Sim.validateSave(save), null);
  const h = createGame(); const r = h.loadSave(save); assert.ok(r.ok, r.reason);
  assert.equal(h.hash(), g.hash(), 'hash differs right after load');
  assert.deepEqual(h.log, g.log, 'action log lost in the round trip');
  const a = g.runHeadless(20000), b = h.runHeadless(20000);
  assert.equal(b, a, 'loaded game diverges from the original');
  assert.equal(h.runHeadless(30000), g.runHeadless(30000));
  assert.deepEqual(lakes(h.state), lakes(g.state));
});
test('validateSave rejects obviously wrong objects', () => {
  assert.ok(Sim.validateSave(null)); assert.ok(Sim.validateSave({schema: 'x'}));
  const save = playScript(1).makeSave(); assert.equal(Sim.validateSave(save), null);
  assert.ok(Sim.validateSave(Object.assign({}, save, {version: 99})));
});
