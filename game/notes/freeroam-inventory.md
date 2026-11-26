# Freeroam demo: reusable-unit inventory

Source: `/Users/db/Documents/projects/dam-game/game/reference/freeroam/index.html` (1,482 lines, one inline `<script>` inside an IIFE, `const Game=(function(){...})()`). Extracted from `other model's attempts/sonnet5.5-high-freeroam-hydropower-tycoon-3d-diorama.zip`. Title: "Hydropower Tycoon, part one: the world". Renderer is hand-written raw WebGL2 (no Three.js, no build step, no external requests).

Line numbers refer to that file. "Coupling" says what the unit needs from the demo's own valley: `heightAt` / `meshY` (displayed ground, m), `groundY` (ground plus stair treads), `waterDepth`, `FLIGHTS` (stairs), `SITE`/`FEATS` (sites and pads), `LIM` (map half-size minus 3 m), `inBld` (powerhouse footprint). "Pure" means it needs only `CONFIG` or its own arguments.

## Inventory

| # | Unit | Lines | What it does | Inputs / outputs | Coupling to demo terrain |
|---|---|---|---|---|---|
| 1 | CONFIG (world, relief, river, lakes, sites, stairs, player, camera, light, rain, quality, audit) | 480-497 | Every tunable constant, with units in comments | none / plain object | Defines the terrain itself; `stairs`, `player`, `camera` are reusable as-is |
| 2 | Hash, value noise, fBm, RNG, smin helpers | 501-510 | Seeded `hash2`, `vnoise`, `fbm`, `rngMake` (mulberry-style), `smin`, `sstep`, `clamp` | (x,z,seed) / number | Pure |
| 3 | River centreline and river level/width | 515, 522-523 | `cx(z)` sinusoidal centreline, `riverLevel(z)` water surface with up/down slopes, `riverW(z)` noisy width | z / m | Terrain (demo-specific shape) |
| 4 | Lake shape | 516-518 | `mkLake`, `lakeR(L,θ)` wobbly shore radius, `lakeSd(L,x,z)` signed distance to shore | lake record, x, z / m | Terrain (lake placement) |
| 5 | Seeded layout and site chain | 512-521, 559-576 | Places lakes, powerhouse, service route, rim lookout from seed; chains them shore → stair head → yard → route → lookout | CONFIG / site coords | Terrain-specific layout |
| 6 | Base terrain and local rises | 525-534, 578-579 | `baseOnly(x,z)` river valley walls + noise; `baseH` adds Gaussian `MASS` bumps so sites sit on natural ground | x,z / real m (pre-exag) | Terrain generator (the thing to replace) |
| 7 | Polyline projection | 536-543 | `mkPoly`, `project(P,x,z)` returns distance and arc length (in `PR.s`), `pointAt(P,s,out)` | polyline, point / distance, tangent | Pure |
| 8 | `makeFlight` (stair flight generator) | 545-554 | Builds a polyline with a sine-wobble heading, then a profile: landing, n equal risers, landing. Gives `treadTop(i)`, `loD`, `hiD`, `riser`, `tread` | start, heading params, lo/hi heights / flight object | Needs only CONFIG.stairs and `EX`; heights are passed in |
| 9 | Pads and bounding boxes | 556-557 | `mkPad` (flat disc/strip with blend), `bbox` | pts, y, r / feature object | Pure |
| 10 | Height composition | 581-595 | `applyLake` (basin + bank), `carve` (river channel, `smin` blend), `applyFeat` (flatten to flight/pad profile), `heightReal`, `heightAt` (= EX × heightReal) | x,z / displayed m | Terrain (the core of the heightfield) |
| 11 | Height grid and mesh-exact sampler | 597-602 | `buildGrid` (Float32 grid, NV×NV), `meshY(x,z)` triangle-exact interpolation matching the drawn mesh, `meshNormalY` | x,z / m, unitless normal y | Terrain; this is the single sampler the walker should use |
| 12 | `stairTop` | 604-612 | Returns tread top or landing height if (x,z) is on a flight; sets `stairHit` and `stairKind` (1 tread, 2 landing) | x,z / m or NaN | Needs `FLIGHTS` (stairs) |
| 13 | `groundY` | 614 | `max(meshY, stairTop)`: ground the walker stands on | x,z / m | Needs `meshY` and `stairTop` |
| 14 | `treadInfo` | 615-618 | Per-tread centre, yaw, top, ground, and foundation bottom (for drawing) | flight, i / object | Needs `meshY` |
| 15 | `waterDepth` | 620-622 | Water surface minus ground, for both lakes and the river; >0 means wet | x,z,g / m | Needs lakes and river (terrain) |
| 16 | `walkerStep` | 629-639 | The only movement rule. Clamps to LIM, stops at water deeper than `maxWade`, blocks the powerhouse footprint, allows a step of at most one riser on stairs, otherwise a slope limit (`walkSlopeDeg`); too steep = slide back | state{x,y,z,on}, dx,dz, speed, dt / 0 ok, 1 too steep, 2 wet, 3 building | Needs `groundY`, `waterDepth`, `inBld`, `stairHit` (a closure, so the stair test must set it) |
| 17 | `walkableAt` and `lineWalkable` | 640-643 | Straight-line walk test sampled every 0.8 m (slope, water, building, LIM) | segment / bool | Needs `meshY`, `waterDepth`, `inBld` |
| 18 | Powerhouse footprint | 626-628 | `BLD` box and `inBld` | x,z / bool | Demo-specific (blocks walking) |
| 19 | Waypoint chain | 644-648 | Every other point of the three flights plus the yard, as a graph of 1 m-ish way-points | none / array, `chainMark` indices | Terrain-specific (uses flights) |
| 20 | `planPath` | 649-651 | Direct line if walkable, else nearest chain node → walk chain → target | start, target / array of points or null | Needs 17 and 19 |
| 21 | `simulateRoute` | 652-658 | Runs `walkerStep` at a fixed dt along waypoints; reports time, steps, stair steps, tread steps, min clearance, max step-up, NaN count | waypoints, speed / result object | Needs 12-17 |
| 22 | `pose` (walk / idle / climb) | 660-666 | Phase-driven hip, knee, arm, lean, breath, head-yaw, bob. `move` blends walk↔idle, `climb` adds lean and knee lift | rig object, phase, time, move, climb / object | Pure (no terrain) |
| 23 | Rain pool | 667-675 | Fixed Float32 pool, hard cap, reset and step with no allocation; `effects(settings)` returns easing/rain/shimmer flags | camera focus / positions | Pure |
| 24 | Terrain and grid hash | 677-680 | FNV-1a hash of quantised heights, used by the audit to prove walking does not change terrain | none / hex string | Terrain |
| 25 | Places and snapshot | 682-690 | Named place circles (powerhouse, lower shore, service route, lookout) and a JSON deep copy of layout | none / object | Demo-specific names |
| 26 | Core return object | 691-694 | The public surface of `makeCore(CFG)`: heights, walker, pose, rain, layout | CONFIG / object | This is the "seam": everything above it |
| 27 | Audit (`runAudit`) | 697-751 | Runs 19 checks (list below) in a worker, returns results and perf | makeCore, CFG / results | Calls core only |
| 28 | Shared state, frozen snapshot, AUDIT, settings `S` | 752-763 | Single-direction data flow: world reads a frozen snapshot, never writes back | none / SNAP, AUDIT, S | Generic pattern |
| 29 | Self-check panel and worker bootstrap | 764-785 | Stringifies `makeCore` and `runAudit` into a Blob Worker, posts CONFIG, renders PASS/FAIL table | none / DOM | Generic (the worker trick) |
| 30 | M4 matrix helpers | 792-805 | Column-major 4×4 ops: persp, ortho, lookAt, T/Rx/Ry/Rz, pivot | out matrix, args / out matrix | Pure |
| 31 | Shader compile helper `prog` | 808-812 | Compiles VS/FS, links, caches uniform locations | sources / {p,u} | Pure |
| 32 | Lit shader (VS/FS) | 814-866 | Flat-shaded, double-sided, hemi + sun, 3×3 PCF shadow, rain sparkle on mat 2, distance fog; instanced grass sway in VS | uniforms / colour | Pure |
| 33 | Water shader (VS/FS) | 869-916 | Procedural wave normals, depth tint, refraction from copied scene, Fresnel, sun glint, foam at shore, translucent "volume" mode | uHeight texture, uGrid / colour + alpha | Needs the height texture (terrain) and water level |
| 34 | Sky, blit and rain shaders | 917-929 | Full-screen sky gradient, blit, line rain | camera basis / colour | Pure |
| 35 | `Mesh` builder, `makeGeo`, `fromMesh` | 934-957 | Flat-colour triangle accumulator (normals from winding), VBO/VAO creation, instanced attribute packing (xyz+scale, yaw+tint) | calls to tri/quad/box/beam/frustum / VAO | Pure |
| 36 | Terrain colouring | 961-975 | `terrainColor` (grass to hill to rock to snow by height and normal, gravel on river banks, bed in water, path under pads), `gravelMask`, `padMask` | x,z,h,normal / RGB | Terrain-specific palette; logic generic |
| 37 | `buildTerrain` | 976-993 | Triangulated top from the grid, plus four strata-coloured side walls and a bottom | core grid / two geos | Terrain (needs grid) |
| 38 | Powerhouse builder | 1010-1053 | Foundation, hollow walls with door and windows, parapet, crest rail, tilted solar panels, crates | `SITE`, `CONFIG.sites` / meshes | Demo-specific building; `Mesh` helpers reusable |
| 39 | Stair builder | 1055-1073 | Each tread as a stone box down to ground, alternating colours, dashed centre strip, landing slabs, handrails with posts on both open sides | flights / meshes | Needs `treadInfo`, `meshY`, `pointAt` |
| 40 | `drape` dashed footpaths | 1076-1090 | Lays dashed quads along a polyline draped onto `meshY`, skipping stairs and water | polyline / quads | Needs `meshY`, `waterDepth`, `stairTop` |
| 41 | Rim lookout builder | 1092-1103 | Fenced ring with a gap, bench, marker post | site / meshes | Demo-specific |
| 42 | Scatter (trees, rocks, gravel, grass) | 1105-1145 | Clustered seeded placement with `clearOf` (keep out of pads), slope and water filters; icosahedron rock; 3-blade grass; 3-tier conifer | seed, `meshY`, `meshNormalY` / instance arrays | Needs terrain samplers; placement logic generic |
| 43 | `athleteRig` | 1147-1170 | Builds the swimmer once per body preset by bucketing triangles of the GB output into 8 rigid parts (torso, head, arms, thighs, shins) with pivots, colours from the tint mask | body descriptor / `RIG` {geo, pivots, Lt, Ls, sole, standH} | Pure (uses swimmerGB) |
| 44 | Render targets and shadow map | 1173-1196 | MSAA colour + depth FBO, resolve FBO with texture (for water refraction), 24-bit depth shadow map with compare mode | w,h,samples / FBOs | Pure |
| 45 | Player state, `posePlayer`, `drawPlayer` | 1201-1221 | Root at walker state, lower foot planted via leg extension, torso frame (lean, breath), head yaw, arms, leg chain with pivots | P state, PO pose / matrices | Needs `P.vy` (smoothed ground) |
| 46 | Camera | 1223-1246 | Follow / overview / free presets, Q/E orbit, drag, spring easing, ground-clamp of the eye, basis vectors for picking | input state / cam | Needs `meshY` (free and eye clamp), LIM |
| 47 | `pickGround` and `placeAt` | 1249-1259 | Screen ray to ground (bisection on `meshY`), nearest named place or lake shore | client x,y / [x,z] or place | Needs `meshY`, `lakeSd`, `SNAP.places` |
| 48 | Card text and sketches, `showCard`, `closeCard`, `toast` | 1260-1277 | Six inline SVG sketches with blurbs, hover and arrive cards, "Visited" stamp | place id / DOM | Demo-specific text; generic card machinery |
| 49 | `updatePlaces` | 1278-1285 | Current place name HUD, arrival cards | P position / DOM | Needs places |
| 50 | Input | 1287-1320 | Pointer: right-drag orbit, wheel zoom, pinch, double-click and tap to walk (`goTo` → `planPath`), WASD/arrows/Q/E, Shift run, F recentre, Esc closes panels | DOM events / state | Needs `planPath`, `pickGround` |
| 51 | UI wiring | 1322-1342 | Start card, panel toggles, presets, quality buttons (Low/Medium/High), rain, reduced motion, reverse, sound, volume | DOM / S | Generic |
| 52 | Audio (WebAudio synth) | 1344-1353 | Brown (integrated) noise buffer, lowpass "wind" and bandpass "water" loops, short noise footstep | S.sound / audio nodes | Generic; water loop uses lake/river distance |
| 53 | Minimap and compass | 1355-1374 | Offscreen 160×160 survey sketch (shade, contours every 15 m, water, paths, places), live player arrow and view cone; compass needle rotate | core / canvas | Needs `meshY`, `waterDepth`, flights |
| 54 | `updatePlayer` | 1381-1395 | Input or glide to walker step, yaw turn rate, speed estimate, move/climb blends, phase, footstep on half-cycles, smoothed visual Y (never lags ground by >6 cm) | dt / P | Needs `walkerStep` |
| 55 | `render` | 1396-1446 | Shadow pass, sky, lit pass, water volume pass, scene copy for refraction, rain, final blit; quality-driven pixel ratio and shadow size | state / screen | Needs terrain and water geos |
| 56 | Frame loop | 1450-1462 | rAF loop with clamped dt, places, minimap every 4th frame, compass, water-loop gain, fps sampling, hides loading | none / DOM | Generic |
| 57 | `buildLake` / `buildRiver` | 1466-1477 | Lake: 72×26 rings clipped to shore radius; river: ribbon along the centreline, skipping inside the lower lake | level / geos | Needs `lakeR`, `riverW`, `cx` |
| 58 | HUD, compass, start card, settings, checks, hint (HTML/CSS) | 12-156 | Panels with safe-area insets, 44 px touch targets, reduced-motion and mobile breakpoints, paper-and-ink palette | DOM | Generic UI shell |
| 59 | GB triangle-buffer class (Appendix A, verbatim) | 161-175 | `v`, `tri`, `quad`, `box`, `cyl` (with optional gap), `cone`. Packs pos, normal, colour + 1 float tint mask | calls / arrays `p,n,c` | Pure |
| 60 | Swimmer palette, look and tint packing | 194-216 | `SWIM_SKIN`, `SWIM_HAIR`, `SWIM_LOOK`, six `PALETTES`, `swimPack` (18+ bits per instance), `pickVariant`, `swimmerTint` | rnd / variant {icol, look} | Pure |
| 61 | Body descriptor, `BODIES` presets, `pickBody` | 218-252 | Adult-only parametric body (height, build, shoulders, bust, waist, hips, legs, arms, head, neck, hair, suit). Nine presets plus jitter | rnd / {body, scale} | Pure |
| 62 | `swimmerGB` generator (Appendix B, from swimmerGB3.js) | 254-473 | Builds the adult figure for poses 0-3 with torso ring lofting, bust lobes, hip-to-thigh bridge loops, hair/cap, bun, ponytail. Returns `seat`, `top`, `tris`, `body` | pose, body / GB | Pure. Needs GB (59) |
| 63 | `ATHLETE_F` preset | 477-478 | The one body the game uses: 1.74 m, ponytail, two-piece suit, white cap | none / descriptor | Pure |

