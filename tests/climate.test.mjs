// Headless tests for the climate agent: §12 Tests 5, 6, 7 (climate part), 9, 13.
import * as mk from '../src/sim/market.js';

const rows = [];
function check(id, name, expected, actual, tolRel = 0.001, tolAbs = 1e-9) {
  const tol = Math.max(Math.abs(expected) * tolRel, tolAbs);
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  rows.push({ id, name, expected, actual: +actual.toFixed(6), pass });
}
function checkBool(id, name, expected, actual) { rows.push({ id, name, expected, actual, pass: expected === actual }); }

// ---- Test 9: merit order, temperature, clamp
check(9, 'P_base(0)', 45.00, mk.pBase(0), 0, 0.01);
check(9, 'P_base(8.5)', 75.00, mk.pBase(8.5), 0, 0.01);
check(9, 'P_base(13)', 27.00, mk.pBase(13), 0, 0.01);
check(9, 'P_base(19.5)', 90.00, mk.pBase(19.5), 0, 0.01);
check(9, 'R_reg(900,12)', 525, mk.rReg(900, 12));
check(9, 'Price0 h13 T15', -26.16, mk.meritPrice(mk.pBase(13), 15, 525), 0.001, 0.01);
check(9, 'm_T 35C', 1.275, mk.tempFactors(35).mT);
check(9, 'f_D 35C', 1.11, mk.tempFactors(35).fD);
check(9, 'Price0 h19.5 T35 R100', 75.98, mk.meritPrice(mk.pBase(19.5), 35, 100), 0.001, 0.01);
check(9, 'm_T -11C', 1.32, mk.tempFactors(-11).mT);
check(9, 'Price0 h19.5 T-11 R0', 118.80, mk.meritPrice(mk.pBase(19.5), -11, 0), 0.001, 0.01);
check(9, 'Pb90 R525 unclamped', -87.1875, mk.meritPrice(90, 15, 525));
check(9, 'Pb90 R525 clamped', -50, mk.clampPrice(mk.meritPrice(90, 15, 525)));

// ---- Test 13: market impact
const lam = mk.lambdaImpact(90, 15);
check(13, 'lambda', 0.3375, lam);
check(13, 'export 10MW 1h @60', 566.25, 60 * 10 - mk.impactCost(lam, 10, 3600));
// per-step netting of the same hour at dt=30 gives the same total
let s = 0; for (let t = 0; t < 3600; t += 30) s += 60 * 10 * 30 / 3600 - mk.impactCost(lam, 10, 30);
check(13, 'export 10MW stepped dt=30', 566.25, s);
check(13, 'revenue max P', 133.3333, 90 / (2 * lam));
check(13, 'import 10MW @20 cost', 233.75, 20 * 10 + mk.impactCost(lam, -10, 3600));
check(13, 'Price_eff export', 60 - 3.375, mk.effectivePrice(60, lam, 10));

export { rows, check, checkBool };

// Further modules append rows via dynamic import below.
const extra = [];
try { extra.push(await import('./climate.renew.part.mjs')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }

console.table(rows);
const failed = rows.filter(r => !r.pass).length;
console.log(`${rows.length - failed}/${rows.length} passed`);
process.exitCode = failed ? 1 : 0;
