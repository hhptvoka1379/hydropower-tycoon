/* Records game/tests/baseline.json from the CURRENT sim. Run after an intended behaviour change:  node game/tests/record-baseline.mjs
   baseline.test.mjs compares the sim against this file (small tolerances), so it flags unintended drift only.
   Deterministic: fixed seeds, no clock, no randomness; re-running without changing the sim rewrites an identical file. */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {measureStarts, measureDamPrices, measureBattery, measureGod, measureReserve} from './measure.mjs';

const OUT = fileURLToPath(new URL('./baseline.json', import.meta.url));
const baseline = {
  schema: 'dam-game-baseline',
  version: 1,
  note: 'Golden numbers of the extracted sim (game/sim) with default rules. Re-record with: node game/tests/record-baseline.mjs. Canyon starts: TAKE_LOAN 700000 + PLACE_DAM 12 m, balanced/medium. dayN = state when st.day first reaches N.',
  starts: measureStarts(),
  damPrices40m: measureDamPrices(4242),
  battery: measureBattery(),
  god: measureGod(),
  reserveCallsOk: measureReserve()
};
fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
const f = (x) => Math.round(x).toLocaleString('en-US');
console.log('wrote ' + OUT);
for (const [k, v] of Object.entries(baseline.starts)) console.log(k.padEnd(14), 'cash0', f(v.cash0), '| d10 cash', f(v.day10.cash), 'income', f(v.day10.income), '| d30 cash', f(v.day30.cash), 'income', f(v.day30.income), '| hU/hL d30', v.day30.hU.toFixed(2), v.day30.hL.toFixed(2));
console.log('dam 40 m:', Object.entries(baseline.damPrices40m).map(([k, v]) => k + '=' + (k.startsWith('ratio') ? v.toFixed(2) : f(v))).join('  '));
console.log('battery (quoted vs realised $/day):', baseline.battery.map((b) => 'B' + (b.tier + 1) + ' ' + b.quotedPerDay.toFixed(1) + ' vs ' + b.realisedPerDay.toFixed(1)).join('; '));
console.log('god on/off (30 d income / subsidy):', Object.entries(baseline.god).map(([k, v]) => k + ' off ' + f(v.off.income) + ' on ' + f(v.on.income) + ' sub ' + f(v.on.subsidy)).join('; '));
console.log('reserve calls ok of ' + baseline.reserveCallsOk.n + ':', Object.entries(baseline.reserveCallsOk).filter(([k]) => k !== 'n').map(([k, v]) => k + '=' + v).join(' '));
