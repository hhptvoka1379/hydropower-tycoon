// SelfTest audit hook SKELETON (§11.6, §0.9). Real tests are added by the Tests agent.

// FNV-1a over canonical JSON (keys sorted, numbers with 12 significant digits) (§11.5).
export function canonicalJSON(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toPrecision(12))) : 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}';
}
export function fnv1a(str) {
  let h = 0x811C9DC5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export function hashState(state) { return fnv1a(canonicalJSON(state)); }

export function countNonFinite(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? 0 : 1;
  if (!v || typeof v !== 'object') return 0;
  let n = 0;
  for (const k in v) n += countNonFinite(v[k]);
  return n;
}

// tests: [{id, name, run: () => ({expected, actual, tolerance, pass})}]
export function runSelfTest({ tests = [], sweep = null, getState = null, perf = null } = {}) {
  const testResults = tests.map(t => {
    try { const r = t.run(); return { id: t.id, name: t.name, ...r, pass: !!r.pass }; }
    catch (e) { return { id: t.id, name: t.name, expected: null, actual: String(e), tolerance: null, pass: false }; }
  });
  const robustnessSweep = sweep ? sweep() : { ticksRun: 0, nanCount: 0, pass: false };
  const audit = {
    allPassed: testResults.length > 0 && testResults.every(r => r.pass) && robustnessSweep.pass,
    testResults,
    robustnessSweep,
    stateHash: getState ? hashState(getState()) : null,
    perf: perf || { stepMsAvg: null, frameMsAvg: null },
    getSnapshot: () => (getState ? JSON.parse(JSON.stringify(getState())) : null),
  };
  if (typeof console !== 'undefined' && console.table) console.table(testResults);
  if (typeof globalThis !== 'undefined') globalThis.__HYDRO_AUDIT__ = audit;
  return audit;
}
