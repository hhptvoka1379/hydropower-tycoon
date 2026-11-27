/* Terrain mesh from Surface: non-indexed flat-shaded triangles on the exact triangulation Surface.y() samples, colour per vertex from a
   continuous function of elevation, slope and smooth noise in the Field Notes palette (no per-cell blocks, no checker diagonals).
   Plus the strata skirt (so the slab does not float) and a dark table disc that fades into the fog. */
import { BufferAttribute, BufferGeometry, CircleGeometry, Color, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';

const PAPER = 0xf1ead9, INK = 0x2b2a26, MOSS = 0x4f6b3a, CLAY = 0xa3472c, OCHRE = 0xc08a2e, MOSS_DARK = 0x3a5230;

/* smooth value noise (C1), deterministic */
function hash2(i, j) { let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul((j | 0) + 0x165667b1, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; }
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}
const sstep = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

/* Per-grid-vertex linear RGB (Float32Array 3*(N+1)^2). */
export function terrainColours(surface) {
  const { N, N1, X0, CELL, H } = surface;
  const c = (hex) => new Color(hex);
  const moss = c(MOSS), mossD = c(MOSS_DARK), ochre = c(OCHRE), clay = c(CLAY), ink = c(INK), paper = c(PAPER);
  const rock = new Color(0x625648), cap = paper.clone().lerp(ochre, 0.4), rockWarm = new Color(), tmp = new Color(), base = new Color(), col = new Color();
  // elevation range from a sample of the grid (5th..98th percentile) so every site uses its full palette
  const samp = []; for (let k = 0; k < H.length; k += 7) samp.push(H[k]);
  samp.sort((a, b) => a - b);
  const h0 = samp[Math.floor(samp.length * 0.05)], h1 = samp[Math.floor(samp.length * 0.98)], span = Math.max(1, h1 - h0);
  const out = new Float32Array(N1 * N1 * 3);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * N1 + i, x = X0 + i * CELL, z = X0 + j * CELL, h = H[k];
    const im = i > 0 ? i - 1 : i, ip = i < N ? i + 1 : i, jm = j > 0 ? j - 1 : j, jp = j < N ? j + 1 : j;
    const gx = (H[j * N1 + ip] - H[j * N1 + im]) / ((ip - im) * CELL), gz = (H[jp * N1 + i] - H[jm * N1 + i]) / ((jp - jm) * CELL);
    const slope = Math.atan(Math.hypot(gx, gz)) * 57.29578;
    const t = Math.max(0, Math.min(1, (h - h0) / span));
    const n1 = vnoise(x / 90, z / 90), n2 = vnoise(x / 27 + 7.3, z / 27 - 3.1), n3 = vnoise(x / 260 - 2.7, z / 260 + 9.9);
    const jit = (hash2(i, j) - 0.5) * 0.06;
    // grass: moss <-> dark moss by mid-frequency noise, drying toward ochre with altitude and low-frequency patches
    base.copy(moss).lerp(mossD, 0.5 + 0.5 * n2);
    const dry = sstep(0.1, 0.9, 0.35 + 0.55 * n3 + 0.45 * n1 * 0.5 + (t - 0.4) * 0.6);
    base.lerp(ochre, dry * 0.5);
    // rock on steep ground: grey-paper rock with clay streaks
    rockWarm.copy(rock).lerp(clay, 0.12 + 0.12 * (0.5 + 0.5 * n1));
    tmp.copy(rockWarm).lerp(ink, 0.12 + 0.1 * (0.5 + 0.5 * n2));
    col.copy(base).lerp(tmp, sstep(17, 36, slope + n2 * 3));
    // chalky caps on the highest ground
    col.lerp(cap, sstep(0.85, 1.0, t + n3 * 0.05) * 0.4 * (1 - 0.5 * sstep(24, 40, slope)));
    const l = 1 + n2 * 0.06 + jit;
    out[k * 3] = col.r * l; out[k * 3 + 1] = col.g * l; out[k * 3 + 2] = col.b * l;
  }
  return out;
}

