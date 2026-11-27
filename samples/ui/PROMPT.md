# Prompt: one UI iteration for Hydropower Tycoon

How to use: paste everything below the line into a fresh chat or agent, once per iteration. Change only the `DIRECTION` line (pick one from the list at the bottom, or write your own). Each run produces one self-contained HTML file. Any capable model works; nothing in the repo needs to be read.

---

Design ONE clickable UI sample as a single self-contained HTML file. I will compare it with other iterations of the same scene and pick a direction, so commit fully to the direction given and do not hedge toward a generic dashboard. It should look like a finished interface, not a wireframe.

DIRECTION: <paste one direction here>

OUTPUT: one file, `ui-<short-direction-name>.html`. Inline CSS, inline SVG and plain JS only. No external fonts, images, libraries or network requests. Keep it under 700 lines. Reply with the file and at most five lines of notes (the idea, and its weakest spot).

THE GAME: "Hydropower Tycoon, field station edition". A cozy pumped-storage hydropower game you inhabit. You are an athlete who walks a low-poly valley (powerhouse, dam, two lakes, solar and wind parcels, a rim lookout) and operates each machine by walking up to it. Underneath is real physics and a real electricity market: pump water uphill when power is cheap, generate when it is dear. The interface must feel calm and personal. It is not a control room: no gauge strips, no dense tables, no dashboard grid, no permanent panels.

LOCKED LOOK ("Field Notes"): paper `#f1ead9`, ink `#2b2a26`, moss `#4f6b3a`, clay `#a3472c`, river `#2f6f86`, ochre for fills only. Small radii, serif headings, monospaced tabular numbers, system font stacks. Text contrast WCAG AA. State is never shown by colour alone (add an icon, label or pattern). Respect `prefers-reduced-motion`.

THE MOMENT (use these numbers verbatim so iterations compare fairly): Day 12, 17:40, late-summer dusk. The player stands at the powerhouse.
- Cash $412,860. Today so far +$1,930. Time mode "Field pace" (1 s = 1 min).
- Generating 6.4 MW at 14 m³/s, head 92 m. Turbine T2 health 81%, pump T1 health 96%.
- Upper lake 71% full, lower lake 38%.
- Price now $84/MWh. Peak 18:00–21:00, up to $112. Cheapest 02:00–05:00 at $21.
- Automation is ON with three rules, highest priority wins: (3) price above $90 → generate at 16 m³/s; (2) price below $30 → pump at 12 m³/s; (1) upper lake above 95% → generate at 8 m³/s.
- Just refused: "Repair turbine". Why: "Unit must be idle to repair. Set Idle first."
- Just completed: quest "First full cycle: pump at night, generate at the peak", reward $5,000.
- Weather: clear tonight, wind picking up tomorrow 14:00, rain in two days.

BACKDROP: behind the UI, draw a simple but attractive stand-in for the 3D view in inline SVG: a faceted low-poly valley at dusk with an upper lake behind a dam, a penstock down to a powerhouse with lit windows, a lower lake, a few conifers, and a small athlete figure at the powerhouse. Add a night variant: dark, moonlit, with a warm torch halo around the player. The UI is the subject; spend at most a quarter of the file on the backdrop.

WHAT THE PAGE MUST SHOW (the four things that decide the direction):
1. Walking: HUD only (cash, clock, time-mode chip, pause, menu) over the world. Nothing else permanent.
2. At the powerhouse: the station card with Generate / Pump / Idle, the flow control (disabled, with the reason shown, while automation is on; enabled when automation is switched off), turbine and pump health with Repair, and a "wait" row (1 h / until next peak / until morning).
3. Feedback: the refusal toast with its "why", sitting above the open card, and the quest notice with a one-click claim.
4. The forecast board: the 24 h price curve with the peak window marked, the weather, and a one-sentence reading of it.

Also: a day/night toggle (the UI must stay readable over the dark world) and a phone-width toggle that shows the same UI in a 390 px frame with the card as a bottom sheet.

CONTROLS: put a slim strip labelled "Sample controls", visibly separate from the game UI, with: Walking / At powerhouse / Forecast board / Toast / Quest / Day–Night / Phone width. Inside the game UI, wire the cheap interactions for real: the mode buttons switch state, the automation switch enables the flow control, Claim removes the quest notice, toasts dismiss, Esc closes the card, keyboard focus is visible.

BEFORE YOU REPLY, check: no dead game controls, no overlapping text at 1280×800 or at 390 px, the toast layer is above the card, no console errors.

---

## Directions to choose from (one per run)

1. **Pocket notebook.** The interface is the player's own field notebook. Cards are ruled pages with a margin and a tab per station, actions are ink stamps, a finished quest is a sticker, toasts are paper slips tucked over the page edge, the forecast is hand-plotted on graph paper. Warm and tactile, but restrained: no fake stains, no illegible script.
2. **Tethered tags.** The world is the hero and the UI lives in it. The station card is a small paper tag tied by a thin leader line to the machine, showing two or three things and unfolding more on demand. The HUD is two luggage-tag chips. Other stations are tiny pins with distances. The forecast board is a noticeboard object in the scene that enlarges when approached. Smallest footprint of all.
3. **Survey ledger.** For the player who likes numbers, without a control room. One calm sheet slides in from the right, set like a surveyor's logbook: strong type hierarchy, hairline rules, aligned mono columns, and a plain sentence saying what is happening and why ("Generating into the evening peak. At this rate the upper lake lasts about 5 h."). One primary action per section.
4. **Trail signs.** Everything is wayfinding. Cards look like painted wooden trail signs and enamel plates fixed to posts and walls, with big pictograms and very few words. Built for glancing while moving.
5. **Radio and postcards.** Information arrives as short messages rather than panels: a handheld radio strip at the bottom speaks in sentences ("Price peaks in 20 minutes"), and each station is a postcard with a picture side and a controls side you flip.
6. **Map table.** The card is a folded topographic map sheet of the valley with the current station circled; controls sit in the map's legend box, and the forecast is drawn as a profile along the map's edge.
7. **Your own:** one or two sentences describing the feel, what a card is made of, and where it sits on screen.
