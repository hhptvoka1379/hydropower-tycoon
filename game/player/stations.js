/* Stations (decisions/fable.md D4), the path graph that connects them and the stair flights / decks the routes need. Pure ES module: no DOM, no THREE,
   no Math.random, no Date. Everything is in display metres and reads only the Surface API of D2 (y, floorY, slopeDeg, depth, waterSurface).

   buildStations(site, surface, opts) -> [{id, kind, label, x, z, y, range, parcel?, nominal:{x,z}}]
   buildPaths(stations, surface, opts) -> {nodes, edges, flights, routes, blocked, cell}
   registerFlights(surface, paths)     -> registers every flight's floor function with surface.addFloorProvider
   stationAt(x, z, stations)           -> nearest station whose range contains the point, or null
   createStationTracker(stations)      -> hysteresis wrapper (enter at range, leave at range + hysteresis) so cards do not flicker */
import {createWalker, PLAYER} from './walker.js';

export const STATION = {
  ranges: {powerhouse: 6, board: 8, dam: 8, penstock: 5, upper: 6, lower: 6, desk: 6, slide: 6, lookout: 8}, // m, the card opens inside this distance
  hysteresis: 2.5, // m beyond `range` before a card closes
  phFootprint: {w: 11, d: 8}, // m, powerhouse walls (demo: 10.8 x 7.8). Solid for the walker; the world draws it.
  snapMaxSlope: 22, // deg: a station spot must be flatter than this (search outward until it is)
  snapRelaxSlope: 30, // deg: fall back to this if nothing flatter exists within the search radius
  snapRadius: 220, // m search radius
  dryMargin: 0.05, // m of water allowed at a station spot
  shoreMargin: 5, // m above the waterline for shore stations
  flightRiser: 0.18, flightTread: 0.27, // m; riser/tread = 0.667 = 33.7 deg, just above the planner's 0.644 so walkable slopes never need stairs
  flightHalfWidth: 1.2, // m
  deckClear: 1.0, // m above the water for a bridge deck
  hoverEps: 0.03, // m: a route needs a structure only where the envelope is this far above the terrain
  edgyCost: 4.5, // x length: a leg that is walkable on its centre line only (a steep side slope with no margin)
  structCost: 4.5, // x length: Dijkstra price of a stair/deck leg against a walkable one
  cell: 6, // m grid pitch of the route search
  margin: 120 // m around the stations for the route search box
};

const TAU = Math.PI * 2;
const hyp = Math.hypot;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ blocked footprints */
export function defaultBlocked(site) {
  const ph = site.layout.ph, F = STATION.phFootprint;
  return [{x0: ph.x - F.w / 2, z0: ph.z - F.d / 2, x1: ph.x + F.w / 2, z1: ph.z + F.d / 2}];
}

/* ------------------------------------------------------------------ spot search */
/* Where can the water be at its highest? The sim's reservoirs reach a maximum level (upper: dam height - freeboard; lower: hMax). A station has to be dry
   there, not only at the level of the moment, otherwise it floods during play. The test is geometric and independent of the live level, so the
   result does not change as the lakes fill. flood.prone(x,z) is true when (x,z) is inside a lake's maximum extent and lower than its maximum level. */
export function floodModel(site, surface, opts = {}) {
  const L = site.layout, fb = opts.freeboard === undefined ? 2 : opts.freeboard, margin = opts.margin === undefined ? 0.6 : opts.margin;
  const area = (r, h) => (r.a1 + 2 * r.a2 * h + 3 * r.a3 * h * h), radius = (r, h) => Math.sqrt(Math.max(0, area(r, h)) / Math.PI);
  const dm = site.dam || {}, damTop = Math.max(dm.height || 0, dm.raising && dm.raising.to ? dm.raising.to : 0);
  const upH = dm.built || dm.raising ? Math.max(0, damTop - fb) : 0, loH = site.lower.hMax || 20;
  const up = {level: surface.toDisplayY(site.upper.bottom + upH), h: upH, R: radius(site.upper, upH) * 1.3 + 12}, lo = {level: surface.toDisplayY(site.lower.bottom + loH), h: loH, R: radius(site.lower, loH) * 1.3 + 12};
  const classic = site.kind === 'classic';
  const prone = (x, z) => {
    const y = surface.floorY(x, z); // floor, not terrain: a crest walkway above the water is dry ground
    if (y < lo.level + margin && Math.hypot(x - L.lo.x, z - L.lo.z) <= lo.R) return true;
    if (upH > 0 && y < up.level + margin) {
      if (classic) { if (Math.hypot(x - L.up.x, z - L.up.z) <= up.R) return true; }
      else if (z < L.dam.z + 6 && z > L.dam.z - 900) return true; // canyon: the reservoir fills the valley upstream of the dam
    }
    return false;
  };
  return {prone, up, lo, upH, loH};
}

