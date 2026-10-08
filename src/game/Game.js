import { clock, universe } from '../config.js';
import {
  ACHIEVEMENTS,
  BANNER_COLORS,
  BANNER_EMBLEMS,
  BUILDINGS,
  BUILDING_KEYS,
  COLONY,
  DAILY_REWARDS,
  DAILY_TASKS,
  DAILY_TASK_BONUS,
  DAILY_TASK_REWARD,
  DIPLOMACY,
  HERO,
  HERO_SKILLS,
  ISLAND_TYPES,
  MERCENARIES,
  MERCENARY_HOURS,
  JOINT_MAX,
  LAND_UNITS,
  PLAYER_UNITS,
  POWERS,
  QUESTS,
  RELICS,
  RELIC_RARITY,
  RELIC_SLOTS,
  RESEARCH,
  RESEARCH_KEYS,
  RESOURCES,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  UNITS,
  VACATION,
  VISITORS,
  WONDERS,
  WONDER_LEVELS,
  WONDER_RESOURCES,
} from './data.js';
import { battle, count, hasCombat } from './combat.js';
import {
  HOUR_MS,
  buildSeconds,
  buildingMax,
  canAfford,
  colonyCost,
  colonyUpgrade,
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
  relicBonus,
  storageCapacity,
  wonderLevel,
  wonderOf,
  worldEventAt,
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
    stats: { spent: 0, victories: 0, raidsRepelled: 0, expeditions: 0, powers: 0, treasures: 0, kraken: 0, pvpWins: 0, trades: 0, transports: 0, kills: 0, loot: 0, conquests: 0, donated: 0, contestWins: 0, trained: 0, explorations: 0, exchanges: 0, upgrades: 0, researched: 0, sabotages: 0 },
    daily: { last: null, streak: 0, best: 0 },
    hero: null,
    quests: { claimed: [] },
    visitor: null,
    nextVisitAt: null,
    vacation: null,
    vacationReadyAt: 0,
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
    daily: { ...base.daily, ...saved.daily },
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
    return favorRate(this.state, this.now());
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
    return this.activeQuests().filter((q) => q.done).length + this.dailyTasks().filter((t) => t.done && !t.claimed).length;
  }

  // ── Encargos diarios ───────────────────────────────────────────────────────

  /** Al empezar el día se eligen tres encargos entre los posibles (lo decide el servidor). */
  #ensureTasks(now) {
    const day = Math.floor(now / 86_400_000);
    if (this.state.tasks?.day === day) return;
    // Una foto al día del imperio, para la gráfica del perfil (las últimas cuatro semanas)
    const army = Object.values(this.state.units).reduce((a, b) => a + b, 0) + this.state.missions.reduce((a, m) => a + count(m.units), 0);
    this.state.history = [...(this.state.history ?? []).filter((h) => h.day !== day), { day, points: this.score(), army }].slice(-28);
    const eligible = Object.entries(DAILY_TASKS)
      .filter(([, t]) => Object.entries(t.requires ?? {}).every(([b, n]) => this.level(b) >= n))
      .map(([id]) => id);
    // Barajado con una semilla del día y del jugador: siempre los mismos ese día
    let seed = (day * 2654435761 + Number(this.userId ?? 0) * 40503) >>> 0;
    const rand = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const town = Math.max(1, this.level('ayuntamiento'));
    const picks = eligible.slice(0, 3).map((id) => ({ id, need: DAILY_TASKS[id].need(town) }));
    const base = {};
    for (const p of picks) base[DAILY_TASKS[p.id].stat] = this.state.stats[DAILY_TASKS[p.id].stat] ?? 0;
    this.state.tasks = { day, town, picks, base, claimed: [] };
    this.#dirty = true;
  }

  /** Los encargos de hoy con lo que llevas de cada uno. */
  dailyTasks() {
    const t = this.state.tasks;
    if (!t) return [];
    return t.picks.map((p) => {
      const def = DAILY_TASKS[p.id];
      const progress = Math.floor((this.state.stats[def.stat] ?? 0) - (t.base[def.stat] ?? 0));
      return { ...p, icon: def.icon, text: def.text(p.need), progress: Math.min(progress, p.need), done: progress >= p.need, claimed: t.claimed.includes(p.id) };
    });
  }

  /** Recompensa de un encargo (y la de los tres, si es el último). */
  taskReward() {
    const k = 1 + 0.3 * (Math.max(1, this.state.tasks?.town ?? 1) - 1);
    const out = {};
    for (const [r, n] of Object.entries(DAILY_TASK_REWARD)) out[r] = Math.round(n * k);
    return out;
  }

  claimTask(id, now = this.now()) {
    this.#advance(now);
    const task = this.dailyTasks().find((x) => x.id === id);
    if (!task) return this.#fail('Ese encargo no es de hoy.');
    if (task.claimed) return this.#fail('Ya has cobrado ese encargo.');
    if (!task.done) return this.#fail('Todavía no lo has terminado.');
    const reward = this.taskReward();
    this.#gain(reward);
    this.state.tasks.claimed.push(id);
    let text = `📜 Encargo cumplido: ${fmtBag(reward)}`;
    if (this.state.tasks.claimed.length === this.state.tasks.picks.length) {
      const { favor, ...rest } = DAILY_TASK_BONUS;
      this.#gain(rest);
      this.state.favor += favor;
      text += ` · ¡y los tres de hoy! ${fmtBag(rest)} · 🙏 ${favor}`;
    }
    this.#note(text, 'success');
    return this.#done();
  }

  // ── Recompensa diaria y logros ─────────────────────────────────────────────

  /** Estado de la recompensa diaria: si se puede reclamar hoy y qué toca. */
  dailyStatus(now = this.now()) {
    const today = Math.floor(now / 86_400_000);
    const d = this.state.daily;
    const available = d.last !== today;
    const streak = available ? (d.last === today - 1 ? d.streak + 1 : 1) : d.streak;
    const day = ((streak - 1) % DAILY_REWARDS.length) + 1;
    const k = 1 + 0.25 * Math.max(0, this.level('ayuntamiento') - 1);
    const reward = {};
    for (const [res, n] of Object.entries(DAILY_REWARDS[day - 1])) reward[res] = res === 'favor' ? n : Math.round(n * k);
    return { available, streak, day, reward, today };
  }

  achievements() {
    return ACHIEVEMENTS.filter((a) => a.check(this)).map((a) => a.id);
  }

  // ── Modo vacaciones ────────────────────────────────────────────────────────

  /** Si estás de vacaciones (y cuándo puedes volver) o, si no, si puedes irte y por qué no. */
  vacationStatus(now = this.now()) {
    const s = this.state;
    if (s.vacation) return { active: true, since: s.vacation.since, until: s.vacation.until, canEnd: now >= s.vacation.until };
    const attacked = this.world.underAttack ? this.world.underAttack(this.userId) : !!this.incoming?.length;
    let reason = null;
    if (s.missions.length) reason = 'Tienes flotas en el mar o tropas de apoyo fuera: espera a que vuelvan.';
    else if (s.raid) reason = 'Hay piratas a la vista: defiende antes tu isla.';
    else if (attacked) reason = 'Una flota enemiga viene hacia tu isla.';
    else if ((s.vacationReadyAt ?? 0) > now) reason = 'Acabas de volver de vacaciones.';
    return { active: false, reason, readyAt: s.vacationReadyAt ?? 0 };
  }

  startVacation(now = this.now()) {
    this.#advance(now);
    const st = this.vacationStatus(now);
    if (st.active) return this.#fail('Ya estás de vacaciones.');
    if (st.reason) return this.#fail(st.reason);
    this.state.vacation = { since: now, until: now + hours(VACATION.minHours) };
    this.#note('🏖️ Modo vacaciones: tu isla descansa y nadie la puede atacar.', 'success');
    return this.#done();
  }

  endVacation(now = this.now()) {
    this.#advance(now);
    const s = this.state;
    if (!s.vacation) return this.#fail('No estás de vacaciones.');
    if (now < s.vacation.until) return this.#fail(`Las vacaciones duran al menos ${VACATION.minHours} horas.`);
    s.vacation = null;
    s.vacationReadyAt = now + hours(VACATION.cooldownHours);
    // Que los piratas y los visitantes no lleguen todos de golpe al volver
    if (s.nextRaidAt) s.nextRaidAt = Math.max(s.nextRaidAt, now + hours(RAID_MIN_H));
    if (s.nextVisitAt) s.nextVisitAt = Math.max(s.nextVisitAt, now + hours(1));
    this.#note('⚓ ¡Bienvenido de vuelta! Tu isla vuelve a producir.', 'success');
    return this.#done();
  }

  // ── Almirante ──────────────────────────────────────────────────────────────

  get hero() {
    return this.state.hero;
  }

  /** Dónde está el almirante: 'casa', 'mision' o 'herido' (null si no hay). */
  heroStatus(now = this.now()) {
    const h = this.state.hero;
    if (!h) return null;
    if (h.mission != null && this.state.missions.some((m) => m.id === h.mission)) return 'mision';
    if ((h.woundedUntil ?? 0) > now) return 'herido';
    return 'casa';
  }

  /** Bono de una habilidad (0 si el almirante no está o no la tiene). */
  heroBonus(skill) {
    const h = this.state.hero;
    return h ? (h.skills[skill] ?? 0) * HERO_SKILLS[skill].per : 0;
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
    return tradeRate(this.state, from, to, this.now());
  }

  /** El evento del archipiélago que hay ahora (o null). */
  worldEvent(now = this.now()) {
    return worldEventAt(now);
  }

  colony(id) {
    return this.state.colonies.find((c) => c.id === id) ?? null;
  }

  /** Si tienes alguna colonia en el continente `id`. */
  hasColonyOn(id) {
    return this.state.colonies.some((c) => this.world.island(c.id)?.land === id);
  }

  /** Aportar recursos a la maravilla de un continente donde tienes colonia. */
  donateWonder(id, bag, now = this.now()) {
    this.#advance(now);
    const isl = this.world.island(id);
    if (!isl || isl.type !== 'continente') return this.#fail('Eso no es un continente.');
    if (!this.hasColonyOn(id)) return this.#fail('Necesitas una colonia en este continente para ayudar a levantar su maravilla.');
    const gift = {};
    for (const r of WONDER_RESOURCES) {
      const n = Math.floor(Number(bag?.[r]) || 0);
      if (n > 0) gift[r] = n;
    }
    const total = sum(gift);
    if (!total) return this.#fail('Elige cuánta madera, piedra o cristal aportas.');
    if (!canAfford(this.state.resources, gift)) return this.#fail('No tienes tantos recursos.');
    const rt = this.world.islandState(id);
    if (wonderLevel(rt?.wonder?.progress) >= WONDER_LEVELS.length) return this.#fail('La maravilla ya está terminada.');
    const left = WONDER_LEVELS.at(-1) - (rt?.wonder?.progress ?? 0);
    if (total > left) return this.#fail(`Solo faltan ${left.toLocaleString('es-ES')} recursos para terminarla.`);
    this.#pay(gift);
    this.state.stats.donated = (this.state.stats.donated ?? 0) + total;
    this.world.donateWonder?.(id, this.userId, total, now);
    this.#note(`${WONDERS[wonderOf(isl)].icon} Aportas ${fmtBag(gift)} a la maravilla`, 'success');
    return this.#done();
  }

  // ── Mercenarios ────────────────────────────────────────────────────────────

  /** Las compañías que ofrece hoy la taberna: cuántos vienen, qué cuestan y si ya la has contratado. */
  mercenaryOffers(now = this.now()) {
    const lvl = this.level('taberna');
    const day = Math.floor(now / 86_400_000);
    const hired = this.state.mercsHired?.day === day ? this.state.mercsHired.ids : [];
    return Object.entries(MERCENARIES).map(([id, m]) => {
      const count = lvl ? Math.round(m.base + m.per * (lvl - 1)) : 0;
      const cost = Object.fromEntries(Object.entries(m.price).map(([r, n]) => [r, n * count]));
      return { id, ...m, count, cost, hired: hired.includes(id) };
    });
  }

  hireMercenaries(id, now = this.now()) {
    this.#advance(now);
    if (this.level('taberna') < 1) return this.#fail('Construye la taberna para contratar mercenarios.');
    const offer = this.mercenaryOffers(now).find((o) => o.id === id);
    if (!offer) return this.#fail('Esa compañía no existe.');
    if (offer.hired) return this.#fail('Esa compañía ya está contratada hoy. Mañana habrá otra.');
    if (!canAfford(this.state.resources, offer.cost)) return this.#fail('No tienes con qué pagarles.');
    this.#pay(offer.cost, false);
    this.state.units[offer.unit] += offer.count;
    const day = Math.floor(now / 86_400_000);
    this.state.mercsHired = { day, ids: [...(this.state.mercsHired?.day === day ? this.state.mercsHired.ids : []), id] };
    this.state.mercs = [...(this.state.mercs ?? []), { id, unit: offer.unit, count: offer.count, until: now + hours(MERCENARY_HOURS) }];
    this.#note(`${offer.icon} Llegan ${offer.count} × ${UNITS[offer.unit].name} a sueldo durante un día`, 'success');
    return this.#done();
  }

  /** Se acaba el contrato: se van los que queden (primero los de casa, luego los de las flotas). */
  #dismissMercs(c, t) {
    this.state.mercs = (this.state.mercs ?? []).filter((x) => x !== c);
    let left = c.count;
    const home = Math.min(left, this.state.units[c.unit] ?? 0);
    this.state.units[c.unit] -= home;
    left -= home;
    for (const m of this.state.missions) {
      if (left <= 0) break;
      const n = Math.min(left, m.units[c.unit] ?? 0);
      if (!n) continue;
      m.units[c.unit] -= n;
      if (!m.units[c.unit]) delete m.units[c.unit];
      left -= n;
    }
    const gone = c.count - left;
    if (gone > 0) this.#note(`${MERCENARIES[c.id]?.icon ?? '⚔️'} Termina el contrato: se van ${gone} × ${UNITS[c.unit].name}`, 'info');
  }

  // ── Título ─────────────────────────────────────────────────────────────────

  /** Uno de tus logros como título junto a tu nombre ('' para no llevar ninguno). */
  setTitle(id, now = this.now()) {
    this.#advance(now);
    if (id && !this.achievements().includes(id)) return this.#fail('Todavía no has ganado ese logro.');
    this.state.title = id || null;
    return this.#done();
  }

  // ── Estandarte ─────────────────────────────────────────────────────────────

  setBanner(color, emblem, now = this.now()) {
    this.#advance(now);
    if (!BANNER_COLORS.includes(color) || !BANNER_EMBLEMS.includes(emblem)) return this.#fail('Ese estandarte no existe.');
    this.state.banner = { color, emblem };
    return this.#done();
  }

  // ── Reliquias ──────────────────────────────────────────────────────────────

  relics() {
    return (this.state.relics ?? []).map((r) => ({ ...r, ...RELICS[r.id] }));
  }

  /** Equipar o guardar una reliquia (como mucho RELIC_SLOTS a la vez). */
  equipRelic(id, on, now = this.now()) {
    this.#advance(now);
    const r = (this.state.relics ?? []).find((x) => x.id === id);
    if (!r) return this.#fail('No tienes esa reliquia.');
    if (on && !r.equipped && this.state.relics.filter((x) => x.equipped).length >= RELIC_SLOTS) return this.#fail(`Solo puedes llevar ${RELIC_SLOTS} reliquias a la vez.`);
    r.equipped = !!on;
    return this.#done();
  }

  /** Vender una reliquia a los coleccionistas del mercado. */
  sellRelic(id, now = this.now()) {
    this.#advance(now);
    const r = (this.state.relics ?? []).find((x) => x.id === id);
    if (!r) return this.#fail('No tienes esa reliquia.');
    const price = RELIC_RARITY[RELICS[id].rarity].sell;
    this.state.relics = this.state.relics.filter((x) => x !== r);
    this.#gain({ oro: price });
    this.#note(`${RELICS[id].icon} Vendes ${RELICS[id].name} por 🪙 ${price.toLocaleString('es-ES')}`, 'success');
    return this.#done();
  }

  /** Una reliquia que aún no tienes, de la rareza que toque (o su valor en oro si ya las tienes todas). */
  #findRelic(t, where, weights) {
    const owned = new Set((this.state.relics ?? []).map((r) => r.id));
    let roll = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
    let rarity = 'rara';
    for (const [k, w] of Object.entries(weights)) {
      if ((roll -= w) < 0) {
        rarity = k;
        break;
      }
    }
    const free = Object.keys(RELICS).filter((id) => !owned.has(id));
    const pool = free.filter((id) => RELICS[id].rarity === rarity);
    const id = (pool.length ? pool : free)[Math.floor(Math.random() * (pool.length || free.length))];
    if (!id) {
      this.#gain({ oro: RELIC_RARITY[rarity].sell });
      return;
    }
    const def = RELICS[id];
    this.state.relics = [...(this.state.relics ?? []), { id, t, equipped: (this.state.relics ?? []).filter((r) => r.equipped).length < RELIC_SLOTS }];
    this.#report({ t, kind: 'reliquia', outcome: 'victoria', title: `Reliquia ${RELIC_RARITY[def.rarity].name.toLowerCase()}: ${def.name}`, text: `${def.icon} La has encontrado ${where}. ${def.text}. Equípala o véndela desde el ayuntamiento.` });
    this.#note(`🏺 ¡Has encontrado ${def.name}!`, 'success');
    if (def.rarity === 'legendaria') this.world.announce?.(`🏺 ${this.state.name} ha encontrado ${def.name}`);
  }

  /** Ampliar una colonia: cuesta recursos y tarda un rato; solo una a la vez. */
  upgradeColony(id, now = this.now()) {
    this.#advance(now);
    const col = this.colony(id);
    if (!col) return this.#fail('Esa isla no es tu colonia.');
    const level = col.level ?? 1;
    if (level >= COLONY.maxLevel) return this.#fail('La colonia ya está al máximo.');
    if (this.state.colonies.some((c) => c.upgradeEnd)) return this.#fail('Ya estás ampliando una colonia.');
    const { cost, seconds } = colonyUpgrade(level);
    if (!canAfford(this.state.resources, cost)) return this.#fail('No tienes recursos suficientes.');
    this.#pay(cost);
    col.upgradeEnd = now + seconds * 1000;
    this.#note(`🚩 Los colonos de ${col.name} empiezan a ampliar la colonia`, 'success');
    return this.#done();
  }

  #finishColony(col) {
    col.level = (col.level ?? 1) + 1;
    delete col.upgradeEnd;
    this.#note(`🚩 ${col.name} sube a nivel ${col.level}`, 'success');
  }

  /** Vista de una isla en el instante `t`: datos fijos, estado compartido y lo que sabes de ella. */
  island(id, t = this.now()) {
    const isl = this.world.island(id);
    if (!isl) return null;
    const rt = this.world.islandState(id);
    const known = this.state.known[id];
    const view = {
      ...isl,
      typeName: isl.land && isl.type === 'libre' ? 'Tierra libre' : ISLAND_TYPES[isl.type].name,
      dist: this.distanceTo(id),
      explored: isl.type === 'brumas' || isl.type === 'continente' || isl.owner === this.userId || !!known?.explored,
      intel: known?.intel ?? null,
      inbound: this.state.missions.filter((m) => m.target === id),
      mine: isl.owner != null && isl.owner === this.userId,
    };
    if (isl.type === 'jugador') {
      const p = this.world.playerInfo(isl.owner);
      Object.assign(view, {
        ownerName: p?.name ?? '¿?',
        score: p?.score ?? 0,
        protected: !!p?.protected,
        townLevel: p?.townLevel ?? 1,
        alliance: p?.alliance ?? null,
        online: !!p?.online,
        vacation: !!p?.vacation,
        inactive: !!p?.inactive,
        relation: this.world.relation?.(this.userId, isl.owner) ?? null,
      });
      return view;
    }
    if (isl.type === 'continente') {
      const progress = rt?.wonder?.progress ?? 0;
      const level = wonderLevel(progress);
      view.wonder = { id: wonderOf(isl), level, progress, next: WONDER_LEVELS[level] ?? null, donors: rt?.wonder?.donors ?? {}, member: this.hasColonyOn(id) };
    }
    const colonizedBy = rt?.colonizedBy ?? null;
    Object.assign(view, {
      colonized: colonizedBy != null && colonizedBy === this.userId,
      colony: colonizedBy != null && colonizedBy === this.userId ? this.colony(id) : null,
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
    this.state.stats.exchanges = (this.state.stats.exchanges ?? 0) + 1;
    this.#flush(true);
    return { ok: true, paid: Math.min(n, pay), got: get };
  }

  /** Recursos que se pueden cargar: solo enteros positivos de recursos conocidos. */
  #cleanPayload(payload) {
    const out = {};
    for (const res of RESOURCE_KEYS) {
      const n = Math.max(0, Math.floor(Number(payload?.[res]) || 0));
      if (n) out[res] = n;
    }
    return out;
  }

  /** Comprueba una misión sin enviarla. `payload`: recursos que lleva un transporte. */
  planMission(type, target, units, payload, opts = {}) {
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
    const withHero = !!opts.hero;
    const heroSpeed = withHero ? 1 + this.heroBonus('velocidad') : 1;
    const travel = Number.isFinite(speed) ? travelSeconds(s, this.distanceTo(target), speed, heroSpeed) : 0;
    // Unirse al ataque de un aliado: la flota acompasa la marcha para llegar a la vez
    const joint = opts.join ? (this.world.jointAttack?.(opts.join) ?? null) : null;
    const seconds = joint ? Math.max(1, Math.ceil((joint.arrive - this.now()) / 1000)) : travel;
    const slots = fleetSlots(s);
    const pendingColonies = s.missions.filter((m) => m.type === 'colonizar' || m.type === 'conquistar').length;
    let cost = null;

    if (target === s.home) reason ||= 'Es tu propia isla.';
    if (isl.type === 'continente') reason ||= 'Es un continente: elige una de sus ciudades o tierras.';
    if (opts.join) {
      if (type !== 'atacar') reason ||= 'Solo te puedes unir a un ataque.';
      else if (!joint || joint.target !== target) reason ||= 'Ese ataque ya no está en camino.';
      else if (joint.leaderId === this.userId) reason ||= 'Es tu propio ataque.';
      else if (!this.world.sameAlliance?.(this.userId, joint.leaderId)) reason ||= 'Solo puedes unirte a ataques de tu alianza.';
      else if (s.missions.some((m) => m.joint === opts.join)) reason ||= 'Ya te has unido a ese ataque.';
      else if (joint.allies >= JOINT_MAX) reason ||= `Ya van ${JOINT_MAX} aliados con ese ataque.`;
      else if (travel > seconds) reason ||= 'Tu flota no llega a tiempo: el ataque llegará antes.';
      if (withHero) reason ||= 'Tu almirante solo va en tus propios ataques.';
    }
    if (withHero && this.heroStatus() !== 'casa') reason ||= this.state.hero ? 'Tu almirante no está en casa o está herido.' : 'No tienes almirante.';
    if (withHero) cargo = Math.floor(cargo * (1 + this.heroBonus('botin')));
    cargo = Math.floor(cargo * (1 + relicBonus(s, 'botin')));
    if (slots < 1) reason ||= 'Necesitas un puerto para zarpar.';
    else if (s.missions.length >= slots) reason ||= `Todas tus flotas están en el mar (${s.missions.length}/${slots}). Mejora el puerto.`;
    if (!count(sent)) reason ||= 'Elige qué unidades envías.';
    else if (!ships) reason ||= 'Hace falta al menos un barco para cruzar el mar.';
    else if (used > capacity) reason ||= `Faltan plazas en los barcos: ${used}/${capacity}.`;

    let load = null;
    if (isl.type === 'jugador') {
      if (type === 'explorar') {
        if (Object.keys(sent).some((id) => !UNITS[id].explorer)) reason ||= 'Para espiar envía solo botes exploradores.';
        if (view.vacation) reason ||= `${view.ownerName} está de vacaciones: no hay nada que espiar.`;
      } else if (type === 'sabotaje') {
        if (Object.keys(sent).some((id) => !UNITS[id].explorer)) reason ||= 'Los saboteadores van en botes exploradores.';
        if (this.world.sameAlliance?.(this.userId, isl.owner)) reason ||= `${view.ownerName} es de tu alianza.`;
        else if (view.relation === 'pacto') reason ||= `Tu alianza tiene un pacto de no agresión con la de ${view.ownerName}.`;
        else if (view.vacation) reason ||= `${view.ownerName} está de vacaciones.`;
        else if (view.protected) reason ||= `${view.ownerName} está bajo protección de novato.`;
        else if (this.isProtected()) reason ||= `Mientras tengas menos de ${NEWBIE_POINTS} puntos no puedes sabotear a otros jugadores.`;
      } else if (type === 'transporte') {
        load = this.#cleanPayload(payload);
        const total = sum(load);
        if (Object.keys(sent).some((id) => UNITS[id].kind !== 'barco')) reason ||= 'Los transportes solo llevan barcos.';
        if (!total) reason ||= 'Elige qué recursos envías.';
        else if (total > cargo) reason ||= `No cabe: llevas ${total} y los barcos cargan ${cargo}.`;
        else if (!canAfford(s.resources, load)) reason ||= 'No tienes tantos recursos.';
      } else if (type === 'apoyo') {
        if (!this.world.sameAlliance?.(this.userId, isl.owner)) reason ||= 'Solo puedes mandar tropas de apoyo a miembros de tu alianza.';
        if (!hasCombat(sent)) reason ||= 'Envía al menos una unidad de combate.';
        if (s.missions.some((m) => m.type === 'apoyo' && m.target === target && m.phase !== 'vuelta')) reason ||= 'Ya tienes tropas de apoyo en esa ciudad: retíralas antes de mandar más.';
      } else if (type === 'atacar') {
        if (this.world.sameAlliance?.(this.userId, isl.owner)) reason ||= `${view.ownerName} es de tu alianza.`;
        else if (view.relation === 'pacto') reason ||= `Tu alianza tiene un pacto de no agresión con la de ${view.ownerName}.`;
        else if (view.vacation) reason ||= `${view.ownerName} está de vacaciones: su isla no se puede atacar.`;
        else if (view.protected) reason ||= `${view.ownerName} está bajo protección de novato (menos de ${NEWBIE_POINTS} puntos).`;
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
    } else if (type === 'conquistar') {
      // Vencer a la guarnición y quedarse con la ciudad: un ataque con colonos detrás
      const colonies = s.colonies.length;
      const max = maxColonies(s);
      if (isl.type !== 'ciudadela') reason ||= 'Solo se pueden conquistar las ciudades bárbaras de los continentes.';
      else if (!view.explored) reason ||= 'Espía la ciudad antes de intentar conquistarla.';
      else if (rt?.colonizedBy != null) reason ||= rt.colonizedBy === this.userId ? 'Ya es tuya.' : `${view.colonistName} ya la ha conquistado.`;
      else if (s.missions.some((m) => m.type === 'conquistar' && m.target === target)) reason ||= 'Ya va una flota a conquistarla.';
      else if (max === 0) reason ||= 'Investiga Cartografía para poder gobernar otras tierras.';
      else if (colonies + pendingColonies >= max) reason ||= `Ya tienes ${colonies + pendingColonies}/${max} colonias. Investiga más Cartografía.`;
      if (!hasCombat(sent)) reason ||= 'Envía tropas para vencer a la guarnición.';
      if (!sent.mercante) reason ||= 'Los colonos viajan en un barco mercante.';
      cost = colonyCost(colonies + pendingColonies);
      if (!canAfford(s.resources, cost)) reason ||= 'No tienes los recursos para gobernar la ciudad.';
    } else {
      reason ||= 'Misión desconocida.';
    }
    return { ok: !reason, reason, units: sent, seconds, travel, capacity, used, cargo, ships, cost, load, joint };
  }

  sendMission(type, target, units, payload, opts = {}, now = this.now()) {
    this.#advance(now);
    const plan = this.planMission(type, target, units, payload, opts);
    if (!plan.ok) return this.#fail(plan.reason);
    for (const [id, n] of Object.entries(plan.units)) this.state.units[id] -= n;
    if (plan.cost) this.#pay(plan.cost);
    if (plan.load) this.#pay(plan.load, false);
    this.state.missions.push({
      id: this.state.seq++,
      type,
      target,
      targetName: this.world.island(target).name,
      units: plan.units,
      cargo: { ...(plan.cost ?? plan.load ?? {}) },
      depart: now,
      arrive: plan.joint ? plan.joint.arrive : now + plan.seconds * 1000,
      back: null,
      phase: 'ida',
      hero: !!opts.hero,
      ...(plan.joint ? { joint: opts.join, leader: plan.joint.leader, trip: plan.travel * 1000 } : {}),
    });
    if (opts.hero) this.state.hero.mission = this.state.missions.at(-1).id;
    return this.#done();
  }

  /** Hace dar media vuelta a una flota que aún no ha llegado. */
  recall(id, now = this.now()) {
    this.#advance(now);
    const m = this.state.missions.find((x) => x.id === id);
    if (!m || (m.phase !== 'ida' && m.phase !== 'estacionada')) return this.#fail('Esa flota ya no puede volver.');
    // De ida: deshace lo andado. Estacionada: el viaje completo de vuelta.
    m.back = m.phase === 'ida' ? now + Math.min(now - m.depart, m.trip ?? Infinity) : now + (m.arrive - m.depart);
    m.recalled = m.phase === 'ida';
    m.phase = 'vuelta';
    m.turn = now;
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

  hireHero(name, now = this.now()) {
    this.#advance(now);
    if (this.state.hero) return this.#fail('Ya tienes almirante.');
    if (missingRequirements(this.state, HERO.requires).length) return this.#fail('Necesitas el ayuntamiento a nivel 3.');
    if (!canAfford(this.state.resources, HERO.cost)) return this.#fail('No tienes recursos suficientes.');
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Almirante';
    this.#pay(HERO.cost);
    this.state.hero = { name: clean, level: 1, xp: 0, points: 1, skills: { ataque: 0, defensa: 0, botin: 0, velocidad: 0 }, woundedUntil: 0, mission: null };
    this.#note(`🎖️ ${clean} se pone al mando de tu flota`, 'success');
    return this.#done();
  }

  heroSkill(skill, now = this.now()) {
    this.#advance(now);
    const h = this.state.hero;
    if (!h) return this.#fail('No tienes almirante.');
    if (!HERO_SKILLS[skill]) return this.#fail('Habilidad desconocida.');
    if (h.points < 1) return this.#fail('No te quedan puntos. Gana combates para subir de nivel.');
    h.points--;
    h.skills[skill]++;
    return this.#done();
  }

  claimDaily(now = this.now()) {
    this.#advance(now);
    const d = this.dailyStatus(now);
    if (!d.available) return this.#fail('Ya has recogido el regalo de hoy. ¡Vuelve mañana!');
    const { favor, ...rest } = d.reward;
    this.#gain(rest);
    if (favor) this.state.favor += favor;
    this.state.daily = { last: d.today, streak: d.streak, best: Math.max(this.state.daily.best ?? 0, d.streak) };
    this.#note(`🎁 Regalo del día ${d.day}: ${fmtBag(rest)}${favor ? ` · 🙏 ${favor}` : ''}`, 'success');
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
      watch: this.level('torre'),
      town: this.level('ayuntamiento'),
    };
  }

  /**
   * Otro jugador ataca tu isla en el instante `t`. Defienden tus tropas en casa
   * y la muralla; si ganan los atacantes se llevan recursos (salvo lo protegido).
   */
  receiveAttack({ attackerName, units, atkMul, hpMul, cargoMul = 1, islandName, joint = false }, t) {
    const s = this.state;
    const { result, wall } = this.#defend({ units, atkMul, hpMul }, t, attackerName);

    let stolen = null;
    let cargo = 0;
    for (const [id, n] of Object.entries(result.att.left)) cargo += n * (UNITS[id].cargo ?? 0);
    cargo = Math.floor(cargo * cargoMul);
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
      empate: joint ? `${attackerName} se retiran de tu isla` : `${attackerName} se retira de tu isla`,
      derrota: joint ? `${attackerName} han saqueado tu isla` : `${attackerName} ha saqueado tu isla`,
    }[outcome];
    this.#report({ t, kind: 'defensa', outcome, title, islandName, battle: pick(result), loot: stolen, towers: wall.towers, enemy: attackerName });
    this.#note(`⚔️ ${title}`, outcome === 'derrota' ? 'error' : 'success');
    this.#dirty = true;
    return { result, stolen: stolen ?? {} };
  }

  /** Un informe y un aviso que llegan de fuera (por ejemplo, de tus tropas de apoyo). */
  receiveNews(report, note, kind = 'info') {
    if (report) this.#report(report);
    if (note) this.#note(note, kind);
    this.#dirty = true;
  }

  /** Llega a tu isla un transporte de otro jugador. */
  receiveTransport({ fromName, cargo, islandName }, t) {
    this.#gain(cargo);
    this.#report({ t, kind: 'transporte', islandName, title: `${fromName} te envía recursos`, loot: { ...cargo }, enemy: fromName });
    this.#note(`📦 ${fromName} te ha enviado recursos`, 'success');
    this.#dirty = true;
  }

  /** Aparta recursos (oferta del mercado del archipiélago). Devuelve si había bastantes. */
  takeResources(bag, now = this.now()) {
    this.#advance(now);
    if (!canAfford(this.state.resources, bag)) return false;
    this.#pay(bag, false);
    this.#flush(true);
    return true;
  }

  /** Entrega recursos que vienen de otro jugador o del mercado. */
  giveResources(bag, note) {
    this.#gain(bag);
    if (note) this.#note(note, 'success');
    this.#flush(true);
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  /** Experiencia por las bajas causadas en un combate. */
  #heroXp(killed, t) {
    const h = this.state.hero;
    if (!h) return;
    let xp = 0;
    for (const [id, n] of Object.entries(killed ?? {})) xp += (n * (UNITS[id].atk + UNITS[id].hp)) / 10;
    h.xp += Math.round(xp);
    while (h.level < HERO.maxLevel && h.xp >= HERO.xpFor(h.level + 1)) {
      h.level++;
      h.points++;
      this.#note(`🎖️ ${h.name} sube a nivel ${h.level}: tienes un punto de habilidad`, 'success');
    }
  }

  #heroWounded(t) {
    const h = this.state.hero;
    if (!h) return;
    h.mission = null;
    h.woundedUntil = t + hours(HERO.woundHours);
    this.#note(`🎖️ ${h.name} vuelve herido. Tardará en recuperarse.`, 'error');
  }

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
      this.#ensureTasks(now);
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
    for (const m of s.missions) {
      // Las estacionadas no tienen fecha; las de un ataque conjunto las resuelve quien lo dirige
      if (m.phase === 'estacionada' || (m.joint && m.phase === 'ida')) continue;
      consider(m.phase === 'ida' ? m.arrive : m.back, (t) => this.#missionEvent(m, t));
    }
    if (s.raid) consider(s.raid.arrival, (t) => this.#resolveRaid(t));
    else if (s.nextRaidAt && !s.vacation) consider(s.nextRaidAt, (t) => this.#spawnRaid(t));
    if (s.visitor) consider(s.visitor.expires, (t) => this.#visitorLeaves(t));
    else if (s.nextVisitAt && !s.vacation) consider(s.nextVisitAt, (t) => this.#spawnVisitor(t));
    for (const col of s.colonies) if (col.upgradeEnd) consider(col.upgradeEnd, () => this.#finishColony(col));
    // Cambia la temporada del archipiélago: cambia la producción
    consider(worldEventAt(s.lastUpdate).end, () => {});
    // El final de un efecto divino también es un suceso: cambia la producción
    for (const [id, until] of Object.entries(s.buffs)) consider(until, () => delete s.buffs[id]);
    for (const c of s.mercs ?? []) consider(c.until, (t) => this.#dismissMercs(c, t));
    return best;
  }

  #accrue(t) {
    const s = this.state;
    const start = s.lastUpdate;
    const h = Math.max(0, t - start) / HOUR_MS;
    s.lastUpdate = Math.max(start, t);
    if (h === 0 || s.vacation) return; // de vacaciones la isla ni produce ni gasta
    s.favor = Math.min(Math.max(s.favor, favorMax(s)), s.favor + favorRate(s, start) * h);
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
    this.state.stats.upgrades = (this.state.stats.upgrades ?? 0) + 1;
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
    this.state.stats.researched = (this.state.stats.researched ?? 0) + 1;
    const r = RESEARCH[q.id];
    this.#note(`${r.icon} Investigación completada: ${r.name} nivel ${q.level}`, 'success');
  }

  #trainOne(building, t) {
    const q = this.state.training[building];
    const head = q[0];
    head.done++;
    this.state.units[head.unit]++;
    this.state.stats.trained = (this.state.stats.trained ?? 0) + 1;
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
      if (m.hero && this.state.hero) this.state.hero.mission = null;
      const loot = fmtBag(m.cargo);
      this.#note(`⚓ Ha vuelto la flota de ${m.targetName}${loot ? `: ${loot}` : ''}`, 'success');
      return;
    }

    const isl = this.world.island(m.target);
    if (!isl) {
      // La isla ha desaparecido del mundo: la flota vuelve sin más
    } else if (isl.type === 'jugador') {
      if (m.type === 'explorar') this.#arriveSpy(m, isl, t);
      else if (m.type === 'sabotaje') this.#arriveSabotage(m, isl, t);
      else if (m.type === 'apoyo') {
        // Si ya no sois aliados al llegar, las tropas se dan la vuelta
        if (!this.world.sameAlliance?.(this.userId, isl.owner)) {
          this.#report({ t, kind: 'apoyo', island: isl.id, islandName: isl.name, title: `Apoyo rechazado en ${isl.name}`, text: 'Ya no sois aliados. Tus tropas vuelven a casa.' });
          m.rejected = true;
        }
      } else if (m.type === 'transporte') this.#arriveTransport(m, isl, t);
      else this.#arrivePlayerAttack(m, isl, t);
    } else if (m.type === 'explorar') this.#arriveExplore(m, isl, t);
    else if (m.type === 'atacar') this.#arriveAttack(m, isl, t);
    else if (m.type === 'colonizar') this.#arriveColonize(m, isl, t);
    else if (m.type === 'conquistar') this.#arriveConquer(m, isl, t);
    else if (m.type === 'expedicion') this.#arriveExpedition(m, isl, t);

    if (m.type === 'apoyo' && !m.rejected && count(m.units) > 0) {
      // Las tropas se quedan defendiendo hasta que las retires
      m.phase = 'estacionada';
      m.stationedAt = t;
      const host = this.world.playerInfo(isl.owner)?.name ?? isl.name;
      this.#note(`🛡️ Tus tropas ya defienden ${isl.name}`, 'success');
      this.world.hostNews?.(isl.owner, `🛡️ ${this.state.name} ha enviado tropas para defender tu ciudad`);
      this.#report({ t, kind: 'apoyo', island: isl.id, islandName: isl.name, title: `Defendiendo la ciudad de ${host}`, text: 'Tus tropas se quedan hasta que las retires. Siguen comiendo de tus graneros.' });
      return;
    }
    if (count(m.units) > 0) {
      m.phase = 'vuelta';
      m.turn = t;
      m.back = t + (m.arrive - m.depart) * (m.slow ?? 1);
    } else {
      this.state.missions = this.state.missions.filter((x) => x !== m);
      if (m.hero) this.#heroWounded(t);
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
    this.state.stats.explorations = (this.state.stats.explorations ?? 0) + 1;
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
      if (Math.random() < 0.35) this.#findRelic(t, `entre las ruinas de ${isl.name}`, { rara: 60, epica: 35, legendaria: 5 });
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

  /** Saboteadores en la ciudad de otro jugador: si no los pillan, queman o retrasan algo. */
  #arriveSabotage(m, isl, t) {
    const owner = this.world.playerInfo(isl.owner)?.name ?? isl.name;
    const rel = this.world.relation?.(this.userId, isl.owner);
    const res = rel === 'aliado' || rel === 'pacto' ? null : this.world.sabotage?.(isl.owner, { attackerName: this.state.name, stealth: relicBonus(this.state, 'sigilo') }, t);
    if (!res) {
      this.#report({ t, kind: 'exploracion', island: isl.id, islandName: isl.name, title: `Sabotaje cancelado en ${isl.name}`, text: 'Los saboteadores no han podido (o no debían) acercarse. Vuelven a casa.' });
      return;
    }
    if (res.caught) {
      const lost = { ...m.units };
      m.units = {};
      this.#report({ t, kind: 'exploracion', island: isl.id, islandName: isl.name, outcome: 'derrota', title: `Saboteadores capturados en ${isl.name}`, text: `Los vigías de ${owner} los han descubierto. Has perdido los botes.`, lostUnits: lost });
      this.#note(`🔥 Han capturado a tus saboteadores en ${isl.name}`, 'error');
      return;
    }
    this.state.stats.sabotages = (this.state.stats.sabotages ?? 0) + 1;
    this.#report({ t, kind: 'exploracion', island: isl.id, islandName: isl.name, outcome: 'victoria', title: `Sabotaje en ${isl.name}`, text: res.text, enemy: owner });
    this.#note(`🔥 Sabotaje en ${isl.name}: ${res.text}`, 'success');
  }

  /** Te sabotean la ciudad. Muralla y torre de vigía ayudan a pillarlos. */
  receiveSabotage({ attackerName, stealth = 0 }, t) {
    const chance = Math.min(0.85, 0.15 + 0.08 * this.level('muralla') + 0.05 * this.level('torre')) * (1 - stealth);
    if (Math.random() < chance) {
      this.#report({ t, kind: 'defensa', outcome: 'victoria', title: 'Saboteadores capturados', text: `Tus vigías han capturado a los saboteadores de ${attackerName} antes de que hicieran nada.` });
      this.#note(`🔥 Tus vigías han capturado a unos saboteadores de ${attackerName}`, 'success');
      this.#dirty = true;
      return { caught: true };
    }
    const q = this.state.queue;
    let mine;
    let theirs;
    if (q && Math.random() < 0.5) {
      // Retrasan la obra en marcha (un 30 % de lo que le queda, como mucho una hora de juego)
      const delay = Math.round(Math.min(Math.max(0, q.end - t) * 0.3, hours(1)));
      q.end += delay;
      const mins = Math.max(1, Math.round(delay / 60000));
      mine = `Han saboteado la obra de ${BUILDINGS[q.id].name}: se retrasa ${mins} min.`;
      theirs = `La obra de ${BUILDINGS[q.id].name} se retrasa ${mins} min.`;
    } else {
      // Queman parte de lo que no está a salvo en el almacén
      const safe = protectedAmount(this.state);
      const pool = RESOURCE_KEYS.filter((r) => this.state.resources[r] - safe > 50).sort(() => Math.random() - 0.5).slice(0, 2);
      const burnt = {};
      for (const r of pool) {
        const n = Math.floor((this.state.resources[r] - safe) * 0.12);
        if (n > 0) {
          burnt[r] = n;
          this.state.resources[r] -= n;
        }
      }
      mine = Object.keys(burnt).length ? `Han quemado ${fmtBag(burnt)} de tus almacenes.` : 'No encontraron nada que quemar.';
      theirs = Object.keys(burnt).length ? `Arden ${fmtBag(burnt)} en sus almacenes.` : 'No había nada fuera del almacén que quemar.';
    }
    this.#report({ t, kind: 'defensa', outcome: 'derrota', title: 'Sabotaje en tu ciudad', text: `Saboteadores de ${attackerName}. ${mine}` });
    this.#note(`🔥 ¡Sabotaje! ${mine}`, 'error');
    this.#dirty = true;
    return { caught: false, text: theirs };
  }

  #arriveSpy(m, isl, t) {
    const info = this.world.spyPlayer?.(isl.owner, t);
    if (!info) {
      this.#report({ t, kind: 'exploracion', island: isl.id, islandName: isl.name, title: `Sin noticias de ${isl.name}`, text: 'El bote no ha podido acercarse.' });
      return;
    }
    // Los vigías de la muralla pueden descubrir el bote (8 % por nivel, como mucho 60 %)
    if (Math.random() < Math.min(0.7, 0.08 * info.wall + 0.04 * (info.watch ?? 0)) * (1 - relicBonus(this.state, 'sigilo'))) {
      const lost = { ...m.units };
      m.units = {};
      this.#report({ t, kind: 'exploracion', island: isl.id, islandName: isl.name, outcome: 'derrota', title: `Espía descubierto en ${isl.name}`, text: 'Los vigías de la muralla han visto el bote y lo han hundido.', lostUnits: lost });
      this.#note(`🔭 Han descubierto a tu espía en ${isl.name}`, 'error');
      this.world.hostNews?.(isl.owner, `🔭 Tus vigías han hundido un bote espía de ${this.state.name}`);
      return;
    }
    this.state.stats.explorations = (this.state.stats.explorations ?? 0) + 1;
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

  #arriveTransport(m, isl, t) {
    const delivered = this.world.deliver?.(isl.owner, { fromName: this.state.name, cargo: m.cargo, islandName: this.homeIsland?.name }, t);
    const owner = this.world.playerInfo(isl.owner)?.name ?? isl.name;
    if (!delivered) {
      this.#report({ t, kind: 'transporte', island: isl.id, islandName: isl.name, title: `Nadie recoge la carga en ${isl.name}`, text: 'Los barcos vuelven con todo.' });
      return;
    }
    this.state.stats.transports = (this.state.stats.transports ?? 0) + 1;
    this.#report({ t, kind: 'transporte', island: isl.id, islandName: isl.name, title: `Carga entregada a ${owner}`, loot: { ...m.cargo }, enemy: owner });
    this.#note(`📦 Carga entregada en ${isl.name}`, 'success');
    m.cargo = {};
  }

  #arrivePlayerAttack(m, isl, t) {
    // Lo que valía al zarpar puede haber cambiado por el camino
    const rel = this.world.relation?.(this.userId, isl.owner);
    const away = this.world.playerInfo?.(isl.owner)?.vacation;
    if (rel === 'aliado' || rel === 'pacto' || away) {
      const why = away
        ? `${this.world.playerInfo(isl.owner).name} se ha ido de vacaciones: su isla no se puede atacar.`
        : rel === 'aliado'
          ? 'Ahora sois aliados: tu flota se da la vuelta sin combatir.'
          : 'Vuestras alianzas han firmado un pacto de no agresión: tu flota se da la vuelta.';
      this.#report({ t, kind: 'ataque', island: isl.id, islandName: isl.name, title: `Ataque cancelado en ${isl.name}`, text: why });
      return;
    }
    const { atkMul, hpMul } = playerCombat(this.state);
    const hero = m.hero ? { atk: this.heroBonus('ataque'), cargo: 1 + this.heroBonus('botin') } : { atk: 0, cargo: 1 };
    const war = this.world.relation?.(this.userId, isl.owner) === 'guerra';
    const cargoMul = hero.cargo * (war ? 1 + DIPLOMACY.warLoot : 1) * (1 + relicBonus(this.state, 'botin'));
    // Los aliados que se han unido a este ataque combaten como un solo ejército
    const allies = this.world.jointFleets?.(`${this.userId}-${m.id}`, t) ?? [];
    const groups = [
      { units: { ...m.units }, atkMul: atkMul + hero.atk, hpMul },
      ...allies.map((a) => ({ units: { ...a.mission.units }, atkMul: a.combat.atkMul, hpMul: a.combat.hpMul, ally: a })),
    ];
    const combined = {};
    let size = 0;
    let atkSum = 0;
    let hpSum = 0;
    for (const g of groups) {
      const n = count(g.units);
      size += n;
      atkSum += g.atkMul * n;
      hpSum += g.hpMul * n;
      for (const [id, k] of Object.entries(g.units)) combined[id] = (combined[id] ?? 0) + k;
    }
    const names = allies.map((a) => a.name);
    const res = this.world.attackPlayer?.(
      isl.owner,
      { attackerId: this.userId, attackerName: names.length ? `${[this.state.name, ...names].slice(0, -1).join(', ')} y ${names.at(-1)}` : this.state.name, joint: names.length > 0, units: combined, atkMul: atkSum / size, hpMul: hpSum / size, cargoMul, islandName: this.homeIsland?.name },
      t,
    );
    if (!res) {
      const empty = { t, kind: 'ataque', island: isl.id, islandName: isl.name, title: `No hay nadie en ${isl.name}`, text: 'La ciudad está vacía. La flota vuelve a casa.' };
      this.#report(empty);
      for (const a of allies) a.settle({ left: a.mission.units, loot: {}, kills: 0, won: false, report: empty });
      return;
    }
    const { result, stolen } = res;
    const lefts = shareSurvivors(groups.map((g) => g.units), result.att.left);
    const loots = splitBag(stolen, lefts.map(cargoOf));
    const killed = count(result.def.lost);
    const outcome = result.winner === 'att' ? 'victoria' : result.winner === 'def' ? 'derrota' : 'empate';
    const enemy = this.world.playerInfo(isl.owner)?.name ?? isl.name;
    const battleLog = pick(result);
    const warText = war ? `Guerra entre alianzas: los barcos cargan un ${Math.round(DIPLOMACY.warLoot * 100)} % más de botín.` : '';

    m.units = lefts[0];
    for (const [r, n] of Object.entries(loots[0])) m.cargo[r] = (m.cargo[r] ?? 0) + n;
    if (m.hero) this.#heroXp(result.def.lost, t);
    this.state.stats.kills += Math.round((killed * count(groups[0].units)) / size);
    this.state.stats.loot += count(loots[0]);
    if (outcome === 'victoria') {
      this.state.stats.victories++;
      this.state.stats.pvpWins++;
    }
    const title = { victoria: `Has saqueado ${isl.name}`, derrota: `Derrota en ${isl.name}`, empate: `Retirada de ${isl.name}` }[outcome];
    const text = [names.length ? `🤝 Ataque conjunto con ${names.join(', ')}. El botín se reparte según la bodega de cada uno.` : '', warText].filter(Boolean).join(' ') || undefined;
    this.#report({ t, kind: 'ataque', island: isl.id, islandName: isl.name, outcome, title, text, battle: battleLog, loot: loots[0], enemy, pvp: true });
    this.#note(`⚔️ ${title}${fmtBag(loots[0]) ? ` · botín ${fmtBag(loots[0])}` : ''}`, outcome === 'victoria' ? 'success' : 'error');

    allies.forEach((a, i) => {
      const g = groups[i + 1];
      const allyTitle = { victoria: `Ataque conjunto: saqueo de ${isl.name}`, derrota: `Ataque conjunto: derrota en ${isl.name}`, empate: `Ataque conjunto: retirada de ${isl.name}` }[outcome];
      a.settle({
        left: lefts[i + 1],
        loot: loots[i + 1],
        kills: Math.round((killed * count(g.units)) / size),
        won: outcome === 'victoria',
        report: {
          t,
          kind: 'ataque',
          island: isl.id,
          islandName: isl.name,
          outcome,
          title: allyTitle,
          text: [`🤝 Al mando, ${this.state.name}. Tus tropas: ${count(g.units)} de las ${size} del ataque.`, warText].filter(Boolean).join(' '),
          battle: battleLog,
          loot: loots[i + 1],
          enemy,
          pvp: true,
        },
      });
    });
  }

  /** Resultado del ataque conjunto al que se unió esta flota (lo resuelve quien lo dirige). */
  settleJoint(m, { left, loot, kills, won, report }, t) {
    m.units = Object.fromEntries(Object.entries(left).filter(([, n]) => n > 0));
    for (const [r, n] of Object.entries(loot)) m.cargo[r] = (m.cargo[r] ?? 0) + n;
    this.state.stats.kills += kills;
    this.state.stats.loot += count(loot);
    if (won) {
      this.state.stats.victories++;
      this.state.stats.pvpWins++;
    }
    if (count(m.units) > 0) {
      m.phase = 'vuelta';
      m.turn = t;
      m.back = t + (m.trip ?? m.arrive - m.depart);
    } else {
      this.state.missions = this.state.missions.filter((x) => x !== m);
    }
    this.receiveNews(report, `⚔️ ${report.title}${fmtBag(loot) ? ` · botín ${fmtBag(loot)}` : ''}`, won ? 'success' : 'error');
  }

  /** El ataque al que te uniste ya no existe (lo han retirado): tu flota vuelve. */
  releaseJoint(m, now) {
    m.phase = 'vuelta';
    m.turn = now;
    m.recalled = true;
    m.back = now + Math.min(Math.max(0, now - m.depart), m.trip ?? Infinity);
    this.#note(`🤝 El ataque conjunto contra ${m.targetName} se ha cancelado: tu flota vuelve a casa`, 'error');
    this.#flush(true);
  }

  #arriveAttack(m, isl, t) {
    const rt = this.world.islandState(isl.id);
    if (isl.type === 'ruinas' && !rt.looted) {
      rt.looted = true;
      this.state.stats.treasures++;
      for (const [res, n] of Object.entries(isl.treasure)) m.cargo[res] = (m.cargo[res] ?? 0) + n;
      if (Math.random() < 0.35) this.#findRelic(t, `entre las ruinas de ${isl.name}`, { rara: 60, epica: 35, legendaria: 5 });
    }
    const garrison = garrisonAt(isl, rt, t);
    const stock = stockAt(isl, rt, t);
    const { atkMul, hpMul } = playerCombat(this.state);
    const siege = Object.entries(m.units).reduce((s, [id, n]) => s + (UNITS[id].siege ?? 0) * n, 0);
    const wall = Math.max(0, (isl.wall ?? 0) - siege);
    const heroAtk = m.hero ? this.heroBonus('ataque') : 0;
    const result = battle({ units: m.units, atkMul: atkMul + heroAtk, hpMul }, { units: garrison, hpMul: 1 + wall });
    if (m.hero) this.#heroXp(result.def.lost, t);
    this.state.stats.kills += count(result.def.lost);

    rt.garrison = result.def.left;
    rt.garrisonAt = t;
    m.units = result.att.left;

    let loot = null;
    if (result.winner === 'att') {
      let capacity = 0;
      for (const [id, n] of Object.entries(m.units)) capacity += n * (UNITS[id].cargo ?? 0);
      if (m.hero) capacity = Math.floor(capacity * (1 + this.heroBonus('botin')));
      capacity = Math.floor(capacity * (1 + relicBonus(this.state, 'botin')));
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
    if (loot) this.state.stats.loot += count(loot);
    if (isl.type === 'kraken' && outcome === 'victoria') {
      this.state.stats.kraken++;
      this.#note('🐙 ¡Has derrotado al Kraken! Los mares son tuyos.', 'success');
      this.#findRelic(t, 'entre los restos del Kraken', { epica: 30, legendaria: 70 });
      this.world.announce?.(`🐙 ${this.state.name} ha derrotado al Kraken de ${isl.name}`);
    }
  }

  /** Asalto a una ciudad bárbara: si cae toda la guarnición, los colonos se quedan con ella. */
  #arriveConquer(m, isl, t) {
    const cost = { ...m.cargo };
    m.cargo = {};
    this.#arriveAttack(m, isl, t);
    const rt = this.world.islandState(isl.id);
    const won = count(garrisonAt(isl, rt, t)) === 0 && hasCombat(m.units);
    const room = this.state.colonies.length < maxColonies(this.state);
    if (!won || !room || !m.units.mercante || !this.world.colonize?.(isl.id, this.userId)) {
      // Los colonos vuelven con lo que llevaban
      for (const [r, n] of Object.entries(cost)) m.cargo[r] = (m.cargo[r] ?? 0) + n;
      this.#report({
        t,
        kind: 'colonia',
        island: isl.id,
        islandName: isl.name,
        outcome: 'derrota',
        title: `${isl.name} resiste`,
        text: won ? 'La ciudad ya no se puede gobernar. Los colonos vuelven a casa.' : 'Sin vencer a toda la guarnición no hay conquista. Los colonos vuelven a casa.',
      });
      return;
    }
    // Lo que más se producía allí es lo que mandará la ciudad conquistada
    const specialty = Object.entries(isl.loot?.mix ?? { hierro: 1 }).sort((a, b) => b[1] - a[1])[0][0];
    const colonyYieldBase = Math.round(60 + (isl.tier ?? 4) * 30);
    this.state.colonies.push({ id: isl.id, name: isl.name, specialty, yield: colonyYieldBase, conquered: true });
    this.state.wonderBonus = this.world.wonderBonusFor?.(this.state.colonies) ?? this.state.wonderBonus;
    this.state.stats.conquests = (this.state.stats.conquests ?? 0) + 1;
    if (Math.random() < 0.3) this.#findRelic(t, `en el gran salón de ${isl.name}`, { rara: 50, epica: 40, legendaria: 10 });
    m.units.mercante -= 1;
    if (!m.units.mercante) delete m.units.mercante;
    const r = RESOURCES[specialty];
    this.#report({
      t,
      kind: 'colonia',
      island: isl.id,
      islandName: isl.name,
      outcome: 'victoria',
      title: `¡Has conquistado ${isl.name}!`,
      text: `Tu bandera ondea sobre la empalizada. La ciudad mandará ${r.icon} ${r.name.toLowerCase()} a tu capital y puedes ampliarla como cualquier colonia.`,
    });
    this.#note(`🏴 ¡Has conquistado ${isl.name}!`, 'success');
    this.world.announce?.(`🏴 ${this.state.name} conquista la ciudad bárbara de ${isl.name}`);
  }

  #arriveColonize(m, isl, t) {
    const ok = this.state.colonies.length < maxColonies(this.state) && this.world.colonize?.(isl.id, this.userId);
    if (!ok) {
      this.#report({ t, kind: 'colonia', island: isl.id, islandName: isl.name, title: `Colonia fallida: ${isl.name}`, text: 'Los colonos no han podido instalarse y vuelven con los recursos.' });
      return;
    }
    this.state.colonies.push({ id: isl.id, name: isl.name, specialty: isl.specialty, yield: isl.yield });
    this.state.wonderBonus = this.world.wonderBonusFor?.(this.state.colonies) ?? this.state.wonderBonus;
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
      s.stats.kills += count(result.att.lost);
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
        .filter((i) => i.type !== 'jugador' && i.type !== 'brumas' && i.type !== 'continente' && !s.known[i.id]?.explored)
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
    if (report.outcome !== 'derrota' && Math.random() < 0.12) this.#findRelic(t, 'en la niebla', { rara: 70, epica: 25, legendaria: 5 });
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

  /**
   * Defiende tu isla: tus tropas en casa, las de apoyo de tus aliados y la
   * muralla. Las bajas se reparten entre todos en proporción a lo que aportó cada uno.
   */
  #defend(attacker, t, enemyName = 'Piratas') {
    const s = this.state;
    const wall = wallBonus(this.level('muralla'), this.level('torre'));
    const mine = playerCombat(s);
    const aegis = (s.buffs.egida ?? 0) > t ? 0.5 : 0;
    const pools = [{ units: { ...s.units }, apply: (left) => PLAYER_UNITS.forEach((id) => (s.units[id] = left[id] ?? 0)) }];
    for (const sup of this.world.supportersAt?.(s.home, this.userId) ?? []) {
      pools.push({ units: { ...sup.mission.units }, apply: (left) => sup.apply(left), sup });
    }
    const combined = {};
    for (const pool of pools) for (const [id, n] of Object.entries(pool.units)) if (n > 0) combined[id] = (combined[id] ?? 0) + n;
    const heroHome = this.heroStatus(t) === 'casa';
    const heroDef = heroHome ? this.heroBonus('defensa') : 0;
    const result = battle(attacker, { units: combined, atkMul: mine.atkMul, hpMul: mine.hpMul + wall.hp + aegis + heroDef, extraAtk: wall.towers });
    s.stats.kills += count(result.att.lost);
    if (heroHome) {
      this.#heroXp(result.att.lost, t);
      if (result.winner === 'att') this.#heroWounded(t);
    }

    // Reparto de supervivientes: cada uno conserva la misma fracción; lo que sobra por redondeo, para el anfitrión
    const lefts = pools.map(() => ({}));
    for (const [id, start] of Object.entries(combined)) {
      const frac = (result.def.left[id] ?? 0) / start;
      let given = 0;
      pools.forEach((pool, i) => {
        const n = Math.floor((pool.units[id] ?? 0) * frac);
        lefts[i][id] = n;
        given += n;
      });
      const extra = (result.def.left[id] ?? 0) - given;
      const owner = pools.findIndex((pool) => (pool.units[id] ?? 0) > 0);
      lefts[owner][id] += extra;
    }
    pools.forEach((pool, i) => pool.apply(lefts[i]));

    // Cada aliado recibe su propio informe con sus bajas
    const outcome = result.winner === 'att' ? 'derrota' : result.winner === 'def' ? 'victoria' : 'empate';
    pools.forEach((pool, i) => {
      if (!pool.sup) return;
      const lost = {};
      for (const [id, n] of Object.entries(pool.units)) if (n - (lefts[i][id] ?? 0) > 0) lost[id] = n - (lefts[i][id] ?? 0);
      const title = outcome === 'derrota' ? `Tus tropas no pudieron salvar ${this.homeIsland?.name}` : `Tus tropas defienden ${this.homeIsland?.name}`;
      pool.sup.game.receiveNews(
        { t, kind: 'defensa', outcome, title, islandName: this.homeIsland?.name, text: `${enemyName} atacó la ciudad de ${s.name}.`, lostUnits: lost },
        `🛡️ ${title}`,
        outcome === 'derrota' ? 'error' : 'success',
      );
    });
    return { result, wall, allies: pools.length - 1 };
  }

  #resolveRaid(t) {
    const s = this.state;
    const raid = s.raid;
    const { result, wall } = this.#defend({ units: raid.army }, t);

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
  if (rt.colonizedBy != null) return out; // conquistada: ya no hay bárbaros
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
    log: result.log,
  };
}

