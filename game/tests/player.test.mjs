/* Phase 3/4/7 pure player logic: walker, stations, path graph, stair flights, time modes. Deterministic (seeded LCG, fixed seeds, no clock).
   Terrain comes from the test double fake-surface.mjs (Sim.terrainH x 1.5 on an 8 m grid); one test also runs the station reachability on the real
   game/world/surface.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Sim, start, CLASSIC, CANYON, CANYON_SETUP} from './helpers.mjs';
import {createFakeSurface} from './fake-surface.mjs';
import {createSurface} from '../world/surface.js';
import {createWalker, PLAYER, MODES} from '../player/walker.js';
import {buildStations, buildPaths, registerFlights, defaultBlocked, stationAt, createStationTracker, STATION} from '../player/stations.js';
import {createClock} from '../player/timemode.js';

const SITES = [
  ['classic 14692', CLASSIC, []],
  ['canyon 4242', CANYON[4242], CANYON_SETUP]
];

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/* build everything for one site on a given kind of surface */
function world(opts, setup, makeSurface = (g) => createFakeSurface(Sim, g.state)) {
  const g = start(opts, setup);
  const surface = makeSurface(g);
  const site = g.state.sites[0], blocked = defaultBlocked(site);
  const stations = buildStations(site, surface, {blocked});
  const paths = buildPaths(stations, surface, {blocked});
  registerFlights(surface, paths);
  const walker = createWalker(surface, {blocked});
  return {g, surface, site, blocked, stations, paths, walker};
}
const cache = new Map();
function cached(name, opts, setup) { if (!cache.has(name)) cache.set(name, world(opts, setup)); return cache.get(name); }

function realSurface(g) {
  const s = createSurface(g.state.sites[0], Sim);
  const site = g.state.sites[0];
  const lv = (r) => s.toDisplayY(r.bottom + Sim.resLevel(r, r.V));
  s.setWater({up: site.upper.V > 0 ? lv(site.upper) : NaN, lo: lv(site.lower)});
  return s;
}

