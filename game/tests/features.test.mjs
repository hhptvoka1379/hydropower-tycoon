/* World features (game/world/features): the THREE-free placement / layout / geometry helpers in Node, plus a smoke run that builds every feature
   for the classic (14692) and canyon (4242) sites and rebuilds them 30 times. Deterministic: no Math.random, no Date-dependent asserts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera } from 'three';
import { Sim, start, CLASSIC, CANYON, CANYON_SETUP } from './helpers.mjs';
import { Surface } from '../world/surface.js';
import { ResourceScope } from '../world/scope.js';
import { buildStations, buildPaths } from '../player/stations.js';
import { GB } from '../world/features/geom.js';
import { PAL } from '../world/features/palette.js';
import { panelRowGB, coniferGB, rockGB, tuftGB, flowerGB, rotorGB, containerGB, deskGB, craneGB } from '../world/features/models.js';
import { layoutTile, tileConfig, tileCenter, tilesSignature, parcelLines, pickTile, pickTileRay, assetBoxes, PANEL } from '../world/features/layout.js';
import { sampleXZ, ribbonStrip, drapePatch } from '../world/features/ribbon.js';
import { planScatter, keepoutGeometry, keepGridFrom, insideKeepout, maxLevels, LIMITS, CAPS, STRIDE } from '../world/features/placement.js';
import { createEnvReader, seasonOf, rotorFront, windVector, swayTip, swayTipMin, SWAY, qualityFactor } from '../world/features/envread.js';
import { normalizePaths, chainsOf } from '../world/features/pathsnorm.js';
import { treadsOf, drawnTop } from '../world/features/stairs.js';
import { writeTRS, writePanel, writeRotor } from '../world/features/inst.js';
import { FEATURES } from '../world/features/index.js';

const cfg = tileConfig(Sim);
const mkClassic = () => start(CLASSIC).state.sites[0];
const mkCanyon = () => start(CANYON[4242], CANYON_SETUP).state.sites[0];
const classic = mkClassic(), canyon = mkCanyon();
const surfC = new Surface(classic, Sim), surfK = new Surface(canyon, Sim);
const SITES = [['classic 14692', classic, surfC], ['canyon 4242', canyon, surfK]];
const fillTiles = (site) => {
  site.parcels = [true, true, true];
  for (let i = 0; i < 48; i++) {
    const t = site.tiles[i], m = i % 3;
    if (m === 0) { t.solar = { tier: i % 3, soil: 0, curtail: 0, health: 100 }; if (i % 2) t.wind = { tier: i % 3, curtail: 0, damaged: false, rpm: 20, v: 8 }; }
    else if (m === 1) { t.wind = { tier: (i >> 1) % 3, curtail: 0, damaged: false, rpm: 20, v: 8 }; t.solar = { tier: 2, soil: 0, curtail: 0, health: 100 }; }
    else { t.battery = { tier: i % 3, soc: 0.5, fade: 0, mode: 'auto', act: 'idle' }; if (i % 2) t.solar = { tier: 1, soil: 0, curtail: 0, health: 100 }; }
  }
};

test('geometry builder: faces point outward, bounds and counts are sane', () => {
  const b = new GB().box(1, 2, 3, 2, 4, 6, PAL.paper);
  assert.equal(b.triCount, 12);
  const bb = b.bounds(); assert.deepEqual([bb.x0, bb.x1, bb.y0, bb.y1, bb.z0, bb.z1], [0, 2, 0, 4, 0, 6]);
  const outward = (gb, c) => { for (let i = 0; i < gb.p.length; i += 9) { const mx = (gb.p[i] + gb.p[i + 3] + gb.p[i + 6]) / 3 - c[0], my = (gb.p[i + 1] + gb.p[i + 4] + gb.p[i + 7]) / 3 - c[1], mz = (gb.p[i + 2] + gb.p[i + 5] + gb.p[i + 8]) / 3 - c[2]; if (gb.n[i] * mx + gb.n[i + 1] * my + gb.n[i + 2] * mz < -1e-9) return false; } return true; };
  assert.ok(outward(b, [1, 2, 3]));
  const cy = new GB().cyl([0, 0, 0], [0, 5, 0], 1, 0.5, 8, PAL.moss, true);
  assert.ok(outward(cy, [0, 2.5, 0]));
  const cone = new GB().cyl([0, 0, 0], [3, 4, 1], 2, 0, 7, PAL.moss, true);
  assert.ok(outward(cone, [1.5, 2, 0.5]));
  assert.ok(cone.triCount >= 14);
  for (const g of [panelRowGB(6, 3, 2.7), coniferGB(0), coniferGB(1), rockGB(0), rockGB(1), tuftGB(), flowerGB(0), rotorGB(false), rotorGB(true), containerGB(), deskGB(1, true), craneGB(10)]) {
    assert.ok(g.triCount > 0 && g.triCount < 300, 'triangle budget');
    for (const v of g.p) assert.ok(Number.isFinite(v));
    for (let i = 0; i < g.n.length; i += 3) assert.ok(Math.abs(Math.hypot(g.n[i], g.n[i + 1], g.n[i + 2]) - 1) < 1e-5);
  }
  assert.ok(rockGB(0).triCount === 20, 'boulder is an irregular 20-facet solid, not a pyramid');
  const rk = rockGB(0).bounds(); assert.ok(Math.abs(rk.y0 + 0.25) < 1e-6, 'boulder sits 0.25 m into the ground');
});

test('instance matrices: panel pitch, rotor facing and yaw', () => {
  const a = new Float32Array(16);
  writePanel(a, 0, 1, 2, 3, 0, 0.4, 1);
  // panel normal (0,1,0) -> (0, cos, sin): tilts to +z (south)
  assert.ok(Math.abs(a[5] - Math.cos(0.4)) < 1e-6 && Math.abs(a[6] - Math.sin(0.4)) < 1e-6);
  assert.deepEqual([a[12], a[13], a[14]], [1, 2, 3]);
  writeRotor(a, 0, 0, 0, 0, 0.7, 0, 5);   // local +z axis -> (sin yaw, cos yaw)
  assert.ok(Math.abs(a[8] - Math.sin(0.7) * 5) < 1e-5 && Math.abs(a[10] - Math.cos(0.7) * 5) < 1e-5);
  writeTRS(a, 0, 1, 2, 3, Math.PI / 2, 2, 3, 4);
  assert.ok(Math.abs(a[2] + 2) < 1e-6 && Math.abs(a[5] - 3) < 1e-6 && Math.abs(a[8] - 4) < 1e-6);
});

for (const [name, site, surf] of SITES) {
  test(`${name}: tile layout sits on surface.y, borders hug the ground`, () => {
    const s = structuredClone(site); fillTiles(s);
    let panels = 0, winds = 0, batts = 0;
    for (let i = 0; i < 48; i++) {
      const L = layoutTile(s, surf, i, cfg), c = tileCenter(s, i, cfg.ts);
      assert.ok(Math.abs(L.x - c.x) < 1e-9 && Math.abs(L.z - c.z) < 1e-9);
      for (const r of L.rows) {
        panels += r.n;
        assert.ok(Math.abs(r.gy - surf.y(r.x, r.z)) < 1e-3, 'row ground sample');
        assert.ok(r.y >= r.gy + 0.5 - 1e-9 - 1e-3 || Math.abs(r.roll) > 0, 'row clears the ground at its centre');
        assert.ok(Math.abs(r.x - L.x) <= cfg.ts / 2 && Math.abs(r.z - L.z) <= cfg.ts / 2, 'row inside its tile');
        assert.ok(r.pitch >= -0.1 - 1e-9 && r.pitch <= 0.95 + 1e-9);
        assert.equal(r.poles.length, 3);
        for (const q of r.poles) { assert.ok(Math.abs(q.gy - surf.y(q.x, q.z)) < 1e-3, 'pole ground sample'); assert.ok(q.top > q.gy, 'pole reaches the slab'); }
      }
      if (L.wind) { winds++; assert.ok(Math.abs(L.wind.gy - surf.y(L.wind.x, L.wind.z)) < 1e-3); assert.ok(L.wind.gyMin <= L.wind.gy + 1e-9 && L.wind.gyMax >= L.wind.gy - 1e-9); }
      for (const b of L.batts) { batts++; assert.ok(Math.abs(b.gy - surf.y(b.x, b.z)) < 1e-3); assert.ok(b.gyMax >= b.gy - 1e-9 && b.gyMin <= b.gy + 1e-9); }
    }
    assert.ok(panels > 0 && winds > 0 && batts > 0);
    // all 48 tiles at tier 3 solar = 1440 panels, none dropped (C12)
    const full = structuredClone(site); full.parcels = [true, true, true];
    for (const t of full.tiles) t.solar = { tier: 2, soil: 0 };
    let n = 0; for (let i = 0; i < 48; i++) n += layoutTile(full, surf, i, cfg).panelCount;
    assert.equal(n, 3 * 16 * 30);
    // parcel lines: sampled at <= 2.5 m, every vertex lifted exactly on surface.y
    for (let p = 0; p < 3; p++) for (const ln of parcelLines(site, p, cfg.ts)) {
      const pts = sampleXZ(ln.a[0], ln.a[1], ln.b[0], ln.b[1], 2.5);
      for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) <= 2.5 + 1e-9);
      const gb = new GB(); ribbonStrip(gb, surf, pts.map(([x, z]) => ({ x, z })), ln.width, 0.12, { mid: PAL.ochre, edge: PAL.ochre });
      assert.ok(gb.triCount >= 2 * (pts.length - 1));
      for (let i = 0; i < gb.p.length; i += 3) { const ry = surf.y(gb.p[i], gb.p[i + 2]); const d = gb.p[i + 1] - ry; assert.ok(d > 0.119 && d < 0.14, 'ribbon vertex on surface.y + lift'); }
    }
    const gp = new GB(); drapePatch(gp, surf, site.layout.parcels[0].x - 15, site.layout.parcels[0].z - 15, site.layout.parcels[0].x + 15, site.layout.parcels[0].z + 15, 5, 0.07, PAL.gravel);
    for (let i = 0; i < gp.p.length; i += 3) assert.ok(Math.abs(gp.p[i + 1] - surf.y(gp.p[i], gp.p[i + 2]) - 0.07) < 1e-3);
  });
}

test('tile signature changes exactly when tile state changes', () => {
  const s = structuredClone(classic);
  const sig0 = tilesSignature(s);
  assert.equal(tilesSignature(structuredClone(s)), sig0);
  // live values never change it
  s.tiles[0].solar = { tier: 1, soil: 0, building: true }; const sig1 = tilesSignature(s); assert.notEqual(sig1, sig0);
  s.tiles[0].solar.soil = 0.2; s.tiles[0].solar.p = 5; s.tel.G = 800; assert.equal(tilesSignature(s), sig1);
  s.tiles[0].solar.building = false; const sig2 = tilesSignature(s); assert.notEqual(sig2, sig1);          // construction finished
  s.tiles[0].solar.tier = 2; const sig3 = tilesSignature(s); assert.notEqual(sig3, sig2);
  s.tiles[7].wind = { tier: 0, building: true, rpm: 0, v: 0 }; const sig4 = tilesSignature(s); assert.notEqual(sig4, sig3);
  s.tiles[7].wind.rpm = 30; s.tiles[7].wind.damaged = true; s.tiles[7].wind.feathered = true; assert.equal(tilesSignature(s), sig4);
  s.tiles[20].battery = { tier: 1, soc: 0.5 }; const sig5 = tilesSignature(s); assert.notEqual(sig5, sig4);
  s.tiles[20].battery.soc = 0.9; s.tiles[20].battery.act = 'charging'; assert.equal(tilesSignature(s), sig5);
  s.parcels[1] = !s.parcels[1]; assert.notEqual(tilesSignature(s), sig5);
  for (const f of FEATURES) { const ft = f({ scene: new Scene() }); assert.equal(typeof ft.signature(s), 'string'); assert.equal(ft.signature(s), ft.signature(structuredClone(s))); }
});

test('picking: terrain hit -> tile, ray -> tile proxy box', () => {
  const s = structuredClone(classic); const P = s.layout.parcels[1];
  assert.deepEqual(pickTile(s, P.x - 54 + 1, P.z - 18 + 2, cfg.ts), { type: 'tile', parcel: 1, tile: 16 + 1 * 4 + 0 });
  assert.equal(pickTile(s, P.x + 200, P.z, cfg.ts), null);
  // narrow proxies: a tower / container / crane resolves to its tile, empty ground and panels never do (camera occlusion safety)
  s.tiles[20].wind = { tier: 1 }; s.tiles[21].battery = { tier: 0, soc: 0.5 }; s.tiles[22].solar = { tier: 1, building: true };
  const L = []; for (let i = 0; i < 48; i++) L.push(layoutTile(s, surfC, i, cfg));
  const boxes = assetBoxes(L), w = L[20].wind;
  assert.equal(boxes.length, 3);
  const h = pickTileRay(boxes, { x: w.x - 60, y: w.gy + 30, z: w.z }, { x: 1, y: 0, z: 0 }, 200);
  assert.ok(h && h.type === 'tile' && h.tile === 20 && h.parcel === 1 && h.t > 50 && h.t < 60);
  const c = tileCenter(s, 19, cfg.ts);
  assert.equal(pickTileRay(boxes, { x: c.x, y: surfC.y(c.x, c.z) + 100, z: c.z }, { x: 0, y: -1, z: 0 }, 1000), null, 'an empty tile has no proxy');
  const cr = L[22].crane; assert.ok(cr && pickTileRay(boxes, { x: cr.x, y: cr.gy + 40, z: cr.z }, { x: 0, y: -1, z: 0 }, 100).tile === 22);
});

test('env reader: shapes of wind / rain / snow, season curves, rotor facing, sway', () => {
  const rd = createEnvReader();
  let e = rd({ wind: 9, rain: 5, snow: 0, doy: 100, climate: { T: 8, wdir: 1.0, storm: 1 } });
  assert.equal(e.wind, 9); assert.equal(e.windDir, 1.0); assert.equal(e.rain, 1); assert.equal(e.snowing, 0); assert.equal(e.storm, 1);
  e = rd({ wind: { speed: 4, dir: 2 }, rain: 1.25, T: -3 });
  assert.equal(e.wind, 4); assert.equal(e.windDir, 2); assert.equal(e.rain, 0); assert.ok(Math.abs(e.snowing - 0.5) < 1e-9, 'cold rain falls as snow');
  e = rd({}); assert.equal(e.wind, 0); assert.equal(e.rain, 0); assert.ok(Number.isFinite(e.winter));
  assert.ok(seasonOf(315, null).winter > 0.99 && seasonOf(225, null).autumnRaw > 0.99 && seasonOf(135, null).winter === 0);
  assert.ok(seasonOf(315, { valleySnow: 9 }).snowCover === 1 && seasonOf(100, null).snowCover === 0);
  // rotors face INTO the wind: front . blow-direction < 0
  for (const d of [0, 0.7, 2, 3.5, 5.9]) { const f = rotorFront(d), w = windVector(d); assert.ok(f.x * w.x + f.z * w.z < -0.999); }
  // visible sway: >= 0.15 m at the tip of the smallest tree in strong wind (>= 9 m/s), even at the calmest point of the gust cycle
  const hMin = 0.8 * 8.2 /* smallest conifer: fir, scale 0.8 */;
  assert.ok(swayTipMin(hMin, 9) >= 0.15, 'tree tip sway ' + swayTipMin(hMin, 9));
  assert.ok(swayTip(9, 12, 1, 1) > swayTip(9, 12, 1, 0) && swayTip(9, 40) === swayTip(9, SWAY.maxWind));
  assert.equal(qualityFactor('low'), 0.5); assert.equal(qualityFactor('high'), 1); assert.equal(qualityFactor(undefined), 1);
});

