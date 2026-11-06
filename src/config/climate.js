// Constants owned by the climate agent (spec chunks per README). Merged into CONFIG by src/config.js. Add new keys only; never alter contract keys.
const F = Object.freeze;

export default F({
  // §5.1 seasonal table (index = season 0..3 per CONFIG.time.seasons). T °C, amp °C, u m/s, precipChance /day, precipMm mm/day total, cloud 0..1, Gmax W/m²
  climateSeasons: F([
    F({ name: 'Winter', T_mean: 2, amp: 5, u_mean: 9, precipChance: 0.12, precipMm: 8, cloud: 0.60, G_max: 550 }),
    F({ name: 'Spring', T_mean: 10, amp: 8, u_mean: 7, precipChance: 0.30, precipMm: 6, cloud: 0.45, G_max: 800 }),
    F({ name: 'Summer', T_mean: 22, amp: 10, u_mean: 5, precipChance: 0.20, precipMm: 10, cloud: 0.35, G_max: 1000 }),
    F({ name: 'Autumn', T_mean: 12, amp: 7, u_mean: 6, precipChance: 0.35, precipMm: 7, cloud: 0.50, G_max: 700 }),
  ]),
  climate: F({
    cloudSpread: 0.2,                 // ± daily cloud draw around seasonal mean (§5.1)
    T_peakHourOffset: 9,              // sin(π(h−9)/12) → peak 15:00 (§5.1)
    T_cloudBase: 0.6, T_cloudClear: 0.4, // diurnal amp factor 0.6 + 0.4(1−cloud) (§5.1)
    G_cloudLoss: 0.70,                // G × (1 − 0.70·cloud) (§5.1)
    u_diurnal: 0.30,                  // u × (1 + 0.30 cos(2πh/24)) (§5.1)
    RH_mean: 0.55, RH_amp: 0.25, RH_phase: 2, RH_cloud: 0.30, RH_min: 0.15, RH_max: 0.95, // fraction (§5.1)
    sunriseBase: 7, sunsetBase: 18.25, sunsetSlope: 1.75, sunDayOffset: 46, // h, h, h, day (§5.1)
    arT: F({ sigma: 0.3, alpha: 0.9 }),   // °C AR(1) (§5.1)
    arU: F({ sigma: 1.2, alpha: 0.92 }),  // m/s AR(1) (§5.1)
    rainHoursMin: 6, rainHoursSpan: 13,   // N = 6 + floor(13·rng()) hours (§5.1)
    snowBelowC: 0,                    // °C, rain shown as snow (§5.1)
  }),
  // §5.2 weather events
  events: F({
    heatWave: F({ dT: 8, Gmult: 1.15, minDays: 3, maxDays: 7, secondProb: 0.3, minGapDays: 5 }), // °C, ×, days (§5.2)
    coldSnap: F({ dT: -10, minDays: 3, maxDays: 5, secondProb: 0.3, earliestDay: 3, snowpackFrac: 0.5, meltAboveC: 2 }), // (§5.2)
    windstorm: F({ dailyProb: 0.01, minDays: 1, maxDays: 3, uMin: 20, uMax: 30, bladeDamageProb: 0.02, repairCost: 5000, offlineH: 6 }), // m/s, $, h (§5.2)
    stormRain: F({ dailyProb: 0.01, minDays: 1, maxDays: 2, mmPerDay: 40, runoffMult: 2 }), // mm/day (§5.2)
  }),
  // §5.2 spring melt into the lower reservoir
  springMelt: F({ peakQ: 0.25, center: 96.5, halfWidth: 4.5, firstDay: 92, lastDay: 100 }), // m³/s, day (§5.2)
  // §5.2 river into the upper reservoir
  river: F({
    sSeason: F([0.6, 1.4, 0.5, 0.9]), // per season (§5.2)
    Q_baseClassic: 0,                 // m³/s at Classic site (§5.2)
    Q_baseProcedural: 0.15,           // m³/s default procedural (§5.2)
    A_basin: 3e6,                     // m² (3 km², §5.2)
    runoffCoef: 0.25,                 // (§5.2)
  }),
  // §5.3 wind
  wind: F({
    shearExp: 0.143, refHeight: 2,    // 1/7 power law from u₂ at 2 m (§5.3)
    Cp: 0.40, etaMech: 0.95,          // (§5.3)
    cutIn: 3.5, rated: 12, cutOut: 25, // m/s (§5.3)
    tiers: F([null,
      F({ tier: 1, R: 15, H_hub: 30 }),  // m (§5.3)
      F({ tier: 2, R: 28, H_hub: 60 }),
      F({ tier: 3, R: 49, H_hub: 90 }),
    ]),
    tilePitch: 150,                   // m (§5.3, §5.5)
    C_T: 0.80, k_w: 0.075, phi: 0.25, etaWakeMin: 0.65, // Jensen wake (§5.3)
  }),
  // §5.4 solar
  solar: F({
    A_panel: 1.7,                     // m² per module (§5.4)
    etaPanel: F([null, 0.20, 0.21, 0.22]), // (§5.4)
    modules: F([null, 150, 1500, 6000]),   // per array (§5.4)
    gamma: 0.004,                     // 1/°C (§5.4)
    etaInv: 0.96,                     // (§5.4)
    T_ref: 25, G_noct: 800, dT_noct: 25, // T_cell = T + G/800·25 (§5.4)
  }),
  // §5.5 parcels
  parcels: F({ nTiles: 16, k_shade: 0.05, k_coloc: 0.03, secondTechDiscount: 0.15 }), // (§5.5)
  // §6 market
  market: F({
    base: 45, am: F({ A: 30, h: 8.5 }), pm: F({ A: 45, h: 19.5 }), // $/MWh, h (§6.1)
    dip: F({ A: 18, start: 10, end: 16, period: 6 }),             // $/MWh, h (§6.1)
    coolBase: 24, heatBase: 5,        // °C (§6.1)
    mT_cool: 0.025, mT_heat: 0.020, fD_cool: 0.010, fD_heat: 0.008, // per degree (§6.1)
    R_solarMW: 250, R_windMW: 300, R_windRef: 12, // MW, MW, m/s (§6.2)
    k_merit: 1.5, D_total: 400,       // –, MW (§6.2)
    noise: 3,                         // ± $/MWh uniform (§6.2)
    priceMin: -50, priceMax: 500,     // $/MWh clamp (§6.2)
    forecastErr: 0.10,                // ± fraction (§6.3)
  }),
});
