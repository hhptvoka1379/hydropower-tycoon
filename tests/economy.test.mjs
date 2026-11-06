// Economy self-tests (§12 rows 10, 16, 21, 22) plus extra checks. Run: node tests/economy.test.mjs
import { CONFIG } from '../src/config.js';
import { createInitialState } from '../src/state.js';
import * as E from '../src/sim/economy.js';
import * as C from '../src/sim/construction.js';
import * as K from '../src/sim/canyon.js';
import { maxVolume, areaAt } from '../src/sim/reservoirs.js';
import { createRngState } from '../src/rng.js';

const rows = [];
function check(id, name, expected, actual, tol) {
  const t = tol ?? Math.max(Math.abs(expected) * 1e-4, 1e-9);
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= t;
  rows.push({ id, name, expected, actual: +Number(actual).toPrecision(10), tolerance: t, pass });
}
const flag = (id, name, ok) => rows.push({ id, name, expected: true, actual: !!ok, tolerance: 0, pass: !!ok });

// ---- Test 10: economic sign and NPV ----
{
  const st = createInitialState(1);
  const cash0 = st.finance.cash;
  // pump takes 1 MW for 1 h (3600 steps of dt = 1 s collapsed to 120 steps of 30 s), no generation
  for (let i = 0; i < 120; i++) E.accumulateStep(st.finance, { P_pump: 1e6, lambda: 0, dt: 30 });
  check(10, 'E_bought MWh', 1, st.finance.hourly.E_bought);
  const rec = E.settleHour(st, { price: -10, day: 1, hour: 9, C_MW: 0 });
  check(10, 'revenue term (E_sold−E_bought)·Price₀ = +$10', 10, rec.revenue);
  // cash change = +10 − O&M (0.10·1 MWh throughput, §7.2); add O&M back to isolate the sign
  check(10, 'cash rise before O&M', 10, st.finance.cash - cash0 + rec.om);
  check(10, 'AF (r=5%, N=10)', 7.72173, E.annuityFactor(0.05, 10), 5e-6);
  check(10, 'NPV', 5443.47, E.npv(10000, 2000, 10, 0.05), 5e-3);
  // a plant selling at a negative price loses money
  const st2 = createInitialState(1);
  for (let i = 0; i < 120; i++) E.accumulateStep(st2.finance, { P_gen: 1e6, lambda: 0, dt: 30 });
  flag(10, 'sell at negative price loses money', E.settleHour(st2, { price: -10, day: 1, hour: 9, C_MW: 0 }).revenue < 0);
}

// ---- Test 16: soiling dynamics ----
{
  let f = 0.60;
  for (let i = 0; i < 10; i++) f = C.soilingDay(f, 0);
  check(16, '10 dry days from 0.60', 0.594, f, 1e-9);
  check(16, 'clean 0.594 -> 0.744', 0.744, C.cleaned(0.594), 1e-9);
  check(16, 'clean 0.90 -> 1.00 cap', 1.0, C.cleaned(0.90), 1e-9);
  check(16, 'rain 0.945 -> 0.950', 0.950, C.soilingDay(0.945, 5), 1e-9);
  check(16, 'rain 0.97 stays 0.97', 0.97, C.soilingDay(0.97, 12), 1e-9);
  let g = 0.5501; for (let i = 0; i < 100; i++) g = C.soilingDay(g, 0);
  check(16, 'floor 0.55', 0.55, g, 1e-12);
  check(16, 'clean job on 535 kW = $428', 428, C.cleanCost(535), 1e-9);
  const st = createInitialState(1);
  const r = C.startCleaning(st.sites[0], 1);
  check(16, 'start job on start array (535.5 kW)', 0.8 * 535.5, r.cost, 1e-6);
  for (let i = 0; i < 24; i++) C.advanceJobs(st.sites[0], 3600);
  check(16, 'array f_soil after job 0.60 -> 0.75', 0.75, st.sites[0].arrays[0].f_soil, 1e-9);
  flag(16, 'job removed, cleaning flag cleared', st.sites[0].jobs.length === 0 && !st.sites[0].arrays[0].cleaning);
}

