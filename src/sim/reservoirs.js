// Reservoirs and mass conservation (§3). Pure functions, SI units.
// A reservoir is either a frustum {A_bot, s, D_max, z_floor, V_max, V, d, z}
// or tabulated (same fields plus `table: {h, A:[...], V:[...]}`) (§3.1).
import { CONFIG } from '../config.js';
import { frustumArea, frustumVolume } from '../state.js';

const RC = CONFIG.reservoir;
const PM = CONFIG.penman;

// ---- Tabulated form (§3.1) ----
// Build A_k = A(k·h) with A_k ≥ A_min, non-decreasing, and cumulative V_k (exact for linear A).
export function buildTable(areaFn, D_max, h = RC.tableStep) {
  const n = Math.max(1, Math.ceil(D_max / h - 1e-9));
  const A = [], V = [0];
  for (let k = 0; k <= n; k++) {
    let a = Math.max(RC.A_min, areaFn(Math.min(k * h, D_max)));
    if (k > 0 && a < A[k - 1]) throw new Error('tabulated area must be non-decreasing (§3.1)');
    A.push(a);
    if (k > 0) V.push(V[k - 1] + (A[k - 1] + a) / 2 * h);  // trapezoid = exact quadratic integral
  }
  return { h, A, V };
}
function segOf(t, d) { return Math.min(t.A.length - 2, Math.max(0, Math.floor(d / t.h))); }
// V(d) = V_k + A_k u + (A_{k+1} − A_k)/(2h) u² (§3.1)
function tabVolume(t, d) {
  const k = segOf(t, d), u = d - k * t.h;
  return t.V[k] + t.A[k] * u + (t.A[k + 1] - t.A[k]) / (2 * t.h) * u * u;
}
function tabArea(t, d) {
  const k = segOf(t, d), u = d - k * t.h;
  return t.A[k] + (t.A[k + 1] - t.A[k]) * u / t.h;
}

// Common interface A(d), V(d) (§3.1)
export function areaAt(res, d) {
  return res.table ? tabArea(res.table, d) : frustumArea(res.A_bot, res.s, d);
}
export function volumeAt(res, d) {
  return res.table ? tabVolume(res.table, d) : frustumVolume(res.A_bot, res.s, d);
}
export function maxVolume(res) { return volumeAt(res, res.D_max); }

// Depth from volume: Newton–Raphson with V'(d) = A(d), start at previous depth,
// tol 1e-6 m³, hard cap 8 iterations, clamp to [0, D_max] (§3.1). Tabulated: stay in the
// current segment, hop to the neighbour when the root lies outside it.
export function dFromV(res, V, dPrev = res.d ?? 0) {
  const Vmax = maxVolume(res);
  if (!(V > 0)) return 0;
  if (V >= Vmax) return res.D_max;
  if (res.table) {
    const t = res.table;
    let k = segOf(t, Math.min(Math.max(dPrev, 0), res.D_max));
    while (k > 0 && V < t.V[k]) k--;                      // move to neighbouring segment
    while (k < t.A.length - 2 && V > t.V[k + 1]) k++;
    const lo = k * t.h, hi = Math.min((k + 1) * t.h, res.D_max);
    let d = Math.min(hi, Math.max(lo, dPrev));
    for (let i = 0; i < RC.newtonMaxIter; i++) {
      const r = tabVolume(t, d) - V;
      if (Math.abs(r) < RC.newtonTol) break;
      const A = tabArea(t, d);
      d = Math.min(hi, Math.max(lo, d - (A > 0 ? r / A : 0)));
    }
    return Math.min(res.D_max, Math.max(0, d));
  }
  let d = Math.min(res.D_max, Math.max(0, dPrev));
  if (d === 0) d = res.D_max * V / Vmax;                  // avoid A(0)-only start from empty
  for (let i = 0; i < RC.newtonMaxIter; i++) {
    const r = frustumVolume(res.A_bot, res.s, d) - V;
    if (Math.abs(r) < RC.newtonTol) break;
    const A = frustumArea(res.A_bot, res.s, d);
    d = Math.min(res.D_max, Math.max(0, d - (A > 0 ? r / A : 0)));
  }
  return d;
}

// A_catch = 2·A_lower(D_max), fixed at game start (§3.2)
export function catchmentArea(lower) { return RC.catchFactor * areaAt(lower, lower.D_max); }

