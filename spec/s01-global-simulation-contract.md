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

