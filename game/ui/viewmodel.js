/* View-models: pure functions of (snapshot, Sim) -> plain data the cards paint. No DOM here, so Node tests cover them.
   Every "why can't I" string comes from here, so a disabled button always has a reason next to it. */
import { money, num, pct, hourLabel, needMore, duration, clamp } from './format.js';
import { firingIndex } from './rules-logic.js';

export const LIGHT_WEAR_HEALTH = 90; // repair is a flat fee in the sim; below this much wear it is not offered

export const activeSite = snap => (snap && snap.sites && (snap.sites[snap.active] || snap.sites[0])) || null;
const canPay = (snap, cost) => snap.demo || snap.cash >= cost;

export function jobFor(snap, siteId, kind, pred) {
  const j = (snap.jobs || []).find(x => x.site === siteId && x.kind === kind && (!pred || pred(x)));
  if (!j) return null;
  return { id: j.id, rem: j.rem, total: j.total, progress: clamp(1 - j.rem / Math.max(1, j.total), 0, 1), etaHours: j.rem / 3600 };
}
export function jobText(j) { return j ? Math.round(j.progress * 100) + '% done, about ' + duration(j.etaHours) + ' of game time left' : ''; }

/* ---- plant ---- */
export function idleReason(snap, s, Sim) {
  const C = Sim.CONFIG;
  if (!snap.started) return 'The game has not started yet.';
  if (!s.dam.built) return 'No dam yet. Walk to the dam crest to place one.';
  if (s.penstock.busy) return 'The penstock is being replaced.';
  const hU = s.tel ? s.tel.hU : 0, hL = s.tel ? s.tel.hL : 0;
  if (s.q > 0 || s.q < 0) return '';
  const mode = s.mode;
  if (mode === 'gen') {
    if (s.turbine.busy) return 'The turbine is being worked on.';
    if (s.turbine.health <= 0) return 'The turbine is worn out. Repair it.';
    if (hU <= C.res.minOpU) return 'The upper lake is too low to generate (' + num(hU) + ' m, needs ' + C.res.minOpU + ' m).';
    return 'Starting up.';
  }
  if (mode === 'pump') {
    if (s.pump.busy) return 'The pump is being worked on.';
    if (s.pump.health <= 0) return 'The pump is worn out. Repair it.';
    if (hL <= C.res.minOpL) return 'The lower lake is too low to pump from.';
    if (s.upper.V >= Sim.capU(s)) return 'The upper lake is full.';
    return 'Starting up.';
  }
  if (snap.god && snap.god.enabled && snap.god.dispatch) return 'Assisted mode is holding the plant idle for now.';
  if (s.auto && s.auto.enabled) {
    const n = s.auto.rules.filter(r => r.on).length;
    return n === 0 ? 'Automation is on but no rule is switched on.' : 'Automation is waiting: no rule matches right now (price ' + money(snap.market.price) + ' per MWh).';
  }
  return 'You set the plant to idle and automation is off.';
}

export function plantStatus(snap, s, Sim) {
  const tel = s.tel || {}, q = s.q || 0;
  const state = q > 0 ? 'gen' : q < 0 ? 'pump' : 'idle';
  const reason = idleReason(snap, s, Sim);
  const godOn = !!(snap.god && snap.god.enabled && snap.god.dispatch);
  const autoOn = !!(s.auto && s.auto.enabled);
  const label = state === 'gen' ? 'Generating' : state === 'pump' ? 'Pumping' : 'Idle';
  const watts = state === 'gen' ? tel.pGen : state === 'pump' ? tel.pPump : 0;
  const T = Sim.CONFIG.turbine[s.turbine.tier], P = Sim.CONFIG.pump[s.pump.tier];
  return {
    state, label, reason, watts, flow: Math.abs(q), head: tel.Hg || 0, netHead: tel.Hn || 0, upPct: Sim.upPct(s), loPct: Sim.loPct(s),
    autoOn, godOn, flowLocked: autoOn || godOn,
    flowLockReason: godOn ? 'Assisted mode sets the flow. Turn it off to set the flow by hand.' : autoOn ? 'Automation sets the flow. Turn it off to set the flow by hand.' : '',
    flowMax: Math.round(Math.max(T.Qr, P.Qr) * 1.1 * 10) / 10,
    turbineRange: [T.Qr * Sim.CONFIG.eff.xMinT, T.Qr * Sim.CONFIG.eff.xMaxT], pumpRange: [P.Qr * Sim.CONFIG.eff.xMinP, P.Qr * Sim.CONFIG.eff.xMaxP],
    needsDam: !s.dam.built, modeRequested: s.mode, firing: autoOn ? firingIndex(snap, s, Sim) : -1,
    sceneNote: s.call ? 'Reserve call in progress: deliver +' + num(s.call.mw) + ' MW' : ''
  };
}

