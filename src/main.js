import './style.css';
import { GAME_SPEED } from './config.js';
import { RESOURCES } from './game/data.js';
import { Game } from './game/Game.js';
import { World } from './scene/World.js';
import { Hud } from './ui/Hud.js';
import { fmtNum } from './ui/format.js';

const game = new Game();

function select(id) {
  world.select(id);
  hud.select(id);
}

const world = new World(document.getElementById('scene'), game, { onSelect: select });
const hud = new Hud(game, { onSelect: select });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') select(null);
});

if (game.offlineGains && Object.keys(game.offlineGains).length) {
  const gains = Object.entries(game.offlineGains)
    .map(([res, n]) => `${RESOURCES[res].icon} +${fmtNum(n)}`)
    .join('  ');
  hud.toast(`Mientras no estabas: ${gains}`, 'success');
}
if (GAME_SPEED > 1) hud.toast(`Universo a velocidad ×${GAME_SPEED}`);

let last = performance.now();
let hudTimer = 0;
world.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.update();
  world.update(dt, now / 1000);
  hudTimer += dt;
  if (hudTimer > 0.2) {
    hudTimer = 0;
    hud.update();
  }
});

setInterval(() => game.save(), 5000);
document.addEventListener('visibilitychange', () => document.hidden && game.save());
window.addEventListener('beforeunload', () => game.save());

// Acceso para depurar desde la consola
window.__IMPERIUM__ = { game, world, hud, select };
