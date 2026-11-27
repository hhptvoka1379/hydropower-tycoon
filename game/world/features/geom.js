/* THREE-free low-poly geometry builder. Everything is non-indexed with flat (per-face) normals and a per-vertex linear colour,
   so a result {position, normal, color} drops straight into a BufferGeometry. Solids are convex or star-shaped around a reference
   point; the winding of each face is chosen so its normal points away from that point (so no hand-written winding can be wrong). */
export class GB {
  constructor() { this.p = []; this.n = []; this.c = []; }
  get triCount() { return this.p.length / 9; }
  /* one triangle; normal from the winding (a,b,c counter-clockwise seen from outside) */
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) return this;
    nx /= l; ny /= l; nz /= l;
    for (const q of [a, b, c]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
    return this;
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); return this.tri(a, c, d, col); }
  /* triangle whose normal faces away from the reference point `o` */
  triOut(a, b, c, col, o) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - o[0], my = (a[1] + b[1] + c[1]) / 3 - o[1], mz = (a[2] + b[2] + c[2]) / 3 - o[2];
    return nx * mx + ny * my + nz * mz >= 0 ? this.tri(a, b, c, col) : this.tri(a, c, b, col);
  }
  quadOut(a, b, c, d, col, o) { this.triOut(a, b, c, col, o); return this.triOut(a, c, d, col, o); }
  /* axis-aligned box given its centre and full size; col or {top, side, bottom} */
  box(cx, cy, cz, sx, sy, sz, col) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, o = [cx, cy, cz];
    const top = col.top || col, side = col.side || col, bot = col.bottom || col;
    this.quadOut([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top, o);
    this.quadOut([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bot, o);
    this.quadOut([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side, o);
    this.quadOut([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], side, o);
    this.quadOut([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], side, o);
    this.quadOut([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side, o);
    return this;
  }
  /* box between two y levels over an arbitrary quadrilateral footprint is rarely needed; boxY gives a y-range box */
  boxY(x0, x1, y0, y1, z0, z1, col) { return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col); }
  /* tapered prism / cone along p0 -> p1 (r1 = 0 gives a cone), `seg` sides, optional end caps. Colour: c or [c0, c1] (bottom, top). */
  cyl(p0, p1, r0, r1, seg, col, caps = true, rot = 0) {
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    let ux, uy, uz;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; uz = 0; } else { ux = 0; uy = 1; uz = 0; }
    let ax = uy * dz - uz * dy, ay = uz * dx - ux * dz, az = ux * dy - uy * dx;
    const al = Math.sqrt(ax * ax + ay * ay + az * az); ax /= al; ay /= al; az /= al;
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const c0 = Array.isArray(col[0]) ? col[0] : col, c1 = Array.isArray(col[0]) ? col[1] : col;
    const ring = (p, r, k) => { const a = rot + (k / seg) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r; return [p[0] + ax * ca + bx * sa, p[1] + ay * ca + by * sa, p[2] + az * ca + bz * sa]; };
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    for (let k = 0; k < seg; k++) {
      const a0 = ring(p0, r0, k), a1 = ring(p0, r0, k + 1), b0 = ring(p1, r1, k), b1 = ring(p1, r1, k + 1);
      if (r1 > 1e-6) {
        // two triangles with the bottom and top colours (smooth vertical gradient inside each facet is kept by vertex colour)
        this._triOutC(a0, a1, b1, c0, c0, c1, mid); this._triOutC(a0, b1, b0, c0, c1, c1, mid);
      } else this._triOutC(a0, a1, b0, c0, c0, c1, mid);
    }
    if (caps) {
      if (r0 > 1e-6) for (let k = 0; k < seg; k++) this.triOut(p0, ring(p0, r0, k), ring(p0, r0, k + 1), c0, mid);
      if (r1 > 1e-6) for (let k = 0; k < seg; k++) this.triOut(p1, ring(p1, r1, k), ring(p1, r1, k + 1), c1, mid);
    }
    return this;
  }
  _triOutC(a, b, c, ca, cb, cc, o) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - o[0], my = (a[1] + b[1] + c[1]) / 3 - o[1], mz = (a[2] + b[2] + c[2]) / 3 - o[2];
    if (nx * mx + ny * my + nz * mz < 0) { const t = b; b = c; c = t; const tc = cb; cb = cc; cc = tc; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-12) return this;
    nx /= l; ny /= l; nz /= l;
    const P = [a, b, c], C = [ca, cb, cc];
    for (let k = 0; k < 3; k++) { this.p.push(P[k][0], P[k][1], P[k][2]); this.n.push(nx, ny, nz); this.c.push(C[k][0], C[k][1], C[k][2]); }
    return this;
  }
  /* triangle with one colour per vertex, normal from the winding (double-sided materials: blades, crossed quads) */
  triC(a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-12) return this;
    nx /= l; ny /= l; nz /= l;
    const P = [a, b, c], C = [ca, cb, cc];
    for (let k = 0; k < 3; k++) { this.p.push(P[k][0], P[k][1], P[k][2]); this.n.push(nx, ny, nz); this.c.push(C[k][0], C[k][1], C[k][2]); }
    return this;
  }
  /* triangle with one colour per vertex whose normal is forced to face up (+y): ground ribbons and drapes */
  triUp(a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny < 0) { const t = b; b = c; c = t; const tc = cb; cb = cc; cc = tc; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-12) return this;
    nx /= l; ny /= l; nz /= l;
    const P = [a, b, c], C = [ca, cb, cc];
    for (let k = 0; k < 3; k++) { this.p.push(P[k][0], P[k][1], P[k][2]); this.n.push(nx, ny, nz); this.c.push(C[k][0], C[k][1], C[k][2]); }
    return this;
  }
  /* append another builder, rotated about y by `ry`, scaled by `s` (uniform, or [sx,sy,sz]) and moved to (x,y,z) */
  add(o, x = 0, y = 0, z = 0, ry = 0, s = 1) {
    const sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s, sz = Array.isArray(s) ? s[2] : s;
    const c = Math.cos(ry), sn = Math.sin(ry);
    for (let i = 0; i < o.p.length; i += 3) {
      const px = o.p[i] * sx, py = o.p[i + 1] * sy, pz = o.p[i + 2] * sz;
      this.p.push(px * c + pz * sn + x, py, -px * sn + pz * c + z);
      const nx = o.n[i] / sx, ny = o.n[i + 1] / sy, nz = o.n[i + 2] / sz, l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      this.n.push((nx * c + nz * sn) * l, ny * l, (-nx * sn + nz * c) * l);
      this.c.push(o.c[i], o.c[i + 1], o.c[i + 2]);
    }
    return this;
  }
  bounds() {
    const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (let i = 0; i < this.p.length; i += 3) {
      if (this.p[i] < b.x0) b.x0 = this.p[i]; if (this.p[i] > b.x1) b.x1 = this.p[i];
      if (this.p[i + 1] < b.y0) b.y0 = this.p[i + 1]; if (this.p[i + 1] > b.y1) b.y1 = this.p[i + 1];
      if (this.p[i + 2] < b.z0) b.z0 = this.p[i + 2]; if (this.p[i + 2] > b.z1) b.z1 = this.p[i + 2];
    }
    return b;
  }
  /* tint every vertex colour (multiply) */
  tint(k) { for (let i = 0; i < this.c.length; i += 3) { this.c[i] *= k[0]; this.c[i + 1] *= k[1]; this.c[i + 2] *= k[2]; } return this; }
  arrays() { return { position: new Float32Array(this.p), normal: new Float32Array(this.n), color: new Float32Array(this.c) }; }
}
