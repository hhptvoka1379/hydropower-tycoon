# Hydropower Tycoon: Final Prompt (Working Draft)

Nov 5, 2026 · @Alessandro Di Benedetto

## Preamble and deliverable

You are receiving a complete specification for a browser-based pumped-storage hydropower management game, **"HYDROPOWER TYCOON."** Implement exactly what is specified. Every formula, constant and self-test number here has been pre-validated: do not substitute, "improve" or abstract any of them. Where this document is silent, choose the physically realistic option and record the choice in a code comment.

You are the orchestrator (Sonnet, medium effort) of a multi-agent build in a file-editing workspace. You write the contract files, assign focused modules to subagents, verify their output against the self-tests, and bundle the result. For every subagent you spawn, you choose the model and the reasoning effort yourself, from Sonnet at medium effort up to Opus at low effort, with Opus at medium effort only as an escalation after repeated failures, matching both to the difficulty of the module (§13). Subagents never edit another agent's module or the contract.

**Deliverable.** One file, `hydropower-tycoon.html`: HTML5, CSS3 and ES6+, fully self-contained, opens offline from `file://`. There is no line-count target and no practical size limit (expect a few MB at most).

- 3D uses **Three.js**, vendored at a pinned version and inlined in the file, with its MIT license header kept. Bundle it to a classic IIFE script with a bundler (esbuild or rollup), because `file://` blocks module imports and recent Three.js releases ship no classic minified build.
- No CDN, no network requests, no external fonts, images or audio. Everything else is procedural: geometry, textures, shaders.
- Development happens in focused modules (`src/*.js`, `src/*.css`, about 300 to 500 lines each); a deterministic bundler script inlines them into the final file at the end.

**Critical directive.** Real physics only: fluid dynamics, thermodynamics, financial engineering. No abstracted game math. Every tunable constant lives in one `CONFIG` object, and all units are SI.

## 0. Non-negotiables

1. **Contract first.** Before any subagent starts, write `CONFIG` and `createInitialState(seed)` with exact property paths and SI units. Nobody invents or renames state keys.
2. **Headless simulation kernel.** All physics, climate, hydrology, wear, automation and market code (`SimEngine`) has zero DOM, Canvas, WebGL or Three.js dependencies and steps as `(state, config, dt)`. It must run 10,000 ticks in Node in milliseconds.
3. **One-way data flow.** Renderers and UI treat `Game.state` as read-only. All input becomes a structured action, for example `Game.dispatch({type:'SET_FLOW', unitId:1, targetPct:0.85})`, applied at the start of the next physics tick.
4. **Fixed-step simulation** for all physics and economics, with the step sizes of the speed ladder in §1.1 (1, 1, 1, 1, 5 and 30 s, never crossing an hour boundary). Rendering runs on `requestAnimationFrame`; physics never runs at variable dt.
5. **Equations implemented literally**, each with a code comment naming it at its call site.
6. **Zero NaN and zero Infinity, ever.** Guard every division; clamp the arguments of `log10`, `sqrt` and `exp`.
7. **Deterministic.** A seeded mulberry32 PRNG drives all simulation noise (weather, prices, terrain); the seed is stored in the save file; no `Math.random()` in simulation logic. Cosmetic-only visuals (water shimmer, particles) may use a separate seeded RNG that never feeds back into state.
8. **Playable on load**, with no tutorial text wall.
9. **Audit hook.** `SelfTest` runs on page load and headless, prints a `console.table()` of every self-test of §12 plus the robustness sweep, and exposes `window.__HYDRO_AUDIT__ = { allPassed, testResults: [{id, name, expected, actual, tolerance, pass}], robustnessSweep: {ticksRun, nanCount, pass}, stateHash, perf, getSnapshot }`.
10. **Process and output format** follow §13 and §14.

## 1. Global simulation contract

### 1.1 Time system

Game time is hours (0 to 23) and days (1 to 365). A game year is 365 days in four seasons: Winter days 1 to 91, Spring 92 to 182, Summer 183 to 274, Autumn 275 to 365 (91, 91, 92, 91 days). Day 1 is January 1st, 08:00, in Winter.

**Modes.** Real-time (with pause) and turn-based. Both use the identical tick pipeline and the player may switch at any time. Turn-based advances exactly one game hour per press by running that hour's steps back to back.

**Speeds.** At ×1, one real minute is one game hour. Each speed has a fixed physics step `dt` (the tick), defined in `CONFIG`:

| Speed | Game seconds per real second | Physics `dt` (s) | Steps per real second | Real time per game year |
| --- | --- | --- | --- | --- |
| ×1 | 60 | 1 | 60 | 146 h |
| ×2 | 120 | 1 | 120 | 73 h |
| ×4 | 240 | 1 | 240 | 36.5 h |
| ×8 | 480 | 1 | 480 | 18.3 h |
| ×60 | 3,600 | 5 | 720 | 2.4 h |
| ×360 | 21,600 | 30 | 720 | 24 min |

Step rules:

- A step never crosses an hour boundary: `dt_eff = min(dt, seconds until the next hour)`. A speed change takes effect on the next step.
- Every rate limiter (valve ramp, flow clamps, wear, evaporation) is written per second and scaled by `dt_eff`. The robustness sweep (§12) runs at every `dt` in the table.
- Hour boundary: climate update, market update, hourly settlement. Day boundary: weather roll, evaporation budget, quest checks, autosave.
- Loop: each `requestAnimationFrame` adds min(real elapsed, 250 ms) × 60 × speed to an accumulator of game seconds and runs steps while the accumulator holds at least one `dt`. Render at 60 fps and interpolate visuals (water level, rotor spin) between steps. Never run physics inside the rAF callback at a variable `dt`.
- Cost budget: the kernel averages under 0.05 ms per step, which is about 720 steps per real second at the fastest speeds, or under 40 ms of main-thread time per second. Hourly and daily jobs may cost more.

### 1.2 Energy accounting and per-step netting

Power in W is computed on every step and integrated as `E_Wh += P * dt_eff / 3600`. Billing uses MWh. State in a code comment that 1 MW × 1 h = 1 MWh.

The plant nets its own generation and consumption on **every step**, not at the hour boundary:

```latex
P_{net} = P_{gen} + P_{wind} + P_{solar} - P_{pump}
```

```latex
E_{sold} \mathrel{+}= \frac{\max(P_{net},0)}{10^{6}}\cdot\frac{dt_{eff}}{3600}, \qquad E_{bought} \mathrel{+}= \frac{\max(-P_{net},0)}{10^{6}}\cdot\frac{dt_{eff}}{3600}
```

Both accumulators are in MWh. At the hour boundary, `Economy` (§7) multiplies each by that hour's `Price(h)`, settles cash and resets both to 0. Solar produced at 14:50 therefore never offsets pumping done at 14:10; only simultaneous production does.

Keep separate lifetime counters of **gross** turbine energy `ΣE_gen` and gross pump energy `ΣE_pump`, before netting. RTE and LCOS (§7.5) use these, never the netted figures.

### 1.3 Notation (SI units throughout)

| Symbol | Meaning | Units |
| --- | --- | --- |
| `ρ` | water density | 1000 kg/m³ |
| `ρ_air` | air density | 1.225 kg/m³ |
| `g` | gravity | 9.81 m/s² |
| `ν` | water kinematic viscosity (20 °C) | 1.0e-6 m²/s |
| `z`, `z_floor` | water-surface elevation, reservoir floor elevation (`z = z_floor + d`) | m |
| `H_g` | gross head = `z_upper − z_lower` | m |
| `H_n` | net head (generating) | m |
| `H_f` | friction head loss (major + minor) | m |
| `Q` | volumetric flow rate (penstock total = sum over active units) | m³/s |
| `D`, `L` | penstock diameter, length | m |
| `v` | mean flow velocity = `Q / A_pipe` | m/s |
| `f` | Darcy friction factor | none |
| `ε` | pipe absolute roughness | m |
| `η_t`, `η_p` | turbine, pump efficiency | none |
| `P` | power | W |
| `P_net` | plant net power at the grid connection (positive = export) | W |
| `d`, `A(d)`, `V(d)` | reservoir depth, surface area, stored volume | m, m², m³ |
| `T` | air temperature | °C |
| `G` | global solar irradiance (horizontal) | W/m² |
| `u₂` | wind speed at 2 m height | m/s |
| `RH` | relative humidity | 0 to 1 |
| `e_s`, `e_a` | saturation, actual vapor pressure | kPa |

## 2. Core hydraulics

### 2.1 Heads

```latex
H_g = z_{upper} - z_{lower}, \qquad z = z_{floor} + d
```

```latex
H_n = H_g - H_f \;\text{(generating)}, \qquad H_{dyn} = H_g + H_f \;\text{(pumping)}
```

Heads use the **current water-surface elevations** of both reservoirs, so `H_g` varies with fill level and with tailwater drawdown. The pump must overcome friction in addition to the static lift. If `H_n <= 0`, generation power is exactly 0.

### 2.2 Penstock friction (Darcy–Weisbach, Reynolds-dependent)

The penstock carries the total flow `Q_pen` of all active units (§2.3). If `Q_pen = 0`, then `v = 0` and `H_f = 0`; skip the Reynolds computation.

```latex
A_{pipe} = \pi (D/2)^2, \qquad v = Q_{pen}/A_{pipe}, \qquad Re = vD/\nu
```

Do **not** use a constant friction factor. Use the Swamee–Jain explicit approximation of Colebrook–White (valid for 5e3 ≤ Re ≤ 1e8 and 1e-6 ≤ ε/D ≤ 0.05):

```latex
f = \frac{0.25}{\left[\log_{10}\!\left(\dfrac{\varepsilon}{3.7D} + \dfrac{5.74}{Re^{0.9}}\right)\right]^2}
```

Clamp `f` to \[0.008, 0.100\]. If 0 < Re < 5000, use `f = 0.015` and log one warning per episode, not one per step. Default roughness is ε = 0.0003 m (steel-lined concrete); the cheaper "rough" option is ε = 0.0010 m.

**Minor losses** (entrance, exit, bends) dominate at high flow:

```latex
H_m = \Sigma K \cdot \frac{v^2}{2g}, \qquad H_{f,major} = f\,\frac{L}{D}\,\frac{v^2}{2g}, \qquad H_f = H_{f,major} + H_m
```

`K_entrance = 0.5`, `K_exit = 1.0`, `K_bend = 0.3` each. The default layout has 2 bends, so ΣK = 2.1. Keep `H_f,major` and `H_m` as separate state values; the UI shows both.

### 2.3 Units on the penstock

The powerhouse has **two turbine bays and two pump bays**, all manifolded onto the single penstock. Each bay holds one machine of any tier; bays are independent and tiers may be mixed.

- Plant mode is exclusive: generating (turbines only), pumping (pumps only) or idle. Switching between generating and pumping requires every unit's flow to have ramped to 0 first. Reversible units are defined in §9.1.
- Total flow is the sum over active units, and all units see the same head loss:

```latex
Q_{pen} = \sum_i Q_{unit,i}, \qquad H_f = H_f(Q_{pen})
```

- Because `H_f` scales with `v²`, two turbines at full flow through one narrow penstock lose about **four times** the head of one. At the starting site (D = 1.0 m, ΣK = 2.1, two Tier-1 turbines at 2.2 m³/s each) `H_f` is about 4.8 m, against about 1.2 m for one. This is intentional: it is the incentive to upgrade the penstock diameter when adding a second unit.

### 2.4 Turbine power and efficiency hill curve

```latex
P_{gen,i} = \rho\, g\, H_n\, Q_{unit,i}\, \eta_{t,i}
```

`η_t` is not constant. Model a simplified hill curve as two independent parabolic deratings around the unit's design point, then apply the health multiplier from §4.3:

```latex
\eta_t = \eta_{t,rated}\cdot\left[1 - 0.15\left(\frac{H_n/H_{des} - 1}{0.30}\right)^2\right]\cdot\left[1 - 0.10\left(\frac{Q/Q_{des} - 1}{0.50}\right)^2\right]
```

Clamp each bracket to \[0.4, 1\], clamp `η_t` to \[0.4, `η_t,rated`\], then multiply by `η_mult` (§4.3). `H_des` is the middle of the tier's head band and `Q_des = 0.9 · Q_max` (§8.2); `Q` is the unit's own flow. At `H_n = H_des` and `Q = Q_des`, `η_t = η_t,rated` exactly.

The starting site sits below the Tier-1 design head (`H_n` about 49 m against `H_des` = 55 m), so a Tier-1 turbine there runs at about `η_t` = 0.833, not 0.85. This is intended: it rewards raising the dam.

### 2.5 Pump power

```latex
P_{pump,i} = \frac{\rho\, g\, H_{dyn}\, Q_{unit,i}}{\eta_{p,i}}, \qquad \eta_p = \eta_{p,rated}\left[1 - 0.12\left(\frac{Q/Q_{des} - 1}{0.40}\right)^2\right]
```

Clamp `η_p` to \[0.4, `η_p,rated`\], then multiply by `η_mult`. `Q_des = 0.9 · Q_max` for the pump as well.

### 2.6 Caps, minimum flow, ramping

- **Power cap.** `P_gen,i ≤ P_turb,rated` and `P_pump,i ≤ P_pump,rated`. If a unit's computed power exceeds its rating, the governor closes the gates: set `Q_unit,i ← Q_unit,i · P_rated / P_i`, then recompute `Q_pen`, `H_f`, heads, efficiencies and powers once, and clamp each `P_i` at its rating. Do not iterate further. The reservoirs use the capped flows, so water use stays consistent with power.
- **Minimum flow.** A requested flow between 0 and 10% of `Q_max` is raised to 10%; a request of 0 stops the unit. Flow passing through that band while ramping at start or stop is normal and never trips the unit. The same rule applies to pumps.
- **Ramping.** Each unit's flow moves toward its setpoint at `dQ/dt = ± Q_max / 60 s` (full range in one minute), scaled by `dt_eff`. This models water-hammer mitigation: real penstocks cannot slam valves, because the surge `Δp = ρ·c·Δv` (wave speed c ≈ 1000 m/s) would burst the pipe. Model the ramp only, not the transient itself.
- **Start wear.** Each start (off to on) of a unit adds +0.02% wear (§4.3).
- **Pure functions.** Expose `frictionFactor(Re, ε/D)`, `turbinePower(H_n, Q, η)` and `pumpPower(H_dyn, Q, η)` as pure functions that take the efficiency explicitly. The self-tests (§12) call these directly.

### 2.7 Order of computation within one step

