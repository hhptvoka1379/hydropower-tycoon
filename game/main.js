// Toolchain proof: bundle + THREE global + sim in a browser. Replace with the real client.
import { Sim, createGame } from './sim/index.js';

const game = createGame();
game.newGame({ seed: 1 });
game.dispatch({ type: 'START' });

document.body.innerHTML =
  '<div id="app"><h1>Hydropower Tycoon - Fable build</h1>' +
  '<div id="hud"></div><canvas id="gl" width="480" height="270"></canvas><div id="msg"></div></div>';
const hud = document.getElementById('hud');
const msg = document.getElementById('msg');

function paint() {
  const s = game.getSnapshot();
  hud.textContent = s ? 'Day ' + s.day + '  Cash ' + Math.round(s.cash) : 'no game';
  // advance about 6 sim hours per real second so the HUD visibly changes
  game.runHeadless(Math.ceil(6 * 3600 / Sim.CONFIG.time.dtBySpeed[game.state.speed]));
}
paint();
setInterval(paint, 1000);

try {
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true });
  renderer.setClearColor(0x12283a);
  renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  msg.textContent = 'THREE r' + THREE.REVISION + ' WebGL OK';
} catch (e) {
  msg.textContent = 'WebGL unavailable: ' + (e && e.message ? e.message : e);
}
