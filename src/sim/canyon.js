// §8.3 / §8.4 Procedural canyon: value-noise terrain from the `terrain` stream, A(d) table, dam concrete integral,
// raise cost, the three dam solvers, siting preview, generator with validity retries. Pure; no DOM.
// Units: x, W, s, h in m; areas m²; volumes m³; money $ (charged = base × CAPEX_SCALE, concrete $12/m³).
import { CONFIG } from '../config.js';
import { nextFloat, makeGenerator } from '../rng.js';
import { buildTable, dFromV } from './reservoirs.js';

const CN = () => CONFIG.canyon;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- 1-D value noise
// One lattice per wavelength, values uniform in [−1,1] from a generator seeded by the sub-seed drawn from the terrain stream.
const latticeCache = new Map();
function lattice(subSeed, octaveKey, n) {
  const key = subSeed + ':' + octaveKey + ':' + n;
  let L = latticeCache.get(key);
  if (!L) {
    const g = makeGenerator((subSeed ^ Math.imul(octaveKey + 1, 0x9E3779B1)) >>> 0);
    L = new Float64Array(n);
    for (let i = 0; i < n; i++) L[i] = 2 * g() - 1;
    if (latticeCache.size > 64) latticeCache.clear();
    latticeCache.set(key, L);
  }
  return L;
}
// Smooth value noise at wavelength lam: smoothstep interpolation between lattice values.
function valueNoise(subSeed, octaveKey, lam, x) {
  const n = Math.ceil(CN().length / lam) + 2;
  const L = lattice(subSeed, octaveKey, n);
  const u = Math.max(0, x) / lam, i = Math.floor(u), t = u - i;
  const w = t * t * (3 - 2 * t);
  return L[i % n] * (1 - w) + L[(i + 1) % n] * w;
}
// Weighted sum normalised by Σ weights, so the result lies in [−1,1] (§8.3).
function fbm(subSeed, base, spec, x) {
  let s = 0, wsum = 0;
  for (let k = 0; k < spec.wavelengths.length; k++) {
    s += spec.weights[k] * valueNoise(subSeed, base + k, spec.wavelengths[k], x);
    wsum += spec.weights[k];
  }
  return s / wsum;
}
export const Nw = (t, x) => fbm(t.subSeed, 0, CN().Nw, x);    // wavelengths 400, 150, 50 m, weights 1, 0.5, 0.25
export const Ns = (t, x) => fbm(t.subSeed, 10, CN().Ns, x);   // wavelengths 300, 100 m, weights 1, 0.5

// Terrain parameter record (stored as site.terrain); the terrain bias menu edits W0, a_w, s0, a_s, S0 (§8.3).
export function makeTerrain(subSeed, overrides = {}) {
  const c = CN();
  return { subSeed, W0: c.W0, a_w: c.a_w, s0: c.s0, a_s: c.a_s, S0: c.S0, ...overrides };
}
// W_bot(x) = clamp(W0(1 + a_w N_w(x)), 12, 200)   s(x) = clamp(s0 + a_s N_s(x), 0.35, 1.5)
export function Wbot(t, x) { const c = CN(); return clamp(t.W0 * (1 + t.a_w * Nw(t, x)), c.Wbot_min, c.Wbot_max); }
export function slope(t, x) { const c = CN(); return clamp(t.s0 + t.a_s * Ns(t, x), c.s_min, c.s_max); }
// z_bed(x) = z_upper_floor + S0 (x − x_dam)
export function zBed(t, zUpperFloor, xDam, x) { return zUpperFloor + t.S0 * (x - xDam); }

// ---------------------------------------------------------------- A(d) and tables
// A(d) = ∫ from x_dam (W_bot + 2 s h) dx, h(x) = d − S0 (x − x_dam), counted only where h > 0; midpoint rule with step dx.
export function areaAtDepth(t, xDam, d, dx = CN().dx) {
  if (!(d > 0)) return 0;
  const reach = d / t.S0;                       // x_back − x_dam where h reaches 0
  const n = Math.ceil(Math.min(reach, CN().length) / dx);
  let A = 0;
  for (let i = 0; i < n; i++) {
    const xm = xDam + (i + 0.5) * dx;
    const h = d - t.S0 * (xm - xDam);
    if (h > 0) A += (Wbot(t, xm) + 2 * slope(t, xm) * h) * dx;
  }
  return A;
}
// Table of A at d = 0, step, 2·step … up to the dam height, in the §3.1 form {h, A[], V[]} (A linear per step, V piecewise quadratic).
export function buildCanyonTable(t, xDam, Hdam, fine = true) {
  const c = CN();
  const dx = fine ? c.dx : c.previewDx, step = fine ? c.depthStep : c.previewDepthStep;
  return buildTable(d => areaAtDepth(t, xDam, d, dx), Hdam, step);
}
export function tableVmax(table) { return table.V[table.V.length - 1]; }
export function vmaxAt(t, xDam, H, fine = true) { return tableVmax(buildCanyonTable(t, xDam, H, fine)); }

