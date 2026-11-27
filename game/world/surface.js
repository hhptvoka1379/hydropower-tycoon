/* The single ground sampler (decisions/fable.md D1, D2). Pure JS: no THREE, no DOM, runs in Node.
   Mesh, water, placement, picking, walking and camera all read this object; nothing else interpolates terrain height.

   Grid: N x N cells of CELL metres over SIZE metres, vertices (N+1)^2. Heights are DISPLAY metres: Sim.terrainH * VEX, computed once.
   Each cell is split into two triangles; the diagonal is chosen from the corner heights
     |h00-h11| <= |h10-h01|  ->  split 00-11 (D=0)   else split 10-01 (D=1)
   and y(x,z) is the exact plane of the triangle containing (x,z), so the drawn mesh and every sampled height are the same surface.
   Vertex (i,j) is at x = X0 + i*CELL, z = X0 + j*CELL; h00=(i,j) h10=(i+1,j) h01=(i,j+1) h11=(i+1,j+1).

   Water: setWater({up, lo}) takes live DISPLAY levels (use toDisplayY(site.upper.bottom + Sim.resLevel(...))). A lake is the set of
   vertices below its level that are 4-/diagonal-connected (along drawn triangle edges) to the lake's seed inside the lake's allowed
   region (flood fill), so disconnected pockets stay dry. depth()/waterSurface() agree with the water mesh by construction:
   a triangle is wet when one of its vertices is in the flooded set, and the wet part is where level > y. */

export const VEX = 1.5;
export const GRID_N = 200;
export const GRID_SIZE = 1600;
const RIVER_LIFT = 0.25;      // display m: the river strip floats this high over the drawn floor
const RIVER_STAGE = 0.35;     // display m: extra stage at the channel centre (wadable stream, 0.1..0.45 m)

