/* Tile / parcel layout and picking, THREE-free (runs in Node tests). Everything that touches the ground samples surface.y only.
   Parcel = 4 x 4 tiles of `ts` metres centred on layout.parcels[p]; tile i = 16 p + 4 r + c sits at centre (p.x + (c-1.5) ts, p.z + (r-1.5) ts). */
import { clamp } from './hash.js';

export const DEFAULT_TS = 36;
export const SOLAR_ROWS = [3, 4, 5], SOLAR_PER = [4, 5, 6];   // panels per tile: 12 / 20 / 30 (legacy rows x per)
export const PANEL = { w: 4.4, d: 2.5, tilt: 25 * Math.PI / 180, clear: 0.5 };
export const BATT = { w: 3.0, h: 3.0, l: 9.0, pitch: 4.2 };

export function tileConfig(Sim) {
  const C = Sim && Sim.CONFIG;
  return {
    ts: C && C.land ? C.land.tileSize : DEFAULT_TS,
    wind: C && C.wind ? C.wind.tiers.map(t => ({ R: t.R, hub: t.hub })) : [{ R: 14, hub: 36 }, { R: 22, hub: 55 }, { R: 36, hub: 80 }],
  };
}
export const tileRC = (i) => { const p = Math.floor(i / 16), k = i - p * 16, r = Math.floor(k / 4); return { p, r, c: k - r * 4 }; };
export function tileCenter(site, i, ts = DEFAULT_TS, out = { x: 0, z: 0 }) {
  const rc = tileRC(i), p = site.layout.parcels[rc.p];
  out.x = p.x + (rc.c - 1.5) * ts; out.z = p.z + (rc.r - 1.5) * ts; return out;
}
export const parcelOwned = (site, p) => !!(site.parcels && site.parcels[p]);

/* ---- signature: changes exactly when something the tile meshes depend on changes ---- */
export function tilesSignature(site) {
  const L = site.layout, parts = [];
  if (L) parts.push(L.parcels.map(p => Math.round(p.x) + ',' + Math.round(p.z)).join(';'));
  for (let p = 0; p < 3; p++) parts.push(parcelOwned(site, p) ? '1' : '0');
  const T = site.tiles || [];
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    let s = '';
    if (t.solar) s += 's' + t.solar.tier + (t.solar.building ? '~' : '');
    if (t.wind) s += 'w' + t.wind.tier + (t.wind.building ? '~' : '');
    if (t.battery) s += 'b' + t.battery.tier + (t.battery.building ? '~' : '');
    parts.push(s);
  }
  return parts.join('|');
}

/* ---- per-tile asset layout (positions already on the ground) ---- */
export function panelGrid(tier, shared) {
  const rows = SOLAR_ROWS[tier] || SOLAR_ROWS[0], per = SOLAR_PER[tier] || SOLAR_PER[0];
  const region = shared ? { xc: -8, w: 18 } : { xc: 0, w: 28.8 }, pitchZ = 28.8 / rows, pitchX = region.w / per;
  return { rows, per, xc: region.xc, w: region.w, pitchX, pitchZ, panelW: Math.min(PANEL.w, pitchX * 0.92) };
}

