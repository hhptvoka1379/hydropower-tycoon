# Sonnet follow-ups: player rides the waterslide, player swims

Status: brief for a later implementation agent (Sonnet). Written 2026-11-16 against the state in `FABLE_PLAN.md` (Phase 7 hooks). Fable 5.2 builds the hooks first; this brief covers the features that sit on top of them.

Names marked **[EXISTS]** are in the current code. Names marked **[PROPOSED]** do not exist yet. Fable creates them in Phase 3 or Phase 7. If a [PROPOSED] name has changed when you start, follow what Fable actually built and note the change in your commit message.

---

## 1. Goal

Two render-side features on top of the walking player and the Three.js world:

**(a) Ride the waterslide.** The player climbs the slide platform, sits (or lies back) on the helix, rides it, and splashes into the lower lake. The v2 slide already has a closed-form ride and a ballistic landing. Replace its placeholder rider (`riderGB()`) with the player avatar, using `swimmerGB3` poses 1 (sitting) and 2 (lying back).

**(b) Swim.** Walk into the water and the player switches from wading to swimming at the waterline. Swimming has buoyancy, a stroke-like animation, a dive entry, and exits by shore or ladder. Intake and tailrace zones are hazards. The torch goes off underwater.

Neither feature changes the simulation. The world, the water level and the physics are read-only inputs to them.

---

## 2. Non-negotiable invariants

1. **Render-side only.** Code for (a) and (b) lives in `game/player/` and `game/world/`. It never imports from `game/sim/` for writing, never dispatches a sim action, and never mutates `state`, `Game.getSnapshot()` results, save data or the replay log.
2. **Never touches sim RNG.** Do not call `Sim.rng` or any sim stream. Cosmetic randomness (rider variety, splash spread) uses a render-only generator. v2 uses `Math.random` for this, which is acceptable in render code only. Do not use `Math.random` anywhere under `game/sim/`.
3. **Hash unchanged.** `Sim.hashState(state)` (or `Game` hash equivalent) is identical before and after any amount of riding, swimming, walking or torch toggling with no sim actions dispatched.
4. **No new globals** except `Game` and `__HYDRO_AUDIT__`. Everything else is a closure inside the World or player module. Check `Object.keys(window)` against a baseline in tests.
5. **No image files.** Textures, sprites and water foam are generated in code. Do not add `.png`, `.jpg`, `.webp` or similar to the repo or to the bundle.
6. **One surface sampler.** Walking, wading, swimming, slide placement and picking all read the same ground and water functions. Do not introduce a second height query.
7. **Display space.** The render uses a vertical exaggeration `VEX = 3` (v2 line 1387). The water surface in display metres is `(lower.bottom + Sim.resLevel(lower, lower.V)) * VEX` (v2 line 2218). Every query in this brief returns display-space Y. Do not mix sim metres and display metres.
8. **Bundle budget.** Stay inside the Phase 8 budget (about 1.5 MB output). Swimmer meshes are baked per body and pose. Build only the poses in use, and cache them.

---

## 3. Hook API that Fable provides

### 3.1 Already exists (read these before you write anything)

