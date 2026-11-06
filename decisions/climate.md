# Climate & Market agent decisions

## Resume
- Done and tested: src/config/climate.js (all §5/§6 constants), src/sim/market.js (§6). The tests/climate.test.mjs market rows: 18/19 pass. The one failure is a spec CONFLICT (below), and the expected value was left unchanged.
- Not started: src/sim/renewables.js (§5.3–5.5, Tests 5, 6), src/sim/climate.js (§5.1–5.2, Test 7 climate part).
- Stopped on a CONFLICT per the rules. Next step after it is resolved: renewables.js, then append its rows to tests/climate.test.mjs. The test harness already tries to import tests/climate.renew.part.mjs, which is the file I was going to write those rows in.
- Open questions: (1) the Test 9 −63 conflict; (2) Penman E belongs to Physics §3.3. climate.js must receive a Physics evaporation function, and I cannot import it because sim files may only import config/state/rng. Proposal: generateDay(state, evapFn) gets it injected by the engine.

## Decisions
- Market draw order per hour on the `market` stream: ε (±3), then the forecast error e (±0.10). One record per hour {hourIndex, Pb, R_reg, clean, eps, unclamped, price, forecast, lambda} goes into state.market.prices. priceAt/forecastAt/auditHour read it purely.
- meritPrice(Pb, T, R) takes P_base explicitly so the audit can evaluate arbitrary P_base.
- Test 13 is also checked with per-step summation at dt=30 (same $566.25).

## mom consults
- Test 7 Penman: ANSWER. Climate does not implement Penman. It calls the §3.3 Physics function and owns only the year-1 check that daily E stays in [0,16] and that E = 0 when T̄ < 0.
- Test 9 "−63 before clamp": CONFLICT. The §6.2 formula gives 90·(1−1.5·525/400) = −87.1875. The same formula gives the quoted −26.16 for P_base=27. mom: −63 is a spec error, and the orchestrator should change it to −87.19 in §6.2 and §12 Test 9. The clamped −50 passes.
