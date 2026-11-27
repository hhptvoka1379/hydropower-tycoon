/* Card chrome shared by every station card: header, collapse, close, collapsible sections, "wait" row, gated action rows. */
import { h, setText, setHidden, setEnabled, setAttr, button } from './dom.js';

export function makeCard(env, { id, title, sub }) {
  const titleEl = h('h2', { class: 'card-title', id: 'ct-' + id, text: title });
  const subEl = h('span', { class: 'card-sub', text: sub || '' });
  const body = h('div', { class: 'card-body' });
  const collapse = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Collapse card', 'aria-expanded': 'true', on: { click: () => api.toggle() } }, h('span', { 'aria-hidden': 'true', text: '▾' }));
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close card', on: { click: () => api.close() } }, h('span', { 'aria-hidden': 'true', text: '✕' }));
  const el = h('section', { class: 'card', id: 'card-' + id, tabindex: '-1', 'aria-labelledby': 'ct-' + id },
    h('header', { class: 'card-head' }, h('div', { class: 'card-titles' }, titleEl, subEl), h('div', { class: 'card-tools' }, collapse, close)), body);
  const api = {
    el, body, id, visible: false, collapsed: false, dismissed: false,
    setTitle: t => setText(titleEl, t), setSub: t => setText(subEl, t),
    toggle() { api.collapsed = !api.collapsed; body.hidden = api.collapsed; collapse.setAttribute('aria-expanded', String(!api.collapsed)); collapse.setAttribute('aria-label', api.collapsed ? 'Expand card' : 'Collapse card'); },
    close() { api.dismissed = true; api.hide(); if (env.onCardClosed) env.onCardClosed(api); },
    show() { api.visible = true; el.hidden = false; },
    hide() { api.visible = false; el.hidden = true; },
    onShow: null
  };
  el.hidden = true;
  return api;
}

/* <details class="sect"> with a summary and an optional count badge. */
export function section(title, opt) {
  opt = opt || {};
  const badge = h('span', { class: 'sect-badge', hidden: true });
  const inner = h('div', { class: 'sect-body' });
  const el = h('details', { class: 'sect' }, h('summary', {}, h('span', { class: 'sect-title', text: title }), badge), inner);
  if (opt.open) el.open = true;
  return { el, body: inner, badge, setBadge(t) { setText(badge, t); setHidden(badge, !t); } };
}

/* A gated action: button + visible reason line (aria-describedby). set(enabled, reason, label?) writes in place. */
export function gated(label, onClick, opt) {
  opt = opt || {};
  const reason = h('p', { class: 'reason', hidden: true, role: 'note' });
  const btn = h('button', { type: 'button', class: 'btn' + (opt.kind ? ' btn-' + opt.kind : ''), on: { click: onClick } }, label);
  reason.id = 'r' + (gated.n = (gated.n || 0) + 1);
  btn.setAttribute('aria-describedby', reason.id);
  return {
    btn, reason, el: h('div', { class: 'gate' }, btn, reason),
    set(enabled, why, newLabel, fallback) { if (newLabel !== undefined) setText(btn, newLabel); setEnabled(btn, enabled, reason, why, fallback); }
  };
}

/* Progress meter with a text twin: <progress> plus "40% done, about 3 h left". */
export function meter(labelText) {
  const bar = h('progress', { max: '100', value: '0', 'aria-label': labelText || 'Progress' });
  const text = h('span', { class: 'meter-text' });
  const el = h('div', { class: 'meter', hidden: true }, bar, text);
  return { el, set(j, txt) { setHidden(el, !j); if (j) { const v = String(Math.round(j.progress * 100)); if (bar.value !== v) bar.value = v; setText(text, txt); } } };
}

/* Key/value line with a mono value, updated in place. */
export function kv(label) {
  const v = h('span', { class: 'num' });
  const el = h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: label }), v);
  return { el, set: t => setText(v, t) };
}

/* The "wait" row every card carries: 1 h / until next peak / until morning (+ optional "until this job is done"). */
export function waitRow(env, opt) {
  opt = opt || {};
  const reason = h('p', { class: 'reason', hidden: true });
  const status = h('p', { class: 'wait-status', hidden: true, role: 'status' });
  const mk = (label, spec) => h('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => env.requestWait(typeof spec === 'function' ? spec() : spec) } }, label);
  const jobBtn = mk('Until the job finishes', () => ({ kind: 'hours', h: Math.max(0.1, Math.ceil(jobH * 10) / 10) }));
  let jobH = 0;
  setHidden(jobBtn, true);
  const btns = [mk('Wait 1 hour', { kind: 'hours', h: 1 }), mk('Until next peak', { kind: 'nextPeak' }), mk('Until morning', { kind: 'morning' }), jobBtn];
  const el = h('div', { class: 'wait' }, h('p', { class: 'label', text: 'Wait here' }), h('div', { class: 'btn-row' }, btns), status, reason);
  return {
    el,
    update(snap, jobHours) {
      const can = env.canWait();
      const why = !can ? 'Time control is not available here.' : snap.paused ? 'The game is paused. Resume to wait.' : env.waiting() ? 'Already waiting.' : '';
      for (const b of btns) setEnabled(b, !why, null, '', el);
      setText(reason, why); setHidden(reason, !why);
      jobH = jobHours || 0;
      setHidden(jobBtn, !(jobHours > 0));
      setText(status, env.waiting() ? 'Waiting… time is running faster until the wait ends.' : ''); setHidden(status, !env.waiting());
    }
  };
}
export const p = (text, cls) => h('p', { class: cls || '', text });
