# Swimmer v3 — adult-only redesign + live body lab

Separate experiment folder for the slide/swimmer rider. Nothing here is wired into the game yet;
it is a drop-in replacement plus a live tuning page.

## Files

| file | purpose |
|---|---|
| `swimmerGB3.js` | v3 geometry generator. Same public names as `swimmerGB.js` / `swimmerGB2.js`. Adult presets only. ~2.1–2.3× the triangles. |
| `index.html` | live WebGL2 viewer: orbit camera, pose buttons, every body parameter on a slider, presets, palette/look, wireframe. Raw WebGL2 + the game-style `uMat 5` tint decode, no build step. Remembers your last setup. |
| `gb.js` | copy of the game's `GB` triangle-buffer class that `swimmerGB3.js` depends on. |
| `check.js` | headless geometry check: `node check.js` prints tri counts, seats, height error and fails on NaNs. |
| `README.md` | this file. |

## Run the viewer

Just open `index.html` in a WebGL2 browser (`file://` works — no modules, no server). Or:

```sh
python3 -m http.server 8000   # then http://localhost:8000/
```

Controls: drag = orbit, wheel = zoom, `Frame` / `Front` / `Side` reset the camera, `Auto-spin` and
`Wireframe` toggles, preset dropdown, and a slider for every body field. Geometry rebuilds immediately
(~1000 tris, no debounce needed). HUD shows live triangle count, vertex count, seat and extent.

The viewer boots on **`tuned`**, the hand-picked lab combo (1.67 m, build 0.32, shoulders 0.80, bust 0.85,
waist 0.70, hips 1.04, legs 1.15, arms 1.12, head 1.12, neck 0.80, ponytail, plain one-piece). It is a
viewer-only preset: `BODIES` still has exactly the 9 game presets.

Body, pose, palette, look, preset, spin and wireframe are saved to `localStorage` under
`swimmer3.viewer.v1`, so the page reopens where you left it. `Reset preset` puts the tuned combo back.

## Adult-only changes

- The `child` preset is gone. `BODIES` has 9 presets, all adult heights (1.52–1.87 m).
- The `child` field and every child-proportion path were removed from `swimmerGB()` (head/neck/leg/arm
  scaling, softer waist, bust suppression). Passing `child` in a body descriptor is ignored.
- `pickBody()` weights now cover the 9 adult presets.
- Parameter ranges in the viewer keep height at 1.45 m or above.

## Detail budget (v3 vs v2)

Same topology within a body across all 4 poses, so tri count is per body:

| preset | v2 tris | v3 tris | ratio |
|---|---|---|---|
| average | 454 | 982 | 2.16× |
| slim_tall | 479 | 1012 | 2.11× |
| curvy | 466 | 998 | 2.14× |
| stocky | 454 | 982 | 2.16× |
| athletic | 479 | 1012 | 2.11× |
| petite | 466 | 998 | 2.14× |
| plus_size | 454 | 982 | 2.16× |
| masc_average | 434 | 982 | 2.26× |
| masc_broad | 434 | 982 | 2.26× |
| reference (no body) | 454 | 982 | 2.16× |

Where the triangles went (deliberately, not uniform subdivision):

- torso: 8 → 16 sides and 11 → 15 rings, concentrated at the hip, waist, bust and shoulder curve.
- the torso no longer ends in a crotch fan: a **saddle hip ring** (low at the front/back centre, high over
  the hip bones) is stitched to each thigh's top ring by `bridgeLoop()`, so the hip and the legs are one
  continuous surface with real leg holes and a shared inseam,
- legs: 5 → 7 sides and 5 → 8 rings, with a quad/hamstring/calf/ankle shape function,
- arms: 5 → 7 sides and 5 rings, with deltoid, biceps/triceps and forearm shaping,
- neck: 5 → 7 sides with a mid ring; head: 8 → 10 sides with a fifth ring through the brow/cheek,
- bun 6 → 8 sides, ponytail 5 → 6 sides (only where that hair is used).

