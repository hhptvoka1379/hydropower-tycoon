# Render port map: v2 hand-written WebGL2 -> Three.js r187

Scope: Phase 2 of `FABLE_PLAN.md` (flaws C1-C13 of `PROJECT_STATUS.md` 4C). Render-only: nothing here touches `game/sim`, its RNG, saves or the state hash.
Source of truth for line numbers: `game/legacy/v2.index.html` (same numbering as `PROJECT_STATUS.md`). The ranges quoted in the brief are stale; the real ones are:

| Part | Lines |
|---|---|
| GL helpers, matrices, GB/OB/WB builders, `meshFromGB` | 1387-1540 |
| Shader strings `SH.*` | 1402-1500 |
| `World` IIFE | 1545-2444 (init 1556, terrain 1583-1632, scatter 1655-1715, water 1717-1744, dam 1747-1794, powerhouse+penstock+road 1795-1849, assets 1851-1884, survey 1886, cut 1896, slide 1909-2252, build/sync 2254-2273, picking 2275-2314, camera 2316-2338, `setLight` 2342, `frame` 2354-2434) |
| Game loop / boot | 2994-3004 / 3297-3302 |

Vendored three: `vendor/three.iife.js` = 750 KB raw / 191 KB gz, **everything** (`export * from 'three'`), no add-ons. `node_modules/three` is 0.187.0 (REVISION '187'). Facts about r187 that the port depends on (checked in `node_modules/three/src`):
- `PCFSoftShadowMap` is deprecated and falls back to `PCFShadowMap` with a warning; softness comes from `light.shadow.radius` (Vogel-disk PCF, shadowmap_pars_fragment).
- `WebGLRenderer` already registers `webglcontextlost` (calls `preventDefault`, sets an internal flag) and `webglcontextrestored` (re-runs `initGLContext`); it also has `forceContextLoss()/forceContextRestore()`, `compileAsync`, `copyFramebufferToTexture`.
- Vertex colours with `itemSize 4` become `vertexAlphas` (v2 packs a sway weight in alpha; we will not do that, see section 1).
- Matrices are column-major Float32 exactly like v2's `m4*`/`writeYZ`/`writeYX`/`slWrite`; `m4trsY` equals `Matrix4.makeRotationY`. `InstancedMesh.instanceMatrix.array` can be written by the existing v2 helpers unchanged.
- Fog: v2's `1-exp(-(d*uFogD)^2)` is exactly `FogExp2` (density = `uFogD`, 0.00028 default).
- Clip planes: v2 discards where `dot(plane,w) > 0`; three keeps where `n.x + c >= 0`. Convert with `normal = -n`, `constant = n . p0` (v2 stores `clip = [nx,0,nz,-(n.p0)]`).

---

## 1. Feature map

Difficulty: S = under a day, M = 1-3 days, L = more than 3 days or needs a spike/new tooling. "GB" = the existing `GB`/`WB`/`OB` CPU builders (1508-1523). **Strategy for most rows: keep every GB-based builder function untouched and replace only `meshFromGB`/`waterMesh`/`ovMesh` with helpers that return `BufferGeometry` (position, normal, color rgb, and a separate `aSway` float where alpha was used).** That is why most structure rows are S.

Sim-side names below are the public `Sim` API (`game/sim`, same as legacy `createSimModule`): `terrainH(site,x,z)`, `terrainH.shoreF`, `terrainH.sc`, `resLevel(res,V)`, `bowlR(res,h)`, `sunAt(doy,hr)`, `cX/cW/cBed/riverW(cp,z)`, `CONFIG`, `tileRC`. Snapshot fields: `snap.{doy,hour,secInHour,day,year,paused,started,active,climate{T,cloud,rain,wind,wdir,storm,heat,sea},sites[]}`; per site `{kind,seed,layout{up,lo,dir,dam,ph,tail,padY,phDist,parcels},upper/lower{bottom,V,a1,a2,a3,hMax,excav},dam{cls,height,built,raising,crack},penstock{D,L,mat},route[],tiles[48]{solar,wind,battery},parcels[3],turbine/pump{tier},q,spillU,spillL,riverIn,riverOut,envDel,ice,snowpack,valleySnow,sculpt,cp,tel{G,sun,...}}`.

