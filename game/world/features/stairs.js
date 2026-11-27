/* Stair flights and bridge decks as stepped meshes (THREE-free). Tread i covers [i*tread, min((i+1)*tread, len)) along the flight and its top is
   exactly flight.tops[i] -- the value Flight.floor(x,z) of game/player/stations.js returns -- so what you see is what you stand on. */
import { GB } from './geom.js';
import { PAL, mix, mul } from './palette.js';
import { polyPoint } from './pathsnorm.js';

/* [{s0, s1, top}] for the flight */
export function treadsOf(f) {
  const out = [];
  for (let i = 0; i < f.tops.length; i++) { const s0 = i * f.tread; if (s0 >= f.len) break; out.push({ s0, s1: Math.min((i + 1) * f.tread, f.len), top: f.tops[i] }); }
  return out;
}
/* Top of the drawn flight at (x,z) or NaN (same lookup as the mesh uses; used by the tests against Flight.floor) */
export function drawnTop(f, x, z) {
  const T = treadsOf(f); let best = 1e18, bs = 0, out = false;
  for (let i = 0; i < f.pts.length - 1; i++) {
    const a = f.pts[i], b = f.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez, tr = l2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / l2 : 0, t = tr < 0 ? 0 : tr > 1 ? 1 : tr;
    const dd = (x - (a.x + ex * t)) ** 2 + (z - (a.z + ez * t)) ** 2;
    if (dd < best) { best = dd; bs = f.cum[i] + t * Math.sqrt(l2); out = (i === 0 && tr < 0) || (i === f.pts.length - 2 && tr > 1); }
  }
  if (out || Math.sqrt(best) > f.hw) return NaN;
  return T[Math.min(T.length - 1, Math.floor(bs / f.tread))].top;
}

/* adds the flight to `solid` (treads, piers) and `rails` (posts and handrails) */
export function addFlight(solid, rails, f, surface) {
  const T = treadsOf(f), bridge = f.kind === 'bridge', stone = mix(PAL.paper, PAL.ink, 0.2), wood = PAL.wood;
  const p0 = {}, p1 = {}, pm = {};
  const rise = f.tops[f.tops.length - 1] - f.tops[0];
  let maxGap = 0, nRail = 0;
  const railPts = [[], []];
  T.forEach((t, i) => {
    polyPoint(f.pts, f.cum, t.s0, p0); polyPoint(f.pts, f.cum, t.s1, p1); polyPoint(f.pts, f.cum, (t.s0 + t.s1) / 2, pm);
    const nx = -pm.dz * f.hw, nz = pm.dx * f.hw;
    const L0 = [p0.x + nx, p0.z + nz], R0 = [p0.x - nx, p0.z - nz], L1 = [p1.x + nx, p1.z + nz], R1 = [p1.x - nx, p1.z - nz];
    let g = 1e9;
    for (const [x, z] of [L0, R0, L1, R1, [pm.x, pm.z]]) { const y = surface.y(x, z); if (y < g) g = y; }
    const bottom = bridge ? t.top - 0.28 : Math.max(g - 0.2, t.top - 1.0);
    if (t.top - g > maxGap) maxGap = t.top - g;
    const col = bridge ? mul(wood, 0.92 + 0.12 * ((i * 7) % 5) / 5) : mul(stone, 0.94 + 0.1 * ((i * 3) % 4) / 4);
    const ctr = [pm.x, (bottom + t.top) / 2, pm.z], y = t.top;
    solid.quadOut([L0[0], y, L0[1]], [R0[0], y, R0[1]], [R1[0], y, R1[1]], [L1[0], y, L1[1]], col, ctr);                       // tread top
    solid.quadOut([L0[0], bottom, L0[1]], [R0[0], bottom, R0[1]], [R0[0], y, R0[1]], [L0[0], y, L0[1]], mul(col, 0.78), ctr);   // riser (low side)
    solid.quadOut([L1[0], bottom, L1[1]], [R1[0], bottom, R1[1]], [R1[0], y, R1[1]], [L1[0], y, L1[1]], mul(col, 0.7), ctr);    // back
    solid.quadOut([L0[0], bottom, L0[1]], [L1[0], bottom, L1[1]], [L1[0], y, L1[1]], [L0[0], y, L0[1]], mul(col, 0.74), ctr);   // left
    solid.quadOut([R0[0], bottom, R0[1]], [R1[0], bottom, R1[1]], [R1[0], y, R1[1]], [R0[0], y, R0[1]], mul(col, 0.74), ctr);   // right
    // piers where the flight stands off the ground
    if (t.top - bottom - 0 > 0 && (bottom - g) > 0.5 && i % 11 === 5) for (const [x, z] of [L0, R0]) { const gy = surface.y(x, z); solid.box(x, (gy - 0.3 + bottom) / 2, z, 0.34, bottom - gy + 0.3, 0.34, mul(wood, 0.8)); }
    // rail posts every 8 treads
    if (i % 8 === 0 || i === T.length - 1) {
      railPts[0].push([L0[0] * 0.92 + pm.x * 0.08, y, L0[1] * 0.92 + pm.z * 0.08]); railPts[1].push([R0[0] * 0.92 + pm.x * 0.08, y, R0[1] * 0.92 + pm.z * 0.08]);
    }
  });
  if (bridge || rise > 1.2 || maxGap > 0.9) {
    for (const side of railPts) {
      for (let k = 0; k < side.length; k++) {
        const a = side[k];
        rails.cyl([a[0], a[1], a[2]], [a[0], a[1] + 1.0, a[2]], 0.05, 0.05, 4, PAL.ink, false);
        if (k + 1 < side.length) { const b = side[k + 1]; rails.cyl([a[0], a[1] + 0.95, a[2]], [b[0], b[1] + 0.95, b[2]], 0.035, 0.035, 4, PAL.ink, false); nRail++; }
      }
    }
  }
  return { treads: T.length, rails: nRail, maxGap };
}