export function modeOption(snap, s, mode) {
  if (mode !== 'idle' && !s.dam.built) return { enabled: false, reason: 'No dam at this site yet' };
  if (mode === 'gen' && s.turbine.busy) return { enabled: false, reason: 'The turbine is busy with a job' };
  if (mode === 'pump' && s.pump.busy) return { enabled: false, reason: 'The pump is busy with a job' };
  return { enabled: true, reason: '' };
}

export function tierOptions(snap, s, unit, Sim) {
  const list = Sim.CONFIG[unit], u = s[unit];
  return list.map((t, i) => {
    let reason = '';
    if (u.busy) reason = 'Busy with a job';
    else if (i === u.tier) reason = u.health > 99 ? 'Installed' : 'Repair is cheaper than replacing';
    else if (i < u.tier) reason = 'Downgrades are not offered';
    else if (!canPay(snap, t.cost)) reason = needMore(snap.cash, t.cost);
    return { tier: i, name: t.name, cost: t.cost, Qr: t.Qr, eta: t.eta, current: i === u.tier, enabled: !reason, reason };
  });
}
export function repairOption(snap, s, unit, Sim) {
  const u = s[unit], C = Sim.CONFIG;
  const cost = C[unit][u.tier].cost * C.jobs.repairFrac;
  let reason = '';
  if (u.busy) reason = 'Busy with a job';
  else if (u.health >= 99.9) reason = 'No wear to repair';
  else if (u.health >= LIGHT_WEAR_HEALTH) reason = 'Only ' + num(100 - u.health, 0) + '% worn; repair is a flat fee, so wait for more wear';
  else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason, health: u.health };
}
export function reserveModel(snap, s, Sim) {
  const cap = Sim.reserveCap(s) / 1e6;
  return { cap, offer: s.reserveOffer || 0, hint: (s.reserveOffer || 0) === 0 && cap > 0.01 ? 'Offer up to ' + num(cap, 2) + ' MW of standby power: you are paid every hour for being ready.' : '', capReason: cap <= 0 ? 'No deliverable reserve right now (needs a built dam and an idle, healthy turbine).' : '' };
}
export function offerCheck(cap, text) {
  const v = Number(String(text).replace(',', '.'));
  if (String(text).trim() === '' || !Number.isFinite(v) || v < 0) return { enabled: false, reason: 'Enter a number of MW (0 or more)' };
  if (v > cap + 1e-9) return { enabled: false, reason: 'More than the ' + num(cap, 2) + ' MW the plant can deliver in time' };
  return { enabled: true, reason: '' };
}
export const hasSolar = s => s.tiles.some(t => t.solar);

