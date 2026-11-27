/* TEMPORARY placeholder HUD (plain, unstyled DOM). The real UI is on hold; this file exists only so the player and the time modes can be driven and checked.
   Delete this file (and its two lines in main.js) when the real UI lands. It reads game.state and calls ctx.act; it writes nothing else. */
/* The placeholder actions per station kind (game/notes/stations.md), as [label, action] pairs. Pure: no DOM, so a test can check that every action type exists in
   game/sim/actions.js. For the dam it also shows the read-only quote of Sim.raiseQuote (base, premium, discount) in the label. */
export function stationActions(s, st, site, Sim) {
  const L = [];
  const add = (label, a) => L.push([label, a]);
  switch (s.kind) {
    case 'powerhouse':
      add('mode gen', { type: 'SET_MODE', mode: 'gen' }); add('mode pump', { type: 'SET_MODE', mode: 'pump' }); add('mode idle', { type: 'SET_MODE', mode: 'idle' });
      add('flow 3', { type: 'SET_FLOW', q: 3 }); add('repair turbine', { type: 'REPAIR', target: 'turbine' });
      add('rules ' + (site.auto && site.auto.enabled ? 'off' : 'on'), { type: 'SET_RULES', enabled: !(site.auto && site.auto.enabled) });
      add('reserve offer 0.5', { type: 'SET_RESERVE_OFFER', mw: 0.5 }); add('curtail 0', { type: 'SET_CURTAIL', frac: 0 });
      break;
    case 'board': break;
    case 'dam': {
      const q = Sim.raiseQuote ? Sim.raiseQuote(st, st.active, 1) : null;
      add('raise 1 m' + (q ? q.ok ? ' ($' + Math.round(q.cost) + ' = base ' + Math.round(q.base) + ' + premium ' + Math.round(q.premium) + ' - discount ' + Math.round(q.discount) + ')' : ' (' + q.reason + ')' : ''), { type: 'RAISE_DAM', meters: 1 });
      add('repair dam', { type: 'REPAIR', target: 'dam' });
      if (site.kind === 'proc' && !site.dam.built) add('place dam 12 m', { type: 'PLACE_DAM', height: 12 });
      add('gravity permit', { type: 'BUY_PERMIT', kind: 'dam', cls: 'gravity' });
      break;
    }
    case 'penstock': add('replace D 1.2 steel', { type: 'REPLACE_PENSTOCK', D: 1.2, mat: 'steel' }); break;
    case 'lower': add('excavate', { type: 'EXCAVATE' }); break;
    case 'desk': {
      const p = s.parcel | 0;
      if (p > 0) add('buy parcel permit', { type: 'BUY_PERMIT', kind: 'parcel', parcel: p });
      add('build solar T1 tile ' + p * 16, { type: 'BUILD', kind: 'solar', tile: p * 16, tier: 1 }); add('clean tile ' + p * 16, { type: 'CLEAN_ARRAY', tile: p * 16 });
      break;
    }
    case 'lookout':
      add('loan 100k', { type: 'TAKE_LOAN', amount: 100000 }); add('repay 100k', { type: 'REPAY_LOAN', amount: 100000 });
      for (const o of st.contracts.offers) add('sign ' + o.name, { type: 'SIGN_CONTRACT', id: o.id });
      for (const q of (Sim.QUESTS || [])) if (st.quests[q.id] && st.quests[q.id].done && !st.quests[q.id].claimed) add('claim ' + q.id, { type: 'CLAIM_QUEST', id: q.id });
      add('emergency credit', { type: 'EMERGENCY_CREDIT' }); add('site 0', { type: 'SET_ACTIVE', site: 0 });
      if (st.bankrupt) add('restructure: refinance', { type: 'RESTRUCTURE', plan: 'refinance' });
      break;
    default: break; // upper shore, slide: no sim action
  }
  return L;
}
/* grid emergency notice shown on every station card while the sim has one */
export function gridWarningText(st) {
  const g = st.gridWarning; if (!g) return '';
  const inH = g.startsAt - st.H;
  return 'GRID WARNING: ' + (inH > 0 ? 'emergency in ' + inH + ' h' : 'emergency now') + ', ' + g.hours + ' h, ' + (g.mwShort !== undefined ? g.mwShort + ' MW short, ' : '') + 'price x' + (g.priceMult !== undefined ? g.priceMult : '?');
}

