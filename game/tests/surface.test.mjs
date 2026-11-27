/* Surface sampler (game/world/surface.js): triangle-exact height, DDA raycast vs brute force, live water depth, unit conversion.
   Deterministic: a seeded LCG, no Math.random. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, start, CLASSIC, CANYON, CANYON_SETUP } from './helpers.mjs';
import { Surface, VEX } from '../world/surface.js';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

const classic = start(CLASSIC).state.sites[0];
const canyon = start(CANYON[4242], CANYON_SETUP).state.sites[0];
const surfC = new Surface(classic, Sim);
const surfK = new Surface(canyon, Sim);

/* Independent reference: plane through the three vertices of the cell's chosen triangle (cross product form). */
function planeY(S, x, z) {
  const { N, N1, X0, CELL, H } = S;
  const fx = (x - X0) / CELL, fz = (z - X0) / CELL;
  const i = Math.min(N - 1, Math.floor(fx)), j = Math.min(N - 1, Math.floor(fz));
  const h = (a, b) => H[(j + b) * N1 + i + a];
  const px = X0 + i * CELL, pz = X0 + j * CELL;
  const v = (a, b) => [px + a * CELL, h(a, b), pz + b * CELL];
  const split00_11 = Math.abs(h(0, 0) - h(1, 1)) <= Math.abs(h(1, 0) - h(0, 1));
  const u = fx - i, w = fz - j;
  let A, B, C;
  if (split00_11) { if (w <= u) { A = v(0, 0); B = v(1, 0); C = v(1, 1); } else { A = v(0, 0); B = v(0, 1); C = v(1, 1); } }
  else if (u + w <= 1) { A = v(0, 0); B = v(1, 0); C = v(0, 1); }
  else { A = v(1, 0); B = v(1, 1); C = v(0, 1); }
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return A[1] - (n[0] * (x - A[0]) + n[2] * (z - A[2])) / n[1];
}

test('constants: VEX 1.5, cell 8 m, N 200 over 1600 m', () => {
  assert.equal(VEX, 1.5);
  assert.equal(surfC.N, 200); assert.equal(surfC.CELL, 8); assert.equal(surfC.SIZE, 1600);
  assert.equal(surfC.H.length, 201 * 201);
});

test('grid heights are Sim.terrainH x VEX and finite', () => {
  for (const S of [surfC, surfK]) {
    const rng = lcg(7);
    for (let n = 0; n < 200; n++) {
      const i = Math.floor(rng() * 201), j = Math.floor(rng() * 201);
      const want = Sim.terrainH(S.site, S.X0 + i * 8, S.X0 + j * 8) * 1.5;
      assert.ok(Math.abs(S.H[j * 201 + i] - want) < 1e-3, 'vertex height');
    }
    for (let k = 0; k < S.H.length; k++) assert.ok(Number.isFinite(S.H[k]));
  }
});

test('diagonal rule: |h00-h11| <= |h10-h01| splits 00-11', () => {
  for (const S of [surfC, surfK]) {
    for (let j = 0; j < S.N; j++) for (let i = 0; i < S.N; i++) {
      const k = j * S.N1 + i, H = S.H;
      const want = Math.abs(H[k] - H[k + S.N1 + 1]) <= Math.abs(H[k + 1] - H[k + S.N1]) ? 0 : 1;
      assert.equal(S.D[j * S.N + i], want);
    }
  }
});

test('y() equals the plane of the chosen triangle at 10,000 deterministic points (classic + canyon)', () => {
  for (const S of [surfC, surfK]) {
    const rng = lcg(14692);
    let worst = 0;
    for (let n = 0; n < 10000; n++) {
      const x = -799.99 + rng() * 1599.98, z = -799.99 + rng() * 1599.98;
      const d = Math.abs(S.y(x, z) - planeY(S, x, z));
      if (d > worst) worst = d;
      assert.ok(d < 1e-5, `y mismatch ${d} at ${x},${z}`);
    }
    assert.ok(worst < 1e-5);
  }
});

