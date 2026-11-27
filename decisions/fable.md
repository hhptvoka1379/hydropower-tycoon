# Fable decisions — field station build

Binding for every builder. Where this file and a note in `game/notes/` disagree, this file wins.

## D1. World / terrain (Phase 3A spike result)
Spike (Node, `Sim.terrainH`, classic seed 14692): share of the world steeper than 35° is 0% / 1% / 2% / 12% at vertical exaggeration 1 / 1.5 / 2 / 3. Powerhouse→dam is 239 m, powerhouse→parcels 550–600 m.
- **Route (a): one world.** The walker, stairs and camera of the free-roam demo are re-authored on the sim terrain. The demo valley is not transplanted.
- **VEX = 1.5**, one constant, applied once inside `Surface`. Everything with a sim height goes through `surface.toDisplayY(simY)`. Dam profile, penstock and water are drawn from sim numbers × VEX (C13 closed by construction, except pipe diameter: true D, visual minimum 1.2 m, documented).
- **Grid:** cell 8 m (N = 200 over 1600 m), non-indexed flat-shaded triangles, colour per vertex from a continuous function of elevation, slope and noise. Diagonal chosen by corner heights (`|h00-h11| <= |h10-h01|` → split 00–11).
- **One sampler:** `game/world/surface.js` (pure JS, no THREE, Node-tested). Mesh, water depth, placement, picking, walking and camera all read it. No other module interpolates height.
- **Avatar scale vs world:** avatar 1.74 m. Walk 5 m/s, run (Shift) 11 m/s, so powerhouse→dam is ~22 s running. Slope limit 35° displayed; generated paths/stairs where a station route exceeds it.
- Sim `penstock.L` stays the hydraulic length (not the drawn polyline); documented, not a bug.

## D2. Module contract
```
game/sim/      pure sim (unchanged rules: no DOM/THREE/Math.random/Date/performance)
game/app/      bus.js (event bus), written by the orchestrator
game/world/    Three.js. index.js exports createWorld(ctx) -> world
game/player/   walker.js, stations.js, timemode.js (pure, Node-tested); avatar.js, camera.js, index.js exports createPlayer(ctx)
game/ui/       index.js exports createUI(ctx); style in game/style.css
game/main.js   builds ctx and the frame loop
```
`ctx = { Sim, game, bus, act, clock, world, surface, player, ui }`
- `ctx.act(action)` is the **only** dispatch path for UI and player: calls `game.dispatch`, emits `action:result {action, ok, reason}`.
- three is imported by name from `'three'` (esbuild tree-shakes). Never `import * as THREE`, never the `THREE` global.

Surface API (display metres unless named `Real`):
`y(x,z)`, `yReal(x,z)`, `normal(x,z,out)`, `slopeDeg(x,z)`, `raycast(origin,dir,tMax)`, `toDisplayY(simY)`, `floorY(x,z)` (= max of `y` and floor providers: crest walkway, stairs, decks), `addFloorProvider(fn)`, `setWater(levels)` / `depth(x,z)` (max over lakes and river of live level − y; >0 wet), `waterSurface(x,z)` (level or NaN), `version`.

World API: `build(siteState)`, `frame(dtReal, view)`, `setTorch({x,y,z,dx,dz,on})`, `water.surfaceAt(x,z)`, `water.depthAt(x,z)`, `hazards` (data), `slide` (data + rider-pose request stub), `pick(ndcX, ndcY)`, `debugSetTime({doy,hour})`, `audit()`.

Bus events: `sim:stepped`, `action:result`, `station:enter {id}`, `station:leave {id}`, `time:mode {mode,rate,reason}`, `alert {level,text,why}`, `world:rebuilt`, `game:new`, `game:loaded`.

