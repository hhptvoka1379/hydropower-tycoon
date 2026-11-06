// mulberry32 PRNG and named, serializable streams (§0.7, §11.1). No DOM access.

export const STREAM_NAMES = Object.freeze(['weather', 'market', 'events', 'terrain']);

// mulberry32: one step on a uint32 state. Returns [nextState, valueIn[0,1)].
export function mulberry32Step(s) {
  const next = (s + 0x6D2B79F5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

// Derive a uint32 sub-seed from a seed and a stream name (FNV-1a over the name, mixed with seed).
export function deriveSeed(seed, name) {
  let h = 0x811C9DC5 ^ (seed >>> 0);
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // one mulberry32 scramble so nearby seeds diverge
  return Math.floor(mulberry32Step(h)[1] * 4294967296) >>> 0;
}

// Serializable RNG state object stored in state.rng: { weather: uint32, market: ..., ... }
export function createRngState(seed) {
  const out = {};
  for (const n of STREAM_NAMES) out[n] = deriveSeed(seed, n);
  return out;
}

// Draw a uniform [0,1) from a named stream, mutating rngState in place.
export function nextFloat(rngState, stream) {
  if (!(stream in rngState)) throw new Error('unknown rng stream: ' + stream);
  const [s, v] = mulberry32Step(rngState[stream]);
  rngState[stream] = s;
  return v;
}

export function nextRange(rngState, stream, lo, hi) {
  return lo + (hi - lo) * nextFloat(rngState, stream);
}

export function nextInt(rngState, stream, lo, hiInclusive) {
  return lo + Math.floor(nextFloat(rngState, stream) * (hiInclusive - lo + 1));
}

// Standalone generator (e.g. cosmetic RNG, §0.7) that never touches simulation state.
export function makeGenerator(seed) {
  let s = seed >>> 0;
  return () => { const r = mulberry32Step(s); s = r[0]; return r[1]; };
}
