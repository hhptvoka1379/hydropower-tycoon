/* Tiles feature (D9, milestone M5): the three parcels of 4 x 4 tiles. Painted borders and gravel pads that follow the ground (every vertex
   sampled on surface.y, <= 2.5 m apart), solar arrays as rigid ROWS of panels (one instanced slab per row, pitched and rolled with the ground,
   no cap: 3 x 16 x 30 panels), wind turbines (static tower, instanced nacelle and rotor; rotors face INTO the wind and spin at the sim rpm),
   battery containers with a status LED, a crane + tape (+ progress column when env.jobs is given) on a tile under construction, and one kiosk
   "parcel desk" per parcel with a painted A/B/C sign.
   Shader programs: every lit mesh here is an InstancedMesh with instanceColor (static meshes are count-1 instances), so they all share ONE lambert program.
   Picking (world.pick seam): pick(origin, unitDir, tMax) -> {type:'tile', parcel, tile, kind, t} for tower / container / crane and
   {type:'desk', parcel, station:'desk'+(p+1), t} for a desk. Never whole tiles (the player's camera occlusion uses pick); for empty ground use pickGround(x,z). */
import { Color, MeshLambertMaterial } from 'three';
import { GB } from './geom.js';
import { PAL, mix, mul } from './palette.js';
import { clamp01 } from './hash.js';
import { writeRow, writeRotor, writeTRS } from './inst.js';
import { createEnvReader, rotorYaw, angDiff } from './envread.js';
import { assetBoxes, layoutTile, parcelLines, parcelOwned, pickTile, pickTileRay, tileConfig, tilesSignature } from './layout.js';
import { drapePatch, ribbonStrip, sampleXZ } from './ribbon.js';
import { containerGB, craneGB, deskGB, DESK_FOOT, ledGB, nacelleGB, panelRowGB, poleGB, rotorGB, stakeGB, towerGB } from './models.js';
import { geoFrom, instancedFrom, staticFrom } from './three-util.js';
import { getStations } from './stations-link.js';

export { pickTile, pickTileRay } from './layout.js';

const LINE_LIFT = 0.12, PAD_LIFT = 0.07, YAW_RATE = 0.35, TAU = Math.PI * 2;
const LED_STATES = [['charging', [0.08, 0.9, 0.22]], ['discharging', [1.0, 0.5, 0.06]], ['idle', [0.12, 0.3, 0.38]], ['low', [1.0, 0.1, 0.04]]];

