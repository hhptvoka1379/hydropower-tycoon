# 10 — ENGINE agent (wave A)

Read `_common.md` first. Name: `engine`. Branch: `agent/engine`. Model suggestion: strongest available, low/medium reasoning (quiet numerical/ordering errors are the risk).

## Mission
Wire the finished physics, climate, market and economy modules into one deterministic step pipeline, and expose the game API the UI will use. After this wave the whole game can be played headless.

## Spec chunks you may read
`s00`, `s01`, `s02` (esp. §2.6–2.8, the order of computation), `s03` (§3.2 step order, spill/fine order), `s07` (§7.2 settlement), `s11` (all), and Test rows **4, 12 (sim part only, no battery/reserve yet), 15, 24, 25** of `s12`. Also read `PROGRESS.md` §11–§15 for the hand-offs of the finished modules (call signatures, state keys, who charges what).

## Your files
`src/sim/engine.js`, `src/game.js`, `src/sim/sites.js` **only the minimal site create/lookup helpers the engine needs** (the full multi-site rules belong to the Gameplay agent: keep it to `getSite`, `forEachSite`, `createSite` wrappers around existing state helpers), `tests/engine.test.mjs`, `decisions/engine.md`.

## What to build
1. `SimEngine`: `createEngine(state)` returning `{ step(dt), stepTo(...), dispatch(action), stateHash(), getSnapshot() }` (names may adapt to `src/selftest.js`). One fixed step: apply queued actions at the start of the step, then run the pipeline of §2.7 in exactly the specified order for every site: weather read → renewables → plant solve (`solvePlant`) → reservoirs (`stepReservoirs`, using Q_up) → wear → economy `accumulateStep` (add `envUnmet` to `finedVolume`) → clock advance. Steps never cross an hour boundary. At each hour boundary call `climate.updateHour`, then `economy.settleHour` with the hour's price. At each day boundary call `climate.dayBoundary` and `construction.soilingDayAll`. Every step call `construction.advanceJobs`. Initial game: `climate.initClimate`.
2. Action handling for the actions that already have owners: `SET_SPEED PAUSE TURN_STEP SET_FLOW SET_MODE SET_CURTAIL PLACE_DAM RAISE_DAM EXCAVATE BUILD REPLACE_PENSTOCK CLEAN_ARRAY REPAIR TAKE_LOAN REPAY_LOAN SIGN_CONTRACT`. Validate, charge `job.cost` against `availableBudget`, reject with a reason otherwise (never throw). `BUY_PERMIT BUY_SITE SET_RESERVE_OFFER SET_RULES CLAIM_QUEST` are Gameplay's: route them to a registry (`registerActionHandler(type, fn)`) that Gameplay fills; unregistered types return a clear rejection.
3. Hook registry for the gameplay layer: `registerStepHook(phase, fn)` with phases at the points the Gameplay agent needs (before-plant: automation/rules and reserve calls set targets; after-plant: battery/services; hourly; daily). Document the phases in `decisions/engine.md`. Empty hooks must be no-ops, not stubs that fake behaviour.
4. `src/game.js`: the rAF loop of §11.3 (accumulate real time, speed ladder, ≤40 ms per frame budget with carry-over), `Game.dispatch`, `Game.getSnapshot()` (immutable copy for rendering), the top-level `try/catch` that pauses and keeps the last good snapshot (§11.6). Loop code must guard `requestAnimationFrame` so the engine also runs under Node.
5. Place the plant-result fields that Physics said had no state keys (Hf_major, Hf_minor, σ margin, NPSH margin, etc.) under a nested per-site `live` object that is part of the snapshot (nested keys only; do not add top-level state keys). Record it in `decisions/engine.md` and `PROGRESS.md`-ready text in your PR.

## Tests you must make pass (exact values from `s12`)
4 (conservation of mass and sign, through the real engine: ΔV = ±3600 m³ for 1 m³/s over 1 h, sum 0, at dt 1/5/30), 15 (per-step netting), 12 sim-part (3 game days at each step size across day 91→92 with units at max, alternating pump/generate every 6 h, heat wave, storm rain: no NaN/Infinity, volumes within [0, V_max], health within [0,100]), 25 (step cost; warns, does not fail). **Test 24** (pacing) must be implemented and its two numbers **printed**: mean net income per day and the §7.4 payback of the Tier-2 pump+turbine pair. If either is outside its range, **do not retune anything**; report the numbers in the PR (the owner may retune only `CAPEX_SCALE`).

## Done when
`node tests/engine.test.mjs` passes (except documented warn-only/report-only rows), all earlier test files still pass, purity check OK, PR opened with actual numbers.
