# Visual critique: low-poly hydropower game (v2 snapshot 2026-11-13)

Screenshots: `/private/tmp/claude-501/-Users-db--claude-spares-spare-VPcXbo/58c63371-dc97-4bd1-a0de-236fee5a8208/scratchpad/critic/`
(all file names below are relative to that folder). Captured with Playwright + SwiftShader at 1280x800. Classic map (demo mode) and one canyon map. A few shots were taken with the HUD hidden via injected CSS. Time was fast-forwarded with `Game.runHeadless`.
Note: SwiftShader auto-dropped quality to "Medium" in the canyon game, so some fine detail (grass density, shadow resolution) may be better on a real GPU.

Rating key: **critical** = breaks the look or reads as a bug; **noticeable** = a player would see it within a minute; **nitpick** = polish.

---

## 1. Sky & light

| # | Issue | Rating |
|---|---|---|
| 1.1 | **Sky is a flat beige/grey fill with no sun, no moon, no clouds and no gradient.** `03_overview_spring_h12.png`, `04_season_day100.png` (whole upper third of the frame) is one flat colour. At noon it is the same dull taupe as at dawn (`03_overview_spring_h06.png`), so there is no time-of-day sky mood. Cloud cover (0 to 1) and storms never change it. | **critical** |
| 1.2 | **The horizon is a visible cut-off.** `20_horizon.png` and `66_canyon_cliff.png` show a pale beige ground plane, then a hard-edged grey-blue band across the top that looks like a dome seam. `68_canyon_horizon.png` and `68_canyon_edge.png` show the map as a floating slab in an empty beige void, with a hard vertical grey wall for the skirt. There is no distant mountain ring, haze layer or fog fade into the sky. | **critical** |
| 1.3 | **Night is almost black and the lakes glow.** `03_overview_spring_h19.png`, `h02.png` and `71_night_lake.png`: terrain, trees and structures drop to near-black while water stays bright teal, as if emissive. Water brightness does not follow the sky. There is no moonlight, no cool ambient fill, no star gradient, and no lights on the powerhouse, dam crest, wind turbines or road (`71_night_ph.png` is a black void). | **critical** |
| 1.4 | **Stars are tiny square white pixels**, a few of them (`70_dusk_lake_lowangle.png`, `72_dawn_lake.png`). They look like dead pixels, not stars. | nitpick |
| 1.5 | **Dusk and dawn have no warm or cool colour shift.** `03_overview_spring_h06.png` is only slightly pinker. There is no orange sun-side rim, no long golden light on slopes, and no coloured fog. The dusk frame (`70_dusk_lake_lowangle.png`) goes straight to a dull mauve with green-black ground. | noticeable |
| 1.6 | **Lighting is flat at midday overview.** Hill shading is mostly per-face tint with little form; shadows are soft, low-contrast and only visible close up (wind turbine shadows in `32_wind_parcel2_close.png` are good, forest shadows at overview are barely there). No ambient-occlusion look in the valley or under trees, so forests read as dark blobs sitting on grass. | noticeable |
| 1.7 | **No cloud shadows** drifting over terrain, no god rays, no sun glint on water. | noticeable |

## 2. Terrain & rocks

