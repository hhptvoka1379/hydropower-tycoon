# FABLE 5.2 EXECUTION PLAN — Hydropower Tycoon "field station" edition

Owner of the work: Fable 5.2 (structural work). Mode: execute end to end, no check-ins except where a phase says **STOP-AND-ASK**.
Read first: `PROJECT_STATUS.md` (flaw register IDs A1–C13 are used below). Sim/UI/render findings there come from code reading plus Node runs, not from play; confirm each in the running game before fixing.

---

## 0. Decisions already made by the user (locked, do not re-litigate)

| Topic | Decision |
|---|---|
| Base | `other model's attempts/reconstructed/opus5.5 v2/index.html` is the sim and gameplay base. |
| Renderer | Replace the hand-written WebGL2 with **Three.js** (already vendored: `three@0.187.0`, `vendor/three.iife.js`, `build/vendor-three.mjs`; `esbuild@0.28.2`). Do not write a renderer from scratch. This also retires C1 (context loss), C7 (AA/shadows), C9, much of C6. |
| World / terrain | **A blend, Fable decides.** Short spike first (Phase 3A), then pick. The only hard rule: one surface sampler used by walking, water, placement and picking (retires C10). |
| Player | Physical walking player; walk to stations; **discrete time modes** (walking/working runs at a friendly fixed rate; stations offer "wait/sleep to next peak"; critical events auto-slow). |
| Control | **Walk to operate.** Remote views (forecast board, plant summary) are read-only. Remote allowed only for: pause, save/load, settings, and the rule engine's master switch. |
| God mode | The profit top-up is an **intended mechanic**, kept as an opt-in assisted mode. Shown as its own "subsidy" line; **excluded** from quests and the win check, so normal play stays honest. Off by default, opt-in from the start screen. |
| Dam price | One integrated cost function of (h0, h1). Modest premium for a big single step (mobilisation, rush contractors), shrinking with lead time. Planning a multi-stage programme ahead earns a **small discount up to ~5%**. The discount must be small enough that the plant still depends on solar, wind and arbitrage for revenue. Tune so the total is never 2× different between routes. |
| Stakes | "Cozy with real consequences": bankruptcy reachable but recoverable (restructure, lose a site, never a hard game over); dam crack derates storage until repaired; wear matters over weeks; loans stay easy. |
| Art | One faceted low-poly style, one Field Notes theme (paper `#f1ead9`, ink `#2b2a26`, moss `#4f6b3a`, clay `#a3472c`, river `#2f6f86`, ochre fills only). Drop the 3×3 theme/style matrix. |
| `src/` swarm build | **Retired.** Keep `spec/`, `src/`, `tests/`, `decisions/` as reference and as a source of tests and formulas. Do not continue Stages 2–5. |
| UI vibe | **Chill, not SCADA.** The SCADA drawer is removed. Minimal in-world HUD, cards at stations, a diegetic forecast board, cozy notebook feel. |
| Swimming and slide ride | Left to a **later Sonnet agent**. Fable builds the structure it needs (Phase 7 hooks), not the finished feature. |
| Night | Give the player a **torch / halo** (light source) plus a proper moon and ambient floor; water and ice must be lit, not emissive. |

---

## 1. Target architecture

Keep the deliverable a single offline `hydropower-tycoon.html`, produced by a build step.

```
game/
  sim/           pure ES modules, no DOM/THREE/Math.random/Date (lifted from v2 createSimModule)
    engine.js hydraulics.js reservoirs.js plant.js economy.js market.js climate.js
    construction.js god.js quests.js rules.js saveload.js
  world/         Three.js: scene, terrain, water, dam, penstock, buildings, scatter, sky, weather, camera, picking
  player/        walker, stations, interaction, time-mode controller, (hooks for slide/swim)
  ui/            hud, cards, forecast board, rule cards, build, finance, quests, save, onboarding, toasts
  tests/         node --test harness for sim; browser audit hook
build/bundle.mjs  esbuild IIFE + inlined three, outputs dist/hydropower-tycoon.html
```

Rules: `game/sim` may not touch DOM, THREE, `Math.random`, `Date`, `performance`. The player, slide and swim code are **render-side only** and must never touch sim RNG, state, saves or the state hash. One-way flow: UI and player dispatch actions; render reads `getSnapshot()` (cached, not deep-cloned at 20 Hz).

---

## 2. Phases

Each phase ends with: tests green, a git commit, and a tag (`fable-p0` … `fable-p8`). Commit messages carry **no** Claude/Anthropic/Co-Authored-By lines (user rule, overrides any default).

### Phase 0 — Safety net and extraction  (do first, no behaviour change)
1. New branch `fable/main` from `master`; copy v2 to `game/legacy/v2.index.html` untouched as the behavioural baseline.
2. Extract `createSimModule()` into `game/sim/*` ES modules. Keep public API identical (`Sim.*`, `Game.dispatch`, `Game.getSnapshot`, `Game.replay`).
3. Build a Node harness (`node --test`) with golden tests captured from v2: mass-balance ledger, 10-day income for classic and procedural starts, replay hash equality, V(h) inversion, reserve calls. Record v2's current numbers as the baseline.
4. Update `build/bundle.mjs` to produce `dist/hydropower-tycoon.html` (still works with the legacy renderer at this point).
**Done when:** `npm test` passes, the built file plays identically to v2.

