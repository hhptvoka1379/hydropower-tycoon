/* Low-poly model recipes (THREE-free: GB builders). Faceted, Field Notes palette, linear colours. Dimensions in metres, y up.
   Triangle budget (round 2): every recipe is as small as it can be and still read; see the counts in the report / state file. */
import { GB } from './geom.js';
import { PAL, mix, mul } from './palette.js';
import { hash3 } from './hash.js';

/* ---------------- tiles ---------------- */
/* a row of `per` solar panels lying in xz (centred on the origin), 10-triangle slabs (no underside), pitched / rolled as one rigid row */
export function panelRowGB(per, pitchX, panelW) {
  const g = new GB(), D = 2.5, y0 = -0.05, y1 = 0.05;
  for (let k = 0; k < per; k++) {
    const cx = (k - (per - 1) / 2) * pitchX, x0 = cx - panelW / 2, x1 = cx + panelW / 2, z0 = -D / 2, z1 = D / 2, o = [cx, 0, 0];
    g.quadOut([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], PAL.panel, o);
    g.quadOut([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], PAL.steel, o);
    g.quadOut([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], PAL.steel, o);
    g.quadOut([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], PAL.steelDark, o);
    g.quadOut([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], PAL.steelDark, o);
  }
  return g;
}
/* unit-height pole (y 0..1), 3 sides, 6 triangles; scaled per instance in y */
export function poleGB() { return new GB().cyl([0, 0, 0], [0, 1, 0], 0.13, 0.13, 3, PAL.steel, false); }

/* wind tower for a tile: foundation + tapered tower from the ground to `top` (absolute y); base radius rb. Origin = world (static mesh). 28 triangles */
export function towerGB(x, z, yFoot, yTop, rb, rf, tip = 0.55) {
  const g = new GB(), rt = Math.max(0.3, rb * tip);
  g.cyl([x, yFoot, z], [x, yFoot + 1.6, z], rf, rf * 0.95, 6, PAL.concreteDark, false);
  g.cyl([x, yFoot + 1.5, z], [x, yTop, z], rb, rt, 8, [mul(PAL.paper, 0.9), mul(PAL.paper, 1.04)], false);
  return g;
}
/* nacelle, unit scale, origin at the tower top, front toward local +z (the hub sits at z = 3.6). 17 triangles */
export function nacelleGB() {
  const g = new GB();
  g.box(0, 0, 0.5, 2.3, 2.2, 5.8, { top: PAL.paper, side: mul(PAL.paper, 0.9), bottom: mul(PAL.paper, 0.7) });
  g.cyl([0, 0, 3.4], [0, 0, 4.4], 1.05, 0.2, 5, PAL.paper, false);
  return g;
}
/* rotor of radius 1 in the xy plane (disc normal +z), 3 blades x 4 triangles; `feathered` = blades edge-on (storm / damaged) */
export function rotorGB(feathered) {
  const g = new GB(), r0 = 0.05, pitch = feathered ? 1.35 : 0.42, w0 = feathered ? 0.012 : 0.085, w1 = feathered ? 0.006 : 0.028;
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca, cs = Math.cos(pitch), sn = Math.sin(pitch);
    const P = (r, w, s) => [ca * r + tx * w * cs * s, sa * r + ty * w * cs * s, 0.05 + w * sn * s];
    const A = P(r0, w0, -1), B = P(r0, w0, 1), C = P(1, w1, 1), D = P(1, w1, -1);
    g.quad(A, B, C, D, PAL.white); g.quad(A, D, C, B, PAL.paper);
  }
  return g;
}
/* battery container, origin on the ground centre, 3 x 3 x 9, long axis z, status LED end at +z. 24 triangles */
export function containerGB() {
  const g = new GB();
  g.box(0, 1.5, 0, 3.0, 3.0, 9.0, { top: mul(PAL.paper, 0.75), side: mul(PAL.paper, 0.9), bottom: PAL.concreteDark });
  g.box(0, 3.06, 0, 3.15, 0.12, 9.15, PAL.clay);
  return g;
}
/* LED: one 0.45 m quad on the +z end face (2 triangles) */
export function ledGB() { return new GB().quad([-0.22, 2.1, 4.54], [0.22, 2.1, 4.54], [0.22, 2.55, 4.54], [-0.22, 2.55, 4.54], [1, 1, 1]); }

/* parcel stake, 8 triangles (+2 for a pennant) */
export function stakeGB(h, flag) {
  const g = new GB();
  g.cyl([0, -0.4, 0], [0, h, 0], 0.09, 0.07, 4, PAL.wood, false);
  if (flag) g.tri([0.05, h, 0], [1.2, h - 0.25, 0.02], [0.05, h - 0.55, 0], flag);
  return g;
}