| Name | Where | What it gives you |
|---|---|---|
| `SLH` constants (`hw 3.1, rim 1.7, ds 2, Le 12, max 24, clr 0.9, slmax 0.75, NT 64, sT 0.4, QF 0.5, thr 0.8`) | v2 1917 | Slide geometry and tuning. Do not change them to fit the rider. |
| `riderGB()` | v2 1927–1938 | Placeholder figure. Its contract is `{tint, fixed}`. Replaced by `swimmerGB3`, so the contract below is what changes. |
| `slideFind(site)` / `ensureSlide(site)` | v2 2022, 2164 | Seed-stable placement of the helix beside the lower lake. Returns `plan` with `q`, `cx`, `xs/zs/y`, `n`, `nF`. |
| `slideBuild(plan)` → `S` | v2 2089 | Static body. Holds `S.P` (positions), `S.T/L/N` (tangent, lateral, normal frames), `S.K` (curvature), `S.cum` (arc length), `S.len` (effective exit), `S.lip` (waterline launch point), `S.dh` and `S.m0` (exit heading and slope). |
| `slideTailFill(S, lv)` | v2 2048 | Recomputes the level-following end run and `S.lip`/`S.len` for lake level `lv`. |
| `rideS(r, t)` | v2 2175 | Arc length along the chute at ride time `t`. Closed form, no integration. |
| `slidePose(S, r, t, o)` | v2 2177 | Writes position (`o.px/py/pz`) and frame (`o.X/Y/Z`) on the chute at time `t`. Reuse it. |
| `slideSpawn` / `slideTick` | v2 2196, 2212 | Full rider lifecycle: ride, ballistic flight from the lip (`tf`, `D`), splash (`tb`, `sink`), droplets and rings. Read the landing branch (v2 2233–2247) carefully before you write the player version. |
| `Sim.resLevel(lw, V)`, `Sim.bowlR`, `Sim.cX`, `Sim.riverW` | v2 1380 export list | Read-only sim helpers. |
| `hD(x, z)` | v2 (terrain height sampler, used throughout the slide code) | Ground height at a point. Phase 3 replaces it with the single sampler. Read through the new sampler when it exists. |
| `W.slide` / `S.riders` / `S.hidden` | v2 2091, 2215 | Current slide state. Survey lens hides the slide. Honour that. |
| `layout.ph`, `layout.dam`, `layout.tail`, `layout.lo`, `layout.parcels` | used in v2 1952–1955 | Anchor points. `layout.lo` is the lower lake centre. `layout.tail` is the tailrace point. |
| `swimmerGB3` poses and `g.seat` | `swimmer-adult-redesign/swimmerGB3.js` | See §3.4. |

### 3.2 Water

**[PROPOSED] `World.water.surfaceAt(x, z)`**
Returns display-space Y of the lake surface at (x, z), or `null` if (x, z) is not over water. Driven by the live level each call (not baked at build time, see C5). Must match what the water mesh draws, including the shoreline.

**[PROPOSED] `World.water.depthAt(x, z)`**
Returns `surfaceAt(x, z) - groundAt(x, z)` in display metres, or `0` if there is no water. Positive means under water.

Both must be cheap (called every frame for the player) and pure (no side effects).

### 3.3 Hazards and slide

**[PROPOSED] `World.hazards`** (data only, no behaviour in Phase 7)
An array of zones: `{ id: 'intake' | 'tailrace', shape: 'circle' | 'box', x, z, r | box, y0, y1, pushDir? }`. Phase 7 fills it with the intake and the tailrace. The swimmer reads it. Lethality is not decided (see §8, Q5). Default behaviour is push-back.

**[PROPOSED] `World.slide`**, a view over the existing `W.slide`:
- `platform`: entry box and standing point on the platform (`{x, y, z, facing}`).
- `exit`: the lip (`S.lip`) and the landing direction (`S.dh`).
- `chute(t)`: returns `{px, py, pz, X, Y, Z}` at ride time `t`, from `slidePose`.
- `requestPose(id)`: returns a `GB` mesh for pose `1` (sit) or `2` (lie) of the player's body, plus `seat`. Cached per `(body, pose)`.
- `isRiding(player)`: true while the player is on the chute.

### 3.4 Player

**[PROPOSED] `player.mode`**, one of `walk | swim | slide | stairs | blocked`.
- `walk`: normal ground movement from the demo (`walkerStep`, `groundY`, `planPath`).
- `stairs`: on a stair flight (from the demo).
- `blocked`: no movement. Used for the bankruptcy overlay and other modal states.
- `swim`: in water deeper than the swim threshold (§5.1).
- `slide`: riding the chute (§4).

The mode is a pure function of the previous mode plus the sampled surface and input. Transitions are listed in §4.3 and §5.2.

