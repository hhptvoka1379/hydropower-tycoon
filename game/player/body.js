/* The body seam. createBody(opts) -> {parts, rig, pose, newPose, posePlayer, posePreset, partNames, height, tris}. Nothing else may import body-legacy.js or ./body/*.
     parts[name] = {position, normal, color}  Float32Array triangles (non-indexed), part-local to the pelvis frame of the T-pose, +Z forward, y up
     rig                                       dimensions and pivots (see game/player/body/index.js)
     pose(o, phase, t, move, climb)            walk/idle/climb angles into o (newPose() makes one)
     posePlayer(rig, o, {x,y,z,yaw}, mats)     fills mats[name] (Float32Array(16) world matrices) and returns the pelvis lift above the ground y
     posePreset(rig, id, {x,y,z,yaw}, mats)    static lab poses 0 T, 1 slide sit, 2 slide lie, 3 dive (new body module; pelvis world position as root)
   Default = the NEW generator (game/player/body/). createBody({legacy: true}) returns the old coarse body. Options: see game/player/body/index.js.
   Pure: no THREE, no DOM. */
import { athleteRig, pose, newPose, posePlayer, PART_NAMES as LEGACY_NAMES } from './body-legacy.js';
import { generateBody, PART_NAMES } from './body/index.js';
import { posePreset } from './body/poses.js';

export function createBody(opts = {}) {
  if (opts.legacy) {
    const { parts, rig } = athleteRig(opts.preset);
    return { parts, rig, pose, newPose, posePlayer, posePreset, partNames: LEGACY_NAMES.slice(), height: rig.body.height, tris: rig.tris, legacy: true };
  }
  const g = generateBody(opts);
  return { parts: g.parts, rig: g.rig, pose, newPose, posePlayer, posePreset, partNames: PART_NAMES.slice(), height: g.rig.body.height, tris: g.tris, partTris: g.partTris };
}
