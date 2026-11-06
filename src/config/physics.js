// Constants owned by the physics agent (§2, §3, §4). Merged into CONFIG by src/config.js.
// Add new keys only; never alter contract keys. SI units unless stated.
export default Object.freeze({
  hydraulics: Object.freeze({
    K_entrance: 0.5, K_exit: 1.0, K_bend: 0.3,   // minor-loss coefficients, – (§2.2)
    swameeA: 3.7, swameeB: 5.74, swameeExp: 0.9, // Swamee–Jain constants (§2.2)
    f_min: 0.008, f_max: 0.100,                  // friction-factor clamp, – (§2.2)
    Re_turbulent: 5000,                          // below this (Re>0) use f_lowRe (§2.2)
    f_lowRe: 0.015,                              // – (§2.2)
    turbHillH: 0.15, turbHillHWidth: 0.30,       // head derating, – (§2.4)
    turbHillQ: 0.10, turbHillQWidth: 0.50,       // flow derating, – (§2.4)
    hillBracketMin: 0.4, hillBracketMax: 1.0,    // bracket clamp (§2.4)
    eta_min: 0.4,                                // efficiency floor, – (§2.4, §2.5)
    pumpHillQ: 0.12, pumpHillQWidth: 0.40,       // pump flow derating, – (§2.5)
    minFlowFrac: 0.10,                           // minimum flow, fraction of Q_max (§2.6)
    rampSeconds: 60,                             // dQ/dt = Q_max / 60 s (§2.6)
  }),
  reservoir: Object.freeze({
    tableStep: 0.5,          // m, tabulated depth grid (§3.1)
    A_min: 1,                // m², floor of tabulated areas (§3.1)
    newtonTol: 1e-6,         // m³ (§3.1)
    newtonMaxIter: 8,        // (§3.1)
    runoffCoef: 0.25,        // – (§3.2)
    catchFactor: 2,          // A_catch = 2·A_lower(D_max) (§3.2)
  }),
  penman: Object.freeze({
    a: 0.6108, b: 17.27, c: 237.3,  // e_s(T) kPa (§3.3)
    dA: 4098,                       // Δ numerator (§3.3)
    gamma: 0.0665,                  // kPa/°C (§3.3)
    Rs_per_W: 0.0864,               // MJ/m²/day per W/m² (§3.3)
    albedoFactor: 0.92,             // 1 − 0.08 (§3.3)
    k_rad: 0.408, k_aero: 900,      // (§3.3)
    E_max: 16,                      // sanity band, mm/day (§3.3)
  }),
  wear: Object.freeze({
    H_atm: 10.33,            // m H2O (§4.1)
    H_vap: 0.24,             // m H2O at 20 °C (§4.1)
    H_s_design: 1.0,         // m, turbine design suction height (§4.1)
    H_s_pump: 1.5,           // m (§4.2)
    K_suction: 0.30,         // m at design flow (§4.2)
    cavitationPenalty: 10,   // – (§4.1, §4.2)
    marginAlert: 1.15,       // σ/σ_c alert threshold (§4.1)
    baseWearPctPerH: 0.05,   // %/h (§4.3)
    startWearPct: 0.02,      // health points per start (§2.6, §4.3)
    tripHealthPct: 5,        // % (§4.3)
    etaMultSlope: 0.05,      // η_mult = 1 − 0.05(1 − health/100) (§4.3)
    repairCostPctPerPt: 0.0025, // 0.25% of unit CapEx per health point (§4.4)
    repairHoursPerPt: 0.2,   // h per health point (§4.4)
  }),
});
