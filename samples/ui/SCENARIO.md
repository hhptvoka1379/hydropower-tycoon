# Shared scenario for the UI samples (identical data in every sample, so they compare fairly)

Moment: Day 12, 17:40, late-summer dusk, classic site. The player stands at the powerhouse.
- Cash $412,860. Today so far +$1,930. Time mode "Field pace" (1 s = 1 min). 
- Plant: generating 6.4 MW at 14 m³/s, head 92 m, turbine T2 health 81%, pump T1 health 96%.
- Upper lake 71% full, lower lake 38%. Price now $84/MWh; today's peak 18:00–21:00 at up to $112; cheapest 02:00–05:00 at $21.
- Automation ON, 3 rules: (1) price above $90 → generate at 16 m³/s, priority 3; (2) price below $30 → pump at 12 m³/s, priority 2; (3) upper lake above 95% → generate at 8 m³/s, priority 1. "Highest priority wins."
- Because automation is on, the flow slider is disabled with the reason shown.
- A rejected action just happened: "Repair turbine" → refused, why: "Unit must be idle to repair. Set Idle first." This toast must sit ABOVE the open card.
- A quest just completed: "First full cycle: pump at night, generate at the peak" → reward $5,000, one-click claim.
- Weather: clear tonight, wind picking up tomorrow 14:00, rain in two days.
- Stations (for any map/list): Powerhouse, Forecast board, Dam crest, Valve house, Upper shore, Lower shore, Parcel desks A/B/C, Slide platform, Rim lookout (office).

Each sample must show, switchable inside the one page:
1. Walking view: HUD only (cash, clock, time-mode chip, pause, menu) over the world. Nothing else permanent.
2. At the powerhouse: the station card (Generate / Pump / Idle, flow, turbine + pump health with repair, reserve offer, "wait" row: 1 h / until next peak / until morning).
3. The toast with its "why", visible above the card; the quest-complete notice with claim.
4. The forecast board (24 h price curve with peak hours marked, weather; a text alternative).
5. The rule editor as stacked cards, with an unsaved marker after an edit.
6. A critical alert banner ("Grid emergency: 40 MW short for 2 h. Time slowed to field pace.").
7. Day / night toggle (night = dark world, torch halo around the player; UI must stay readable).
8. Phone width (≤ 480 px): the card becomes a bottom sheet.

Locked look: Field Notes theme. Paper #f1ead9, ink #2b2a26, moss #4f6b3a, clay #a3472c, river #2f6f86, ochre for fills only. Small radii, serif headings, mono tabular numbers, WCAG AA text, state never by colour alone. Chill, not a control room: no gauge strips, no dense tables, no dashboard grid.
