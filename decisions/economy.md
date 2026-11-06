# Economy agent decisions

## Resume
- Done and tested (node tests/economy.test.mjs: 79/79): src/config/economy.js, src/sim/economy.js (Tests 10, 22), src/sim/construction.js (Tests 16, 21 Classic + excavation), src/sim/canyon.js (Test 21 procedural + generator/solvers). `node build/bundle.mjs --check` OK.
- Actual numbers: Test 10 cash +10 (before O&M 0.10), AF 7.721735, NPV 5443.4699. Test 16 0.594 / 0.744 / 1.00 / 0.95 / 0.97 / 0.55 floor, clean $428. Test 21: Classic $35,200 4 d; V_conc 3506.676 -> $42,080.11, 11573.408 -> $138,880.90, raise $96,800.78 4 d, arch 6906.704 = $82,880.45; excavation dV 61,998.40, $8,239.81, 2 d; all six V_max match §8.5. Test 22: M 4303.3215, interest 1639.858, final balance 0, emergency 7000 / M 1207.8386, AF 12.46221, LCOS 20.0485.
- In progress: none. Next: engine wiring (Tests 15, 24 later).
- Open questions: none blocking (see Log).

## Engine API
- Per step: `economy.accumulateStep(state.finance, {P_gen,P_wind,P_solar,P_pump,P_bat_dis,P_bat_ch,lambda,dt,finedVolume})`. Nets §1.2, adds §6.5 impact, throughput, §3 fines ($0.50/m³ on Physics finedVolume), gross lifetime E_gen/E_pump.
- Per hour: `economy.settleHour(state, {price, day, hour, services, C_MW?})` with day/hour = clock after the boundary. Loan payments at hour 0 every 30 days after the draw day. Returns record with `bankrupt`; engine ends the game. Emergency loan handled inside. The §9.5 `envUnmet` charge: engine adds envUnmet·0.50 to `finedVolume`.
- Daily: `construction.soilingDayAll(site, rainMm)`; per step: `construction.advanceJobs(site, dt)` (raise/excavate/clean/repair completion; also procedural raise).
- Actions: construction.startClassicRaise / startExcavation / startCleaning / startRepair, canyon.startProceduralRaise, economy.takeLoan / repayLoan / signContract. Engine validates and charges cash (job.cost) against economy.availableBudget.

## Log
- Solar cleaning $0.80/kW is NOT CAPEX_SCALE-scaled: Test 16 requires 0.80·535 = $428, and §8.6 states it as the charged price.
- Soiling on a rain day: rain replaces the dust loss (no −0.0006 that day), because Test 16 requires 0.97 to stay exactly 0.97 and 0.945 to reach 0.950.
- New nested state keys (reported): `finance.hourly.{impact,E_thru,fines}`; loan records {principal,apr,months,payment,balance,drawnDay,paid}; contract {id,C_MW,price,startDay,endDay}; job shape {type,secondsLeft,cost,...}; `site.kind` becomes 'procedural', `site.terrain = {subSeed,W0,a_w,s0,a_s,S0,x_dam}`, `site.dam.station/H_dam`.
- Test 10 "cash rises by $10": the sign term is exactly +$10; the engine also charges §7.2 O&M on the 1 MWh throughput ($0.10), so the test adds O&M back.
- Credit limit equipment price = charged price of turbines, pumps, wind, arrays and the penstock (not dams, land or reservoirs). LCOS CapEx input is supplied by the caller (hydro prices from construction.js plus dam spend); no state key tracks dam spend.
- Terrain noise: lattice values from a generator seeded by a sub-seed drawn from the `terrain` stream (one draw per attempt); smoothstep interpolation; Σweights normalisation. Sample of 40 seeds: 97.5% pass first try, median V_max(10 m) 209,684 (spec ~197,000), V at 15/20/30 m 442k/836k/2099k for seed 7 (spec ~0.47/0.89/2.1 Mm³). Spec numbers are "about"; not tuned.
- Usable-energy for the target solver uses H_g = 40 + H_dam (§8.4 "about"), configurable via ctx.grossHead.
- Dam class limits H_dam only; the Expansion quest / permit gating is the engine's job.
- Not implemented (not in my chunks): battery specs, permit prices, BUY_SITE prices, Tests 15 and 24.
