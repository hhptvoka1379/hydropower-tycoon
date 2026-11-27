/* Paths feature (D9): the trodden footpath strips between the stations and the stair flights / bridge decks of game/player/stations.js.
   The graph comes from world.paths / world.stations when the world already has them, otherwise from buildStations + buildPaths (memoised in
   stations-link.js). Strips hug surface.y + 0.06 on every vertex; flights are stepped meshes whose tread tops are exactly Flight.floor, and their
   floor providers are registered on the surface (the world removes them again when this feature is rebuilt). */
import { MeshLambertMaterial } from 'three';
import { GB } from './geom.js';
import { PAL, mix, mul } from './palette.js';
import { ribbonStrip } from './ribbon.js';
import { chainsOf, densify, normalizePaths } from './pathsnorm.js';
import { addFlight } from './stairs.js';
import { meshFrom } from './three-util.js';
import { getRoutes } from './stations-link.js';

const PATH_LIFT = 0.06, PATH_W = 1.9;

export function makePaths(world) {
  let S = null;
  return {
    name: 'paths',
    signature(site) {
      const d = site.dam || {}, L = site.layout;
      return [site.kind, d.height, d.raising && d.raising.to, site.lower && site.lower.excav, L ? [L.ph.x, L.ph.z, L.dam.x, L.dam.z, L.lo.x, L.lo.z].map(Math.round).join(',') + ';' + L.parcels.map(p => Math.round(p.x) + ',' + Math.round(p.z)).join(';') : ''].join('|');
    },
    get stats() { return S ? S.stats : null; },
    get flights() { return S ? S.flights : null; },

    build(scope, site, surface, env) {
      const scene = (env && env.scene) || world.scene, r = getRoutes(world, site, surface), raw = r.paths, np = normalizePaths(raw);
      const inFlight = (x, z) => { for (const f of np.flights) if (f.floor && f.floor(x, z) === f.floor(x, z)) return true; return false; };
      const skip = (ax, az, bx, bz) => { const mx = (ax + bx) / 2, mz = (az + bz) / 2; return inFlight(mx, mz) || surface.depth(mx, mz) > 0.05; };
      const chains = chainsOf(raw, skip), strip = new GB(), solid = new GB(), rails = new GB();
      const trod = PAL.trodden, cols = { mid: trod, edge: mix(trod, PAL.moss, 0.35) };
      chains.forEach((c, i) => { if (c.length > 1) ribbonStrip(strip, surface, densify(c, 1.1), PATH_W, PATH_LIFT, cols, { jitter: 0.04, seed: i * 131 }); });
      const fs = { treads: 0, flights: np.flights.length };
      for (const f of np.flights) fs.treads += addFlight(solid, rails, f, surface).treads;
      const mStrip = scope.track(new MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      const mSolid = scope.track(new MeshLambertMaterial({ vertexColors: true }));
      meshFrom(scope, scene, strip, mStrip, { name: 'paths-strips' });
      meshFrom(scope, scene, solid, mSolid, { cast: true, name: 'paths-stairs' });
      meshFrom(scope, scene, rails, mSolid, { cast: true, name: 'paths-rails' });
      // walkable heights: the same tread tops as the drawn mesh (skipped when the world/player registers its own flights)
      if (!r.owned) for (const f of raw.flights || []) if (typeof f.floor === 'function') { surface.addFloorProvider(f.floor); scope.onDispose(() => surface.removeFloorProvider && surface.removeFloorProvider(f.floor)); }
      S = { stats: Object.assign(fs, { stripTriangles: strip.triCount, stairTriangles: solid.triCount + rails.triCount, chains: chains.length }), flights: np.flights, site };
      scope.onDispose(() => { if (S && S.site === site) S = null; });
    },
    frame() {},
  };
}