export function makeTiles(world) {
  const readEnv = createEnvReader();
  let S = null, time = 0;
  const feature = {
    name: 'tiles',
    signature: (site) => tilesSignature(site),
    get layouts() { return S ? S.layouts : null; },
    get stats() { return S ? S.stats : null; },

    build(scope, site, surface, env) {
      const scene = (env && env.scene) || world.scene, cfg = tileConfig(surface.Sim), ts = cfg.ts;
      const layouts = [];
      for (let i = 0; i < site.tiles.length; i++) layouts.push(layoutTile(site, surface, i, cfg));
      const ground = new GB(), props = new GB(), blockers = [];
      const stats = { panels: 0, rows: 0, turbines: 0, batteries: 0, markers: 0, desks: 0, triangles: 0 };

      // ---- parcel borders (dashed when not owned) and gravel pads under occupied tiles
      for (let p = 0; p < site.layout.parcels.length; p++) {
        const owned = parcelOwned(site, p);
        parcelLines(site, p, ts).forEach((ln, k) => {
          if (!owned && ln.kind === 'inner') return;
          const pts = sampleXZ(ln.a[0], ln.a[1], ln.b[0], ln.b[1], 2.5).map(([x, z]) => ({ x, z }));
          const base = owned ? (ln.kind === 'outer' ? PAL.ochre : mix(PAL.ochre, PAL.paper, 0.5)) : mix(PAL.paper, PAL.ink, 0.28);
          ribbonStrip(ground, surface, pts, ln.width, LINE_LIFT, { mid: base, edge: base }, { two: true, dash: owned ? null : [3, 1], seed: p * 64 + k * 7 });
        });
        const P = site.layout.parcels[p];
        for (const [sx, sz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
          const x = P.x + sx * ts, z = P.z + sz * ts;
          props.add(stakeGB(2.6, owned ? PAL.ochre : PAL.clay), x, surface.y(x, z), z, sx * sz > 0 ? 0.6 : -0.6);
        }
      }
      for (const L of layouts) if (L.occupied) drapePatch(ground, surface, L.x - 15.5, L.z - 15.5, L.x + 15.5, L.z + 15.5, 7.75, PAD_LIFT, PAL.gravel, { jitter: 0.05, seed: L.i * 13 });

      // ---- per-tile assets
      const rowGroups = new Map(), poles = [], windRecs = [], leds = [], beacons = [];
      const tileInfo = new Array(layouts.length);
      for (const L of layouts) {
        const info = tileInfo[L.i] = { rows: [] };
        for (const r of L.rows) {
          const key = r.per + '|' + r.pitchX.toFixed(3);
          if (!rowGroups.has(key)) rowGroups.set(key, { per: r.per, pitchX: r.pitchX, panelW: r.panelW, rows: [] });
          const grp = rowGroups.get(key); info.rows.push({ grp, idx: grp.rows.length }); grp.rows.push(r);
          for (const q of r.poles) poles.push(q);
        }
        if (L.wind) {
          const w = L.wind, top = w.building ? w.gy + w.hub * 0.4 : w.gy + w.hub;
          props.add(towerGB(w.x, w.z, w.gyMin - 0.6, top, w.rb, w.rf), 0, 0, 0);
          if (!w.building) windRecs.push({ tile: L.i, x: w.x, z: w.z, hubY: w.gy + w.hub, R: w.R, k: w.k, yaw: 0, spin: (L.i * 1.7) % TAU, init: false });
          stats.turbines++;
        }
        for (const b of L.batts) {
          const top = b.gyMax + 0.18;
          props.add(new GB().box(0, (b.gyMin - 0.4 + top) / 2, 0, 3.6, top - (b.gyMin - 0.4), 9.6, PAL.concrete), b.x, 0, b.z);
          props.add(containerGB(), b.x, top, b.z);
          if (!b.building) leds.push({ x: b.x, y: top, z: b.z, tile: L.i });
          stats.batteries++;
        }
        if (L.crane) {
          stats.markers++;
          const k = L.crane, cx = L.x, cz = L.z;
          props.add(craneGB(k.h), k.x, k.gy, k.z, Math.PI);
          blockers.push({ x0: k.x - 1.8, z0: k.z - 1.8, x1: k.x + 1.8, z1: k.z + 1.8 });
          beacons.push({ x: k.x - k.h * 0.62, y: k.gy + k.h + 0.5, z: k.z, tile: L.i, px: k.x - 3.4, py: k.gy, pz: k.z });
          const R = 16.5, corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
          for (let s = 0; s < 4; s++) {
            const a = corners[s], b = corners[(s + 1) % 4], pts = sampleXZ(cx + a[0], cz + a[1], cx + b[0], cz + b[1], 2.4);
            for (let q = 0; q < pts.length; q++) {
              const [x, z] = pts[q];
              if (q % 3 === 0) props.add(stakeGB(1.5, null), x, surface.y(x, z), z);
              if (q < pts.length - 1) {
                const [x2, z2] = pts[q + 1], y0 = surface.y(x, z), y1 = surface.y(x2, z2), col = q % 2 ? PAL.ochre : PAL.ink;
                const A = [x, y0 + 1.0, z], B = [x2, y1 + 1.0, z2], C = [x2, y1 + 1.3, z2], D = [x, y0 + 1.3, z];
                props.quad(A, B, C, D, col); props.quad(A, D, C, B, col);
              }
            }
          }
        }
      }
      // ---- parcel desks: kiosk 2.8 m beyond the station (the player stands at the station, facing it), counter side toward the station
      const stations = getStations(world, site, surface), desks = [], deskBoxes = [], ph = site.layout.ph;
      site.layout.parcels.forEach((P, p) => {
        const st = stations.find((s) => s.id === 'desk' + (p + 1)), sx = st ? st.x : P.x, sz = st ? st.z : P.z;
        let dx = P.x - ph.x, dz = P.z - ph.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const x = sx + dx * 2.8, z = sz + dz * 2.8, yaw = Math.atan2(-dx, -dz);
        let lo = 1e9, hi = -1e9;
        for (const [a, b] of [[0, 0], [2.0, 1.5], [-2.0, 1.5], [2.0, -1.5], [-2.0, -1.5]]) { const y = surface.y(x + a, z + b); if (y < lo) lo = y; if (y > hi) hi = y; }
        const top = hi + 0.1, c = Math.cos(yaw), s = Math.sin(yaw), hw = DESK_FOOT.w / 2, hd = DESK_FOOT.d / 2;
        props.add(new GB().box(0, (lo - 0.35 + top) / 2, 0, 3.4, top - lo + 0.35, 2.6, PAL.concrete), x, 0, z, yaw);
        props.add(deskGB(p, parcelOwned(site, p)), x, top, z, yaw);
        const ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
        blockers.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
        deskBoxes.push({ type: 'desk', parcel: p, tile: undefined, station: 'desk' + (p + 1), x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez, y0: lo - 0.3, y1: top + 3.4 });
        desks.push({ x, z, yaw });
        stats.desks++;
      });
      if (world && world.blockers) for (const b of blockers) world.blockers.push(b);

      // ---- meshes (all share one lambert program: vertexColors + instancing + instanceColor + receiveShadow)
      const lam = (o = {}) => scope.track(new MeshLambertMaterial(Object.assign({ vertexColors: true }, o)));
      const mGround = lam({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), mProps = lam(), mPanel = lam({ emissive: new Color(0, 0, 0) });
      const mProg = lam();
      const glow = (r, g, b) => lam({ color: 0x000000, emissive: new Color(r, g, b) });
      staticFrom(scope, scene, ground, mGround, { name: 'tiles-ground' });
      staticFrom(scope, scene, props, mProps, { cast: true, name: 'tiles-props' });

      const rowMeshes = [];
      let nRows = 0;
      for (const grp of rowGroups.values()) {
        const m = instancedFrom(scope, scene, geoFrom(scope, panelRowGB(grp.per, grp.pitchX, grp.panelW)), mPanel, grp.rows.length, { cast: true, name: 'tiles-solar-rows' });
        grp.rows.forEach((r, k) => writeRow(m.instanceMatrix.array, k, r.x, r.y, r.z, r.roll, r.pitch));
        m.computeBoundingSphere(); grp.mesh = m; rowMeshes.push(m);
        nRows += grp.rows.length; stats.panels += grp.rows.length * grp.per;
      }
      stats.rows = nRows;
      if (poles.length) {
        const pm = instancedFrom(scope, scene, geoFrom(scope, poleGB()), mProps, poles.length, { cast: true, name: 'tiles-solar-poles' });
        poles.forEach((q, k) => writeTRS(pm.instanceMatrix.array, k, q.x, q.gy - 0.3, q.z, 0, 1, Math.max(0.2, q.top - q.gy + 0.3), 1));
        pm.computeBoundingSphere();
      }
      let nacMesh = null, rotMesh = null, rotFMesh = null;
      if (windRecs.length) {
        nacMesh = instancedFrom(scope, scene, geoFrom(scope, nacelleGB()), mProps, windRecs.length, { cast: true, cull: false, name: 'tiles-nacelles' });
        rotMesh = instancedFrom(scope, scene, geoFrom(scope, rotorGB(false)), mProps, windRecs.length, { cast: true, cull: false, name: 'tiles-rotors' });
        rotFMesh = instancedFrom(scope, scene, geoFrom(scope, rotorGB(true)), mProps, windRecs.length, { cast: true, cull: false, name: 'tiles-rotors-feathered' });
        nacMesh.count = rotMesh.count = rotFMesh.count = 0;
      }
      const ledMeshes = [];
      if (leds.length) {
        const lg = geoFrom(scope, ledGB());
        for (const [name, c] of LED_STATES) { const m = instancedFrom(scope, scene, lg, glow(c[0], c[1], c[2]), leds.length, { name: 'tiles-led-' + name }); m.count = 0; m.frustumCulled = false; ledMeshes.push(m); }
      }
      let beaconMesh = null, progMesh = null, mBeacon = null;
      if (beacons.length) {
        mBeacon = glow(1, 0.45, 0.08);
        beaconMesh = instancedFrom(scope, scene, geoFrom(scope, new GB().box(0, 0, 0, 0.7, 0.7, 0.7, [1, 1, 1])), mBeacon, beacons.length, { name: 'tiles-beacons' });
        beacons.forEach((b, k) => writeTRS(beaconMesh.instanceMatrix.array, k, b.x, b.y, b.z, 0, 1, 1, 1));
        beaconMesh.computeBoundingSphere();
        progMesh = instancedFrom(scope, scene, geoFrom(scope, new GB().box(0, 0.5, 0, 1, 1, 1, PAL.ochre)), mProg, beacons.length, { cast: false, name: 'tiles-progress' });
        progMesh.count = 0; progMesh.frustumCulled = false;
      }
      const tri = (g) => g.triCount;
      stats.triangles = ground.triCount + props.triCount + Array.from(rowGroups.values()).reduce((a, g) => a + g.rows.length * tri(panelRowGB(g.per, g.pitchX, g.panelW)), 0) + poles.length * 6
        + windRecs.length * (tri(nacelleGB()) + tri(rotorGB(false))) + leds.length * 2 + beacons.length * 24;
      S = { site, surface, cfg, layouts, boxes: assetBoxes(layouts).concat(deskBoxes), desks, stats, tileInfo, windRecs, leds, rowMeshes, mPanel, nacMesh, rotMesh, rotFMesh, ledMeshes, beaconMesh, mBeacon, progMesh, beacons, soilCache: new Float32Array(layouts.length).fill(-1), ledMats: ledMeshes.map(m => m.material) };
      scope.onDispose(() => {
        if (world && world.blockers) for (const b of blockers) { const k = world.blockers.indexOf(b); if (k >= 0) world.blockers.splice(k, 1); }
        if (S && S.site === site && S.surface === surface) S = null;
      });
    },

    frame(dt, env) {
      if (!S) return;
      dt = Math.min(dt > 0 ? dt : 0, 0.1); time += dt;
      const st = (env && env.site) || S.site, E = readEnv(env, st), tiles = st.tiles;
      // solar glow follows the irradiance; dust and "under construction" tint the panel rows
      if (S.rowMeshes.length) {
        const G = clamp01(((st.tel && st.tel.G) || 0) / 1000), e = S.mPanel.emissive;
        e.r = 0.006 + 0.03 * G; e.g = 0.02 + 0.08 * G; e.b = 0.05 + 0.16 * G;
        for (let i = 0; i < tiles.length; i++) {
          const info = S.tileInfo[i], so = tiles[i].solar;
          if (!info || !info.rows.length) continue;
          const soil = so ? (so.building ? 9 : Math.min(0.3, so.soil || 0)) : -2;
          if (soil === S.soilCache[i]) continue;
          S.soilCache[i] = soil;
          const k = so && so.building ? 0 : clamp01(soil / 0.3), bd = so && so.building;
          const r = bd ? 0.55 : 1 - 0.28 * k, g = bd ? 0.55 : 1 - 0.34 * k, b = bd ? 0.6 : 1 - 0.5 * k;
          for (const ref of info.rows) { const c = ref.grp.mesh.instanceColor; c.array[ref.idx * 3] = r; c.array[ref.idx * 3 + 1] = g; c.array[ref.idx * 3 + 2] = b; c.needsUpdate = true; }
        }
      }
      // wind: rotors yaw into the wind (slewed) and spin at the sim rpm
      if (S.nacMesh) {
        const target = rotorYaw(E.windDir), na = S.nacMesh.instanceMatrix.array, ra = S.rotMesh.instanceMatrix.array, fa = S.rotFMesh.instanceMatrix.array;
        const rc = S.rotMesh.instanceColor.array, fc = S.rotFMesh.instanceColor.array;
        let nN = 0, nF = 0, nn = 0;
        for (let r = 0; r < S.windRecs.length; r++) {
          const rec = S.windRecs[r], t = tiles[rec.tile] && tiles[rec.tile].wind;
          if (!t || t.building) continue;
          if (!rec.init) { rec.yaw = target; rec.init = true; } else { const m = YAW_RATE * dt, d = angDiff(rec.yaw, target); rec.yaw += d < -m ? -m : d > m ? m : d; }
          const rpm = t.rpm > 0 ? t.rpm : 0;
          rec.spin = (rec.spin + rpm / 60 * TAU * dt) % TAU;
          const fx = Math.sin(rec.yaw), fz = Math.cos(rec.yaw), hub = 3.6 * rec.k, feather = t.feathered || t.damaged;
          writeTRS(na, nn++, rec.x, rec.hubY, rec.z, rec.yaw, rec.k, rec.k, rec.k);
          if (feather) {
            writeRotor(fa, nF, rec.x + fx * hub, rec.hubY, rec.z + fz * hub, rec.yaw, rec.spin * 0.05 + (t.damaged ? 0.6 : 0), rec.R);
            fc[nF * 3] = 1; fc[nF * 3 + 1] = t.damaged ? 0.55 : 1; fc[nF * 3 + 2] = t.damaged ? 0.5 : 1; nF++;
          } else {
            writeRotor(ra, nN, rec.x + fx * hub, rec.hubY, rec.z + fz * hub, rec.yaw, rec.spin, rec.R);
            rc[nN * 3] = rc[nN * 3 + 1] = rc[nN * 3 + 2] = 1; nN++;
          }
        }
        S.nacMesh.count = nn; S.rotMesh.count = nN; S.rotFMesh.count = nF;
        S.nacMesh.instanceMatrix.needsUpdate = S.rotMesh.instanceMatrix.needsUpdate = S.rotFMesh.instanceMatrix.needsUpdate = true;
        S.rotMesh.instanceColor.needsUpdate = S.rotFMesh.instanceColor.needsUpdate = true;
      }
      // battery LEDs: one emissive mesh per state (charging green, discharging ochre, idle teal, low charge blinking red)
      if (S.ledMeshes.length) {
        const cnt = [0, 0, 0, 0], blink = Math.sin(time * 6) > 0 ? 1 : 0.15;
        S.ledMats[3].emissive.setRGB(LED_STATES[3][1][0] * blink, LED_STATES[3][1][1] * blink, LED_STATES[3][1][2] * blink);
        for (let k = 0; k < S.leds.length; k++) {
          const l = S.leds[k], b = tiles[l.tile] && tiles[l.tile].battery;
          if (!b || b.building) continue;
          const s = b.soc < 0.12 ? 3 : b.act === 'charging' ? 0 : b.act === 'discharging' ? 1 : 2, m = S.ledMeshes[s];
          writeTRS(m.instanceMatrix.array, cnt[s]++, l.x, l.y, l.z, 0, 1, 1, 1);
        }
        for (let s = 0; s < 4; s++) { S.ledMeshes[s].count = cnt[s]; S.ledMeshes[s].instanceMatrix.needsUpdate = true; }
      }
      if (S.beaconMesh) {
        const k = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 5)); S.mBeacon.emissive.setRGB(k, k * 0.45, k * 0.08);
        // construction progress column (only when the world passes env.jobs = game.state.jobs)
        const jobs = env && env.jobs;
        if (jobs && S.progMesh) {
          let n = 0;
          for (let k2 = 0; k2 < S.beacons.length; k2++) {
            const bc = S.beacons[k2]; let prog = 0;
            for (let j = 0; j < jobs.length; j++) { const jb = jobs[j]; if (jb.kind === 'build' && jb.p && jb.p.tile === bc.tile && (jb.site === undefined || jb.site === st.id)) { prog = clamp01(1 - jb.rem / Math.max(1, jb.total)); break; } }
            writeTRS(S.progMesh.instanceMatrix.array, n++, bc.px, bc.py, bc.pz, 0, 1.2, Math.max(0.06, prog * 7), 1.2);
          }
          S.progMesh.count = n; S.progMesh.instanceMatrix.needsUpdate = true; S.progMesh.computeBoundingSphere();
        } else if (S.progMesh) S.progMesh.count = 0;
      }
    },

    /* world.pick seam: (origin, unitDir, tMax) -> {type:'tile'|'desk', parcel, tile?, station?, t, x, y, z} | null */
    pick(origin, dir, tMax) { return S ? pickTileRay(S.boxes, origin, dir, tMax) : null; },
    /* terrain hit (x,z) -> {type:'tile', parcel, tile} | null */
    pickGround(x, z) { return S ? pickTile(S.site, x, z, S.cfg.ts) : null; },
  };
  return feature;
}
