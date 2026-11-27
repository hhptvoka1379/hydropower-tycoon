/* NEW body generator (pure JS: no THREE, no DOM, deterministic, ~10 ms).

   API   generateBody(opts) -> { parts, rig, height, tris, partTris }
     opts.preset      body descriptor overrides (height, build, shoulders, bust, waist, hips, legs, arms, head, neck, hair 'ponytail'|'bun'|'short'|'cap', suit 'twopiece'|'plain'|'striped'|'trunks', cap)
     opts.cap         true/false: swim cap over the hair (default true, as the athlete_f preset)
     opts.suitColor, opts.trimColor, opts.capColor, opts.skin, opts.hairColor   sRGB [r,g,b] 0..1 or '#rrggbb'
   RIG CONTRACT (identical to body-legacy.js, so pose()/posePlayer() from there drive it unchanged)
     parts: torso, head, armR, armL, thighR, thighL, shinR, shinL = {position, normal, color} Float32Array, non-indexed triangles, in the T-pose pelvis frame (metres, +Z forward, +Y up, origin at the
            midpoint of the hips). One draw call per part. Left parts are the exact mirror of the right ones.
     pivots (the rig object): thigh about (±hipX, 0, hipZ); shin about (±hipX - 0.03 Lt, -Lt, hipZ + 0.02 Lt); arm about (±shX, shY, shZ) (T-pose arms point along ±X);
            head about (0, headY, 0). rig.standH = pelvis-to-sole distance, rig.sole, Lt, Ls as before.
   No cracks at joints: the thigh top, thigh bottom, shin top and arm root are spherical domes centred on their pivots (the neighbouring dome coincides with them whatever the angle);
   the neck is a vertical prism shared by the torso and the head stub, so head yaw is seamless.
   Poses 1-3 (slide sitting, slide lying, dive): posePreset(rig, id, root, mats) places the same rigid parts with matrices (see bottom of file).
   Baked look: per-vertex colour = face paint (suit panels, trim, skin, hair, cap) times hemisphere shading times ambient-occlusion blobs (armpit, crotch, knee, neck, chin, ...)
   with small skin-tone tints (knees, elbows, shoulders, cheeks). Facet edges follow the form: rings sit on panel boundaries, brow, eye, cheek and jaw lines. */
import { makeContext } from './style.js';
import { buildTorso } from './torso.js';
import { buildThigh, buildShin, buildArm } from './limbs.js';
import { buildHead } from './head.js';

export const PART_NAMES = ['torso', 'head', 'armR', 'armL', 'thighR', 'thighL', 'shinR', 'shinL'];

export function generateBody(opts = {}) {
  const X = makeContext(opts), SC = X.SC;
  const R = { thigh: buildThigh(X), shin: buildShin(X), arm: buildArm(X) };
  const meshes = { torso: buildTorso(X), head: buildHead(X), armR: R.arm, armL: R.arm.mirrored(), thighR: R.thigh, thighL: R.thigh.mirrored(), shinR: R.shin, shinL: R.shin.mirrored() };
  const parts = {}, partTris = {};
  let tris = 0, minY = Infinity;
  for (const n of PART_NAMES) {
    const sm = meshes[n].scaled(SC);
    for (let i = 1; i < sm.p.length; i += 3) if (sm.p[i] < minY) minY = sm.p[i];
    parts[n] = sm.toPart(); partTris[n] = sm.count; tris += sm.count;
  }
  const Lt = 0.4 * X.legL * SC, Ls = 0.39 * X.legL * SC, standH = -minY;
  const rig = { SC, tris, standH, Lt, Ls, sole: standH - Lt - Ls, hipX: X.hx * SC, hipZ: X.hipZ * SC, shX: X.S[0] * SC, shY: X.S[1] * SC, shZ: X.S[2] * SC, headY: 0.545 * SC, kneeDrop: Lt * 0.9995, body: X.Bd };
  return { parts, rig, height: X.Bd.height, tris, partTris };
}
