# 50 — 3D WORLD agent (wave C)

Read `_common.md` first. Name: `world3d`. Branch: `agent/world3d`. Run after waves A and B are merged, in parallel with the UI agent: you never edit `src/ui/*`.

## Mission
Build the Three.js diorama: terrain, water, dam, objects, sky, weather, camera, lenses, picking, audio. It renders from `Game.getSnapshot()` and never mutates state.

## Spec chunks you may read
`s00`, `s10` §10.1 (the **art styles** part), §10.3 (the 3D world), §10.4 (lenses and build modes), `s08` §8.3 (terrain functions only), `s11` §11.4 (performance budgets) and §11.1's dependency rule. `vendor/three.iife.js` is the only 3D library; read-only. Three is exposed as the global `THREE`; `src/world/*` may use it, `src/sim/*` may not.

## Your files
`src/world/renderer.js`, `terrain.js`, `water.js`, `dam.js`, `objects.js`, `sky.js`, `weather.js`, `camera.js`, `lenses.js`, `picking.js`, `audio.js` (synthesised WebAudio only), `tests/world-smoke.mjs`, `decisions/world3d.md`. Export a single `initWorld(container, Game)` and document it in `decisions/world3d.md`; the UI agent's `src/main.js` calls it.

## What to build
3 art styles (as in §10.1) × any UI theme; terrain that uses the **same pure terrain functions as the simulation** (`src/sim/canyon.js` helper functions are importable by the world — that is the one allowed sim import), water surfaces tracking reservoir levels, dam geometry from `site.dam`, instanced meshes for repeated objects (wind turbines, solar tiles), object pools for particles, **no allocation in the render loop**, weather and day/night from `snapshot.climate`, camera presets and orbit, lenses (hydraulic, electrical, ecology, etc., per §10.4), GPU-friendly quality step-down (§10.3), picking for build modes. CPU budget <8 ms per frame in the World view.

## Verification
`tests/world-smoke.mjs`: import the pure-geometry parts (terrain height sampling, dam profile, lens colour tables) headless and assert determinism and no NaN; for the rest, say in the PR whether you ran it in a real browser/headless GL and what you saw (frame time, console errors).

## Done when
Earlier tests still pass, purity check OK, PR lists each §10.3/10.4 requirement and where it lives (or why not done).
