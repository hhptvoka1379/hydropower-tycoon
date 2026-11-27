/* Rule editor logic, DOM-free: rule cards <-> SET_RULES payload, validation, sentences, and "which rule is firing".
   The sim stores 8 slots {on, pri, cond, val, cond2, val2, act, flow}. A card is the same shape with text fields so a blank box stays blank. */
import { parseNum } from './format.js';

export const CONDS = [
  { id: 'always', label: 'always', unit: '', needs: false },
  { id: 'price_lt', label: 'price is below', unit: '$/MWh', needs: true },
  { id: 'price_gt', label: 'price is above', unit: '$/MWh', needs: true },
  { id: 'upper_lt', label: 'upper lake is below', unit: '% full', needs: true, min: 0, max: 100 },
  { id: 'upper_gt', label: 'upper lake is above', unit: '% full', needs: true, min: 0, max: 100 },
  { id: 'lower_lt', label: 'lower lake is below', unit: '% full', needs: true, min: 0, max: 100 },
  { id: 'lower_gt', label: 'lower lake is above', unit: '% full', needs: true, min: 0, max: 100 },
  { id: 'hour_ge', label: 'hour of day is from', unit: 'h (0–24)', needs: true, min: 0, max: 24 },
  { id: 'hour_lt', label: 'hour of day is before', unit: 'h (0–24)', needs: true, min: 0, max: 24 },
  { id: 'ren_gt', label: 'solar and wind output is above', unit: 'MW', needs: true, min: 0 },
  { id: 'soc_lt', label: 'battery charge is below', unit: '% charged', needs: true, min: 0, max: 100 },
  { id: 'soc_gt', label: 'battery charge is above', unit: '% charged', needs: true, min: 0, max: 100 },
  { id: 'none', label: '(no second condition)', unit: '', needs: false }
];
export const ACTS = [
  { id: 'gen', label: 'generate', verb: 'Generate', flow: true },
  { id: 'pump', label: 'pump', verb: 'Pump', flow: true },
  { id: 'pump_local', label: 'pump from our own solar and wind only', verb: 'Pump (own power only)', flow: true },
  { id: 'idle', label: 'stay idle', verb: 'Idle', flow: false }
];
export const SLOT_COUNT = 8;
export const condById = id => CONDS.find(c => c.id === id) || CONDS[0];
export const actById = id => ACTS.find(a => a.id === id) || ACTS[3];

const s = v => (v === undefined || v === null || Number.isNaN(v)) ? '' : String(+(+v).toFixed(4));

export function rulesToCards(rules) {
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const r = (rules && rules[i]) || { on: false, pri: 1, cond: 'always', val: 0, cond2: 'none', val2: 0, act: 'idle', flow: 0 };
    out.push({ on: !!r.on, pri: String(r.pri | 0 || 1), cond: r.cond, val: condById(r.cond).needs ? s(r.val) : '', cond2: r.cond2 || 'none', val2: condById(r.cond2 || 'none').needs ? s(r.val2) : '', act: r.act, flow: actById(r.act).flow ? s(r.flow) : '' });
  }
  return out;
}

/* Validate one card -> [{field, msg}] (empty = fine). Blank required fields are errors, never 0. */
export function validateCard(c) {
  const errs = [];
  const pri = parseNum(c.pri);
  if (!Number.isInteger(pri) || pri < 1 || pri > 8) errs.push({ field: 'pri', msg: 'Priority is a whole number 1–8' });
  for (const [cf, vf, label] of [['cond', 'val', 'first'], ['cond2', 'val2', 'second']]) {
    const cd = condById(c[cf]);
    if (!cd.needs) continue;
    const v = parseNum(c[vf]);
    if (!Number.isFinite(v)) errs.push({ field: vf, msg: 'Enter a number for the ' + label + ' condition' });
    else if ((cd.min !== undefined && v < cd.min) || (cd.max !== undefined && v > cd.max)) errs.push({ field: vf, msg: 'Use ' + cd.min + '–' + (cd.max === undefined ? 'any' : cd.max) });
  }
  if (actById(c.act).flow) {
    const f = parseNum(c.flow);
    if (!Number.isFinite(f)) errs.push({ field: 'flow', msg: 'Enter a flow in m³/s' });
    else if (f < 0 || f > 20) errs.push({ field: 'flow', msg: 'Flow is 0–20 m³/s' });
  }
  return errs;
}

