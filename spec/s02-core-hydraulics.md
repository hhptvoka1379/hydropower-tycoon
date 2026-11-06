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