**[PROPOSED] Player body.** Use `swimmerGB3`, not `riderGB`. The body is `swimmerGB(pose, body)` from `swimmer-adult-redesign/swimmerGB3.js`.
- Poses: `0` T-pose (walking), `1` seated, feet +Z (slide start), `2` lying back, hands behind head (slide), `3` dive, belly down, head +Z (water entry).
- Origin is the pelvis. `g.seat` is the lowest body point. To rest the figure on a surface at height `h`, place its origin at `y = h - g.seat`. Pose 1 gives `seat ≈ -0.11` for the average body.
- Scale the figure by `scale` from `pickBody` if the player's body is jittered. Use the same cached mesh and multiply the instance matrix.
- The README caches with `meshFromGB(g, {inst: 24, mat: 5})`. That is the v2 API. Renderer is moving to Three.js, so map it to the Three.js instanced mesh and check the material against §8, Q1.

---

## 4. (a) Riding the waterslide

### 4.1 Feel

- Entry is from the platform top, at the entry box `platform`. The player walks onto the platform, faces the channel mouth, and presses the ride key (or clicks the channel mouth).
- The ride is the existing closed-form ride. Do not write a new physics integrator. The player's position is `slidePose(S, r, t)`, where `r` is a ride record with the same fields `slideSpawn` builds (`vmax`, `ta`, `wA`, `wW`, `wP`, `swA`, `swW`, `swP`).
- The player's ride record uses the same ranges as the NPC riders, but with fixed values for the player (so the ride is consistent): `vmax 13, ta 1.4, wA 0.4, wW 1.2, wP 0, swA 0.25, swW 1.1, swP 0`. These are **[PROPOSED]**; tune them by watching the ride.
- Pose: sit (pose 1) on the helix. Lie back (pose 2) only on the final run-out if `S.len` allows it. Choose one per ride and keep it for the whole ride, so the figure never pops.
- Camera follows the player along the chute at a fixed offset. The slide's existing camera distance scaling (`camSc`) still applies.

### 4.2 Landing

- Exit at `S.len`, the effective exit. The launch point is `S.lip` and the heading is `S.dh`.
- Use the existing ballistic landing: `D` (distance to water), `tf` (flight time), `tb` (bob time), `sink`. Copy the model from `slideTick` (v2 2233–2243). Do not reimplement it.
- Splash: reuse the droplet and ring instancers (`M.slideDrops`, `M.slideRings`). Those are render-only.
- On landing (the water contact moment, `t = tLand`), the player switches to `swim` (§5). If the lake is shallow at the landing point (`depthAt` below the swim threshold), the player switches to `walk` instead, wading out.

### 4.3 Transitions

| From | To | Condition |
|---|---|---|
| walk | slide | On platform entry box and ride key pressed and `World.slide` is present and not hidden. |
| slide | swim | Landing point has `depthAt > SWIM_ON` (§5.1). |
| slide | walk | Landing point has `depthAt <= SWIM_ON`. Player wades out to the shore. |
| slide | blocked | `W.slide` is hidden (survey lens) mid-ride. Stop the ride, keep the player where they are, release to walk. |

If the lake level changes while the player is on the chute, do not rebuild the chute. `slideTailFill` only runs when nobody is still on the chute (v2 2220–2221). Follow the same rule for the player.

### 4.4 Cosmetic randomness

Use a render-only generator. Do not use `Sim.rng`. Splash spread and droplet angles may be random. The ride itself is deterministic from the ride record.

---

## 5. (b) Swimming

### 5.1 Thresholds (all **[PROPOSED]**, tune them)

- `WADE_MAX = 0.6 m`: walkable depth. Below this the player walks, with the body at ground height.
- `SWIM_ON = 1.2 m`: depth at which wading turns into swimming.
- `SWIM_OFF = 0.8 m`: depth at which swimming turns back into wading. Use hysteresis (`SWIM_OFF < SWIM_ON`) so the mode does not flicker at the edge.
- `DRAFT`: the body is held so that the water surface sits at the chest for pose 0 and at the shoulders for pose 3. Derive from `g.seat` and `g.top` of the body. Do not hard-code it.

### 5.2 Transitions

