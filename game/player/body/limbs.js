/* Limb parts, right side only (the left is the mirror image): thigh, shin + foot, arm + hand. Every joint end is a sphere-ish dome centred on the pivot, so
   rotating a part about its pivot never opens a crack (the neighbour's dome coincides with it). */
import { Mesh, loft, fan, ring, add, sub, mul, cross, nrm, lerp } from './geom.js';

const frame = (ax) => { const a = nrm(ax); let u = cross(a, Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]); u = nrm(u); return [u, cross(a, u)]; };
/* dome rings (from the apex outward) for a sphere radius R centred at c on axis dir; sign +1 builds below c, -1 above */
const domeRows = (R) => [[0.87, 0.5], [0.5, 0.87]].map(([h, r]) => [h * R, r * R]);

export function buildThigh(X) {
  const { thR, legL, hx, lr } = X, H = [hx, 0, X.hipZ], K = X.K, N = 12;
  const U = [1, 0, 0], V = [0, 0, 1], Rh = 0.097 * thR, Rk = 0.049 * lr;
  const at = (t) => [lerp(H[0], K[0], t), lerp(H[1], K[1], t), lerp(H[2], K[2], t)];
  const rows = [];   // [centre, rx, rf, rb]
  for (const [h, r] of domeRows(Rh)) rows.push([add(H, [0, h, 0]), r, r, r]);
  const T = [[0, 0.098, 0.096, 0.098], [0.14, 0.098, 0.1, 0.103], [0.3, 0.09, 0.097, 0.097], [0.5, 0.076, 0.085, 0.082], [0.7, 0.062, 0.07, 0.066], [0.88, 0.052, 0.057, 0.054]];
  for (const [t, a, f, b] of T) rows.push([at(t), a * thR, f * thR, b * thR]);
  rows.push([K, 0.047 * lr, 0.052 * lr, 0.047 * lr]);
  for (const [h, r] of domeRows(Rk).reverse()) rows.push([add(K, [0, -h, 0]), r, r, r]);
  const rings = rows.map(([c, rx, rf, rb]) => ring(c, U, V, rx, rf, rb, N));
  const m = new Mesh();
  loft(m, rings, { ref: (i) => rows[i][0], col: (i, k, P) => X.skinAt(P), vm: (i, k, P, n) => X.shade(P, n) });
  fan(m, rings[0], add(H, [0, Rh, 0]), H, (P) => X.skinAt(P), null);
  const last = rings.length - 1;
  fan(m, rings[last], add(K, [0, -Rk, 0]), K, (P) => X.skinAt(P), (P) => X.shade(P, [0, -1, 0]));
  return m;
}

export function buildShin(X) {
  const { legL, lr, fsz, K, A, sd } = X, N = 12, U = [1, 0, 0], V = [0, 0, 1], Rk = 0.049 * lr, L = 0.39 * legL;
  const at = (u) => add(K, mul(sd, L * u));
  const rows = [];
  for (const [h, r] of domeRows(Rk)) rows.push([add(K, [0, h, 0]), r, r, r]);
  const T = [[0, 0.047, 0.05, 0.047], [0.1, 0.046, 0.048, 0.05], [0.24, 0.045, 0.046, 0.056], [0.38, 0.047, 0.045, 0.063], [0.55, 0.042, 0.04, 0.052], [0.75, 0.032, 0.032, 0.036], [0.9, 0.027, 0.027, 0.029], [1.0, 0.026, 0.024, 0.027]];
  for (const [u, a, f, b] of T) rows.push([at(u), a * lr, f * lr, b * lr]);
  const rings = rows.map(([c, rx, rf, rb]) => ring(c, U, V, rx, rf, rb, N));
  const m = new Mesh();
  loft(m, rings, { ref: (i) => rows[i][0], col: (i, k, P) => X.skinAt(P), vm: (i, k, P, n) => X.shade(P, n) });
  fan(m, rings[0], add(K, [0, Rk, 0]), K, (P) => X.skinAt(P), null);
  fan(m, rings[rings.length - 1], add(A, mul(sd, 0.01)), A, (P) => X.skinAt(P), null);
  /* foot: flat-soled loft along +z with an 8-point cross-section; the sole is 0.075 fsz under the ankle, as before */
  const sole = A[1] - 0.075 * fsz, sf = fsz;
  const FS = [[-0.062, 0.02, 0.045], [-0.05, 0.031, 0.075], [-0.02, 0.033, 0.088], [0.025, 0.036, 0.062], [0.07, 0.043, 0.04], [0.11, 0.042, 0.028], [0.145, 0.034, 0.017]];
  const out = 0.05;
  const frs = FS.map(([z, w, h]) => {
    const zz = z * sf, ww = w * sf, hh = h * sf, cx = A[0] + out * zz, cz = A[2] + zz;
    return [[-0.8, 0], [0.8, 0], [1, 0.35], [0.8, 0.8], [0.35, 1], [-0.35, 1], [-0.8, 0.8], [-1, 0.35]].map(([px, py]) => [cx + px * ww, sole + py * hh, cz]);
  });
  const fcen = (i) => [A[0] + out * FS[i][0] * sf, sole + FS[i][2] * sf * 0.4, A[2] + FS[i][0] * sf];
  loft(m, frs, {
    ref: fcen, col: (i, k, P) => X.skinAt(P, i >= 5 ? [1.03, 1.0, 0.98] : null),
    vm: (i, k, P, n) => X.shade(P, n) * (i === 5 && k > 1 && k < 6 ? 0.93 : 1)
  });
  fan(m, frs[0], [frs[0][0][0], sole + 0.02 * sf, A[2] - 0.068 * sf], fcen(0), (P) => X.skinAt(P), (P) => X.shade(P, [0, -0.5, -1]));
  fan(m, frs[frs.length - 1], [A[0] + out * 0.152 * sf, sole + 0.008 * sf, A[2] + 0.152 * sf], fcen(6), (P) => X.skinAt(P), null);
  return m;
}

