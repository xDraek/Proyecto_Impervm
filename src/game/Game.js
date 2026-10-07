import { clock, universe } from '../config.js';
import {
  BUILDINGS,
  BUILDING_KEYS,
  ISLAND_TYPES,
  LAND_UNITS,
  PLAYER_UNITS,
  POWERS,
  QUESTS,
  RESEARCH,
  RESEARCH_KEYS,
  RESOURCES,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  UNITS,
  VISITORS,
} from './data.js';
import { battle, count, hasCombat } from './combat.js';
import {
  HOUR_MS,
  buildSeconds,
  buildingMax,
  canAfford,
  colonyCost,
  costFor,
  economy,
  favorMax,
  favorRate,
  fleetSlots,
  maxColonies,
  missingRequirements,
  multiplyCost,
  playerCombat,
  protectedAmount,
  researchCost,
  researchMax,
  researchSeconds,
  scoreOf,
  storageCapacity,
  sum,
  tradeRate,
  travelSeconds,
  unitSeconds,
  wallBonus,
} from './rules.js';

export const SAVE_VERSION = 4;
const MAX_REPORTS = 40;
const MAX_NOTES = 30;

// Piratas: el primer asalto llega un rato después de que el ayuntamiento alcance
// el nivel 3; luego, cada 4-7 horas. Se avistan 20 minutos antes de llegar.
const RAID_TOWN_LEVEL = 3;
const RAID_FIRST_H = 1.5;
const RAID_MIN_H = 4;
const RAID_MAX_H = 7;
const RAID_WARNING_MIN = 20;
const RAID_THEFT = 0.2;
const LOOT_SHARE = 0.5;
const VISIT_MIN_H = 3;
const VISIT_MAX_H = 6;
const ACTIVE_QUESTS = 3;
/** Por debajo de estos puntos nadie te puede atacar (ni tú a otros jugadores). */
export const NEWBIE_POINTS = 100;

const hours = (h) => (h * HOUR_MS) / universe.speed;

/** Partida nueva de un jugador cuya isla es `home`. */
export function newState({ now = clock.now(), home, name }) {
  const buildings = {};
  for (const id of BUILDING_KEYS) buildings[id] = BUILDINGS[id].startLevel ?? 0;
  const research = {};
  for (const id of RESEARCH_KEYS) research[id] = 0;
  const units = {};
  for (const id of PLAYER_UNITS) units[id] = 0;
  return {
    version: SAVE_VERSION,
    name,
    home,
    resources: { ...STARTING_RESOURCES },
    buildings,
    research,
    units,
    queue: null,
    researchQueue: null,
    training: { cuartel: [], puerto: [] },
    missions: [],
    known: {},
    colonies: [],
    raid: null,
    nextRaidAt: null,
    reports: [],
    notes: [],
    favor: 0,
    buffs: {},
    stats: { spent: 0, victories: 0, raidsRepelled: 0, expeditions: 0, powers: 0, treasures: 0, kraken: 0, pvpWins: 0 },
    quests: { claimed: [] },
    visitor: null,
    nextVisitAt: null,
    startedAt: now,
    seq: 1,
    lastUpdate: now,
  };
}

/** Completa una partida guardada con los campos que se hayan añadido después. */
export function upgradeState(saved) {
  const base = newState({ now: saved.lastUpdate, home: saved.home, name: saved.name });
  return {
    ...base,
    ...saved,
    version: SAVE_VERSION,
    resources: { ...base.resources, ...saved.resources },
    buildings: { ...base.buildings, ...saved.buildings },
    research: { ...base.research, ...saved.research },
    units: { ...base.units, ...saved.units },
    training: { ...base.training, ...saved.training },
    stats: { ...base.stats, ...saved.stats },
    quests: { claimed: saved.quests?.claimed ?? [] },
  };
}

/**
 * Estado y reglas de la partida de un jugador. Todo se calcula a partir de
 * marcas de tiempo: `#advance` procesa en orden cronológico cada suceso (obras,
 * investigaciones, reclutas, flotas, piratas…) y acumula la producción entre
 * uno y otro.
 *
 * El mismo código corre en dos sitios:
 * - En el servidor (`mode: 'server'`) es el árbitro: procesa los sucesos.
 * - En el navegador (`mode: 'mirror'`) es un espejo: solo hace correr la
 *   producción hasta el siguiente suceso y avisa (`due`) para pedir al
 *   servidor el estado nuevo. Las acciones las decide siempre el servidor.
 *
 * `world` da acceso a las islas compartidas (ver server/WorldServer.js y
 * net/ClientWorld.js).
 *
 * Eventos: 'change' (cualquier cambio que no sea el goteo de recursos) y
 * 'notify' (detail: { text, kind }).
 */
export class Game extends EventTarget {
  #notes = [];
  #dirty = false;

  constructor({ state, world, userId, mode = 'server' }) {
    super();
    this.state = upgradeState(state);
    this.world = world;
    this.userId = userId;
    this.mode = mode;
    this.due = false;
    this.busy = false;
    if (mode === 'server') {
      this.#ensureRaid(this.state.lastUpdate);
      this.#ensureVisits(this.state.lastUpdate);
    }
  }

  get mirror() {
    return this.mode === 'mirror';
  }