| From | To | Condition |
|---|---|---|
| walk | swim | `depthAt >= SWIM_ON` at the player's position, after a step. |
| swim | walk | `depthAt <= SWIM_OFF` at the player's position. Walk out up the shore. |
| swim | walk (exit by shore) | Player is at a shore exit point (see §5.4) and presses forward out of the water. |
| swim | walk (exit by ladder) | Player is at a ladder cell and presses up. Ladder positions are data, see §5.4. |
| swim | blocked | Overlay or modal opened. Pause the swim, keep the position. |

### 5.3 Buoyancy and motion

- Vertical: spring toward the surface. Target `y = surfaceAt(x, z) - draftOffset`. Use a damped spring (`k` and `c` **[PROPOSED]**, tune until the bob settles in about 1 s). Clamp the step so `dt` above 0.1 s does not explode the spring.
- Horizontal: input direction times a swim speed (`~1.4 m/s` **[PROPOSED]**, slower than walking). Drag toward zero when there is no input.
- Level changes under the swimmer: `surfaceAt` is re-read every frame. If the lake drops so that `depthAt < SWIM_OFF`, the mode goes to `walk` (§5.2). The body must never be left below the ground under it, and never stuck in a wall.

### 5.4 Exits

Every water position must have a way out. Two kinds of exit exist in the design:

- **Shore:** the nearest point where the ground rises above the surface and the slope is walkable (under the demo's slope limit). Compute from the same sampler. Do not hand-place shore exits.
- **Ladder:** a short list of ladder cells (data), for the slide platform ladder (v2 2115–2118 shows the back ladder geometry) and any lower-lake ladder Fable adds. **[PROPOSED]** Store them as `World.ladders = [{x, z, dir, topY}]`.

Acceptance test §7.4 checks that a shore or ladder exit is reachable from every water cell in the lower lake.

### 5.5 Stroke animation

This is the hard part. `swimmerGB3` produces **baked** poses, not a rig (`swimmer-adult-redesign/README.md` "Limitations"). There is no arm-stroke pose. Use this order:

1. Use pose 3 (dive, belly down) as the swimming body.
2. Animate with a periodic roll and a small forward pitch on the whole body, tied to swim speed (`roll = 0.12 * sin(phase)`, phase advances with distance). Add a head-bob via the head-height offset if desired.
3. Add a foam ring and a small ripple at the body for motion cues, using the ring instancer (`M.slideRings`).
4. Do **not** author new body poses or edit `swimmerGB3.js` without asking Fable.

### 5.6 Torch in water

- The torch (Phase 2 night halo) is a light attached to the player. **[PROPOSED]** Rule: the torch turns off when the player's head is under the surface (`mode === 'swim'` and head below `surfaceAt`). It fades out over 0.3 s and fades back on over 0.3 s on exit.
- At night in water the lake is lit by the moon and ambient floor only. Do not make the water emissive to compensate.
- The torch never changes the sim, the hash, or any save.

### 5.7 Hazard zones

- `World.hazards` entries for `intake` and `tailrace` are read each frame.
- Default behaviour is **push-back**: inside a hazard zone the swim velocity gets a component pushing the player out, and an on-screen notice appears (toast, render-only).
- Do not make a hazard lethal, and do not block the player from leaving the water. Lethality is an open decision (§8, Q5).

---

## 6. Files and ownership

- `game/player/` owns the player mode, input, walk/stairs/blocked/swim/slide logic, the torch, and the body mesh cache.
- `game/world/` owns `World.water`, `World.hazards`, `World.slide` (the view over the existing slide), and all Three.js meshes.
- `game/sim/` is not touched by this work.
- The slide code in v2 (lines 1910–2250) is the reference. Port it into the Three.js world module. Do not reuse the WebGL2 `meshFromGB` path as written.

---

## 7. Acceptance tests

Run in the Node harness where possible (pure functions, fixed `dt`, scripted input) and in the browser self-test (`__HYDRO_AUDIT__`) for the rest.

1. **No NaN over 60 s.** Script a 60 s session (walk, climb, ride, swim, exit, walk) at `dt = 1/60`. Every position, velocity and frame component is finite at every step.
2. **Never below terrain, except swimming.** Over the same session, `player.y >= groundAt(x, z) - 1e-3` whenever `player.mode !== 'swim'`. In swim mode the player may be below the surface, but never below ground.
3. **Hash unchanged.** Record the sim state hash before the session and after. Equal. Also check that no sim action was dispatched (count the dispatch calls).
4. **Exit from water always possible.** From a grid of water cells in the lower lake (sample at 1 m spacing, 3 water-level values: low, mid, high), a shore or ladder exit is reachable by a path of walkable cells within 40 m. The route is found with the demo's `planPath`.
5. **Level change under swimmer.** Drop the lake level by 1 m while the player is swimming. The mode settles to `walk` or `swim` without NaN and without the body ending below ground.
6. **Slide ride end to end.** Ride from the platform. The player ends in water (`swim`) or on the shore (`walk`). No frame where the rider is more than 0.5 m off the chute centreline except during the landing flight.
7. **Torch.** Torch is off when the head is under the surface and on otherwise (night only). Verify the fade timing.
8. **No new globals.** `Object.keys(window)` minus the baseline equals `[]` after a session, apart from `Game` and `__HYDRO_AUDIT__`.
9. **No image files.** Repo and bundle contain no new image files from this work.
10. **Survey lens.** Turning the survey lens on mid-ride stops the ride, hides the slide, and leaves the player on walkable ground.

---

## 8. Open questions (ask Fable or the user, do not decide alone)

- **Q1. Material path for the body.** `swimmerGB3` expects the game shader's `uMat 5` decode, from a `swimmerGB2.README.txt` snippet that is **not** in `swimmer-adult-redesign/` and is not in the v2 shader (its fragment shader only has `uMat` 1–4). The renderer is moving to Three.js in Phase 2. Decide the material with Fable: a Three.js `ShaderMaterial` that decodes the packed `icol`, or a per-instance colour approach.
- **Q2. Swim stroke.** Baked poses have no stroke. Is the roll-and-bob approach (§5.5) acceptable, or does the user want a rigged arm split? A rig is a new task and is out of scope for this brief.
- **Q3. Which slide pose** the player uses for most of the ride: sitting (pose 1) is the default in this brief. Confirm with a visual check.
- **Q4. Is the ride free?** The plan says the slide is render-only, with no ticket. Keep it that way unless the user asks for an economy hook.
- **Q5. Hazard behaviour.** `PROJECT_STATUS.md` §5 Q5 asks whether intakes and tailrace are lethal, blocked or push-back. This brief uses push-back. Confirm before anything stronger is built.
- **Q6. Intake location.** The v2 slide code does not show where the penstock intake is. `layout.tail` is the tailrace. The intake is probably the start of the penstock route (`site.route[0]`), but confirm in the layout code.
- **Q7. Torch rule in water** (§5.6). Confirm the on/off rule.

---

## 9. Do not do

- Do not dispatch any sim action (`applyAction`, `SET_*`, `BUILD`, `REPAIR` and the rest) from the player, the slide or the water code. Walking and riding must not spend money or change the state.
- Do not call `Sim.rng`, `Sim.step`, or anything that advances the sim clock.
- Do not write to `state`, the save format, the replay log, or `lastReject`.
- Do not add a global variable, a `window.` property, or a top-level `let`/`var` that escapes the module closure.
- Do not add image files, texture files, or sprite sheets. Generate everything in code.
- Do not change `swimmerGB3.js` geometry, its poses, or its palette. If a pose looks wrong on the rider, report it and wait.
- Do not change `SLH` constants or the closed-form ride to make the player fit. Adapt the player's record instead.
- Do not reuse `riderGB()`. It is a placeholder and is replaced.
- Do not rebuild the chute mid-ride. Respect the rule in v2 2220–2221.
- Do not bake lake level into the mesh. Read `surfaceAt` live each frame.
- Do not make hazards lethal, or prevent leaving the water.
- Do not add a second terrain height query. Use the single sampler from Phase 3.
- Do not write `.md` report files, changelogs or notes beyond the commit message.
- Do not commit or push unless the user asks. Do not add any Claude, Anthropic or Co-Authored-By attribution to commits, comments, files or PR text.