/* ---- dam ---- */
export function damRaise(snap, s, meters, Sim) {
  const d = s.dam, C = Sim.CONFIG;
  const m = Math.max(1, Math.floor(meters || 1)), to = d.height + m;
  const cls = Sim.clsFor(Math.max(to, d.height));
  const cost = Sim.damCost(cls, d.height, to, Sim.crestLen(s, to));
  const storageNow = Sim.storageMWh(s, d.height), storageAfter = Sim.storageMWh(s, to);
  const maxH = Sim.maxClassH(snap);
  let reason = '', need = null;
  if (!d.built) reason = 'There is no dam to raise';
  else if (d.raising) reason = 'A raise is already in progress';
  else if (to > s.maxDam) reason = 'The valley rim limits this site to ' + s.maxDam + ' m';
  else if (to > maxH) {
    need = (cls === 'arch' && !snap.permits.gravity) ? 'gravity' : cls;
    reason = 'A ' + to + ' m dam needs the ' + C.dam.classes[need].name + ' permit (' + money(C.dam.classes[need].permit) + ')';
  } else if (d.crack) reason = 'Repair the crack before raising';
  else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { m, to, cls, className: C.dam.classes[cls].name, cost, hours: C.dam.hoursPerM * m, storageNow, storageAfter, gain: storageAfter - storageNow, enabled: !reason, reason, needPermit: need, permitCost: need ? C.dam.classes[need].permit : 0, maxRaise: Math.max(0, Math.min(s.maxDam, 70) - d.height) };
}
export function damRepair(snap, s, Sim) {
  const d = s.dam, cost = d.value * Sim.CONFIG.dam.repairFrac;
  let reason = '';
  if (!d.crack) reason = 'No crack to repair';
  else if (d.repairing) reason = 'Repair under way';
  else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason };
}
export function damPlace(snap, si, height, Sim) {
  const q = Sim.damQuote(snap, si, undefined, height);
  const C = Sim.CONFIG;
  let reason = '', need = null;
  if (!q.ok) { reason = q.reason; if (q.needPermit) need = (q.needPermit === 'arch' && !snap.permits.gravity) ? 'gravity' : q.needPermit; }
  else if (!canPay(snap, q.cost)) reason = needMore(snap.cash, q.cost);
  return { q, enabled: !reason, reason, needPermit: need, permitCost: need ? C.dam.classes[need].permit : 0 };
}
export function permitOption(snap, cls, Sim) {
  const cost = Sim.CONFIG.dam.classes[cls].permit;
  let reason = '';
  if (snap.permits[cls]) reason = 'Already permitted';
  else if (cls === 'arch' && !snap.permits.gravity) reason = 'Gravity permit first';
  else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason };
}
export function crackInfo(s, Sim) {
  const d = s.dam; if (!d.crack) return null;
  const hU = s.tel.hU;
  return { elev: d.crack.elev, damage: d.crack.damage, level: hU, over: hU > d.crack.elev, text: 'Crack in the wall above ' + num(d.crack.elev) + ' m. Keep the lake below that until it is repaired (now ' + num(hU) + ' m); capacity is cut meanwhile.' };
}

/* ---- penstock, lakes ---- */
export function penstockCost(s, D, mat, Sim) { return Sim.CONFIG.penstock.materials[mat].cost * s.penstock.L * D + Sim.CONFIG.penstock.mobilisation; }
export function penstockOption(snap, s, D, mat, Sim) {
  const C = Sim.CONFIG.penstock;
  if (!C.materials[mat]) return { enabled: false, reason: 'Pick a material', cost: 0 };
  if (!(D >= C.Dmin && D <= C.Dmax)) return { enabled: false, reason: 'Diameter must be ' + C.Dmin + '–' + C.Dmax + ' m', cost: 0 };
  const cost = penstockCost(s, D, mat, Sim);
  let reason = '';
  if (s.penstock.busy) reason = 'Penstock work is already under way';
  else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason, hours: C.replaceHours };
}
export function lakeInfo(s, which, Sim) {
  const r = s[which], h = Sim.resLevel(r, r.V);
  const cap = which === 'upper' ? Sim.capU(s) : Sim.capL(s);
  return { level: h, volume: r.V, cap, pct: cap > 0 ? 100 * r.V / cap : 0, inflow: s.riverIn || 0, spill: which === 'upper' ? s.spillU || 0 : s.spillL || 0, ice: s.ice > 0.5, snow: s.snowpack || 0, built: which === 'lower' || s.dam.built };
}
export function excavateOption(snap, s, Sim) {
  const C = Sim.CONFIG.res;
  const cost = C.excavCost * (1 + 0.5 * s.lower.excav);
  let reason = '';
  if (s.lower.excav >= C.excavStages) reason = 'All excavation stages are done';
  else if ((snap.jobs || []).some(j => j.site === s.id && j.kind === 'excavate')) reason = 'Excavation is already under way';
  else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason, stage: s.lower.excav, stages: C.excavStages, hours: C.excavHours };
}

/* ---- parcels and tiles ---- */
export const tileRC = i => { const p = Math.floor(i / 16), k = i - p * 16, r = Math.floor(k / 4); return { p, r, c: k - r * 4, k }; };
export function parcelOption(snap, s, p, Sim) {
  const cost = Sim.CONFIG.land.parcelCost[p];
  let reason = '';
  if (s.parcels[p]) reason = 'Already owned';
  else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { owned: !!s.parcels[p], cost, enabled: !reason, reason };
}
export function tileContents(t) {
  const out = [];
  if (t.solar) out.push(t.solar.building ? 'solar (building)' : 'solar');
  if (t.wind) out.push(t.wind.building ? 'wind (building)' : t.wind.damaged ? 'wind (damaged)' : 'wind');
  if (t.battery) out.push(t.battery.building ? 'battery (building)' : 'battery');
  return out;
}
export const tileGlyph = t => t.battery ? 'B' : (t.solar && t.wind) ? 'S+W' : t.solar ? 'S' : t.wind ? 'W' : '·';
export const KIND_NAME = { solar: 'Solar array', wind: 'Wind turbine', battery: 'Battery' };

