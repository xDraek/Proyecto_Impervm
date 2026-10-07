import './style.css';
import { isMuted, play, setAmbienceLevel, setMuted, unlockAudio } from './audio.js';
import { clock, universe } from './config.js';
import { BUILDINGS } from './game/data.js';
import { Game, newState } from './game/Game.js';
import { freshIslandState, generateSector } from './game/world.js';
import { ClientGame } from './net/ClientGame.js';
import { ClientWorld } from './net/ClientWorld.js';
import { getToken, setToken } from './net/api.js';
import { World } from './scene/World.js';
import { Hud } from './ui/Hud.js';
import { showLanding } from './ui/landing.js';

const DAYNIGHT_KEY = 'imperium.daynight';
const scene = document.getElementById('scene');

function readDayNight() {
  try {
    return localStorage.getItem(DAYNIGHT_KEY) !== '0';
  } catch {
    return true;
  }
}

// El navegador solo deja sonar audio tras la primera interacción
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

boot();

async function boot() {
  if (getToken()) {
    try {
      startGame(await ClientGame.connect());
      return;
    } catch (err) {
      if (err.status === 401) setToken(null);
      startLanding(err.status === 401 ? 'Tu sesión ha caducado. Vuelve a entrar.' : err.message);
      return;
    }
  }
  startLanding();
}

// ── Pantalla principal ────────────────────────────────────────────────────────

/** Una isla de muestra que gira detrás del formulario de entrada. */
function startLanding(message) {
  const now = clock.now();
  const world = new ClientWorld();
  const home = { id: 'escaparate', type: 'jugador', x: 0, z: 0, size: 10, owner: 0, name: 'Imperium' };
  const neutrals = generateSector(0, 3);
  world.apply({ islands: [home, ...neutrals], states: Object.fromEntries(neutrals.map((i) => [i.id, freshIslandState(i, now)])), players: {} });
  const state = newState({ now, home: home.id, name: 'Imperium' });
  Object.assign(state.buildings, { ayuntamiento: 6, aserradero: 5, cantera: 4, granja: 4, mina: 3, fundicion: 3, mercado: 3, almacen: 5, academia: 4, templo: 3, cuartel: 3, puerto: 4, muralla: 3, coloso: 6 });
  Object.assign(state.units, { lancero: 14, arquero: 8, mercante: 2, trirreme: 1 });
  for (const isl of neutrals) state.known[isl.id] = { explored: true };
  const demo = new Game({ state, world, userId: 0, mode: 'mirror' });
  const view = new World(scene, demo, { showcase: true });
  view.setDayNight(false);
  view.renderer.setAnimationLoop((t) => view.update(0.016, t / 1000));

  showLanding({ message, onLogin: () => location.reload() });
}

// ── Partida ───────────────────────────────────────────────────────────────────

function startGame(game) {
  document.body.classList.remove('landing-mode');
  document.getElementById('landing').hidden = true;

  const isIsland = (id) => !!game.world.island(id);

  function select(id) {
    if (id && isIsland(id) && world.view !== 'mapa') setView('mapa');
    if (id && BUILDINGS[id] && world.view !== 'isla') setView('isla');
    world.select(id);
    hud.select(id);
  }

  function setView(view) {
    world.setView(view);
    hud.setView(view);
    setAmbienceLevel(view === 'mapa' ? 0.35 : 1);
    if (hud.selected && (view === 'mapa') !== isIsland(hud.selected)) {
      world.select(null);
      hud.select(null);
    }
  }

  const settings = {
    sound: () => !isMuted(),
    setSound: (on) => {
      setMuted(!on);
      if (on) unlockAudio();
    },
    dayNight: () => world.dayNight,
    setDayNight: (on) => {
      world.setDayNight(on);
      try {
        localStorage.setItem(DAYNIGHT_KEY, on ? '1' : '0');
      } catch {
        // sin almacenamiento: solo dura esta sesión
      }
    },
  };

  const logout = () => {
    setToken(null);
    location.reload();
  };

  const world = new World(scene, game, { onSelect: select });
  world.setDayNight(readDayNight());
  const hud = new Hud(game, { onSelect: select, onView: setView, settings, onLogout: logout });
  game.addEventListener('logout', logout);

  window.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'Escape') {
      if (!document.getElementById('modal').hidden) hud.closeModal();
      else select(null);
    }
    if (e.key === 'm' || e.key === 'M') setView(world.view === 'isla' ? 'mapa' : 'isla');
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('button, .list li, [data-select]')) play('click');
  });
  game.addEventListener('notify', (e) => {
    const { text, kind } = e.detail;
    if (text.includes('¡Velas piratas') || text.startsWith('⚔️')) play(kind === 'error' ? 'horn' : 'success');
    else if (kind === 'success') play('success');
    else if (kind === 'error') play('error');
  });
  if (universe.speed > 1) hud.toast(`Universo a velocidad ×${universe.speed}`);
  hud.toast(`Bienvenido, ${game.username}.`, 'success');

  game.start();
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

  // Acceso para depurar desde la consola
  window.__IMPERIUM__ = { game, world, hud, select, setView };
}
