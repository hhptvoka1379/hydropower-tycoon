/* Body viewer: OLD (legacy) vs NEW body side by side. Bundled with three inlined by build.mjs -> body-viewer.html. */
import { Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, BufferGeometry, BufferAttribute, MeshStandardMaterial, HemisphereLight, DirectionalLight, PointLight, Color, PlaneGeometry, GridHelper, Fog, PCFSoftShadowMap, BoxGeometry } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBody } from '../../game/player/body.js';
import { AMP, strideOf } from '../../game/player/gait.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const st = { wire: Q.get('wire') === '1', turn: Q.get('turn') === '1', night: Q.get('night') === '1', anim: Q.get('anim') || 'idle', pose: +(Q.get('pose') || -1), view: Q.get('view') || 'both', cap: Q.get('cap') !== '0', hair: Q.get('hair') || 'ponytail', suit: Q.get('suit') || '#212b66', style: Q.get('style') || 'twopiece', cam: Q.get('cam') || 'three' };

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);
const scene = new Scene(), camera = new PerspectiveCamera(40, 1, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.target.set(0, 0.9, 0);
const hemi = new HemisphereLight(0xdfe8f0, 0x6a6a50, 1), sun = new DirectionalLight(0xfff0d8, 2.2), torch = new PointLight(0xffa850, 0, 14, 2);
sun.position.set(3, 6, 2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 15 });
scene.add(hemi, sun, torch);
const ground = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x8a9a6a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const grid = new GridHelper(20, 20, 0x556040, 0x6f7f55); grid.position.y = 0.002; scene.add(grid);
const step = new Mesh(new BoxGeometry(2, 0.2, 0.4), new MeshStandardMaterial({ color: 0xa3472c, roughness: 1 })); step.position.set(3.5, 0.1, 0); step.castShadow = true; scene.add(step);

