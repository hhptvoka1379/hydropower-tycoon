/* Scatter placement (THREE-free, deterministic: seeded integer hashes, never Math.random). Plans where conifers, rocks, grass tufts and flowers
   stand on a Surface, then the scatter feature turns the plan into instanced meshes. Heights come from surface.y only.

   Filters (all of them must pass): slope (surface.slopeDeg), water at the reservoirs' MAXIMUM level for the current/under-construction dam
   height (our own flood fill over the surface grid, the live water is never touched), the river channel, keep-out zones (parcels, structures,
   world.blockers, stations, footpaths and stair flights) and the altitude tree line. A raised dam changes the signature, so the plan is redone. */
import { hash3, vnoise, clamp, clamp01, smoothstep } from './hash.js';

export const LIMITS = { coniferSlope: 30, tuftSlope: 26, flowerSlope: 14, rockSlope: 58, cell: 4 };
export const CAPS = { conifer: 1500, rock: 300, tuft: 1200, flower: 400 };
export const STRIDE = 8;           // x, y, z, scale, rotY, r1 (hue), r2 (phase), r3 (autumn bias)

/* ---------- water at the maximum level ---------- */
export function maxLevels(site, surface, Sim) {
  const fb = Sim.CONFIG.res.freeboard, d = site.dam || {};
  const h = Math.max(d.height || 0, d.raising && d.raising.to ? d.raising.to : 0);
  return {
    up: d.built ? surface.toDisplayY(site.upper.bottom + Math.max(0, h - fb)) : NaN,
    lo: surface.toDisplayY(site.lower.bottom + site.lower.hMax),
  };
}
/* Flood fill of one lake at `level` over the surface grid, the same rule as Surface._flood (4-neighbours plus the drawn diagonals, inside the lake's allowed region). */
export function floodMax(surface, lake, level) {
  const { N, N1, H, D } = surface, wet = new Uint8Array(N1 * N1);
  if (!(level === level) || lake.seed < 0 || !(H[lake.seed] < level)) return wet;
  const q = new Int32Array(N1 * N1), allowed = lake.allowed;
  let qh = 0, qt = 0; wet[lake.seed] = 1; q[qt++] = lake.seed;
  const visit = (n) => { if (!wet[n] && allowed[n] && H[n] < level) { wet[n] = 1; q[qt++] = n; } };
  while (qh < qt) {
    const k = q[qh++], i = k % N1, j = (k - i) / N1;
    if (i > 0) visit(k - 1); if (i < N) visit(k + 1); if (j > 0) visit(k - N1); if (j < N) visit(k + N1);
    if (i < N && j < N && D[j * N + i] === 0) visit(k + N1 + 1);
    if (i > 0 && j > 0 && D[(j - 1) * N + (i - 1)] === 0) visit(k - N1 - 1);
    if (i < N && j > 0 && D[(j - 1) * N + i] === 1) visit(k - N1 + 1);
    if (i > 0 && j < N && D[j * N + (i - 1)] === 1) visit(k + N1 - 1);
  }
  return wet;
}
export function makeWaterTest(surface, site, Sim) {
  const lv = maxLevels(site, surface, Sim), { N, N1, X0, inv } = surface;
  const mask = new Uint8Array(N1 * N1);
  for (const lake of surface.lakes || []) {
    const w = floodMax(surface, lake, lake.name === 'up' ? lv.up : lv.lo);
    for (let k = 0; k < w.length; k++) mask[k] |= w[k];
  }
  const rd = typeof surface.riverDepth === 'function';
  /* true when (x,z) is in or within `dil` grid cells of water at the maximum level, or in the live river / live water */
  function wetAt(x, z, dil = 0) {
    let fx = (x - X0) * inv, fz = (z - X0) * inv;
    const i = clamp(Math.floor(fx), 0, N - 1), j = clamp(Math.floor(fz), 0, N - 1);
    for (let dj = -dil; dj <= 1 + dil; dj++) for (let di = -dil; di <= 1 + dil; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a > N || b > N) continue;
      if (mask[b * N1 + a]) return true;
    }
    if (surface.depth(x, z) > 0) return true;
    if (rd && (surface.riverDepth(x, z) > 0 || (dil > 0 && (surface.riverDepth(x + 2.5, z) > 0 || surface.riverDepth(x - 2.5, z) > 0)))) return true;
    return false;
  }
  return { mask, levels: lv, wetAt };
}

