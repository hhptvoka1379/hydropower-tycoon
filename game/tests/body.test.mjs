import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, TRI_CAP } from '../player/body/check.mjs';
import { createBody } from '../player/body.js';

test('new body: finite, within the triangle budget, 1.74 m, deterministic, mirrored, fast, no cracks at joints in walk/run/climb poses', () => {
  const r = runChecks();
  assert.deepEqual(r.errors, []);
  assert.ok(r.tris <= TRI_CAP, `${r.tris} triangles`);
  assert.equal(r.cracks, 0);
});

test('body seam: opts.legacy returns the old body, default is the new one; options change colours and hair', () => {
  const o = createBody({ legacy: true }), n = createBody();
  assert.equal(o.legacy, true); assert.ok(n.tris > o.tris && n.tris <= TRI_CAP);
  assert.deepEqual(n.partNames, o.partNames);
  const a = createBody({ suitColor: '#ff0000', cap: false }), b = createBody();
  assert.notDeepEqual(Array.from(a.parts.torso.color.slice(0, 60)), Array.from(b.parts.torso.color.slice(0, 60)));
  for (const preset of [{ height: 1.5, build: 0.8, hair: 'bun' }, { height: 1.9, build: 0.2, hair: 'short', suit: 'trunks' }]) {
    const x = createBody({ preset }); assert.ok(x.tris <= TRI_CAP && Number.isFinite(x.rig.standH)); assert.ok(Math.abs(x.height - preset.height) < 1e-9);
  }
});
