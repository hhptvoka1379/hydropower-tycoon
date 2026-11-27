/* Test double for the Surface API of decisions/fable.md D2 (the real one is game/world/surface.js).
   Heights = Sim.terrainH x VEX on an 8 m grid with triangle-exact interpolation (same diagonal rule as D1). Water is derived once from the
   site and state: lake discs (live level = bottom + resLevel) and, on canyon sites, a river strip. Not part of the shipped game; no THREE, no DOM. */
export const VEX = 1.5;
const HALF = 800, CELL = 8, N = 200;

export function createFakeSurface(Sim, state, siteIndex = 0) {
  const site = state.sites[siteIndex];
  const NV = N + 1;
  const G = new Float32Array(NV * NV);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) G[j * NV + i] = Sim.terrainH(site, -HALF + i * CELL, -HALF + j * CELL) * VEX;
  const providers = [];
  const L = site.layout;

  /* water: list of lakes {x,z,r,level} (display metres) and an optional river */
  const lakes = [];
  const lvU = site.upper.bottom + Sim.resLevel(site.upper, site.upper.V), lvL = site.lower.bottom + Sim.resLevel(site.lower, site.lower.V);
  if (site.kind === 'classic') {
    lakes.push({x: L.up.x, z: L.up.z, r: Sim.bowlR(site.upper, Sim.resLevel(site.upper, site.upper.V)) * 1.35 + 12, level: lvU * VEX});
  }
  lakes.push({x: L.lo.x, z: L.lo.z, r: Sim.bowlR(site.lower, Sim.resLevel(site.lower, site.lower.V)) * 1.35 + 12, level: lvL * VEX});
  const cp = site.cp;
  const canyonUpper = site.kind === 'proc' && site.dam.built && site.upper.V > 0;

  function clampI(v, a, b) { return v < a ? a : v > b ? b : v; }
  /* The second diagonal (b-c) is rarely used; evaluate it exactly with barycentric weights for clarity. */
  function yTri(x, z) {
    const fx = clampI((x + HALF) / CELL, 0, N - 1e-6), fz = clampI((z + HALF) / CELL, 0, N - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * NV + i;
    const a = G[k], b = G[k + 1], c = G[k + NV], d = G[k + NV + 1];
    if (Math.abs(a - d) <= Math.abs(b - c)) return tz <= tx ? a + (b - a) * tx + (d - b) * tz : a + (d - c) * tx + (c - a) * tz; // split 00-11
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz); // split 10-01
  }
  const S = {
    version: 1, half: HALF, cell: CELL, vex: VEX,
    y: yTri,
    yReal: (x, z) => yTri(x, z) / VEX,
    toDisplayY: (simY) => simY * VEX,
    normal(x, z, out) {
      const e = 1, gx = (yTri(x + e, z) - yTri(x - e, z)) / (2 * e), gz = (yTri(x, z + e) - yTri(x, z - e)) / (2 * e), l = Math.sqrt(gx * gx + 1 + gz * gz);
      out = out || {x: 0, y: 0, z: 0}; out.x = -gx / l; out.y = 1 / l; out.z = -gz / l; return out;
    },
    slopeDeg(x, z) {
      const e = 1, gx = (yTri(x + e, z) - yTri(x - e, z)) / (2 * e), gz = (yTri(x, z + e) - yTri(x, z - e)) / (2 * e);
      return Math.atan(Math.sqrt(gx * gx + gz * gz)) * 180 / Math.PI;
    },
    raycast(o, d, tMax) {
      const step = 1; let prev = 0;
      for (let t = 0; t <= tMax; t += step) {
        const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
        if (py <= S.floorY(px, pz)) { let lo = prev, hi = t; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= S.floorY(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; } return {t: hi, x: o.x + d.x * hi, y: o.y + d.y * hi, z: o.z + d.z * hi}; }
        prev = t;
      }
      return null;
    },
    addFloorProvider(fn) { providers.push(fn); S.version++; },
    floorY(x, z) { let h = yTri(x, z); for (let i = 0; i < providers.length; i++) { const v = providers[i](x, z); if (v === v && v > h) h = v; } return h; },
    waterSurface(x, z) {
      for (const lk of lakes) { const dx = x - lk.x, dz = z - lk.z; if (dx * dx + dz * dz < lk.r * lk.r && yTri(x, z) < lk.level) return lk.level; }
      if (cp) {
        const xc = Sim.cX(cp, z), rw = Sim.riverW(cp, z), bed = Sim.cBed(cp, z) * VEX;
        if (Math.abs(x - xc) < rw / 2 + 4 && yTri(x, z) < bed) return bed;
        if (canyonUpper && z < site.station && z > site.station - 700 && Math.abs(x - xc) < 260) {
          const lv = (site.upper.bottom + Sim.resLevel(site.upper, site.upper.V)) * VEX; if (yTri(x, z) < lv) return lv;
        }
      }
      return NaN;
    },
    depth(x, z) { const w = S.waterSurface(x, z); return w === w ? Math.max(0, w - yTri(x, z)) : 0; },
    setWater() { S.version++; }
  };
  return S;
}
