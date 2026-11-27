# PROJECT STATUS — Hydropower Tycoon

Snapshot: 2026-11-16. Written so that Fable 5.2 can plan the fixes and the next build steps.
Base: `other model's attempts/reconstructed/opus5.5 v2/index.html` (3,308 lines, one file, raw WebGL2, sim in `createSimModule()`).
Graft source: `other model's attempts/sonnet5.5-high-freeroam-hydropower-tycoon-3d-diorama.zip` (one 1,482-line `index.html`: walking player, stairs, swimmer body).

> **Update 2026-11-16 (later):** the open decisions in §5 are answered and the execution plan is in `FABLE_PLAN.md`. Notable rulings: Three.js replaces the raw WebGL2 renderer; god-mode profit top-up (A1) is an intended opt-in mode, kept separate from quests and the win check; dam pricing gets a modest big-step premium with a ≤5% planning discount; `src/` swarm build is retired; UI is chill, not SCADA; swimming and the slide ride go to a later Sonnet agent.

> Evidence level: the sim findings were checked with Node runs on the extracted `createSimModule`. UI and rendering findings come from reading the code; nothing was rendered or clicked. The free-roam demo was read, not run. Line numbers refer to the opus5.5 v2 file unless stated.

---

## 1. Where the project is

There are three threads, and only one is the base for the next step.

| Thread | State | Role |
|---|---|---|
| **opus5.5 v2** (`other model's attempts/reconstructed/opus5.5 v2/`) | Playable. Sim, 3D world, panels, automation, god-mode planner, quests, saves, waterslide (render-only). Physics core is sound; economy, onboarding, feedback and rendering have the flaws in section 4. | **Base of the next version.** |
| **Sonnet 5.5 free-roam diorama** (zip, same folder) | Static "part one: world" demo: a swimsuit-clad station athlete walks a valley on foot, climbs three stair flights (powerhouse, lakes, rim lookout), double-click to walk, parametric swimmer v3 body. No clock, economy or sim. The player stops at the waterline (`maxWade 0.06`). | **Graft source** for the walking avatar, stairs, camera and body rig. |
| **Swarm build in `src/`** (spec §0–14, `PROGRESS.md`) | Stage 0–1 closed. Stage 2: physics 62/62, climate 61/61, economy 79/79 tests pass. Engine pipeline, gameplay modules, UI and 3D never started. Paused 2026-11-06 to save usage. | Reference only (spec, tests, decisions). Not on the critical path for the v2 direction. |

Supporting material: `swimmer-adult-redesign/` (swimmer v3 mesh generator `swimmerGB3.js`, live body lab `index.html`, `check.js`); `other model's attempts/VISUAL_CRITIQUE.md` and `VISUAL_FIX_PLAN.md` (critique of an earlier v2 snapshot, draft paused); `material/prompts-short/` (single-turn "part one: world" brief, Field Notes theme, faceted low-poly only, minimal HUD); `NOTES.md` (playtests of all attempts).

Not audited: `src/` swarm code and the `prompts-short` briefs.

---

## 2. The vision

A pumped-storage hydropower management game you *inhabit*. You are an athlete on a field station. The simulation is the real physics of v2; the player is the interface to it.

### 2.1 Physical player, walking between stations
- A player avatar walks the valley: powerhouse, dam, penstock, both lakes, solar and wind tiles, batteries, slide platform, rim lookout.
- **Walk to change things:** to operate a machine, you go to it. Standing within range opens that station's card (Generate/Pump/Idle, repair, upgrade, rules). Remote control stays limited to a clearly labelled SCADA view.
- **Time scale adapted to walking:** the sim clock follows the player's pace. Walking or working at a station slows the clock to a rate where a 60 s walk is a believable stretch of game time; a "fast-forward / wait" action sits at stations (sleep or wait at the lookout). Critical events auto-slow the clock.
- Click-to-go with a distance/ETA marker; stairs and slopes as in the free-roam demo.