/* Returns {i, x, z, panels[], pole[], wind, batts[], y0, y1} for tile i with ground-sampled heights. */
export function layoutTile(site, surface, i, cfg) {
  const ts = cfg.ts, t = site.tiles[i], c = tileCenter(site, i, ts), out = { i, x: c.x, z: c.z, rows: [], panelCount: 0, crane: null, wind: null, batts: [], building: false, gyMin: 1e9, gyMax: -1e9 };
  const sampleRange = (x0, z0, x1, z1) => { for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) { const y = surface.y(x0 + (x1 - x0) * a / 4, z0 + (z1 - z0) * b / 4); if (y < out.gyMin) out.gyMin = y; if (y > out.gyMax) out.gyMax = y; } };
  sampleRange(c.x - ts / 2, c.z - ts / 2, c.x + ts / 2, c.z + ts / 2);
  const hasWind = !!t.wind, hasBatt = !!t.battery, hasSolar = !!t.solar;
  if (hasSolar) {
    // one rigid slab per ROW of panels: pitched to the south (25 deg over flat ground), rolled along a cross slope, three poles to the ground
    const g = panelGrid(t.solar.tier, hasWind || hasBatt), d2 = PANEL.d / 2, Lr = (g.per - 1) * g.pitchX + g.panelW, hx = Lr / 2;
    for (let r = 0; r < g.rows; r++) {
      const x = c.x + g.xc, z = c.z + (r - (g.rows - 1) / 2) * g.pitchZ;
      const pitch = clamp(PANEL.tilt - Math.atan2(surface.y(x, z + d2) - surface.y(x, z - d2), PANEL.d), -0.1, 0.95);
      const roll = clamp(Math.atan2(surface.y(x + hx, z) - surface.y(x - hx, z), Lr), -0.6, 0.6);
      const sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
      let y = surface.y(x, z) + PANEL.clear + 0.1;
      for (const xi of [-hx, 0, hx]) for (const zs of [1, -1]) {
        const gy = surface.y(x + xi * cr, z + zs * d2 * cp), off = xi * sr - zs * d2 * sp * cr;
        if (gy + PANEL.clear - off > y) y = gy + PANEL.clear - off;
      }
      const poles = [];
      for (const xi of [-hx + 0.6, 0, hx - 0.6]) { const wx = x + xi * cr, gy = surface.y(wx, z); poles.push({ x: wx, z, gy, top: y + xi * sr - 0.1 }); }
      out.rows.push({ x, z, gy: surface.y(x, z), y, pitch, roll, per: g.per, n: g.per, pitchX: g.pitchX, panelW: g.panelW, building: !!t.solar.building, poles });
      out.panelCount += g.per;
    }
    if (t.solar.building) out.building = true;
  }
  if (hasWind) {
    const tr = cfg.wind[t.wind.tier] || cfg.wind[0], x = c.x + (hasSolar ? 10 : 0), z = c.z;
    const R = tr.R, rb = R * 0.075 + 0.6, rf = rb + 0.9;
    let gyMin = 1e9, gyMax = -1e9;
    for (let a = 0; a < 8; a++) { const y = surface.y(x + Math.cos(a * 0.785) * rf, z + Math.sin(a * 0.785) * rf); if (y < gyMin) gyMin = y; if (y > gyMax) gyMax = y; }
    const gy = surface.y(x, z);
    out.wind = { x, z, gy, gyMin: Math.min(gyMin, gy), gyMax: Math.max(gyMax, gy), R, hub: tr.hub, rb, rf, tier: t.wind.tier, building: !!t.wind.building, k: clamp(R / 22, 0.7, 1.6) };
    if (t.wind.building) out.building = true;
  }
  if (hasBatt) {
    const n = t.battery.tier + 1, ox = hasSolar ? 8 : 0, bz = c.z + 6;
    for (let k = 0; k < n; k++) {
      const x = c.x + ox + (k - (n - 1) / 2) * BATT.pitch;
      let gyMin = 1e9, gyMax = -1e9;
      for (const sx of [-BATT.w / 2, BATT.w / 2]) for (const sz of [-BATT.l / 2, 0, BATT.l / 2]) { const y = surface.y(x + sx, bz + sz); if (y < gyMin) gyMin = y; if (y > gyMax) gyMax = y; }
      out.batts.push({ x, z: bz, gy: surface.y(x, bz), gyMin, gyMax, tier: t.battery.tier, building: !!t.battery.building, tile: i });
    }
    if (t.battery.building) out.building = true;
  }
  if (out.building) { const h = hasWind && out.wind.building ? 16 : 10, kx = c.x + 15.5, kz = c.z - 15.5; out.crane = { x: kx, z: kz, gy: surface.y(kx, kz), h }; }
  out.occupied = hasSolar || hasWind || hasBatt;
  return out;
}

