// §5.1–5.2 climate checks + Test 7 climate part (year-1 daily E in [0,16], E = 0 when T̄ < 0).
// The evaporation function is Physics's §3.3 penmanEvaporation, injected through a test-only adapter.
import { createInitialState, } from '../src/state.js';
import * as cl from '../src/sim/climate.js';
import * as mk from '../src/sim/market.js';
import { penmanEvaporation } from '../src/sim/reservoirs.js';

const evapAdapter = m => penmanEvaporation(m.T, m.RH, m.u2, m.Rs);   // test-side injection only

function runYear(seed) {
  const s = createInitialState(seed);
  s.clock.hour = 0;
  cl.initClimate(s, evapAdapter, mk.priceDay);
  const days = [cl.dayRecord(s, 1), cl.dayRecord(s, 2)];
  let nan = 0, pMin = Infinity, pMax = -Infinity, melt = 0, river = 0, n = 0;
  const finite = o => Object.values(o).every(v => typeof v !== 'number' || Number.isFinite(v));
  for (let D = 1; D <= 365; D++) {
    s.clock.day = D;
    if (D > 1) days.push(cl.dayBoundary(s, evapAdapter, mk.priceDay));
    for (let h = 0; h < 24; h++) {
      s.clock.hour = h; cl.updateHour(s);
      const c = s.climate.current;
      if (!finite(c) || !c.Q_river.every(Number.isFinite)) nan++;
      const p = mk.priceAt(s, cl.hourIndex(D, h));
      if (!Number.isFinite(p)) nan++; else { pMin = Math.min(pMin, p); pMax = Math.max(pMax, p); }
      melt += c.Q_melt * 3600; river += c.Q_river[0]; n++;
    }
  }
  return { s, days: days.filter(d => d.day <= 365), nan, pMin, pMax, melt, river: river / n };
}

export default function run(check, checkBool) {
  const a = runYear(12345), b = runYear(12345), c = runYear(999);
  // Orchestrator ruling 2026-11-06: the [0,16] band applies to days with no heat wave or windstorm (spec forbids multipliers; literal Penman gives ~40 mm/d in a 25 m/s storm). Event days: finite and >= 0.
  const isEv = d => d.events.includes('heatWave') || d.events.includes('windstorm');
  const Es = a.days.filter(d => !isEv(d)).map(d => d.E);
  checkBool(7, 'year-1 event-free daily E all in [0,16]', true, Es.every(e => e >= 0 && e <= 16));
  check(7, 'year-1 event-free max daily E (info, ≤16)', Math.min(16, Math.max(...Es)), Math.max(...Es));
  checkBool(7, 'event-day E finite and >= 0', true, a.days.filter(isEv).every(d => Number.isFinite(d.E) && d.E >= 0));
  checkBool(7, 'E = 0 on every day with T̄ < 0', true, a.days.filter(d => d.mean.T < 0).every(d => d.E === 0));
  check(7, 'Penman via Physics 25°C/50%/3m/s/250W', 9.73, evapAdapter({ T: 25, RH: 0.5, u2: 3, Rs: 250 }), 0, 0.05);
  checkBool(0, 'no NaN/Infinity in year-1 climate/prices', 0, a.nan);
  checkBool(0, 'prices within [-50,500]', true, a.pMin >= -50 && a.pMax <= 500);
  checkBool(0, 'deterministic: same seed same E series + prices', true, JSON.stringify(a.days.map(d => d.E)) === JSON.stringify(b.days.map(d => d.E)) && JSON.stringify(a.s.market.prices) === JSON.stringify(b.s.market.prices));
  checkBool(0, 'different seed differs', false, JSON.stringify(a.days.map(d => d.E)) === JSON.stringify(c.days.map(d => d.E)));
  check(0, 'spring melt total m³ (§5.2)', 97200, a.melt, 0.01);
  const ev = a.s.climate.events;
  const hw = a.days.filter(d => d.events.includes('heatWave') && d.day >= 183 && d.day <= 274).length;
  const cs = a.days.filter(d => d.events.includes('coldSnap') && d.day <= 91).length;
  checkBool(0, 'heat-wave days in Summer ≥ 3', true, hw >= 3);
  checkBool(0, 'cold-snap days in Winter ≥ 3', true, cs >= 3);
  const sun1 = cl.sunTimes(1 + 0), sMid = cl.sunTimes(228);
  check(0, 'sunrise mid-Winter (day 46−182.5→ day 228 summer peak)', 6.0, sMid.sunrise, 0.001);
  check(0, 'sunset mid-Summer', 20.0, sMid.sunset, 0.001);
  check(0, 'sunrise c=1 winter (day 46)', 8.0, cl.sunTimes(46).sunrise, 0.001);
  check(0, 'sunset c=1 winter (day 46)', 16.5, cl.sunTimes(46).sunset, 0.001);
  check(0, 'Classic site river base = 0 (Winter)', 0, cl.riverBase({ kind: 'classic' }, 10));
  check(0, 'procedural river base Winter 0.09', 0.09, cl.riverBase({ kind: 'procedural' }, 10));
  check(0, 'river rain 10 mm/day', 0.25 * 0.01 * 3e6 / 86400, cl.riverRain(10, false));
  check(0, 'storm rain doubles', 2 * 0.25 * 0.04 * 3e6 / 86400, cl.riverRain(40, true));
  void sun1; void ev;
}
