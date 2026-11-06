// §7 Financial system: per-step netting, hourly settlement, O&M, loans, emergency loan, NPV, LCOS, RTE, firm contract.
// Pure functions over state.finance; no DOM. Money in $, energy in MWh (1 MW × 1 h = 1 MWh), power in W unless named MW.
// Engine API per step:   accumulateStep(state.finance, {P_gen,P_wind,P_solar,P_pump,P_bat_dis,P_bat_ch,lambda,dt,finedVolume})
// Engine API per hour:   settleHour(state, {price, day, hour, services})  (day/hour = the clock AFTER the boundary was crossed)
// state.finance.hourly carries extra nested accumulators: impact ($), E_thru (MWh), fines ($), reported to the orchestrator.
import { CONFIG } from '../config.js';
import { impactCost } from './market.js';
import { windRated } from './renewables.js';
import { ownedEquipmentPrice } from './construction.js';

const F = () => CONFIG.finance;
const finite = x => (Number.isFinite(x) ? x : 0);

// ---------------------------------------------------------------- §1.2 / §7.1 per-step netting
// P_net = P_gen + P_wind + P_solar (+ P_bat,dis) − P_pump (− P_bat,ch)  [W]
export function netPower(p) {
  return finite(p.P_gen) + finite(p.P_wind) + finite(p.P_solar) + finite(p.P_bat_dis) - finite(p.P_pump) - finite(p.P_bat_ch);
}

// One step of netting: E_sold += max(P_net,0)/1e6·dt/3600, E_bought += max(−P_net,0)/1e6·dt/3600 (MWh).
// Also adds the §6.5 impact λ·P_net²·dt/3600, the throughput for §7.2 O&M, fines (§3/§9.5 $/m³) and the gross lifetime counters (§1.2).
export function accumulateStep(fin, p) {
  const dt = p.dt;
  const Pnet = netPower(p);
  const PnetMW = Pnet / CONFIG.energy.wPerMW;
  const k = dt / CONFIG.energy.secPerHour;     // h
  const h = fin.hourly;
  h.E_sold += Math.max(PnetMW, 0) * k;
  h.E_bought += Math.max(-PnetMW, 0) * k;
  h.impact = finite(h.impact) + impactCost(finite(p.lambda), PnetMW, dt);
  // E_thru = pumped + turbined + produced by wind and solar (§7.2) plus battery throughput
  h.E_thru = finite(h.E_thru) + (finite(p.P_gen) + finite(p.P_wind) + finite(p.P_solar) + finite(p.P_pump) + finite(p.P_bat_dis) + finite(p.P_bat_ch)) / CONFIG.energy.wPerMW * k;
  h.fines = finite(h.fines) + F().finePerM3 * Math.max(0, finite(p.finedVolume));
  fin.lifetime.E_gen += finite(p.P_gen) / CONFIG.energy.wPerMW * k;   // gross turbine energy, MWh (§1.2)
  fin.lifetime.E_pump += finite(p.P_pump) / CONFIG.energy.wPerMW * k; // gross pump energy, MWh (§1.2)
  return Pnet;
}

// ---------------------------------------------------------------- §7.2 O&M
// O&M_hour = 0.15·C_MW + 0.10·E_thru
export function omHour(C_MW, E_thru) {
  return F().om.perMWHour * C_MW + F().om.perMWhThru * E_thru;
}

// Installed capacity C_MW: turbines + pumps + wind + solar (STC) + batteries, rated MW (§7.2)
export function solarStcW(arr) { return arr.modules * CONFIG.solar.A_panel * CONFIG.solar.etaPanel[arr.tier] * 1000; } // 1000 W/m² STC (§5.4, §8.6)
export function installedMW(site) {
  let W = 0;
  for (const u of site.turbines) W += CONFIG.turbines[u.tier].P_rated;
  for (const u of site.pumps) W += CONFIG.pumps[u.tier].P_rated;
  for (const w of site.windTurbines) W += windRated(CONFIG.wind.tiers[w.tier].R);
  for (const a of site.arrays) W += solarStcW(a);
  for (const b of site.batteries) W += finite(b.P_rated);
  return W / CONFIG.energy.wPerMW;
}
export function installedMWAll(state) { return state.sites.reduce((s, x) => s + installedMW(x), 0); }
export function installedPumpMW(state) {
  let W = 0;
  for (const s of state.sites) for (const u of s.pumps) W += CONFIG.pumps[u.tier].P_rated;
  return W / CONFIG.energy.wPerMW;
}

