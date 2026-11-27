# world-features agent state (paused by the owner)

Status: round 1 accepted (tiles, scatter, weather, paths, 149 tests). Round 2 (budget + desk + debug seams) is NOT applied yet to any feature;
only additive helpers landed. All files valid: npm test 150/150, npm run check green, npm run build 0.79 MiB.

## Done and verified (round 1, unchanged behaviour)
tiles.js, scatter.js, weather.js, paths.js, index.js (FEATURES = paths, tiles, scatter, weather), plus pure helpers geom, models, layout, ribbon,
placement, envread, pathsnorm, stairs, inst, hash, palette, stations-link, three-util. Tests: game/tests/features.test.mjs (13 tests).
Tile pick: tiles feature pick(origin, unitDir, tMax) -> {type:'tile', parcel, tile, t}. Storm hook: env.stormDarken / world.weather.darken.

## Round 2 helpers already added (additive, unused so far)
- geom.js: GB.triC (per-vertex colour, winding normal, for double-sided blades/quads).
- ribbon.js: ribbonStrip opts.two = 2-column strip (2 triangles per row).
- inst.js: writeRow(a,k,x,y,z,roll,pitch) = T*Rz(roll)*Rx(pitch) for merged panel rows.
- three-util.js: staticFrom() (count-1 InstancedMesh, identity matrix, instanceColor, receiveShadow always true); meshFrom kept for old callers.

## Current triangle counts (classic start, before round 2) - target is total <= 90k
- scatter ~215k (conifers 3000 x 38-59, rocks 800 x 80, tufts 4500 x 7, flowers 1500 x 16) -> target <= 60k
- paths strips 13.6k + stairs 5.9k (classic); canyon 9.0k + 1.6k -> target strips+stairs <= 8k
- tiles: panel 54 + pole 10 per panel (worst 1440 panels ~92k) -> target worst <= 30k
- programs: scatter (one cache key per variant + depth variants), tiles/paths lambert static + instanced, LED/beacon basic, weather x2 -> target <= 4 total

## Remaining, in order (design decided, nothing half-written)
1. models.js: conifer 2 variants (4 tiers x6 seg = 24 + trunk 6; fir 3 tiers x7 = 21 + 6), 8-tri cone impostor, rock = 20-tri displaced icosahedron (one geometry, per-instance xyz squash),
   tuft = 2 crossed trapezoid quads (4 tris), flower = tuft + small crossed head quads (head colour index in aRand.w, recoloured in shader where vertex colour is near white),
   panel ROW geometry (n panels x 10-tri 5-face boxes), 3-sided 6-tri poles, 8-seg towers, 17-tri nacelle, 12-tri rotor, 24-tri container, 2-tri LED quad, lighter crane,
   new kiosk desk (roof, notice board, counter, painted block letter A/B/C from thin boxes).
2. placement.js: CAPS conifer 1500, rock 300, tuft 1200, flower 400; 2 conifer variants; update tests (variant counts, caps).
3. layout.js: tile rows (one slab per row of 3-6 panels with pitch + roll following the ground, 3 poles per row) replacing per-panel layout; keep logical panel count 3x16x30 in the test.
4. scatter.js: 3x3 spatial chunks, per-chunk full / impostor meshes switched per frame by distance to the camera (full < 150 m, impostor < 900 m, rocks < 700, tufts < 130,
   flowers < 160), computeBoundingSphere, frustumCulled true; ONE program for all scatter (DoubleSide, uFlower uniform instead of per-kind code, shadowSide = BackSide, no custom depth material);
   only full-detail conifer meshes and rocks cast shadows.
5. tiles.js / paths.js: use staticFrom for all static meshes (one shared lambert instanced program), LEDs as 4 emissive InstancedMeshes by state + beacon mesh (no MeshBasic),
   pads 4x4 cells, borders opts.two; paths: Douglas-Peucker simplify chains then densify to 4 m, 2-column strips, stairs 8 tris per tread (no back face), 3-sided rails.
6. Desk: kiosk offset 2.6 m from the station toward the parcel centre (player stands at the station), pick {type:'desk', parcel, station:'desk'+(p+1)};
   push desk and crane footprints into world.blockers (world removes them on rebuild). pick() must NOT return whole-tile boxes (they occlude the camera, player uses pick for occlusion):
   only tower, container, crane and desk boxes; empty-tile resolution stays pickGround(x,z) on the terrain hit.
