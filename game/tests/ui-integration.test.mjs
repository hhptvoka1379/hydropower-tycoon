import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim, createGame } from '../sim/index.js';
import { createClock } from '../player/timemode.js';
import { pickTile } from '../world/features/tiles.js';

test('timemode: 6-speed index maps cleanly to 1 min/s .. 1 day/s and keeps cycleDebug', () => {
  const clock = createClock(Sim);
  assert.equal(clock.speedIndex, 0);
  assert.equal(clock.rate, 60);

  clock.setSpeedIndex(2);
  assert.equal(clock.speedIndex, 2);
  assert.equal(clock.rate, 3600);

  clock.setSpeedIndex(5);
  assert.equal(clock.speedIndex, 5);
  assert.equal(clock.rate, 86400);

  clock.setSpeedIndex(99);
  assert.equal(clock.speedIndex, 5);
  clock.setSpeedIndex(-3);
  assert.equal(clock.speedIndex, 0);

  assert.equal(clock.cycleDebug(), 600);
});

test('ui/index.js exports createUI and uses only valid Sim actions', async () => {
  const uiMod = await import('../ui/index.js');
  assert.equal(typeof uiMod.createUI, 'function');

  const actionsSrc = readFileSync(new URL('../sim/actions.js', import.meta.url), 'utf8');
  const validTypes = new Set([...actionsSrc.matchAll(/case '([A-Z_]+)'/g)].map(m => m[1]));

  const uiSrc = readFileSync(new URL('../ui/index.js', import.meta.url), 'utf8');
  const sentTypes = [...uiSrc.matchAll(/type:\s*'([A-Z_]+)'/g)].map(m => m[1]);
  assert.ok(sentTypes.length >= 15, 'expected >= 15 action types in ui/index.js');
  for (const t of sentTypes) {
    assert.ok(validTypes.has(t), `Action '${t}' used in game/ui/index.js is missing from game/sim/actions.js`);
  }
});

test('pickTile resolves ground coordinates within parcels to parcel/tile metadata', () => {
  const g = createGame();
  g.newGame({ seed: 14692 });
  const s = g.state.sites[0];
  const P = s.layout.parcels[1];
  const ts = Sim.CONFIG.land.tileSize;
  const hit = pickTile(s, P.x - 54 + 1, P.z - 18 + 2, ts);
  assert.deepEqual(hit, { type: 'tile', parcel: 1, tile: 20 });
});