// ---------------------------------------------------------------- §7.3 loans
export function loanApr(amount) {
  for (const t of F().loan.aprTiers) if (t.upTo === null || amount <= t.upTo) return t.apr;
  return F().loan.aprTiers[F().loan.aprTiers.length - 1].apr;
}
// M = P·r(1+r)^n / ((1+r)^n − 1), r = APR/12  (r = 0 degenerates to P/n)
export function loanPayment(P, apr, n) {
  const r = apr / 12;
  if (!(n > 0)) return P;
  if (r <= 0) return P / n;
  const g = Math.pow(1 + r, n);
  return P * r * g / (g - 1);
}
// Full schedule: each payment splits into interest r·balance and principal M − interest; the last payment clears the balance exactly.
export function amortizationSchedule(P, apr, n) {
  const r = apr / 12, M = loanPayment(P, apr, n);
  let bal = P, totalInterest = 0;
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const interest = r * bal;
    const pay = k === n ? bal + interest : M;
    const principal = pay - interest;
    bal = k === n ? 0 : bal - principal;
    totalInterest += interest;
    rows.push({ k, payment: pay, interest, principal, balance: bal });
  }
  return { M, rows, totalInterest, finalBalance: bal };
}
export function outstandingPrincipal(fin) {
  let s = 0;
  for (const l of fin.loans) s += l.balance;
  if (fin.emergencyLoan) s += fin.emergencyLoan.balance;
  return s;
}
// Credit limit = $25,000 + 50% of the purchase price (charged) of owned equipment (§7.3)
export function creditLimit(state) {
  return F().loan.creditBase + F().loan.creditEquipFrac * ownedEquipmentPrice(state);
}
// Budget for the Build menu and dam solver: cash + unused credit (§7.3, §8.4)
export function availableBudget(state) {
  return state.finance.cash + Math.max(0, creditLimit(state) - outstandingPrincipal(state.finance));
}
function newLoan(principal, apr, months, day) {
  return { principal, apr, months, payment: loanPayment(principal, apr, months), balance: principal, drawnDay: day, paid: 0 };
}
export function takeLoan(state, amount, months, day) {
  const L = F().loan;
  if (!(amount > 0) || !Number.isFinite(amount)) return { ok: false, reason: 'amount must be positive' };
  if (!Number.isInteger(months) || months < L.minMonths || months > L.maxMonths) return { ok: false, reason: 'term must be 12 to 60 months' };
  if (outstandingPrincipal(state.finance) + amount > creditLimit(state) + 1e-9) return { ok: false, reason: 'credit limit exceeded' };
  const loan = newLoan(amount, loanApr(amount), months, day);
  state.finance.loans.push(loan);
  state.finance.cash += amount;
  return { ok: true, loan };
}
// Early repayment of any amount, no penalty (§7.3). Returns the amount actually paid.
export function repayLoan(state, index, amount) {
  const fin = state.finance, loan = fin.loans[index];
  if (!loan) return { ok: false, reason: 'no such loan' };
  const pay = Math.min(amount, loan.balance, Math.max(0, fin.cash));
  if (!(pay > 0)) return { ok: false, reason: 'nothing to pay' };
  fin.cash -= pay;
  loan.balance -= pay;
  if (loan.balance <= 1e-9) fin.loans.splice(index, 1);
  return { ok: true, paid: pay };
}
// One scheduled payment of a loan. Returns {payment, interest, principal, cleared}.
function chargeLoan(loan) {
  const interest = loan.apr / 12 * loan.balance;
  const last = loan.paid + 1 >= loan.months || loan.balance + interest <= loan.payment;
  const payment = last ? loan.balance + interest : loan.payment;
  const principal = payment - interest;
  loan.balance = last ? 0 : loan.balance - principal;
  loan.paid += 1;
  return { payment, interest, principal, cleared: last };
}
function paymentDue(loan, day, hour) {
  const age = day - loan.drawnDay;
  return hour === 0 && age > 0 && age % F().monthDays === 0;
}
// Emergency loan: shortfall + $5,000 rounded up to the next $1,000, 12% APR, 6 months (§7.3)
export function emergencyAmount(shortfall) {
  const e = F().emergency;
  return Math.ceil((shortfall + e.add) / e.roundTo - 1e-12) * e.roundTo;
}

