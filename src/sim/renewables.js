// §5.3 wind, §5.4 solar, §5.5 parcels/shading. Pure; no DOM.
import { CONFIG } from '../config.js';

const W = () => CONFIG.wind, S = () => CONFIG.solar, PC = () => CONFIG.parcels;

// §5.3 hub speed: v_hub = u₂·(H_hub/2)^0.143 (1/7 power-law shear)
export function hubSpeed(u2, H_hub) {
  const w = W();
  return Math.max(0, u2) * Math.pow(Math.max(1e-9, H_hub / w.refHeight), w.shearExp);
}

// §5.3 cubic P = ½ρ_air·A·v³·Cp·η_mech  [W]
function cubic(v, R) {
  const w = W();
  return 0.5 * CONFIG.physics.rhoAir * Math.PI * R * R * v * v * v * w.Cp * w.etaMech;
}

// §5.3 rated power, the cubic evaluated at 12 m/s  [W]
export function windRated(R) { return cubic(W().rated, R); }

// §5.3 four-region power curve, given hub speed v (m/s) and rotor radius R (m)  [W]
export function windPower(v, R) {
  const w = W();
  if (!(v >= w.cutIn) || v > w.cutOut) return 0;   // cut-in / cut-out
  if (v >= w.rated) return windRated(R);           // rated plateau, no cubic runaway
  return cubic(v, R);
}

// §5.3 Jensen wake with direction averaging. Tuned game simplification, not a derivation.
// η_wake = max(0.65, 1 − (N−1)·φ·δ_J), δ_J = (1 − √(1−C_T))/(1 + 2k_w·S_norm)², S_norm = 150/(2R), mean over turbines
export function wakeFactor(tiers) {
  const w = W();
  const n = tiers.length;
  if (n <= 1) return 1;
  let sNorm = 0;
  for (const t of tiers) sNorm += w.tilePitch / (2 * w.tiers[t].R);
  sNorm /= n;
  const dJ = (1 - Math.sqrt(Math.max(0, 1 - w.C_T))) / ((1 + 2 * w.k_w * sNorm) ** 2);
  return Math.max(w.etaWakeMin, 1 - (n - 1) * w.phi * dJ);
}

// §5.3 parcel output: η_wake × Σ P_wind,i. turbines: [{tier, offline?}], u2 m/s. Returns {total, each[]} in W.
export function parcelWind(turbines, u2) {
  const w = W();
  const eta = wakeFactor(turbines.map(t => t.tier));
  const each = turbines.map(t => {
    if (t.offline) return 0;
    const spec = w.tiers[t.tier];
    return eta * windPower(hubSpeed(u2, spec.H_hub), spec.R);
  });
  return { eta, each, total: each.reduce((a, b) => a + b, 0) };
}

// §5.4 solar PV. Explicit inputs for the pure test. Returns {G_eff, P_dc, T_cell, tempFactor, P_ac} (W, °C).
export function solarPower({ G, area, eta, T, shade = 0, fSoil = 1 }) {
  const s = S();
  const G_eff = Math.max(0, G) * (1 - shade);                    // G_eff = G(1 − shade)
  const P_dc = area * G_eff * eta;                               // P_dc = N·A·G_eff·η (area = N·A_panel)
  const T_cell = T + G_eff / s.G_noct * s.dT_noct;               // T_cell = T + G_eff/800·25
  const tempFactor = Math.max(0, 1 - s.gamma * (T_cell - s.T_ref)); // bracket clamped at 0
  const P_ac = P_dc * tempFactor * s.etaInv * fSoil;             // P_ac = P_dc(1−γ(T_cell−25))η_inv·f_soil
  return { G_eff, P_dc, T_cell, tempFactor, P_ac };
}

// §5.4 an array of a tier: area = modules × 1.7 m²
export function arrayPower(arr, G, T, shade) {
  const s = S();
  return solarPower({ G, area: arr.modules * s.A_panel, eta: s.etaPanel[arr.tier], T, shade, fSoil: arr.f_soil ?? 1 }).P_ac;
}

// §5.5 shade = k_shade·N_wind/N_tiles + k_coloc·[tile also holds wind]
export function solarShade(nWind, colocated) {
  const p = PC();
  return p.k_shade * nWind / p.nTiles + (colocated ? p.k_coloc : 0);
}

// §5.5 recompute layout factors for a site (on layout change and hourly, never per step).
// Wind turbines and arrays carry .parcel and optional .tile. Returns {wakeByParcel, shadeByArray}.
export function layoutFactors(site) {
  const wakeByParcel = {}, shadeByArray = {};
  const wt = site.windTurbines || [];
  const parcels = new Set(wt.map(t => t.parcel ?? 1));
  for (const p of parcels) wakeByParcel[p] = wakeFactor(wt.filter(t => (t.parcel ?? 1) === p).map(t => t.tier));
  for (const a of site.arrays || []) {
    const onParcel = wt.filter(t => (t.parcel ?? 1) === (a.parcel ?? 1));
    const coloc = a.tile != null && onParcel.some(t => t.tile === a.tile);
    shadeByArray[a.id] = solarShade(onParcel.length, coloc);
  }
  return { wakeByParcel, shadeByArray };
}

// §5.6 site renewables for the current hour weather {G, T, u2}. Writes P (W) on each unit; returns totals.
export function updateSiteRenewables(site, wx) {
  const { shadeByArray } = layoutFactors(site);
  let P_solar = 0, P_wind = 0;
  for (const a of site.arrays || []) { a.P = arrayPower(a, wx.G, wx.T, shadeByArray[a.id]); P_solar += a.P; }
  const wt = site.windTurbines || [];
  const byParcel = {};
  for (const t of wt) (byParcel[t.parcel ?? 1] ||= []).push(t);
  for (const list of Object.values(byParcel)) {
    const r = parcelWind(list, wx.u2);
    list.forEach((t, i) => { t.P = r.each[i]; });
    P_wind += r.total;
  }
  return { P_solar, P_wind };
}
