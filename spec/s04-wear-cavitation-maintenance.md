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

