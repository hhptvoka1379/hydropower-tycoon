/* Torso part: pelvis/brief hem, waist, ribcage with a subtle bust, shoulder slope, neck. Rings sit exactly on the suit panel edges so paint boundaries are crisp. */
import { Mesh, loft, fan, lerp, mul, add, sub, clamp } from './geom.js';

export function buildTorso(X) {
  const { bdp, belly, chestW, hipR, waR, shR, bw, bust, col } = X, NS = 20, suit = X.Bd.suit;
  const KEY = [[-0.025, 0.085 * hipR, 0.062 * bdp, 0], [0, 0.168 * Math.pow(hipR, 0.9), 0.105 * bdp, -0.012], [0.07, 0.162 * hipR, 0.098 * bdp, -0.006],
    [0.13, 0.124 * lerp(hipR, waR, 0.45), 0.08 * bdp + belly * 0.6, belly * 0.4], [0.2, 0.104 * waR, 0.072 * bdp + belly, belly * 0.8],
    [0.27, 0.122 * lerp(waR, chestW, 0.5), 0.084 * bdp + belly * 0.5, 0.006 + belly * 0.4], [0.33, 0.134 * chestW, 0.096 * bdp, 0.004], [0.38, 0.138 * chestW, 0.098 * bdp, 0.008],
    [0.42, 0.142 * chestW, 0.088 * bdp, 0.008], [0.445, 0.168 * shR, 0.076 * bdp, 0], [0.47, 0.132 * (0.85 + 0.15 * bw), 0.068 * bdp, 0], [0.49, 0.092, 0.058, 0], [0.505, 0.062, 0.052, 0]];
  const prof = (y) => {   // smooth (Hermite) interpolation of the key rows
    let i = 0; while (i + 2 < KEY.length && y > KEY[i + 1][0]) i++;
    const A = KEY[i], B = KEY[i + 1], t = clamp((y - A[0]) / (B[0] - A[0]), -0.2, 1.2), h = B[0] - A[0], out = [];
    for (let c = 1; c < 4; c++) {
      const pa = i > 0 ? (B[c] - KEY[i - 1][c]) / (B[0] - KEY[i - 1][0]) : (B[c] - A[c]) / h, pb = i + 2 < KEY.length ? (KEY[i + 2][c] - A[c]) / (KEY[i + 2][0] - A[0]) : (B[c] - A[c]) / h;
      const t2 = t * t, t3 = t2 * t;
      out.push((2 * t3 - 3 * t2 + 1) * A[c] + (t3 - 2 * t2 + t) * pa * h + (-2 * t3 + 3 * t2) * B[c] + (t3 - t2) * pb * h);
    }
    return out;
  };
  const bx = 0.05 * chestW, bsx = 0.024 * chestW;
  const bustD = (y, x, ca) => {
    if (bust <= 0 || ca <= 0.06) return 0;
    const lobe = Math.exp(-((x - bx) ** 2) / (2 * bsx * bsx)) + Math.exp(-((x + bx) ** 2) / (2 * bsx * bsx)), q = (y - 0.372) / (y > 0.372 ? 0.05 : 0.055);
    return bust * 0.044 * lobe * Math.exp(-q * q) * Math.pow(ca, 1.1);
  };
  const E = 0.85;
  const mk = (y, hem) => {
    const r = [];
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
      const yy = y + (hem ? 0.05 * Math.pow(Math.abs(sa), 0.62) + 0.03 * Math.pow(Math.max(0, -ca), 1.4) : 0), p = prof(yy);
      const sx = Math.sign(sa) * Math.pow(Math.abs(sa), E), sz = Math.sign(ca) * Math.pow(Math.abs(ca), E), x = p[0] * sx, d = bustD(yy, x, ca);
      r.push([x + sx * d, yy, p[2] + (ca >= 0 ? p[1] * sz + ca * d : p[1] * 0.96 * sz)]);
    }
    return r;
  };
  const RY = [-0.04, 0.0, 0.04, 0.085, 0.11, 0.17, 0.225, 0.26, 0.285, 0.32, 0.355, 0.385, 0.41, 0.436, 0.458, 0.478, 0.495, 0.505];
  const rings = RY.map((y, i) => mk(y, i === 0));
  const cen = (i) => { let y = 0; for (const p of rings[i]) y += p[1]; return [0, y / NS, prof(RY[i])[2]]; };
  const m = new Mesh();
  const trimBand = (y) => (suit === 'striped' ? Math.floor((y - 0.085) / 0.043) % 2 === 1 : false);
  const paint = (P) => {
    const y = P[1], ax = Math.abs(P[0]);
    const skin = () => X.skinAt(P);
    if (suit === 'trunks') return y < 0.085 ? col.suit : y < 0.11 ? col.trim : skin();
    if (y >= 0.436) return ax > 0.05 && ax < 0.115 ? col.suit : skin();
    if (suit === 'plain') return y > 0.41 || y < 0.11 && y > 0.085 ? col.trim : col.suit;
    if (suit === 'striped') return y < 0.085 ? col.suit : trimBand(y) ? col.trim : col.suit;
    if (y < 0.085) return col.suit;
    if (y < 0.11) return col.trim;
    if (y < 0.26) return skin();
    if (y < 0.285) return col.trim;
    if (y < 0.41) return col.suit;
    return col.trim;
  };
  const vm = (i, k, P, N) => {
    let s = X.shade(P, N);
    if (k === 0 && P[1] > 0.12 && P[1] < 0.26) s *= 0.95;          // linea alba
    if (k === NS / 2 && P[1] > 0.1 && P[1] < 0.44) s *= 0.96;      // spine
    return s;
  };
  loft(m, rings, { ref: cen, col: (i, k, P) => paint(P), vm });
  fan(m, rings[0], [0, 0.0, -0.005], [0, 0.03, 0], () => col.suit, (P) => X.shade(P, [0, -1, 0]));
  const top = [0, 0.53, 0];
  fan(m, rings[rings.length - 1], top, [0, 0.45, 0], (P) => X.skinAt(P), (P) => X.shade(P, [0, 1, 0]));
  /* neck, up to the head pivot; the head part carries its own stub of the same radius */
  const nk = (y) => 0.047 * X.nr * (y < 0.5 ? lerp(1.12, 1, (y - 0.46) / 0.04) : lerp(1, 0.94, (y - 0.5) / 0.1));
  const NY = [0.46, 0.5, 0.53, 0.555];
  const nrings = NY.map((y) => { const r = []; for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; r.push([Math.sin(a) * nk(y), y, Math.cos(a) * nk(y)]); } return r; });
  loft(m, nrings, { ref: (i) => [0, NY[i], 0], col: (i, k, P) => X.skinAt(P), vm: (i, k, P, N) => X.shade(P, N) });
  fan(m, nrings[3], [0, 0.56, 0], [0, 0.5, 0], (P) => X.skinAt(P), null);
  return m;
}
export { mul, add, sub };
