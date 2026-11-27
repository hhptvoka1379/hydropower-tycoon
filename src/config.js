// CONFIG — every constant of the simulation contract, SI units unless stated.
// Owned by the Contract agent. Section-owned constants not listed here are added by
// the owning agent (see decisions/contract.md). No DOM / window access in this file.

import physicsCfg from './config/physics.js';
import climateCfg from './config/climate.js';
import economyCfg from './config/economy.js';

export const CONFIG = Object.freeze({
  ...physicsCfg, ...climateCfg, ...economyCfg,  // owner blocks; must not collide with contract keys
  // §1.3 physical constants
  physics: Object.freeze({
    rho: 1000,          // water density, kg/m³ (§1.3)
    rhoAir: 1.225,      // air density, kg/m³ (§1.3)
    g: 9.81,            // gravity, m/s² (§1.3)
    nu: 1.0e-6,         // water kinematic viscosity at 20 °C, m²/s (§1.3)
  }),

  // §1.1 time system
  time: Object.freeze({
    hoursPerDay: 24,
    secondsPerHour: 3600,            // s
    daysPerYear: 365,
    startDay: 1,                     // Jan 1st (§1.1)
    startHour: 8,                    // 08:00 (§1.1)
    // Seasons: [firstDay, lastDay] inclusive (§1.1)
    seasons: Object.freeze([
      Object.freeze({ name: 'Winter', first: 1, last: 91 }),
      Object.freeze({ name: 'Spring', first: 92, last: 182 }),
      Object.freeze({ name: 'Summer', first: 183, last: 274 }),
      Object.freeze({ name: 'Autumn', first: 275, last: 365 }),
    ]),
    // Speed ladder (§1.1): game seconds per real second and fixed physics dt, s
    speeds: Object.freeze([
      Object.freeze({ label: 'x1', gameSecPerRealSec: 60, dt: 1 }),
      Object.freeze({ label: 'x2', gameSecPerRealSec: 120, dt: 1 }),
      Object.freeze({ label: 'x4', gameSecPerRealSec: 240, dt: 1 }),
      Object.freeze({ label: 'x8', gameSecPerRealSec: 480, dt: 1 }),
      Object.freeze({ label: 'x60', gameSecPerRealSec: 3600, dt: 5 }),
      Object.freeze({ label: 'x360', gameSecPerRealSec: 21600, dt: 30 }),
    ]),
    maxFrameRealMs: 250,             // accumulator clamp per rAF, ms (§1.1)
    stepBudgetMsPerFrame: 40,        // max sim time per frame before carry-over, ms (§11.3)
  }),

  // §1.2 energy accounting: 1 MW × 1 h = 1 MWh
  energy: Object.freeze({
    wPerMW: 1e6,                     // W per MW
    secPerHour: 3600,                // E_Wh += P·dt/3600 (§1.2)
  }),

  // §11.4 performance budgets
  perf: Object.freeze({
    stepMsPerSiteMax: 0.05,          // ms (§11.4, §1.1)
    rebuildSliceMs: 8,               // ms per frame for table rebuilds (§11.4)
    chartRingPoints: 1440,           // 24 h at 1-min resolution (§11.4)
    textUpdateRelChange: 0.001,      // 0.1% (§11.4)
    textUpdateMaxIntervalS: 1,       // s (§11.4)
  }),

  // §11.5 hashing
  hash: Object.freeze({
    significantDigits: 12,           // canonical JSON number precision (§11.5)
  }),

  // §8.1 money scaling (also §7)
  CAPEX_SCALE: 0.04,                 // charged = base × CAPEX_SCALE (§8.1)

  // §8.1 equipment catalogue. Prices are BASE $; Q in m³/s; P in W; heads in m.
  pumps: Object.freeze([
    null,
    Object.freeze({ tier: 1, model: 'Sulzer-class APT-50', P_rated: 500e3, Q_max: 0.80, eta_p: 0.80, H_des: 50, NPSH_R: 3.0, basePrice: 120e3 }),
    Object.freeze({ tier: 2, model: 'KSB-class RPH-500', P_rated: 5e6, Q_max: 4.3, eta_p: 0.84, H_des: 100, NPSH_R: 4.5, basePrice: 900e3 }),
    Object.freeze({ tier: 3, model: 'Voith-class RPT-5000', P_rated: 50e6, Q_max: 30, eta_p: 0.87, H_des: 150, NPSH_R: 6.0, basePrice: 7.5e6 }),
  ]),
  // H_des = middle of band; Q_des = 0.9·Q_max (§8.1, §2.4)
  turbines: Object.freeze([
    null,
    Object.freeze({ tier: 1, model: 'Andritz-class Francis F-1', P_rated: 1e6, Q_max: 2.2, eta_t: 0.85, sigma_c: 0.10, H_band: Object.freeze([40, 70]), basePrice: 180e3 }),
    Object.freeze({ tier: 2, model: 'Voith-class Francis F-20', P_rated: 20e6, Q_max: 19, eta_t: 0.90, sigma_c: 0.09, H_band: Object.freeze([60, 180]), basePrice: 2.8e6 }),
    Object.freeze({ tier: 3, model: 'GE-class Francis F-150', P_rated: 150e6, Q_max: 85, eta_t: 0.92, sigma_c: 0.08, H_band: Object.freeze([100, 300]), basePrice: 16e6 }),
  ]),
  turbineQdesFrac: 0.9,              // Q_des = 0.9·Q_max (§8.1)
  windBasePrice: Object.freeze([null, 350e3, 1.1e6, 3.2e6]),   // $ (§8.1; specs in §5.3)
  solarBasePrice: Object.freeze([null, 45e3, 420e3, 1.6e6]),   // $ (§8.1; specs in §5.4)

  penstock: Object.freeze({
    diameters: Object.freeze([0.6, 1.0, 1.5, 2.5]),            // m (§8.1)
    basePricePerM: Object.freeze([400, 900, 1800, 4000]),      // $/m (§8.1)
    roughness: Object.freeze({ steel: 0.0003, concrete: 0.0010 }), // ε, m (§8.1)
    concreteCostFactor: 0.85,                                  // −15% cost (§8.1)
  }),

  landParcelBasePrice: Object.freeze([null, 0, 200e3, 300e3, 400e3, 600e3, 800e3]), // $; parcel 1 owned (§8.1)

  dam: Object.freeze({
    concreteBasePricePerM3: 300,     // $/m³ (§8.1)
    C_dam: 800,                      // $/m² of head, Classic raise (§8.1, §8.2)
    raiseDaysBase: 2,                // days (§8.2, §8.4)
    raiseDaysPerM: 1 / 5,            // days per m (§8.2, §8.4)
    classicStartHead: 50,            // m (§8.2)
    classMaxGrossHead: Object.freeze({ gravity: 80, arch: 150, doubleArch: 250 }),  // m (§8.2)
    classMaxHdam: Object.freeze({ gravity: 40, arch: 110, doubleArch: 210 }),       // m (§8.4)
    profile: Object.freeze({         // (§8.4) t_crest m, k_batter
      gravity: Object.freeze({ t_crest: 4, k_batter: 0.70 }),
      arch: Object.freeze({ t_crest: 3, k_batter: 0.35 }),
      doubleArch: Object.freeze({ t_crest: 2.5, k_batter: 0.18 }),
    }),
    concreteIntegralSteps: 100,      // midpoint steps (§8.4)
    proceduralStartH0: 10,           // m (§8.4)
  }),

  excavation: Object.freeze({
    basePricePerM3: 3,               // $/m³ (§8.1)
    baseMobilization: 20e3,          // $ (§8.1)
    stageAddAbot: 5000,              // m² per stage (§8.5)
    stages: 5,                       // (§8.5)
    m3PerDay: 50000,                 // Days = max(2, ceil(ΔV/50,000)) (§8.5)
    minDays: 2,
  }),

  canyon: Object.freeze({            // §8.3 / §8.4 defaults
    W0: 60, a_w: 0.6, s0: 0.8, a_s: 0.25, S0: 0.015,
    Wbot_min: 12, Wbot_max: 200,     // m
    s_min: 0.35, s_max: 1.5,
    length: 20000,                   // m
    Nw: Object.freeze({ wavelengths: Object.freeze([400, 150, 50]), weights: Object.freeze([1, 0.5, 0.25]) }),
    Ns: Object.freeze({ wavelengths: Object.freeze([300, 100]), weights: Object.freeze([1, 0.5]) }),
    dx: 5, depthStep: 0.5,           // m, fine table (§8.3)
    previewDx: 20, previewDepthStep: 2, previewTol: 0.03,   // (§8.4)
    xDamMin: 0, xDamMax: 1200,       // m (§8.4)
    defaultStationRange: Object.freeze([100, 600]),         // m (§8.4)
    VmaxValid: Object.freeze([150000, 300000]),             // m³ (§8.4)
    maxRetries: 50,                  // (§8.4)
  }),

  soiling: Object.freeze({           // §8.6
    min: 0.55, max: 1.00,
    dailyLoss: 0.0006,
    rainThresholdMm: 5, rainGain: 0.02, rainCap: 0.95,
    cleanCostPerKW: 0.80,            // $ per kW STC (not CapEx-scaled, §8.6 quotes it directly)
    cleanDays: 1, cleanGain: 0.15,
  }),

  // §8.7 starting configuration (Classic Benchmark)
  start: Object.freeze({
    cash: 50000,                     // $ (§8.7)
    grossHead: 50,                   // m at both reservoirs startFill (§8.7, §3.1)
    startFill: 0.8,                  // fraction of V_max (§8.7)
    upper: Object.freeze({ A_bot: 20000, s: 0.6, D_max: 10 }),   // m², –, m (§8.7)
    // z_lower_floor = 0 m: datum implied by z_upper_floor ≈ 51.5993 (§8.3; decisions/contract.md)
    lower: Object.freeze({ A_bot: 30000, s: 0.5, D_max: 12, z_floor: 0 }),
    penstock: Object.freeze({ D: 1.0, L: 60, sumK: 2.1, material: 'steel' }), // (§8.7)
    pumpTiers: Object.freeze([1]),
    turbineTiers: Object.freeze([1]),
    solar: Object.freeze({ tier: 2, modules: 1500, P_stc_approx: 535e3, f_soil: 0.60, parcel: 1 }), // (§8.7)
    wind: Object.freeze([]),
    ownedParcels: Object.freeze([1]),
  }),

  // §12 Test 11 reference net head
  test11: Object.freeze({ H_n: 49 }),  // m
});

export const SPEED_COUNT = CONFIG.time.speeds.length;
