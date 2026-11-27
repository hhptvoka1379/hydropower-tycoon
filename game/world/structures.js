/* Structures feature (M4, decisions/fable.md D9): dam (earth / concrete, scaffold while raising), spillway chute on the dam's own face function,
   penstock on saddles, powerhouse with night windows, tailrace, switchyard with gantry, forecast board, rim-lookout hut, slide platform
   placeholder, lamps with glow sprites and 3 pooled warm PointLights. Faceted low-poly, Field Notes palette.
   Everything placed with surface.y, every sim height through surface.toDisplayY. Merged into: 1 lit mesh, 1 window mesh, 1 lamp mesh,
   2 flow ribbons, 1 glow Points. All resources belong to the feature scope (disposed on rebuild). */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, PointLight, Points, ShaderMaterial } from 'three';
import { MeshBuilder, lin, shade } from './builder.js';
import { buildStations } from '../player/stations.js';

const HEX = {
  paper: 0xe6dcc3, ink: 0x2b2a26, clay: 0xa3472c, moss: 0x5d7a43, ochre: 0xc08a2e,
  concrete: 0xcfc9b8, concreteBand: 0xa8a293, concreteTop: 0xdcd7c8, concreteD: 0x9d978a,
  riprap: 0x8a826c, riprapBand: 0x6b6454, gravel: 0xb9ab88,
  steel: 0x6f7a80, steelD: 0x474f55, wood: 0x9a7440, woodD: 0x6e5230, scaffold: 0xd9a521, pole: 0x56524a,
  trafo: 0x6b7a6e, fence: 0x7d8286, glass: 0x23303a, warm: 0xffd58a, flow: 0x7fbac0,
};
const C = (k) => lin(HEX[k]);
const BULB = lin(0xffe2a8);
const LAMP_I = 55;

function damProfile(cls, h) { // [u (m, + downstream), v] heel, crest upstream edge, crest downstream edge, toe
  if (cls === 'earth') return [[-1.8 * h - 4, 0], [-4, 1], [4, 1], [1.8 * h + 4, 0]];
  if (cls === 'gravity') return [[-0.05 * h - 3, 0], [-3, 1], [3, 1], [0.78 * h + 3, 0]];
  return [[-0.09 * h - 1.5, 0], [-1.5, 1], [1.5, 1], [0.12 * h + 1.5, 0]];
}

function aabbHit(o, d, b, tMax) { // slab test, returns t or Infinity
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    const oo = k === 0 ? o.x : k === 1 ? o.y : o.z, dd = k === 0 ? d.x : k === 1 ? d.y : d.z;
    const lo = b[k], hi = b[k + 3];
    if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) return Infinity; continue; }
    let a = (lo - oo) / dd, c = (hi - oo) / dd;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a; if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}
function segHit(o, d, a, b, r, tMax) { // ray vs capsule axis a-b (closest approach under r), returns t or Infinity
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = o.x - a[0], wy = o.y - a[1], wz = o.z - a[2];
  const A = d.x * d.x + d.y * d.y + d.z * d.z, B = d.x * ux + d.y * uy + d.z * uz, Cc = ux * ux + uy * uy + uz * uz;
  const D = d.x * wx + d.y * wy + d.z * wz, E = ux * wx + uy * wy + uz * wz;
  const den = A * Cc - B * B;
  let t = den > 1e-9 ? (B * E - Cc * D) / den : 0, s = den > 1e-9 ? (A * E - B * D) / den : 0;
  if (s < 0) { s = 0; t = -D / A; } else if (s > 1) { s = 1; t = (B - D) / A; }
  if (t < 0 || t > tMax) return Infinity;
  const px = o.x + d.x * t - (a[0] + ux * s), py = o.y + d.y * t - (a[1] + uy * s), pz = o.z + d.z * t - (a[2] + uz * s);
  return px * px + py * py + pz * pz <= r * r ? t : Infinity;
}