for (const [name, site0, surf0] of SITES) {
  test(`${name}: scatter plan is deterministic and respects water, keep-outs and slope`, () => {
    const site = structuredClone(site0), surf = surf0;
    const L = site.layout, stations = buildStations(site, surf, {});
    const blockers = [{ x0: L.ph.x - 40, z0: L.ph.z - 40, x1: L.ph.x + 40, z1: L.ph.z + 40 }, { x0: -60, z0: 200, x1: 0, z1: 260 }];
    const polys = [{ pts: [{ x: -300, z: -300 }, { x: 100, z: 50 }, { x: 300, z: 400 }], hw: 6 }];
    const geo = keepoutGeometry(site, { ts: cfg.ts, blockers, stations, polys }), keep = keepGridFrom(geo);
    const opts = { Sim, keep, poi: [L.ph, L.dam, ...L.parcels], quality: 1, seed: site.seed };
    const a = planScatter(surf, site, opts), b = planScatter(surf, site, opts);
    const flat = (p) => [...p.conifer, ...p.rock, p.tuft, ...p.flower];
    flat(a).forEach((arr, i) => assert.deepEqual(Array.from(arr), Array.from(flat(b)[i]), 'same seed, same plan'));
    const c = planScatter(surf, site, Object.assign({}, opts, { seed: (site.seed | 0) + 1 }));
    assert.notDeepEqual(Array.from(c.conifer[0]), Array.from(a.conifer[0]), 'different seed, different plan');
    const st = a.stats;
    assert.ok(st.conifers > 400 && st.conifers <= CAPS.conifer * 1.1, 'conifers ' + st.conifers);
    assert.ok(st.rocks > 30 && st.rocks <= CAPS.rock * 1.1 && st.tufts > 300 && st.tufts <= CAPS.tuft * 1.1 && st.flowers > 50 && st.flowers <= CAPS.flower * 1.1, JSON.stringify(st));
    assert.equal(a.conifer.length, 2); assert.equal(a.rock.length, 2); assert.equal(a.flower.length, 4);
    // independent water check: a second Surface flooded to the maximum levels (flood fill of the Surface itself)
    const ref = new Surface(site, Sim), lv = maxLevels(site, ref, Sim);
    ref.setWater({ up: lv.up, lo: lv.lo });
    const kinds = [['conifer', a.conifer, LIMITS.coniferSlope], ['rock', a.rock, LIMITS.rockSlope], ['tuft', [a.tuft], LIMITS.tuftSlope], ['flower', a.flower, LIMITS.flowerSlope]];
    let total = 0;
    for (const [kind, lists, maxSlope] of kinds) for (const arr of lists) for (let i = 0; i < arr.length; i += STRIDE) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2]; total++;
      assert.ok(ref.depth(x, z) <= 0, `${kind} in water at max level (${x.toFixed(1)}, ${z.toFixed(1)})`);
      assert.ok(Math.abs(y - surf.y(x, z)) < 1e-3, 'on surface.y');
      assert.ok(surf.slopeDeg(x, z) <= maxSlope + 1e-9, `${kind} slope`);
      assert.ok(!insideKeepout(geo, x, z), `${kind} inside a keep-out (parcel, blocker, station, route or path)`);
      for (const p of L.parcels) assert.ok(!(Math.abs(x - p.x) < 2 * cfg.ts && Math.abs(z - p.z) < 2 * cfg.ts), 'inside a parcel');
      for (const bx of blockers) assert.ok(!(x > bx.x0 && x < bx.x1 && z > bx.z0 && z < bx.z1), 'inside a blocker');
      assert.ok(Math.abs(x) < 800 && Math.abs(z) < 800);
    }
    assert.ok(total > 1000);
    for (const arr of a.conifer) for (let i = 0; i < arr.length; i += STRIDE) { assert.ok(arr[i + 3] >= 0.8 && arr[i + 3] <= 1.4); assert.ok(arr[i + 5] >= 0 && arr[i + 5] < 1 && arr[i + 7] >= 0 && arr[i + 7] < 1); }
  });
}

