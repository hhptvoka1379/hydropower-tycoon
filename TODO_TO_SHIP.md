# Everything left, from here to a working game

Written 2026-11-16 by the orchestrator. Scope: every piece of work and every fix that still has to go through a builder and be verified before the field-station edition is a working, shippable game. Background: `HANDOFF4fable.md` (status), `decisions/fable.md` (binding decisions D1–D9), `FABLE_PLAN.md` (phases), `PROJECT_STATUS.md` (flaw register).

Status words: **RUNNING** (a builder is on it now), **OPEN** (not started), **BLOCKED** (waits on you), **CHECK** (reported done by a builder, not yet verified by me).
"Verify" lines say what I check before I call the item done. A visual item is not done without a browser screenshot.

Where things stand in one paragraph: the sim is extracted, tested and mostly fixed; the world renders with terrain, lakes, sky, dam, penstock and powerhouse; the walker, stations and clock exist as tested logic. There is no player on screen yet, no real UI, no tiles/trees/weather on screen yet, the lighting needs another pass, and nothing has been played end to end.

---

## 0. Decisions that wait on you

| # | Decision | Blocks |
|---|---|---|
| U1 | **UI direction.** Run `samples/ui/PROMPT.md` for a few directions and pick one (or describe your own). | All of section 5 |
| U2 | **Player mesh rework.** Restart the low-effort Fable agent (2,000–3,500 triangles, hard cap 4,000), or leave the old mesh. | Section 4, item P9 |
| U3 | **Commit.** Nothing is committed. Everything lives uncommitted in the worktree `.claude/worktrees/hydropower-field-station-build-6d3df7`; the main checkout still has only the prep files. Say when to commit and whether to bring it back to `master`. | Section 9 |
| U4 | **Audio** (plan §3.2: ambient water, wind, turbine hum, emergency sound, all generated in code, off by default). In or out for this release? | Item X4 |

---

## 1. Simulation (Phase 1)

Done and verified by me: A1, A2, A3, A4, A5, A8, A9, A10, A11, A12, A13, A14a–d, A15b/c. `npm test` 0 failures; 34 of 39 flaw tests pass with todo markers off.

| # | Item | Status | Verify |
|---|---|---|---|
| S1 | **A6a** canyon start: a 12 m dam must cost ≤ 90% of start cash on seeds 4242, 99, 31337 (seed 99 costs $368k against $300k). | RUNNING (sim batch 3) | strict flaw test |
| S2 | **A6b** canyon head: operating head > 10 m after 10 days with a 12 m dam (now 8.7–10.8 m; the river keeps the lower lake brimming). | RUNNING | strict flaw test |
| S3 | **A7** canyon upper-lake volume curve within 3% of the terrain volume (now 0.61–1.02). Needed so the drawn shoreline matches the sim. | RUNNING | strict flaw test; mass balance still holds |
| S4 | **A14e** state hash insensitive to last-bit float noise. | RUNNING | strict flaw test |
| S5 | **A15a** test rewritten: 16 of 20 quests to win is intended. | RUNNING | test asserts the intended rule |
| S6 | Remove the 38 todo markers in `flaws.test.mjs` so fixed flaws are enforced. | RUNNING | `npm test` shows 0 todo |
| S7 | God planner values wear with the new damage-scaled repair cost (it now over-values wear ~15×, so assisted mode generates less: classic 19.6k vs 22.2k expected, canyon −1.2k). | RUNNING | assisted-bot income in the pacing test |
| S8 | `godSiteProfit` tier-2 upgrade still extrapolates one day × 720; use the seasonal sample. | RUNNING | phase1b-style test |
| S9 | Replace god.js's private `spotPrice` copy with the exported `priceAt`. | RUNNING | grep; quotes unchanged |
| S10 | `Game.markDirty()` and a cheap cached `getSnapshot` (C9 second half; main.js currently uses a `runHeadless(0)` workaround). | RUNNING | test; main.js workaround removed (P-side) |
| S11 | Save version bump; old saves refused with a readable reason. | RUNNING | test |
| S12 | Battery refurbishment (`refurbFrac`) is not in the battery quote. | OPEN | quote test |
| S13 | Sim pad height: the powerhouse pad equals the lower lake's start level, so it may flood at the lake's maximum. Get the numbers; raise the pad or cap the level. | OPEN | station dry at max level on both sites |
| S14 | Re-record `baseline.json` after all of the above, with the list of what moved and why. | RUNNING | baseline test green |

