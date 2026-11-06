// Per-step plant solve (§2.7 steps 2–5), composing hydraulics, reservoirs and wear.
// The engine applies actions (step 1) by writing unit.targetPct, then calls solvePlant,
// then stepReservoirs with the returned Q_up. solvePlant does NOT move water itself.
import { CONFIG } from '../config.js';
import { penstockLoss, solveHydraulics, applyMinFlow, rampFlow } from './hydraulics.js';
import { interlockLimit } from './reservoirs.js';
import * as Wr from './wear.js';

function spec(u) { return (u.kind === 'pump' ? CONFIG.pumps : CONFIG.turbines)[u.tier]; }

function unitParams(u) {
  const c = spec(u);
  const isPump = u.kind === 'pump';
  return {
    Q_max: c.Q_max,
    Q_des: CONFIG.turbineQdesFrac * c.Q_max,           // Q_des = 0.9·Q_max (§2.4, §2.5)
    etaRated: isPump ? c.eta_p : c.eta_t,
    H_des: isPump ? c.H_des : (c.H_band[0] + c.H_band[1]) / 2,  // middle of band (§2.4)
    P_rated: c.P_rated,
  };
}

// Unit unavailable: tripped (health < 5 %) or under repair (§4.3, §4.4)
export function unitOffline(site, u) {
  if (Wr.isTripped(Wr.healthOf(u))) return true;
  return (site.jobs || []).some(j => j && j.type === 'repair' && j.unitId === u.id);
}

// Plant mode is exclusive (§2.3): a mode with flowing units keeps it until all flows are 0.
export function plantMode(site) {
  if (site.pumps.some(u => u.Q > 0)) return 'pump';
  if (site.turbines.some(u => u.Q > 0)) return 'gen';
  if (site.turbines.some(u => u.targetPct > 0 && !unitOffline(site, u))) return 'gen';
  if (site.pumps.some(u => u.targetPct > 0 && !unitOffline(site, u))) return 'pump';
  return 'idle';
}

export function solvePlant(site, dt) {
  const up = site.reservoirs.upper, lo = site.reservoirs.lower;
  const pipe = site.penstock;
  const mode = plantMode(site);
  const all = [...site.turbines, ...site.pumps];
  const alerts = [];
  // Step 2: setpoints (min-flow rule), ramp; inactive kind ramps to 0; trip forces 0.
  const prevQ = new Map(all.map(u => [u, u.Q]));
  for (const u of all) {
    const p = unitParams(u);
    const active = (mode === 'gen' && u.kind === 'turbine') || (mode === 'pump' && u.kind === 'pump');
    if (unitOffline(site, u)) { u.Q = 0; continue; }
    const Qset = active ? applyMinFlow(Math.max(0, u.targetPct) * p.Q_max, p.Q_max) : 0;
    u.Q = rampFlow(u.Q, Qset, p.Q_max, dt);           // dQ/dt = ±Q_max/60 s
  }
  // Interlock (§3.2): scale active flows by one factor
  const act = mode === 'pump' ? site.pumps : mode === 'gen' ? site.turbines : [];
  const Qsum = act.reduce((a, u) => a + u.Q, 0);
  if (Qsum > 0) {
    const { factor } = interlockLimit(mode, Qsum, up, lo, dt);
    if (factor < 1) {
      for (const u of act) u.Q *= factor;
      if (factor === 0) alerts.push({ type: mode === 'pump' ? 'interlock_pump' : 'interlock_gen' });
    }
  }
  // Steps 3–4: hydraulics + cap pass
  const H_g = up.z - lo.z;                             // H_g = z_upper − z_lower (§2.1)
  const params = act.map(u => ({ ...unitParams(u), Q: u.Q, etaMult: Wr.etaMult(Wr.healthOf(u)) }));
  const hy = act.length
    ? solveHydraulics(mode, H_g, params, pipe)
    : { ...penstockLoss(0, pipe.D, pipe.L, pipe.epsilon, pipe.sumK), Q_pen: 0, H_g, H_n: H_g, H_dyn: H_g, Q: [], P: [], eta: [] };
  for (const u of all) u.P = 0;
  act.forEach((u, i) => { u.Q = hy.Q[i]; u.P = hy.P[i]; });
  for (const u of all) {
    const Qm = spec(u).Q_max;
    u.openPct = Qm > 0 ? u.Q / Qm : 0;
    u.running = u.Q > 0;
  }
  // Step 5: cavitation and wear (§4). Inactive plant → evaluate with Q = 0 (H_n = H_g).
  const drawdown = Math.max(0, lo.D_max - lo.d);       // tailwater drawdown
  const H_s_eff = Wr.turbineSuctionHead(drawdown);     // H_s,eff = H_s,design + drawdown
  const H_n_cav = mode === 'gen' ? hy.H_n : H_g;
  const sigma = Wr.thomaSigma(H_n_cav, H_s_eff);       // Thoma σ (§4.1)
  const turbines = site.turbines.map(u => {
    const sc = spec(u).sigma_c;
    const margin = sigma === null ? null : sigma / sc;
    return { id: u.id, sigma, margin, penalty: u.Q > 0 ? Wr.cavitationPenalty(sigma, sc) : 0 };
  });
  const pumps = site.pumps.map(u => {
    const c = spec(u);
    const npsh = Wr.npshAvailable(drawdown, u.Q, CONFIG.turbineQdesFrac * c.Q_max);  // NPSH_A (§4.2)
    return { id: u.id, NPSH_A: npsh, margin: npsh / c.NPSH_R, penalty: u.Q > 0 ? Wr.cavitationPenalty(npsh, c.NPSH_R) : 0 };
  });
  const cav = new Map([...site.turbines.map((u, i) => [u, turbines[i]]), ...site.pumps.map((u, i) => [u, pumps[i]])]);
  for (const u of all) {
    let h = Wr.healthOf(u);
    if (prevQ.get(u) === 0 && u.Q > 0) h -= CONFIG.wear.startWearPct;          // start wear (§2.6)
    if (u.Q > 0) h += Wr.wearDelta(u.P, spec(u).P_rated, cav.get(u).penalty, dt); // wear law (§4.3)
    Wr.setHealth(u, h);
    if (Wr.isTripped(h) && u.Q > 0) alerts.push({ type: 'trip', unitId: u.id });
    if (cav.get(u).margin !== null && cav.get(u).margin < CONFIG.wear.marginAlert && u.Q > 0)
      alerts.push({ type: 'cavitation_margin', unitId: u.id, margin: cav.get(u).margin });
  }
  const P_gen = mode === 'gen' ? site.turbines.reduce((a, u) => a + u.P, 0) : 0;
  const P_pump = mode === 'pump' ? site.pumps.reduce((a, u) => a + u.P, 0) : 0;
  const Q_pen = hy.Q_pen || 0;
  return {
    mode, Q_pen, Q_up: mode === 'pump' ? Q_pen : mode === 'gen' ? -Q_pen : 0,  // signed into upper (§3.2)
    v: hy.v, Re: hy.Re, f: hy.f, Hf_major: hy.Hf_major, Hf_minor: hy.Hf_minor, Hf: hy.Hf,
    H_g, H_n: hy.H_n, H_dyn: hy.H_dyn, P_gen, P_pump, lowRe: !!hy.lowRe, capped: !!hy.capped,
    drawdown, H_s_eff, turbines, pumps, alerts,
  };
}
