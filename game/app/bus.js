// Event bus shared by world, player and UI. See decisions/fable.md D2 for the event names.
export function createBus() {
  const map = new Map();
  return {
    on(type, fn) {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      const set = map.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(payload); } catch (e) { if (type !== 'error') this.emit('error', { source: type, error: e }); }
      }
    },
  };
}

// The single dispatch path for UI and player code.
export function createAct(game, bus) {
  return function act(action) {
    const r = game.dispatch(action) || { ok: false, reason: 'no result' };
    bus.emit('action:result', { action, ok: !!r.ok, reason: r.reason || '' });
    return r;
  };
}
