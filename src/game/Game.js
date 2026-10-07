import { SAVE_KEY } from '../config.js';
import { BUILDINGS, BUILDING_KEYS, RESOURCE_KEYS, STARTING_RESOURCES } from './data.js';
import {
  buildSeconds,
  canAfford,
  costFor,
  missingRequirements,
  productionPerHour,
  storageCapacity,
} from './rules.js';

const SAVE_VERSION = 1;

function newState(now) {
  const buildings = {};
  for (const id of BUILDING_KEYS) buildings[id] = BUILDINGS[id].startLevel ?? 0;
  return {
    version: SAVE_VERSION,
    resources: { ...STARTING_RESOURCES },
    buildings,
    queue: null,
    lastUpdate: now,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.version !== SAVE_VERSION) return null;
    const base = newState(saved.lastUpdate ?? Date.now());
    return {
      ...base,
      ...saved,
      resources: { ...base.resources, ...saved.resources },
      buildings: { ...base.buildings, ...saved.buildings },
    };
  } catch {
    return null;
  }
}

/**
 * Estado y reglas de la partida. Todo se calcula a partir de marcas de tiempo,
 * así que la producción y las obras avanzan aunque la página esté cerrada.
 *
 * Eventos: 'change' (cualquier cambio de niveles o cola) y
 * 'completed' (detail: { id, level }).
 */
export class Game extends EventTarget {
  constructor() {
    super();
    const now = Date.now();
    this.state = loadState() ?? newState(now);
    const before = { ...this.state.resources };
    const away = now - this.state.lastUpdate;
    this.completedWhileAway = this.#advance(now);
    this.offlineGains = away > 60_000 ? diff(this.state.resources, before) : null;
  }

  level(id) {
    return this.state.buildings[id] ?? 0;
  }

  get resources() {
    return this.state.resources;
  }

  get queue() {
    return this.state.queue;
  }

  production() {
    return productionPerHour(this.state.buildings);
  }

  capacity() {
    return storageCapacity(this.level('almacen'));
  }

  /** Información de la próxima mejora de un edificio. */
  nextUpgrade(id) {
    const level = this.level(id) + 1;
    const cost = costFor(id, level);
    const missing = missingRequirements(this.state.buildings, id);
    const cap = this.capacity();
    return {
      level,
      cost,
      seconds: buildSeconds(id, level, this.level('ayuntamiento')),
      missing,
      affordable: canAfford(this.state.resources, cost),
      exceedsStorage: Object.values(cost).some((n) => n > cap),
    };
  }

  /** Segundos hasta poder pagar `cost` al ritmo actual (Infinity si nunca). */
  secondsUntilAffordable(cost) {
    const prod = this.production();
    const cap = this.capacity();
    let worst = 0;
    for (const [res, n] of Object.entries(cost)) {
      const lack = n - this.state.resources[res];
      if (lack <= 0) continue;
      if (n > cap || prod[res] <= 0) return Infinity;
      worst = Math.max(worst, (lack / prod[res]) * 3600);
    }
    return worst;
  }

  update(now = Date.now()) {
    const completed = this.#advance(now);
    for (const c of completed) this.dispatchEvent(new CustomEvent('completed', { detail: c }));
    if (completed.length) this.#changed();
  }

  upgrade(id, now = Date.now()) {
    this.#advance(now);
    if (this.state.queue) return { ok: false, reason: 'Ya hay una obra en marcha.' };
    const next = this.nextUpgrade(id);
    if (next.missing.length) return { ok: false, reason: 'No cumples los requisitos.' };
    if (!next.affordable) return { ok: false, reason: 'No tienes recursos suficientes.' };

    for (const [res, n] of Object.entries(next.cost)) this.state.resources[res] -= n;
    this.state.queue = { id, level: next.level, start: now, end: now + next.seconds * 1000, cost: next.cost };
    this.#changed();
    return { ok: true };
  }

  cancel() {
    const q = this.state.queue;
    if (!q) return;
    for (const [res, n] of Object.entries(q.cost)) this.state.resources[res] += n;
    this.state.queue = null;
    this.#changed();
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch {
      // Sin almacenamiento disponible (modo privado, cuota…): la partida sigue en memoria.
    }
  }

  reset() {
    this.state = newState(Date.now());
    this.save();
    this.#changed();
  }

  #changed() {
    this.save();
    this.dispatchEvent(new Event('change'));
  }

  /** Avanza el tiempo hasta `now`, cerrando las obras que terminen por el camino. */
  #advance(now) {
    const completed = [];
    const q = this.state.queue;
    if (q && q.end <= now) {
      this.#accrue(q.end);
      this.state.buildings[q.id] = q.level;
      this.state.queue = null;
      completed.push({ id: q.id, level: q.level });
    }
    this.#accrue(now);
    return completed;
  }

  #accrue(t) {
    const s = this.state;
    const hours = Math.max(0, t - s.lastUpdate) / 3_600_000;
    s.lastUpdate = t;
    if (hours === 0) return;
    const prod = productionPerHour(s.buildings);
    const cap = storageCapacity(s.buildings.almacen);
    for (const res of RESOURCE_KEYS) {
      const cur = s.resources[res];
      if (cur < cap) s.resources[res] = Math.min(cap, cur + prod[res] * hours);
    }
  }
}

function diff(after, before) {
  const out = {};
  for (const res of RESOURCE_KEYS) {
    const d = Math.floor(after[res] - before[res]);
    if (d > 0) out[res] = d;
  }
  return out;
}
