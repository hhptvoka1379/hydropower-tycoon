// §5.1–5.2 climate engine: seasonal table, named RNG streams, daily generation, AR(1) noise,
// rain, events, spring melt, river. Pure state-in/state-out; no DOM. Draws only from the
// `weather` and `events` streams; no player action ever consumes a draw.
import { CONFIG } from '../config.js';
import { nextFloat, mulberry32Step, deriveSeed } from '../rng.js';

const C = () => CONFIG.climate, EV = () => CONFIG.events;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Absolute day D (1, 2, …) → day of year 1..365 and season index 0..3 (§1.1)
export function dayOfYear(D) { return ((Math.max(1, D) - 1) % CONFIG.time.daysPerYear) + 1; }
export function seasonIndex(D) {
  const y = dayOfYear(D), s = CONFIG.time.seasons;
  for (let i = 0; i < s.length; i++) if (y >= s[i].first && y <= s[i].last) return i;
  return 0;
}
export const hourIndex = (D, h) => (D - 1) * 24 + h;

// §5.1 sunrise = 7 − c, sunset = 18.25 + 1.75c, c = −cos(2π(day − 46)/365)
export function sunTimes(D) {
  const c0 = C();
  const c = -Math.cos(2 * Math.PI * (dayOfYear(D) - c0.sunDayOffset) / CONFIG.time.daysPerYear);
  return { sunrise: c0.sunriseBase - c, sunset: c0.sunsetBase + c0.sunsetSlope * c };
}
// §5.1 dayFactor(h) = max(0, sin(π(h − sunrise)/(sunset − sunrise)))
export function dayFactor(h, sun) {
  const len = Math.max(1e-9, sun.sunset - sun.sunrise);
  return Math.max(0, Math.sin(Math.PI * (h - sun.sunrise) / len));
}

// §5.1 daily cloud draw: clamp(mean + 0.2(2·rng − 1), 0, 1)
function drawCloud(rng, D) {
  const mean = CONFIG.climateSeasons[seasonIndex(D)].cloud;
  return clamp(mean + C().cloudSpread * (2 * nextFloat(rng, 'weather') - 1), 0, 1);
}

// §5.2 season-start plan of heat waves (Summer) / cold snaps (Winter); events stream.
function planSeasonal(rng, D, kind) {
  const e = kind === 'heatWave' ? EV().heatWave : EV().coldSnap;
  const sIdx = kind === 'heatWave' ? 2 : 0;
  const season = CONFIG.time.seasons[sIdx];
  const yearStart = D - dayOfYear(D);                      // absolute day before day-of-year 1
  const first = yearStart + Math.max(season.first, kind === 'coldSnap' ? e.earliestDay : season.first);
  const last = yearStart + season.last;
  const gap = e.minGapDays ?? 0;
  const out = [];
  const place = () => {
    const dur = e.minDays + Math.floor(nextFloat(rng, 'events') * (e.maxDays - e.minDays + 1));
    const start = first + Math.floor(nextFloat(rng, 'events') * Math.max(1, last - dur + 2 - first));
    return { type: kind, start, end: start + dur - 1 };
  };
  out.push(place());
  if (nextFloat(rng, 'events') < e.secondProb) {
    for (let tries = 0; tries < 50; tries++) {             // bounded deterministic retry
      const c = place();
      const ok = out.every(o => c.start > o.end + gap || c.end < o.start - gap);
      if (ok) { out.push(c); break; }
    }
  }
  return out;
}

// §5.2 event state for day D (events stream). Mutates cl.events (list of {type,start,end,u2?}).
function rollEvents(rng, cl, D) {
  const y = dayOfYear(D), s = CONFIG.time.seasons;
  if (y === s[2].first || (cl.planned.heatWave !== Math.floor((D - 1) / 365) && y > s[2].first && y <= s[2].last)) {
    cl.events.push(...planSeasonal(rng, D, 'heatWave')); cl.planned.heatWave = Math.floor((D - 1) / 365);
  }
  if (cl.planned.coldSnap !== Math.floor((D - 1) / 365) && y >= s[0].first && y <= s[0].last) {
    cl.events.push(...planSeasonal(rng, D, 'coldSnap')); cl.planned.coldSnap = Math.floor((D - 1) / 365);
  }
  for (const kind of ['windstorm', 'stormRain']) {
    const active = cl.events.some(ev => ev.type === kind && ev.start <= D && ev.end >= D);
    const roll = nextFloat(rng, 'events');                  // always drawn: fixed draw order
    if (!active && roll < EV()[kind].dailyProb) {
      const e = EV()[kind];
      const dur = e.minDays + Math.floor(nextFloat(rng, 'events') * (e.maxDays - e.minDays + 1));
      const ev = { type: kind, start: D, end: D + dur - 1 };
      if (kind === 'windstorm') ev.u2 = e.uMin + (e.uMax - e.uMin) * nextFloat(rng, 'events');
      cl.events.push(ev);
    }
  }
  cl.events = cl.events.filter(ev => ev.end >= D - 2);      // drop long-finished events
}

export function eventsOn(cl, D) { return cl.events.filter(ev => ev.start <= D && ev.end >= D); }