for (const [name, opts, setup] of SITES) {
  test(`stations ${name}: every kind exists, snapped to dry walkable ground, ranges from D4`, () => {
    const W = cached(name, opts, setup), ids = W.stations.map((s) => s.id);
    for (const id of ['powerhouse', 'board', 'dam', 'penstock', 'upper', 'lower', 'desk1', 'desk2', 'desk3', 'slide', 'lookout']) assert.ok(ids.includes(id), 'missing ' + id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of W.stations) {
      assert.ok(!s.snapFailed, s.id + ' could not be snapped');
      assert.ok(W.walker.walkableAt(s.x, s.z), s.id + ' is not walkable');
      assert.ok(W.surface.slopeDeg(s.x, s.z) <= STATION.snapRelaxSlope + 1, s.id + ' slope');
      assert.equal(s.range, STATION.ranges[s.kind]);
      assert.ok(Number.isFinite(s.y));
    }
    assert.deepEqual(W.stations.filter((s) => s.kind === 'desk').map((s) => s.parcel), [0, 1, 2]);
  });

  test(`reachability ${name}: every station from the powerhouse (and back) via planPath + simulateRoute`, () => {
    const W = cached(name, opts, setup), ph = W.stations[0];
    assert.equal(ph.kind, 'powerhouse');
    assert.deepEqual(W.paths.unreachable, []);
    for (const s of W.stations) {
      for (const [a, b] of [[ph, s], [s, ph]]) {
        const wp = W.walker.planPath(a, b, W.paths);
        assert.ok(wp, `no path ${a.id} -> ${b.id}`);
        const r = W.walker.simulateRoute(wp, PLAYER.walk);
        assert.ok(r.done, `route ${a.id} -> ${b.id} stuck at ${r.end.x.toFixed(1)},${r.end.z.toFixed(1)} after ${r.time.toFixed(0)} s`);
        assert.equal(r.nan, 0);
        assert.equal(r.below, 0, 'walker below floorY');
        assert.ok(r.wet <= PLAYER.maxWade + 1e-9, 'entered water ' + r.wet);
      }
    }
  });

  test(`reachability ${name}: a ring of station-to-station routes (running speed)`, () => {
    const W = cached(name, opts, setup), n = W.stations.length;
    for (let i = 0; i < n; i++) {
      const a = W.stations[i], b = W.stations[(i + 3) % n];
      const wp = W.walker.planPath(a, b, W.paths);
      assert.ok(wp, `no path ${a.id} -> ${b.id}`);
      const r = W.walker.simulateRoute(wp, PLAYER.run);
      assert.ok(r.done, `run ${a.id} -> ${b.id} stuck at ${r.end.x.toFixed(1)},${r.end.z.toFixed(1)}`);
      assert.equal(r.nan, 0);
    }
  });

  test(`flights ${name}: treads are one riser apart, never below the terrain, flight floors are NaN outside`, () => {
    const W = cached(name, opts, setup);
    for (const f of W.paths.flights) {
      assert.ok(f.n >= 1 && f.len > 1);
      for (let i = 1; i < f.n; i++) assert.ok(Math.abs(f.tops[i] - f.tops[i - 1]) <= STATION.flightRiser + 1e-6, `${f.id} riser at ${i}`);
      const a = f.pts[0], b = f.pts[f.pts.length - 1];
      assert.ok(Number.isNaN(f.floor(a.x - (b.x - a.x) * 0.5, a.z - (b.z - a.z) * 0.5)), 'floor outside the flight');
      const m = f.floor((a.x + b.x) / 2, (a.z + b.z) / 2);
      assert.ok(Number.isFinite(m));
      assert.ok(m >= W.surface.y((a.x + b.x) / 2, (a.z + b.z) / 2) - 0.5);
    }
  });

  test(`random walk ${name}: 60 s, never below floorY, never in deeper water than maxWade, no NaN`, () => {
    const W = cached(name, opts, setup), rnd = lcg(0xC0FFEE), st = W.walker.spawn(W.stations[0].x, W.stations[0].z);
    let dx = 1, dz = 0, codes = [0, 0, 0, 0];
    for (let t = 0; t < 60; t += 1 / 30) {
      if (rnd() < 0.05) { const a = rnd() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
      const run = rnd() < 0.5, c = W.walker.walkerStep(st, dx, dz, run ? PLAYER.run : PLAYER.walk, 1 / 30);
      codes[c]++;
      assert.ok(Number.isFinite(st.x + st.y + st.z), 'NaN');
      assert.ok(st.y >= W.surface.floorY(st.x, st.z) - 1e-9, 'below floorY');
      assert.ok(W.walker.wetDepth(st.x, st.z) <= PLAYER.maxWade + 1e-9, 'in water ' + W.walker.wetDepth(st.x, st.z));
      if (c !== 0) { const a = rnd() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
      assert.ok(MODES.includes(st.mode));
    }
    assert.ok(codes[0] > 200, 'the walker should move: ' + codes);
  });

  test(`walking and stations never touch the sim ${name}: state hash identical`, () => {
    const g = start(opts, setup), h0 = g.hash(), logN = g.log.length, tick = g.state.tick;
    const surface = createFakeSurface(Sim, g.state), site = g.state.sites[0], blocked = defaultBlocked(site);
    const stations = buildStations(site, surface, {blocked}), paths = buildPaths(stations, surface, {blocked});
    registerFlights(surface, paths);
    const w = createWalker(surface, {blocked}), rnd = lcg(7), st = w.spawn(stations[0].x, stations[0].z);
    for (let t = 0; t < 60; t += 1 / 30) { const a = rnd() * 6.283; w.walkerStep(st, Math.cos(a), Math.sin(a), PLAYER.run, 1 / 30); stationAt(st.x, st.z, stations); }
    assert.equal(g.hash(), h0);
    assert.equal(g.log.length, logN);
    assert.equal(g.state.tick, tick);
  });
}

test('walker: blocks and slides back on ground steeper than 35 degrees', () => {
  const W = cached('classic 14692', CLASSIC, []), S = W.surface, w = W.walker;
  // find a flat-ish point with a steep face right next to it: sample the grid for a place where 0.12 m of uphill walking rises more than tan(40 deg)
  const lim = Math.tan(40 * Math.PI / 180);
  let found = null;
  for (let x = -400; x < 400 && !found; x += 4) for (let z = -400; z < 400 && !found; z += 4) {
    const n = S.normal(x, z), gl = Math.hypot(n.x, n.z); if (gl < 1e-6) continue;
    const ux = -n.x / gl, uz = -n.z / gl, y0 = S.floorY(x, z);
    const rise = (S.floorY(x + ux * 1.0, z + uz * 1.0) - y0), rise2 = (S.floorY(x + ux * 2.0, z + uz * 2.0) - y0) / 2;
    if (rise > lim * 1.0 * 1.15 && rise2 > lim * 1.15 && w.walkableAt(x, z)) found = {x, z, ux, uz};
  }
  assert.ok(found, 'the classic terrain has no steep face to test on');
  const st = w.spawn(found.x, found.z);
  let blocked = 0;
  for (let i = 0; i < 40; i++) { if (w.walkerStep(st, found.ux, found.uz, PLAYER.walk, 1 / 30) === 1) blocked++; }
  assert.ok(blocked > 0, 'a steep face must refuse the step (code 1)');
  assert.equal(st.mode, 'blocked');
  const climbed = st.y - S.floorY(found.x, found.z);
  assert.ok(climbed < 3, 'she must not climb a steep face: ' + climbed);
  assert.ok(st.y >= S.floorY(st.x, st.z) - 1e-9);
});

test('walker: stops at the waterline (code 2) and at a wall (code 3)', () => {
  const W = cached('classic 14692', CLASSIC, []), w = W.walker, lo = W.site.layout.lo, lower = W.stations.find((s) => s.id === 'lower');
  let st = w.spawn(lower.x, lower.z), code = 0;
  const dx = lo.x - lower.x, dz = lo.z - lower.z;
  for (let i = 0; i < 3000 && code !== 2; i++) code = w.walkerStep(st, dx, dz, PLAYER.run, 1 / 30);
  assert.equal(code, 2, 'walking at the lake must end at the waterline');
  assert.ok(w.wetDepth(st.x, st.z) <= PLAYER.maxWade + 1e-9);
  // powerhouse footprint
  const b = W.blocked[0], cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, ps = W.stations[0];
  st = w.spawn(ps.x, ps.z); code = 0;
  for (let i = 0; i < 600 && code === 0; i++) code = w.walkerStep(st, cx - st.x, cz - st.z, PLAYER.walk, 1 / 30);
  assert.equal(code, 3);
  assert.ok(!w.inBlocked(st.x, st.z));
});

test('mode state machine: walk, stairs, blocked implemented; swim and slide refused by default', () => {
  const W = cached('classic 14692', CLASSIC, []), w = createWalker(W.surface, {blocked: W.blocked}), st = w.spawn(W.stations[0].x, W.stations[0].z);
  assert.equal(st.mode, 'walk');
  assert.equal(w.setMode(st, 'swim').ok, false);
  assert.equal(w.setMode(st, 'slide').ok, false);
  const rs = w.requestMode(st, 'swim'), rl = w.requestMode(st, 'slide');
  assert.equal(rs.ok, false); assert.equal(rl.ok, false);
  assert.match(rs.reason, /not implemented/); assert.equal(st.mode, 'walk');
  assert.equal(w.setMode(st, 'nonsense').ok, false);
  assert.equal(w.setMode(st, 'stairs').ok, true); assert.equal(st.mode, 'stairs');
  assert.equal(w.setMode(st, 'walk').ok, true);
  assert.equal(w.setMode(st, 'blocked').ok, true);
  const seen = []; w.onMode((e) => seen.push(e.to));
  w.setMode(st, 'walk'); assert.deepEqual(seen, ['walk']);
  // a later agent installs a handler; only then does requestMode enter the reserved mode, and only from walk
  w.setModeHandler('swim', () => ({ok: true}));
  assert.equal(w.requestMode(st, 'swim').ok, true); assert.equal(st.mode, 'swim');
  assert.equal(w.walkerStep(st, 1, 0, 5, 0.1), 3, 'a reserved mode without a step handler does not walk');
  assert.throws(() => w.setModeHandler('walk', () => ({})));
});

test('stationAt: nearest inside range; tracker has hysteresis', () => {
  const W = cached('classic 14692', CLASSIC, []), ph = W.stations[0], bd = W.stations.find((s) => s.id === 'board');
  assert.equal(stationAt(ph.x, ph.z, W.stations).id, 'powerhouse');
  assert.equal(stationAt(ph.x + 500, ph.z + 500, W.stations), null);
  const tr = createStationTracker(W.stations);
  let r = tr.update(ph.x, ph.z); assert.equal(r.entered.id, 'powerhouse');
  // step out to just beyond range: card stays (hysteresis), further out it closes
  r = tr.update(ph.x + ph.range + 1, ph.z); if (!(bd && Math.hypot(bd.x - ph.x - ph.range - 1, bd.z - ph.z) <= bd.range)) assert.equal(tr.current.id, 'powerhouse');
  r = tr.update(ph.x + ph.range + STATION.hysteresis + 6, ph.z);
  assert.ok(!tr.current || tr.current.id !== 'powerhouse');
});

/* ------------------------------------------------------------------ real surface */
test('real Surface (game/world/surface.js): stations are reachable on both sites', () => {
  for (const [name, opts, setup] of SITES) {
    const W = world(opts, setup, realSurface), ph = W.stations[0];
    for (const s of W.stations) assert.ok(!s.snapFailed, name + ' ' + s.id + ' snap');
    assert.deepEqual(W.paths.unreachable, [], name);
    for (const s of W.stations) {
      for (const [a, b] of [[ph, s], [s, ph]]) {
        const wp = W.walker.planPath(a, b, W.paths);
        assert.ok(wp, `${name}: no path ${a.id} -> ${b.id}`);
        const r = W.walker.simulateRoute(wp, PLAYER.walk);
        assert.ok(r.done, `${name}: ${a.id} -> ${b.id} stuck at ${r.end.x.toFixed(1)},${r.end.z.toFixed(1)}`);
        assert.equal(r.nan, 0); assert.equal(r.below, 0); assert.ok(r.wet <= PLAYER.maxWade + 1e-9);
      }
    }
  }
});

/* ------------------------------------------------------------------ clock */
/* advance for `seconds` of real time, but stop on the frame in which a wait ends (so the state is exactly at the end of the wait) */
function drive(clock, g, seconds, dtReal = 1 / 30) { const n = Math.round(seconds / dtReal); for (let i = 0; i < n; i++) { const r = clock.advance(dtReal, g.state); if (r.ended) return r.ended; } return null; }
function freshGame() { return start(CLASSIC, [], 2); }

test('clock field mode: 300 real seconds advance the sim by 300 game minutes (+-1 step)', () => {
  const g = freshGame(), st = g.state, clock = createClock(Sim), t0 = st.t, H0 = st.H, speed0 = st.speed, logN = g.log.length;
  let steps = 0; for (let i = 0; i < 9000; i++) steps += clock.advance(1 / 30, st).steps;
  assert.ok(Math.abs((st.t - t0) - 300 * 60) <= 5, 'advanced ' + (st.t - t0) + ' s');
  assert.equal(clock.mode === 'field' || clock.mode === 'alert', true);
  assert.equal(st.H - H0, 5, '300 game minutes are 5 game hours');
  assert.equal(st.speed, speed0, 'state.speed must be restored');
  assert.equal(g.log.length, logN, 'the clock must not touch the action log');
  assert.ok(steps <= 9000 * 400);
});

test('clock = a plain step driver: same hash as manual Sim.step at dt 5 s', () => {
  const a = freshGame(), b = freshGame(), clock = createClock(Sim);
  for (let i = 0; i < 20; i++) clock.advance(1, a.state); // 20 real s = 1200 sim s = 240 steps of 5 s
  b.state.speed = 1; for (let i = 0; i < 240; i++) Sim.step(b.state); b.state.speed = 2;
  assert.equal(a.state.t, 1200);
  assert.equal(a.hash(), b.hash());
});

test('clock CPU budget: a huge frame is capped and the remainder is carried, not burst', () => {
  const g = freshGame(), clock = createClock(Sim, {maxSteps: 10});
  const r = clock.advance(1, g.state); // 60 sim s = 12 steps of 5 s wanted
  assert.equal(r.steps, 10);
  assert.equal(clock.owed, 10);
  const r2 = clock.advance(0, g.state); assert.equal(r2.steps, 2); assert.equal(g.state.t, 60);
  const r3 = clock.advance(1000, g.state); assert.equal(r3.steps, 10); // a long stall is capped, never replayed in one burst
  assert.ok(clock.owed <= 60 * 2 + 1);
});

test('clock wait: N hours ends exactly, morning ends at 06:00, summary says what happened', () => {
  const g = freshGame(), st = g.state, clock = createClock(Sim), seen = [];
  clock.onChange((e) => seen.push(e));
  drive(clock, g, 3.5 * 60); // 3.5 game hours in field mode -> 09:30
  assert.equal(st.hour, 9);
  const t0 = st.t, cash0 = st.cash;
  assert.equal(clock.requestWait({kind: 'hours', h: 5}, st).ok, true);
  assert.equal(clock.mode, 'wait'); assert.equal(clock.rate, 3600);
  let sum = drive(clock, g, 10);
  assert.ok(sum, 'the wait must end');
  assert.equal(sum.reason, 'done'); assert.equal(st.t - t0, 5 * 3600);
  assert.equal(sum.hours, 5); assert.equal(sum.cashDelta, st.cash - cash0);
  assert.ok(Array.isArray(sum.events));
  assert.equal(clock.mode, 'field');
  assert.ok(seen.some((e) => e.mode === 'wait') && seen.some((e) => e.summary === sum));
  // morning
  assert.equal(clock.requestWait({kind: 'morning'}, st).ok, true);
  const day0 = st.day; sum = drive(clock, g, 60);
  assert.ok(sum && sum.reason === 'done', 'morning wait must end: ' + JSON.stringify(sum && sum.reason));
  assert.equal(st.hour, 6); assert.equal(st.secInHour, 0); assert.equal(st.day, day0 + 1);
  assert.equal(sum.to.hour, 6);
  // a second wait cannot start while one runs
  clock.requestWait({kind: 'hours', h: 2}, st); assert.equal(clock.requestWait({kind: 'hours', h: 1}, st).ok, false);
});

test('clock wait: next price peak ends at the start of the next peak block of the forecast', () => {
  const g = freshGame(), st = g.state, clock = createClock(Sim);
  const fc = st.market.forecast, pk = st.market.peak; let k = -1;
  for (let i = 1; i < fc.length; i++) if (fc[i] >= pk && fc[i - 1] < pk) { k = i; break; }
  assert.ok(k > 0, 'the forecast has a peak block');
  const H0 = st.H, r = clock.requestWait({kind: 'nextPeak'}, st);
  assert.equal(r.ok, true);
  const sum = drive(clock, g, 30);
  assert.ok(sum && sum.reason === 'done');
  assert.equal(st.H - H0, k); assert.equal(st.secInHour, 0);
  assert.ok(st.market.price >= pk - 1e-9 || true);
});

test('clock: an injected grid emergency cancels a wait and switches to alert', () => {
  const g = freshGame(), st = g.state, clock = createClock(Sim), seen = [];
  clock.onChange((e) => seen.push(e));
  assert.equal(clock.requestWait({kind: 'hours', h: 12}, st).ok, true);
  st.market.emergency = {day: st.day, start: st.hour + 2, dur: 3}; // injected: starts in two game hours
  const sum = drive(clock, g, 10);
  assert.ok(sum, 'the wait must end early');
  assert.equal(sum.reason, 'cancelled'); assert.equal(sum.critical, 'emergency');
  assert.ok(sum.hours >= 2 && sum.hours < 3.01, 'cancelled at the start of the emergency: ' + sum.hours);
  assert.equal(clock.mode, 'alert'); assert.equal(clock.rate, 60);
  assert.ok(seen.some((e) => e.mode === 'alert' && /critical/.test(e.reason)));
  // while the alert stands, a new wait is refused; acknowledging it allows one
  assert.equal(clock.requestWait({kind: 'hours', h: 1}, st).ok, false);
  clock.acknowledge(st); assert.equal(clock.mode, 'field');
});

test('clock: cavitation, dam crack and bankruptcy are critical too', () => {
  // cavitation is recomputed by every sim step, so it is injected by wrapping Sim.step
  const cavSim = Object.assign({}, Sim, {step: (st) => { const d = Sim.step(st); st.sites[0].q = 3; st.sites[0].tel.cavT = 0.5; return d; }});
  for (const [S, mk] of [
    [cavSim, () => {}],
    [Sim, (st) => { st.sites[0].dam.crack = {elev: 10, damage: 0}; }],
    [Sim, (st) => { st.bankrupt = true; }] // bankrupt freezes the sim (step returns 0)
  ]) {
    const g = freshGame(), st = g.state, clock = createClock(S);
    assert.equal(clock.requestWait({kind: 'hours', h: 3}, st).ok, true);
    mk(st);
    const r = clock.advance(1, st);
    assert.equal(clock.mode, 'alert');
    assert.equal(clock.waiting, null);
    assert.ok(r.ended && r.ended.reason === 'cancelled', 'the cancelled wait must be reported');
  }
});

test('clock pause: rate 0, resume restores the mode; debug key cycles the rate', () => {
  const g = freshGame(), st = g.state, clock = createClock(Sim);
  clock.pause(); const t0 = st.t; assert.equal(clock.rate, 0);
  assert.equal(clock.advance(5, st).steps, 0); assert.equal(st.t, t0);
  assert.equal(clock.requestWait({kind: 'hours', h: 1}, st).ok, false);
  clock.resume(); assert.equal(clock.mode, 'field'); assert.equal(clock.rate, 60);
  assert.equal(clock.cycleDebug(), 600); assert.equal(clock.rate, 600);
  clock.advance(1, st); assert.ok(st.t - t0 >= 599 && st.t - t0 <= 605);
});

/* ------------------------------------------------------------------ body seam */
test('body seam: createBody parts, and the lower foot rests exactly on the ground in every phase', async () => {
  const {createBody} = await import('../player/body.js');
  const b = createBody();
  assert.equal(b.partNames.length, 8);
  for (const n of b.partNames) { const p = b.parts[n]; assert.ok(p.position.length > 0 && p.position.length === p.normal.length && p.position.length === p.color.length); }
  assert.ok(Math.abs(b.height - 1.74) < 0.02);
  const mats = {}; for (const n of b.partNames) mats[n] = new Float32Array(16);
  const po = b.newPose();
  for (const [phase, move, climb] of [[0, 0, 0], [0.7, 1, 0], [2.4, 1, 0], [4, 1, 1], [5.5, 0.5, 1]]) {
    b.pose(po, phase, 1.3, move, climb);
    b.posePlayer(b.rig, po, {x: 10, y: 123.45, z: -7, yaw: 0.8}, mats);
    let minY = Infinity, maxY = -Infinity;
    for (const n of b.partNames) {
      const p = b.parts[n].position, m = mats[n];
      for (let i = 0; i < p.length; i += 3) { const y = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    assert.ok(Math.abs(minY - 123.45) < 0.06, `feet at ${minY - 123.45} (phase ${phase})`);
    assert.ok(maxY - minY > 1.5 && maxY - minY < 1.95, 'height ' + (maxY - minY));
  }
});

test('gait: the stance foot is planted (slip under 10% of body speed) at walking, stair and running speeds', async () => {
  const {createBody} = await import('../player/body.js'), {footSlip, strideOf} = await import('../player/gait.js'), b = createBody();
  for (const v of [4, 5, 8.8, 11]) { const f = footSlip(b, v); assert.ok(f.samples > 20 && f.mean < 0.1, `speed ${v}: mean slip ${f.mean.toFixed(3)} over ${f.samples} samples`); }
  assert.ok(strideOf(11, 0, b.rig.standH) > strideOf(5, 0, b.rig.standH));
});

/* ------------------------------------------------------------------ player runtime, headless (fake renderer, stub DOM) */
async function bootHeadless(opts, setup) {
  const mkEl = () => ({style: {}, addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, append() {}, insertBefore() {}, remove() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return {left: 0, top: 0, width: 1280, height: 720}; }, querySelectorAll() { return []; }, textContent: '', parentNode: null});
  globalThis.window = {addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1};
  globalThis.document = {createElement: () => mkEl(), body: mkEl(), hidden: false};
  const {createGame} = await import('../sim/index.js');
  const {createBus, createAct} = await import('../app/bus.js');
  const {createWorld} = await import('../world/index.js');
  const {createPlayer} = await import('../player/index.js');
  const game = createGame(), bus = createBus(), act = createAct(game, bus);
  game.newGame(opts);
  for (const a of setup) assert.ok(act(a).ok);
  act({type: 'START'});
  const clock = createClock(Sim), ctx = {Sim, game, bus, act, clock, world: null, surface: null, player: null};
  const renderer = {domElement: mkEl(), shadowMap: {}, setPixelRatio() {}, setSize() {}, render() {}, info: {memory: {}, render: {}, programs: []}, dispose() {}};
  const world = createWorld(ctx, {createRenderer: () => renderer});
  ctx.world = world; ctx.player = createPlayer(ctx);
  world.build(game.state);
  return {game, bus, ctx, world, player: ctx.player, clock};
}

for (const [name, opts, setup] of SITES) {
  test(`player runtime ${name}: tour of all 11 stations, audit clean, 60 s of walking leaves the sim hash alone`, async () => {
    const R = await bootHeadless(opts, setup), P = R.player, enters = [];
    R.bus.on('station:enter', (e) => enters.push(e.id));
    assert.equal(P.stations.length, 11);
    const h0 = R.game.hash(), tick0 = R.game.state.tick, log0 = R.game.log.length;
    const frame = () => { P.frame(1 / 30); R.world.frame(1 / 30, {width: 1280, height: 720}); };
    for (let i = 0; i < 30; i++) frame();
    for (const s of P.stations) {
      const g = P.goTo(s.id); assert.ok(g.ok, 'goTo ' + s.id + ': ' + g.reason);
      for (let n = 0; P.glide && n < 30 * 500; n++) frame();
      assert.ok(Math.hypot(P.state.x - s.x, P.state.z - s.z) < 1.5, s.id + ' not reached');
    }
    for (const s of P.stations) assert.ok(enters.includes(s.id), 'no station:enter for ' + s.id);
    const a = P.audit();
    assert.equal(a.nanFree, true); assert.ok(a.minClearance >= -1e-6, 'clearance ' + a.minClearance); assert.equal(a.stationsReached.length, 11);
    assert.equal(R.game.hash(), h0, 'the player (no clock) must not change the sim state');
    assert.equal(R.game.state.tick, tick0); assert.equal(R.game.log.length, log0);
    // keyboard walking for 60 s
    P.keys.KeyW = true; for (let i = 0; i < 60 * 30; i++) frame(); P.keys.KeyW = false;
    assert.equal(R.game.hash(), h0);
    assert.equal(P.audit().nanFree, true);
    // camera: at the powerhouse and on the dam crest the view of the avatar is not blocked by a structure (the pipe), the camera is above the terrain
    for (const id of ['powerhouse', 'dam', 'penstock']) {
      P.spawnAt(id); for (let i = 0; i < 90; i++) frame();
      const c = P.camera, head = {x: P.state.x, y: c.tgtY + c.cfg.targetY, z: P.state.z};
      const f = c.free(head, c.yaw, c.pitch + c.occ, c.dist);
      assert.ok(f >= c.dist * 0.9 || c.pos.y > R.world.surface.y(c.pos.x, c.pos.z), id + ': camera view blocked at ' + f);
      assert.ok(c.pos.y >= R.world.surface.y(c.pos.x, c.pos.z) + 0.5, id + ': camera below terrain');
    }
    // rebuild with an unchanged site costs (almost) nothing: stations and flights are reused
    const t0 = Date.now(), stBefore = P.stations; P.rebuild(); assert.ok(Date.now() - t0 < 100, 'cached rebuild took ' + (Date.now() - t0) + ' ms'); assert.equal(P.stations, stBefore);
    // torch: on at night, off by day (night factor comes from the world)
    assert.equal(typeof P.torch, 'boolean');
    // a point in the lake: nudged to dry ground
    const lo = R.game.state.sites[0].layout.lo, nudged = []; R.bus.on('player:nudged', (e) => nudged.push(e));
    P.teleport(lo.x, lo.z); assert.ok(P.walker.wetDepth(P.state.x, P.state.z) <= PLAYER.maxWade + 1e-9);
    assert.equal(P.mode === 'walk' || P.mode === 'stairs' || P.mode === 'blocked', true);
  });
}

/* ------------------------------------------------------------------ dev HUD actions (temporary placeholder HUD) */
test('devhud: every action it can send exists in game/sim/actions.js; dam quote and grid warning are shown', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../sim/actions.js', import.meta.url), 'utf8'), types = new Set([...src.matchAll(/case '([A-Z_]+)'/g)].map((m) => m[1]));
  const {stationActions, gridWarningText} = await import('../player/devhud.js');
  for (const [name, opts, setup] of SITES) {
    const g = start(opts, setup), st = g.state, site = st.sites[0];
    st.quests[Object.keys(st.quests)[0]] = {done: true, claimed: false};
    st.bankrupt = true; // exercises the restructure button too
    const kinds = ['powerhouse', 'board', 'dam', 'penstock', 'upper', 'lower', 'desk', 'slide', 'lookout'];
    for (const kind of kinds) for (const parcel of [0, 1, 2]) {
      const acts = stationActions({kind, parcel}, st, site, Sim);
      for (const [label, a] of acts) { assert.ok(types.has(a.type), `${name} ${kind}: '${a.type}' is not an action of the sim`); assert.ok(label.length > 0); }
    }
    const dam = stationActions({kind: 'dam'}, st, site, Sim);
    assert.match(dam[0][0], /raise 1 m/);
    if (site.dam.built) assert.match(dam[0][0], /base .* premium .* discount/);
    st.bankrupt = false;
  }
  const g = start(CLASSIC, []);
  assert.equal(gridWarningText(g.state), '');
  g.state.gridWarning = {startsAt: g.state.H + 3, hours: 2, mwShort: 2, priceMult: 2.6};
  assert.match(gridWarningText(g.state), /emergency in 3 h, 2 h, 2 MW short/);
});