// ---------------------------------------------------------------- §7.6 firm contract
export function availableContracts(state) {
  const pump = installedPumpMW(state);
  return F().contracts.filter(c => pump + 1e-12 >= c.minPumpMW);
}
export function signContract(state, id, day) {
  const fin = state.finance;
  if (fin.contract) return { ok: false, reason: 'a contract is already active' };
  const c = availableContracts(state).find(x => x.id === id);
  if (!c) return { ok: false, reason: 'contract not available' };
  fin.contract = { id: c.id, C_MW: c.C_MW, price: c.price, startDay: day, endDay: day + F().contractDays };
  return { ok: true, contract: fin.contract };
}
// Contract revenue for one hour. Delivered = min(E_sold, C·1 h), paid at contract price; excess at spot;
// Shortfall = C·1 h − Delivered costs 3·max(Price,20) per MWh (§7.6). Imports always at spot.
export function hourRevenue(E_sold, E_bought, price, contract) {
  if (!contract) return { delivered: 0, shortfall: 0, revenue: (E_sold - E_bought) * price, penalty: 0 };
  const delivered = Math.min(E_sold, contract.C_MW * 1);
  const shortfall = contract.C_MW * 1 - delivered;
  const penalty = F().shortfallMult * Math.max(price, F().shortfallPriceFloor) * shortfall;
  const revenue = delivered * contract.price + (E_sold - delivered) * price - E_bought * price;
  return { delivered, shortfall, revenue, penalty };
}

// ---------------------------------------------------------------- §7.1 hourly settlement
// Profit_hour = (E_sold − E_bought)·Price₀ − Impact − O&M − LoanPayment − Fines + Services (contract replaces the export part, §7.6).
// opts: {price (Price₀, $/MWh of the hour just ended), day, hour (clock after the boundary), services ($), C_MW (installed MW)}
// Returns the record; the engine ends the game when record.bankrupt is true.
export function settleHour(state, opts) {
  const fin = state.finance, h = fin.hourly;
  const endedDay = opts.hour === 0 ? opts.day - 1 : opts.day;   // the settled hour belongs to the previous day at 00:00
  if (fin.contract && endedDay >= fin.contract.endDay) fin.contract = null;   // 30-day contract expired (renewable by signing again)
  const C_MW = opts.C_MW !== undefined ? opts.C_MW : installedMWAll(state);
  const rev = hourRevenue(h.E_sold, h.E_bought, opts.price, fin.contract);
  const om = omHour(C_MW, finite(h.E_thru));
  const impact = finite(h.impact), fines = finite(h.fines), services = finite(opts.services);
  let loanPayments = 0;
  for (let i = fin.loans.length - 1; i >= 0; i--) {
    const l = fin.loans[i];
    if (paymentDue(l, opts.day, opts.hour)) { loanPayments += chargeLoan(l).payment; if (l.balance <= 1e-9) fin.loans.splice(i, 1); }
  }
  const el = fin.emergencyLoan;
  if (el && paymentDue(el, opts.day, opts.hour)) { loanPayments += chargeLoan(el).payment; if (el.balance <= 1e-9) fin.emergencyLoan = null; }
  const costs = impact + om + loanPayments + fines + rev.penalty;
  const profit = rev.revenue - costs + services;
  fin.cash += profit;
  fin.lifetime.revenue += rev.revenue + services;
  fin.lifetime.costs += costs;
  let emergencyGranted = 0, bankrupt = false;
  if (fin.cash < 0) {
    if (!fin.emergencyLoan) {
      emergencyGranted = emergencyAmount(-fin.cash);
      fin.emergencyLoan = newLoan(emergencyGranted, F().emergency.apr, F().emergency.months, opts.day);
      fin.cash += emergencyGranted;
    } else bankrupt = true;     // cash < 0 with an emergency loan active: game over (§7.3)
  }
  const rec = { profit, revenue: rev.revenue, delivered: rev.delivered, shortfall: rev.shortfall, penalty: rev.penalty, impact, om, loanPayments, fines, services, emergencyGranted, bankrupt, E_sold: h.E_sold, E_bought: h.E_bought };
  h.E_sold = 0; h.E_bought = 0; h.impact = 0; h.E_thru = 0; h.fines = 0;
  return rec;
}