test('y() is continuous across cell edges and reproduces vertex heights', () => {
  const S = surfC, rng = lcg(5);
  for (let n = 0; n < 500; n++) {
    const i = 1 + Math.floor(rng() * 198), j = 1 + Math.floor(rng() * 198);
    const x = S.X0 + i * 8, z = S.X0 + j * 8;
    assert.ok(Math.abs(S.y(x, z) - S.H[j * 201 + i]) < 1e-4);
    const t = rng();   // along an edge: both neighbouring cells agree
    assert.ok(Math.abs(S.y(x + t * 8, z + 1e-9) - S.y(x + t * 8, z - 1e-9)) < 1e-4);
    assert.ok(Math.abs(S.y(x + 1e-9, z + t * 8) - S.y(x - 1e-9, z + t * 8)) < 1e-4);
  }
});

test('yReal = y / VEX, toDisplayY(simY) = simY * 1.5', () => {
  assert.equal(surfC.toDisplayY(100), 150);
  assert.equal(surfC.toRealY(150), 100);
  assert.ok(Math.abs(surfC.yReal(12.3, -45.6) * 1.5 - surfC.y(12.3, -45.6)) < 1e-9);
  assert.ok(Math.abs(surfC.yReal(-200, 300) - Sim.terrainH(classic, -200, 300)) < 40, 'same order as the sim height');
});

test('normal is a unit vector pointing up; slope matches the gradient', () => {
  const S = surfK, n = { x: 0, y: 0, z: 0 }, rng = lcg(99);
  for (let k = 0; k < 500; k++) {
    const x = -790 + rng() * 1580, z = -790 + rng() * 1580;
    S.normal(x, z, n);
    assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9 && n.y > 0);
    const sl = S.slopeDeg(x, z);
    assert.ok(Math.abs(Math.acos(n.y) * 180 / Math.PI - sl) < 1e-6);
  }
});

/* Brute-force reference: every triangle of the grid, plane intersection + barycentric. */
function bruteRay(S, o, d) {
  const len = Math.hypot(d.x, d.y, d.z), dx = d.x / len, dy = d.y / len, dz = d.z / len;
  let best = null;
  const { N, N1, X0, CELL, H } = S;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N1 + i, x0 = X0 + i * CELL, z0 = X0 + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const p00 = [x0, H[k], z0], p10 = [x1, H[k + 1], z0], p01 = [x0, H[k + N1], z1], p11 = [x1, H[k + N1 + 1], z1];
    const tris = S.D[j * N + i] === 0 ? [[p00, p10, p11], [p00, p01, p11]] : [[p00, p10, p01], [p10, p11, p01]];
    for (const [A, B, C] of tris) {
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const den = n[0] * dx + n[1] * dy + n[2] * dz;
      if (Math.abs(den) < 1e-12) continue;
      const t = (n[0] * (A[0] - o.x) + n[1] * (A[1] - o.y) + n[2] * (A[2] - o.z)) / den;
      if (t < 0) continue;
      const px = o.x + dx * t - A[0], py = o.y + dy * t - A[1], pz = o.z + dz * t - A[2];
      const d00 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], d01 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], d11 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
      const d20 = px * e1[0] + py * e1[1] + pz * e1[2], d21 = px * e2[0] + py * e2[1] + pz * e2[2];
      const dd = d00 * d11 - d01 * d01;
      const v = (d11 * d20 - d01 * d21) / dd, w = (d00 * d21 - d01 * d20) / dd;
      if (v < -1e-9 || w < -1e-9 || v + w > 1 + 1e-9) continue;
      if (!best || t < best) best = t;
    }
  }
  return best;
}

test('raycast equals brute force over all triangles (120 rays, classic + canyon)', () => {
  for (const S of [surfC, surfK]) {
    const rng = lcg(4242);
    let hits = 0;
    for (let n = 0; n < 60; n++) {
      const o = { x: -900 + rng() * 1800, y: S.hMin + 5 + rng() * (S.hMax - S.hMin + 120), z: -900 + rng() * 1800 };
      // mostly downward, some shallow, some upward-ish
      const d = { x: rng() * 2 - 1, y: -1.2 * rng() + 0.1 * rng(), z: rng() * 2 - 1 };
      const a = S.raycast(o, d), t0 = bruteRay(S, o, d);
      if (t0 === null) { assert.equal(a, null, 'expected a miss'); continue; }
      assert.ok(a, 'expected a hit at t=' + t0);
      assert.ok(Math.abs(a.t - t0) < 1e-4, `t ${a.t} vs ${t0}`);
      hits++;
      assert.ok(Math.abs(a.y - S.y(a.x, a.z)) < 1e-3, 'hit lies on the surface');
    }
    assert.ok(hits > 20, 'enough rays actually hit (' + hits + ')');
  }
});

