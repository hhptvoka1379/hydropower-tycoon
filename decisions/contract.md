# Contract agent decisions

## Files
src/config.js, src/state.js, src/rng.js, src/actions.js, src/selftest.js (skeleton), tools/contract-check.mjs.

## Decisions
- **Frustum geometry** (in state.js, needed to derive z_upper_floor): square-based frustum, A(d) = (√A_bot + 2sd)², V(d) = A_bot·d + 2√A_bot·s·d² + (4/3)s²d³. It reproduces Test 11 and §8.5 exactly (217,450.56 / 385,517.53 m³). The Physics agent owns §3 and should reuse `frustumArea/Volume/Depth` or match them.
- **z_lower_floor = 0 m** (CONFIG.start.lower.z_floor). mom ANSWER: §8.3's z_upper_floor ≈ 51.5993 only works with lower floor 0 and fill = 80% of V_max. Physics agent: confirm against §3.1.
- **startFill = 0.8 of V_max**, not of depth (same mom ANSWER).
- z_upper_floor is derived in createInitialState (51.599307 m), never hard-coded.
- **ESM under "type":"commonjs":** src/*.js use ES syntax. Node treats them as CJS, so Node runners must register a load hook that forces `format:'module'` for /src/ (see tools/contract-check.mjs). Orchestrator: you may prefer adding `src/package.json` `{"type":"module"}`. I did not do that because the file is outside my scope.
- Arrays indexed by tier (`CONFIG.pumps[1]` etc.). Index 0 is null.
- Soiling cleaning price $0.80/kW is stored as quoted in §8.6, without CAPEX_SCALE. Economy agent: confirm whether it is scaled.

## Constants left for owning agents (not invented here)
- §2 hydraulics: Colebrook/Swamee–Jain parameters, hill-curve shape, valve ramp rates, flow clamps, minimum head.
- §3 reservoirs: evaporation, spill, minimum operating depths, river inflow (§5.2 river scale).
- §4 wear/cavitation: atmospheric head (10.33), vapor head, wear rates, repair costs and times.
- §5 climate/renewables: wind T1–T3 specs, solar T1–T3 specs (module power, η, temperature coefficients), weather generator parameters, event probabilities.
- §6 market: price curve, duck-curve parameters, forecast error, emergency state.
- §7 finance: loans, credit, emergency loan, contracts, interest, LCOS parameters (CAPEX_SCALE = 0.04 is set here from §8.1).
- §8 parts not given numerically: permit prices, BUY_SITE prices, battery specs, excavation days for the upper reservoir.
- §9 quests/automation/alerts, §10 settings options, §12 robustness-sweep parameters.

## SPEC-GAP / CONFLICT
None. One mom consult (ANSWER) about z_lower_floor and fill basis, logged above.
