/* Head part: a 16-column skull loft (rings dense at brow, eyes, cheek, jaw), hair or swim cap painted on ring-aligned regions and puffed a few mm,
   decals for eyes/brows/lips on the actual facets, a small nose, ears, an optional ponytail/bun, and a neck stub for the yaw pivot. */
import { Mesh, loft, fan, ring, add, sub, mul, cross, nrm, lerp } from './geom.js';

export function buildHead(X) {
  const { hsz, pivY, col, Bd } = X, NH = 16, cap = !!(Bd.cap || Bd.hair === 'cap'), hairStyle = Bd.hair === 'cap' ? 'none' : Bd.hair;
  const HC = [0, 0.125, 0.012], piv = [0, pivY, 0];
  const ph = (p) => add(piv, mul(add(HC, p), hsz));                 // head-local -> pelvis frame (unit space)
  // [y, rx, rzFront, rzBack, zOffset]
  const HR = [[0.122, 0.034, 0.04, 0.046, -0.008], [0.1, 0.06, 0.071, 0.08, -0.006], [0.072, 0.074, 0.083, 0.09, -0.002], [0.04, 0.078, 0.088, 0.092, 0], [0.008, 0.077, 0.086, 0.09, 0.002],
    [-0.026, 0.071, 0.084, 0.082, 0.004], [-0.06, 0.063, 0.076, 0.07, 0.008], [-0.092, 0.048, 0.064, 0.052, 0.014], [-0.116, 0.032, 0.05, 0.038, 0.02]];
  const base = HR.map(([y, rx, rf, rb, zo]) => ring([0, y, zo], [1, 0, 0], [0, 0, 1], rx, rf, rb, NH));
  const kk = (k) => Math.min(k, NH - k);   // 0 front .. 8 back
  const jc = Bd.suit === 'field' ? [2, 2, 2, 3, 3, 4, 4, 4, 4] : [2, 2, 3, 3, 3, 4, 5, 6, 6], jh = [2, 2, 3, 4, 4, 5, 6, 7, 7];   // last ring (index) covered by cap / by hair, per column distance from the front
  const puff = (j, k) => (cap && j <= jc[kk(k)] ? (Bd.suit === 'field' ? 1.09 : 1.05) : (cap || hairStyle !== 'none') && j <= jh[kk(k)] ? 1.035 : 1);
  const rings = base.map((r, j) => r.map((p, k) => { const s = puff(j, k), zo = HR[j][4]; return [p[0] * s, p[1], zo + (p[2] - zo) * s]; }));
  const m = new Mesh();
  const hairC = col.hair, capC = col.cap;
  const regionCol = (j, k) => {     // quad between rings j,j+1 and columns k,k+1
    const k1 = (k + 1) % NH, lo = j + 1;
    if (cap && lo <= Math.min(jc[kk(k)], jc[kk(k1)])) {
      if (Bd.suit === 'field' && lo === Math.min(jc[kk(k)], jc[kk(k1)])) return col.trim; // helmet band
      return capC;
    }
    if (lo <= Math.min(jh[kk(k)], jh[kk(k1)])) return hairC;
    return null;
  };
  const faceTint = (P) => { const L = sub(P, [0, 0, 0]); return X.skinAt(ph(P), null); void L; };
  const vm = (j, k, P, N) => {
    const A = ph(P), n = [N[0], N[1], N[2]];
    let s = X.shade(A, n);
    if (j >= 6 && kk(k) <= 3) s *= 0.93;                      // under the jaw
    if (cap && j === jc[kk(k)] + 1 && j < 7) s *= 0.9;        // cap rim shadow on the skin just below the edge
    return s;
  };
  const pos = rings.map((r) => r.map((p) => ph(p)));
  const Hc = (j) => ph([0, HR[j][0], 0.0]);
  loft(m, pos, {
    ref: Hc,
    col: (j, k, Pc) => { const c = regionCol(j, k), P = sub(Pc, piv); void P; return c || X.skinAt(Pc, k === 0 ? null : null); },
    vm: (j, k, Pa, N) => vm(j, k, sub(mul(sub(Pa, piv), 1 / hsz), HC), N)
  });
  fan(m, pos[0], ph([0, 0.142, -0.01]), Hc(0), () => (cap ? capC : hairC), (P) => X.shade(P, [0, 1, 0]));
  fan(m, pos[pos.length - 1], ph([0, -0.124, 0.028]), Hc(8), (P) => X.skinAt(P), (P) => X.shade(P, [0, -1, 0]) * 0.85);
  // safety helmet / field cap brim in front when wearing a field helmet
  if (cap && Bd.suit === 'field') {
    const refB = ph([0, 0.06, 0.04]);
    const bL = ph([-0.062, 0.068, 0.068]), bR = ph([0.062, 0.068, 0.068]);
    const fL = ph([-0.046, 0.058, 0.128]), fR = ph([0.046, 0.058, 0.128]);
    const shB = (f) => [capC[0] * f, capC[1] * f, capC[2] * f];
    m.tri(bL, bR, fR, shB(0.96), shB(0.96), shB(0.92), refB);
    m.tri(bL, fR, fL, shB(0.96), shB(0.92), shB(0.92), refB);
    m.tri(bL, fR, bR, shB(0.75), shB(0.72), shB(0.75), refB);
    m.tri(bL, fL, fR, shB(0.75), shB(0.72), shB(0.72), refB);
  }

  /* ---- facial features, placed on the unpuffed skull surface (head-local coords) ---- */
  const surf = (y, a) => {
    let j = 0; while (j + 2 < HR.length && y < HR[j + 1][0]) j++;
    const t = (y - HR[j][0]) / (HR[j + 1][0] - HR[j][0]), f = (((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * NH, k = Math.floor(f) % NH, k1 = (k + 1) % NH, u = f - Math.floor(f);
    const P = (jj, kx) => base[jj][kx];
    const top = [lerp(P(j, k)[0], P(j, k1)[0], u), lerp(P(j, k)[1], P(j, k1)[1], u), lerp(P(j, k)[2], P(j, k1)[2], u)];
    const bot = [lerp(P(j + 1, k)[0], P(j + 1, k1)[0], u), lerp(P(j + 1, k)[1], P(j + 1, k1)[1], u), lerp(P(j + 1, k)[2], P(j + 1, k1)[2], u)];
    return [lerp(top[0], bot[0], t), lerp(top[1], bot[1], t), lerp(top[2], bot[2], t)];
  };
  const O = [0, 0, 0], lift = (p, d) => add(p, mul(nrm([p[0], p[1] * 0.3, p[2]]), d));
  const quad = (a, b, c, d, color, off = 0.0015) => {
    const A = ph(lift(a, off)), B = ph(lift(b, off)), C = ph(lift(c, off)), D = ph(lift(d, off)), ref = ph(O);
    const sh = (P) => { const v = X.shade(P, [0, 0, 1]); return [color[0] * v, color[1] * v, color[2] * v]; };
    m.tri(A, B, C, sh(A), sh(B), sh(C), ref); m.tri(A, C, D, sh(A), sh(C), sh(D), ref);
  };
  const D2R = Math.PI / 180, ink = [0.17, 0.12, 0.09], white = [0.93, 0.91, 0.87], iris = [0.2, 0.15, 0.1];
  const brow = [Math.min(1, hairC[0] * 0.8), hairC[1] * 0.8, hairC[2] * 0.8];
  for (const s of [-1, 1]) {
    const q = (y0, y1, a0, a1, c, off) => quad(surf(y0, s * a0 * D2R), surf(y0, s * a1 * D2R), surf(y1, s * a1 * D2R), surf(y1, s * a0 * D2R), c, off);
    q(0.024, 0.0, 9, 36, white, 0.0016);        // eye white
    q(0.02, 0.002, 16, 30, iris, 0.0024);         // iris
    q(0.0165, 0.0055, 20, 26, ink, 0.0030);    // pupil
    q(0.041, 0.031, 6, 42, brow, 0.0022);          // brow
    q(0.026, 0.021, 8, 38, [ink[0] * 1.4, ink[1] * 1.3, ink[2] * 1.2], 0.0022);  // upper lash line
  }
  const lipC = [X.col.skin[0] * 0.82, X.col.skin[1] * 0.58, X.col.skin[2] * 0.56], lipD = [lipC[0] * 0.85, lipC[1] * 0.8, lipC[2] * 0.8];
  quad(surf(-0.066, -17 * D2R), surf(-0.066, 17 * D2R), surf(-0.073, 14 * D2R), surf(-0.073, -14 * D2R), lipC, 0.003);
  quad(surf(-0.073, -14 * D2R), surf(-0.073, 14 * D2R), surf(-0.082, 11 * D2R), surf(-0.082, -11 * D2R), lipD, 0.0032);
  /* nose */
  {
    const skin = (P) => X.skinAt(ph(P)), refN = ph(O);
    const B = lift(surf(0.022, 0), 0.002), T = add(surf(-0.022, 0), [0, 0.001, 0.02]), AL = add(surf(-0.026, -13 * D2R), [-0.004, 0, 0.012]), AR = add(surf(-0.026, 13 * D2R), [0.004, 0, 0.012]), BC = add(surf(-0.03, 0), [0, 0, 0.009]);
    const Cc = (P, f) => { const c = skin(P), v = X.shade(ph(P), [0, 0.3, 1]) * f; return [c[0] * v, c[1] * v, c[2] * v]; };
    const tri = (a, b, c, f) => m.tri(ph(a), ph(b), ph(c), Cc(a, f), Cc(b, f), Cc(c, f), refN);
    tri(B, AR, T, 1.0); tri(B, T, AL, 1.0); tri(T, AR, BC, 0.88); tri(T, BC, AL, 0.88); tri(AR, AL, BC, 0.8);
  }
  /* ears */
  for (const s of [-1, 1]) {
    const a = s * 90 * D2R, e = (y, dz, d) => { const p = surf(y, a); return [p[0] + s * d, y, p[2] + dz]; };
    const att = [[0.024, 0.0], [0.016, 0.024], [-0.012, 0.03], [-0.042, 0.004], [-0.014, -0.012]].map(([y, dz]) => e(y, dz - 0.004, -0.004 * 1));
    const outp = [[0.022, 0.0], [0.015, 0.02], [-0.012, 0.025], [-0.038, 0.004], [-0.012, -0.01]].map(([y, dz]) => e(y, dz - 0.004, 0.018));
    const cen = e(-0.01, 0.01, 0.006), ref = ph(O);
    const earC = (P) => { const c = X.skinAt(ph(P), [1.05, 0.93, 0.9]), v = X.shade(ph(P), [s, 0, 0]); return [c[0] * v, c[1] * v, c[2] * v]; };
    const oc = e(-0.008, 0.01, 0.02);
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5;
      m.tri(ph(att[i]), ph(att[j]), ph(outp[j]), earC(att[i]), earC(att[j]), earC(outp[j]), ref);
      m.tri(ph(att[i]), ph(outp[j]), ph(outp[i]), earC(att[i]), earC(outp[j]), earC(outp[i]), ref);
      m.tri(ph(outp[i]), ph(outp[j]), ph(oc), earC(outp[i]).map((v) => v * 0.9), earC(outp[j]).map((v) => v * 0.9), earC(oc).map((v) => v * 0.8), ph(cen));
    }
  }
  /* hair extras */
  const hc2 = (P) => { const v = X.shade(P, [0, 0, -1]); return [hairC[0] * v, hairC[1] * v, hairC[2] * v]; };
  const tube = (pts, rad, n, colf) => {
    const rr = pts.map((p, i) => { const ax = nrm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])), [u, v] = (() => { let u = nrm(cross(ax, [1, 0, 0])); return [u, cross(ax, u)]; })(); return Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2; return add(p, add(mul(u, Math.cos(a) * rad[i]), mul(v, Math.sin(a) * rad[i]))); }); });
    const tt = new Mesh();
    loft(tt, rr, { ref: (i) => pts[i], col: (i, k, P) => colf(i), vm: (i, k, P, N) => X.shade(P, N) });
    m.append(tt);
    return rr;
  };
  if (hairStyle === 'ponytail') {
    const pts = [[0, -0.02, -0.075], [0, -0.052, -0.106], [0, -0.112, -0.124], [0, -0.178, -0.116]].map(ph);
    const rr = tube(pts, [0.022 * hsz, 0.03 * hsz, 0.027 * hsz, 0.012 * hsz], 6, (i) => (i === 1 ? col.suit : hairC));
    const tip = add(pts[3], mul(nrm(sub(pts[3], pts[2])), 0.03 * hsz));
    fan(m, rr[3], tip, pts[3], () => hairC, (P) => X.shade(P, [0, -1, 0]));
  } else if (hairStyle === 'bun') {
    const c = ph([0, 0.1, -0.09]), r = 0.048 * hsz, ring0 = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ring0.push(add(c, [Math.sin(a) * r, Math.cos(a) * r * 0.2, Math.cos(a) * r])); }
    fan(m, ring0, add(c, [0, r * 0.9, -r * 0.5]), c, () => hairC, (P) => X.shade(P, [0, 1, 0]));
    fan(m, ring0, add(c, [0, -r * 0.8, -r * 0.5]), c, () => hairC, (P) => X.shade(P, [0, -1, 0]));
  }
  /* neck stub (head yaw pivot), same radius as the torso's neck plus half a millimetre */
  const nk = (y) => 0.047 * X.nr * (y < 0.5 ? lerp(1.12, 1, (y - 0.46) / 0.04) : lerp(1, 0.94, (y - 0.5) / 0.1)) + 0.0005;
  const NY = [0.535, 0.56, 0.6];
  const nr = NY.map((y) => { const r = []; for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; r.push([Math.sin(a) * nk(y), y, Math.cos(a) * nk(y)]); } return r; });
  loft(m, nr, { ref: (i) => [0, NY[i], 0], col: (i, k, P) => X.skinAt(P), vm: (i, k, P, N) => X.shade(P, N) * 0.95 });
  fan(m, nr[2], [0, 0.61, 0], [0, 0.58, 0], (P) => X.skinAt(P), null);
  void faceTint;
  return m;
}
