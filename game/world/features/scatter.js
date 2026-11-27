/* Scatter feature (D9, milestone M6): conifers (3 variants), faceted boulders, grass tufts and flower meadows, instanced, deterministic and clustered
   (placement.js), filtered by slope, by water AT THE MAXIMUM LEVEL of the current / pending dam height (so nothing stands in a lake after a raise:
   the signature carries the dam height and the plan is redone), by parcels, structures (world.blockers), stations and footpaths.
   Season (C8): per-instance autumn hue shift, snow load on up-facing facets, flowers shrink and brown. Wind sway is in the vertex shader
   (onBeforeCompile replacing project_vertex, applied after the instance matrix); casters use a matching custom depth material. */
import { DoubleSide, FrontSide, InstancedBufferAttribute, MeshDepthMaterial, MeshLambertMaterial, RGBADepthPacking, Vector2 } from 'three';
import { GB } from './geom.js';
import { coniferGB, coniferHeight, flowerGB, rockGB, tuftGB } from './models.js';
import { writeTRS } from './inst.js';
import { createEnvReader, qualityFactor, SWAY, angDiff } from './envread.js';
import { keepGridFrom, keepoutGeometry, planScatter, STRIDE } from './placement.js';
import { geoFrom, instancedFrom } from './three-util.js';
import { getRoutes } from './stations-link.js';
import { normalizePaths } from './pathsnorm.js';
import { tileConfig } from './layout.js';

const f1 = (v) => v.toFixed(5);
const DECL = 'uniform float uTime; uniform float uWindSpeed; uniform vec2 uWindDir; uniform float uAutumn; uniform float uSnow; uniform float uFade;\n'
  + 'uniform float uHeight; uniform float uSwayK; uniform vec2 uAut; uniform vec2 uSnowEdge; attribute vec4 aRand;\n';