const mat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
const root = new Group(); scene.add(root);
const rigs = [];
function makeRig(body, x) {
  const g = new Group(); g.position.x = x; root.add(g);
  const meshes = {}, mats = {};
  for (const n of body.partNames) {
    const p = body.parts[n], geo = new BufferGeometry(), col = new Float32Array(p.color.length);
    for (let i = 0; i < col.length; i++) col[i] = lin(p.color[i]);
    geo.setAttribute('position', new BufferAttribute(p.position, 3)); geo.setAttribute('normal', new BufferAttribute(p.normal, 3)); geo.setAttribute('color', new BufferAttribute(col, 3));
    const m = new Mesh(geo, mat); m.castShadow = true; m.frustumCulled = false; m.matrixAutoUpdate = false; g.add(m); meshes[n] = m; mats[n] = new Float32Array(16);
  }
  return { body, g, meshes, mats, po: body.newPose(), baseY: 0 };
}
function rebuild() {
  for (const r of rigs) { root.remove(r.g); for (const m of Object.values(r.meshes)) m.geometry.dispose(); }
  rigs.length = 0;
  const opts = { cap: st.cap, hair: st.hair, suitColor: st.suit, suitStyle: st.style };
  const o = createBody({ ...opts, legacy: true }), n = createBody(opts);
  rigs.push(makeRig(o, -0.75), makeRig(n, 0.75));
  rigs[0].g.visible = st.view !== 'new'; rigs[1].g.visible = st.view !== 'old';
  if (st.view !== 'both') rigs.forEach((r) => (r.g.position.x = 0));
  $('count').textContent = `OLD ${o.tris} tris  |  NEW ${n.tris} tris  (${Object.entries(n.partTris).map(([k, v]) => k + ' ' + v).join(', ')})`;
}
let phase = 0, tt = 0;
function poseRig(r, dt) {
  const b = r.body;
  if (st.pose >= 0) {
    b.posePreset(b.rig, st.pose, { x: 0, y: r.baseY, z: 0, yaw: 0 }, r.mats);
    let mn = Infinity;
    for (const n of b.partNames) { const p = b.parts[n].position, m = r.mats[n]; for (let i = 0; i < p.length; i += 3) { const y = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13]; if (y < mn) mn = y; } }
    r.baseY -= mn; b.posePreset(b.rig, st.pose, { x: 0, y: r.baseY, z: 0, yaw: 0 }, r.mats);
  } else {
    const spd = { idle: 0, walk: 5, run: 11, stairs: 4 }[st.anim], move = spd ? 1 : 0, climb = st.anim === 'stairs' ? 1 : 0, amp = spd ? AMP(spd) : 1;
    const PO = r.po; b.pose(PO, phase, tt, move, climb);
    if (amp !== 1) { PO.hipL *= amp; PO.hipR *= amp; PO.kneeL *= amp; PO.kneeR *= amp; PO.armL *= amp; PO.armR *= amp; PO.lean *= Math.min(amp, 1.4); }
    b.posePlayer(b.rig, PO, { x: 0, y: 0, z: 0, yaw: 0 }, r.mats);
  }
  for (const n of b.partNames) { r.meshes[n].matrix.fromArray(r.mats[n]); r.meshes[n].matrixWorldNeedsUpdate = true; }
  r.hand = r.mats.armR ? [r.mats.torso[12], r.mats.torso[13] + 0.2, r.mats.torso[14]] : [0, 1, 0];
}
function applyLook() {
  mat.wireframe = st.wire; mat.needsUpdate = true;
  scene.background = new Color(st.night ? 0x0b0e14 : 0xbfd4dc); scene.fog = new Fog(st.night ? 0x0b0e14 : 0xbfd4dc, 12, 40);
  hemi.intensity = st.night ? 0.12 : 1.0; sun.intensity = st.night ? 0 : 2.2; torch.intensity = st.night ? 22 : 0;
  ground.material.color.set(st.night ? 0x3a4430 : 0x8a9a6a);
}
function setCam(name) {
  st.cam = name; controls.autoRotate = false;
  const c = { front: [0, 1.1, 3.2], side: [3.2, 1.1, 0], back: [0, 1.1, -3.2], three: [2.2, 1.4, 2.8], close: [0.6, 1.5, 1.2], follow: [0, 1.5, -4], feet: [1.2, 0.3, 1.5] }[name] || [2.2, 1.4, 2.8];
  if (Q.get('cp')) { const a = Q.get('cp').split(',').map(Number), t = (Q.get('ct') || '0,1,0').split(',').map(Number); camera.position.set(...a); controls.target.set(...t); controls.update(); return; }
  camera.position.set(...c); controls.target.set(0, name === 'close' ? 1.4 : name === 'follow' ? 1.0 : name === 'feet' ? 0.15 : 0.9, 0);
  if (name === 'follow') camera.fov = 50; else camera.fov = 40; camera.updateProjectionMatrix(); controls.update();
}
function size() { const w = $('stage').clientWidth, h = $('stage').clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', size);
function ui() {
  const bind = (id, key, num) => { const e = $(id); if (!e) return; if (e.type === 'checkbox') e.checked = !!st[key]; else e.value = st[key]; e.addEventListener('input', () => { st[key] = e.type === 'checkbox' ? e.checked : num ? +e.value : e.value; if (['cap', 'hair', 'suit', 'style', 'view'].includes(key)) rebuild(); applyLook(); }); };
  bind('wire', 'wire'); bind('turn', 'turn'); bind('night', 'night'); bind('cap', 'cap'); bind('hair', 'hair'); bind('suit', 'suit'); bind('style', 'style'); bind('anim', 'anim'); bind('pose', 'pose', true); bind('view', 'view');
  document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
}
const clockT = { last: performance.now() };
function frame(now) {
  const dt = Math.min(0.05, (now - clockT.last) / 1000); clockT.last = now; tt += dt;
  const spd = { idle: 0, walk: 5, run: 11, stairs: 4 }[st.anim];
  if (st.pose < 0 && spd) phase += dt * 6.2831853 * spd / strideOf(spd, st.anim === 'stairs' ? 1 : 0, rigs[1].body.rig.standH);
  if (Q.get('phase')) phase = +Q.get('phase');
  for (const r of rigs) poseRig(r, dt);
  if (st.turn) root.rotation.y += dt * 0.6;
  const r1 = rigs[rigs.length - 1];
  torch.position.set(root.position.x + (st.view === 'old' ? 0 : 0.4), 1.2, 0.9);
  if (st.cam === 'follow') torch.position.set(0.4, 1.8, -1.3);
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(frame);
  void r1;
}
size(); ui(); rebuild(); applyLook(); setCam(st.cam); requestAnimationFrame(frame);
