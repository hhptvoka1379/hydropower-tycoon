/* Save slots, DOM-free. One storage object serves every read and write (B12: no "write to memory, read from localStorage"),
   saves are validated deeply before the live state is touched, and quota errors are returned, never swallowed. */

export const SLOT_IDS = ['auto', 's1', 's2', 's3'];
export const SLOT_LABEL = { auto: 'Autosave', s1: 'Slot 1', s2: 'Slot 2', s3: 'Slot 3' };
const PREFIX = 'hydrofield.save.';

export function createMemoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _map: m };
}
/* Returns {storage, persistent}. Probes a write once; if the browser refuses, the whole store is memory (and says so). */
export function pickStorage(getLocal) {
  try {
    const ls = getLocal();
    if (!ls) throw new Error('none');
    const k = PREFIX + 'probe';
    ls.setItem(k, '1');
    if (ls.getItem(k) !== '1') throw new Error('readback');
    ls.removeItem(k);
    return { storage: ls, persistent: true };
  } catch (e) {
    return { storage: createMemoryStorage(), persistent: false };
  }
}
function isQuota(e) { return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014); }
export function storageReason(e) {
  return isQuota(e) ? 'Browser storage is full. Delete an old save and try again.' : 'The browser refused to store the save' + (e && e.message ? ' (' + e.message + ')' : '') + '.';
}

/* A game counts as played once it has run a couple of game hours or crossed a day; a throwaway "new game and close" is never autosaved. */
export function isPlayed(snap) {
  return !!snap && !!snap.started && ((snap.day | 0) >= 1 || (snap.t || 0) >= 7200);
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const fin = v => typeof v === 'number' && Number.isFinite(v);

/* Everything the sim, the UI and the renderer read. baseValidate is Sim.validateSave. Returns an error string or null. */
export function validateSaveDeep(save, baseValidate, questIds) {
  if (typeof baseValidate === 'function') { const e = baseValidate(save); if (e) return 'This save cannot be used: ' + e; }
  const st = save && save.state;
  if (!isObj(st)) return 'This save has no game state.';
  for (const k of ['cash', 'loans', 'tick', 't', 'day', 'hour', 'secInHour', 'H', 'doy'])
    if (!fin(st[k])) return 'This save is incomplete (' + k + ' is missing).';
  for (const k of ['market', 'fin', 'god', 'stats', 'settings', 'permits', 'contracts', 'reserve', 'quests', 'climate', 'init'])
    if (!isObj(st[k])) return 'This save is incomplete (' + k + ' is missing).';
  if (!Array.isArray(st.market.forecast) || st.market.forecast.length !== 24) return 'This save is incomplete (price forecast).';
  for (const k of ['jobs', 'alerts', 'shop']) if (!Array.isArray(st[k])) return 'This save is incomplete (' + k + ' is missing).';
  if (!Array.isArray(st.contracts.offers) || !Array.isArray(st.contracts.active)) return 'This save is incomplete (contracts).';
  if (Array.isArray(questIds)) for (const q of questIds) if (!isObj(st.quests[q])) return 'This save is incomplete (quest ' + q + ').';
  if (!fin(st.active) || !st.sites[st.active]) return 'This save points at a site that does not exist.';
  for (let i = 0; i < st.sites.length; i++) {
    const s = st.sites[i], w = 'site ' + (i + 1);
    for (const k of ['upper', 'lower', 'dam', 'penstock', 'turbine', 'pump', 'auto', 'tel', 'layout', 'ledger', 'yr', 'acc'])
      if (!isObj(s[k])) return 'This save is incomplete (' + w + ' ' + k + ').';
    if (!Array.isArray(s.parcels) || s.parcels.length !== 3) return 'This save is incomplete (' + w + ' parcels).';
    if (!Array.isArray(s.hist) || !Array.isArray(s.route)) return 'This save is incomplete (' + w + ' history).';
    if (!Array.isArray(s.auto.rules) || s.auto.rules.length !== 8) return 'This save is incomplete (' + w + ' rules).';
    for (const k of ['V', 'bottom']) if (!fin(s.upper[k]) || !fin(s.lower[k])) return 'This save is incomplete (' + w + ' lakes).';
    for (const k of ['health']) if (!fin(s.turbine[k]) || !fin(s.pump[k]) || !fin(s.penstock[k])) return 'This save is incomplete (' + w + ' equipment).';
    if (!fin(s.q) || !fin(s.flowSet)) return 'This save is incomplete (' + w + ' flow).';
    for (let t = 0; t < 48; t++) if (!isObj(s.tiles[t])) return 'This save is incomplete (' + w + ' tile ' + (t + 1) + ').';
  }
  return null;
}

export function metaOf(save, now) {
  const st = save.state, s = st.sites[st.active] || st.sites[0];
  return { savedAt: now, day: st.day, hour: st.hour, cash: Math.round(st.cash), kind: st.init && st.init.kind, site: s ? s.name : '', god: !!(st.god && st.god.enabled) };
}

/* store: {list(), write(slot, save), read(slot), remove(slot), has(slot), latest(), persistent} */
export function createSaveStore(opt) {
  const storage = opt.storage, now = opt.now || (() => 0), validate = opt.validate || (() => null);
  const dk = id => PREFIX + id + '.data', mk = id => PREFIX + id + '.meta';
  const get = k => { try { return storage.getItem(k); } catch (e) { return null; } };
  const store = {
    persistent: opt.persistent !== false,
    has(id) { return get(mk(id)) !== null && get(dk(id)) !== null; },
    meta(id) {
      const raw = get(mk(id));
      if (raw === null) return null;
      try { const m = JSON.parse(raw); return isObj(m) ? m : { corrupt: true }; } catch (e) { return { corrupt: true }; }
    },
    list() { return SLOT_IDS.map(id => ({ id, label: SLOT_LABEL[id], meta: store.meta(id), has: store.has(id) })); },
    write(id, save) {
      if (SLOT_IDS.indexOf(id) < 0) return { ok: false, reason: 'Unknown slot' };
      let text;
      try { text = JSON.stringify(save); } catch (e) { return { ok: false, reason: 'The game could not be turned into a save.' }; }
      const oldData = get(dk(id)), oldMeta = get(mk(id));
      try { storage.setItem(dk(id), text); }
      catch (e) { return { ok: false, reason: storageReason(e), quota: isQuota(e) }; }
      try { storage.setItem(mk(id), JSON.stringify(metaOf(save, now()))); }
      catch (e) {
        try { if (oldData === null) storage.removeItem(dk(id)); else storage.setItem(dk(id), oldData); if (oldMeta !== null) storage.setItem(mk(id), oldMeta); } catch (e2) { /* nothing more to do */ }
        return { ok: false, reason: storageReason(e), quota: isQuota(e) };
      }
      return { ok: true, bytes: text.length };
    },
    read(id) {
      const raw = get(dk(id));
      if (raw === null) return { ok: false, reason: 'That slot is empty.' };
      let obj;
      try { obj = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'This save is damaged and cannot be read.' }; }
      const err = validate(obj);
      return err ? { ok: false, reason: err } : { ok: true, save: obj };
    },
    remove(id) {
      try { storage.removeItem(dk(id)); storage.removeItem(mk(id)); return { ok: true }; }
      catch (e) { return { ok: false, reason: storageReason(e) }; }
    },
    latest() {
      let best = null;
      for (const e of store.list()) if (e.has && e.meta && !e.meta.corrupt && (!best || e.meta.savedAt > best.meta.savedAt)) best = e;
      return best ? best.id : null;
    }
  };
  return store;
}