function makeSpotTools(surface, walker, flood) {
  let skipWater = false; // the powerhouse yard sits at the lower lake's start level by the sim's own design: tested against the live water only, not the maximum
  const dryAt = (x, z) => walker.wetDepth(x, z) <= STATION.dryMargin;
  const proneAt = (x, z) => !skipWater && flood.prone(x, z);
  const clearOfWalls = (x, z) => { for (const [a, b] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) if (walker.inBlocked(x + a, z + b)) return false; return true; };
  function good(x, z, maxSlope) {
    if (Math.abs(x) > walker.LIM - 6 || Math.abs(z) > walker.LIM - 6) return false;
    if (!clearOfWalls(x, z)) return false;
    for (const [a, b] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
      if (!dryAt(x + a, z + b) || proneAt(x + a, z + b)) return false;
      if (surface.slopeDeg(x + a, z + b) > maxSlope) return false;
    }
    return true;
  }
  /* snap(x, z, pred) -> nearest good spot to (x,z); expands in rings. pred(x,z) adds a kind-specific condition. */
  function snap(x, z, pred) {
    for (const maxSlope of [STATION.snapMaxSlope, STATION.snapRelaxSlope]) {
      for (let r = 0; r <= STATION.snapRadius; r += 2) {
        const n = r === 0 ? 1 : Math.max(12, Math.ceil(TAU * r / 3));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (good(px, pz, maxSlope) && (!pred || pred(px, pz))) return {x: px, z: pz};
        }
      }
    }
    return {x, z, failed: true};
  }
  /* first point along a ray from a lake centre that is above the lake's MAXIMUM level (the shore at full pool); null if there is none within rMax */
  function shoreAlong(cx, cz, ang, rMax, level) {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let below = false;
    for (let r = 0; r <= rMax; r += 2) {
      const x = cx + dx * r, z = cz + dz * r;
      if (Math.abs(x) > walker.LIM || Math.abs(z) > walker.LIM) return null;
      const y = surface.y(x, z);
      if (y < level) below = true; else if (below) return r;
    }
    return null;
  }
  return {snap, good, shoreAlong, dryAt, noWater(v) { skipWater = !!v; }};
}

function routeMid(site) {
  const R = site.route && site.route.length > 1 ? site.route : [site.layout.dam, site.layout.ph];
  let L = 0; for (let i = 1; i < R.length; i++) L += hyp(R[i].x - R[i - 1].x, R[i].z - R[i - 1].z);
  let acc = 0, half = L / 2;
  for (let i = 1; i < R.length; i++) {
    const l = hyp(R[i].x - R[i - 1].x, R[i].z - R[i - 1].z);
    if (acc + l >= half) { const t = (half - acc) / (l || 1); return {x: R[i - 1].x + (R[i].x - R[i - 1].x) * t, z: R[i - 1].z + (R[i].z - R[i - 1].z) * t, tx: (R[i].x - R[i - 1].x) / (l || 1), tz: (R[i].z - R[i - 1].z) / (l || 1)}; }
    acc += l;
  }
  const a = R[0]; return {x: a.x, z: a.z, tx: 1, tz: 0};
}

