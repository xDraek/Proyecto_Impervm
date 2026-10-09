import { universe } from '../config.js';
import {
  BASE_PRODUCTION,
  BUILDINGS,
  COLONY,
  COLONY_COST,
  OCCUPATION,
  PLAYER_UNITS,
  RESEARCH,
  RESEARCH_COST_FACTOR,
  RESOURCES,
  RESOURCE_KEYS,
  UNITS,
  RELICS,
  WONDERS,
  WONDER_KEYS,
  WONDER_LEVELS,
  WORLD_EVENTS,
  WORLD_EVENT_CHANCE,
  WORLD_EVENT_HOURS,
  WORK,
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

export function buildingMax(id) {
  return BUILDINGS[id].maxLevel ?? Infinity;
}

/** Coste para subir el edificio `id` hasta `level`. */
export function costFor(id, level) {
  const b = BUILDINGS[id];
  return scaleCost(b.baseCost, b.costFactor, level);
}

/** Segundos de obra para llevar `id` hasta `level`. */
export function buildSeconds(state, id, level) {
  const raw = BUILDINGS[id].baseTime * TIME_FACTOR ** (level - 1);
  const speed = (1 + TOWN_SPEEDUP * lvl(state, 'ayuntamiento')) * (1 + 0.08 * lvl(state, 'arquitectura'));
  return Math.max(1, Math.round(raw / speed / universe.speed));
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
  const speed = (1 + 0.1 * Math.max(0, lvl(state, 'academia') - 1)) * (1 + wonderBonus(state, 'investigacion'));
  return Math.max(1, Math.round(raw / speed / universe.speed));
}

export function researchMax(id) {
  return RESEARCH[id].maxLevel ?? 10;
}

// ── Unidades ─────────────────────────────────────────────────────────────────

export function unitSeconds(state, id) {
  const u = UNITS[id];
  let speed = 1 + 0.1 * Math.max(0, lvl(state, u.building) - 1);
  if (u.building === 'puerto') speed *= 1 + 0.08 * lvl(state, 'astillero');
  return Math.max(1, Math.round(u.time / speed / universe.speed));
}

/** Multiplicadores de combate de tus tropas. */
export function playerCombat(state) {
  return {
    atkMul: 1 + 0.1 * lvl(state, 'herreria') + 0.03 * lvl(state, 'forja') + 0.03 * lvl(state, 'tactica') + wonderBonus(state, 'ataque') + relicBonus(state, 'ataque'),
    hpMul: 1 + 0.1 * lvl(state, 'armaduras') + 0.03 * lvl(state, 'tactica') + relicBonus(state, 'defensa'),
  };
}

/** Vida extra de tus barcos cuando defienden tu ciudad: el faro guía a los tuyos (+4 % por nivel). */
export function navalDefense(faroLevel) {
  return 0.04 * faroLevel;
}

/** Defensa de la muralla; la torre de vigía añade arqueros a las torres. */
export function wallBonus(level, watch = 0) {
  return { hp: 0.1 * level, towers: 10 * level + 8 * watch };
}

/** Comida que se ahorran las tropas gracias a la taberna (0 a 0,4). */
export function tavernSaving(state) {
  return Math.min(0.4, 0.04 * lvl(state, 'taberna'));
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
  return 1 + 0.1 * lvl(state, 'navegacion') + 0.04 * lvl(state, 'faro') + wonderBonus(state, 'velocidad') + relicBonus(state, 'velocidad');
}

/** Segundos de viaje (solo ida) hasta una isla con una flota a cierta velocidad. */
/** `extra`: multiplicador de velocidad adicional (por ejemplo, el almirante). */
export function travelSeconds(state, dist, speed, extra = 1) {
  return Math.max(1, Math.round((40 + dist * 7) / speed / fleetSpeedBonus(state) / extra / universe.speed));
}

// ── Economía ─────────────────────────────────────────────────────────────────

/** Producción por hora de un productor a un nivel dado (sin bonos ni base de la isla). */
export function producerOutput(id, level) {
  const b = BUILDINGS[id];
  if (!b.produces || level <= 0) return 0;
  return b.baseProduction * level * 1.1 ** level * universe.speed;
}

/** Qué parte de los trabajadores de un edificio productor está produciendo (de 0 a 1). */
export function workShare(state, id) {
  const w = state.work?.[id];
  return w == null ? 1 : Math.min(100, Math.max(0, w)) / 100;
}

/** ¿Se pueden repartir los trabajadores de este edificio? (los que producen, salvo el oro del mercado) */
export function hasWorkers(id) {
  const res = BUILDINGS[id]?.produces;
  return !!res && res !== 'oro';
}

/** Oro por hora que pagan los trabajadores libres de un edificio. */
export function workTaxes(id, level, share) {
  const res = BUILDINGS[id].produces;
  return producerOutput(id, level) * (1 - share) * (RESOURCES[res].value / RESOURCES.oro.value) * WORK.taxShare;
}

export function researchBonus(state, res) {
  return 0.1 * lvl(state, RESOURCE_RESEARCH[res]);
}

/** Lo que da una colonia (o una isla libre si la colonizaras) por hora. */
export function colonyYield(island) {
  return island.yield * universe.speed * (1 + COLONY.yieldPerLevel * ((island.level ?? 1) - 1));
}

/** Coste y duración (segundos) de ampliar una colonia de `level` a `level + 1`. */
export function colonyUpgrade(level) {
  return {
    cost: Object.fromEntries(Object.entries(multiplyCost(COLONY.upgradeCost, COLONY.costFactor ** (level - 1))).map(([r, n]) => [r, Math.round(n / 10) * 10])),
    seconds: Math.max(1, Math.round((COLONY.upgradeMinutes * 60 * COLONY.timeFactor ** (level - 1)) / universe.speed)),
  };
}

// ── Maravillas ──────────────────────────────────────────────────────────────

/** Qué maravilla tiene un continente (los antiguos no la traen guardada). */
export function wonderOf(continent) {
  if (continent.wonder && WONDERS[continent.wonder]) return continent.wonder;
  let h = 0;
  for (const ch of String(continent.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WONDER_KEYS[h % WONDER_KEYS.length];
}

/** Nivel de una maravilla según lo aportado. */
export function wonderLevel(progress = 0) {
  return WONDER_LEVELS.filter((n) => progress >= n).length;
}

/** Bono de las reliquias equipadas para una estadística. */
export function relicBonus(state, stat) {
  let k = 0;
  for (const r of state.relics ?? []) if (r.equipped && RELICS[r.id]?.stat === stat) k += RELICS[r.id].value;
  return k;
}

/** Bono de las maravillas para un jugador (lo guarda el servidor en el estado). */
function wonderBonus(state, stat) {
  return state.wonderBonus?.[stat] ?? 0;
}

// ── Eventos del archipiélago ─────────────────────────────────────────────────

/** Duración de cada tramo del calendario, en milisegundos (un número entero). */
export function worldEventSpan() {
  return Math.max(60_000, Math.round((WORLD_EVENT_HOURS * HOUR_MS) / universe.speed));
}

/** El evento que hay en el instante `t` (o `id: null` si es un tramo tranquilo), con su principio y su final. */
export function worldEventAt(t) {
  const span = worldEventSpan();
  const idx = Math.floor(t / span);
  const r = hash01(universe.eventSeed, idx);
  const keys = Object.keys(WORLD_EVENTS);
  const id = r < WORLD_EVENT_CHANCE ? keys[Math.floor((r / WORLD_EVENT_CHANCE) * keys.length)] : null;
  return { id, event: id ? WORLD_EVENTS[id] : null, start: idx * span, end: (idx + 1) * span };
}

/** Los `n` tramos siguientes al de `t` (para el calendario). */
export function upcomingWorldEvents(t, n = 4) {
  const out = [];
  let cur = worldEventAt(t);
  for (let i = 0; i < n; i++) {
    cur = worldEventAt(cur.end);
    out.push(cur);
  }
  return out;
}

function hash01(seed, n) {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(n, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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
  return total * universe.speed * (1 - tavernSaving(state));
}

/** Oro por hora que cobran las tropas de élite (las de casa y las que están en el mar). */
export function payPerHour(state) {
  let total = 0;
  for (const [id, n] of Object.entries(totalUnits(state))) total += n * (UNITS[id].pay ?? 0);
  return total * universe.speed;
}

/** Multiplicador de toda la producción: Coloso y Cosecha abundante. */
export function productionBonus(state, t = state.lastUpdate) {
  let k = 1 + 0.05 * lvl(state, 'coloso');
  if ((state.buffs?.cosecha ?? 0) > t) k *= 1.25;
  return k;
}

/**
 * Economía por hora con su desglose. `net` ya descuenta el mantenimiento de las
 * tropas en comida. Con hambruna, el resto de la producción cae a la mitad.
 */
export function economy(state, t = state.lastUpdate) {
  const bonus = productionBonus(state, t);
  const base = {};
  const buildings = {};
  const research = {};
  const colonies = {};
  const gross = {};
  for (const res of RESOURCE_KEYS) {
    base[res] = BASE_PRODUCTION[res] * universe.speed;
    buildings[res] = 0;
    colonies[res] = 0;
  }
  // Los trabajadores que no producen comercian y pagan impuestos en oro
  let taxes = 0;
  for (const [id, b] of Object.entries(BUILDINGS)) {
    if (!b.produces) continue;
    const level = state.buildings[id] ?? 0;
    const share = hasWorkers(id) ? workShare(state, id) : 1;
    buildings[b.produces] += producerOutput(id, level) * share;
    if (share < 1) taxes += workTaxes(id, level, share);
  }
  // Con el puerto bloqueado u ocupado, las colonias no pueden mandar nada a la capital
  const closed = portClosed(state);
  for (const col of state.colonies ?? []) if (!(col.raidedUntil > t) && !closed) colonies[col.specialty] += colonyYield(col);
  const event = worldEventAt(t).event;
  const eventBonus = {};
  for (const res of RESOURCE_KEYS) {
    research[res] = (base[res] + buildings[res]) * researchBonus(state, res);
    eventBonus[res] = event?.prod?.[res] ?? 0;
    const wonder = res === 'comida' ? wonderBonus(state, 'comida') : 0;
    const relic = relicBonus(state, 'produccion') + (res === 'comida' ? relicBonus(state, 'comida') : 0) + (res === 'oro' ? relicBonus(state, 'oro') : 0);
    gross[res] = (base[res] + buildings[res] + research[res] + colonies[res] + (res === 'oro' ? taxes : 0)) * bonus * (1 + eventBonus[res] + wonder + relic);
  }
  const upkeep = upkeepPerHour(state);
  const pay = payPerHour(state);
  // Ciudad ocupada: los invasores se quedan una parte de todo lo que se produce
  const tribute = {};
  for (const res of RESOURCE_KEYS) tribute[res] = state.occupied ? Math.max(0, gross[res]) * OCCUPATION.tribute : 0;
  const net = {};
  for (const res of RESOURCE_KEYS) net[res] = gross[res] - tribute[res];
  net.comida -= upkeep;
  net.oro -= pay;
  const hungry = {};
  for (const res of RESOURCE_KEYS) hungry[res] = res === 'comida' ? net.comida : res === 'oro' ? (gross.oro - tribute.oro) * 0.5 - pay : net[res] * 0.5;
  return { base, buildings, research, colonies, taxes, bonus, eventBonus, gross, tribute, upkeep, pay, net, hungry, closed };
}

/** Si el puerto de la ciudad está cerrado por un bloqueo o una ocupación enemiga. */
export function portClosed(state) {
  return !!(state.blockade || state.occupied);
}

/** Lo que el almacén esconde de cada recurso y los piratas no pueden robar. */
export function protectedAmount(state) {
  return 100 + 250 * lvl(state, 'almacen');
}

// ── Templo ───────────────────────────────────────────────────────────────────

export function favorRate(state, t = state.lastUpdate) {
  return 6 * lvl(state, 'templo') * universe.speed * (worldEventAt(t).event?.favor ?? 1) * (1 + relicBonus(state, 'favor'));
}

export function favorMax(state) {
  const n = lvl(state, 'templo');
  return n ? 100 + 60 * n : 0;
}

// ── Clasificación ────────────────────────────────────────────────────────────

/** Un punto por cada 100 recursos invertidos, como en OGame (allí son 1000). */
export function scoreOf(spent) {
  return Math.floor(spent / 100);
}

export function sum(cost) {
  return Object.values(cost).reduce((a, b) => a + b, 0);
}

export function storageCapacity(state) {
  return Math.floor(1500 * 1.6 ** lvl(state, 'almacen') * (1 + 0.2 * lvl(state, 'logistica')));
}

/** Cuánto recibes por cada unidad de `from` al cambiarla por `to` en el mercado. */
export function tradeRate(state, from, to, t = state.lastUpdate) {
  const fair = worldEventAt(t).event?.trade ?? 0;
  const efficiency = Math.min(0.92 + fair, 0.5 + 0.04 * lvl(state, 'mercado') + 0.04 * lvl(state, 'comercio') + fair);
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
