import { GAME_SPEED } from '../config.js';
import { BASE_PRODUCTION, BUILDINGS, RESOURCE_KEYS } from './data.js';

const TIME_FACTOR = 1.45;
const TOWN_SPEEDUP = 0.1;

/** Coste para subir el edificio `id` hasta `level`. */
export function costFor(id, level) {
  const b = BUILDINGS[id];
  const factor = b.costFactor ** (level - 1);
  const cost = {};
  for (const [res, base] of Object.entries(b.baseCost)) cost[res] = Math.floor(base * factor);
  return cost;
}

/** Segundos de obra para llevar `id` hasta `level`. */
export function buildSeconds(id, level, townLevel) {
  const raw = BUILDINGS[id].baseTime * TIME_FACTOR ** (level - 1);
  return Math.max(1, Math.round(raw / (1 + TOWN_SPEEDUP * townLevel) / GAME_SPEED));
}

export function townSpeedup(townLevel) {
  return Math.round(TOWN_SPEEDUP * townLevel * 100);
}

/** Producción por hora de un productor a un nivel dado (sin la base de la isla). */
export function producerOutput(id, level) {
  const b = BUILDINGS[id];
  if (!b.produces || level <= 0) return 0;
  return b.baseProduction * level * 1.1 ** level * GAME_SPEED;
}

export function productionPerHour(buildings) {
  const out = {};
  for (const res of RESOURCE_KEYS) out[res] = BASE_PRODUCTION[res] * GAME_SPEED;
  for (const [id, b] of Object.entries(BUILDINGS)) {
    if (b.produces) out[b.produces] += producerOutput(id, buildings[id] ?? 0);
  }
  return out;
}

export function storageCapacity(almacenLevel) {
  return Math.floor(1500 * 1.6 ** almacenLevel);
}

/** Requisitos no cumplidos: [{ id, level }]. */
export function missingRequirements(buildings, id) {
  const reqs = BUILDINGS[id].requires ?? {};
  return Object.entries(reqs)
    .filter(([req, lvl]) => (buildings[req] ?? 0) < lvl)
    .map(([req, lvl]) => ({ id: req, level: lvl }));
}

export function canAfford(resources, cost) {
  return Object.entries(cost).every(([res, n]) => resources[res] >= n);
}