### 2.2 The slide
- Keep v2's helix waterslide beside the lower lake. The player climbs the platform, rides it with the sitting or lying pose, and splashes into the lake.
- Render-only: no sim RNG, no save or hash effect. Replaces the placeholder `riderGB()` with `swimmerGB3` poses 1 and 2.

### 2.3 Player swimming
- Wade → swim at the waterline, with the surface tracking `Sim.resLevel`; stroke animation, dive pose 3 for entry, exit by shore or ladder.
- Safety and fun: intake and tailrace zones are off-limits or push back; level changes under the swimmer are visible.
- Hash-isolated like the slide.

### 2.4 Game logic that is playable and enjoyable
- A first 10 minutes that explains the loop (pump cheap, generate dear) without jargon, with a plant already doing something visible.
- An honest economy: quotes that match reality, a start you can afford, a dam that costs the same however you buy it.
- Real stakes (bankruptcy reachable, dam crack and wear matter) and tools that reward attention (reserve market, grid emergencies, quests that announce themselves).
- Events you can't miss: auto-slow, banner, sound, and a station that glows.

### 2.5 UI ideas that make sense
- Minimal in-world HUD: cash and clock only; the 3D world fills the window (matches the part-one decision).
- Cards that appear when you stand at a station, not a stack of panels.
- A diegetic forecast board at the powerhouse; the SCADA drawer as a place you walk to, with a compact remote view.
- Rule editor as stacked cards ("When price is above X → generate"), with "highest priority wins" stated plainly.
- Toasts always on top of everything; a quest badge; an unsaved-edits marker.
- Field Notes theme, faceted low-poly only, WCAG AA text, state never by colour alone.

### 2.6 Integration map (what comes from where)

| Need | Take from | Note |
|---|---|---|
| Sim, economy, saves, god planner | opus5.5 v2 | Fix section 4A first. |
| Terrain, lakes, dam, penstock, slide | opus5.5 v2 | Fix section 4C. |
| `walkerStep`, `groundY`, `planPath`, stairs, slope/wade limits, follow camera | free-roam demo | Its heightfield and stair flights differ from v2's chunked terrain. Decision needed (section 5). |
| Athlete rig and body lab | free-roam demo / `swimmerGB3.js` | Already adult-only; poses 0–3 (T, slide sit, slide lie, dive). |
| Whimsy, start card wording | free-roam demo / `part_one_world.md` | |

### 2.7 What exists today per pillar

| Pillar | Have | Missing |
|---|---|---|
| Walking player | Demo: 2.4/4.2 m/s, stairs, slope limit, collision, click-to-go, audit checks | Any avatar in v2; interaction by proximity |
| Time scale to walking | v2: 6-step speed ladder, Turn mode | Player-driven clock, auto-slow rules |
| Slide | v2: full helix slide, cosmetic | Ridable by the player; real rider mesh |
| Swimming | Dive pose in `swimmerGB3`; demo stops at the water | Swim locomotion, buoyancy, stroke, exits, zones |
| Playable logic | Sound physics, quests, rules, god mode | Honest economy, onboarding, discoverable events |
| UI | Working panels, SCADA drawer | Clipping/overlap fixes, HUD rework, station cards |

---

## 3. Fix order (suggested)

1. **Stop the bleeding:** B1, B3, B4, B2, C1, A1, A2, B12.
2. **Make the loop honest and playable:** A3–A6, B5–B7, B10, B11, quests (A15).
3. **Determinism and save integrity:** A8, A9, A14.
4. **Look:** C2–C5, C7, C10, C11.
5. **Vision work, in this order:** avatar + walk-to-interact → player-driven time scale → swimming → ridable slide → HUD and onboarding rework.

---

## 4. Flaw register

Severity: **C** critical, **M** major, **m** minor. The physics core itself is sound: Darcy–Weisbach with Swamee–Jain, turbine/pump power, ledger mass balance held to the m³ on classic and procedural sites, mass-balance-correct `resLevel` inversion, cloned-save hash continuity.

### 4A. Simulation and economy