| # | v2 feature (legacy lines) | Three.js construct | Sim data needed | Closes | Diff |
|---|---|---|---|---|---|
| 1 | **Single surface sampler** (new; replaces `hReal`/`hD`/`sampleHeights`, 1583-1587) | Plain JS class `Surface` (section 3), no THREE dependency; its `H` array also uploaded as a `DataTexture` (RG, `FloatType`, `NearestFilter`) for water | `Sim.terrainH(site,x,z)` at the 161x161 grid; level fns for depth | C10 (root cause) | M |
| 2 | Terrain chunks + colouring (`buildChunk` 1612, `terrainCol` 1604, `PAL` 1602, skirt 1628) | 16 `Mesh` chunks, non-indexed `BufferGeometry` (position, normal, **per-vertex colour from height/slope/fbm noise**), `MeshLambertMaterial({vertexColors:true})` + `onBeforeCompile` for snow line, autumn grass tint, wet band, survey contour (`fwidth`), lens desaturate. Triangulation from `Surface.diag(i,j)` (height-driven, not `(i+j)&1`). Skirt = a second small mesh from `strata()`; cutaway faces reuse it | `Surface.H`; `site.layout` for wet-band centres; `snap.doy`, `site.valleySnow` for snow | C3, C10, C6 (frees chunks via scope), C7 (shadow receiver) | M |
| 3 | Shoreline + water surface per reservoir, live level (`buildLake` 1718, `waterVS/FS` 1444-1471, `lakeMasks` 1591) | One faceted jittered grid `Mesh` per reservoir at `position.y = level` (never re-built for level change), `MeshStandardMaterial({transparent:true,flatShading:true,roughness:0.15})` + `onBeforeCompile`: vertex wave (fades with depth), fragment samples the `Surface` height+fill-level texture with the same triangle rule to get **exact depth**, `discard` when depth<=0 or not connected to the lake, foam band by depth, opacity/colour by depth, Fresnel sky mix from a uniform. Connectivity: priority-flood once per terrain edit gives `fillLevel[cell]` (the lowest level at which the cell joins the lake); wet = `fill<=level`. Replaces the build-time mask, and fixes disconnected pockets | `Sim.resLevel(res,V)` + `res.bottom` per frame (cache per sim step, see section 5), `res.hMax`, `layout.up/lo`, `snap.doy` (shallow/deep tint season shift), `s.q` (flow ripple), `s.ice` | C5, C2 (lit, not emissive), C10 | L |
| 4 | River strips (`stripMesh` 1726, `buildRivers` 1740, flow kind 1) | 3 strip `Mesh`es (up / mid / down), per-vertex `aArc` (arc length) and `aSide`, same water material variant with `uKind=1`, `uFlow` per mesh. Y = `cBed - 0.55` today; proposal: `max(Surface.y+0.05, bed + stage(Q))` so stage follows `riverIn` | `Sim.cX/cBed/riverW(cp,z)`, `s.riverIn`, `s.riverOut`, `s.spillU`, `s.envDel` | C5 (partly), C10 | S-M |
| 5 | Dam earth/concrete/arch + raise scaffolding (`damProfile` 1747, `damFrame` 1751, `buildDam` 1757, `damCap` overlay) | GB -> `BufferGeometry` mesh (Lambert), `damCap` as transparent `MeshBasicMaterial` overlay mesh. `damFrame` base y from `Surface.y` (triangle-exact) | `site.dam{cls,height,built,raising{from,to,progress}}`, `upper.bottom`, `CONFIG.res.freeboard`, `layout.dam{arc,span,cx,cz,r,x,z,dx,dz}` | C10, C13 (drawn profile vs sim: decision in section 7) | S |
| 6 | Spill chute (1775-1782, `M.spill`, drawn when `spillU>0.001`, 2412) | Chute geometry derived from **the same `damFace(u)` function** as the downstream face (return `[u, y]` pairs from the profile builder, chute offsets are `face(u)+0.4` along the face normal). Water ribbon = water variant `uKind=1`, `visible` by `spillU>eps`, `uFlow` and ribbon width/alpha scale with `spillU` (continuous, not on/off) | `s.spillU`, `s.spillL`, `dam.height`, `dam.cls` | C11 | M |
| 7 | Penstock (path from `s.route`, saddles, water core; 1838-1844) | Open-top shell GB mesh, saddles from `Surface.y`; `tubeWater` core = water variant `uKind=2`, `uFlow=qn` per frame. Radius = `D/2 * PIPE_EXAG` (named constant), polyline length = sim `L` (see section 7 on who owns L) | `s.route[]{x,y,z}`, `s.penstock{D,L}`, `s.q`, `CONFIG.turbine[tier].Qr` | C10, C13 | S |
| 8 | Powerhouse + switchyard (`phFrame` 1795, `buildPowerhouse` 1797-1844; runners 1821; internal water routes) | GB static `Mesh` (Lambert), roof as separate mesh (hidden in the `turbines` preset), runner `Mesh`es with `rotation.y` driven per frame (`angT/angP`), internal pipe water meshes (variant `uKind=2`). New: `windows` mesh (emissive MeshBasic, night-driven), lamp instances (section 4) | `layout.{ph,tail,padY}`, `s.q`, `turbine/pump.tier`, `CONFIG.turbine/pump[tier].Qr` | C2 (lamps/windows), C10 | S |
| 9 | Tiles: solar arrays (`InstancedMesh` cap 1200), wind towers/nacelles/rotors (`rotors` + feathered `rotorsF`), batteries (1859-1884); `assetSig` 2267 | `InstancedMesh` with `instanceMatrix` written by existing `writeYX/writeYZ`, `instanceColor` for "building" grey, count = number of panels (**allocate 1500+ or grow**, 48 tiles x 6x5 = 1440). Towers/batteries static GB. Solar glow = material `emissive` from `tel.G` | `site.tiles[]{solar{tier,building},wind{tier,rpm,feathered,damaged,building},battery{tier,building}}`, `layout.parcels`, `CONFIG.land.tileSize`, `CONFIG.wind.tiers`, `cl.wdir`, `tel.G` | C10, C12 (instance cap) | M |
| 10 | Scatter: trees x2, rocks, grass, 5 flower meshes (`buildScatter` 1682-1715, `blocked` 1673) | One `InstancedMesh` each (caps 2600/2600/1600/3000/5x700), `instanceColor` for tint, extra `InstancedBufferAttribute` `aPhase` (autumn onset, sway phase). Wind sway via `onBeforeCompile` that replaces `project_vertex` so displacement is applied **after** the instance matrix, in world space, as v2 does (1410), weight in a dedicated `aSway` attribute (not colour alpha); same sway on a `customDepthMaterial` so shadows move. Placement uses `Surface`. Dam raise: re-run `blocked()` over stored instance positions and rewrite matrices (cheap), do not re-sample the whole field | `Surface`, `site.seed`, `site.upper/lower`, `site.dam.height`, `site.route`, `layout`, `site.sculpt.gen.{forest,flower}`, `Sim.cX/riverW` | C8, C10, C12 (not rebuilt after raise) | M |
| 11 | Sky, stars, sun disc, moon (`skyVS/FS` 1477-1487, fullscreen triangle) | Inverted `SphereGeometry` dome that follows the camera, `ShaderMaterial({side:BackSide,depthWrite:false,fog:false})`, `renderOrder=-1000`: smooth 3-stop gradient (zenith/horizon/below-horizon = fog colour so there is no void), dusk band keyed on sun elevation, sun glow. Stars = `Points` (round sprite via `gl_PointCoord`, magnitude-weighted size, twinkle) faded by `night`. Moon = disc in the dome shader with phase terminator, direction from lunar phase (render-side function of `snap.day`, period 29.5 d). Optional fallback: `examples/jsm/objects/Sky.js` | `snap.{doy,hour,secInHour,day}`, `Sim.sunAt(doy,hr)`, `climate.{cloud,storm}` | C4, C7 (sun sets, moon moves) | M |
| 12 | Day-night lighting rig (`setLight` 2342) | `DirectionalLight` key (sun -> moon crossfade through twilight, one shadow map), `HemisphereLight` (sky/ground colours with a night floor), `Fog` -> `FogExp2` with `scene.fog.color` = horizon colour, plus the lamp/torch lights of section 4. Remove the clamp `max(0.08,sun.y)` and the `el>0.02` branch that makes the sun jump | `Sim.sunAt`, `climate.{cloud,storm,heat}`, `snap.day` (moon) | C2, C7 | M |
| 13 | Shadows (3x3 `sampler2DShadow` PCF, 1024/2048, ortho box `ext=clamp(dist*0.75,180,1300)` 2374) | `light.castShadow`, `shadow.camera` ortho resized by camera distance, **texel-snapped target** (snap light position in light space to `2*ext/mapSize`), `shadow.normalBias` in the 0.3-1.5 world-unit range (start at one texel), `shadow.radius` 1.5-2.5, `PCFShadowMap`. Casters: terrain, dam, powerhouse, towers, trees (`InstancedMesh.castShadow` with custom depth material), riders. Off at night unless moon is above 0.2 rad and phase > 0.3 | sun/moon vector | C7 | M |
| 14 | Weather particles (`ptVS/FS` 1488-1495, 1563 seeds, `nP=min(parts,rain*500)`) | `Points` with the same seed buffer + `ShaderMaterial` (`transparent`, `depthWrite:false`), rain streak = stretched sprite in the vertex shader (`gl_PointSize` + fragment `abs(d.x)` discard as v2), snow when `climate.T<0.5`. Add edge fade by distance to the box boundary and recentre the box on the camera target at every frame | `climate.{rain,T,wind,wdir}`, `World.cam` target | C12 (visible box edge) | S |
| 15 | Season tint (`uAutumn`, 2386; mat 1-3 branches 1425-1431) | Uniforms on the shared terrain/vegetation `onBeforeCompile` patch; per-instance onset via `aPhase`; flowers fade by `winter`; snow load = `smoothstep` of `uSnowAmt` on up-facing normals (trees/roofs too) | `snap.doy`, `site.valleySnow`, `site.snowpack`, `climate.T` | C8 | S |
| 16 | Snow and ice (`uSnowAmt/uSnowLine` 1427, `uIce` 1449/1470) | Snow = terrain/instance shader mix (lit, so moon-lit snow works). Ice = same water mesh with `uIce=1`: lighter colour, higher roughness, crack hash, still `MeshStandardMaterial` so it receives the rig (v2 returned flat unlit white) | `site.ice` (>0.5), `site.valleySnow`, `climate.T` | C2, C8 | S |
| 17 | Waterslide + riders (`slideFind` 2022, `slideBuild` 2089, `slideTick` 2212, `riderGB` 1927) | Builders unchanged (GB/WB). Static body `Mesh`, tail `Mesh` rebuilt by the existing `slideTailFill/Meshes`; rider parts = 2 `InstancedMesh` (cap 24), drops (256) and rings (32) `InstancedMesh`; per-frame `slWrite` writes straight into `instanceMatrix.array` and sets `mesh.count`; `setUsage(DynamicDrawUsage)`. Plan cached by signature **and kept across `build()`** (fix C6). Tail rebuild rate-limited (min 2 s and `>0.8 m` level change). Lamps = instanced emissive bulbs | `site.lower.{bottom,V,a1,excav,hMax}`, `Sim.resLevel`, `Surface`, `layout`, `route`, `W.road`, `climate.wdir` (flag), `site.seed` | C6, C10, C12 (tail rebuild rate) | L (search cost is CPU, not GL; port is mechanical) |
| 18 | Parcels + roads (`buildAssets` 1855, road 1846-1849) | **Paint roads, tile pads and the powerhouse apron into terrain vertex colours** (a paint list consumed by the terrain colour pass), so they can never float or clip. Parcel outlines = `LineSegments` sampled every <=2.5 m on `Surface.y + epsilon` (v2 sampled 1/4 tile = ~11 m on bilinear). Build-mode pulse via material `opacity` | `layout.parcels`, `site.parcels[3]`, `CONFIG.land.tileSize`, ph frame | C10 | S |
| 19 | Cutaway / section views (`buildCut` 1897, presets 2328-2338, `cutDirty` 2273) | Per-material `clippingPlanes=[Plane]` + `renderer.localClippingEnabled=true` (cut faces and overlays simply have none). Strata + section water = GB/OB meshes rebuilt by `sync()` **when `|level change|>0.25 m`** (fixes the never-set `cutDirty`) | `Sim.resLevel` both lakes, `W.penPath`, `layout.ph`, `Surface` | C5, C12 (picking vs clip) | M |
| 20 | Picking (`buildPicks` 2276, `makeRay` 2290, `rayTerrain` 2293, `pick` 2294-2306) | Keep the pure-JS pick list but feed it `raycaster.setFromCamera(ndc,camera).ray`: AABBs for dam/powerhouse/bays/tiles/slide, **oriented segment+radius tests for the penstock** (`Ray.distanceSqToSegment`) instead of AABBs, separate roof from bays (priority), reservoirs by plane at live level + `Surface.depth>0`, terrain by `Surface.raycast` (grid DDA, triangle-exact). Reject hits on the clipped side of the plane. Do **not** raycast the 154k-triangle terrain meshes (>5 ms per hover) | `Surface`, `site.tiles`, `layout`, `W.winds/batts`, `Sim.cX/riverW`, `Sim.resLevel` | C12 | M |
| 21 | Camera + presets (`camUpdate` 2318, `flyTo` 2325, `preset` 2328) | `PerspectiveCamera` (fov 0.8 rad = 45.84 deg), the same orbit state `{tx,ty,tz,yaw,pitch,dist,fly}`, `camera.position.set` + `lookAt`. Ground clamp via `Surface.y`. **Adaptive near plane** `clamp(dist*0.02,0.5,8)` (v2 fixed 4). No `OrbitControls` (not in the IIFE, semantics differ). Phase 3 adds a follow camera on the same object | `Surface`, `layout` (presets) | C12 (near-plane clipping) | S |
| 22 | Post (`postFS` 1498: vignette, heat shimmer, storm darkening) and no AA | Low: nothing. Medium: `antialias:true` MSAA on the default framebuffer; vignette as a CSS radial-gradient overlay. High: `EffectComposer` (`RenderPass` -> `UnrealBloomPass` (high threshold, only emissives) -> `OutputPass`), MSAA via `WebGLRenderTarget({samples:4})`; heat shimmer as one `ShaderPass` only while `climate.heat` | `climate.{heat,storm}`, night factor | C7 | M |
| 23 | Quality auto-scaling (`QUAL` 1554, 2433-2434) | `QualityGovernor` (section 5): DPR first, then tier; render-only time; hysteresis and recovery | none (render-side clocks) | C9 | S |
| 24 | Context loss | Listeners in addition to three's own (section 5), `isContextLost()` guard in `World.frame`, toast, recovery test with `WEBGL_lose_context` | none | C1 | S |
| 25 | Selection/hover brackets, shape-your-land zones/brush, survey pins/flood/preview dam, lens highlight `uHi` (2313, 1636-1653, 1887-1894) | `LineSegments`/`Mesh` overlays with `depthTest:false` (brackets, brush) and `renderOrder`; lens highlight = a shared uniform in the `onBeforeCompile` patch; `World.shape.region()` updates **chunk position/colour attributes in place** (`needsUpdate`) rather than rebuilding geometry | UI-side state; `Sim.terrainH.sc.mask` | C6 (slider ticks) | M |
| 26 | Resize / DPR / render targets (`ensureTargets` 1566) | `renderer.setPixelRatio`, `setSize(w,h,false)`, composer `setSize`; no manual FBO management | none | - | S |

