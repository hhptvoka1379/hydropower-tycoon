/* Unified Field-Station UI:
   - Top status bar + clock/speed controls (-/= and pips)
   - Bottom 1-6 dock (+ hidden single-site selector)
   - Centered floating Oxford field notebook (#panel) with 1-6 sections
   - Walk-up station & 3D plot click card (#card)
   - SCADA telemetry drawer (F1), Alerts, Start modal, Restructure modal */

import { money, num, pct, hourLabel, duration } from './format.js';
import {
  activeSite, plantStatus, modeOption, tierOptions, repairOption, penstockOption,
  parcelOption, buildOption, cleanOption, windRepair, batteryRefurb,
  financeModel, loanOption, repayOption, questsModel, siteChoices, parseStationId
} from './viewmodel.js';
import { CONDS, ACTS, rulesToCards, cardsToRules, describeRule, firingIndex } from './rules-logic.js';
import { pickStorage, createSaveStore, validateSaveDeep, isPlayed } from './save-logic.js';

const NB_TABS = [
  ['operate', '1 · Operate', '#1d6e68'],
  ['build', '2 · Build', '#4f6b3a'],
  ['automation', '3 · Automation', '#2f6f86'],
  ['services', '4 · Services', '#a3472c'],
  ['finance', '5 · Finance & Quests', '#8a5f10'],
  ['world', '6 · World & Settings', '#1d3557']
];

const PANELS = {
  operate: { title: 'Field Log — Operate', tabs: null, cls: 'compact' },
  build: { title: 'Site Plans — Build', tabs: ['Tiles', 'Plant', 'Dam & basin', 'Land & sites'], cls: '' },
  automation: { title: 'Dispatch Rules — Automation', tabs: ['Rules', 'God mode'], cls: 'notebook' },
  services: { title: 'Grid & Upkeep — Services', tabs: ['Reserve', 'Contracts', 'Maintenance'], cls: '' },
  finance: { title: 'Ledger & Milestones — Finance & Quests', tabs: null, cls: 'split' },
  world: { title: 'Station & View — World & Settings', tabs: ['World', 'Settings'], cls: 'compact' },
  save: { title: 'Archive — Save / Load', tabs: null, cls: 'compact' }
};

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function kv(k, v, cls) { return `<div class="kv"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`; }
function J(o) { return `data-j='${JSON.stringify(o).replace(/'/g, '&#39;')}'`; }
function seasonOf(doy) { return doy < 90 ? ['Spring', '🌱'] : doy < 180 ? ['Summer', '☀'] : doy < 270 ? ['Autumn', '🍂'] : ['Winter', '❄']; }

