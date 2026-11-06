// Physics self-tests (§12 rows 1, 2, 3, 4, 8, 11, 14). Run: node tests/physics.test.mjs
import * as H from '../src/sim/hydraulics.js';

const rows = [];
function check(id, name, expected, actual, tol) {
  const t = tol ?? Math.max(Math.abs(expected) * 1e-3, 1e-9);
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= t;
  rows.push({ id, name, expected, actual: +actual.toPrecision(10), tolerance: t, pass });
}

// ---- Test 1 (pure) ----
{
  const L = H.penstockLoss(2, 1, 60, 0.0003, 2.1);
  check(1, 'v', 2.546, L.v); check(1, 'Re', 2.546e6, L.Re);
  check(1, 'f', 0.015307, L.f); check(1, 'Hf_major', 0.3036, L.Hf_major);
  check(1, 'Hf_minor', 0.6941, L.Hf_minor); check(1, 'Hf', 0.9976, L.Hf);
  const Hn = 50 - L.Hf; check(1, 'H_n', 49.002, Hn);
  check(1, 'P_gen kW', 817.2, H.turbinePower(Hn, 2, 0.85) / 1e3);
  // ---- Test 2 (pure) ----
  const Hd = 50 + L.Hf; check(2, 'H_dyn', 50.998, Hd);
  const Pp = H.pumpPower(Hd, 2, 0.80); check(2, 'P_pump MW', 1.2507, Pp / 1e6);
  check(2, 'RTE', 0.6534, H.turbinePower(Hn, 2, 0.85) / Pp);
}
// ---- Test 14 (pure) ----
{
  check(14, 'eta H55 Qdes', 0.85, H.turbineEfficiency(0.85, 55, 55, 1.98, 1.98));
  check(14, 'eta H49 Qdes', 0.8331, H.turbineEfficiency(0.85, 49, 55, 1.98, 1.98));
  check(14, 'eta H55 Q1.10', 0.7828, H.turbineEfficiency(0.85, 55, 55, 1.10, 1.98));
  const em = 1 - 0.05 * (1 - 50 / 100);
  check(14, 'eta_mult h50', 0.975, em);
  check(14, 'eta h50', 0.8288, H.turbineEfficiency(0.85, 55, 55, 1.98, 1.98, em), 0.0005);
}

// ---- Test 3: frustum ----
import * as R from '../src/sim/reservoirs.js';
import { createInitialState } from '../src/state.js';
import { CONFIG } from '../src/config.js';
{
  const res = { A_bot: 10000, s: 1, D_max: 20, d: 0 };
  const A = R.areaAt(res, 10), V = R.volumeAt(res, 10);
  check(3, 'A(10)', 14400, A); check(3, 'V(10)', 121333.33, V);
  check(3, 'closed form diff', 0, V - 10 / 3 * (10000 + A + Math.sqrt(10000 * A)), 1e-6);
  check(3, 'V->d', 10, R.dFromV(res, V, 5), 1e-6);
  // tabulated form reproduces the frustum (A linear only approximately; check self-consistency)
  const tres = { D_max: 20, d: 3, table: R.buildTable(d => 10000 + 400 * d, 20) };
  check(3, 'tab V->d', 13.3, R.dFromV(tres, R.volumeAt(tres, 13.3), 3), 1e-6);
}
// ---- Test 11 ----
{
  const s = createInitialState(12345).sites[0];
  const up = s.reservoirs.upper, lo = s.reservoirs.lower;
  check(11, 'V_max upper', 217450.56, up.V_max);
  check(11, 'gross MWh', 29.04, R.storedEnergyMWh(up.V_max, CONFIG.test11.H_n));
  check(11, 'net MWh', 24.68, R.storedEnergyMWh(up.V_max, CONFIG.test11.H_n, 0.85));
  check(11, 'V_max lower', 385517.5, lo.V_max);
  check(11, 'H_g start', 50, up.z - lo.z, 1e-9);
}
// ---- Test 4: mass conservation, every ladder dt ----
for (const dt of [1, 5, 30]) {
  const s = createInitialState(12345).sites[0];
  const up = s.reservoirs.upper, lo = s.reservoirs.lower;
  for (const [mode, sign] of [['pump', 1], ['gen', -1]]) {
    const u0 = up.V, l0 = lo.V;
    for (let t = 0; t < 3600; t += dt) {
      const f = R.interlockLimit(mode, 1, up, lo, dt).factor;
      R.stepReservoirs(up, lo, { Q_up: sign * 1 * f }, dt);
    }
    check(4, `dt=${dt} ${mode} dV_upper`, sign * 3600, up.V - u0, 1e-6);
    check(4, `dt=${dt} ${mode} dV_lower`, -sign * 3600, lo.V - l0, 1e-6);
    check(4, `dt=${dt} ${mode} sum`, 0, (up.V - u0) + (lo.V - l0), 1e-9);
  }
}
// ---- Penman (Test 7 numbers, owned by tests/climate but formula lives here) ----
check(7, 'Penman E', 9.73, R.penmanEvaporation(25, 0.5, 3, 250), 0.05);

// ---- Test 8: cavitation (pure + sim start) ----
import * as Wr from '../src/sim/wear.js';
{
  check(8, 'sigma Hs=3', 0.14469, Wr.thomaSigma(49, 3.0));
  const s6 = Wr.thomaSigma(49, 6.0);
  check(8, 'sigma Hs=6', 0.08347, s6);
  check(8, 'penalty Hs=6', 10, Wr.cavitationPenalty(s6, 0.10));
  check(8, 'NPSH static', 8.59, Wr.npshAvailable(0, 0, 0.72));
  check(8, 'NPSH 7m drawdown', 1.59, Wr.npshAvailable(7, 0, 0.72));
  const lo = createInitialState(12345).sites[0].reservoirs.lower;
  const dd = lo.D_max - lo.d;
  check(8, 'start drawdown', 2.2757, dd, 0.0005);
  const sg = Wr.thomaSigma(49, Wr.turbineSuctionHead(dd));
  check(8, 'sim sigma start', 0.1391, sg, 0.002);
  check(8, 'sim margin', 1.39, sg / CONFIG.turbines[1].sigma_c, 0.02);
  check(8, 'sim penalty', 0, Wr.cavitationPenalty(sg, CONFIG.turbines[1].sigma_c));
  // §4.4 example: Tier-1 turbine at 50% → $900, 10 h
  check(0, 'repair cost', 900, Wr.repairCost(50, Wr.unitCapex('turbine', 1)));
  check(0, 'repair hours', 10, Wr.repairHours(50));
}

// @@MORE@@

console.table(rows);
const nPass = rows.filter(r => r.pass).length;
console.log(`physics tests: ${nPass}/${rows.length} passed`);
process.exit(nPass === rows.length ? 0 : 1);
