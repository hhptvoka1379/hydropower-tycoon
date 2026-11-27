/* Small three.js helpers shared by the features: everything created is tracked in the feature's ResourceScope.
   To keep the number of shader programs tiny, EVERY lit mesh of tiles and paths is an InstancedMesh with an instanceColor and receiveShadow = true
   (a "static" mesh is an instanced mesh of count 1 with the identity matrix), so they all share one lambert program (and one instanced depth program). */
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, Mesh } from 'three';
import { writeTRS } from './inst.js';

export function geoFrom(scope, gb) {
  const a = gb.arrays(), g = scope.track(new BufferGeometry());
  g.setAttribute('position', new BufferAttribute(a.position, 3));
  g.setAttribute('normal', new BufferAttribute(a.normal, 3));
  g.setAttribute('color', new BufferAttribute(a.color, 3));
  g.computeBoundingSphere();
  return g;
}
/* plain Mesh (old path; round 2 moves tiles and paths to staticFrom) */
export function meshFrom(scope, parent, gb, mat, o = {}) {
  if (gb.triCount === 0) return null;
  const m = new Mesh(geoFrom(scope, gb), mat);
  m.castShadow = !!o.cast; m.receiveShadow = o.receive !== false; if (o.name) m.name = o.name;
  scope.add(parent, m);
  return m;
}
/* InstancedMesh with an allocated instanceColor (all white); the mesh itself is tracked so its GPU buffers are freed. */
export function instancedFrom(scope, parent, geo, mat, count, o = {}) {
  const m = scope.track(new InstancedMesh(geo, mat, count));
  m.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  m.castShadow = !!o.cast; m.receiveShadow = true; if (o.name) m.name = o.name;
  m.frustumCulled = o.cull !== false;
  scope.add(parent, m);
  return m;
}
/* a one-instance mesh at the identity (static geometry in the shared instanced program) */
export function staticFrom(scope, parent, gb, mat, o = {}) {
  if (gb.triCount === 0) return null;
  const m = instancedFrom(scope, parent, geoFrom(scope, gb), mat, 1, o);
  writeTRS(m.instanceMatrix.array, 0, 0, 0, 0, 0, 1, 1, 1);
  m.computeBoundingSphere();
  return m;
}