/* ---------- keep-out grid ---------- */
export class KeepGrid {
  constructor(size = 1600, cell = LIMITS.cell) { this.cell = cell; this.n = Math.ceil(size / cell); this.x0 = -size / 2; this.g = new Uint8Array(this.n * this.n); }
  _ij(x, z) { return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.x0) / this.cell)]; }
  /* any cell that overlaps the box is stamped (conservative) */
  box(x0, z0, x1, z1, margin = 0) {
    const [i0, j0] = this._ij(x0 - margin, z0 - margin), [i1, j1] = this._ij(x1 + margin, z1 + margin);
    for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) this.g[j * this.n + i] = 1;
  }
  circle(x, z, r) { this.box(x - r, z - r, x + r, z + r, 0); }
  /* a corridor of half-width `hw` along a polyline [{x,z}] */
  poly(pts, hw) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / (this.cell * 0.5)));
      for (let k = 0; k <= n; k++) this.circle(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n, hw);
    }
  }
  blocked(x, z) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.x0) / this.cell);
    return i < 0 || j < 0 || i >= this.n || j >= this.n || this.g[j * this.n + i] === 1;
  }
}

/* Everything the scatter must keep clear of, as plain geometry (also used by the tests to verify the plan independently):
   { boxes:[{x0,z0,x1,z1}], circles:[{x,z,r}], polys:[{pts:[{x,z}], hw}] } */
export function keepoutGeometry(site, o = {}) {
  const L = site.layout, ts = o.ts || 36, boxes = [], circles = [], polys = [];
  const pm = 2 * ts + 12;
  for (const p of L.parcels) boxes.push({ x0: p.x - pm, z0: p.z - pm, x1: p.x + pm, z1: p.z + pm });
  for (const b of o.blockers || []) boxes.push({ x0: Math.min(b.x0, b.x1) - 4, z0: Math.min(b.z0, b.z1) - 4, x1: Math.max(b.x0, b.x1) + 4, z1: Math.max(b.z0, b.z1) + 4 });
  circles.push({ x: L.ph.x, z: L.ph.z, r: 30 }, { x: L.dam.x, z: L.dam.z, r: 70 });
  if (L.tail) circles.push({ x: L.tail.x, z: L.tail.z, r: 24 });
  for (const s of o.stations || []) circles.push({ x: s.x, z: s.z, r: 9 });
  if (site.route && site.route.length > 1) polys.push({ pts: site.route.map(p => ({ x: p.x, z: p.z })), hw: 8 });
  for (const pl of o.polys || []) polys.push(pl);
  return { boxes, circles, polys };
}
export function keepGridFrom(geo, size = 1600) {
  const g = new KeepGrid(size);
  for (const b of geo.boxes) g.box(b.x0, b.z0, b.x1, b.z1, 0);
  for (const c of geo.circles) g.circle(c.x, c.z, c.r);
  for (const p of geo.polys) g.poly(p.pts, p.hw);
  return g;
}
/* exact (non-gridded) test, for verification */
export function insideKeepout(geo, x, z) {
  for (const b of geo.boxes) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
  for (const c of geo.circles) if (Math.hypot(x - c.x, z - c.z) <= c.r) return true;
  for (const p of geo.polys) for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i], b = p.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? clamp(((x - a.x) * ex + (z - a.z) * ez) / l2, 0, 1) : 0;
    if (Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)) <= p.hw) return true;
  }
  return false;
}

/* ---------- the plan ---------- */
function pushInst(list, x, y, z, s, rot, r1, r2, r3) { list.push(x, y, z, s, rot, r1, r2, r3); }

