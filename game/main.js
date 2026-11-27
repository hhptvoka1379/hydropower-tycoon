// Boot: game + ctx + world + player + clock + UI + frame loop. ctx = { Sim, game, bus, act, clock, world, surface, player, ui } (decisions/fable.md D2).
// URL params: ?site=canyon  ?hour=12|18.5|0  ?doy=172  ?at=<stationId> (spawn the player at a station)   window.__HT = ctx.   Key ] cycles the debug clock rate.
import { Sim, createGame } from './sim/index.js';
import { createBus, createAct } from './app/bus.js';
import { createWorld } from './world/index.js';
import { createClock } from './player/timemode.js';
import { createPlayer } from './player/index.js';
import { createUI } from './ui/index.js';

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const CLASSIC = { seed: 14692 };
const CANYON = { seed: 4242, kind: 'proc', bias: 'balanced', river: 'medium' };
const CANYON_SETUP = [{ type: 'TAKE_LOAN', amount: 700000 }, { type: 'PLACE_DAM', height: 12 }];

const game = createGame();
const bus = createBus();
const act = createAct(game, bus);
const canyon = params.get('site') === 'canyon';
game.newGame(canyon ? CANYON : CLASSIC);
bus.emit('game:new', {});
if (canyon) for (const a of CANYON_SETUP) { const r = act(a); if (!r.ok) console.warn('canyon setup rejected', a, r.reason); }
act({ type: 'START' });

/* ?hour= / ?doy= set the SIM clock: the sim has no start-time option for a new game (CONFIG.time.startHour is fixed), so the game is stepped normally from its start
   to the wanted time before the first frame (coarse 5 min steps, then 1 min steps for a fractional hour). Nothing is edited mid-run: it is the sim running, the HUD
   shows the same clock the sky uses, and world.debugSetTime (sky only) is no longer used by the URL. A `newGame({hour, doy})` option in the sim would make this a one-liner. */
function fastForward(h, d) {
  const st = game.state, whole = Math.floor(h === undefined ? st.hour : h), secs = ((h === undefined ? st.hour : h) - whole) * 3600;
  let hours = ((d === undefined ? st.doy : ((d % 360) + 360) % 360) - st.doy + 360) % 360 * 24 + (whole - st.hour);
  if (hours <= 0 && (d === undefined || ((d % 360) + 360) % 360 === st.doy)) hours += 24;
  if (hours < 0) hours += 8640;
  const saved = st.speed, target = st.H + hours;
  st.speed = 5;
  while (st.H < target) if (!Sim.step(st)) break;
  st.speed = 3;
  while (secs > 0 && st.secInHour < secs) if (!Sim.step(st)) break;
  st.speed = saved;
}
if (params.has('hour') || params.has('doy')) fastForward(params.has('hour') ? parseFloat(params.get('hour')) : undefined, params.has('doy') ? parseFloat(params.get('doy')) : undefined);

const clock = createClock(Sim);
const ctx = { Sim, game, bus, act, clock, world: null, surface: null, player: null, ui: null };
const world = createWorld(ctx);
ctx.world = world;
ctx.player = createPlayer(ctx);          // listens for world:rebuilt: stations, paths and flights are built after the world has its crest provider
world.build(game.state);
window.__HT = ctx;

const cv = world.canvas;
cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
document.body.appendChild(cv);
ctx.ui = createUI(ctx);
ctx.hud = ctx.ui;

if (params.has('at') && !ctx.player.spawnAt(params.get('at'))) console.warn('unknown station for ?at=', params.get('at'));
window.addEventListener('keydown', (e) => { if (e.key === ']') { const r = clock.cycleDebug(); ctx.ui.say('Clock rate: ' + r + ' sim s / real s'); } });

let last = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  const dtReal = last ? Math.min(0.1, (ms - last) / 1000) : 0.016;
  last = ms;
  if (!document.hidden) {
    const r = clock.advance(dtReal, game.state);
    if (r.steps) { bus.emit('sim:stepped', { steps: r.steps }); game.markDirty(); }
  }
  ctx.player.frame(dtReal);
  ctx.ui.update(dtReal);
  world.frame(dtReal, { width: window.innerWidth, height: window.innerHeight });
}
requestAnimationFrame(frame);
