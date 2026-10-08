import './style.css';
import { isMuted, musicOn, play, setAmbienceLevel, setMusic, setMuted, unlockAudio } from './audio.js';
import { clock, universe } from './config.js';
import { BUILDINGS, PLAYER_UNITS, UNITS } from './game/data.js';
import { Game, newState } from './game/Game.js';
import { freshIslandState, generateSector } from './game/world.js';
import { ClientGame } from './net/ClientGame.js';
import { ClientWorld } from './net/ClientWorld.js';
import { api, getToken, setToken } from './net/api.js';
import { connectLive } from './net/socket.js';
import { World } from './scene/World.js';
import { warmPortraits } from './scene/portraits.js';
import { Hud } from './ui/Hud.js';
import { showLanding } from './ui/landing.js';

const DAYNIGHT_KEY = 'imperium.daynight';
const QUALITY_KEY = 'imperium.quality';

/** Gráficos de alta calidad: por defecto sí en el ordenador y no en el móvil. */
function readQuality() {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved) return saved === 'alta';
  } catch {
    // sin almacenamiento
  }
  return !window.matchMedia?.('(pointer: coarse)').matches;
}
const NOTIFY_KEY = 'imperium.notify';
const scene = document.getElementById('scene');

function notifyOn() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

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
  // Enlaces de los correos: ?verificar=… confirma la cuenta (o un correo nuevo); ?clave=… pide otra contraseña
  const params = new URLSearchParams(location.search);
  const verify = params.get('verificar');
  const reset = params.get('clave');
  if (verify || reset) history.replaceState(null, '', location.pathname);
  if (reset) return startLanding(null, { mode: 'reset', resetToken: reset });
  if (verify) {
    try {
      const { token } = await api('POST', '/api/verify', { token: verify });
      setToken(token);
    } catch (err) {
      return startLanding(err.message);
    }
  }
  if (getToken()) {
    try {
      startGame(await ClientGame.connect());
      return;
    } catch (err) {
      if (err.status === 401) setToken(null);
      startLanding(err.status === 401 ? (/correo/.test(err.message) ? err.message : 'Tu sesión ha caducado. Vuelve a entrar.') : err.message);
      return;
    }
  }
  startLanding();
}

// ── Pantalla principal ────────────────────────────────────────────────────────

