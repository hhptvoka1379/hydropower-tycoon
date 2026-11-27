/* Render-side atmosphere numbers: sun and moon directions, sky/fog colours, the light rig curves. Pure JS (no THREE, no DOM).
   Everything here is render-only: it reads the game clock and never touches the sim state or its RNG.
   World frame: x east, y up, z south (same as Sim.sunAt). Colours are sRGB floats 0..1 (arrays); consumers convert to the working space.

   One continuous function of the sun's sine of elevation `s` drives the whole day: no clamp on the sun direction, no branch at the
   horizon, so the sun really sets and the moon takes over through a cross-fade (key light = sun -> moon between +0.05 and -0.10 rad). */

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const K = (s, ...hs) => [s, ...hs.map(hex)];

/* key tables keyed by sin(sun elevation) */
const ZENITH = [K(-0.30, 0x05080f), K(-0.14, 0x0a1226), K(-0.05, 0x1a3566), K(0.02, 0x3a68a8), K(0.12, 0x5f92cd), K(0.40, 0x6ea3dc)];
const HORIZON = [K(-0.30, 0x0d1424), K(-0.14, 0x16213a), K(-0.06, 0x3a4476), K(-0.01, 0xc8806c), K(0.03, 0xf0a060), K(0.12, 0xf3cf9c), K(0.30, 0xe9dfc8), K(0.70, 0xe8e2d0)];
const SUNCOL = [K(0.0, 0xff7a3c), K(0.05, 0xff9a55), K(0.15, 0xffc688), K(0.40, 0xfff0d8), K(1.0, 0xfff6e8)];
const HEMI_SKY = [K(-0.30, 0x5a70b0), K(-0.10, 0x5a70b0), K(-0.04, 0x6a78a8), K(0.0, 0x8a9cc8), K(0.12, 0x9fb4d4), K(0.40, 0xa8c8ea)];
const HEMI_GND = [K(-0.30, 0x2a3050), K(0.0, 0x3a3340), K(0.15, 0x6e6048), K(0.40, 0x6e6248)];
const HEMI_I = [[-0.30, [4.0]], [-0.10, [4.0]], [-0.04, [3.0]], [0.0, [1.8]], [0.12, [1.2]], [0.40, [1.0]]];
const MOON_RGB = hex(0x9db0e0);

/* piecewise ramps with smoothstep easing between keys */
function rampColour(table, s, out) {
  const a = table, n = 3;
  if (s <= a[0][0]) { for (let c = 0; c < n; c++) out[c] = a[0][1][c]; return; }
  const last = a[a.length - 1];
  if (s >= last[0]) { for (let c = 0; c < n; c++) out[c] = last[1][c]; return; }
  let k = 0;
  while (s > a[k + 1][0]) k++;
  const t = sstep(a[k][0], a[k + 1][0], s), p = a[k][1], q = a[k + 1][1];
  for (let c = 0; c < n; c++) out[c] = p[c] + (q[c] - p[c]) * t;
}
function rampScalar(table, s) {
  if (s <= table[0][0]) return table[0][1][0];
  const last = table[table.length - 1];
  if (s >= last[0]) return last[1][0];
  let k = 0;
  while (s > table[k + 1][0]) k++;
  const t = sstep(table[k][0], table[k + 1][0], s);
  return table[k][1][0] + (table[k + 1][1][0] - table[k][1][0]) * t;
}

/* Equatorial -> horizon frame (x east, y up, z south), as Sim.sunAt: lat in rad, dec in rad, hour angle in rad. */
export function horizonDir(lat, dec, ha, out) {
  const cd = Math.cos(dec), sd = Math.sin(dec);
  out[0] = -cd * Math.sin(ha);
  out[1] = Math.sin(lat) * sd + Math.cos(lat) * cd * Math.cos(ha);
  out[2] = -(Math.cos(lat) * sd - Math.sin(lat) * cd * Math.cos(ha));
  return out;
}

export const MOON_PERIOD = 29.53;     // days
export const MOON_PHASE0 = 0.15;      // phase of game day 0 (0 = new, 0.5 = full): a young crescent in the first evenings

/* Moon phase 0..1 from the continuous day number (day + hour/24). Render-side only. */
export function moonPhase(dayFrac) {
  const p = dayFrac / MOON_PERIOD + MOON_PHASE0;
  return p - Math.floor(p);
}

