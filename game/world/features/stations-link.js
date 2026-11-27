/* Shared, cached access to the stations and footpath graph of game/player/stations.js (read-only import), so tiles, scatter and paths agree.
   If the world (or the player) already owns them (world.stations / world.paths) those are used as they are; otherwise they are computed here
   from the surface with world.blockers as the solid footprints. buildPaths is the slow part (about 1-2 s), so it is memoised per surface and
   per dam / lower-basin state and only runs for the features that need the graph. */
import { buildStations, buildPaths, defaultBlocked } from '../../player/stations.js';

const cache = new WeakMap();
const keyOf = (site, surface) => [surface.version, site.dam && site.dam.height, site.dam && site.dam.raising && site.dam.raising.to, site.lower && site.lower.excav, site.kind].join('|');

function blockedFor(world, site) {
  const out = [];
  try { out.push(defaultBlocked(site)[0]); } catch (e) { /* no powerhouse yet */ }
  for (const b of (world && world.blockers) || []) out.push(b);
  return out;
}

export function getStations(world, site, surface) {
  if (world && Array.isArray(world.stations) && world.stations.length) return world.stations;
  let c = cache.get(surface);
  const key = keyOf(site, surface);
  if (!c || c.key !== key) { c = { key, stations: null, paths: null }; cache.set(surface, c); }
  if (!c.stations) c.stations = buildStations(site, surface, { blocked: blockedFor(world, site) });
  return c.stations;
}

/* -> { stations, paths, owned } ; owned = true when the paths came from the world/player (their floor providers are theirs to register) */
export function getRoutes(world, site, surface) {
  if (world && world.paths && Array.isArray(world.paths.flights)) return { stations: getStations(world, site, surface), paths: world.paths, owned: true };
  const stations = getStations(world, site, surface);
  const c = cache.get(surface);
  if (!c.paths) c.paths = buildPaths(stations, surface, { blocked: blockedFor(world, site) });
  return { stations, paths: c.paths, owned: false };
}