  now() {
    return clock.now();
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  level(id) {
    return this.state.buildings[id] ?? 0;
  }

  researchLevel(id) {
    return this.state.research[id] ?? 0;
  }

  get name() {
    return this.state.name;
  }

  get homeIsland() {
    return this.world.island(this.state.home);
  }

  get resources() {
    return this.state.resources;
  }

  get queue() {
    return this.state.queue;
  }

  get researchQueue() {
    return this.state.researchQueue;
  }

  get units() {
    return this.state.units;
  }

  get missions() {
    return this.state.missions;
  }

  get raid() {
    return this.state.raid;
  }

  get reports() {
    return this.state.reports;
  }

  get unreadReports() {
    return this.state.reports.filter((r) => !r.read).length;
  }

  get stats() {
    return this.state.stats;
  }

  get favor() {
    return this.state.favor;
  }

  get visitor() {
    return this.state.visitor;
  }

  favorRate() {
    return favorRate(this.state);
  }

  favorMax() {
    return favorMax(this.state);
  }

  /** Hasta cuándo dura un efecto divino (0 si no está activo). */
  buffUntil(id, now = this.now()) {
    const until = this.state.buffs[id] ?? 0;
    return until > now ? until : 0;
  }

  /** Unidades de un tipo contando las que están en el mar. */
  armyCount(id) {
    return (this.state.units[id] ?? 0) + this.state.missions.reduce((a, m) => a + (m.units[id] ?? 0), 0);
  }

  landArmy() {
    return LAND_UNITS.reduce((a, id) => a + this.armyCount(id), 0);
  }

  known(id) {
    return this.state.known[id] ?? null;
  }

  exploredCount() {
    return Object.entries(this.state.known).filter(([id, k]) => k.explored && this.world.island(id)?.type !== 'brumas').length;
  }

  /** Distancia en leguas desde tu isla. */
  distanceTo(id) {
    const a = this.homeIsland;
    const b = this.world.island(id);
    return a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;
  }

  // ── Misiones (objetivos) ───────────────────────────────────────────────────

  /** Las próximas misiones sin reclamar, con su progreso. */
  activeQuests() {
    const claimed = new Set(this.state.quests.claimed);
    return QUESTS.filter((q) => !claimed.has(q.id))
      .slice(0, ACTIVE_QUESTS)
      .map((q) => {
        const [current, target] = q.goal(this);
        return { ...q, current, target, done: current >= target };
      });
  }

  questsLeft() {
    return QUESTS.length - this.state.quests.claimed.length;
  }

  claimableQuests() {
    return this.activeQuests().filter((q) => q.done).length;
  }

  // ── Clasificación ──────────────────────────────────────────────────────────

  score() {
    return scoreOf(this.state.stats.spent);
  }

  /** Protección de novato: con pocos puntos nadie te ataca. */
  isProtected() {
    return this.score() < NEWBIE_POINTS;
  }

  economy() {
    return economy(this.state, this.now());
  }

  protectedAmount() {
    return protectedAmount(this.state);
  }

  /** Producción neta por hora (con hambruna si no queda comida). */
  production() {
    const eco = economy(this.state, this.now());
    return this.starving(eco) ? eco.hungry : eco.net;
  }

  starving(eco = economy(this.state, this.now())) {
    return eco.net.comida < 0 && this.state.resources.comida < 1;
  }

  capacity() {
    return storageCapacity(this.state);
  }

  colonies() {
    return this.state.colonies;
  }

  maxColonies() {
    return maxColonies(this.state);
  }

  fleetSlots() {
    return fleetSlots(this.state);
  }

  combatBonus() {
    return playerCombat(this.state);
  }

  /** Información de la próxima mejora de un edificio. */
  nextUpgrade(id) {
    const level = this.level(id) + 1;
    const cost = costFor(id, level);
    return {
      level,
      maxed: level > buildingMax(id),
      cost,
      seconds: buildSeconds(this.state, id, level),
      missing: missingRequirements(this.state, BUILDINGS[id].requires),
      affordable: canAfford(this.state.resources, cost),
      exceedsStorage: Object.values(cost).some((n) => n > this.capacity()),
    };
  }

  nextResearch(id) {
    const level = this.researchLevel(id) + 1;
    const maxed = level > researchMax(id);
    const cost = researchCost(id, level);
    return {
      level,
      maxed,
      cost,
      seconds: researchSeconds(this.state, id, level),
      missing: missingRequirements(this.state, RESEARCH[id].requires),
      affordable: canAfford(this.state.resources, cost),
      exceedsStorage: Object.values(cost).some((n) => n > this.capacity()),
    };
  }

  unitInfo(id) {
    const u = UNITS[id];
    return {
      cost: u.cost,
      seconds: unitSeconds(this.state, id),
      missing: missingRequirements(this.state, u.requires),
    };
  }

  /** Cuántas unidades de `id` podrías pagar ahora mismo. */
  maxAffordable(id) {
    let n = Infinity;
    for (const [res, c] of Object.entries(UNITS[id].cost)) n = Math.min(n, Math.floor(this.state.resources[res] / c));
    return Number.isFinite(n) ? n : 0;
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

  /** Cola de un edificio de reclutamiento con la hora de fin de cada tanda. */
  training(building) {
    return this.state.training[building].map((b) => ({ ...b, end: b.start + b.count * b.each }));
  }

  tradeRate(from, to) {
    return tradeRate(this.state, from, to);
  }

  /** Vista de una isla en el instante `t`: datos fijos, estado compartido y lo que sabes de ella. */
  island(id, t = this.now()) {
    const isl = this.world.island(id);
    if (!isl) return null;
    const rt = this.world.islandState(id);
    const known = this.state.known[id];
    const view = {
      ...isl,
      typeName: ISLAND_TYPES[isl.type].name,
      dist: this.distanceTo(id),
      explored: isl.type === 'brumas' || isl.owner === this.userId || !!known?.explored,
      intel: known?.intel ?? null,
      inbound: this.state.missions.filter((m) => m.target === id),
      mine: isl.owner != null && isl.owner === this.userId,
    };
    if (isl.type === 'jugador') {
      const p = this.world.playerInfo(isl.owner);
      Object.assign(view, { ownerName: p?.name ?? '¿?', score: p?.score ?? 0, protected: !!p?.protected, townLevel: p?.townLevel ?? 1 });
      return view;
    }
    const colonizedBy = rt?.colonizedBy ?? null;
    Object.assign(view, {
      colonized: colonizedBy != null && colonizedBy === this.userId,
      colonizedBy,
      colonistName: colonizedBy != null ? (this.world.playerInfo(colonizedBy)?.name ?? '¿?') : null,
      looted: !!rt?.looted,
      garrison: rt ? garrisonAt(isl, rt, t) : {},
      stock: rt ? stockAt(isl, rt, t) : {},
    });
    return view;
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  update(now = this.now()) {
    this.#advance(now);
    this.#flush(false);
  }

  upgrade(id, now = this.now()) {
    this.#advance(now);
    if (this.state.queue) return this.#fail('Ya hay una obra en marcha.');
    const next = this.nextUpgrade(id);
    if (next.maxed) return this.#fail('Ya está terminado.');
    if (next.missing.length) return this.#fail('No cumples los requisitos.');
    if (!next.affordable) return this.#fail('No tienes recursos suficientes.');

    this.#pay(next.cost);
    this.state.queue = { id, level: next.level, start: now, end: now + next.seconds * 1000, cost: next.cost };
    return this.#done();
  }

  cancel(now = this.now()) {
    this.#advance(now);
    const q = this.state.queue;
    if (!q) return this.#fail('No hay ninguna obra.');
    this.#refund(q.cost);
    this.state.queue = null;
    return this.#done();
  }

  research(id, now = this.now()) {
    this.#advance(now);
    if (this.level('academia') < 1) return this.#fail('Necesitas una academia.');
    if (this.state.researchQueue) return this.#fail('Ya hay una investigación en marcha.');
    const next = this.nextResearch(id);
    if (next.maxed) return this.#fail('Ya está al máximo.');
    if (next.missing.length) return this.#fail('No cumples los requisitos.');
    if (!next.affordable) return this.#fail('No tienes recursos suficientes.');

    this.#pay(next.cost);
    this.state.researchQueue = { id, level: next.level, start: now, end: now + next.seconds * 1000, cost: next.cost };
    return this.#done();
  }

  cancelResearch(now = this.now()) {
    this.#advance(now);
    const q = this.state.researchQueue;
    if (!q) return this.#fail('No hay ninguna investigación.');
    this.#refund(q.cost);
    this.state.researchQueue = null;
    return this.#done();
  }

  train(id, amount, now = this.now()) {
    this.#advance(now);
    const u = UNITS[id];
    const n = Math.floor(amount);
    if (!u || u.npc) return this.#fail('Unidad desconocida.');
    if (!(n >= 1 && n <= 100000)) return this.#fail('Indica cuántas unidades quieres.');
    if (this.level(u.building) < 1) return this.#fail(`Necesitas ${BUILDINGS[u.building].name.toLowerCase()}.`);
    if (missingRequirements(this.state, u.requires).length) return this.#fail('No cumples los requisitos.');
    const total = multiplyCost(u.cost, n);
    if (!canAfford(this.state.resources, total)) return this.#fail('No tienes recursos suficientes.');

    this.#pay(total);
    const q = this.state.training[u.building];
    const last = q.at(-1);
    const start = last ? last.start + last.count * last.each : now;
    q.push({ unit: id, count: n, done: 0, each: unitSeconds(this.state, id) * 1000, start, cost: u.cost });
    return this.#done();
  }

  cancelTraining(building, index, now = this.now()) {
    this.#advance(now);
    const q = this.state.training[building];
    const batch = q?.[index];
    if (!batch) return this.#fail('Esa tanda ya no existe.');
    this.#refund(multiplyCost(batch.cost, batch.count - batch.done));
    q.splice(index, 1);
    let start = index === 0 ? now : q[index - 1].start + q[index - 1].count * q[index - 1].each;
    for (let i = index; i < q.length; i++) {
      q[i].start = start;
      start += q[i].count * q[i].each;
    }
    return this.#done();
  }

  trade(from, to, amount, now = this.now()) {
    this.#advance(now);
    const n = Math.floor(amount);
    if (this.level('mercado') < 1) return this.#fail('Necesitas un mercado.');
    if (from === to || !RESOURCES[from] || !RESOURCES[to]) return this.#fail('Elige dos recursos distintos.');
    if (!(n >= 1)) return this.#fail('Indica cuánto quieres cambiar.');
    if (n > this.state.resources[from]) return this.#fail(`No tienes tanta ${RESOURCES[from].name.toLowerCase()}.`);
    const room = this.capacity() - this.state.resources[to];
    const get = Math.min(Math.floor(n * this.tradeRate(from, to)), Math.max(0, Math.floor(room)));
    if (get <= 0) return this.#fail('El almacén no tiene sitio para más.');
    // Si no cabe todo, se cobra solo lo que se ha podido recibir
    const pay = Math.ceil(get / this.tradeRate(from, to));
    this.state.resources[from] -= Math.min(n, pay);
    this.state.resources[to] += get;
    this.#flush(true);
    return { ok: true, paid: Math.min(n, pay), got: get };
  }

  /** Comprueba una misión sin enviarla. */
  planMission(type, target, units) {
    const s = this.state;
    const isl = this.world.island(target);
    const sent = {};
    let reason = '';
    if (!isl) return { ok: false, reason: 'Esa isla no existe.', units: {}, seconds: 0, capacity: 0, used: 0, cargo: 0, ships: 0, cost: null };
    const rt = this.world.islandState(target);
    const view = this.island(target);
    for (const id of PLAYER_UNITS) {
      const n = Math.max(0, Math.floor(Number(units?.[id]) || 0));
      if (!n) continue;
      sent[id] = n;
      if (n > s.units[id]) reason ||= `No tienes ${n} × ${UNITS[id].name}.`;
    }
    let capacity = 0;
    let used = 0;
    let cargo = 0;
    let ships = 0;
    let speed = Infinity;
    for (const [id, n] of Object.entries(sent)) {
      const u = UNITS[id];
      if (u.kind === 'barco') {
        ships += n;
        capacity += n * u.capacity;
        cargo += n * u.cargo;
        speed = Math.min(speed, u.speed);
      } else {
        used += n * u.size;
      }
    }
    const seconds = Number.isFinite(speed) ? travelSeconds(s, this.distanceTo(target), speed) : 0;
    const slots = fleetSlots(s);
    const pendingColonies = s.missions.filter((m) => m.type === 'colonizar').length;
    let cost = null;

    if (target === s.home) reason ||= 'Es tu propia isla.';
    if (slots < 1) reason ||= 'Necesitas un puerto para zarpar.';
    else if (s.missions.length >= slots) reason ||= `Todas tus flotas están en el mar (${s.missions.length}/${slots}). Mejora el puerto.`;
    if (!count(sent)) reason ||= 'Elige qué unidades envías.';
    else if (!ships) reason ||= 'Hace falta al menos un barco para cruzar el mar.';
    else if (used > capacity) reason ||= `Faltan plazas en los barcos: ${used}/${capacity}.`;

    if (isl.type === 'jugador') {
      if (type === 'explorar') {
        if (Object.keys(sent).some((id) => !UNITS[id].explorer)) reason ||= 'Para espiar envía solo botes exploradores.';
      } else if (type === 'atacar') {
        if (view.protected) reason ||= `${view.ownerName} está bajo protección de novato (menos de ${NEWBIE_POINTS} puntos).`;
        else if (this.isProtected()) reason ||= `Mientras tengas menos de ${NEWBIE_POINTS} puntos no puedes atacar a otros jugadores.`;
        if (!hasCombat(sent)) reason ||= 'Envía al menos una unidad de combate.';
      } else {
        reason ||= 'Esa misión no sirve contra otra ciudad.';
      }
    } else if (type === 'explorar') {
      if (isl.type === 'brumas') reason ||= 'En el Mar de las Brumas solo caben expediciones.';
      if (Object.keys(sent).some((id) => !UNITS[id].explorer)) reason ||= 'Para explorar envía solo botes exploradores.';
    } else if (type === 'expedicion') {
      if (isl.type !== 'brumas') reason ||= 'Las expediciones zarpan hacia el Mar de las Brumas.';
      else if (this.researchLevel('navegacion') < 2) reason ||= 'Investiga Navegación 2 para aventurarte en la niebla.';
    } else if (isl.type === 'brumas') {
      reason ||= 'En el Mar de las Brumas solo caben expediciones.';
    } else if (type === 'atacar') {
      if (rt?.colonizedBy != null) reason ||= rt.colonizedBy === this.userId ? 'Es tu colonia.' : `Es una colonia de ${view.colonistName}.`;
      else if (view.explored && (isl.type === 'libre' || isl.type === 'ruinas')) reason ||= 'Aquí no hay nada que atacar.';
      if (!hasCombat(sent)) reason ||= 'Envía al menos una unidad de combate.';
    } else if (type === 'colonizar') {
      const colonies = s.colonies.length;
      const max = maxColonies(s);
      if (!view.explored) reason ||= 'Explora la isla antes de mandar colonos.';
      else if (isl.type !== 'libre') reason ||= 'Solo puedes colonizar islas deshabitadas.';
      else if (rt?.colonizedBy != null) reason ||= rt.colonizedBy === this.userId ? 'Ya es tu colonia.' : `${view.colonistName} ya la ha colonizado.`;
      else if (s.missions.some((m) => m.type === 'colonizar' && m.target === target)) reason ||= 'Ya navegan colonos hacia aquí.';
      else if (max === 0) reason ||= 'Investiga Cartografía para poder fundar colonias.';
      else if (colonies + pendingColonies >= max) reason ||= `Ya tienes ${colonies + pendingColonies}/${max} colonias. Investiga más Cartografía.`;
      if (!sent.mercante) reason ||= 'Los colonos viajan en un barco mercante.';
      cost = colonyCost(colonies + pendingColonies);
      if (!canAfford(s.resources, cost)) reason ||= 'No tienes los recursos para fundar la colonia.';
    } else {
      reason ||= 'Misión desconocida.';
    }
    return { ok: !reason, reason, units: sent, seconds, capacity, used, cargo, ships, cost };
  }

  sendMission(type, target, units, now = this.now()) {
    this.#advance(now);
    const plan = this.planMission(type, target, units);
    if (!plan.ok) return this.#fail(plan.reason);
    for (const [id, n] of Object.entries(plan.units)) this.state.units[id] -= n;
    if (plan.cost) this.#pay(plan.cost);
    this.state.missions.push({
      id: this.state.seq++,
      type,
      target,
      targetName: this.world.island(target).name,
      units: plan.units,
      cargo: plan.cost ? { ...plan.cost } : {},
      depart: now,
      arrive: now + plan.seconds * 1000,
      back: null,
      phase: 'ida',
    });
    return this.#done();
  }

  /** Hace dar media vuelta a una flota que aún no ha llegado. */
  recall(id, now = this.now()) {
    this.#advance(now);
    const m = this.state.missions.find((x) => x.id === id);
    if (!m || m.phase !== 'ida') return this.#fail('Esa flota ya no puede volver.');
    m.phase = 'vuelta';
    m.back = now + (now - m.depart);
    m.turn = now;
    m.recalled = true;
    return this.#done();
  }

  markReportsRead() {
    let changed = false;
    for (const r of this.state.reports) {
      if (!r.read) {
        r.read = true;
        changed = true;
      }
    }
    if (changed) this.#flush(true);
    return { ok: true };
  }

  claimQuest(id, now = this.now()) {
    this.#advance(now);
    const q = this.activeQuests().find((x) => x.id === id);
    if (!q) return this.#fail('Esa misión no está disponible.');
    if (!q.done) return this.#fail('Todavía no la has cumplido.');
    this.state.quests.claimed.push(id);
    const { favor, ...rest } = q.reward;
    this.#gain(rest);
    if (favor) this.state.favor += favor;
    return this.#done();
  }

  castPower(id, now = this.now()) {
    this.#advance(now);
    const p = POWERS[id];
    const s = this.state;
    if (!p) return this.#fail('Poder desconocido.');
    if (this.level('templo') < 1) return this.#fail('Necesitas un templo.');
    if (s.favor < p.cost) return this.#fail('No tienes favor suficiente.');
    if (id === 'inspiracion') {
      const qs = [s.queue, s.researchQueue].filter(Boolean);
      if (!qs.length) return this.#fail('No hay ninguna obra ni investigación en curso.');
      for (const q of qs) q.end = now + (q.end - now) * 0.7;
    } else if (id === 'viento') {
      if (!s.missions.length) return this.#fail('No tienes flotas en el mar.');
      for (const m of s.missions) {
        if (m.phase === 'ida') m.arrive = now + (m.arrive - now) * 0.5;
        else m.back = now + (m.back - now) * 0.5;
      }
    } else if (id === 'rayo') {
      if (!s.raid) return this.#fail('No hay piratas a la vista.');
      for (const u of Object.keys(s.raid.army)) s.raid.army[u] = Math.round(s.raid.army[u] * 0.6);
    } else {
      s.buffs[id] = Math.max(s.buffs[id] ?? 0, now) + hours(p.duration);
    }
    s.favor -= p.cost;
    s.stats.powers++;
    this.#note(`${p.icon} ${p.name}`, 'success');
    return this.#done();
  }

  acceptVisitor(now = this.now()) {
    this.#advance(now);
    const v = this.state.visitor;
    if (!v) return this.#fail('Ya no hay nadie esperando.');
    if (v.give && !canAfford(this.state.resources, v.give)) return this.#fail('No tienes lo que te piden.');
    if (v.give) this.#pay(v.give, false);
    if (v.get) this.#gain(v.get);
    if (v.units) for (const [id, n] of Object.entries(v.units)) this.state.units[id] += n;
    this.state.visitor = null;
    this.#scheduleVisit(now);
    return this.#done();
  }

  dismissVisitor(now = this.now()) {
    this.#advance(now);
    if (!this.state.visitor) return this.#fail('Ya no hay nadie esperando.');
    this.state.visitor = null;
    this.#scheduleVisit(now);
    return this.#done();
  }

  // ── Llamadas del mundo (otros jugadores) ───────────────────────────────────

  /** Lo que ve un espía en tu isla. */
  spyReport() {
    return {
      units: Object.fromEntries(Object.entries(this.state.units).filter(([, n]) => n > 0)),
      resources: Object.fromEntries(RESOURCE_KEYS.map((r) => [r, Math.floor(this.state.resources[r])])),
      wall: this.level('muralla'),
      town: this.level('ayuntamiento'),
    };
  }

  /**
   * Otro jugador ataca tu isla en el instante `t`. Defienden tus tropas en casa
   * y la muralla; si ganan los atacantes se llevan recursos (salvo lo protegido).
   */
  receiveAttack({ attackerName, units, atkMul, hpMul, islandName }, t) {
    const s = this.state;
    const wall = wallBonus(this.level('muralla'));
    const mine = playerCombat(s);
    const aegis = (s.buffs.egida ?? 0) > t ? 0.5 : 0;
    const result = battle({ units, atkMul, hpMul }, { units: { ...s.units }, atkMul: mine.atkMul, hpMul: mine.hpMul + wall.hp + aegis, extraAtk: wall.towers });
    for (const id of PLAYER_UNITS) s.units[id] = result.def.left[id] ?? 0;

    let stolen = null;
    let cargo = 0;
    for (const [id, n] of Object.entries(result.att.left)) cargo += n * (UNITS[id].cargo ?? 0);
    const outcome = result.winner === 'att' ? 'derrota' : result.winner === 'def' ? 'victoria' : 'empate';
    if (outcome === 'derrota') {
      const bag = {};
      const safe = protectedAmount(s);
      for (const res of RESOURCE_KEYS) bag[res] = Math.max(0, s.resources[res] - safe);
      stolen = takeLoot(bag, cargo);
      for (const [res, n] of Object.entries(stolen)) s.resources[res] -= n;
    }
    const title = {
      victoria: `Has rechazado el ataque de ${attackerName}`,
      empate: `${attackerName} se retira de tu isla`,
      derrota: `${attackerName} ha saqueado tu isla`,
    }[outcome];
    this.#report({ t, kind: 'defensa', outcome, title, islandName, battle: pick(result), loot: stolen, towers: wall.towers, enemy: attackerName });
    this.#note(`⚔️ ${title}`, outcome === 'derrota' ? 'error' : 'success');
    this.#dirty = true;
    return { result, stolen: stolen ?? {} };
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  #fail(reason) {
    this.#flush(false);
    return { ok: false, reason };
  }

  #done() {
    this.#flush(true);
    return { ok: true };
  }

  #flush(changed) {
    const notes = this.#notes.splice(0);
    if (changed || this.#dirty || notes.length) {
      this.#dirty = false;
      this.dirty = true;
      this.dispatchEvent(new Event('change'));
    }
    for (const n of notes) this.dispatchEvent(new CustomEvent('notify', { detail: n }));
  }

  /** Aviso para el jugador. En el servidor se guarda para enseñarlo cuando se conecte. */
  #note(text, kind = 'info') {
    const note = { id: this.state.seq++, t: this.state.lastUpdate, text, kind };
    this.#notes.push(note);
    this.state.notes.push(note);
    if (this.state.notes.length > MAX_NOTES) this.state.notes.splice(0, this.state.notes.length - MAX_NOTES);
  }