### Phase 1 — Sim correctness and economy  (flaws A, kept faithful to your decisions)
Fix in this order, each with a test:
- **A2** reserve pay revalidated every hour against `reserveCap`.
- **A3** integrated dam cost with the modest-premium / 5%-planning-discount rule above; test: one-shot vs staged totals within a defined band, never 2×.
- **A1 (reclassified):** keep god-mode top-up; add a separate `subsidy` ledger line; exclude from quests, `profitDays`, netWorth and win; opt-in default off.
- **A4/A5** NPV and payback quotes: cap battery at MWh × cycles with RTE; annualise over a seasonal sample; apply the shading cost; remove dead no-ops; god auto-build must not spend on a single-day extrapolation.
- **A6** procedural start: affordable first dam, lower-lake spill/head fix (`lowerHMax`, lower bed), tune `startCash`.
- **A7** calibrate `a2`/`a3` to terrain volume (or derive terrain from the polynomial). Test: flooded terrain volume vs `resVol` within 3%.
- **A8** determinism: remove `lastReject` from the hash or log rejections; separate RNG streams (events/market/reserve/cracks); sub-step reserve calls so pass/fail is dt-independent. Test across dt 1/5/30/60/300.
- **A9** replay loop guard. **A10–A15** as listed in `PROJECT_STATUS.md`, including quest count/q9 fix and `validateSave` full schema.
- **Stakes:** implement recoverable bankruptcy (restructure/lose a site), dam crack derating, wear that matters over weeks, `EMERGENCY_CREDIT` respecting `maxLoan`.
**Done when:** all A tests pass; 10-day income and pacing within the targets set in Phase 6.

### Phase 2 — Three.js renderer port  (flaws C)
Rebuild the world in Three.js from the sim's layout:
- Terrain: continuous per-vertex colour from elevation, slope and noise (no 4×4 blocks, no checker diagonal), triangulated surface exposed as the **single sampler**.
- Water: reservoir surfaces fit the basin and follow `Sim.resLevel` every frame; shore computed in shader from the live level; connectivity flood-fill; cutaway views updated.
- Dam (earth and concrete), spillway sharing the face function (C11), penstock drawn to the sim's `L` and `D` (C13), powerhouse with lit windows, switchyard, solar/wind/battery tiles, scatter (trees, rocks, gravel) rebuilt on dam raise.
- Sky and light: smooth gradient, horizon fog/backdrop, sun that sets, moon, season hue on vegetation, soft shadows, FXAA/MSAA.
- **Night:** moon plus ambient floor, lit water and ice, lamps on powerhouse and crest, and the **player torch/halo** (soft cone or radial light that follows the avatar).
- Resource hygiene: dispose geometries/materials on rebuild, context loss/restored handlers, render-only frame timing for auto quality (with recovery).
**Done when:** screenshots at noon, dusk, night, canyon and classic starts show none of C1–C13; no GPU resource growth across 50 rebuilds.

### Phase 3 — Player and world  (core of the new vision)
- **3A spike (≤ 1 hour of work):** compare (a) re-authoring the free-roam demo's stairs, slope limit and `walkerStep` on the sim terrain, versus (b) transplanting the demo's valley. Pick or blend; write the decision into `decisions/fable.md`.
- Port from the free-roam demo (zip in `other model's attempts/`): `walkerStep`, `groundY`, `planPath`, double-click-to-go, follow camera, athlete rig (`swimmerGB3.js` body lab).
- Station graph: powerhouse, dam crest, penstock, both lakes' shores, each tile, slide platform, rim lookout; stairs/paths generated on the one sampler.
- Interaction: standing within range of a station opens its card; a distance/ETA marker when click-to-go.
- Player render-only; add an audit hook (no NaN over 60 s, never below terrain, walking never changes the state hash).
**Done when:** the player can walk from the powerhouse to every station and open each card; hash unchanged by walking.

### Phase 4 — Time modes
- Walking and working run at a fixed friendly rate; per-station "wait / sleep until next peak / until morning"; auto-slow to 1× with a banner on critical events (grid emergency, cavitation, crack, bankrupt).
- Keep pause. Retire the 6-step ladder from the main HUD (fast-forward available only via the "wait" actions and a hidden debug key).
- Reserve calls and emergencies must be reachable even at fast-forward (A8, B11).
**Done when:** a grid emergency can never be missed; a 5-minute walk-and-work session advances the clock by an intentional, documented amount.