/* ---- parcel border lines: [{a:[x,z], b:[x,z], width, kind}] (5 lines each way; k = 0 and 4 are the outer border) ---- */
export function parcelLines(site, p, ts) {
  const P = site.layout.parcels[p], h = 2 * ts, lines = [];
  for (let k = 0; k <= 4; k++) {
    const o = k === 0 || k === 4, w = o ? 0.8 : 0.4;
    lines.push({ a: [P.x - h, P.z - h + k * ts], b: [P.x + h, P.z - h + k * ts], width: w, kind: o ? 'outer' : 'inner' });
    lines.push({ a: [P.x - h + k * ts, P.z - h], b: [P.x - h + k * ts, P.z + h], width: w, kind: o ? 'outer' : 'inner' });
  }
  return lines;
}

/* ---- picking ---- */
/* Terrain hit -> tile footprint it falls in: {type:'tile', parcel, tile} or null. */
export function pickTile(site, x, z, ts = DEFAULT_TS) {
  const P = site.layout.parcels;
  for (let p = 0; p < P.length; p++) {
    const c = Math.floor((x - P[p].x) / ts + 2), r = Math.floor((z - P[p].z) / ts + 2);
    if (c >= 0 && c < 4 && r >= 0 && r < 4) return { type: 'tile', parcel: p, tile: p * 16 + r * 4 + c };
  }
  return null;
}
/* Proxy boxes for ray picking (so a click on a turbine blade or a panel in the air resolves to its tile): one per tile. */
/* Ray proxies, deliberately narrow (the player's camera occlusion calls every feature's pick): only solid things, never whole tiles.
   wind tower, battery containers, crane. Empty ground resolves through pickTile(site, x, z) on the terrain hit. */
export function assetBoxes(layouts) {
  const boxes = [];
  for (const L of layouts) {
    const base = { type: 'tile', parcel: Math.floor(L.i / 16), tile: L.i };
    if (L.wind) { const w = L.wind, r = w.rb + 0.4; boxes.push({ ...base, kind: 'wind', x0: w.x - r, x1: w.x + r, z0: w.z - r, z1: w.z + r, y0: w.gyMin - 0.5, y1: w.gy + w.hub + 2 }); }
    for (const b of L.batts) boxes.push({ ...base, kind: 'battery', x0: b.x - 1.6, x1: b.x + 1.6, z0: b.z - 4.6, z1: b.z + 4.6, y0: b.gyMin - 0.4, y1: b.gyMax + 3.3 });
    if (L.crane) { const k = L.crane; boxes.push({ ...base, kind: 'crane', x0: k.x - 1.7, x1: k.x + 1.7, z0: k.z - 1.7, z1: k.z + 1.7, y0: k.gy - 0.3, y1: k.gy + k.h + 1.5 }); }
  }
  return boxes;
}
export function tileBoxes(site, surface, cfg) {
  const layouts = [];
  for (let i = 0; i < site.tiles.length; i++) layouts.push(layoutTile(site, surface, i, cfg));
  return assetBoxes(layouts);
}
const hitOut = { type: 'tile', parcel: 0, tile: 0, station: undefined, t: 0, x: 0, y: 0, z: 0 };
/* Ray (origin, dir: {x,y,z}) vs the proxy boxes: nearest hit within tMax or null. Returns a shared scratch object unless `out` is given. */
export function pickTileRay(boxes, o, d, tMax = Infinity, out = hitOut) {
  let best = tMax, bi = -1;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let t0 = 0, t1 = best;
    const axes = [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]];
    let ok = true;
    for (const [oo, dd, lo, hi] of axes) {
      if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) { ok = false; break; } continue; }
      let a = (lo - oo) / dd, c = (hi - oo) / dd; if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a; if (c < t1) t1 = c;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < best) { best = t0; bi = i; }
  }
  if (bi < 0) return null;
  const b = boxes[bi];
  out.type = b.type || 'tile'; out.parcel = b.parcel; out.tile = b.tile; out.station = b.station; out.t = best; out.x = o.x + d.x * best; out.y = o.y + d.y * best; out.z = o.z + d.z * best;
  return out;
}
