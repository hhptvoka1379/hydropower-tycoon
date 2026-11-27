# world-core builder state (paused)

## Done and verified (round 4 so far)
- Terrain chunked 8x8 (`terrain.js`), one shared Lambert material with a small `uSoft` patch (program key `ht-terrain`); frustum culling now works for camera and shadow camera. Verified in the browser at hour 0: no console errors.
- Torch softening: while the torch is on at night the terrain shading normal blends toward up (`terrain.soft`, driven in `index.js` from `lights.torchLevel`); spot 70 / decay 1.2 / angle 0.62 / penumbra 1.0, halo 34 / dist 9. Seen on grass and on the dam crest: soft warm pool, no wedge.
- The hard wedge seen earlier on a footpath is the `paths-strips` mesh (features builder, pale albedo lit by the torch), not the light cone. Needs a darker or night-dimmed path colour in `game/world/features/paths.js`.
- `world.quality` getter/setter ('low' | 'medium' | 'high', default 'medium'): low = no shadows and no pooled lamps (`env.quality` read in structures), medium = 1024 shadow map, high = 2048; DPR cap 1 / 1.5 / 2; emits bus `quality`. Verified by toggling in the browser and in the Node smoke run.
- `world.audit()` now returns `categories` (sky, terrain, skirt, water, structures, paths, tiles, scatter, weather, other), `sceneTriangles`, `quality`, plus the old fields.
- Flow ribbons share one program (speed is a uniform); `userData.cat` tags on meshes.
- Storm darkening wired: `env.stormDarken` is smoothed in `index.js` and passed to `atmosphere.update(..., darken)` (direct, moon and hemisphere intensity x (1 - 0.35 d), sky grey mix +0.5 d, fog +0.8 d); the sky also gets cloud + 0.5 d.
- Debug seams: `world.debugWeather({rain mm/h, snow 0..1, wind m/s, windDir}|null)` and `world.debugSeason(doy|null)` override `env.rain/snow/wind/windDir/T/doy/season` (render-only). Rain override verified in the browser (weather feature draws, darken responds).
- `env` now also carries `climate`, `state`, `windDir`, `T` (features read them).
- `world.pick`: tile hits work through the tiles feature (`type:'tile'`). No feature returns `type:'desk'` yet (only tiles do).

## In progress
Nothing half-edited. The last change (debug seams + darken) is complete and built.

## Remaining, in order
1. Profile table for the report (below) and re-measure after the features builder's cuts.
2. Programs 30-31 at start (46 after toggling quality in a session): mine are about 9 (dome, stars, glow, water, flow, 2 Basic, terrain Lambert, plus depth). The rest are the features' 9 scatter programs with per-material custom cache keys plus their depth materials; they should share one key.
3. Optional: skip shadow-map re-render while the focus is stationary (`renderer.shadowMap.autoUpdate=false`); a desk pick type in the features builder; darker night colour for path strips (features).
4. Re-run the 50-build leak check after any further change (currently flat: 105 -> 105 nodes, scope size 93, blockers 6).

## Triangles (classic start, game running at the powerhouse/dam, medium)
| piece | scene tris |
|---|---|
| terrain (64 chunks) | 80,000 (was 1 mesh, 80,000) |
| skirt + table | 4,872 |
| water | ~11,300 |
| structures | 4,457 |
| paths | ~14,200 |
| tiles | 5,830 |
| scatter | ~176,700 (features builder; was ~215k) |
| weather (active) | ~900 |
| sky | 3,908 |
| avatar/other | ~1,000 |
| scene total | ~302,000 |
Rendered last frame (info.render.triangles): 419,609 at medium (main pass ~247k, shadow pass ~173k, almost all scatter casters); low 246,873. Draw calls 95 medium / 54 low. Programs 31. Target of <= 250k total will be met only when scatter drops further.

## Files changed this round
game/world/terrain.js, game/world/index.js, game/world/lights.js, game/world/atmosphere.js, game/world/structures.js, game/world/water.js, game/world/sky.js, game/notes/agent-state/world-core.md. Not touched: main.js, player, sim, features.

## Status
- npm run check: green. npm run build: green (0.79 MiB). surface tests: 15/15.
- npm test: 149 pass, 1 fail: `classic 14692: paths adapter, stair treads equal Flight.floor` (player/features area, not my files).
- Browser tab closed.

## Resumed round 4 (after pause)
- `env.jobs` = live `game.state.jobs` reference. Shadow map is on demand (`renderer.shadowMap.autoUpdate=false`): re-rendered when the focus moves > 2 m, the key direction moves > 0.2 deg, the box size changes, the scene/quality changes (`world.invalidateShadows()` for features), or the map is older than 0.5 s (moving focus) / 1 s (still). Measured idle at the powerhouse: shadow pass on 17 of 127 frames.
- My programs = 9 (dome, stars, glow, water, flow, terrain, shared Lambert, Basic with and without vertex colours); the other ~22 of 31 are scatter's per-material keys, weather and the avatar.
- Audit (classic start, medium, scatter cuts NOT landed yet): scene ~302k, rendered 243k on frames without a shadow pass / 397k with one (about 263k average, was 395k constant), draw calls 51 (no shadow pass), programs 31.
- Hook needed from features: split instanced scatter into spatial chunks with bounding spheres (or set `castShadow=false` on far chunks) so the shadow frustum culls them.