### Phase 5 — UI rework: chill, not SCADA
Remove the SCADA drawer and any dense gauge strip. New UI, all in the Field Notes style (small radii, serif headings, mono tabular numbers, WCAG AA, state never by colour alone):
- **HUD:** cash and clock only; small time-mode chip; pause; menu.
- **Station cards:** appear when the player is at a station; Generate/Pump/Idle, flow, repair, upgrade; update values in place, never rebuild the DOM under the cursor (fixes B2, B8).
- **Forecast board:** diegetic object at the powerhouse (24 h price, peak hours, weather); remote view is read-only.
- **Rule editor:** stacked cards ("when price is above ___ then generate"), "highest priority wins" stated, unsaved marker, no 760 px tables (B9).
- **Toasts and chips always on top** of every panel (B1), grouped, readable, with a short "why" on every rejection (B5, B7).
- **Build/plant/dam tabs:** buttons that will be rejected are disabled with a reason; job progress and ETA shown; quote above the map; repair scaled to damage; no paid downgrades (B5–B7).
- **Quests:** badge and toast on completion; claim in one click; tutorial ladder.
- **Onboarding:** "Welcome to the field station" card that states the loop in two sentences and points at the first thing to do; start state shows a working plant; explain why idle if idle; a visible hint when automation is off or rules never fire.
- **Save/load:** Continue on the start screen, atomic load, confirm on overwrite/delete, quota errors surfaced (B12); no autosave of a throwaway game.
- **Robustness:** global error handler that shows one dismissible overlay (B3); Esc never traps a bankrupt state (B4); modals pause the sim (B13).
- **A11y:** focus management and trap in dialogs, no Space hijack, text alternatives for charts, loss days not drawn as profits (B14).
**Done when:** a first-time player reaches their first profit without opening documentation; all B items closed.

### Phase 6 — Gameplay and pacing pass
Define target numbers up front and tune only `CAPEX_SCALE`/start values:
- First 10 minutes: first profit within one in-game day, first quest claimed within 10 real minutes.
- Mid-game: a build choice that matters every ~2 in-game days; solar/wind/arbitrage carry revenue; the planning discount from dam pricing must not make reserve or god mode dominant.
- Grid events: short telegraphed warning plus reward so they feel like opportunities, not surprises.
- Quests: 20, rebalanced; wins reachable in a long session.
- Automation: default rules visible and enabled, clearly explained.
- Add a "what happened while you were away" note after waits.
Write a headless "bot" in the Node harness that plays the first 30 game days with default rules and with greedy rules and asserts income bands.

### Phase 7 — Hooks for the Sonnet follow-ups (build the structure, not the features)
So a later Sonnet agent can add the slide ride and swimming without touching the core:
- `player.mode` state machine with `walk | swim | slide | stairs | blocked`.
- `World.water.surfaceAt(x, z)` and `World.water.depthAt(x, z)` live from the sim level; walkable-or-swimmable query.
- `World.hazards`: intake and tailrace zones (data only).
- `World.slide`: platform/exit points and a rider-pose request API (`riderGB()` placeholder replaced by the `swimmerGB3` poses 1 and 2).
- A written brief at `decisions/sonnet-followups.md` listing exactly what to implement and the invariants (hash isolation, no sim RNG, no new global).
**Done when:** the hooks exist, are covered by tests, and the brief is self-contained.

### Phase 8 — QA and ship
- Browser self-test and `__HYDRO_AUDIT__` green; Node suite green; replay equality across dt.
- Perf budgets: ≥ 50 fps on a mid laptop at medium, load ≤ 5 s, memory flat over 30 minutes (no leak per rebuild), output ≤ ~1.5 MB.
- Playtest scripts through the built-in browser: first 10 minutes, a grid emergency, a night walk with the torch, save/load round trip, bankruptcy-and-recover, canyon start.
- Update `PROJECT_STATUS.md`, write `README.md`, tag `fable-release`.

---

## 3. What else (additions I'd make, Fable to confirm or skip)

1. **Save compatibility:** bump the save version; migrate or refuse v2 saves with a friendly message.
2. **Audio:** gentle ambient (water, wind, turbine hum that follows load), sound for emergencies; all generated in code, no files; off-by-default toggle.
3. **Mobile/narrow viewports:** cards as bottom sheets; the walking control via on-screen stick; check at 375 px.
4. **Torch tuning:** a light cone with a limited range so night is atmospheric, not fully lit; skip the torch in daylight.
5. **Debug overlay (F2):** time mode, player position, active station, hash, frame time. Kept for the Sonnet follow-ups.
6. **Error budget:** every phase starts by reading the relevant flaw rows in `PROJECT_STATUS.md` and re-confirming them in the running build before editing; no fix for a bug that does not reproduce.
7. **Repo hygiene:** `other model's attempts/` stays untouched; keep generated files out of git unless listed; commits per phase, no push.

## 4. STOP-AND-ASK points (the only ones)
- If the Phase 3A spike shows neither terrain route can share one sampler without a rewrite larger than Phase 2.
- If the Three.js bundle plus inlined code exceeds ~3 MB single-file.
- If any dam-pricing or stakes tuning requires changing what you decided above (e.g. the 5% planning discount cannot hold without making reserve dominant).

## 5. Out of scope for Fable
Finished swimming locomotion, ridable slide, extra body presets/hairstyles, a second site type beyond classic and canyon, multiplayer, art for 3×3 theme/style variants.