// ---------------------------------------------------------------- dam concrete and cost
// V_conc(H) = ∫0^H (W_bot(x_dam) + 2 s(x_dam) y)(t_crest + k_batter (H − y)) dy, 100 midpoint steps (§8.4)
export function concreteVolume(Wb, s, H, cls) {
  const prof = CONFIG.dam.profile[cls], N = CONFIG.dam.concreteIntegralSteps;
  const dy = H / N;
  let V = 0;
  for (let i = 0; i < N; i++) {
    const y = (i + 0.5) * dy;
    V += (Wb + 2 * s * y) * (prof.t_crest + prof.k_batter * (H - y)) * dy;
  }
  return V;
}
export function concretePricePerM3() { return CONFIG.dam.concreteBasePricePerM3 * CONFIG.CAPEX_SCALE; }   // $300 × 0.04 = $12
// Cost_dam(H) = 12·V_conc(H)
export function damCost(Wb, s, H, cls) { return concretePricePerM3() * concreteVolume(Wb, s, H, cls); }
export function damCostAt(t, xDam, H, cls) { return damCost(Wbot(t, xDam), slope(t, xDam), H, cls); }
// Raising from H_cur to H pays Cost_dam(H) − Cost_dam(H_cur), takes 2 + (H − H_cur)/5 days (§8.4)
export function raiseCost(Wb, s, Hcur, H, cls) { return damCost(Wb, s, H, cls) - damCost(Wb, s, Hcur, cls); }
export function raiseDays(Hcur, H) { return CONFIG.dam.raiseDaysBase + (H - Hcur) * CONFIG.dam.raiseDaysPerM; }
export function classLimit(cls) { return CONFIG.dam.classMaxHdam[cls]; }

// ---------------------------------------------------------------- solvers (§8.4)
// (2) Max volume for budget B: H* = max{H integer, H_cur ≤ H ≤ class limit : raise cost ≤ B}. Cost is strictly increasing in H, so bisection.
export function solveMaxHeightForBudget(Wb, s, Hcur, cls, B) {
  const lim = classLimit(cls);
  if (Hcur >= lim) return { H: Hcur, cost: 0 };
  let lo = Hcur, hi = lim;                       // invariant: cost(lo) ≤ B
  if (raiseCost(Wb, s, Hcur, hi, cls) <= B) lo = hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (raiseCost(Wb, s, Hcur, mid, cls) <= B) lo = mid; else hi = mid;
  }
  return { H: lo, cost: raiseCost(Wb, s, Hcur, lo, cls) };
}
// Usable net energy of a dam of height H (MWh): limited by the smaller reservoir, min(V_upper, V_lower,max) (§8.4).
// E = ρ g V H_g η_t / 3.6e9 with H_g ≈ 40 m + H_dam (§8.4).
export function usableEnergy(Vupper, VlowerMax, H, eta_t, grossHead) {
  const Hg = grossHead ? grossHead(H) : CONFIG.siting.grossHeadBase + H;
  const V = Math.min(Vupper, VlowerMax);
  return CONFIG.physics.rho * CONFIG.physics.g * V * Hg * eta_t / 3.6e9;
}
// (3) Target storage E: the smallest integer H in [H_cur, limit] whose usable net energy ≥ E; null if the class cannot reach it.
export function solveHeightForEnergy(ctx, Hcur, cls, E) {
  const { t, xDam, VlowerMax, eta_t, grossHead } = ctx;
  for (let H = Hcur; H <= classLimit(cls); H++) {
    const Vup = vmaxAt(t, xDam, H);
    if (usableEnergy(Vup, VlowerMax, H, eta_t, grossHead) >= E) {
      return { H, cost: raiseCost(Wbot(t, xDam), slope(t, xDam), Hcur, H, cls), Vupper: Vup, lowerIsBottleneck: Vup > VlowerMax };
    }
  }
  return null;
}
// (1) Manual slider panel: price, V_max and stored energy at an integer height, with the lower-reservoir bottleneck warning.
export function sliderInfo(ctx, Hcur, cls, H) {
  const { t, xDam, VlowerMax, eta_t, grossHead } = ctx;
  const Vup = vmaxAt(t, xDam, H);
  return {
    H, cost: raiseCost(Wbot(t, xDam), slope(t, xDam), Hcur, H, cls), days: raiseDays(Hcur, H),
    Vmax: Vup, energy: usableEnergy(Vup, VlowerMax, H, eta_t, grossHead), lowerIsBottleneck: Vup > VlowerMax,
  };
}