test('raycast: straight-down rays land on y(x,z); tMax and misses behave', () => {
  const S = surfK, rng = lcg(11);
  for (let n = 0; n < 200; n++) {
    const x = -790 + rng() * 1580, z = -790 + rng() * 1580;
    const h = S.raycast({ x, y: S.hMax + 50, z }, { x: 0, y: -1, z: 0 });
    assert.ok(h && Math.abs(h.y - S.y(x, z)) < 1e-4 && Math.abs(h.x - x) < 1e-9);
    assert.ok(h.ny > 0 && Math.abs(Math.hypot(h.nx, h.ny, h.nz) - 1) < 1e-9);
  }
  assert.equal(S.raycast({ x: 0, y: S.hMax + 50, z: 0 }, { x: 0, y: -1, z: 0 }, 10), null, 'tMax');
  assert.equal(S.raycast({ x: 0, y: S.hMax + 50, z: 0 }, { x: 0, y: 1, z: 0 }), null, 'ray pointing away');
  assert.equal(S.raycast({ x: 2000, y: 500, z: 0 }, { x: 1, y: -0.1, z: 0 }), null, 'outside the box, heading away');
  assert.equal(S.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), null, 'zero direction');
});

test('floor providers raise floorY, never y; removal restores', () => {
  const S = surfC, x = 20, z = -30, g = S.y(x, z);
  const off = S.addFloorProvider((px, pz) => (Math.abs(px - x) < 5 ? g + 3 : -Infinity));
  assert.ok(Math.abs(S.floorY(x, z) - (g + 3)) < 1e-9);
  assert.equal(S.y(x, z), g);
  assert.equal(S.floorY(400, 400), S.y(400, 400));
  off();
  assert.equal(S.floorY(x, z), g);
});

/* ---------- water ---------- */
const levels = (st) => { const s = st.sites[0]; return { up: (s.upper.bottom + Sim.resLevel(s.upper, s.upper.V)) * VEX, lo: (s.lower.bottom + Sim.resLevel(s.lower, s.lower.V)) * VEX }; };

test('classic lakes: depth/waterSurface at the live level, dry far away, level changes move the shore', () => {
  const S = new Surface(classic, Sim);
  const lv = levels(start(CLASSIC).state);
  S.setWater(lv);
  const L = classic.layout;
  for (const [c, level] of [[L.up, lv.up], [L.lo, lv.lo]]) {
    const d = S.depth(c.x, c.z);
    assert.ok(d > 0.5, 'lake centre is wet, depth ' + d);
    assert.ok(Math.abs(S.waterSurface(c.x, c.z) - level) < 1e-4, 'surface equals live level');
    assert.ok(Math.abs(d - (level - S.y(c.x, c.z))) < 1e-4);
  }
  assert.ok(Number.isNaN(S.waterSurface(L.parcels[0].x, L.parcels[0].z)), 'a parcel is dry');
  assert.equal(S.depth(L.parcels[1].x, L.parcels[1].z), 0);
  // more water -> larger wet set; no water -> nothing wet
  const wetCount = (k) => S.lakes[k].count;
  const c0 = wetCount(0);
  S.setWater({ up: lv.up + 6, lo: lv.lo });
  assert.ok(wetCount(0) > c0, 'raising the level floods more vertices');
  S.setWater({ up: lv.up - 8, lo: lv.lo });
  assert.ok(wetCount(0) < c0, 'lowering retreats the shore');
  S.setWater({ up: NaN, lo: NaN });
  assert.equal(S.depth(L.up.x, L.up.z), 0);
  assert.ok(Number.isNaN(S.waterSurface(L.lo.x, L.lo.z)));
});

