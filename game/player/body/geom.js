/* Geometry kit for the new body: vec helpers, a triangle Mesh with per-vertex colours, ring lofts and fans. Pure JS, no THREE, no DOM. */
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Mesh {
  constructor() { this.p = []; this.n = []; this.c = []; }
  get count() { return this.p.length / 9; }
  /* one triangle; ref = a point inside the solid, used to wind the face outward */
  tri(a, b, c, ca, cb, cc, ref) {
    let n = cross(sub(b, a), sub(c, a));
    const l = len(n);
    if (l < 1e-12) return;
    n = [n[0] / l, n[1] / l, n[2] / l];
    if (ref && dot(n, sub(mul(add(add(a, b), c), 1 / 3), ref)) < 0) { [b, c] = [c, b]; [cb, cc] = [cc, cb]; n = [-n[0], -n[1], -n[2]]; }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }
  /* flat-coloured triangle */
  tri1(a, b, c, col, ref) { this.tri(a, b, c, col, col, col, ref); }
  append(o) { for (let i = 0; i < o.p.length; i++) { this.p.push(o.p[i]); this.n.push(o.n[i]); this.c.push(o.c[i]); } return this; }
  scaled(s) { const m = new Mesh(); m.p = this.p.map((v) => v * s); m.n = this.n.slice(); m.c = this.c.slice(); return m; }
  /* mirror across x = 0 (winding reversed so faces stay outward) */
  mirrored() {
    const m = new Mesh();
    for (let t = 0; t < this.count; t++) {
      const o = t * 9, src = (a, v) => [a[o + v * 3], a[o + v * 3 + 1], a[o + v * 3 + 2]];
      const P = [0, 1, 2].map((v) => src(this.p, v)), N = [0, 1, 2].map((v) => src(this.n, v)), C = [0, 1, 2].map((v) => src(this.c, v));
      for (const v of [0, 2, 1]) { m.p.push(-P[v][0], P[v][1], P[v][2]); m.n.push(-N[v][0], N[v][1], N[v][2]); m.c.push(C[v][0], C[v][1], C[v][2]); }
    }
    return m;
  }
  toPart() { return { position: new Float32Array(this.p), normal: new Float32Array(this.n), color: new Float32Array(this.c) }; }
}

/* Loft a closed tube through rings (arrays of equal-length point lists).
   o.ref(i) -> interior point for ring i; o.col(i,k,P) -> face colour (crisp paint); o.vm(i,k,P,N) -> vertex multiplier (scalar or rgb): baked shading */
export function loft(mesh, rings, o) {
  const R = rings.length, n = rings[0].length, N = [];
  for (let i = 0; i < R; i++) {
    const row = [], ref = o.ref(i);
    for (let k = 0; k < n; k++) {
      const P = rings[i][k], tk = sub(rings[i][(k + 1) % n], rings[i][(k + n - 1) % n]), ti = sub(rings[Math.min(i + 1, R - 1)][k], rings[Math.max(i - 1, 0)][k]);
      let nn = cross(tk, ti);
      if (len(nn) < 1e-9) nn = sub(P, ref);
      nn = nrm(nn);
      if (dot(nn, sub(P, ref)) < 0) nn = mul(nn, -1);
      row.push(nn);
    }
    N.push(row);
  }
  const vc = (i, k, base) => { const P = rings[i][k], m = o.vm ? o.vm(i, k, P, N[i][k]) : 1; return typeof m === 'number' ? [base[0] * m, base[1] * m, base[2] * m] : [base[0] * m[0], base[1] * m[1], base[2] * m[2]]; };
  for (let i = 0; i + 1 < R; i++) {
    const ref = mul(add(o.ref(i), o.ref(i + 1)), 0.5);
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n, a = rings[i][k], b = rings[i][k1], c = rings[i + 1][k1], d = rings[i + 1][k];
      const cen = mul(add(add(a, b), add(c, d)), 0.25), base = o.col(i, k, cen);
      const A = vc(i, k, base), B = vc(i, k1, base), C = vc(i + 1, k1, base), D = vc(i + 1, k, base);
      if (len(sub(a, c)) <= len(sub(b, d))) { mesh.tri(a, b, c, A, B, C, ref); mesh.tri(a, c, d, A, C, D, ref); }
      else { mesh.tri(a, b, d, A, B, D, ref); mesh.tri(b, c, d, B, C, D, ref); }
    }
  }
  return N;
}

/* close a ring with a fan to an apex; ringIdx selects which ring's normals/colours to use */
export function fan(mesh, ring, apex, ref, colFn, vmFn) {
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n, cen = mul(add(add(ring[k], ring[k1]), apex), 1 / 3), base = colFn(cen);
    const m = (P) => { const v = vmFn ? vmFn(P) : 1; return typeof v === 'number' ? [base[0] * v, base[1] * v, base[2] * v] : [base[0] * v[0], base[1] * v[1], base[2] * v[2]]; };
    mesh.tri(ring[k], ring[k1], apex, m(ring[k]), m(ring[k1]), m(apex), ref);
  }
}

/* Elliptical ring in the plane spanned by unit axes u (side) and v (front); front vertex is k = 0. rf/rb: front/back radii, e: superellipse exponent (1 = ellipse) */
export function ring(c, u, v, rx, rf, rb, n, e = 1) {
  const r = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, s = Math.sin(a), co = Math.cos(a);
    const sx = Math.sign(s) * Math.pow(Math.abs(s), e), sz = Math.sign(co) * Math.pow(Math.abs(co), e);
    r.push(add(c, add(mul(u, rx * sx), mul(v, sz * (co >= 0 ? rf : rb)))));
  }
  return r;
}
