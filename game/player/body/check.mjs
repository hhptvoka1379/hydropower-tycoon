/* Headless check of the new body: node game/player/body/check.mjs  (also run by game/tests/body.test.mjs). Exits 1 on failure, prints per-part triangle counts. */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBody } from '../body.js';
import { generateBody } from './index.js';

export const TRI_CAP = 4000;
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const matMul = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/* point inside a closed triangle soup by ray parity (irrational ray direction avoids edge hits) */
function inside(tris, p) {
  const d = [0.5773, 0.3141, 0.7549];
  let hits = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2], e1 = [tris[t + 3] - ax, tris[t + 4] - ay, tris[t + 5] - az], e2 = [tris[t + 6] - ax, tris[t + 7] - ay, tris[t + 8] - az];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(a) < 1e-12) continue;
    const f = 1 / a, s = [p[0] - ax, p[1] - ay, p[2] - az], u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
    if (v < 0 || u + v > 1) continue;
    if (f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) > 1e-9) hits++;
  }
  return hits % 2 === 1;
}
function worldTris(body, mats, name) {
  const p = body.parts[name].position, m = mats[name], out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { const w = matMul(m, [p[i], p[i + 1], p[i + 2]]); out[i] = w[0]; out[i + 1] = w[1]; out[i + 2] = w[2]; }
  return out;
}

export function runChecks(opts = {}) {
  const res = { errors: [], info: [] }, fail = (m) => res.errors.push(m);
  let ms = Infinity, body;   // best of 3: the test runner executes files in parallel
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); body = createBody(opts); ms = Math.min(ms, performance.now() - t0); }
  res.ms = ms; res.tris = body.tris; res.partTris = body.partTris;
  if (ms > 50) fail(`generation took ${ms.toFixed(1)} ms (> 50)`);
  let tris = 0;
  for (const n of body.partNames) {
    const p = body.parts[n]; tris += p.position.length / 9;
    for (const k of ['position', 'normal', 'color']) for (const v of p[k]) if (!Number.isFinite(v)) { fail(`NaN/Inf in ${n}.${k}`); break; }
    for (const v of p.color) if (v < 0 || v > 1.0001) { fail(`colour out of range in ${n}`); break; }
    for (let i = 0; i < p.normal.length; i += 3) if (Math.abs(norm([p.normal[i], p.normal[i + 1], p.normal[i + 2]]) - 1) > 1e-3) { fail(`non-unit normal in ${n}`); break; }
  }
  if (tris > TRI_CAP) fail(`${tris} triangles > ${TRI_CAP}`);
  let mn = Infinity, mx = -Infinity;
  for (const n of body.partNames) { const p = body.parts[n].position; for (let i = 1; i < p.length; i += 3) { mn = Math.min(mn, p[i]); mx = Math.max(mx, p[i]); } }
  res.heightErr = Math.abs(mx - mn - 1.74);
  if (res.heightErr > 0.01) fail(`height error ${(res.heightErr * 100).toFixed(2)} cm`);
  const old = createBody({ legacy: true });
  if (Math.abs(old.rig.standH - body.rig.standH) > 0.005) fail(`standH ${body.rig.standH} differs from legacy ${old.rig.standH}`);
  const hash = () => { const h = createHash('sha256'); const b = generateBody(); for (const n of Object.keys(b.parts).sort()) for (const k of ['position', 'normal', 'color']) h.update(Buffer.from(b.parts[n][k].buffer)); return h.digest('hex').slice(0, 16); };
  res.hash = hash(); if (res.hash !== hash()) fail('generation is not deterministic');
  for (const [a, b] of [['armR', 'armL'], ['thighR', 'thighL'], ['shinR', 'shinL']]) {
    const A = body.parts[a].position, B = body.parts[b].position;
    if (A.length !== B.length) { fail(`${a}/${b} differ in size`); continue; }
    for (let i = 0; i < A.length; i += 9) if (Math.abs(A[i] + B[i]) > 1e-5) { fail(`${a}/${b} are not mirrored`); break; }
  }
  /* no cracks: in walk, run and climb poses, ring samples around each joint (a 7.5 cm hip ring, 3.6 cm knee ring, ...), moved with the part that owns them, must lie inside some part */
  const mats = {}; for (const n of body.partNames) mats[n] = new Float32Array(16);
  const po = body.newPose(), rig = body.rig; let cracks = 0, samples = 0;
  const poses = [[0.9, 1, 0, 1], [2.2, 1, 0, 1.8], [4.1, 1, 1, 1.3], [5.5, 1, 0, 1.8], [3.3, 1, 1, 1.0], [0.3, 0, 0, 1]];
  for (const [phase, move, climb, amp] of poses) {
    body.pose(po, phase, 0.7, move, climb);
    po.hipL *= amp; po.hipR *= amp; po.kneeL *= amp; po.kneeR *= amp; po.armL *= amp; po.armR *= amp; po.lean *= Math.min(amp, 1.4);
    body.posePlayer(rig, po, { x: 0, y: 0, z: 0, yaw: 0 }, mats);
    const W = {}; for (const n of body.partNames) W[n] = worldTris(body, mats, n);
    const all = (p) => body.partNames.some((n) => inside(W[n], p));
    const joints = [];
    for (const s of [1, -1]) {
      const sf = s > 0 ? 'R' : 'L', hip = [s * rig.hipX, 0, rig.hipZ], knee = [s * rig.hipX - 0.03 * s * rig.Lt, -rig.Lt, rig.hipZ + 0.02 * rig.Lt];
      joints.push({ name: 'hip' + sf, c: hip, r: 0.075, axis: [0, 1, 0], parts: ['thigh' + sf] });
      joints.push({ name: 'knee' + sf, c: knee, r: 0.036, axis: [0, 1, 0], parts: ['thigh' + sf, 'shin' + sf] });
      joints.push({ name: 'shoulder' + sf, c: [s * rig.shX, rig.shY, rig.shZ], r: 0.04, axis: [1, 0, 0], parts: ['arm' + sf] });
    }
    joints.push({ name: 'neck', c: [0, rig.headY, 0], r: 0.038, axis: [0, 1, 0], parts: ['head', 'torso'] });
    for (const j of joints) for (const owner of j.parts) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, u = j.axis[1] ? [1, 0, 0] : [0, 1, 0], v = [0, 0, 1];
      for (const off of [-0.012, 0.012]) {
        const p0 = [0, 1, 2].map((i) => j.c[i] + j.axis[i] * off + (u[i] * Math.cos(a) + v[i] * Math.sin(a)) * j.r);
        const p = matMul(mats[owner], p0); samples++;
        if (!all(p)) { cracks++; if (cracks < 6) res.info.push(`crack sample at ${j.name} (${owner}) pose ph=${phase} amp=${amp}: ${p.map((x) => x.toFixed(3))}`); }
      }
    }
  }
  res.cracks = cracks; res.samples = samples;
  if (cracks) fail(`${cracks}/${samples} joint ring samples fall outside every part (cracks)`);
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = runChecks();
  console.log(`triangles ${r.tris} (cap ${TRI_CAP}):`, JSON.stringify(r.partTris));
  console.log(`generation ${r.ms.toFixed(1)} ms | height error ${(r.heightErr * 100).toFixed(2)} cm | joint samples ${r.samples}, cracks ${r.cracks} | hash ${r.hash}`);
  for (const i of r.info) console.log(i);
  for (const e of r.errors) console.error('FAIL', e);
  process.exit(r.errors.length ? 1 : 0);
}