## 2. Pacing and economy (Phase 6)

All RUNNING in sim batch 3 as headless bots with asserted targets; each one still has to come back green or with the exact shortfall.

| # | Target | Verify |
|---|---|---|
| E1 | Classic, default rules: first day ends in real profit; ≥ $10k cumulative by day 30. | pacing test |
| E2 | **Renewables are worth building.** Honest quotes are now negative for batteries (−$99k to −$168k), wind W1 (−$176k) and solar S1 (−$184k). At least one tier each of solar, wind and battery must have positive NPV with payback 0.5–4 game years; realised income within ±40% of the quote. | pacing test |
| E3 | Greedy bot builds ≥ 2 assets by day 30, earns ≥ 15% more than the default bot, has a build decision about every 3 days. | pacing test |
| E4 | Reserve market ≤ 35% of total revenue. | pacing test |
| E5 | Assisted (god) mode's real income ≤ 1.5× the greedy bot's; subsidy reported separately. | pacing test |
| E6 | Canyon: ≤ $400k loan + 12 m dam on day 0 → a profitable day by day 10, no bankruptcy in 30 days. | pacing test |
| E7 | Reckless bot reaches restructure within 400 days; after refinancing it is profitable again within 60 days. | pacing test |
| E8 | Grid emergencies announced ≥ 2 game hours ahead (`st.gridWarning`), with a clear reward. | pacing test |
| E9 | Quests: 20 rebalanced against the new economy; a win reachable in a long session; first quest claimable within 10 real minutes. | OPEN: a bot that claims quests; then a manual run |
| E10 | Dam planning discount must not make the plant independent of solar, wind and arbitrage (STOP-AND-ASK case if it cannot hold). | OPEN: greedy bot with and without a dam programme |
| E11 | Real-time pacing check at field pace (1 s = 1 min): how long until first profit, first quest, first build, measured in real minutes by playing. | OPEN: manual browser session |

## 3. World and rendering (Phase 2)

Verified in the browser: terrain with continuous colour and visible facets, live lakes and river, sky with a haze horizon, earth dam, spill chute, penstock with valve house, powerhouse with lit windows, switchyard, tailrace, lamps; 0.68 MiB; no console errors.

