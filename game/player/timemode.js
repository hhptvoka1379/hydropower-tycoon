/* Time modes of decisions/fable.md D3. Pure ES module (no DOM, no THREE, no Math.random, no Date/performance): the render side calls
   clock.advance(dtReal, state) once per frame and the controller performs the right number of Sim.step calls.

   mode   rate (sim s per real s)   when
   field  60                         default, walking and working at a card (1 real s = 1 game min)
   wait   up to 3600                 only through requestWait: N hours, next price peak, next morning
   alert  60, forced                 a critical event (grid emergency, cavitation, dam crack, bankrupt) not yet acknowledged; cancels a wait
   pause  0                          pause, any modal

   Sim step dt: the engine reads CONFIG.time.dtBySpeed[state.speed] on every step. The only action that sets state.speed is SET_SPEED, which would be
   written to the action log and change the state hash. The clock therefore writes state.speed directly for the duration of one advance() call and restores
   the previous value in a finally block: the action log is untouched and state.speed (hashed) is exactly what it was before the call; only the simulated
   physics advance, which is the point. Consequence (documented, not a bug): a save's replay log does not contain the clock's dt choices, so replay(log)
   reproduces the game at the logged speed, not at the clock's step size. */

export const TIME = {
  fieldRate: 60,
  waitRate: 3600,
  alertRate: 60,
  fieldMaxDt: 5, // s, largest sim step in field / alert
  waitMaxDt: 60, // s, largest sim step in wait
  maxSteps: 400, // CPU budget: most Sim.step calls in one advance()
  maxCarry: 2, // real seconds of owed sim time that may be carried between calls; beyond it time is dropped, not simulated in a burst
  morningHour: 6,
  debugRates: [60, 600, 3600, 14400] // hidden debug key `]` cycles through these
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createClock(Sim, opts = {}) {
  const T = Object.assign({}, TIME, opts);
  const ladder = Sim.CONFIG.time.dtBySpeed; // [1,5,30,60,120,300]
  /* largest ladder index whose dt <= cap (and <= want when given) */
  function indexFor(maxDt, want) {
    let k = 0;
    for (let i = 0; i < ladder.length; i++) if (ladder[i] <= maxDt && (want === undefined || ladder[i] <= want)) k = i;
    return k;
  }
  const listeners = [];
  let mode = 'field', prevMode = 'field', reason = 'start', owed = 0, wait = null, debugI = 0;
  let lastSummary = null, pendingEnded = null;
  let known = new Set(); // critical keys already acknowledged (or present when a wait began)
  let lastCritical = [];

  const rate = () => (mode === 'pause' ? 0 : mode === 'wait' ? T.waitRate : mode === 'alert' ? T.alertRate : T.debugRates[debugI] > T.fieldRate ? T.debugRates[debugI] : T.fieldRate);
  function emit(extra) { const e = Object.assign({mode, rate: rate(), reason}, extra || {}); for (const fn of listeners.slice()) fn(e); }
  function setModeInternal(m, why, extra) { if (m === mode && !extra) return; const changed = m !== mode; mode = m; reason = why; if (changed || extra) emit(extra); }

  /* ---- critical conditions (all read-only on the state) ---- */
  function criticalKeys(st) {
    const out = [];
    const em = st.market && st.market.emergency;
    if (em && em.day === st.day && st.hour >= em.start && st.hour < em.start + em.dur) out.push('emergency');
    for (const s of st.sites) {
      const tel = s.tel || {};
      if ((s.q > 0 && tel.cavT < 1) || (s.q < 0 && tel.cavP < 1)) out.push('cavitation:' + s.id);
      if (s.dam && s.dam.crack) out.push('crack:' + s.id);
    }
    if (st.bankrupt) out.push('bankrupt');
    return out;
  }
  const textOf = (key) => (key === 'emergency' ? 'Grid emergency' : key === 'bankrupt' ? 'Bankrupt' : key.indexOf('cavitation') === 0 ? 'Cavitation' : key.indexOf('crack') === 0 ? 'Dam crack' : key);
  /* update mode from the critical set. Returns the first unacknowledged key or null. */
  function checkCritical(st) {
    const keys = criticalKeys(st);
    lastCritical = keys;
    for (const k of [...known]) if (keys.indexOf(k) < 0) known.delete(k); // a cleared condition can fire again later
    const fresh = keys.find((k) => !known.has(k)) || null;
    if (fresh) {
      if (mode === 'wait') endWait(st, 'cancelled', fresh);
      if (mode !== 'alert' && mode !== 'pause') setModeInternal('alert', 'critical:' + fresh, {text: textOf(fresh), why: fresh});
      else if (mode === 'pause') prevMode = 'alert';
    } else if (mode === 'alert') setModeInternal('field', 'alert-cleared');
    return fresh;
  }

  /* ---- waiting ---- */
  function snapshot(st) { return {t: st.t, day: st.day, hour: st.hour, cash: st.cash, gen: st.stats.genMWh, pumped: st.stats.pumpedM3, seq: st.alertSeq, loans: st.loans}; }
  function summary(st, w, why, key) {
    const a = w.start, events = [];
    for (const al of st.alerts) if (al.id > a.seq) events.push({id: al.id, day: al.day, hour: al.hour, sev: al.sev, msg: al.msg});
    events.reverse(); // oldest first
    return {
      kind: w.kind, reason: why, critical: key || null,
      simSeconds: st.t - a.t, hours: (st.t - a.t) / 3600,
      from: {day: a.day, hour: a.hour}, to: {day: st.day, hour: st.hour},
      cashDelta: st.cash - a.cash, loansDelta: st.loans - a.loans, genMWh: st.stats.genMWh - a.gen, pumpedM3: st.stats.pumpedM3 - a.pumped,
      events
    };
  }
  function endWait(st, why, key) {
    if (!wait) return null;
    const s = summary(st, wait, why, key); wait = null;
    setModeInternal(prevMode === 'wait' ? 'field' : (prevMode || 'field'), 'wait-' + why, {summary: s});
    lastSummary = s; pendingEnded = s; return s;
  }

  /* sim seconds until the target, or null when it cannot be computed */
  function targetFor(st, req) {
    if (req.kind === 'hours') { const h = +req.h; return h > 0 ? st.t + h * 3600 : null; }
    if (req.kind === 'morning') {
      let d = T.morningHour - (st.hour + st.secInHour / 3600); if (d <= 1e-9) d += 24;
      return st.t + d * 3600;
    }
    if (req.kind === 'nextPeak') {
      const fc = st.market.forecast, pk = st.market.peak;
      if (!fc || fc.length < 2) return null;
      for (let k = 1; k < fc.length; k++) if (fc[k] >= pk && fc[k - 1] < pk) return st.t + k * 3600 - st.secInHour; // start of the next peak block
      return null;
    }
    return null;
  }
  function requestWait(req, st) {
    if (!st || !st.started) return {ok: false, reason: 'The game has not started'};
    if (st.bankrupt) return {ok: false, reason: 'Bankrupt: restructure first'};
    if (mode === 'pause') return {ok: false, reason: 'Paused'};
    if (mode === 'wait') return {ok: false, reason: 'Already waiting'};
    const fresh = checkCritical(st);
    if (fresh) return {ok: false, reason: textOf(fresh) + ' needs attention first'};
    const target = targetFor(st, req);
    if (target === null) return {ok: false, reason: req.kind === 'nextPeak' ? 'No price peak in the forecast' : 'Bad wait request'};
    known = new Set(lastCritical); // standing, acknowledged conditions do not cancel this wait
    wait = {kind: req.kind, target, start: snapshot(st), req};
    prevMode = mode; setModeInternal('wait', 'wait:' + req.kind);
    return {ok: true, target, hours: (target - st.t) / 3600};
  }
  function cancelWait(st) { return wait ? endWait(st, 'cancelled', null) : null; }

  /* ---- the frame call ---- */
  function advance(dtReal, st) {
    const out = {steps: 0, simSeconds: 0, mode, ended: null};
    if (!st || !st.started || mode === 'pause') { return out; }
    if (st.paused && !st.bankrupt) { return out; } // the sim itself is paused (e.g. a modal the app opened through the sim PAUSE action)
    const r = rate();
    owed = Math.min(owed + r * Math.max(0, dtReal), r * T.maxCarry + 1);
    const saved = st.speed; let steps = 0, simmed = 0;
    try {
      while (steps < T.maxSteps) {
        const maxDt = mode === 'wait' || T.debugRates[debugI] > 600 ? T.waitMaxDt : T.fieldMaxDt;
        let want = owed;
        if (mode === 'wait') { const left = wait.target - st.t; if (left < 1) { endWait(st, 'done', null); break; } want = Math.min(want, left); }
        if (want < ladder[0]) break; // less than the smallest step is carried to the next call
        st.speed = indexFor(maxDt, want);
        const used = Sim.step(st);
        if (!used) { owed = 0; checkCritical(st); break; } // not started or bankrupt: nothing advances
        steps++; simmed += used; owed -= used;
        if (mode === 'wait' && st.t >= wait.target - 1e-6) { endWait(st, 'done', null); break; }
        const wasWait = mode === 'wait';
        if (checkCritical(st) && wasWait) { owed = 0; break; } // a cancelled wait stops here; a plain alert keeps running at 60
      }
    } finally { st.speed = saved; }
    out.ended = pendingEnded; pendingEnded = null;
    out.steps = steps; out.simSeconds = simmed; out.mode = mode;
    return out;
  }

  const clock = {
    get mode() { return mode; },
    get rate() { return rate(); },
    get waiting() { return wait ? {kind: wait.kind, target: wait.target} : null; },
    get critical() { return lastCritical.slice(); },
    get lastSummary() { return lastSummary; },
    get owed() { return owed; },
    get frac() { return Math.min(owed, 120); }, // sim seconds not yet stepped (the world adds it to the time of day)
    advance, requestWait, cancelWait,
    /* acknowledge the standing alert(s): the banner is dismissed and these conditions no longer cancel a wait */
    acknowledge(st) { known = new Set(lastCritical); if (mode === 'alert') setModeInternal('field', 'acknowledged'); },
    pause() { if (mode === 'pause') return; prevMode = mode; setModeInternal('pause', 'pause'); },
    resume() { if (mode !== 'pause') return; setModeInternal(prevMode || 'field', 'resume'); },
    /* hidden debug key `]`: cycles 60, 600, 3600, 14400 sim s per real s in field mode */
    cycleDebug() { debugI = (debugI + 1) % T.debugRates.length; emit({reason: 'debug-rate'}); return T.debugRates[debugI]; },
    check(st) { return checkCritical(st); },
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    reset() { mode = 'field'; prevMode = 'field'; owed = 0; wait = null; known = new Set(); lastCritical = []; lastSummary = null; debugI = 0; }
  };
  return clock;
}