| # | Sev | Flaw | Where | Fix direction |
|---|---|---|---|---|
| A1 | C | God-mode "profit protection" tops up any hour with net < $1 to +$1, so every pumping hour is refunded. ~$490/day of subsidy on top of ~$480/day real income. Makes bankruptcy impossible and inflates `profitDays` and net worth. | 969, 763, 468 | Default off; exclude subsidy from quests and net worth. |
| A2 | M | Reserve availability pay is checked only when the offer is set. A dead plant (`turbine.health=0`) still earns $9/MW·h: +$17.8k over 200 days with 0 of 328 calls delivered. | 957, 1352, 454 | Pay only while `reserveCap >= offer`. |
| A3 | M | Dam price depends on how it is bought: 40 m one-shot $4.68M, 32 m + 8 m $2.86M, 1 m steps $2.25M. | 677–679, 672–673, 1310 | One integrated cost function of (h0, h1), per-layer crest and class. |
| A4 | M | Battery NPV quote ~3× too high: assumes 6 h at full power, every tier holds 2 h; ignores RTE and fade. B1 quotes +$191k on $168k; B3 quotes $1.5–6.5M on $1.1M. | 1249 | Cap at MWh × cycles; apply RTE. |
| A5 | M | NPV quotes extrapolate one 24 h forecast × 360. W1 wind NPV swings −944k to +802k by day. God auto-build spends on this noise. Dead no-ops `lo+=0` and `*0` ignore shading cost. | 1240–1254, 1196 | Annualise over a seasonal sample; apply shading. |
| A6 | M | Procedural start can't afford a useful dam (12 m = $301,625 vs $300k start); river spill keeps the lower lake brimming (18 m ≈ fall), so head collapses to 3–8 m. | 669, 449, 891, 460 | Lower `lowerHMax` or the lower bed; tune start cash. |
| A7 | M | Analytic V(h) for procedural upper lakes is 14–30% below the drawn terrain volume (`a3 = m/(3·S0)` is half the geometric `2m/(3·S0)`). | 667 | Calibrate `a2`, `a3` to terrain, or derive terrain from the polynomial. |
| A8 | M | Determinism: (a) rejected actions change the hashed state via `lastReject` but are not logged, so `replay` diverges; (b) the `events` RNG stream is shared with player-driven draws, so offering reserve shifts the emergency schedule (verified, seed 3); `rng.market` is unused; (c) reserve-call pass/fail depends on dt: 41/49 ok at dt 1/5/30, 28/49 at dt ≥ 60. | 1279, 976/994/1000, 838–856, 942 | Exclude `lastReject` from the hash; separate streams; sub-step during calls. |
| A9 | M | `replay` loops forever if the log ends bankrupt (`step()` returns 0 without advancing `tick`). | 1378, 931 | Break when `step` returns 0 and no log entry remains. |
| A10 | m | Year-end bonus ≤ $100 per site and fires once; `yr.eRen`, `yr.capH` never reset. | 1003, 653, 960 | Scale and reset. |
| A11 | m | Friction factor jumps 75% at Re 2300 (irrelevant below ~3 L/s); `solveQ` assumes P(Q) monotone, so a big turbine at low head can yield zero; cavitation `ns` uses operating, not rated, power. | 721, 731/836/850, 740 | Blend; find max-power Q; use rated values. |
| A12 | m | God planner ignores river inflow on the lower lake; manual curtailment is applied twice versus the sim (`0.15·p` planned vs `0.3·p` simulated). | 1062–1075, 1152 vs 808 | Track volumes separately; multiplicative curtailment. |
| A13 | m | Stakes: loans have no term and `EMERGENCY_CREDIT` bypasses `maxLoan`; bankruptcy practically unreachable; dam crack has no consequence; turbine wear needs ~2,900 days to reach 0 health with an efficiency floor of 0.85. | 1338, 967, 995, 901 | Decide intended stakes, then tune. |
| A14 | m | Classic dam ring and zone cache go stale after raise/excavation; `PLACE_DAM` at a new station resets the penstock to fresh; `BUILD` allows paid downgrades (T3 → T1) with 24 h downtime; `validateSave` checks too little; transcendental functions are not bit-identical across engines. | 918/526, 1305, 1316, 1375, 471 | Fix each. |
| A15 | m | Quests: `win.quests:16` but 20 exist; q9 "at least two rules" completes at tick 0 because new game dispatches `SET_RULES enabled:true`; q15 double-counts contracts. | 467, 1223, 2966, 965 | Align counts; require a real player action. |

