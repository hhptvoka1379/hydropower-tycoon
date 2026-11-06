## 11. Architecture and performance

### 11.1 Source layout and dependency direction

Development happens in small modules, bundled at the end into `hydropower-tycoon.html` (§0). The layout, with one responsibility per file and none above about 500 lines:

```
src/config.js      CONFIG: every constant, commented with units
src/state.js       createInitialState(seed), the state schema, SAVE_VERSION
src/rng.js         mulberry32 and the named streams
src/sim/           canyon.js reservoirs.js hydraulics.js plant.js renewables.js battery.js
                   wear.js climate.js market.js economy.js services.js environment.js
                   sites.js construction.js automation.js quests.js alerts.js engine.js
src/ui/            theme.js hud.js popovers.js drawer.js charts.js editor.js modals.js settings.js
src/world/         renderer.js terrain.js water.js dam.js objects.js sky.js weather.js
                   camera.js lenses.js picking.js audio.js
src/game.js        the loop and Game.dispatch
src/saveload.js  src/debug.js  src/selftest.js
vendor/three.iife.js   build/bundle.mjs
```

The dependency rule is one-way: `src/sim/*` may import only `config`, `state` and `rng`; `src/ui/*` and `src/world/*` may read a state snapshot but never import `src/sim/*` internals except pure helper functions (such as the terrain functions of §8.3, so that the picture and the simulation use the same code). The bundler script fails the build if any file under `src/sim/` mentions `document`, `window`, `THREE`, `canvas` or `Math.random`.

### 11.2 State and actions (the contract)

The orchestrator writes `CONFIG` and `createInitialState(seed)` before any subagent starts, with these top-level keys, and nobody adds or renames one: `version`, `seed`, `clock` (tick, day, hour, speed index, paused), `rng` (the stream states), `climate` (the generated days, the active events), `market` (hourly prices, forecast errors, the emergency state), `sites[]` (each with its terrain parameters, reservoirs, dam, penstock, turbine and pump bays, parcels, arrays, wind turbines, batteries and wear), `finance` (cash, loans, emergency loan, contract, hourly counters, lifetime counters for RTE and LCOS), `services` (reserve offers, active call, reliability score), `automation`, `quests`, `alerts` and `stats`. UI-only settings (theme, art style, quality, sound) live in a separate `settings` object that is saved with the game but is not part of the simulation state and never affects it.

All input becomes one of these actions, applied at the start of the next step by `Game.dispatch({type, ...})`: `SET_SPEED`, `PAUSE`, `TURN_STEP`, `SET_FLOW`, `SET_MODE`, `SET_CURTAIL`, `PLACE_DAM`, `RAISE_DAM`, `EXCAVATE`, `BUILD`, `REPLACE_PENSTOCK`, `CLEAN_ARRAY`, `REPAIR`, `BUY_PERMIT`, `BUY_SITE`, `TAKE_LOAN`, `REPAY_LOAN`, `SIGN_CONTRACT`, `SET_RESERVE_OFFER`, `SET_RULES`, `CLAIM_QUEST`. Each action is validated by the engine (cash, credit, prerequisites) and either applied or rejected with an alert; the UI never decides.

### 11.3 Loop and time

The `requestAnimationFrame` loop accumulates real time, converts it to game seconds with the speed ladder of §1.1 (step size 1, 1, 1, 1, 5 and 30 s, and a step never crosses an hour boundary), runs as many fixed steps as are due, then renders from an immutable snapshot. If the steps due in one frame would take more than 40 ms, run only what fits, carry the rest over, and show a small "simulation is behind" badge. Physics never runs at a variable dt and never inside the render call.

### 11.4 Performance budgets

- **Simulation step:** under 0.05 ms per site per step on a mid-range laptop (so under 0.15 ms with three sites). At the top speed this is a few percent of one core.
- **Events that rebuild data** (dam raise or siting, excavation, a new site): hypsometric tables and terrain regions are rebuilt once, in slices of at most 8 ms per frame, with a progress ring, and never per step.
- **Render:** under 8 ms of CPU per frame in the World view; GPU targets and the automatic quality step-down are in §10.3. Instanced meshes for repeated objects, object pools for particles, no allocation in the render loop.
- **DOM and charts:** charts use ring buffers (24 hours at 1-minute resolution, 1,440 points per series) and redraw only what changed; text nodes update only when a value changes by more than 0.1% or one second has passed; popovers and the drawer update only while open. All canvases handle `devicePixelRatio` and resize.
- **Footprint:** the file may be a few MB. Import only the Three.js parts used (tree-shaken by the bundler) so the vendored build stays small.

### 11.5 Determinism, replay and hashing

- Only `+ − × ÷`, `sqrt`, `exp`, `log`, `sin`, `cos`, `pow`, `min` and `max` appear in the simulation. Transcendental functions can differ in the last bits between JavaScript engines, so replays are guaranteed identical on the same engine and are expected to match closely elsewhere.
- `SimEngine` exposes `stateHash()`, an FNV-1a hash of the canonical JSON of the simulation state (the `settings` object excluded, keys sorted, numbers printed with 12 significant digits).
- Replay: `replay(seed, actionLog)` reproduces a game exactly. The action log is `[{tick, action}]` and is part of the save, so a save can be verified by replaying it.

### 11.6 Audit hook and error handling

`SelfTest` runs on page load and headless, prints a `console.table()` of every self-test and the robustness sweep, and exposes

```javascript
window.__HYDRO_AUDIT__ = { allPassed, testResults: [{id, name, expected, actual, tolerance, pass}],
  robustnessSweep: {ticksRun, nanCount, pass}, stateHash, perf: {stepMsAvg, frameMsAvg},
  getSnapshot }
```

The step function is wrapped in one top-level `try/catch`: on an exception the game pauses, shows an error panel with a Copy button (message, stack, seed, action log) and keeps the last good snapshot instead of crashing silently. Access to `localStorage` is always wrapped, because some browsers block it on `file://`; when it fails the game keeps running in memory and offers Export.

### 11.7 Browser targets and code quality

The target is the current Chrome, Edge, Firefox and Safari with WebGL2, opened from `file://` with no network at all. No `eval`, no external requests, no globals other than `Game` and `__HYDRO_AUDIT__`. Every equation implementation has a comment naming its section at the call site, and every constant lives in `CONFIG` with its unit.

