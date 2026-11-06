// createInitialState(seed): the simulation state schema (§11.2, §0.1). SI units.
// Top-level keys are fixed; nobody adds or renames one. No DOM / window access.
import { CONFIG } from './config.js';
import { createRngState } from './rng.js';

export const SAVE_VERSION = 1;

export const STATE_KEYS = Object.freeze([
  'version', 'seed', 'clock', 'rng', 'climate', 'market', 'sites',
  'finance', 'services', 'automation', 'quests', 'alerts', 'stats',
]);

// ---- Frustum reservoir geometry (§3.1 as fixed by the §8.5/§8.7/Test 11 numbers) ----
// Square-based frustum: side b = sqrt(A_bot), side at depth d = b + 2·s·d.
// A(d) = (b + 2 s d)², V(d) = A_bot·d + 2 b s d² + (4/3) s² d³.
export function frustumArea(A_bot, s, d) {
  const w = Math.sqrt(Math.max(A_bot, 0)) + 2 * s * d;
  return w * w;
}
export function frustumVolume(A_bot, s, d) {
  const b = Math.sqrt(Math.max(A_bot, 0));
  return A_bot * d + 2 * b * s * d * d + (4 / 3) * s * s * d * d * d;
}
// Newton inversion V(d) = V with V'(d) = A(d) (§3); bracketed to [0, D_max].
export function frustumDepth(A_bot, s, D_max, V) {
  const Vmax = frustumVolume(A_bot, s, D_max);
  if (V <= 0) return 0;
  if (V >= Vmax) return D_max;
  let d = D_max * V / Vmax;
  for (let i = 0; i < 50; i++) {
    const A = frustumArea(A_bot, s, d);
    const step = A > 0 ? (frustumVolume(A_bot, s, d) - V) / A : 0;
    d = Math.min(D_max, Math.max(0, d - step));
    if (Math.abs(step) < 1e-12) break;
  }
  return d;
}

function makeReservoir(geo, z_floor, fill) {
  const V_max = frustumVolume(geo.A_bot, geo.s, geo.D_max);
  const V = fill * V_max;
  const d = frustumDepth(geo.A_bot, geo.s, geo.D_max, V);
  return {
    A_bot: geo.A_bot,     // m²
    s: geo.s,             // side slope, horizontal per vertical
    D_max: geo.D_max,     // m
    z_floor,              // m
    V_max,                // m³
    V,                    // m³
    d,                    // m
    z: z_floor + d,       // m
    excavationStages: 0,
  };
}

function makeUnit(kind, tier, id) {
  return {
    id, kind, tier,
    targetPct: 0,         // commanded opening 0..1
    openPct: 0,           // actual opening 0..1
    Q: 0,                 // m³/s
    P: 0,                 // W
    wear: 0,              // 0..1
    running: false,
  };
}

function makeClassicSite() {
  const st = CONFIG.start;
  const lower = makeReservoir(st.lower, st.lower.z_floor, st.startFill);
  // §3.1/§8.3: z_upper_floor derived so H_g = grossHead exactly at startFill (never hard-coded)
  const V_up = st.startFill * frustumVolume(st.upper.A_bot, st.upper.s, st.upper.D_max);
  const d_up = frustumDepth(st.upper.A_bot, st.upper.s, st.upper.D_max, V_up);
  const z_upper_floor = lower.z + st.grossHead - d_up;
  const upper = makeReservoir(st.upper, z_upper_floor, st.startFill);
  let uid = 1;
  return {
    id: 0,
    kind: 'classic',
    terrain: null,        // procedural canyon params (§8.3) — null at Classic site
    z_upper_floor,        // m, reused by §8.3
    reservoirs: { upper, lower },
    dam: { class: 'gravity', H_gross: st.grossHead, building: null, station: null, H_dam: null },
    penstock: { ...st.penstock, epsilon: CONFIG.penstock.roughness[st.penstock.material] },
    turbines: st.turbineTiers.map(t => makeUnit('turbine', t, uid++)),
    pumps: st.pumpTiers.map(t => makeUnit('pump', t, uid++)),
    parcels: st.ownedParcels.map(n => ({ id: n, owned: true })),
    arrays: [{ id: 1, tier: st.solar.tier, modules: st.solar.modules, parcel: st.solar.parcel,
      f_soil: st.solar.f_soil, cleaning: null, P: 0 }],
    windTurbines: st.wind.map((t, i) => ({ id: i + 1, tier: t, P: 0, wear: 0 })),
    batteries: [],
    jobs: [],             // construction jobs (dam raise, excavation, cleaning)
  };
}

export function createInitialState(seed) {
  const s = (Number(seed) >>> 0);
  return {
    version: SAVE_VERSION,
    seed: s,
    clock: { tick: 0, day: CONFIG.time.startDay, hour: CONFIG.time.startHour,
      secondsIntoHour: 0, speedIndex: 0, paused: false, mode: 'realtime' },
    rng: createRngState(s),
    climate: { days: [], activeEvents: [], current: {} },
    market: { prices: [], forecastErrors: [], emergency: null, priceNow: 0 },
    sites: [makeClassicSite()],
    finance: {
      cash: CONFIG.start.cash,  // $
      loans: [], emergencyLoan: null, contract: null,
      hourly: { E_sold: 0, E_bought: 0 },          // MWh (§1.2)
      lifetime: { E_gen: 0, E_pump: 0, revenue: 0, costs: 0 }, // MWh gross, $ (§1.2, §7.5)
    },
    services: { offers: [], activeCall: null, reliability: 1 },
    automation: { rules: [] },
    quests: { active: [], completed: [], claimed: [] },
    alerts: [],
    stats: { P_net: 0, history: [] },
  };
}

export function createDefaultSettings() {
  return { theme: 'default', artStyle: 'default', quality: 'auto', sound: true };
}
