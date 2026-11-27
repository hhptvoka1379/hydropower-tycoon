# Climate & Market agent decisions

## Resume
- All three modules are written, plus tests: src/config/climate.js, src/sim/market.js (priceDay added), src/sim/renewables.js, src/sim/climate.js. tests/climate.test.mjs runs the market rows inline and loads tests/climate.renew.part.mjs and tests/climate.weather.part.mjs.
- Result: 58/60. Tests 5, 6, 9 and 13 all pass. Test 7: the Penman point via Physics is 9.7347 (pass) and E=0 when T̄<0 passes. The year-1 band [0,16] FAILS: max E is 40.87.
- Stopped on a CONFLICT (consult). Windstorm days force u₂ to 20–30 m/s, and the literal Penman then gives E ≈ 39–41 mm/day (23.8 in winter). Heat-wave days give 16.6–16.8. Needs an orchestrator ruling. Nothing was patched.
- Next step after the ruling: apply it, rerun the tests, then hand back.

## Decisions
- Market draw order per hour on the `market` stream: ε (±3), then the forecast error e (±0.10). One record per hour {hourIndex, Pb, R_reg, clean, eps, unclamped, price, forecast, lambda} goes into state.market.prices. priceAt/forecastAt/auditHour read it purely.
- meritPrice(Pb, T, R) takes P_base explicitly so the audit can evaluate arbitrary P_base.
- Test 13 is also checked with per-step summation at dt=30 (same $566.25).

## Consults
- Test 7 Penman: ANSWER. Climate does not implement Penman. It calls the §3.3 Physics function and owns only the year-1 check that daily E stays in [0,16] and that E = 0 when T̄ < 0.
- Test 9 "−63 before clamp": CONFLICT. The §6.2 formula gives 90·(1−1.5·525/400) = −87.1875. The same formula gives the quoted −26.16 for P_base=27. consult: −63 is a spec error, and the orchestrator should change it to −87.19 in §6.2 and §12 Test 9. The clamped −50 passes.
- Renewables: windPower(v_hub, R) is the pure four-region curve. P_rated is computed as cubic(12) and never stored. wakeFactor uses the mean S_norm over the parcel's turbines. The per-extra-turbine losses of 4.5%, 7.0% and 9.1% and the 0.65 floor are verified in tests. Unit placement uses `.parcel` and `.tile` on wind turbines and arrays (default parcel 1). layoutFactors is meant to be called hourly or on layout change.
- Climate: state.climate gains the sub-keys ar, clouds, events, planned, snowpack (top-level keys unchanged). generateDay(state, D, evapFn) follows the §5.1 draw order: weather (cloud D+1, rain roll, rain N, rain start), then events, then hourly AR T and u. The rain start hour is uniform over the valid starts [0, 24−N], so rain ends by 24:00 (my reading of "random valid hour").
- Events are drawn from the `events` stream. Heat waves and cold snaps are planned on the first generated day of their season, with a bounded 50-try placement for the second event. Windstorm and storm-rain rolls happen every day (fixed order). The windstorm u₂ is drawn once per event and held for the whole event.
- Blade damage uses a hash of (seed, day, turbine id), so the number of player turbines never shifts a stream draw.
- Prices: the engine calls market.priceDay(state, rec) right after generateDay. initClimate and dayBoundary receive priceDayFn and evapFn by injection, because sim modules import only config/state/rng.
- Snowpack: updateHour holds 50% of river rain inflow during a cold snap and releases it evenly over the first day with T̄>2. Limitation: one shared snowpack, and with several sites the hold and release apply to each site's river. The engine must apply current.snowHoldFrac to valley runoff (Physics).
- Test 7 test-side: the test injects Physics's penmanEvaporation through an adapter defined in the test file only.
- consult CONFLICT 2 (Test 7 band against windstorm u₂): see Resume.
