# Player agent state (round 3, paused)

## Status
npm test 150/150, npm run check green, npm run build green (0.79 MiB) at the pause. Cell size is 6 m on purpose: at 8 m the classic site produced 0 flights and
features.test.mjs ("paths adapter ... flights.length >= 1") failed.

## Done and verified
- Item 2 (load hitch): route search made cheap. `walker.lineFast` (1.5 m samples, factor 0.78) in the Dijkstra edge test, early exit once all stations are settled,
  inlined one-sample floor/wet test in `laneWalkable` (walker.js). buildPaths about 110-150 ms in Node (was 2300 ms classic / 1600 ms canyon); in the browser a cold
  rebuild measured 600 ms BEFORE the last two speedups (inline sample, still to be re-measured; target < 400 ms). `siteKey()` cache in player/index.js `rebuild()`:
  an identical key (site layout, dam height quantised to 0.5 m, excavation, foreign provider count, blockers) reuses stations and flights (rebuild 0.2 ms in browser).
  Tests: cached rebuild < 100 ms asserted in the runtime test.
- Item 1 (camera): occlusion by structures: `createCamera({occlude})`, occlude = nearest `rec.f.pick` hit over `world.features` (hits < 1.2 m ignored).
  camera.js `update`: tries higher pitch (steps 0.1) at full distance, else pulls in; `cam.occ` eased (fast up, slow down). `pickYaw(target, want)` at spawn scores 24 yaws
  by clearance and by how many of 7 points around her are visible from the camera. `autoFollow` eases the camera behind her heading while walking forward or gliding
  (not for 1.5 s after a manual orbit). Browser screenshots at `?at=powerhouse&hour=12` and on the dam crest: avatar unobstructed; at the powerhouse the pipe still
  passes behind/above her (it descends to the powerhouse there) but no longer covers her.
- Item 3 (clock/URL): `?hour=` / `?doy=` now fast-forward the SIM from its start (main.js `fastForward`: 5 min steps, then 1 min for a fractional hour; the sim has no
  newGame start-time option and I may not edit it). HUD shows the sim clock (checked: 12:00 at `?hour=12`). `world.debugSetTime` is no longer used by the URL (it is sky-only).
- Item 4 (gait): game/player/gait.js (pure): `AMP(speed)`, `strideOf`, `footSlip`. Stance foot slip mean < 4% at 5, 8.8, 11 m/s (test). avatar.js applies `gait.amp`.
  NOT done: the two mid-stride screenshots in the browser.
- Item 5 (arrival facing): index.js `faceOf(station)` + `facing` state: on arrival she turns to the nearest blocker prop within 14 m (powerhouse/board/hut/slide), the lake for the
  dam and shores, the tiles for a desk, the pipe mid-point for the penstock, and the camera swings behind her. Headless only, NOT checked in the browser.

## Remaining, in order
1. Re-measure cold `P.rebuild()` in the browser (push a blocker onto `__HT.world.blockers`, call `__HT.player.rebuild()`, pop it); if still > 400 ms: cheaper `simplify`/chain code or coarser `OFFS`.
2. Browser check of items 4 and 5: `__HT.player.goTo('lookout')`, two screenshots mid-stride; arrival facing at board, powerhouse, dam, desk1.
3. Look at the camera while walking (autoFollow) and at `?at=dam` (camera chose the lake view); tune `CC.pitchDefault` / `distDefault` if the powerhouse view still feels pipe-heavy.
4. Report (max 12 lines) to the coordinator.

## Files changed this round (all under game/)
player/camera.js, player/index.js, player/avatar.js (amp), player/gait.js (new), player/walker.js (lineFast, inlined sample), player/stations.js (early exit, lineFast edge test),
main.js (fastForward), tests/player.test.mjs (gait, camera clearance, cache tests). Scratch files in /private/tmp/claude-501/scratch only.

## Notes
- player runtime tests use a fake renderer and stub DOM; they run in about 4 s now.
- My browser tab-5 may still be open; close it.

## Update (round 3 leftovers, second pause)
Changed since the note above:
- stations.js `buildPaths`: two-pass search (`search(cell, allow)`: coarse 12 m pass finds corridors, fine 6 m pass only inside them, dilated by 1 coarse cell; falls back to the
  full fine search if a station is unreachable). Cold build in Node about 90 ms (was 150); browser was 430 ms before this pass, NOT re-measured since. Side effect: `uncovered` legs
  (not lane-clear, no flight) are 17-25 per site, all 110 ordered pairs still pass at run speed on the fake and the real surface, classic keeps 1 flight (a dilation of 2 cells made desk3
  unreachable on the fake classic surface: keep 1). Consider an all-pairs test on the real surface.
- index.js: debug seams `player.freeze(speed, {phase, climb})` and `player.pose(name)` ('idle','walk','run','stairs','free','arrival:<stationId>'), deterministic (frame t = 0 when frozen).
  Call from the browser console: `__HT.player.pose('walk')` (mid-stride, stance foot flat), `pose('run')`, `pose('stairs')`, `pose('arrival:board')`, `pose('free')` to release.
- index.js: cache validity uses a geometry tolerance (layout points moving < 0.5 m keep the cached stations and flights) plus a discrete key (kind, seed, dam built/raising, excavation, foreign providers, blockers).
- devhud.js: exported pure `stationActions(s, st, site, Sim)` (dam label shows `Sim.raiseQuote` base/premium/discount, RESTRUCTURE uses `plan`) and `gridWarningText(st)` (shown on every station card).
  New test in player.test.mjs asserts every HUD action type exists in game/sim/actions.js.
Status at the pause: npm test 151/151, check and build green (the features builder settled).
("./layout.js does not provide an export named boxesFromLayouts", breaks features.test.mjs and the player runtime tests that boot the world). Re-run npm test once that settles.
Remaining: re-measure the cold build in the browser; confirm 150+/N tests green after the features builder settles; browser check of freeze/pose seams.
