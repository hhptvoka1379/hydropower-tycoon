/* DOM-free formatters for the field-station UI. Numbers use a real minus sign so a loss never reads as a profit. */
const MINUS = '−';

export function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/* money(-12300) -> "−$12,300"; money(5, {sign:true}) -> "+$5" */
export function money(v, opt) {
  v = Number(v);
  if (!Number.isFinite(v)) return '—';
  const r = Math.round(Math.abs(v));
  const s = '$' + group(r);
  if (v < 0 && r > 0) return MINUS + s;
  return opt && opt.sign && r > 0 ? '+' + s : s;
}
export function moneyCompact(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v), sg = v < 0 ? MINUS : '';
  if (a >= 1e6) return sg + '$' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return sg + '$' + Math.round(a / 1e3) + 'k';
  return sg + '$' + group(Math.round(a));
}
export function num(v, d) {
  v = Number(v);
  if (!Number.isFinite(v)) return '—';
  d = d === undefined ? 1 : d;
  const s = Math.abs(v).toFixed(d);
  return v < 0 && Number(s) !== 0 ? MINUS + s : s;
}
export function pct(v, d) { return num(v, d === undefined ? 0 : d) + '%'; }
export function mw(watts, d) { return num(watts / 1e6, d === undefined ? 2 : d) + ' MW'; }
export function hourLabel(h) { h = ((Math.floor(h) % 24) + 24) % 24; return (h < 10 ? '0' : '') + h + ':00'; }

/* Game clock text from a snapshot: "Day 12 · 14:30". Day 1 is the first day. */
export function clockText(snap) {
  if (!snap) return '';
  const min = Math.min(59, Math.floor((snap.secInHour || 0) / 60));
  const h = snap.hour | 0;
  return 'Day ' + ((snap.day | 0) + 1) + ' · ' + (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
}

/* Game hours -> "5 h 20 min", "2 d 3 h". */
export function duration(hours) {
  hours = Number(hours);
  if (!Number.isFinite(hours) || hours <= 0) return 'less than a minute';
  const totalMin = Math.round(hours * 60);
  if (totalMin < 60) return totalMin + ' min';
  if (hours < 24) { const m = totalMin % 60; return Math.floor(totalMin / 60) + ' h' + (m ? ' ' + m + ' min' : ''); }
  const d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
  return d + ' d' + (h ? ' ' + h + ' h' : '');
}
export function needMore(have, cost) { return 'Need ' + money(cost - have) + ' more'; }
export function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
/* Parse a user-typed number; '' and junk -> NaN (never silently 0). */
export function parseNum(s) { if (typeof s === 'number') return s; s = String(s == null ? '' : s).trim().replace(',', '.'); return s === '' ? NaN : Number(s); }