test('classic: a dam raise changes the scatter signature and the plan keeps clear of the bigger lake', () => {
  const g = start(CLASSIC), site = g.state.sites[0];
  const feat = FEATURES[2]({ scene: new Scene() });
  assert.equal(feat.name, 'scatter');
  const s0 = feat.signature(site), plan0 = planScatter(surfC, site, { Sim, keep: keepGridFrom(keepoutGeometry(site, {})), poi: [site.layout.ph], seed: site.seed });
  site.dam.height += 6;
  assert.notEqual(feat.signature(site), s0, 'dam height is in the signature');
  site.dam.raising = { from: site.dam.height, to: site.dam.height + 3 };
  const s1 = feat.signature(site); site.dam.raising.to += 1; assert.notEqual(feat.signature(site), s1, 'a pending raise too');
  const plan1 = planScatter(surfC, site, { Sim, keep: keepGridFrom(keepoutGeometry(site, {})), poi: [site.layout.ph], seed: site.seed });
  assert.ok(plan1.stats.conifers < plan0.stats.conifers, 'trees are removed where the raised lake will stand');
  const ref = new Surface(site, Sim), lv = maxLevels(site, ref, Sim);
  assert.ok(lv.up > maxLevels(start(CLASSIC).state.sites[0], ref, Sim).up);
  ref.setWater({ up: lv.up, lo: lv.lo });
  for (const arr of [...plan1.conifer, plan1.tuft, ...plan1.flower, ...plan1.rock]) for (let i = 0; i < arr.length; i += STRIDE) assert.ok(ref.depth(arr[i], arr[i + 2]) <= 0);
});