Not a feature but required by every row: **resource scopes** (section 5) and a **RenderView** (section 5), a render-only struct built once per sim step from the state instead of the deep-cloned snapshot.

### Colour management decision (affects every row)

v2 does all lighting arithmetic in display space and writes the result directly (no sRGB conversion). First port: `THREE.ColorManagement.enabled=false; renderer.outputColorSpace=THREE.LinearSRGBColorSpace; renderer.toneMapping=NoToneMapping`, so `PAL` and all colour constants keep their meaning and A/B screenshots against v2 are comparable. Revisit (linear workflow + ACES) only after M12 as a grading pass.

---

## 2. Porting order, milestones, proof screenshots

Rule: the legacy renderer stays runnable behind `?renderer=legacy` until M12 so each milestone can be A/B compared from the same save and camera. Every milestone ends with a Browser-pane screenshot batch using a **fixed clock** (`World.debugSetTime({doy,hour})`, render-only, sets the same fields `frame()` reads) and the `__RENDER_AUDIT__` JSON (`renderer.info.render/memory`, `programs.length`, frame ms, quality, `surface.maxMismatch`).

| M | Scope | Proof (screenshot / artefact) |
|---|---|---|
| M0 | Skeleton: `world/` module, renderer init (`antialias:false` for now, `powerPreference:'high-performance'`), scene, camera orbit parity, `ResourceScope`, `RenderView`, context-loss hooks, empty ground plane, `?renderer=` switch, build script producing one HTML | Screenshot: grey slab + orbit at `overview` preset matches v2's framing; audit shows `geometries/textures` constant over resize. Console clean |
| M1 | `Surface` sampler (pure JS, Node test, no GL) | Node test: for 10,000 random points `Surface.y` equals the plane through the 3 vertices of the cell's chosen triangle within 1e-5; DDA ray hits equal brute force; region rebuild equals full rebuild. Debug screenshot: 5k probe cubes placed at `Surface.y` over the terrain from M2 (none float or sink) |
| M2 | Terrain chunks + colours + hemisphere/sun + fog + sky dome (day only) + skirt | Noon overview, classic and canyon, same camera as v2: **no 40 m blocks, no checker diagonals** (C3), smooth gradient sky and fog into the horizon (C4). Close-up crop proving colour variation per vertex |
| M3 | Water: lakes with live level (debug slider drives `V`), shore, pockets, river strips, ice flag | Three screenshots of the same lake at 15%, 50%, 100% fill: shoreline moves smoothly and stays one continuous contour (C5). A canyon screenshot showing a pocket basin **dry** while the lake is lower than its spill. Depth readback test (64x64 grid, shader depth vs `Surface.depth` within 0.02 m) |
| M4 | Dam + spill + penstock + powerhouse + switchyard + presets `dam/turbines/penstock` + dam raise animation | Three preset screenshots; zoom on the chute-to-face junction (C11), pipe saddles on slope (C10, C13), raise scaffold at 50%. Dam foundation row has no gap on a steep abutment |
| M5 | Assets: solar/wind/battery tiles, parcels, roads (painted), build-mode overlay, instance counts | Parcel view with all 48 tiles filled (1440 panels, no truncation, C12) and a close-up of a parcel line crossing a ridge (line hugs the surface, C10) |
| M6 | Scatter + season/snow + sway; dam-raise re-filter | Same camera in 4 seasons (spring/summer/autumn/winter) showing hue variation per tree, snow load, flowers fading (C8). Before/after a 1 m dam raise: no trees standing in the new lake (C12) |
| M7 | Full light cycle: sun/moon motion, dusk/dawn, night rig, lamps + windows, shadows with snapping, lit water and ice, moon phase | Strip of 6 screenshots (06:00, 12:00, 17:30 golden, 19:30 dusk, 00:00 moon, 00:00 winter ice). Metric printed with the shots: mean luminance of water pixels vs adjacent bank at midnight (water must not exceed bank by more than 1.3x), shadow edge stable across two camera nudges of 0.5 texel (no shimmer) (C2, C7) |
| M8 | Weather: rain, snow, storm darkening, optional cloud shadows | Rain at noon and snow at dusk; verify no visible particle box edge when orbiting low (C12) |
| M9 | Picking + hover/select brackets + cutaways + survey/shape modes | Scripted pick test (`__RENDER_AUDIT__.pickProbe()` projects one point per feature to screen and calls `pick`) returns expected types for dam, penstock (not terrain behind it), roof vs bay, each tile, lakes, rivers. Cut view screenshots at two lake levels: the section water follows (C5). Shaping demo: slider drag stays at frame budget (C6) |
| M10 | Slide + riders + tail follow | Screenshot with 8 riders mid-chute + one splash; second shot after lowering the lake 6 m: tail extends and exit tracks the waterline. 50 rebuilds do not re-run `slideFind` (cached) |
| M11 | Post, AA, quality governor, hygiene | AA zoom crop (edges of the dam crest rail) at Medium vs v2; bloom only on lamps at night on High; forced ladder Low/Medium/High screenshots; **50-rebuild leak test** (`info.memory` and `programs.length` flat, JS heap delta <5 MB); **context-loss test**: `WEBGL_lose_context.loseContext()` then `restoreContext()`, screenshots before/after identical, sim keeps ticking meanwhile (C1) |
| M12 | Parity sweep, delete legacy GL (`SH`, `GL`, `m4*`, `mkBuf`, `World.init` GL code), final size check | 6-preset side-by-side contact sheet v2 vs port at noon and midnight; build size line in the log; `window.onerror`-free boot on file:// |

