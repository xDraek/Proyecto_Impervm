import { GAME_SPEED, SAVE_KEY } from '../config.js';
import {
  BUILDINGS,
  BUILDING_KEYS,
  ISLANDS,
  ISLAND_BY_ID,
  ISLAND_TYPES,
  PLAYER_UNITS,
  RESEARCH,
  RESEARCH_KEYS,
  RESOURCES,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  UNITS,
} from './data.js';
import { battle, count, hasCombat } from './combat.js';
import {
  HOUR_MS,
  buildSeconds,
  canAfford,
  colonyCost,
  costFor,
  economy,
  fleetSlots,
  maxColonies,
  missingRequirements,
  multiplyCost,
  playerCombat,
  researchCost,
  researchMax,
  researchSeconds,
  storageCapacity,
  tradeRate,
  travelSeconds,
  unitSeconds,
  wallBonus,
} from './rules.js';

const SAVE_VERSION = 2;
const MAX_REPORTS = 40;

// Piratas: el primer asalto llega un rato después de que el ayuntamiento alcance
// el nivel 3; luego, cada 4-7 horas. Se avistan 20 minutos antes de llegar.
const RAID_TOWN_LEVEL = 3;
const RAID_FIRST_H = 1.5;
const RAID_MIN_H = 4;
const RAID_MAX_H = 7;
const RAID_WARNING_MIN = 20;
const RAID_THEFT = 0.2;
const LOOT_SHARE = 0.5;

const hours = (h) => (h * HOUR_MS) / GAME_SPEED;

function freshIsland(isl, t) {
  const stock = {};
  for (const [res, k] of Object.entries(isl.loot?.mix ?? {})) stock[res] = isl.loot.max * k * 0.6;
  return {
    explored: false,
    colonized: false,
    looted: false,
    garrison: { ...(isl.garrison ?? {}) },
    garrisonAt: t,
    stock,
    stockAt: t,
  };
}

function newState(now) {
  const buildings = {};
  for (const id of BUILDING_KEYS) buildings[id] = BUILDINGS[id].startLevel ?? 0;
  const research = {};
  for (const id of RESEARCH_KEYS) research[id] = 0;
  const units = {};
  for (const id of PLAYER_UNITS) units[id] = 0;
  const islands = {};
  for (const isl of ISLANDS) islands[isl.id] = freshIsland(isl, now);
  return {
    version: SAVE_VERSION,
    resources: { ...STARTING_RESOURCES },
    buildings,
    research,
    units,
    queue: null,
    researchQueue: null,
    training: { cuartel: [], puerto: [] },
    missions: [],
    islands,
    raid: null,
    nextRaidAt: null,
    reports: [],
    seq: 1,
    lastUpdate: now,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // La versión 1 solo tenía recursos, edificios y la cola de obras: se amplía.
    if (saved?.version !== 1 && saved?.version !== SAVE_VERSION) return null;
    const base = newState(saved.lastUpdate ?? Date.now());
    const islands = { ...base.islands };
    for (const [id, isl] of Object.entries(saved.islands ?? {})) if (islands[id]) islands[id] = { ...islands[id], ...isl };
    return {
      ...base,
      ...saved,
      version: SAVE_VERSION,
      resources: { ...base.resources, ...saved.resources },
      buildings: { ...base.buildings, ...saved.buildings },
      research: { ...base.research, ...saved.research },
      units: { ...base.units, ...saved.units },
      training: { ...base.training, ...saved.training },
      missions: saved.missions ?? [],
      reports: saved.reports ?? [],
      islands,
    };
  } catch {
    return null;
  }
}

/**
 * Estado y reglas de la partida. Todo se calcula a partir de marcas de tiempo:
 * `#advance` procesa en orden cronológico cada suceso (obras, investigaciones,
 * reclutas, flotas, piratas) y acumula la producción entre uno y otro, así que
 * todo sigue su curso aunque la página esté cerrada.
 *
 * Eventos: 'change' (cualquier cambio que no sea el goteo de recursos) y
 * 'notify' (detail: { text, kind }) para los avisos.
 */
export class Game extends EventTarget {
  #notes = [];
  #dirty = false;

