import './style.css';
import { GAME_SPEED } from './config.js';
import { BUILDINGS, ISLAND_BY_ID, RESOURCES } from './game/data.js';
import { Game } from './game/Game.js';
import { World } from './scene/World.js';
import { Hud } from './ui/Hud.js';
import { fmtNum } from './ui/format.js';

const game = new Game();

function select(id) {
  if (id && ISLAND_BY_ID[id] && world.view !== 'mapa') setView('mapa');
  if (id && BUILDINGS[id] && world.view !== 'isla') setView('isla');
  world.select(id);
  hud.select(id);
}

function setView(view) {
  world.setView(view);
  hud.setView(view);
  if (hud.selected && (view === 'mapa') !== !!ISLAND_BY_ID[hud.selected]) {
    world.select(null);
    hud.select(null);
  }
}

const world = new World(document.getElementById('scene'), game, { onSelect: select });
const hud = new Hud(game, { onSelect: select, onView: setView });

window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select, textarea')) return;
  if (e.key === 'Escape') {
    if (!document.getElementById('modal').hidden) hud.closeModal();
    else select(null);
  }
  if (e.key === 'm' || e.key === 'M') setView(world.view === 'isla' ? 'mapa' : 'isla');
});

if (game.offlineGains && Object.keys(game.offlineGains).length) {
  const gains = Object.entries(game.offlineGains)
    .map(([res, n]) => `${RESOURCES[res].icon} +${fmtNum(n)}`)
    .join('  ');
  hud.toast(`Mientras no estabas: ${gains}`, 'success');
}
// Lo que pasó con la pestaña cerrada: unos cuantos avisos y el resto en los informes
for (const note of game.backlog.slice(-4)) hud.toast(note.text, note.kind);
if (game.backlog.length > 4) hud.toast(`Y ${game.backlog.length - 4} cosas más. Mira los informes 📜`);
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
window.__IMPERIUM__ = { game, world, hud, select, setView };