// Flow interlock (§3.2): limit Q_pen so no reservoir over/under-flows in one step.
// mode 'pump' | 'gen'. Returns {limit, factor} where factor scales every unit's flow.
export function interlockLimit(mode, Q_pen, upper, lower, dt) {
  if (!(Q_pen > 0) || !(dt > 0)) return { limit: 0, factor: Q_pen > 0 ? 0 : 1 };
  const src = mode === 'pump' ? lower : upper, dst = mode === 'pump' ? upper : lower;
  const limit = Math.max(0, Math.min(src.V / dt, (dst.V_max - dst.V) / dt));
  return { limit, factor: Q_pen > limit ? limit / Q_pen : 1 };
}

// Mass balance, spill and release for one step (§3.2). Mutates V, d, z of both reservoirs.
// inp: {Q_up, P_rain, E_evap (mm/day), Q_river, Q_river_base (m³/s), dV_melt (m³),
//       A_catch (m²), Q_env (m³/s)}. Returns spill/fine volumes for Economy and alerts.
export function stepReservoirs(upper, lower, inp, dt) {
  const Q_up = inp.Q_up || 0, rain = inp.P_rain || 0, evap = inp.E_evap || 0;
  const Q_river = inp.Q_river || 0;
  const A_up = areaAt(upper, upper.d), A_lo = areaAt(lower, lower.d);  // A at step start
  const netMm = (rain - evap) / 1000 * dt / 86400;                       // mm/day → m per step
  // ΔV_runoff = (P_rain/1000)·max(0, A_catch − A_lower)·0.25·dt/86400 (§3.2)
  const dV_runoff = rain / 1000 * Math.max(0, (inp.A_catch || 0) - A_lo) * RC.runoffCoef * dt / 86400;
  // 1. upper: ΔV_upper = Q_up dt + A_up (P−E)/1000 dt/86400 + Q_river dt
  let Vu = upper.V + Q_up * dt + A_up * netMm + Q_river * dt;
  let S_upper = 0;
  if (Vu > upper.V_max) { S_upper = Vu - upper.V_max; Vu = upper.V_max; }   // spill, not fined
  // 2. lower: ΔV_lower = −Q_up dt + A_lo (P−E)/1000 dt/86400 + ΔV_runoff + ΔV_melt + S_upper − release
  let Vl = lower.V - Q_up * dt + A_lo * netMm + dV_runoff + (inp.dV_melt || 0) + S_upper;
  const envWanted = Math.max(0, inp.Q_env || 0) * dt;
  const envReleased = Math.min(envWanted, Math.max(0, Vl));                // sink limited to water available
  Vl -= envReleased;
  let S_lower = 0;
  if (Vl > lower.V_max) { S_lower = Vl - lower.V_max; Vl = lower.V_max; }
  // 3. Fined flood part (approximation: base river flow is treated as passing straight through)
  const finedVolume = Math.max(0, S_lower - (inp.Q_river_base || 0) * dt);
  // 4. Guard V ≥ 0, recompute depths by Newton inversion
  upper.V = Math.max(0, Vu); lower.V = Math.max(0, Vl);
  upper.d = dFromV(upper, upper.V, upper.d); upper.z = upper.z_floor + upper.d;
  lower.d = dFromV(lower, lower.V, lower.d); lower.z = lower.z_floor + lower.d;
  return { S_upper, S_lower, finedVolume, envReleased, envUnmet: envWanted - envReleased, dV_runoff };
}

// Penman 1948 open-water evaporation (§3.3), mm/day. Verbatim, NO FAO-56 (1+0.34u₂) term.
export function penmanEvaporation(T, RH, u2, Gbar) {
  if (T < 0) return 0;                                              // ice cover
  const Tc = Math.max(T, -200);
  const es = PM.a * Math.exp(Math.min(PM.b * Tc / (Tc + PM.c), 50)); // e_s(T)
  const Delta = PM.dA * es / ((Tc + PM.c) ** 2);                    // Δ
  const ea = Math.min(Math.max(RH, 0), 1) * es;                     // e_a = RH·e_s
  const g = PM.gamma;
  const Rs = PM.Rs_per_W * Math.max(Gbar, 0);                       // R_s = 0.0864 Ḡ
  const Rn = PM.albedoFactor * Rs;                                  // R_n = 0.92 R_s
  const E = PM.k_rad * Delta * Rn / (Delta + g)
    + g / (Delta + g) * PM.k_aero * Math.max(u2, 0) * (es - ea) / (Tc + 273);
  return Math.max(0, E);
}

// Stored energy (§12 Test 11): E = ρ g V H / 3.6e9 MWh
export function storedEnergyMWh(V, H, eta = 1) {
  return CONFIG.physics.rho * CONFIG.physics.g * V * Math.max(H, 0) * eta / 3.6e9;
}