export function buildOption(snap, si, tile, kind, tier, Sim) {
  const s = snap.sites[si], t = s.tiles[tile], p = tileRC(tile).p;
  let reason = '';
  if (!s.parcels[p]) reason = 'Parcel ' + (p + 1) + ' is not owned yet';
  else if (kind === 'battery') { if (t.battery) reason = 'This tile already has a battery'; else if (t.wind) reason = 'Batteries cannot share a tile with a wind turbine'; }
  else if (kind === 'solar') { if (t.solar) reason = 'This tile already has solar'; else if (t.battery) reason = 'A battery occupies this tile, so solar cannot go here'; }
  else if (kind === 'wind') { if (t.wind) reason = 'This tile already has a wind turbine'; else if (t.battery) reason = 'A battery occupies this tile, so wind cannot go here'; }
  let quote = null;
  if (!reason) {
    quote = Sim.quote(snap, si, tile, kind, tier);
    if (!quote.ok) reason = quote.reason; else if (!canPay(snap, quote.cost)) reason = needMore(snap.cash, quote.cost);
  }
  return { enabled: !reason, reason, quote: quote && quote.ok ? quote : null };
}
export function quoteLines(q) {
  if (!q) return null;
  const pb = q.payback;
  return {
    cost: money(q.cost), npv: (q.npv >= 0 ? 'Gain ' : 'Loss ') + money(Math.abs(q.npv)) + ' over 20 years',
    npvGain: q.npv >= 0, annual: money(q.annual, { sign: true }) + ' a year',
    payback: Number.isFinite(pb) ? 'pays back in ' + num(pb, 1) + ' years' : 'never pays back', daily: num(q.dayMWh, 1) + ' MWh per day'
  };
}
export function cleanOption(snap, so, Sim) {
  const S = Sim.CONFIG.solar, cost = S.cleanBase + S.cleanKW * S.tiers[so.tier].kWp;
  let reason = '';
  if (so.soil < 0.001) reason = 'Already clean'; else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason };
}
export function windRepair(snap, s, tile, Sim) {
  const w = s.tiles[tile].wind, W = Sim.CONFIG.wind, tr = W.tiers[w.tier], cost = tr.kW * tr.costKW * W.repairFrac;
  let reason = '';
  if (!w.damaged) reason = 'Not damaged'; else if (w.repairing) reason = 'Repair under way'; else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason };
}
export function batteryRefurb(snap, s, tile, Sim) {
  const b = s.tiles[tile].battery, B = Sim.CONFIG.battery, cost = B.tiers[b.tier].cost * B.refurbFrac;
  let reason = '';
  if (b.fade < 0.001) reason = 'No fade to refurbish'; else if (!canPay(snap, cost)) reason = needMore(snap.cash, cost);
  return { cost, enabled: !reason, reason };
}

