# Stations for the walking-player design

Status: design list for the walking player (FABLE_PLAN Phase 3–5). Written 2026-11-16 against `game/legacy/v2.index.html`.

How to read this:
- **Action names** are the `case` labels of `applyAction` in v2 (lines 1282–1368). They are real. Payload fields are read from that code.
- **[PROPOSED]** marks names, numbers and placements that do not exist yet.
- **Range** is the distance at which standing in front of a station opens its card. All ranges are **[PROPOSED]** placeholders to tune in play.
- **Remote read-only** follows the decision in FABLE_PLAN §0: remote views are read-only. Remote control is allowed only for pause, save/load, settings and the rule engine's master switch.
- **Time-mode** is what the station offers for waiting. v2 has only the speed ladder (`SET_SPEED` 0–5, `SET_TURN`, `TURN_STEP`, `PAUSE`). Waiting options are new, see the note at the end.

Layout anchors used below come from the v2 slide code (lines 1952–1955): `layout.ph` (powerhouse), `layout.dam`, `layout.tail` (tailrace), `layout.lo` (lower lake centre), `layout.parcels`, `site.route` (penstock route). Upper basin centre is not named in that code; **[PROPOSED]** `layout.up`, to confirm.

---

## Global time and pause (any station, remote allowed for pause only)

| Action | Payload | Note |
|---|---|---|
| `START` | none | Starts the sim. |
| `PAUSE` | `paused` (optional bool) | Toggles if omitted. Remote allowed. |
| `SET_SPEED` | `speed` 0–5 | Speed ladder. Sets `turnMode=false`. Retired from the main HUD by Phase 4. |
| `SET_TURN` | `on` | Turn mode on or off. Resumes a paused sim. |
| `TURN_STEP` | none | One step in turn mode. |

---

## 1. Powerhouse (`layout.ph`)

Card: generation and pumping at this site.

| Action | Payload | Note |
|---|---|---|
| `SET_MODE` | `mode` gen / pump / idle, `q` (optional flow), `god` (optional bool) | Rejected for gen or pump with no dam. Turns automation and god dispatch off unless `god` is set. |
| `SET_FLOW` | `q` 0–20 m³/s | Flow setpoint. Disabled while automation is on, with the reason shown (B10). |
| `BUILD` | `kind` turbine or pump, `tier` | Tier is accepted as 0–2 in code, but the message says 1–3. See the open question below. |
| `REPAIR` | `target` turbine or pump | Cost is `cost × repairFrac`. Scale to damage (B7). |
| `SET_RESERVE_OFFER` | `mw` | Offer checked against `reserveCap(s)`. Shows the cap as the reason on rejection. |
| `SET_CURTAIL` | `frac` (no `tile`) | Sets the **site-wide** solar curtailment. It does not apply per tile. |
| `SET_RULES` | `rules` (8 slots) and/or `enabled` | Rule editor is a card at the powerhouse. The **master switch** (`enabled`) is remote-allowed. |

Remote read-only view: **yes**. A plant summary (generation, flow, head, reserve, status). Cannot set mode, flow, rules or offers from remote.

Time-mode at this station: **wait for the next peak** and **wait until morning** (both [PROPOSED], see the note at the end). Auto-slow to 1× on grid emergency, cavitation or crack.

Range: 6 m **[PROPOSED]**.

### Forecast board (powerhouse, separate object)

Card: read-only. 24 h price, peak hours, weather (`climateAt`, `sunAt`, `renForecastMW`).

| Action | Note |
|---|---|
| none | No sim action. The board is diegetic and read-only. |

Remote read-only view: **yes**, same data.

Time-mode: this is where **wait for the next peak** sits, because the board shows the peak hours. [PROPOSED]

Range: 8 m **[PROPOSED]**, so it can be read from the yard.

---

## 2. Dam crest (`layout.dam`)

Card: the dam, its raise, its crack and its permits. Visible only at proc (canyon) sites where a dam exists or can be placed.

| Action | Payload | Note |
|---|---|---|
| `PLACE_DAM` | `station` (optional), `height` (min 5 m) | Canyon sites only. Needs a permitted choke point and the permit class for the height. Keeps equipment, parcels, rules and the lower lake. Resets the penstock on a new station. |
| `RAISE_DAM` | `meters` (≥1) | Rejected while a crack exists or a raise is under way. Cost is the integrated `damCost`. Quote is read-only on the card. |
| `REPAIR` | `target: 'dam'` | Only when `dam.crack` is set. Cost is `dam.value × repairFrac`. |
| `BUY_PERMIT` | `kind: 'dam'`, `cls` gravity or arch | Permit for the dam class. Arch needs gravity first. Placed here because the UI puts dam permits under Build → Dam & basin. |