## Suit

The suit is painted per quad on the one continuous body surface — there is no separate suit geometry and
no strap geometry:

- one-piece (`striped` / `plain`): torso quads from the hip ring up to `SUIT_TOP` (0.436), plus painted
  straps that continue over the shoulder bevel to the back,
- `twopiece`: a painted crop top (shoulder band + chest band) and a separate painted brief; the skin
  between them is the same torso surface,
- `trunks`: white waistband + red shorts, with the red carried onto the thigh's first band and the hip
  bridge,
- the leg line of the brief is the torso's **hip ring** itself, so it is a crisp curve instead of a
  colour step on a ring boundary; the bare hip/thigh below it is the `bridgeLoop` strip,
- stripe bands are coloured from the quad's **Y**, not the ring index, so adding loops never moves them.

## API

Unchanged from v2:

```js
swimmerGB(pose, body) // -> GB, also g.seat, g.top, g.tris, g.body
pickBody(rnd[, weights]) // -> {id, name, body, scale}
pickVariant(rnd[, pal[, look]]) // -> {pal, a, b, look, skin, icol}
swimmerTint(icol, i, v)
```

Poses: `0` T-pose, `1` seated (feet +Z, arms up), `2` lying back (hands behind head), `3` dive.
Axes: y up, metres, faces +Z, arms along ±X, origin = pelvis. The T-pose is scaled to
`body.height` within ~1.6 mm.

Body fields: `height, build, shoulders, bust, waist, hips, legs, arms, head, neck, hair, suit`.
`hair`: `cap | short | bun | ponytail`; `suit`: `striped | plain | twopiece | trunks`.

Internal helper signature (viewer/geometry code only): `tube(pts, rad, seg, colf, m, hint, shape)` now
returns its ring array, and calls `colf(i, k, angle, normal, quadMidY)` — the fifth argument is the
quad's mid height, used by the old leg-opening paint. `bridgeLoop(A, B, axisPt, u, v)` stitches two loops
of different vertex counts.

`BODIES` (adult only):

| id | name | height | build | shoulders | bust | waist | hips | legs | arms | head | neck | hair | suit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | average | 1.68 | 0.55 | 1.00 | 0.50 | 1.00 | 1.04 | 1.00 | 1.00 | 1.00 | 1.00 | cap | striped |
| 1 | slim_tall | 1.84 | 0.15 | 1.00 | 0.30 | 0.92 | 0.94 | 1.07 | 1.05 | 0.96 | 1.12 | ponytail | striped |
| 2 | curvy | 1.66 | 0.62 | 1.00 | 0.80 | 0.88 | 1.22 | 0.98 | 1.00 | 1.00 | 0.98 | bun | plain |
| 3 | stocky | 1.60 | 0.85 | 1.10 | 0.55 | 1.18 | 1.08 | 0.91 | 0.96 | 1.02 | 0.82 | cap | plain |
| 4 | athletic | 1.76 | 0.55 | 1.24 | 0.35 | 0.92 | 0.96 | 1.04 | 1.04 | 0.98 | 1.00 | ponytail | twopiece |
| 5 | petite | 1.52 | 0.35 | 0.94 | 0.45 | 0.95 | 1.00 | 0.97 | 0.98 | 1.05 | 0.95 | bun | striped |
| 6 | plus_size | 1.65 | 1.00 | 1.06 | 0.85 | 1.28 | 1.22 | 0.95 | 0.98 | 1.02 | 0.82 | short | plain |
| 7 | masc_average | 1.77 | 0.50 | 1.20 | 0.12 | 1.10 | 0.88 | 1.00 | 1.04 | 1.00 | 1.00 | short | trunks |
| 8 | masc_broad | 1.87 | 0.85 | 1.36 | 0.18 | 1.16 | 0.94 | 0.98 | 0.97 | 1.00 | 0.92 | short | trunks |

