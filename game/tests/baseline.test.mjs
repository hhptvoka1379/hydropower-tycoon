/* Golden numbers: recompute the baseline scenarios and compare with game/tests/baseline.json (recorded by `node game/tests/record-baseline.mjs`).
   Tolerances are small (money 0.05% or $5, metres 0.005, counts exact): they catch unintended drift, not engine-level float noise.
   After an INTENDED behaviour change, re-record the file and review the diff. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {measureStarts, measureDamPrices, measureBattery, measureGod, measureReserve} from './measure.mjs';

const BASE = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./baseline.json', import.meta.url)), 'utf8'));
const TOL = {money: {rel: 5e-4, abs: 5}, metres: {rel: 0, abs: 5e-3}, ratio: {rel: 1e-3, abs: 0}, mwh: {rel: 5e-4, abs: 0.05}, exact: {rel: 0, abs: 0}};

/* Walks expected vs actual; `kind(path)` picks the tolerance class by key name. Returns a list of mismatch strings. */
function diff(exp, act, path, out) {
  if (typeof exp === 'number') {
    const k = /(^|\.)(hU|hL|head)$/.test(path) ? 'metres' : /ratio/i.test(path) ? 'ratio' : /genMWh|throughput/.test(path) ? 'mwh' : /profitDays|\.n$|dt\d+$|\.tier$/.test(path) ? 'exact' : 'money';
    const t = TOL[k]; const d = Math.abs(act - exp);
    if (!(typeof act === 'number' && d <= Math.max(t.abs, t.rel * Math.abs(exp)))) out.push(path + ': baseline ' + exp + ' now ' + act + ' (tol ' + k + ')');
  } else if (exp && typeof exp === 'object') {
    for (const key of Object.keys(exp)) diff(exp[key], act == null ? undefined : act[key], path + (Array.isArray(exp) ? '[' + key + ']' : '.' + key), out);
  } else if (exp !== act) out.push(path + ': baseline ' + exp + ' now ' + act);
  return out;
}
const check = (name, exp, act) => { const out = diff(exp, act, name, []); assert.equal(out.length, 0, 'drift from baseline.json (re-record if intended):\n  ' + out.join('\n  ')); };

test('baseline file is present and has every section', () => {
  assert.equal(BASE.schema, 'dam-game-baseline');
  for (const k of ['starts', 'damPrices40m', 'battery', 'god', 'reserveCallsOk']) assert.ok(BASE[k], 'missing section ' + k);
  assert.deepEqual(Object.keys(BASE.starts), ['classic_14692', 'canyon_4242', 'canyon_99', 'canyon_31337']);
});
test('baseline: 10-day and 30-day cash, income and lake levels (classic 14692, canyon 4242 / 99 / 31337)', () => {
  check('starts', BASE.starts, measureStarts());
});
test('baseline: 40 m dam price, one-shot vs staged routes', () => {
  check('damPrices40m', BASE.damPrices40m, measureDamPrices(4242));
});
test('baseline: battery quote vs realised value', () => {
  check('battery', BASE.battery, measureBattery());
});
test('baseline: god mode on vs off, 30 days', () => {
  check('god', BASE.god, measureGod());
});
test('baseline: reserve calls ok at dt 1 / 5 / 30 / 60 / 120 / 300 s', () => {
  check('reserveCallsOk', BASE.reserveCallsOk, measureReserve());
});