| # | Issue | Rating |
|---|---|---|
| 2.1 | **Repeating diamond/checker pattern across all grass terrain.** Every overview in spring/summer/autumn (`03_overview_spring_h12.png`, `04_season_day100.png`, `04_season_day140.png`) shows light/dark diagonal tile blocks, like a grid of large lozenges, laid over the whole map. It reads as a tiling artefact and not as natural variation. This is the single most visible terrain flaw. Close up (`14_grass.png`, `11_forest_mid.png`) the triangles have per-face random tint with similar value, so the whole ground is one saturated green. | **critical** |
| 2.2 | **Ground colour is one note.** Spring grass is saturated lime/yellow-green everywhere; there is no meadow vs. forest-floor vs. dry-slope vs. wet-ground variation, no darker soil under tree clusters, no brown patches or paths of bare earth. Autumn is nearly identical to summer (`04_season_day140.png`, `04_season_day180.png`): no orange or brown at all. | **critical** |
| 2.3 | **Hard colour bands in the terrain.** (a) Beige/pink sand band around the drained lower lake with a jagged saw-tooth top edge (`04_season_day100.png`, `16_shore_lower.png`). (b) Sharp green/white snow line with a soft blurry stripe in winter (`04_season_day300.png`). (c) The corridor along the dam and penstock stays bright green while the rest of the map is snow-white (`04_season_day260.png`, `04_season_day300.png`); it looks like a cut-and-paste strip. (d) Light grey cliff patches next to the dam have straight triangle edges against green (`22_preset_Dam.png`). | noticeable |
| 2.4 | **Rocks are tiny grey pyramids.** `12_rocks.png`, `12_rocks2.png`, `32_wind_parcel2_close.png`: about 100 single 4-sided pyramids, all the same grey, scattered sparsely. No boulders, no clusters, no scree fields at cliff bases, no outcrops breaking through the grass. | **critical** |
| 2.5 | **Rock/cliff faces have no strata or detail.** `66_canyon_cliff.png` is a smooth grey-brown slab with big triangles and no layers, cracks or ledges. `22_preset_Dam.png` rock next to the dam is pale grey-pink flat polygons. Steep slopes just darken; they do not switch to rock, and vegetation does not stop on steep faces (trees climb the canyon walls in `65_canyon_upper_lake.png`). | noticeable |
| 2.6 | **Shoreline is a thin beige stripe with a zig-zag edge.** `16_shore_lower.png`, `22_preset_Lower_lake.png`, `04_season_day180.png`: a uniform sand colour, one triangle wide, with serrated teeth where the mesh meets the water. No mud/gravel/wet-sand gradient, no pebbles, no reeds. When the lake is drained (`04_season_day100.png`) the bed is a flat cream colour with the same stair-step edge, and a **hard-edged rectangular pocket** of water/sand is left next to the lake (`04_season_day140.png`, left of the lower lake; also visible as a small pond in `50_rain_overview.png`). That looks like a leftover cut mesh. | noticeable |
| 2.7 | **Roads are a faint grey ribbon** (`03_overview_spring_h12.png`, `20_horizon.png`): thin, no verge, no cuts into slopes, no bridge or culvert where it crosses the stream, and it vanishes at the map edge. | nitpick |
| 2.8 | **Slope edge of the map is a flat brown/grey slab.** `19_edge.png`, `68_canyon_edge.png`: dark topsoil band + brown band + flat dark grey-blue block. No rock strata, no cross-section detail. | noticeable |

## 3. Vegetation

| # | Issue | Rating |
|---|---|---|
| 3.1 | **Only one tree type: a stacked-cone conifer.** Two near-identical dark-green variants (`11_forest_mid.png`, `13_flowers.png`). No deciduous trees, birches, shrubs or dead trunks. Colour variance is tiny. The whole map looks like a plantation. | **critical** |
| 3.2 | **Trees look like copy-paste.** Same shape and orientation, little size variation (apart from a few big ones), spaced evenly in blobs. Overview forests are round "polka-dot" clumps with hard edges against bare grass (`03_overview_spring_h12.png`, `50_rain_overview.png`); no gradual treeline, no edge scatter, no clearings with sunlight. The high ridge has a uniform strip of trees (`04_season_day100.png`, top). | **critical** |
| 3.3 | **No underbrush.** `10_forest_close.png`, `11_forest_mid.png`: under and between trees is plain grass with a few olive spikes. No bushes, ferns, fallen logs, stumps, moss, pine-needle floor. | noticeable |
| 3.4 | **Grass tufts are sparse dark olive spikes** that look like thorns, much darker than the ground and not matching it in colour. `14_grass.png` and `12_rocks.png` show one or two blade triangles each, far apart, so the ground is a smooth carpet with pins in it. In snow they turn pale grey (`52_snowfall_forest.png`), which reads as little white shards on green ground. | noticeable |
| 3.5 | **Trunks float.** In `13_flowers.png` and `14_grass.png` canopies hover over thin trunks with a visible dark gap; the base of each tree has no root flare or ground contact shadow at mid distance. | nitpick |
| 3.6 | **Flower patches are cute but tiny and rare** (`10_forest_close.png`, bottom right: pink/red/yellow). At overview they are invisible. No meadow-scale drifts, no seasonal change (they do not fade in autumn). | nitpick |
| 3.7 | **Trees do not react to season or weather.** Autumn: no yellow or orange anywhere (`04_season_day180.png`). Winter: snow on the ground but trees keep summer green with no snow load (`04_season_day260.png`, `04_season_day300.png`). Snowfall at the forest (`52_snowfall_forest.png`) shows the ground still green. | **critical** |
| 3.8 | **No alpine zone.** Tree density barely changes with altitude and the peak is capped with trees; no krummholz, scree or bare ridge above treeline. In the canyon, trees sit on rock walls (`65_canyon_upper_lake.png`). | noticeable |
| 3.9 | **No reeds, cattails or lakeside greenery.** Shores go grass, sand, water with nothing between (`16_shore_lower_water.png`). | noticeable |

