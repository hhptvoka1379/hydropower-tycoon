/* Water: both lakes follow the live sim level every frame, the shoreline is the exact intersection of the level plane with the drawn
   terrain triangles (computed from the live level, never baked), connectivity comes from Surface's flood fill (disconnected pockets
   stay dry), plus a river strip on canyon sites. Water and ice are LIT (MeshStandardMaterial) and tinted by depth via vertex colour.
   Lake meshes are rewritten in place (preallocated attributes, drawRange) whenever the level moved more than a centimetre. */
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial } from 'three';

const PAPER = 0xf1ead9;
const sstep = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

const WATER_VS_COMMON = 'varying vec3 vWPos;';
const WATER_FS_COMMON = 'varying vec3 vWPos;\nuniform float uTime;\nuniform float uIce;\nuniform vec3 uIceCol;';
const WAVE = /* glsl */`
{
  vec2 p = vWPos.xz; float t = uTime;
  float gx = 0.045 * cos(p.x * 0.23 + t * 0.8 + p.y * 0.07) + 0.030 * cos((p.x + p.y) * 0.47 - t * 1.3);
  float gz = 0.045 * cos(p.y * 0.19 - t * 0.7 + p.x * 0.05) + 0.030 * cos((p.x - p.y) * 0.41 + t * 1.1);
  float k = 1.0 - uIce * 0.9;
  vec3 wn = normalize(vec3(-gx * k, 1.0, -gz * k));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`;