// ---- Test 21: dam and excavation costs ----
{
  check(21, 'Classic raise cost 50->60', 35200, C.classicRaiseCost(50, 60), 1e-6);
  check(21, 'Classic raise days', 4, C.classicRaiseDays(50, 60), 1e-9);
  const V10 = K.concreteVolume(40, 0.8, 10, 'gravity'), V20 = K.concreteVolume(40, 0.8, 20, 'gravity');
  check(21, 'V_conc(10 m)', 3506.67, V10, 0.02);
  check(21, 'cost(10 m)', 42080, K.damCost(40, 0.8, 10, 'gravity'), 0.3);
  check(21, 'V_conc(20 m)', 11573.33, V20, 0.1);
  check(21, 'cost(20 m)', 138880, K.damCost(40, 0.8, 20, 'gravity'), 1);
  check(21, 'raise cost 10->20', 96800, K.raiseCost(40, 0.8, 10, 20, 'gravity'), 1);
  check(21, 'raise days 10->20', 4, K.raiseDays(10, 20), 1e-9);
  check(21, 'arch V_conc(20 m)', 6906.67, K.concreteVolume(40, 0.8, 20, 'arch'), 0.1);
  check(21, 'arch cost(20 m)', 82880, K.damCost(40, 0.8, 20, 'arch'), 1);
  let inc = true, prev = -1;
  for (let H = 1; H <= 40; H++) { const c = K.damCost(40, 0.8, H, 'gravity'); if (!(c > prev)) inc = false; prev = c; }
  flag(21, 'cost strictly increasing in H', inc);
  const st = createInitialState(1), low = st.sites[0].reservoirs.lower;
  const p = C.excavationPlan(low);
  check(21, 'excavation stage 1 dV', 61998, p.dVmax, 1);
  check(21, 'excavation stage 1 cost', 8240, p.cost, 0.5);
  check(21, 'excavation stage 1 days', 2, p.days, 0);
  // all six V_max values of §8.5
  const exp = [385518, 447516, 509376, 571123, 632775, 694347];
  const site = st.sites[0];
  for (let k = 0; k < 6; k++) {
    check(21, 'lower V_max after ' + k + ' stages', exp[k], site.reservoirs.lower.V_max, 1);
    if (k < 5) { C.startExcavation(site, 'lower'); C.advanceJobs(site, 3 * 86400); }
  }
  flag(21, 'no sixth stage', !C.excavationPlan(site.reservoirs.lower).ok);
  // Classic raise applied through the job queue
  const st2 = createInitialState(1), s2 = st2.sites[0];
  const rr = C.startClassicRaise(s2, 60);
  check(21, 'classic job days', 4, rr.job.secondsLeft / 86400, 1e-9);
  C.advanceJobs(s2, 4 * 86400);
  check(21, 'D_max after raise', 20, s2.reservoirs.upper.D_max, 1e-9);
  flag(21, 'V_max grew', s2.reservoirs.upper.V_max > 217450);
}

// ---- Test 22: loans and LCOS ----
{
  const sch = E.amortizationSchedule(50000, 0.06, 12);
  check(22, 'M $50,000 6% 12 mo', 4303.32, sch.M, 0.005);
  check(22, 'total interest', 1639.86, sch.totalInterest, 0.05);
  check(22, 'final balance', 0, sch.finalBalance, 1e-9);
  const sh = 1230, amt = E.emergencyAmount(sh);
  check(22, 'emergency loan for $1,230 shortfall', 7000, amt, 0);
  check(22, 'emergency M (12%, 6 mo)', 1207.84, E.loanPayment(amt, 0.12, 6), 0.005);
  const AF = E.annuityFactor(0.05, 20);
  check(22, 'AF (r=5%, N=20)', 12.4622, AF, 5e-5);
  check(22, 'LCOS', 20.05, E.lcos(100000, 2000, 500), 0.005);
  flag(22, 'LCOS null at zero energy', E.lcos(1, 1, 0) === null);
  // APR tiers and loan flow through the real state
  check(22, 'APR 25k', 0.06, E.loanApr(25000), 0); check(22, 'APR 25,001', 0.07, E.loanApr(25001), 0);
  check(22, 'APR 100k', 0.07, E.loanApr(100000), 0); check(22, 'APR 100,001', 0.08, E.loanApr(100001), 0);
  const st = createInitialState(1);
  const lim = E.creditLimit(st);
  flag(22, 'credit limit > 25,000 (equipment owned)', lim > 25000);
  const r = E.takeLoan(st, 20000, 12, 1);
  flag(22, 'loan granted', r.ok);
  let paid = 0, day = 1;
  for (let d = 1; d <= 12 * 30; d++) {
    const rec = E.settleHour(st, { price: 0, day: d + 1, hour: 0, C_MW: 0 });
    paid += rec.loanPayments;
  }
  check(22, 'loan cleared after 12 payments', 0, st.finance.loans.length, 0);
  const sch2 = E.amortizationSchedule(20000, 0.06, 12);
  check(22, 'sum of settled loan payments', sch2.M * 11 + sch2.rows[11].payment, paid, 1e-6);
  void day;
  // emergency loan: cash below zero after settlement, then bankruptcy when it recurs
  const s3 = createInitialState(1); s3.finance.cash = 100;
  const a = E.settleHour(s3, { price: 0, day: 1, hour: 9, C_MW: 0, services: -1330 });
  check(22, 'emergency granted via settlement', 7000, a.emergencyGranted, 0);
  check(22, 'cash after emergency', 5770, s3.finance.cash, 1e-9);
  s3.finance.cash = -1;
  flag(22, 'second shortfall -> bankrupt', E.settleHour(s3, { price: 0, day: 1, hour: 10, C_MW: 0 }).bankrupt);
}