/* ---- forecast ---- */
export function forecastModel(snap, Sim) {
  const fc = (snap.market && snap.market.forecast) || [];
  const peak = snap.market.peak, cheap = snap.market.cheap;
  const hours = fc.map((p, k) => ({ k, hour: (snap.hour + k) % 24, price: p, peak: p >= peak, cheap: p <= cheap }));
  let max = -Infinity, min = Infinity, iMax = 0, iMin = 0, nextPeak = -1, nextCheap = -1;
  hours.forEach(h => { if (h.price > max) { max = h.price; iMax = h.k; } if (h.price < min) { min = h.price; iMin = h.k; } if (nextPeak < 0 && h.peak) nextPeak = h.k; if (nextCheap < 0 && h.cheap) nextCheap = h.k; });
  const em = snap.market.emergency;
  let emergency = null;
  if (em && em.day === snap.day && snap.hour < em.start + em.dur) {
    const active = snap.hour >= em.start;
    emergency = { active, text: active ? 'Grid emergency now until ' + hourLabel(em.start + em.dur) + ': prices and reserve pay are high.' : 'Grid emergency expected from ' + hourLabel(em.start) + ' to ' + hourLabel(em.start + em.dur) + ': prices and reserve pay will be high.' };
  }
  const cl = snap.climate || {};
  let sky = !cl.cloud && cl.cloud !== 0 ? '' : cl.cloud < 0.25 ? 'Clear' : cl.cloud < 0.6 ? 'Partly cloudy' : 'Overcast';
  if (cl.rain > 0) sky = (cl.T < 0.5 ? 'Snow' : 'Rain');
  if (cl.storm) sky = 'Storm';
  let windMax = 0, windAt = 0, storm = false, cloudSum = 0;
  for (let k = 0; k < 24; k++) { const c = Sim.climateAt(snap.seed, snap.H + k); if (c.wind > windMax) { windMax = c.wind; windAt = (snap.hour + k) % 24; } if (c.storm) storm = true; cloudSum += c.cloud; }
  const rangeText = h => hourLabel(h.hour);
  const summary = fc.length ? 'Now ' + money(snap.market.price) + ' per MWh. Cheapest ' + rangeText(hours[iMin]) + ' (' + money(min) + '). Dearest ' + rangeText(hours[iMax]) + ' (' + money(max) + ').' : 'No forecast yet.';
  return {
    hours, min, max, peak, cheap, summary, emergency, nextPeak, nextCheap, now: snap.market.price,
    weather: { sky, temp: cl.T, wind: cl.wind, rain: cl.rain, storm: !!cl.storm, windMax, windAt, stormAhead: storm, cloudAvg: cloudSum / 24,
      text: (sky ? sky + ', ' : '') + num(cl.T, 1) + ' °C, wind ' + num(cl.wind, 1) + ' m/s.', outlook: 'Next 24 h: wind up to ' + num(windMax, 1) + ' m/s around ' + hourLabel(windAt) + (storm ? '; a storm is expected.' : '; no storm expected.') }
  };
}
export function chartAlt(model) {
  if (!model.hours.length) return 'No forecast available.';
  return 'Price forecast for the next 24 hours, in dollars per megawatt-hour. ' + model.hours.map(h => hourLabel(h.hour) + ' ' + Math.round(h.price) + (h.peak ? ' peak' : h.cheap ? ' cheap' : '')).join(', ') + '.';
}

/* ---- finance, quests, sites ---- */
export function financeModel(snap, Sim) {
  const C = Sim.CONFIG.fin, f = snap.fin || {};
  const god = !!(snap.god && snap.god.enabled);
  const hist = (f.dayHist || []).slice(-14);
  return {
    cash: snap.cash, loans: snap.loans, credit: Math.max(0, C.maxLoan - snap.loans), maxLoan: C.maxLoan, rate: C.loanRate, interestYear: snap.loans * C.loanRate,
    netWorth: Sim.netWorth(snap), today: f.profitToday || 0, yesterday: f.profitYesterday || 0, lifetime: f.lifetime || 0,
    subsidy: f.subsidy || 0, showSubsidy: god || (f.subsidy || 0) > 0, god, hist
  };
}
export function loanOption(snap, amount, Sim) {
  const C = Sim.CONFIG.fin;
  if (!(amount > 0)) return { enabled: false, reason: 'Enter an amount above 0' };
  if (snap.loans + amount > C.maxLoan) return { enabled: false, reason: 'Credit limit is ' + money(C.maxLoan) + ' (' + money(Math.max(0, C.maxLoan - snap.loans)) + ' left)' };
  return { enabled: true, reason: '' };
}
export function repayOption(snap, amount) {
  if (snap.loans <= 0) return { enabled: false, reason: 'No loan to repay' };
  if (!(amount > 0)) return { enabled: false, reason: 'Enter an amount above 0' };
  const a = Math.min(amount, snap.loans);
  if (!snap.demo && snap.cash < a) return { enabled: false, reason: needMore(snap.cash, a) };
  return { enabled: true, reason: '' };
}
export function questsModel(snap, QUESTS) {
  let nextSet = false, claimable = 0, claimed = 0;
  const list = QUESTS.map(q => {
    const r = snap.quests[q.id] || {};
    const state = r.claimed ? 'claimed' : r.done ? 'done' : 'todo';
    if (state === 'done') claimable++; if (state === 'claimed') claimed++;
    const next = state === 'todo' && !nextSet; if (next) nextSet = true;
    return { id: q.id, title: q.title, desc: q.desc, reward: q.reward, state, next };
  });
  return { list, claimable, claimed, total: QUESTS.length, reward: list.filter(q => q.state === 'done').reduce((a, q) => a + q.reward, 0) };
}
export function siteChoices(snap, Sim) {
  const C = Sim.CONFIG;
  const owned = snap.sites.map((s, i) => ({ i, name: s.name, kind: s.kind, active: i === snap.active, dam: s.dam.built }));
  const shop = (snap.shop || []).map((sh, i) => {
    const info = C.shop[i]; let permit = '', buy = '';
    if (sh.bought) return { i, name: info.name, bought: true };
    if (!sh.permit && !snap.demo) { permit = canPay(snap, info.permit) ? '' : needMore(snap.cash, info.permit); }
    if (!sh.permit && !snap.demo) buy = 'Buy the water-rights permit first';
    else if (!canPay(snap, info.cost)) buy = needMore(snap.cash, info.cost);
    return { i, name: info.name, bought: false, permitted: sh.permit, permitCost: info.permit, cost: info.cost, permitReason: sh.permit ? 'Already permitted' : permit, buyReason: buy };
  });
  return { owned, shop };
}