`g.seat` per body (pose 0 T / 1 sit / 2 lie / 3 dive), from the actual geometry:

| body | T | sit | lie | dive |
|---|---|---|---|---|
| reference | −0.864 | −0.112 | −0.101 | −0.124 |
| average | −0.852 | −0.111 | −0.103 | −0.125 |
| slim_tall | −0.959 | −0.113 | −0.087 | −0.101 |
| curvy | −0.836 | −0.115 | −0.114 | −0.143 |
| stocky | −0.784 | −0.123 | −0.122 | −0.141 |
| athletic | −0.911 | −0.116 | −0.105 | −0.121 |
| petite | −0.755 | −0.097 | −0.084 | −0.103 |
| plus_size | −0.826 | −0.142 | −0.141 | −0.165 |
| masc_average | −0.897 | −0.116 | −0.105 | −0.111 |
| masc_broad | −0.946 | −0.131 | −0.132 | −0.140 |

`meshFromGB` drops the extra fields, so cache `seat[body][pose]` when you build the mesh.

## Tint / shader

The packed tint and mask values are unchanged from v2:

- vertex-colour alpha: `0.000` skin, `0.125` hair, `0.25` cap, `0.50` stripe B, `0.75` straps, `1.00` stripe A.
- per-instance `icol`: rgb = stripe A; `a` = `bits 0-17` stripe B (6/6/6), `18-19` cap source,
  `20` strap source, `21-23` LOOK index.
- `SWIM_LOOK` still maps to `SWIM_SKIN` / `SWIM_HAIR`; any palette works on any body.

The game shader snippet from `swimmerGB2.README.txt` applies unchanged (`uMat 5` decode with `SWSK[8]`,
`SWHR[8]`, `lk=(p>>21)&7`). Meshes from v1/v2 still decode with it.

## Game integration

1. Paste `swimmerGB3.js` into the World IIFE as the replacement `swimmerGB.js` (not alongside v1/v2).
2. Use the same lazy cache as before, now with 9 bodies:
   ```js
   const SW={};
   function sw(id,pose){const k=id*4+pose;
     if(!SW[k]){const g=swimmerGB(pose,BODIES[id]);SW[k]=meshFromGB(g,{inst:24,mat:5});SW[k].seat=g.seat;}
     return SW[k];}
   ```
3. For crowd variety, `pickBody(rnd, weights)` returns `{id, body, scale}`; render the cached mesh of
   `BODIES[id]` with the instance matrix scaled by `scale`, and use `seat*scale` for the seat offset.
4. Skin/hair/suit colours stay per instance, so they never add meshes.

Mesh cost: at most 9 bodies × 4 poses = 36 meshes, ~35k tris, ~106k non-indexed verts
(~4.2 MB of position+normal+colour floats) if everything is built. The slide only needs poses 1 and 2
(18 meshes, ~2.1 MB). Each used `(body, pose)` is one instanced draw call; worst case 36 extra draws.
Weights can drop presets you don't ship.

## Limitations

- Still baked poses, not rigged: each `(body, pose)` is its own mesh. The hands-behind-head pose aims
  the forearms at the head, but short arms may not fully reach.
- Hair is a cap-shaped hair region plus a bun or ponytail; no long loose hair.
- The brief's leg line is a 16-gon saddle ring, so from dead-on front/back it has a defined V at the
  crotch rather than a smooth U. Higher torso side counts would round it out.
- Trunks show a small gusset notch where the painted shorts meet the hip bridge.
- Feet and hands are still the v1 wedges; there are no face features beyond the faceted crown/chin.
- Only 8 skin+hair combinations fit in the packed value.
- Stripe B stays 6 bits/channel.

## Headless check

```sh
node check.js
```

Prints per preset: tri count, ratio vs v2, T-pose height error, seats for all four poses. It exits
non-zero on NaNs and on height error > 2 mm.
