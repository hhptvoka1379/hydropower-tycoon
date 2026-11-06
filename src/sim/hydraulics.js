// Core hydraulics (§2). Pure functions, SI units.
// Scope boundaries (§2.8):
// - Quasi-steady flow only: no water-hammer or surge-tank transients (represented by the ramp rule).
// - One penstock per plant, fed by up to two turbine bays and two pump bays; no parallel penstocks, no surge shaft.
// - No sediment, fish passage or ecological flows.
// - Generator and inverter electrical dynamics are out of scope; the grid is an infinite bus.
import { CONFIG } from '../config.js';

const HY = CONFIG.hydraulics;
const PH = CONFIG.physics;

// Heads (§2.1): H_g = z_upper − z_lower
export function grossHead(z_upper, z_lower) { return z_upper - z_lower; }

// Swamee–Jain friction factor (§2.2), clamped to [0.008, 0.100]; 0<Re<5000 → 0.015.
export function frictionFactor(Re, relRough) {
  if (!(Re > 0)) return 0;
  if (Re < HY.Re_turbulent) return HY.f_lowRe;
  const arg = Math.max(relRough / HY.swameeA + HY.swameeB / Math.pow(Re, HY.swameeExp), 1e-12);
  const lg = Math.log10(arg);
  const den = lg * lg;
  const f = den > 0 ? 0.25 / den : HY.f_max;
  return Math.min(HY.f_max, Math.max(HY.f_min, f));
}

// Penstock friction, Darcy–Weisbach + minor losses (§2.2). Q_pen = 0 → all zero.
export function penstockLoss(Q_pen, D, L, epsilon, sumK) {
  if (!(Q_pen > 0) || !(D > 0)) return { A_pipe: Math.PI * (D / 2) ** 2, v: 0, Re: 0, f: 0, Hf_major: 0, Hf_minor: 0, Hf: 0, lowRe: false };
  const A_pipe = Math.PI * (D / 2) ** 2;            // A_pipe = π(D/2)²
  const v = Q_pen / A_pipe;                          // v = Q/A
  const Re = v * D / PH.nu;                          // Re = vD/ν
  const f = frictionFactor(Re, epsilon / D);         // Swamee–Jain
  const vh = v * v / (2 * PH.g);                     // velocity head v²/2g
  const Hf_major = f * (L / D) * vh;                 // H_f,major = f(L/D)v²/2g
  const Hf_minor = sumK * vh;                        // H_m = ΣK v²/2g
  return { A_pipe, v, Re, f, Hf_major, Hf_minor, Hf: Hf_major + Hf_minor, lowRe: Re < HY.Re_turbulent };
}

// Turbine power P = ρ g H_n Q η (§2.4); H_n ≤ 0 → 0.
export function turbinePower(H_n, Q, eta) {
  if (!(H_n > 0) || !(Q > 0)) return 0;
  return PH.rho * PH.g * H_n * Q * eta;
}

// Pump power P = ρ g H_dyn Q / η (§2.5).
export function pumpPower(H_dyn, Q, eta) {
  if (!(Q > 0) || !(eta > 0)) return 0;
  return PH.rho * PH.g * Math.max(H_dyn, 0) * Q / eta;
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Turbine hill curve (§2.4), then × η_mult (§4.3).
export function turbineEfficiency(etaRated, H_n, H_des, Q, Q_des, etaMult = 1) {
  const xh = H_des > 0 ? (H_n / H_des - 1) / HY.turbHillHWidth : 0;
  const xq = Q_des > 0 ? (Q / Q_des - 1) / HY.turbHillQWidth : 0;
  const bh = clamp(1 - HY.turbHillH * xh * xh, HY.hillBracketMin, HY.hillBracketMax);
  const bq = clamp(1 - HY.turbHillQ * xq * xq, HY.hillBracketMin, HY.hillBracketMax);
  return clamp(etaRated * bh * bq, HY.eta_min, etaRated) * etaMult;
}

// Pump curve (§2.5), then × η_mult.
export function pumpEfficiency(etaRated, Q, Q_des, etaMult = 1) {
  const xq = Q_des > 0 ? (Q / Q_des - 1) / HY.pumpHillQWidth : 0;
  return clamp(etaRated * (1 - HY.pumpHillQ * xq * xq), HY.eta_min, etaRated) * etaMult;
}

// Minimum-flow rule on a requested flow (§2.6): (0, 10%) → 10%; 0 stops; capped at Q_max.
export function applyMinFlow(Q_req, Q_max) {
  if (!(Q_req > 0)) return 0;
  return clamp(Q_req, HY.minFlowFrac * Q_max, Q_max);
}

// Ramp toward setpoint at ±Q_max/60 s, scaled by dt (§2.6).
export function rampFlow(Q, Q_set, Q_max, dt) {
  const step = Q_max / HY.rampSeconds * dt;
  if (Q_set > Q) return Math.min(Q_set, Q + step);
  return Math.max(Q_set, Q - step);
}

// Hydraulic solve for one mode with a cap pass (§2.6, §2.7 steps 3–4).
// units: [{Q, Q_max, Q_des, etaRated, H_des, P_rated, etaMult}]; mode 'gen'|'pump'.
// Returns final (possibly capped) flows and powers. One cap re-evaluation, no iteration.
export function solveHydraulics(mode, H_g, units, pipe) {
  const evalAll = (Qs) => {
    const Q_pen = Qs.reduce((a, b) => a + b, 0);
    const loss = penstockLoss(Q_pen, pipe.D, pipe.L, pipe.epsilon, pipe.sumK);
    const H_n = H_g - loss.Hf;                       // H_n = H_g − H_f
    const H_dyn = H_g + loss.Hf;                     // H_dyn = H_g + H_f
    const eta = [], P = [];
    units.forEach((u, i) => {
      if (mode === 'gen') {
        const e = turbineEfficiency(u.etaRated, H_n, u.H_des, Qs[i], u.Q_des, u.etaMult ?? 1);
        eta.push(e); P.push(turbinePower(H_n, Qs[i], e));
      } else {
        const e = pumpEfficiency(u.etaRated, Qs[i], u.Q_des, u.etaMult ?? 1);
        eta.push(e); P.push(pumpPower(H_dyn, Qs[i], e));
      }
    });
    return { Q_pen, ...loss, H_g, H_n, H_dyn, Q: Qs, eta, P };
  };
  let r = evalAll(units.map(u => u.Q));
  if (r.P.some((p, i) => p > units[i].P_rated)) {
    // Governor closes gates: Q ← Q·P_rated/P, recompute once, clamp P (§2.6)
    const Qs = r.Q.map((q, i) => (r.P[i] > units[i].P_rated && r.P[i] > 0 ? q * units[i].P_rated / r.P[i] : q));
    r = evalAll(Qs);
    r.P = r.P.map((p, i) => Math.min(p, units[i].P_rated));
    r.capped = true;
  }
  return r;
}
