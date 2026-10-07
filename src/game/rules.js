import { GAME_SPEED } from '../config.js';
import {
  BASE_PRODUCTION,
  BUILDINGS,
  COLONY_COST,
  ISLANDS,
  PLAYER_UNITS,
  RESEARCH,
  RESEARCH_COST_FACTOR,
  RESOURCES,
  RESOURCE_KEYS,
  UNITS,
} from './data.js';

// Fórmulas puras. Reciben el estado de la partida (o partes) y no lo modifican.

const TIME_FACTOR = 1.45;
const RESEARCH_TIME_FACTOR = 1.55;
const TOWN_SPEEDUP = 0.1;
const HOUR_MS = 3_600_000;

/** Investigación que mejora cada recurso. */
export const RESOURCE_RESEARCH = {
  madera: 'silvicultura',
  piedra: 'mineria',
  hierro: 'mineria',
  comida: 'agricultura',
  cristal: 'cristalografia',
  oro: 'comercio',
};

const lvl = (state, id) => state.buildings[id] ?? state.research?.[id] ?? 0;

export function scaleCost(baseCost, factor, level, mult = 1) {
  const k = factor ** (level - 1) * mult;
  const cost = {};
  for (const [res, base] of Object.entries(baseCost)) cost[res] = Math.floor(base * k);
  return cost;
}

export function multiplyCost(cost, n) {
  const out = {};
  for (const [res, v] of Object.entries(cost)) out[res] = v * n;
  return out;
}

// ── Edificios ────────────────────────────────────────────────────────────────

/** Coste para subir el edificio `id` hasta `level`. */
export function costFor(id, level) {
  const b = BUILDINGS[id];
  return scaleCost(b.baseCost, b.costFactor, level);
}

/** Segundos de obra para llevar `id` hasta `level`. */
export function buildSeconds(state, id, level) {
  const raw = BUILDINGS[id].baseTime * TIME_FACTOR ** (level - 1);
  const speed = (1 + TOWN_SPEEDUP * lvl(state, 'ayuntamiento')) * (1 + 0.08 * lvl(state, 'arquitectura'));
  return Math.max(1, Math.round(raw / speed / GAME_SPEED));
}

export function townSpeedup(townLevel) {
  return Math.round(TOWN_SPEEDUP * townLevel * 100);
}

// ── Investigación ────────────────────────────────────────────────────────────

export function researchCost(id, level) {
  return scaleCost(RESEARCH[id].baseCost, RESEARCH_COST_FACTOR, level);
}

export function researchSeconds(state, id, level) {
  const raw = RESEARCH[id].baseTime * RESEARCH_TIME_FACTOR ** (level - 1);
  const speed = 1 + 0.1 * Math.max(0, lvl(state, 'academia') - 1);
  return Math.max(1, Math.round(raw / speed / GAME_SPEED));
}

export function researchMax(id) {
  return RESEARCH[id].maxLevel ?? 10;
}

// ── Unidades ─────────────────────────────────────────────────────────────────

export function unitSeconds(state, id) {
  const u = UNITS[id];
  const speed = 1 + 0.1 * Math.max(0, lvl(state, u.building) - 1);
  return Math.max(1, Math.round(u.time / speed / GAME_SPEED));
}

/** Multiplicadores de combate de tus tropas. */
export function playerCombat(state) {
  return {
    atkMul: 1 + 0.1 * lvl(state, 'herreria'),
    hpMul: 1 + 0.1 * lvl(state, 'armaduras'),
  };
}

export function wallBonus(level) {
  return { hp: 0.1 * level, towers: 10 * level };
}

export function fleetSlots(state) {
  return lvl(state, 'puerto');
}

export function maxColonies(state) {
  return lvl(state, 'cartografia');
}

export function colonyCost(colonies) {
  return multiplyCost(COLONY_COST, 1 + colonies * 0.5);
}

export function fleetSpeedBonus(state) {
  return 1 + 0.1 * lvl(state, 'navegacion');
}