### 4B. Gameplay and UI

| # | Sev | Flaw | Where | Fix direction |
|---|---|---|---|---|
| B1 | C | `#chips` (z 15) is fully covered by `#panel` (z 25, same corner): every rejection toast, "Saved", construction progress, cavitation, crack and grid-emergency chip is invisible while Build, Services or Save is open. Likely the cause of the playtest's "Build click did nothing". | 114, 143, 2467–2517 | Offset chips when a panel is open, or raise them. |
| B2 | M | The card is rebuilt every 350 ms with live telemetry; its click guard (`UI.pointerDown`) is only set by canvas listeners, so mouse-up/down straddling a rebuild loses the click, and Space on a focused button breaks. | 2583–2586, 3216 | Guard `#card` like the panel, or update values in place. |
| B3 | M | A render exception becomes a per-frame `fatal()` that rewrites `#err`, destroying "Copy details"/"Dismiss" 60× a second; no `window.onerror` or `unhandledrejection`. | 2979–3003 | Idempotent `fatal`; global handlers. |
| B4 | M | Esc on the bankrupt dialog hides it for good (`UI.bkShown` stays true), `simTick` refuses to run while `st.bankrupt`; emergency credit is reachable only via that dialog. | 3284, 2802, 2988 | Ignore Esc for alertdialogs; re-show from Pause. |
| B5 | M | Solar on a battery tile: `BUILD` allows it, the tile UI offers a price with no NPV, `quote()` rejects it; wind says "Not compatible" without a reason. | 1237, 1321, 2575–2580 | One rule; always give the reason. |
| B6 | M | `planDam` always adds ≥ 1 m (target 150 MWh vs 504 MWh current quotes 544.9 MWh). | 1257–1260 | Test before adding. |
| B7 | M | Plant tab: all three tiers enabled, paid downgrades, repair at 99% health costs $7,200 for 1% (flat `cost×0.12`), no job/ETA readout while the unit is offline, Raise +1/+3 enabled during a raise. | 2669–2675, 1316, 1331 | Disable what will be rejected; scale repair cost; show jobs. |
| B8 | M | Alerts feed `innerHTML` rebuilt every 500 ms (scroll resets, old alerts unreachable); bell can overlay an open panel; no outside-click close. | 2779–2809 | Diff against a hash. |
| B9 | M | SCADA drawer and rule editor need 760 px in a 380 px panel (Then and m³/s off-screen); drawer ✕ sits under the panel at ≤ 900 px; "Pri" is unexplained (highest wins, 1–8 range suggests the opposite); edits applied only by "Apply rules" and lost on tab switch; blank fields become 0. | 164–172, 2735, 3248, 822 | Stacked rows or cards; label "8 wins"; unsaved marker. |
| B10 | M | Manual dispatch silently turns off automation and god dispatch; the flow slider does nothing while automation is on (the default). | 1292, 3258, 830 | Toast or confirm; disable and explain the slider. |
| B11 | M | Quest completion has no toast or badge; grid emergencies last 2–4 h (< 0.5 s of real time at fast speeds) with no auto-slow; reserve offer defaults to 0 with no Operate hint. | 1222, 982, 2514, 2693 | Badge, toast, auto-slow on critical alerts, Operate CTA. |
| B12 | M | Save/load: `Store.set` falls back to memory but `Store.get` reads `localStorage` first (stale load after a "Saved" toast); a truncated save passes `validateSave`, replaces live state, then throws in `World.build`; no confirm on Load/Delete/overwrite; no Continue on the start screen; a throwaway game overwrites the autosave on reload. | 2951–2953, 2970, 1375, 2783, 3293 | Validate; swap atomically; add Continue; gate `beforeunload`. |
| B13 | m | Speed pips are 12×6 px; Turn resumes a paused sim; in Turn mode ± both jump to index 2; spot price and Turn hidden < 900 px; sim keeps running behind New game, survey and shaping modals. | 75, 1289, 3270, 278, 2988 | Auto-pause modal flows; larger targets. |
| B14 | m | A11y: Space on tiles and steppers is hijacked into pause; no focus trap; Esc in an input also closes the card; the profit chart plots `abs(v)` so a loss looks like a profit; colour-only state; `aria-live` on regions rebuilt every 350–600 ms. | 2606, 3284–3291, 2707, 343 | Fix each. |
| B15 | m | Loan amount resets to 50000; reserve offer can be lost; checkboxes drop focus; Build quote rendered below the 16-tile grid and not scrolled into view; `buildMode` stale; `UI.wonShown`, `gridTile`, `scadaSite` not reset between games; `SET_FLOW` slider spams the save log; save metadata re-parsed every 600 ms; unvalidated stored settings can brick boot; canyon hint breaks the start-card flex. | 2710, 2695, 2664, 3241, 2811, 3258, 2723, 3294, 2786 | Fix each. |