export function createWater(scope, scene, surface, Sim, site) {
  const { N1, H, D, CELL, X0, N } = surface;
  const uniforms = { uTime: { value: 0 }, uIce: { value: 0 }, uIceCol: { value: new Color(0xcfe0ea) } };
  const mat = scope.track(new MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.2, metalness: 0, depthWrite: false }));
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WATER_VS_COMMON)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_FS_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, uIceCol, uIce); diffuseColor.a = mix(diffuseColor.a, 0.97, uIce);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.5, uIce);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + WAVE);
  };
  mat.customProgramCacheKey = () => 'ht-water-v1';

  // depth tint (linear colours)
  const shallow = new Color(0x2f6573), deep = new Color(0x183f50), paper = new Color(0x7f948f), tmp = new Color();
  const tint = (d, out, o) => {
    tmp.copy(shallow).lerp(deep, sstep(0, 9, d)).lerp(paper, (1 - sstep(0, 0.9, d)) * 0.12);
    out[o] = tmp.r; out[o + 1] = tmp.g; out[o + 2] = tmp.b;
    out[o + 3] = 0.30 + 0.64 * sstep(0, 3.5, d);
  };

  /* ---- lake meshes ---- */
  const lakes = [];
  function makeBuf(cap) {
    const g = new BufferGeometry();
    const pos = new Float32Array(cap * 3), nor = new Float32Array(cap * 3), col = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) nor[i * 3 + 1] = 1;
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('color', new BufferAttribute(col, 4));
    g.setDrawRange(0, 0);
    return g;
  }
  for (const lk of surface.lakes) {
    const rec = { lk, cap: 3000, geo: null, mesh: null, stamp: -1, level: NaN, verts: 0 };
    rec.geo = makeBuf(rec.cap);
    rec.mesh = new Mesh(rec.geo, mat);
    rec.mesh.frustumCulled = false; rec.mesh.renderOrder = 10; rec.mesh.name = 'lake-' + lk.name; rec.mesh.userData.cat = 'water'; rec.mesh.visible = false;
    scope.add(scene, rec.mesh);
    scope.onDispose(() => rec.mesh.geometry.dispose());
    lakes.push(rec);
  }
  // scratch polygon
  const px = new Float64Array(8), pz = new Float64Array(8), pd = new Float64Array(8);
  const ax3 = new Float64Array(3), az3 = new Float64Array(3), ah3 = new Float64Array(3);

  function ensure(rec, need) {
    if (need <= rec.cap) return;
    let cap = rec.cap;
    while (cap < need) cap = Math.ceil(cap * 1.6);
    const old = rec.geo, g = makeBuf(cap);
    // copy already written data
    g.attributes.position.array.set(old.attributes.position.array.subarray(0, rec.verts * 3));
    g.attributes.color.array.set(old.attributes.color.array.subarray(0, rec.verts * 4));
    rec.geo = g; rec.mesh.geometry = g; rec.cap = cap;
    old.dispose();
  }

  function fillLake(rec) {
    const lk = rec.lk, L = lk.level, wet = lk.wet;
    rec.verts = 0;
    rec.level = L; rec.stamp = lk.stamp;
    if (L !== L || lk.count === 0) { rec.geo.setDrawRange(0, 0); rec.mesh.visible = false; return; }
    for (let j = lk.j0; j < lk.j1; j++) for (let i = lk.i0; i < lk.i1; i++) {
      const k = j * N1 + i;
      if (!(wet[k] | wet[k + 1] | wet[k + N1] | wet[k + N1 + 1])) continue;
      const split0 = D[j * N + i] === 0;
      for (let tri = 0; tri < 2; tri++) {
        let a, b, c;
        if (split0) { if (tri === 0) { a = k; b = k + 1; c = k + N1 + 1; } else { a = k; b = k + N1; c = k + N1 + 1; } }
        else if (tri === 0) { a = k; b = k + 1; c = k + N1; } else { a = k + 1; b = k + N1 + 1; c = k + N1; }
        if (!(wet[a] | wet[b] | wet[c])) continue;
        const ids = [a, b, c];
        let below = 0;
        for (let q = 0; q < 3; q++) {
          const id = ids[q], ci = id % N1, cj = (id - ci) / N1;
          ax3[q] = X0 + ci * CELL; az3[q] = X0 + cj * CELL; ah3[q] = H[id];
          if (H[id] < L) below++;
        }
        if (below === 0) continue;
        // clip the triangle to y < L (Sutherland-Hodgman against one plane); depth = L - h, 0 on the shoreline
        let n = 0;
        for (let q = 0; q < 3; q++) {
          const r = (q + 1) % 3, hq = ah3[q], hr = ah3[r];
          const inQ = hq < L, inR = hr < L;
          if (inQ) { px[n] = ax3[q]; pz[n] = az3[q]; pd[n] = L - hq; n++; }
          if (inQ !== inR) {
            const t = (L - hq) / (hr - hq);
            px[n] = ax3[q] + (ax3[r] - ax3[q]) * t; pz[n] = az3[q] + (az3[r] - az3[q]) * t; pd[n] = 0; n++;
          }
        }
        if (n < 3) continue;
        ensure(rec, rec.verts + (n - 2) * 3);
        const P = rec.geo.attributes.position.array, C = rec.geo.attributes.color.array;
        for (let f = 1; f < n - 1; f++) {
          // fan (0,f,f+1); orient so the normal points up: cross.y = e1z*e2x - e1x*e2z
          let u = 0, v = f, w = f + 1;
          const cy = (pz[v] - pz[u]) * (px[w] - px[u]) - (px[v] - px[u]) * (pz[w] - pz[u]);
          if (cy < 0) { const s = v; v = w; w = s; }
          for (const q of [u, v, w]) {
            const o = rec.verts++;
            P[o * 3] = px[q]; P[o * 3 + 1] = L; P[o * 3 + 2] = pz[q];
            tint(pd[q], C, o * 4);
          }
        }
      }
    }
    const g = rec.geo, pa = g.attributes.position, ca = g.attributes.color;
    pa.clearUpdateRanges(); pa.addUpdateRange(0, rec.verts * 3); pa.needsUpdate = true;
    ca.clearUpdateRanges(); ca.addUpdateRange(0, rec.verts * 4); ca.needsUpdate = true;
    if (rec.geo.attributes.normal.version === 0) rec.geo.attributes.normal.needsUpdate = true;
    g.setDrawRange(0, rec.verts);
    rec.mesh.visible = rec.verts > 0;
  }

  /* ---- river strip (canyon sites) ---- */
  let river = null;
  if (surface.river) {
    const NC = 6, rows = [];
    const zs = [];
    for (let z = X0 + CELL * 0.5; z <= X0 + surface.SIZE - CELL * 0.5; z += CELL) zs.push(z);
    const pos = [], col = [];
    const lift = surface.riverLift;
    const c6 = [0, 0, 0, 0];
    for (const z of zs) {
      const cx = surface.river.cx(z), hw = surface.river.half(z) * 0.95, row = [];
      for (let k = 0; k <= NC; k++) {
        const u = (k / NC) * 2 - 1, x = cx + u * hw;
        const y = surface.y(x, z) + lift + 0.12 * (1 - u * u);
        const edge = 1 - Math.abs(u);
        tint(0.4 + 1.6 * edge, c6, 0); c6[3] = 0.35 + 0.5 * sstep(0, 0.5, edge);
        row.push([x, y, z, c6[0], c6[1], c6[2], c6[3]]);
      }
      rows.push(row);
    }
    const push = (a, b, c) => {
      const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const t = cy < 0 ? [a, c, b] : [a, b, c];
      for (const v of t) { pos.push(v[0], v[1], v[2]); col.push(v[3], v[4], v[5], v[6]); }
    };
    for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < NC; k++) {
      const A = rows[r][k], B = rows[r][k + 1], C = rows[r + 1][k], E = rows[r + 1][k + 1];
      push(A, C, B); push(B, C, E);
    }
    const g = scope.track(new BufferGeometry());
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
    river = new Mesh(g, mat);
    river.frustumCulled = false; river.renderOrder = 9; river.name = 'river'; river.userData.cat = 'water';
    scope.add(scene, river);
  }

  return {
    mat, uniforms, lakes, river,
    /* dt: real seconds; ice 0..1 target (eased here) */
    update(dt, iceGoal) {
      uniforms.uTime.value += dt;
      const k = uniforms.uIce.value, g = iceGoal ? 1 : 0;
      uniforms.uIce.value = Math.abs(g - k) < 1e-3 ? g : k + (g - k) * Math.min(1, dt * 1.5);
      for (const rec of lakes) {
        const lk = rec.lk;
        if (rec.stamp !== lk.stamp || (lk.level === lk.level && Math.abs(lk.level - rec.level) > 0.01)) fillLake(rec);
      }
    },
    surfaceAt: (x, z) => surface.waterSurface(x, z),
    depthAt: (x, z) => surface.depth(x, z),
    triangleCount() { let n = 0; for (const r of lakes) n += r.verts / 3; return n; },
  };
}
