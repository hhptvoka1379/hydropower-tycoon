# Physics agent decisions

## Resume
- Done and tested: src/config/physics.js, src/sim/hydraulics.js (Tests 1, 2 pure, 14 pass: f=0.0153075, Hf=0.99762, P_gen=817.21 kW, P_pump=1.25072 MW, RTE=0.65340, η(49)=0.83314, η(Q1.10)=0.78284, η h50=0.82875).
- Done and tested: src/sim/reservoirs.js (Test 3: A=14400, V=121333.333, closed-form diff 0, V->d 10.000000; Test 11: V_max up 217450.563, gross 29.035, net 24.680, V_max low 385517.532, H_g start 50; Test 4: ±3600 exactly, sum 0 at dt 1/5/30; Penman 9.7347).
- Done and tested: src/sim/wear.js (Test 8: σ 0.144694 / 0.083469, NPSH 8.59 / 1.59, start drawdown 2.275703, sim σ 0.139067, margin 1.3907; repair $900 / 10 h).
- Done and tested: src/sim/plant.js (Test 2 sim: pump Q 0.80, P ≤ rated; start wear 0.02 pts; Test 17 informative: Q(45 s)=1.65, P=659.10 kW). ALL 62/62 checks pass; bundle --check OK.
- In progress: none. Next: engine agent wires solvePlant → stepReservoirs.
- Open questions: none.

## Log
- hydraulics: Re<5000 returns f=0.015 and `lowRe:true` in penstockLoss result; dedup "one warning per episode" is left to the caller (pure function has no memory). solveHydraulics does the cap pass exactly once (§2.6).
- applyMinFlow also clamps requests to Q_max (a unit cannot exceed its rated flow; Test 2 sim's 0.80 m³/s comes out of this and the cap pass).
- reservoirs: reuse frustumArea/frustumVolume from src/state.js; own Newton dFromV (tol 1e-6 m³, cap 8, start at previous depth) instead of state.js frustumDepth (50 iter) to follow §3.1 literally. Same formula, same answers.
- Confirmed against §3.1: "80% full" = 80% of V_max by volume, and z_lower_floor = 0 m (§3.1 states both verbatim). Start H_g = 50 exactly (test 11 row).
- Tabulated reservoir: optional nested `table: {h, A[], V[]}` on a reservoir object; whoever builds the procedural dam (§8) must attach it via buildTable(areaFn, D_max). Report to orchestrator: this is a new nested key.
- stepReservoirs returns finedVolume (m³); Economy applies $0.50/m³. Q_env release limited to available water; the §9.5 unmet-volume charge is left to the caller (envUnmet returned).
- wear: state field unit.wear (fraction 0..1, contract key) holds damage; health = 100·(1−wear). No new key added. Start wear 0.02 points = wear += 0.0002.
- Trip/offline is derived, not stored: health < 5 or a site.jobs entry {type:'repair', unitId} in progress. The construction/jobs owner must use that job shape (report).
- plant: solvePlant(site, dt) mutates unit Q/P/openPct/running/wear, returns {mode, Q_pen, Q_up, v, Re, f, Hf_major, Hf_minor, Hf, H_g, H_n, H_dyn, P_gen, P_pump, lowRe, capped, drawdown, H_s_eff, turbines[{sigma,margin,penalty}], pumps[{NPSH_A,margin,penalty}], alerts}. Engine stores Hf_major/Hf_minor etc. where the contract puts them (no state key exists yet; report). Mode is derived from flows (exclusive, switch only once all flows are 0).
- Test 4 is done by calling interlockLimit + stepReservoirs directly at dt 1/5/30 (no engine needed).
