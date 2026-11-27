/* Deterministic integer hashing (no Math.random anywhere). All functions return floats in [0,1) unless noted. */
export function hash2(i, j) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul((j | 0) + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
export function hash3(s, i, j) {
  let h = Math.imul((s | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i | 0, 0xc2b2ae35) ^ Math.imul((j | 0) + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/* smooth value noise in [-1,1] */
export function vnoise(seed, x, z) {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash3(seed, i, j), b = hash3(seed, i + 1, j), c = hash3(seed, i, j + 1), d = hash3(seed, i + 1, j + 1);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}
/* a small counter-based generator: r = rng(seed); r() -> [0,1) */
export function rng(seed) { let n = 0; return () => hash3(seed | 0, n++, 0x51ed); }
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