/* ------------------------------------------------------------------ stations */
/* opts: {blocked, walker, slide:{x,z}} (slide = platform position from World.slide when the world has one) */
export function buildStations(site, surface, opts = {}) {
  const L = site.layout, blocked = opts.blocked || defaultBlocked(site);
  const walker = opts.walker || createWalker(surface, {blocked});
  const flood = opts.flood || floodModel(site, surface);
  const T = makeSpotTools(surface, walker, flood);
  const out = [];
  const add = (id, kind, label, nx, nz, extra) => {
    T.noWater(kind === 'powerhouse' || kind === 'board');
    const s = T.snap(nx, nz, extra && extra.pred);
    T.noWater(false);
    const st = {id, kind, label, x: s.x, z: s.z, y: surface.floorY(s.x, s.z), range: STATION.ranges[kind], nominal: {x: nx, z: nz}};
    if (extra && extra.parcel !== undefined) st.parcel = extra.parcel;
    if (s.failed) st.snapFailed = true;
    out.push(st); return st;
  };
  const dir = L.dir && (L.dir.x || L.dir.z) ? L.dir : {x: 1, z: 0}; // dam -> powerhouse (classic: upper -> lower)
  const perp = {x: -dir.z, z: dir.x};
  // powerhouse: in front of the door, on the dam side of the building, outside the footprint
  let pd = 9; const box = blocked[0];
  for (; pd < 30; pd += 1) { const x = L.ph.x - dir.x * pd, z = L.ph.z - dir.z * pd; if (!box || x < box.x0 - 3 || x > box.x1 + 3 || z < box.z0 - 3 || z > box.z1 + 3) break; }
  add('powerhouse', 'powerhouse', 'Powerhouse', L.ph.x - dir.x * pd, L.ph.z - dir.z * pd);
  // forecast board at the powerhouse yard, beside the door
  add('board', 'board', 'Forecast board', L.ph.x - dir.x * (pd - 2) + perp.x * 10, L.ph.z - dir.z * (pd - 2) + perp.z * 10);
  // dam crest
  add('dam', 'dam', 'Dam crest', L.dam.x, L.dam.z);
  // penstock: a valve house beside the mid-point of the pipe
  const pm = routeMid(site);
  add('penstock', 'penstock', 'Penstock valve house', pm.x - pm.tz * 7, pm.z + pm.tx * 7);
  // upper shore: first dry ground on a ray from the upper basin centre, away from the dam / across the valley
  const up = L.up;
  const aUp = site.kind === 'classic' ? Math.atan2(dir.z, dir.x) + 100 * Math.PI / 180 : (L.ph.x >= up.x ? 0 : Math.PI);
  const rU = T.shoreAlong(up.x, up.z, aUp, 520, flood.up.level + 0.6);
  const rUs = (rU === null ? 200 : rU) + STATION.shoreMargin;
  add('upper', 'upper', 'Upper shore', up.x + Math.cos(aUp) * rUs, up.z + Math.sin(aUp) * rUs);
  // lower shore: on the ray from the lower basin centre towards the powerhouse, turned 30 degrees
  const lo = L.lo, aLo = Math.atan2(L.ph.z - lo.z, L.ph.x - lo.x) + 30 * Math.PI / 180;
  const rL = T.shoreAlong(lo.x, lo.z, aLo, 520, flood.lo.level + 0.6);
  const rLs = (rL === null ? 200 : rL) + STATION.shoreMargin;
  const lower = add('lower', 'lower', 'Lower shore', lo.x + Math.cos(aLo) * rLs, lo.z + Math.sin(aLo) * rLs);
  // one desk per parcel
  L.parcels.forEach((p, i) => add('desk' + (i + 1), 'desk', 'Parcel ' + (i + 1) + ' desk', p.x, p.z, {parcel: i}));
  // slide platform: from the world if it knows, else on the hillside above the lower shore
  if (opts.slide) add('slide', 'slide', 'Slide platform', opts.slide.x, opts.slide.z);
  else { const a2 = aLo + 35 * Math.PI / 180, rs = rLs + 60; add('slide', 'slide', 'Slide platform', lo.x + Math.cos(a2) * rs, lo.z + Math.sin(a2) * rs); }
  // rim lookout: the highest good ground within a minute or two of the powerhouse
  {
    const ph = L.ph; let best = null;
    for (let r = 120; r <= 380; r += 30) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU, x = ph.x + Math.cos(a) * r, z = ph.z + Math.sin(a) * r;
        if (!T.good(x, z, 20)) continue;
        const sc = surface.floorY(x, z) - 0.2 * r;
        if (!best || sc > best.sc + 1e-9) best = {sc, x, z};
      }
    }
    if (best) add('lookout', 'lookout', 'Rim lookout', best.x, best.z);
    else add('lookout', 'lookout', 'Rim lookout', ph.x + 150, ph.z + 150);
  }
  return out;
}

/* ------------------------------------------------------------------ nearest station, hysteresis */
export function stationAt(x, z, stations) {
  let best = null, bd = Infinity;
  for (const s of stations) { const d = hyp(s.x - x, s.z - z); if (d <= s.range && d < bd) { bd = d; best = s; } }
  return best;
}
/* tracker.update(x,z) -> {current, entered, left}. A card opens inside `range` and closes only beyond range + hysteresis; when two ranges overlap the
   nearer station takes over only once the current one is left or the other is clearly (1 m) nearer. */
export function createStationTracker(stations, hyst = STATION.hysteresis) {
  let cur = null;
  return {
    get current() { return cur; },
    reset() { cur = null; },
    update(x, z) {
      let next = cur;
      if (cur) {
        const dc = hyp(cur.x - x, cur.z - z);
        if (dc > cur.range + hyst) next = null;
        else { const n = stationAt(x, z, stations); if (n && n !== cur && hyp(n.x - x, n.z - z) + 1 < dc) next = n; }
      }
      if (!next) next = stationAt(x, z, stations);
      const entered = next && next !== cur ? next : null, left = cur && next !== cur ? cur : null;
      cur = next;
      return {current: cur, entered, left};
    }
  };
}