/**
 * Reparte los supervivientes de un bando formado por varios grupos: cada uno
 * conserva la misma fracción de cada tipo; lo que sobra por redondeo, para el primero que lo tenga.
 */
function shareSurvivors(groups, left) {
  const start = {};
  for (const g of groups) for (const [id, n] of Object.entries(g)) start[id] = (start[id] ?? 0) + n;
  const out = groups.map(() => ({}));
  for (const [id, total] of Object.entries(start)) {
    const frac = (left[id] ?? 0) / total;
    let given = 0;
    groups.forEach((g, i) => {
      const n = Math.floor((g[id] ?? 0) * frac);
      out[i][id] = n;
      given += n;
    });
    const owner = groups.findIndex((g) => (g[id] ?? 0) > 0);
    out[owner][id] += (left[id] ?? 0) - given;
  }
  return out.map((o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0)));
}

/** Reparte un botín según unos pesos (la bodega que le queda a cada uno). */
function splitBag(bagIn, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const out = weights.map(() => ({}));
  if (!total) return out;
  for (const [res, n] of Object.entries(bagIn ?? {})) {
    let given = 0;
    weights.forEach((w, i) => {
      const k = Math.floor((n * w) / total);
      if (k) out[i][res] = k;
      given += k;
    });
    const first = weights.findIndex((w) => w > 0);
    if (n - given > 0) out[first][res] = (out[first][res] ?? 0) + n - given;
  }
  return out;
}

function cargoOf(units) {
  return Object.entries(units).reduce((s, [id, n]) => s + n * (UNITS[id].cargo ?? 0), 0);
}

function fmtBag(bag) {
  return Object.entries(bag ?? {})
    .filter(([, n]) => n > 0)
    .map(([res, n]) => `${RESOURCES[res].icon} ${Math.floor(n).toLocaleString('es-ES')}`)
    .join(' ');
}
