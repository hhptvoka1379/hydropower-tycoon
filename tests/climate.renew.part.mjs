// Tests 5 and 6 (pure) plus §5.3/§5.4 table self-consistency. Appends to rows in climate.test.mjs.
import * as rn from '../src/sim/renewables.js';
export default function run(check) {

// Test 5: R = 20 m, tolerance 0.5%
check(5, 'wind v=10', 292.5e3, rn.windPower(10, 20), 0.005);
check(5, 'wind v=12 rated', 505.4e3, rn.windPower(12, 20), 0.005);
check(5, 'wind v=13 capped', 505.4e3, rn.windPower(13, 20), 0.005);
check(5, 'wind v=3 cut-in', 0, rn.windPower(3, 20));
check(5, 'wind v=26 cut-out', 0, rn.windPower(26, 20));
// §5.3 table
check(5, 'T1 P_rated 284 kW', 284e3, rn.windRated(15), 0.005);
check(5, 'T2 P_rated 991 kW', 991e3, rn.windRated(28), 0.005);
check(5, 'T3 P_rated 3.03 MW', 3.03e6, rn.windRated(49), 0.005);
check(5, 'wake T1 per extra', 1 - 0.045, rn.wakeFactor([1, 1]), 0.002);
check(5, 'wake T2 per extra', 1 - 0.070, rn.wakeFactor([2, 2]), 0.002);
check(5, 'wake T3 per extra', 1 - 0.091, rn.wakeFactor([3, 3]), 0.002);
check(5, 'wake floor T3 x5', 0.65, rn.wakeFactor([3, 3, 3, 3, 3]));
check(5, 'storm u2=20 T1 cut-out', 0, rn.parcelWind([{ tier: 1 }], 20).total);

// Test 6
const a = rn.solarPower({ G: 1000, area: 2, eta: 0.20, T: 35, shade: 0, fSoil: 1 });
check(6, 'P_dc', 400, a.P_dc);
check(6, 'T_cell', 66.25, a.T_cell);
check(6, 'temp factor', 0.835, a.tempFactor);
check(6, 'P_ac f_soil=1', 320.64, a.P_ac);
check(6, 'P_ac f_soil=0.6', 192.38, rn.solarPower({ G: 1000, area: 2, eta: 0.20, T: 35, fSoil: 0.6 }).P_ac);
// §5.4 rating at 1000 W/m², 25 °C STC (label rounding, 1%)
for (const [t, kw] of [[1, 51e3], [2, 535e3], [3, 2.24e6]])
  check(6, `T${t} STC rating`, kw, 1000 * 1.7 * [0, 150, 1500, 6000][t] * [0, 0.20, 0.21, 0.22][t], 0.01);
check(6, 'shade 4 wind + coloc', 0.05 * 4 / 16 + 0.03, rn.solarShade(4, true));
}