  #report(data) {
    const r = { id: this.state.seq++, read: false, ...data };
    this.state.reports.unshift(r);
    this.state.reports.length = Math.min(this.state.reports.length, MAX_REPORTS);
    return r;
  }

  /** Gasto que cuenta para la puntuación (salvo que `invest` sea false). */
  #pay(cost, invest = true) {
    for (const [res, n] of Object.entries(cost)) this.state.resources[res] -= n;
    if (invest) this.state.stats.spent += sum(cost);
  }

  #refund(cost) {
    for (const [res, n] of Object.entries(cost)) this.state.resources[res] += n;
    this.state.stats.spent = Math.max(0, this.state.stats.spent - sum(cost));
  }

  /** Recursos que llegan de fuera: botines, recompensas, regalos. */
  #gain(bag) {
    for (const [res, n] of Object.entries(bag ?? {})) this.state.resources[res] += n;
  }

  /** Avanza el tiempo hasta `now` procesando los sucesos en orden. */
  #advance(now) {
    if (this.mirror) {
      // El espejo del navegador no decide nada: solo deja correr la producción
      const ev = this.#nextEvent();
      if (ev && ev.t <= now) this.due = true;
      this.#accrue(Math.min(now, ev?.t ?? now));
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      for (let guard = 0; guard < 20000; guard++) {
        const ev = this.#nextEvent();
        if (!ev || ev.t > now) break;
        this.#accrue(ev.t);
        ev.run(ev.t);
        this.#dirty = true;
      }
      this.#accrue(now);
    } finally {
      this.busy = false;
    }
  }

  #nextEvent() {
    const s = this.state;
    let best = null;
    const consider = (t, run) => {
      if (!best || t < best.t) best = { t, run };
    };
    if (s.queue) consider(s.queue.end, (t) => this.#finishBuilding(t));
    if (s.researchQueue) consider(s.researchQueue.end, (t) => this.#finishResearch(t));
    for (const b of Object.keys(s.training)) {
      const head = s.training[b][0];
      if (head) consider(head.start + (head.done + 1) * head.each, (t) => this.#trainOne(b, t));
    }
    for (const m of s.missions) consider(m.phase === 'ida' ? m.arrive : m.back, (t) => this.#missionEvent(m, t));
    if (s.raid) consider(s.raid.arrival, (t) => this.#resolveRaid(t));
    else if (s.nextRaidAt) consider(s.nextRaidAt, (t) => this.#spawnRaid(t));
    if (s.visitor) consider(s.visitor.expires, (t) => this.#visitorLeaves(t));
    else if (s.nextVisitAt) consider(s.nextVisitAt, (t) => this.#spawnVisitor(t));
    // El final de un efecto divino también es un suceso: cambia la producción
    for (const [id, until] of Object.entries(s.buffs)) consider(until, () => delete s.buffs[id]);
    return best;
  }

  #accrue(t) {
    const s = this.state;
    const start = s.lastUpdate;
    const h = Math.max(0, t - start) / HOUR_MS;
    s.lastUpdate = Math.max(start, t);
    if (h === 0) return;
    s.favor = Math.min(Math.max(s.favor, favorMax(s)), s.favor + favorRate(s) * h);
    const eco = economy(s, start);
    const cap = storageCapacity(s);
    // Si el mantenimiento se come la comida, a partir de ese momento hay hambruna
    let fed = h;
    if (eco.net.comida < 0) fed = Math.min(h, s.resources.comida / -eco.net.comida);
    this.#produce(eco.net, fed, cap);
    if (h > fed) this.#produce(eco.hungry, h - fed, cap);
  }

  #produce(rates, h, cap) {
    if (h <= 0) return;
    const res = this.state.resources;
    for (const key of RESOURCE_KEYS) {
      const d = rates[key] * h;
      if (d > 0 && res[key] < cap) res[key] = Math.min(cap, res[key] + d);
      else if (d < 0) res[key] = Math.max(0, res[key] + d);
    }
  }

  #finishBuilding(t) {
    const q = this.state.queue;
    this.state.buildings[q.id] = q.level;
    this.state.queue = null;
    const b = BUILDINGS[q.id];
    this.#note(`${b.icon} ${b.name} ha alcanzado el nivel ${q.level}`, 'success');
    this.#ensureRaid(t);
    this.#ensureVisits(t);
    if (q.id === 'coloso' && q.level >= buildingMax('coloso')) {
      this.#report({
        t,
        kind: 'victoria',
        outcome: 'victoria',
        title: '¡El Coloso está terminado!',
        text: 'Marineros de todo el archipiélago lo ven brillar desde el horizonte. Tu imperio ya es leyenda.',
      });
      this.#note('🗽 ¡Has terminado el Coloso! Tu imperio será recordado para siempre.', 'success');
      this.world.announce?.(`🗽 ${this.state.name} ha terminado el Coloso`);
    }
  }

  #finishResearch() {
    const q = this.state.researchQueue;
    this.state.research[q.id] = q.level;
    this.state.researchQueue = null;
    const r = RESEARCH[q.id];
    this.#note(`${r.icon} Investigación completada: ${r.name} nivel ${q.level}`, 'success');
  }

  #trainOne(building, t) {
    const q = this.state.training[building];
    const head = q[0];
    head.done++;
    this.state.units[head.unit]++;
    if (head.done >= head.count) {
      q.shift();
      if (q[0]) q[0].start = t;
      const u = UNITS[head.unit];
      this.#note(`${u.icon} ${head.count} × ${u.name} ${head.count === 1 ? 'listo' : 'listos'}`, 'success');
    }
  }

  // ── Flotas ─────────────────────────────────────────────────────────────────

  #missionEvent(m, t) {
    if (m.phase === 'vuelta') {
      for (const [id, n] of Object.entries(m.units)) this.state.units[id] += n;
      for (const [res, n] of Object.entries(m.cargo)) this.state.resources[res] += n;
      this.state.missions = this.state.missions.filter((x) => x !== m);
      const loot = fmtBag(m.cargo);
      this.#note(`⚓ Ha vuelto la flota de ${m.targetName}${loot ? `: ${loot}` : ''}`, 'success');
      return;
    }

    const isl = this.world.island(m.target);
    if (!isl) {
      // La isla ha desaparecido del mundo: la flota vuelve sin más
    } else if (isl.type === 'jugador') {
      if (m.type === 'explorar') this.#arriveSpy(m, isl, t);
      else this.#arrivePlayerAttack(m, isl, t);
    } else if (m.type === 'explorar') this.#arriveExplore(m, isl, t);
    else if (m.type === 'atacar') this.#arriveAttack(m, isl, t);
    else if (m.type === 'colonizar') this.#arriveColonize(m, isl, t);
    else if (m.type === 'expedicion') this.#arriveExpedition(m, isl, t);

    if (count(m.units) > 0) {
      m.phase = 'vuelta';
      m.turn = t;
      m.back = t + (m.arrive - m.depart) * (m.slow ?? 1);
    } else {
      this.state.missions = this.state.missions.filter((x) => x !== m);
    }
  }

  #know(id, data) {
    this.state.known[id] = { ...this.state.known[id], explored: true, ...data };
  }

  #intel(isl, rt, t) {
    const intel = { t, garrison: garrisonAt(isl, rt, t), stock: stockAt(isl, rt, t) };
    this.#know(isl.id, { intel });
    return intel;
  }

  #arriveExplore(m, isl, t) {
    const rt = this.world.islandState(isl.id);
    const first = !this.state.known[isl.id]?.explored;
    const intel = this.#intel(isl, rt, t);
    let text = `${ISLAND_TYPES[isl.type].icon} Es ${ISLAND_TYPES[isl.type].name.toLowerCase()}.`;
    let loot = null;
    if (isl.type === 'ruinas' && !rt.looted) {
      rt.looted = true;
      this.world.touch?.(isl.id);
      this.state.stats.treasures++;
      for (const [res, n] of Object.entries(isl.treasure)) m.cargo[res] = (m.cargo[res] ?? 0) + n;
      loot = { ...isl.treasure };
      text += ' ¡Entre los escombros había un tesoro!';
    } else if (isl.type === 'ruinas') {
      text += ' Alguien se llevó ya el tesoro.';
    } else if (isl.type === 'libre') {
      text += rt.colonizedBy != null
        ? ` Ya es una colonia de ${this.world.playerInfo(rt.colonizedBy)?.name ?? 'otro imperio'}.`
        : ` Tierra fértil: una colonia aquí produciría ${RESOURCES[isl.specialty].icon} ${RESOURCES[isl.specialty].name.toLowerCase()}.`;
    }
    this.#report({ t, kind: 'exploracion', island: isl.id, islandName: isl.name, title: `${first ? 'Descubierta' : 'Explorada'}: ${isl.name}`, text, intel, loot });
    this.#note(`🔭 ${isl.name}: ${ISLAND_TYPES[isl.type].name}`, 'success');
  }

  #arriveSpy(m, isl, t) {
    const info = this.world.spyPlayer?.(isl.owner, t);
    if (!info) {
      this.#report({ t, kind: 'exploracion', island: isl.id, islandName: isl.name, title: `Sin noticias de ${isl.name}`, text: 'El bote no ha podido acercarse.' });
      return;
    }
    const intel = { t, garrison: info.units, stock: info.resources, wall: info.wall, town: info.town };
    this.#know(isl.id, { intel });
    this.#report({
      t,
      kind: 'exploracion',
      island: isl.id,
      islandName: isl.name,
      title: `Espionaje: ${isl.name}`,
      text: `Ciudad de ${info.name}. Ayuntamiento nivel ${info.town}, muralla nivel ${info.wall}.`,
      intel,
    });
    this.#note(`🔭 Tus espías vuelven de ${isl.name}`, 'success');
  }

  #arrivePlayerAttack(m, isl, t) {
    const { atkMul, hpMul } = playerCombat(this.state);
    const res = this.world.attackPlayer?.(isl.owner, { attackerName: this.state.name, units: m.units, atkMul, hpMul, islandName: this.homeIsland?.name }, t);
    if (!res) {
      this.#report({ t, kind: 'ataque', island: isl.id, islandName: isl.name, title: `No hay nadie en ${isl.name}`, text: 'La ciudad está vacía. Tu flota vuelve a casa.' });
      return;
    }
    const { result, stolen } = res;
    m.units = result.att.left;
    for (const [r, n] of Object.entries(stolen)) m.cargo[r] = (m.cargo[r] ?? 0) + n;
    const outcome = result.winner === 'att' ? 'victoria' : result.winner === 'def' ? 'derrota' : 'empate';
    if (outcome === 'victoria') {
      this.state.stats.victories++;
      this.state.stats.pvpWins++;
    }
    const enemy = this.world.playerInfo(isl.owner)?.name ?? isl.name;
    const title = { victoria: `Has saqueado ${isl.name}`, derrota: `Derrota en ${isl.name}`, empate: `Retirada de ${isl.name}` }[outcome];
    this.#report({ t, kind: 'ataque', island: isl.id, islandName: isl.name, outcome, title, battle: pick(result), loot: stolen, enemy, pvp: true });
    this.#note(`⚔️ ${title}${fmtBag(stolen) ? ` · botín ${fmtBag(stolen)}` : ''}`, outcome === 'victoria' ? 'success' : 'error');
  }

  #arriveAttack(m, isl, t) {
    const rt = this.world.islandState(isl.id);
    if (isl.type === 'ruinas' && !rt.looted) {
      rt.looted = true;
      this.state.stats.treasures++;
      for (const [res, n] of Object.entries(isl.treasure)) m.cargo[res] = (m.cargo[res] ?? 0) + n;
    }
    const garrison = garrisonAt(isl, rt, t);
    const stock = stockAt(isl, rt, t);
    const { atkMul, hpMul } = playerCombat(this.state);
    const siege = Object.entries(m.units).reduce((s, [id, n]) => s + (UNITS[id].siege ?? 0) * n, 0);
    const wall = Math.max(0, (isl.wall ?? 0) - siege);
    const result = battle({ units: m.units, atkMul, hpMul }, { units: garrison, hpMul: 1 + wall });

    rt.garrison = result.def.left;
    rt.garrisonAt = t;
    m.units = result.att.left;

    let loot = null;
    if (result.winner === 'att') {
      let capacity = 0;
      for (const [id, n] of Object.entries(m.units)) capacity += n * (UNITS[id].cargo ?? 0);
      loot = takeLoot(stock, capacity);
      for (const [res, n] of Object.entries(loot)) {
        stock[res] -= n;
        m.cargo[res] = (m.cargo[res] ?? 0) + n;
      }
      rt.stock = stock;
      rt.stockAt = t;
    }
    this.world.touch?.(isl.id);
    this.#intel(isl, rt, t);

    const outcome = result.winner === 'att' ? 'victoria' : result.winner === 'def' ? 'derrota' : 'empate';
    const title = {
      victoria: `Victoria en ${isl.name}`,
      derrota: `Derrota en ${isl.name}`,
      empate: `Retirada en ${isl.name}`,
    }[outcome];
    if (isl.type === 'ruinas') loot = { ...m.cargo };
    this.#report({ t, kind: 'ataque', island: isl.id, islandName: isl.name, outcome, title, battle: pick(result), loot, wall });
    this.#note(
      outcome === 'victoria' ? `⚔️ ${title}${loot && fmtBag(loot) ? ` · botín ${fmtBag(loot)}` : ''}` : `⚔️ ${title}`,
      outcome === 'victoria' ? 'success' : 'error',
    );
    if (outcome === 'victoria') this.state.stats.victories++;
    if (isl.type === 'kraken' && outcome === 'victoria') {
      this.state.stats.kraken++;
      this.#note('🐙 ¡Has derrotado al Kraken! Los mares son tuyos.', 'success');
      this.world.announce?.(`🐙 ${this.state.name} ha derrotado al Kraken de ${isl.name}`);
    }
  }

  #arriveColonize(m, isl, t) {
    const ok = this.state.colonies.length < maxColonies(this.state) && this.world.colonize?.(isl.id, this.userId);
    if (!ok) {
      this.#report({ t, kind: 'colonia', island: isl.id, islandName: isl.name, title: `Colonia fallida: ${isl.name}`, text: 'Los colonos no han podido instalarse y vuelven con los recursos.' });
      return;
    }
    this.state.colonies.push({ id: isl.id, name: isl.name, specialty: isl.specialty, yield: isl.yield });
    m.units.mercante -= 1;
    if (!m.units.mercante) delete m.units.mercante;
    m.cargo = {};
    const r = RESOURCES[isl.specialty];
    this.#report({
      t,
      kind: 'colonia',
      island: isl.id,
      islandName: isl.name,
      title: `Nueva colonia: ${isl.name}`,
      text: `Los colonos se han quedado con su barco. La colonia producirá ${r.icon} ${r.name.toLowerCase()} para tu imperio.`,
    });
    this.#note(`🚩 Has fundado una colonia en ${isl.name}`, 'success');
  }

  /** Expedición al Mar de las Brumas: un poco de todo, como en OGame. */
  #arriveExpedition(m, isl, t) {
    const s = this.state;
    s.stats.expeditions++;
    let capacity = 0;
    let power = 0;
    for (const [id, n] of Object.entries(m.units)) {
      capacity += n * (UNITS[id].cargo ?? 0);
      power += n * UNITS[id].atk;
    }
    const roll = Math.random();
    const report = { t, kind: 'expedicion', island: isl.id, islandName: isl.name, outcome: null };
    const add = (bag) => {
      for (const [res, n] of Object.entries(bag)) m.cargo[res] = (m.cargo[res] ?? 0) + n;
    };
    if (roll < 0.28) {
      const pool = ['madera', 'piedra', 'hierro', 'cristal', 'oro'].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
      const total = Math.max(400, capacity * (0.4 + Math.random() * 0.6));
      const bag = {};
      for (const res of pool) bag[res] = Math.floor(total / pool.length / RESOURCES[res].value);
      add(bag);
      Object.assign(report, { title: 'Un pecio a la deriva', text: 'Entre la niebla aparece un barco mercante abandonado con la bodega llena.', loot: bag, outcome: 'victoria' });
    } else if (roll < 0.4) {
      const n = 1 + Math.floor(Math.random() * 3);
      const type = Math.random() < 0.7 ? 'mercante' : 'trirreme';
      m.units[type] = (m.units[type] ?? 0) + n;
      Object.assign(report, { title: 'Barcos sin tripulación', text: `${n} × ${UNITS[type].name} flotaban vacíos en la niebla. Ahora navegan bajo tu bandera.`, outcome: 'victoria' });
    } else if (roll < 0.48) {
      const bag = { oro: Math.floor(600 + Math.random() * 1400), cristal: Math.floor(300 + Math.random() * 700) };
      add(bag);
      Object.assign(report, { title: 'Una isla que no sale en los mapas', text: 'En una cala escondida hay un cofre con el tesoro de algún pirata olvidado.', loot: bag, outcome: 'victoria' });
    } else if (roll < 0.66) {
      Object.assign(report, { title: 'Solo niebla', text: 'Días de niebla, gaviotas y silencio. La flota vuelve sin nada que contar.' });
    } else if (roll < 0.78) {
      const pirata = Math.max(3, Math.round((power / 11) * (0.4 + Math.random() * 0.5)));
      const army = { pirata, corsario: Math.floor(pirata / 12) };
      const { atkMul, hpMul } = playerCombat(s);
      const result = battle({ units: army }, { units: m.units, atkMul, hpMul });
      m.units = result.def.left;
      const won = result.winner !== 'att';
      const loot = won ? { oro: 15 * pirata } : null;
      if (loot) add(loot);
      Object.assign(report, {
        title: won ? 'Emboscada pirata rechazada' : 'Emboscada pirata',
        text: won ? 'Unos piratas os atacan entre la niebla, pero tu flota los pone en fuga.' : 'Unos piratas os atacan entre la niebla y hunden tu flota.',
        battle: pick(result),
        loot,
        outcome: won ? 'victoria' : 'derrota',
        defending: true,
      });
    } else if (roll < 0.86) {
      m.slow = 2;
      Object.assign(report, { title: 'Perdidos en la niebla', text: 'La flota se desorienta y tardará el doble en volver.', outcome: 'empate' });
    } else if (roll < 0.93) {
      const lost = {};
      for (const [id, n] of Object.entries(m.units)) {
        const k = Math.floor(n * 0.3);
        if (k) {
          lost[id] = k;
          m.units[id] = n - k;
        }
      }
      Object.assign(report, { title: '¡Una serpiente marina!', text: 'Un monstruo surge de las profundidades y se lleva parte de la flota.', lostUnits: lost, outcome: 'derrota' });
    } else if (roll < 0.97) {
      const hidden = (this.world.islandsNear?.(this.state.home, 600) ?? [])
        .filter((i) => i.type !== 'jugador' && i.type !== 'brumas' && !s.known[i.id]?.explored)
        .slice(0, 3);
      for (const other of hidden) this.#intel(other, this.world.islandState(other.id), t);
      Object.assign(report, {
        title: 'Cartas náuticas',
        text: hidden.length ? `Un viejo navegante os vende sus cartas: ahora conoces ${hidden.map((i) => i.name).join(', ')}.` : 'Un viejo navegante os vende sus cartas, pero ya conocías todo lo que aparece en ellas.',
        outcome: 'victoria',
      });
    } else {
      s.favor += 50;
      Object.assign(report, { title: 'Un altar en la niebla', text: 'Tus marineros encuentran un altar olvidado y hacen ofrendas. Los dioses te sonríen (+50 de favor).', outcome: 'victoria' });
    }
    this.#report(report);
    this.#note(`🧭 Expedición: ${report.title}`, report.outcome === 'derrota' ? 'error' : 'success');
  }

  // ── Piratas ────────────────────────────────────────────────────────────────

  #ensureRaid(t) {
    const s = this.state;
    if (!s.raid && !s.nextRaidAt && this.level('ayuntamiento') >= RAID_TOWN_LEVEL) s.nextRaidAt = t + hours(RAID_FIRST_H);
  }

  raidTier() {
    const levels = Object.values(this.state.buildings).reduce((a, b) => a + b, 0);
    return Math.max(1, Math.min(6, 1 + Math.floor((levels - 12) / 10)));
  }

  #spawnRaid(t) {
    const tier = this.raidTier();
    const army = { pirata: Math.round(4 * tier ** 1.3) };
    if (tier >= 3) army.corsario = Math.round((tier - 2) ** 1.2);
    this.state.raid = { spawn: t, arrival: t + hours(RAID_WARNING_MIN / 60), army, tier };
    this.state.nextRaidAt = null;
    this.#note('🏴‍☠️ ¡Velas piratas en el horizonte! Prepara tus defensas.', 'error');
  }

  #resolveRaid(t) {
    const s = this.state;
    const raid = s.raid;
    const wall = wallBonus(this.level('muralla'));
    const { atkMul, hpMul } = playerCombat(s);
    const aegis = (s.buffs.egida ?? 0) > t ? 0.5 : 0;
    const result = battle({ units: raid.army }, { units: { ...s.units }, atkMul, hpMul: hpMul + wall.hp + aegis, extraAtk: wall.towers });
    for (const id of PLAYER_UNITS) s.units[id] = result.def.left[id] ?? 0;

    let stolen = null;
    let reward = null;
    let outcome;
    if (result.winner === 'att') {
      outcome = 'derrota';
      const bag = {};
      const safe = protectedAmount(s);
      for (const res of RESOURCE_KEYS) bag[res] = Math.max(0, s.resources[res] - safe) * RAID_THEFT;
      stolen = takeLoot(bag, 500 * raid.tier, 1);
      for (const [res, n] of Object.entries(stolen)) s.resources[res] -= n;
    } else {
      outcome = result.winner === 'def' ? 'victoria' : 'empate';
      reward = outcome === 'victoria' ? { oro: 80 * raid.tier, hierro: 60 * raid.tier } : null;
      if (reward) this.#gain(reward);
      s.stats.raidsRepelled++;
    }
    const title = {
      victoria: 'Asalto pirata rechazado',
      empate: 'Los piratas se retiran',
      derrota: 'Los piratas han saqueado la isla',
    }[outcome];
    this.#report({ t, kind: 'defensa', outcome, title, battle: pick(result), loot: stolen, reward, towers: wall.towers });
    this.#note(`🏴‍☠️ ${title}${stolen ? ` · se llevan ${fmtBag(stolen)}` : ''}`, outcome === 'derrota' ? 'error' : 'success');
    s.raid = null;
    s.nextRaidAt = t + hours(RAID_MIN_H + Math.random() * (RAID_MAX_H - RAID_MIN_H));
  }

  // ── Visitantes ─────────────────────────────────────────────────────────────

  #ensureVisits(t) {
    const s = this.state;
    if (!s.visitor && !s.nextVisitAt && this.level('ayuntamiento') >= 2) s.nextVisitAt = t + hours(1 + Math.random() * 2);
  }

  #scheduleVisit(t) {
    this.state.nextVisitAt = t + hours(VISIT_MIN_H + Math.random() * (VISIT_MAX_H - VISIT_MIN_H));
  }

  #spawnVisitor(t) {
    const s = this.state;
    s.nextVisitAt = null;
    const roll = Math.random();
    const scale = 1 + this.level('ayuntamiento') * 0.4;
    if (roll < 0.45) {
      // Compra lo que te sobra y paga en algo escaso, mejor que el mercado
      const common = ['madera', 'piedra', 'comida'].sort((a, b) => s.resources[b] - s.resources[a])[0];
      const rare = ['hierro', 'cristal', 'oro'][Math.floor(Math.random() * 3)];
      const give = Math.round((300 + Math.random() * 500) * scale);
      const get = Math.round((give * RESOURCES[common].value * (0.8 + Math.random() * 0.3)) / RESOURCES[rare].value);
      s.visitor = { kind: 'mercader', give: { [common]: give }, get: { [rare]: get }, expires: t + hours(1) };
    } else if (roll < 0.7 && this.level('cuartel') >= 1) {
      const type = ['lancero', 'arquero', 'espadachin'][Math.floor(Math.random() * 3)];
      const n = Math.round((6 + Math.random() * 8) * Math.sqrt(scale));
      const price = Math.round(n * (type === 'espadachin' ? 22 : 12));
      s.visitor = { kind: 'mercenarios', give: { oro: price }, units: { [type]: n }, expires: t + hours(1) };
    } else if (roll < 0.85) {
      const bag = this.level('templo') ? null : { oro: Math.round(80 * scale) };
      if (bag) this.#gain(bag);
      else s.favor += 30;
      this.#report({
        t,
        kind: 'visita',
        title: 'Llegan peregrinos',
        text: bag ? 'Unos peregrinos de paso dejan ofrendas en la plaza.' : 'Los peregrinos rezan en tu templo: +30 de favor.',
        loot: bag,
      });
      this.#note(`${VISITORS.peregrinos.icon} Llegan peregrinos${bag ? '' : ' (+30 de favor)'}`, 'success');
      this.#scheduleVisit(t);
      return;
    } else {
      const bag = {};
      for (const res of ['madera', 'hierro', 'comida']) bag[res] = Math.round((60 + Math.random() * 140) * scale);
      this.#gain(bag);
      this.#report({ t, kind: 'visita', title: 'Restos de un naufragio', text: 'La marea arrastra a la playa barriles y tablones de un barco hundido.', loot: bag });
      this.#note(`${VISITORS.naufragio.icon} El mar trae restos de un naufragio: ${fmtBag(bag)}`, 'success');
      this.#scheduleVisit(t);
      return;
    }
    const v = VISITORS[s.visitor.kind];
    this.#note(`${v.icon} ${v.name} en el puerto`, 'info');
  }

  #visitorLeaves(t) {
    const v = VISITORS[this.state.visitor.kind];
    this.state.visitor = null;
    this.#scheduleVisit(t);
    this.#note(`${v.icon} ${v.name}: se han marchado`, 'info');
  }
}