export class Surface {
  /* site: sim site state (kind, layout, upper, lower, cp, ...). Sim: the public Sim object (terrainH, cX, cW, cBed, riverW, bowlR). */
  constructor(site, Sim, opts = {}) {
    this.site = site;
    this.Sim = Sim;
    this.VEX = opts.vex || VEX;
    this.N = opts.N || GRID_N;
    this.SIZE = opts.size || GRID_SIZE;
    this.X0 = -this.SIZE / 2;
    this.CELL = this.SIZE / this.N;
    this.inv = 1 / this.CELL;
    const n1 = this.N + 1;
    this.N1 = n1;
    this.H = new Float32Array(n1 * n1);
    this.D = new Uint8Array(this.N * this.N);
    this.version = 0;
    this.waterVersion = 0;
    this.hMin = 0; this.hMax = 0;
    this.providers = [];
    // scratch (no allocation in the hot paths)
    this._i = 0; this._j = 0; this._u = 0; this._v = 0; this._tri = 0;
    this._a = 0; this._b = 0; this._c = 0;   // vertex indices of the located triangle
    this._gx = 0; this._gz = 0;               // plane gradient of the located triangle (display m per m)
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, i: 0, j: 0, tri: 0 };
    this.rebuild();
    this._makeLakes();
    this._makeRiver();
  }

  /* ----- build ----- */
  rebuild() {
    const { N, N1, X0, CELL, VEX: vex, Sim, site, H } = this;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * N1 + i] = Sim.terrainH(site, X0 + i * CELL, X0 + j * CELL) * vex;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this._diag(i, j);
    this._minmax();
    this.version++;
  }
  /* Re-sample a rectangle (metres) after a terrain edit; returns the touched cell box {i0,i1,j0,j1} (inclusive cells). */
  rebuildRegion(x0, z0, x1, z1) {
    const { N, N1, X0, CELL, VEX: vex, Sim, site, H } = this;
    const vi0 = Math.max(0, Math.floor((x0 - X0) / CELL)), vi1 = Math.min(N, Math.ceil((x1 - X0) / CELL));
    const vj0 = Math.max(0, Math.floor((z0 - X0) / CELL)), vj1 = Math.min(N, Math.ceil((z1 - X0) / CELL));
    for (let j = vj0; j <= vj1; j++) for (let i = vi0; i <= vi1; i++) H[j * N1 + i] = Sim.terrainH(site, X0 + i * CELL, X0 + j * CELL) * vex;
    const i0 = Math.max(0, vi0 - 1), i1 = Math.min(N - 1, vi1), j0 = Math.max(0, vj0 - 1), j1 = Math.min(N - 1, vj1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this._diag(i, j);
    this._minmax();
    this.version++;
    this.waterVersion++;
    for (const lk of this.lakes) lk.level = NaN;   // force a re-flood on the next setWater
    return { i0, i1, j0, j1 };
  }
  _diag(i, j) {
    const H = this.H, k = j * this.N1 + i;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + this.N1], h11 = H[k + this.N1 + 1];
    this.D[j * this.N + i] = Math.abs(h00 - h11) <= Math.abs(h10 - h01) ? 0 : 1;
  }
  _minmax() {
    let mn = Infinity, mx = -Infinity;
    const H = this.H;
    for (let k = 0; k < H.length; k++) { const h = H[k]; if (h < mn) mn = h; if (h > mx) mx = h; }
    this.hMin = mn; this.hMax = mx;
  }

  /* ----- unit conversion ----- */
  toDisplayY(simY) { return simY * this.VEX; }
  toRealY(dispY) { return dispY / this.VEX; }

  /* ----- height ----- */
  /* Locate (x,z): sets _i,_j,_u,_v,_tri and the three vertex indices _a,_b,_c. Triangle ids: 0 = first, 1 = second (see header). */
  _locate(x, z) {
    const N = this.N;
    let fx = (x - this.X0) * this.inv, fz = (z - this.X0) * this.inv;
    fx = fx < 0 ? 0 : fx > N ? N : fx;
    fz = fz < 0 ? 0 : fz > N ? N : fz;
    let i = fx | 0, j = fz | 0;
    if (i >= N) i = N - 1;
    if (j >= N) j = N - 1;
    const u = fx - i, v = fz - j, k = j * this.N1 + i, N1 = this.N1;
    this._i = i; this._j = j; this._u = u; this._v = v;
    if (this.D[j * N + i] === 0) {           // split 00-11
      if (v <= u) { this._tri = 0; this._a = k; this._b = k + 1; this._c = k + N1 + 1; }          // 00,10,11
      else { this._tri = 1; this._a = k; this._b = k + N1; this._c = k + N1 + 1; }                // 00,01,11
    } else {                                  // split 10-01
      if (u + v <= 1) { this._tri = 0; this._a = k; this._b = k + 1; this._c = k + N1; }         // 00,10,01
      else { this._tri = 1; this._a = k + 1; this._b = k + N1 + 1; this._c = k + N1; }            // 10,11,01
    }
  }
  /* Height of the located triangle at (_u,_v) and its gradient (display m per m). */
  _evalLocated() {
    const H = this.H, k = this._j * this.N1 + this._i, N1 = this.N1, u = this._u, v = this._v, inv = this.inv;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + N1], h11 = H[k + N1 + 1];
    let y, du, dv;
    if (this.D[this._j * this.N + this._i] === 0) {
      if (this._tri === 0) { du = h10 - h00; dv = h11 - h10; y = h00 + u * du + v * dv; }
      else { du = h11 - h01; dv = h01 - h00; y = h00 + v * dv + u * du; }
    } else if (this._tri === 0) { du = h10 - h00; dv = h01 - h00; y = h00 + u * du + v * dv; }
    else { du = h11 - h01; dv = h11 - h10; y = h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11); }
    this._gx = du * inv; this._gz = dv * inv;
    return y;
  }
  y(x, z) { this._locate(x, z); return this._evalLocated(); }
  yReal(x, z) { return this.y(x, z) / this.VEX; }
  /* Unit normal of the triangle at (x,z) written into out {x,y,z}. */
  normal(x, z, out) {
    this._locate(x, z); this._evalLocated();
    const gx = this._gx, gz = this._gz, l = 1 / Math.sqrt(gx * gx + gz * gz + 1);
    out.x = -gx * l; out.y = l; out.z = -gz * l;
    return out;
  }
  slopeDeg(x, z) {
    this._locate(x, z); this._evalLocated();
    return Math.atan(Math.sqrt(this._gx * this._gx + this._gz * this._gz)) * 57.29577951308232;
  }
  /* Vertex height lookup by grid index (display m). */
  hAt(i, j) { return this.H[j * this.N1 + i]; }

  /* Walking surface: ground or any registered deck/stair/crest, whichever is higher. Placement uses y(), never floorY(). */
  addFloorProvider(fn) { this.providers.push(fn); return () => this.removeFloorProvider(fn); }
  removeFloorProvider(fn) { const k = this.providers.indexOf(fn); if (k >= 0) this.providers.splice(k, 1); }
  floorY(x, z) {
    let h = this.y(x, z);
    for (let k = 0; k < this.providers.length; k++) { const p = this.providers[k](x, z); if (p > h) h = p; }
    return h;
  }

  /* ----- ray casting (grid DDA, triangle-exact) -----
     origin {x,y,z}, dir {x,y,z} (any length, normalised here). Returns {t,x,y,z,nx,ny,nz,i,j,tri} (t in metres along the ray) or null.
     Pass `out` to avoid allocation; with no `out` a shared scratch object is returned (copy it if you keep it). */
  raycast(origin, dir, tMax = Infinity, out = this._hit) {
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 0)) return null;
    dx /= len; dy /= len; dz /= len;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const N = this.N, N1 = this.N1, X0 = this.X0, CELL = this.CELL, H = this.H;
    let t0 = 0, t1 = tMax;
    // clip against the slab of the whole terrain box
    const slab = (o, d, lo, hi) => {
      if (d === 0) return o >= lo && o <= hi;
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    const x1 = X0 + this.SIZE;
    if (!slab(ox, dx, X0, x1) || !slab(oz, dz, X0, x1) || !slab(oy, dy, this.hMin - 1e-3, this.hMax + 1e-3)) return null;
    const eps = 1e-9;
    let px = ox + dx * t0, pz = oz + dz * t0;
    let i = Math.floor((px - X0) / CELL), j = Math.floor((pz - X0) / CELL);
    i = i < 0 ? 0 : i >= N ? N - 1 : i; j = j < 0 ? 0 : j >= N ? N - 1 : j;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = sx ? CELL / Math.abs(dx) : Infinity, tdz = sz ? CELL / Math.abs(dz) : Infinity;
    let tnx = sx ? ((sx > 0 ? X0 + (i + 1) * CELL : X0 + i * CELL) - ox) / dx : Infinity;
    let tnz = sz ? ((sz > 0 ? X0 + (j + 1) * CELL : X0 + j * CELL) - oz) / dz : Infinity;
    let tc = t0;
    for (let guard = 0; guard < 4 * N + 8; guard++) {
      const te = Math.min(tnx, tnz, t1);
      // quick vertical reject: ray y range over this cell vs the cell's height range
      const ya = oy + dy * tc, yb = oy + dy * te;
      const k = j * N1 + i;
      const a = H[k], b = H[k + 1], c = H[k + N1], d = H[k + N1 + 1];
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      if (!((ya < lo && yb < lo) || (ya > hi && yb > hi))) {
        const hit = this._cellHit(i, j, ox, oy, oz, dx, dy, dz, tc - 1e-7, te + 1e-7, out);
        if (hit) return hit;
      }
      if (te >= t1 - eps) return null;
      if (tnx < tnz) { i += sx; tc = tnx; tnx += tdx; } else { j += sz; tc = tnz; tnz += tdz; }
      if (i < 0 || i >= N || j < 0 || j >= N) return null;
    }
    return null;
  }
  /* Moller-Trumbore against the two triangles of cell (i,j); nearest hit with tLo <= t <= tHi. */
  _cellHit(i, j, ox, oy, oz, dx, dy, dz, tLo, tHi, out) {
    const N1 = this.N1, H = this.H, X0 = this.X0, CELL = this.CELL, k = j * N1 + i;
    const x0 = X0 + i * CELL, z0 = X0 + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + N1], h11 = H[k + N1 + 1];
    const split0 = this.D[j * this.N + i] === 0;
    let bestT = Infinity, bestTri = -1, nx = 0, ny = 1, nz = 0;
    for (let tri = 0; tri < 2; tri++) {
      let ax, ay, az, bx, by, bz, cx, cy, cz;
      if (split0) {
        if (tri === 0) { ax = x0; ay = h00; az = z0; bx = x1; by = h10; bz = z0; cx = x1; cy = h11; cz = z1; }
        else { ax = x0; ay = h00; az = z0; bx = x0; by = h01; bz = z1; cx = x1; cy = h11; cz = z1; }
      } else if (tri === 0) { ax = x0; ay = h00; az = z0; bx = x1; by = h10; bz = z0; cx = x0; cy = h01; cz = z1; }
      else { ax = x1; ay = h10; az = z0; bx = x1; by = h11; bz = z1; cx = x0; cy = h01; cz = z1; }
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const id = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az;
      const uu = (tx * px + ty * py + tz * pz) * id;
      if (uu < -1e-9 || uu > 1 + 1e-9) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (dx * qx + dy * qy + dz * qz) * id;
      if (vv < -1e-9 || uu + vv > 1 + 1e-9) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * id;
      if (t < tLo || t > tHi || t < 0) continue;
      if (t < bestT) {
        bestT = t; bestTri = tri;
        let cxn = e1y * e2z - e1z * e2y, cyn = e1z * e2x - e1x * e2z, czn = e1x * e2y - e1y * e2x;
        if (cyn < 0) { cxn = -cxn; cyn = -cyn; czn = -czn; }
        const l = 1 / Math.sqrt(cxn * cxn + cyn * cyn + czn * czn);
        nx = cxn * l; ny = cyn * l; nz = czn * l;
      }
    }
    if (bestTri < 0) return null;
    out.t = bestT; out.x = ox + dx * bestT; out.y = oy + dy * bestT; out.z = oz + dz * bestT;
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.i = i; out.j = j; out.tri = bestTri;
    return out;
  }

  /* ----- lakes and river ----- */
  _makeLakes() {
    const { site, Sim } = this, L = site.layout;
    this.lakes = [];
    if (!L) return;
    const sf = Sim.terrainH.shoreF;
    const defs = [];
    if (site.kind === 'classic') {
      const rU = L.dam.r - 2;
      defs.push({ name: 'up', cx: L.up.x, cz: L.up.z, seedR: 40, mask: (x, z) => { const dx = x - L.up.x, dz = z - L.up.z, r = rU * sf(site, 0, x, z); return dx * dx + dz * dz < r * r; } });
    } else {
      const cp = site.cp, d = L.dam, tx = -d.dz, tz = d.dx;
      const hm = Math.max(site.maxDam || 45, 10), len = hm / cp.S0 + 60;
      defs.push({
        name: 'up', cx: d.x - tx * 14, cz: d.z - tz * 14, seedR: 28,
        mask: (x, z) => { const a = (x - d.x) * tx + (z - d.z) * tz; if (a > -2 || a < -len) return false; return Math.abs(x - Sim.cX(cp, z)) < Sim.cW(cp, z) / 2 + cp.m * hm * 1.3 + 40; },
      });
    }
    const rL = Sim.bowlR(site.lower, site.lower.hMax);
    defs.push({ name: 'lo', cx: L.lo.x, cz: L.lo.z, seedR: 40, mask: (x, z) => { const dx = x - L.lo.x, dz = z - L.lo.z, r = rL * sf(site, 1, x, z) + 14; return dx * dx + dz * dz < r * r; } });
    const { N, N1, X0, CELL, H } = this;
    for (const def of defs) {
      const allowed = new Uint8Array(N1 * N1);
      let i0 = N, i1 = 0, j0 = N, j1 = 0;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        if (def.mask(X0 + i * CELL, X0 + j * CELL)) {
          allowed[j * N1 + i] = 1;
          if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
        }
      }
      // seed: lowest allowed vertex near the lake centre
      let seed = -1, sh = Infinity;
      const r2 = def.seedR * def.seedR;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * N1 + i;
        if (!allowed[k]) continue;
        const dx = X0 + i * CELL - def.cx, dz = X0 + j * CELL - def.cz;
        if (dx * dx + dz * dz <= r2 && H[k] < sh) { sh = H[k]; seed = k; }
      }
      this.lakes.push({
        name: def.name, allowed, seed, i0, i1, j0, j1,
        wet: new Uint8Array(N1 * N1), queue: new Int32Array(Math.max(1, (i1 - i0 + 1) * (j1 - j0 + 1))),
        level: NaN, count: 0, stamp: 0,
      });
    }
  }
  _makeRiver() {
    const { site, Sim } = this;
    this.river = null;
    if (site.kind !== 'proc' || !site.cp) return;
    const cp = site.cp, vex = this.VEX;
    this.river = {
      cp,
      // centre x and half width at z; the stage is derived from y() (see riverDepth)
      cx: z => Sim.cX(cp, z), half: z => Sim.riverW(cp, z) * 0.5, level: z => (Sim.cBed(cp, z) - 0.55) * vex,
    };
  }
  lake(k) { return typeof k === 'string' ? this.lakes.find(l => l.name === k) : this.lakes[k]; }

  /* Live levels in DISPLAY metres: {up, lo} (or an array [up, lo]); NaN/undefined/-Infinity = no water in that lake. */
  setWater(levels) {
    for (let k = 0; k < this.lakes.length; k++) {
      const lk = this.lakes[k];
      let lv = Array.isArray(levels) ? levels[k] : levels && levels[lk.name];
      if (!(lv > -1e8)) lv = NaN;
      const same = (lv !== lv && lk.level !== lk.level) || Math.abs(lv - lk.level) < 1e-3;
      if (same) continue;
      lk.level = lv;
      this._flood(lk);
      lk.stamp++;
      this.waterVersion++;
    }
  }
  _flood(lk) {
    const { N1, H, D, N } = this;
    lk.wet.fill(0);
    lk.count = 0;
    const lv = lk.level;
    if (lv !== lv || lk.seed < 0 || !(H[lk.seed] < lv)) return;
    const q = lk.queue, wet = lk.wet, allowed = lk.allowed;
    let qh = 0, qt = 0;
    wet[lk.seed] = 1; q[qt++] = lk.seed;
    const visit = (n) => { if (!wet[n] && allowed[n] && H[n] < lv) { wet[n] = 1; q[qt++] = n; } };
    while (qh < qt) {
      const k = q[qh++];
      const i = k % N1, j = (k - i) / N1;
      if (i > 0) visit(k - 1);
      if (i < N) visit(k + 1);
      if (j > 0) visit(k - N1);
      if (j < N) visit(k + N1);
      // drawn diagonals: cell (ci,cj) with D=0 connects 00-11, D=1 connects 10-01
      if (i < N && j < N) { if (D[j * N + i] === 0) visit(k + N1 + 1); }                 // cell (i,j): 00 -> 11
      if (i > 0 && j > 0) { if (D[(j - 1) * N + (i - 1)] === 0) visit(k - N1 - 1); }     // cell (i-1,j-1): 11 -> 00
      if (i < N && j > 0) { if (D[(j - 1) * N + i] === 1) visit(k - N1 + 1); }           // cell (i,j-1): 01 -> 10
      if (i > 0 && j < N) { if (D[j * N + (i - 1)] === 1) visit(k + N1 - 1); }           // cell (i-1,j): 10 -> 01
    }
    lk.count = qt;
  }

  /* River stage at (x,z): display m of water over the drawn floor, 0 outside the channel. */
  riverDepth(x, z) {
    const r = this.river;
    if (!r) return 0;
    const half = r.half(z), t = Math.abs(x - r.cx(z)) / half;
    if (t >= 0.95) return 0;
    const yy = this.y(x, z), over = r.level(z) - yy;
    return (over > 0 ? over : 0) + RIVER_LIFT * 0.4 + RIVER_STAGE * (1 - t * t);
  }
  /* Water depth (display m, >0 wet): max over lakes and the river of live level - y. Uses y(), never floorY(). */
  depth(x, z) {
    this._locate(x, z);
    const y = this._evalLocated();
    let best = 0;
    const a = this._a, b = this._b, c = this._c;
    for (let k = 0; k < this.lakes.length; k++) {
      const lk = this.lakes[k];
      if (lk.count === 0) continue;
      if (lk.wet[a] | lk.wet[b] | lk.wet[c]) { const d = lk.level - y; if (d > best) best = d; }
    }
    if (this.river) { const d = this.riverDepth(x, z); if (d > best) best = d; }
    return best;
  }
  /* Water surface height (display m) at (x,z), or NaN when dry. */
  waterSurface(x, z) {
    const d = this.depth(x, z);
    if (!(d > 0)) return NaN;
    return this.y(x, z) + d;   // lake: equals the live level exactly; river: floor + stage
  }
  /* Display y of the river strip centreline vertices: floor + lift (the strip then follows the drawn triangles). */
  get riverLift() { return RIVER_LIFT; }
}

export function createSurface(site, Sim, opts) { return new Surface(site, Sim, opts); }