Units 1-63 above. Rows 59-63 are the swimmer/body block. Rows 1-58 are the walking valley.

### Units that are the main reuse candidates
- `walkerStep` (16) with CONFIG.player and CONFIG.stairs: slope, wade and step-up rules, plus the slide-back behaviour. This is the most generic piece of game logic here.
- Pose function (22) with the rig/athleteRig (43) and `posePlayer` (45): a walk cycle driven by phase, applied to rigid pieces with pivots. Needs no terrain.
- Camera (46) plus input (50): follow, free and overview presets, spring easing, double-click to walk via `planPath` (20).

## Walking controls (as implemented)
- WASD or arrow keys walk, camera-relative. Shift runs (4.2 m/s vs 2.4 m/s walk). Q/E turn the camera.
- Right-drag orbits (yaw and pitch). Wheel zooms. Two-finger pinch zooms (touch).
- Double-click (or single tap on touch) on ground: `pickGround` then `goTo` → `planPath` → glide along the waypoints. Any key cancels the glide.
- F recentres the camera behind her (follow preset).
- Presets: Follow, Overview (dist 470), Free look (WASD moves the camera focus, not her).
- Esc closes the about card, the settings and checks panels, and the arrive card.

## Start card, HUD, compass
- Start card (`#start`, lines 122-127): "Field station, upper valley". Click "Start walking" or press any movement key to dismiss.
- HUD top-left: place name (from `updatePlaces`), seed.
- HUD top-right: compass (SVG needle rotated to yaw) and survey minimap (canvas), plus Settings and Checks buttons.
- Status chip bottom-left: self-check state from the worker. Preset buttons bottom-right. Hint line bottom-centre.
- Arrival cards: `showCard(id,'arrive')` on entering a named place, stamped "Visited" on repeat; hover cards on desktop.

