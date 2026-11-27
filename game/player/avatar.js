/* The avatar: rig meshes built from createBody() (game/player/body.js), posed every frame, casting a shadow. three is imported by name only.
   update() takes the logical state (x, y = floorY under the feet, z, yaw) and the gait numbers; the lower foot rests exactly on y. */
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { createBody } from './body.js';

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // the body's colours are sRGB values; vertex colours are linear

export function createAvatar(opts = {}) {
  const body = opts.body || createBody(opts);
  const group = new Group();
  group.name = 'avatar';
  const mat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  const meshes = {}, mats = {}, geos = [];
  for (const name of body.partNames) {
    const p = body.parts[name], g = new BufferGeometry();
    const col = new Float32Array(p.color.length);
    for (let i = 0; i < col.length; i++) col[i] = lin(p.color[i]);
    g.setAttribute('position', new BufferAttribute(p.position, 3));
    g.setAttribute('normal', new BufferAttribute(p.normal, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    const m = new Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; m.matrixAutoUpdate = false;
    group.add(m);
    meshes[name] = m; mats[name] = new Float32Array(16); geos.push(g);
  }
  const PO = body.newPose();
  const hand = { x: 0, y: 0, z: 0 };
  const api = {
    group, body, pose: PO, hand, height: body.height,
    /* s = {x, y, z, yaw}, gait = {phase, move, climb, t} */
    update(s, gait) {
      body.pose(PO, gait.phase, gait.t, gait.move, gait.climb);
      const a = gait.amp || 1;   // swing scale for running: a longer stride needs a wider swing to keep the stance foot planted
      if (a !== 1) { PO.hipL *= a; PO.hipR *= a; PO.kneeL *= a; PO.kneeR *= a; PO.armL *= a; PO.armR *= a; PO.lean *= Math.min(a, 1.4); }
      body.posePlayer(body.rig, PO, { x: s.x, y: s.y, z: s.z, yaw: s.yaw }, mats);
      for (const name of body.partNames) { meshes[name].matrix.fromArray(mats[name]); meshes[name].matrixWorldNeedsUpdate = true; }
      const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw);   // the body faces +Z rotated by yaw (Ry): forward = (sin yaw, cos yaw)
      hand.x = s.x + sn * 0.35; hand.z = s.z + cs * 0.35; hand.y = s.y + 0.95;
    },
    setVisible(v) { group.visible = !!v; },
    dispose() { for (const g of geos) g.dispose(); mat.dispose(); if (group.parent) group.parent.remove(group); }
  };
  return api;
}
