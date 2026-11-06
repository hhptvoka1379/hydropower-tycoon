// §8 Construction and equipment (Classic site): price list × CAPEX_SCALE, Classic dam raise, excavation stages,
// solar soiling and cleaning, repair jobs, job timers. Pure; no DOM. Money in $, volumes m³, time in game days/seconds.
// Job schema in site.jobs: {type:'raise'|'excavate'|'clean'|'repair', secondsLeft, ...}. Repair jobs are {type:'repair', unitId} (Physics hand-off).
import { CONFIG } from '../config.js';
import { frustumVolume, frustumDepth } from '../state.js';
import { repairCost, repairHours } from './wear.js';
import { finishProceduralRaise } from './canyon.js';

const SCALE = () => CONFIG.CAPEX_SCALE;
const DAY = 86400;   // s per game day

// ---------------------------------------------------------------- §8.1 prices: charged = base × CAPEX_SCALE
export function charged(base) { return base * SCALE(); }
export const pumpPrice = tier => charged(CONFIG.pumps[tier].basePrice);
export const turbinePrice = tier => charged(CONFIG.turbines[tier].basePrice);
export const windPrice = tier => charged(CONFIG.windBasePrice[tier]);
export const solarPrice = tier => charged(CONFIG.solarBasePrice[tier]);
export const parcelPrice = n => charged(CONFIG.landParcelBasePrice[n]);
// Penstock: per-metre price by diameter, concrete −15% cost (§8.1). Replacing charges the full new price, no refund.
export function penstockPrice(D, L, material = 'steel') {
  const i = CONFIG.penstock.diameters.indexOf(D);
  if (i < 0) throw new Error('unknown penstock diameter ' + D);
  const f = material === 'concrete' ? CONFIG.penstock.concreteCostFactor : 1;
  return charged(CONFIG.penstock.basePricePerM[i] * L * f);
}
// Purchase price of the equipment the player owns (credit limit §7.3): machines, arrays, wind turbines and penstocks.
export function ownedEquipmentPrice(state) {
  let p = 0;
  for (const s of state.sites) {
    for (const u of s.turbines) p += turbinePrice(u.tier);
    for (const u of s.pumps) p += pumpPrice(u.tier);
    for (const w of s.windTurbines) p += windPrice(w.tier);
    for (const a of s.arrays) p += solarPrice(a.tier);
    p += penstockPrice(s.penstock.D, s.penstock.L, s.penstock.material);
  }
  return p;
}

// ---------------------------------------------------------------- §8.2 Classic dam raise
// Cost_raise = C_dam·(H_new² − H_old²) with C_dam charged = 800 × CAPEX_SCALE = $32/m²; Days = 2 + ΔH/5
export function classicRaiseCost(Hold, Hnew) { return charged(CONFIG.dam.C_dam) * (Hnew * Hnew - Hold * Hold); }
export function classicRaiseDays(Hold, Hnew) { return CONFIG.dam.raiseDaysBase + (Hnew - Hold) * CONFIG.dam.raiseDaysPerM; }
// Plan a raise of the Classic site to gross head Hnew: cost, days, ΔV_max of the upper reservoir (D_max grows by ΔH).
export function classicRaisePlan(site, Hnew) {
  const up = site.reservoirs.upper, Hold = site.dam.H_gross;
  const limit = CONFIG.dam.classMaxGrossHead[site.dam.class];
  if (!(Hnew > Hold)) return { ok: false, reason: 'new head must exceed the current head' };
  if (Hnew > limit) return { ok: false, reason: 'exceeds the ' + site.dam.class + ' class limit of ' + limit + ' m' };
  const dH = Hnew - Hold;
  const Vmax1 = frustumVolume(up.A_bot, up.s, up.D_max + dH);
  return { ok: true, Hold, Hnew, dH, cost: classicRaiseCost(Hold, Hnew), days: classicRaiseDays(Hold, Hnew), VmaxNew: Vmax1, dVmax: Vmax1 - up.V_max };
}
// Start the raise: cash is charged by the caller (engine validates budget); the reservoir keeps working during the build.
export function startClassicRaise(site, Hnew) {
  const plan = classicRaisePlan(site, Hnew);
  if (!plan.ok) return plan;
  if (site.dam.building) return { ok: false, reason: 'dam already under construction' };
  const job = { type: 'raise', fromH: plan.Hold, toH: Hnew, dH: plan.dH, cost: plan.cost, secondsLeft: plan.days * DAY };
  site.jobs.push(job);
  site.dam.building = { toH: Hnew };
  return { ok: true, job, plan };
}
function finishClassicRaise(site, job) {
  const up = site.reservoirs.upper;
  up.D_max += job.dH;                                          // A raise increases D_max by ΔH (§8.2)
  up.V_max = frustumVolume(up.A_bot, up.s, up.D_max);
  up.d = frustumDepth(up.A_bot, up.s, up.D_max, up.V);
  up.z = up.z_floor + up.d;
  site.dam.H_gross = job.toH;
  site.dam.building = null;
}