7. Weather: single ShaderMaterial program for rain and snow (uMode uniform, same source for both); particle offsets accumulated in JS as normalised fractions (uOff) so there is no time wrap pop;
   snow sway time wrapped at 2*pi*10 s. Scatter uTime unwrapped.
8. Debug seams in envread.js (shared override state): feature.debugWeather({rain, snow, wind, windDir, storm} | null) and feature.debugSeason(doy | null), exposed on every feature object.
9. Tile construction progress: site state does not expose jobs (they are game.state.jobs, j.p.tile, j.rem/j.total); keep crane + tape, optionally read env.jobs if the world adds it.
10. Update features.test.mjs (rows, caps, variants, two-column strips), run npm test / check / build, report with the before/after triangle table.

## Files changed this round
geom.js, ribbon.js, inst.js, three-util.js (all additive). Nothing else.

## Test status
npm test 150/150, npm run check OK, npm run build OK (828844 bytes).

# UPDATE (second pause) - all files valid: npm test 151/151, check OK, build OK (833371 bytes)

## Done since the first state note
- models.js rewritten to the round-2 recipes: panelRowGB (10-tri slabs per row), 6-tri poles, 28-tri towers, 22-tri nacelle, 12-tri rotor, 24-tri container, 2-tri LED quad,
  kiosk deskGB (deck, posts, gabled roof, notice board, counter, sign post with block letter A/B/C, ~250 tris), 68-tri crane, 2 conifer variants (30 / 27 tris) + 8-tri impostor
  (coniferImpGB, not used yet), 20-tri rock, 4-tri crossed-quad tuft, 8-tri flower (head vertices near-white; shader recolour by aRand.w NOT written yet).
- layout.js: rows (one slab per panel row, pitch + roll, 3 poles), L.panelCount, L.crane, assetBoxes() = narrow pick proxies (tower, container, crane); tileBoxes/boxesFromLayouts removed.
- tiles.js rewritten: all static meshes via staticFrom (shared lambert instanced program), row meshes per (per, pitchX) group, LEDs as 4 emissive InstancedMeshes by state,
  beacon + optional progress column from env.jobs (kind 'build', p.tile, rem/total, site id), kiosk desks 2.8 m beyond the station with pick {type:'desk', parcel, station:'desk'+(p+1)},
  crane + desk footprints pushed into world.blockers (removed on dispose), pick() only returns tower/container/crane/desk boxes, pickGround(x,z) kept.
- placement.js: CAPS 1500/300/1200/400, 2 conifer variants. scatter.js: adapted to the new models only (still ONE mesh per variant, no chunks, still per-variant shader keys).
- Debug seams: not needed, world.js already wires debugWeather/debugSeason into env (env.wind, rain mm/h, snow, windDir, T, doy).
- features.test.mjs updated (rows, assetBoxes, caps, 2 variants).

## Triangles now (classic start; canyon similar)
scatter 55.6k (was 215k) full detail, no LOD yet; tiles 3.6k (canyon test site 5.1k; worst case 48 tiles T3 ~ 1440 panels = 144 rows x 60 = 8.6k + poles 2.6k + ground ~5k ~ 22k);
paths strips 13.9k (unchanged, still 3-column 1.1 m sampling) + stairs 2.3k (old 10-tri treads); weather 0.

## Remaining, in order
1. paths.js/pathsnorm: Douglas-Peucker simplify + densify to 4 m, ribbonStrip opts.two, stairs 8 tris/tread (no back face) and 3-sided rails, staticFrom for all meshes,
   night dimming of the strip (mStrip.color.setScalar(1 - 0.6*env.night), darker albedo PAL.trodden*0.8) -> target strips+stairs <= 8k.
2. scatter.js: 3x3 chunks, full/impostor meshes switched per frame by camera distance, ONE program (DoubleSide, uFlower uniform, shadowSide BackSide, no custom depth material,
   flower head recolour by aRand.w, rocks as one geometry with per-instance xyz squash, flowers as one mesh) -> target <= 4 programs total.
3. weather.js: single ShaderMaterial program for rain + snow (uMode), normalised accumulated offsets (no time wrap pop).
4. Re-run tests, check, build; report with the before/after triangle and program table (programs not yet reduced: scatter still has one cache key per mesh type).