/* Build terrain + skirt + table into the scene under `scope`. Returns {mesh, skirt, table, baseY}. */
export function buildTerrain(surface, scope, scene) {
  const { N, N1, X0, CELL, H, D } = surface;
  const cols = terrainColours(surface);
  // chunked 8x8 so frustum culling (camera and shadow camera) drops what is out of view; one shared material, one program
  const CHN = 8, CHC = Math.ceil(N / CHN);
  const mat = scope.track(new MeshLambertMaterial({ vertexColors: true }));   // per-face normals below give the flat look (no flatShading: same program as every other Lambert)
  // torch fix: grazing torch light on flat-shaded faces lights single triangles (hard wedge). While the torch is on at night the shading
  // normal is blended toward 'up' (uSoft 0..1, driven by the world); by day uSoft = 0 and the facets stay crisp.
  const soft = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSoft = soft;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSoft;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), uSoft));');
  };
  mat.customProgramCacheKey = () => 'ht-terrain';
  const meshes = [];
  const idx = new Int32Array(3);
  for (let cj = 0; cj < CHN; cj++) for (let ci = 0; ci < CHN; ci++) {
    const i0 = ci * CHC, i1 = Math.min(N, i0 + CHC), j0 = cj * CHC, j1 = Math.min(N, j0 + CHC);
    if (i1 <= i0 || j1 <= j0) continue;
    const nv = (i1 - i0) * (j1 - j0) * 6;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    let o = 0;
    const emit = (a, b, c) => {   // vertex ids (grid k) in any order; written so the face normal points up
      const ax = a % N1, az = (a - ax) / N1, bx = b % N1, bz = (b - bx) / N1, cx = c % N1, cz = (c - cx) / N1;
      const e1x = (bx - ax) * CELL, e1y = H[b] - H[a], e1z = (bz - az) * CELL, e2x = (cx - ax) * CELL, e2y = H[c] - H[a], e2z = (cz - az) * CELL;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      idx[0] = a; if (ny >= 0) { idx[1] = b; idx[2] = c; } else { idx[1] = c; idx[2] = b; nx = -nx; ny = -ny; nz = -nz; }
      const l = 1 / Math.hypot(nx, ny, nz); nx *= l; ny *= l; nz *= l;
      for (let q = 0; q < 3; q++) {
        const k = idx[q], i = k % N1, j = (k - i) / N1;
        pos[o] = X0 + i * CELL; pos[o + 1] = H[k]; pos[o + 2] = X0 + j * CELL;
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        col[o] = cols[k * 3]; col[o + 1] = cols[k * 3 + 1]; col[o + 2] = cols[k * 3 + 2];
        o += 3;
      }
    };
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const k = j * N1 + i, a = k, b = k + 1, c = k + N1, d = k + N1 + 1;
      if (D[j * N + i] === 0) { emit(a, b, d); emit(a, c, d); } else { emit(a, b, c); emit(b, d, c); }
    }
    const geo = scope.track(new BufferGeometry());
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'terrain';
    mesh.userData.cat = 'terrain';
    scope.add(scene, mesh);
    meshes.push(mesh);
  }

  // strata skirt: topsoil / clay / rock bands from the rim down to the base
  const baseY = surface.hMin - 45;
  const soil = new Color(0x4a3b2a), clayC = new Color(CLAY).multiplyScalar(0.8), deep = new Color(PAPER).lerp(new Color(INK), 0.6);
  const bands = [[0, 2.5 * surface.VEX, soil], [2.5 * surface.VEX, 11 * surface.VEX, clayC], [11 * surface.VEX, 1e9, deep]];
  const sp = [], sn = [], sc = [];
  const quad = (p0, p1, p2, p3, n, c) => { for (const p of [p0, p1, p2, p0, p2, p3]) { sp.push(p[0], p[1], p[2]); sn.push(n[0], n[1], n[2]); sc.push(c.r, c.g, c.b); } };
  const E = X0 + surface.SIZE;
  // edges as lists of vertex ids walked counter-clockwise seen from above; outward normal given per edge
  const edges = [
    { ids: (s) => s, nrm: [0, 0, -1], x: (s) => X0 + s * CELL, z: () => X0 },          // z = X0 (north side)
    { ids: (s) => N * N1 + s, nrm: [0, 0, 1], x: (s) => X0 + s * CELL, z: () => E },   // z = E
    { ids: (s) => s * N1, nrm: [-1, 0, 0], x: () => X0, z: (s) => X0 + s * CELL },     // x = X0
    { ids: (s) => s * N1 + N, nrm: [1, 0, 0], x: () => E, z: (s) => X0 + s * CELL },   // x = E
  ];
  for (const e of edges) {
    for (let s = 0; s < N; s++) {
      const ta = H[e.ids(s)], tb = H[e.ids(s + 1)];
      const ax = e.x(s), az = e.z(s), bx = e.x(s + 1), bz = e.z(s + 1);
      for (const [d0, d1, c] of bands) {
        const a0 = Math.max(baseY, ta - d0), a1 = Math.max(baseY, ta - d1), b0 = Math.max(baseY, tb - d0), b1 = Math.max(baseY, tb - d1);
        if (a0 - a1 < 0.01 && b0 - b1 < 0.01) continue;
        // winding so the face points outward: sides at z=X0 / x=E use (a,b) order, the others reversed
        const flip = !((e.nrm[2] < 0) || (e.nrm[0] > 0));
        const P = [[ax, a0, az], [bx, b0, bz], [bx, b1, bz], [ax, a1, az]];
        if (flip) quad(P[3], P[2], P[1], P[0], e.nrm, c); else quad(P[0], P[1], P[2], P[3], e.nrm, c);
      }
    }
  }
  const sgeo = scope.track(new BufferGeometry());
  sgeo.setAttribute('position', new BufferAttribute(new Float32Array(sp), 3));
  sgeo.setAttribute('normal', new BufferAttribute(new Float32Array(sn), 3));
  sgeo.setAttribute('color', new BufferAttribute(new Float32Array(sc), 3));
  const smat = scope.track(new MeshLambertMaterial({ vertexColors: true }));
  const skirt = new Mesh(sgeo, smat);
  skirt.name = 'skirt'; skirt.castShadow = false; skirt.receiveShadow = true;
  scope.add(scene, skirt);

  // table: a large dark disc under the slab, lost in the fog toward the horizon
  const tgeo = scope.track(new CircleGeometry(8000, 72));
  tgeo.rotateX(-Math.PI / 2);
  const tmat = scope.track(new MeshBasicMaterial({ color: 0xcfd8dc }));   // colour = fog colour each frame: the slab ends in haze, not in a dark band
  const table = new Mesh(tgeo, tmat);
  table.position.y = baseY - 0.05;
  table.name = 'table';
  scope.add(scene, table);
  skirt.userData.cat = 'skirt'; table.userData.cat = 'skirt';
  return { mesh: meshes[0], meshes, material: mat, soft, skirt, table, baseY };
}