Dependencies: M1 before M2; M3 needs M1+M2; M4+ need M1; M7 needs M2-M4 (something to light); M9 needs M4/M5/M10 meshes to exist (do the slide pick boxes then).
Phase 3 (walking) consumes only `Surface`, `World.water.*` and the light-rig `setTorch` API, so it can start after M3 + M7.

---

## 3. The single surface sampler

### Why v2 disagrees with itself (C10)

Three different heights are used for "the ground":
1. `H` = analytic `Sim.terrainH` sampled at 161x161 (CELL = 10 m), `VEX = 3` applied late (`hD = hReal*VEX`, 1585).
2. The **mesh** triangulates each cell with a diagonal flipped on `(i+j)&1` (1616), so its true height inside a cell is piecewise planar on those triangles.
3. Everything placed on it (trees 1695, flowers 1713, roads 1848, parcel lines 1856, pipe saddles 1842, tile centres 1863, slide posts 2071) calls **`hD` = bilinear**. Bilinear and the two triangulations differ by up to ~0.25 x (second difference) x VEX per cell, which at 3x exaggeration is the metres of float/clip described in C10. `blocked()`/scatter classify on `hReal` and place on `hD` (two interpolators again); water vertices store the bilinear height as `aAux.x` and the shader divides by 3 (`d = uLevel/3 - aAux.x`, 1449) so the shoreline is a linearly interpolated contour of 10 m vertices.