// §5.1 generate day D. Draw order: cloud (lookahead D+1), rain roll, event state, then 24 hourly T, G, u₂, RH.
// evapFn({T, RH, u2, Rs}) → mm/day is the §3.3 Physics function, injected by the engine.
export function generateDay(state, D, evapFn) {
  const rng = state.rng, cl = state.climate, c0 = C();
  const sea = CONFIG.climateSeasons[seasonIndex(D)];
  if (cl.clouds[D] == null) cl.clouds[D] = drawCloud(rng, D);
  cl.clouds[D + 1] = drawCloud(rng, D + 1);                 // one-day lookahead (§5.1)
  const c0d = cl.clouds[D], c1d = cl.clouds[D + 1];
  // Rain roll: N = 6 + floor(13·rng) hours from a random valid start hour
  let rain = null;
  if (nextFloat(rng, 'weather') < sea.precipChance) {
    const N = c0.rainHoursMin + Math.floor(nextFloat(rng, 'weather') * c0.rainHoursSpan);
    const start = Math.floor(nextFloat(rng, 'weather') * (24 - N + 1));
    rain = { start, N, total: sea.precipMm };
  }
  rollEvents(rng, cl, D);
  const evs = eventsOn(cl, D);
  const heat = evs.some(e => e.type === 'heatWave'), cold = evs.some(e => e.type === 'coldSnap');
  const storm = evs.find(e => e.type === 'windstorm'), sRain = evs.some(e => e.type === 'stormRain');
  const sun = sunTimes(D);
  const hours = [];
  let sT = 0, sRH = 0, sU = 0, sG = 0, sP = 0;
  for (let h = 0; h < 24; h++) {
    const cloud = c0d + (c1d - c0d) * h / 24;               // linear to tomorrow's draw
    // AR(1): ε_t = α·ε_{t−1} + σ(2·rng − 1), once per game hour, carried across days
    cl.ar.T = c0.arT.alpha * cl.ar.T + c0.arT.sigma * (2 * nextFloat(rng, 'weather') - 1);
    cl.ar.u = c0.arU.alpha * cl.ar.u + c0.arU.sigma * (2 * nextFloat(rng, 'weather') - 1);
    // T(h) = T_mean + amp·sin(π(h−9)/12)(0.6 + 0.4(1 − cloud)) + ε_T
    let T = sea.T_mean + sea.amp * Math.sin(Math.PI * (h - c0.T_peakHourOffset) / 12) * (c0.T_cloudBase + c0.T_cloudClear * (1 - cloud)) + cl.ar.T;
    if (heat) T += EV().heatWave.dT;
    if (cold) T += EV().coldSnap.dT;
    const df = dayFactor(h, sun);
    // G(h) = G_max·max(0, sin(π(h − sunrise)/(sunset − sunrise)))·(1 − 0.70·cloud)
    let G = sea.G_max * df * (1 - c0.G_cloudLoss * cloud);
    if (heat) G *= EV().heatWave.Gmult;
    // u₂(h) = u_mean(1 + 0.30 cos(2πh/24)) + ε_u, clamp ≥ 0
    let u2 = Math.max(0, sea.u_mean * (1 + c0.u_diurnal * Math.cos(2 * Math.PI * h / 24)) + cl.ar.u);
    if (storm) u2 = storm.u2;
    // RH(h) = 0.55 + 0.25 sin(2π(h+2)/24) − 0.30·cloud·dayFactor, clamp [0.15, 0.95]
    const RH = clamp(c0.RH_mean + c0.RH_amp * Math.sin(2 * Math.PI * (h + c0.RH_phase) / 24) - c0.RH_cloud * cloud * df, c0.RH_min, c0.RH_max);
    // Rain: P_rain = total·24/N (mm/day-equivalent) during the rain hours
    let P_rain = (rain && h >= rain.start && h < rain.start + rain.N) ? rain.total * 24 / rain.N : 0;
    if (sRain) P_rain = Math.max(P_rain, EV().stormRain.mmPerDay);
    const snow = P_rain > 0 && T < c0.snowBelowC;
    hours.push({ T, G, u2, RH, cloud, P_rain, snow });
    sT += T; sRH += RH; sU += u2; sG += G; sP += P_rain / 24;
  }
  const mean = { T: sT / 24, RH: sRH / 24, u2: sU / 24, Rs: sG / 24, precipMm: sP };
  // §5.2 ice cover: E = 0 when T̄ < 0 °C; otherwise the §3.3 Penman value (no event multiplier)
  let E = 0;
  if (mean.T >= 0 && typeof evapFn === 'function') {
    const v = evapFn(mean);
    E = Number.isFinite(v) ? Math.max(0, v) : 0;
  }
  const rec = { day: D, cloud: c0d, rain, sunrise: sun.sunrise, sunset: sun.sunset, events: evs.map(e => e.type), hours, mean, E, ice: mean.T < 0 };
  cl.days.push(rec);
  cl.days.sort((a, b) => a.day - b.day);
  while (cl.days.length > 4) cl.days.shift();
  for (const k of Object.keys(cl.clouds)) if (+k < D - 1) delete cl.clouds[k];
  return rec;
}