1. Apply queued actions and automation rules to produce each unit's flow setpoint.
2. Ramp each unit's flow toward its setpoint; apply the dry-reservoir and spillway limits (§3.2).
3. Sum `Q_pen`; compute `v`, `Re`, `f`, `H_f` (major and minor).
4. Compute `H_n` or `H_dyn`, then each unit's efficiency and power; run the cap pass of §2.6.
5. Pass the final flows and powers to Reservoirs (§3), Wear (§4) and Economy (§7).

No implicit solver is needed anywhere in this chain.

### 2.8 Scope boundaries (state these in a comment header)

- Quasi-steady flow only: no water-hammer or surge-tank transients (represented by the ramp rule).
- One penstock per plant, fed by up to two turbine bays and two pump bays; no parallel penstocks, no surge shaft.
- No sediment, fish passage or ecological flows.
- Generator and inverter electrical dynamics (reactive power, frequency response) are out of scope; the grid is an infinite bus the player price-takes from.

## 3. Reservoirs and mass conservation

### 3.1 Geometry

Every reservoir exposes the same interface: `A(d)`, `V(d)`, `dFromV(V)`, `D_max`, `V_max` and `z_floor` (the elevation of its lowest point at the dam wall, so `z = z_floor + d`). There are two implementations. The lower reservoir is always a frustum; the upper reservoir is a frustum at the Classic Benchmark site and tabulated when the player builds a dam in procedural canyon mode (§8).

**Frustum (closed form).** An inverted truncated pyramid with flat bottom area `A_bot`, uniform side slope `s` (m horizontal per m vertical) and maximum depth `D_max`:

```latex
L(d) = \sqrt{A_{bot}} + 2 s d, \qquad A(d) = L(d)^2, \qquad V(d) = A_{bot}\,d + 2\sqrt{A_{bot}}\,s\,d^2 + \tfrac{4}{3}s^2 d^3
```

The classic frustum identity must hold to machine precision and is asserted in the self-test:

```latex
V(d) = \frac{d}{3}\left(A_{bot} + A(d) + \sqrt{A_{bot}\,A(d)}\right)
```

**Tabulated (procedural canyon).** Built once when the dam is built (§8): `A_k = A(k · 0.5 m)` on a 0.5 m depth grid, with cumulative volumes `V_k`. Between nodes `A` is linear, so `V` is exactly quadratic:

```latex
V(d) = V_k + A_k u + \frac{A_{k+1} - A_k}{2h}\,u^2, \qquad u = d - d_k,\; h = 0.5\text{ m}
```

Floor every `A_k` at `A_min = 1 m²` so the Newton derivative never vanishes, and assert that `A_k` is non-decreasing. Here `d` is the water depth at the dam wall, `z_floor` is the riverbed elevation at the dam station, and `D_max` equals the dam height.

**Depth from volume.** Invert `V(d)` with Newton–Raphson, using the derivative `V'(d) = A(d)`: start at the previous depth (or, for the tabulated form, inside the previous segment), tolerance 1e-6 m³, normally 3 to 4 iterations, hard cap 8. Clamp the result to \[0, `D_max`\]. Never scan for the answer. For the tabulated form, keep the iterate inside the current 0.5 m segment and move to the neighbouring segment if the solution lies outside it.

**Starting fill.** "80% full" means 80% of `V_max` by volume. Compute the starting depth with the inversion above. `z_lower_floor = 0 m`; `z_upper_floor` is derived at game start so the starting head is exactly 50.00 m (§8.3).

### 3.2 Mass conservation (every step)

Define `Q_up` as the signed flow into the upper reservoir: `+Q_pen` when pumping, `−Q_pen` when generating, 0 when idle.

```latex
\Delta V_{upper} = Q_{up}\,dt_{eff} + A_{upper}\,\frac{P_{rain} - E_{evap}}{1000}\cdot\frac{dt_{eff}}{86400} + Q_{river}\,dt_{eff}
```

```latex
\Delta V_{lower} = -Q_{up}\,dt_{eff} + A_{lower}\,\frac{P_{rain} - E_{evap}}{1000}\cdot\frac{dt_{eff}}{86400} + \Delta V_{runoff} + \Delta V_{melt} + S_{upper}
```

- `P_rain` and `E_evap` are instantaneous rates in mm/day, converted with `/1000` and `/86400`. `A` is the current exposed water surface `A(d)` of each reservoir at the start of the step: the plane of the water level cutting the basin walls (the closed form of §3.1, or the table). A shallow lake exposes less surface, so it loses less water to evaporation and catches less direct rain.
- Rain on the lake surface is the direct-rain term above. Rain on the surrounding **land** becomes runoff and enters the **lower** reservoir only (valley drainage): `ΔV_runoff = (P_rain / 1000) · max(0, A_catch − A_lower(d)) · 0.25 · (dt_eff / 86400)`. The runoff coefficient 0.25 is constant. `ΔV_melt` is the spring-melt inflow of §5.2.
- `A_catch` is the total drainage area of the lower valley (lake plus land), fixed at game start as `2 · A_lower(D_max)`, about 68,600 m² at the default site. It never changes with water level or later excavation, so as the lake rises the land share shrinks and the direct-rain share grows.
- `Q_river` (m³/s) is the natural inflow of the canyon river into the **upper** reservoir, produced by Climate (§5.2). It is 0 at the Classic Benchmark site (pure pumped storage), so the original economics and self-tests are unchanged. Procedural canyon sites get a seeded river whose scale is set in the terrain bias menu (§10). River water that fills the upper reservoir is free generation fuel, which makes the plant a mixed (pump-back) plant.
- `S_upper` is the upper reservoir's spill of this step (below); it flows down the river into the lower reservoir.
- Sign check for the self-tests: pumping 1 m³/s for 3600 s gives `ΔV_upper = +3600 m³` and `ΔV_lower = −3600 m³`; generating gives the opposite.

**Flow interlock.** Before power is computed (step 2 of §2.7), limit the total flow so that no machine action can overfill or empty a reservoir within one step, at any `dt`:

```latex
\text{pumping: } Q_{pen} \le \min\!\left(\frac{V_{lower}}{dt_{eff}},\; \frac{V_{max,upper} - V_{upper}}{dt_{eff}}\right), \qquad \text{generating: } Q_{pen} \le \min\!\left(\frac{V_{upper}}{dt_{eff}},\; \frac{V_{max,lower} - V_{lower}}{dt_{eff}}\right)
```

If `Q_pen` exceeds the limit, scale every active unit's flow by the same factor (ratios preserved). A flow forced to 0 because the source is empty or the destination is full raises an alert; §9.7 defines the dry-reservoir consequences.

**Spill, release and fines.** Machine flows are interlocked, so only rain, runoff, melt and the river can push a reservoir over `V_max`. Resolve the reservoirs in this order each step:

1. Update the upper volume. If `V_upper > V_max,upper`, set `V_upper = V_max,upper`. The excess `S_upper` passes over the spillway and down the river into the lower reservoir. This is river water passing through, so it is not fined.
2. Update the lower volume, including the environmental release Q\_env · dt\_eff (§9.5, a sink limited to the water available) and the term `S_upper`. If `V_lower > V_max,lower`, set `V_lower = V_max,lower`. The excess `S_lower` is released downstream and leaves the system.
3. Fine only the flood part of that release: fined volume = `max(0, S_lower − Q_river,base · dt_eff)`, at $0.50/m³ (§7.1), with an alert. `Q_river,base` is the river's seasonal base flow without weather surges (§5.2), so ordinary river flow passing through is free while storm and melt surges are fined. With no river (the Classic Benchmark site) the whole release is fined. Note in a comment that this is an approximation.
4. Guard `V = max(0, V)`, then recompute both depths with the inversion of §3.1. Depths always stay within \[0, `D_max`\].

### 3.3 Evaporation (Penman 1948 form of Penman–Monteith, open water)

```latex
e_s(T) = 0.6108\,\exp\!\left(\frac{17.27\,T}{T + 237.3}\right), \qquad \Delta = \frac{4098\,e_s(T)}{(T + 237.3)^2}, \qquad e_a = RH\cdot e_s(T), \qquad \gamma = 0.0665
```

```latex
R_s = 0.0864\,\bar G, \qquad R_n = 0.92\,R_s, \qquad E = \frac{0.408\,\Delta\,R_n}{\Delta + \gamma} + \frac{\gamma}{\Delta + \gamma}\cdot\frac{900\,u_2\,(e_s - e_a)}{T + 273}
```

Units: `e_s`, `e_a`, `γ` in kPa, `Δ` and `γ` per °C, `R_s` and `R_n` in MJ/m²/day (`Ḡ` is the daily mean irradiance in W/m², with night hours counted as 0), `u₂` in m/s, `E` in mm/day. The 0.92 factor is one minus the open-water albedo of about 0.08.

**Implement this exact open-water expression verbatim. Do NOT insert the FAO-56 grass-reference `(1 + 0.34·u₂)` denominator term.** Self-Test #7 validates `E ≈ 9.73 mm/day`; the FAO-56 form would give about 7.7 mm/day and fail it.

- Evaluate once per game day, at the day boundary, after the day's 24 hourly weather values (§5.1) exist. Use the daily means `T̄`, `RH̄`, `ū₂` and `Ḡ`. The result is a constant rate for that day. Log it and show it in the debug overlay.
- Clamp `E ≥ 0`. Ice cover: if `T̄ < 0 °C`, then `E = 0`.
- Sanity band: the daily `E` must stay within 0 to 16 mm/day for the climate of §5. A value outside the band is a bug. (With the §5.1 table the formula gives roughly 7, 9, 12 and 8 mm/day in Winter, Spring, Summer and Autumn, and about 15 mm/day in a heat wave.)

## 4. Wear, cavitation, maintenance

Every machine bay has its own `health` (percent, 0 to 100, starting at 100) and its own cavitation checks. All values below are evaluated every step for each active unit (flow > 0). When no unit is active, evaluate σ and NPSH with `Q = 0` (so `H_n = H_g` and `H_f,suction = 0`), so the UI and alerts always have a margin to show.

### 4.1 Turbine cavitation (Thoma parameter)

```latex
\sigma = \frac{H_{atm} - H_{vap} - H_{s,eff}}{H_n}, \qquad H_{s,eff} = H_{s,design} + \left(D_{lower,max} - d_{lower}\right)
```

- `H_atm = 10.33 m H₂O`, `H_vap = 0.24 m H₂O` (20 °C). If `H_n ≤ 0`, skip (`P = 0`).
- `D_lower,max − d_lower` is the current **tailwater drawdown**. A falling lower reservoir raises the suction height and can push the plant into cavitation. This is the physical driver of the rule.
- **`H_s,design = 1.0 m` by default** (a `CONFIG` value). With 3.0 m the starting plant would already cavitate: the lower reservoir starts 2.28 m below full, giving σ ≈ 0.098, below the Tier-1 critical value of 0.10. With 1.0 m the start has σ ≈ 0.139 (margin 1.39), and cavitation begins only when the lower reservoir sits more than about 4.2 m below full, after roughly 63,000 m³ (about 8.6 MWh of gross stored energy at 50 m) has been pumped out of it.
- `σ_c` is a per-tier property: Tier 1 = 0.10, Tier 2 = 0.09, Tier 3 = 0.08 (Francis-family values; the onset of gap and blade cavitation is σ ≈ 0.08 to 0.12 in the literature).
- All turbines share `H_n` and `H_s,eff` (one penstock, one tailwater) but each unit checks its own `σ_c`, so mixed tiers can differ. `CavitationPenalty = 10` if `σ < σ_c`, else 0.
- Expose the margin `σ / σ_c` as state; below 1.15 it triggers the alerts and the alert of §9.9 and the amber pulse of §10.2.

### 4.2 Pump cavitation (NPSH)

```latex
NPSH_A = H_{atm} - H_{vap} - \left(H_{s,pump} + \text{drawdown}_{lower}\right) - H_{f,suction}, \qquad H_{f,suction} = K_{suction}\left(\frac{Q_i}{Q_{des,i}}\right)^2
```

- `H_s,pump = 1.5 m`, `K_suction = 0.30 m`. The pump intake tunnel is much shorter and wider than the penstock, so its friction loss is small: 0.30 m at design flow, and 0 at standstill. `Q_i` is that pump's own flow.
- `NPSH_R` is a per-tier property: 3.0, 4.5 and 6.0 m. The penalty is 10 when `NPSH_A < NPSH_R`, the same as for turbines. Expose the margin `NPSH_A / NPSH_R` as state.
- At the starting site a Tier-1 pump at design flow has `NPSH_A` ≈ 6.0 m, safe against 3.0 m. It begins to cavitate when the lower reservoir sits more than about 5.3 m below full.

### 4.3 Wear law

Per step, per active unit, with `Δt_hr = dt_eff / 3600`:

```latex
\Delta health = -\,BaseWear\cdot\left(\frac{P_{current}}{P_{rated}}\right)^2\cdot\left(1 + CavitationPenalty\right)\cdot\Delta t_{hr}, \qquad BaseWear = 0.05\ \%/\text{h}
```

- At rated power without cavitation a unit takes 2,000 h (about 83 days of continuous running) to go from 100% to 0. A cavitating unit wears 11 times faster: a Tier-1 turbine at about 82% load drops from 100% to the 5% trip point in roughly 11 days.
- **Starts:** each start of a unit (flow going from 0 to above 0) costs a further 0.02 health points, for pumps and turbines alike.
- **Trip:** health below 5% takes the unit offline, and it stays offline until repaired.
- **Performance:** `η_mult = 1 − 0.05·(1 − health/100)` multiplies `η_t` and `η_p` after the hill curves of §2.4 and §2.5.

### 4.4 Maintenance

The player can schedule a repair for any unit:

```latex
\text{Cost} = (100 - health)\times 0.25\%\times CapEx_{unit}, \qquad \text{Downtime} = (100 - health)\times 0.2\ \text{h}
```

A repair always restores health to 100% and runs like a construction job: the unit is unavailable until it finishes. Example: a Tier-1 turbine (charged $7,200, base price $180k) at 50% health costs $900 and 10 hours. The automation action "repair if health < X" (§9.2) uses the same rule.

## 5. Climate and renewables

### 5.1 Climate engine (default site: "Alpine foothills", temperate)

The seasonal table drives everything and is editable in `CONFIG`:

| Season | T\_mean (°C) | Diurnal amp (°C) | Wind mean u₂ (m/s) | Precip chance per day | Precip (mm) | Mean cloud | G\_max (W/m²) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Winter | 2 | 5 | 9 | 12% | 8 | 0.60 | 550 |
| Spring | 10 | 8 | 7 | 30% | 6 | 0.45 | 800 |
| Summer | 22 | 10 | 5 | 20% | 10 | 0.35 | 1000 |
| Autumn | 12 | 7 | 6 | 35% | 7 | 0.50 | 700 |

**Random streams.** Derive separate mulberry32 streams from the master seed, one each for `weather`, `market`, `events` and `terrain` (stream seed = hash of the master seed and the stream name). No player action ever consumes a draw, so replays stay identical.

**Daily generation.** At each day boundary (00:00), generate the day after the one that is starting, so that two days of hourly values always exist and 24-hour forecasts can be read. Generate in a fixed draw order: the cloud draw, the rain roll, the event state, then the 24 hourly values of `T`, `G`, `u₂` and `RH`. Compute the daily means and the evaporation rate `E` (§3.3) from them. Days 1 and 2 are generated at game start and play begins at the 08:00 entry of day 1. Hourly values are held constant for the whole hour. Keep a one-day lookahead of the cloud draw so the hourly cloud can be interpolated across midnight.

**Hourly values.** `h` is the hour (0 to 23):

```latex
T(h) = T_{mean} + amp\cdot\sin\!\left(\frac{\pi (h-9)}{12}\right)\left(0.6 + 0.4\,(1 - cloud(h))\right) + \varepsilon_T(h)
```

```latex
G(h) = G_{max}\cdot\max\!\left(0, \sin\!\frac{\pi (h - sunrise)}{sunset - sunrise}\right)\cdot\left(1 - 0.70\,cloud(h)\right)
```

```latex
u_2(h) = u_{mean}\left(1 + 0.30\cos\frac{2\pi h}{24}\right) + \varepsilon_u(h) \;\;(\text{clamp} \ge 0), \qquad RH(h) = 0.55 + 0.25\sin\frac{2\pi (h+2)}{24} - 0.30\,cloud(h)\,dayFactor(h)\;\;(\text{clamp to } [0.15, 0.95])
```

- Temperature peaks at 15:00 and bottoms at 03:00. Humidity peaks near 04:00 and bottoms in mid-afternoon. `dayFactor(h) = max(0, sin(π(h − sunrise)/(sunset − sunrise)))`, the daylight shape of `G`.
- **Wind phase.** Use `cos(2πh/24)` so nights are windier (peak at midnight, trough at noon). The original `sin(2πh/24 − π/2)` peaked at noon, which contradicted its own "nights windier" comment.
- `cloud`: each day draws `clamp(seasonal mean + 0.2·(2·rng() − 1), 0, 1)`; the hourly value interpolates linearly from today's draw to tomorrow's.
- **Sunrise and sunset** vary smoothly through the year: `sunrise = 7 − c`, `sunset = 18.25 + 1.75·c`, with `c(day) = −cos(2π(day − 46)/365)`. This gives 8.0 / 16.5 at mid-Winter, 6.0 / 20.0 at mid-Summer and about 7.0 / 18.25 in Spring and Autumn.
- **AR(1) noise.** `ε_t = α·ε_{t−1} + σ·(2·rng() − 1)` with `ε_0 = 0`, advanced once per game hour and carried across days. Temperature uses σ = 0.3, α = 0.9; wind uses σ = 1.2, α = 0.92. The drift is bounded by ±σ/(1−α), which is ±3 °C and ±15 m/s (typical spread about 0.4 °C and 1.8 m/s). This uniform form cannot produce NaN or Infinity, unlike a Box–Muller draw.

**Rain.** Rolled once per day. If it rains, the daily total comes from the table and falls over `N = 6 + floor(13·rng())` hours (6 to 18) starting at a random valid hour. During those hours `P_rain = total × 24 / N` (mm/day-equivalent rate), otherwise 0. Rain at `T < 0 °C` is shown as snow.

### 5.2 Weather events and water inflows

Events are announced at least 24 hours ahead in the Alerts feed. The generator always knows tomorrow, so this costs nothing.

| Event | Frequency | Duration | Effect |
| --- | --- | --- | --- |
| Heat wave | Exactly one per Summer, plus a second with probability 0.3. Start day drawn at the start of the season, at least 5 days from any other heat wave. | 3 to 7 days | T +8 °C, G ×1.15, demand and price rise through the temperature terms of §6.1. Evaporation follows from the formula (about +20%); do not add a multiplier. |
| Cold snap | Exactly one per Winter, plus a second with probability 0.3. Start day not before day 3. | 3 to 5 days | T −10 °C. Ice cover when the daily mean `T̄ < 0 °C` (`E = 0`). Precipitation falls as snow (visual). 50% of runoff and of rain-driven river inflow is held as snowpack and released evenly over the first day with `T̄ > 2 °C`. |
| Windstorm | 1% chance per day when none is active | 1 to 3 days | `u₂` = 20 to 30 m/s; every wind turbine cuts out (§5.3). 2% chance per wind turbine per storm day of blade damage: $5k repair, offline 6 h. |
| Storm rain | 1% chance per day when none is active | 1 to 2 days | 40 mm/day; valley runoff and rain-driven river inflow doubled. |

Events of different types may overlap.

**Spring melt** (every year, days 92 to 100): a triangular inflow into the **lower** reservoir, `Q_melt(t) = 0.25 · max(0, 1 − |t − 96.5| / 4.5)` m³/s, where `t = day + hour/24`. It peaks at 0.25 m³/s in the middle of day 96. The total is 97,200 m³, about 25% of the lower reservoir's `V_max` at the default site.

**River** (upper reservoir, §3.2): `Q_river = Q_river,base + Q_river,rain`.

```latex
Q_{river,base} = Q_{base}\cdot s_{season}, \qquad Q_{river,rain} = \frac{0.25\cdot (P_{rain}/1000)\cdot A_{basin}}{86400}
```

- `s_season` = 0.6 Winter, 1.4 Spring, 0.5 Summer, 0.9 Autumn. `Q_base` is 0 at the Classic Benchmark site and 0.15 m³/s by default at procedural sites (the terrain bias menu scales it). `A_basin` defaults to 3 km². Storm rain doubles `Q_river,rain`.
- At the default `Q_base` the mean river flow is about 0.127 m³/s, or 4.0 million m³ per year. If all of it were generated at 49 m head with `η_t` = 0.85, that is about 450 MWh per year.

### 5.3 Wind power

```latex
v_{hub} = u_2(h)\left(\frac{H_{hub}}{2}\right)^{0.143}, \qquad A_{swept} = \pi R^2, \qquad P_{wind} = \tfrac{1}{2}\,\rho_{air}\,A_{swept}\,v_{hub}^3\,C_p\,\eta_{mech}
```

The exponent 0.143 is the 1/7th power-law shear from the 2 m reference height of the meteorological `u₂`. `C_p = 0.40`, `η_mech = 0.95`. The curve has four regions:

- `v_hub < 3.5 m/s` (cut-in): 0.
- 3.5 ≤ `v_hub` < 12 m/s: the cubic formula above.
- 12 ≤ `v_hub` ≤ 25 m/s: `P_rated`, the formula evaluated at 12 m/s. This prevents the unphysical cubic runaway.
- `v_hub > 25 m/s` (cut-out): 0, safety shutdown. A windstorm (`u₂` = 20 to 30 m/s) gives hub speeds of 29 to 34 m/s, so every turbine cuts out.

Rated power is **computed** at 12 m/s, so the table is self-consistent:

| Tier | Rotor radius R (m) | Hub height (m) | `P_rated` | Label | CapEx | `S_norm` in a 150 m tile |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 15 | 30 | 284 kW | 250 kW class | $350k | 5.0 |
| 2 | 28 | 60 | 991 kW | 1 MW class | $1.1M | 2.7 |
| 3 | 49 | 90 | 3.03 MW | 3 MW class | $3.2M | 1.5 |

**Wake interference.** The wind turbines of one parcel (§5.5) shade each other. Use the Jensen wake deficit with a direction-averaging factor:

```latex
\eta_{wake} = \max\!\left(0.65,\; 1 - (N_{wind} - 1)\,\varphi\,\delta_J\right), \qquad \delta_J = \frac{1 - \sqrt{1 - C_T}}{(1 + 2\,k_w\,S_{norm})^2}
```

`C_T = 0.80`, `k_w = 0.075` (onshore), `φ = 0.25`: the wind direction keeps changing, so a given neighbour is upwind only part of the time. A parcel's wind output is `η_wake × Σ P_wind,i`. `S_norm` is the tile pitch divided by the rotor diameter, `150 m / (2R)`; for mixed tiers use the mean over the parcel's turbines. Each extra turbine then costs 4.5% (Tier 1), 7.0% (Tier 2) or 9.1% (Tier 3), and the 0.65 floor binds from the 9th, 6th and 5th turbine of a parcel. This is a tuned game simplification, not a derivation; say so in a comment.

### 5.4 Solar PV

```latex
G_{eff} = G\,(1 - shade), \qquad P_{dc} = N_{mod}\,A_{panel}\,G_{eff}\,\eta_{panel}, \qquad T_{cell} = T(h) + \frac{G_{eff}}{800}\cdot 25
```

```latex
P_{ac} = P_{dc}\,\left(1 - \gamma\,(T_{cell} - 25)\right)\,\eta_{inv}\,f_{soil}
```

`shade` comes from §5.5 (0 for an array alone on its parcel). `A_panel = 1.7 m²` per module; `η_panel` = 0.20 (Tier 1), 0.21 (Tier 2), 0.22 (Tier 3); `γ = 0.004 /°C`; `η_inv = 0.96`. Clamp the temperature bracket at 0 from below. f\_soil is the array's soiling factor (§8.6), 1.0 for a clean array.

| Tier | Modules | Rating at 1000 W/m² | Label | CapEx |
| --- | --- | --- | --- | --- |
| 1 | 150 | 51 kW | 50 kW class | $45k |
| 2 | 1,500 | 535 kW | 500 kW class | $420k |
| 3 | 6,000 | 2.24 MW | 2 MW class | $1.6M |

Panels glow in proportion to `G` (visual, §10).

### 5.5 Land parcels and co-location

- The map has 4 to 6 expandable parcels on the canyon rim and valley flats (purchase costs in §8). Each is a 4 × 4 grid of tiles at 150 m pitch (`N_tiles = 16`). A tile holds a solar array, one wind turbine, or both.
- **Wind shading on solar.** For a solar array on a parcel with `N_wind` wind turbines:

```latex
shade = k_{shade}\,\frac{N_{wind}}{N_{tiles}} + k_{coloc}\cdot[\text{its tile also holds a wind turbine}], \qquad k_{shade} = 0.05,\; k_{coloc} = 0.03
```

- **Cost.** A second technology placed on a tile that already holds the first costs 15% less (shared interconnect and lease).
- Wind-on-wind wakes are in §5.3.
- Recompute `shade` and `η_wake` when the layout changes and once per hour, never per step.

### 5.6 Self-consumption

Player-owned wind and solar enter the per-step net power `P_net` of §1.2: they offset pumping first, and any excess is sold at the spot price. The player is a price-taker (§6).

## 6. Dynamic grid pricing and the duck curve

The plant is a price taker: its dispatch never moves the price. The price for each hour is computed once, when that hour's weather is generated, and held constant for the whole hour. The grid has a base demand D\_total = 400 MW, raised by heating and cooling (§6.1), and the price falls when wind and solar push the residual load down (the merit-order effect), which is what creates the midday dip and the evening peak.

### 6.1 Base price (double peak with a midday dip)

With h the hour of day (0 to 24, fractional hours allowed), in $/MWh:

```latex
P_{base}(h) = 45 + 30\,e^{-(h-8.5)^2/2} + 45\,e^{-(h-19.5)^2/2} - DIP(h)
```

```latex
DIP(h) = \begin{cases} 18\,\sin^2\!\left(\dfrac{\pi (h-10)}{6}\right) & 10 \le h \le 16 \\ 0 & \text{otherwise} \end{cases}
```

Reference values for the audit: P\_base(0) = 45.0, P\_base(8.5) = 75.0, P\_base(13) = 27.0, P\_base(19.5) = 90.0. Temperature moves both demand and price (air conditioning in the heat, electric heating in the cold), using the hourly air temperature T in °C from §5. Cooling degrees are C = max(0, T − 24) and heating degrees are H = max(0, 5 − T). The price factor is m\_T = 1 + 0.025·C + 0.020·H and the demand factor is f\_D = 1 + 0.010·C + 0.008·H. Between 5 and 24 °C both factors are exactly 1, so the reference values above hold in mild weather. A heat-wave afternoon at 35 °C gives m\_T = 1.275 and f\_D = 1.11, and a cold-snap night at −11 °C gives m\_T = 1.32 and f\_D = 1.128. Heat waves and cold snaps therefore need no price multiplier of their own; they act only through T.

### 6.2 Renewable discount (merit order)

The regional renewable output R\_reg, in MW, comes from the same climate state as the player's own plant (§5), so the price and the player's wind and solar output are driven by the same weather:

```latex
R_{reg} = 250\,\frac{G}{1000} + 300\,\min\!\left(1, \left(\frac{u_2}{12}\right)^3\right)
```

Here G is the global horizontal irradiance in W/m² and u₂ is the 2 m wind speed in m/s, both the hourly values from §5. The market price is then

```latex
Price = P_{base}\,m_T\left(1 - k_{merit}\,\frac{R_{reg}}{D_{total}\,f_D}\right) + \varepsilon, \qquad k_{merit} = 1.5,\; D_{total} = 400\text{ MW}
```

ε is uniform noise in \[−3, +3\] $/MWh, one draw per hour from the `market` stream. The final price is clamped to \[−50, +500\] $/MWh. Negative prices therefore occur when R\_reg exceeds D\_total / k\_merit ≈ 267 MW, which needs a sunny and windy hour together and is mostly a winter event, with occasional spring midday cases (the wind blows harder at night, so a windy and sunny hour is rare in summer).

Worked check (Test 9): at 13:00 with G = 900 W/m², u₂ = 12 m/s and T = 15 °C (so m\_T = f\_D = 1), R\_reg = 225 + 300 = 525 MW, so the noise-free price is 27 · (1 − 1.5 · 525 / 400) = −26.16 $/MWh. A flooded winter hour with P\_base = 90 and the same R\_reg would give −87.19 and clamp at −50.

### 6.3 Forecast