/* ------------------------------------------------------------------ flights */
/* A flight is a stair run or a deck: a centre line (few straight legs) with a profile of treads. floor(x,z) -> tread top or NaN, like a Surface floor provider. */
function makeFlight(id, legs, tops, kind) {
  const S = STATION;
  const pts = legs; const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hyp(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const len = cum[cum.length - 1];
  let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
  for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  const m = S.flightHalfWidth + 0.2; x0 -= m; z0 -= m; x1 += m; z1 += m;
  const hw = S.flightHalfWidth, tread = S.flightTread, nT = tops.length;
  const proj = {s: 0, d: 0};
  function project(x, z) {
    let best = 1e18, bs = 0, out = false;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
      const tr = l2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / l2 : 0;
      const t = tr < 0 ? 0 : tr > 1 ? 1 : tr;
      const px = a.x + ex * t, pz = a.z + ez * t, dd = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dd < best) { best = dd; bs = cum[i] + t * Math.sqrt(l2); out = (i === 0 && tr < 0) || (i === pts.length - 2 && tr > 1); }
    }
    proj.s = bs; proj.d = out ? Infinity : Math.sqrt(best); return proj;
  }
  const F = {
    id, kind, pts, cum, len, bbox: [x0, z0, x1, z1], tops, tread, riser: S.flightRiser, width: hw * 2, n: nT,
    lo: tops[0], hi: tops[nT - 1], rise: tops[nT - 1] - tops[0],
    floor(x, z) {
      if (x < x0 || x > x1 || z < z0 || z > z1) return NaN;
      const p = project(x, z); if (p.d > hw) return NaN;
      return tops[Math.min(nT - 1, Math.floor(p.s / tread))];
    },
    treadTop: (i) => tops[i]
  };
  return F;
}

export function registerFlights(surface, paths) { for (const f of paths.flights) surface.addFloorProvider(f.floor); }

/* ------------------------------------------------------------------ paths */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