export function createUI(ctx) {
  const { Sim, game, bus, act, clock, world } = ctx;
  const C = Sim.CONFIG;

  // Save store backed by localStorage or memory fallback
  const picked = pickStorage(() => (typeof localStorage !== 'undefined' ? localStorage : null));
  const store = createSaveStore({
    storage: picked.storage,
    persistent: picked.persistent,
    now: () => Date.now(),
    validate: (save) => validateSaveDeep(save, Sim.validateSave, Sim.QUESTS.map(q => q.id))
  });

  const UI = {
    panel: null,
    tab: {},
    card: null,       // { kind: 'station'|'tile', id?, parcel?, tile? }
    dismissedStation: null,
    gridTile: 0,
    tier: { solar: 1, wind: 1, battery: 0 },
    plan: { budget: 200000, target: 150 },
    damH: 12,
    penD: 1.2,
    penMat: 'steel',
    scadaSite: 'active',
    settings: { theme: 'field', sound: false },
    sellSel: new Set(),
    lastPanel: 0,
    lastCard: 0,
    lastDrawer: 0,
    lastAutoDay: -1,
    pdown: false,
    ac: null
  };

  try {
    const savedSet = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('hydro_field_settings')) || 'null');
    if (savedSet) Object.assign(UI.settings, savedSet);
  } catch (_) {}
  if (UI.settings.theme !== 'field' && UI.settings.theme !== 'brass') UI.settings.theme = 'field';

  // Ring buffers for SCADA charts (1440 samples = 24h at 1-min resolution)
  const rings = {};
  let lastRingMin = -1;
  function mkRing() {
    const f = () => new Float32Array(1440).fill(NaN);
    return { price: f(), vu: f(), vl: f(), gen: f(), pump: f(), ren: f(), req: f(), head: -1, count: 0 };
  }
  function ringPush(R, v) {
    R.head = (R.head + 1) % 1440;
    R.count = Math.min(1440, R.count + 1);
    for (const k in v) R[k][R.head] = v[k];
  }
  function sampleRings(st) {
    if (!st) return;
    const m = Math.floor(st.t / 60);
    if (m === lastRingMin) return;
    const n = lastRingMin < 0 ? 1 : Math.min(10, m - lastRingMin);
    lastRingMin = m;
    for (let k = 0; k < n; k++) {
      const ag = { price: st.market.price, vu: 0, vl: 0, gen: 0, pump: 0, ren: 0, req: st.market.req * 10 };
      st.sites.forEach((s, i) => {
        const R = rings[i] || (rings[i] = mkRing());
        const v = {
          price: st.market.price, vu: Sim.upPct(s), vl: Sim.loPct(s),
          gen: (s.tel.pGen || 0) / 1e6, pump: -(s.tel.pPump || 0) / 1e6, ren: (s.tel.pRen || 0) / 1e6,
          req: st.market.req * 10
        };
        ringPush(R, v);
        ag.vu += v.vu / st.sites.length; ag.vl += v.vl / st.sites.length;
        ag.gen += v.gen; ag.pump += v.pump; ag.ren += v.ren;
      });
      ringPush(rings.all || (rings.all = mkRing()), ag);
    }
  }

  // Mount root UI containers
  const root = document.createElement('div');
  root.id = 'uiRoot';
  root.innerHTML = `
    <header id="top" class="pane" aria-label="Station telemetry and clock">
      <div class="brand" title="Hydropower Tycoon — Field Station">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V5l8 15V5M16 4c2 3 4 5 4 9a4 4 0 0 1-8 0c0-4 2-6 4-9z"/></svg>
        <span class="hide-xs">Hydropower</span>
      </div>
      <div class="stat"><span class="lbl" id="tSeason">Day 1</span><b class="num" id="tClock">06:00</b></div>
      <div class="stat click" id="statCash" role="button" tabindex="0" title="Open Finance & Quests (5)"><span class="lbl">Cash</span><b class="num" id="tCash">$0</b></div>
      <div class="stat click hide-s" id="statProfit" role="button" tabindex="0" title="Open Finance & Quests (5)"><span class="lbl">Today</span><b class="num" id="tProfit">$0</b></div>
      <div class="stat hide-s"><span class="lbl">Spot</span><b class="num" id="tPrice">$0/MWh</b></div>
      <div class="stat hide-s"><span class="lbl">Plant / Upper</span><b class="num" id="tPlant">Idle</b></div>
      <div class="spacer"></div>
      <div class="timectl">
        <button id="bPause" title="Pause / Resume (Space or 0)"><span id="pauseTx">Pause</span></button>
        <div class="stepper">
          <button id="bSlower" aria-label="Slower (-)" title="Slower (-)">−</button>
          <div class="speedBox" id="speedBox" title="Simulation pace (- / = keys or click dots)">
            <span id="speedLbl" class="num">1 min/s</span>
            <div class="pips">${[0, 1, 2, 3, 4, 5].map(i => `<button data-speed="${i}" aria-label="${C.time.labels[i]}" title="${C.time.labels[i]}"></button>`).join('')}</div>
          </div>
          <button id="bFaster" aria-label="Faster (=)" title="Faster (=)">+</button>
        </div>
      </div>
      <button id="bScada" title="SCADA telemetry (F1)"><span class="hide-xs">SCADA</span></button>
      <button id="bBell" aria-label="Alerts" title="Alerts"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 19a2 2 0 0 0 4 0"/></svg><span id="bellN"></span></button>
    </header>

    <div id="chips" aria-live="polite"></div>
    <div id="alerts" class="pane" hidden role="region" aria-label="Station alerts"></div>

    <nav id="tools" class="pane" aria-label="Toolbar">
      <div class="grp" role="group" aria-label="Station">
        <button data-tool="operate" title="Operate (1)"><span class="hk">1</span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M12 5v2M4 13h2M20 13h-2"/></svg><span class="tl">Operate</span></button>
        <button data-tool="build" title="Build (2)"><span class="hk">2</span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 20V10l7-6 7 6v10M10 20v-6h4v6"/></svg><span class="tl">Build</span></button>
        <button data-tool="automation" title="Automation notebook (3)"><span class="hk">3</span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/></svg><span class="tl">Automation</span></button>
        <button data-tool="services" title="Services (4)"><span class="hk">4</span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4a4.5 4.5 0 0 0-4 6.3L4 17.3 6.7 20l7-7A4.5 4.5 0 0 0 20 9l-3 2-2.5-2.5 2-3z"/></svg><span class="tl">Services</span></button>
      </div>
      <div class="grp" role="group" aria-label="Management">
        <button data-tool="finance" title="Finance & Quests (5)"><span class="hk">5</span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9H11a1.8 1.8 0 0 0 0 3.6h2a1.8 1.8 0 0 1 0 3.6H9M12 6.5v11"/></svg><span class="tl">Finance</span></button>
        <button data-tool="world" title="World & Settings (6)"><span class="hk">6</span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><span class="tl">World</span></button>
        <button data-tool="save" title="Save / Load"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg><span class="tl">Save</span></button>
      </div>
      <div class="grp" id="siteGrp" hidden><select id="siteSel" aria-label="Site switcher" title="Switch site"></select></div>
    </nav>

    <section id="panel" class="pane" hidden aria-live="polite">
      <nav id="nbNav" class="nb-nav" aria-label="Notebook sections"></nav>
      <header><h2 id="pTitle">Notebook</h2><button id="pClose" aria-label="Close notebook">✕</button></header>
      <div class="tabs" id="pTabs"></div>
      <div id="pBody"></div>
    </section>

    <div id="card" class="pane" hidden role="dialog" aria-live="polite"></div>
    <div id="ctip" hidden></div>

    <section id="drawer" class="pane" hidden aria-label="SCADA telemetry drawer">
      <header>
        <h2 style="margin:0;flex:1">SCADA Telemetry</h2>
        <label class="lbl" for="scadaSite">View</label>
        <select id="scadaSite"></select>
        <button id="dClose" aria-label="Close SCADA">✕</button>
      </header>
      <div class="body">
        <div>
          <div class="lbl">Price, 24 h history + forecast · reserve req</div><canvas class="chart" id="cPrice"></canvas>
          <div class="lbl" style="margin-top:6px">Reservoir levels (% full)</div><canvas class="chart" id="cVol"></canvas>
          <div class="lbl" style="margin-top:6px">Power MW (gen + / pump − / renewables)</div><canvas class="chart" id="cPow"></canvas>
        </div>
        <div>
          <div id="telem"></div>
          <div class="lbl" style="margin-top:8px">Hydraulic grade line</div>
          <canvas id="hgl" style="width:100%;height:110px;border:1px solid var(--hair);border-radius:6px;background:var(--raised)"></canvas>
        </div>
      </div>
    </section>

    <div id="modal" hidden></div>
  `;
  document.body.appendChild(root);
  const $ = (id) => document.getElementById(id);

  function applySettings() {
    document.body.dataset.theme = UI.settings.theme;
    try { localStorage.setItem('hydro_field_settings', JSON.stringify(UI.settings)); } catch (_) {}
  }
  applySettings();

  function beep(freq) {
    if (!UI.settings.sound) return;
    try {
      UI.ac = UI.ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = UI.ac.createOscillator(), g = UI.ac.createGain();
      o.type = 'triangle'; o.frequency.value = freq || 520; g.gain.value = 0.035;
      o.connect(g); g.connect(UI.ac.destination);
      const t = UI.ac.currentTime; g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.start(t); o.stop(t + 0.12);
    } catch (_) {}
  }

  function toast(msg, sev, nav) {
    const c = $('chips');
    const d = document.createElement('div');
    d.className = 'chip' + (sev === 'warn' ? ' amber' : sev === 'crit' ? ' red' : '');
    if (nav) {
      d.dataset.nav = '1'; d.setAttribute('role', 'button'); d.setAttribute('tabindex', '0');
      const sp = document.createElement('span'); sp.textContent = msg + ' ';
      const b = document.createElement('b'); b.textContent = '→ ' + nav.label;
      d.appendChild(sp); d.appendChild(b);
      const go = () => {
        if (nav.panel) { UI.tab[nav.panel] = nav.tab || 0; openPanel(nav.panel); }
        d.remove();
      };
      d.onclick = go;
      d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    } else d.textContent = msg;
    c.prepend(d);
    setTimeout(() => d.remove(), nav ? 6500 : 4000);
  }

  function navForReason(r) {
    if (!r) return null;
    const s = String(r).toLowerCase();
    if (s.includes('permit') && (s.includes('dam') || s.includes('gravity') || s.includes('arch'))) return { panel: 'build', tab: 2, label: 'Dam permits' };
    if (s.includes('water-rights') || s.includes('water rights')) return { panel: 'build', tab: 3, label: 'Land & sites' };
    if (s.includes('parcel not owned')) return { panel: 'build', tab: 0, label: 'Buy parcel' };
    if (s.includes('not enough cash') || s.includes('credit limit')) return { panel: 'finance', tab: 0, label: 'Finance & Loans' };
    if (s.includes('no dam') || s.includes('place a dam')) return { panel: 'build', tab: 2, label: 'Dam & basin' };
    if (s.includes('reserve')) return { panel: 'services', tab: 0, label: 'Reserve' };
    if (s.includes('contract')) return { panel: 'services', tab: 1, label: 'Contracts' };
    if (s.includes('penstock')) return { panel: 'build', tab: 1, label: 'Penstock' };
    return null;
  }

  function doAct(a) {
    const r = act(a);
    if (!r.ok) toast(r.reason, 'warn', navForReason(r.reason));
    else beep(a.type === 'SET_MODE' ? (a.mode === 'gen' ? 660 : a.mode === 'pump' ? 440 : 330) : 560);
    UI.lastPanel = 0; UI.lastCard = 0; UI.lastDrawer = 0;
    return r;
  }

  // ---- Notebook panel (#panel) ----
  function openPanel(name) {
    if (name === 'quests') name = 'finance';
    if (name === 'settings') { name = 'world'; UI.tab.world = 1; }
    if (name === 'lens') name = 'world';
    if (UI.panel === name) { closePanel(); return; }
    UI.panel = name;
    $('alerts').hidden = true;
    const p = PANELS[name], pan = $('panel');
    pan.hidden = false;
    pan.classList.toggle('split', p.cls === 'split');
    pan.classList.toggle('compact', p.cls === 'compact');
    pan.classList.toggle('notebook', p.cls === 'notebook');
    $('nbNav').innerHTML = NB_TABS.map(x => `<button type="button" data-nbjump="${x[0]}" style="--nb-c:${x[2]}" aria-pressed="${name === x[0]}">${x[1]}</button>`).join('');
    $('pTitle').textContent = p.title;
    UI.tab[name] = UI.tab[name] || 0;
    $('pTabs').innerHTML = p.tabs ? p.tabs.map((t, i) => `<button data-tab="${i}" aria-pressed="${UI.tab[name] === i}">${t}</button>`).join('') : '';
    document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === name));
    renderPanel(true);
  }
  function closePanel() {
    UI.panel = null;
    const pan = $('panel'); pan.hidden = true; pan.classList.remove('split', 'compact', 'notebook');
    document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  }

  function tileMapHTML(snap, s) {
    const cw = 13, ch = 7.5;
    const busy = new Set((snap.jobs || []).filter(j => j.kind === 'build' && j.site === s.id).map(j => j.p.tile));
    let o = `<svg class="tmap" viewBox="0 0 336 112" role="group" aria-label="Parcel map"><defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--raised)"/><path d="M0 0V5" style="stroke:var(--border)" stroke-width="1.6"/></pattern></defs>`;
    const ic = (t, cx, cy) => {
      let g = '';
      if (t.solar) g += `<g transform="translate(${cx - (t.wind || t.battery ? 4 : 0)},${cy})"><circle r="2.6" fill="#e0a526"/></g>`;
      if (t.wind) g += `<g transform="translate(${cx + (t.solar ? 4 : 0)},${cy})" stroke="var(--ren)" stroke-width="1.4" fill="none"><path d="M0 0V4.6M0 0L0-4.4M0 0L3.8 2.2M0 0L-3.8 2.2"/></g>`;
      if (t.battery) g += `<g transform="translate(${cx + (t.solar ? 4 : 0)},${cy})"><rect x="-3" y="-2.5" width="6" height="5" rx="1" fill="var(--gen)"/></g>`;
      return g;
    };
    for (let p = 0; p < 3; p++) {
      const ox = 8 + p * 108 + 48, oy = 6, own = s.parcels[p]; let sel = '';
      for (let k = 0; k < 16; k++) {
        const i = p * 16 + k, rc = Sim.tileRC(i), t = s.tiles[i];
        const cx = ox + (rc.c - rc.r) * cw, cy = oy + (rc.r + rc.c + 1) * ch;
        const pts = `${cx},${cy - ch} ${cx + cw},${cy} ${cx},${cy + ch} ${cx - cw},${cy}`;
        const isb = busy.has(i);
        const cls = 'cell' + (own ? '' : ' lock') + (isb ? ' busy' : '') + (UI.gridTile === i ? ' sel' : '');
        const el = `<g><polygon class="${cls}" points="${pts}" ${own ? `data-tilebtn="${i}" tabindex="0" role="button"` : ''}></polygon>${own ? ic(t, cx, cy) : ''}</g>`;
        if (UI.gridTile === i) sel = el; else o += el;
      }
      o += sel + `<text x="${ox}" y="${oy + 8 * ch + 13}" text-anchor="middle">Parcel ${p + 1}</text>` + (own ? '' : `<text class="pr" x="${ox}" y="${oy + 8 * ch + 24}" text-anchor="middle">for sale ${money(C.land.parcelCost[p])}</text>`);
    }
    return o + `</svg><div class="tlegend"><span><i style="background:#e0a526"></i>solar</span><span><i style="background:var(--ren)"></i>wind</span><span><i style="background:var(--gen)"></i>battery</span><span><i style="background:var(--ochre)"></i>building</span><span><i style="background:var(--accent)"></i>selected</span></div>`;
  }

  function tileCardHTML(snap, s, ti) {
    const t = s.tiles[ti];
    const p = Math.floor(ti / 16);
    const po = parcelOption(snap, s, p, Sim);
    let h = `<b>Parcel ${p + 1} · Tile ${(ti % 16) + 1}</b>`;
    if (!po.owned) {
      return h + `<p class="muted" style="font-size:12px">Parcel ${p + 1} is not owned yet.</p><button ${po.enabled ? J({ type: 'BUY_PERMIT', kind: 'parcel', parcel: p }) : `disabled title="${esc(po.reason)}"`}>Buy parcel ${p + 1} · ${money(po.cost)}</button>`;
    }
    const cur = [
      t.solar ? `${C.solar.tiers[t.solar.tier].name}${t.solar.building ? ' (building)' : ` · ${C.solar.tiers[t.solar.tier].kWp} kWp · ${pct(t.solar.soil * 100)} soiled`}` : null,
      t.wind ? `${C.wind.tiers[t.wind.tier].name}${t.wind.building ? ' (building)' : ` · ${C.wind.tiers[t.wind.tier].kW} kW${t.wind.damaged ? ' · DAMAGED' : ''}`}` : null,
      t.battery ? `${C.battery.tiers[t.battery.tier].name}${t.battery.building ? ' (building)' : ` · ${pct(t.battery.soc * 100)} SoC`}` : null
    ].filter(Boolean);
    h += `<div class="muted" style="font-size:12px;margin:4px 0 8px">${cur.length ? cur.join(' · ') : 'Empty cleared plot — ready to build.'}</div>`;
    if (t.solar && !t.solar.building && t.solar.soil > 0.005) {
      const co = cleanOption(snap, t.solar, Sim);
      h += `<div class="row" style="margin-bottom:6px"><button ${co.enabled ? J({ type: 'CLEAN_ARRAY', tile: ti }) : `disabled title="${esc(co.reason)}"`}>Clean solar (${money(co.cost)})</button></div>`;
    }
    if (t.wind && !t.wind.building && t.wind.damaged && !t.wind.repairing) {
      const wr = windRepair(snap, s, ti, Sim);
      h += `<div class="row" style="margin-bottom:6px"><button ${wr.enabled ? J({ type: 'REPAIR', target: 'wind', tile: ti }) : `disabled title="${esc(wr.reason)}"`}>Repair wind (${money(wr.cost)})</button></div>`;
    }
    if (t.battery && !t.battery.building) {
      h += `<div class="seg" style="margin-bottom:6px">${['auto', 'charge', 'discharge', 'idle'].map(m => `<button ${J({ type: 'SET_BATTERY', tile: ti, mode: m })} aria-pressed="${t.battery.mode === m}">${m}</button>`).join('')}</div>`;
    }
    for (const kind of ['solar', 'wind', 'battery']) {
      const tr = UI.tier[kind] || 0;
      const opt = buildOption(snap, snap.active, ti, kind, tr, Sim);
      const q = opt.quote;
      h += `<div style="margin-top:6px;padding-top:6px;border-top:1px dotted var(--hair)">
        <div class="row" style="justify-content:space-between"><b>${kind[0].toUpperCase() + kind.slice(1)}</b>
          <span class="seg" style="flex:none">${[0, 1, 2].map(i => `<button data-tier="${kind}:${i}" aria-pressed="${tr === i}">T${i + 1}</button>`).join('')}</span>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:4px">
          <span class="muted" style="font-size:11px">${q ? `Cost ${money(q.cost)} · Est. NPV ${money(q.npv, { sign: true })}` : ''}</span>
          <button class="${opt.enabled ? 'on' : ''}" ${opt.enabled ? J({ type: 'BUILD', kind, tile: ti, tier: tr }) : `disabled title="${esc(opt.reason)}"`}>Build</button>
        </div>
        ${!opt.enabled && opt.reason ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(opt.reason)}</div>` : ''}
      </div>`;
    }
    return h;
  }

  function rulesHTML(snap, s) {
    const cards = rulesToCards(s.auto.rules);
    const fire = s.auto.enabled ? firingIndex(snap, s, Sim) : -1;
    return `
      <label class="row"><input type="checkbox" data-autoen ${s.auto.enabled ? 'checked' : ''}> <b>Automation enabled</b> (8 priority slots — highest priority wins)</label>
      <div style="overflow-x:auto">
        <table class="rules"><thead><tr><td>On</td><td>Pri</td><td>If</td><td>Val</td><td>And</td><td>Val</td><td>Then</td><td>m³/s</td><td></td></tr></thead><tbody>
          ${cards.map((r, i) => `<tr data-rule="${i}">
            <td><input type="checkbox" data-rf="on" ${r.on ? 'checked' : ''}></td>
            <td><input type="number" data-rf="pri" min="1" max="8" value="${r.pri}"></td>
            <td><select data-rf="cond">${CONDS.filter(c => c.id !== 'none').map(c => `<option value="${c.id}" ${c.id === r.cond ? 'selected' : ''}>${c.label}</option>`).join('')}</select></td>
            <td><input type="number" data-rf="val" value="${esc(r.val)}" ${CONDS.find(c => c.id === r.cond)?.needs ? '' : 'disabled'}></td>
            <td><select data-rf="cond2">${CONDS.map(c => `<option value="${c.id}" ${c.id === r.cond2 ? 'selected' : ''}>${c.label}</option>`).join('')}</select></td>
            <td><input type="number" data-rf="val2" value="${esc(r.val2)}" ${CONDS.find(c => c.id === r.cond2)?.needs ? '' : 'disabled'}></td>
            <td><select data-rf="act">${ACTS.map(a => `<option value="${a.id}" ${a.id === r.act ? 'selected' : ''}>${a.verb}</option>`).join('')}</select></td>
            <td><input type="number" data-rf="flow" step="0.1" value="${esc(r.flow)}" ${ACTS.find(a => a.id === r.act)?.flow ? '' : 'disabled'}></td>
            <td>${fire === i ? '<span class="stamp done" style="font-size:9px">FIRING</span>' : ''}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
      <div class="row" style="margin-top:8px">
        <button data-saverules class="on">Apply rules</button>
        <span class="muted" style="font-size:11.5px">${fire >= 0 ? `Active: ${esc(describeRule(cards[fire]))}` : 'Price $/MWh · Levels % · Ren MW · SoC %'}</span>
      </div>`;
  }

  function collectRules(rootEl) {
    const cards = [];
    rootEl.querySelectorAll('[data-rule]').forEach(tr => {
      const g = (k) => tr.querySelector(`[data-rf="${k}"]`);
      cards.push({
        on: g('on').checked, pri: g('pri').value,
        cond: g('cond').value, val: g('val').value,
        cond2: g('cond2').value, val2: g('val2').value,
        act: g('act').value, flow: g('flow').value
      });
    });
    return cardsToRules(cards);
  }

  function panelHTML(snap, name, tab) {
    const s = activeSite(snap);
    if (!s) return '';
    const t = s.tel || {};

    if (name === 'operate') {
      const ps = plantStatus(snap, s, Sim);
      const fc = snap.market.forecast || [];
      const nd = !s.dam.built;
      return `
        ${nd ? `<div class="section"><b class="warn">No dam stands yet</b><p class="muted" style="font-size:12px;margin:4px 0">Walk to the dam crest or open <b>2 · Build → Dam &amp; basin</b> to place your dam first.</p></div>` : ''}
        <div class="section">
          <div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${esc(s.name)}</b><span class="num" style="font-size:12px">Spot <b>$${num(snap.market.price, 1)}</b>/MWh</span></div>
          <div class="seg">${['gen', 'pump', 'idle'].map(m => {
            const opt = modeOption(snap, s, m);
            return `<button ${opt.enabled ? J({ type: 'SET_MODE', mode: m }) : `disabled title="${esc(opt.reason)}"`} aria-pressed="${!ps.autoOn && ps.modeRequested === m}">${{ gen: 'Generate', pump: 'Pump', idle: 'Idle' }[m]}</button>`;
          }).join('')}</div>
          <label class="lbl" style="display:flex;justify-content:space-between;margin-top:8px">Flow setpoint <span class="num">${num(s.flowSet, 2)} m³/s</span></label>
          <input type="range" min="0" max="${ps.flowMax}" step="0.05" value="${Math.min(ps.flowMax, s.flowSet)}" data-slider="flow" ${nd ? 'disabled' : ''}>
          <div class="grid2" style="margin-top:4px">
            ${kv('Plant', `${ps.label} · ${num(ps.flow, 1)} m³/s`)}${kv('Lakes', `${pct(ps.upPct)} / ${pct(ps.loPct)}`)}
            ${kv('Gen / Pump', `${num((t.pGen || 0) / 1e6, 2)} / ${num((t.pPump || 0) / 1e6, 2)} MW`)}${kv('Ren / Batt', `${num((t.pRen || 0) / 1e6, 2)} / ${num((t.pBatt || 0) / 1e6, 2)} MW`)}
          </div>
          ${ps.reason ? `<p class="muted" style="font-size:11.5px;margin:6px 0 0">${esc(ps.reason)}</p>` : ''}
        </div>
        <div class="section">
          <div class="lbl" style="margin-bottom:4px">Upcoming 24 h prices ($/MWh)</div>
          <div class="row" style="gap:2px;align-items:flex-end;height:48px">${fc.map((p, i) => `<div data-bar="+${i} h: $${p.toFixed(1)}/MWh" style="flex:1;height:${Math.max(3, Math.min(48, (p + 40) / 3.4))}px;border-radius:2px 2px 0 0;background:${p < 0 ? 'var(--gen)' : p >= snap.market.peak ? 'var(--pump)' : 'var(--border)'}"></div>`).join('')}</div>
          <div class="muted" style="font-size:11px;margin-top:3px">Teal = negative (paid to pump) · Clay = peak hours</div>
        </div>
        <div class="section">
          <div class="lbl" style="margin-bottom:6px">Field time &amp; telemetry</div>
          <div class="row">
            <button data-wait="h1">Wait 1 h</button>
            <button data-wait="peak">Until peak</button>
            <button data-wait="morn">Until 06:00</button>
            <button data-drawer>SCADA (F1)</button>
          </div>
        </div>`;
    }

    if (name === 'build') {
      if (tab === 0) {
        return `<p class="muted" style="font-size:12px;margin:0 0 6px">Walk around and click any plot in the 3D field — or choose from the grid below — to build Solar, Wind, or Batteries and watch construction. Owned parcels: ${s.parcels.map((o, i) => o ? (i + 1) : '').filter(Boolean).join(', ')}.</p>`
          + tileMapHTML(snap, s)
          + `<div class="section">${tileCardHTML(snap, s, UI.gridTile || 0)}</div>`
          + `<div class="row">${[1, 2].filter(p => !s.parcels[p]).map(p => `<button ${J({ type: 'BUY_PERMIT', kind: 'parcel', parcel: p })}>Buy parcel ${p + 1} · ${money(C.land.parcelCost[p])}</button>`).join('')}</div>`;
      }
      if (tab === 1) {
        let h = '';
        for (const u of ['turbine', 'pump']) {
          const cur = s[u], opts = tierOptions(snap, s, u, Sim), rep = repairOption(snap, s, u, Sim);
          h += `<div class="section"><b>${u === 'turbine' ? 'Turbine bay' : 'Pump bay'}</b>
            ${kv('Installed', `${C[u][cur.tier].name} · ${C[u][cur.tier].Qr} m³/s`)}${kv('Health', pct(cur.health))}
            <div class="row" style="margin-top:6px">${opts.map(o => `<button ${o.enabled ? J({ type: 'BUILD', kind: u, tier: o.tier }) : `disabled title="${esc(o.reason)}"`}>T${o.tier + 1} · ${money(o.cost)}</button>`).join('')}</div>
            <div class="row" style="margin-top:6px"><button ${rep.enabled ? J({ type: 'REPAIR', target: u }) : `disabled title="${esc(rep.reason)}"`}>Repair (${money(rep.cost)})</button>${!rep.enabled ? `<span class="muted" style="font-size:11px">${esc(rep.reason)}</span>` : ''}</div>
          </div>`;
        }
        const pq = penstockOption(snap, s, UI.penD, UI.penMat, Sim);
        h += `<div class="section"><b>Penstock</b>
          ${kv('Current', `${num(s.penstock.D, 2)} m ${C.penstock.materials[s.penstock.mat].name} · Health ${pct(s.penstock.health)}`)}
          <div class="grid2" style="margin-top:6px">
            <div><label class="lbl">Diameter (m)</label><input type="number" id="penD" min="${C.penstock.Dmin}" max="${C.penstock.Dmax}" step="0.1" value="${UI.penD}"></div>
            <div><label class="lbl">Material</label><select id="penM">${Object.keys(C.penstock.materials).map(k => `<option value="${k}" ${k === UI.penMat ? 'selected' : ''}>${C.penstock.materials[k].name}</option>`).join('')}</select></div>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:8px">
            <span class="muted" style="font-size:12px">Replace cost: ${money(pq.cost)}</span>
            <button data-pen class="${pq.enabled ? 'on' : ''}" ${pq.enabled ? '' : `disabled title="${esc(pq.reason)}"`}>Replace penstock</button>
          </div>
        </div>`;
        return h;
      }
      if (tab === 2) {
        let h = '';
        if (s.kind === 'proc' && !s.dam.built) {
          const dq = Sim.damQuote(snap, snap.active, s.station, UI.damH);
          h += `<div class="section"><b>Place canyon dam</b>
            <p class="muted" style="font-size:12px;margin:4px 0">Station ${s.station} m · Choose height (5–${dq.limit} m permitted):</p>
            <label class="lbl" style="display:flex;justify-content:space-between">Height <span class="num">${dq.h} m</span></label>
            <input type="range" min="5" max="${dq.limit}" step="1" value="${dq.h}" data-slider="damh">
            ${kv('Cost', money(dq.cost))}${kv('Storage capacity', `${num(dq.capacity / 1e3, 0)}k m³ (${num(dq.storageMWh, 1)} MWh)`)}
            <button class="on" ${dq.ok ? J({ type: 'PLACE_DAM', station: dq.station, height: dq.h }) : 'disabled'}>Place dam · ${money(dq.cost)}</button>
          </div>`;
        } else {
          const rq1 = Sim.raiseQuote(snap, snap.active, 1), rq3 = Sim.raiseQuote(snap, snap.active, 3);
          const pb = Sim.planDam(snap, snap.active, { budget: UI.plan.budget }), pt = Sim.planDam(snap, snap.active, { target: UI.plan.target });
          h += `<div class="section"><b>Dam</b>
            ${kv('Height', `${s.dam.height} m (${C.dam.classes[s.dam.cls].name})`)}${kv('Storage now', `${num(Sim.storageMWh(s, s.dam.height), 1)} MWh`)}
            <div class="row" style="margin-top:6px">
              <button ${rq1.ok ? J({ type: 'RAISE_DAM', meters: 1 }) : `disabled title="${esc(rq1.reason)}"`}>Raise +1 m (${money(rq1.cost)})</button>
              <button ${rq3.ok ? J({ type: 'RAISE_DAM', meters: 3 }) : `disabled title="${esc(rq3.reason)}"`}>+3 m (${money(rq3.cost)})</button>
              ${s.dam.crack && !s.dam.repairing ? `<button class="on" ${J({ type: 'REPAIR', target: 'dam' })}>Repair crack</button>` : ''}
            </div>
            <div class="grid2" style="margin-top:8px">
              <div><label class="lbl">Budget plan ($)</label><input type="number" step="10000" value="${UI.plan.budget}" data-plan="budget"><div class="muted" style="font-size:11px">→ ${pb.height} m (${num(pb.storage, 1)} MWh)</div></div>
              <div><label class="lbl">Target MWh</label><input type="number" step="10" value="${UI.plan.target}" data-plan="target"><div class="muted" style="font-size:11px">→ ${pt.height} m (${money(pt.cost)})</div></div>
            </div>
          </div>`;
        }
        h += `<div class="section"><b>Lower basin</b>${kv('Excavation stage', `${s.lower.excav} / ${C.res.excavStages}`)}<button ${J({ type: 'EXCAVATE' })}>Excavate (${money(C.res.excavCost * (1 + 0.5 * s.lower.excav))})</button></div>`;
        h += `<div class="section"><b>Dam permits</b>${['gravity', 'arch'].map(k => kv(`${C.dam.classes[k].name} (≤ ${C.dam.classes[k].max} m)`, snap.permits[k] ? '✓ held' : `<button ${J({ type: 'BUY_PERMIT', kind: 'dam', cls: k })}>${money(C.dam.classes[k].permit)}</button>`)).join('')}</div>`;
        return h;
      }
      const sc = siteChoices(snap, Sim);
      return `<div class="section"><b>Sites for sale</b>${sc.shop.map(x => `<div class="kv"><span>${esc(x.name)}</span><span>${x.bought ? '✓ owned' : `${x.permitted ? '' : `<button ${J({ type: 'BUY_PERMIT', kind: 'water', id: x.i })} ${x.permitReason ? `disabled title="${esc(x.permitReason)}"` : ''}>Water permit ${money(x.permitCost)}</button>`} <button ${J({ type: 'BUY_SITE', id: x.i })} ${x.buyReason ? `disabled title="${esc(x.buyReason)}"` : ''}>Buy ${money(x.cost)}</button>`}</span></div>`).join('')}</div>`;
    }

    if (name === 'automation') {
      if (tab === 0) {
        return `<div class="nb-head"><b>DISPATCH RULES · ${esc(s.name.toUpperCase())}</b><span style="font-size:11px;opacity:.75">Day ${snap.day + 1}</span></div>`
          + rulesHTML(snap, s)
          + `<div class="section"><div class="frow"><label class="fl" for="cres">Repair cash reserve<small>dollars held back</small></label><input id="cres" type="number" step="5000" value="${snap.settings.cashReserve}" data-opt="cashReserve"></div></div>`;
      }
      const g = snap.god;
      return `<div class="nb-head"><b>SUPERVISOR LOG · GOD MODE</b><span style="font-size:11px;opacity:.75">Auto-operator</span></div>
        <div class="section"><label class="row"><span><b>God mode</b><br><span class="muted" style="font-size:12px">Dispatches and builds on your behalf</span></span><input type="checkbox" data-god="enabled" ${g.enabled ? 'checked' : ''}></label></div>
        <div class="section">
          <label class="row"><span>Dispatch the plant</span><input type="checkbox" data-god="dispatch" ${g.dispatch ? 'checked' : ''}></label>
          <label class="row"><span>Curtail renewables at negative prices</span><input type="checkbox" data-god="curtailNeg" ${g.curtailNeg ? 'checked' : ''}></label>
          <label class="row"><span>Profit protection <span class="muted" style="font-size:11px">(subsidy)</span></span><input type="checkbox" data-god="protect" ${g.protect ? 'checked' : ''}></label>
        </div>
        <div class="section">
          <div class="frow"><label class="fl">Flow target<small>fraction of rated</small></label><input type="number" data-godn="flowTarget" step="0.05" min="0.2" max="1.1" value="${g.flowTarget}"></div>
          <div class="frow"><label class="fl">Cash reserve<small>dollars kept back</small></label><input type="number" data-godn="cashReserve" step="5000" value="${g.cashReserve}"></div>
          <div class="frow"><label class="fl">Cheap hours<small>pump at lowest prices</small></label><input type="number" data-godn="cheapHours" min="1" max="12" value="${g.cheapHours}"></div>
          <div class="frow"><label class="fl">Peak hours<small>generate at highest prices</small></label><input type="number" data-godn="peakHours" min="1" max="12" value="${g.peakHours}"></div>
        </div>${kv('Subsidy recorded so far', money(snap.fin.subsidy))}`;
    }

    if (name === 'services') {
      const note = `<div class="svc-note"><b>Services overview</b> — <i>Reserve</i> pays you to keep fast MW ready for grid emergencies; <i>Contracts</i> lock in fixed-hour supply premiums; <i>Maintenance</i> tracks repairs &amp; solar cleaning. <span class="muted">(Planned for a clearer workflow rework later.)</span></div>`;
      if (tab === 0) {
        const cap = Sim.reserveCap(s) / 1e6;
        return note + `<div class="section"><b>Reserve market</b>
          ${kv('Deliverable within 50 s', `${num(cap, 2)} MW`)}${kv('Current offer', `${num(s.reserveOffer, 2)} MW`)}${kv('Availability pay', `$${C.reserve.availPay}/MW·h`)}
          ${kv('Reliability score', `${num(snap.reserve.score * 100, 0)} / 100`)}${kv('Calls answered', `${snap.reserve.ok} of ${snap.reserve.calls}`)}
          <div class="frow"><label class="fl" for="resMW">Offer<small>MW</small></label><input id="resMW" type="number" step="0.05" min="0" value="${s.reserveOffer}"></div>
          <div class="row"><button data-resoffer class="on">Set offer</button><button ${J({ type: 'SET_RESERVE_OFFER', mw: 0 })}>Withdraw</button></div>
          ${snap.gridWarning ? `<p class="warn" style="font-size:12px">Grid emergency ahead: starts in ${Math.max(0, snap.gridWarning.startsAt - snap.H)} h for ${snap.gridWarning.hours} h (${snap.gridWarning.mwShort} MW short, ×${snap.gridWarning.priceMult} price).</p>` : ''}
        </div>`;
      }
      if (tab === 1) {
        const c = snap.contracts;
        return note + `<div class="section"><b>Contract offers</b>${c.offers.length ? c.offers.map(o => `<div class="kv"><span>${esc(o.name)}: ${o.mw.toFixed(1)} MW, ${o.h0}–${o.h1} h, ${o.days} d, +$${o.premium}/MWh</span><button ${J({ type: 'SIGN_CONTRACT', id: o.id })}>Sign</button></div>`).join('') : '<div class="empty">No offers right now (refreshes every 15 days).</div>'}</div>
          <div class="section"><b>Active contracts</b>${c.active.length ? c.active.map(o => kv(esc(o.name), `${o.mw.toFixed(1)} MW (${o.h0}–${o.h1} h), ends day ${o.end + 1}`)).join('') : '<div class="empty">No active contracts.</div>'}${kv('Hours delivered in full', c.fulfilledHours)}</div>`;
      }
      let h = note + `<div class="section"><b>Equipment</b>${kv('Turbine health', pct(s.turbine.health))}${kv('Pump health', pct(s.pump.health))}${kv('Penstock health', pct(s.penstock.health))}
        <div class="row" style="margin-top:6px"><button ${J({ type: 'REPAIR', target: 'turbine' })}>Repair turbine</button><button ${J({ type: 'REPAIR', target: 'pump' })}>Repair pump</button></div></div>`;
      h += `<div class="section"><b>Active jobs</b>${snap.jobs.length ? snap.jobs.map(j => kv(`${snap.sites[j.site].name}: ${j.kind}`, duration(j.rem / 3600))).join('') : '<div class="empty">No construction or repair jobs.</div>'}</div>`;
      return h;
    }

    if (name === 'finance') {
      const fm = financeModel(snap, Sim), qm = questsModel(snap, Sim.QUESTS);
      const amt = +($('loanAmt') ? $('loanAmt').value : 50000) || 50000;
      const lo = loanOption(snap, amt, Sim), rp = repayOption(snap, amt);
      const dh = snap.fin.dayHist || [];
      const meanDay = dh.length ? dh.reduce((a, b) => a + b, 0) / dh.length : 0;
      const renMW = (t.pRen || 0) / 1e6, avgFc = snap.market.forecast.reduce((a, b) => a + b, 0) / Math.max(1, snap.market.forecast.length);
      const est24 = (renMW * Math.max(0, avgFc) - Sim.omPerHour(s)) * 24;
      return `<div class="split-grid">
        <div>
          <div class="section"><b>Books &amp; 24 h forecast</b>
            ${kv('Cash', money(fm.cash))}${kv('Loans', money(fm.loans))}${kv('Net worth', money(fm.netWorth))}
            ${kv('Today / yesterday', `${money(fm.today, { sign: true })} / ${money(fm.yesterday, { sign: true })}`)}
            ${kv('Mean daily profit', money(meanDay, { sign: true }))}${kv('24 h baseline forecast', money(est24, { sign: true }))}
            ${kv('O&amp;M this site', `${money(Sim.omPerHour(s))}/h`)}${kv('Lifetime net', money(fm.lifetime, { sign: true }))}
            ${dh.length ? `<div class="lbl" style="margin-top:8px">Daily profit (${dh.length} d)</div><div class="fchart">${dh.map((v, k) => `<div class="fcol" data-bar="Day ${snap.day - dh.length + k + 1}: ${money(v)}"><i style="height:${Math.min(54, 3 + Math.abs(v) / Math.max(1, Math.max(...dh.map(Math.abs))) * 51)}px;background:${v >= 0 ? 'var(--gen)' : 'var(--pump)'}"></i></div>`).join('')}</div>` : ''}
          </div>
          <div class="section"><b>Credit line (${(C.fin.loanRate * 100).toFixed(0)}%/yr)</b>
            ${kv('Limit', money(fm.maxLoan))}${fm.showSubsidy ? kv('God subsidy', money(fm.subsidy)) : ''}
            <div class="frow"><label class="fl" for="loanAmt">Amount<small>dollars</small></label><input id="loanAmt" type="number" step="10000" value="${amt}"></div>
            <div class="row"><button data-loan="take" ${lo.enabled ? '' : `disabled title="${esc(lo.reason)}"`}>Borrow</button><button data-loan="repay" ${rp.enabled ? '' : `disabled title="${esc(rp.reason)}"`}>Repay</button></div>
          </div>
        </div>
        <div>
          <div class="section"><b>Quests (${qm.claimed}/${qm.total})</b>
            <p class="muted" style="font-size:12px;margin:4px 0 8px">Win goal: ${C.win.quests} quests + ${money(C.win.netWorth)} net worth.${snap.won ? ' <span class="stamp done">Won</span>' : ''}</p>
            ${qm.list.map(q => `<div class="quest"><div><b>${esc(q.title)}</b><br><span class="muted" style="font-size:12px">${esc(q.desc)} · <b>+${money(q.reward)}</b></span></div><div>${q.state === 'claimed' ? '<span class="stamp done">Claimed</span>' : q.state === 'done' ? `<button class="on" ${J({ type: 'CLAIM_QUEST', id: q.id })}>Claim</button>` : '<span class="stamp">Open</span>'}</div></div>`).join('')}
          </div>
        </div>
      </div>`;
    }

    if (name === 'world') {
      const P = ctx.player;
      if (tab === 0) {
        const sts = P ? P.stations : [];
        return `
          <div class="section">
            <div class="row" style="justify-content:space-between;margin-bottom:6px">
              <b>3D Field &amp; Camera</b>
              <button data-overview class="${P && P.camera && P.camera.overview ? 'on' : ''}">Overview map (M)</button>
            </div>
            <div class="lbl" style="margin-bottom:6px">Walk or jump to station</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${sts.map(st => `<button data-goto="${esc(st.id)}">${esc(st.label || st.id)}</button>`).join('')}
            </div>
          </div>
          <div class="section">
            <div class="lbl" style="margin-bottom:6px">Render quality</div>
            <div class="seg">${['low', 'medium', 'high'].map(q => `<button data-qbtn="${q}" aria-pressed="${world.quality === q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>
          </div>
          <div class="section">
            ${kv('Avatar status', P ? `${P.mode}${P.torch ? ' · Torch ON' : ''}` : '—')}
            ${kv('Standing at', P && P.station ? (P.station.label || P.station.id) : 'Walking in valley')}
          </div>`;
      }
      return `
        <div class="section">
          <div class="lbl" style="margin-bottom:6px">Theme</div>
          <div class="seg">${[['field', 'Field Notes'], ['brass', 'Brass & Slate']].map(x => `<button data-themebtn="${x[0]}" aria-pressed="${UI.settings.theme === x[0]}">${x[1]}</button>`).join('')}</div>
        </div>
        <div class="section">
          <label class="row"><input type="checkbox" data-set="sound" ${UI.settings.sound ? 'checked' : ''}> Sound clicks</label>
        </div>
        <div class="section">
          <div class="lbl">Controls &amp; Shortcuts</div>
          <p class="muted" style="font-size:11.5px;margin:4px 0 8px"><b>WASD / Arrows</b> walk · <b>Shift</b> run · <b>Double-click</b> walk to ground · <b>Click plot/machine</b> inspect · <b>M</b> overview camera · <b>1–6</b> notebook menus · <b>− / =</b> speed · <b>Space</b> pause · <b>F1</b> SCADA · <b>Esc</b> close</p>
          <div class="row"><button data-opensave>Save / Load…</button><button data-newgame>New game…</button></div>
        </div>`;
    }

    if (name === 'save') {
      const list = store.list();
      return list.map(e => {
        const m = e.meta;
        const desc = m && !m.corrupt ? `Day ${m.day + 1} ${hourLabel(m.hour)} · ${money(m.cash)} · ${m.site || ''}` : m && m.corrupt ? 'corrupted' : 'empty';
        return `<div class="section"><b>${esc(e.label)}</b> <span class="muted" style="font-size:12px">${esc(desc)}</span>
          <div class="row" style="margin-top:6px">
            ${e.id !== 'auto' ? `<button data-save="${e.id}">Save</button>` : ''}
            <button data-load="${e.id}" ${e.has ? '' : 'disabled'}>Load</button>
            ${e.has ? `<button data-del="${e.id}">Delete</button>` : ''}
          </div>
        </div>`;
      }).join('') + `<div class="section"><div class="row"><button data-export>Export JSON</button><label style="display:inline-flex;align-items:center;padding:0 12px;min-height:40px;border:1px solid var(--hair);border-radius:9px;background:var(--btn);cursor:pointer">Import JSON<input type="file" id="importF" accept=".json,application/json" style="display:none"></label><button data-replay>Verify replay</button></div><p class="muted" id="saveMsg" style="font-size:11.5px;margin:6px 0 0">${store.persistent ? 'Saves persist in browser storage.' : 'Browser storage unavailable — using in-memory session storage.'}</p></div>`;
    }
    return '';
  }

  function renderPanel(force) {
    if (!UI.panel || (!force && UI.pdown)) return;
    const b = $('pBody');
    const ae = document.activeElement;
    if (!force && b.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;
    const snap = game.getSnapshot();
    if (!snap) return;
    const html = panelHTML(snap, UI.panel, UI.tab[UI.panel] || 0);
    if (b.dataset.h !== html) {
      const sc = b.scrollTop;
      b.innerHTML = html;
      b.dataset.h = html;
      b.scrollTop = sc;
    }
  }

  // ---- Station / 3D tile proximity card (#card) ----
  function renderCard(force) {
    const el = $('card');
    if (!UI.card) { el.hidden = true; return; }
    const snap = game.getSnapshot(); if (!snap) { el.hidden = true; return; }
    const s = activeSite(snap); if (!s) { el.hidden = true; return; }
    const ae = document.activeElement;
    if (!force && el.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;

    let body = '', title = 'Station';
    if (UI.card.kind === 'tile') {
      title = `Parcel ${UI.card.parcel + 1}`;
      body = tileCardHTML(snap, s, UI.card.tile);
    } else {
      const stn = UI.card.station;
      const parsed = parseStationId(stn.id);
      const kind = parsed ? parsed.kind : stn.kind;
      title = stn.label || stn.id;
      const ps = plantStatus(snap, s, Sim);
      if (kind === 'powerhouse') {
        body = `${kv('Plant', `${ps.label} · ${num(ps.flow, 1)} m³/s`)}${kv('Output', num(ps.watts / 1e6, 2) + ' MW')}
          <div class="seg" style="margin:6px 0">${['gen', 'pump', 'idle'].map(m => `<button ${J({ type: 'SET_MODE', mode: m })} aria-pressed="${!ps.autoOn && ps.modeRequested === m}">${{ gen: 'Generate', pump: 'Pump', idle: 'Idle' }[m]}</button>`).join('')}</div>
          <div class="row"><button data-openpanel="operate:0">Operate page (1)</button><button data-drawer>SCADA (F1)</button></div>`;
      } else if (kind === 'parcel') {
        const p = parsed ? parsed.parcel : (stn.parcel | 0);
        const ti = (UI.gridTile >= p * 16 && UI.gridTile < (p + 1) * 16) ? UI.gridTile : p * 16;
        UI.gridTile = ti;
        body = tileCardHTML(snap, s, ti) + `<div class="row" style="margin-top:8px"><button data-openpanel="build:0">All tiles in Build (2)</button></div>`;
      } else if (kind === 'dam') {
        if (s.kind === 'proc' && !s.dam.built) {
          const dq = Sim.damQuote(snap, snap.active, s.station, UI.damH);
          body = `<p class="muted" style="font-size:12px">No dam stands yet.</p><button class="on" ${dq.ok ? J({ type: 'PLACE_DAM', station: dq.station, height: dq.h }) : 'disabled'}>Place ${dq.h} m dam · ${money(dq.cost)}</button> <button data-openpanel="build:2">Configure in Build (2)</button>`;
        } else {
          const rq1 = Sim.raiseQuote(snap, snap.active, 1);
          body = `${kv('Dam height', `${s.dam.height} m`)}${kv('Upper lake', pct(ps.upPct))}<div class="row" style="margin-top:6px"><button ${rq1.ok ? J({ type: 'RAISE_DAM', meters: 1 }) : 'disabled'}>Raise +1 m (${money(rq1.cost)})</button><button data-openpanel="build:2">Dam plans (2)</button></div>`;
        }
      } else if (kind === 'penstock') {
        body = `${kv('Penstock', `${num(s.penstock.D, 2)} m ${C.penstock.materials[s.penstock.mat].name}`)}${kv('Flow / Head', `${num(ps.flow, 2)} m³/s · ${num(ps.netHead, 1)} m`)}<button data-openpanel="build:1" style="margin-top:6px">Replace / Repair in Build (2)</button>`;
      } else if (kind === 'lookout') {
        const fm = financeModel(snap, Sim), qm = questsModel(snap, Sim.QUESTS);
        body = `${kv('Cash', money(fm.cash))}${kv('Net worth', money(fm.netWorth))}${kv('Quests', `${qm.claimed}/${qm.total} (${qm.claimable} ready)`)}<div class="row" style="margin-top:6px"><button class="on" data-openpanel="finance:0">Finance &amp; Quests (5)</button><button data-openpanel="save:0">Save / Load</button></div>`;
      } else if (kind === 'forecast') {
        body = `${kv('Spot price', `$${num(snap.market.price, 1)}/MWh`)}<div class="row" style="margin-top:6px"><button data-openpanel="operate:0">24 h Forecast (1)</button><button data-openpanel="automation:0">Rules (3)</button></div>`;
      } else if (kind === 'slide') {
        body = `<p class="muted" style="font-size:12px;margin:0 0 6px">Chute down to the lower lake. Click Ride to hop in!</p><div class="row"><button class="on" data-rideslide>Ride water slide!</button><button data-openpanel="world:0">Stations (6)</button></div>`;
      } else {
        body = `${kv('Upper / Lower lake', `${pct(ps.upPct)} / ${pct(ps.loPct)}`)}${kind === 'lower' ? `<button ${J({ type: 'EXCAVATE' })} style="margin-top:6px">Excavate lower basin</button>` : ''}`;
      }
      body += `<div class="row" style="margin-top:8px;padding-top:6px;border-top:1px dotted var(--hair)"><button data-wait="h1">Wait 1 h</button><button data-wait="peak">Next peak</button><button data-wait="morn">Morning</button></div>`;
    }
    const html = `<h3><span>${esc(title)}</span><button class="x" data-closecard aria-label="Close card">✕</button></h3>${body}`;
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
    el.hidden = false;
  }

  // ---- SCADA Drawer ----
  function fitCanvas(c) {
    const r = c.getBoundingClientRect(), pr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * pr)), h = Math.max(10, Math.round(r.height * pr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return pr;
  }
  function cssv(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }
  function drawSeries(c, series, opts) {
    const pr = fitCanvas(c), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H); g.font = (11 * pr) + 'px system-ui';
    const t2 = cssv('--text2');
    let mn = opts.min ?? 0, mx = opts.max ?? 1, any = false;
    for (const s of series) for (let i = 0; i < s.n; i++) { const v = s.get(i); if (Number.isFinite(v)) { any = true; if (opts.auto) { mn = Math.min(mn, v); mx = Math.max(mx, v); } } }
    if (!any) { g.fillStyle = t2; g.textAlign = 'center'; g.fillText('No SCADA samples yet — let time advance.', W / 2, H / 2); return; }
    if (mx - mn < 1e-6) mx = mn + 1;
    g.strokeStyle = cssv('--border'); g.lineWidth = 1; g.beginPath();
    const y0 = H - ((0 - mn) / (mx - mn)) * (H - 16 * pr) - 8 * pr;
    if (y0 > 0 && y0 < H) { g.moveTo(0, y0); g.lineTo(W, y0); }
    g.stroke();
    g.fillStyle = t2; g.textAlign = 'left';
    g.fillText(mx.toFixed(opts.dec || 0), 4 * pr, 12 * pr); g.fillText(mn.toFixed(opts.dec || 0), 4 * pr, H - 4 * pr);
    for (const s of series) {
      g.strokeStyle = s.color; g.lineWidth = (s.w || 1.5) * pr; g.setLineDash(s.dash ? [5 * pr, 4 * pr] : []);
      g.beginPath(); let st = false; const tot = s.total || s.n;
      for (let i = 0; i < s.n; i++) {
        const v = s.get(i); if (!Number.isFinite(v)) { st = false; continue; }
        const x = ((s.off || 0) + i) / Math.max(1, tot - 1) * W, y = H - ((v - mn) / (mx - mn)) * (H - 16 * pr) - 8 * pr;
        if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.setLineDash([]);
  }
  function openDrawer(on) {
    const d = $('drawer');
    d.hidden = on === undefined ? !d.hidden : !on;
    if (!d.hidden) {
      closePanel();
      const snap = game.getSnapshot();
      $('scadaSite').innerHTML = `<option value="active">Active site</option><option value="all">All sites</option>` + snap.sites.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('');
      $('scadaSite').value = UI.scadaSite;
      renderDrawer(true);
    }
  }
  function renderDrawer() {
    const d = $('drawer'); if (d.hidden) return;
    const snap = game.getSnapshot(); if (!snap) return;
    const s = activeSite(snap);
    const key = UI.scadaSite === 'active' ? String(snap.active) : UI.scadaSite;
    const R = rings[key] || null;
    const rg = (arr) => ({ n: R ? R.count : 0, get: i => arr[(R.head - R.count + i + 1440) % 1440] });
    if (R) {
      const fc = snap.market.forecast || [], tot = R.count + fc.length * 60;
      drawSeries($('cPrice'), [
        Object.assign(rg(R.price), { color: cssv('--text'), total: tot }),
        { n: fc.length * 60, get: i => fc[Math.floor(i / 60)], off: R.count, total: tot, color: cssv('--ochre'), dash: true }
      ], { min: 0, max: 50, auto: true });
      drawSeries($('cVol'), [Object.assign(rg(R.vu), { color: cssv('--ren') }), Object.assign(rg(R.vl), { color: cssv('--gen'), dash: true })], { min: 0, max: 100 });
      drawSeries($('cPow'), [Object.assign(rg(R.gen), { color: cssv('--gen') }), Object.assign(rg(R.pump), { color: cssv('--pump') }), Object.assign(rg(R.ren), { color: cssv('--ren') })], { min: -0.5, max: 1, auto: true, dec: 2 });
    } else {
      for (const id of ['cPrice', 'cVol', 'cPow']) drawSeries($(id), [], {});
    }
    const t = s.tel || {}, P = (t.pGen || 0) - (t.pPump || 0);
    $('telem').innerHTML = [
      ['H_g', `${num(t.Hg, 2)} m`], ['H_n', `${num(t.Hn, 2)} m`], ['H_f', `${num(t.hf, 3)} m`],
      ['Q', `${num(t.Q, 3)} m³/s`], ['v', `${num(t.v, 2)} m/s`], ['P', `${num(P / 1e6, 3)} MW`],
      ['η', pct((t.eta || 0) * 100)], ['Revenue rate', `${money(P / 1e6 * snap.market.price)}/h`]
    ].map(a => kv(a[0], a[1])).join('');

    const hgl = $('hgl'), pr = fitCanvas(hgl), g = hgl.getContext('2d'), W = hgl.width, H = hgl.height;
    g.clearRect(0, 0, W, H);
    const r = s.route;
    if (!r || !s.dam.built) { g.fillStyle = cssv('--text2'); g.fillText('No penstock/dam active.', 10 * pr, 20 * pr); return; }
    const zU = s.upper.bottom + Sim.resLevel(s.upper, s.upper.V), zL = s.lower.bottom + Sim.resLevel(s.lower, s.lower.V);
    const mn = Math.min(zL, ...r.map(p => p.y)) - 3, mx = zU + 6;
    const X = i => 8 * pr + i / (r.length - 1) * (W - 16 * pr), Y = z => H - 8 * pr - (z - mn) / (mx - mn) * (H - 16 * pr);
    g.strokeStyle = cssv('--text2'); g.lineWidth = 3.5 * pr; g.beginPath(); r.forEach((p, i) => i ? g.lineTo(X(i), Y(p.y)) : g.moveTo(X(i), Y(p.y))); g.stroke();
    g.setLineDash([5 * pr, 4 * pr]); g.strokeStyle = cssv('--ochre'); g.lineWidth = 2 * pr; g.beginPath();
    const hf = t.hf || 0;
    for (let i = 0; i < r.length; i++) { const fr = i / (r.length - 1), z = s.q > 0 ? zU - hf * fr : s.q < 0 ? zU + hf * fr : zU; i ? g.lineTo(X(i), Y(z)) : g.moveTo(X(i), Y(z)); }
    g.stroke(); g.setLineDash([]);
  }

  // ---- Modals (New Game & Restructure) ----
  function showStart() {
    const m = $('modal'); m.hidden = false; clock.pause();
    const seed = Math.floor(Date.now() % 100000);
    m.innerHTML = `<div class="pane" role="dialog" aria-labelledby="stT">
      <h1 id="stT" style="font-size:22px;margin-top:0">Hydropower Tycoon — Field Station</h1>
      <p class="muted" style="font-size:13px">Walk your valley in 3D, click plots to build renewables &amp; batteries, or press <b>1–6</b> to open your floating Oxford field notebook anytime.</p>
      <div class="section">
        <div class="lbl" style="margin-bottom:6px">Site type</div>
        <div class="seg"><button id="kClassic" aria-pressed="true">Two lakes (Classic)</button><button id="kProc" aria-pressed="false">Winding canyon (Procedural)</button></div>
        <div class="grid2" style="margin-top:10px">
          <div><label class="lbl" for="nSeed">Seed</label><input id="nSeed" type="number" value="${seed}"></div>
          <div><label class="lbl" for="nBias">Terrain</label><select id="nBias"><option value="gentle">Gentle</option><option value="balanced" selected>Balanced</option><option value="rugged">Rugged</option></select></div>
          <div><label class="lbl" for="nRiver">River size</label><select id="nRiver"><option value="small">Small</option><option value="medium" selected>Medium</option><option value="large">Large</option></select></div>
          <div><label class="row"><input type="checkbox" id="nDemo"> Demo (∞ funds)</label></div>
        </div>
        <label class="row" style="margin-top:6px"><input type="checkbox" id="nGod"> Assisted mode (god mode auto-operator)</label>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:10px">
        ${game.state ? '<button id="nCancel">Cancel</button>' : ''}
        <button id="nGo" class="on">Start station</button>
      </div>
    </div>`;
    let kind = 'classic';
    $('kClassic').onclick = () => { kind = 'classic'; $('kClassic').setAttribute('aria-pressed', 'true'); $('kProc').setAttribute('aria-pressed', 'false'); };
    $('kProc').onclick = () => { kind = 'proc'; $('kProc').setAttribute('aria-pressed', 'true'); $('kClassic').setAttribute('aria-pressed', 'false'); };
    if ($('nCancel')) $('nCancel').onclick = () => { m.hidden = true; clock.resume(); };
    $('nGo').onclick = () => {
      const o = { seed: (+$('nSeed').value >>> 0) || 1, kind, bias: $('nBias').value, river: $('nRiver').value, demo: $('nDemo').checked };
      m.hidden = true;
      closePanel();
      UI.card = null;
      game.newGame(o);
      bus.emit('game:new', {});
      act({ type: 'START' });
      if ($('nGod').checked) act({ type: 'SET_GOD', enabled: true, dispatch: true });
      clock.reset();
      toast('Station ready — press 1–6 for your Oxford notebook or walk with WASD.', 'info');
    };
  }

  function showRestructure(snap) {
    const m = $('modal'); if (!m.hidden) return;
    const ro = Sim.restructureOptions(snap);
    m.hidden = false; clock.pause();
    m.innerHTML = `<div class="pane" role="dialog">
      <h2 class="alarm">Overdraft — Restructure Station</h2>
      <p>Cash dropped to <b>${money(snap.cash)}</b>. Choose how to recover without losing your valley:</p>
      <div class="section">
        <b>Option 1: Refinance debt</b>
        <p class="muted" style="font-size:12px">Consolidates loans into ${money(ro.refiLoan)} at ${(C.fin.refiRate * 100).toFixed(0)}%/yr with ${money(C.fin.refiCash)} working capital (borrowing limited for ${C.fin.creditCutDays} days).</p>
        <button id="rRefi" class="on">Refinance &amp; continue</button>
      </div>
      ${ro.sellTiles && ro.sellTiles.length ? `<div class="section">
        <b>Option 2: Sell equipment</b>
        <p class="muted" style="font-size:12px">Sell tiles for 50% of cost to cover ${money(ro.need)} overdraft:</p>
        <div id="rTiles">${ro.sellTiles.map(t => `<label class="row"><input type="checkbox" data-sell="${t.site}:${t.tile}"> Site ${t.site + 1} tile ${(t.tile % 16) + 1} (${money(t.value)})</label>`).join('')}</div>
        <button id="rSell" style="margin-top:6px">Sell selected &amp; resume</button>
      </div>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button id="rSand">Continue in Sandbox (∞)</button></div>
    </div>`;
    $('rRefi').onclick = () => { const r = doAct({ type: 'RESTRUCTURE', plan: 'refinance' }); if (r.ok) { m.hidden = true; clock.resume(); } };
    if ($('rSell')) $('rSell').onclick = () => {
      const tiles = [];
      m.querySelectorAll('[data-sell]:checked').forEach(x => { const [si, ti] = x.dataset.sell.split(':'); tiles.push({ site: +si, tile: +ti }); });
      const r = doAct({ type: 'RESTRUCTURE', plan: 'sell', tiles });
      if (r.ok) { m.hidden = true; clock.resume(); }
    };
    $('rSand').onclick = () => { doAct({ type: 'CONTINUE_SANDBOX' }); m.hidden = true; clock.resume(); };
  }

  function renderAlerts() {
    const a = $('alerts'); if (a.hidden) return;
    const snap = game.getSnapshot(); if (!snap) return;
    a.innerHTML = '<h3>Alerts</h3>' + (snap.alerts.length
      ? snap.alerts.slice(0, 20).map(x => `<div class="alert ${x.sev}"><b>${x.sev === 'crit' ? '⚠ Critical' : x.sev === 'warn' ? '△ Warning' : 'ℹ Info'}</b> · D${x.day + 1} ${hourLabel(x.hour)}<br>${esc(x.msg)}</div>`).join('')
      : '<div class="empty">No alerts yet.</div>');
  }

  // ---- Event wiring ----
  root.addEventListener('pointerdown', (e) => { if ($('panel').contains(e.target)) UI.pdown = true; }, true);
  window.addEventListener('pointerup', () => setTimeout(() => { UI.pdown = false; }, 50), true);

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-tab], [data-tilebtn]');
    if (!t) return;
    const d = t.dataset;
    if (d.tool) { openPanel(d.tool); return; }
    if (d.nbjump) { UI.panel = null; openPanel(d.nbjump); return; }
    if (d.tab !== undefined && UI.panel) { UI.tab[UI.panel] = +d.tab; const n = UI.panel; UI.panel = null; openPanel(n); return; }
    if (d.j) { doAct(JSON.parse(d.j)); return; }
    if (d.tilebtn !== undefined) { UI.gridTile = +d.tilebtn; renderPanel(true); return; }
    if (d.tier) { const [k, i] = d.tier.split(':'); UI.tier[k] = +i; renderPanel(true); renderCard(true); return; }
    if (d.drawer !== undefined) { openDrawer(true); return; }
    if (d.closecard !== undefined) { if (UI.card && UI.card.kind === 'station') UI.dismissedStation = UI.card.station.id; UI.card = null; renderCard(true); return; }
    if (d.openpanel) { const [p, tb] = d.openpanel.split(':'); UI.tab[p] = +(tb || 0); UI.panel = null; openPanel(p); return; }
    if (d.pen !== undefined) { doAct({ type: 'REPLACE_PENSTOCK', D: +$('penD').value, mat: $('penM').value }); return; }
    if (d.resoffer !== undefined) { doAct({ type: 'SET_RESERVE_OFFER', mw: +$('resMW').value }); return; }
    if (d.loan) { doAct({ type: d.loan === 'take' ? 'TAKE_LOAN' : 'REPAY_LOAN', amount: +$('loanAmt').value }); return; }
    if (d.saverules !== undefined) {
      const res = collectRules($('pBody'));
      if (!res.ok) { toast(res.errors[0]?.msg || 'Check rule values', 'warn'); return; }
      doAct({ type: 'SET_RULES', rules: res.rules }); return;
    }
    if (d.wait) {
      const req = d.wait === 'h1' ? { kind: 'hours', h: 1 } : d.wait === 'peak' ? { kind: 'nextPeak' } : { kind: 'morning' };
      const r = clock.requestWait(req, game.state);
      if (!r.ok) toast(r.reason, 'warn');
      else toast('Waiting…', 'info');
      return;
    }
    if (d.goto && ctx.player) { const r = ctx.player.goTo(d.goto); if (r && r.ok) closePanel(); return; }
    if (d.rideslide !== undefined && ctx.player) { ctx.player.startSlide(); UI.card = null; renderCard(true); return; }
    if (d.overview !== undefined && ctx.player) { ctx.player.camera.toggleOverview(); renderPanel(true); return; }
    if (d.qbtn) { world.quality = d.qbtn; renderPanel(true); return; }
    if (d.themebtn) { UI.settings.theme = d.themebtn === 'brass' ? 'brass' : 'field'; applySettings(); renderPanel(true); return; }
    if (d.opensave !== undefined) { UI.panel = null; openPanel('save'); return; }
    if (d.newgame !== undefined) { closePanel(); showStart(); return; }
    if (d.save) {
      const res = store.write(d.save, game.makeSave());
      toast(res.ok ? `Saved to ${d.save}.` : res.reason, res.ok ? 'info' : 'warn');
      renderPanel(true); return;
    }
    if (d.load) {
      const res = store.read(d.load);
      if (!res.ok) { toast(res.reason, 'warn'); return; }
      const lr = game.loadSave(res.save);
      if (!lr.ok) { toast(lr.reason, 'warn'); return; }
      bus.emit('game:loaded', {}); clock.reset(); closePanel(); toast('Loaded save.', 'info');
      return;
    }
    if (d.del) { store.remove(d.del); renderPanel(true); return; }
    if (d.export !== undefined) {
      const blob = new Blob([JSON.stringify(game.makeSave(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `hydropower-day${game.state.day + 1}.json`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      return;
    }
    if (d.replay !== undefined) {
      const st = game.state; const rp = Sim.replay(st.init, game.log, st.tick);
      const ok = Sim.hashState(rp) === Sim.hashState(st);
      const msgEl = $('saveMsg');
      if (msgEl) msgEl.textContent = ok ? `Replay verified: ${game.log.length} actions match hash ${Sim.hashState(st)}.` : 'Replay diverged.';
      return;
    }
  });

  root.addEventListener('input', (e) => {
    const t = e.target, d = t.dataset;
    if (d.slider === 'flow') {
      act({ type: 'SET_FLOW', q: +t.value });
      const lbl = t.previousElementSibling;
      if (lbl) lbl.querySelector('span').textContent = `${(+t.value).toFixed(2)} m³/s`;
    } else if (d.slider === 'damh') {
      UI.damH = +t.value;
      renderPanel(true);
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset;
    if (d.autoen !== undefined) { doAct({ type: 'SET_RULES', enabled: t.checked }); return; }
    if (d.god) { doAct({ type: 'SET_GOD', [d.god]: t.checked }); return; }
    if (d.godn) { doAct({ type: 'SET_GOD', [d.godn]: +t.value }); return; }
    if (d.opt) { doAct({ type: 'SET_OPTION', key: d.opt, value: +t.value }); return; }
    if (d.plan) { UI.plan[d.plan] = +t.value; renderPanel(true); return; }
    if (d.set) { UI.settings[d.set] = t.checked; applySettings(); return; }
    if (t.id === 'penD') { UI.penD = +t.value; renderPanel(true); return; }
    if (t.id === 'penM') { UI.penMat = t.value; renderPanel(true); return; }
    if (t.id === 'importF' && t.files && t.files[0]) {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const obj = JSON.parse(fr.result);
          const err = validateSaveDeep(obj, Sim.validateSave, Sim.QUESTS.map(q => q.id));
          if (err) { toast(err, 'warn'); return; }
          const r = game.loadSave(obj);
          if (r.ok) { bus.emit('game:loaded', {}); clock.reset(); closePanel(); toast('Imported save.', 'info'); }
          else toast(r.reason, 'warn');
        } catch (_) { toast('Invalid JSON file.', 'warn'); }
      };
      fr.readAsText(t.files[0]);
    }
  });

  // Top bar & dock controls
  $('pClose').onclick = closePanel;
  $('dClose').onclick = () => openDrawer(false);
  $('bScada').onclick = () => openDrawer();
  const setSpeed = (idx) => {
    if (clock.mode === 'alert') clock.acknowledge(game.state);
    clock.setSpeedIndex(idx);
  };
  $('bPause').onclick = () => {
    if (clock.mode === 'pause') { clock.resume(); if (clock.mode === 'alert') clock.acknowledge(game.state); }
    else clock.pause();
  };
  $('bSlower').onclick = () => setSpeed(clock.speedIndex - 1);
  $('bFaster').onclick = () => setSpeed(clock.speedIndex + 1);
  root.querySelectorAll('[data-speed]').forEach(b => { b.onclick = () => setSpeed(+b.dataset.speed); });
  $('bBell').onclick = () => { $('alerts').hidden = !$('alerts').hidden; renderAlerts(); };
  $('siteSel').onchange = (e) => { doAct({ type: 'SET_ACTIVE', site: +e.target.value }); bus.emit('game:loaded', {}); };
  $('scadaSite').onchange = (e) => { UI.scadaSite = e.target.value; renderDrawer(); };
  for (const id of ['statCash', 'statProfit']) {
    const el = $(id);
    const go = () => { UI.tab.finance = 0; openPanel('finance'); };
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  }

  // Keyboard shortcuts: 1-6 menus, -/= speeds, Space/0 pause, F1 SCADA, Esc close
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    const inForm = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
    if (e.key === 'Escape') {
      if (inForm) e.target.blur();
      if (!$('modal').hidden && game.state && !game.state.bankrupt) { $('modal').hidden = true; clock.resume(); }
      else if (UI.panel) closePanel();
      else if (!$('drawer').hidden) openDrawer(false);
      else if (UI.card) { if (UI.card.kind === 'station') UI.dismissedStation = UI.card.station.id; UI.card = null; renderCard(true); }
      else if (!$('alerts').hidden) $('alerts').hidden = true;
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); openDrawer(); return; }
    if (inForm || !$('modal').hidden) return;
    const k = e.key.toLowerCase();
    const MENUS = ['operate', 'build', 'automation', 'services', 'finance', 'world'];
    if (k >= '1' && k <= '6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); openPanel(MENUS[+k - 1]); return;
    }
    if (k === '-' || k === '_') { e.preventDefault(); setSpeed(clock.speedIndex - 1); return; }
    if (k === '=' || k === '+') { e.preventDefault(); setSpeed(clock.speedIndex + 1); return; }
    if (k === '0' || k === ' ') {
      if (tag === 'BUTTON') return;
      e.preventDefault();
      if (clock.mode === 'pause') { clock.resume(); if (clock.mode === 'alert') clock.acknowledge(game.state); } else clock.pause();
    }
  });

  // Bus listeners (walk-to-station, 3D tile pick, alerts)
  bus.on('station:enter', ({ id }) => {
    if (UI.dismissedStation === id) return;
    const stn = ctx.player && ctx.player.stationById(id);
    if (!stn) return;
    UI.card = { kind: 'station', station: stn };
    renderCard(true);
  });
  bus.on('station:leave', ({ id }) => {
    if (UI.dismissedStation === id) UI.dismissedStation = null;
    if (UI.card && UI.card.kind === 'station' && UI.card.station.id === id) {
      UI.card = null; renderCard(true);
    }
  });
  bus.on('world:pick', (hit) => {
    if (!hit) return;
    if (hit.type === 'tile' || hit.type === 'desk') {
      const p = hit.parcel | 0;
      const ti = hit.tile !== undefined ? hit.tile : p * 16;
      UI.gridTile = ti;
      UI.card = { kind: 'tile', parcel: p, tile: ti };
      renderCard(true);
      if (UI.panel === 'build') renderPanel(true);
    }
  });
  bus.on('alert', (ev) => { if (ev && ev.text) toast(ev.text, ev.level === 'warn' ? 'warn' : 'info'); });
  bus.on('time:mode', (ev) => {
    if (ev && ev.mode === 'alert' && ev.text) {
      toast(`${ev.text} — clock slowed`, 'crit');
      clock.acknowledge(game.state);
    }
  });
  bus.on('sim:stepped', () => {
    sampleRings(game.state);
    const st = game.state;
    if (st && st.day !== UI.lastAutoDay) {
      if (UI.lastAutoDay >= 0 && isPlayed(st)) store.write('auto', game.makeSave());
      UI.lastAutoDay = st.day;
    }
  });

  function update(dtReal) {
    const snap = game.getSnapshot();
    if (!snap) return;
    const s = activeSite(snap);
    const [seas, em] = seasonOf(snap.doy);
    $('tSeason').textContent = `${em} ${seas} · Day ${snap.day + 1}`;
    const mm = String(Math.floor((snap.secInHour || 0) / 60)).padStart(2, '0');
    $('tClock').textContent = `${String(snap.hour).padStart(2, '0')}:${mm}`;
    $('tCash').textContent = money(snap.cash);
    $('tProfit').textContent = money(snap.fin.profitToday, { sign: true });
    $('tPrice').textContent = `$${num(snap.market.price, 0)}/MWh`;
    if (s) {
      const ps = plantStatus(snap, s, Sim);
      $('tPlant').textContent = `${ps.label} · ${pct(ps.upPct)}`;
    }

    const paused = clock.mode === 'pause';
    $('pauseTx').textContent = paused ? 'Play' : 'Pause';
    $('bPause').setAttribute('aria-pressed', String(!paused));
    const spIdx = clock.speedIndex;
    $('speedLbl').textContent = clock.mode === 'wait' ? 'Waiting' : paused ? 'Paused' : clock.mode === 'alert' ? 'Alert · 1m/s' : C.time.labels[spIdx] || '1 min/s';
    $('bSlower').disabled = spIdx <= 0;
    $('bFaster').disabled = spIdx >= C.time.labels.length - 1;
    root.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === spIdx)));

    $('bellN').textContent = snap.alerts.length ? String(snap.alerts.length) : '';

    // Hide single-site selector when <= 1 site is owned
    $('siteGrp').hidden = snap.sites.length <= 1;
    const sel = $('siteSel');
    const opts = snap.sites.map(x => x.name).join('|');
    if (sel.dataset.o !== opts) {
      sel.innerHTML = snap.sites.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('');
      sel.dataset.o = opts;
    }
    if (+sel.value !== snap.active) sel.value = String(snap.active);

    if (snap.bankrupt && $('modal').hidden) showRestructure(snap);

    const now = performance.now();
    if (UI.panel && now - UI.lastPanel > 450) { UI.lastPanel = now; renderPanel(false); }
    if (UI.card && now - UI.lastCard > 400) { UI.lastCard = now; renderCard(false); }
    if (!$('drawer').hidden && now - UI.lastDrawer > 500) { UI.lastDrawer = now; renderDrawer(); }
  }

  return {
    update,
    openPanel,
    closePanel,
    showStart,
    toast,
    say: (msg) => toast(msg, 'info'),
    get panel() { return UI.panel; }
  };
}
