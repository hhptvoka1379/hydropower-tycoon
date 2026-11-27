// Feature registry (decisions/fable.md D9). Each feature module exports a factory returning
// { name, signature(site), build(scope, site, surface, env), frame(dt, env), pick? } and is listed here.
import { makeTiles } from './tiles.js';
import { makeScatter } from './scatter.js';
import { makeWeather } from './weather.js';
import { makePaths } from './paths.js';

export const FEATURES = [makePaths, makeTiles, makeScatter, makeWeather];
export function registerFeatures(world) {
  for (const make of FEATURES) world.addFeature(make(world));
}