  constructor() {
    super();
    const now = Date.now();
    this.state = loadState() ?? newState(now);
    this.#ensureRaid(this.state.lastUpdate);
    const before = { ...this.state.resources };
    const away = now - this.state.lastUpdate;
    this.#advance(now);
    this.offlineGains = away > 60_000 ? diff(this.state.resources, before) : null;
    this.backlog = this.#notes.splice(0);
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  level(id) {
    return this.state.buildings[id] ?? 0;
  }

  researchLevel(id) {
    return this.state.research[id] ?? 0;
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

  economy() {
    return economy(this.state);
  }

  /** Producción neta por hora (con hambruna si no queda comida). */
  production() {
    const eco = economy(this.state);
    return this.starving(eco) ? eco.hungry : eco.net;
  }

  starving(eco = economy(this.state)) {
    return eco.net.comida < 0 && this.state.resources.comida < 1;
  }

  capacity() {
    return storageCapacity(this.state);
  }

  colonies() {
    return ISLANDS.filter((i) => this.state.islands[i.id].colonized);
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

  /** Vista de una isla del archipiélago en el instante `t`. */
  island(id, t = Date.now()) {
    const isl = ISLAND_BY_ID[id];
    const rt = this.state.islands[id];
    return {
      ...isl,
      typeName: ISLAND_TYPES[isl.type].name,
      explored: rt.explored,
      colonized: rt.colonized,
      looted: rt.looted,
      garrison: this.#garrisonAt(isl, rt, t),
      stock: this.#stockAt(isl, rt, t),
      intel: rt.intel ?? null,
      inbound: this.state.missions.filter((m) => m.target === id),
    };
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  update(now = Date.now()) {
    this.#advance(now);
    this.#flush(false);
  }

  upgrade(id, now = Date.now()) {
    this.#advance(now);
    if (this.state.queue) return this.#fail('Ya hay una obra en marcha.');
    const next = this.nextUpgrade(id);
    if (next.missing.length) return this.#fail('No cumples los requisitos.');
    if (!next.affordable) return this.#fail('No tienes recursos suficientes.');

    this.#pay(next.cost);
    this.state.queue = { id, level: next.level, start: now, end: now + next.seconds * 1000, cost: next.cost };
    return this.#done();
  }

  cancel() {
    const q = this.state.queue;
    if (!q) return;
    this.#refund(q.cost);
    this.state.queue = null;
    this.#flush(true);
  }

  research(id, now = Date.now()) {
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

  cancelResearch() {
    const q = this.state.researchQueue;
    if (!q) return;
    this.#refund(q.cost);
    this.state.researchQueue = null;
    this.#flush(true);
  }

  train(id, amount, now = Date.now()) {
    this.#advance(now);
    const u = UNITS[id];
    const n = Math.floor(amount);
    if (!u || u.npc) return this.#fail('Unidad desconocida.');
    if (!(n >= 1)) return this.#fail('Indica cuántas unidades quieres.');
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

  cancelTraining(building, index, now = Date.now()) {
    this.#advance(now);
    const q = this.state.training[building];
    const batch = q[index];
    if (!batch) return;
    this.#refund(multiplyCost(batch.cost, batch.count - batch.done));
    q.splice(index, 1);
    let start = index === 0 ? now : q[index - 1].start + q[index - 1].count * q[index - 1].each;
    for (let i = index; i < q.length; i++) {
      q[i].start = start;
      start += q[i].count * q[i].each;
    }
    this.#flush(true);
  }

  trade(from, to, amount, now = Date.now()) {
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
    const isl = ISLAND_BY_ID[target];
    const rt = s.islands[target];
    const sent = {};
    let reason = '';
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
    const seconds = Number.isFinite(speed) ? travelSeconds(s, isl.dist, speed) : 0;
    const slots = fleetSlots(s);
    const pendingColonies = s.missions.filter((m) => m.type === 'colonizar').length;
    let cost = null;

    if (slots < 1) reason ||= 'Necesitas un puerto para zarpar.';
    else if (s.missions.length >= slots) reason ||= `Todas tus flotas están en el mar (${s.missions.length}/${slots}). Mejora el puerto.`;
    if (!count(sent)) reason ||= 'Elige qué unidades envías.';
    else if (!ships) reason ||= 'Hace falta al menos un barco para cruzar el mar.';
    else if (used > capacity) reason ||= `Faltan plazas en los barcos: ${used}/${capacity}.`;

    if (type === 'explorar') {
      if (Object.keys(sent).some((id) => !UNITS[id].explorer)) reason ||= 'Para explorar envía solo botes exploradores.';
    } else if (type === 'atacar') {
      if (rt.colonized) reason ||= 'Es tu colonia.';
      else if (rt.explored && (isl.type === 'libre' || isl.type === 'ruinas')) reason ||= 'Aquí no hay nada que atacar.';
      if (!hasCombat(sent)) reason ||= 'Envía al menos una unidad de combate.';
    } else if (type === 'colonizar') {
      const colonies = this.colonies().length;
      const max = maxColonies(s);
      if (!rt.explored) reason ||= 'Explora la isla antes de mandar colonos.';
      else if (isl.type !== 'libre') reason ||= 'Solo puedes colonizar islas deshabitadas.';
      else if (rt.colonized) reason ||= 'Ya es tu colonia.';
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

  sendMission(type, target, units, now = Date.now()) {
    this.#advance(now);
    const plan = this.planMission(type, target, units);
    if (!plan.ok) return this.#fail(plan.reason);
    for (const [id, n] of Object.entries(plan.units)) this.state.units[id] -= n;
    if (plan.cost) this.#pay(plan.cost);
    this.state.missions.push({
      id: this.state.seq++,
      type,
      target,
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
  recall(id, now = Date.now()) {
    this.#advance(now);
    const m = this.state.missions.find((x) => x.id === id);
    if (!m || m.phase !== 'ida') return;
    m.phase = 'vuelta';
    m.back = now + (now - m.depart);
    m.recalled = true;
    this.#flush(true);
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
    this.#notes = [];
    this.#flush(true);
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
      this.save();
      this.dispatchEvent(new Event('change'));
    }
    for (const n of notes) this.dispatchEvent(new CustomEvent('notify', { detail: n }));
  }

  #note(text, kind = 'info') {
    this.#notes.push({ text, kind });
  }

  #report(data) {
    const r = { id: this.state.seq++, read: false, ...data };
    this.state.reports.unshift(r);
    this.state.reports.length = Math.min(this.state.reports.length, MAX_REPORTS);
    return r;
  }

  #pay(cost) {
    for (const [res, n] of Object.entries(cost)) this.state.resources[res] -= n;
  }

  #refund(cost) {
    for (const [res, n] of Object.entries(cost)) this.state.resources[res] += n;
  }

  #garrisonAt(isl, rt, t) {
    const out = {};
    const regen = hours(isl.regenHours ?? 1);
    for (const [id, full] of Object.entries(isl.garrison ?? {})) {
      const n = Math.min(full, (rt.garrison[id] ?? 0) + (full * Math.max(0, t - rt.garrisonAt)) / regen);
      if (n >= 1) out[id] = Math.floor(n);
    }
    return out;
  }

  #stockAt(isl, rt, t) {
    const out = {};
    if (!isl.loot) return out;
    const h = Math.max(0, t - rt.stockAt) / HOUR_MS;
    for (const [res, k] of Object.entries(isl.loot.mix)) {
      out[res] = Math.floor(Math.min(isl.loot.max * k, (rt.stock[res] ?? 0) + isl.loot.rate * k * GAME_SPEED * h));
    }
    return out;
  }

  /** Avanza el tiempo hasta `now` procesando los sucesos en orden. */
  #advance(now) {
    for (let guard = 0; guard < 20000; guard++) {
      const ev = this.#nextEvent();
      if (!ev || ev.t > now) break;
      this.#accrue(ev.t);
      ev.run(ev.t);
      this.#dirty = true;
    }
    this.#accrue(now);
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
    return best;
  }

  #accrue(t) {
    const s = this.state;
    const h = Math.max(0, t - s.lastUpdate) / HOUR_MS;
    s.lastUpdate = Math.max(s.lastUpdate, t);
    if (h === 0) return;
    const eco = economy(s);
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
      const isl = ISLAND_BY_ID[m.target];
      const loot = fmtBag(m.cargo);
      this.#note(`⚓ Ha vuelto la flota de ${isl.name}${loot ? `: ${loot}` : ''}`, 'success');
      return;
    }

    if (m.type === 'explorar') this.#arriveExplore(m, t);
    else if (m.type === 'atacar') this.#arriveAttack(m, t);
    else if (m.type === 'colonizar') this.#arriveColonize(m, t);

    if (count(m.units) > 0) {
      m.phase = 'vuelta';
      m.back = t + (m.arrive - m.depart);
    } else {
      this.state.missions = this.state.missions.filter((x) => x !== m);
    }
  }

  #intel(isl, rt, t) {
    rt.intel = { t, garrison: this.#garrisonAt(isl, rt, t), stock: this.#stockAt(isl, rt, t) };
  }

  #arriveExplore(m, t) {
    const isl = ISLAND_BY_ID[m.target];
    const rt = this.state.islands[isl.id];
    const first = !rt.explored;
    rt.explored = true;
    this.#intel(isl, rt, t);
    let text = `${ISLAND_TYPES[isl.type].icon} Es ${ISLAND_TYPES[isl.type].name.toLowerCase()}.`;
    if (isl.type === 'ruinas' && !rt.looted) {
      rt.looted = true;
      for (const [res, n] of Object.entries(isl.treasure)) m.cargo[res] = (m.cargo[res] ?? 0) + n;
      text += ' ¡Entre los escombros había un tesoro!';
    } else if (isl.type === 'libre') {
      text += ` Tierra fértil: una colonia aquí produciría ${RESOURCES[isl.specialty].icon} ${RESOURCES[isl.specialty].name.toLowerCase()}.`;
    }
    this.#report({
      t,
      kind: 'exploracion',
      island: isl.id,
      title: `${first ? 'Descubierta' : 'Explorada'}: ${isl.name}`,
      text,
      intel: rt.intel,
      loot: isl.type === 'ruinas' ? { ...m.cargo } : null,
    });
    this.#note(`🔭 ${isl.name}: ${ISLAND_TYPES[isl.type].name}`, 'success');
  }

  #arriveAttack(m, t) {
    const isl = ISLAND_BY_ID[m.target];
    const rt = this.state.islands[isl.id];
    rt.explored = true;
    if (isl.type === 'ruinas' && !rt.looted) {
      rt.looted = true;
      for (const [res, n] of Object.entries(isl.treasure)) m.cargo[res] = (m.cargo[res] ?? 0) + n;
    }
    const garrison = this.#garrisonAt(isl, rt, t);
    const stock = this.#stockAt(isl, rt, t);
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
    this.#intel(isl, rt, t);

    const outcome = result.winner === 'att' ? 'victoria' : result.winner === 'def' ? 'derrota' : 'empate';
    const title = {
      victoria: `Victoria en ${isl.name}`,
      derrota: `Derrota en ${isl.name}`,
      empate: `Retirada en ${isl.name}`,
    }[outcome];
    if (isl.type === 'ruinas') loot = { ...m.cargo };
    this.#report({ t, kind: 'ataque', island: isl.id, outcome, title, battle: pick(result), loot, wall });
    this.#note(
      outcome === 'victoria' ? `⚔️ ${title}${loot && fmtBag(loot) ? ` · botín ${fmtBag(loot)}` : ''}` : `⚔️ ${title}`,
      outcome === 'victoria' ? 'success' : 'error',
    );
    if (isl.type === 'kraken' && outcome === 'victoria') {
      this.#note('🐙 ¡Has derrotado al Kraken! Los mares son tuyos.', 'success');
    }
  }

  #arriveColonize(m, t) {
    const isl = ISLAND_BY_ID[m.target];
    const rt = this.state.islands[isl.id];
    if (rt.colonized || this.colonies().length >= maxColonies(this.state)) {
      this.#report({ t, kind: 'colonia', island: isl.id, title: `Colonia fallida: ${isl.name}`, text: 'Los colonos no han podido instalarse y vuelven con los recursos.' });
      return;
    }
    rt.colonized = true;
    m.units.mercante -= 1;
    if (!m.units.mercante) delete m.units.mercante;
    m.cargo = {};
    const r = RESOURCES[isl.specialty];
    this.#report({
      t,
      kind: 'colonia',
      island: isl.id,
      title: `Nueva colonia: ${isl.name}`,
      text: `Los colonos se han quedado con su barco. La colonia producirá ${r.icon} ${r.name.toLowerCase()} para tu imperio.`,
    });
    this.#note(`🚩 Has fundado una colonia en ${isl.name}`, 'success');
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
    const result = battle({ units: raid.army }, { units: { ...s.units }, atkMul, hpMul: hpMul + wall.hp, extraAtk: wall.towers });
    for (const id of PLAYER_UNITS) s.units[id] = result.def.left[id] ?? 0;

    let stolen = null;
    let reward = null;
    let outcome;
    if (result.winner === 'att') {
      outcome = 'derrota';
      const bag = {};
      for (const res of RESOURCE_KEYS) bag[res] = s.resources[res] * RAID_THEFT;
      stolen = takeLoot(bag, 500 * raid.tier, 1);
      for (const [res, n] of Object.entries(stolen)) s.resources[res] -= n;
    } else {
      outcome = result.winner === 'def' ? 'victoria' : 'empate';
      reward = outcome === 'victoria' ? { oro: 80 * raid.tier, hierro: 60 * raid.tier } : null;
      if (reward) this.#refund(reward);
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
  return Object.entries(bag)
    .filter(([, n]) => n > 0)
    .map(([res, n]) => `${RESOURCES[res].icon} ${Math.floor(n).toLocaleString('es-ES')}`)
    .join(' ');
}

function diff(after, before) {
  const out = {};
  for (const res of RESOURCE_KEYS) {
    const d = Math.floor(after[res] - before[res]);
    if (d > 0) out[res] = d;
  }
  return out;
}