export function createDevHud(ctx) {
  const { game, bus, act, clock } = ctx;
  const root = document.createElement('div');
  root.id = 'devhud';
  root.style.cssText = 'position:fixed;left:0;top:0;max-width:420px;font:12px monospace;color:#000;background:rgba(255,255,255,.85);padding:4px;z-index:10';
  const top = document.createElement('div'), stationEl = document.createElement('div'), actionsEl = document.createElement('div'), msg = document.createElement('div');
  root.append(top, stationEl, actionsEl, msg);
  const bar = document.createElement('div');
  const btn = (label, fn, host) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; (host || bar).appendChild(b); return b; };
  const say = (t) => { msg.textContent = t; };
  const wait = (req) => () => { const r = clock.requestWait(req, game.state); say(r.ok ? 'waiting ' + r.hours.toFixed(1) + ' h' : 'wait refused: ' + r.reason); };
  btn('wait 1 h', wait({ kind: 'hours', h: 1 }));
  btn('next peak', wait({ kind: 'nextPeak' }));
  btn('morning', wait({ kind: 'morning' }));
  const pauseB = btn('pause', () => { if (clock.mode === 'pause') clock.resume(); else clock.pause(); });
  btn('ack alert', () => clock.acknowledge(game.state));
  root.insertBefore(bar, actionsEl);
  document.body.appendChild(root);

  const doAct = (a) => () => { const r = act(a); say(a.type + (r.ok ? ' ok' : ' refused: ' + r.reason)); game.markDirty && game.markDirty(); };
  const info = (s, st, site) => {
    const f = st.market.forecast || [];
    switch (s.kind) {
      case 'board': return 'price ' + st.market.price.toFixed(0) + ' $/MWh, peak above ' + st.market.peak.toFixed(0) + ', next 6 h ' + f.slice(0, 6).map((v) => v.toFixed(0)).join(' ');
      case 'upper': return 'upper lake ' + Math.round(site.upper.V) + ' m3';
      case 'lower': return 'lower lake ' + Math.round(site.lower.V) + ' m3, excavation stage ' + site.lower.excav;
      case 'dam': return 'dam ' + (site.dam.built ? site.dam.height + ' m ' + site.dam.cls : 'not built') + (site.dam.crack ? ' CRACK' : '');
      case 'penstock': return 'penstock D ' + site.penstock.D + ' ' + site.penstock.mat + ' health ' + site.penstock.health.toFixed(0);
      case 'powerhouse': return 'mode ' + site.mode + ' q ' + (site.q || 0).toFixed(1) + ' turbine health ' + site.turbine.health.toFixed(0);
      case 'slide': return 'render-only slide, no sim action';
      case 'lookout': return 'loans ' + st.loans + ', contracts ' + st.contracts.active.length;
      default: return '';
    }
  };

  let shownId = null, tick = 0;
  function render() {
    const st = game.state; if (!st) return;
    const site = st.sites[st.active | 0], cur = ctx.player && ctx.player.station;
    const hh = String(st.hour).padStart(2, '0'), mm = String(Math.floor(st.secInHour / 60)).padStart(2, '0');
    top.textContent = '$' + Math.round(st.cash) + ' | day ' + st.day + ' ' + hh + ':' + mm + ' | time ' + clock.mode + ' x' + clock.rate +
      (clock.waiting ? ' (waiting ' + clock.waiting.kind + ')' : '') + (clock.critical.length ? ' | ALERT ' + clock.critical.join(',') : '') +
      (st.bankrupt ? ' | BANKRUPT' : '');
    pauseB.textContent = clock.mode === 'pause' ? 'resume' : 'pause';
    stationEl.textContent = 'station: ' + (cur ? cur.label + ' (' + cur.id + ')' : '(none)') + (ctx.player && ctx.player.glide ? ' | walking' : '');
    if (cur) { stationEl.textContent += ' | ' + info(cur, st, site); const gw = gridWarningText(st); if (gw) stationEl.textContent += ' | ' + gw; }
    const id = cur ? cur.id : null;
    if (id !== shownId || (tick % 8 === 0 && cur && cur.kind === 'lookout')) {
      shownId = id; actionsEl.textContent = '';
      if (cur) for (const [label, a] of stationActions(cur, st, site, ctx.Sim)) { const b = document.createElement('button'); b.textContent = label; b.onclick = doAct(Object.assign({}, a)); actionsEl.appendChild(b); }
    }
  }
  const off = bus.on('station:enter', () => { shownId = undefined; });
  return {
    root, say,
    update() { if ((tick++ & 3) === 0) render(); },
    /* for scripts: the names of the buttons currently offered */
    actionLabels() { return [...actionsEl.querySelectorAll('button')].map((b) => b.textContent); },
    stationText() { return stationEl.textContent; },
    dispose() { off(); root.remove(); }
  };
}