// ---------------------------------------------------------------- siting and generation
// Narrowest W_bot between x = 100 and 600 m is the default station (§8.4).
export function defaultStation(t) {
  const [a, b] = CN().defaultStationRange;
  let best = a, bw = Infinity;
  for (let x = a; x <= b; x += CONFIG.siting.stationScanStep) { const w = Wbot(t, x); if (w < bw) { bw = w; best = x; } }
  return best;
}
// Siting panel numbers at a station: V_max of the free H0 = 10 m dam, plus price and volume of a 20 m and a 30 m dam.
export function sitingPanel(t, xDam, cls = 'gravity', fine = false) {
  const H0 = CONFIG.dam.proceduralStartH0, Wb = Wbot(t, xDam), s = slope(t, xDam);
  return {
    xDam, Vmax0: vmaxAt(t, xDam, H0, fine),
    options: CONFIG.siting.previewHeights.map(H => ({
      H, Vmax: vmaxAt(t, xDam, H, fine), concreteCost: damCost(Wb, s, H, cls), raiseCost: raiseCost(Wb, s, H0, H, cls),
    })),
  };
}
// Draw sub-seeds from the `terrain` stream; accept a canyon whose V_max(H0) at the default station is within
// [150,000, 300,000] m³; up to 50 retries, then null (fall back to the Classic site). Returns {terrain, xDam, Vmax0, attempts} or null.
export function generateCanyon(rng, overrides = {}) {
  const c = CN();
  for (let k = 0; k < c.maxRetries; k++) {
    const subSeed = Math.floor(nextFloat(rng, 'terrain') * 4294967296) >>> 0;
    const t = makeTerrain(subSeed, overrides);
    const xDam = defaultStation(t);
    const Vmax0 = vmaxAt(t, xDam, CONFIG.dam.proceduralStartH0, true);
    if (Vmax0 >= c.VmaxValid[0] && Vmax0 <= c.VmaxValid[1]) return { terrain: t, xDam, Vmax0, attempts: k + 1 };
  }
  return null;
}

// ---------------------------------------------------------------- site integration
// Replace the upper reservoir of a site by the tabulated canyon reservoir (the lower stays the §3.1 frustum), free H0 = 10 m dam.
export function applyCanyonToSite(site, terrain, xDam) {
  const H0 = CONFIG.dam.proceduralStartH0;
  const table = buildCanyonTable(terrain, xDam, H0, true);
  const old = site.reservoirs.upper;
  const up = {
    A_bot: table.A[0], s: slope(terrain, xDam), D_max: H0, z_floor: site.z_upper_floor,
    V_max: tableVmax(table), V: 0, d: 0, z: site.z_upper_floor, excavationStages: 0, table,
  };
  up.V = CONFIG.start.startFill * up.V_max;                      // 80% full (§8.7)
  up.d = dFromV(up, up.V, 0);
  up.z = up.z_floor + up.d;
  site.reservoirs.upper = up;
  site.kind = 'procedural';
  site.terrain = { ...terrain, x_dam: xDam };
  site.dam = { class: 'gravity', H_gross: up.z - site.reservoirs.lower.z, building: null, station: xDam, H_dam: H0 };
  return { replaced: old, upper: up };
}
// Plan and start a procedural raise to height H (integer m); cost charged by the caller; new volume appears when the job finishes.
export function planProceduralRaise(site, H, cls = site.dam.class) {
  const t = site.terrain, x = site.dam.station, Hcur = site.dam.H_dam;
  if (!(H > Hcur)) return { ok: false, reason: 'new height must exceed the current height' };
  if (H > classLimit(cls)) return { ok: false, reason: 'exceeds the ' + cls + ' class limit of ' + classLimit(cls) + ' m' };
  const Wb = Wbot(t, x), s = slope(t, x);
  return { ok: true, Hcur, H, cost: raiseCost(Wb, s, Hcur, H, cls), days: raiseDays(Hcur, H), cls };
}
export function startProceduralRaise(site, H, cls = site.dam.class) {
  const plan = planProceduralRaise(site, H, cls);
  if (!plan.ok) return plan;
  if (site.dam.building) return { ok: false, reason: 'dam already under construction' };
  const job = { type: 'raise', procedural: true, fromH: plan.Hcur, toH: H, cls, cost: plan.cost, secondsLeft: plan.days * 86400 };
  site.jobs.push(job);
  site.dam.building = { toH: H };
  return { ok: true, job, plan };
}
// Raise finished: rebuild the fine table (only on build or raise, never per tick), keep the stored volume.
export function finishProceduralRaise(site, job) {
  const up = site.reservoirs.upper, x = site.dam.station;
  up.table = buildCanyonTable(site.terrain, x, job.toH, true);
  up.D_max = job.toH;
  up.V_max = tableVmax(up.table);
  up.d = dFromV(up, up.V, up.d);
  up.z = up.z_floor + up.d;
  site.dam.class = job.cls;
  site.dam.H_dam = job.toH;
  site.dam.building = null;
}
