/* The movement rule of the free-roam demo (walkerStep, walkableAt, lineWalkable, lineClear, lineFast, planPath, simulateRoute; demo lines 629-658) re-authored on the
   Surface API of decisions/fable.md D2. Pure ES module: no DOM, no THREE, no Math.random, no Date/performance. Everything is in display metres.

   Ground is surface.floorY (terrain or a floor provider such as stairs, a bridge deck or the dam crest). A point is wet when the water on it is deeper than
   PLAYER.maxWade over the floor the player stands on (so a deck over a river is dry). The walker never writes to the sim: it only reads the surface. */

export const PLAYER = {
  height: 1.74, // m (D1)
  walk: 11, // m/s (former run speed, now default walk)
  run: 44, // m/s (4x walk speed when holding Shift)
  stairFactor: 0.8, // x speed while on a stair flight or deck
  slopeDeg: 35, // displayed slope limit (D1)
  routeSlopeFactor: 0.88, // planner margin: a route leg is accepted up to 0.88 x tan(limit) (demo: 0.92) so a triangle kink between two samples cannot exceed the walker limit
  maxWade: 0.15, // m of water over the floor that still counts as dry (ankle deep)
  kinkTol: 1.3, // x slope limit that one triangle may exceed when the next 0.5 m is within the limit
  stepDown: 0.6, // m: a step down of this much is allowed when leaving a flight (a hop off the edge)
  stepMax: 0.45, // m: largest step (up or down) allowed on or onto a stair flight; one riser is 0.18
  slideBack: 0.25, // fraction of the attempted step that is undone when the slope is too steep
  subStep: 0.12, // m: walkerStep substeps so no single move is longer than this (a stair tread is 0.27 m)
  maxSubSteps: 40,
  worldHalf: 800, // m (D1: 1600 m world), the walker stops 3 m inside
  edgeInset: 3,
  glideTol: 0.25, // m: waypoint reached
  sample: 0.5, // m between samples in lineWalkable (demo: 0.8)
  fastSample: 1.5, fastFactor: 0.78, // lineFast: sample pitch (m) and slope margin of the coarse planner test
  lane: 0.4 // m: lineClear also checks lanes this far to both sides of the line
};

export const RESULT = {OK: 0, STEEP: 1, WET: 2, BLOCKED: 3};

/* ---- mode state machine ----
   walk    free movement on the ground
   stairs  on a stair flight / deck / floor provider (entered and left automatically by walkerStep)
   blocked the last step was refused (steep, wet, wall); leaves on the next accepted step
   swim, slide  RESERVED hooks. They can only be entered through requestMode(), which asks a handler installed in opts.modeHandlers.
                The default handler refuses, so a game that has not implemented them never enters them. */