## D3. Time modes (Phase 4)
Render-side controller `game/player/timemode.js`; rate = sim seconds per real second.
| Mode | Rate | When |
|---|---|---|
| `field` | 60 (1 real s = 1 game min) | default: walking and working at a card |
| `wait` | up to 3600 (1 game h per real s) | only from a station "wait" action: 1 h, until next price peak, until morning |
| `alert` | 60, forced | critical event (grid emergency, cavitation, crack, bankrupt): cancels `wait`, banner |
| `pause` | 0 | pause, any modal |
A 5-minute walk-and-work session advances the clock 5 game hours. Sim step dt is chosen from `CONFIG.time.dtBySpeed` (≤ 5 s in field/alert, ≤ 60 s in wait). Hidden debug key `]` cycles a debug fast-forward. The speed ladder is gone from the HUD.

## D4. Stations
One station per place, not per tile: powerhouse, forecast board (at the powerhouse), dam crest, penstock (mid-route valve house), upper shore, lower shore, **one desk per parcel** (card shows its 16 tiles), slide platform, rim lookout. Lookout = office: finance, quests, site switch, save. God mode: opt-in on the start screen, switch also at the lookout. Remote (anywhere): pause, save/load, settings, rules master switch, read-only plant summary and forecast.
Hazards (intake, tailrace): data only now; intended behaviour for the follow-up agent is push-back, never lethal.

## D5. Dam price (A3)
`cost(h0→h1) = ∫ c(h) dh` over the layers actually added (route-independent core) `× (1 + premium) × (1 − discount)`.
- premium = 8% × clamp((Δh − 5)/35, 0, 1): a big single step costs at most 8% more.
- discount = 1.25% per stage of a declared programme that was declared ≥ 2 game days before it starts, max 5%.
- Worst route ratio is therefore ≤ 1.08/0.95 ≈ 1.14. Test band: every route within 15% of every other.

## D6. Stakes (A13)
- Bankruptcy is a **restructure** state, never game over: choose "refinance" (debt rolled into one loan at a higher rate, credit limit cut for 30 days) or "sell assets" (sell chosen tiles at 50% of cost). The sim keeps running after the choice.
- `EMERGENCY_CREDIT` respects `maxLoan`; restructure is the way out beyond it.
- Dam crack derates usable storage (max level −20%) until repaired.
- Wear: a neglected turbine loses visible efficiency within ~60 game days and reaches 0 health in ~300.
- Loans stay easy.

## D7. Render
Default three colour management (sRGB output). No legacy A/B switch: the legacy game stays runnable through `npm run legacy`. No bloom at launch: MSAA + glow sprites. Moon phase computed render-side from the day number. `World.water.*` is backed by `Surface` + live levels.

## D8. Flaw policy
A flaws are reproduced in Node first (`game/notes/flaw-repro.md`) and fixed only if reproduced. B and C flaws belong to the legacy UI and renderer, which are replaced, not patched: each B/C row becomes an acceptance check on the new UI/renderer instead of a legacy repro.
Phase 1 changes sim behaviour on purpose, so `game/tests/parity.mjs` (legacy equality) is valid for Phase 0 only; after Phase 1 it is kept as a record and not run in `npm test`. `baseline.json` is re-recorded with the reasons listed.

## D9. World features seam
`game/world/index.js` (owner: world-core builder) exposes `world.addFeature(feature)` and calls `registerFeatures(world)` from `game/world/features/index.js` once at creation.
A feature is `{ name, signature(site) -> string, build(scope, site, surface, env), frame(dt, env), dispose? }`:
- `build` is called on `world.build` and again whenever `signature(site)` changes (dam raised, tile built); the feature's own `ResourceScope` is disposed first, so nothing leaks.
- `scope` is a `ResourceScope` (`track`, `add`); `env` carries what the world already computes per frame: `{ scene, camera, night (0..1), sunDir, doy, hour, season, wind, rain, snow, quality, view }` plus `site` state for live values.
- Features place objects with `surface.y` only, convert sim heights with `surface.toDisplayY`, and may register floor providers (`surface.addFloorProvider`) for anything walkable (crest walkway, stairs, decks) and blocked footprints (`world.blockers`, array of `{x0,z0,x1,z1}` boxes the walker treats as solid).
- Structures (dam, spillway, penstock, powerhouse, switchyard, lamps) live in `game/world/structures.js`, owned by the world-core builder. Everything under `game/world/features/` (tiles, scatter, weather, paths and stairs) belongs to the features builder.