| # | Item | Status | Verify |
|---|---|---|---|
| W1 | **Torch** not visible at all (cone and halo). Warm ~6 m pool, soft cone to ~40–55 m, off by day. | RUNNING (world round 3) | screenshots at 8 m and 60 m, midnight |
| W2 | **Night floor**: terrain near black at midnight. Must read as moonlit shapes, walkable without the torch at full moon; moon and stars visible; water not brighter than 1.3× its bank. | RUNNING | midnight screenshots, full and new moon |
| W3 | **Dusk/dawn** flat mauve: real gradient, warm rim light, long shadows. | RUNNING | 06:00, 17:30, 18.6, 19.5 |
| W4 | Noon: shadows crisp near structures, no acne, no shimmer on small camera moves, blue toward the zenith. | RUNNING | screenshots |
| W5 | Terrain and lakes do not rebuild when a dam raise or excavation changes the layout. | RUNNING | raise the dam in the browser; shoreline and terrain follow; no leak |
| W6 | Tiles: three parcels, solar arrays, wind turbines facing the wind, batteries, build-in-progress marker, parcel desks, pick resolver. | RUNNING (features builder) | all 48 tiles filled, no instance truncation (C12); parcel line over a ridge hugs the ground (C10) |
| W7 | Scatter: conifers, boulders, grass/flowers; none in water at max level, in parcels, on paths or inside buildings; season hue, snow load, visible sway (C8). | RUNNING | four-season screenshots; before/after dam raise (C12) |
| W8 | Weather: rain and snow without a visible particle box; storm darkening fed to sky and lights. | RUNNING | rain at noon, snow at dusk, low orbit |
| W9 | Footpaths and stair flights drawn exactly where the walker's floor providers are; the canyon bridge deck drawn. | RUNNING (features + player) | walk a flight in the browser: feet on the treads |
| W10 | Wire the feature hooks into the world: tile pick, storm darkening. | RUNNING (world round 3, if features landed) | pick a tile; storm darkens the sky |
| W11 | Canyon site with structures: concrete dam variant, steep abutments (no gap under the foundation), penstock on the canyon wall. Only seen without structures so far. | OPEN | canyon noon and night screenshots |
| W12 | Dam raise in progress: scaffold visible, crest walkway and lamps follow the new height. | CHECK | start a raise in the browser |
| W13 | Spill: chute flow visible and proportional when the upper lake spills (C11). | CHECK | force a spill, screenshot the chute joint |
| W14 | Ice and snow: winter lake ice is lit, not white-glowing; snow on terrain. | CHECK | winter midnight and noon |
| W15 | Water level visibly moves: three fills of the same lake (15%, 50%, 100%) with one continuous shoreline (C5); a dry pocket stays dry. | CHECK | screenshots |
| W16 | Not built yet: shore wet-band tint, penstock flow hint, dam crack visual (needed for the stakes to be visible), powerhouse interior. Crack visual is required; the rest is polish. | OPEN | crack visible after a crack event |
| W17 | Context loss and restore (C1). | CHECK | `WEBGL_lose_context` in the browser: same picture after restore, sim kept running |
| W18 | Leak check in the real browser: 50 `world.build`, 20 rebuilds, 10 dam raises → geometry/texture/program counts flat (C6). Only done with a stub renderer so far. | CHECK | `world.audit()` before/after |
| W19 | Quality governor (C9): render-only timing, DPR steps then tiers, recovery; Low/Medium/High ladder. Not built; quality is fixed at "high". | OPEN | forced ladder screenshots; drops and recovers |
| W20 | Glow sprite size and lamp intensity untuned; light pools on the dam crest. | RUNNING (round 3 by eye) | night screenshot of crest and yard |
| W21 | Picking contract: every clickable object returns its type before terrain (dam, penstock, powerhouse, board, hut, slide, tiles, desks); roof vs wall does not matter. | CHECK | scripted pick probe per object |
| W22 | Slide: the helix waterslide beside the lower lake is only a platform placeholder. The slide structure itself (render-only, cosmetic) must be drawn and its search cached. | OPEN | screenshot; 50 rebuilds do not re-run the search |
| W23 | Cutaway views (legacy had section views of dam, turbines, penstock). Decide: drop, since the player now walks up to things. Proposed: drop and record it. | OPEN (my call, to record) | — |
| W24 | `game/README-build.md` still says three is inlined from vendor. | OPEN (Haiku) | text matches the build |

## 4. Player (Phase 3)

Reported done, tests green: walker (slope, water, blockers, stairs), 11 stations per site, path graph with stair flights and a bridge, mode state machine, clock.

| # | Item | Status | Verify |
|---|---|---|---|
| P1 | Avatar on screen, posed (idle, walk, run, stairs), feet on the ground, shadow. | RUNNING (player round 2) | browser at `?at=powerhouse` |
| P2 | Follow camera: never clips into terrain, pulls in when blocked, overview toggle. | RUNNING | walk into the gorge and up a flight |
| P3 | Input: WASD/arrows, Shift run, double-click to walk with distance/ETA marker, click a station object to walk there. | RUNNING | browser |
| P4 | Station tracker emits enter/leave; each of the 11 stations opens its (placeholder) card on arrival, classic and canyon. This is the Phase 3 "done when". | RUNNING | scripted tour of all 11 on both sites |
| P5 | Torch bound to the avatar, on at night only. | RUNNING (needs W1) | midnight walk screenshot |
| P6 | Stations chosen dry at maximum lake levels; what happens if water rises under the player. | RUNNING | raise the lower lake to max; stations still dry |
| P7 | Dam station depends on the crest walkway being registered first (57 m off otherwise). | RUNNING | avatar stands on the crest |
| P8 | Hash isolation: 60 s of walking leaves the state hash unchanged; `player.audit()` clean (no NaN, never below the floor). | RUNNING | test + browser audit |
| P9 | Player mesh rework behind the `game/player/body.js` seam; walk rig and slide/dive poses kept; viewer for your review. | BLOCKED (U2) | viewer side by side; check script |
| P10 | One path leg per site is listed as "uncovered" (neither clear nor on a flight) though routes pass. Find out why and close it. | OPEN | `paths.uncovered` empty |
| P11 | Touch controls: on-screen stick and tap-to-walk at phone width. | OPEN | 375 px check |
| P12 | Replay note: a saved log replays at the logged speed, not the clock's step size. Confirm save → load → continue gives the same future as not saving. | OPEN | test |

