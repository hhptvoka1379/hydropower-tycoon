// Wear, cavitation, maintenance (§4). Pure functions. Health is in percent (0..100);
// the state stores unit.wear as a fraction 0..1 with health = 100·(1 − wear).
import { CONFIG } from '../config.js';

const W = CONFIG.wear;

export const healthOf = (unit) => 100 * (1 - (unit.wear || 0));
export const setHealth = (unit, h) => { unit.wear = 1 - Math.min(100, Math.max(0, h)) / 100; };

// Thoma σ = (H_atm − H_vap − H_s,eff)/H_n, H_s,eff = H_s,design + drawdown (§4.1). H_n ≤ 0 → null (skip).
export function thomaSigma(H_n, H_s_eff, H_atm = W.H_atm, H_vap = W.H_vap) {
  if (!(H_n > 0)) return null;
  return (H_atm - H_vap - H_s_eff) / H_n;
}
export function turbineSuctionHead(drawdown, H_s_design = W.H_s_design) { return H_s_design + Math.max(0, drawdown); }

// NPSH_A = H_atm − H_vap − (H_s,pump + drawdown) − K_suction (Q/Q_des)² (§4.2)
export function npshAvailable(drawdown, Q, Q_des, H_s_pump = W.H_s_pump) {
  const r = Q_des > 0 ? Q / Q_des : 0;
  const Hf_suction = W.K_suction * r * r;
  return W.H_atm - W.H_vap - (H_s_pump + Math.max(0, drawdown)) - Hf_suction;
}

// CavitationPenalty = 10 if σ < σ_c (or NPSH_A < NPSH_R), else 0 (§4.1, §4.2)
export function cavitationPenalty(value, critical) {
  return value !== null && value < critical ? W.cavitationPenalty : 0;
}

// Δhealth = −BaseWear·(P/P_rated)²·(1 + penalty)·Δt_hr (§4.3), in health points.
export function wearDelta(P, P_rated, penalty, dt) {
  const load = P_rated > 0 ? Math.max(0, P) / P_rated : 0;
  return -W.baseWearPctPerH * load * load * (1 + penalty) * (dt / 3600);
}

// η_mult = 1 − 0.05·(1 − health/100) (§4.3)
export function etaMult(health) { return 1 - W.etaMultSlope * (1 - Math.min(100, Math.max(0, health)) / 100); }

// Trip: health below 5 % takes the unit offline until repaired (§4.3)
export function isTripped(health) { return health < W.tripHealthPct; }

// Repair (§4.4): Cost = (100 − h)·0.25%·CapEx_unit, Downtime = (100 − h)·0.2 h
export function unitCapex(kind, tier) {
  const cat = kind === 'pump' ? CONFIG.pumps : CONFIG.turbines;
  return (cat[tier] ? cat[tier].basePrice : 0) * CONFIG.CAPEX_SCALE;
}
export function repairCost(health, capex) { return Math.max(0, 100 - health) * W.repairCostPctPerPt * capex; }
export function repairHours(health) { return Math.max(0, 100 - health) * W.repairHoursPerPt; }
