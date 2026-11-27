/* Reads the per-frame `env` of decisions/fable.md D9 defensively (pure JS, no THREE). The world owner may hand over numbers or small objects:
     wind   number (m/s) | { speed | v, dir | wdir }          dir = radians, the wind BLOWS TOWARD (sin dir, cos dir) in (x, z), as in the legacy renderer
     rain   number (mm/h of the sim climate, 0..~10) | { intensity }
     snow   number 0..1 snowing intensity (optional; derived from temperature and rain when absent)
   plus env.windDir | env.wdir, env.T, env.doy, env.night, env.climate (the sim climate object: wind, wdir, rain, T, storm, cloud, heat).
   Season is derived from env.doy with the same curves as the legacy renderer so every consumer agrees. */
import { clamp01, smoothstep } from './hash.js';

const TAU = Math.PI * 2;
export const RAIN_FULL = 2.5;          // mm/h that counts as full intensity (the sim's rain is (cloud-0.62)*7, storms x3.5)
export const SNOW_T = 0.5;             // Sim.CONFIG.snow.tSnow

export function createEnvReader() {
  const out = {
    wind: 3, windDir: 0,                 // m/s, radians (blow-toward = (sin, cos))
    rainMM: 0, rain: 0, snowing: 0,      // rain: 0..1 intensity, snowing: 0..1
    T: 10, storm: 0, cloud: 0, night: 0, doy: 120,
    winter: 0, autumn: 0, autumnRaw: 0, snowCover: 0, flowerFade: 0,
  };
  return function read(env, site) {
    const cl = (env && (env.climate || (env.state && env.state.climate))) || null;
    let wind, dir;
    if (env) {
      const w = env.wind;
      if (typeof w === 'number') wind = w;
      else if (w && typeof w === 'object') { wind = w.speed !== undefined ? w.speed : w.v; dir = w.dir !== undefined ? w.dir : w.wdir; }
      if (typeof dir !== 'number') dir = typeof env.windDir === 'number' ? env.windDir : env.wdir;
    }
    if (typeof wind !== 'number' && cl) wind = cl.wind;
    if (typeof dir !== 'number' && cl) dir = cl.wdir;
    out.wind = wind > 0 ? wind : 0;
    out.windDir = typeof dir === 'number' && dir === dir ? dir : 0;
    let rain = NaN;
    if (env) { const r = env.rain; rain = typeof r === 'number' ? r : (r && typeof r === 'object' ? r.intensity : NaN); }
    if (!(rain === rain) && cl) rain = cl.rain;
    out.rainMM = rain === rain && rain > 0 ? rain : 0;
    const T = env && typeof env.T === 'number' ? env.T : (cl ? cl.T : 10);
    out.T = T === T ? T : 10;
    out.storm = (cl && cl.storm) || (env && env.storm === true) ? 1 : 0;
    out.cloud = cl && cl.cloud === cl.cloud ? cl.cloud : 0;
    const wet = clamp01(out.rainMM / RAIN_FULL);
    let sn = env && typeof env.snow === 'number' ? clamp01(env.snow) : NaN;
    if (!(sn === sn)) sn = out.T < SNOW_T ? wet : 0;
    out.snowing = sn;
    out.rain = sn > 0 ? 0 : wet;
    out.night = env && typeof env.night === 'number' ? env.night : 0;
    const doy = env && typeof env.doy === 'number' ? env.doy : (cl ? cl.doy : 120);
    out.doy = doy === doy ? doy : 120;
    seasonOf(out.doy, site, out);
    return out;
  };
}

/* The legacy season curves: autumn peaks on day 225, winter on day 315 (360-day year). Writes into `o` (or a fresh object). */
export function seasonOf(doy, site, o = {}) {
  const winter = Math.max(0, -Math.sin(TAU * (doy - 45) / 360));
  const autumnRaw = Math.max(0, Math.sin(TAU * (doy - 135) / 360));
  o.winter = winter; o.autumnRaw = autumnRaw; o.autumn = autumnRaw * 0.8;
  const valley = site && site.valleySnow > 5 ? 0.3 : 0;
  o.snowCover = clamp01(winter * 1.4 - 0.2 + valley);
  o.flowerFade = clamp01(smoothstep(0.35, 0.95, autumnRaw) + winter * 2);
  return o;
}

/* Rotors face INTO the wind: front direction = opposite of the blow-toward vector. */
export function rotorYaw(windDir) { return windDir + Math.PI; }
export function rotorFront(windDir, out = { x: 0, z: 0 }) { const y = rotorYaw(windDir); out.x = Math.sin(y); out.z = Math.cos(y); return out; }
export function windVector(windDir, out = { x: 0, z: 0 }) { out.x = Math.sin(windDir); out.z = Math.cos(windDir); return out; }
/* shortest signed angle from a to b */
export function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }

/* Vegetation sway (the GLSL in scatter.js uses the same constants): tip displacement in metres for a plant of world height `h`
   in wind `w` (m/s), gust factor g (0.6..1) and oscillation phase term s (-1..1). */
export const SWAY = { lean: 0.0055, osc: 0.0022, cross: 0.35, maxWind: 28 };
export function swayTip(h, w, g = 1, s = 0) {
  const ww = Math.min(Math.max(w, 0), SWAY.maxWind);
  return h * ww * (SWAY.lean * g + SWAY.osc * s);
}
export function swayTipMin(h, w) { return swayTip(h, w, 0.6, 0); }   // calmest moment of a gust cycle, no oscillation help

/* quality knob: string or number -> density factor 0.4..1 */
export function qualityFactor(q) {
  if (typeof q === 'number') return q === q ? Math.min(1, Math.max(0.4, q <= 1.5 ? q : q / 3)) : 1;
  if (typeof q === 'string') { const s = q.toLowerCase(); if (s.startsWith('l')) return 0.5; if (s.startsWith('m')) return 0.75; return 1; }
  return 1;
}
