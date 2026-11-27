/* MeshBuilder: merges faceted low-poly shapes into one BufferGeometry (position, face normal, linear vertex colour).
   Every face takes an outward `hint` vector so winding mistakes cannot produce inside-out faces. Colours are sRGB hex. */
import { BufferAttribute, BufferGeometry, Color } from 'three';

const cache = new Map();
const tmpC = new Color();
export function lin(hex) {
  let c = cache.get(hex);
  if (!c) { tmpC.setHex(hex); c = [tmpC.r, tmpC.g, tmpC.b]; cache.set(hex, c); }
  return c;
}
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export class MeshBuilder {
  constructor() { this.p = []; this.c = []; this.n = []; this.tris = 0; }
  /* triangle (a,b,c are [x,y,z]); hint = outward direction or null; col linear [r,g,b] */
  tri(a, b, c, col, hint) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { const s = b; b = c; c = s; nx = -nx; ny = -ny; nz = -nz; }
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
    this.tris++;
  }
  quad(a, b, c, d, col, hint) { this.tri(a, b, c, col, hint); this.tri(a, c, d, col, hint); }
  /* axis-aligned box standing on y0, centred on (cx,cz), optional yaw about its centre */
  box(cx, y0, cz, sx, sy, sz, col, yaw = 0, opts = null) {
    const ca = Math.cos(yaw), sa = Math.sin(yaw), hx = sx / 2, hz = sz / 2;
    const P = (lx, ly, lz) => [cx + lx * ca - lz * sa, y0 + ly, cz + lx * sa + lz * ca];
    const A = P(-hx, 0, -hz), B = P(hx, 0, -hz), C = P(hx, 0, hz), D = P(-hx, 0, hz);
    const E = P(-hx, sy, -hz), F = P(hx, sy, -hz), G = P(hx, sy, hz), H = P(-hx, sy, hz);
    const ax = [ca, 0, sa], az = [-sa, 0, ca];
    const sk = opts && opts.sideShade ? opts.sideShade : 1;
    this.quad(E, H, G, F, col, [0, 1, 0]);
    this.quad(A, B, F, E, shade(col, sk), [-az[0], 0, -az[2]]);
    this.quad(B, C, G, F, shade(col, sk), ax);
    this.quad(C, D, H, G, shade(col, sk), az);
    this.quad(D, A, E, H, shade(col, sk), [-ax[0], 0, -ax[2]]);
    if (!opts || opts.bottom !== false) this.quad(A, D, C, B, shade(col, 0.7), [0, -1, 0]);
    return this;
  }
  /* prism cylinder from p0 to p1, radius r, seg sides, optional end caps */
  cyl(p0, p1, r, seg, col, caps = true) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2], l = Math.hypot(ax, ay, az) || 1;
    const dx = ax / l, dy = ay / l, dz = az / l;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let px = uy * dz - uz * dy, py = uz * dx - ux * dz, pz = ux * dy - uy * dx;
    const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
    const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
    const ring = (c, t) => [c[0] + (px * Math.cos(t) + qx * Math.sin(t)) * r, c[1] + (py * Math.cos(t) + qy * Math.sin(t)) * r, c[2] + (pz * Math.cos(t) + qz * Math.sin(t)) * r];
    for (let s = 0; s < seg; s++) {
      const t0 = (s / seg) * Math.PI * 2, t1 = ((s + 1) / seg) * Math.PI * 2, tm = (t0 + t1) / 2;
      const h = [px * Math.cos(tm) + qx * Math.sin(tm), py * Math.cos(tm) + qy * Math.sin(tm), pz * Math.cos(tm) + qz * Math.sin(tm)];
      const kk = 0.9 + 0.1 * Math.cos(tm * 2);
      this.quad(ring(p0, t0), ring(p0, t1), ring(p1, t1), ring(p1, t0), shade(col, kk), h);
      if (caps) {
        this.tri(p0, ring(p0, t1), ring(p0, t0), col, [-dx, -dy, -dz]);
        this.tri(p1, ring(p1, t0), ring(p1, t1), col, [dx, dy, dz]);
      }
    }
    return this;
  }
  /* gable roof over a rectangle (axis-aligned), ridge along x (alongX) or z */
  gable(cx, y0, cz, sx, sz, rise, overhang, col, alongX = true) {
    const hx = sx / 2 + overhang, hz = sz / 2 + overhang, y1 = y0 + rise;
    if (alongX) {
      const A = [cx - hx, y0, cz - hz], B = [cx + hx, y0, cz - hz], C = [cx + hx, y0, cz + hz], D = [cx - hx, y0, cz + hz], R0 = [cx - hx, y1, cz], R1 = [cx + hx, y1, cz];
      this.quad(A, B, R1, R0, col, [0, hz, -rise]); this.quad(D, C, R1, R0, shade(col, 0.92), [0, hz, rise]);
      const w = shade(col, 0.8); this.tri(A, R0, D, w, [-1, 0, 0]); this.tri(B, C, R1, w, [1, 0, 0]);
    } else {
      const A = [cx - hx, y0, cz - hz], B = [cx + hx, y0, cz - hz], C = [cx + hx, y0, cz + hz], D = [cx - hx, y0, cz + hz], R0 = [cx, y1, cz - hz], R1 = [cx, y1, cz + hz];
      this.quad(A, D, R1, R0, col, [-rise, hx, 0]); this.quad(B, C, R1, R0, shade(col, 0.92), [rise, hx, 0]);
      const w = shade(col, 0.8); this.tri(A, B, R0, w, [0, 0, -1]); this.tri(D, C, R1, w, [0, 0, 1]);
    }
    return this;
  }
  get count() { return this.tris; }
  toGeometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere();
    return g;
  }
}