/* opts: { Sim, seed, quality (0.4..1), keep: KeepGrid, poi: [{x,z}], blockers... } -> { conifer:[3 arrays], rock:[2], tuft, flower:[4], stats } (Float32Array, stride 8) */
export function planScatter(surface, site, opts) {
  const { Sim } = opts, seed = (opts.seed !== undefined ? opts.seed : site.seed) | 0, q = opts.quality || 1;
  const water = makeWaterTest(surface, site, Sim), keep = opts.keep, poi = opts.poi || [];
  const X0 = surface.X0, SIZE = surface.SIZE, hMin = surface.hMin, hMax = surface.hMax;
  const treeLine = hMin + 0.82 * (hMax - hMin);
  // cluster centres (forest stands) and meadow centres
  const clusters = [];
  for (let i = 0; i < 80; i++) clusters.push([X0 + hash3(seed, i * 3, 1) * SIZE, X0 + hash3(seed, i * 3 + 1, 2) * SIZE, 45 + hash3(seed, i * 3 + 2, 3) * 120]);
  const dens = (x, z) => {
    let d = 0;
    for (let i = 0; i < clusters.length; i++) { const c = clusters[i], dx = x - c[0], dz = z - c[1], r = c[2]; if (dx > r || dx < -r || dz > r || dz < -r) continue; const k = 1 - Math.hypot(dx, dz) / r; if (k > d) d = k; }
    return clamp01(d * (0.75 + 0.5 * vnoise(seed + 5, x / 70, z / 70)) + 0.03);
  };
  const free = (x, z) => !(keep && keep.blocked(x, z));
  const conifer = [[], []], rock = [[], []], tuft = [], flower = [[], [], [], []];
  const stats = { candidates: 0, rejWater: 0, rejSlope: 0, rejKeep: 0 };
  // --- conifers: jittered grid, clustered density
  const GT = 8.5;
  for (let gz = X0 + 8; gz < X0 + SIZE - 8; gz += GT) for (let gx = X0 + 8; gx < X0 + SIZE - 8; gx += GT) {
    const ix = Math.round((gx - X0) / GT), iz = Math.round((gz - X0) / GT);
    const x = gx + (hash3(seed, ix, iz * 2 + 1) - 0.5) * GT * 0.85, z = gz + (hash3(seed, ix * 2 + 7, iz) - 0.5) * GT * 0.85;
    const d = dens(x, z);
    if (hash3(seed + 11, ix, iz) >= d * 0.95 * q) continue;
    stats.candidates++;
    if (!free(x, z)) { stats.rejKeep++; continue; }
    if (water.wetAt(x, z, 1)) { stats.rejWater++; continue; }
    const y = surface.y(x, z);
    if (y > treeLine - 25 && hash3(seed + 12, ix, iz) < smoothstep(treeLine - 25, treeLine + 10, y)) continue;
    if (surface.slopeDeg(x, z) > LIMITS.coniferSlope) { stats.rejSlope++; continue; }
    const r = hash3(seed + 13, ix, iz), hi = smoothstep(hMin + 0.3 * (hMax - hMin), treeLine, y);
    const v = r < 0.5 - 0.15 * hi ? 0 : 1;
    pushInst(conifer[v], x, y, z, 0.8 + hash3(seed + 14, ix, iz) * 0.6, hash3(seed + 15, ix, iz) * 6.2832, hash3(seed + 16, ix, iz), hash3(seed + 17, ix, iz), hash3(seed + 18, ix, iz));
  }
  // --- rocks: sparse, more on steep ground, above the tree line and on river banks
  const GR = 12;
  for (let gz = X0 + 6; gz < X0 + SIZE - 6; gz += GR) for (let gx = X0 + 6; gx < X0 + SIZE - 6; gx += GR) {
    const ix = Math.round((gx - X0) / GR), iz = Math.round((gz - X0) / GR);
    const x = gx + (hash3(seed + 21, ix, iz) - 0.5) * GR * 0.9, z = gz + (hash3(seed + 22, ix, iz) - 0.5) * GR * 0.9;
    const y = surface.y(x, z), sl = surface.slopeDeg(x, z);
    const p = 0.012 + 0.3 * smoothstep(16, 38, sl) + 0.1 * smoothstep(treeLine - 10, treeLine + 20, y);
    if (hash3(seed + 23, ix, iz) >= p * q) continue;
    if (sl > LIMITS.rockSlope || !free(x, z) || water.wetAt(x, z, 0)) continue;
    const r = hash3(seed + 24, ix, iz), s = 0.7 + Math.pow(hash3(seed + 25, ix, iz), 2) * 2.8;
    pushInst(rock[r < 0.6 ? 0 : 1], x, y, z, s, hash3(seed + 26, ix, iz) * 6.2832, hash3(seed + 27, ix, iz), hash3(seed + 28, ix, iz), 0);
  }
  // river-bank boulders (canyon sites)
  if (surface.river) {
    for (let z = X0 + 4; z < X0 + SIZE - 4; z += 7) {
      const cx = surface.river.cx(z), half = surface.river.half(z);
      for (const sd of [-1, 1]) {
        const iz = Math.round((z - X0) / 7), r = hash3(seed + 31, iz, sd + 2);
        if (r >= 0.5) continue;
        const x = cx + sd * (half + 1.5 + r * 5), zz = z + (r - 0.25) * 6;
        if (!free(x, zz) || water.wetAt(x, zz, 0) || surface.slopeDeg(x, zz) > LIMITS.rockSlope) continue;
        pushInst(rock[r < 0.25 ? 0 : 1], x, surface.y(x, zz), zz, 0.6 + r * 3.6, r * 31, hash3(seed + 32, iz, sd + 2), hash3(seed + 33, iz, sd + 2), 0);
          }
    }
  }
  // --- tufts: dense where the player is (stations, parcels, the plant), thin elsewhere
  const GG = 4.4;
  const nearPoi = (x, z) => { let k = 0; for (let i = 0; i < poi.length; i++) { const dx = x - poi[i].x, dz = z - poi[i].z, d2 = dx * dx + dz * dz; if (d2 < 220 * 220) { const t = 1 - Math.sqrt(d2) / 220; if (t > k) k = t; } } return k; };
  for (let gz = X0 + 6; gz < X0 + SIZE - 6; gz += GG) for (let gx = X0 + 6; gx < X0 + SIZE - 6; gx += GG) {
    const ix = Math.round((gx - X0) / GG), iz = Math.round((gz - X0) / GG);
    const x = gx + (hash3(seed + 41, ix, iz) - 0.5) * GG, z = gz + (hash3(seed + 42, ix, iz) - 0.5) * GG;
    const near = nearPoi(x, z), p = (0.03 + 0.5 * near * near) * (0.6 + 0.8 * (0.5 + 0.5 * vnoise(seed + 43, x / 24, z / 24)));
    if (hash3(seed + 44, ix, iz) >= p * q) continue;
    if (!free(x, z) || water.wetAt(x, z, 1)) continue;
    const y = surface.y(x, z);
    if (y > treeLine + 15 || surface.slopeDeg(x, z) > LIMITS.tuftSlope) continue;
    pushInst(tuft, x, y, z, 0.8 + hash3(seed + 45, ix, iz) * 0.9, hash3(seed + 46, ix, iz) * 6.2832, hash3(seed + 47, ix, iz), hash3(seed + 48, ix, iz), hash3(seed + 49, ix, iz));
  }
  // --- flower meadows: patches on gentle open ground
  for (let pi = 0; pi < 90; pi++) {
    const cx = X0 + 60 + hash3(seed + 51, pi, 1) * (SIZE - 120), cz = X0 + 60 + hash3(seed + 51, pi, 2) * (SIZE - 120), pr = 14 + hash3(seed + 51, pi, 3) * 20;
    if (dens(cx, cz) > 0.4 || !free(cx, cz) || water.wetAt(cx, cz, 2) || surface.y(cx, cz) > treeLine - 30) continue;
    const main = Math.floor(hash3(seed + 52, pi, 4) * 4), alt = Math.floor(hash3(seed + 52, pi, 5) * 4);
    for (let gz = -pr; gz <= pr; gz += 3.2) for (let gx = -pr; gx <= pr; gx += 3.2) {
      const jx = Math.round(gx * 5), jz = Math.round(gz * 5);
      const x = cx + gx + (hash3(seed + 53, pi * 7 + jx, jz) - 0.5) * 2.8, z = cz + gz + (hash3(seed + 54, pi * 7 + jz, jx) - 0.5) * 2.8, dd = Math.hypot(x - cx, z - cz) / pr;
      if (dd > 1 || hash3(seed + 55, pi * 7 + jx, jz + 3) > 0.92 - 0.6 * dd * dd) continue;
      if (!free(x, z) || water.wetAt(x, z, 1) || surface.slopeDeg(x, z) > LIMITS.flowerSlope) continue;
      const u = hash3(seed + 56, pi * 7 + jx, jz), c = u < 0.72 ? main : u < 0.86 ? alt : Math.floor(hash3(seed + 57, jx, jz) * 4);
      pushInst(flower[c], x, surface.y(x, z), z, 0.8 + hash3(seed + 58, jx, jz) * 0.8, hash3(seed + 59, jx, jz) * 6.2832, hash3(seed + 60, pi, jx + jz), hash3(seed + 61, jx, jz), 0);
    }
  }
  // caps: thin by the (uniform, independent) phase value so no part of the map is favoured
  const thin = (lists, cap) => {
    const n = lists.reduce((a, l) => a + l.length / STRIDE, 0);
    if (n <= cap) return lists.map(l => Float32Array.from(l));
    const keepP = cap / n;
    return lists.map(l => { const o = []; for (let i = 0; i < l.length; i += STRIDE) if (l[i + 6] < keepP) for (let k = 0; k < STRIDE; k++) o.push(l[i + k]); return Float32Array.from(o); });
  };
  const plan = {
    conifer: thin(conifer, CAPS.conifer * q), rock: thin(rock, CAPS.rock * q), tuft: thin([tuft], CAPS.tuft * q)[0], flower: thin(flower, CAPS.flower * q),
    levels: water.levels, stats, wetAt: water.wetAt,
  };
  const cnt = (l) => l.reduce((a, x) => a + x.length / STRIDE, 0);
  stats.conifers = cnt(plan.conifer); stats.rocks = cnt(plan.rock); stats.tufts = plan.tuft.length / STRIDE; stats.flowers = cnt(plan.flower);
  return plan;
}