function flowMaterial(uniforms) {   // one program for every flow ribbon: speed is a per-material uniform
  const m = new MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlowT = uniforms.t; sh.uniforms.uFlowSpeed = uniforms.speed;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aArc;\nvarying float vArc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvArc = aArc;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vArc;\nuniform float uFlowT;\nuniform float uFlowSpeed;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb += 0.22 * smoothstep(0.55, 0.95, sin(vArc * 1.9 - uFlowT * uFlowSpeed));`);
  };
  m.customProgramCacheKey = () => 'ht-flow';
  return m;
}

const GLOW_VS = /* glsl */`
attribute float aSize;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 2.0, 90.0);
}`;
const GLOW_FS = /* glsl */`
uniform float uNight;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * uNight;
  if (a < 0.01) discard;
  gl_FragColor = vec4(1.0, 0.78, 0.45, a);
  #include <colorspace_fragment>
}`;

export function createStructures(world) {
  const Sim = world.Sim, scene = world.scene;
  // pooled lamp lights: created once (constant light count), intensity driven per frame
  const pool = [];
  for (let i = 0; i < 3; i++) {
    const l = new PointLight(0xffd9a0, 0, 60, 2);
    l.position.set(0, -1000, 0);
    scene.add(l); pool.push(l);
  }
  const flowU = { t: { value: 0 }, speed: { value: 5 } }, tailU = { t: { value: 0 }, speed: { value: 2 } };
  const fx = { lamps: [], picks: [], windowsMat: null, bulbMat: null, glow: null, chute: null, tail: null, chuteMat: null, tailMat: null, run: 0, counts: {} };
  let built = null;

  const feature = {
    name: 'structures',
    pool, fx,
    signature(site) {
      const dm = site.dam, L = site.layout;
      return [site.kind, dm.built ? 1 : 0, dm.cls, dm.height, dm.raising ? dm.raising.to : '', site.penstock.D, L.dam.x.toFixed(1), L.dam.z.toFixed(1), L.ph.x.toFixed(1), L.ph.z.toFixed(1)].join('|');
    },

    build(scope, site, surface, env) {
      const VEX = surface.VEX, L = site.layout, dm = site.dam;
      const sy = (x, z) => surface.y(x, z);
      const toD = (v) => surface.toDisplayY(v);
      const main = new MeshBuilder(), win = new MeshBuilder(), bulbs = new MeshBuilder();
      const picks = [], lamps = [], blockers = [], glowPts = [];
      const chuteQuads = [], tailQuads = [];
      fx.counts = {};
      const count = (name, b0) => { fx.counts[name] = (fx.counts[name] || 0) + (main.count - b0); };

      let stations = null;
      try { stations = buildStations(site, surface); } catch (e) { stations = null; }
      world.stations = stations;   // shared with the features builder (stations-link.js reads world.stations)
      const station = (id) => (stations ? stations.find((s) => s.id === id) : null);
      const dirv = L.dir && (L.dir.x || L.dir.z) ? L.dir : { x: 1, z: 0 };
      const dl = Math.hypot(dirv.x, dirv.z) || 1, dir = { x: dirv.x / dl, z: dirv.z / dl };
      const addPick = (type, x0, y0, z0, x1, y1, z1) => picks.push({ type, box: [x0, y0, z0, x1, y1, z1] });
      const addLamp = (x, y, z) => {
        lamps.push({ x, y, z });
        bulbs.box(x, y - 0.16, z, 0.32, 0.32, 0.32, BULB, 0, { bottom: true });
        glowPts.push(x, y, z);
      };

      /* ============ powerhouse (axis-aligned 11 x 8 footprint = the walker's blocker) ============ */
      const ph = L.ph, PW = 11, PD = 8, padY = toD(L.padY);
      const nAxis = Math.abs(dir.x) >= Math.abs(dir.z) ? { x: -Math.sign(dir.x) || -1, z: 0 } : { x: 0, z: -Math.sign(dir.z) || -1 }; // door faces the dam
      const lat = { x: -nAxis.z, z: nAxis.x };
      {
        const b0 = main.count, y0 = padY;
        main.box(ph.x, y0 - 0.4, ph.z, PW + 1.2, 0.7, PD + 1.2, C('concreteD'));
        main.box(ph.x, y0 + 0.3, ph.z, PW, 4.9, PD, C('paper'), 0, { sideShade: 0.96 });
        main.gable(ph.x, y0 + 5.2, ph.z, PW, PD, 2.4, 0.55, C('clay'), true);
        main.box(ph.x - 2.5, y0 + 7.0, ph.z + 0.8, 0.9, 1.6, 0.9, C('steelD'));   // vent stack
        // door + lintel on the dam side
        const faceOff = nAxis.x ? PW / 2 : PD / 2;
        const fx0 = ph.x + nAxis.x * faceOff, fz0 = ph.z + nAxis.z * faceOff;
        const dsx = nAxis.x ? 0.3 : 2.6, dsz = nAxis.x ? 2.6 : 0.3;
        main.box(fx0 + nAxis.x * 0.08, y0 + 0.3, fz0 + nAxis.z * 0.08, dsx, 3.0, dsz, C('ink'));
        main.box(fx0 + nAxis.x * 0.14, y0 + 3.3, fz0 + nAxis.z * 0.14, nAxis.x ? 0.4 : 3.2, 0.35, nAxis.x ? 3.2 : 0.4, C('concreteD'));
        main.box(fx0 + nAxis.x * 0.9, y0 + 0.3, fz0 + nAxis.z * 0.9, nAxis.x ? 1.2 : 3.6, 0.25, nAxis.x ? 3.6 : 1.2, C('concrete')); // step
        // windows: emissive quads on the long faces and the far gable face, dark frames behind
        const wq = (cx, cy, cz, w, h, nx, nz) => {
          const px = -nz, pz = nx;
          const A = [cx - px * w / 2, cy - h / 2, cz - pz * w / 2], B = [cx + px * w / 2, cy - h / 2, cz + pz * w / 2], Cc = [cx + px * w / 2, cy + h / 2, cz + pz * w / 2], D = [cx - px * w / 2, cy + h / 2, cz - pz * w / 2];
          win.quad(A, B, Cc, D, lin(HEX.warm), [nx, 0, nz]);
        };
        for (const s of [-1, 1]) {   // z faces (long, 11 m)
          if (nAxis.z === s) continue;
          for (const x of [-3.9, -1.3, 1.3, 3.9]) {
            main.box(ph.x + x, y0 + 1.9, ph.z + s * (PD / 2 + 0.03), 1.5, 1.7, 0.1, C('ink'));
            wq(ph.x + x, y0 + 2.75, ph.z + s * (PD / 2 + 0.1), 1.2, 1.4, 0, s);
          }
        }
        for (const s of [-1, 1]) {   // x faces
          if (nAxis.x === s) continue;
          for (const z of [-1.6, 1.6]) {
            main.box(ph.x + s * (PW / 2 + 0.03), y0 + 1.9, ph.z + z, 0.1, 1.7, 1.5, C('ink'));
            wq(ph.x + s * (PW / 2 + 0.1), y0 + 2.75, ph.z + z, 1.2, 1.4, s, 0);
          }
        }
        // flanking windows on the door face
        for (const o of [-3.4, 3.4]) {
          main.box(fx0 + nAxis.x * 0.03 + lat.x * o, y0 + 1.9, fz0 + nAxis.z * 0.03 + lat.z * o, nAxis.x ? 0.1 : 1.5, 1.7, nAxis.x ? 1.5 : 0.1, C('ink'));
          wq(fx0 + nAxis.x * 0.1 + lat.x * o, y0 + 2.75, fz0 + nAxis.z * 0.1 + lat.z * o, 1.2, 1.4, nAxis.x, nAxis.z);
        }
        addPick('powerhouse', ph.x - PW / 2 - 0.6, y0 - 0.4, ph.z - PD / 2 - 0.6, ph.x + PW / 2 + 0.6, y0 + 7.6, ph.z + PD / 2 + 0.6);
        blockers.push({ x0: ph.x - PW / 2, z0: ph.z - PD / 2, x1: ph.x + PW / 2, z1: ph.z + PD / 2 });
        // yard lamps at the four corners
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const x = ph.x + sx * (PW / 2 + 1.6), z = ph.z + sz * (PD / 2 + 1.6);
          main.box(x, y0 - 0.2, z, 0.16, 3.6, 0.16, C('pole'));
          addLamp(x, y0 + 3.55, z);
        }
        count('powerhouse', b0);
      }

      /* ============ switchyard behind the powerhouse ============ */
      {
        const b0 = main.count, y0 = padY;
        const cx = ph.x - nAxis.x * (PW / 2 + 9.5), cz = ph.z - nAxis.z * (PD / 2 + 9.5), W = nAxis.x ? 6.4 : 9, Dd = nAxis.x ? 9 : 6.4;
        main.box(cx, y0 - 0.2, cz, W, 0.35, Dd, C('concreteD'));
        for (const o of [-1.9, 1.9]) {                                   // two transformers with fins
          const tx = cx + (nAxis.x ? 0 : o), tz = cz + (nAxis.x ? o : 0);
          main.box(tx, y0 + 0.15, tz, 2.0, 2.3, 1.6, C('trafo'));
          for (const f of [-0.5, 0, 0.5]) main.box(tx, y0 + 0.4, tz + f, 2.2, 1.7, 0.1, shade(C('trafo'), 0.8));   // cooling fins
          main.box(tx, y0 + 2.45, tz, 0.3, 0.7, 0.3, C('steelD'));
        }
        // gantry: two posts at the ends of the longer axis, crossbeam, three insulators
        const alongX = W >= Dd, half = (alongX ? W : Dd) / 2 - 0.7, gz0 = alongX ? cz - Dd / 2 + 0.8 : cz, gx0 = alongX ? cx : cx - W / 2 + 0.8;
        const pp = (s2) => [alongX ? gx0 + s2 * half : gx0, alongX ? gz0 : gz0 + s2 * half];
        for (const s2 of [-1, 1]) { const q = pp(s2); main.box(q[0], y0 + 0.1, q[1], 0.35, 6.5, 0.35, C('steel')); }
        main.box(gx0, y0 + 6.4, gz0, alongX ? half * 2 : 0.3, 0.3, alongX ? 0.3 : half * 2, C('steel'));
        for (const s2 of [-0.5, 0, 0.5]) {
          const ix = alongX ? gx0 + s2 * half * 1.6 : gx0, iz = alongX ? gz0 : gz0 + s2 * half * 1.6;
          main.cyl([ix, y0 + 6.3, iz], [ix, y0 + 5.2, iz], 0.12, 6, C('paper'), true);
        }
        // fence
        const fh = 1.5;
        main.box(cx, y0 + 0.15, cz - Dd / 2, W, fh, 0.06, C('fence'), 0, { bottom: false });
        main.box(cx, y0 + 0.15, cz + Dd / 2, W, fh, 0.06, C('fence'), 0, { bottom: false });
        main.box(cx - W / 2, y0 + 0.15, cz, 0.06, fh, Dd, C('fence'), 0, { bottom: false });
        main.box(cx + W / 2, y0 + 0.15, cz, 0.06, fh, Dd, C('fence'), 0, { bottom: false });
        for (const [lx, lz] of [[-1, -1], [1, 1]]) {
          const x = cx + lx * (W / 2 + 0.6), z = cz + lz * (Dd / 2 + 0.6);
          main.box(x, y0 - 0.2, z, 0.14, 3.4, 0.14, C('pole'));
          addLamp(x, y0 + 3.3, z);
        }
        blockers.push({ x0: cx - W / 2 - 0.3, z0: cz - Dd / 2 - 0.3, x1: cx + W / 2 + 0.3, z1: cz + Dd / 2 + 0.3 });
        addPick('switchyard', cx - W / 2, y0 - 0.2, cz - Dd / 2, cx + W / 2, y0 + 6.8, cz + Dd / 2);
        count('switchyard', b0);
      }

      /* ============ tailrace: lined channel + flowing water to the lake ============ */
      {
        const b0 = main.count, T = L.tail;
        let tx = T.x - ph.x, tz = T.z - ph.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const px = -tz, pz = tx, start = 6.5, end = Math.max(start + 12, tl), step = 5;
        let prev = null, arc = 0;
        const q = (x, z, o) => [x + px * o, 0, z + pz * o];
        main.box(ph.x + tx * (start - 1.2), padY - 0.5, ph.z + tz * (start - 1.2), 4.2, 2.2, 4.2, C('concreteD'), Math.atan2(tz, tx)); // draft-tube outlet
        for (let s = start; s <= end; s += step) {
          const cx = ph.x + tx * s, cz = ph.z + tz * s;
          const cur = { l: q(cx, cz, -2.9), r: q(cx, cz, 2.9), il: q(cx, cz, -2.5), ir: q(cx, cz, 2.5), arc };
          for (const k of ['l', 'r', 'il', 'ir']) cur[k][1] = sy(cur[k][0], cur[k][2]);
          if (prev) {
            for (const [a, b, o] of [['l', 'l', -1], ['r', 'r', 1]]) {   // low lining walls on both banks
              const A = [prev[a][0], prev[a][1] - 0.4, prev[a][2]], B = [cur[b][0], cur[b][1] - 0.4, cur[b][2]];
              const A2 = [A[0], prev[a][1] + 0.55, A[2]], B2 = [B[0], cur[b][1] + 0.55, B[2]];
              main.quad(A, B, B2, A2, C('concrete'), [px * -o, 0, pz * -o]);
              main.quad(A2, B2, [B2[0] - px * o * 0.5, B2[1], B2[2] - pz * o * 0.5], [A2[0] - px * o * 0.5, A2[1], A2[2] - pz * o * 0.5], C('concreteTop'), [0, 1, 0]);
            }
            const lift = 0.3, seg = Math.hypot(cur.il[0] - prev.il[0], cur.il[2] - prev.il[2]);
            tailQuads.push([[prev.il[0], prev.il[1] + lift, prev.il[2]], [prev.ir[0], prev.ir[1] + lift, prev.ir[2]], [cur.ir[0], cur.ir[1] + lift, cur.ir[2]], [cur.il[0], cur.il[1] + lift, cur.il[2]], prev.arc, prev.arc + seg]);
            arc += seg; cur.arc = arc;
          }
          prev = cur;
        }
        count('tailrace', b0);
      }

      /* ============ dam ============ */
      let damInfo = null;
      if (dm.built) {
        const b0 = main.count, d = L.dam, h = dm.height, crestSim = site.upper.bottom + h, crestY = toD(crestSim);
        const prof = damProfile(dm.cls, h), u0 = prof[0][0], u1 = prof[1][0], u2 = prof[2][0], u3 = prof[3][0];
        const earth = dm.cls === 'earth';
        const NCOL = 28, cols = [];
        for (let i = 0; i <= NCOL; i++) {
          const t = -1 + (2 * i) / NCOL; let x, z, ox, oz;
          if (d.arc) { const th = Math.atan2(L.dir.z, L.dir.x) + (t * d.span) / d.r; x = d.cx + Math.cos(th) * d.r; z = d.cz + Math.sin(th) * d.r; ox = Math.cos(th); oz = Math.sin(th); }
          else { x = d.x + d.dx * t * d.span; z = d.z + d.dz * t * d.span; ox = -d.dz; oz = d.dx; }
          const base = sy(x, z);
          cols.push({ x, z, ox, oz, base, yb: base - 2 });
        }
        const P = (c, u, v) => [c.x + c.ox * u, c.yb + (crestY - c.yb) * v, c.z + c.oz * u];
        const upU = (v) => u0 + (u1 - u0) * v, dnU = (v) => u3 + (u2 - u3) * v;   // the dam face functions (shared with the chute)
        const lerpCol = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ox: a.ox + (b.ox - a.ox) * t, oz: a.oz + (b.oz - a.oz) * t, base: a.base + (b.base - a.base) * t, yb: a.yb + (b.yb - a.yb) * t });
        let first = -1, last = -1;
        const inc = (c) => c.base <= crestY - 0.5;
        for (let i = 0; i < NCOL; i++) if (inc(cols[i]) || inc(cols[i + 1])) { if (first < 0) first = i; last = i + 1; }
        if (first >= 0) {
          const freeY = toD(crestSim - Sim.CONFIG.res.freeboard);
          const bandA = toD(crestSim - Sim.CONFIG.res.freeboard - 1.2), bandB = freeY + 0.5 * VEX;
          const cUp = earth ? C('riprap') : C('concrete'), cBand = earth ? C('riprapBand') : C('concreteBand');
          const cTop = earth ? C('gravel') : C('concreteTop');
          const cDn = earth ? C('moss') : C('concrete');
          const vOf = (c, y) => Math.max(0, Math.min(1, (y - c.yb) / (crestY - c.yb)));
          for (let i = first; i < last; i++) {
            const a = cols[i], b = cols[i + 1];
            const rowsA = [0, vOf(a, bandA), vOf(a, bandB), 1], rowsB = [0, vOf(b, bandA), vOf(b, bandB), 1];
            for (let r = 0; r < 3; r++) {
              main.quad(P(a, upU(rowsA[r]), rowsA[r]), P(b, upU(rowsB[r]), rowsB[r]), P(b, upU(rowsB[r + 1]), rowsB[r + 1]), P(a, upU(rowsA[r + 1]), rowsA[r + 1]), r === 1 ? cBand : cUp, [-a.ox, 0.3, -a.oz]);
            }
            main.quad(P(a, u1, 1), P(b, u1, 1), P(b, u2, 1), P(a, u2, 1), cTop, [0, 1, 0]);
            const steps = earth ? 3 : 6;
            for (let s = 0; s < steps; s++) {
              const v0 = s / steps, v1 = (s + 1) / steps, k = s % 2 ? 0.93 : 1;
              main.quad(P(a, dnU(v0), v0), P(b, dnU(v0), v0), P(b, dnU(v1), v1), P(a, dnU(v1), v1), shade(cDn, k), [a.ox, 0.3, a.oz]);
            }
            // foundation skirts under heel and toe: no gap on a steep abutment
            for (const [u, hint] of [[u0, -1], [u3, 1]]) {
              const pa = P(a, u, 0), pb = P(b, u, 0);
              const ga = sy(pa[0], pa[2]) - 0.6, gb = sy(pb[0], pb[2]) - 0.6;
              if (ga < pa[1] - 0.02 || gb < pb[1] - 0.02) main.quad(pa, pb, [pb[0], Math.min(gb, pb[1]), pb[2]], [pa[0], Math.min(ga, pa[1]), pa[2]], shade(cUp, 0.7), [hint * a.ox, 0, hint * a.oz]);
            }
          }
          for (const [idx, sgn] of [[first, -1], [last, 1]]) {   // abutment end walls
            const c = cols[idx], tgx = cols[last].x - cols[first].x, tgz = cols[last].z - cols[first].z, tl = Math.hypot(tgx, tgz) || 1;
            const hint = [sgn * tgx / tl, 0, sgn * tgz / tl];
            const pts = [P(c, u0, 0), P(c, u1, 1), P(c, u2, 1), P(c, u3, 0)];
            main.quad(pts[0], pts[1], pts[2], pts[3], shade(cUp, 0.85), hint);
          }
          // crest rails and posts
          for (let i = first; i <= last; i++) {
            const c = cols[i];
            if ((i - first) % 2) continue;
            for (const u of [u1 + 0.4, u2 - 0.4]) main.box(c.x + c.ox * u, crestY, c.z + c.oz * u, 0.14, 1.1, 0.14, C('steel'));
          }
          for (let i = first; i < last; i++) {
            const a = cols[i], b = cols[i + 1];
            for (const u of [u1 + 0.4, u2 - 0.4]) {
              const ax = a.x + a.ox * u, az = a.z + a.oz * u, bx = b.x + b.ox * u, bz = b.z + b.oz * u;
              main.box((ax + bx) / 2, crestY + 1.0, (az + bz) / 2, Math.hypot(bx - ax, bz - az), 0.07, 0.07, C('steel'), Math.atan2(bz - az, bx - ax));
            }
          }
          // spillway chute at the right abutment: floor, walls, ribbon, all from the same face functions
          const ci = Math.max(first, last - 3), ca = cols[ci], cb = cols[Math.min(last, ci + 1)];
          const cl = lerpCol(ca, cb, 0.1), cr = lerpCol(ca, cb, 0.9), cmid = lerpCol(ca, cb, 0.5);
          const rows = 8; let arc = 0;
          const vs = []; for (let s = 0; s <= rows; s++) vs.push(1 - s / rows);
          const cF = C('concreteD'), cW = C('concrete');
          for (let s = 0; s < rows; s++) {
            const v0 = vs[s], v1 = vs[s + 1];
            const A = P(cl, dnU(v0), v0), B = P(cr, dnU(v0), v0), Cc = P(cr, dnU(v1), v1), D = P(cl, dnU(v1), v1);
            for (const p of [A, B, Cc, D]) p[1] += 0.3;
            main.quad(A, B, Cc, D, cF, [cmid.ox, 1, cmid.oz]);
            for (const [pa, pb, sd] of [[A, D, cl], [B, Cc, cr]]) {
              const hint = [(sd === cl ? -1 : 1) * -cmid.oz, 0, (sd === cl ? -1 : 1) * cmid.ox];
              main.quad(pa, pb, [pb[0], pb[1] + 0.9, pb[2]], [pa[0], pa[1] + 0.9, pa[2]], cW, hint);
            }
            const seg = Math.hypot(Cc[0] - B[0], Cc[1] - B[1], Cc[2] - B[2]);
            const lift = 0.35;
            chuteQuads.push([[A[0], A[1] + lift, A[2]], [B[0], B[1] + lift, B[2]], [Cc[0], Cc[1] + lift, Cc[2]], [D[0], D[1] + lift, D[2]], arc, arc + seg]);
            arc += seg;
          }
          // apron beyond the toe, following the ground
          {
            const wx = cr.x - cl.x, wz = cr.z - cl.z, hw = Math.hypot(wx, wz) / 2, nx = wx / (hw * 2 || 1), nz = wz / (hw * 2 || 1);
            let prevA = null;
            for (let k = 0; k <= 5; k++) {
              const u = u3 + k * 6, mx = cmid.x + cmid.ox * u, mz = cmid.z + cmid.oz * u;
              const L1 = [mx - nx * hw, 0, mz - nz * hw], R1 = [mx + nx * hw, 0, mz + nz * hw];
              L1[1] = sy(L1[0], L1[2]) + 0.25; R1[1] = sy(R1[0], R1[2]) + 0.25;
              if (prevA) {
                main.quad(prevA[0], prevA[1], R1, L1, cF, [0, 1, 0]);
                const seg = Math.hypot(R1[0] - prevA[1][0], R1[2] - prevA[1][2]);
                chuteQuads.push([[prevA[0][0], prevA[0][1] + 0.3, prevA[0][2]], [prevA[1][0], prevA[1][1] + 0.3, prevA[1][2]], [R1[0], R1[1] + 0.3, R1[2]], [L1[0], L1[1] + 0.3, L1[2]], arc, arc + seg]);
                arc += seg;
              }
              prevA = [L1, R1];
            }
          }
          // intake tower on the upstream face
          const ic = cols[(first + last) >> 1], ix = ic.x + ic.ox * (u0 * 0.55 - 5), iz = ic.z + ic.oz * (u0 * 0.55 - 5);
          main.box(ix, sy(ix, iz) - 1, iz, 3.4, crestY + 3 - sy(ix, iz) + 1, 3.4, C('concreteD'));
          main.box(ix, crestY + 3, iz, 4.4, 1.4, 4.4, C('clay'));
          // raise in progress: yellow scaffold up to the target height
          if (dm.raising) {
            const toY = toD(site.upper.bottom + dm.raising.to);
            for (let i = first; i <= last; i += 2) {
              const c = cols[i];
              for (const u of [u1 - 1.2, u2 + 1.2]) main.box(c.x + c.ox * u, crestY, c.z + c.oz * u, 0.22, toY - crestY, 0.22, C('scaffold'));
            }
            for (let y = crestY + 2.25; y <= toY + 0.01; y += 2.25) {
              for (let i = first; i < last; i += 2) {
                const a = cols[i], b = cols[Math.min(last, i + 2)];
                for (const u of [u1 - 1.2, u2 + 1.2]) {
                  const ax = a.x + a.ox * u, az = a.z + a.oz * u, bx = b.x + b.ox * u, bz = b.z + b.oz * u;
                  main.box((ax + bx) / 2, y, (az + bz) / 2, Math.hypot(bx - ax, bz - az), 0.16, 0.16, C('scaffold'), Math.atan2(bz - az, bx - ax));
                }
              }
            }
          }
          // crest lamps about every 20 m along the downstream edge
          let acc = 0, nextL = 6;
          for (let i = first; i < last; i++) {
            const a = cols[i], b = cols[i + 1], seg = Math.hypot(b.x - a.x, b.z - a.z);
            while (nextL <= acc + seg) {
              const t = (nextL - acc) / seg, x = a.x + (b.x - a.x) * t + a.ox * (u2 - 0.4), z = a.z + (b.z - a.z) * t + a.oz * (u2 - 0.4);
              main.box(x, crestY, z, 0.14, 3.0, 0.14, C('pole'));
              addLamp(x, crestY + 3.0, z);
              nextL += 20;
            }
            acc += seg;
          }
          // crest walkway: a floor provider (display y of the crest) over the walkable strip
          const hwk = Math.min(u2 - u1, 8) / 2 - 0.55, uc = (u1 + u2) / 2;
          const provider = (x, z) => {
            for (let i = first; i < last; i++) {
              const a = cols[i], b = cols[i + 1], sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz;
              const t = ((x - a.x) * sx + (z - a.z) * sz) / l2;
              if (t < 0 || t > 1) continue;
              const ox = (a.ox + b.ox) / 2, oz = (a.oz + b.oz) / 2, ol = Math.hypot(ox, oz) || 1;
              const u = ((x - a.x - sx * t) * ox + (z - a.z - sz * t) * oz) / ol;
              if (Math.abs(u - uc) <= hwk) return crestY;
            }
            return -Infinity;
          };
          scope.onDispose(surface.addFloorProvider(provider));
          // picking boxes per segment
          for (let i = first; i < last; i += 2) {
            const a = cols[i], b = cols[Math.min(last, i + 2)], pts = [P(a, u0, 0), P(a, u3, 0), P(b, u0, 0), P(b, u3, 0), P(a, u1, 1), P(b, u2, 1)];
            let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
            for (const p of pts) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); mnz = Math.min(mnz, p[2]); mxz = Math.max(mxz, p[2]); }
            addPick('dam', mnx, mny, mnz, mxx, mxy + 1.2, mxz);
          }
          damInfo = { cols, first, last, crestY, prof };
        }
        count('dam', b0);
      }
      fx.damInfo = damInfo;

      /* ============ penstock on saddles ============ */
      {
        const b0 = main.count;
        const route = Sim.penstockRoute(site);
        const R = Math.max(1.2, site.penstock.D) / 2;           // true diameter (fable.md D1), visual minimum 1.2 m
        const pts = [];
        for (let i = 1; i < route.length - 1; i++) pts.push([route[i].x, route[i].z]);
        const wallX = ph.x + nAxis.x * (PW / 2) - lat.x * 3.3 + nAxis.x * 0.2, wallZ = ph.z + nAxis.z * (PD / 2) - lat.z * 3.3 + nAxis.z * 0.2;
        pts.push([wallX, wallZ]);
        // resample about every 5 m
        const sm = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(l / 5));
          for (let k = 1; k <= n; k++) sm.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        }
        const gy = sm.map((p) => sy(p[0], p[1]));
        const py = sm.map((p, i) => {
          const a = gy[Math.max(0, i - 1)], b = gy[i], c = gy[Math.min(gy.length - 1, i + 1)];
          return Math.max(b, (a + b + c) / 3) + R + 0.25;
        });
        py[py.length - 1] = Math.max(py[py.length - 1], padY + 3.0);
        for (let i = 1; i < sm.length; i++) {
          const A = [sm[i - 1][0], py[i - 1], sm[i - 1][1]], B = [sm[i][0], py[i], sm[i][1]];
          main.cyl(A, B, R, 8, C('steel'), false);
          if (i % 3 === 0) main.cyl([B[0] - (B[0] - A[0]) * 0.06, B[1] - (B[1] - A[1]) * 0.06, B[2] - (B[2] - A[2]) * 0.06], [B[0] + 0.001, B[1], B[2]], R * 1.15, 8, C('steelD'), true);
          if (i % 2 === 0) {   // saddle from below the ground up to the pipe
            const yaw = Math.atan2(B[2] - A[2], B[0] - A[0]), g = gy[i] - 0.7;
            main.box(B[0], g, B[2], 1.2, py[i] - R * 0.7 - g, R * 2.2, C('concreteD'), yaw);
          }
          picks.push({ type: 'penstock', seg: [A, B], r: R + 0.5 });
        }
        // valve house straddling the middle of the pipe
        const mi = sm.length >> 1, vx = sm[mi][0], vz = sm[mi][1], vy = Math.min(...[gy[mi - 1], gy[mi], gy[mi + 1]]);
        main.box(vx, vy - 0.4, vz, 4.2, py[mi] + R + 0.9 - vy + 0.4, 4.2, C('paper'), 0);
        main.gable(vx, py[mi] + R + 0.5, vz, 4.2, 4.2, 1.4, 0.35, C('clay'), true);
        addPick('penstock', vx - 2.3, vy - 0.4, vz - 2.3, vx + 2.3, py[mi] + R + 2.4, vz + 2.3);
        blockers.push({ x0: vx - 2.2, z0: vz - 2.2, x1: vx + 2.2, z1: vz + 2.2 });
        count('penstock', b0);
      }

      /* ============ forecast board, rim-lookout hut, slide platform ============ */
      {
        const b0 = main.count;
        // board
        const sb = station('board');
        const sp = sb || { x: ph.x + nAxis.x * 12 + lat.x * 10, z: ph.z + nAxis.z * 12 + lat.z * 10 };
        let fxs = ph.x - sp.x, fzs = ph.z - sp.z; const fl = Math.hypot(fxs, fzs) || 1; fxs /= fl; fzs /= fl;
        const bx = sp.x + fxs * 2.2, bz = sp.z + fzs * 2.2, yaw = Math.atan2(-fxs, fzs);   // panel faces the station
        const g = Math.min(sy(bx, bz), sy(bx + 1.2, bz), sy(bx - 1.2, bz), sy(bx, bz + 1.2), sy(bx, bz - 1.2));
        const ux = Math.cos(yaw), uz = Math.sin(yaw);
        for (const s of [-1, 1]) main.box(bx + ux * s * 1.1, g - 0.5, bz + uz * s * 1.1, 0.16, 3.1, 0.16, C('woodD'));
        main.box(bx, g + 1.0, bz, 2.8, 1.7, 0.1, C('ink'), yaw);
        main.box(bx + (-uz) * 0.0 + fxs * -0.0, g + 1.1, bz, 2.5, 1.5, 0.12, C('paper'), yaw);
        main.box(bx, g + 2.75, bz, 3.0, 0.14, 0.5, C('clay'), yaw);
        addPick('board', bx - 1.6, g - 0.5, bz - 1.6, bx + 1.6, g + 3.0, bz + 1.6);
        blockers.push({ x0: bx - 1.3, z0: bz - 1.3, x1: bx + 1.3, z1: bz + 1.3 });
        // hut beside the lookout
        const lk = station('lookout');
        {
          const sx = lk ? lk.x : ph.x + 150, sz = lk ? lk.z : ph.z + 150;
          let ax = sx - ph.x, az = sz - ph.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
          const hx = sx + ax * 4.5, hz = sz + az * 4.5, HW = 3.2, HD = 2.6, HH = 2.5;
          const gmin = Math.min(sy(hx - HW / 2, hz - HD / 2), sy(hx + HW / 2, hz - HD / 2), sy(hx - HW / 2, hz + HD / 2), sy(hx + HW / 2, hz + HD / 2));
          const gmax = Math.max(sy(hx - HW / 2, hz - HD / 2), sy(hx + HW / 2, hz - HD / 2), sy(hx - HW / 2, hz + HD / 2), sy(hx + HW / 2, hz + HD / 2));
          main.box(hx, gmin - 0.8, hz, HW + 0.4, gmax - gmin + 0.9, HD + 0.4, C('concreteD'));
          main.box(hx, gmax + 0.1, hz, HW, HH, HD, C('wood'));
          main.gable(hx, gmax + 0.1 + HH, hz, HW, HD, 1.2, 0.35, C('clay'), true);
          const faceX = Math.abs(ax) >= Math.abs(az) ? -Math.sign(ax) : 0, faceZ = faceX ? 0 : -Math.sign(az);   // door faces the station
          main.box(hx + faceX * (HW / 2 + 0.03), gmax + 0.1, hz + faceZ * (HD / 2 + 0.03), faceX ? 0.1 : 1.0, 1.9, faceX ? 1.0 : 0.1, C('ink'));
          const wxq = (cx, cy, cz, w, h, nx, nz) => { const px = -nz, pz = nx; win.quad([cx - px * w / 2, cy - h / 2, cz - pz * w / 2], [cx + px * w / 2, cy - h / 2, cz + pz * w / 2], [cx + px * w / 2, cy + h / 2, cz + pz * w / 2], [cx - px * w / 2, cy + h / 2, cz - pz * w / 2], lin(HEX.warm), [nx, 0, nz]); };
          wxq(hx, gmax + 1.6, hz + (faceZ ? -faceZ : 1) * (HD / 2 + 0.08), 0.9, 0.7, 0, faceZ ? -faceZ : 1);
          addPick('hut', hx - HW / 2, gmin - 0.8, hz - HD / 2, hx + HW / 2, gmax + 4.2, hz + HD / 2);
          blockers.push({ x0: hx - HW / 2 - 0.2, z0: hz - HD / 2 - 0.2, x1: hx + HW / 2 + 0.2, z1: hz + HD / 2 + 0.2 });
        }
        // slide platform & water slide chute down into the lower lake
        {
          const ss = station('slide'), sx = ss ? ss.x : ph.x - 40, sz = ss ? ss.z : ph.z - 40;
          let ax = L.lo.x - sx, az = L.lo.z - sz; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
          const pxp = -az, pzp = ax;
          const cx = sx + ax * 4.5, cz = sz + az * 4.5, S = 3.4, hgt = 2.4;
          const gs = [sy(cx - S / 2, cz - S / 2), sy(cx + S / 2, cz - S / 2), sy(cx - S / 2, cz + S / 2), sy(cx + S / 2, cz + S / 2)];
          const gmax = Math.max(...gs), deck = gmax + hgt;
          for (const [px, pz, gg] of [[-1, -1, gs[0]], [1, -1, gs[1]], [-1, 1, gs[2]], [1, 1, gs[3]]]) main.box(cx + px * (S / 2 - 0.2), gg - 0.4, cz + pz * (S / 2 - 0.2), 0.3, deck - gg + 0.4, 0.3, C('woodD'));
          main.box(cx, deck, cz, S, 0.2, S, C('wood'));
          for (const [rx, rz, w, dd] of [[0, -1, S, 0.06], [0, 1, S, 0.06], [-1, 0, 0.06, S], [1, 0, 0.06, S]]) main.box(cx + rx * (S / 2 - 0.05), deck + 0.2, cz + rz * (S / 2 - 0.05), w, 1.0, dd, C('woodD'), 0, { bottom: false });
          addPick('slide', cx - S / 2, gmax - 0.5, cz - S / 2, cx + S / 2, deck + 1.3, cz + S / 2);
          blockers.push({ x0: cx - S / 2 - 0.2, z0: cz - S / 2 - 0.2, x1: cx + S / 2 + 0.2, z1: cz + S / 2 + 0.2 });

          // trace chute toward the lower lake shoreline (or max 85 m)
          const loSurf = surface.toDisplayY(site.lower.bottom + 5);
          let len = 42;
          for (let d = 12; d <= 110; d += 3) {
            const x = cx + ax * d, z = cz + az * d;
            if (sy(x, z) <= loSurf - 0.3) { len = d + 3; break; }
            len = d;
          }
          const N = Math.max(8, Math.round(len / 4));
          const chute = [];
          const startY = deck + 0.22;
          const endY = Math.max(loSurf + 0.9, sy(cx + ax * len, cz + az * len) + 1.1);
          for (let i = 0; i <= N; i++) {
            const u = i / N;
            const d = 1.6 + u * len;
            const sway = Math.sin(u * Math.PI * 2) * 3.2 * Math.sin(u * Math.PI);
            const x = cx + ax * d + pxp * sway, z = cz + az * d + pzp * sway;
            const linY = startY + (endY - startY) * Math.pow(u, 0.85);
            const minGround = sy(x, z) + (u > 0.85 ? 0.55 : 0.75);
            const y = Math.max(linY, minGround);
            chute.push({ x, y, z });
          }
          // keep chute monotonically descending until exit ski-jump flare
          for (let i = 1; i < chute.length - 1; i++) {
            if (chute[i].y > chute[i - 1].y - 0.12) chute[i].y = Math.max(sy(chute[i].x, chute[i].z) + 0.45, chute[i - 1].y - 0.12);
          }
          const slideBlue = lin(0x287ea6), slideRim = lin(0x1b5c7d);
          let arc = 0;
          const hw = 0.65, wallH = 0.42;
          for (let i = 0; i < chute.length - 1; i++) {
            const A = chute[i], B = chute[i + 1];
            const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, segL = Math.hypot(dx, dy, dz) || 1;
            const hlen = Math.hypot(dx, dz) || 1, lx = -dz / hlen, lz = dx / hlen;
            // water ribbon inside trough
            const wA0 = [A.x - lx * (hw - 0.08), A.y + 0.09, A.z - lz * (hw - 0.08)], wA1 = [A.x + lx * (hw - 0.08), A.y + 0.09, A.z + lz * (hw - 0.08)];
            const wB0 = [B.x - lx * (hw - 0.08), B.y + 0.09, B.z - lz * (hw - 0.08)], wB1 = [B.x + lx * (hw - 0.08), B.y + 0.09, B.z + lz * (hw - 0.08)];
            tailQuads.push([wA0, wA1, wB1, wB0, arc, arc + segL]);
            arc += segL;
            // sloped trough floor & underside
            const fA0 = [A.x - lx * hw, A.y, A.z - lz * hw], fA1 = [A.x + lx * hw, A.y, A.z + lz * hw];
            const fB0 = [B.x - lx * hw, B.y, B.z - lz * hw], fB1 = [B.x + lx * hw, B.y, B.z + lz * hw];
            main.quad(fA0, fA1, fB1, fB0, slideBlue, [0, 1, 0]);
            const uA0 = [fA0[0], fA0[1] - 0.14, fA0[2]], uA1 = [fA1[0], fA1[1] - 0.14, fA1[2]];
            const uB0 = [fB0[0], fB0[1] - 0.14, fB0[2]], uB1 = [fB1[0], fB1[1] - 0.14, fB1[2]];
            main.quad(uA0, uB0, uB1, uA1, shade(slideRim, 0.8), [0, -1, 0]);
            // left & right sloped trough walls
            const lA = [fA0[0], fA0[1] + wallH, fA0[2]], lB = [fB0[0], fB0[1] + wallH, fB0[2]];
            const rA = [fA1[0], fA1[1] + wallH, fA1[2]], rB = [fB1[0], fB1[1] + wallH, fB1[2]];
            main.quad(uA0, lA, lB, uB0, slideRim, [-lx, 0.2, -lz]);
            main.quad(fA0, lA, lB, fB0, shade(slideBlue, 0.9), [lx, 0.2, lz]);
            main.quad(uA1, rA, rB, uB1, slideRim, [lx, 0.2, lz]);
            main.quad(fA1, rA, rB, fB1, shade(slideBlue, 0.9), [-lx, 0.2, -lz]);
            if (i > 0 && i % 2 === 0) {
              const gy = sy(A.x, A.z);
              if (A.y - gy > 0.35) main.box(A.x, gy - 0.2, A.z, 0.24, A.y - gy + 0.1, 0.24, C('steelD'));
            }
          }
          world.slide = { platform: { x: cx, y: deck, z: cz }, chute, lip: chute[chute.length - 1], loLevel: loSurf };
        }
        count('props', b0);
      }

      /* ============ assemble meshes ============ */
      const mat = scope.track(new MeshLambertMaterial({ vertexColors: true }));
      const mesh = new Mesh(scope.track(main.toGeometry()), mat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'structures'; mesh.userData.cat = 'structures';
      scope.add(env.scene, mesh);
      fx.mainTris = main.count;

      fx.windowsMat = scope.track(new MeshBasicMaterial({ vertexColors: true, color: 0x000000 }));
      const wmesh = new Mesh(scope.track(win.toGeometry()), fx.windowsMat);
      wmesh.name = 'windows'; wmesh.userData.cat = 'structures'; scope.add(env.scene, wmesh);
      fx.bulbMat = scope.track(new MeshBasicMaterial({ vertexColors: true, color: 0x000000 }));
      const bmesh = new Mesh(scope.track(bulbs.toGeometry()), fx.bulbMat);
      bmesh.name = 'lamps'; bmesh.userData.cat = 'structures'; scope.add(env.scene, bmesh);
      fx.windowTris = win.count; fx.bulbTris = bulbs.count;

      // flow ribbons (chute, tailrace)
      const ribbon = (quads, name) => {
        const p = [], n = [], c = [], a = [], col = lin(HEX.flow);
        for (const [A, B, Cc, D, a0, a1] of quads) {
          for (const [v, arc] of [[A, a0], [B, a0], [Cc, a1], [A, a0], [Cc, a1], [D, a1]]) { p.push(v[0], v[1], v[2]); n.push(0, 1, 0); c.push(col[0], col[1], col[2], 0.9); a.push(arc); }
          // orientation: make faces point up
          const l = p.length - 18, e1 = [p[l + 3] - p[l], p[l + 4] - p[l + 1], p[l + 5] - p[l + 2]], e2 = [p[l + 6] - p[l], p[l + 7] - p[l + 1], p[l + 8] - p[l + 2]];
          if (e1[2] * e2[0] - e1[0] * e2[2] < 0) for (let t = 0; t < 2; t++) { const o = l + t * 9; for (let k = 0; k < 3; k++) { const s = p[o + 3 + k]; p[o + 3 + k] = p[o + 6 + k]; p[o + 6 + k] = s; } }
        }
        if (!quads.length) return null;
        const g = scope.track(new BufferGeometry());
        g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
        g.setAttribute('normal', new BufferAttribute(new Float32Array(n), 3));
        g.setAttribute('color', new BufferAttribute(new Float32Array(c), 4));
        g.setAttribute('aArc', new BufferAttribute(new Float32Array(a), 1));
        return g;
      };
      fx.chute = fx.tail = null;
      const cg = ribbon(chuteQuads), tg = ribbon(tailQuads);
      fx.chuteMat = scope.track(flowMaterial(flowU)); fx.tailMat = scope.track(flowMaterial(tailU));
      if (cg) { fx.chute = new Mesh(cg, fx.chuteMat); fx.chute.name = 'chute-flow'; fx.chute.userData.cat = 'structures'; fx.chute.renderOrder = 11; fx.chute.visible = false; scope.add(env.scene, fx.chute); }
      if (tg) { fx.tail = new Mesh(tg, fx.tailMat); fx.tail.name = 'tail-flow'; fx.tail.userData.cat = 'structures'; fx.tail.renderOrder = 11; scope.add(env.scene, fx.tail); }

      // glow sprites on each bulb
      fx.glowU = { uNight: { value: 0 }, uScale: { value: 800 } };
      if (glowPts.length) {
        const gg = scope.track(new BufferGeometry());
        gg.setAttribute('position', new BufferAttribute(new Float32Array(glowPts), 3));
        gg.setAttribute('aSize', new BufferAttribute(new Float32Array(glowPts.length / 3).fill(5.5), 1));
        const gm = scope.track(new ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: fx.glowU, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }));
        fx.glow = new Points(gg, gm); fx.glow.frustumCulled = false; fx.glow.userData.cat = 'structures'; fx.glow.renderOrder = 12;
        scope.add(env.scene, fx.glow);
      }

      fx.lamps = lamps; fx.picks = picks;
      for (const b of blockers) world.blockers.push(b);
      built = { blockers: blockers.length, lamps: lamps.length };
    },

    frame(dt, env) {
      const site = env.site;
      if (!site || !built) return;
      const night = env.night;
      // windows follow night x running; bulbs follow night
      const run = Math.abs(site.q || 0) > 0.05 ? 1 : 0;
      fx.run += (run - fx.run) * Math.min(1, dt * 1.5);
      const wk = 0.05 + night * (0.6 + 0.4 * fx.run), bk = 0.1 + 0.9 * night;
      if (fx.windowsMat) fx.windowsMat.color.setRGB(wk, wk, wk);
      if (fx.bulbMat) fx.bulbMat.color.setRGB(bk, bk, bk);
      if (fx.glowU) {
        fx.glowU.uNight.value = night;
        const v = env.view || {}, h = (v.height || 600) * (v.dpr || 1), fov = (env.camera.fov || 45) * Math.PI / 180;
        fx.glowU.uScale.value = h / (2 * Math.tan(fov / 2));
      }
      // flow: chute in proportion to spill, tailrace to turbine/pump flow
      flowU.t.value += dt; tailU.t.value += dt;
      const sp = site.spillU || 0;
      if (fx.chute) { fx.chute.visible = sp > 1e-3; fx.chuteMat.opacity = 0.35 + 0.6 * Math.min(1, sp / 15); }
      if (fx.tail) fx.tailMat.opacity = 0.55 + 0.4 * Math.min(1, Math.abs(site.q || 0) / 8);
      // pooled lights: the 3 lamps nearest the camera target, positions eased so reassignment does not pop
      const f = env.focus, k = Math.min(1, dt * 6);
      const lamps = fx.lamps;
      let n0 = -1, n1 = -1, n2 = -1, d0 = 1e18, d1 = 1e18, d2 = 1e18;
      for (let i = 0; i < lamps.length; i++) {
        const l = lamps[i], d = (l.x - f.x) * (l.x - f.x) + (l.y - f.y) * (l.y - f.y) + (l.z - f.z) * (l.z - f.z);
        if (d < d0) { n2 = n1; d2 = d1; n1 = n0; d1 = d0; n0 = i; d0 = d; }
        else if (d < d1) { n2 = n1; d2 = d1; n1 = i; d1 = d; }
        else if (d < d2) { n2 = i; d2 = d; }
      }
      const idx = [n0, n1, n2], dd = [d0, d1, d2];
      for (let i = 0; i < 3; i++) {
        const l = pool[i], j = idx[i];
        if (j < 0) { l.intensity = 0; continue; }
        const t = lamps[j];
        l.position.x += (t.x - l.position.x) * k; l.position.y += (t.y - 0.3 - l.position.y) * k; l.position.z += (t.z - l.position.z) * k;
        const reach = Math.max(0, 1 - Math.sqrt(dd[i]) / 260);
        l.intensity = env.quality === 'low' ? 0 : LAMP_I * night * reach;
      }
    },

    /* nearest structure hit by the ray: {type, t} or null */
    pick(o, d, tMax) {
      let best = Infinity, type = null;
      for (const p of fx.picks) {
        const t = p.box ? aabbHit(o, d, p.box, tMax) : segHit(o, d, p.seg[0], p.seg[1], p.r, tMax);
        if (t < best) { best = t; type = p.type; }
      }
      return type ? { type, t: best } : null;
    },

    dispose() { for (const l of pool) { scene.remove(l); l.dispose && l.dispose(); } },
  };
  return feature;
}
