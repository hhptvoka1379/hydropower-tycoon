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