/* block letters A / B / C from thin boxes (units of u metres, 3 x 4 cells), painted on a sign board. */
const LETTER_BARS = {
  A: [[0, 0, 0, 4], [3, 0, 3, 4], [0, 4, 3, 4], [0, 2, 3, 2]],
  B: [[0, 0, 0, 4], [3, 0, 3, 4], [0, 4, 3, 4], [0, 2, 3, 2], [0, 0, 3, 0]],
  C: [[0, 0, 0, 4], [0, 4, 3, 4], [0, 0, 3, 0]],
};
export const DESK_LETTERS = 'ABC';
export function letterGB(ch, u, col, depth = 0.07) {
  const g = new GB(), bars = LETTER_BARS[ch] || LETTER_BARS.A;
  for (const [x0, y0, x1, y1] of bars) g.box(((x0 + x1) / 2 - 1.5) * u, ((y0 + y1) / 2 - 2) * u, 0, (x1 - x0 + 1) * u, (y1 - y0 + 1) * u, depth, col);
  return g;
}
/* the walk-up parcel desk: a small kiosk (deck, four posts, gabled roof, back wall with a notice board, counter, plan on the counter) and a painted
   sign post with the parcel letter. origin = ground centre of the kiosk, front (counter side) = +z. Footprint ~ 4.0 x 2.4 m (kiosk 3.2 x 2.4 + sign). */
export const DESK_FOOT = { w: 4.4, d: 2.6 };
export function deskGB(index, owned) {
  const g = new GB(), wood = PAL.wood, roof = owned ? PAL.clay : mix(PAL.clay, PAL.paper, 0.4), paint = owned ? PAL.ochre : PAL.clay;
  g.box(0, 0.06, 0, 3.2, 0.12, 2.4, mul(wood, 0.85));                                                       // deck
  for (const [x, z] of [[-1.4, -1.0], [1.4, -1.0], [-1.4, 1.0], [1.4, 1.0]]) g.box(x, 1.25, z, 0.12, 2.3, 0.12, wood);
  g.box(0, 1.2, -1.0, 2.7, 2.2, 0.08, mix(PAL.paper, wood, 0.35));                                          // back wall
  g.box(0.15, 1.55, -0.94, 1.7, 0.95, 0.05, PAL.ink);                                                       // notice board
  for (const [x, y] of [[-0.45, 1.75], [0.2, 1.4], [0.7, 1.7]]) g.box(x, y, -0.9, 0.38, 0.3, 0.02, PAL.paper);
  g.box(0, 0.5, 0.65, 2.5, 0.9, 0.55, wood);                                                                // counter
  g.box(0, 0.97, 0.65, 2.6, 0.06, 0.7, mul(wood, 1.15));
  g.box(0, 1.01, 0.65, 0.9, 0.012, 0.55, PAL.paper);                                                        // the plan on the counter
  const o = [0, 2.5, 0], e = 2.45, ry = 3.0;                                                                // gabled roof along x
  g.quadOut([-1.8, e, -1.5], [1.8, e, -1.5], [1.8, ry, 0], [-1.8, ry, 0], roof, o);
  g.quadOut([-1.8, e, 1.5], [1.8, e, 1.5], [1.8, ry, 0], [-1.8, ry, 0], mul(roof, 0.9), o);
  g.quadOut([-1.8, e, -1.5], [1.8, e, -1.5], [1.8, e, 1.5], [-1.8, e, 1.5], mul(roof, 0.6), o);
  g.triOut([-1.8, e, -1.5], [-1.8, e, 1.5], [-1.8, ry, 0], mul(roof, 0.75), o); g.triOut([1.8, e, -1.5], [1.8, e, 1.5], [1.8, ry, 0], mul(roof, 0.75), o);
  // sign post at the right front corner: painted board with the parcel letter
  g.box(2.05, 1.1, 0.9, 0.1, 2.2, 0.1, wood);
  g.box(2.05, 2.35, 0.9, 1.0, 1.0, 0.08, paint);
  g.add(letterGB(DESK_LETTERS[index % 3], 0.13, PAL.paper), 2.05, 2.35, 0.97);
  return g;
}
/* tower crane for a tile under construction (height h), origin = ground centre; jib toward +x. ~60 triangles */
export function craneGB(h) {
  const g = new GB();
  g.box(0, 0.25, 0, 3.2, 0.5, 3.2, PAL.concreteDark);
  g.cyl([0, 0.5, 0], [0, h, 0], 0.32, 0.22, 4, PAL.clay, false, Math.PI / 4);
  g.box(h * 0.22, h + 0.2, 0, h * 0.8, 0.3, 0.3, PAL.ochre);
  g.box(-h * 0.1, h - 0.4, 0, 1.4, 1.0, 1.0, PAL.concreteDark);
  g.box(h * 0.5, h * 0.45, 0, 0.5, 0.4, 0.5, PAL.ink);
  g.box(0, 0.9, 1.9, 1.6, 1.8, 1.1, PAL.paper);
  return g;
}

