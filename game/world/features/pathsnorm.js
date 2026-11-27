/* Adapter from the footpath graph of game/player/stations.js (buildPaths) -- or the documented shape
   {nodes:[{x,z}], edges:[[i,j]] | [{a,b}], flights:[{pts:[{x,(y),z}], riser, tread, top(x,z)->y|NaN | floor | tops}]} -- to one plain form. Pure, THREE-free.
   -> { segs:[[ax,az,bx,bz]], flights:[{id, kind, pts:[{x,z}], len, tread, riser, hw, tops:[y], floor(x,z)}] }
   Tread i covers path distance [i*tread, min((i+1)*tread, len)) and its top is tops[i] (exactly Flight.floor of stations.js). */
export function normalizePaths(raw) {
  const nodes = (raw && raw.nodes) || [], segs = [];
  for (const e of (raw && raw.edges) || []) {
    const ia = Array.isArray(e) ? e[0] : (e.a !== undefined ? e.a : e.from), ib = Array.isArray(e) ? e[1] : (e.b !== undefined ? e.b : e.to);
    const A = nodes[ia], B = nodes[ib];
    if (A && B) segs.push([A.x, A.z, B.x, B.z]);
  }
  const flights = ((raw && raw.flights) || []).map((f, k) => normFlight(f, k)).filter(Boolean);
  return { segs, flights };
}
/* Chains of the graph as polylines [{x,z}], walking from junctions / dead ends; edges for which skip(ax,az,bx,bz) is true are dropped (they split the chain). */
export function chainsOf(raw, skip) {
  const nodes = (raw && raw.nodes) || [], E = [];
  for (const e of (raw && raw.edges) || []) {
    const a = Array.isArray(e) ? e[0] : (e.a !== undefined ? e.a : e.from), b = Array.isArray(e) ? e[1] : (e.b !== undefined ? e.b : e.to);
    if (nodes[a] && nodes[b] && !(skip && skip(nodes[a].x, nodes[a].z, nodes[b].x, nodes[b].z))) E.push([a, b]);
  }
  const adj = nodes.map(() => []);
  E.forEach(([a, b], i) => { adj[a].push([b, i]); adj[b].push([a, i]); });
  const used = new Uint8Array(E.length), chains = [];
  const walk = (start, first) => {
    const pts = [{ x: nodes[start].x, z: nodes[start].z }]; let cur = start, nxt = first;
    for (;;) {
      used[nxt[1]] = 1; cur = nxt[0]; pts.push({ x: nodes[cur].x, z: nodes[cur].z });
      if (adj[cur].length !== 2) break;
      const o = adj[cur][0][1] === nxt[1] ? adj[cur][1] : adj[cur][0];
      if (used[o[1]]) break;
      nxt = o;
    }
    return pts;
  };
  for (let n = 0; n < nodes.length; n++) if (adj[n].length !== 2) for (const e of adj[n]) if (!used[e[1]]) chains.push(walk(n, e));
  for (let n = 0; n < nodes.length; n++) for (const e of adj[n]) if (!used[e[1]]) chains.push(walk(n, e));
  return chains;
}
export function densify(pts, maxStep) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxStep));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}
export function polyPoint(pts, cum, s, out) {
  let q = 0; while (q < pts.length - 2 && cum[q + 1] < s) q++;
  const l = cum[q + 1] - cum[q] || 1, t = Math.min(1, Math.max(0, (s - cum[q]) / l));
  out.x = pts[q].x + (pts[q + 1].x - pts[q].x) * t; out.z = pts[q].z + (pts[q + 1].z - pts[q].z) * t;
  out.dx = (pts[q + 1].x - pts[q].x) / l; out.dz = (pts[q + 1].z - pts[q].z) / l;
  return out;
}
function normFlight(f, k) {
  if (!f || !f.pts || f.pts.length < 2) return null;
  const pts = f.pts.map(p => ({ x: p.x, z: p.z })), cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const len = cum[cum.length - 1], tread = f.tread || 0.27, riser = f.riser || 0.18, nT = Math.max(1, Math.ceil(len / tread - 1e-9));
  const floor = typeof f.floor === 'function' ? f.floor : (typeof f.top === 'function' ? f.top : null);
  let tops = f.tops && f.tops.length ? Array.from(f.tops) : null;
  if (!tops) {
    tops = []; const o = {};
    for (let i = 0; i < nT; i++) { polyPoint(pts, cum, Math.min(len, (i + 0.5) * tread), o); const y = floor ? floor(o.x, o.z) : NaN; tops.push(y === y ? y : (i ? tops[i - 1] : 0)); }
  }
  return { id: f.id || 'flight' + k, kind: f.kind || 'stairs', pts, cum, len, tread, riser, hw: (f.width || 2.4) / 2, tops, floor };
}