### 4C. Rendering and world

| # | Sev | Flaw | Where | Fix direction |
|---|---|---|---|---|
| C1 | C | No `webglcontextlost`/`restored` handlers: black canvas after a GPU reset or mobile background; the loop keeps calling dead GL. | 1557, 3297 | Add handlers; recreate resources. |
| C2 | C | Night is near-black (moon-sun 0.1/0.12/0.18, hemisphere 0.06–0.12) while water body colour is constant and ice is flat unlit white, so lakes and ice glow. No lights on the powerhouse, crest or road. | 2342–2353, 1465–1470, 2404 | Ambient/moon floor; light water and ice; add lamps. |
| C3 | C | Diamond/checker terrain: 40 m hard colour blocks (`hsh(i>>2,j>>2)`) plus triangle diagonal flipped on `(i+j)&1`, per-cell tint. | 1609, 1616, 1604 | Per-vertex noise colour; diagonal by height. |
| C4 | C | Sky is 5 flat bands (`floor(...*5)/5`), cream horizon, slab floating in a void. | 1483, 2379, 1553 | Smooth gradient; backdrop or mist below horizon. |
| C5 | M | Shoreline baked at build-time lake level, one cell wide, saw-toothed; disconnected pockets flood (`buildLake` ignores connectivity); in cutaway views the section water never moves (`cutDirty` is read and never set). | 1606–1618, 1718–1725, 2273, 1899 | Shader shore from live level; flood-fill; update the cut. |
| C6 | M | `build()` frees `M` but never `W.chunks` (16 meshes, ~8 MB per build); the slide search (≤ ~46k candidates) reruns every build; shape-slider ticks cost ~0.2–0.6 s (likely). | 2256–2262, 2165, 1621 | Free chunks; cache the slide; skip smooth normals for style 0. |
| C7 | M | No antialiasing; shadow bias ≈ 4–9 m world units, so shadows under ~4 m vanish; light camera not texel-snapped; sun direction jumps at `el=0.02`; sun never sets, static moon. | 1557, 1434, 2344 | FXAA; texel bias; interpolate; drive moon from time. |
| C8 | M | Vegetation ignores season (no autumn hue, no snow load, flowers never fade); wind sway 0.035 m is invisible. | 1429–1431, 2386, 2395 | Per-instance hue; snow load; larger sway. |
| C9 | M | Auto-quality averages `max(ft, dtReal)` so it counts the sim's 40 ms budget, drops after ~4 s at high speed and never recovers; `getSnapshot` deep-clones and freezes the whole state up to 20 Hz. | 2433, 2990, 2962 | Time render only; allow recovery; cache the snapshot. |
| C10 | M | Objects placed with bilinear `hD` while the mesh is triangulated (and up to 3× exaggerated): roads, parcel lines, trees, flowers, pipe saddles clip or float. | 1583, 1616, 1695, 1713, 1842, 1848, 1856 | Share one surface sampler. |
| C11 | M | Earth-dam spill chute starts at `bottom+h·v+0.4` but the downstream face drops 6 m at the toe: the chute floats up to ~19 displayed m above the face; spill is on/off. | 1767, 1777–1782, 2412 | Share the face function; continuous flow. |
| C12 | m | Picking ignores the clip plane; penstock AABBs (diagonal segments) swallow terrain and tile clicks; roof click picks the turbine; scatter not rebuilt after a dam raise (trees stand in the new lake); coplanar foundation and slab tops z-fight (likely); near-plane clipping at low pitch; rain/snow box edge visible; rotors face downwind (likely); per-frame garbage; solar instance cap 1200 vs 1440 needed; slide tail rebuilt several times a second at fast speed. | 2294–2306, 2271, 1799, 2322, 1491, 2364, 2391, 1860, 2151 | Fix each. |
| C13 | m | Penstock drawn 248 m vs sim friction length 300 m (−17%), drawn radius ≈ 3× sim D; dam drawn 3× steeper than the sim profile. | 1841, 444, 1760 | Make L match or document the exaggeration. |

