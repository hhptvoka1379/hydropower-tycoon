/* Tiny DOM helpers. Rule for the whole UI: build a card once, then change text/attributes/values in place.
   Nothing in here ever replaces the children of a container that holds buttons or inputs on a timer. */
const SVGNS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const ev in v) el.addEventListener(ev, v[ev]);
    else if (k === 'attrs') for (const a in v) { if (v[a] !== undefined && v[a] !== null) el.setAttribute(a, v[a]); }
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'type' || k === 'min' || k === 'max' || k === 'step' || k === 'id') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
}

/* ---- in-place setters: write only when the value changed ---- */
export function setText(el, v) { v = v === undefined || v === null ? '' : String(v); if (el._t !== v) { el._t = v; el.textContent = v; } }
export function setAttr(el, k, v) { v = String(v); if (el._a === undefined) el._a = {}; if (el._a[k] !== v) { el._a[k] = v; el.setAttribute(k, v); } }
export function setHidden(el, hide) { hide = !!hide; if (el.hidden !== hide) el.hidden = hide; }
export function setCls(el, name, on) { on = !!on; if (!!(el._c && el._c[name]) !== on) { if (!el._c) el._c = {}; el._c[name] = on; el.classList.toggle(name, on); } }
export function isFocused(el) { return typeof document !== 'undefined' && document.activeElement === el; }
/* Never overwrite a field the user is typing in or dragging. */
export function setValue(input, v) {
  v = String(v);
  if (input._dragging || isFocused(input)) return;
  if (input.value !== v) input.value = v;
}
export function setChecked(input, on) { on = !!on; if (input.checked !== on) input.checked = on; }
/* Disable with a visible reason. If the button had focus, park focus on a fallback so keyboard users are not dropped to <body>. */
export function setEnabled(btn, enabled, reasonEl, reason, fallback) {
  enabled = !!enabled;
  if (!enabled && !btn.disabled && isFocused(btn) && fallback && fallback.focus) fallback.focus();
  if (btn.disabled === enabled) btn.disabled = !enabled;
  if (reasonEl) { setText(reasonEl, enabled ? '' : reason || ''); setHidden(reasonEl, enabled || !reason); }
}
export function button(label, onClick, opt) {
  opt = opt || {};
  return h('button', { type: 'button', class: 'btn' + (opt.kind ? ' btn-' + opt.kind : ''), on: { click: onClick }, attrs: opt.attrs }, label);
}
/* Range input that keeps a live label while dragging and only commits on release/change (no save-log spam). */
export function trackDrag(input) {
  const on = () => { input._dragging = true; };
  const off = () => { input._dragging = false; };
  input.addEventListener('pointerdown', on); input.addEventListener('pointerup', off); input.addEventListener('pointercancel', off);
  input.addEventListener('keydown', on); input.addEventListener('keyup', off); input.addEventListener('blur', off); input.addEventListener('change', off);
}

/* A labelled field: <label>text <input></label>. Returns {wrap, input}. */
export function field(labelText, input, hint) {
  const id = 'f' + (field.n = (field.n || 0) + 1);
  input.id = id;
  return { wrap: h('div', { class: 'field' }, h('label', { for: id, text: labelText }), input, hint ? h('span', { class: 'hint', text: hint }) : null), input };
}
export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function focusables(root) { return Array.from(root.querySelectorAll(FOCUSABLE)).filter(e => !e.hidden && e.getAttribute('aria-hidden') !== 'true' && !e.closest('[hidden]')); }
export function trapTab(root, e) {
  if (e.key !== 'Tab') return;
  const f = focusables(root);
  if (!f.length) { e.preventDefault(); root.focus(); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (e.shiftKey && (a === first || a === root)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  else if (!root.contains(a)) { e.preventDefault(); first.focus(); }
}
