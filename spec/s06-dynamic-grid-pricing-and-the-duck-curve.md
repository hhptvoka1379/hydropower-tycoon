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

