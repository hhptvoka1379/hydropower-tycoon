/* World (Three.js): terrain, sky, light rig, water. createWorld(ctx) -> world. See decisions/fable.md D2/D7.
   ctx needs { Sim, game, bus }. world.build(site) creates ctx.surface (the single ground sampler) and the meshes;
   world.frame(dtReal, view) renders. Nothing here mutates the sim. */
import { Color, FogExp2, PCFShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { Surface } from './surface.js';
import { ResourceScope } from './scope.js';
import { createAtmosphere } from './atmosphere.js';
import { createSky } from './sky.js';
import { createLights } from './lights.js';
import { buildTerrain } from './terrain.js';
import { createWater } from './water.js';
import { registerFeatures } from './features/index.js';
import { createStructures } from './structures.js';

const FAR = 14000;

/* opts.createRenderer(): inject a renderer (tests); opts.canvas: use an existing canvas. */
export function createWorld(ctx, opts = {}) {
  const { Sim } = ctx;
  const renderer = opts.createRenderer ? opts.createRenderer() : new WebGLRenderer({ canvas: opts.canvas, antialias: true, powerPreference: 'high-performance' });
  const canvas = renderer.domElement;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;           // re-rendered on demand (lights.takeShadowDirty / world.invalidateShadows)
  renderer.shadowMap.needsUpdate = true;           // PCFSoftShadowMap is deprecated in r187; softness = light.shadow.radius
  const scene = new Scene();
  const fog = new FogExp2(0xcfd8dc, 0.00022);
  scene.fog = fog;
  const camera = new PerspectiveCamera(45, 1, 1, FAR);
  camera.position.set(0, 900, 1400);
  const atm = createAtmosphere(Sim.CONFIG.climate.lat);

  // long-lived (never rebuilt): sky and lights. Per-site: terrain, water.
  const fixedScope = new ResourceScope('fixed');
  let siteScope = new ResourceScope('site');
  const lights = createLights(fixedScope, scene);
  const sky = createSky(fixedScope, scene, { lat: atm.out.lat });
  lights.setQuality('medium');

  const DPR_CAP = { low: 1, medium: 1.5, high: 2 };
  let quality = 'medium';
  const levels = { up: NaN, lo: NaN };
  const focus = new Vector3(0, 100, 0);
  const camTarget = new Vector3(0, 100, 0);
  const tmpV = new Vector3(), tmpD = new Vector3(), tmpC = new Color();
  const ray = { x: 0, y: 0, z: 0 }, rdir = { x: 0, y: 0, z: 0 };
  const hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, i: 0, j: 0, tri: 0 };
  let shadowDirty = true, darken = 0, override = null, lost = false, w = 0, h = 0, dpr = 0, cloud = 0, storm = 0, nearV = 1;
  let siteIndex = 0, builtSite = null, terrain = null, water = null, frames = 0;
  // D9 features: { f, scope, sig, mineBlockers, mineProviders }. env is one reused object, refreshed every frame.
  const features = [];
  const blockers = [];
  const env = { scene, camera, night: 0, sunDir: atm.out.sunDir, doy: 0, hour: 12, season: 0, wind: 0, rain: 0, snow: 0, quality: 'medium', view: null, site: null, focus, dt: 0, jobs: null };
  let sigClock = 0, builtSig = '';
  // terrain/water signature: anything that changes the ground or the lake outlines (dam raise -> layout, excavation, shaping)
  function siteSig(site) {
    const L = site.layout, r = (v) => (v === undefined ? '' : Math.round(v * 10));
    const sc = site.sculpt;
    return [site.kind, site.dam.built ? 1 : 0, site.dam.height, site.upper.excav, site.lower.excav, site.lower.hMax, site.upper.a1, site.upper.a2, site.lower.a1, site.lower.a2,
      L ? [r(L.up.x), r(L.up.z), r(L.lo.x), r(L.lo.z), r(L.dam.x), r(L.dam.z), r(L.ph.x), r(L.ph.z), r(L.tail.x), r(L.tail.z), r(L.padY)].join(',') : '',
      sc ? (sc.d ? sc.d.length + ':' + sc.d.slice(0, 64) : '') + JSON.stringify(sc.gen || {}) : ''].join('|');
  }
  let dbgWeather = null, dbgSeason = null;
  function refreshEnv(st, site, A, hour, doy, view) {
    const cl = st && st.climate ? st.climate : null;
    env.night = A.night; env.sunDir = A.sunDir; env.hour = hour;
    const d = dbgSeason !== null ? dbgSeason : doy;
    env.doy = d; env.season = (((d % 360) + 360) % 360) / 360;
    env.climate = cl; env.state = st;
    env.wind = cl ? cl.wind : 0; env.windDir = cl ? cl.wdir : 0; env.T = cl ? cl.T : 10;
    env.rain = cl ? cl.rain : 0; env.snow = site && site.tel && site.tel.snowing ? 1 : 0;
    if (dbgWeather) {   // render-only override (null clears): rain in mm/h, snow 0..1, wind in m/s
      if (dbgWeather.wind !== undefined) env.wind = dbgWeather.wind;
      if (dbgWeather.windDir !== undefined) env.windDir = dbgWeather.windDir;
      if (dbgWeather.rain !== undefined) env.rain = dbgWeather.rain;
      env.snow = dbgWeather.snow !== undefined ? dbgWeather.snow : (dbgWeather.rain ? 0 : env.snow);
      if (dbgWeather.snow > 0) env.T = Math.min(env.T, -2);
    }
    env.jobs = st ? st.jobs : null;                      // live reference, not a copy
    env.view = view || null; env.site = site;
  }
  function buildFeature(rec) {
    const surface = world.surface, site = (ctx.game.state && ctx.game.state.sites[siteIndex]) || builtSite;
    releaseFeature(rec);
    rec.scope = new ResourceScope(rec.f.name || 'feature');
    const b0 = blockers.slice(), p0 = surface.providers.slice();
    env.site = site;
    rec.f.build(rec.scope, site, surface, env);
    shadowDirty = true;
    rec.mineBlockers = blockers.filter((b) => !b0.includes(b));
    rec.mineProviders = surface.providers.filter((q) => !p0.includes(q));
    rec.sig = rec.f.signature ? rec.f.signature(site) : '';
  }
  function releaseFeature(rec) {
    if (rec.scope) { rec.scope.dispose(); rec.scope = null; }
    for (const b of rec.mineBlockers || []) { const k = blockers.indexOf(b); if (k >= 0) blockers.splice(k, 1); }
    if (world.surface) for (const q of rec.mineProviders || []) world.surface.removeFloorProvider(q);
    rec.mineBlockers = []; rec.mineProviders = [];
  }

  const world = {
    renderer, scene, camera, canvas, domElement: canvas,
    atmosphere: atm.out, Sim, blockers, surface: null, water: { surfaceAt: () => NaN, depthAt: () => 0 },
    hazards: { intake: null, tailrace: null }, slide: { platform: null, requestRiderPose() { return false; } },
    get lost() { return lost; },
    /* 'low' | 'medium' | 'high': low = no shadows and no pooled lamps, medium = 1024 shadow map, high = 2048; also caps the pixel ratio (1 / 1.5 / 2). */
    get quality() { return quality; },
    set quality(q) {
      if (!DPR_CAP[q] || q === quality) return;
      quality = q; env.quality = q;
      lights.setQuality(q); shadowDirty = true;
      renderer.shadowMap.enabled = q !== 'low';
      dpr = 0;   // re-apply the pixel ratio on the next frame
      if (ctx.bus) ctx.bus.emit('quality', { quality: q });
    },
    get frames() { return frames; },

    /* D9: { name, signature(site), build(scope, site, surface, env), frame(dt, env), pick?(o,d,tMax), dispose? }.
       Built on world.build and whenever signature(site) changes (checked ~4x/s); the feature's own ResourceScope is disposed first. */
    addFeature(f) {
      const rec = { f, scope: null, sig: null, mineBlockers: [], mineProviders: [] };
      features.push(rec);
      if (builtSite && world.surface) buildFeature(rec);
      return f;
    },
    features,

    /* siteState: a site object (state.sites[i]) or the whole game state (its active site is used). */
    build(siteState) {
      const st = siteState && siteState.sites ? siteState : null;
      const site = st ? st.sites[st.active | 0] : siteState;
      siteIndex = st ? st.active | 0 : (ctx.game.state ? Math.max(0, ctx.game.state.sites.indexOf(site)) : 0);
      for (const rec of features) releaseFeature(rec);
      blockers.length = 0;
      world.stations = null;
      siteScope.dispose();
      siteScope = new ResourceScope('site');
      builtSite = site;
      builtSig = siteSig(site);
      const surface = new Surface(site, Sim);
      world.surface = ctx.surface = surface;
      terrain = buildTerrain(surface, siteScope, scene);
      water = createWater(siteScope, scene, surface, Sim, site);
      world.water.surfaceAt = water.surfaceAt;
      world.water.depthAt = water.depthAt;
      world.water.mesh = water;
      const L = site.layout;
      world.hazards = L ? {
        intake: { x: L.dam.x - (L.dir ? L.dir.x * 6 : 0), z: L.dam.z - (L.dir ? L.dir.z * 6 : 0), r: 14 },
        tailrace: { x: L.tail.x, z: L.tail.z, r: 14 },
      } : { intake: null, tailrace: null };
      levels.up = levels.lo = NaN;
      readLevels(site);
      surface.setWater(levels);
      for (const rec of features) buildFeature(rec);
      shadowDirty = true;
      if (ctx.bus) ctx.bus.emit('world:rebuilt', { surface });
      try { if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {}); } catch (e) { /* optional */ }
      return world;
    },

    /* view: optional {width,height,dpr}; defaults to the window. */
    frame(dtReal, view) {
      if (lost || !builtSite) return;
      if (dtReal > 0.25) dtReal = 0.25;
      resize(view);
      const st = ctx.game.state;
      const site = (st && st.sites[siteIndex]) || builtSite;
      // clock (render-only): the live sim time plus the sub-step remainder, or the debug override
      const clk = ctx.clock;
      let hour = st ? st.hour + (st.secInHour + (clk && clk.frac ? clk.frac : 0)) / 3600 : 12;
      let doy = st ? st.doy : 60, day = st ? st.day : 0;
      if (override) {
        if (override.hour != null) hour = override.hour;
        if (override.doy != null) { day += override.doy - doy; doy = override.doy; }
      }
      const cl = st && st.climate ? st.climate : null;
      const k = Math.min(1, dtReal * 0.8);
      cloud += ((cl ? cl.cloud : 0) - cloud) * k; storm += ((cl && cl.storm ? 1 : 0) - storm) * k;
      darken += ((env.stormDarken || 0) - darken) * Math.min(1, dtReal * 1.2);
      const A = atm.update(doy, hour, day, cloud, storm, darken);

      readLevels(site);
      world.surface.setWater(levels);
      water.update(dtReal, site.ice > 0.5);
      refreshEnv(st, site, A, hour, doy, view);
      env.dt = dtReal;
      sigClock += dtReal;
      if (sigClock >= 0.25) {
        sigClock = 0;
        if (siteSig(site) !== builtSig) { world.build(st && st.sites ? st : site); return; }   // ground changed: rebuild terrain, water and every feature
        for (const rec of features) { if (rec.f.signature && rec.f.signature(site) !== rec.sig) buildFeature(rec); }
      }

      // fog follows the horizon colour so terrain and table dissolve into the sky
      tmpC.setRGB(A.fog[0], A.fog[1], A.fog[2], 'srgb');
      fog.color.copy(tmpC); fog.density = A.fogDensity;
      if (terrain) {
        terrain.table.material.color.copy(tmpC);
        const e = A.night * 0.9;   // cool moonlit floor independent of albedo, so slopes read blue-grey at night
        terrain.soft.value = Math.min(1, lights.torchLevel * 1.2) * 0.9;
        terrain.material.emissive.setRGB(0.006 * e, 0.012 * e, 0.030 * e);
        terrain.skirt.material.emissive.copy(terrain.material.emissive);
      }

      const camDist = camera.position.distanceTo(camTarget);
      lights.update(A, focus, camDist, dtReal);
      sky.update(A, camera.position, Math.min(1, cloud + 0.5 * darken), dtReal, dpr || 1);

      for (const rec of features) if (rec.f.frame) rec.f.frame(dtReal, env);
      if (lights.takeShadowDirty() || shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }

      const near = Math.max(0.5, Math.min(8, camDist * 0.02));
      if (Math.abs(near - nearV) > nearV * 0.05) { nearV = near; camera.near = near; camera.updateProjectionMatrix(); }
      renderer.render(scene, camera);
      frames++;
    },

    /* Camera seam: position and look-at target (display metres). The shadow box follows the target. */
    setCameraPose(p) {
      camera.position.set(p.x, p.y, p.z);
      camTarget.set(p.tx, p.ty, p.tz);
      focus.copy(camTarget);
      if (p.fov && p.fov !== camera.fov) { camera.fov = p.fov; camera.updateProjectionMatrix(); }
      camera.lookAt(camTarget);
      camera.updateMatrixWorld();
    },
    setTorch(t) { lights.setTorch(t); },
    /* Render-only clock override: {doy, hour} (either optional); null clears. */
    /* Render-only weather override read by the weather/scatter features: {rain mm/h, snow 0..1, wind m/s, windDir rad}; null clears. */
    debugWeather(w) { dbgWeather = w ? Object.assign({}, w) : null; },
    /* Render-only day-of-year override for the season (autumn ~225, winter ~315); null clears. */
    debugSeason(doy) { dbgSeason = doy === null || doy === undefined ? null : +doy; },
    /* Ask for a shadow-map re-render on the next frame (features call this when a caster moves or changes). */
    invalidateShadows() { shadowDirty = true; },
    debugSetTime(t) { override = t ? { doy: t.doy, hour: t.hour } : null; },

    /* NDC (-1..1) -> terrain hit {type:'terrain'|'water', x,y,z,t} or null. */
    pick(ndcX, ndcY) {
      if (!world.surface) return null;
      camera.updateMatrixWorld();
      tmpV.set(ndcX, ndcY, 0.5).unproject(camera);
      tmpD.copy(tmpV).sub(camera.position);
      ray.x = camera.position.x; ray.y = camera.position.y; ray.z = camera.position.z;
      rdir.x = tmpD.x; rdir.y = tmpD.y; rdir.z = tmpD.z;
      const r = world.surface.raycast(ray, rdir, FAR, hit);
      const len = Math.hypot(rdir.x, rdir.y, rdir.z) || 1;
      const ud = { x: rdir.x / len, y: rdir.y / len, z: rdir.z / len };
      let best = null;
      for (const rec of features) {
        if (!rec.f.pick) continue;
        const h = rec.f.pick(ray, ud, r ? r.t : FAR);
        if (h && (!best || h.t < best.t)) best = h;
      }
      if (best && (!r || best.t <= r.t)) {
        const point = { x: ray.x + ud.x * best.t, y: ray.y + ud.y * best.t, z: ray.z + ud.z * best.t };
        return { type: best.type, point, x: point.x, y: point.y, z: point.z, t: best.t };
      }
      if (!r) return null;
      const type = world.surface.depth(r.x, r.z) > 0 ? 'water' : 'terrain';
      return { type, point: { x: r.x, y: r.y, z: r.z }, x: r.x, y: r.y, z: r.z, t: r.t };
    },

    /* geometry counts per category (static, all meshes) plus what the last frame really rendered (shadow pass included) */
    audit() {
      const info = renderer.info, cat = {}, add = (k, n) => { cat[k] = (cat[k] || 0) + n; };
      scene.traverse((o) => {
        if (!(o.isMesh || o.isPoints || o.isLine) || !o.geometry) return;
        const g = o.geometry, n = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0;
        const dr = g.drawRange.count, c = (dr === Infinity ? n : Math.min(n, dr)) / (o.isPoints ? 1 : 3);
        const tri = Math.round(c * (o.isInstancedMesh ? o.count : 1));
        let k = o.userData && o.userData.cat;
        if (!k) { const nm = o.name || ''; k = /^(scatter|tiles|paths|weather)/.test(nm) ? 'features' : /^(terrain|skirt|table)/.test(nm) ? 'terrain' : /^lake|river/.test(nm) ? 'water' : 'other'; if (k === 'features') k = nm.split('-')[0]; }
        if (o.visible) add(k, tri);
      });
      let total = 0; for (const k in cat) total += cat[k];
      return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : 0, drawCalls: info.render.calls, triangles: info.render.triangles, sceneTriangles: total, categories: cat, quality };
    },

    destroy() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const rec of features) { releaseFeature(rec); if (rec.f.dispose) rec.f.dispose(); }
      siteScope.dispose(); fixedScope.dispose();
      for (const off of busOff) off();
      if (renderer.dispose) renderer.dispose();
    },
  };

  function readLevels(site) {
    const s = Sim, sf = world.surface;
    levels.up = site.dam && site.dam.built ? sf.toDisplayY(site.upper.bottom + s.resLevel(site.upper, site.upper.V)) : NaN;
    levels.lo = sf.toDisplayY(site.lower.bottom + s.resLevel(site.lower, site.lower.V));
  }
  function resize(view) {
    const nw = (view && view.width) || (typeof window !== 'undefined' ? window.innerWidth : 640);
    const nh = (view && view.height) || (typeof window !== 'undefined' ? window.innerHeight : 360);
    const nd = Math.min((view && view.dpr) || (typeof window !== 'undefined' && window.devicePixelRatio) || 1, DPR_CAP[quality]);
    if (nw === w && nh === h && nd === dpr) return;
    w = nw; h = nh; dpr = nd;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  function onLost(e) { if (e && e.preventDefault) e.preventDefault(); lost = true; if (ctx.bus) ctx.bus.emit('alert', { level: 'warn', text: 'Graphics context lost, recovering', why: 'webglcontextlost' }); }
  function onRestored() { lost = false; w = h = dpr = 0; }
  const busOff = [];
  if (ctx.bus) for (const ev of ['game:new', 'game:loaded']) busOff.push(ctx.bus.on(ev, () => { if (ctx.game.state) world.build(ctx.game.state); }));
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  registerFeatures(world);
  world.addFeature(createStructures(world));
  return world;
}