export function createAtmosphere(latDeg = 46.5) {
  const lat = latDeg * D2R;
  const out = {
    lat,
    sunDir: [0, 1, 0], moonDir: [0, -1, 0], keyDir: [0, 1, 0],
    sunSin: 1, moonSin: -1, sunElev: 0, moonElev: 0,
    phase: 0, illum: 0, moonW: 0,                   // phase 0..1, illuminated fraction, key cross-fade weight (0 sun, 1 moon)
    zenith: [0, 0, 0], horizon: [0, 0, 0], fog: [0, 0, 0], fogDensity: 0.0001,
    sunCol: [1, 1, 1], moonCol: MOON_RGB, keyCol: [1, 1, 1], keyI: 0, sunI: 0, moonI: 0,
    hemiSky: [0, 0, 0], hemiGround: [0, 0, 0], hemiI: 1,
    night: 0, lst: 0,                                // star visibility 0..1, local sidereal angle (rad)
    dusk: 0, duskCol: [1, 0.42, 0.12],
    dec: 0, ha: 0, doyF: 0, hourF: 0,
  };
  const sd = [0, 0, 0], md = [0, 0, 0];

  /* doy: day of year (0..359), hr: hour 0..24+ (fractional, may run past 24), day: whole game day, cloud/storm 0..1. */
  function update(doy, hr, day, cloud = 0, storm = 0, darken = 0) {
    const doyF = doy + hr / 24;
    const lam = TAU * (doyF - 45) / 360;                           // sun ecliptic longitude (same phase as Sim.sunAt)
    const dec = 23.44 * D2R * Math.sin(lam);
    const ha = (hr - 12) * 15 * D2R;
    horizonDir(lat, dec, ha, sd);
    out.sunDir[0] = sd[0]; out.sunDir[1] = sd[1]; out.sunDir[2] = sd[2];
    out.sunSin = sd[1];
    out.sunElev = Math.asin(Math.max(-1, Math.min(1, sd[1])));
    out.dec = dec; out.ha = ha; out.doyF = doyF; out.hourF = hr;

    // moon: ecliptic longitude = sun's + phase angle; hour angle lags the sun's by the same angle
    const ph = moonPhase(day + hr / 24);
    const pa = ph * TAU;
    const decM = Math.asin(Math.sin(23.44 * D2R) * Math.sin(lam + pa));
    horizonDir(lat, decM, ha - pa, md);
    out.moonDir[0] = md[0]; out.moonDir[1] = md[1]; out.moonDir[2] = md[2];
    out.moonSin = md[1];
    out.moonElev = Math.asin(Math.max(-1, Math.min(1, md[1])));
    out.phase = ph;
    out.illum = 0.5 - 0.5 * Math.cos(pa);
    out.lst = ha + lam;                                             // RA of the sun ~ its ecliptic longitude

    const s = sd[1];
    const cl = cloud < 0 ? 0 : cloud > 1 ? 1 : cloud;
    const dk = darken < 0 ? 0 : darken > 1 ? 1 : darken;            // storm darkening from the weather feature
    const dull = (1 - 0.6 * Math.pow(cl, 1.6)) * (1 - 0.35 * dk);    // overcast and storms cut direct light
    const stormK = storm ? 0.8 : 1;

    rampColour(ZENITH, s, out.zenith);
    rampColour(HORIZON, s, out.horizon);
    // overcast pulls the sky toward a grey of the same brightness
    const gz = (out.zenith[0] + out.zenith[1] + out.zenith[2]) / 3, gh = (out.horizon[0] + out.horizon[1] + out.horizon[2]) / 3, ck = Math.min(0.85, 0.3 * cl + 0.5 * dk);
    for (let c = 0; c < 3; c++) {
      out.zenith[c] += (gz * 0.95 - out.zenith[c]) * ck;
      out.horizon[c] += (gh * 0.98 - out.horizon[c]) * ck * 0.8;
      out.fog[c] = out.horizon[c];
    }
    out.fogDensity = 0.0001 * (1 + 0.9 * cl + 0.6 * storm + 0.8 * dk);

    // sun and moon light
    rampColour(SUNCOL, s, out.sunCol);
    out.sunI = ((s > 0 ? 3.4 * (1 - Math.exp(-9 * s)) : 0) + 1.2 * sstep(-0.07, 0.0, s)) * dull * stormK;   // a warm residue until the sun is ~4 deg down
    out.moonI = 1.15 * Math.pow(out.illum, 1.2) * sstep(0.0, 0.2, md[1]) * (1 - 0.7 * cl) * (1 - 0.35 * dk);
    const t = clamp01((0.0 - out.sunElev) / 0.17);                  // 0 rad -> -0.17 rad
    const w = t * t * (3 - 2 * t);
    out.moonW = w;
    let kx = sd[0] + (md[0] - sd[0]) * w, ky = sd[1] + (md[1] - sd[1]) * w, kz = sd[2] + (md[2] - sd[2]) * w;
    const kl = 1 / (Math.hypot(kx, ky, kz) || 1);
    out.keyDir[0] = kx * kl; out.keyDir[1] = ky * kl; out.keyDir[2] = kz * kl;
    for (let c = 0; c < 3; c++) out.keyCol[c] = out.sunCol[c] + (MOON_RGB[c] - out.sunCol[c]) * w;
    out.keyI = out.sunI * (1 - w) + out.moonI * w;

    // hemisphere fill with a night floor (never black): silhouettes, snow and the dam stay readable
    rampColour(HEMI_SKY, s, out.hemiSky);
    rampColour(HEMI_GND, s, out.hemiGround);
    out.hemiI = rampScalar(HEMI_I, s) * (1 + 0.15 * cl) * (1 - 0.35 * dk);
    out.dusk = Math.max(0, 1 - Math.abs(s - 0.0) / 0.24);
    // stars
    const tn = clamp01((-0.02 - s) / 0.14);
    out.night = tn * tn * (3 - 2 * tn) * (1 - 0.85 * cl);
    return out;
  }
  return { out, update };
}
