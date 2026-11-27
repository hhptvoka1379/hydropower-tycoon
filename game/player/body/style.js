/* Body descriptor, palette and baked-shading helpers. Colours are sRGB triplets (the avatar linearises them). */
import { lerp, clamp } from './geom.js';

export const ATHLETE_F = { name: 'athlete_f', height: 1.74, build: 0.40, shoulders: 1.14, bust: 0.52, waist: 0.94, hips: 1.02, legs: 1.05, arms: 1.04, head: 0.98, neck: 1.0, hair: 'ponytail', suit: 'field', cap: true };

const hex = (c) => (typeof c === 'string' ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) : c);

/* resolve options into one context X: proportions in unit space (the 1.70 m reference; SC scales to metres), colours, baked-shading functions */
export function makeContext(opts = {}) {
  const Bd = Object.assign({}, ATHLETE_F, opts.preset || {});
  if (opts.cap !== undefined) Bd.cap = !!opts.cap;
  if (opts.hair !== undefined) Bd.hair = opts.hair;
  if (opts.suitStyle !== undefined) Bd.suit = opts.suitStyle;
  const bld = clamp(Bd.build, 0, 1), bw = 1 + (bld - 0.5) * 0.5, bdp = 1 + (bld - 0.5) * 0.55, lr = 1 + (bld - 0.5) * 0.6;
  const belly = Math.max(0, bld - 0.6) * 0.05, fsz = 1 + (lr - 1) * 0.4;
  const hsz = Bd.head, legL = Bd.legs, armL = Bd.arms, neckL = Bd.neck, shW = Bd.shoulders, hipW = Bd.hips, waistW = Bd.waist;
  const chestW = bw * (0.55 + 0.45 * shW), hipR = hipW * bw, waR = waistW * bw, shR = shW * (0.8 + 0.2 * bw);
  const pivY = 0.5 + 0.08 * neckL, legRaw = 0.79 * legL + 0.075 * fsz, headTop = pivY + 0.26 * hsz;
  const SC = Bd.height / (legRaw + headTop);
  const X = {
    Bd, bld, bw, bdp, lr, belly, fsz, hsz, legL, armL, neckL, shW, hipW, waistW, chestW, hipR, waR, shR, pivY, SC,
    bust: clamp(Bd.bust, 0, 1), ar: lr * (0.75 + 0.25 * shW), thR: lerp(1, lr, 0.6) * (0.6 + 0.4 * hipR),
    nr: (0.85 + 0.15 * bw) * (1 + 1.2 * Math.max(0, shW - 1)),
    hx: 0.07 * lerp(1, hipR, 0.6), hipZ: -0.006, S: [0.155 * shR, 0.455, -0.005],
    col: {
      suit: hex(opts.suitColor || [0.16, 0.28, 0.40]),
      trim: hex(opts.trimColor || [0.85, 0.58, 0.18]),
      cap: hex(opts.capColor || [0.94, 0.92, 0.86]),
      skin: hex(opts.skin || [0.87, 0.7, 0.52]),
      hair: hex(opts.hairColor || [0.24, 0.16, 0.1]),
      boot: hex(opts.bootColor || [0.28, 0.19, 0.13]),
      sole: [0.11, 0.10, 0.09]
    }
  };
  X.col.pants = opts.pantsColor ? hex(opts.pantsColor) : [X.col.suit[0] * 0.52 + 0.06, X.col.suit[1] * 0.52 + 0.06, X.col.suit[2] * 0.52 + 0.07];
  X.K = [X.hx - 0.012 * legL, -0.4 * legL, X.hipZ + 0.008 * legL];   // knee pivot (matches the rig pivot)
  const ua = norm3([1, -0.08, 0]), fa = norm3([1, -0.06, 0]);
  X.ua = ua; X.fa = fa;
  X.E = [X.S[0] + ua[0] * 0.28 * armL, X.S[1] + ua[1] * 0.28 * armL, X.S[2]];
  X.Wr = [X.E[0] + fa[0] * 0.25 * armL, X.E[1] + fa[1] * 0.25 * armL, X.E[2]];
  X.sd = norm3([-0.03, -1, -0.03]);
  X.A = [X.K[0] + X.sd[0] * 0.39 * legL, X.K[1] + X.sd[1] * 0.39 * legL, X.K[2] + X.sd[2] * 0.39 * legL];

  /* ambient-occlusion blobs [centre, radius, strength] (both sides listed) and skin tint blobs [centre, radius, rgb multiplier] */
  const both = (c) => [[c[0], c[1], c[2]], [-c[0], c[1], c[2]]];
  const ao = [], tn = [];
  const A_ = (c, r, k) => both(c).forEach((p) => ao.push([p, r, k]));
  const T_ = (c, r, m) => both(c).forEach((p) => tn.push([p, r, m]));
  A_([0.128 * shR, 0.405, 0], 0.05, 0.22); A_([0, 0.335, 0.095], 0.03, 0.06); A_([0, 0.185, 0.085], 0.012, 0.25); A_([0, 0.495, 0.045], 0.05, 0.2);
  A_([0, pivY - 0.015, 0.045], 0.05, 0.3); A_([0, -0.03, 0], 0.06, 0.3); A_([0.07, -0.04, -0.09], 0.045, 0.22);
  A_([X.K[0], X.K[1], X.K[2] - 0.045], 0.05, 0.3); A_([X.E[0], X.E[1], X.E[2] + 0.03], 0.04, 0.15);
  A_([X.A[0], X.A[1] - 0.02, X.A[2] - 0.03], 0.03, 0.2);
  T_([X.K[0], X.K[1], X.K[2] + 0.05], 0.05, [1.05, 0.93, 0.92]); T_([X.E[0], X.E[1], X.E[2] - 0.04], 0.04, [1.05, 0.94, 0.93]);
  T_([X.S[0], 0.47, 0], 0.07, [1.04, 0.96, 0.94]); T_([X.A[0], X.A[1] - 0.07, X.A[2]], 0.05, [0.97, 0.94, 0.92]);
  T_([X.hx, -0.2 * legL, 0.02], 0.12, [1.02, 1.01, 1.0]);
  X.aoBlobs = ao; X.tintBlobs = tn;
  /* baked shading: hemisphere term from the smooth normal times the AO blobs */
  X.shade = (P, N) => {
    let m = lerp(0.8, 1.0, 0.5 + 0.5 * N[1]);
    for (const [c, r, k] of ao) { const d = Math.hypot(P[0] - c[0], P[1] - c[1], P[2] - c[2]) / r; if (d < 1) m *= 1 - k * (1 - d * d) * (1 - d * d); }
    return m;
  };
  X.skinAt = (P, extra) => {
    let r = X.col.skin[0], g = X.col.skin[1], b = X.col.skin[2];
    for (const [c, rad, mm] of tn) { const d = Math.hypot(P[0] - c[0], P[1] - c[1], P[2] - c[2]) / rad; if (d < 1) { const f = (1 - d * d) * (1 - d * d); r *= 1 + (mm[0] - 1) * f; g *= 1 + (mm[1] - 1) * f; b *= 1 + (mm[2] - 1) * f; } }
    if (extra) { r *= extra[0]; g *= extra[1]; b *= extra[2]; }
    return [r, g, b];
  };
  return X;
}
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