## 5. UI (Phase 5): nothing real exists yet

Blocked on U1. Left over from the stopped builder: six unverified DOM-free logic files in `game/ui/` (formatters, rule and save logic, a view model that still calls `Sim.damCost` instead of `Sim.raiseQuote`). The throwaway `devhud.js` stands in until this section is built.

| # | Item | Closes | Verify |
|---|---|---|---|
| I1 | Theme and HUD: cash, clock, time-mode chip, pause, menu. Nothing else permanent. | — | screenshot while walking |
| I2 | Toast layer above every card and dialog, grouped, each rejection with its "why". | B1, B5, B7 | toast visible with a card open |
| I3 | Station card framework: opens on arrival, closes on leaving, values update in place, never rebuilds under the cursor. | B2, B8 | click Generate/Pump 20× at field pace |
| I4 | Powerhouse card: Generate/Pump/Idle, flow (disabled with reason under automation; manual warns it turns automation off), tier builds with no paid downgrades, repair priced by damage, reserve offer with the cap shown, curtailment. | B7, B10, B11 | browser |
| I5 | Forecast board: 24 h price, peak window, weather, one-sentence reading, text alternative. Remote view read-only. | B14 | browser |
| I6 | Rule editor as stacked cards, "highest priority wins", unsaved marker, no wide table, blank fields not turned into 0. | B9 | 380 px check |
| I7 | Dam crest card: raise with the quote shown first (base, premium, discount), declare a programme (`PLAN_DAM`), repair, job progress and ETA, rejected buttons disabled with a reason. | B6, B7 | browser |
| I8 | Parcel desk card: 16 tiles, build solar/wind/battery with quote and NPV, incompatible options disabled with the reason. | B5, B15 | browser |
| I9 | Penstock and shore cards (levels, read-only), slide platform card (placeholder text). | — | browser |
| I10 | Lookout office: loans (credit limit, term), subsidy line shown separately in assisted mode, quests with badge, toast and one-click claim, site switch. | B11, A1 | browser |
| I11 | Restructure dialog: refinance or sell tiles; cannot be escaped into a dead state; reachable again from pause. | B4, D6 | go bankrupt in the browser, recover |
| I12 | Critical alert banner on auto-slow; emergency warning shown ≥ 2 h ahead with what to do. | B11, E8 | trigger an emergency during a wait |
| I13 | "Wait" row on every card (1 h, next peak, morning) and the "what happened while you waited" note. | Phase 4/6 | browser |
| I14 | Start screen: New game (classic / canyon), assisted mode opt-in off by default, Continue when a save exists. | B12 | browser |
| I15 | Onboarding: welcome card stating the loop in two sentences and the first thing to do; hint when the plant is idle and why; hint when automation is off or rules never fire. The start state shows a working plant. | 4D-5 | first-time run without docs |
| I16 | Save/load: slots, one consistent storage source with memory fallback, validate before swapping, atomic load, confirm on overwrite/delete, quota errors shown, no autosave of an unplayed game, old-version saves refused with the reason. | B12 | round trip in the browser |
| I17 | Global error overlay: one, idempotent, dismissible, with copy details. | B3 | throw in the render loop |
| I18 | Modals pause the clock; focus trap; Space not hijacked; Esc rules; loss days drawn as losses; state never by colour alone; contrast AA day and night. | B13, B14 | keyboard-only pass |
| I19 | Remote read-only views from the menu: plant summary, forecast. Remote controls limited to pause, save/load, settings, rules master switch. | locked decision | no action buttons in remote views |
| I20 | Phone width: cards as bottom sheets, HUD fits 375 px. | plan §3.3 | 375 px screenshots |
| I21 | Reset per-game UI state between games; loan amount and reserve offer not lost on refresh; settings validated on boot. | B15 | new game after a game |
| I22 | Delete `devhud.js` and the `SCADA` wording anywhere user-visible. | locked decision | grep |

## 6. Time modes (Phase 4)