for (const [name, site, surf] of SITES) {
  test(`${name}: paths adapter, stair treads equal Flight.floor, documented shape works too`, () => {
    const stations = buildStations(site, surf, {}), raw = buildPaths(stations, surf, {});
    const np = normalizePaths(raw);
    assert.equal(np.segs.length, raw.edges.length); assert.equal(np.flights.length, raw.flights.length);
    assert.ok(np.flights.length >= 1);
    const chains = chainsOf(raw); assert.ok(chains.length >= 1);
    assert.equal(chains.reduce((a, c) => a + c.length - 1, 0), raw.edges.length, 'every edge in exactly one chain');
    np.flights.forEach((f, k) => {
      const rf = raw.flights[k], T = treadsOf(f);
      assert.equal(T.length, rf.tops.length); assert.ok(f.kind === 'stairs' || f.kind === 'bridge');
      assert.ok(Math.abs(T[T.length - 1].s1 - f.len) < 1e-9);
      for (let i = 0; i < T.length; i++) assert.equal(T[i].top, rf.tops[i]);
      // sample points on and around the flight: the drawn top equals the floor provider (NaN where there is no floor)
      const A = f.pts[0], B = f.pts[f.pts.length - 1], dx = (B.x - A.x) / f.len, dz = (B.z - A.z) / f.len;
      for (let s = -1; s <= f.len + 1; s += 0.13) for (const lat of [-2, -1.1, 0, 0.7, 1.19, 1.5]) {
        const x = A.x + dx * s - dz * lat, z = A.z + dz * s + dx * lat, want = rf.floor(x, z), got = drawnTop(f, x, z);
        if (want === want) assert.equal(got, want, 'tread top at s=' + s.toFixed(2)); else assert.ok(!(got === got) || Math.abs(Math.abs(lat) - f.hw) < 0.05 || s < 0 || s > f.len, 'no mesh where there is no floor');
      }
    });
    // documented fallback shape: [i,j] edges, {x,y,z} points and a top() function
    const doc = normalizePaths({ nodes: [{ x: 0, z: 0 }, { x: 5, z: 0 }], edges: [[0, 1]], flights: [{ pts: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 10 }], riser: 0.18, tread: 0.27, top: (x, z) => (z >= 0 && z <= 10 && Math.abs(x) <= 1.2 ? Math.round(z / 0.27) * 0.0 + Math.floor(z / 0.27) * 0.18 : NaN) }] });
    assert.equal(doc.segs.length, 1); assert.equal(doc.flights.length, 1);
    const df = doc.flights[0]; assert.equal(df.tops.length, Math.ceil(10 / 0.27));
    assert.ok(Math.abs(df.tops[3] - (Math.floor((3.5 * 0.27) / 0.27) * 0.18)) < 1e-9);
  });
}

