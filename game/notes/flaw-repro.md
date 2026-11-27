# Flaw reproduction A1-A15 (extracted pure sim)

Measured with `game/tests/flaws.test.mjs` (run `FLAWS_STRICT=1 node --test game/tests/flaws.test.mjs` to see every failure without the todo marker). Line numbers refer to `game/sim/*.js` as of this commit. Sims: classic = seed 14692, canyon = seeds 4242 / 99 / 31337 (balanced, medium river), default rules on, `dt` = 30 s unless stated.

| ID | Reproduced? | Measured numbers | Where in game/sim | Note |
|---|---|---|---|---|
| A1 | YES | God planner, 60 d, protection on vs off (same trajectory, `fin.lifetime` identical): classic subsidy $26,165 (about $436/d) on real income $48,972 (about $816/d), netWorth +$26,165; canyon 4242 subsidy $5,797 (about $97/d) on real income $2,469, netWorth $426,394 vs $420,597, **profitDays 60 vs 31**. | economy.js:settleHour L31 (top-up, also adds to `profitToday`), engine.js:dayBoundary L71 (`profitDays`), economy.js:netWorth L36 (uses `cash`), quests.js L9/L28 | `st.fin.subsidy` already exists and is kept apart from `fin.lifetime`, but `cash`, `profitToday`, netWorth and the win check all include it. Bankruptcy-impossible not separately tested. Tests A1a (netWorth) and A1b (profitDays). |
| A2 | YES | Offer 0.5 MW, `turbine.health=0`, 10 d: revenue $1,107 vs healthy plant $1,107 (identical). 20 d: $2,200 each; dead plant 36 calls, 0 ok, fines $957 (healthy: 28 ok). `reserveCap` = 0 for the dead plant. | economy.js:settleHour L19 (`avail`), actions.js SET_RESERVE_OFFER L85 (only place cap is checked) | Pay is independent of capacity and health. |
| A3 | YES | 40 m wall, seed 4242: one-shot $4,581,829; 20+20 $3,357,609; 32+8 $2,795,594; 32 then 1 m x8 $2,710,832; 5 then 1 m x35 $2,188,825; **max/min = 2.09**. Seed 99: 1.96, seed 31337: 2.07. | construction.js:damCost L48-50 (crest and class of the final height applied to each layer), actions.js PLACE_DAM L34 (via `makeProcSite` L43-44) vs RAISE_DAM L43 | Register figures ($4.68M / $2.86M / $2.25M) are close but not identical. |
| A4 | YES | Day-0 quote vs ceiling (1 cycle/d x RTE x widest forecast spread, minus O&M): B1 $89/d vs $36/d (2.5x), B2 $377/d vs $165/d (2.3x), B3 $962/d vs $430/d (2.2x). Realised over 30 d (baseline): B1 $12.8/d, B2 $66/d, B3 $164/d, i.e. quotes are 5.7-7x realised. Quoted NPV B1 +$173k on $168k, B3 +$2.55M on $1.12M (day 40: +$3.78M). Real throughput ~0.9 cycle/d. | economy.js:quote L60 (battery branch: 6 peak hours at 0.9 x MW and 6 cheap hours at MW, no MWh cap, no RTE), L64 | Register "about 3x too high" holds against the ceiling; against realised value it is worse. |
| A5 | YES (wind, shading, instability); NO (solar sign) | W1 NPV on days 0,45,..,315: -341k -416k -443k -438k **+1,394k** +290k +297k -372k. W3: -886k ... **+4,438k** ... -1,132k. Solar S1: -147k -141k -59k -130k -235k -178k -239k -204k (never changes sign, range $179k on mean $167k). Shading: wind quote on tile 0 (solar) dayRev 54.653 = tile 4 (empty) 54.653. | economy.js:quote L51-65 (24 h forecast x 360), L59 `if(t.solar)lo+=0`, L62 `rev-=0.03*energy*0` | Tests A5a (wind sign), A5b (solar sign, passes), A5c (shading), A5d (range <= 50% of mean). |
| A6 | PARTLY | 12 m dam cost: seed 4242 $237,358, seed 99 **$342,990**, seed 31337 $254,821 vs $300,000 start cash, so affordable on 2 of 3 seeds. Head after 10 d (with loan + 12 m dam): 8.75 m, 9.19 m, 10.76 m (> 10 only on 31337); day 30: 9.16 / 8.72 / 8.48 m. Lower lake at hMax 18 (17.7-18) by day 10-30: river spill keeps it brimming. | config.js proc.lowerHMax L22, fin.startCash L33; construction.js:makeProcSite L35-47; reservoirs.js:stepReservoirs L39-41 | Register's $301,625 and "3-8 m" do not match these seeds (8.5-10.8 m). Direction right. |
| A7 | YES | analytic resVol / flooded terrain (step 5 m): seed 4242 h10/20/28 = 0.793 / 0.711 / 0.631; seed 99 = 0.829 / 0.969 / 1.020; seed 31337 = 0.647 / 0.615 / 0.644. | construction.js:makeProcSite L38 (`a2=w/(2·S0)`, `a3=m/(3·S0)`) | Seed 99 is within 3% only at 24-28 m. See "register wrong" for the cause. |
| A8a | YES | After one rejected `RAISE_DAM 99` at day 2, day 3: replay hash 2087d00a vs live bace175a; the control without a rejection replays exactly. | actions.js:rej L12 (writes `lastReject`), saveload.js:hashState L5 (hashes it), game.js dispatch (logs only accepted actions) | |
| A8b | YES | Emergency schedule over 90 d, seed 3: no offer `30:10+4 34:6+4 58:7+4 71:14+2`; offer 0.05 MW `5:21+3 59:19+2 67:16+3 69:12+3 88:16+3`. | engine.js:hourEvents L61 (draws `events` only while an offer is standing) vs dayBoundary L79/L85 (same stream) | `rng.market` is not consumed anywhere in the sim (seen by grep, not tested). |
| A8c | YES | 48 forced calls, ok at dt 1 / 5 / 30 / 60 = 48, 48, 48, 48; dt 120 = 32, dt 300 = 32. | engine.js:step L50-52 (call timers advance per step), plant.js:stepPlant L63 (delivery window sampled per step), endCall L91 | Register counts (41/49, 28/49, drop at dt >= 60) are wrong; the dt dependence is real. |
| A9 | YES | `bankruptGame()` goes bankrupt at tick 213,696 (day 742, loans $800k). `replay(init, log, untilTick = bankruptTick)` returns; with `untilTick = bankruptTick + 3600` it never returns (killed after 6 s; step() returns 0, tick stays 213,696). | saveload.js:replay L11, engine.js:step L46 (`return 0`) | Hangs only when asked to replay past the bankruptcy tick. The test runs the real `Sim.replay` in a child process with a 6 s timeout (about 6 s of CPU per `npm test` until fixed). |
| A10 | YES | 3 S3 solar + starter array: eRen 3,370 MWh, capH 21,515 MW-h, **bonus $15.67** (CF 0.157 x $100). After day 361 `yr` = {3,391; 21,635} (not reset); at day 720 no second bonus (condition is `day === 360`). | engine.js:dayBoundary L88; economy.js:settleHour L22 | Three tests: A10a scale, A10b every year, A10c reset. |
| A11 | YES (all three, at unit level) | a) f(Re 2299) = 0.0278, f(2301) = 0.0487, **+74.9%**. b) T3 turbine, Hg 10 m: P(qmax 11 m3/s) = 0 W, max 202 kW at 4.35 m3/s; `solveQ` for 50 kW returns 11 m3/s = 0 W. c) `sigmaC` 0.0240 at 100 kW vs 0.1041 at 800 kW (same Q, Hn). | hydraulics.js:hydraulics L10, solveQ L20, cavitation L29 | a) Re 2300 is about 2 L/s, so no gameplay effect. b) and c) imported from `game/sim/hydraulics.js` directly (not in the Sim facade). |
| A12 | YES (b), PARTLY (a) | b) manual 0.3 + god 0.5: sim delivers 0.50 of available; multiplicative would be 0.35. a) planner `natIn` vs real net inflow of the two lakes over the next 24 h, canyon 4242: day 10 2.17 vs 0.86, day 20 2.47 vs -0.04, day 30 2.82 vs -0.17, day 60 14.4 vs -0.03 m3/s (river spills through the lower lake: spillL 1.5-4.4 m3/s, env release 0.36 m3/s). Classic day 10: 0.14 vs 0.30. | god.js:godCtx L41 (`natIn`), L155 (`godCurtail`, fraction of a forecast that already includes manual curtailment), plant.js:stepRenewables L19/L25 (`max(gcur, manual)`) | a) the planner books all river inflow as stored in the upper lake and ignores lower-lake rain, runoff, evaporation, environmental release and spill. Test sums every `natIn*` field of `godCtx`, so a split into upper/lower fields still passes. |
| A13 | YES (a, b, c, d, e) | a) emergency credit on a bankrupt max-loan game: loans $1,050,000 vs maxLoan $800,000. b) idle plant with $800k loan: day 1800 loans $800,000, cash $683,757, not bankrupt (a spend-everything game does go bankrupt at day 742). c) crack at 100% damage: cash, genMWh, lake volumes, dam height bit-identical to a crack-free run (30 d). d) turbine health 98.50 after 60 d: about 4,004 days to zero (god on: about 5,084). e) `healthFloor` 0.85. | actions.js EMERGENCY_CREDIT L96; engine.js:dayBoundary L79-82 (crack only alerts); plant.js:stepWear L81; config.js eff.healthFloor L14 | b, c, d, e use thresholds I proposed (5 y, any visible effect, <= 1,500 d, floor <= 0.7); intended stakes are a design call. Only A13a is unambiguous. |
| A14 | YES (a, b, c, d); PARTLY (e) | a1) classic after one excavation: powerhouse 306.4 m from lake centre, basin needs 314.9 m. a2) zone cache lower radius 365.7 vs 375.9 m (same cached object). a3) after raise 30 to 32 m: dam ring r 284.4 vs 291.4 m. b) seed 3 (two chokes), REPLACE_PENSTOCK 1.8 m HDPE then PLACE_DAM at station 135: penstock back to steel 1.2 m. c) T3 to T1 accepted, charged $60,000, unit busy. d) 18 of 18 corrupted saves accepted (market, fin, god, climate, quests, contracts, stats, rng, alerts, jobs, queue, turbine, pump, penstock, auto, hist, null tile, string volume). e) a 4-ulp change of `cash` changes the hash. | terrain.js:classicLayout L116-117, SC.zones L52 (cache keyed by layout object), construction.js:completeJob raise L61 / excavate L62, actions.js PLACE_DAM L36-38, BUILD L49, saveload.js:validateSave L8-10, hashState L5 | e) cross-engine drift cannot be observed in one engine; the test only asserts the hash tolerates last-bit noise (one of several valid fixes). 32 source lines use sin, cos, exp, pow, log, atan2 or tan. |
| A15 | YES | a) `win.quests` 16, QUESTS 20. b) q9 done after 8 game hours with no player action (`rulesSet` 1 from the wrapper's `SET_RULES`). c) two evening contracts active (second one signed after the day-15 offer refresh), 3 clock hours deliver 0.05 MW: `fulfilledHours` +6. | config.js:win L40; actions.js SET_RULES L90, engine.js:newGame L40 / game.js:newGame; economy.js:settleHour L27; market.js:genContracts L25 | c) only double counts when two active contracts overlap in time; fixed windows (18-21 and 6-9) make that possible only via the 15-day offer refresh. |

## Did not reproduce / register is wrong

- **A5 solar**: the S1 quote never changes sign (always -$59k to -$239k), only its size swings about 4x. Only wind flips sign. The register's wind range (-944k to +802k) is for different days; mine is -443k to +1,394k (W1) and -1,750k to +4,438k (W3).
- **A6**: the register's $301,625 for 12 m and "3-8 m head" do not match the three standard seeds: 12 m costs $237k / $343k / $255k and the head after 10 d is 8.75 / 9.19 / 10.76 m. A 12 m dam is unaffordable on seed 99 only.
- **A7 cause**: `a3 = m/(3·S0)` is correct for a valley with banks of slope m on both sides (A = w·d + m·d², V = (w·h²/2 + m·h³/3)/S0), so the "half of 2m/(3·S0)" explanation is wrong. A width-varying geometric lake over the real `cW(z)` gets within 0.80-0.93 of the terrain; the main error is `a2` using the choke-point width (39 / 80 / 46 m) for the whole lake, where the upstream mean width is 48-84 m. Seed 99 passes at 24-28 m because its choke is wider than its upstream mean.
- **A8c**: dt 60 passes (48/48); only dt >= 120 fails (32/48). The register's 41/49 and 28/49 do not match.
- **A13 "bankruptcy unreachable"**: reachable (day 742) when the player spends the whole loan on non-earning items; an idle or running plant never reaches it in 5 years. Turbine wear takes about 4,000 d at default rules (register: 2,900).
- **A15a** is probably intentional: the UI states "Win: claim 16 and reach $2.5M" (legacy L2713), so 16 of 20 is a documented threshold. The test asserts equality as the register asks; drop it if the design keeps 16.
- **A15c** needs two overlapping active contracts; with the two fixed windows this arises only when the 15-day offer refresh re-offers a block that is still active.
- **A11a** has no effect on any real flow (Re 2300 is about 2 L/s through a 1.2 m pipe).

## Test choices that are mine (not locked rules)

A4 ceiling uses 1 cycle/day and the day's widest forecast spread; A5d allows a 50% range; A10a asks for a bonus above the old $100 cap; A12a tolerance is 0.25 m3/s; A13b/d/e thresholds (5 y, 1,500 d, 0.7); A14e requires a quantised hash; A14d lists 18 required fields; A15a equality.

## Phase 1 outcome (final status per ID)

All A tests in `game/tests/flaws.test.mjs` are enforced by `npm test` (no todo markers left).

| ID | Status | How |
|---|---|---|
| A1-A5, A8-A10, A12-A14d, A15b/c | fixed in batches 1 and 2 | see `phase1a.test.mjs`, `phase1b.test.mjs` |
| A6 | fixed | canyon start cash $420k (`fin.startCashCanyon`; classic stays $300k): a 12 m dam costs 54% / 88% / 60% of it (seeds 4242 / 99 / 31337). The river now leaves the lower lake over an outlet weir (`proc.lowerWeirH` 6 m, `lowerWeirK` 1.2) instead of only at the rim, so the lake settles at 7-8 m and the head after 10 days is 19.5-19.8 m (was 8.7-9.3). Mass balance holds (the weir flow is booked as `spillL`); the planner's `natInflow` mirrors it. |
| A7 | fixed | procedural upper lake V(h) is a table (`upper.tab`, m3 at levels 0..72 m) measured from the drawn terrain at site creation (5 m grid, +-260 m corridor, memoised per seed / bias / river / station), cubic Hermite between nodes. Error vs `floodedVolume`: 0.2-0.8% at 10-28 m on all three seeds (closed form was 20-45% off; no a2/a3 polynomial can follow the S-shaped V/h2 of the terrain). `resLevel(resVol(h)) == h` holds to 1e-6. |
| A14e | fixed | `hashState` quantises non-integer numbers to 10 significant digits. |
| A15a | intended | the test now asserts 16 of 20 quests. |
| housekeeping | done | `god.js` uses `priceAt`; wear is valued with `economy.repairCost`; tier-2 upgrade value is the mean planner gain over 4 seasonal sample days (memoised), not one day x 720; `Game.markDirty()` + cheap `getSnapshot`; `SAVE_VERSION` 2 with "This save is from an earlier version and cannot be loaded". Automation (god) now spends only real cash (never the assisted-mode top-up), which keeps A1a exact. |

## Phase 6 tuning (pacing.test.mjs, bots in bot.mjs)

Constants changed (before -> after). Event reward sizes, quest rewards and the D5 dam formula were not touched.

| Constant | Before | After |
|---|---|---|
| `market.dipBase` / `dipSun` (midday price dip) | 22 / 62 | 12 / 35 |
| `solar.tiers[].costKW` | 950 / 880 / 820 | 140 / 130 / 120 |
| `solar.omKWyr` | 15 | 3 |
| `wind.tiers[].costKW` | 1700 / 1500 / 1350 | 480 / 420 / 380 |
| `wind.omKWyr` | 40 | 15 |
| `battery.tiers[].cost` | 150k / 500k / 1.1M | 30k / 100k / 220k |
| `battery.tiers[].om` ($/h) | 0.6 / 1.6 / 3.2 | 0.15 / 0.4 / 0.8 |
| `land.tileCost` | 18000 | 10000 |
| `god.quoteCycles` (new; was a fixed 1 in the quote) | 1 | 0.6 |
| `fin.startCashCanyon` (new; classic `startCash` unchanged) | 300000 | 420000 |
| `fin.loanRate` | 0.08 | 0.10 |
| `fin.bankrupt` (overdraft limit) | -150000 | -60000 |
| `market.emergBonus` (new, $/MWh delivered in a grid emergency) | - | 40 |

Measured (classic 14692 unless stated): see the report; the targets are asserted in `pacing.test.mjs`.
