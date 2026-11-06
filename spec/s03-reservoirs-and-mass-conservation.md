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

