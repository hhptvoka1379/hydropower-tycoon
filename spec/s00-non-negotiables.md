## 0. Non-negotiables

1. **Contract first.** Before any subagent starts, write `CONFIG` and `createInitialState(seed)` with exact property paths and SI units. Nobody invents or renames state keys.
2. **Headless simulation kernel.** All physics, climate, hydrology, wear, automation and market code (`SimEngine`) has zero DOM, Canvas, WebGL or Three.js dependencies and steps as `(state, config, dt)`. It must run 10,000 ticks in Node in milliseconds.
3. **One-way data flow.** Renderers and UI treat `Game.state` as read-only. All input becomes a structured action, for example `Game.dispatch({type:'SET_FLOW', unitId:1, targetPct:0.85})`, applied at the start of the next physics tick.
4. **Fixed-step simulation** for all physics and economics, with the step sizes of the speed ladder in §1.1 (1, 1, 1, 1, 5 and 30 s, never crossing an hour boundary). Rendering runs on `requestAnimationFrame`; physics never runs at variable dt.
5. **Equations implemented literally**, each with a code comment naming it at its call site.
6. **Zero NaN and zero Infinity, ever.** Guard every division; clamp the arguments of `log10`, `sqrt` and `exp`.
7. **Deterministic.** A seeded mulberry32 PRNG drives all simulation noise (weather, prices, terrain); the seed is stored in the save file; no `Math.random()` in simulation logic. Cosmetic-only visuals (water shimmer, particles) may use a separate seeded RNG that never feeds back into state.
8. **Playable on load**, with no tutorial text wall.
9. **Audit hook.** `SelfTest` runs on page load and headless, prints a `console.table()` of every self-test of §12 plus the robustness sweep, and exposes `window.__HYDRO_AUDIT__ = { allPassed, testResults: [{id, name, expected, actual, tolerance, pass}], robustnessSweep: {ticksRun, nanCount, pass}, stateHash, perf, getSnapshot }`.
10. **Process and output format** follow §13 and §14.