// Prepare state.climate and generate days 1 and 2 (§5.1). priceDayFn = market.priceDay, injected.
export function initClimate(state, evapFn, priceDayFn) {
  const cl = state.climate;
  cl.days = []; cl.activeEvents = []; cl.current = {};
  cl.ar = { T: 0, u: 0 };          // ε_0 = 0
  cl.clouds = {};
  cl.events = [];
  cl.planned = { heatWave: -1, coldSnap: -1 };
  cl.snowpack = { stored: 0, releaseRate: 0, releaseDay: 0 };   // m³, m³/s, day
  const D = state.clock.day;
  for (const d of [D, D + 1]) { const r = generateDay(state, d, evapFn); if (priceDayFn) priceDayFn(state, r); }
  updateHour(state);
  return state;
}

// Day boundary (00:00 of day D starts): generate D+1 so two days always exist.
export function dayBoundary(state, evapFn, priceDayFn) {
  const r = generateDay(state, state.clock.day + 1, evapFn);
  if (priceDayFn) priceDayFn(state, r);
  return r;
}

export function dayRecord(state, D) { return state.climate.days.find(d => d.day === D) || null; }

// §5.2 spring melt into the lower reservoir: Q = 0.25·max(0, 1 − |t − 96.5|/4.5), t = day + hour/24  [m³/s]
export function qMelt(D, hour) {
  const m = CONFIG.springMelt;
  const t = dayOfYear(D) + hour / 24;
  if (t < m.firstDay || t > m.lastDay + 1) return 0;
  return m.peakQ * Math.max(0, 1 - Math.abs(t - m.center) / m.halfWidth);
}

// §5.2 river base Q_base·s_season (Classic site 0, procedural default 0.15 or site.terrain.Q_base)
export function riverBase(site, D) {
  const r = CONFIG.river;
  const Qb = site && site.kind === 'classic' ? r.Q_baseClassic : (site && site.terrain && Number.isFinite(site.terrain.Q_base) ? site.terrain.Q_base : r.Q_baseProcedural);
  return Qb * r.sSeason[seasonIndex(D)];
}
// §5.2 Q_river,rain = 0.25·(P_rain/1000)·A_basin/86400, doubled by storm rain  [m³/s]
export function riverRain(P_rain, stormRain, A_basin = CONFIG.river.A_basin) {
  const q = CONFIG.river.runoffCoef * (Math.max(0, P_rain) / 1000) * A_basin / 86400;
  return stormRain ? q * EV().stormRain.runoffMult : q;
}

// §5.2 blade damage of a turbine on a storm day: 2% per turbine per day. Uses a hash of
// (seed, day, turbine id) so it never consumes a stream draw (player layouts cannot shift replays).
export function bladeDamaged(seed, D, turbineId) {
  const s = deriveSeed((seed ^ Math.imul(D, 0x9E3779B1)) >>> 0, 'blade' + turbineId);
  return mulberry32Step(s)[1] < EV().windstorm.bladeDamageProb;
}

// Hour boundary: publish the current hour's climate into state.climate.current, including river and
// melt inflows and snowpack hold/release (§5.2). Sites use current.Q_river[siteIndex].
export function updateHour(state) {
  const cl = state.climate, D = state.clock.day, h = state.clock.hour;
  const rec = dayRecord(state, D);
  if (!rec) return state;
  const x = rec.hours[h];
  const evs = eventsOn(cl, D);
  cl.activeEvents = evs.map(e => ({ type: e.type, start: e.start, end: e.end }));
  const cold = evs.some(e => e.type === 'coldSnap');
  const sRain = evs.some(e => e.type === 'stormRain');
  const sp = cl.snowpack;
  // Snowpack release: evenly over the first day with T̄ > 2 °C
  if (h === 0 || sp.releaseDay !== D) {
    if (!cold && rec.mean.T > EV().coldSnap.meltAboveC && sp.stored > 0 && sp.releaseDay !== D) {
      sp.releaseRate = sp.stored / 86400; sp.stored = 0; sp.releaseDay = D;
    } else if (sp.releaseDay !== D) sp.releaseRate = 0;
  }
  const holdFrac = cold ? EV().coldSnap.snowpackFrac : 0;    // engine applies the same hold to valley runoff
  const Q_river = state.sites.map(site => {
    let qr = riverRain(x.P_rain, sRain);
    if (holdFrac > 0) { sp.stored += holdFrac * qr * 3600; qr *= 1 - holdFrac; }
    return riverBase(site, D) + qr + sp.releaseRate;
  });
  cl.current = {
    day: D, hour: h, hourIndex: hourIndex(D, h),
    T: x.T, G: x.G, u2: x.u2, RH: x.RH, cloud: x.cloud, P_rain: x.P_rain, snow: x.snow,
    E: rec.E, ice: rec.ice, sunrise: rec.sunrise, sunset: rec.sunset,
    Q_river, Q_melt: qMelt(D, h), snowHoldFrac: holdFrac, stormRunoffMult: sRain ? EV().stormRain.runoffMult : 1,
  };
  return state;
}
