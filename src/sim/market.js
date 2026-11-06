// §6 Dynamic grid pricing (duck curve), forecast and market impact. Pure; no DOM.
import { CONFIG } from '../config.js';
import { nextRange } from '../rng.js';

const M = () => CONFIG.market;
const clampPrice = p => Math.min(M().priceMax, Math.max(M().priceMin, p));

// §6.1 P_base(h) = 45 + 30e^{−(h−8.5)²/2} + 45e^{−(h−19.5)²/2} − DIP(h)
export function pBase(h) {
  const m = M();
  const x = Number.isFinite(h) ? h : 0;
  // DIP(h) = 18 sin²(π(h−10)/6) for 10 ≤ h ≤ 16
  const dip = (x >= m.dip.start && x <= m.dip.end) ? m.dip.A * Math.sin(Math.PI * (x - m.dip.start) / m.dip.period) ** 2 : 0;
  const a = Math.max(-700, -((x - m.am.h) ** 2) / 2), b = Math.max(-700, -((x - m.pm.h) ** 2) / 2);
  return m.base + m.am.A * Math.exp(a) + m.pm.A * Math.exp(b) - dip;
}

// §6.1 temperature factors: m_T = 1 + 0.025C + 0.020H, f_D = 1 + 0.010C + 0.008H
export function tempFactors(T) {
  const m = M();
  const C = Math.max(0, T - m.coolBase), H = Math.max(0, m.heatBase - T);
  return { C, H, mT: 1 + m.mT_cool * C + m.mT_heat * H, fD: 1 + m.fD_cool * C + m.fD_heat * H };
}

// §6.2 R_reg = 250·G/1000 + 300·min(1,(u₂/12)³)  [MW]
export function rReg(G, u2) {
  const m = M();
  return m.R_solarMW * Math.max(0, G) / 1000 + m.R_windMW * Math.min(1, (Math.max(0, u2) / m.R_windRef) ** 3);
}

// §6.2 noise-free merit-order price: P_base·m_T·(1 − k·R_reg/(D·f_D)). Takes Pb explicitly so audit can pass any P_base.
export function meritPrice(Pb, T, R) {
  const m = M();
  const { mT, fD } = tempFactors(T);
  const denom = Math.max(1e-9, m.D_total * fD);
  return Pb * mT * (1 - m.k_merit * R / denom);
}

// §6.5 λ(h) = P_base·m_T·k_merit/(D_total·f_D)  [$/MWh per MW]
export function lambdaImpact(Pb, T) {
  const m = M();
  const { mT, fD } = tempFactors(T);
  return Pb * mT * m.k_merit / Math.max(1e-9, m.D_total * fD);
}

// §6.5 Price_eff = Price₀ − λ·P_net  (P_net MW, + export)
export function effectivePrice(price0, lambda, P_netMW) { return price0 - lambda * P_netMW; }

// §6.5 Impact cost of one step: λ·P_net²·dt/3600  [$]; 1 MW × 1 h = 1 MWh
export function impactCost(lambda, P_netMW, dt) { return lambda * P_netMW * P_netMW * dt / 3600; }

// §6.2/§6.3 price one hour from its weather. Draw order (market stream): ε then forecast error e.
// Returns the record stored in state.market.prices.
export function priceHour(rng, hourIndex, w) {
  const m = M();
  const h = ((hourIndex % 24) + 24) % 24;
  const Pb = pBase(h);
  const R = rReg(w.G, w.u2);
  const clean = meritPrice(Pb, w.T, R);
  const eps = nextRange(rng, 'market', -m.noise, m.noise);
  const e = nextRange(rng, 'market', -m.forecastErr, m.forecastErr);
  const unclamped = clean + eps;
  return {
    hourIndex, Pb, R_reg: R, clean, eps, unclamped,
    price: clampPrice(unclamped),                       // Price₀, clamped (§6.2)
    forecast: clampPrice(clean * (1 + e)),              // §6.3 fixed per target hour
    lambda: lambdaImpact(Pb, w.T),                      // §6.5
  };
}

// §6.4 pure reads. hourIndex = (day−1)·24 + hour.
function find(state, hourIndex) {
  const arr = state.market.prices;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].hourIndex === hourIndex) return arr[i];
  return null;
}
export function priceAt(state, hourIndex) { const r = find(state, hourIndex); return r ? r.price : null; }
export function forecastAt(state, hourIndex) { const r = find(state, hourIndex); return r ? r.forecast : null; }
export function auditHour(state, hourIndex) {
  const r = find(state, hourIndex);
  return r ? { P_base: r.Pb, R_reg: r.R_reg, unclamped: r.unclamped, price: r.price } : null;
}
export { clampPrice };