## Audit / self-test checks (runAudit, lines 697-751, 19 checks)
1. Same seed gives the same terrain hash twice
2. A different seed gives a different hash
3. Height samples are continuous (max step < 4 m per 0.5 m, five transects)
4. Every stair step up is at most one riser (displayed m)
5. Tread depth is at least the spec minimum (0.28 m)
6. Treads snap to the displayed heightfield (top vs ground at tread centre)
7. Mesh under every tread is within reach of the tread foundation
8. Every step has a solid foundation below the ground (0 floating steps)
9. Landings are flat: displayed ground along the landing (<= 5 deg)
10. Landings are flat: terrain mesh in the outer landing (<= 5 deg)
11. Walk route: powerhouse to the lower lake shore (completes, climbs every tread)
12. Walk route: powerhouse to the upper lake service route
13. Walk route: service route to the rim lookout
14. Player stays above the displayed terrain on every route sample
15. No NaN in any position, rotation or height over 60 s of walking and idling
16. Walking does not change the terrain hash
17. Rain never exceeds 1,500 particles
18. Reduced motion turns off easing, rain and shimmer
19. Rain stays off unless switched on in Settings

Results go to the Checks panel and the status chip. The audit runs in a Blob Worker that has its own copy of `makeCore` and `runAudit` (stringified), so it cannot touch the live scene.