## 4. Water

| # | Issue | Rating |
|---|---|---|
| 4.1 | **Water surface is flat shaded polygons with no reflection or sky tint.** Close up (`16_shore_lower.png`, `16_shore_lower_water.png`) it is a teal faceted mesh, semi-transparent, with no specular glint, no sky or tree reflection, no Fresnel effect at grazing angles. It looks like frosted glass, not water. | **critical** |
| 4.2 | **Both lakes have different looks.** Upper lake is deep navy, lower lake light teal (`03_overview_spring_h12.png`); at low level the lower lake becomes milky pale-teal (`04_season_day100.png`) with a visible sand floor, which looks like a plastic sheet. Depth gradient exists (dark centre, turquoise rim, good) but it is saturated and fixed to the shape, not to the sun. | noticeable |
| 4.3 | **No shoreline foam, wet edge or ripple ring.** There is a thin white line only at some segments (`16_shore_lower.png`). The edge is a hard polygon cut, and where it meets the sand band the saw-tooth is obvious (`04_season_day180.png`). | noticeable |
| 4.4 | **Tailrace and river are a narrow teal ribbon with no flow cues.** `24_tail_close.png` and `22_preset_Lower_lake.png`: pale-teal pale triangles; no foam at the draft-tube outlet, no whitewater, no visible current direction. In the classic map the penstock-to-lake stream is a one-pixel line at overview. | noticeable |
| 4.5 | **No waterfall or spillway flow at the dam.** The dam face is dry khaki in all states, including a storm (`51_storm_dam.png`) and with a full lake. No overflow curtain, no plunge pool, no spray. The canyon dam shows a dry dark face with a tiny gate. | **critical** |
| 4.6 | **Lakes never freeze in winter**, although there is ice logic in the sim (`s.ice`). The upper lake is bare and teal in snow (`04_season_day260.png`). | noticeable |
| 4.7 | **Canyon river is the best-looking water in the game** (`65_canyon_upper_lake.png`): turquoise edge to deep blue centre with visible banks. But it still has no flow texture or white water where it narrows. | (praise, see section 9) |

## 5. Structures