/* cards -> {ok, errors:[{i, field, msg}], rules} ; rules are exactly what SET_RULES expects. */
export function cardsToRules(cards) {
  const errors = [], rules = [];
  cards.forEach((c, i) => {
    const e = validateCard(c);
    for (const x of e) errors.push({ i, field: x.field, msg: x.msg });
    const cd = condById(c.cond), cd2 = condById(c.cond2), ac = actById(c.act);
    rules.push({
      on: !!c.on, pri: Math.min(8, Math.max(1, parseNum(c.pri) | 0 || 1)),
      cond: c.cond, val: cd.needs ? (parseNum(c.val) || 0) : 0,
      cond2: c.cond2 || 'none', val2: cd2.needs ? (parseNum(c.val2) || 0) : 0,
      act: c.act, flow: ac.flow ? (parseNum(c.flow) || 0) : 0
    });
  });
  return { ok: errors.length === 0 && cards.length === SLOT_COUNT, errors, rules };
}
export function rulesPayload(cards, enabled) {
  const r = cardsToRules(cards);
  if (!r.ok) return null;
  const a = { type: 'SET_RULES', rules: r.rules };
  if (enabled !== undefined) a.enabled = !!enabled;
  return a;
}
const sig = rules => JSON.stringify(cardsToRules(rulesToCards(rules)).rules);
export function rulesEqual(a, b) { return sig(a) === sig(b); }
export function cardsEqualRules(cards, rules) { return JSON.stringify(cardsToRules(cards).rules) === sig(rules); }

/* "Pump when price is below 35 $/MWh and upper lake is below 95 % full, at 2.5 m³/s." */
export function describeRule(c) {
  const cd = condById(c.cond), cd2 = condById(c.cond2), ac = actById(c.act);
  const part = (d, v) => d.id === 'always' ? '' : d.label + (d.needs ? ' ' + (v === '' ? '___' : v) + ' ' + d.unit : '');
  let when = cd.id === 'always' ? 'Always' : 'When ' + part(cd, c.val);
  if (cd2.id !== 'none' && cd2.id !== 'always') when += ' and ' + part(cd2, c.val2);
  const tail = ac.flow ? ', ' + ac.label + ' at ' + (c.flow === '' ? '___' : c.flow) + ' m³/s' : ', ' + ac.label;
  return when + tail + '.';
}

function condOK(snap, site, id, v, Sim) {
  switch (id) {
    case 'none': case 'always': return true;
    case 'price_lt': return snap.market.price < v;
    case 'price_gt': return snap.market.price > v;
    case 'upper_lt': return Sim.upPct(site) < v;
    case 'upper_gt': return Sim.upPct(site) > v;
    case 'lower_lt': return Sim.loPct(site) < v;
    case 'lower_gt': return Sim.loPct(site) > v;
    case 'hour_ge': return snap.hour >= v;
    case 'hour_lt': return snap.hour < v;
    case 'ren_gt': return site.tel.pRen / 1e6 > v;
    case 'soc_lt': return Sim.socAvg(site) * 100 < v;
    case 'soc_gt': return Sim.socAvg(site) * 100 > v;
  }
  return false;
}
/* Index of the rule that wins right now (highest priority, first on a tie), or -1. Mirrors sim/rules.js evalRules; a test compares the two. */
export function firingIndex(snap, site, Sim) {
  let best = -1, bp = -1;
  const rules = site.auto.rules;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!r.on) continue;
    if (condOK(snap, site, r.cond, r.val, Sim) && condOK(snap, site, r.cond2, r.val2, Sim) && r.pri > bp) { best = i; bp = r.pri; }
  }
  return best;
}