### Design

One object, built once per site/terrain-edit, owns the numbers; **mesh, shader, placement, walking, water depth, picking and camera all read it**.

```
class Surface {
  N=160; size=1600; x0=-800; cell=10; VEX=3;       // constants live here only
  H   : Float32Array((N+1)^2)   // DISPLAY heights = Sim.terrainH * VEX, computed once
  D   : Uint8Array(N*N)         // diagonal per cell: 0 = split 00-11, 1 = split 10-01
  fill: Float32Array((N+1)^2)   // per reservoir: spill level at which the vertex joins the lake (priority-flood)
  version : int                 // bump on any change

  diag(i,j): rule on the 4 corner heights: |h00-h11| <= |h10-h01| ? 0 : 1  (tie -> 0)
  y(x,z)                        // exact height on the drawn triangle  <- THE ground
  yReal(x,z) = y/VEX            // for sim-metre comparisons (uniform scale, exact)
  normal(x,z,out), slope(x,z)   // from the same triangle
  raycast(ray, tMax)            // grid DDA, triangle-exact; returns {t,x,y,z,i,j}
  depth(x,z,levels)             // max over lakes/river of (waterLevel - y)  (uses y, not floorY)
  floorY(x,z) = max(y, floorProviders...)   // walk surface: dam crest walkway, stairs, slide platform, powerhouse floor
  addFloorProvider(fn) / removeFloorProvider(fn)
  rebuildRegion(bbox)           // partial terrain edit (shape mode, excavation); returns touched chunk ids
}
```