## Whimsy features
- Hand-drawn feel: paper palette, dashed survey lines on paths and minimap, stamped "Visited" card, inline SVG sketches for each place.
- Compass needle and minimap view cone (dashed line) that follow the camera.
- Wind-swayed grass in the vertex shader, rain sparkle on the shiny material (mat 2), shimmering water surface and foam.
- Footstep sound on each half stride, water loop volume rises near shore, a pinch of wind noise.
- Breathing offset and idle head sway (`pose`).
- Reduced-motion mode disables easing, rain and shimmer; wind is scaled to 0.35.

## Rendering approach
- Raw WebGL2, hand-written matrix helpers (30), no Three.js, no build step, no eval.
- Flat-shaded, double-sided lit pass with 3×3 PCF shadow map (1024/2048/4096 by quality), sky quad, water as a separate translucent pass that refracts a copied scene texture, rain as line primitives, final blit.
- Terrain is one triangle mesh (NC×NC×2 tris) plus solid strata walls; instanced trees, rocks, gravel and grass; the athlete is 8 cached geos drawn with `uModel`.
- MSAA where the quality level allows (0 / 4 samples).

## Ties to its own terrain generator
Units 3-6, 8-15, 17, 20-21, 24-25, 36-37, 39-42, 46-47, 49, 53, 55, 57 depend on the valley generator. The seam is `makeCore` (26): everything it returns is a closure over the generator, so porting means replacing units 3-6 and 10 with another height function and keeping the rest of the seam.