| # | Item | Status | Verify |
|---|---|---|---|
| T1 | Clock drives the sim in the running game: field 60×, wait up to 3600×, alert forced to 60×, pause. | RUNNING (player round 2) | 5 real minutes = 5 game hours |
| T2 | A grid emergency can never be missed: a wait is cancelled before it, banner shown. | CHECK (logic tested) | in the browser during "wait until morning" |
| T3 | Cavitation, dam crack and bankruptcy also cancel a wait. | CHECK | browser |
| T4 | Speed ladder gone from the HUD; hidden debug key only. | RUNNING | browser |
| T5 | Modals and the start screen pause the clock. | OPEN (with UI) | browser |

## 7. Hooks for the later swim/slide agent (Phase 7)

| # | Item | Status | Verify |
|---|---|---|---|
| H1 | `player.mode` state machine with `walk / swim / slide / stairs / blocked`; swim and slide refuse by default. | CHECK | test exists; confirm in the running game |
| H2 | `world.water.surfaceAt` / `depthAt` live from the sim level; walkable-or-swimmable query. | CHECK | test against the sim level |
| H3 | `world.hazards` (intake, tailrace) data. | CHECK | data present on both sites |
| H4 | `world.slide`: platform and exit points, rider-pose request stub. Currently a stub with no geometry (see W22). | OPEN | test |
| H5 | Tests covering H1–H4. | OPEN | `npm test` |
| H6 | Rewrite `decisions/sonnet-followups.md` against the real module names, API and invariants (hash isolation, no sim RNG, no new global), so it is self-contained. | OPEN | read-through; names exist in code (Haiku check) |

## 8. Integration and QA (Phase 8)

| # | Item | Verify |
|---|---|---|
| Q1 | Full `npm test`, `npm run check`, `npm run build` green with everything merged; bundle ≤ 1.5 MB. | commands |
| Q2 | Browser self-test hook `__HYDRO_AUDIT__`: world audit, player audit, sim invariants, all green. | browser |
| Q3 | Playtest scripts in the browser: first 10 minutes; a grid emergency; a night walk with the torch; save/load round trip; bankruptcy and recovery; canyon start. | screenshots and notes per script |
| Q4 | Visual set: noon, dusk, night with torch, canyon and classic, a cards-at-stations walk, toasts with a card open. | screenshots |
| Q5 | Performance: ≥ 50 fps at medium on a mid laptop, load ≤ 5 s, memory flat over 30 minutes. | browser timing, `world.audit()` over time |
| Q6 | Works from `file://` as a single offline file (so far only tested over a local server). | open the file directly |
| Q7 | F2 debug overlay: time mode, player position, active station, hash, frame time. | browser |
| Q8 | Sweep (Haiku): forbidden words in `game/sim`, `import * as THREE`, dead code, stale references, leftover scratch files, every action name used by the UI exists in the sim. | report |
| Q9 | Every B and C row of the flaw register ticked against the new UI and renderer, with the evidence. | table in the handoff |

## 9. Docs and close-out

| # | Item |
|---|---|
| X1 | `HANDOFF4fable.md` final status; `PROJECT_STATUS.md` updated; `README.md` (how to build, test, play). |
| X2 | `Fable_op.md` "Result": what was delivered, how it was verified, known gaps, next step. |
| X3 | Commit per your word (U3); tags if you want them. |
| X4 | Audio, if in (U4). |
| X5 | Stop the stray servers: port 8099 (from the prep run, serves the main checkout's `dist/`) and port 8123 (mine, for browser checks). |

---

## Order I would run it in

1. Let the four running builders finish: sim batch 3, world round 3, world features, player round 2. Review each in the browser.
2. One integration round: features wired into the world, paths under the player's feet, canyon with structures (W10, W11, W9, P4), then the slide structure and hooks (W22, H4–H6).
3. UI build in two or three parallel pieces once you pick a direction (section 5), replacing `devhud.js`.
4. Mesh rework dropped in behind the body seam, if you want it (P9).
5. Pacing by hand at field pace (E9–E11), then the quality governor and the browser-side leak and context-loss checks (W17–W19).
6. QA scripts, sweep, docs, commit (sections 8 and 9).

Shortest path to "playable, ugly": steps 1 and 2 plus the throwaway HUD. Shortest path to "working game": add step 3 and the Q3 playtests.