The 24-hour price forecast shown to the player is the noise-free price for each target hour times (1 + e), where e is uniform in \[−0.10, +0.10\] and is drawn once per target hour from the `market` stream, when that hour's weather is generated. The error is fixed per target hour, so it does not change as the hour approaches and the forecast cannot be "refreshed" for a better answer. Because days 1 and 2 are generated at game start (§5.1), a forecast is available from the first tick. The forecast is clamped to the same \[−50, +500\] range.

### 6.4 Determinism and interface

- Prices depend only on the seed and the hour index. They never depend on the player's actions.
- `SimEngine` exposes `priceAt(hourIndex)` and `forecastAt(hourIndex)` as pure reads, and the UI never computes prices itself.
- The audit hook returns P\_base, R\_reg, the unclamped price and the clamped price for any hour, so Test 9 can check each step.

### 6.5 Market impact of the player's dispatch

The player's net export acts like extra supply in the merit-order formula, and net import acts like extra demand, so a large plant flattens the spread it earns from. Let P\_net(t) be the net power of all the player's sites together in MW (positive = export, negative = import), as in §7.1. The price the plant actually trades at in each step is

```latex
Price_{eff}(t) = Price_0 - \lambda(h)\,P_{net}(t), \qquad \lambda(h) = \frac{P_{base}(h)\,m_T\,k_{merit}}{D_{total}\,f_D}\ \left[\frac{\$/MWh}{MW}\right]
```

Price₀ is the price of §6.2 (what an idle plant would see); it is the price on the chart, the price in the forecast and the price used by the rule engine, and the clamp to \[−50, +500\] applies to it only. λ is exactly the slope of the merit-order formula with respect to R\_reg, so no new constant exists. Settlement (§7.1) charges the extra cost per step, which is the same for export and import:

```latex
Impact_{hour} = \sum_{steps} \lambda(h)\,P_{net}^2\,\frac{dt}{3600}
```

Worked check (Test 13): at the evening peak P\_base = 90 and m\_T = f\_D = 1 give λ = 0.3375 $/MWh per MW. A net export of 10 MW for one hour at Price₀ = 60 earns 60 · 10 − 0.3375 · 100 = $566.25, and the revenue Price₀ · P − λP² peaks at P = Price₀ / (2λ), about 133 MW at 90 $/MWh. Below about 5 MW the effect is under 2% and the player will not notice it; a Tier-3 turbine will.

## 7. Financial system

All money is in dollars. The economy is rescaled to the real price level of §6 (a Tier-1 plant earns tens of dollars a day, not thousands), through one constant `CAPEX_SCALE` that multiplies every equipment and construction price of §8 (default 0.04, final values in §8). Everything in this section is defined so that this constant is the only thing to retune.

### 7.1 Settlement

Energy is netted every simulation step, as in §1.2 and §5.6, never only at the hour boundary. At each step the net plant power is P\_net = P\_gen + P\_wind + P\_solar − P\_pump. If P\_net ≥ 0 the energy P\_net · dt / 3600 is added to the hourly export counter E\_sold (MWh), otherwise its absolute value is added to the hourly import counter E\_bought (MWh). On each hour boundary the engine settles with that hour's price Price₀ (§6), subtracts the market impact of §6.5 accumulated per step, adds the grid-service income of §9.4, and then resets all hourly counters:

```latex
Profit_{hour} = (E_{sold} - E_{bought})\,Price_0 - Impact_{hour} - O\&M_{hour} - LoanPayment_{hour} - Fines_{hour} + Services_{hour}
```

Buying and selling use the same spot price, with no spread. The sign must come out of the formula and is never special-cased: at −10 $/MWh a plant that buys 1 MWh earns $10, and a plant that sells at a negative price loses money, so the player can curtail wind and solar (§9) in those hours. The engine never curtails by itself. Purchases in the Build menu are refused if they would take cash below zero; cash can only go negative through settlement.

### 7.2 O&M

Operating cost per hour is

```latex
O\&M_{hour} = 0.15\,C_{MW} + 0.10\,E_{thru}
```

where C\_MW is the installed capacity in MW (turbines, pumps, wind and solar rated power added up) and E\_thru is the MWh moved in that hour (pumped plus turbined plus produced by wind and solar). This is a third of the original rates on purpose. The starting plant (0.5 MW pump, 1 MW turbine, 0.5 MW solar) pays about $7 a day of capacity cost plus roughly $1.5 a day of throughput cost.

### 7.3 Loans

- A month is exactly 30 game days. A loan has a term of 1 to 5 years (12 to 60 months), and a payment is charged at the 00:00 settlement every 30 days after the day it is drawn.
- The APR depends on the amount: up to $25,000 it is 6%, up to $100,000 it is 7%, and above that it is 8%.
- The monthly payment is the standard amortization payment:

```latex
M = P_{loan}\,\frac{r\,(1+r)^n}{(1+r)^n - 1}, \qquad r = \frac{APR}{12},\; n = \text{months}
```

Each payment splits into interest r · balance and principal M − interest. The last payment clears the balance exactly, so the residual is zero up to rounding. Early repayment of any amount is allowed with no penalty.

- Credit limit: the total outstanding principal may not exceed $25,000 plus 50% of the purchase price of the equipment the player owns. The Build menu and the dam budget solver of §8 use cash plus the unused part of this limit as the available budget.
- Emergency loan: it is granted automatically only when cash is below zero after a settlement and no emergency loan is active. Its amount is the shortfall plus $5,000 rounded up to the next $1,000, at 12% APR over 6 months. If cash is below zero and an emergency loan is already active, the game ends in bankruptcy with the final stats screen.
- Grants (quest rewards, §9) are cash and not loans.

### 7.4 NPV shown in the Build menu

Every upgrade option shows a live NPV with the closed-form annuity, never a loop over years:

```latex
NPV = -CapEx + R_{annual}\,AF, \qquad AF = \frac{1-(1+r)^{-N}}{r}, \quad r = 0.05,\; N = 20
```

R\_annual is estimated from the current 24-hour forecasts of price (§6.3) and weather (§5), and the estimation method is documented in a code comment. Both estimates are deliberately simple and conservative, and every agent must implement them identically.

- Wind and solar upgrades: E\_expected(h) is the energy the new unit would produce in hour h of the forecast, with the wake and shading factors of §5. Revenue counts only positive prices, because the player can curtail:

```latex
R_{annual} = 365 \sum_{h=0}^{23} E_{expected}(h)\,\max(0, Price_{fc}(h)) - \Delta O\&M_{annual}
```

- Pumped-storage, dam and penstock upgrades: take P̄\_peak6 as the mean of the six highest forecast prices and P̄\_off6 as the mean of the six lowest, assume one arbitrage cycle per day, and define the delivered energy of one cycle for a configuration as

```latex
E_{cycle} = \min\left(6\,P_{gen,MW},\; RTE\cdot 6\,P_{pump,MW},\; E_{net,storage}\right)
```

where the powers are the installed turbine and pump powers in MW and E\_net,storage is the net energy of §3. With ΔE\_cycle the difference between the new and the current configuration:

```latex
R_{annual} = 365\,\Delta E_{cycle}\left(\bar P_{peak6} - \frac{\bar P_{off6}}{RTE_{new}}\right) - \Delta O\&M_{annual}
```

The 6-hour cycle underestimates what a skilled player earns (the starting pair can arbitrage for much more than 6 hours), which is intended: the NPV is a floor, not a promise.

### 7.5 LCOS and round-trip efficiency

LCOS is shown in $/MWh of discharged energy and counts the hydro system only (dam, reservoirs, penstock, pumps, turbines), not wind and solar. With E\_annual the discharged energy over the last 365 days (annualized from the days played so far when less than 365 have passed) and r = 0.05, N = 20, the discounted sums have a closed form:

```latex
LCOS = \frac{CapEx + O\&M_{annual}\,AF}{E_{annual}\,AF} = \frac{CapEx}{E_{annual}\,AF} + \frac{O\&M_{annual}}{E_{annual}}
```

If E\_annual is zero the display shows an em dash instead of dividing. Round-trip efficiency is RTE = ΣE\_gen / ΣE\_pump over the plant's life, taken from the gross counters of §1.2 (energy counted at the unit, before netting, so wind and solar never inflate it). Design targets: about 65% for the Tier-1 pair, about 79% for Tier 3 with a large penstock.

### 7.6 Firm contract

The player may sign a 30-day firm contract, which cannot be cancelled and can be renewed when it ends. Two contracts are offered: 0.2 MW at $48/MWh from the start, and 0.5 MW at $52/MWh once the installed pump power reaches 1.5 MW. In every hour, with C the contract power in MW:

```latex
Delivered = \min(E_{sold}, C \cdot 1\,\text{h}), \qquad Shortfall = C \cdot 1\,\text{h} - Delivered
```

Delivered energy is paid at the contract price. Any export above the contract is sold at the spot price. Each MWh of shortfall costs 3 · max(Price, 20) dollars, so a negative spot price can never turn a shortfall into a profit. Imports (pumping) are always bought at the spot price. The contract is measured on hourly energy, so the plant may produce in bursts and does not have to run continuously at low load.

The pacing targets for this section are checked in the §12 economy test: with the starting configuration the mean net income over year 1 under the scripted policy of §12 should be about $40 to $120 a day, and the §7.4 payback of the Tier-2 pump and turbine pair should be 200 to 450 game days. If the payback is outside its range, only `CAPEX_SCALE`, and nothing else, is changed; an income outside its range is reported to the author, not fixed here.

## 8. Construction and equipment

### 8.1 Price list and CAPEX\_SCALE

Every price in this section and every CapEx figure quoted elsewhere in this prompt (§4 repair examples, §5.3 and §5.4 tables) is a **base price**. The engine charges `base × CAPEX_SCALE` with `CAPEX_SCALE = 0.04` (§7). Specs (power, flow, efficiency) are never scaled, only money. Model names are flavor and the specs are the contract.

| Tier | Pump | P\_rated | Q\_max | η\_p | H\_des | NPSH\_R | Base price | Charged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | "Sulzer-class APT-50" | 500 kW | 0.80 m³/s | 0.80 | 50 m | 3.0 m | $120k | $4,800 |
| 2 | "KSB-class RPH-500" | 5 MW | 4.3 m³/s | 0.84 | 100 m | 4.5 m | $900k | $36,000 |
| 3 | "Voith-class RPT-5000" | 50 MW | 30 m³/s | 0.87 | 150 m | 6.0 m | $7.5M | $300,000 |

| Tier | Turbine | P\_rated | Q\_max | η\_t | σ\_c | H\_des band | Base price | Charged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | "Andritz-class Francis F-1" | 1 MW | 2.2 m³/s | 0.85 | 0.10 | 40–70 m | $180k | $7,200 |
| 2 | "Voith-class Francis F-20" | 20 MW | 19 m³/s | 0.90 | 0.09 | 60–180 m | $2.8M | $112,000 |
| 3 | "GE-class Francis F-150" | 150 MW | 85 m³/s | 0.92 | 0.08 | 100–300 m | $16M | $640,000 |

`H_des` is the middle of the band and `Q_des = 0.9 · Q_max` (§2.4). Operating outside the band is allowed and derated by the hill curve.

| Item | Base price | Charged |
| --- | --- | --- |
| Wind T1 / T2 / T3 (§5.3) | $350k / $1.1M / $3.2M | $14,000 / $44,000 / $128,000 |
| Solar array T1 / T2 / T3 (§5.4) | $45k / $420k / $1.6M | $1,800 / $16,800 / $64,000 |
| Penstock D = 0.6 / 1.0 / 1.5 / 2.5 m, per metre | $400 / $900 / $1,800 / $4,000 | $16 / $36 / $72 / $160 |
| Land parcel 2 / 3 / 4 / 5 / 6 (§5.5; parcel 1 is owned) | $200k / $300k / $400k / $600k / $800k | $8k / $12k / $16k / $24k / $32k |
| Dam concrete (procedural canyon), per m³ | $300 | $12 |
| Dam raise coefficient `C_dam` (Classic site), per m² of head | $800 | $32 |
| Reservoir excavation, per m³ plus one mobilization | $3 + $20k | $0.12 + $800 |

Penstocks use ε = 0.0003 m (steel) or 0.0010 m (rough concrete, −15% cost). A larger D cuts H\_f quadratically in v but costs linearly per metre. Replacing a penstock charges the full new price with no refund. The cost of any machine, array or penstock is charged on purchase and the unit works immediately; only dams and excavation have build times.

### 8.2 Dam raising, Classic site

The hydrostatic force per metre of wall is F = ½ρgH², so the cost grows with the square of the head:

```latex
Cost_{raise} = C_{dam}\,(H_{new}^2 - H_{old}^2), \qquad Days_{raise} = 2 + \frac{H_{new}-H_{old}}{5}
```

H\_old and H\_new are the gross heads before and after, starting from 50 m. The reservoir keeps working during the build. A raise increases the upper reservoir's `D_max` by the same ΔH, so capacity grows non-linearly (deeper and wider through the side slope). Example: 50 m to 60 m costs 32 · (3600 − 2500) = $35,200 and takes 4 days. Dam classes limit the gross head: **concrete gravity** up to 80 m, **arch** up to 150 m, **double-curvature arch** up to 250 m. The arch class is unlocked by the "Expansion" quest and the double-curvature class by a later quest (§9).

### 8.3 Procedural canyon (terrain stream)

The game offers two sites: the **Classic Benchmark** (exact frustum reservoirs, no river, used by the self-tests) and a **Procedural Canyon** generated from the seed by the `terrain` stream. The procedural canyon replaces the *upper* reservoir only; the lower reservoir is always the §3.1 frustum.

The canyon runs along an axial coordinate x in metres, with x = 0 at the cliff and the valley continuing upstream to x = 20,000 m (generated by value noise at fixed wavelengths, so the length costs nothing). All noise is sampled as smooth 1-D value noise from the `terrain` stream: `N_w(x)` sums wavelengths 400, 150 and 50 m with weights 1, 0.5 and 0.25, and `N_s(x)` sums 300 and 100 m with weights 1 and 0.5, each normalized to \[−1, 1\].

```latex
W_{bot}(x) = \mathrm{clamp}\!\left(W_0\,(1 + a_w N_w(x)),\; 12,\; 200\right)\ \text{m}, \qquad s(x) = \mathrm{clamp}\!\left(s_0 + a_s N_s(x),\; 0.35,\; 1.5\right)
```

```latex
z_{bed}(x) = z_{upper,floor} + S_0\,(x - x_{dam})
```