Rules that keep everything consistent:
- **One triangulation rule, two implementations of it**: the CPU `diag()` above builds the chunk index/vertex order *and* answers `y()`; the water/terrain GLSL recomputes the same rule from the same four texels of the uploaded height texture. Ties are equal-by-construction (same float32 inputs); in the tie case the two triangulations are within float noise of each other.
- **Placement uses `terrainY` only** (`Surface.y`), never `floorY`: trees, rocks, roads, saddles, tile pads, posts.
- **Walking uses `floorY`**. Player feet cannot float/clip because the drawn triangle *is* the sampled triangle. Stairs/decks register as floor providers (the free-roam demo's `groundY=max(meshY,stairTop)` is exactly this shape, `game/reference/freeroam/index.html` 614).
- **Water depth uses `y` + the live level**: `depth = level - y`. `World.water.surfaceAt/depthAt` (Phase 7) are thin wrappers. Same value as the shader's per-fragment depth (verified by the readback test in M3).
- **Exaggeration is one constant** (`VEX`), applied exactly once, in `Surface.H`. Any object with a sim-metre height (dam crest, water level, route y) goes through `Surface.toDisplayY(simY)`; no module multiplies by 3 on its own (v2 does it in ~30 places: 1612, 1741, 1759, 1839, 1946, 2218, 2299...).
- **Roads, parcel borders, tile pads are painted into vertex colour** (terrain colour pass takes a paint list) or sampled every <=2.5 m on `Surface.y + 0.05`, so they follow the drawn triangles.
- Scatter slope test uses `Surface.slope` and height uses `Surface.y` (v2 classifies with `hReal` and places with `hD`).
- **Cell size is a parameter.** The tailrace trench (6-14 m wide) and the powerhouse pad edge are under-sampled at 10 m. Spike at M1: N=160 non-indexed (154k verts, ~5.5 MB, per-triangle colours = current low-poly look) versus N=320 **indexed** + `flatShading:true` (102k verts, ~2.5 MB, colours become per-vertex gradients). Sampler API does not change; only `N` and the geometry builder do.

Cost: `Surface.y` is ~12 flops; `raycast` DDA ~150 cell visits worst case vs v2's 1400-step march; `rebuildRegion` re-samples `Sim.terrainH` only in the box (as `sampleHeights/region` do today, 1587/1646).

### Verification (acceptance for C10)

- Node: `y()` equals the planar interpolant for all cells; `raycast` equals brute force over triangles.
- Browser pane: 200 `THREE.Raycaster` rays straight down at random points against the terrain meshes (build-time debug only): `|hit.y - Surface.y| < 1e-3`.
- Visual: the M1 probe-cube screenshot; M5 parcel-line-over-ridge screenshot.

---

## 4. Night lighting plan

Problem inventory (C2): night sun colour `(0.1,0.12,0.18)` and hemisphere `0.06-0.12` make land near black while the water body colour is a constant (`uDeep`) and ice is flat unlit white, so lakes and ice are the brightest objects; nothing is lit by the plant itself.

### Rig (all constant-count so shaders never recompile at dusk)

| Light | Config | Role |
|---|---|---|
| Key `DirectionalLight` (only shadow caster) | direction = sun, crossfading to moon while sun elevation goes from +0.05 to -0.10 rad; intensity = day curve, then moon curve; colour warm -> cool; **no** direction clamp, no jump | sun/moon, shadows |
| `HemisphereLight` | sky colour and ground colour interpolate to a **night floor**; target: night terrain luminance ~8-12% of noon so silhouettes, snow and dam read | ambient fill |
| Moon | direction from lunar phase function of `snap.day` (render side); intensity = phase x clamp(elevation); colour (0.55,0.62,0.85) | moon shadows when elevation>0.2 and phase>0.3 (same key light) |
| 3 pooled `PointLight`s | warm (1.0,0.82,0.55), `distance` 60, `decay` 2, intensity 0 by day. Each frame assigned to the 3 lamp instances nearest to the camera target (or player), position smoothed | real light pools near the action |
| Torch `SpotLight` | colour (1.0,0.86,0.62), `angle` ~0.55 rad, `penumbra` 0.7, `distance` ~55 display m, `decay` 1.6, no shadow (optional 512 shadow on High); `target` ahead 10-14 m and pitched at the ground | player cone (Phase 3 attaches to the avatar) |
| Torch halo `PointLight` | `distance` ~7, low intensity | radius ~5-6 m of light around the feet so you never stand in black outside the cone |

Light count: 1 key + 1 hemi + 3 point + 1 spot + 1 halo = 7. Low quality drops the 3 pooled points (emissive only) and keeps the torch (gameplay). Intensities are always set, never `visible` toggled, to avoid recompiles; pre-warm with `renderer.compileAsync(scene,camera)` at boot. Phase 2 delivers `LightRig.setTorch({pos,dir,on})` and tests it with a debug torch that follows the camera target; Phase 3 binds it to the avatar.

### Fixed lamps and glows (no dynamic light needed)

- Emissive lamp **bulbs** (`InstancedMesh`, `MeshBasicMaterial`, colour x `night`): powerhouse yard x4, dam crest every ~20 m, service road every ~40 m, switchyard, slide (existing `slideLamp`), wind-turbine aviation lights (red, 1 Hz blink), battery LEDs.
- **Powerhouse windows** emissive quads: night x (0.6 + 0.4 x plant running, from `s.q != 0`).
- Additive **glow sprites** (camera-facing instanced quads, soft radial texture, `depthWrite:false`) on each bulb, and additive **ground pools** (quads conformed to `Surface.y + 0.05`) so crest and road read as lit without any real light.
- Optional bloom (High only) makes only emissives bloom (threshold ~0.9); glow sprites give the same impression on Low/Medium.

### Water and ice are lit, not emissive

- Water and ice use `MeshStandardMaterial` + `onBeforeCompile`: base colour multiplies the whole rig (hemisphere floor, moon, lamps, torch); specular glints come from moon, lamps and torch for free; the Fresnel sky reflection mixes a `uSky` uniform that is the *current* sky colour (dark at night). `uDeep/uShallow` are albedo, never added after lighting.
- Ice: albedo pale blue-white, roughness 0.3, lit, with crack hash. Snow likewise lit.
- Acceptance: the M7 luminance metric (water <= 1.3x adjacent bank at midnight; ice <= adjacent snow).
- Rain particles near the torch get a colour boost within a radius uniform (cheap lit-looking rain).

### Backdrop

Fog colour = sky horizon colour at all times; dome nadir colour = fog colour; optional big dark "table" disc beneath the 1600 m skirt so the slab never floats in a void at night (C4).

---

## 5. Resource hygiene

### Scopes

- `ResourceScope`: `track(obj)` registers any `BufferGeometry`, `Material` (non-shared), `Texture`, `InstancedMesh`, `RenderTarget`, returns it. `scope.dispose()` removes meshes from their parent, calls `.dispose()` on everything tracked, clears the list.
- One scope per feature group: `terrain`, `skirt`, `water`, `river`, `dam`, `powerhouse`, `assets`, `scatter`, `slide`, `cut`, `overlays`, `survey`, `shape`. Partial rebuilds (`rebuildRegion`, `sync` dam/asset signature changes) dispose only their scope. `World.build` disposes all, then rebuilds. This fixes C6's 16 leaked chunk meshes (~8 MB per build) structurally.
- Shared long-lived registries (never disposed on rebuild): the palette materials (Lambert, Standard water, rider/glow/ring basics), unit geometries (glow quad, sphere for moon), the star `Points` buffer, noise textures. Disposed only on page unload / `World.destroy()`.
- Keep CPU-side arrays on every `BufferAttribute`/`DataTexture` after upload (do not null `array` or use `onUpload`): three re-uploads from them after a context restore.
- No per-frame allocation in `World.frame`: preallocated `Vector3/Matrix4/Color/Plane`, uniforms mutated through `.value`, instance arrays written in place, `Raycaster` reused (v2 already aims for "allocation-free", 2340).

### Context loss / restore (C1)

- three already `preventDefault`s and re-inits GL state on restore. Our additions on `renderer.domElement`: `webglcontextlost` -> `World.lost=true`, skip `renderer.render` and every GL touch, keep the sim loop running, toast "Graphics context lost, recovering"; `webglcontextrestored` -> `World.lost=false`, reset the quality governor's EMA (shader recompile hitch), force one full uniform refresh, toast off.
- `World.frame` begins with `if (gl.isContextLost()) return;`.
- If no restore within 5 s, show the "3D view unavailable" panel that already exists (`#nogl`, 3297) with a "Try again" button calling `renderer.forceContextRestore()`; last resort recreate the renderer on a fresh canvas and `World.build`.
- Test (M11): `WEBGL_lose_context.loseContext()` + `restoreContext()` from the Browser pane; screenshot before/after must match, `renderer.info.memory` consistent, no console errors; also test loss during a rebuild.
- `document.visibilitychange`: skip render while hidden; on return reset EMA (v2 already ignores hidden frames for quality, 2433).

### Quality governor (C9)

v2 averages `max(ft, dtReal*1000)` where `ft` is only the CPU submit time and `dtReal` includes the sim's 40 ms budget (2990), so at high speed it drops after ~4 s and never recovers. New rules:
- Measure `renderMs = (rAF interval) - simMs` where `simMs` is the measured time of `simTick` that frame (clamped at >= CPU submit time). Optionally use `EXT_disjoint_timer_query_webgl2` when present (not Safari/Firefox) for true GPU time.
- Ignore frames: `document.hidden`, first 60 frames after build/resize/quality change/context restore, `dt>100 ms`.
- Levers in order: DPR in steps (2 -> 1.5 -> 1.25 -> 1 -> 0.85), then tier (High -> Medium -> Low).
- Drop when EMA > 22 ms for 2 s; **raise** when EMA < 11 ms for 8 s, at most one change per 10 s, never raise twice within 60 s after a drop that was reversed (anti-flap). Governor state exposed in `__RENDER_AUDIT__` and the F2 debug overlay.
- Quality ladder: Low = no shadows, no flowers, no post, DPR 1, particles 300, no pooled lamps. Medium = shadow 1024, MSAA, DPR<=1.5, particles 800. High = shadow 2048, composer + bloom + MSAA RT, DPR<=2, particles 1500.

### Render view (cuts the snapshot cost, part of C9)

`getSnapshot()` deep-clones and freezes the whole state at up to 20 Hz (2962). The renderer should not use it. Define `RenderView` filled once per sim step (or on dispatch) from `Engine.state` with plain scalars: `doy, hourFrac, day, paused, started, climate scalars, per active site: upperLevel, lowerLevel (= bottom + Sim.resLevel(V), computed once, Newton is 40 iterations), q, spillU, spillL, riverIn, riverOut, envDel, ice, valleySnow, tel.G, tile/parcel/dam signatures`. Between sim steps interpolate levels and angles (render time vs sim time) so a fast clock does not stair-step the water.

### Leak acceptance (M11)

50 consecutive `World.build()` + 20 `rebuildRegion` + 10 dam raises: `renderer.info.memory.geometries/textures` and `info.programs.length` equal to the first-build values (+/-0), JS heap (Chromium `performance.memory`) growth <5 MB after a GC.

---

## 6. Bundle size

Measured with esbuild 0.28.2 against `node_modules/three` 0.187.0 (minified IIFE, `NODE_PATH` resolution):

| Bundle | Raw | gz |
|---|---|---|
| `vendor/three.iife.js` as shipped (`export * from 'three'`) | 750 KB | 191 KB |
| Named imports only: renderer, scene, camera, Mesh, InstancedMesh, Lambert, Standard, ShaderMaterial, lights, Fog, Points, Raycaster, DataTexture, geometries, math | 558 KB | 138 KB |
| Minimal subset (renderer, Mesh, InstancedMesh, Standard, DirectionalLight, BufferGeometry, Raycaster) | 541 KB | 135 KB |
| Named subset + `EffectComposer, RenderPass, UnrealBloomPass, SMAAPass, OutputPass` | 623 KB | 178 KB |

Reading: the renderer core (shader chunks, programs, state) is ~540 KB and cannot be shaved; tree-shaking buys ~190 KB raw over the full IIFE, add-ons cost ~65 KB (SMAA includes embedded lookup data; FXAA is far smaller).

Projection for the deliverable: three ~560-620 KB + sim/UI/builders ~330 KB (v2's 394 KB file minus ~60 KB of hand-written GL, matrices and shaders that are deleted) = **~0.9-1.0 MB**, inside the 1.5 MB target and far inside the STOP-AND-ASK line at 3 MB.

Recommendations:
1. **Do not inline `vendor/three.iife.js` for the shipping build.** Import named symbols from `'three'` in the app entry and let esbuild tree-shake into the one app IIFE. Reasons: smaller; add-ons from `three/examples/jsm/...` import the module `'three'`, so they would load a **second copy** of three if the vendored IIFE was also present (instanceof checks and shader caches break). Keep `vendor/three.iife.js` only as a convenience/offline reference and for quick experiments in the Browser pane.
2. Never write `import * as THREE` or `export *` in app code (kills tree-shaking). Add a lint check in `build/bundle.mjs`.
3. Output stays a **classic script**: `format:'iife'`, `target:'es2020'`, no `type="module"`, no dynamic imports, works from `file://`. The existing `safe()` helper that escapes `</script` is still required for the inlined bundle.
4. `minify:true` for the release bundle (the current skeleton sets `minify:false` for the app); keep an unminified `dev` mode with sourcemap-less readable output. `legalComments:'none'` is fine **provided** the MIT notice banner for three stays in the file (the vendor script already carries it; add the same banner to the tree-shaken bundle).
5. Gate every add-on with `esbuild --metafile` and a budget line in the build log; fail the build above ~1.5 MB (warn at 1.2 MB). Prefer `FXAAPass`/MSAA to SMAA if size matters; do not import `OrbitControls`, `Water.js`/`Reflector`, `Sky.js` unless chosen.
6. Do not import `three/webgpu` or `three/tsl` (large, unused).
7. `sim/*.js` purity check (`checkSim`) must keep forbidding `THREE|document|window|Math.random` under `game/sim`; the renderer lives under `game/world`.

---

## 7. Risks and open questions

**Risks**
1. **Water material complexity.** Standard material + `onBeforeCompile` (wave vertex displacement, height-texture shoreline, connectivity, foam, flow variants for river/pipe/chute/slide) touches `begin_vertex`, `normal_fragment_begin`, `opaque_fragment` chunk strings. Pinned at 0.187.0 so it is stable, but it is the single largest item. Fallback: fully custom `ShaderMaterial` plus a small light-uniform block (key, hemi, torch cone, 3 lamps) copied from the rig; costs night realism work but isolates from chunk changes.
2. **Shadow quality**: no `PCFSoftShadowMap` in r187; 2048 map over a 1600 m scene is 0.3-0.6 m/texel at overview, coarse close up (C7 small shadows vanish). Needs target-following ortho box, texel snapping, `normalBias`, `radius`; may need a second near cascade (CSM add-on, ~+size) for the walking camera in Phase 3.
3. **Transparency ordering** (water, glow sprites, overlays, particles, ice) needs explicit `renderOrder`; instanced vegetation is opaque (no alpha cards) so fine.
4. **Wind sway with instancing + shadows** needs the `project_vertex` replacement plus a matching `customDepthMaterial`; easy to get wrong silently (shadows don't sway).
5. **Per-triangle colours vs indexed meshes** decision (section 3) affects look; spike early, do not change after M2.
6. **Slide search CPU cost** (`slideFind` up to ~46k candidates per PROJECT_STATUS C6, cost not measured here) is untouched by the port; first build can hitch. Cache by signature; consider `requestIdleCallback` chunking or a deferred build after first paint.
7. **Programs and compile hitches**: first frame compiles ~10 programs (Lambert, Standard water variants, depth variants for instanced sway, sky, points, overlays). Use `compileAsync` behind the start screen; keep light count constant; avoid material flag toggles at runtime (e.g. do not flip `transparent`, `fog`, `flatShading` per frame).
8. **Headless/Browser-pane verification**: software GL (SwiftShader) is slow and may lack `EXT_color_buffer_float` / timer queries; composer/bloom paths need a fallback (`UnsignedByteType` RT) and must be tested there.
9. **Screen-space refraction dropped**: look differs from v2 near shorelines (v2 samples the opaque scene with a normal-based offset, 1464). Replacement uses exact depth, which is arguably better, but expect art re-tuning.
10. **Sim/drawn mismatch persists** unless Phase 1 fixes it: A7 (`V(h)` 14-30% below drawn volume on procedural upper lakes) means the live-level shoreline will not match the sim's `resArea`. The renderer should not hide this by cheating the level.
11. Picking relies on custom proxies; any new object must register one (document the contract), otherwise it is unclickable.
12. Two interpolators survive on the GPU side if someone samples the height texture with `LinearFilter`; keep it `NearestFilter` + the shared GLSL triangle function.

**Open questions (for Fable / the user)**
1. **VEX**: keep the 3x terrain exaggeration? The walking player (1.7 m avatar), slopes and slide are all displayed on exaggerated ground, and C13 says dam profile and penstock radius are drawn ~3x off the sim. Either exaggerate uniformly and rescale the avatar/stairs, or reduce to ~1.5-2x. Needs one decision before M1 (it is a single constant in `Surface`).
2. **Sim `penstock.L`** vs drawn polyline: should the sim take `L = polyline length` (render and sim agree by construction) or keep `classicL=300` and stretch the drawing? (C13)
3. **Terrain resolution** N=160 non-indexed (current look) vs N=320 indexed+flatShading; one low-poly style only, per FABLE (drop the 3x3 style matrix, so the `uStyle` branches 1410, 1426-1438, 1483-1484 are deleted rather than ported).
4. **Dam profile**: draw the sim profile (shallower) or keep the steeper drawn one as documented exaggeration (C13)?
5. **Post at launch**: is bloom a requirement for Phase 2, or only MSAA + glow sprites? (changes the High tier definition and +65 KB.)
6. **Moon**: render-side lunar phase from `snap.day` (no sim change) is the proposal; acceptable?
7. **Does `Sim.sunAt` need an hour-of-day continuous input** (it takes `hour + secInHour/3600` already, 2342) and should the sun/moon cross-fade be driven by `tel.sun` per site or one global value? Proposal: one global value from the active site.
8. Is the **"Try again" recovery panel** copy acceptable for context loss, given the cozy tone?
9. **Walking player and `World.water`**: Phase 7 asks for `surfaceAt/depthAt`; confirm they should be backed by `Surface`+levels (this note's design) rather than a separate water sampler.

**v2 render features with no direct Three.js equivalent**
- Screen-space water refraction/distortion sampling a framebuffer copy (1464): three has nothing for arbitrary forward materials; replaced by depth-tinted alpha blending (exact depth is known). `renderer.copyFramebufferToTexture` could restore distortion if art wants it.
- Hand-rolled 3x3 hardware PCF with per-slope bias (1434-1435): replaced by three's fixed Vogel-disk PCF; look and tuning knobs differ.
- Fullscreen-triangle post that applies vignette and heat-shimmer without a composer: vignette becomes CSS; shimmer needs an `EffectComposer` `ShaderPass` (High only) or is dropped.
- Everything else (instancing with attribute divisors, per-mesh clip opt-out, point-sprite particles, procedural sky, flow-by-arc-length water, GL_LINES overlays, per-instance tint) maps to a standard construct as listed in section 1.
