/* Static pose presets for the rigid rig (the legacy swimmer lab poses): 0 T-pose, 1 slide sitting, 2 slide lying back, 3 dive (belly down, head +Z).
   posePreset(rig, id, root, mats): root = {x, y, z, yaw} is the PELVIS world position; fills mats[name] (column-major Float32Array(16)) like posePlayer does.
   The rig has no elbow, so arms are one straight piece: the preset aims the whole arm along the lab's upper-arm direction. Directions are in the pelvis frame, mirrored for the left side. */
const PS = [
  { lean: 0, head: 0, thigh: [-0.03, -1, 0.02], shin: [-0.03, -1, -0.03], arm: [1, -0.08, 0] },
  { lean: 0.32, head: -0.1, thigh: [0.13, -0.06, 1], shin: [0.08, -0.03, 1], arm: [0.42, 1, 0.12] },
  { lean: 1.38, head: 0.55, thigh: [0.07, -0.04, 1], shin: [0.03, 0.02, 1], arm: [0.75, 0.55, 0.18] },
  { lean: -Math.PI / 2, head: -0.15, thigh: [-0.02, 0, -1], shin: [-0.01, 0.02, -1], arm: [0.12, 1, 0.04] }
];
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/* 4x4 column-major: rotation R (3x3 rows) about point p */
function rotAbout(R, p) {
  const o = new Float32Array(16);
  o[0] = R[0][0]; o[1] = R[1][0]; o[2] = R[2][0]; o[4] = R[0][1]; o[5] = R[1][1]; o[6] = R[2][1]; o[8] = R[0][2]; o[9] = R[1][2]; o[10] = R[2][2]; o[15] = 1;
  for (let r = 0; r < 3; r++) o[12 + r] = p[r] - (R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]);
  return o;
}
function fromTo(a, b) {   // rotation taking unit a to unit b (Rodrigues)
  a = nrm(a); b = nrm(b);
  const v = crs(a, b), c = dt(a, b);
  if (c < -0.9999) return [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];
  const k = 1 / (1 + c), x = v[0], y = v[1], z = v[2];
  return [[c + x * x * k, x * y * k - z, x * z * k + y], [y * x * k + z, c + y * y * k, y * z * k - x], [z * x * k - y, z * y * k + x, c + z * z * k]];
}
const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
function mulm(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function applyPt(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }

export function posePreset(rig, id, root, mats) {
  const P = PS[(id | 0) % 4], cy = Math.cos(root.yaw), sy = Math.sin(root.yaw);
  const M = new Float32Array(16); M[0] = cy; M[2] = -sy; M[5] = 1; M[8] = sy; M[10] = cy; M[12] = root.x; M[13] = root.y; M[14] = root.z; M[15] = 1;
  const torso = mulm(M, rotAbout(rx(-P.lean), [0, 0, 0]));
  mats.torso.set(torso);
  mats.head.set(mulm(torso, rotAbout(rx(P.head), [0, rig.headY, 0])));
  for (const s of [1, -1]) {
    const mir = (v) => [v[0] * s, v[1], v[2]], sfx = s > 0 ? 'R' : 'L';
    mats['arm' + sfx].set(mulm(torso, rotAbout(fromTo([s, 0, 0], nrm(mir(P.arm))), [s * rig.shX, rig.shY, rig.shZ])));
    const hip = [s * rig.hipX, 0, rig.hipZ], knee = [s * rig.hipX - 0.03 * s * rig.Lt, -rig.Lt, rig.hipZ + 0.02 * rig.Lt];
    const Rt = fromTo([-0.03 * s, -1, 0.02], mir(P.thigh)), Mt = mulm(M, rotAbout(Rt, hip));
    mats['thigh' + sfx].set(Mt);
    const kn = applyPt(Mt, knee), Rs = fromTo([-0.03 * s, -1, -0.03], mir(P.shin));
    const Ms = rotAbout(Rs, [0, 0, 0]); Ms[12] = kn[0] - (Ms[0] * knee[0] + Ms[4] * knee[1] + Ms[8] * knee[2]); Ms[13] = kn[1] - (Ms[1] * knee[0] + Ms[5] * knee[1] + Ms[9] * knee[2]); Ms[14] = kn[2] - (Ms[2] * knee[0] + Ms[6] * knee[1] + Ms[10] * knee[2]);
    mats['shin' + sfx].set(Ms);
  }
}