/* ---------------- scatter ---------------- */
/* conifer variants: 0 spruce (4 tiers x 6 sides, tall and dark), 1 fir (3 tiers x 7 sides, fat). 30 / 27 triangles with a 3-sided trunk */
export const CONIFER = [
  { tiers: 4, seg: 6, y0: 1.2, step: 1.9, h: 3.2, r: 2.3, shrink: 0.2, dark: PAL.mossDark, light: PAL.moss, tint: 0.85 },
  { tiers: 3, seg: 7, y0: 1.0, step: 2.0, h: 3.5, r: 3.1, shrink: 0.25, dark: PAL.mossDark, light: PAL.mossLight, tint: 1.0 },
];
export function coniferGB(v, seed = 0) {
  const d = CONIFER[v], g = new GB();
  g.cyl([0, 0, 0], [0, d.y0 + 0.5, 0], 0.3, 0.2, 3, PAL.bark, false);
  for (let i = 0; i < d.tiers; i++) {
    const b = d.y0 + i * d.step, r = d.r * (1 - i * d.shrink), j = 0.92 + hash3(seed + v, i, 3) * 0.16;
    const lo = mul(mix(d.dark, d.light, i / d.tiers * 0.7), d.tint * j), hi = mul(mix(d.dark, d.light, 0.35 + i / d.tiers * 0.65), d.tint * j);
    g.cyl([0, b, 0], [0, b + d.h, 0], r, 0, d.seg, [lo, hi], false, hash3(seed + v, i, 4) * 6.28);
  }
  return g;
}
export function coniferHeight(v) { const d = CONIFER[v]; return d.y0 + (d.tiers - 1) * d.step + d.h; }
/* far impostor: a single 8-sided cone with the tree's overall size and mid tone */
export function coniferImpGB(v) {
  const d = CONIFER[v], g = new GB(), H = coniferHeight(v);
  g.cyl([0, d.y0 * 0.6, 0], [0, H, 0], d.r * 0.78, 0, 8, [mul(d.dark, d.tint), mul(mix(d.dark, d.light, 0.8), d.tint)], false);
  return g;
}

/* irregular faceted boulder: icosahedron (20 facets) with radial noise. Lowest point sits 0.25 m below the origin. */
export function rockGB(variant = 0, seed = 0) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const P = V.map((v, i) => { const k = 0.78 + 0.4 * hash3(seed + variant * 31, i, 7); return [v[0] * k, v[1] * k * 0.8, v[2] * k]; });
  let y0 = Infinity; for (const p of P) if (p[1] < y0) y0 = p[1];
  const g = new GB(), base = mix(mix(PAL.paper, PAL.ink, 0.52), PAL.clay, 0.1);
  F.forEach(([a, b, c], fi) => {
    const A = [P[a][0], P[a][1] - y0 - 0.25, P[a][2]], B = [P[b][0], P[b][1] - y0 - 0.25, P[b][2]], C = [P[c][0], P[c][1] - y0 - 0.25, P[c][2]];
    const cy = (A[1] + B[1] + C[1]) / 3, k = 0.8 + 0.3 * hash3(seed + 5, fi, variant) + 0.15 * Math.min(1, cy / 0.9);
    g.triOut(A, B, C, mul(base, k), [0, 0.4, 0]);
  });
  return g;
}

/* grass tuft: two crossed trapezoid blades (4 triangles, double-sided material), root dark, tip pale */
function crossedQuads(g, wBottom, wTop, h, root, tip, y0 = 0) {
  for (const a of [0, Math.PI / 2]) {
    const c = Math.cos(a), s = Math.sin(a);
    const P = (x, y) => [x * c, y, x * s];
    const A = P(-wBottom / 2, y0), B = P(wBottom / 2, y0), C = P(wTop / 2, y0 + h), D = P(-wTop / 2, y0 + h);
    g.triC(A, B, C, root, root, tip); g.triC(A, C, D, root, tip, tip);
  }
}
export function tuftGB() { const g = new GB(); crossedQuads(g, 0.8, 0.22, 0.62, mul(PAL.mossDark, 0.7), mix(PAL.moss, PAL.mossLight, 0.6)); return g; }
/* flower: a small grass tuft plus a crossed pair of white head quads (head vertices are near-white; the shader recolours them by aRand.w). 8 triangles */
export function flowerGB() {
  const g = new GB(); crossedQuads(g, 0.5, 0.14, 0.42, mul(PAL.mossDark, 0.7), mix(PAL.moss, PAL.mossLight, 0.4));
  crossedQuads(g, 0.12, 0.34, 0.24, [0.98, 0.98, 0.98], [0.98, 0.98, 0.98], 0.4);
  return g;
}