export function buildArm(X) {
  const { ar, armL, fsz, S, E, ua, fa, lr } = X, N = 10, U = [0, 1, 0], V = [0, 0, 1], Ra = 0.054 * ar;
  const at = (d) => (d <= 0.28 * armL ? add(S, mul(ua, d)) : add(E, mul(fa, d - 0.28 * armL)));
  const rows = [];
  for (const [h, r] of domeRows(Ra)) rows.push([add(S, mul(ua, -h)), r, r, r]);
  const T = [[0, 0.054, 0.054, 0.052], [0.05, 0.056, 0.057, 0.054], [0.1, 0.054, 0.056, 0.052], [0.17, 0.05, 0.052, 0.048], [0.24, 0.043, 0.045, 0.043], [0.28, 0.037, 0.036, 0.04],
    [0.34, 0.037, 0.038, 0.037], [0.41, 0.031, 0.031, 0.03], [0.48, 0.025, 0.025, 0.024], [0.53, 0.021, 0.021, 0.021]];
  for (const [d, a, f, b] of T) { const s = d === 0 ? 1 : 1; rows.push([at(d * armL), a * ar * s, f * ar, b * ar]); }
  const rings = rows.map(([c, ry, rf, rb]) => ring(c, U, V, ry, rf, rb, N));
  const m = new Mesh();
  loft(m, rings, { ref: (i) => rows[i][0], col: (i, k, P) => X.skinAt(P), vm: (i, k, P, n) => X.shade(P, n) });
  fan(m, rings[0], add(S, mul(ua, -Ra)), S, (P) => X.skinAt(P), null);
  /* hand: a flat mitten (6-sided loft along the forearm) plus a thumb on the front edge */
  const Hs = sub(X.Wr, mul(fa, 0.02)), Lh = armL, hand = [[0, 0.016, 0.026], [0.05, 0.017, 0.027], [0.085, 0.016, 0.027], [0.11, 0.013, 0.024], [0.13, 0.01, 0.017]];
  const hr = hand.map(([d, th, w]) => ring(add(Hs, mul(fa, d * Lh)), U, V, th * fsz, w * fsz, w * fsz, 6));
  const hc = (i) => add(Hs, mul(fa, hand[i][0] * Lh));
  loft(m, hr, { ref: hc, col: (i, k, P) => X.skinAt(P, i >= 1 ? [1.03, 0.97, 0.95] : null), vm: (i, k, P, n) => X.shade(P, n) * (i === 2 && k === 0 ? 0.92 : 1) });
  fan(m, hr[hr.length - 1], add(Hs, mul(fa, 0.14 * Lh)), hc(4), (P) => X.skinAt(P), null);
  const tdir = nrm([1, 0, 0.45]), [tu, tv] = frame(tdir), tb = add(Hs, [0.03 * Lh, 0, 0.02 * fsz]);
  const tr = [[0, 0.0105], [0.028, 0.0095], [0.052, 0.0075]].map(([d, r]) => { const c = add(tb, mul(tdir, d * fsz)), q = []; for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; q.push(add(c, add(mul(tu, Math.cos(a) * r * fsz), mul(tv, Math.sin(a) * r * fsz)))); } return q; });
  loft(m, tr, { ref: (i) => add(tb, mul(tdir, [0, 0.028, 0.052][i] * fsz)), col: (i, k, P) => X.skinAt(P, [1.03, 0.97, 0.95]), vm: (i, k, P, n) => X.shade(P, n) });
  fan(m, tr[2], add(tb, mul(tdir, 0.066 * fsz)), add(tb, mul(tdir, 0.04 * fsz)), (P) => X.skinAt(P), null);
  return m;
}