Remote read-only view: **yes**. Dam height, crest length, crack status, storage, quote for the next raise.

Time-mode: **wait until the raise finishes** (the job takes `dam.hoursPerM × m` hours) [PROPOSED]. Waiting here does not change the sim, it only runs the clock.

Range: 8 m **[PROPOSED]**.

---

## 3. Penstock (`site.route`, `layout.penstock`)

Card: the pipe from the upper lake to the powerhouse.

| Action | Payload | Note |
|---|---|---|
| `REPLACE_PENSTOCK` | `D` (within `penstock.Dmin..Dmax`), `mat` (key of `penstock.materials`) | Pauses the flow for the job (`s.q = 0`). Cost via `penstockCost`. |

Remote read-only view: **yes**. Diameter, material, length, friction loss, condition.

Time-mode: **wait until the replacement is done** [PROPOSED].

Range: 5 m along the pipe **[PROPOSED]**. Pipe is long, so the card opens at a valve chamber or the nearest point to the player.

---

## 4. Upper lake shore

Card: the upper basin. It has no sim action in v2. It is an observation point.

| Action | Note |
|---|---|
| none | Upper basin fills from the river. Its only control is through `PLACE_DAM` (which resets it). |

Remote read-only view: **yes**. Level, volume, inflow, snow store.

Time-mode: **wait until the upper basin is full** [PROPOSED]. Useful after `PLACE_DAM`, when the basin is empty.

Range: 6 m **[PROPOSED]**.

---

## 5. Lower lake shore (`layout.lo`)

Card: the lower basin and its excavation.

| Action | Payload | Note |
|---|---|---|
| `EXCAVATE` | none | Next excavation stage (cost rises 50% per stage, max `excavStages`). Rejected if one is under way or all are done. |

Remote read-only view: **yes**. Level, spill, excavation stage.

Time-mode: **wait until excavation is finished** [PROPOSED].

Range: 6 m **[PROPOSED]**.

---

## 6. Solar tile

Card: one solar array on a tile. Tile index is `a.tile`.

| Action | Payload | Note |
|---|---|---|
| `BUILD` | `kind: 'solar'`, `tile`, `tier` | Rejected if the tile has solar already or the parcel is not owned. Known bug: solar on a battery tile is allowed, and the UI quote does not match (B5). |
| `CLEAN_ARRAY` | `tile` | Rejected if already clean. |
| `BUY_PERMIT` | `kind: 'parcel'`, `parcel` 1 or 2 | Shown here when the tile's parcel is not owned, because `BUILD` rejects without it. |

Solar curtailment is not here. `SET_CURTAIL` without a tile applies to the whole site, so it sits on the powerhouse card.

Remote read-only view: **yes**. Output, soiling, tier.

Time-mode: **wait for clear weather** is not offered. Wait until the next morning [PROPOSED] only, since soiling and output depend on the day.

Range: 4 m **[PROPOSED]**.

Note: 48 tiles per site (`validateSave` requires 48). A card per tile is too many stations. See the open question below.

---

## 7. Wind tile

Card: one wind turbine on a tile.

| Action | Payload | Note |
|---|---|---|
| `BUILD` | `kind: 'wind'`, `tile`, `tier` | Rejected if the tile has wind, or holds a battery. The "not compatible" reason is missing (B5). |
| `SET_CURTAIL` | `tile`, `frac` 0–1 | Per turbine. Rejected if the tile has no wind. |
| `REPAIR` | `target: 'wind'`, `tile` | Only when `w.damaged`. Cost is `kW × costKW × repairFrac`. |

Remote read-only view: **yes**. Output, damage, tier, curtailment.

Time-mode: **wait until the repair is done** [PROPOSED].

Range: 4 m **[PROPOSED]**.

---

## 8. Battery tile

Card: one battery on a tile.

| Action | Payload | Note |
|---|---|---|
| `BUILD` | `kind: 'battery'`, `tile`, `tier` | Rejected if the tile has a battery or wind. |
| `SET_BATTERY` | `tile`, `mode` auto / charge / discharge / idle | Battery mode. |
| `REPAIR` | `target: 'battery'`, `tile` | Refurbish. Only when `fade ≥ 0.001`. Resets fade and the threshold. |