/* opts: {blocked, walker, cell, margin}. The first station of kind 'powerhouse' is the root of the route tree. */
export function buildPaths(stations, surface, opts = {}) {
  const S = STATION, cell = opts.cell || S.cell, blocked = opts.blocked || [];
  const walker = opts.walker || createWalker(surface, {blocked});
  const LIM = walker.LIM;
  const root = stations.find((s) => s.kind === 'powerhouse') || stations[0];
  /* One search of the route tree on a grid of pitch `cell` aligned on the root; `allow(x,z)` (optional) restricts the nodes. Returns the grid and Dijkstra arrays. */
  const search = (cell, allow) => {
  let bx0 = 1e18, bz0 = 1e18, bx1 = -1e18, bz1 = -1e18;
  for (const s of stations) { bx0 = Math.min(bx0, s.x); bz0 = Math.min(bz0, s.z); bx1 = Math.max(bx1, s.x); bz1 = Math.max(bz1, s.z); }
  bx0 = Math.max(-LIM, bx0 - S.margin); bz0 = Math.max(-LIM, bz0 - S.margin); bx1 = Math.min(LIM, bx1 + S.margin); bz1 = Math.min(LIM, bz1 + S.margin);
  const i0 = Math.ceil((bx0 - root.x) / cell), i1 = Math.floor((bx1 - root.x) / cell), j0 = Math.ceil((bz0 - root.z) / cell), j1 = Math.floor((bz1 - root.z) / cell);
  const W = i1 - i0 + 1, H = j1 - j0 + 1, M = W * H;
  const gx = (idx) => root.x + (i0 + (idx % W)) * cell, gz = (idx) => root.z + (j0 + Math.floor(idx / W)) * cell;
  const nodeOk = new Uint8Array(M);
  for (let k = 0; k < M; k++) nodeOk[k] = walker.inBlocked(gx(k), gz(k)) || (allow && !allow(gx(k), gz(k))) ? 0 : 1;
  const OFFS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  const cls = new Int8Array(M * OFFS.length); // 0 unknown, 1 walkable, 2 structure
  const edgeCost = (u, o) => {
    const v = u + OFFS[o][0] + OFFS[o][1] * W, c = cls[u * OFFS.length + o];
    const ax = gx(u), az = gz(u), bx = gx(v), bz = gz(v), len = hyp(bx - ax, bz - az);
    if (c === 1) return len;
    if (c === 2) return structLen(ax, az, bx, bz, len) * S.structCost;
    const k = walker.lineFast(ax, az, bx, bz) ? 1 : 2; // 2: needs a stair/deck (or has no margin on a steep side slope)
    cls[u * OFFS.length + o] = k;
    return k === 1 ? len : structLen(ax, az, bx, bz, len) * S.structCost;
  };
  /* a stair has to be as long as the climb needs (rise / grade), not only as long as the grid edge */
  const structLen = (ax, az, bx, bz, len) => Math.max(len, Math.abs(surface.floorY(bx, bz) - surface.floorY(ax, az)) / (S.flightRiser / S.flightTread));
  const rootIdx = (0 - i0) + (0 - j0) * W;
  // ---- Dijkstra over the grid
  const dist = new Float64Array(M).fill(Infinity), parent = new Int32Array(M).fill(-1);
  const heap = new MinHeap(); dist[rootIdx] = 0; heap.push(0, rootIdx);
  // early exit: a station is settled once the search has gone a few cells beyond the first node of its 7 x 7 neighbourhood; stop when all are
  const stCell = stations.map((s) => ({i: Math.round((s.x - root.x) / cell) - i0, j: Math.round((s.z - root.z) / cell) - j0, first: -1}));
  const slack = cell * 4 * S.structCost * 0.5;
  while (heap.size) {
    const [d, u] = heap.pop(); if (d > dist[u]) continue;
    const ui0 = u % W, uj0 = (u / W) | 0;
    let allDone = true;
    for (const c of stCell) {
      if (c.first < 0) { if (Math.abs(ui0 - c.i) <= 3 && Math.abs(uj0 - c.j) <= 3) c.first = d; }
      if (c.first < 0 || d < c.first + slack) allDone = false;
    }
    if (allDone) break;
    const ui = u % W, uj = (u / W) | 0;
    for (let o = 0; o < OFFS.length; o++) {
      const vi = ui + OFFS[o][0], vj = uj + OFFS[o][1]; if (vi < 0 || vj < 0 || vi >= W || vj >= H) continue;
      const v = vj * W + vi; if (!nodeOk[v]) continue;
      const nd = d + edgeCost(u, o); if (nd < dist[v]) { dist[v] = nd; parent[v] = u; heap.push(nd, v); }
    }
  }
  return {cell, i0, j0, W, H, M, gx, gz, dist, parent, rootIdx};
  };
  // two passes: a coarse search (twice the pitch) finds the corridors, the fine search then only visits nodes within one coarse cell of them
  let G = null;
  if (opts.twoPass !== false) {
    const C = search(cell * 2, null), cc = C.cell, keys = new Set(), keyOf = (i, j) => i * 100003 + j;
    let ok = true;
    for (const s of stations) {
      if (s === root) continue;
      const ci = Math.round((s.x - root.x) / cc) - C.i0, cj = Math.round((s.z - root.z) / cc) - C.j0;
      let best = -1, bd = Infinity;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= C.W || j >= C.H) continue; const v = j * C.W + i; if (C.dist[v] < bd) { bd = C.dist[v]; best = v; } }
      if (best < 0) { ok = false; break; }
      for (let n = best; n >= 0; n = C.parent[n]) { const i = (n % C.W) + C.i0, j = ((n / C.W) | 0) + C.j0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) keys.add(keyOf(i + a, j + b)); }
    }
    if (ok) {
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) for (const s of stations) { const i = Math.round((s.x - root.x) / cc) + di, j = Math.round((s.z - root.z) / cc) + dj; keys.add(keyOf(i, j)); }
      G = search(cell, (x, z) => keys.has(keyOf(Math.round((x - root.x) / cc), Math.round((z - root.z) / cc))));
      // a station the fine search could not reach inside its corridor: fall back to the full fine search
      for (const s of stations) { if (s === root) continue; const ci = Math.round((s.x - root.x) / cell) - G.i0, cj = Math.round((s.z - root.z) / cell) - G.j0; let any = false; for (let dj = -3; dj <= 3 && !any; dj++) for (let di = -3; di <= 3; di++) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < G.W && j < G.H && isFinite(G.dist[j * G.W + i])) { any = true; break; } } if (!any) { G = null; break; } }
    }
  }
  if (!G) G = search(cell, null);
  const {i0, j0, W, H, M, gx, gz, dist, parent, rootIdx} = G;
  // ---- attach every station: cheapest grid node within 3 cells + the final leg
  const NS = stations.length, par = new Int32Array(M + NS).fill(-1), spt = [];
  for (let k = 0; k < M; k++) par[k] = parent[k];
  const stNode = new Array(NS).fill(-1), unreachable = [];
  stations.forEach((s, si) => {
    if (s === root) { stNode[si] = rootIdx; return; }
    const ci = Math.round((s.x - root.x) / cell) - i0, cj = Math.round((s.z - root.z) / cell) - j0;
    let best = -1, bc = Infinity;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const v = j * W + i; if (!isFinite(dist[v])) continue;
      const len = hyp(gx(v) - s.x, gz(v) - s.z), c = dist[v] + (walker.lineWalkable(gx(v), gz(v), s.x, s.z) ? len : len * S.structCost);
      if (c < bc) { bc = c; best = v; }
    }
    if (best < 0) { unreachable.push(s.id); return; }
    stNode[si] = M + si; par[M + si] = best;
  });
  // ---- route tree: which nodes are used, who branches
  const px = (n) => (n >= M ? stations[n - M].x : gx(n)), pz = (n) => (n >= M ? stations[n - M].z : gz(n));
  const used = new Map(), childCount = new Map();
  stations.forEach((s, si) => {
    let n = stNode[si]; if (n < 0) return;
    for (; n >= 0; n = par[n]) { if (used.has(n)) break; used.set(n, true); }
  });
  for (const n of used.keys()) { const p = par[n]; if (p >= 0 && used.has(p)) childCount.set(p, (childCount.get(p) || 0) + 1); }
  const isKey = (n) => n === rootIdx || n >= M || (childCount.get(n) || 0) >= 2;
  // ---- chains: from each key node (not the root) up to the next key node, then simplified
  const chains = [];
  const keyList = [...used.keys()].filter((n) => isKey(n) && n !== rootIdx).sort((a, b) => a - b);
  for (const k of keyList) {
    const raw = [k]; let n = par[k];
    while (n >= 0) { raw.push(n); if (isKey(n)) break; n = par[n]; }
    raw.reverse(); // from the parent key down to k
    const sp = simplify(raw.map((n2) => ({x: px(n2), z: pz(n2)})));
    chains.push({from: raw[0], to: k, pts: sp, rpts: sp});
  }
  /* greedy line-of-sight simplification of one chain: walkable legs are merged while the straight line stays walkable; structure legs while it stays inside the world and clear of walls */
  function simplify(P) {
    const free = (a, b) => { const n = Math.max(1, Math.ceil(hyp(b.x - a.x, b.z - a.z) / 2)); for (let i = 0; i <= n; i++) { const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n; if (Math.abs(x) > LIM || Math.abs(z) > LIM || walker.inBlocked(x, z)) return false; } return true; };
    const out = [P[0]]; let i = 0;
    while (i < P.length - 1) {
      const clear = walker.lineClear(P[i].x, P[i].z, P[i + 1].x, P[i + 1].z), normal = clear || walker.lineWalkable(P[i].x, P[i].z, P[i + 1].x, P[i + 1].z);
      const test = clear ? walker.lineClear : walker.lineWalkable;
      let j = i + 1;
      while (j + 1 < P.length) {
        const nx = j + 1, ok = normal ? test(P[i].x, P[i].z, P[nx].x, P[nx].z)
          : (!walker.lineWalkable(P[j].x, P[j].z, P[nx].x, P[nx].z) && free(P[i], P[nx]));
        if (!ok) break; j = nx;
      }
      out.push(P[j]); i = j;
    }
    return out;
  }
  // ---- flights per chain
  /* A run of ground the walker cannot walk is replaced by one straight chord (start -> end of the run, padded to terrain level at both ends) and the chord
     carries one flight, so a flight never bends. The envelope P is the lowest profile that is >= terrain (or water + deck clearance) with a slope of at most
     riser/tread; the treads are P rounded up to a riser multiple. */
  const flights = [];
  const ds = 0.5, g = S.flightRiser / S.flightTread;
  const lenOf = (P) => { let l = 0; for (let i = 1; i < P.length; i++) l += hyp(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); return l; };
  const free = (a, b) => { const n = Math.max(1, Math.ceil(hyp(b.x - a.x, b.z - a.z) / 2)); for (let i = 0; i <= n; i++) { const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n; if (Math.abs(x) > LIM || Math.abs(z) > LIM || walker.inBlocked(x, z)) return false; } return true; };
  /* sample a polyline every ~ds: arrays X,Z,Y (terrain), Tp (terrain or deck), WET */
  function sampleLine(pts, lat) {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hyp(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const Ltot = cum[cum.length - 1], K = Math.max(2, Math.ceil(Ltot / ds) + 1), sd = Ltot / (K - 1);
    const X = new Float64Array(K), Z = new Float64Array(K), Y = new Float64Array(K), Tp = new Float64Array(K), WET = new Uint8Array(K);
    let seg = 0;
    for (let k = 0; k < K; k++) {
      const s = k * sd; while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
      const l = cum[seg + 1] - cum[seg] || 1, t = clamp((s - cum[seg]) / l, 0, 1);
      X[k] = pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t; Z[k] = pts[seg].z + (pts[seg + 1].z - pts[seg].z) * t;
      Y[k] = surface.floorY(X[k], Z[k]); Tp[k] = Y[k];
      if (lat) { // a flight must clear the terrain across its whole width (an uphill side on a cross slope)
        const ex = pts[seg + 1].x - pts[seg].x, ez = pts[seg + 1].z - pts[seg].z, el = Math.hypot(ex, ez) || 1, nx = -ez / el * lat, nz = ex / el * lat;
        const w = clamp(Math.min(s, Ltot - s) / 3, 0, 1); // the lateral clearance fades in over the first and last 3 m so the flight meets the ground at both ends
        for (const sgn of [-1, 1]) { const yy = surface.floorY(X[k] + nx * sgn, Z[k] + nz * sgn); if (Y[k] + w * (yy - Y[k]) > Tp[k]) Tp[k] = Y[k] + w * (yy - Y[k]); }
      }
      const ws = surface.waterSurface(X[k], Z[k]);
      if (ws === ws && ws - Y[k] > PLAYER.maxWade) { Tp[k] = Math.max(Tp[k], ws + S.deckClear); WET[k] = 1; }
    }
    const P = new Float64Array(K); P[0] = Tp[0];
    for (let k = 1; k < K; k++) P[k] = Math.max(Tp[k], P[k - 1] - g * sd);
    let run = Tp[K - 1]; if (run > P[K - 1]) P[K - 1] = run;
    for (let k = K - 2; k >= 0; k--) { run = Math.max(Tp[k], run - g * sd); if (run > P[k]) P[k] = run; }
    return {cum, Ltot, K, sd, X, Z, Y, Tp, WET, P};
  }
  function hoverSpans(sm) {
    const {K, sd, P, Y} = sm, spans = []; let a = -1;
    for (let k = 0; k < K; k++) { const h = P[k] - Y[k] > S.hoverEps; if (h && a < 0) a = k; if (!h && a >= 0) { spans.push([a, k - 1]); a = -1; } }
    if (a >= 0) spans.push([a, K - 1]);
    const padK = Math.ceil(4 / sd), gapK = Math.ceil(6 / sd), merged = [];
    for (const sp of spans) {
      const s0 = Math.max(0, sp[0] - padK), s1 = Math.min(K - 1, sp[1] + padK);
      if (merged.length && s0 - merged[merged.length - 1][1] <= gapK) merged[merged.length - 1][1] = s1; else merged.push([s0, s1]);
    }
    return merged;
  }
  function flightOnChord(A, B) {
    const sm = sampleLine([A, B], S.flightHalfWidth), {K, sd, P, Y, WET} = sm, len = sm.Ltot, nT = Math.max(1, Math.ceil(len / S.flightTread)), lo = Y[0], tops = new Array(nT);
    const Pat = (s) => { const f = clamp(s / sd, 0, K - 1), i = Math.min(K - 2, Math.floor(f)), t = f - i; return P[i] + (P[i + 1] - P[i]) * t; };
    for (let i = 0; i < nT; i++) tops[i] = lo + Math.ceil((Pat((i + 0.5) * S.flightTread) - lo) / S.flightRiser - 1e-9) * S.flightRiser;
    let wet = false; for (let k = 0; k < K; k++) if (WET[k]) { wet = true; break; }
    return {tops, wet, P0: P[0], Y0: Y[0], P1: P[K - 1], Y1: Y[K - 1]};
  }
  chains.forEach((ch, ci) => {
    let pts = ch.pts;
    // structure legs of the original route (these decide where a flight is needed at all)
    const sm = sampleLine(pts), structS = []; let c0 = 0;
    for (let q = 0; q < pts.length - 1; q++) { const l = hyp(pts[q + 1].x - pts[q].x, pts[q + 1].z - pts[q].z); if (!walker.lineClear(pts[q].x, pts[q].z, pts[q + 1].x, pts[q + 1].z)) structS.push([c0, c0 + l]); c0 += l; }
    const spans = hoverSpans(sm).filter(([k0, k1]) => structS.some((r) => k1 * sm.sd >= r[0] - 12 && k0 * sm.sd <= r[1] + 12));
    const at = (s) => { let q = 0; while (q < pts.length - 2 && sm.cum[q + 1] < s) q++; const l = sm.cum[q + 1] - sm.cum[q] || 1, t = clamp((s - sm.cum[q]) / l, 0, 1); return {x: pts[q].x + (pts[q + 1].x - pts[q].x) * t, z: pts[q].z + (pts[q + 1].z - pts[q].z) * t}; };
    const out = [pts[0]]; let cursor = 0;
    for (const [k0, k1] of spans) {
      let s0 = k0 * sm.sd, s1 = k1 * sm.sd, A = at(s0), B = at(s1), chord = null, back = null;
      if (s0 < cursor) { if (opts.debug) console.log('span before cursor', ci, s0, cursor); continue; }
      // the chord must meet the ground at both ends: if the envelope over it starts or ends above the terrain, move the end back along the route; when the
      // route has no more room (the start of a chain) the flight starts on the open ground behind it, one straight leg from the original start
      for (let it = 0; it < 12; it++) {
        const Aeff = back || A;
        if (hyp(B.x - Aeff.x, B.z - Aeff.z) < 1.5 || !free(Aeff, B)) { chord = null; break; }
        chord = flightOnChord(Aeff, B);
        const e0 = chord.P0 - chord.Y0, e1 = chord.P1 - chord.Y1;
        if (e0 <= S.hoverEps && e1 <= S.hoverEps) break;
        chord = null;
        if (e0 > S.hoverEps) {
          const d = Math.max(2, e0 / g);
          if (s0 - d >= cursor - 1e-9 && !back) { s0 -= d; A = at(s0); }
          else { const L0 = hyp(B.x - Aeff.x, B.z - Aeff.z), ux = (Aeff.x - B.x) / L0, uz = (Aeff.z - B.z) / L0, cand = {x: Aeff.x + ux * d, z: Aeff.z + uz * d}; if (!free(Aeff, cand) || !walker.lineClear(A.x, A.z, cand.x, cand.z) && !walker.lineWalkable(A.x, A.z, cand.x, cand.z)) break; back = cand; }
        }
        if (e1 > S.hoverEps) { if (s1 + Math.max(2, e1 / g) > sm.Ltot) break; s1 += Math.max(2, e1 / g); B = at(s1); }
      }
      if (!chord) { if (opts.debug) console.log('chord failed', ci, s0, s1, A, B); continue; }
      for (let q = 1; q < pts.length - 1; q++) if (sm.cum[q] > cursor + 1e-6 && sm.cum[q] < s0 - 1e-6) out.push(pts[q]);
      out.push(A); if (back) out.push(back); out.push(B);
      const F = makeFlight('flight' + flights.length, [back || A, B], chord.tops, chord.wet ? 'bridge' : 'stairs'); F.chain = ci; F.from = back || A; F.to = B; flights.push(F);
      cursor = s1;
    }
    for (let q = 1; q < pts.length - 1; q++) if (sm.cum[q] > cursor + 1e-6) out.push(pts[q]);
    out.push(pts[pts.length - 1]);
    ch.rpts = out;
  });
  // ---- graph: key nodes + points every 2 m along each chain
  const nodes = [], edges = [], keyId = new Map();
  const keyNode = (n) => { if (!keyId.has(n)) { keyId.set(n, nodes.length); nodes.push({x: px(n), z: pz(n), key: n >= M ? stations[n - M].id : (n === rootIdx ? root.id : null)}); } return keyId.get(n); };
  for (const ch of chains) {
    let prev = keyNode(ch.from);
    const pts = ch.rpts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L2 = hyp(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L2 / 2));
      for (let q = 1; q <= n; q++) {
        let id;
        if (i === pts.length - 1 && q === n) id = keyNode(ch.to);
        else { id = nodes.length; nodes.push({x: a.x + (b.x - a.x) * q / n, z: a.z + (b.z - a.z) * q / n, key: null}); }
        edges.push({a: prev, b: id, len: L2 / n}); prev = id;
      }
    }
  }
  // the root is a key node; make sure it exists even when it is alone
  keyNode(rootIdx);
  // ---- per-station route report
  const chainOf = new Map(); chains.forEach((c, i) => chainOf.set(c.to, i));
  const routes = {};
  stations.forEach((s, si) => {
    const r = {length: 0, flights: [], reachable: stNode[si] >= 0}; routes[s.id] = r; if (stNode[si] < 0 || s === root) return;
    let n = stNode[si];
    while (n !== rootIdx && n >= 0) {
      const ci = chainOf.get(n); if (ci === undefined) break;
      const ch = chains[ci]; for (let i = 1; i < ch.rpts.length; i++) r.length += hyp(ch.rpts[i].x - ch.rpts[i - 1].x, ch.rpts[i].z - ch.rpts[i - 1].z);
      for (const f of flights) if (f.chain === ci) r.flights.push(f.id);
      n = ch.from;
    }
  });
  // diagnostics: legs of the final routes that are neither walkable nor inside a flight (should stay empty)
  const uncovered = [];
  for (const ch of chains) for (let q = 0; q < ch.rpts.length - 1; q++) {
    const a = ch.rpts[q], b = ch.rpts[q + 1];
    if (!walker.lineClear(a.x, a.z, b.x, b.z) && !flights.some((f) => f.chain === chains.indexOf(ch) && hyp(f.from.x - a.x, f.from.z - a.z) < 0.01 && hyp(f.to.x - b.x, f.to.z - b.z) < 0.01)) uncovered.push({from: a, to: b, chain: chains.indexOf(ch)});
  }
  return {nodes, edges, flights, routes, uncovered, chains: chains.length, blocked, cell, unreachable, root: root.id};
}