Visual critique items still present (earlier snapshot): flat banded sky, horizon void, black night with glowing water, square stars, weak dusk/dawn, flat midday light, no cloud shadows, diamond ground, one-note ground, sand shoreline, pyramid rocks, repeated trees, roads, thin penstock at overview, no animals, faint weather, canyon overview framing. Fixed or partly fixed: basin-fitted reservoir surface with live level, terrain-following penstock, switchyard and gantry added, weak foam and Fresnel on water.

### 4D. Gaps against the vision (missing features, not bugs)

1. v2 has no player avatar. The demo's terrain system (heightfield + three stair flights) differs from v2's chunked terrain; porting needs a bridge.
2. No link between player and sim clock; no "arrive to interact" rule.
3. The slide cannot be ridden; `riderGB()` is a placeholder.
4. Nothing in either project lets the player swim.
5. Onboarding and idle-by-default confusion (playtest: plant idle at start, nothing says why; reserve and emergencies undiscoverable).
6. UI is a panel stack that fights the 3D view; the part-one brief already calls for a minimal HUD.

---

## 5. Open decisions for Fable 5.2 / the user

1. **Terrain bridge:** re-author the demo's stairs and walk rules on v2's terrain (recommended: one world, one surface sampler, see C10), or keep the demo's terrain for walking and v2's for the sim (two worlds, high risk).
2. **Time scale:** continuous (clock speed tied to player speed) or discrete (walking auto-sets 1×, stations offer "wait"/fast-forward)?
3. **Remote vs walked control:** what stays available from anywhere (SCADA view, saves) and what requires standing at a station?
4. **Stakes:** how punishing should bankruptcy, dam crack and wear be (A13)? The 2026-11-06 playtest said aggressive loans are fine.
5. **Swim hazards:** are intakes and tailrace lethal, blocked, or just pushback?
6. **Slide in the sim?** Keep it render-only (recommended) or give it an economy hook (tickets)?
7. **Art direction:** one faceted low-poly style only (part-one brief) or keep v2's three styles?
8. **Does the swarm build in `src/` continue,** or is it retired in favour of v2? (PROGRESS.md still lists Stage 2 as the resume point.)

---

## 6. Verification checklist for whoever implements

- Open the v2 file in the browser pane: `Game.getSnapshot()`, the self-test toast (earlier notes: 32/32), `__HYDRO_AUDIT__.allPassed`.
- Node harness on the extracted `createSimModule`: mass-balance ledger, replay hash equality after rejected actions, reserve-call results at dt 1/5/30/60/300, god-on vs god-off income, dam price one-shot vs stepped, battery quote vs realised.
- At 1 h/s: click Generate/Pump on the card 20×, confirm toasts are visible with Build open, rule editor at 380 px, night screenshot, shoreline at low and high lake level.
- After the graft, the free-roam demo's own `__HYDRO_AUDIT__` checks (stair risers, tread depth, walk routes, no NaN over 60 s) must stay green on the new terrain.