/* replaces <project_vertex>: instance matrix first, then the sway in world space (the mesh sits at the origin) */
const PROJECT = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{
  float sc = 1.0;
  #ifdef USE_INSTANCING
    sc = length( instanceMatrix[1].xyz );
  #endif
  float hw = clamp( position.y / max( uHeight, 0.001 ), 0.0, 1.0 );
  hw *= hw;
  float ph = mvPosition.x * 0.05 + mvPosition.z * 0.043 + aRand.y * 6.2831;
  float gust = 0.8 + 0.2 * sin( uTime * 0.7 + mvPosition.x * 0.012 + mvPosition.z * 0.009 );
  float hwld = uHeight * sc;
  float wsp = clamp( uWindSpeed, 0.0, ${f1(SWAY.maxWind)} );
  float osc = sin( uTime * ( 1.6 + 0.8 * aRand.x ) + ph );
  float along = hwld * wsp * ( ${f1(SWAY.lean)} * gust + ${f1(SWAY.osc)} * osc );
  float across = hwld * wsp * ${f1(SWAY.osc * SWAY.cross)} * sin( uTime * 1.3 + ph * 1.7 );
  mvPosition.xz += ( uWindDir * along + vec2( -uWindDir.y, uWindDir.x ) * across ) * hw * uSwayK;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
const colourCode = (flower) => `
#ifdef USE_COLOR
{
  vec3 c = vColor.rgb;
  float aut = clamp( uAutumn * mix( uAut.x, uAut.y, aRand.z ), 0.0, 1.0 );
  c = mix( c, vec3( c.g * 2.3 + 0.02, c.g * 1.15 + 0.01, c.g * 0.25 ), aut );
  float sn = clamp( uSnow * smoothstep( uSnowEdge.x, uSnowEdge.y, objectNormal.y + ( aRand.x - 0.5 ) * 0.25 ), 0.0, 1.0 );
  c = mix( c, vec3( 0.74, 0.8, 0.9 ), sn );
  ${flower ? 'float k = clamp( ( uFade - aRand.y * 0.7 ) / 0.3, 0.0, 1.0 ); transformed *= ( 1.0 - k ); c = mix( c, vec3( 0.2, 0.14, 0.08 ), k );' : ''}
  vColor.rgb = c;
}
#endif
`;

export function makeScatter(world) {
  const readEnv = createEnvReader();
  const U = { uTime: { value: 0 }, uWindSpeed: { value: 0 }, uWindDir: { value: new Vector2(0, 1) }, uAutumn: { value: 0 }, uSnow: { value: 0 }, uFade: { value: 0 } };
  let S = null, time = 0, init = false, windDir = 0;

  function patch(mat, o) {
    const own = { uHeight: { value: o.height }, uSwayK: { value: o.sway }, uAut: { value: new Vector2(o.aut[0], o.aut[1]) }, uSnowEdge: { value: new Vector2(o.snowEdge[0], o.snowEdge[1]) } };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U, own);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + DECL).replace('#include <project_vertex>', PROJECT);
      if (shader.vertexShader.includes('#include <begin_vertex>') && !mat.isMeshDepthMaterial) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + colourCode(o.flower));
    };
    mat.customProgramCacheKey = () => 'ht-scatter-' + o.key;
    return mat;
  }
  function depthFor(scope, o) {
    const d = scope.track(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }));
    return patch(d, Object.assign({}, o, { key: o.key + '-depth', flower: false }));
  }

  const feature = {
    name: 'scatter',
    signature(site) {
      const d = site.dam || {}, L = site.layout;
      return [site.kind, site.seed, d.built ? 1 : 0, d.height, d.raising && d.raising.to, site.upper && site.upper.excav, site.lower && site.lower.excav, site.lower && site.lower.hMax,
        L ? [L.ph.x, L.ph.z, L.dam.x, L.dam.z].map(Math.round).join(',') + ';' + L.parcels.map(p => Math.round(p.x) + ',' + Math.round(p.z)).join(';') : ''].join('|');
    },
    get stats() { return S ? S.stats : null; },
    get plan() { return S ? S.plan : null; },

    build(scope, site, surface, env) {
      const scene = (env && env.scene) || world.scene, Sim = surface.Sim, cfg = tileConfig(Sim), q = qualityFactor(env && env.quality);
      let stations = [], polys = [];
      try {
        const r = getRoutes(world, site, surface), np = normalizePaths(r.paths);
        stations = r.stations;
        polys = np.segs.map(([ax, az, bx, bz]) => ({ pts: [{ x: ax, z: az }, { x: bx, z: bz }], hw: 2.8 }));
        for (const f of np.flights) polys.push({ pts: f.pts, hw: 3.4 });
      } catch (e) { /* no stations module: scatter without path keep-outs */ }
      const geo = keepoutGeometry(site, { ts: cfg.ts, blockers: world.blockers || [], stations, polys });
      const L = site.layout, poi = [L.ph, L.dam, L.tail, ...L.parcels, ...stations].filter(Boolean);
      const plan = planScatter(surface, site, { Sim, keep: keepGridFrom(geo, surface.SIZE), poi, quality: q, seed: site.seed });
      const meshes = [], mats = [];
      const mk = (list, gb, height, o) => {
        const n = list.length / STRIDE; if (!n) return;
        const g = geoFrom(scope, gb);
        const aR = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { aR[i * 4] = list[i * STRIDE + 5]; aR[i * 4 + 1] = list[i * STRIDE + 6]; aR[i * 4 + 2] = list[i * STRIDE + 7]; aR[i * 4 + 3] = 0; }
        g.setAttribute('aRand', new InstancedBufferAttribute(aR, 4));
        const mat = scope.track(new MeshLambertMaterial({ vertexColors: true, side: o.double ? DoubleSide : FrontSide }));
        patch(mat, Object.assign({ height, snowEdge: [0.3, 0.6], aut: [0, 0.4], sway: 1, flower: false }, o));
        const m = instancedFrom(scope, scene, g, mat, n, { cast: !!o.cast, name: 'scatter-' + o.key });
        if (o.cast) m.customDepthMaterial = depthFor(scope, Object.assign({ height, snowEdge: [0.3, 0.6], aut: [0, 0.4], sway: 1 }, o));
        const a = m.instanceMatrix.array, c = m.instanceColor.array;
        for (let i = 0; i < n; i++) {
          const b = i * STRIDE, s = list[b + 3];
          writeTRS(a, i, list[b], list[b + 1], list[b + 2], list[b + 4], s, s, s);
          const r1 = list[b + 5], t = o.tint(r1);
          c[i * 3] = t[0]; c[i * 3 + 1] = t[1]; c[i * 3 + 2] = t[2];
        }
        m.computeBoundingSphere(); meshes.push(m); mats.push(mat);
      };
      const green = (r) => [0.9 + 0.2 * r, 0.95 + 0.1 * (1 - r), 0.9 + 0.2 * (1 - r)], grey = (r) => [0.85 + 0.25 * r, 0.85 + 0.25 * r, 0.85 + 0.22 * r], bright = (r) => [0.88 + 0.22 * r, 0.88 + 0.22 * r, 0.88 + 0.22 * r];
      plan.conifer.forEach((l, v) => mk(l, coniferGB(v, site.seed | 0), coniferHeight(v), { key: 'tree' + v, cast: true, tint: green, aut: [0, 0.45], snowEdge: [0.2, 0.55], sway: 1 }));
      plan.rock.forEach((l, v) => mk(l, rockGB(v, site.seed | 0), 1, { key: 'rock' + v, cast: true, tint: grey, aut: [0, 0], snowEdge: [0.45, 0.85], sway: 0 }));
      mk(plan.tuft, tuftGB(site.seed | 0), 0.9, { key: 'tuft', double: true, tint: bright, aut: [0.5, 1], snowEdge: [-1, -0.9], sway: 3.2 });
      plan.flower.forEach((l, c) => mk(l, flowerGB(c), 0.7, { key: 'flower' + c, double: true, tint: bright, aut: [0, 0], snowEdge: [-1, -0.9], sway: 3.2, flower: true }));
      const tris = plan.conifer.reduce((a, l, v) => a + l.length / STRIDE * coniferGB(v).triCount, 0) + plan.rock.reduce((a, l, v) => a + l.length / STRIDE * rockGB(v).triCount, 0) + plan.tuft.length / STRIDE * tuftGB().triCount + plan.flower.reduce((a, l, c) => a + l.length / STRIDE * flowerGB(c).triCount, 0);
      S = { plan, stats: Object.assign({ triangles: tris, meshes: meshes.length }, plan.stats), site };
      scope.onDispose(() => { if (S && S.site === site) S = null; });
    },

    frame(dt, env) {
      if (!S) return;
      dt = Math.min(dt > 0 ? dt : 0, 0.1); time = (time + dt) % 3600;
      const E = readEnv(env, (env && env.site) || S.site), k = init ? Math.min(1, dt * 1.2) : 1;
      const first = !init; init = true;
      if (!first) windDir += angDiff(windDir, E.windDir) * Math.min(1, dt * 0.6); else windDir = E.windDir;
      U.uTime.value = time;
      U.uWindSpeed.value += (E.wind - U.uWindSpeed.value) * (first ? 1 : Math.min(1, dt * 0.8));
      U.uWindDir.value.set(Math.sin(windDir), Math.cos(windDir));
      U.uAutumn.value += (E.autumn - U.uAutumn.value) * k;
      U.uSnow.value += (E.snowCover - U.uSnow.value) * k;
      U.uFade.value += (E.flowerFade - U.uFade.value) * k;
    },
  };
  return feature;
}