## Porting notes

### Pure logic (portable as-is, given CONFIG or arguments)
- GB class (59), swimmer palette and packing (60), body descriptor and `pickBody` (61), `swimmerGB` (62), `ATHLETE_F` (63).
- `athleteRig` (43) once it is given an `SC`-consistent body. Pivots are computed from the body, not from terrain.
- `pose` (22), `posePlayer` and `drawPlayer` (45), rain pool (23), M4 (30), `prog` (31), Mesh/makeGeo (35), shaders (32-34), shadow and target setup (44), sky/blit (34).
- Hashes and noise (2), projection (7), pads and bbox (9), `makeFlight` (8, needs CONFIG.stairs and an externally supplied profile), audit harness (27-29) and the check list (its checks are about the demo's terrain, so rewrite them).
- Frame loop, input, UI wiring, audio, HTML shell (51-58).

### Depends on this terrain
- Layout and heights (3-6, 10, 12-15, 17, 19-21, 24-25, 36-37, 39-42, 46-47, 49, 53, 55, 57): demo-specific.
- Powerhouse and lookout builders (38, 41), cards text (48), places (25), `BLD` (18).

### What an integration needs
1. One displayed-height sampler `heightAt(x,z)` (m) plus a grid or triangle-exact `meshY` that matches the drawn mesh. The walker and camera use `meshY`, so they must agree with the mesh. Units 11 and 37 are the template.
2. One water sampler `waterDepth(x,z,g)` returning water level minus ground (m, >0 = wet). Used by `walkerStep` (16), `lineWalkable` (17), the wade rule and terrain colouring. Water level can be a constant plane per lake.
3. A stair hook if the new world has stairs: `stairTop(x,z)` returning tread height or NaN, and a `stairHit` flag. Without stairs, `groundY` becomes `meshY` and `walkerStep` loses the riser branch.
4. `LIM` and `inBld` (or a walkable-area test) for world bounds and solid buildings.
5. `CONFIG.player` and `CONFIG.camera` values as-is. `CONFIG.world.size` and `cell` set the grid.

With those five, the pure units (walker, pose, camera, input, rain, rig, renderer) port unchanged.

## Swimmer body lab (`/Users/db/Documents/projects/dam-game/swimmer-adult-redesign/`)
`swimmerGB3.js` is the adult-only v3 generator with poses 0 T-pose, 1 slide sitting (feet-first, arms up), 2 slide lying back (hands behind head), 3 dive (belly down, head forward). `gb.js` is the GB class it depends on (the game's Appendix A). `index.html` is a standalone WebGL2 viewer with pose buttons, body sliders, presets, palette/look, wireframe, and a remembered setup. `check.js` is a headless Node check (triangle counts, seats, height error, NaN). The embedded Appendix B in the demo matches `swimmerGB3.js` except for one flagged world edit: the `Bd.cap` flag (a white swim cap over any hair style). The standalone lab file does not have that flag, so copying from the lab would lose cap-over-ponytail. The lab README says it is not wired into the game yet. The walking demo uses only pose 0 (the rig is built from the T-pose), so poses 1-3 are unused there.

## Odd things found while reading
1. **No swimming.** The player is called "the station swimmer" and the start card says she is "out on survey". Water is blocked: `maxWade` is 0.06 m, so she stops at the waterline (`walkerStep` returns 2). Poses 1-3 of the swimmer exist but the demo never uses them.
2. `pose()` (line 665) has a dead term: `0.012*move*Math.abs(s)*0`.
3. `CONFIG.player.height` (1.74) is not read anywhere in the code; the rig height comes from `ATHLETE_F.height`.
4. Only `ATHLETE_F` is instantiated. The other eight `BODIES` presets are defined but never used by the demo.
5. Several audit checks are close to tautologies (16 "walking does not change the terrain hash", 17 rain cap, 18-19 flags). They cannot fail unless the code changes shape. The stair and route checks (4-13) are the useful ones.
6. `planPath` runs `lineWalkable` against every chain point on each click (the `near` helper loops the whole chain). Not measured, but this is an O(chain) scan of 0.8 m samples per click.