Remote read-only view: **yes**. State of charge, fade, mode, tier.

Time-mode: **wait until the battery is full or empty** [PROPOSED].

Range: 4 m **[PROPOSED]**.

---

## 9. Slide platform (`World.slide`, render-only)

Card: the waterslide. No sim action. Render-only.

| Action | Note |
|---|---|
| none in the sim | Riding the slide is render-only (see `decisions/sonnet-followups.md`). It spends nothing and changes no state. |

Remote read-only view: **not needed**. The slide has no sim state. The survey lens hides it (v2 2214–2216).

Time-mode: none.

Range: 6 m **[PROPOSED]**.

---

## 10. Rim lookout

Card: the site overview and the bank. It is the one place for finance, quests and site selection.

| Action | Payload | Note |
|---|---|---|
| `SET_ACTIVE` | `site` (index) | Chooses the active site. |
| `BUY_SITE` | `id` | Shop site. Needs the water permit first. |
| `BUY_PERMIT` | `kind: 'water'`, `id` | Water-rights permit for a shop site. |
| `TAKE_LOAN` | `amount` | Rejected above `maxLoan`. Automation never borrows. |
| `REPAY_LOAN` | `amount` | Capped at the loan balance. |
| `SIGN_CONTRACT` | `id` | At most two active contracts. |
| `CLAIM_QUEST` | `id` | Claims a completed quest reward. |
| `EMERGENCY_CREDIT` | none | One time only. Shown in the bankruptcy dialog. Bankruptcy is recoverable (FABLE Phase 1). |

Placement note: FABLE_PLAN says the forecast board is read-only. Finance, quests and site selection need a home, so they sit at the rim lookout. This is **[PROPOSED]**. See the open question below.

Remote read-only view: **yes**. Cash, loans, contracts, quest progress, site overview.

Time-mode: **sleep until morning** and **wait for the next peak** [PROPOSED]. The lookout is the usual sleep spot.

Range: 8 m **[PROPOSED]**.

---

## Settings (remote allowed, no station)

| Action | Payload | Note |
|---|---|---|
| `SET_GOD` | `enabled`, `dispatch`, `curtailNeg`, `protect`, `planner`, `flowTarget`, `cashReserve`, `cheapHours`, `peakHours` | Opt-in assisted mode from the start screen (FABLE §0). The plan does not say where runtime changes happen. Open question. |
| `SET_OPTION` | `key: 'cashReserve'`, `value` | Settings. Remote allowed. |

---

## Time-mode waiting options (all [PROPOSED])

v2 has no wait action. The walking design adds these, and they map onto the existing clock controls:

- **Wait for the next peak** (forecast board, powerhouse, rim lookout): advance the sim at a fixed rate until the next peak hour from the forecast.
- **Wait until morning** (rim lookout, solar tile): advance until the next sunrise.
- **Wait until a job finishes** (dam crest, penstock, lower lake, wind tile): advance until the job's ETA.
- **Auto-slow:** any wait stops and drops to 1× with a banner on grid emergency, cavitation, dam crack or bankruptcy. Reserve calls must stay reachable at any speed (FABLE Phase 4, A8).

These are implemented by the time-mode controller in Phase 4. They are not in the sim's action list today.

---

## Open questions

1. **Tier range.** `BUILD` accepts `tier` 0–2 but its message says "Tier must be 1–3". Which is right? Check `C.turbine[tier]` and `C.wind.tiers`.
2. **Tiles vs stations.** 48 tiles per site cannot each have a card. Options: one station per parcel (listing its tiles), or one station per equipment type. Decide before building the tile cards.
3. **Finance placement.** Loans, contracts and quests at the rim lookout is a proposal. The alternative is a separate bank desk.
4. **Where `SET_GOD` and `SET_ACTIVE` live.** Both are settings-like. Remote or station-bound?
5. **Upper basin anchor.** The code does not name it. Confirm `layout.up` (or the equivalent) before placing the upper lake shore.
6. **Forecast board wait.** It sits at the powerhouse. Is it a separate station object or part of the powerhouse card?
7. **Parcel purchase.** It is shown on the solar tile card here, but parcels cover several tiles. Confirm that a parcel purchase belongs to the parcel station.
