/* Instance-matrix writers (THREE-free). three stores InstancedMesh matrices column-major, 16 floats per instance. */
/* T(x,y,z) * Ry(ry) * S(sx,sy,sz) */
export function writeTRS(a, k, x, y, z, ry, sx, sy, sz) {
  const o = k * 16, c = Math.cos(ry), s = Math.sin(ry);
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
/* T * Ry(yaw) * Rz(spin) * S(s): rotor disc in the local xy plane facing local +z, rotated to face world direction (sin yaw, cos yaw) */
export function writeRotor(a, k, x, y, z, yaw, spin, s) {
  const o = k * 16, c = Math.cos(yaw), sn = Math.sin(yaw), cp = Math.cos(spin), sp = Math.sin(spin);
  a[o] = c * cp * s; a[o + 1] = sp * s; a[o + 2] = -sn * cp * s; a[o + 3] = 0;
  a[o + 4] = -c * sp * s; a[o + 5] = cp * s; a[o + 6] = sn * sp * s; a[o + 7] = 0;
  a[o + 8] = sn * s; a[o + 9] = 0; a[o + 10] = c * s; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
/* T * Ry(yaw) * Rx(pitch) * S(sx,1,1): a panel lying in xz, its north (-z) edge raised by `pitch`, so its normal tilts to +z (south) */
export function writePanel(a, k, x, y, z, yaw, pitch, sx) {
  const o = k * 16, c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // columns of Rx(pitch): (1,0,0) (0,cp,sp) (0,-sp,cp); then Ry(yaw)
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = s * sp; a[o + 5] = cp; a[o + 6] = c * sp; a[o + 7] = 0;
  // Ry * (0,-sp,cp) = (s*cp, -sp, c*cp)
  a[o + 8] = s * cp; a[o + 9] = -sp; a[o + 10] = c * cp; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
/* T * Rz(roll) * Rx(pitch): a panel row lying in xz; pitch raises its north edge, roll follows a cross slope (ground rising toward +x for roll > 0) */
export function writeRow(a, k, x, y, z, roll, pitch) {
  const o = k * 16, cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  a[o] = cr; a[o + 1] = sr; a[o + 2] = 0; a[o + 3] = 0;
  a[o + 4] = -cp * sr; a[o + 5] = cp * cr; a[o + 6] = sp; a[o + 7] = 0;
  a[o + 8] = sp * sr; a[o + 9] = -sp * cr; a[o + 10] = cp; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