/** Una isla de muestra que gira detrás del formulario de entrada. */
function startLanding(message, opts = {}) {
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

  showLanding({ message, ...opts, onLogin: () => location.reload() });
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
    music: () => musicOn(),
    setMusic: (on) => setMusic(on),
    notify: () => notifyOn(),
    /** Activa los avisos del navegador (pide permiso). Devuelve si han quedado activos. */
    setNotify: async (on) => {
      let ok = on;
      if (on && 'Notification' in window && Notification.permission !== 'granted') ok = (await Notification.requestPermission()) === 'granted';
      if (on && !ok) hud.toast('El navegador no deja mostrar avisos. Revisa los permisos del sitio.', 'error');
      try {
        localStorage.setItem(NOTIFY_KEY, ok ? '1' : '0');
      } catch {
        // sin almacenamiento
      }
      return ok;
    },
    quality: () => world.high,
    setQuality: (on) => {
      world.setQuality(on);
      try {
        localStorage.setItem(QUALITY_KEY, on ? 'alta' : 'baja');
      } catch {
        // sin almacenamiento: solo dura esta sesión
      }
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
  world.setQuality(readQuality());
  const hud = new Hud(game, { onSelect: select, onView: setView, settings, onLogout: logout });
  game.addEventListener('logout', logout);

  // Los retratos de los menús se dibujan en los ratos libres: primero las tropas y lo ya construido
  warmPortraits([
    ...PLAYER_UNITS.map((id) => [UNITS[id].kind === 'barco' ? 'ship' : 'unit', id, { width: 120, height: 120 }]),
    ...Object.keys(BUILDINGS)
      .filter((id) => id !== 'muralla')
      .map((id) => ['building', id, { level: Math.max(1, game.level(id)), width: 340, height: 170 }]),
  ]);

  // Botones de la cámara (girar, acercar, alejar y centrar), sobre todo para el móvil
  const camControls = document.getElementById('cam-controls');
  camControls.hidden = false;
  camControls.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-cam]')?.dataset.cam;
    if (kind === 'home') world.recenter();
    else if (kind) world.nudgeCamera({ rotate: kind === 'rotl' ? 0.6 : kind === 'rotr' ? -0.6 : 0, zoom: kind === 'in' ? 0.7 : kind === 'out' ? 1.4 : 1 });
  });

  // Atajos de la barra superior (1-7, en su orden) y rótulos que salen al momento con el ratón
  const SHORTCUTS = ['quests-btn', 'chat-btn', 'mail-btn', 'alliance-btn', 'rank-btn', 'map-btn', 'reports-btn', 'army-btn', 'friends-btn'];
  for (const el of document.querySelectorAll('#topbar .top-actions .icon-btn[title], #view-btn')) {
    const key = SHORTCUTS.indexOf(el.id) + 1;
    el.dataset.tip = key ? `${el.title} · ${key}` : el.title;
    el.setAttribute('aria-label', el.title);
    el.removeAttribute('title');
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const shortcut = SHORTCUTS[Number(e.key) - 1];
    if (shortcut) document.getElementById(shortcut)?.click();
    if (e.key === 'Escape') {
      if (!document.getElementById('modal').hidden) hud.closeModal();
      else select(null);
    }
    if (e.key === 'm' || e.key === 'M') setView(world.view === 'isla' ? 'mapa' : 'isla');
    if (e.key === '?') hud.openGuide();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('button, .list li, [data-select]')) play('click');
  });
  game.addEventListener('notify', (e) => {
    const { text, kind } = e.detail;
    // Con la pestaña en segundo plano, lo importante también como aviso del navegador
    const important = kind === 'error' || /⚔️|🏴‍☠️|🛡️|✉️/.test(text);
    if (document.hidden && important && notifyOn()) {
      try {
        new Notification('Imperium', { body: text, tag: 'imperium' });
      } catch {
        // algunos navegadores no dejan crear avisos así
      }
    }
    if (text.includes('¡Velas piratas') || text.startsWith('⚔️')) play(kind === 'error' ? 'horn' : 'success');
    else if (kind === 'success') play('success');
    else if (kind === 'error') play('error');
  });
  if (universe.speed > 1) hud.toast(`Universo a velocidad ×${universe.speed}`);
  hud.toast(`Bienvenido, ${game.username}.`, 'success');

  // Ataques que se acercan: aviso del navegador una vez por flota
  const warned = new Set();
  game.addEventListener('change', () => {
    for (const m of game.incoming ?? []) {
      if (warned.has(m.id)) continue;
      warned.add(m.id);
      if (document.hidden && notifyOn()) {
        try {
          new Notification('Imperium · ¡Te atacan!', { body: `${m.from} viene hacia tu isla con ${m.size} unidades`, tag: `ataque-${m.id}` });
        } catch {
          // sin avisos
        }
      }
    }
  });

  // Jugadores nuevos: bienvenida; luego, el regalo del día si está disponible
  let welcomed = true;
  try {
    welcomed = localStorage.getItem(`imperium.welcome.${game.userId}`) === '1';
  } catch {
    // sin almacenamiento
  }
  if (!welcomed && game.score() < 50) hud.social.openWelcome();
  else if (game.dailyStatus().available) hud.social.openDaily();

  game.start();
  connectLive(game, {
    onChat: (m) => hud.receiveChat(m),
    onChatDelete: (id) => hud.removeChat(id),
    onBanned: () => {
      setToken(null);
      alert('Tu cuenta ha sido suspendida.');
      location.reload();
    },
  });
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