test('canyon: river stays wet in the channel, upper lake only upstream of the dam axis', () => {
  const S = new Surface(canyon, Sim);
  const cp = canyon.cp;
  const zUp = canyon.layout.dam.z - 400;       // well upstream of the dam
  assert.ok(S.depth(Sim.cX(cp, zUp), zUp) > 0, 'river wet at the channel centre');
  assert.equal(S.depth(Sim.cX(cp, zUp) + 60, zUp), 0, 'dry on the bank');
  // the dam is a construction job in the sim: use a synthetic level for the geometry check
  const lvUp = (canyon.upper.bottom + 10) * VEX;
  S.setWater({ up: lvUp, lo: NaN });
  const d = canyon.layout.dam;
  const tx = -d.dz, tz = d.dx;
  const upstream = [d.x - tx * 25, d.z - tz * 25], downstream = [d.x + tx * 25, d.z + tz * 25];
  assert.ok(S.depth(...upstream) > 0.2, 'lake upstream of the dam');
  const w = S.lakes[0].level - S.y(...downstream);
  assert.ok(w > 0, 'downstream floor is below the lake level, yet it must not be flooded');
  // the drawn lake wet set never contains a vertex downstream of the dam axis
  const { N, N1, X0, CELL } = S, wet = S.lakes[0].wet;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) if (wet[j * N1 + i]) {
    const a = (X0 + i * CELL - d.x) * tx + (X0 + j * CELL - d.z) * tz;
    assert.ok(a <= -2, 'wet vertex downstream of the dam axis');
  }
  assert.ok(S.lakes[0].count > 20, 'lake has area');
});

/* Synthetic terrain: two bowls and a pit that is below the level but not connected to the lake. */
function pocketWorld(offset = 0) {
  const terrainH = (s, x, z) => {
    const dx = x + 100, dz = z; let h = 10 + 0.002 * (dx * dx + dz * dz);
    const px = x + 150, pz = z - 50;
    if (px * px + pz * pz < 10 * 10) h = 2;
    const lx = x - 100; h = Math.min(h, 4 + 0.002 * (lx * lx + dz * dz));
    const r2 = (x - 40) ** 2 + z * z;
    return r2 < 1600 ? h + offset * (1 - r2 / 1600) : h;   // compact bump so a region rebuild can be exact
  };
  terrainH.shoreF = () => 1;
  const Sm = { terrainH, bowlR: () => 80, cX: () => 0, cW: () => 10 };
  const site = { kind: 'classic', layout: { up: { x: -100, z: 0 }, lo: { x: 100, z: 0 }, dam: { r: 90 } }, lower: { hMax: 5 } };
  return new Surface(site, Sm, { N: 50, size: 400 });
}

test('flood fill: a pit below the level that is not connected stays dry; it floods once connected', () => {
  const S = pocketWorld();
  const pit = [-150, 50], centre = [-100, 0];
  S.setWater({ up: 12 * VEX, lo: NaN });
  assert.ok(S.depth(centre[0], centre[1]) > 0, 'main lake wet');
  assert.ok(S.y(pit[0], pit[1]) < S.lakes[0].level, 'the pit is below the level');
  assert.equal(S.depth(pit[0], pit[1]), 0, 'disconnected pocket is dry');
  assert.ok(Number.isNaN(S.waterSurface(pit[0], pit[1])));
  S.setWater({ up: 30 * VEX, lo: NaN });
  assert.ok(S.depth(pit[0], pit[1]) > 0, 'connected at a high level');
});

test('rebuildRegion equals a full rebuild after a terrain edit', () => {
  const S = pocketWorld(0);
  S.Sim.terrainH = pocketWorld(8).Sim.terrainH;
  const box = S.rebuildRegion(-60, -60, 140, 60);
  assert.ok(box.i1 >= box.i0 && box.j1 >= box.j0);
  const F = new Surface(S.site, S.Sim, { N: 50, size: 400 });
  assert.deepEqual(Array.from(S.H), Array.from(F.H));
  assert.deepEqual(Array.from(S.D), Array.from(F.D));
});

test('setWater is cheap to repeat: an unchanged level does not bump the water version', () => {
  const S = pocketWorld();
  S.setWater({ up: 14, lo: NaN });
  const v = S.waterVersion;
  S.setWater({ up: 14, lo: NaN });
  assert.equal(S.waterVersion, v);
  S.setWater({ up: 14.5, lo: NaN });
  assert.ok(S.waterVersion > v);
});