| # | Issue | Rating |
|---|---|---|
| 5.1 | **Dam face is a single flat colour with no concrete detail.** `22_preset_Dam.png`, `23_dam_crest_top.png`, `51_storm_dam.png`: one khaki/olive triangle. No block joints, no spillway gates or crest piers, no inspection gallery, no abutment keyed into the rock, no shading differences. At overview it reads as a brown wedge. The crest has a fine railing and a small red-roofed tower; that is good but tiny. | **critical** |
| 5.2 | **Penstock is too thin at overview** (a single teal line, `03_overview_spring_h12.png`). Close up (`22_preset_Penstock.png`) it has blue segments with dark bands, but the section cut-away shows a flat dark-brown "trench" with no soil layers; it looks like a UI cutaway, not a buried or surface pipe with anchors/saddles. | noticeable |
| 5.3 | **Powerhouse is a tiny red-roofed box** that is nearly invisible at overview. The cutaway (`22_preset_Turbines.png`) is charming: two colour-coded machines and a manifold, but it is floating on a grey platform cut into the hillside with no transformer yard, no switchyard, no transmission towers to the parcels, no access road, no lights. | noticeable |
| 5.4 | **Solar panels read as small blue tables on thin legs.** `30_solar_parcel0_close.png`: all the same blue, flat, high on stilts with no frames, no cells, no gaps/rows aligned to the sun, no inverter boxes. Different tiers differ only in spacing/rows (`30_solar_parcel0_over.png`). No dust/snow on panels in winter was checked (it was not visible). No shadows to speak of at overview. | noticeable |
| 5.5 | **Wind turbines are huge and uniform.** `32_wind_parcel2_over.png`, `32_wind_parcel2_close.png`: tower base is wider than trees are tall, white/grey; blades long and flat; heavy long shadows are good. But there are no blinking lights, no access road, no fence, and nothing marks the tile boundary other than a thin yellow outline. Scale next to the trees is off (towers about 10x the tree height). | noticeable |
| 5.6 | **Batteries are grey boxes with black window slits** and sit directly on the grass with no pad. (`32_wind_parcel2_over.png`). | nitpick |
| 5.7 | **Waterslide is the most detailed prop** (`70_slide_dusk.png`, spiral tube, red/blue segments, ladder) but it is out of tone: a neon theme-park object next to otherwise muted low-poly terrain, and it has no splash at the outlet at this quality. | nitpick |
| 5.8 | **Parcel grids are drawn as thin yellow/white line meshes** floating over the terrain (`03_overview_spring_h12.png`); they are the strongest line work in the scene and compete with the roads. They also clip through terrain in places (`30_solar_parcel0_close.png`). | nitpick |

## 6. Life & nature that is missing

| # | Issue | Rating |
|---|---|---|
| 6.1 | **No animals at all**: no birds, fish, deer, no insects. The world is entirely static apart from water and turbines. | **critical** |
| 6.2 | **No wind in vegetation.** Trees and grass never sway even in a 19 m/s storm (`51_storm_overview.png`). | noticeable |
| 6.3 | **Weather is almost invisible.** Rain: a few thin streaks (`50_rain_forest.png`, `50_rain_overview.png`); the sky does not darken, no wet-ground sheen, no puddles, no ripple rings on the lakes, no mist. Storm: `51_storm_overview.png` and `51_storm_dam.png` look like a normal bright day with slightly muted light. Snowfall: `52_snowfall_forest.png` shows a few white dots. | **critical** |
| 6.4 | **No mist/haze/fog** in valleys or over water at dawn, and no distance fade, so everything is equally crisp from 70 m to 2000 m. | noticeable |
| 6.5 | **No falling leaves, no seasonal flowers**, no snow on tree branches, no icicles on the dam, no frost. | nitpick |
| 6.6 | **Snow cover is only a terrain tint.** It looks good from far (`04_season_day260.png`) but close it is a faceted white-lilac surface with no depth; grass tufts turn grey. | nitpick |

## 7. Composition & readability

| # | Issue | Rating |
|---|---|---|
| 7.1 | **Overview camera is excellent for reading the two lakes, but all assets are tiny.** Dam, powerhouse, penstock, panels and wind turbines are legible mostly by position, not shape. At overview, nothing says "power plant". | noticeable |
| 7.2 | **Canyon overview crops the map**: the default camera shows only the middle of the canyon and part of the map is off the top (`63_canyon_overview_noon.png`). The survey view (`60_canyon_survey.png`) is very dark and contour-lined; the red pins were not visible in the first frame and I had to project them to click. | noticeable |
| 7.3 | **HUD panels cover a lot of scene.** The top-left gauge card, camera button, toast stack, and the bottom toolbar cover about 30% of the overview (`01_classic_overview.png`). The right-hand toast stack stays on screen through the whole session. Build panel (`41_panel_Build.png`) covers the entire right third. | nitpick |
| 7.4 | **Lens modes are subtle.** Hydraulic, Electrical and Ecology (`40_lens_1_Hydraulic.png`, `40_lens_3_Ecology.png`) mostly desaturate the world to grey-green; hydraulic does not show flow or pressure, and ecology highlights almost nothing visible. Survey/contour (`40_lens_0_Survey.png`, `41_panel_Build.png`) works well. | noticeable |
| 7.5 | **Camera presets** (Dam, Turbines, Penstock) fly close and show cutaways; the Penstock view looks at the underside of the trench and is confusing (`22_preset_Penstock.png`). | nitpick |
| 7.6 | **Camera can go below ground or clip into hills** (`19_edge2`-type angles and `14_grass_top.png` give a blank green wall). Near-plane clipping at very close zoom shows only a single polygon. | nitpick |