export const MODES = ['walk', 'stairs', 'blocked', 'swim', 'slide'];
export const RESERVED_MODES = ['swim', 'slide'];
export const MODE_TRANSITIONS = {
  walk: ['stairs', 'blocked', 'swim', 'slide'],
  stairs: ['walk', 'blocked'],
  blocked: ['walk', 'stairs'],
  swim: ['walk'],
  slide: ['walk']
};
const REFUSE = (mode) => () => ({ok: false, reason: mode + ' is not implemented yet'});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createWalker(surface, opts = {}) {
  const cfg = Object.assign({}, PLAYER, opts.player || {});
  const LIM = (opts.half || cfg.worldHalf) - cfg.edgeInset;
  const TANL = Math.tan(cfg.slopeDeg * Math.PI / 180);
  let blocked = (opts.blocked || []).map(normBox); // [{x0,z0,x1,z1}] solid footprints supplied by the world
  const handlers = Object.assign({swim: REFUSE('swim'), slide: REFUSE('slide')}, opts.modeHandlers || {});
  const listeners = [];

  function normBox(b) { return {x0: Math.min(b.x0, b.x1), z0: Math.min(b.z0, b.z1), x1: Math.max(b.x0, b.x1), z1: Math.max(b.z0, b.z1)}; }
  const inBlocked = (x, z) => { for (let i = 0; i < blocked.length; i++) { const b = blocked[i]; if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true; } return false; };
  /* a floor provider lifts the floor above the terrain: stairs, decks, crest */
  const onStructure = (x, z) => surface.floorY(x, z) > surface.y(x, z) + 0.02;
  /* water over the floor the player would stand on; the deck of a bridge makes the point dry even though the terrain below is wet */
  const wetDepth = (x, z) => {
    const f = surface.floorY(x, z), t = surface.y(x, z);
    if (f > t + 0.02) { const w = surface.waterSurface(x, z); return w === w ? w - f : 0; }
    return surface.depth(x, z);
  };
  const walkableAt = (x, z) => Math.abs(x) <= LIM && Math.abs(z) <= LIM && wetDepth(x, z) <= cfg.maxWade && !inBlocked(x, z);

  /* ---- state ---- */
  function spawn(x, z) {
    const y = surface.floorY(x, z);
    return {x, y, z, on: onStructure(x, z), mode: 'walk', yaw: 0, last: 0};
  }

  /* ---- modes ---- */
  function canTransition(from, to) { return from === to || (MODE_TRANSITIONS[from] || []).indexOf(to) >= 0; }
  function emitMode(st, from, to, reason) { for (const fn of listeners) fn({from, to, reason, state: st}); }
  /* setMode: implemented modes only. swim and slide are refused here and must go through requestMode. */
  function setMode(st, to, reason) {
    if (MODES.indexOf(to) < 0) return {ok: false, reason: 'unknown mode ' + to};
    if (RESERVED_MODES.indexOf(to) >= 0) return {ok: false, reason: to + ' is reserved: use requestMode'};
    if (!canTransition(st.mode, to)) return {ok: false, reason: 'no transition ' + st.mode + ' -> ' + to};
    if (st.mode !== to) { const from = st.mode; st.mode = to; emitMode(st, from, to, reason || ''); }
    return {ok: true};
  }
  /* requestMode: the only way into swim and slide. The handler decides (default: refuse). A later agent installs handlers through opts.modeHandlers
     or walker.setModeHandler; a handler may enter the mode by returning {ok:true}. */
  function requestMode(st, to, ctx) {
    if (RESERVED_MODES.indexOf(to) < 0) return setMode(st, to, 'request');
    if (!canTransition(st.mode, to)) return {ok: false, reason: 'no transition ' + st.mode + ' -> ' + to};
    const r = handlers[to](st, ctx, walker) || {ok: false, reason: to + ' refused'};
    if (r.ok && st.mode !== to) { const from = st.mode; st.mode = to; emitMode(st, from, to, 'request'); }
    return r;
  }
  function leaveReserved(st) { if (RESERVED_MODES.indexOf(st.mode) >= 0) { const from = st.mode; st.mode = 'walk'; emitMode(st, from, 'walk', 'leave'); } }

  /* ---- the movement rule ---- */
  function oneStep(st, dx, dz, dist) {
    const nx = clamp(st.x + dx * dist, -LIM, LIM), nz = clamp(st.z + dz * dist, -LIM, LIM), mx = nx - st.x, mz = nz - st.z, md = Math.hypot(mx, mz);
    if (md < 1e-9) return 0;
    const g = surface.floorY(nx, nz), inNew = g > surface.y(nx, nz) + 0.02, dh = g - st.y;
    if (wetDepth(nx, nz) > cfg.maxWade) return 2; // she stops at the waterline
    if (inBlocked(nx, nz)) return 3; // solid walls
    // stairs: a step of at most one riser (stepMax) is automatic on and onto a flight; elsewhere the walkable slope limit applies
    let ok;
    if (inNew || st.on) ok = dh <= cfg.stepMax && dh >= -cfg.stepDown;
    else {
      const sl = Math.abs(dh) / md;
      ok = sl <= TANL;
      // a single triangle up to 30% over the limit is crossed if the ground 0.5 m further on is within the limit (a triangle edge is not a wall)
      if (!ok && sl <= cfg.kinkTol * TANL) ok = Math.abs(surface.floorY(nx + dx * 0.5, nz + dz * 0.5) - g) / 0.5 <= TANL;
    }
    if (ok) { st.x = nx; st.z = nz; st.y = g; st.on = inNew; return 0; }
    const sb = cfg.slideBack * dist; // too steep: slide back a little
    st.x = clamp(st.x - dx * sb, -LIM, LIM); st.z = clamp(st.z - dz * sb, -LIM, LIM); st.y = surface.floorY(st.x, st.z); st.on = onStructure(st.x, st.z);
    return 1;
  }
  /* walkerStep(state, dx, dz, speed, dt) -> 0 ok, 1 too steep, 2 wet, 3 blocked. (dx,dz) is a direction (any length), speed m/s, dt s.
     The move is split into substeps of at most cfg.subStep metres so a long frame cannot skip a stair tread. Speed is multiplied by stairFactor on a flight. */
  function walkerStep(st, dx, dz, speed, dt) {
    if (RESERVED_MODES.indexOf(st.mode) >= 0) { const h = handlers[st.mode]; if (h && h.step) return h.step(st, dx, dz, speed, dt, walker); return 3; }
    const len = Math.hypot(dx, dz);
    if (len < 1e-9 || !(dt > 0)) return 0;
    dx /= len; dz /= len;
    const total = speed * (st.on ? cfg.stairFactor : 1) * dt;
    const n = Math.min(cfg.maxSubSteps, Math.max(1, Math.ceil(total / cfg.subStep)));
    let code = 0, hit = 0;
    for (let i = 0; i < n; i++) {
      const c = oneStep(st, dx, dz, total / n);
      if (c !== 0) { code = c; hit++; break; } // stop on the first refusal: the rest of the frame is lost
    }
    st.last = code;
    if (code !== 0) { if (st.mode !== 'blocked') setMode(st, 'blocked', 'step'); }
    else setMode(st, st.on ? 'stairs' : 'walk', 'step');
    return code;
  }

  /* steerStep: walkerStep for a route follower (click-to-walk glide, simulateRoute). When the step is refused as too steep or blocked, it retries
     the same move rotated by +-10, 20 and 35 degrees, so a walker that is a decimetre off the planned line is not stopped by a neighbouring triangle. */
  /* distance from the state to the segment leg.{x0,z0,x1,z1} */
  function legOffset(st, l) {
    const lx = l.x1 - l.x0, lz = l.z1 - l.z0, l2 = lx * lx + lz * lz || 1, t = clamp(((st.x - l.x0) * lx + (st.z - l.z0) * lz) / l2, 0, 1);
    return Math.hypot(st.x - (l.x0 + lx * t), st.z - (l.z0 + lz * t));
  }
  const STEER = [0.17, -0.17, 0.35, -0.35, 0.6, -0.6];
  function steerStep(st, dx, dz, speed, dt, leg) {
    const keep = {x: st.x, y: st.y, z: st.z, on: st.on, mode: st.mode};
    const c0 = walkerStep(st, dx, dz, speed, dt);
    if (c0 === 0 || c0 === 2) return c0;
    for (const a of STEER) {
      st.x = keep.x; st.y = keep.y; st.z = keep.z; st.on = keep.on; st.mode = keep.mode;
      const ca = Math.cos(a), sa = Math.sin(a);
      if (walkerStep(st, dx * ca - dz * sa, dx * sa + dz * ca, speed, dt) === 0 && (!leg || legOffset(st, leg) <= leg.maxOff)) return 0;
    }
    st.x = keep.x; st.y = keep.y; st.z = keep.z; st.on = keep.on; st.mode = keep.mode;
    st.last = c0; if (st.mode !== 'blocked') setMode(st, 'blocked', 'step');
    return c0;
  }

  /* ---- planning ---- */
  /* straight leg test, sampled every cfg.sample metres on the floor with the same rules as walkerStep, but with the demo's margin on the slope and on three
     parallel lanes (centre and +-cfg.lane m): a triangle edge a few decimetres off the line can hold a steeper gradient, and a walker that follows the
     line is never exactly on it. */
  function laneWalkable(ax, az, bx, bz, ox, oz, sample, factor) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (sample || cfg.sample))), sl = L / n;
    let py = surface.floorY(ax, az), pOn = onStructure(ax, az);
    const lim = TANL * (factor || cfg.routeSlopeFactor);
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t + ox, z = az + (bz - az) * t + oz;
      if (Math.abs(x) > LIM || Math.abs(z) > LIM) return false;
      // inlined floorY / wetDepth: one terrain sample when no floor provider is registered (surface.providers is the real Surface's list)
      const ty = surface.y(x, z), y = surface.providers && surface.providers.length === 0 ? ty : surface.floorY(x, z), on = y > ty + 0.02;
      if (on || pOn) { if (y - py > cfg.stepMax || py - y > cfg.stepDown) return false; } else if (Math.abs(y - py) / sl > lim) return false;
      let wd; if (on) { const w = surface.waterSurface(x, z); wd = w === w ? w - y : 0; } else wd = surface.depth(x, z);
      if (wd > cfg.maxWade || inBlocked(x, z)) return false;
      py = y; pOn = on;
    }
    return true;
  }
  /* coarse and cheap (1.5 m samples, stricter slope, centre line): the route search uses it; the chosen routes are re-checked with lineClear */
  function lineFast(ax, az, bx, bz) { return laneWalkable(ax, az, bx, bz, 0, 0, cfg.fastSample, cfg.fastFactor); }
  /* centre line only: the rule the walker itself enforces (the planner's definition of "walkable") */
  function lineWalkable(ax, az, bx, bz) { return laneWalkable(ax, az, bx, bz, 0, 0); }
  /* centre line and both lanes: a route a walker can follow without a decimetre of error putting it on a steeper triangle */
  function lineClear(ax, az, bx, bz) {
    if (!laneWalkable(ax, az, bx, bz, 0, 0)) return false;
    const L = Math.hypot(bx - ax, bz - az); if (L < 1e-9 || cfg.lane <= 0) return true;
    const nx = -(bz - az) / L * cfg.lane, nz = (bx - ax) / L * cfg.lane;
    return laneWalkable(ax, az, bx, bz, nx, nz) && laneWalkable(ax, az, bx, bz, -nx, -nz);
  }

  /* graph = {nodes:[{x,z}], edges:[{a,b,len}]} as produced by stations.buildPaths (adj is built on first use and cached on the graph).
     planPath(from, to, graph) -> array of {x,z} waypoints starting with `from`, or null when no route exists. */
  function adjacency(graph) {
    if (graph._adj && graph._adjN === graph.nodes.length) return graph._adj;
    const adj = graph.nodes.map(() => []);
    for (const e of graph.edges) { adj[e.a].push([e.b, e.len]); adj[e.b].push([e.a, e.len]); }
    graph._adj = adj; graph._adjN = graph.nodes.length; return adj;
  }
  function nearestVisible(graph, p, maxTry) {
    const cand = [];
    for (let i = 0; i < graph.nodes.length; i++) { const n = graph.nodes[i]; cand.push([(n.x - p.x) * (n.x - p.x) + (n.z - p.z) * (n.z - p.z), i]); }
    cand.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min(cand.length, maxTry); k++) { const n = graph.nodes[cand[k][1]]; if (lineClear(p.x, p.z, n.x, n.z)) return cand[k][1]; }
    return -1;
  }
  function dijkstra(graph, a, b) {
    const adj = adjacency(graph), n = graph.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    const heap = [[0, a]]; dist[a] = 0;
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, u] = pop(); if (d > dist[u]) continue; if (u === b) break;
      for (const [v, w] of adj[u]) { const nd = d + w; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); } }
    }
    if (!isFinite(dist[b])) return null;
    const out = []; for (let u = b; u >= 0; u = prev[u]) out.push(u); return out.reverse();
  }
  function planPath(from, to, graph) {
    const f = {x: from.x !== undefined ? from.x : from[0], z: from.z !== undefined ? from.z : from[1]}, t = {x: to.x !== undefined ? to.x : to[0], z: to.z !== undefined ? to.z : to[1]};
    if (!walkableAt(t.x, t.z)) return null;
    if (lineClear(f.x, f.z, t.x, t.z)) return [f, t];
    if (!graph || !graph.nodes.length) return null;
    const a = nearestVisible(graph, f, 60), b = nearestVisible(graph, t, 60);
    if (a < 0 || b < 0) return null;
    const ids = dijkstra(graph, a, b); if (!ids) return null;
    const wp = [f]; for (const i of ids) wp.push({x: graph.nodes[i].x, z: graph.nodes[i].z}); wp.push(t); return wp;
  }
  /* followStep: one frame of route following (click-to-walk and simulateRoute). route = {wps:[{x,z}], i}; i starts at 1 (wps[0] is the start).
     Pure pursuit on the current leg, steering around a refused step, never overshooting the aim point. Returns {code, done, dt} (dt = time actually used). */
  function followStep(st, route, speed, dt) {
    const wps = route.wps;
    while (route.i < wps.length && Math.hypot(wps[route.i].x - st.x, wps[route.i].z - st.z) < cfg.glideTol) route.i++;
    if (route.i >= wps.length) return {code: 0, done: true, dt: 0};
    const w = wps[route.i], p0 = wps[route.i - 1], lx = w.x - p0.x, lz = w.z - p0.z, ll = Math.hypot(lx, lz) || 1;
    const u = clamp(((st.x - p0.x) * lx + (st.z - p0.z) * lz) / (ll * ll) + 1.2 / ll, 0, 1); // aim 1.2 m ahead on the leg, not at its far end
    const dx = p0.x + lx * u - st.x, dz = p0.z + lz * u - st.z;
    const dd = Math.hypot(dx, dz), sp = speed * (st.on ? cfg.stairFactor : 1), dtE = Math.min(dt, dd / sp + 1e-9);
    const code = steerStep(st, dx, dz, speed, dtE, {x0: p0.x, z0: p0.z, x1: w.x, z1: w.z, maxOff: 0.4});
    return {code, done: false, dt: dtE};
  }
  /* simulateRoute(waypoints, speed, opts) walks the route with followStep at a fixed dt and reports what happened (demo simulateRoute) */
  function simulateRoute(wps, speed, o = {}) {
    const dt = o.dt || 0.05, maxT = o.maxTime || 1800, a = wps[0];
    const st = spawn(a.x, a.z), route = {wps, i: 1};
    let t = 0, steps = 0, stairSteps = 0, minClear = Infinity, maxUp = 0, stuck = 0, nan = 0, wet = 0, below = 0;
    while (t < maxT) {
      const py = st.y, f = followStep(st, route, speed, dt);
      if (f.done) break;
      t += f.dt; steps++; if (st.on) stairSteps++;
      const fl = surface.floorY(st.x, st.z), mc = st.y - fl; if (mc < minClear) minClear = mc; if (mc < -1e-6) below++;
      if (st.y - py > maxUp) maxUp = st.y - py;
      if (!isFinite(st.x + st.y + st.z)) nan++;
      const wd = wetDepth(st.x, st.z); if (wd > wet) wet = wd;
      if (f.code !== 0) { stuck++; if (stuck > 240) break; } else stuck = 0;
    }
    return {done: route.i >= wps.length, time: t, steps, stairSteps, minClear, maxUp, nan, wet, below, end: {x: st.x, z: st.z}, state: st};
  }

  const walker = {
    surface, cfg, spawn, walkerStep, steerStep, followStep, walkableAt, lineWalkable, lineClear, lineFast, planPath, simulateRoute, wetDepth, onStructure,
    setMode, requestMode, canTransition, leaveReserved,
    onMode(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    setModeHandler(mode, fn) { if (RESERVED_MODES.indexOf(mode) < 0) throw new Error('only swim and slide have handlers'); handlers[mode] = fn; },
    setBlocked(list) { blocked = (list || []).map(normBox); },
    getBlocked: () => blocked.slice(),
    inBlocked, LIM
  };
  return walker;
}
