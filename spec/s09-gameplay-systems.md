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