/* ---- hints ---- */
export function hintModel(snap, Sim) {
  const s = activeSite(snap);
  if (!snap || !s || !snap.started || snap.bankrupt) return null;
  const st = plantStatus(snap, s, Sim);
  if (!s.dam.built) return { key: 'nodam', text: st.reason, action: null };
  if (!st.autoOn && !st.godOn) {
    if (st.state === 'idle') return { key: 'off-idle', text: 'Automation is off and the plant is idle, so it earns nothing. ' + st.reason, action: 'enableAuto' };
    return { key: 'off', text: 'Automation is off: the plant only runs the way you last set it.', action: 'enableAuto' };
  }
  if (st.state === 'idle' && st.reason) return { key: 'idle:' + st.reason, text: st.reason, action: null };
  return null;
}

/* ---- remote summary rows ---- */
export function summaryRows(snap, Sim) {
  const s = activeSite(snap); if (!s) return [];
  const st = plantStatus(snap, s, Sim), f = financeModel(snap, Sim);
  const rows = [
    ['Plant', st.label + (st.state === 'idle' ? '' : ' at ' + num(st.flow, 1) + ' m³/s, ' + num(st.watts / 1e6, 2) + ' MW')],
    ['Why', st.reason || (st.state === 'gen' ? 'Selling power to the grid.' : 'Moving water uphill.')],
    ['Automation', st.godOn ? 'Assisted mode is dispatching' : st.autoOn ? 'On' : 'Off'],
    ['Upper lake', pct(st.upPct) + ' full'], ['Lower lake', pct(st.loPct) + ' full'],
    ['Head', num(st.head, 1) + ' m'], ['Price now', money(snap.market.price) + ' per MWh'],
    ['Solar and wind', num((s.tel.pRen || 0) / 1e6, 2) + ' MW'], ['Reserve offered', num(s.reserveOffer || 0, 2) + ' MW'],
    ['Cash', money(f.cash)], ['Loans', money(f.loans)], ['Today', money(f.today, { sign: true })]
  ];
  if (f.showSubsidy) rows.push(['Subsidy (assisted mode)', money(f.subsidy)]);
  return rows;
}

/* ---- stations ---- */
export const STATION_KINDS = ['powerhouse', 'forecast', 'dam', 'penstock', 'upper', 'lower', 'parcel', 'slide', 'lookout'];
/* Accepts the ids the player module is likely to use. Returns {kind, parcel?} or null. */
export function parseStationId(id) {
  const s = String(id || '').toLowerCase().trim();
  if (!s) return null;
  let m = s.match(/^(?:parcel|desk|tiles?)[-_: ]*([0-2])$/);
  if (m) return { kind: 'parcel', parcel: +m[1] };
  if (/^(?:parcel|desk)/.test(s)) return { kind: 'parcel', parcel: 0 };
  if (/forecast|board/.test(s)) return { kind: 'forecast' };
  if (/power|house|plant/.test(s)) return { kind: 'powerhouse' };
  if (/dam|crest/.test(s)) return { kind: 'dam' };
  if (/pen/.test(s)) return { kind: 'penstock' };
  if (/upper|^up/.test(s)) return { kind: 'upper' };
  if (/lower|^lo[-_ ]|^lo$|tail/.test(s)) return { kind: 'lower' };
  if (/slide/.test(s)) return { kind: 'slide' };
  if (/look|rim|office|bank|desk/.test(s)) return { kind: 'lookout' };
  return null;
}