// ---------------------------------------------------------------- §8.5 excavation (lower reservoir, and upper at Classic site)
// Stage adds 5,000 m² to A_bot; ΔV_max exact; Cost = 0.12·ΔV + 800 (charged); Days = max(2, ceil(ΔV/50,000)). Slope unchanged.
export function excavationPlan(res) {
  const ex = CONFIG.excavation;
  if (res.table) return { ok: false, reason: 'tabulated reservoirs cannot be excavated' };
  if ((res.excavationStages || 0) >= ex.stages) return { ok: false, reason: 'all ' + ex.stages + ' stages done' };
  const A1 = res.A_bot + ex.stageAddAbot;
  const dV = frustumVolume(A1, res.s, res.D_max) - frustumVolume(res.A_bot, res.s, res.D_max);
  return {
    ok: true, dVmax: dV, A_bot: A1,
    cost: charged(ex.basePricePerM3) * dV + charged(ex.baseMobilization),
    days: Math.max(ex.minDays, Math.ceil(dV / ex.m3PerDay)),
  };
}
export function startExcavation(site, which) {
  const res = site.reservoirs[which];
  if (!res) return { ok: false, reason: 'no such reservoir' };
  if (site.jobs.some(j => j.type === 'excavate' && j.which === which)) return { ok: false, reason: 'excavation already under way' };
  const plan = excavationPlan(res);
  if (!plan.ok) return plan;
  const job = { type: 'excavate', which, cost: plan.cost, dVmax: plan.dVmax, secondsLeft: plan.days * DAY };
  site.jobs.push(job);
  return { ok: true, job, plan };
}
function finishExcavation(site, job) {
  const r = site.reservoirs[job.which];
  r.A_bot += CONFIG.excavation.stageAddAbot;
  r.V_max = frustumVolume(r.A_bot, r.s, r.D_max);
  r.d = frustumDepth(r.A_bot, r.s, r.D_max, r.V);
  r.z = r.z_floor + r.d;
  r.excavationStages = (r.excavationStages || 0) + 1;
}

// ---------------------------------------------------------------- §8.6 soiling and cleaning
// Daily update: a rain day (≥ 5 mm) raises f_soil by 0.02 up to the 0.95 cap (a value already above the cap stays);
// a dry day loses 0.0006; f_soil never drops below 0.55 (§8.6, Test 16).
export function soilingDay(f, rainMm) {
  const S = CONFIG.soiling;
  if (rainMm >= S.rainThresholdMm) return Math.min(S.max, Math.max(f, Math.min(f + S.rainGain, S.rainCap)));
  return Math.max(S.min, f - S.dailyLoss);
}
export function soilingDayAll(site, rainMm) { for (const a of site.arrays) a.f_soil = soilingDay(a.f_soil, rainMm); }
// A cleaning job adds 0.15 to f_soil up to 1.00
export function cleaned(f) { return Math.min(CONFIG.soiling.max, f + CONFIG.soiling.cleanGain); }
// Price: $0.80 per kW of STC power, NOT CAPEX_SCALE-scaled (Test 16: 0.80·535 = $428; §8.6 states the charged price directly)
export function cleanCost(P_stc_kW) { return CONFIG.soiling.cleanCostPerKW * P_stc_kW; }
export function arrayStcKW(arr) { return arr.modules * CONFIG.solar.A_panel * CONFIG.solar.etaPanel[arr.tier]; }   // 1000 W/m² STC → kW
export function startCleaning(site, arrayId) {
  const arr = site.arrays.find(a => a.id === arrayId);
  if (!arr) return { ok: false, reason: 'no such array' };
  if (arr.cleaning) return { ok: false, reason: 'already being cleaned' };
  const cost = cleanCost(arrayStcKW(arr));
  const job = { type: 'clean', arrayId, cost, secondsLeft: CONFIG.soiling.cleanDays * DAY };
  site.jobs.push(job);
  arr.cleaning = true;   // the array keeps producing during the job
  return { ok: true, job, cost };
}

// ---------------------------------------------------------------- §4.4 repair jobs (shape fixed by Physics: {type:'repair', unitId})
export function startRepair(site, unit) {
  const health = 100 * (1 - unit.wear);
  const base = unit.kind === 'pump' ? CONFIG.pumps[unit.tier].basePrice : CONFIG.turbines[unit.tier].basePrice;
  const cost = repairCost(health, charged(base));
  if (site.jobs.some(j => j.type === 'repair' && j.unitId === unit.id)) return { ok: false, reason: 'repair already under way' };
  const job = { type: 'repair', unitId: unit.id, cost, secondsLeft: repairHours(health) * 3600 };
  site.jobs.push(job);
  return { ok: true, job, cost };
}

// ---------------------------------------------------------------- job timers
// Advance every job by dt seconds; apply the effect of finished raise, excavation, cleaning and repair jobs and return them.
// Procedural raises are jobs of type 'raise' with procedural:true, finished by canyon.finishProceduralRaise.
export function advanceJobs(site, dt) {
  const done = [];
  for (let i = site.jobs.length - 1; i >= 0; i--) {
    const j = site.jobs[i];
    j.secondsLeft -= dt;
    if (j.secondsLeft > 1e-9) continue;
    site.jobs.splice(i, 1);
    if (j.type === 'raise') {
      if (j.procedural) finishProceduralRaise(site, j); else finishClassicRaise(site, j);
    } else if (j.type === 'excavate') finishExcavation(site, j);
    else if (j.type === 'clean') {
      const a = site.arrays.find(x => x.id === j.arrayId);
      if (a) { a.f_soil = cleaned(a.f_soil); a.cleaning = null; }
    } else if (j.type === 'repair') {
      const u = [...site.turbines, ...site.pumps].find(x => x.id === j.unitId);
      if (u) u.wear = 0;
    }
    done.push(j);
  }
  return done.reverse();
}
