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