// ── Islas neutrales: guarnición y botín que se regeneran con el tiempo ──────

export function garrisonAt(isl, rt, t) {
  const out = {};
  const regen = hours(isl.regenHours ?? 1);
  for (const [id, full] of Object.entries(isl.garrison ?? {})) {
    const n = Math.min(full, (rt.garrison[id] ?? 0) + (full * Math.max(0, t - rt.garrisonAt)) / regen);
    if (n >= 1) out[id] = Math.floor(n);
  }
  return out;
}

export function stockAt(isl, rt, t) {
  const out = {};
  if (!isl.loot) return out;
  const h = Math.max(0, t - rt.stockAt) / HOUR_MS;
  for (const [res, k] of Object.entries(isl.loot.mix)) {
    out[res] = Math.floor(Math.min(isl.loot.max * k, (rt.stock[res] ?? 0) + isl.loot.rate * k * universe.speed * h));
  }
  return out;
}

/** Reparte `capacity` entre los recursos de `stock` (como mucho `share` de cada uno). */
function takeLoot(stock, capacity, share = LOOT_SHARE) {
  const avail = {};
  let total = 0;
  for (const [res, n] of Object.entries(stock)) {
    avail[res] = Math.max(0, n * share);
    total += avail[res];
  }
  const k = total > capacity ? capacity / total : 1;
  const loot = {};
  for (const [res, n] of Object.entries(avail)) {
    const v = Math.floor(n * k);
    if (v > 0) loot[res] = v;
  }
  return loot;
}

function pick(result) {
  return {
    rounds: result.rounds,
    att: { start: result.att.start, lost: result.att.lost },
    def: { start: result.def.start, lost: result.def.lost },
  };
}

function fmtBag(bag) {
  return Object.entries(bag ?? {})
    .filter(([, n]) => n > 0)
    .map(([res, n]) => `${RESOURCES[res].icon} ${Math.floor(n).toLocaleString('es-ES')}`)
    .join(' ');
}
