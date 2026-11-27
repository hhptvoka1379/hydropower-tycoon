/* Ground-hugging ribbons and drapes (THREE-free). Every vertex height comes from surface.y(x,z) + lift: the only height source (D1). */
import { hash2 } from './hash.js';

/* Points along a straight line a -> b spaced at most `maxStep` apart (both ends included). out: array of [x, z]. */
export function sampleXZ(ax, az, bx, bz, maxStep) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / maxStep - 1e-9)), out = [];
  for (let i = 0; i <= n; i++) out.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
  return out;
}
/* The same, lifted onto the surface: [x, surface.y + lift, z]. */
export function sampleLine(surface, ax, az, bx, bz, maxStep, lift = 0) {
  return sampleXZ(ax, az, bx, bz, maxStep).map(([x, z]) => [x, surface.y(x, z) + lift, z]);
}

/* A strip of `width` metres along the polyline pts [{x,z}] with three vertex columns (edge, centre, edge) so cross slopes are followed.
   cols = {mid:[r,g,b], edge:[r,g,b]}; jitter: per-row colour noise (trodden look). dash = [on, off] in rows, skips the off rows (unowned land).
   Returns the number of triangles added. */
export function ribbonStrip(gb, surface, pts, width, lift, cols, opts = {}) {
  const n = pts.length; if (n < 2) return 0;
  const hw = width / 2, jit = opts.jitter || 0, seed = opts.seed || 0, dash = opts.dash || null;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx, x = pts[i].x, z = pts[i].z;
    const xl = x + nx * hw, zl = z + nz * hw, xr = x - nx * hw, zr = z - nz * hw;
    rows.push([[xl, surface.y(xl, zl) + lift, zl], [x, surface.y(x, z) + lift + 0.015, z], [xr, surface.y(xr, zr) + lift, zr]]);
  }
  const before = gb.triCount;
  for (let i = 0; i < n - 1; i++) {
    if (dash && (i % (dash[0] + dash[1])) >= dash[0]) continue;
    const k0 = 1 + (jit ? (hash2(i + seed, 7) - 0.5) * 2 * jit : 0), k1 = 1 + (jit ? (hash2(i + 1 + seed, 7) - 0.5) * 2 * jit : 0);
    const e = opts.two ? cols.mid : cols.edge, m = cols.mid;
    const c = (col, k) => [col[0] * k, col[1] * k, col[2] * k];
    const A = rows[i], B = rows[i + 1];
    if (opts.two) { gb.triUp(A[0], B[0], B[2], c(e, k0), c(e, k1), c(e, k1)); gb.triUp(A[0], B[2], A[2], c(e, k0), c(e, k1), c(e, k0)); continue; }
    // left half then right half; each quad = two triangles (faceted, normals face up)
    gb.triUp(A[0], B[0], B[1], c(e, k0), c(e, k1), c(m, k1)); gb.triUp(A[0], B[1], A[1], c(e, k0), c(m, k1), c(m, k0));
    gb.triUp(A[1], B[1], B[2], c(m, k0), c(m, k1), c(e, k1)); gb.triUp(A[1], B[2], A[2], c(m, k0), c(e, k1), c(e, k0));
  }
  return gb.triCount - before;
}

/* A draped square-ish patch (gravel pad): grid of `step` m cells over [x0,x1] x [z0,z1], each vertex on the surface + lift. */
export function drapePatch(gb, surface, x0, z0, x1, z1, step, lift, col, opts = {}) {
  const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step)), seed = opts.seed || 0, jit = opts.jitter || 0;
  const V = (i, j) => { const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz; return [x, surface.y(x, z) + lift, z]; };
  const before = gb.triCount;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = V(i, j), b = V(i + 1, j), c = V(i, j + 1), d = V(i + 1, j + 1);
    const k = 1 + (jit ? (hash2(i + seed, j) - 0.5) * 2 * jit : 0), cc = [col[0] * k, col[1] * k, col[2] * k];
    // split along the shorter-height diagonal, like the terrain does
    if (Math.abs(a[1] - d[1]) <= Math.abs(b[1] - c[1])) { gb.triUp(a, b, d, cc, cc, cc); gb.triUp(a, d, c, cc, cc, cc); }
    else { gb.triUp(a, b, c, cc, cc, cc); gb.triUp(b, d, c, cc, cc, cc); }
  }
  return gb.triCount - before;
}