test('smoke: every feature builds for classic 14692 and canyon 4242, 30 rebuilds leave the counts flat', () => {
  assert.equal(FEATURES.length, 4);
  for (const [name, site0, surf] of SITES) {
    const site = structuredClone(site0); fillTiles(site); site.tiles[3].solar = { tier: 1, building: true }; site.tiles[8].wind = { tier: 2, building: true, rpm: 0, v: 0 };
    surf.setWater({ up: surf.toDisplayY(site.upper.bottom + Sim.resLevel(site.upper, site.upper.V)), lo: surf.toDisplayY(site.lower.bottom + Sim.resLevel(site.lower, site.lower.V)) });
    const scene = new Scene(), cam = new PerspectiveCamera(45, 1.5, 1, 14000); cam.position.set(site.layout.parcels[0].x, surf.y(site.layout.parcels[0].x, site.layout.parcels[0].z) + 30, site.layout.parcels[0].z + 80); cam.lookAt(site.layout.parcels[0].x, 0, site.layout.parcels[0].z);
    const world = { scene, blockers: [], surface: surf, stations: null };
    const env = { scene, camera: cam, night: 0, doy: 120, hour: 12, season: 0.3, wind: 9, rain: 3, snow: 0, quality: 'high', view: { width: 800, height: 600, dpr: 1 }, site };
    const feats = FEATURES.map(make => make(world)), scopes = feats.map(f => new ResourceScope(f.name));
    const snapshot = () => ({ sizes: scopes.map(s => s.size), scene: scene.children.length, providers: surf.providers.length });
    let first = null;
    const before = surf.providers.length;
    for (let rep = 0; rep < 30; rep++) {
      feats.forEach((f, i) => {
        scopes[i].dispose(); scopes[i] = new ResourceScope(f.name);
        f.build(scopes[i], site, surf, env);
        for (let k = 0; k < 3; k++) f.frame(0.016, env);
      });
      const snap = snapshot();
      if (rep === 0) first = snap; else assert.deepEqual(snap, first, `${name}: counts differ on rebuild ${rep}`);
    }
    assert.ok(first.sizes.every((n) => n > 0));
    assert.ok(scene.children.length > 10);
    const T = { ...feats[1].stats }, Sc = { ...feats[2].stats };
    const hit = feats[1].pick({ x: site.layout.parcels[0].x, y: surf.y(site.layout.parcels[0].x, site.layout.parcels[0].z) + 200, z: site.layout.parcels[0].z }, { x: 0, y: -1, z: 0 }, 1e4);
    for (let i = 0; i < feats.length; i++) scopes[i].dispose();
    assert.equal(scene.children.length, 0, 'everything removed from the scene on dispose');
    assert.equal(surf.providers.length, before, 'floor providers removed on dispose');
    assert.equal(T.desks, 3); assert.ok(T.panels > 0 && T.rows > 0 && T.turbines > 0 && T.batteries > 0 && T.markers >= 2);
    assert.ok(Sc.conifers > 400);
    assert.ok(feats[3].state.rain > 0, 'rain intensity from env.rain');
    assert.ok(env.stormDarken >= 0 && env.stormDarken <= 1);
    // pick seam: the tile proxy answers world.pick's (origin, unitDir, tMax) call
    assert.ok(hit === null || hit.t > 0);
  }
});
