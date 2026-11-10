# Notes on the reconstructed attempts

## Standout: sonnet fail (patched)

`reconstructed/sonnet fail-hydrogame/index.fixed.html` — the user found this one
quite impressive when opened in Safari.

- The original `index.html` only failed because `canvas` was never declared in
  `initGL`, so the "WebGL2 is not available" overlay covered the UI.
- The fix is one line, added just before `function initGL()`:
  `var canvas=document.getElementById("gl");`
- Its built-in self-test (31 tests) passed on the unpatched file.
- Original `index.html` left untouched.

## Status of the others (headless Chromium checks)

| Source | Status |
|---|---|
| sonnet-5.5 | Works as-is (4 of 17 self-tests fail) |
| opus-arena | Works as-is (1 self-test fails) |
| option b (`index.html`) | Works as-is; prefer it over `index.as-created.html` |
| fable-5.2 | `index.fixed.html`: Math alias renamed to `logM` (line 99) and its calls on line 154; verified playable on a scratch copy |
| fable-xh | `hydropower-tycoon.fixed.html`: syntax error, Build quote persistence, drawer overlap, payback and toast fixed; verified playable |
| option A | Truncated capture, won't run |
| max-router | Empty template with placeholders, not a game |
| opus5.5 | `opus5.5 not bad/index.fixed.html`: added `[hidden]{display:none!important}`, renamed clobbered `W.pick`->`W.pickList` and `W.preset`->`W.presetName`; fixed copy verified (32/32 self-test) |
| failedfablerun | B model's reply was never saved, nothing to extract |

## Playtest notes (live, built-in browser)

Played three tabs: fable-5.2 (`index.fixed.html`), opus-arena, sonnet-5.5.
Short sessions only; first impressions, not a full playthrough.

### Intuitive
- **Build panels show est. $/day, payback days and NPV per item** (all three). Best mechanic:
  you can pick purchases without guessing.
- **sonnet-5.5 construction queue**: "Under construction: Turbine Tier 2, 35 h left" with a
  progress bar, and the button greys out as "Already being built". Clear feedback.
- **sonnet-5.5 layout**: Build is a side panel that does not cover the bottom toolbar. Best layout of the three.
- **fable-5.2 quests**: 20-step ladder with plain goals and rewards ("Commission a wind rotor, $3,000"),
  works as a tutorial. Claimed quests are stamped.
- **opus-arena start state**: a working plant is already running (+0.89 MW, $400k), so you see the loop immediately.
- **Rule engine (IF price > 95 THEN generate, IF price < 45 THEN pump)**: readable IF/THEN slots,
  and it is the core arbitrage loop of the game.
- **Click a building for a popover** (opus-arena powerhouse): mode, flow, power, head, efficiency, cavitation margin, with Generate/Pump/Auto buttons.

### Sucks
- **Idle with no explanation** (sonnet-5.5, opus-arena): 0.00 MW and a negative "today" at start.
  The plant sits idle because the default rules only fire above $95 or below $45, and nothing says so.
  A new player assumes it is broken.
- **fable-5.2 starts nearly bankrupt** ($6.8k cash by day 6) with a $14k turbine, so the first
  decisions are forced. A rejected purchase shows a toast that is partly hidden behind the panel.
- **No purchase confirmation** (opus-arena): building a solar block only changed cash, with no toast or "queued" state.
- **Build panel covers the toolbar** (fable-5.2, opus-arena): you must close it to switch tabs.
- **Popover stacks over the Build panel** (opus-arena): the powerhouse popover overlapped the panel, unreadable until closed.
  Clicking the powerhouse also took a moment to respond.
- **Night is near-black** (fable-5.2, opus-arena): the scene is hard to read at night; the sim runs through it at high speed.
- **Dense jargon** (Thoma sigma, NPSHa, "Ø1.6 m"): fine for engineers, but nothing explains it.
- **Speed buttons are unlabelled steps** (sonnet-5.5 shows 1-6 with no units; fable-5.2 and opus use 1m/s, 1h/s).

### Your feedback (added after the playtest)
- **fable-5.2 speed toggles** are too limited (1x, 10x, 1m/s ... 1h/s). Wanted finer or wider steps.
- **fable-5.2 loans**: it is fine to be aggressive with loans; the near-bankrupt start is tolerable if loans are easy to take.
- **fable-5.2 snow**: the volumetric snow box looks bad.
- **Big issue (sonnet-5.5 tab, the one on screen when this was said): the upper reservoir is a flat
  "plane" used as the water surface, and it looks bad.** It floats as a disc on the hillside.
  The water should instead fill a basin with a real surface that rises and falls.
- **Penstock goes straight down.** It should run a long way along the slope and not drop vertically,
  because of terminal velocity / friction losses (and it matches how real penstocks are laid).

### Opus 5.5 playtest (`opus5.5 not bad/index.fixed.html`), user's pick as the best of the batch
You said the sonnet-5.5 style isn't for you, so I dropped the reservoir/penstock patch there.

Intuitive:
- Welcome card states the whole loop in two sentences (pump when cheap, generate when dear).
- Classic start is a crater upper lake with a long penstock down to the lower lake, i.e. the shape you wanted.
- Operate panel: manual Generate / Pump / Idle, live upper/lower fill %, and a 24 h price forecast
  with peak hours in clay. Easy to learn the arbitrage loop.