/** Segundos de viaje (solo ida) hasta una isla con una flota a cierta velocidad. */
export function travelSeconds(state, dist, speed) {
  return Math.max(1, Math.round((40 + dist * 7) / speed / fleetSpeedBonus(state) / GAME_SPEED));
}

// ── Economía ─────────────────────────────────────────────────────────────────

/** Producción por hora de un productor a un nivel dado (sin bonos ni base de la isla). */
export function producerOutput(id, level) {
  const b = BUILDINGS[id];
  if (!b.produces || level <= 0) return 0;
  return b.baseProduction * level * 1.1 ** level * GAME_SPEED;
}

export function researchBonus(state, res) {
  return 0.1 * lvl(state, RESOURCE_RESEARCH[res]);
}

export function colonyYield(island) {
  return island.yield * GAME_SPEED;
}

/** Todas las unidades que mantienes: en casa y en misiones. */
export function totalUnits(state) {
  const out = {};
  for (const id of PLAYER_UNITS) out[id] = state.units[id] ?? 0;
  for (const m of state.missions) {
    for (const [id, n] of Object.entries(m.units)) out[id] = (out[id] ?? 0) + n;
  }
  return out;
}

export function upkeepPerHour(state) {
  let total = 0;
  for (const [id, n] of Object.entries(totalUnits(state))) total += n * (UNITS[id].upkeep ?? 0);
  return total * GAME_SPEED;
}

/**
 * Economía por hora con su desglose. `net` ya descuenta el mantenimiento de las
 * tropas en comida. Con hambruna, el resto de la producción cae a la mitad.
 */
export function economy(state) {
  const base = {};
  const buildings = {};
  const research = {};
  const colonies = {};
  const gross = {};
  for (const res of RESOURCE_KEYS) {
    base[res] = BASE_PRODUCTION[res] * GAME_SPEED;
    buildings[res] = 0;
    colonies[res] = 0;
  }
  for (const [id, b] of Object.entries(BUILDINGS)) {
    if (b.produces) buildings[b.produces] += producerOutput(id, state.buildings[id] ?? 0);
  }
  for (const isl of ISLANDS) {
    if (state.islands[isl.id]?.colonized) colonies[isl.specialty] += colonyYield(isl);
  }
  for (const res of RESOURCE_KEYS) {
    research[res] = (base[res] + buildings[res]) * researchBonus(state, res);
    gross[res] = base[res] + buildings[res] + research[res] + colonies[res];
  }
  const upkeep = upkeepPerHour(state);
  const net = { ...gross, comida: gross.comida - upkeep };
  const hungry = {};
  for (const res of RESOURCE_KEYS) hungry[res] = res === 'comida' ? net.comida : net[res] * 0.5;
  return { base, buildings, research, colonies, gross, upkeep, net, hungry };
}

export function storageCapacity(state) {
  return Math.floor(1500 * 1.6 ** lvl(state, 'almacen') * (1 + 0.2 * lvl(state, 'logistica')));
}

/** Cuánto recibes por cada unidad de `from` al cambiarla por `to` en el mercado. */
export function tradeRate(state, from, to) {
  const efficiency = Math.min(0.92, 0.5 + 0.04 * lvl(state, 'mercado') + 0.04 * lvl(state, 'comercio'));
  return (RESOURCES[from].value / RESOURCES[to].value) * efficiency;
}

// ── Requisitos ───────────────────────────────────────────────────────────────

/** Requisitos no cumplidos: [{ id, level, kind: 'building' | 'research' }]. */
export function missingRequirements(state, requires = {}) {
  return Object.entries(requires)
    .filter(([id, need]) => lvl(state, id) < need)
    .map(([id, need]) => ({ id, level: need, kind: BUILDINGS[id] ? 'building' : 'research' }));
}

export function canAfford(resources, cost) {
  return Object.entries(cost).every(([res, n]) => resources[res] >= n);
}

export function requirementName(req) {
  return req.kind === 'building' ? BUILDINGS[req.id].name : RESEARCH[req.id].name;
}

export { HOUR_MS };
