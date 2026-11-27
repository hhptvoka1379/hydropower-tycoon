/* createPlayer(ctx): the walking player. Render side only: it reads the sim (stations are built from the site state) and never writes to it, never uses the
   sim RNG. ctx = { Sim, game, bus, act, clock, world, surface }. Call player.frame(dtReal) once per frame BEFORE world.frame (it sets the camera pose and the torch).

   Returned object: { stations, paths, walker, avatar, camera, tracker, state, mode, station, glide, goTo(idOrPoint), stop(), teleport(x,z), spawnAt(id), rebuild(),
   frame(dt), audit(), setBlockedHint(), on rebuild bus 'player:paths' {stations, paths}, dispose() }.
   Bus: station:enter {id}, station:leave {id}, player:paths {stations, paths}, player:nudged {x,z}, alert {level:'info', text} for refused walks. */
import { Mesh, MeshBasicMaterial, RingGeometry, DoubleSide, Vector3 } from 'three';
import { createWalker, PLAYER } from './walker.js';
import { buildStations, buildPaths, registerFlights, createStationTracker } from './stations.js';
import { createAvatar } from './avatar.js';
import { createCamera } from './camera.js';
import { AMP, strideOf } from './gait.js';

const PICK_STATION = { powerhouse: 'powerhouse', switchyard: 'powerhouse', dam: 'dam', penstock: 'penstock', board: 'board', hut: 'lookout', slide: 'slide' };
const NIGHT_ON = 0.3, NIGHT_OFF = 0.22; // torch hysteresis on the world's night factor
export function createPlayer(ctx) {
  const { Sim, game, bus, world } = ctx;
  const canvas = world.canvas;
  let surface = null, walker = null, stations = [], paths = null, tracker = null, flightFns = [];
  let st = null, glide = null, marker = null, label = null;
  let frozen = null, night = 0, torchOn = false, tt = 0, phase = 0, move = 0, climb = 0, speedEst = 0, yaw = 0, amp = 1, facing = null, sig = '', sigT = 0, pendingFresh = true;
  const keys = {};
  const reached = new Set();
  const audit = { nanFree: true, minClearance: Infinity, frames: 0 };
  const avatar = createAvatar();
  /* structures occlude the camera too: the nearest hit of any feature's pick (powerhouse, penstock, dam, props); hits within 1.2 m of her head are ignored (she may stand inside a pick box) */
  const occlude = (o, d, tMax) => { let best = Infinity; for (const rec of world.features) { if (!rec.f.pick) continue; const h = rec.f.pick(o, d, tMax); if (h && h.t >= 1.2 && h.t < best) best = h.t; } return best; };
  const camera = createCamera({ surface: () => surface, canvas, yaw: 0, occlude });
  const offs = [];
  const toast = (text) => bus.emit('alert', { level: 'info', text, why: 'player' });

  // night factor comes from the world's per-frame env (a world feature that only reads it)
  world.addFeature({ name: 'player-env', signature: () => '', build() {}, frame(dt, env) { night = env.night; } });
  world.scene.add(avatar.group);

  function site() { const s = game.state; return s.sites[s.active | 0]; }
  const foreign = () => surface.providers.filter((p) => !flightFns.includes(p));
  const r1 = (v) => Math.round(v * 10) / 10, boxKey = (b) => [b.x0, b.z0, b.x1, b.z1].map(r1).join(',');
  /* Everything the stations and routes depend on. A change of less than 0.5 m in the dam crest does not change it; an identical key reuses the old stations and
     flights (their floor functions do not depend on the surface object), so a rebuild of the world with the same site costs nothing. */
  function siteKey() {
    const s = site(), dm = s.dam;
    return [s.kind, s.seed, s.station, dm.built ? 1 : 0, dm.raising ? dm.raising.to : '', s.lower.excav, foreign().length, world.blockers.map(boxKey).join('|')].join('#');
  }
  /* layout points (the dam ring follows the dam height): a move of under 0.5 m keeps the cache */
  function geom() { const L = site().layout; return [L.ph, L.dam, L.up, L.lo, ...L.parcels].flatMap((p) => [p.x, p.z]); }
  const sameGeom = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.5);
  const signature = siteKey;
  let cache = null;

  /* ---- build / rebuild: stations and paths after the world has registered the crest floor provider (world:rebuilt is emitted after every feature built) ---- */
  function rebuild(opts = {}) {
    surface = ctx.surface;
    if (!surface) return;
    for (const fn of flightFns) surface.removeFloorProvider(fn);   // (a new surface has none of ours; an old one is dropped anyway)
    flightFns = [];
    const keep = st && !opts.fresh ? { x: st.x, z: st.z } : null;
    walker = createWalker(surface, { blocked: world.blockers.slice() });
    const key = siteKey();
    const g = geom();
    if (cache && cache.key === key && sameGeom(cache.geom, g)) { stations = cache.stations; paths = cache.paths; registerFlights(surface, paths); }
    else {
      // stations use the same call as the world's structures (default footprint) so props and stations agree; routes avoid every blocker
      stations = buildStations(site(), surface, {});
      paths = buildPaths(stations, surface, { blocked: world.blockers.slice() });
      registerFlights(surface, paths);
      cache = { key, stations, paths, geom: g };
    }
    flightFns = surface.providers.filter((p) => paths.flights.some((f) => f.floor === p));
    tracker = createStationTracker(stations);
    ctx.paths = { stations, graph: paths, flights: paths.flights };
    world.stations = stations; world.paths = paths; // the features builder's stations-link.js reads these (owned: the player registers the flight floors)
    bus.emit('player:paths', { stations, paths });
    walker.onMode((e) => bus.emit('player:mode', { mode: e.to, from: e.from }));
    if (keep) { st = walker.spawn(keep.x, keep.z); ensureDry(true); } else spawnAt('powerhouse');
    sig = signature();
  }

  /* ---- water rising under her: nudge to the nearest dry walkable point (render side, no sim effect) ---- */
  function ensureDry(force) {
    if (!walker) return;
    const bad = walker.wetDepth(st.x, st.z) > PLAYER.maxWade + (force ? 0 : 0.3) || walker.inBlocked(st.x, st.z);
    if (!bad) return false;
    for (let r = 2; r <= 300; r += 2) {
      const n = Math.max(8, Math.ceil(r * 2.1));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, x = st.x + Math.cos(a) * r, z = st.z + Math.sin(a) * r;
        if (walker.walkableAt(x, z) && surface.slopeDeg(x, z) < 28) { st.x = x; st.z = z; st.y = surface.floorY(x, z); st.on = walker.onStructure(x, z); glide = null; bus.emit('player:nudged', { x, z }); return true; }
      }
    }
    return false;
  }

  function stationById(id) { return stations.find((s) => s.id === id) || null; }
  function spawnAt(id) {
    const s = typeof id === 'string' ? stationById(id) : id;
    if (!s) return false;
    st = walker.spawn(s.x, s.z);
    glide = null; tracker && tracker.reset();
    // look along the way she is most likely to walk (powerhouse: towards the dam; elsewhere: back to the powerhouse), then take the nearest view that no structure blocks
    const goal = s.kind === 'powerhouse' ? stationById('dam') || s : stationById('powerhouse') || s, vx = goal.x - s.x, vz = goal.z - s.z, l = Math.hypot(vx, vz);
    const fx = l > 1 ? vx / l : 1, fz = l > 1 ? vz / l : 0;
    camera.snap();
    camera.yaw = camera.pickYaw(st, Math.atan2(-fx, -fz));
    yaw = Math.atan2(-Math.sin(camera.yaw), -Math.cos(camera.yaw)); facing = null;
    return true;
  }
  function teleport(x, z) { st = walker.spawn(x, z); glide = null; ensureDry(true); camera.snap(); return { x: st.x, z: st.z }; }

  /* ---- walking to a place or a station ---- */
  function goTo(target) {
    if (!walker || !st) return { ok: false, reason: 'not ready' };
    let tx, tz, id = null;
    if (typeof target === 'string') { const s = stationById(target); if (!s) return { ok: false, reason: 'unknown station ' + target }; tx = s.x; tz = s.z; id = s.id; }
    else { tx = target.x; tz = target.z; }
    let to = { x: tx, z: tz };
    if (!walker.walkableAt(tx, tz)) {
      let found = null;
      for (let r = 1; r <= 14 && !found; r += 1) for (let k = 0; k < 16 && !found; k++) { const a = k / 16 * Math.PI * 2, x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r; if (walker.walkableAt(x, z)) found = { x, z }; }
      if (!found) { toast('She cannot walk there.'); return { ok: false, reason: 'not walkable' }; }
      to = found;
    }
    const wps = walker.planPath({ x: st.x, z: st.z }, to, paths);
    if (!wps) { toast('No walkable way there.'); return { ok: false, reason: 'no route' }; }
    glide = { wps, i: 1, stuck: 0, id, to };
    let len = 0; for (let i = 1; i < wps.length; i++) len += Math.hypot(wps[i].x - wps[i - 1].x, wps[i].z - wps[i - 1].z);
    return { ok: true, id, length: len, eta: len / PLAYER.walk };
  }
  function stop() { glide = null; }
  /* what a station looks at: the nearest solid prop within 14 m (building, board, hut, slide deck), the water for the shores and the dam, the tiles for a desk */
  function faceOf(s) {
    const L = site().layout; let best = null, bd = 14;
    for (const b of world.blockers) { const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, d = Math.hypot(cx - s.x, cz - s.z); if (d < bd && d > 0.5) { bd = d; best = { x: cx, z: cz }; } }
    if (s.kind === 'powerhouse') return { x: L.ph.x, z: L.ph.z };
    if (s.kind === 'dam') return { x: L.up.x, z: L.up.z };
    if (s.kind === 'upper') return { x: L.up.x, z: L.up.z };
    if (s.kind === 'lower') return { x: L.lo.x, z: L.lo.z };
    if (s.kind === 'desk') return L.parcels[s.parcel | 0];
    if (s.kind === 'penstock') { const r = site().route; if (r && r.length > 2) { const m = r[r.length >> 1]; return { x: m.x, z: m.z }; } }
    return best;
  }
  function remaining() {
    if (!glide) return 0;
    let d = Math.hypot(glide.wps[glide.i].x - st.x, glide.wps[glide.i].z - st.z);
    for (let i = glide.i + 1; i < glide.wps.length; i++) d += Math.hypot(glide.wps[i].x - glide.wps[i - 1].x, glide.wps[i].z - glide.wps[i - 1].z);
    return d;
  }

  /* ---- input ---- */
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  const onKeyDown = (e) => {
    if (typing(e)) return;
    keys[e.code] = true;
    if (e.code === 'KeyM' && !e.repeat) { camera.toggleOverview(); }
    if (e.code.startsWith('Arrow')) e.preventDefault();
  };
  const onKeyUp = (e) => { keys[e.code] = false; };
  const onBlur = () => { for (const k of Object.keys(keys)) keys[k] = false; };
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
  offs.push(() => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); });

  let lastClick = null, downAt = null;
  const pickAt = (e) => { const r = canvas.getBoundingClientRect(); return world.pick(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); };
  const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY, t: e.timeStamp }; };
  const onUp = (e) => {
    if (e.button !== 0 || !downAt || camera.dragged || camera.overview && false) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    const hit = pickAt(e); if (!hit) return;
    if (hit.type === 'tile' || hit.type === 'desk') {
      bus.emit('world:pick', hit);
      const dblTile = lastClick && e.timeStamp - lastClick.t < 420 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 24;
      lastClick = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (dblTile) { lastClick = null; goTo({ x: hit.x, z: hit.z }); }
      return;
    }
    const sid = PICK_STATION[hit.type];
    if (sid) { goTo(sid); bus.emit('world:pick', hit); lastClick = null; return; }
    const dbl = lastClick && e.timeStamp - lastClick.t < 420 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 24;
    lastClick = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (!dbl) return;
    lastClick = null;
    // a double click close to a station walks to the station itself
    for (const s of stations) if (Math.hypot(s.x - hit.x, s.z - hit.z) < s.range + 3) { goTo(s.id); return; }
    goTo({ x: hit.x, z: hit.z });
  };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
  offs.push(() => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); });

  /* ---- destination marker (ring in the world + a text label with distance and time) ---- */
  marker = new Mesh(new RingGeometry(0.7, 1.0, 28), new MeshBasicMaterial({ color: 0xffe066, side: DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
  marker.rotation.x = -Math.PI / 2; marker.visible = false; marker.renderOrder = 10;
  world.scene.add(marker);
  label = document.createElement('div');
  label.style.cssText = 'position:fixed;pointer-events:none;font:12px monospace;color:#fff;background:rgba(0,0,0,.55);padding:1px 5px;border-radius:3px;display:none;transform:translate(-50%,-140%);z-index:5';
  document.body.appendChild(label);
  const pv = new Vector3();
  function updateMarker() {
    if (!glide) { marker.visible = false; label.style.display = 'none'; return; }
    const t = glide.to, y = surface.floorY(t.x, t.z) + 0.15, pulse = 1 + 0.15 * Math.sin(tt * 5);
    marker.visible = true; marker.position.set(t.x, y, t.z); marker.scale.setScalar(pulse);
    pv.set(t.x, y + 0.5, t.z).project(world.camera);
    if (pv.z > 1 || pv.z < -1) { label.style.display = 'none'; return; }
    const r = canvas.getBoundingClientRect(), d = remaining();
    label.style.display = 'block'; label.style.left = r.left + (pv.x * 0.5 + 0.5) * r.width + 'px'; label.style.top = r.top + (-pv.y * 0.5 + 0.5) * r.height + 'px';
    label.textContent = (glide.id ? glide.id + ' ' : '') + Math.round(d) + ' m, ' + Math.max(1, Math.round(d / PLAYER.walk)) + ' s';
  }

  /* ---- per frame ---- */
  function frame(dtReal) {
    if (!surface || !st) return;
    const dt = Math.min(0.05, Math.max(0, dtReal));
    tt += dt;
    if (frozen) { // debug seam: a fixed gait pose, no movement, no input (see player.pose / player.freeze)
      ensureDry(false);
      avatar.update({ x: st.x, y: st.y, z: st.z, yaw }, { phase: frozen.phase, move: 1, climb: frozen.climb, t: 0, amp: AMP(frozen.speed) });
      const fp = camera.update(dt, { x: st.x, y: st.y, z: st.z }); world.setCameraPose(fp);
      world.setTorch({ x: avatar.hand.x, y: avatar.hand.y, z: avatar.hand.z, dx: Math.sin(yaw), dz: Math.cos(yaw), on: torchOn });
      updateMarker(); return;
    }
    const fast = keys.ShiftLeft || keys.ShiftRight, iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const ox = st.x, oz = st.z, speed = fast ? PLAYER.run : PLAYER.walk;
    let dx = 0, dz = 0, have = false, res = 0;
    if (ix || iz) {
      const f = camera.forward(), r = camera.right();
      dx = f[0] * iz + r[0] * ix; dz = f[1] * iz + r[1] * ix; have = true; glide = null;
      res = walker.walkerStep(st, dx, dz, speed, dt);
    } else if (glide) {
      const f = walker.followStep(st, glide, speed, dt);
      if (f.done) { const sid = glide.id; glide = null; if (sid) { const stt = stationById(sid); facing = stt ? faceOf(stt) : null; } }
      else {
        have = true; res = f.code;
        const w = glide.wps[glide.i]; dx = w.x - st.x; dz = w.z - st.z;
        if (res !== 0) { glide.stuck += dt; if (glide.stuck > 1.5) { glide = null; toast('She stopped: the way ahead is too steep or wet.'); } } else glide.stuck = 0;
      }
    }
    if (have) facing = null;
    if (!have && facing) {   // arrived: turn to the station's object and bring the camera round behind her
      const ty = Math.atan2(facing.x - st.x, facing.z - st.z), d = Math.atan2(Math.sin(ty - yaw), Math.cos(ty - yaw));
      yaw += d * Math.min(1, 6 * dt); camera.autoFollow(dt, yaw, 2.5);
      if (Math.abs(d) < 0.02) facing = null;
    } else if (have && (glide || (iz > 0 && !ix))) camera.autoFollow(dt, yaw, 1.2); // walking forward: the camera drifts round behind her unless she is orbiting by hand
    if (have && (dx || dz)) { const ty = Math.atan2(dx, dz), d = Math.atan2(Math.sin(ty - yaw), Math.cos(ty - yaw)); yaw += d * Math.min(1, 10 * dt); }
    const moved = Math.hypot(st.x - ox, st.z - oz) / Math.max(dt, 1e-4);
    speedEst += (moved - speedEst) * Math.min(1, dt * 10);
    const moving = have && res === 0 && moved > 0.2 * PLAYER.walk;
    move += ((moving ? 1 : 0) - move) * Math.min(1, dt * 8);
    climb += ((st.on && moving ? 1 : 0) - climb) * Math.min(1, dt * 6);
    amp = AMP(Math.max(speedEst, 1));
    phase += move * dt * 6.2831853 * Math.max(speedEst, 0) / strideOf(Math.max(speedEst, 1), climb, avatar.body.rig.standH);

    ensureDry(false);
    // stations: enter / leave events and the audit's reach set
    const r = tracker.update(st.x, st.z);
    if (r.left) bus.emit('station:leave', { id: r.left.id });
    if (r.entered) { bus.emit('station:enter', { id: r.entered.id }); reached.add(r.entered.id); }

    // the world changed under us (dam raised, structures rebuilt)? re-plan, at most twice a second
    sigT += dt; if (sigT > 0.5) { sigT = 0; const s2 = signature(); if (s2 !== sig || !sameGeom(cache && cache.geom, geom())) { walker.setBlocked(world.blockers); rebuild(); } }

    avatar.update({ x: st.x, y: st.y, z: st.z, yaw }, { phase, move, climb, t: tt, amp });
    const pose = camera.update(dt, { x: st.x, y: st.y, z: st.z });
    world.setCameraPose(pose);
    // torch: at the hand, along the heading, on at night
    torchOn = night > NIGHT_ON ? true : night < NIGHT_OFF ? false : torchOn;
    world.setTorch({ x: avatar.hand.x, y: avatar.hand.y, z: avatar.hand.z, dx: Math.sin(yaw), dz: Math.cos(yaw), on: torchOn });
    updateMarker();

    audit.frames++;
    const clear = st.y - surface.floorY(st.x, st.z);
    if (clear < audit.minClearance) audit.minClearance = clear;
    if (!Number.isFinite(st.x + st.y + st.z + pose.x + pose.y + pose.z + yaw + phase)) audit.nanFree = false;
  }

  /* ---- deterministic debug seams for screenshots ----
     player.freeze(speed, opts?)  hold a running gait frozen at `speed` m/s (the swing and stride follow it), opts {phase (rad, default 0.9 = mid stride, stance foot flat), climb 0..1}.
                                  player.freeze(null) releases. No input, no movement while frozen; the camera still follows.
     player.pose(name)            'idle' | 'walk' | 'run' | 'stairs' (frozen mid-stride presets), 'free' (release), or 'arrival:<stationId>' (teleport to the station and turn to
                                  its object exactly as an arrival does, unfrozen, camera swung behind her).  Returns a description object. */
  function freeze(speed, o = {}) {
    if (speed === null || speed === undefined) { frozen = null; return { frozen: false }; }
    frozen = { speed, phase: o.phase === undefined ? 0.9 : o.phase, climb: o.climb || 0 }; glide = null;
    return { frozen: true, speed, phase: frozen.phase, climb: frozen.climb, amp: AMP(speed) };
  }
  function pose(name) {
    if (name === 'free') return freeze(null);
    if (name === 'idle') { frozen = null; glide = null; move = 0; climb = 0; return { frozen: false, pose: 'idle' }; }
    if (name === 'walk') return freeze(PLAYER.walk);
    if (name === 'run') return freeze(PLAYER.run);
    if (name === 'stairs') return freeze(PLAYER.walk * PLAYER.stairFactor, { climb: 1 });
    const m = /^arrival:(.+)$/.exec(name || '');
    if (m) {
      const s = stationById(m[1]); if (!s) return { ok: false, reason: 'unknown station ' + m[1] };
      frozen = null; spawnAt(s); const f = faceOf(s);
      if (f) { yaw = Math.atan2(f.x - st.x, f.z - st.z); camera.yaw = camera.pickYaw(st, yaw + Math.PI); camera.snap(); }
      facing = null; move = 0; climb = 0;
      return { ok: true, station: s.id, yaw, faces: f };
    }
    return { ok: false, reason: 'unknown pose ' + name };
  }

  const player = {
    get stations() { return stations; }, get paths() { return paths; }, get walker() { return walker; }, get state() { return st; },
    get mode() { return st ? st.mode : 'walk'; }, get station() { return tracker && tracker.current ? tracker.current : null; }, get glide() { return glide; },
    get torch() { return torchOn; }, get night() { return night; }, get yaw() { return yaw; },
    avatar, camera, tracker: null, keys, reached,
    goTo, stop, teleport, spawnAt, rebuild, frame, stationById, freeze, pose,
    requestMode(m) { return walker.requestMode(st, m); },
    audit() { return { nanFree: audit.nanFree, minClearance: audit.minClearance === Infinity ? 0 : audit.minClearance, stationsReached: [...reached], frames: audit.frames }; },
    dispose() { for (const o of offs) o(); world.scene.remove(avatar.group, marker); avatar.dispose(); if (label.parentNode) label.parentNode.removeChild(label); }
  };
  Object.defineProperty(player, 'tracker', { get() { return tracker; } });

  offs.push(bus.on('world:rebuilt', () => { rebuild({ fresh: pendingFresh }); pendingFresh = false; }));
  for (const ev of ['game:new', 'game:loaded']) offs.push(bus.on(ev, () => { pendingFresh = true; }));
  if (ctx.surface) { rebuild({ fresh: true }); pendingFresh = false; }
  return player;
}