## 8. What already looks good

- The overall low-poly style is consistent, and the overview framing of the crater lake above the dam with the lower lake below is readable and attractive (`01_classic_overview.png`).
- The wind turbine shadows are crisp and a convincing element (`32_wind_parcel2_close.png`). Tree shadows near the camera also work (`11_forest_mid.png`).
- Lake colour gradient (dark centre, bright rim) is nice, and the canyon river with its turquoise margin is the best water in the game (`65_canyon_upper_lake.png`).
- Winter snow from altitude downwards, with a snow line that follows the terrain, is a strong seasonal read from far (`04_season_day260.png`); the canyon snow-versus-rock-versus-valley-green banding is striking (`63_canyon_overview_noon.png`).
- The turbine-hall cutaway with colour-coded machines is charming (`22_preset_Turbines.png`).
- Contour overlay in Survey lens and the UI cards (soft cream with serif titles) are well made and unobtrusive.
- Sun/shadow cycle works mechanically: the same view changes brightness plausibly from dawn to night.

## 9. Top 10 fixes that would change the look the most

1. **Replace the flat sky with a real gradient sky dome** (horizon haze, zenith colour by time of day, warm sunrise/sunset, visible sun and moon disc) and fade the terrain into it with distance fog; add a few drifting low-poly clouds with moving shadows.
2. **Remove the diamond/checker pattern in the terrain colour** (blend vertex colours smoothly with large-scale noise, drop the per-face random tint) and add real variation: meadow, forest floor, dry slope, bare earth, wet ground.
3. **Add a second and third tree species and break up placement** (deciduous round-canopy trees, birches, shrubs, dead snags), vary size 0.6x to 1.6x, add random rotation/lean and feathered forest edges and clearings; stop trees on steep rock faces and above the alpine line.
4. **Make seasons visible in vegetation**: yellow/orange/red foliage in autumn, bare/snow-laden trees in winter, snow on the dam, panels and roofs; extend the snow shader to the corridor around the dam.
5. **Upgrade the water shader**: sky reflection/Fresnel, sun glint, animated normal ripples, soft shoreline foam and wet-edge band, depth tint tied to the sky, ice in winter, rain ripple rings.
6. **Give the dam a proper face and flow**: concrete block lines and shading, spillway gates/crest, visible overflow curtain and plunge-pool foam when the lake is full, and a visible discharge at the tailrace with turbulence.
7. **Make the weather visible**: darken/greyer sky and lighting in rain and storm, denser rain streaks, wet ground sheen, fog banks, heavier snow flakes with accumulation, wind sway on trees and grass.
8. **Add real rocks and scree**: larger faceted boulders in clusters, scree at cliff bases, strata/colour bands on cliff faces, rock outcrops through grass, and a gradual grass to gravel to sand to water shoreline with reeds.
9. **Night pass**: dim water with the same light model as the land, add moonlight/blue ambient, window and yard lights on the powerhouse, red aircraft lights on turbines, lit dam crest, and real stars.
10. **Add ambient life and ground cover**: birds, fish rings, flying insects or fireflies, falling leaves, plus a denser, softer grass layer (colour-matched to the ground) with ferns, bushes and fallen logs under trees; and replace the void/skirt edge with a layered rock cross-section or distant ridge silhouettes.