The defaults are `W0 = 60 m`, `a_w = 0.6`, `s0 = 0.8` (horizontal run per vertical rise), `a_s = 0.25` and `S0 = 0.015`; the terrain bias menu (§10) edits them and the river scale of §5.2. `z_upper_floor` is the value derived at game start at the Classic site (§3.1: chosen so the starting gross head is exactly 50.00 m with both reservoirs 80% full; ≈ 51.5993 m with the defaults, never hard-coded), reused unchanged here, so the head does not depend on where the dam stands. Narrow stretches of `W_bot` are the rock choke points (cheap dams), wide stretches upstream are the basins (big lakes).

For a dam at station x\_dam and water depth d at the wall, the wetted width at x ≥ x\_dam is `W(x, d) = W_bot(x) + 2 s(x) h(x)` with `h(x) = d − S0 (x − x_dam)`, counted only where h > 0. The surface area and volume are

```latex
A(d) = \int_{x_{dam}}^{x_{back}(d)} \left(W_{bot}(x) + 2 s(x)\,h(x)\right) dx, \qquad V(d) = \int_0^d A(u)\,du
```

Evaluate A(d) by the midpoint rule with dx = 5 m at d = 0, 0.5, 1.0, … up to the dam height, store the table, and use it exactly as §3 prescribes (A linear per 0.5 m, V piecewise quadratic, Newton inversion with V' = A). The table is rebuilt only when the dam is built or raised, never per tick.

### 8.4 Siting, raising and the dam solvers (procedural)

- **Siting step (before day 1).** In 3D siting mode the player drags the dam along the canyon (x\_dam between 0 and 1,200 m) and confirms. The starting dam is free and has height H0 = 10 m, so `D_max = 10 m` as at the Classic site. The panel shows V\_max for H0 and the price and volume of a 20 m and a 30 m dam at that spot, so choosing a choke point in front of a wide basin pays off later. While dragging, use a coarse preview (dx = 20 m, 2 m depth step, within 3% of the fine result); the confirmed station uses the fine table.
- **Validity.** The generator accepts a canyon only if the starting V\_max at its default station (the narrowest `W_bot` between x = 100 and 600 m) lies between 150,000 and 300,000 m³. Otherwise it retries with the next sub-seed, up to 50 times, and then falls back to the Classic site. With the defaults about 95% of seeds pass on the first try (median V\_max about 197,000 m³).
- **Dam concrete.** At the confirmed station the dam concrete volume and price are

```latex
V_{conc}(H) = \int_0^{H} \left(W_{bot}(x_{dam}) + 2 s(x_{dam})\,y\right)\left(t_{crest} + k_{batter}\,(H - y)\right) dy, \qquad Cost_{dam}(H) = 12 \cdot V_{conc}(H)
```

The class sets the profile: gravity `t_crest = 4 m, k_batter = 0.70`, arch `3 m, 0.35`, double-curvature `2.5 m, 0.18`. Class limits on H\_dam (gross head is about 40 m + H\_dam): gravity 40 m, arch 110 m, double-curvature 210 m. Evaluate the integral with 100 midpoint steps.

- **Raising.** Raising from H\_cur to H pays `Cost_dam(H) − Cost_dam(H_cur)` and takes `2 + (H − H_cur)/5` days. The reservoir keeps working during the build and the new volume appears when the job finishes. The station cannot be moved after the siting step.
- **Solvers.** `Cost_dam` is strictly increasing in H, so three modes work while the player moves the height: (1) a manual slider in 1 m steps showing price, V\_max and stored energy; (2) *Max volume for budget B*, where B = cash plus the unused credit of §7.3, finds `H* = max{H integer, H_cur ≤ H ≤ class limit : raise cost ≤ B}` and draws the wall and the lake; (3) *Target storage E*, which finds the smallest integer H whose usable net energy is at least E and shows its price. Usable storage is limited by the smaller reservoir, `min(V_upper, V_lower,max)`, and the panel shows both volumes and a warning when the lower reservoir is the bottleneck.
- For reference, with the defaults the median canyon gives V\_max about 0.2 Mm³ at 10 m, 0.47 Mm³ at 15 m, 0.89 Mm³ at 20 m and 2.1 Mm³ at 30 m, with a gravity-dam raise from 10 m to 15 m costing about $44k.

### 8.5 Reservoir excavation

Excavation applies to the lower reservoir (and to the upper reservoir at the Classic site). It comes in five discrete stages that each add 5,000 m² to `A_bot`; the button shows the exact ΔV\_max, price and days.

```latex
Cost = 0.12\,\Delta V_{max} + 800, \qquad Days = \max\!\left(2, \left\lceil \Delta V_{max} / 50{,}000 \right\rceil\right)
```

For the default lower reservoir (A\_bot = 30,000 m², s = 0.5, D\_max = 12 m) the stages give ΔV\_max of about 62,000 m³ each (V\_max = 385,518; 447,516; 509,376; 571,123; 632,775; 694,347 m³), at about $8,200 and 2 days each. The side slope is not changed by these stages.

### 8.6 Solar soiling and cleaning (all arrays)

Every solar array carries a soiling factor `f_soil` in \[0.55, 1.00\] that multiplies its output (§5.4 uses it as one more factor in the AC power). A new array starts clean at 1.00. Each day f\_soil drops by 0.0006 (dust), and on a day with at least 5 mm of rain it rises by 0.02 up to a cap of 0.95 (rain washes but never fully cleans). The player orders a **cleaning job** on an array: it costs $0.80 per kW of STC power, takes 1 day, and adds 0.15 to f\_soil up to 1.00. The array keeps producing during the job. The starting array is deliberately dirty, which gives the player something useful to do on day 1.

### 8.7 Starting configuration (day 1)

- Cash $50,000, no loans, no contracts.
- Site: Classic Benchmark by default, or the sited procedural canyon. Gross head 50 m (at 80% upper fill), upper reservoir `A_bot = 20,000 m², s = 0.6, D_max = 10 m` (V\_max = 217,450 m³, 29.0 MWh gross, 24.7 MWh net at η\_t = 0.85; show both numbers in the Build menu), lower reservoir `A_bot = 30,000 m², s = 0.5, D_max = 12 m`, both starting at 80% full.
- Penstock D = 1.0 m, L = 60 m, ΣK = 2.1, steel. One Tier-1 pump and one Tier-1 turbine, in their bays.
- One Tier-2 solar array (1,500 modules, about 535 kW STC) on parcel 1 with `f_soil = 0.60`. No wind. Grid as §6.

## 9. Gameplay systems

The game has three phases. **Phase 1, survive:** clean the panels and make the starting plant profitable. **Phase 2, scale:** Tier-2 machines, wind, the dam, batteries. **Phase 3, grid player:** reserve contracts, grid emergencies, the reliability score, a second site, and a plant big enough to move the price (§6.5). The sections below define the systems; §9.8 ties them to quests.

### 9.1 Player actions and modes

- **Manual:** per-machine toggles (pump / generate / idle) and a flow slider from 0 to 100% of Q\_max, applied through the ramp rule. Wind and solar can be curtailed per array (0 to 100%).
- **Automation:** the rule engine (§9.2). **Construction:** §8. **Financials:** loans, contracts, repairs, grants (through quests). **Time:** pause, speed, turn-step (§1.1).
- **Modes of a plant:** pump-only, generate-only, idle. Tier-1 and Tier-2 machines are separate pumps and turbines; a Tier-3 reversible unit can do either but not both at once. Pumping while generating on the same penstock is impossible, and the UI says so.

### 9.2 Automation rule engine

Rules have a priority order and the form `IF conditions THEN action ELSE continue`, evaluated every simulation step with a hysteresis of ±2% on reservoir and battery thresholds to prevent flapping. There are 8 slots; 2 are free and the rest come from quests marked (+slot) in §9.8. The editor is visual (dropdowns, number fields, drag to reorder), with no free-text language.

- **Conditions:** `grid_price` < or > X, `upper_%`, `lower_%`, `battery_%` < or > X, `hour in [a,b]`, `wind` > X, `solar` > X, `season = X`, `health` < X, `forecast_heatwave`, `forecast_rain`, `reserve_call_active`, `emergency_active`, `env_flow_ok`.
- **Actions:** `pump at X%`, `generate at X%`, `idle`, `pump on local power` (see below), `battery charge X%`, `battery discharge X%`, `battery idle`, `offer reserve X MW` (§9.4), `hold X%` (keep the upper reservoir at or above X% as an energy reserve), `repair if health < X`.
- **Pump on local power:** this is how pumping works together with wind, solar and the battery. The pump runs at the on-site surplus, `P_wind + P_solar` (plus, if the player ticks the option, the battery discharge down to its minimum charge) minus other local use, so it imports nothing from the grid. It never exceeds the pump's rating, and the unused surplus is sold as usual.
- **Precedence:** a pending reserve call or emergency (§9.4) > `hold` > rules in order > manual default.

### 9.3 Batteries

A battery is a fast, short-duration store that complements the pumped storage. It sits on a parcel tile like a solar array, and any site can have several. Specs, with base prices charged at `base × CAPEX_SCALE` (§8.1):

| Tier | Energy | Power | Base price | Charged |
| --- | --- | --- | --- | --- |
| B1 | 1 MWh | 0.5 MW | $250k | $10,000 |
| B2 | 10 MWh | 5 MW | $2.25M | $90,000 |
| B3 | 100 MWh | 50 MW | $20M | $800,000 |

- Round-trip efficiency 0.88, split as η = √0.88 = 0.938 on charge and on discharge. Usable state of charge is 10% to 95%. Power responds within one step (no ramp limit).
- Capacity fade is 0.02% of the nominal energy per equivalent full cycle (about 7% a year at one cycle a day). A *refurbish* job restores it for 30% of the base price and takes 1 day.
- The battery enters the netting of §7.1 as `P_net = P_gen + P_wind + P_solar + P_bat,dis − P_pump − P_bat,ch`. O&M counts its rated MW like any other unit. Its power can count toward a reserve offer (§9.4), and it is the only unit that can answer a call inside one second.
- Rough economics (for the NPV of §7.4): one cycle a day earns about $23/day on B1 plus up to about $22/day of reserve capacity, against a price of $10,000.

### 9.4 Grid services

The grid operator buys *reserve*: capacity that is held ready and called now and then to cover a frequency dip. The market is small on purpose, and the plant is the only seller.

- **Requirement and price.** For every hour, with R\_reg from §6.2 in MW: `R_req(h) = 1.5 + 0.004 · R_reg(h)` MW (1.5 to 3.7 MW) and the capacity price is `π_cap(h) = 1.0 + 0.004 · R_reg(h)` $/MW/h (1.0 to 3.2). The sum of the player's offers over all sites cannot exceed R\_req(h). Both are known 24 hours ahead from the forecast.
- **Offer.** The player sets a standing offer C in MW (or a rule does, with `offer reserve X MW`); it applies from the next full hour. The offer is *qualified* in an hour only if at its start the plant could add C MW to its net export (idle turbine headroom plus the pump load it could drop plus battery power), the upper reservoir is above 20% and the units involved are not tripped. An unqualified hour is void: no payment and no penalty, with an alert.
- **Income.** Each qualified hour pays `C · π_cap(h)`, counted in `Services_hour` (§7.1). While a reserve call lasts, the extra energy delivered above the pre-call net power is paid at `max(Price₀, 60)` $/MWh.
- **Calls.** In each qualified hour a call starts with probability 0.08 at a uniformly drawn minute (from the `events` stream, so about two a day), lasting 15 minutes. The plant must raise its net power by at least 0.9 · C within 45 seconds of the call and hold it for the 15 minutes. The measurement is the real net power of the simulation, so the hydraulic ramp (§2.6) decides: a Tier-1 turbine started from rest reaches about 75% of Q\_max in 45 s, while a battery answers at once. A failed call returns that hour's capacity payment, adds a fine of twice that amount and lowers the reliability score.
- **Grid emergency (event).** With 1% probability per day when none is active, an emergency lasts 2 to 4 hours (one of the §5.2 events). Price₀ is fixed at 250 $/MWh for its whole duration. Every offered MW is called at full power; the whole plant can also sell as usual at this price, minus the market impact of §6.5. There is no forecast alert, only a live alert, so players with a rule on `emergency_active` profit most. Roughly, 1 MW for 3 hours earns about $750, which is about nine days of starting income.
- **Reliability score S** (0 to 100, starts at 70): +0.5 per successful call, +3 per successful emergency, −5 per failed call, −10 per failed emergency, −1 per day with an environmental fine (§9.5). With S ≥ 80 the capacity price rises by 25%.

### 9.5 Environment

- **Minimum downstream flow.** At sites with a river (procedural canyons), the lower reservoir must release `Q_env = 0.5 · Q_base · s_season` m³/s downstream at all times (§5.2 gives Q\_base and s\_season; the Classic Benchmark has none). This is a sink term in the lower reservoir's mass balance of §3.2, and the reserved water is never available to the turbines. If the lower reservoir is below 5% of its depth, it releases what it has and the unmet volume is fined at $0.50/m³, the same rate as spills.
- **Permit.** The arch dam class (§8.2, §8.4) needs an *environmental permit* ($20,000) in addition to the Expansion quest, and the permit is only sold after 60 days with no environmental fines.
- **Climate drift.** From year 2 on, the temperature of §5.1 rises by 0.3 °C for each year after the first, and `Q_base` is multiplied by 0.95 per year with a floor of 0.5. On day 1 of each year after the first, the `events` stream gives a 25% chance of a drought year: rain × 0.6, `Q_base` × 0.6 for that year, and one more heat wave in summer. Year 1 has no drift and no drought, so the self-tests are unaffected.

### 9.6 Multiple sites

The player may own up to 3 sites, each a complete plant (reservoirs, penstock, bays, parcels, batteries, wear) with its own canyon from the `terrain` stream seeded with the master seed, the stream name and the site number. Site 2 is for sale for $150,000 (base $3.75M) after the player has answered 5 reserve calls, and site 3 for $300,000 after the second site has been owned for 90 days. A new site starts like day 1 of §8.7 without the machines: free 10 m dam at a sited station, empty parcel 1, and the player buys its pump and turbine.

Weather, prices, the reserve requirement, the loans, the contracts and the quests are shared. The price impact (§6.5) and the reserve cap act on the sum over all sites. The engine holds `state.sites[]` from day 1 (one entry at first), so single-site play uses the same code. The UI has one tab per site and a summary tab.

### 9.7 Failure states

- **Bankruptcy:** an emergency loan once, and if cash is still below zero at the next hourly settlement the game ends with a stats screen and an option to continue in sandbox.
- **Reservoir dry:** units trip, the firm-contract penalty accrues, reserve offers become unqualified, alert.
- **Reservoir overflow:** a fine of $0.50/m³ spilled, wasted energy and an alert, repeated while ignored.
- **Cavitation failure:** health below 5% trips the unit until repaired (§4.3).
- **Equipment damage:** windstorms (§5.2) create repair jobs.
- **Flood:** storm rain with a full reservoir forces a spill, with a small chance of dam damage if the head is above 90% of the dam class limit.
- **Failed reserve call or emergency:** §9.4. **Environmental fine:** §9.5.

### 9.8 Progression, quests and winning

**Main goal:** at the end of day 365, cash ≥ 0, no active emergency loan and positive net worth, where *net worth = cash + 50% of the purchase price of everything owned − outstanding principal*. Then the game continues as a sandbox, and the score is `net worth + 10 · RTE(%) + 5 · S + a renewables capacity-factor bonus`.

Quests reward grants (cash, not loans) or unlocks. Amounts are charged as written and are not scaled again.

| # | Quest | Trigger | Reward |
| --- | --- | --- | --- |
| 1 | Tutorial | Pump 500 m³, generate 1 MWh, sell during 18:00–21:00 | +slot |
| 2 | Clean the panels | Starting array at f\_soil ≥ 0.90 | $500 |
| 3 | First profit day | Net profit ≥ $60 in one day | $500 |
| 4 | Spring melt | Days 92–100 without overflowing the lower reservoir | +slot |
| 5 | Summer scorcher | Upper reservoir ≥ 20% through a heat wave of 5 days or more | $1,500 |
| 6 | Duck hunter | Earn ≥ $100 in one day from pumping in negative-price hours | $1,000 |
| 7 | Autumn wind harvest | Pump 120 MWh in 7 autumn days | $2,000 |
| 8 | Winter freeze | 5 consecutive days with ice-covered reservoirs | +slot |
| 9 | Grant: wind build-out | Build 2 wind turbines | $8,000 |
| 10 | Grant: modernize | Install a Tier-2 pump and a Tier-2 turbine | $40,000 |
| 11 | Grant: efficiency | RTE ≥ 75% over 30 consecutive days | $25,000 |
| 12 | Expansion | Raise the dam by 10 m | Unlocks the arch class (with the permit) |
| 13 | Battery online | Install a battery | $2,000 |
| 14 | First call | Answer one reserve call | +slot |
| 15 | Reliable | 20 reserve calls answered in a row | $5,000, +slot |
| 16 | Blackout hero | Deliver ≥ 90% of the offered MW through a grid emergency | $10,000 |
| 17 | Green quarter | 90 days with no environmental fine | $3,000 |
| 18 | Second site | Own a second site | $10,000 |
| 19 | Grid anchor | S ≥ 90 for 30 consecutive days | $25,000, +slot |
| 20 | The long game | Finish year 1 (main quest) | Sandbox |

### 9.9 Alerts feed (left sidebar)

Heat wave, cold snap and storm forecasts at least 24 h ahead; cavitation risk (σ or NPSH margin below 1.15 times critical); overflow imminent; bankruptcy warning; repair due (health below 30%); grant available; contract status; reserve offer void or called; grid emergency live; environmental flow unmet; panels dirty (f\_soil below 0.75); site for sale. Alerts have severity colors and timestamps.

## 10. UI and 3D world

The game should feel like a calm diorama you tend, not a control-room spreadsheet. The 3D world fills the whole window, and the interface is a few soft floating pieces on top of it. Every number from the simulation stays reachable, but the detailed telemetry hides in a drawer until the player asks for it.

### 10.1 Themes, art styles and look

The look is chosen in Settings and can change at any time without touching the simulation. There are **three UI themes** and **three art styles for the 3D world**, any combination of which works. Nothing is an image file: every color, shape, gradient and grain is generated in code (CSS gradients, an inline SVG noise filter, procedural geometry). The result must not look cheap: depth comes from one consistent light direction (from the top left), restrained shadows and fine details, never from cartoon bevels, glows or heavy outlines.

**Rules shared by every theme**

- The layout does not change between themes, only the materials, colors and type do. Bars and panels are rectangular with small radii (6 to 10 px), edge to edge where they dock; there are no pill shapes.
- One primary action per view, clear hierarchy, visible focus rings, and full keyboard navigation. Text and background pairs meet WCAG AA (4.5:1) in every theme; the palettes below were checked. State is never shown by color alone: pair it with an icon or a word.
- Touch targets are at least 44 px. Below the 1024 × 640 minimum viewport the toolbar collapses to a menu button and the drawer takes the full width; there is no horizontal scroll.
- Every list and chart has a designed empty state, a loading state and an error state. `prefers-reduced-motion` turns off camera easing, particles, shimmer and animated gauges.
- Fonts are system stacks only (the file is offline). Numbers always use `font-variant-numeric: tabular-nums`.
- Semantic tokens that every theme defines: `--gen` (generation), `--pump` (pumping), `--ren` (wind and solar), `--warn`, `--alarm`, plus surface, raised surface, text, secondary text and border.

**Theme A: Field Notes** (paper, ink and earth pigments, like a surveyor's notebook)

- Palette: Paper `#f1ead9`, Paper shade `#ddd2b8`, Ink `#2b2a26`, Moss `#4f6b3a`, Clay `#a3472c`, River `#2f6f86`, Ochre `#c58b2a` (fills only; as text use `#8a5f10`).
- Tokens: gen = Moss, pump = Clay, ren = River, warn = Ochre, alarm = Clay with an icon.
- Type: headings in a serif stack (`'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`), dense numbers in `ui-monospace, 'Cascadia Mono', Consolas, monospace`.
- Controls: paper cards with fine ruled lines and a faint paper grain, ink-drawn dials and tick marks on sliders, tabs like paper index tabs, quest badges like rubber stamps.

**Theme B: Brass and Slate** (machine-room metals with a patina; the skeuomorphic option)

- Palette: Slate `#1f2428`, Slate raised `#2a3137`, Brass `#b08d57` (bright `#d9b777`), Bone `#ece6d8`, Mist `#a9b0b5`, Verdigris `#5aa89b`, Oxide `#e07a6b`.
- Tokens: gen = Verdigris, pump = Oxide, ren = Brass bright, warn = Brass bright with an icon, alarm = Oxide with an icon.
- Type: engraved capitals with letter-spacing in `'DIN Alternate', Bahnschrift, 'Segoe UI Semibold', system-ui, sans-serif`, numbers in the same stack.
- Controls: real analog gauges (power, net head, reservoir level, price) with brass bezels, a subtle glass highlight and an animated needle, engraved nameplates, chunky toggle switches, faders with brass knobs, indicator lamps, and very discreet corner screws. Keep every effect fine and low-contrast so it reads as a real object and not as a toy.

**Theme C: Frosted Dusk** (refined glass)

- Palette: Night `#121c2e` (panels at 72% opacity with `backdrop-filter: blur(14px)`), Mist `#a7b6cc`, Text `#e8eef7`, Teal `#5eead4`, Coral `#fb7185`, Amber `#fbbf24`, Sky `#7dd3fc`.
- Tokens: gen = Teal, pump = Coral, ren = Sky, warn = Amber, alarm = Coral with an icon.
- Type: `ui-rounded, 'SF Pro Rounded', system-ui, 'Segoe UI', Roboto, sans-serif`.
- Controls: frosted panels with a 1 px inner highlight and a very light noise, thin-line charts, rectangular buttons.

**Art styles for the 3D world** (Settings; each changes only normals, materials and shaders, never the geometry of the simulation):

1. **Faceted low-poly:** flat shading, saturated vertex colors, hard shadows. The cheapest on the GPU and very readable.
2. **Soft stylized (default):** smooth shading, gradient vertex colors, soft shadows, gentle fog, rounded forms.
3. **Naturalistic:** smooth normals plus procedural shader detail (noise on rock and grass, wet-rock darkening at the waterline, sky scattering approximated by a gradient with a sun glow, softer water highlights). The heaviest style; it is not offered when quality is set to Low.

The defaults are Theme A with the Soft stylized art style; both can be changed in Settings at any time.

### 10.2 Layout

- **Top bar (always visible, edge to edge, 44 px high):** cash, today's profit, net power in MW (with an arrow for export or import), the spot price Price₀ in $/MWh with a small trend arrow, the game clock with season icon, and pause and speed controls.
- **Bottom toolbar (edge to edge):** icon buttons with labels for Build, Automation, Services (reserve and contracts, §9.4), Finance, Quests, Lens, Settings and Save/Load, plus a site switcher when the player owns more than one site (§9.6).
- **Notifications:** short toasts appear top center and fade out. A bell icon opens the full alerts feed (§9.9) as a panel; there is no permanent sidebar.
- **World popovers:** clicking (or tapping) a building opens a rectangular popover in the active theme, anchored to it. Its position is recomputed from the 3D point every frame, and it hides when the object is off screen. Contents:
  - *Powerhouse:* each pump and turbine with a mode toggle, a flow slider, a health bar, and the σ/σ\_c or NPSH margin as a chip that pulses amber below 1.15.
  - *Penstock:* diameter, roughness, velocity, H\_f, and the upgrade button.
  - *Dam:* height, class, V\_max and the Raise button, which opens the Dam Builder (§10.4).
  - *Reservoir:* volume, depth, percent full, today's evaporation, and the excavation stages (lower reservoir).
  - *Parcel and tile:* the 4 × 4 grid with free and used tiles, co-location effects, and a build menu with live NPV (§7.4).
  - *Solar array:* output, f\_soil, the Clean button and a curtail slider. *Wind turbine:* RPM, output, curtail slider. *Battery:* state of charge, mode, fade, the refurbish button.
- **SCADA drawer (Tab or F1):** slides in from the right over the world. It holds three live charts (24-hour price with the forecast and the reserve requirement, 24-hour reservoir volumes, and power flow with generation in teal, pumping in coral and renewables in blue), the full hydraulic and economic telemetry (H\_g, H\_n, H\_f major and minor, Q, v, Re, f, P, η, revenue rate, LCOS, RTE, S), and the visual automation editor of §9.2.
- **Hydraulic grade line widget:** a small 2-D cross-section in the bottom corner showing the upper reservoir, the penstock, the runner and the tailrace, with a dashed line that sags as H\_f grows with Q and pulses amber or red when the cavitation margin is below 1.15.
- **Modals:** Build overview, Automation, Finance (with loans and payoff), Quests, Settings, Save/Load, About.
- **Shortcuts:** Space pause, 1 to 6 the speed ladder of §1.1, T turn-step, Tab drawer, C cycle lens, F focus the selected object, F2 debug overlay, Esc close.

### 10.3 The 3D world

- **Stack:** Three.js as vendored in §0 (classic IIFE, no imports), WebGL2. If WebGL2 is missing, show a plain message; the simulation itself remains testable headless.
- **Units and axes:** 1 unit = 1 metre. X runs along the canyon (the cliff at x = 0, the valley continuing upstream as in §8.3), Y is elevation (lower reservoir floor at y = 0, upper floor at y = z_upper_floor, about 51.60, as derived in §3.1), Z is across the canyon. Camera near plane 1 m, far plane 8,000 m.
- **Terrain:** one heightfield mesh of about 3,200 × 1,600 m at 8 m resolution (about 80,000 vertices), colored per vertex (rock, grass, snow by height and season). It is built from the same functions as the simulation: `W_bot(x)`, `s(x)` and `z_bed(x)` of §8.3 for the procedural canyon, and the §3.1 frustum bowls at the Classic site. Parcels are flattened pads blended smoothly into the slopes. When an excavation or a dam raise finishes, only the affected region of the buffer is rebuilt.
- **Dam wall:** generated from the concrete profile of §8.4 (crest thickness and batter of the current class), rebuilt when the height changes. Show a darker band at the high-water line. During a build, show scaffolding and a progress ring.
- **Water:** one translucent plane per reservoir at the exact surface elevation `z_floor + d`, so the water depth on screen is the simulated depth (interpolate between steps). The terrain hides the parts that should be dry, a shoreline foam fades in where the water is shallow (the shader samples a height texture of the terrain), and two layers of gentle sine waves move the surface. The color goes from turquoise in the shallows to deep blue, and shifts with the season. Ice (Winter, `T̄ < 0`) turns the surface white and still.
- **Machines:** the penstock is a pipe along the hillside with flow particles whose speed is proportional to `v = Q / A_pipe`, pointing downhill when generating and uphill when pumping. The powerhouse has a runner that spins in proportion to Q. Wind rotors turn at `60 · λ · v_hub / (2πR)` rpm with λ = 7 and stop feathered when cut out. Solar panels glow in proportion to G and sparkle in rain. Batteries show a fill bar. Use instanced meshes for repeated objects (panels, rotors, tiles).
- **Light and sky:** a directional sun whose elevation is the same function as in §5.1 (so shadows and solar output agree), a hemisphere light, a soft shadow map (2,048 px, one cascade) that follows the camera focus, a sky gradient and fog tinted by time of day, a few hundred stars at night, and a dim moon light. Season changes the foliage and ground colors.
- **Weather:** rain and snow as a capped particle system (at most 1,500 particles), heat shimmer as a subtle screen-space wobble on heat-wave days, storm clouds darkening the sky, and wind-driven grass motion in the vertex shader.
- **Camera and input:** orbit (left drag), pan (right drag or WASD/arrows), zoom (wheel, eased toward the cursor), rotate (Q/E), with limits so the camera cannot go below the terrain or beyond the map. Clicking uses raycasting against objects tagged with an `entityId`; hovering lifts a soft outline and shows a one-line tooltip. Double-click flies the camera to the object.
- **Performance:** target 60 fps at 1080p on an integrated GPU in the World view. Cap the pixel ratio at 2. If the frame time stays above 22 ms for two seconds, step quality down one level (shadow map, particle cap, pixel ratio) and tell the player in Settings; Low/Medium/High can also be set by hand. No per-frame allocations in the render loop. The simulation and the renderer never share mutable state: the renderer reads an immutable snapshot of `SimEngine` once per frame.

### 10.4 Lenses and build modes

- **World lens (default):** the scene above.
- **Survey lens (automatic in Dam Builder and Parcel build mode, or with C):** the terrain shows 5 m elevation contour lines (drawn in the terrain shader from `fract(y / 5)`), the choke points of `W_bot(x)` are marked with pins, and a translucent blue plane shows the flooded basin at the dam height being considered.
- **Dam Builder:** at the siting step (§8.4) the player drags a dam marker along the canyon and sees, live, the V\_max of the 10 m starting dam and the price and volume of 20 m and 30 m dams there. After that the builder offers the three modes of §8.4 (height slider, max volume for a budget, target storage) with a live readout of height, price, build days, V\_max, stored energy in MWh and, in red, the warning when the lower reservoir is the bottleneck. The blue plane and the wall update as the slider moves.
- **Field zoom:** double-clicking a parcel flies the camera over it, shows its 4 × 4 tile grid and lets the player place arrays, turbines and batteries on tiles, with the co-location and wake effects of §5.5 shown as small badges.

### 10.5 New game screen and terrain bias menu

The new game screen has the Classic Benchmark and Procedural Canyon options, a seed field with a dice button, and a *terrain bias* menu for the procedural option, with a live miniature preview that re-renders as sliders move and a validity badge (§8.4: starting V\_max between 150,000 and 300,000 m³, or the number of retries needed). Sliders and their `CONFIG.terrain` keys:

| Slider | Key | Range | Default |
| --- | --- | --- | --- |
| Canyon width | `W0` | 30 – 120 m | 60 |
| Choke strength | `a_w` | 0 – 0.9 | 0.6 |
| Wall steepness (run per rise) | `s0` | 0.4 – 1.4 | 0.8 |
| Valley slope | `S0` | 0.005 – 0.03 | 0.015 |
| River size | `Q_base` | 0 – 0.6 m³/s | 0.15 |

The preview and the generated world use the same seed and the same functions, so the sliders never change what the world will look like beyond what the preview shows.

### 10.6 Debug overlay (F2), required

A translucent panel lists the live computed values so the player can check that the real equations are running: `Re, f, H_f (major and minor), H_n, H_dyn, Q, v, P_gen, P_pump, η_t, η_p, σ, σ_c, NPSH_A, NPSH_R, E (mm/day), R_n, T_cell, f_soil, RTE, LCOS, Price₀, Price_eff, R_reg, R_req, π_cap, λ, Impact, battery SoC, Q_env, S, seed`. A value that fails its self-test condition is shown in red.

### 10.7 Sound (optional, off by default)

A small WebAudio engine can synthesize ambient sound with no audio files: water noise scaled with Q, wind noise scaled with u₂, rain, and a soft low hum from the machines. It has one master volume slider and a mute toggle in Settings, and the game stays fully playable without it.

### 10.8 Save and load

Serialize the whole game state to JSON, `{version, seed, state}`, into `localStorage.hydroTycoonSave`, with an autosave every game day and on unload, manual Save, Load, Export (a text box with the JSON) and Import. The terrain, hypsometric tables and meshes are rebuilt from the seed and the saved parameters and are not stored. A version guard resets gracefully. The save is deterministically replayable: the same seed and the same inputs produce the same world.

### 10.9 About

The About modal, reachable from Settings in the toolbar and from a small footer badge, credits the game: **"Concept, physics architecture and game design by @Jeremih (Discord)."** It also lists, in plain language, the real equations behind the simulation (Darcy–Weisbach with Swamee–Jain, the Thoma parameter and NPSH, Penman evaporation, the wind power curve with Jensen wakes, PV temperature derating, merit-order pricing), the game version, the current seed, and the Three.js MIT license notice.

## 11. Architecture and performance

### 11.1 Source layout and dependency direction

Development happens in small modules, bundled at the end into `hydropower-tycoon.html` (§0). The layout, with one responsibility per file and none above about 500 lines:

```
src/config.js      CONFIG: every constant, commented with units
src/state.js       createInitialState(seed), the state schema, SAVE_VERSION
src/rng.js         mulberry32 and the named streams
src/sim/           canyon.js reservoirs.js hydraulics.js plant.js renewables.js battery.js
                   wear.js climate.js market.js economy.js services.js environment.js
                   sites.js construction.js automation.js quests.js alerts.js engine.js
src/ui/            theme.js hud.js popovers.js drawer.js charts.js editor.js modals.js settings.js
src/world/         renderer.js terrain.js water.js dam.js objects.js sky.js weather.js
                   camera.js lenses.js picking.js audio.js
src/game.js        the loop and Game.dispatch
src/saveload.js  src/debug.js  src/selftest.js
vendor/three.iife.js   build/bundle.mjs
```

The dependency rule is one-way: `src/sim/*` may import only `config`, `state` and `rng`; `src/ui/*` and `src/world/*` may read a state snapshot but never import `src/sim/*` internals except pure helper functions (such as the terrain functions of §8.3, so that the picture and the simulation use the same code). The bundler script fails the build if any file under `src/sim/` mentions `document`, `window`, `THREE`, `canvas` or `Math.random`.

### 11.2 State and actions (the contract)

The orchestrator writes `CONFIG` and `createInitialState(seed)` before any subagent starts, with these top-level keys, and nobody adds or renames one: `version`, `seed`, `clock` (tick, day, hour, speed index, paused), `rng` (the stream states), `climate` (the generated days, the active events), `market` (hourly prices, forecast errors, the emergency state), `sites[]` (each with its terrain parameters, reservoirs, dam, penstock, turbine and pump bays, parcels, arrays, wind turbines, batteries and wear), `finance` (cash, loans, emergency loan, contract, hourly counters, lifetime counters for RTE and LCOS), `services` (reserve offers, active call, reliability score), `automation`, `quests`, `alerts` and `stats`. UI-only settings (theme, art style, quality, sound) live in a separate `settings` object that is saved with the game but is not part of the simulation state and never affects it.

All input becomes one of these actions, applied at the start of the next step by `Game.dispatch({type, ...})`: `SET_SPEED`, `PAUSE`, `TURN_STEP`, `SET_FLOW`, `SET_MODE`, `SET_CURTAIL`, `PLACE_DAM`, `RAISE_DAM`, `EXCAVATE`, `BUILD`, `REPLACE_PENSTOCK`, `CLEAN_ARRAY`, `REPAIR`, `BUY_PERMIT`, `BUY_SITE`, `TAKE_LOAN`, `REPAY_LOAN`, `SIGN_CONTRACT`, `SET_RESERVE_OFFER`, `SET_RULES`, `CLAIM_QUEST`. Each action is validated by the engine (cash, credit, prerequisites) and either applied or rejected with an alert; the UI never decides.

### 11.3 Loop and time

The `requestAnimationFrame` loop accumulates real time, converts it to game seconds with the speed ladder of §1.1 (step size 1, 1, 1, 1, 5 and 30 s, and a step never crosses an hour boundary), runs as many fixed steps as are due, then renders from an immutable snapshot. If the steps due in one frame would take more than 40 ms, run only what fits, carry the rest over, and show a small "simulation is behind" badge. Physics never runs at a variable dt and never inside the render call.

### 11.4 Performance budgets

- **Simulation step:** under 0.05 ms per site per step on a mid-range laptop (so under 0.15 ms with three sites). At the top speed this is a few percent of one core.
- **Events that rebuild data** (dam raise or siting, excavation, a new site): hypsometric tables and terrain regions are rebuilt once, in slices of at most 8 ms per frame, with a progress ring, and never per step.
- **Render:** under 8 ms of CPU per frame in the World view; GPU targets and the automatic quality step-down are in §10.3. Instanced meshes for repeated objects, object pools for particles, no allocation in the render loop.
- **DOM and charts:** charts use ring buffers (24 hours at 1-minute resolution, 1,440 points per series) and redraw only what changed; text nodes update only when a value changes by more than 0.1% or one second has passed; popovers and the drawer update only while open. All canvases handle `devicePixelRatio` and resize.
- **Footprint:** the file may be a few MB. Import only the Three.js parts used (tree-shaken by the bundler) so the vendored build stays small.

### 11.5 Determinism, replay and hashing

- Only `+ − × ÷`, `sqrt`, `exp`, `log`, `sin`, `cos`, `pow`, `min` and `max` appear in the simulation. Transcendental functions can differ in the last bits between JavaScript engines, so replays are guaranteed identical on the same engine and are expected to match closely elsewhere.
- `SimEngine` exposes `stateHash()`, an FNV-1a hash of the canonical JSON of the simulation state (the `settings` object excluded, keys sorted, numbers printed with 12 significant digits).
- Replay: `replay(seed, actionLog)` reproduces a game exactly. The action log is `[{tick, action}]` and is part of the save, so a save can be verified by replaying it.

### 11.6 Audit hook and error handling

`SelfTest` runs on page load and headless, prints a `console.table()` of every self-test and the robustness sweep, and exposes

```javascript
window.__HYDRO_AUDIT__ = { allPassed, testResults: [{id, name, expected, actual, tolerance, pass}],
  robustnessSweep: {ticksRun, nanCount, pass}, stateHash, perf: {stepMsAvg, frameMsAvg},
  getSnapshot }
```

The step function is wrapped in one top-level `try/catch`: on an exception the game pauses, shows an error panel with a Copy button (message, stack, seed, action log) and keeps the last good snapshot instead of crashing silently. Access to `localStorage` is always wrapped, because some browsers block it on `file://`; when it fails the game keeps running in memory and offers Export.

### 11.7 Browser targets and code quality

The target is the current Chrome, Edge, Firefox and Safari with WebGL2, opened from `file://` with no network at all. No `eval`, no external requests, no globals other than `Game` and `__HYDRO_AUDIT__`. Every equation implementation has a comment naming its section at the call site, and every constant lives in `CONFIG` with its unit.

## 12. Self-test protocol

Every test is executed by `SelfTest` in code, headless and on page load, and reported through `console.table()` and `window.__HYDRO_AUDIT__` (§11.6). The values below were computed independently of the game before they were written here, so a mismatch means a bug in the game and not in the table. Rules:

- Tests marked *pure* call the pure functions directly with explicit inputs (efficiencies included), so they do not depend on state, the hill curve or the weather. All other tests run on the Classic Benchmark site (§8.7) with seed 12345 and weather off (no rain, no evaporation, no river, fixed `T` = 15 °C) unless stated.
- The default tolerance is 0.1% relative or 1e-9 absolute, whichever is larger. A different tolerance is stated in the row.
- A failing test is printed in red with expected and actual values, and `allPassed` is false. The orchestrator must not mark a module done while any test that touches it fails (§13).

| # | Test | Setup | Expected |
| --- | --- | --- | --- |
| 1 | Hydro friction and turbine power (*pure*) | `H_g` = 50 m, Q = 2 m³/s, D = 1 m (A = 0.7854 m²), L = 60 m, ε = 0.0003, ν = 1e-6, ΣK = 2.1, η\_t = 0.85 given explicitly | v = 2.546 m/s, Re = 2.546e6, f = 0.015307 (Swamee–Jain; exactly 0.015 means it was hard-coded), H\_f,major = 0.3036 m, H\_minor = 0.6941 m, total H\_f = 0.9976 m, H\_n = 49.002 m, P\_gen = 817.2 kW (about 829 kW means minor losses were forgotten) |
| 2 | Pump head, power, RTE, flow cap | Same pipe. *Pure:* H\_dyn = H\_g + H\_f with η\_p = 0.80 given explicitly. *Sim:* ask the Tier-1 pump for 2 m³/s | H\_dyn = 50.998 m, P\_pump = 1.2507 MW, RTE = P\_gen / P\_pump = 0.6534. In the sim the cap pass of §2.6 limits the Tier-1 pump to 0.80 m³/s (the pure function does not clamp) |
| 3 | Frustum volume and inversion | `A_bot` = 10,000 m², s = 1.0, d = 10 m | A(d) = 14,400 m², V(d) = 121,333.33 m³; the closed form (d/3)(A\_bot + A + √(A\_bot·A)) agrees to 1e-6; V → d recovers 10.000000 m |
| 4 | Conservation of mass and sign | Weather off, no river; pump 1 m³/s for exactly 3,600 s, then generate 1 m³/s for 3,600 s; repeat at each step size of the ladder | After pumping ΔV\_upper = +3,600.000 m³ and ΔV\_lower = −3,600.000 m³ (equal and opposite to 1e-9); generating gives the opposite; the same at dt = 1, 5 and 30 s |
| 5 | Wind cubic and caps (*pure*) | R = 20 m (A = 1256.6 m²) | v = 10 m/s: 292.5 kW; v = 12: 505.4 kW (rated); v = 13: still 505.4 kW (no cubic runaway); v = 3: 0 (cut-in 3.5); v = 26: 0 (cut-out 25). Tolerance 0.5% |
| 6 | Solar derating and soiling (*pure*) | G = 1000 W/m², 2 m², η = 0.20, T\_amb = 35 °C, shade = 0 | P\_dc = 400 W, T\_cell = 66.25 °C, temperature factor 0.835, P\_ac = 320.64 W with f\_soil = 1.00 and 192.38 W with f\_soil = 0.60 |
| 7 | Penman band | T = 25 °C, RH = 50%, u₂ = 3 m/s, R\_s = 250 W/m² (21.6 MJ/m²/day) | e\_s = 3.17 kPa, Δ ≈ 0.189, E = 9.73 mm/day (±0.05) and in \[5, 12\]; the FAO-56 grass value 7.69 means the wrong denominator was used. T < 0 °C gives E = 0. Over the whole year-1 climate every daily E stays in \[0, 16\] |
| 8 | Cavitation (*pure*) | Turbine, H\_s = 3.0 m given explicitly, H\_n = 49.0 m, H\_atm = 10.33, H\_vap = 0.24; pump at static suction (Q = 0), H\_s,pump = 1.5 m | Turbine σ = 0.14469 (above σ\_c = 0.10, safe); after a 3 m drawdown (H\_s = 6.0) σ = 0.08347 (penalty active). Pump NPSH\_A = 8.59 m (above NPSH\_R = 3.0, safe); after a 7 m drawdown 1.59 m (cavitation). In the sim the Classic start with H\_s,design = 1.0 m and the starting tailwater drawdown of 2.2757 m (§4.1, H\_s,eff = 3.2757 m) has σ = (10.33 − 0.24 − 3.2757) / 49 ≈ 0.1391 (±0.002), margin σ/σ\_c ≈ 1.39, and no cavitation |
| 9 | Merit order, temperature, clamp | Noise off, no heat wave unless stated | P\_base(0) = 45.00, P\_base(8.5) = 75.00, P\_base(13) = 27.00 (±0.01), P\_base(19.5) = 90.00. G = 900, u₂ = 12, h = 13, T = 15 °C: R\_reg = 525 MW and Price₀ = −26.16 $/MWh. h = 19.5, T = 35 °C, R\_reg = 100: m\_T = 1.275, f\_D = 1.11, Price₀ = 75.98. h = 19.5, T = −11 °C, R\_reg = 0: m\_T = 1.32, Price₀ = 118.80. P\_base = 90 with R\_reg = 525 gives −87.19 before the clamp and −50 after it |
| 10 | Economic sign and NPV | Price₀ = −10 $/MWh and the pump takes 1 MW for 1 h; CapEx 10,000, R\_annual 2,000, N = 10, r = 5% | Cash rises by $10 (the sign comes out of the formula, no special case). AF = 7.72173, NPV = +5,443.47 |
| 11 | Stored-energy sanity | Classic upper reservoir, H\_n = 49 m | V\_max = 217,450.56 m³; gross 29.04 MWh, net 24.68 MWh at η\_t = 0.85 (both shown in the Build menu). The lower reservoir has V\_max = 385,517.5 m³ |
| 12 | Robustness sweep | 3 full game days at each step size of the ladder (1, 5, 30 s), across the Winter to Spring boundary (day 91 to 92), all units at maximum and alternating pump and generate every 6 h, a heat wave and a 24 h storm rain active, a battery and a reserve offer active, a 3 h grid emergency | No NaN or Infinity anywhere in the snapshot; volumes within \[0, V\_max\]; health within \[0, 100\]; battery state of charge within \[0, 1\]; Price₀ within \[−50, +500\]; the reliability score within \[0, 100\]; cash finite |
| 13 | Market impact | P\_base = 90, m\_T = f\_D = 1; Price₀ = 60, net export of 10 MW for one hour | λ = 0.3375 $/MWh per MW; profit = 60·10 − 0.3375·100 = $566.25; the revenue maximum is at P = Price₀/(2λ) = 133.3 MW at Price₀ = 90; importing 10 MW at Price₀ = 20 costs 200 + 33.75 = $233.75 |
| 14 | Efficiency hill curve (*pure*) | Tier-1 turbine, H\_des = 55 m, Q\_des = 0.9·2.2 = 1.98 m³/s, η\_rated = 0.85 | H\_n = 55, Q = Q\_des: exactly 0.85. H\_n = 49.00, Q = Q\_des: 0.8331. H\_n = 55, Q = 1.10: 0.7828. With health 50%: η\_mult = 0.975, so 0.85 → 0.8288 (tolerance 0.0005) |
| 15 | Per-step netting | Pump 1 MW from 14:00 to 14:30, then solar 1 MW from 14:30 to 15:00, nothing else | At 15:00 E\_bought = 0.5 MWh and E\_sold = 0.5 MWh (not netted to zero over the hour); settlement uses both. Repeat at dt = 1, 5 and 30 s: identical; no step crosses an hour boundary |
| 16 | Soiling dynamics | f\_soil starts at 0.60 | After 10 dry days 0.594. A cleaning job adds 0.15: 0.594 → 0.744, and 0.90 → 1.00 (capped). A rain day (≥ 5 mm) adds 0.02 up to 0.95: 0.945 → 0.950, and 0.97 stays 0.97. f\_soil never goes below 0.55. A job on the 535 kW array costs 0.80 · 535 = $428 |
| 17 | Reserve call and the ramp | Tier-1 turbine from rest, upper reservoir at its start level, a call at 12:00:00 | After 45 s Q = 1.65 m³/s and P ≈ 659 kW. An offer of 0.7 MW succeeds (needs 0.63 MW) and an offer of 0.8 MW fails (needs 0.72 MW). A battery of the same offer succeeds within one step |
| 18 | Reserve money and score | R\_reg = 300 MW; S = 70 | R\_req = 2.7 MW, π\_cap = 2.2 $/MW/h. A 2 MW offer in a qualified hour pays $4.40; an offer of 3 MW is clamped to 2.7 MW. A call delivering 2 MW for 15 min at Price₀ = 30 pays 0.5 MWh at max(30, 60) = $30. A failed call: the $4.40 is returned and a $8.80 fine is added. S moves 70 → 70.5 on a success, → 65 on a failure, +3 on a successful emergency. At S ≥ 80 the price is × 1.25 |
| 19 | Battery | B1 (1 MWh, 0.5 MW), η = 0.938 each way | Charging 1 MWh from the grid stores 0.938 MWh; discharging it all delivers 0.880 MWh (round trip 0.88 ± 0.001). State of charge stays within 10% to 95%. After 365 equivalent full cycles capacity is 0.927 of nominal. Refurbish costs 0.3 · $10,000 = $3,000 |
| 20 | Environmental flow | Procedural site, Q\_base = 0.15 m³/s, Winter (s\_season = 0.6) | Q\_env = 0.045 m³/s = 3,888 m³/day taken from the lower reservoir; the Classic site has none. Below 5% of the lower depth the release is limited to the available water and the unmet volume costs $0.50/m³ |
| 21 | Dam and excavation costs | Classic: raise 50 m → 60 m. Procedural: W\_bot(x\_dam) = 40 m, s = 0.8, gravity class. Lower reservoir excavation stage 1 | Classic raise: $35,200, 4 days. Procedural: V\_conc(10 m) = 3,506.67 m³ = $42,080 and V\_conc(20 m) = 11,573.33 m³ = $138,880, so the raise costs $96,800 and takes 4 days; the arch class at 20 m uses 6,906.67 m³ = $82,880. Cost is strictly increasing in H. Excavation stage 1: ΔV = 61,998 m³, $8,240, 2 days |
| 22 | Loans and LCOS | $50,000, 6% APR, 12 months; an emergency shortfall of $1,230; LCOS with CapEx 100,000, O&M 2,000 a year, 500 MWh a year, r = 5%, N = 20 | M = $4,303.32, total interest $1,639.86, final balance exactly 0. Emergency loan = $7,000 at 12% over 6 months, M = $1,207.84. LCOS = 100,000 / (500 · 12.4622) + 4.00 = $20.05/MWh |
| 23 | Determinism and save | Seed 12345 and a fixed action script, 30 game days | Two runs give the same `stateHash`. Saving at day 10, loading and continuing to day 30 gives the same hash as the uninterrupted run. `replay(seed, actionLog)` gives the same hash. A different seed gives a different hash |
| 24 | Economy pacing | Starting configuration, seed 12345, year 1, scripted policy: pump in the 6 lowest-price hours of each day and generate in the 6 highest, no purchases | Mean net income per day in \[$40, $120\]. The §7.4 payback of the Tier-2 pump and turbine pair at the start is between 200 and 450 days. Print both values. If the payback is outside the range, change only `CAPEX_SCALE` (§7); if the income is outside it, report it |
| 25 | Step cost | 10,000 steps headless at dt = 1 s, one site and then three sites | Average under 0.05 ms per site per step. This test warns and does not fail, because it depends on the machine |

After the table, `SelfTest` prints one summary line: the number of tests passed out of 25, the robustness sweep result (`ticksRun`, `nanCount`) and the two values of Test 24.

## 13. Orchestration

The orchestrator (Sonnet, medium effort) does not write game code itself, except the glue in the bundle step. It plans, hands out work, checks results and keeps the goal tracker. Everything below is a rule for that role.

### 13.1 Order of work

1. **Packages first.** Before any subagent starts, the main agent fetches everything the project depends on and vendors it into the repository: the Three.js build (pinned version, minified IIFE, committed under `vendor/`) and any other library or tool the bundling step needs. Subagents work offline from `vendor/` and never install or fetch anything themselves. The main agent records the versions in `PROGRESS.md`.
2. **Contract first.** One agent writes `CONFIG`, `createInitialState()`, the action list (§11.2) and the audit hook skeleton (§11.6) before anything else starts. All later agents read this contract and do not change it. If a change is needed, the orchestrator makes it and tells every agent that has already started.
3. **Headless core.** Physics, climate, market and economy are built and tested with no UI, because every test in §12 except the UI checks can run headless.
4. **Gameplay layer** (§9) on top of the passing core.
5. **UI and 3D** (§10) against the contract and a passing core, so they read `getSnapshot()` and dispatch actions and never touch the state directly.
6. **Bundle, full audit, polish.**

Work inside a stage may run in parallel. A stage does not begin until the one before it passes its tests.

### 13.2 Roster

| Agent | Owns | Spec sections | Default model and effort |
| --- | --- | --- | --- |
| Contract | `CONFIG`, state shape, actions, audit hook | §1, §8.7, §11 | Opus low |
| Physics | hydraulics, reservoirs, cavitation, wear | §2, §3, §4 | Opus low |
| Climate and market | weather, wind, solar, pricing, market impact | §5, §6 | Opus low |
| Economy | finance, build costs, siting, dams, soiling | §7, §8 | Sonnet medium |
| Gameplay | contracts, reserve, quests, rule engine, multi-site | §9 | Sonnet medium |
| UI | panels, themes, menus, charts | §10 (UI part) | Sonnet medium |
| 3D | scene, art styles, performance modes | §10 (3D part) | Opus low |
| Tests | `SelfTest`, robustness sweep, replay | §12 | Sonnet medium |
| Reviewer | reads finished modules against the spec, writes no code | all | Opus low |

The last column is a default. The orchestrator chooses the model and effort for each agent and may change them when the task is lighter or heavier than usual. The ladder runs Sonnet medium, Sonnet high, Opus low, Opus medium. Agents start on their default and move up only through the escalation rule below; Opus medium is the top and is reached only after repeated failures. Rules for choosing:

- Opus low for work where a quiet numerical error is easy to make and hard to see (physics, market, 3D math, the contract) and for every review.
- Sonnet medium for work that is mostly structure and wiring (UI panels, gameplay rules, tests, bundling).
- Escalate when a module fails a test for a real reason: after one failure, Sonnet medium goes to Sonnet high; after a second failure on the same test, to Opus low; after a third, to Opus medium. An agent already on Opus low goes to Opus medium after two failures. Drop back to the default once the test passes. Do not step up for a failure that is a typo or a missed requirement.
- Do not use a higher level for an agent whose task is under about 200 lines.

### 13.3 Rules for every subagent

- Each agent gets the contract, only the spec sections it owns, and the tests that cover them. It does not need the rest.
- An agent edits only its own files in `src/`. Needing something from another module means asking the orchestrator, who changes the contract or the owner.
- Agents work offline from `vendor/` (§13.1) and install or fetch nothing.
- No agent changes `CONFIG` values or a formula to make a test pass. A failing test means the module is wrong, or the table is wrong and the orchestrator is told which.
- Every agent finishes by running the tests for its module and reporting the actual numbers, not a statement that they pass.
- A module is not done until the orchestrator has run its tests itself.
- Agents write no placeholders: no TODO that changes behaviour, no stubbed function that returns a constant.
- **Decision log.** Each agent keeps its own short log in `decisions/<agent>.md`: one dated entry per non-obvious choice (what was chosen, what else was considered, why), a few lines each. It records choices, not a diary of steps, and it is committed with the module.
- **Git history.** The project is a git repository from the first step, and the history is written to be read by a person. The orchestrator commits after every merged module and every closed stage, one logical change per commit. A commit message is a subject line of 72 characters or fewer in the form `module: what changed` (for example `physics: hydraulics and caps (§2)`), plus at most three short lines of body when the reason is not obvious. No lists of files, no pasted test output, no paragraphs; details belong in the decision log and `PROGRESS.md`. Agents do not rewrite or squash history, and a fix is a new commit. Each stage is tagged (`stage-1-contract`, `stage-2-core`, and so on), so J can return to any of them.

### 13.4 Goal tracker

The orchestrator keeps `PROGRESS.md` in the project root and updates it after every stage and every merged module:

- one line per module: owner, status (`todo`, `building`, `tests failing`, `passing`, `reviewed`), the test numbers that cover it;
- the last `SelfTest` summary line (§12), including `ticksRun`, `nanCount` and the two values of Test 24;
- a list of deviations from this spec, each with the reason;
- open questions for J.

The tracker is the only memory between sessions. If the work is resumed, the orchestrator reads it first.

### 13.5 Review and integration

- After each stage the Reviewer reads the finished modules against the spec and returns a list of mismatches (a wrong formula, a missing case, a hard-coded value). The owner fixes them. The Reviewer does not edit.
- Integration is done by the orchestrator: bundle into the single file (§11), open it headless, run the full audit and read `window.__HYDRO_AUDIT__.testResults`.
- A stage is closed only when `allPassed` is true, `nanCount` is 0 and the Reviewer's list is empty.
- Test 24 is the exception: if it fails, the orchestrator reports the numbers to J and does not retune anything beyond `CAPEX_SCALE` (§7) on its own.

### 13.6 Stopping

The orchestrator stops and asks J only for a decision that cannot be undone or that the spec leaves open in a way that changes the game (for example a pacing result outside the range). Everything else it decides, records in `PROGRESS.md` and continues.

## 14. Deliverable

The orchestrator hands J the following, and nothing is delivered until the checks in §14.3 pass.

### 14.1 What is delivered

1. **`hydropower-tycoon.html`**: one self-contained file, bundled from `src/*.js` with the vendored Three.js build (§11). It opens by double-click, needs no server and no network, and uses no external fonts or scripts.
2. **The git repository** with the full history (§13.3): `src/`, `vendor/` (Three.js), `decisions/` (each agent's log), the bundling script, `PROGRESS.md`, and a tag per stage.
3. **`PROGRESS.md`** in its final state: every module `reviewed`, the last `SelfTest` summary line, the list of deviations from this spec with reasons, and the open questions.
4. **`SELFTEST_REPORT.md`**: the output of the 25 tests of §12 as a table (test number, expected, actual, pass or fail), the robustness sweep result (`ticksRun`, `nanCount`), and the two values of Test 24 (mean net income per day and the Tier-2 payback in days).
5. **`README.md`**: how to open the game, how to rebuild the single file, how to run the audit headless, and the one line that says which constant to change for pacing (`CAPEX_SCALE`).

### 14.2 Reporting to J

The final message is short: what was built, where the files are, the pacing numbers from Test 24, every deviation from the spec, and anything left for J to decide. It does not retell the work.

### 14.3 Acceptance checks

- The bundled file loads with no console errors, in a clean browser profile and offline.
- `window.__HYDRO_AUDIT__.allPassed` is true and `nanCount` is 0.
- Test 24 is inside its ranges, or its numbers are reported to J as an open question.
- The three themes and three art styles (§10) all render, and the performance modes Low, Medium and High switch without a reload.
- The interface passes the contrast checks of §10 (WCAG AA) in every theme.
- The Reviewer's last list is empty.
- The working tree is clean and the last commit carries the final tag.

If a check cannot be passed, the orchestrator delivers anyway, marks the file as not accepted in `PROGRESS.md` and names the failing check in the final message.