// ---------------------------------------------------------------- §7.4 NPV (closed-form annuity, never a loop)
// AF = (1 − (1+r)^−N)/r ; NPV = −CapEx + R_annual·AF, r = 0.05, N = 20
export function annuityFactor(r = F().npv.r, N = F().npv.N) {
  return r > 0 ? (1 - Math.pow(1 + r, -N)) / r : N;
}
export function npv(capex, Rannual, N = F().npv.N, r = F().npv.r) {
  return -capex + Rannual * annuityFactor(r, N);
}
// Annual O&M of a configuration: 0.15·C_MW·8760 + 0.10·E_thru,annual  (§7.2)
export function omAnnual(C_MW, E_thruAnnual) {
  return F().om.perMWHour * C_MW * F().hoursPerYear + F().om.perMWhThru * E_thruAnnual;
}
// Wind/solar estimate: R_annual = 365·Σ_h E_expected(h)·max(0, Price_fc(h)) − ΔO&M_annual
// (E_expected from the 24 h weather forecast with the §5 wake and shading factors; only positive prices count because the player can curtail.)
export function rAnnualRenewable(Eexp24, priceFc24, dOMannual) {
  let s = 0;
  for (let h = 0; h < 24; h++) s += finite(Eexp24[h]) * Math.max(0, finite(priceFc24[h]));
  return F().npv.daysPerYear * s - dOMannual;
}
// mean of the k highest (or lowest) of a price list
export function meanExtreme(prices, k, high) {
  const a = prices.map(finite).sort((x, y) => (high ? y - x : x - y)).slice(0, k);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
// E_cycle = min(6·P_gen,MW, RTE·6·P_pump,MW, E_net,storage)
export function eCycle(Pgen_MW, Ppump_MW, RTE, Enet) {
  const H = F().npv.cycleHours;
  return Math.min(H * Pgen_MW, RTE * H * Ppump_MW, Enet);
}
// Storage estimate: R_annual = 365·ΔE_cycle·(P̄_peak6 − P̄_off6/RTE_new) − ΔO&M_annual, one cycle per day.
export function rAnnualStorage(dECycle, Ppeak6, Poff6, RTEnew, dOMannual) {
  const rte = Math.max(RTEnew, 1e-9);
  return F().npv.daysPerYear * F().npv.cyclesPerDay * dECycle * (Ppeak6 - Poff6 / rte) - dOMannual;
}

// ---------------------------------------------------------------- §7.5 LCOS and RTE
// LCOS = CapEx/(E_annual·AF) + O&M_annual/E_annual in $/MWh discharged; null (shown as an em dash) when E_annual = 0.
export function lcos(capex, omAnn, Eannual, r = F().npv.r, N = F().npv.N) {
  if (!(Eannual > 0)) return null;
  return capex / (Eannual * annuityFactor(r, N)) + omAnn / Eannual;
}
// E_annual: discharged energy over the last 365 days, annualized from the days played when fewer than 365 have passed.
export function annualizeEnergy(Ewindow, daysPlayed) {
  const d = Math.min(365, Math.max(0, daysPlayed));
  return d > 0 ? Ewindow * 365 / d : 0;
}
// RTE = ΣE_gen / ΣE_pump from the gross lifetime counters (§1.2); null before any pumping
export function rte(fin) {
  return fin.lifetime.E_pump > 0 ? fin.lifetime.E_gen / fin.lifetime.E_pump : null;
}
