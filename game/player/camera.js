/* Third-person follow camera for the walking player (render side only). Spring-eased position a few metres behind and above the avatar, orbit with
   right drag (or left drag past a few pixels, or two fingers), wheel zoom, never below the terrain (clamp with surface.y), pulls in when the terrain
   blocks the line of sight to the avatar (surface.raycast). Key M toggles an overview pose (the old high orbit view). Yaw convention (demo): the camera
   looks along (-sin yaw, -cos yaw); camera-relative walking uses the same vectors. */
const CC = {
  fov: 50, distDefault: 6.5, distMin: 2.2, distMax: 40, pitchDefault: 0.38, pitchMin: 0.05, pitchMax: 1.4, spring: 9, targetY: 1.45, clearance: 0.9,
  overview: { dist: 1500, pitch: 0.55, yaw: 0.6, fov: 45 }
};
const _dir = { x: 0, y: 0, z: 0 };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createCamera(opts) {
  const { surface: getSurface, canvas } = opts, occlude = opts.occlude || null; // occlude(origin, dir, tMax) -> distance to the nearest structure hit or Infinity
  const cam = {
    yaw: opts.yaw || 0, pitch: CC.pitchDefault, dist: CC.distDefault, overview: false, ovYaw: CC.overview.yaw, ovPitch: CC.overview.pitch, ovDist: CC.overview.dist,
    occ: 0, lastManual: -99, now: 0, pos: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: CC.fov, ready: false, tgtY: 0, cfg: CC,
    /* camera-relative basis on the ground */
    forward() { return [-Math.sin(cam.yaw), -Math.cos(cam.yaw)]; },
    right() { return [Math.cos(cam.yaw), -Math.sin(cam.yaw)]; },
    toggleOverview() { cam.overview = !cam.overview; return cam.overview; },
    /* target = avatar feet {x,y,z}. Returns the pose for world.setCameraPose. */
    update(dt, target) {
      const S = getSurface();
      const k = 1 - Math.exp(-CC.spring * dt);
      cam.tgtY = cam.ready ? cam.tgtY + (target.y - cam.tgtY) * Math.min(1, k * 1.5) : target.y; // the aim point follows height changes smoothly (stairs are steppy)
      let tx, ty, tz, yaw, pitch, dist, fov;
      cam.now += dt;
      if (cam.overview) {
        tx = 0; tz = 0; ty = S.y(0, 0); yaw = cam.ovYaw; pitch = cam.ovPitch; dist = cam.ovDist; fov = CC.overview.fov;
      } else {
        tx = target.x; tz = target.z; ty = cam.tgtY + CC.targetY; yaw = cam.yaw; pitch = cam.pitch; dist = cam.dist; fov = CC.fov;
      }
      let d = dist;
      if (!cam.overview) {
        // occlusion: terrain (surface.raycast) and structures (the features' pick). First try a higher pitch at full distance, then pull in.
        const origin = { x: tx, y: ty, z: tz };
        const freeAt = (pt, dd) => cam.free(origin, yaw, pt, dd);
        let extra = 0, best = -1, bestE = 0;
        for (let e = 0; pitch + e <= CC.pitchMax + 1e-6; e += 0.1) {
          const f = freeAt(pitch + e, dist);
          if (f >= dist) { extra = e; best = Infinity; break; }
          if (f > best) { best = f; bestE = e; }
        }
        if (best !== Infinity) extra = bestE;
        // smooth: rise quickly when blocked, settle back slowly
        cam.occ += (extra - cam.occ) * (1 - Math.exp(-(extra > cam.occ ? 10 : 1.2) * dt));
        pitch = Math.min(CC.pitchMax, pitch + cam.occ);
        if (best !== Infinity) { const f = freeAt(pitch, dist); if (f < dist) d = Math.max(CC.distMin * 0.5, f - 0.6); }
      }
      const c = Math.cos(pitch);
      let ox = Math.sin(yaw) * c, oy = Math.sin(pitch), oz = Math.cos(yaw) * c;
      let x = tx + ox * d, y = ty + oy * d, z = tz + oz * d;
      const g = S.y(x, z) + CC.clearance;
      if (y < g) y = g;                                   // never below the terrain
      if (!cam.ready) { cam.pos.x = x; cam.pos.y = y; cam.pos.z = z; cam.look.x = tx; cam.look.y = ty; cam.look.z = tz; cam.ready = true; }
      else {
        const ks = cam.overview ? 1 - Math.exp(-3 * dt) : k;
        cam.pos.x += (x - cam.pos.x) * ks; cam.pos.y += (y - cam.pos.y) * ks; cam.pos.z += (z - cam.pos.z) * ks;
        cam.look.x += (tx - cam.look.x) * ks; cam.look.y += (ty - cam.look.y) * ks; cam.look.z += (tz - cam.look.z) * ks;
      }
      // the eased position may still dip into a rise: clamp again after easing
      const g2 = S.y(cam.pos.x, cam.pos.z) + CC.clearance * 0.6;
      if (cam.pos.y < g2) cam.pos.y = g2;
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-4 * dt));
      return { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z, tx: cam.look.x, ty: cam.look.y, tz: cam.look.z, fov: cam.fov };
    },
    snap() { cam.ready = false; cam.occ = 0; },
    /* distance along the line from `origin` to a camera at (yaw, pitch, dd) before terrain or a structure is hit; Infinity when clear */
    free(origin, yaw, pt, dd) {
      const S = getSurface(), cc = Math.cos(pt), dir = _dir;
      dir.x = Math.sin(yaw) * cc; dir.y = Math.sin(pt); dir.z = Math.cos(yaw) * cc;
      let f = Infinity;
      const h = S.raycast(origin, dir, dd + 0.5); if (h) f = h.t;
      if (occlude) { const t2 = occlude(origin, dir, dd + 0.5); if (t2 < f) f = t2; }
      return f;
    },
    /* the camera yaw (looking direction = (-sin, -cos)) closest to `want` whose view of the avatar is not blocked at the default pitch and distance */
    pickYaw(target, want) {
      const origin = { x: target.x, y: target.y + CC.targetY, z: target.z };
      let best = want, bs = -1e9;
      const S = getSurface(), dir = { x: 0, y: 0, z: 0 };
      // points around her that should be visible from the camera: head, feet, both shoulders, a hand's breadth above her head
      const pts = [[0, 0, 0], [0, -1.3, 0], [0.5, -0.4, 0], [-0.5, -0.4, 0], [0, 0.5, 0], [1.6, -0.4, 0], [-1.6, -0.4, 0]];
      for (let k = 0; k < 24; k++) {
        const yaw = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const f = cam.free(origin, yaw, CC.pitchDefault, CC.distDefault);
        const cc = Math.cos(CC.pitchDefault), cx = origin.x + Math.sin(yaw) * cc * CC.distDefault, cy = origin.y + Math.sin(CC.pitchDefault) * CC.distDefault, cz = origin.z + Math.cos(yaw) * cc * CC.distDefault;
        let seen = 0;
        for (const q of pts) {
          const px = origin.x + (Math.cos(yaw) * q[0]), py = origin.y + q[1], pz = origin.z + (-Math.sin(yaw) * q[0]);
          const dx = cx - px, dy = cy - py, dz = cz - pz, L = Math.hypot(dx, dy, dz); dir.x = dx / L; dir.y = dy / L; dir.z = dz / L;
          const o = { x: px, y: py, z: pz }; let hit = Infinity;
          const h = S.raycast(o, dir, L); if (h) hit = h.t;
          if (occlude) { const t2 = occlude(o, dir, L); if (t2 < hit) hit = t2; }
          if (hit >= L) seen++;
        }
        const dev = Math.abs(Math.atan2(Math.sin(yaw - want), Math.cos(yaw - want)));
        const sc = (f >= CC.distDefault ? 4 : f / CC.distDefault * 2) + seen / pts.length * 6 - dev;
        if (sc > bs) { bs = sc; best = yaw; }
      }
      return best;
    },
    /* ease the yaw so the camera sits behind the heading (heading = avatar yaw); not while the player is orbiting by hand */
    autoFollow(dt, headingYaw, rate) {
      if (cam.overview || cam.now - cam.lastManual < 1.5) return;
      const want = headingYaw + Math.PI, d = Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw));
      cam.yaw += d * (1 - Math.exp(-(rate || 1.2) * dt));
    }
  };

  // ---- pointer input: orbit and zoom (clicks are handled by the player) ----
  if (canvas) {
    const pts = new Map();
    let last = null, pinch = 0;
    cam.dragged = false;
    canvas.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY, button: e.button, moved: 0 };
      cam.dragged = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) cam.zoom(pinch / dd); pinch = dd;
        cam.orbit(dx * 0.5, dy * 0.5); cam.dragged = true; return;
      }
      if (!last) return;
      last.moved += Math.abs(dx) + Math.abs(dy);
      if (last.button === 2 || last.moved > 6) { cam.orbit(dx, dy); cam.dragged = true; }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) last = null; try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  }
  cam.orbit = (dx, dy) => {
    cam.lastManual = cam.now;
    if (cam.overview) { cam.ovYaw -= dx * 0.006; cam.ovPitch = clamp(cam.ovPitch + dy * 0.006, 0.03, 1.5); }
    else { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.005, CC.pitchMin, CC.pitchMax); }
  };
  cam.zoom = (f) => {
    if (cam.overview) cam.ovDist = clamp(cam.ovDist * f, 40, 3200);
    else cam.dist = clamp(cam.dist * f, CC.distMin, CC.distMax);
  };
  return cam;
}