// ---- Extra: contract, O&M, NPV helpers ----
{
  const st = createInitialState(1);
  const MW = E.installedMW(st.sites[0]);
  check('x', 'installed MW start plant (0.5+1+0.5355)', 2.0355, MW, 1e-4);
  check('x', 'capacity O&M per day (spec about $7)', 7, 24 * E.omHour(MW, 0), 0.5);
  const con = { C_MW: 0.2, price: 48 };
  const full = E.hourRevenue(0.5, 0, 30, con);
  check('x', 'contract delivered/paid', 0.2 * 48 + 0.3 * 30, full.revenue, 1e-9);
  const short = E.hourRevenue(0.05, 0.1, -10, con);
  check('x', 'shortfall penalty uses max(P,20)', 3 * 20 * 0.15, short.penalty, 1e-9);
  const sg = E.signContract(st, 'large', 1);
  flag('x', 'large contract needs 1.5 MW pumps', !sg.ok);
  flag('x', 'small contract signs', E.signContract(st, 'small', 5).ok);
  check('x', 'E_cycle = min(6, 0.6534·3, 100)', 1.9602, E.eCycle(1, 0.5, 0.6534, 100), 1e-9);
}

// ---- Extra: procedural canyon ----
{
  let valid = 0, firstTry = 0, vm = [];
  for (let seed = 1; seed <= 40; seed++) {
    const g = K.generateCanyon(createRngState(seed));
    if (g) { valid++; if (g.attempts === 1) firstTry++; vm.push(g.Vmax0); }
  }
  vm.sort((a, b) => a - b);
  flag('c', 'every seed yields a valid canyon within 50 retries', valid === 40);
  rows.push({ id: 'c', name: 'first-try rate (spec ~95%), median V_max (spec ~197,000)', expected: '~0.95/~197000', actual: `${firstTry / 40}/${Math.round(vm[20])}`, tolerance: 'info', pass: true });
  const g = K.generateCanyon(createRngState(7));
  const t = g.terrain, x = g.xDam;
  const fine = K.vmaxAt(t, x, 10, true), coarse = K.vmaxAt(t, x, 10, false);
  check('c', 'preview within 3% of fine (10 m)', fine, coarse, fine * 0.03);
  const f20 = K.vmaxAt(t, x, 20, true), c20 = K.vmaxAt(t, x, 20, false);
  check('c', 'preview within 3% of fine (20 m)', f20, c20, f20 * 0.03);
  const g2 = K.generateCanyon(createRngState(7));
  check('c', 'deterministic Vmax0', g.Vmax0, g2.Vmax0, 0);
  const st = createInitialState(7), site = st.sites[0];
  K.applyCanyonToSite(site, t, x);
  check('c', 'procedural upper V_max = table', fine, maxVolume(site.reservoirs.upper), 1e-6 * fine);
  check('c', 'upper at 80%', 0.8 * fine, site.reservoirs.upper.V, 1e-6 * fine);
  const rp = K.startProceduralRaise(site, 20);
  flag('c', 'procedural raise starts', rp.ok);
  C.advanceJobs(site, rp.plan.days * 86400);
  check('c', 'after raise D_max', 20, site.reservoirs.upper.D_max, 0);
  check('c', 'after raise V_max', f20, maxVolume(site.reservoirs.upper), 1e-6 * f20);
  const Wb = K.Wbot(t, x), s = K.slope(t, x);
  const B = 60000, sol = K.solveMaxHeightForBudget(Wb, s, 10, 'gravity', B);
  flag('c', 'budget solver: cost ≤ B < cost of H+1', sol.cost <= B && K.raiseCost(Wb, s, 10, sol.H + 1, 'gravity') > B);
  const ctx = { t, xDam: x, VlowerMax: 385518, eta_t: 0.85 };
  const te = K.solveHeightForEnergy(ctx, 10, 'gravity', 30);
  flag('c', 'target-storage solver finds a height', te && te.H >= 10);
  rows.push({ id: 'c', name: 'median-style numbers: Vmax at 10/15/20/30 m (spec ~0.2/0.47/0.89/2.1 Mm³)', expected: 'info', actual: [10, 15, 20, 30].map(H => Math.round(K.vmaxAt(t, x, H, true) / 1e3) + 'k').join('/'), tolerance: 'info', pass: true });
  void areaAt;
}

let ok = 0;
for (const r of rows) {
  if (r.pass) ok++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  T${r.id}  ${r.name}  expected=${r.expected}  actual=${r.actual}  tol=${r.tolerance}`);
}
console.log(`economy: ${ok}/${rows.length} checks pass`);
if (ok !== rows.length) process.exit(1);