- Alerts list is timestamped and plain ("Grid emergency for 3 h: prices and reserve pay are elevated").
  Quests are plain goals with rewards, and a quest completion gets announced.
- Automation works: with the master box on, the default rules pump at $13/MWh (-1.12 MW) and
  cash rose about $5k over a week of sim time.
- Build panel has Tiles / Plant / Dam & basin / Land & sites tabs and a parcel grid; you can click tiles in 3D.
- Self-test toast on load: all 32 passed.

Sucks:
- **Automation is shipped OFF.** The default rules are filled in but the "Automation enabled" master box is
  unchecked, so a new player runs manually. Easy to miss.
- **Rule editor columns are far too narrow**: the If/And/Then dropdowns show only fragments ("pu", "ge") or
  nothing, so you can't read what a rule does.
- Manual Pump keeps running until the lower lake is nearly dry (1 %), and the game doesn't warn you.
- Speed 5 sims about three days in a few real seconds, so you miss events (a grid emergency passed unnoticed).
- Alerts popover stays open over other panels until you click the bell again.
- Very dark at night; a nearly empty lower lake renders with striped banding.

### Opus 5.5, longer session (about 50 game days)
Bugs / issues found while actually playing:
- **Clicks get lost while the sim is running.** My first Build click on tile 2 did nothing: cash unchanged,
  panel jumped back to the top. After pausing, the same click worked ($312k to $144k, tile became
  "Occupied: battery"). Looks like the periodic panel re-render swallowing clicks (the same class of bug
  that fable-xh had). Pausing is the workaround.
- **Tile build quote is buried.** Picking a tile highlights it but the quote (Solar/Wind/Battery with cost, NPV, payback) is
  rendered below the 16-tile grid and the other parcel grids, so you have to scroll to find it.
  The panel does not scroll there for you.
- **Tile compatibility is inconsistent**: on a tile holding a battery, Wind says "Not compatible with what is on this tile"
  but Solar still offers a $440k build.
- **Plant upgrades show no payback/NPV** (only a price), unlike tile builds. After buying Tier 3 turbine/pump the
  buttons grey out but there is no "under construction / hours left" readout in that panel; the installed
  line still says "T1 Francis", and the plant sits offline meanwhile.
- **Repair is offered at 99 % health** ($7,200 turbine, $6,600 pump).
- **Penstock replacement is a hidden affordance**: "click the pipe in the world".
- **Quest rewards must be claimed by hand and the game nags only once.** Four finished quests (First light,
  A good day, Clockwork, Pocket storage) sat unclaimed for up to 40 days, which is free cash left on the table.
- **Grid emergencies pass unnoticed.** Five of them (D5, D22, D24, D31, D36) came and went; the reserve market needs
  a manual offer and nothing tells you to set one. Services still lists "Grid emergency scheduled day 36" on day 50.
- **Economics skew**: solar tier 2 ($458k) and wind tier 2 ($918k) show negative 20-yr NPV, battery tier 1 ($168k) shows
  +$284k and 3.9 yr payback. Net worth $1.08M but lifetime profit only about $12.5k after 49 days, so early game is slow.
- **Loans work and are cheap** (8 %/yr, $800k limit). Borrowing $500k went through, but the amount box resets to 50000.
- **Automation tab layout**: God-mode panel labels are misaligned (checkbox rows sit under the wrong text, "CASH" label next to "FLOW TARGET").
- Toolbar position shifts when the pane resizes, which made me misclick once (my error, not a game bug).

### Opus 5.5, second pass (days 50-55, solo)
Worked fine:
- **Save/Load**: slot 1 save, load after 1 sim-day restored D52 16:17 and $180.1k exactly (comes back paused, camera reset).
  "Verify replay: 15 actions reproduce hash 66aa02b4" is a neat determinism check. Export/import file also offered.
- **Quests**: Claim buttons work, all 8 claimable ones paid out (+$76k, then +$25k for Higher wall). The header states the win
  condition clearly ("claim 16 and reach $2.50M net worth").
- **Contracts**: plain terms ("Evening peak block: 1.1 MW, 18-21 h, 20 d, +$25/MWh, penalty $120/MWh short"); once signed, an
  Active list tracks "Hours delivered in full" (reached 5 over 2 days).
- **Reserve offer** and **loans** accepted input; SCADA (F1) shows price history + forecast, reservoir volumes, power flow.

New problems:
- **SCADA drawer is cut off on the right** (charts run under the open Services panel) and it covers the lower half of the 3D view.
- **Dam tab layout**: "Budget-limited plan" and "Target-energy plan (MWh)" labels overlap their inputs; asking for a 150 MWh target
  quotes a result of 544.9 MWh, above the current 504 MWh, which makes the field meaningless.
- **Construction is invisible**: raising the dam took $43.7k at once but Height still read 30 m with no progress bar or
  hours-left, same as plant upgrades. Yet the "Higher wall" quest paid out immediately.
- **Quests pay for queued builds**: Tier-2 turbine and pump quests were claimable while the Tier-3 parts were still being built.
- **Lower lake shows a checkerboard / moire pattern** on the water at some camera angles (visible at night especially).
- **"Lens" button silently changes to "Lens: Survey" and darkens the whole map**, with no legend of what the lens shows.
- Sim speed 3 is about one game day per 10 real seconds; speed 4 only slightly faster, and 5-6 skip events.
- Not tested: mobile layout, clicking in the 3D world to build or replace the penstock, Maintenance tab, Settings.
