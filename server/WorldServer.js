import { clock, universe } from '../src/config.js';
import { RESOURCES } from '../src/game/data.js';
import { assault, battle, count, hasCombat, splitForces } from '../src/game/combat.js';
import { Game, newState } from '../src/game/Game.js';
import { ACHIEVEMENTS, CONTEST_CATEGORIES, CONTEST_DAYS, CONTEST_PRIZES, HORDE, WONDERS } from '../src/game/data.js';
import { playerCombat, wonderLevel, wonderOf, worldEventAt } from '../src/game/rules.js';
import { footprint, freshIslandState, generateContinent, generateSector, homeIsland, sectorCenter, sectorVertices } from '../src/game/world.js';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, newRecoveryCode, newSecret, normalizeCode, verifyPassword } from './auth.js';

// El mundo de todos los jugadores, en memoria. Implementa la interfaz `world`
// que usa Game (islas compartidas, información de otros jugadores, ataques).

const VIEW_RADIUS = 700; // leguas alrededor de tu isla que ves en el mapa
const ONLINE_MS = 5 * 60_000;
const MAX_CHAT = 300;
const MAX_MAIL = 60;
const MAX_MEMBERS = 20;
const MAX_OFFERS = 5;
const OFFER_DAYS = 3;
const RANK_SIZE = 50; // filas de las clasificaciones por categoría
const MAP_CACHE_MS = 30_000;
const INACTIVE_MS = 7 * 86_400_000; // una semana sin entrar: inactivo
const MAX_THREADS = 40;
const MAX_POSTS = 200;
export const NAME_RE = /^[\p{L}\p{N}_ .-]{3,20}$/u;
export const EMAIL_RE = /^[^\s@<>()"',;]{1,64}@[^\s@<>()"',;]+\.[^\s@<>()"',;]{2,}$/;
const HOUR = 3_600_000;
// Cuánto vale cada enlace o permiso que se manda por correo
const TOKEN_HOURS = { registro: 24, correo: 24, clave: 1, permiso: 0.5 };
const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex');
const cleanEmail = (email) => String(email ?? '').trim().toLowerCase();
const ALLIANCE_RE = /^[\p{L}\p{N}_ .'-]{3,30}$/u;
// Flotas que avisan al llegar a tu ciudad
const HOSTILE = new Set(['atacar', 'invadir', 'bloquear']);

/** Quién bloquea el puerto u ocupa la ciudad (para quien la mira desde fuera). */
function portOf(state) {
  const info = state.occupied ?? state.blockade;
  return info ? { kind: state.occupied ? 'invadir' : 'bloquear', by: info.by, name: info.name, banner: info.banner ?? null, until: info.until } : null;
}
const TAG_RE = /^[\p{L}\p{N}]{2,5}$/u;

export class WorldServer {
  constructor(store) {
    this.store = store;
    this.users = new Map(); // id → { id, username, pass, created, lastSeen }
    this.byName = new Map(); // nombre en minúsculas → id
    this.byEmail = new Map(); // correo en minúsculas → id
    this.games = new Map(); // id → Game
    this.islands = new Map(); // id → isla (datos fijos)
    this.islandStates = new Map(); // id → estado compartido
    this.chat = [];
    this.dirtyIslands = new Set();
    this.newIslands = [];
    this.pendingChat = [];
    this.rankingCache = null;
    this.sockets = new Map(); // id → Set de conexiones en vivo
    this.pendingPush = new Set(); // jugadores cuyo estado ha cambiado y hay que avisar
    this.admins = new Set(String(process.env.ADMINS ?? '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean));
  }

  async load() {
    const data = await this.store.load();
    this.meta = { sectors: 0, seed: Math.floor(Math.random() * 1e9), ...data.meta };
    if (!this.meta.secret) this.meta.secret = process.env.AUTH_SECRET || newSecret();
    this.secret = process.env.AUTH_SECRET || this.meta.secret;
    // Semilla del calendario de eventos (aparte de la del mapa: el navegador la conoce)
    this.meta.eventSeed ??= Math.floor(Math.random() * 2 ** 31);
    universe.eventSeed = this.meta.eventSeed;
    for (const isl of data.islands) this.islands.set(isl.id, isl);
    for (const [id, st] of Object.entries(data.islandStates)) this.islandStates.set(id, st);
    for (const isl of this.islands.values()) {
      if (isl.type !== 'jugador' && !this.islandStates.has(isl.id)) this.islandStates.set(isl.id, freshIslandState(isl, clock.now()));
    }
    for (const u of data.users) {
      this.users.set(u.id, { ...u, lastSeen: 0 });
      this.byName.set(u.username.toLowerCase(), u.id);
      if (u.email) this.byEmail.set(u.email, u.id);
    }
    // Los códigos de recuperación ya no se usan: la cuenta se recupera por correo
    delete this.meta.recovery;
    this.meta.tokens ??= {};
    for (const [uid, state] of Object.entries(data.players)) {
      const id = Number(uid);
      if (this.users.has(id)) this.games.set(id, this.#makeGame(id, state));
    }
    this.meta.mod ??= {};
    this.meta.chatDeleted ??= [];
    const deleted = new Set(this.meta.chatDeleted);
    this.chat = data.chat.filter((m) => !deleted.has(m.id)).slice(-MAX_CHAT);
    this.meta.alliances ??= {};
    this.meta.diplomacy ??= {};
    this.meta.forums ??= {};
    // Amigos (mutuos) y solicitudes pendientes: id → lista de ids
    this.meta.friends ??= {};
    this.meta.friendRequests ??= {};
    this.meta.offers ??= [];
    this.memberOf = new Map();
    for (const a of Object.values(this.meta.alliances)) for (const uid of a.members) this.memberOf.set(uid, a.id);
    // Mundos de antes de los continentes: se añaden donde quepan
    for (let s = 0; s < this.meta.sectors; s++) this.#addContinents(s, clock.now());
    this.#refreshWonders();
    this.#ensureContest();
    // Ponerse al día con lo que pasó mientras el servidor estuvo apagado
    this.tick();
    await this.persist(true);
  }

  #makeGame(userId, state) {
    const game = new Game({ state, world: this, userId, mode: 'server' });
    game.dirty = false;
    // Cualquier cambio en su partida se le empuja por la conexión en vivo
    game.addEventListener('change', () => this.pendingPush.add(userId));
    return game;
  }

  // ── Cuentas ────────────────────────────────────────────────────────────────

  /** Comprueba los datos de una cuenta nueva y los deja limpios. */
  #checkAccount(username, city, password, email) {
    username = String(username ?? '').trim();
    city = String(city ?? '').trim() || username;
    if (!NAME_RE.test(username)) throw new UserError('El nombre debe tener entre 3 y 20 letras o números.');
    if (!NAME_RE.test(city)) throw new UserError('El nombre de la ciudad debe tener entre 3 y 20 letras o números.');
    if (password != null && (typeof password !== 'string' || password.length < 6 || password.length > 100)) throw new UserError('La contraseña debe tener al menos 6 caracteres.');
    if (this.byName.has(username.toLowerCase())) throw new UserError('Ese nombre ya está cogido.');
    if (email != null) this.#checkEmail(email);
    return { username, city };
  }

  #checkEmail(email) {
    if (!EMAIL_RE.test(email) || email.length > 120) throw new UserError('Ese correo no parece válido.');
    if (this.byEmail.has(email)) throw new UserError('Ya hay una cuenta con ese correo. Si es tuya, entra o recupera la contraseña.');
  }

  /**
   * Crea la cuenta y su sector. `pass` puede venir ya cifrada (al confirmar un registro).
   * Con `email`, el correo queda verificado.
   */
  async register(username, password, city, { email = null, pass = null } = {}) {
    ({ username, city } = this.#checkAccount(username, city, pass ? null : password, email));
    const created = Date.now();
    pass ??= hashPassword(password);
    const id = await this.store.createUser({ username, pass, created, email });
    this.users.set(id, { id, username, pass, created, lastSeen: created, email });
    this.byName.set(username.toLowerCase(), id);
    if (email) this.byEmail.set(email, id);

    // Cada jugador nuevo abre un sector del archipiélago
    const sector = this.meta.sectors++;
    const now = clock.now();
    const home = homeIsland(sector, id, city);
    const c = sectorCenter(sector);
    const lands = this.#landsNear(c.x, c.z, 520).filter((o) => o.type === 'continente');
    const neutrals = generateSector(sector, this.meta.seed, lands);
    for (const isl of [home, ...neutrals]) this.#addIsland(isl, now);
    this.#addContinents(sector, now);
    const game = this.#makeGame(id, newState({ now, home: home.id, name: username }));
    game.dirty = true;
    this.games.set(id, game);
    if (this.meta.contest) this.meta.contest.base[id] = this.#contestStats(game);
    this.rankingCache = null;
    this.announce(`⚓ ${username} funda la ciudad de ${city}`);
    await this.persist(true);
    return id;
  }

  #addIsland(isl, now) {
    this.islands.set(isl.id, isl);
    this.newIslands.push(isl);
    if (isl.type !== 'jugador') {
      this.islandStates.set(isl.id, freshIslandState(isl, now));
      this.dirtyIslands.add(isl.id);
    }
  }

  /** Tierras cerca de un punto, con el radio que ocupan en el mar. */
  #landsNear(x, z, radius) {
    const out = [];
    for (const isl of this.islands.values()) {
      if (isl.land) continue; // los asentamientos van dentro de su continente
      if (Math.hypot(isl.x - x, isl.z - z) <= radius) out.push({ x: isl.x, z: isl.z, r: footprint(isl), type: isl.type });
    }
    return out;
  }

  /** Continentes en los vértices de un sector (cada vértice se decide una sola vez). */
  #addContinents(sector, now) {
    this.meta.vertices ??= {};
    for (const v of sectorVertices(sector)) {
      if (this.meta.vertices[v.key]) continue;
      this.meta.vertices[v.key] = 1;
      const made = generateContinent(v, this.meta.seed, this.#landsNear(v.x, v.z, 160));
      if (made) for (const isl of made) this.#addIsland(isl, now);
    }
  }

  /** Entrar con el nombre o con el correo. */
  login(username, password) {
    const key = String(username ?? '').trim().toLowerCase();
    const id = this.byName.get(key) ?? this.byEmail.get(key);
    const user = id != null ? this.users.get(id) : null;
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.pass)) throw new UserError('Nombre o contraseña incorrectos.');
    if (this.isBanned(id)) throw new UserError(`Esta cuenta está suspendida${this.meta.mod[id].reason ? `: ${this.meta.mod[id].reason}` : '.'}`);
    return id;
  }

  // ── Correo: registro, confirmación y contraseña olvidada ──────────────────
  // Cada enlace lleva un código al azar; aquí solo se guarda su huella (sha256), con
  // lo que hace falta para terminar la operación y cuándo caduca.

  hasEmail(userId) {
    return !!this.users.get(userId)?.email;
  }

  #issue(kind, data) {
    const token = randomBytes(32).toString('base64url');
    this.meta.tokens[tokenHash(token)] = { kind, ...data, expires: Date.now() + TOKEN_HOURS[kind] * HOUR };
    return token;
  }

  /** Usa un código: lo devuelve (y lo borra, salvo `keep`) si es de ese tipo y no ha caducado. */
  #take(token, kinds, keep = false) {
    const key = tokenHash(token);
    const t = this.meta.tokens[key];
    if (!t || !kinds.includes(t.kind) || t.expires < Date.now()) return null;
    if (!keep) delete this.meta.tokens[key];
    return t;
  }

  /** Quita los códigos caducados y los que se sustituyen por uno nuevo. */
  #dropTokens(match) {
    const now = Date.now();
    for (const [key, t] of Object.entries(this.meta.tokens)) if (t.expires < now || match?.(t)) delete this.meta.tokens[key];
  }

  /**
   * Primer paso del registro: nada se crea hasta que el jugador abre el enlace del correo.
   * Volver a registrarse con el mismo nombre o correo sustituye al intento anterior.
   */
  async startRegistration({ email, username, password, password2, city }) {
    email = cleanEmail(email);
    ({ username, city } = this.#checkAccount(username, city, password, email));
    if (password !== password2) throw new UserError('Las contraseñas no coinciden.');
    const lc = username.toLowerCase();
    this.#dropTokens((t) => t.kind === 'registro' && (t.email === email || t.username.toLowerCase() === lc));
    const token = this.#issue('registro', { email, username, city, pass: hashPassword(password) });
    await this.store.save({ meta: this.meta });
    return { token, email, username };
  }

  /** Abrir un enlace: confirma un registro (crea la cuenta) o un correo nuevo. Devuelve el jugador. */
  async confirm(token) {
    const t = this.#take(token, ['registro', 'correo']);
    if (!t) throw new UserError('Este enlace ya no vale: ha caducado o ya se ha usado.');
    if (t.kind === 'registro') {
      const id = await this.register(t.username, null, t.city, { email: t.email, pass: t.pass });
      return { id, created: true };
    }
    const user = this.users.get(t.uid);
    if (!user) throw new UserError('Esa cuenta ya no existe.');
    if (this.byEmail.has(t.email) && this.byEmail.get(t.email) !== t.uid) throw new UserError('Ese correo ya lo usa otra cuenta.');
    if (user.email) this.byEmail.delete(user.email);
    user.email = t.email;
    this.byEmail.set(t.email, t.uid);
    await this.store.updateEmail(t.uid, t.email);
    await this.store.save({ meta: this.meta });
    return { id: t.uid, created: false };
  }

  /** Permiso corto para añadir el correo a una cuenta antigua (tras entrar con su contraseña). */
  async emailPermit(userId) {
    const token = this.#issue('permiso', { uid: userId });
    await this.store.save({ meta: this.meta });
    return token;
  }

  /** Pedir un correo para una cuenta: con el permiso de entrada o, desde el juego, con la contraseña. */
  async requestEmail({ permit, userId, password, email }) {
    let uid = userId;
    if (permit != null) uid = this.#take(permit, ['permiso'], true)?.uid;
    else if (!this.users.has(uid) || typeof password !== 'string' || !verifyPassword(password, this.users.get(uid).pass)) throw new UserError('La contraseña no es correcta.');
    if (uid == null || !this.users.has(uid)) throw new UserError('Ha pasado demasiado tiempo: vuelve a entrar con tu nombre y contraseña.');
    email = cleanEmail(email);
    if (this.users.get(uid).email === email) throw new UserError('Ese ya es el correo de tu cuenta.');
    this.#checkEmail(email);
    this.#dropTokens((t) => t.kind === 'correo' && t.uid === uid);
    const token = this.#issue('correo', { uid, email });
    await this.store.save({ meta: this.meta });
    return { token, email, username: this.users.get(uid).username };
  }

  /** Contraseña olvidada: un enlace al correo de la cuenta (null si no hay ninguna con ese correo). */
  async forgotPassword(email) {
    email = cleanEmail(email);
    const id = this.byEmail.get(email);
    if (id == null || this.isBanned(id)) return null;
    this.#dropTokens((t) => t.kind === 'clave' && t.uid === id);
    const token = this.#issue('clave', { uid: id });
    await this.store.save({ meta: this.meta });
    return { token, email, username: this.users.get(id).username };
  }

  async resetPassword(token, password, password2) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 100) throw new UserError('La contraseña nueva debe tener al menos 6 caracteres.');
    if (password !== password2) throw new UserError('Las contraseñas no coinciden.');
    const t = this.#take(token, ['clave']);
    if (!t || !this.users.has(t.uid)) throw new UserError('Este enlace ya no vale: ha caducado o ya se ha usado. Pide otro.');
    const user = this.users.get(t.uid);
    user.pass = hashPassword(password);
    await this.store.updatePassword(t.uid, user.pass);
    await this.store.save({ meta: this.meta });
    return t.uid;
  }

  /** El correo de un jugador, para enseñárselo a él mismo (con parte oculta). */
  maskedEmail(userId) {
    const email = this.users.get(userId)?.email;
    if (!email) return null;
    const [name, domain] = email.split('@');
    return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`;
  }

  /** Moderación: una contraseña temporal para quien la ha perdido todo. */
  async adminResetPassword(adminId, name) {
    if (!this.isAdmin(adminId)) throw new UserError('Solo para moderadores.');
    const id = this.byName.get(String(name ?? '').trim().toLowerCase());
    if (id == null) throw new UserError('No hay ningún jugador con ese nombre.');
    const temp = normalizeCode(newRecoveryCode()).slice(0, 10).toLowerCase();
    const user = this.users.get(id);
    user.pass = hashPassword(temp);
    await this.store.updatePassword(id, user.pass);
    return temp;
  }

  seen(userId) {
    const u = this.users.get(userId);
    if (u) u.lastSeen = Date.now();
    // La última visita también se guarda (con un minuto de margen) para saber quién está inactivo
    const g = this.games.get(userId);
    if (g && Date.now() - (g.state.lastSeen ?? 0) > 60_000) {
      g.state.lastSeen = Date.now();
      g.dirty = true;
    }
  }

  isInactive(userId) {
    const g = this.games.get(userId);
    const last = g?.state.lastSeen ?? this.users.get(userId)?.created ?? 0;
    return Date.now() - last > INACTIVE_MS;
  }

  // ── Interfaz `world` para Game ─────────────────────────────────────────────

  island(id) {
    return this.islands.get(id) ?? null;
  }

  islandState(id) {
    return this.islandStates.get(id) ?? null;
  }

  touch(id) {
    this.dirtyIslands.add(id);
  }

  playerInfo(userId) {
    const game = this.games.get(userId);
    const user = this.users.get(userId);
    if (!game || !user) return null;
    const a = this.allianceOf(userId);
    return {
      name: user.username,
      score: game.score(),
      protected: game.isProtected(),
      townLevel: game.level('ayuntamiento'),
      online: Date.now() - user.lastSeen < ONLINE_MS,
      vacation: !!game.state.vacation,
      inactive: this.isInactive(userId),
      banner: game.state.banner ?? null,
      alliance: a ? { id: a.id, tag: a.tag, name: a.name } : null,
      port: portOf(game.state),
      // Recién liberada: a salvo de bloqueos e invasiones hasta entonces
      shield: game.state.shieldUntil || null,
    };
  }

  /** Si viene alguna flota enemiga hacia la ciudad de este jugador. */
  underAttack(userId) {
    const game = this.games.get(userId);
    return !!game && this.incoming(game.state.home).length > 0;
  }

  sameAlliance(a, b) {
    const x = this.memberOf.get(a);
    return x != null && x === this.memberOf.get(b);
  }

  /** Qué relación hay entre dos jugadores: 'aliado', 'pacto', 'guerra' o null. */
  relation(a, b) {
    const x = this.memberOf.get(a);
    const y = this.memberOf.get(b);
    if (x == null || y == null) return null;
    if (x === y) return 'aliado';
    return this.meta.diplomacy[pairKey(x, y)]?.type ?? null;
  }

  /**
   * Tropas de apoyo de otros jugadores estacionadas en la isla `homeId`.
   * `apply(left)` deja a cada una con sus supervivientes tras un combate.
   */
  supportersAt(homeId, hostId) {
    const out = [];
    for (const [uid, game] of this.games) {
      if (uid === hostId) continue;
      for (const mission of game.state.missions) {
        if (mission.type !== 'apoyo' || mission.phase !== 'estacionada' || mission.target !== homeId) continue;
        out.push({
          game,
          mission,
          apply: (left) => {
            mission.units = Object.fromEntries(Object.entries(left).filter(([, n]) => n > 0));
            if (!Object.keys(mission.units).length) game.state.missions = game.state.missions.filter((m) => m !== mission);
            game.dirty = true;
          },
        });
      }
    }
    return out;
  }

  /** Aviso para el dueño de una isla (alguien le manda tropas, etc.). */
  hostNews(ownerId, text) {
    const host = this.games.get(ownerId);
    if (!host) return;
    host.receiveNews(null, text, 'success');
    host.dirty = true;
  }

  /** Si dos jugadores dejan de ser aliados, sus tropas de apoyo vuelven a casa. */
  #recallBrokenSupport() {
    const now = clock.now();
    for (const [uid, game] of this.games) {
      for (const m of game.state.missions) {
        if (m.type !== 'apoyo' || m.phase !== 'estacionada') continue;
        const host = this.islands.get(m.target)?.owner;
        if (host != null && this.sameAlliance(uid, host)) continue;
        m.phase = 'vuelta';
        m.turn = now;
        m.back = now + (m.arrive - m.depart);
        game.dirty = true;
      }
    }
  }

  /** Llega un transporte de otro jugador a la isla de `ownerId`. */
  deliver(ownerId, payload, t) {
    const target = this.games.get(ownerId);
    if (!target) return false;
    target.update(t);
    target.receiveTransport(payload, t);
    target.dirty = true;
    return true;
  }

  islandsNear(homeId, radius) {
    const home = this.islands.get(homeId);
    if (!home) return [];
    const out = [];
    for (const isl of this.islands.values()) {
      const d = Math.hypot(isl.x - home.x, isl.z - home.z);
      if (d <= radius) out.push({ ...isl, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  colonize(id, userId) {
    const rt = this.islandStates.get(id);
    if (!rt || rt.colonizedBy != null) return false;
    rt.colonizedBy = userId;
    this.touch(id);
    return true;
  }

  // ── Invasiones bárbaras ────────────────────────────────────────────────────

  /** Quién tiene colonia en cada continente (id del continente → ids de jugadores). */
  #colonistsByLand() {
    const out = new Map();
    for (const [uid, g] of this.games) {
      for (const c of g.state.colonies) {
        const land = this.islands.get(c.id)?.land;
        if (!land) continue;
        if (!out.has(land)) out.set(land, new Set());
        out.get(land).add(uid);
      }
    }
    return out;
  }

  #hoursMs(h) {
    return (h * 3_600_000) / universe.speed;
  }

  #between([a, b]) {
    return this.#hoursMs(a + Math.random() * (b - a));
  }

  /** Aparecen hordas en los continentes con colonias, y las que no se derrotan a tiempo saquean. */
  #updateHordes(now) {
    // Una vez cada diez segundos basta
    if (now - (this.hordeCheck ?? 0) < 10_000 / Math.max(1, universe.speed)) return;
    this.hordeCheck = now;
    const colonists = this.#colonistsByLand();
    for (const [land, uids] of colonists) {
      const cont = this.islands.get(land);
      const rt = this.islandStates.get(land);
      if (!cont || !rt) continue;
      if (!rt.horde) {
        if (!rt.nextHorde) {
          rt.nextHorde = now + this.#between(HORDE.firstHours);
          this.touch(land);
        } else if (now >= rt.nextHorde) this.#spawnHorde(cont, rt, uids, now);
        continue;
      }
      if (now >= rt.horde.deadline) this.#ravage(cont, rt, uids, now);
    }
  }

  #spawnHorde(cont, rt, uids, now) {
    const k = 1 + HORDE.perColonist * (uids.size - 1);
    const garrison = Object.fromEntries(Object.entries(HORDE.garrison).map(([u, n]) => [u, Math.round(n * k)]));
    rt.horde = { spawn: now, deadline: now + this.#hoursMs(HORDE.warnHours), garrison, start: { ...garrison }, damage: {}, names: {}, colonists: uids.size };
    this.touch(cont.id);
    const total = Object.values(garrison).reduce((a, b) => a + b, 0);
    this.announce(`🔥 Una horda de ${total} bárbaros desembarca en ${cont.name}: arrasará sus colonias en ${HORDE.warnHours} h si nadie la detiene`);
    for (const uid of uids) {
      this.hostNews(uid, `🔥 ¡Una horda bárbara amenaza tus colonias de ${cont.name}! Atácala antes de ${HORDE.warnHours} h`);
      this.pendingPush.add(uid);
    }
    this.mapCache = null;
  }

  /** La horda no ha caído a tiempo: las colonias del continente se quedan un día sin producir. */
  #ravage(cont, rt, uids, now) {
    const until = now + this.#hoursMs(HORDE.ravageHours);
    for (const uid of uids) {
      const game = this.games.get(uid);
      game.update(now);
      for (const c of game.state.colonies) if (this.islands.get(c.id)?.land === cont.id) c.raidedUntil = until;
      game.dirty = true;
      this.hostNews(uid, `🔥 La horda ha saqueado tus colonias de ${cont.name}: no producirán en ${HORDE.ravageHours} h`);
      this.pendingPush.add(uid);
    }
    this.announce(`🔥 Nadie detuvo a la horda: ha arrasado las colonias de ${cont.name}`);
    rt.horde = null;
    rt.nextHorde = now + this.#between(HORDE.gapHours);
    this.touch(cont.id);
  }

  /** La horda ha caído: botín para todos según los bárbaros que abatió cada uno, y una reliquia posible para el mejor. */
  hordeDefeated(id, t) {
    const rt = this.islandStates.get(id);
    const cont = this.islands.get(id);
    const h = rt?.horde;
    if (!h) return;
    const total = Object.values(h.damage).reduce((a, b) => a + b, 0) || 1;
    const k = 1 + HORDE.perColonist * ((h.colonists ?? 1) - 1);
    const ranking = Object.entries(h.damage).sort((a, b) => b[1] - a[1]);
    for (const [uid, n] of ranking) {
      const game = this.games.get(Number(uid));
      if (!game || !n) continue;
      const share = n / total;
      const bag = Object.fromEntries(Object.entries(HORDE.reward).map(([r, v]) => [r, Math.floor(v * k * share)]));
      game.giveResources(bag, `🏆 Tu parte del botín de la horda de ${cont.name} (${Math.round(share * 100)} % de los bárbaros abatidos)`);
      game.dirty = true;
      this.pendingPush.add(Number(uid));
    }
    const best = ranking[0];
    if (best && Math.random() < 0.5) this.games.get(Number(best[0]))?.awardRelic(`entre los estandartes de la horda de ${cont.name}`, { rara: 55, epica: 35, legendaria: 10 }, t);
    const names = ranking.slice(0, 3).map(([uid, n]) => `${h.names?.[uid] ?? '¿?'} (${n})`).join(', ');
    this.announce(`🏆 ¡La horda de ${cont.name} ha sido derrotada! Más bárbaros abatidos: ${names}`);
    rt.horde = null;
    rt.nextHorde = t + this.#between(HORDE.gapHours);
    this.touch(id);
    this.mapCache = null;
  }

  // ── Competición semanal ────────────────────────────────────────────────────

  #contestStats(game) {
    const out = {};
    for (const c of Object.values(CONTEST_CATEGORIES)) out[c.stat] = game.state.stats[c.stat] ?? 0;
    return out;
  }

  /** Empieza una competición nueva: lo que lleva cada uno ahora es su punto de partida. */
  #ensureContest(start = Date.now()) {
    if (this.meta.contest) return;
    const base = {};
    for (const [uid, game] of this.games) base[uid] = this.#contestStats(game);
    const n = (this.meta.contestSeq = (this.meta.contestSeq ?? 0) + 1);
    this.meta.contest = { n, start, end: start + (CONTEST_DAYS * 86_400_000) / universe.speed, base };
  }

  /** Lo hecho esta semana en cada categoría, de mayor a menor. */
  contestStandings() {
    const c = this.meta.contest;
    const out = {};
    for (const [key, cat] of Object.entries(CONTEST_CATEGORIES)) {
      out[key] = [...this.games.entries()]
        .map(([uid, g]) => ({ uid, name: g.name, score: Math.floor((g.state.stats[cat.stat] ?? 0) - (c.base[uid]?.[cat.stat] ?? 0)) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);
    }
    return out;
  }

  #finishContest() {
    const c = this.meta.contest;
    const standings = this.contestStandings();
    const winners = {};
    for (const [key, list] of Object.entries(standings)) {
      const cat = CONTEST_CATEGORIES[key];
      winners[key] = list.slice(0, 3).map((r, i) => {
        const game = this.games.get(r.uid);
        game.update(clock.now());
        game.giveResources(CONTEST_PRIZES[i], `🏅 ${['¡Primer', 'Segundo', 'Tercer'][i]} puesto en ${cat.name} de la competición semanal! Premio entregado.`);
        if (i === 0) game.state.stats.contestWins = (game.state.stats.contestWins ?? 0) + 1;
        game.dirty = true;
        return { name: r.name, score: r.score };
      });
      if (winners[key][0]) this.announce(`🏅 ${cat.icon} ${winners[key][0].name} gana la semana en ${cat.name} (${winners[key][0].score.toLocaleString('es-ES')} ${cat.unit})`);
    }
    this.meta.hall = [{ n: c.n, end: c.end, winners }, ...(this.meta.hall ?? [])].slice(0, 12);
    this.meta.contest = null;
    this.#ensureContest(c.end);
    this.rankingCache = null;
  }

  /** La competición vista por un jugador: el podio de cada categoría y su puesto. */
  contestView(userId) {
    const c = this.meta.contest;
    const standings = this.contestStandings();
    const categories = {};
    for (const [key, list] of Object.entries(standings)) {
      const i = list.findIndex((r) => r.uid === userId);
      categories[key] = {
        top: list.slice(0, 10).map((r, k) => ({ rank: k + 1, name: r.name, score: r.score, me: r.uid === userId })),
        me: i >= 0 ? { rank: i + 1, score: list[i].score } : null,
      };
    }
    return { n: c.n, end: c.end, categories, prizes: CONTEST_PRIZES, hall: (this.meta.hall ?? []).slice(0, 3) };
  }

  // ── Maravillas de los continentes ──────────────────────────────────────────

  /** Bonos de las maravillas de los continentes donde hay colonias de la lista. */
  wonderBonusFor(colonies) {
    const out = {};
    const seen = new Set();
    for (const c of colonies) {
      const land = this.islands.get(c.id)?.land;
      if (!land || seen.has(land)) continue;
      seen.add(land);
      const cont = this.islands.get(land);
      const level = wonderLevel(this.islandStates.get(land)?.wonder?.progress);
      if (!cont || !level) continue;
      const w = WONDERS[wonderOf(cont)];
      out[w.stat] = (out[w.stat] ?? 0) + level * w.per;
    }
    return out;
  }

  /** Recalcula el bono de quienes tienen colonia en un continente (o de todos). */
  #refreshWonders(continentId = null, now = clock.now()) {
    for (const game of this.games.values()) {
      if (continentId && !game.state.colonies.some((c) => this.islands.get(c.id)?.land === continentId)) continue;
      const next = this.wonderBonusFor(game.state.colonies);
      if (JSON.stringify(next) === JSON.stringify(game.state.wonderBonus ?? {})) continue;
      game.update(now); // que la producción hasta ahora vaya con el bono anterior
      game.state.wonderBonus = next;
      game.dirty = true;
      this.pendingPush.add(game.userId);
    }
  }

  donateWonder(id, userId, amount, now) {
    const rt = this.islandStates.get(id);
    const cont = this.islands.get(id);
    if (!rt || !cont) return;
    rt.wonder ??= { progress: 0, donors: {} };
    const before = wonderLevel(rt.wonder.progress);
    rt.wonder.progress += amount;
    rt.wonder.donors[userId] = (rt.wonder.donors[userId] ?? 0) + amount;
    this.touch(id);
    const after = wonderLevel(rt.wonder.progress);
    if (after > before) {
      const w = WONDERS[wonderOf(cont)];
      this.announce(`${w.icon} ${w.name} de ${cont.name} sube a nivel ${after}`);
      this.#refreshWonders(id, now);
    }
    // Que todos los que miran el continente vean el progreso
    for (const game of this.games.values()) if (game.state.colonies.some((c) => this.islands.get(c.id)?.land === id)) this.pendingPush.add(game.userId);
  }

  spyPlayer(ownerId, t) {
    const target = this.games.get(ownerId);
    if (!target || target.state.vacation) return null;
    target.update(t);
    return { name: target.name, ...target.spyReport() };
  }

  sabotage(ownerId, payload, t) {
    const target = this.games.get(ownerId);
    if (!target || target.state.vacation) return null;
    target.update(t);
    const res = target.receiveSabotage(payload, t);
    target.dirty = true;
    return res;
  }

  // ── Bloqueos y ocupaciones ─────────────────────────────────────────────────

  /** Una flota llega a bloquear el puerto de `ownerId`: combate naval contra su flota. */
  blockadePlayer(ownerId, payload, t) {
    const target = this.games.get(ownerId);
    if (!target || target.state.vacation) return null;
    target.update(t);
    const res = target.receiveBlockade(payload, t);
    target.dirty = true;
    this.pendingPush.add(ownerId);
    return res;
  }

  /** Empieza un bloqueo o una ocupación de la ciudad de `ownerId` (la ocupación releva a cualquier bloqueo). */
  seizePort(ownerId, kind, info, t) {
    const target = this.games.get(ownerId);
    if (!target) return false;
    target.update(t);
    if (kind === 'invadir' && target.state.blockade) {
      const b = this.stationAt(ownerId, 'bloquear');
      if (b?.mission) b.game.endStation(b.mission, t, 'relevo');
      target.state.blockade = null;
      if (b?.game) this.pendingPush.add(b.game.userId);
    }
    target.portSeized(kind, info, t);
    target.dirty = true;
    this.pendingPush.add(ownerId);
    this.mapCache = null;
    return true;
  }

  /**
   * Quién bloquea o ocupa la ciudad de `ownerId` (la ocupación primero, o el `kind` pedido):
   * { kind, info, game, mission } (sin `mission` si la flota ya no está), o null.
   */
  stationAt(ownerId, kind = null) {
    const s = this.games.get(ownerId)?.state;
    if (!s) return null;
    kind ??= s.occupied ? 'invadir' : s.blockade ? 'bloquear' : null;
    const info = kind === 'invadir' ? s.occupied : kind === 'bloquear' ? s.blockade : null;
    if (!info) return null;
    const game = this.games.get(info.by) ?? null;
    const mission = game?.state.missions.find((m) => m.id === info.mission && m.type === kind && m.phase === 'estacionada') ?? null;
    return { kind, info, game, mission };
  }

  /** Se acaba un bloqueo o una ocupación en la isla `islandId`. Devuelve el tributo que se llevan. */
  liftStation(islandId, { by, mission, kind, reason, who }, t) {
    const owner = this.islands.get(islandId)?.owner;
    const target = this.games.get(owner);
    const info = kind === 'invadir' ? target?.state.occupied : target?.state.blockade;
    if (!info || info.by !== by || info.mission !== mission) return {};
    target.update(t);
    const owed = target.portFreed(kind, { reason, who }, t);
    target.dirty = true;
    this.pendingPush.add(owner);
    this.pendingPush.add(by);
    this.mapCache = null;
    return owed;
  }

  /**
   * Alguien combate contra quien bloquea u ocupa la ciudad de `ownerId`: el dueño desde dentro
   * (`fromSea: false`; contra un bloqueo, solo con barcos) o sus aliados llegando por mar.
   * Devuelve { kind, result, broken, enemy } o null.
   */
  fightStation(ownerId, attacker, t, { fromSea = true } = {}) {
    let st = this.stationAt(ownerId);
    if (!st) return null;
    const victim = this.games.get(ownerId);
    // Que quien la mantiene llegue a este instante (puede que se le acabe el tiempo justo antes)
    if (st.mission) {
      st.game.update(t);
      st = this.stationAt(ownerId);
      if (!st) return null;
    }
    if (!st.mission) {
      // La flota ya no está: la ciudad queda libre sin combate
      victim.state[st.kind === 'invadir' ? 'occupied' : 'blockade'] = null;
      victim.dirty = true;
      return { kind: st.kind, result: null, broken: true, enemy: st.info.name };
    }
    const occ = playerCombat(st.game.state);
    const def = { units: { ...st.mission.units }, atkMul: occ.atkMul, hpMul: occ.hpMul };
    const result = fromSea ? assault(attacker, def, { needLanding: st.kind === 'invadir' }) : battle(attacker, def);
    const left = splitForces(result.def.left);
    // Sin barcos de guerra no hay bloqueo; sin soldados, no hay ocupación
    const broken = st.kind === 'bloquear' ? !hasCombat(left.sea) : !hasCombat(left.land);
    st.game.stationFought(st.mission, { result, broken, enemy: attacker.name }, t);
    st.game.dirty = true;
    victim.dirty = true;
    this.pendingPush.add(st.game.userId);
    this.pendingPush.add(ownerId);
    return { kind: st.kind, result, broken, enemy: st.info.name };
  }

  /** Quien ocupa la ciudad de `ownerId` la saquea: { tribute, loot }. */
  plunderCity(ownerId, payload, t) {
    const target = this.games.get(ownerId);
    if (!target?.state.occupied) return null;
    target.update(t);
    const res = target.plunderedBy(payload, t);
    target.dirty = true;
    this.pendingPush.add(ownerId);
    return res;
  }

  /**
   * Bloqueos y ocupaciones que ya no se sostienen: la flota ha desaparecido, ya no quedan soldados
   * ocupando o los dos jugadores ya no están enfrentados (aliados o con un pacto).
   */
  #checkStations(now) {
    for (const [uid, game] of this.games) {
      for (const kind of ['invadir', 'bloquear']) {
        const st = this.stationAt(uid, kind);
        if (!st) continue;
        if (!st.mission) {
          game.update(now);
          game.portFreed(kind, { reason: 'tiempo' }, now);
          game.dirty = true;
          this.pendingPush.add(uid);
          continue;
        }
        const rel = this.relation(st.info.by, uid);
        const units = splitForces(st.mission.units);
        const empty = kind === 'invadir' ? !hasCombat(units.land) : !hasCombat(units.sea);
        if (rel === 'aliado' || rel === 'pacto' || empty) {
          st.game.update(now);
          st.game.endStation(st.mission, now, empty ? 'tiempo' : 'paz');
          st.game.dirty = true;
          this.pendingPush.add(st.game.userId);
        }
      }
    }
  }

  attackPlayer(ownerId, payload, t) {
    const target = this.games.get(ownerId);
    if (!target || target.state.vacation) return null;
    // Que el defensor llegue al momento del ataque (si no está ya ocupado)
    target.update(t);
    const res = target.receiveAttack(payload, t);
    target.dirty = true;
    // En guerra entre alianzas se lleva la cuenta de bajas y botín de cada bando
    if (res && payload.attackerId != null && this.relation(payload.attackerId, ownerId) === 'guerra') {
      const x = this.memberOf.get(payload.attackerId);
      const y = this.memberOf.get(ownerId);
      const war = this.meta.diplomacy[pairKey(x, y)];
      war.kills[x] = (war.kills[x] ?? 0) + count(res.result.def.lost);
      war.kills[y] = (war.kills[y] ?? 0) + count(res.result.att.lost);
      war.loot[x] = (war.loot[x] ?? 0) + count(res.stolen);
      war.battles = (war.battles ?? 0) + 1;
    }
    return res;
  }

  // ── Ataques conjuntos ──────────────────────────────────────────────────────

  /** Un ataque contra otra ciudad al que pueden unirse los aliados de quien lo lanza (clave «jugador-flota»). */
  jointAttack(key) {
    const [uid, mid] = String(key ?? '').split('-').map(Number);
    const game = this.games.get(uid);
    const m = game?.state.missions.find((x) => x.id === mid);
    if (!m || m.type !== 'atacar' || m.phase !== 'ida' || m.joint) return null;
    if (this.islands.get(m.target)?.type !== 'jugador') return null;
    const allies = this.#jointMissions(key);
    return { key, leaderId: uid, leader: game.name, target: m.target, targetName: m.targetName, arrive: m.arrive, allies: allies.length, names: allies.map((x) => x.game.name) };
  }

  #jointMissions(key) {
    const out = [];
    for (const game of this.games.values()) {
      for (const mission of game.state.missions) if (mission.joint === key && mission.phase === 'ida') out.push({ game, mission });
    }
    return out;
  }

  /** Las flotas unidas a un ataque, listas para combatir junto a quien lo dirige. */
  jointFleets(key, t) {
    return this.#jointMissions(key).map(({ game, mission }) => {
      game.update(t);
      return {
        name: game.name,
        mission,
        combat: playerCombat(game.state),
        settle: (data) => {
          game.settleJoint(mission, data, t);
          game.dirty = true;
        },
      };
    });
  }

  /** Ataques de tu alianza (y tuyos) a los que se puede uno unir, para el navegador. */
  #jointList(userId) {
    const a = this.allianceOf(userId);
    const out = [];
    for (const uid of a ? a.members : [userId]) {
      for (const m of this.games.get(uid)?.state.missions ?? []) {
        if (m.type !== 'atacar' || m.phase !== 'ida' || m.joint) continue;
        const info = this.jointAttack(`${uid}-${m.id}`);
        if (info) out.push(info);
      }
    }
    return out;
  }

  announce(text, channel = 'global') {
    this.#pushChat({ name: null, text, system: true, channel });
  }

  #pushChat(data) {
    const msg = { id: (this.meta.chatSeq = (this.meta.chatSeq ?? 0) + 1), t: Date.now(), ...data };
    this.chat.push(msg);
    this.pendingChat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    for (const uid of this.sockets.keys()) {
      const [visible] = this.#visibleChat(uid, [msg]);
      if (visible) this.send(uid, { type: 'chat', message: visible });
    }
    return msg;
  }

  /** Qué mensajes puede leer un jugador (el canal global y el de su alianza), ya preparados para él. */
  #visibleChat(userId, messages) {
    const a = this.allianceOf(userId);
    const mine = a ? `a:${a.id}` : null;
    return messages
      .filter((m) => !m.channel || m.channel === 'global' || m.channel === mine)
      .map((m) => ({ ...m, channel: m.channel && m.channel !== 'global' ? 'alianza' : 'global' }));
  }

  // ── Bucle y guardado ───────────────────────────────────────────────────────

  tick() {
    const now = clock.now();
    for (const game of this.games.values()) game.update(now);
    // Flotas que esperaban a un ataque conjunto que ya no va (lo han retirado o se ha perdido)
    for (const game of this.games.values()) {
      for (const m of game.state.missions) {
        if (!m.joint || m.phase !== 'ida') continue;
        if (this.jointAttack(m.joint) && now <= m.arrive + 60_000) continue;
        game.releaseJoint(m, now);
      }
    }
    if (this.meta.contest && Date.now() >= this.meta.contest.end) this.#finishContest();
    this.#updateHordes(now);
    this.#checkStations(now);
    // Enlaces de correo caducados (cada diez minutos)
    if (Date.now() - (this.tokenSweep ?? 0) > 600_000) {
      this.tokenSweep = Date.now();
      this.#dropTokens();
    }
    // Cuando empieza una temporada del archipiélago, se anuncia una sola vez
    const ev = worldEventAt(now);
    if (this.meta.eventAnnounced !== ev.start) {
      this.meta.eventAnnounced = ev.start;
      if (ev.event) this.announce(`${ev.event.icon} Comienza ${ev.event.name}: ${ev.event.text}`);
    }
    // Las ofertas del mercado caducan y devuelven lo apartado
    const limit = Date.now() - OFFER_DAYS * 86_400_000;
    if (this.meta.offers.some((o) => o.t < limit)) {
      for (const o of this.meta.offers.filter((x) => x.t < limit)) this.games.get(o.seller)?.giveResources(o.give, '⚖️ Una oferta tuya del mercado ha caducado');
      this.meta.offers = this.meta.offers.filter((o) => o.t >= limit);
    }
  }

  async persist(force = false) {
    const players = [];
    for (const [userId, game] of this.games) {
      if (game.dirty || force) {
        players.push({ userId, state: game.state });
        game.dirty = false;
      }
    }
    const islandStates = [...this.dirtyIslands].map((id) => [id, this.islandStates.get(id)]);
    this.dirtyIslands.clear();
    const islands = this.newIslands.splice(0);
    const chat = this.pendingChat.splice(0);
    if (!players.length && !islandStates.length && !islands.length && !chat.length && !force) return;
    await this.store.save({ meta: this.meta, players, islands, islandStates, chat });
  }

  // ── Lo que ve cada jugador ─────────────────────────────────────────────────

  snapshot(userId) {
    const game = this.games.get(userId);
    const user = this.users.get(userId);
    const now = clock.now();
    game.update(now);
    const near = this.islandsNear(game.state.home, VIEW_RADIUS);
    const ids = new Set(near.map((i) => i.id));
    // También las islas lejanas a las que van tus flotas o que son tus colonias
    for (const m of game.state.missions) {
      ids.add(m.target);
      if (m.from) ids.add(m.from);
    }
    for (const c of game.state.colonies) {
      ids.add(c.id);
      // También su continente, para ver su maravilla y si hay horda
      const land = this.islands.get(c.id)?.land;
      if (land) ids.add(land);
    }
    const islands = [...ids].map((id) => this.islands.get(id)).filter(Boolean);
    const states = {};
    const players = {};
    for (const isl of islands) {
      const rt = this.islandStates.get(isl.id);
      if (rt) states[isl.id] = rt;
      for (const uid of [isl.owner, rt?.colonizedBy]) {
        if (uid != null && !players[uid]) players[uid] = { ...this.playerInfo(uid), rel: this.relation(userId, uid) };
      }
    }
    const a = this.allianceOf(userId);
    // El correo va aparte (puede ser largo): aquí solo cuántos sin leer
    const { mail, ...state } = game.state;
    return {
      serverTime: now,
      speed: universe.speed,
      eventSeed: universe.eventSeed,
      userId,
      username: user.username,
      alliance: a ? { id: a.id, tag: a.tag, name: a.name } : null,
      admin: this.isAdmin(userId),
      mailUnread: (mail ?? []).filter((m) => m.box === 'in' && !m.read).length,
      forumUnread: this.#forumUnread(userId),
      applications: a && this.#canManage(a, userId) ? (a.applications ?? []).length : 0,
      friendRequests: (this.meta.friendRequests[userId] ?? []).length,
      state,
      world: { islands, states, players },
      incoming: this.incoming(game.state.home),
      joint: this.#jointList(userId),
      traffic: this.#traffic(userId, game.state.home),
      support: this.supportersAt(game.state.home, userId).map(({ game: g, mission }) => ({ from: g.name, units: mission.units })),
      owed: this.#owedTo(game),
    };
  }

  /** Tributo apartado en cada ciudad que ocupa este jugador (id de la misión → recursos). */
  #owedTo(game) {
    const out = {};
    for (const m of game.state.missions) {
      if (m.type !== 'invadir' || m.phase !== 'estacionada') continue;
      const owner = this.islands.get(m.target)?.owner;
      const occ = this.games.get(owner)?.state.occupied;
      if (occ?.by === game.userId && occ.mission === m.id) out[m.id] = Object.fromEntries(Object.entries(occ.owed ?? {}).map(([r, n]) => [r, Math.floor(n)]));
    }
    return out;
  }

  /** Flotas de otros jugadores que navegan cerca de ti (sin decir qué llevan), para ver el mar con vida. */
  #traffic(userId, homeId) {
    const home = this.islands.get(homeId);
    if (!home) return [];
    const near = (isl) => isl && Math.hypot(isl.x - home.x, isl.z - home.z) <= VIEW_RADIUS;
    const out = [];
    for (const [uid, g] of this.games) {
      if (uid === userId) continue;
      const home = this.islands.get(g.state.home);
      for (const m of g.state.missions) {
        if (m.target === homeId || (m.phase !== 'ida' && m.phase !== 'vuelta')) continue;
        const from = m.from ? this.islands.get(m.from) : home;
        const to = this.islands.get(m.target);
        if (!to || !(near(from) || near(to))) continue;
        const ship = ['dromon', 'galeon', 'trirreme', 'brulote', 'mercante', 'bote'].find((s) => m.units[s]) ?? 'mercante';
        out.push({ id: `${uid}-${m.id}`, fx: from.x, fz: from.z, tx: to.x, tz: to.z, depart: m.depart, arrive: m.arrive, back: m.back, phase: m.phase, ship, ally: this.sameAlliance(userId, uid) });
      }
    }
    return out.slice(0, 40);
  }

  /** Cambiar el nombre de tu ciudad (una vez por semana). */
  renameCity(userId, name) {
    name = String(name ?? '').trim();
    if (!NAME_RE.test(name)) throw new UserError('El nombre de la ciudad debe tener entre 3 y 20 letras o números.');
    const game = this.games.get(userId);
    const wait = (game.state.renamedAt ?? 0) + 7 * 86_400_000 - Date.now();
    if (wait > 0) throw new UserError(`Solo puedes cambiar el nombre una vez por semana (faltan ${Math.ceil(wait / 86_400_000)} días).`);
    const isl = this.islands.get(game.state.home);
    const old = isl.name;
    isl.name = name;
    game.state.renamedAt = Date.now();
    game.dirty = true;
    this.newIslands.push(isl); // se guarda de nuevo con su nombre
    this.mapCache = null;
    this.rankingCache = null;
    this.announce(`🏰 ${game.name} rebautiza ${old} como ${name}`);
    this.pendingPush.add(userId);
  }

  /** Flotas de otros jugadores que vienen a atacar esta isla. */
  incoming(homeId) {
    const list = [];
    for (const [uid, other] of this.games) {
      for (const m of other.state.missions) {
        if (m.target !== homeId || m.phase !== 'ida' || !HOSTILE.has(m.type)) continue;
        const from = this.islands.get(m.from ?? other.state.home);
        const size = Object.values(m.units).reduce((a, b) => a + b, 0);
        list.push({ id: `${uid}-${m.id}`, type: m.type, from: other.name, fromIsland: from?.name, x: from?.x, z: from?.z, depart: m.depart, arrive: m.arrive, size });
      }
    }
    return list.sort((a, b) => a.arrive - b.arrive);
  }

  ranking(userId) {
    if (!this.rankingCache || Date.now() - this.rankingCache.at > 10_000) {
      const rows = [...this.games.entries()].map(([id, g]) => ({
        id,
        name: this.users.get(id)?.username ?? '¿?',
        city: this.islands.get(g.state.home)?.name ?? '',
        island: g.state.home,
        points: g.score(),
        colonies: g.state.colonies.length,
        coloso: g.level('coloso'),
        kills: g.state.stats.kills ?? 0,
        loot: g.state.stats.loot ?? 0,
        tag: this.allianceOf(id)?.tag ?? null,
      }));
      rows.sort((a, b) => b.points - a.points);
      rows.forEach((r, i) => (r.rank = i + 1));
      // Clasificaciones por categoría: solo quien tenga algo que contar
      const by = (key) =>
        rows
          .filter((r) => r[key] > 0)
          .sort((a, b) => b[key] - a[key])
          .slice(0, RANK_SIZE)
          .map((r, i) => ({ ...r, rank: i + 1 }));
      this.rankingCache = { at: Date.now(), rows, military: by('kills'), raiders: by('loot'), alliances: this.allianceList() };
    }
    const { rows, military, raiders } = this.rankingCache;
    const mark = ({ id, ...r }) => ({ ...r, me: id === userId });
    const { id: _, ...me } = rows.find((r) => r.id === userId) ?? {};
    return {
      top: rows.slice(0, 100).map(mark),
      military: military.map(mark),
      raiders: raiders.map(mark),
      me: userId != null && me.name ? me : null,
      total: rows.length,
      alliances: this.rankingCache.alliances,
    };
  }

  stats() {
    const now = Date.now();
    const online = [...this.users.values()].filter((u) => now - u.lastSeen < ONLINE_MS).length;
    const ev = worldEventAt(clock.now());
    const event = ev.event ? { icon: ev.event.icon, name: ev.event.name, text: ev.event.text, end: ev.end } : null;
    return { players: this.users.size, online, top: this.ranking(null).top.slice(0, 5), event };
  }

  addChat(userId, text, channel = 'global') {
    const user = this.users.get(userId);
    text = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) throw new UserError('Escribe algo.');
    const muted = this.meta.mod[userId]?.mutedUntil ?? 0;
    if (muted > Date.now()) throw new UserError(`Estás silenciado en el chat hasta las ${new Date(muted).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`);
    let ch = 'global';
    if (channel === 'alianza') {
      const a = this.allianceOf(userId);
      if (!a) throw new UserError('No estás en ninguna alianza.');
      ch = `a:${a.id}`;
    }
    return this.#pushChat({ name: user.username, title: this.#titleOf(userId), text, channel: ch });
  }

  /** El título que lleva un jugador (el nombre de un logro suyo), o null. */
  #titleOf(userId) {
    const id = this.games.get(userId)?.state.title;
    return id ? (ACHIEVEMENTS.find((a) => a.id === id)?.name ?? null) : null;
  }

  /** Publicar un informe de combate en el chat (general o de la alianza). */
  shareReport(userId, t, channel = 'global') {
    const game = this.games.get(userId);
    const r = game.state.reports.find((x) => x.t === t && x.battle);
    if (!r) throw new UserError('Ese informe ya no existe.');
    const muted = this.meta.mod[userId]?.mutedUntil ?? 0;
    if (muted > Date.now()) throw new UserError('Estás silenciado en el chat.');
    let ch = 'global';
    if (channel === 'alianza') {
      const a = this.allianceOf(userId);
      if (!a) throw new UserError('No estás en ninguna alianza.');
      ch = `a:${a.id}`;
    }
    const icon = { victoria: '🏆', derrota: '💀', empate: '🏳️' }[r.outcome] ?? '📜';
    // Solo lo necesario para verlo y repetir el combate
    const report = { t: r.t, kind: r.kind, outcome: r.outcome, title: r.title, islandName: r.islandName, enemy: r.enemy, defending: r.defending, battle: r.battle, loot: r.loot, wall: r.wall, towers: r.towers };
    return this.#pushChat({ name: game.name, title: this.#titleOf(userId), text: `${icon} ${r.title}`, channel: ch, report });
  }

  /** Mensajes nuevos que puede leer el jugador: el canal global y el de su alianza. */
  chatSince(userId, after) {
    return this.#visibleChat(
      userId,
      this.chat.filter((m) => m.id > after),
    );
  }

  // ── Alianzas ───────────────────────────────────────────────────────────────

  allianceOf(userId) {
    const id = this.memberOf?.get(userId);
    return id != null ? this.meta.alliances[id] : null;
  }

  #alliancePoints(a) {
    return a.members.reduce((sum, uid) => sum + (this.games.get(uid)?.score() ?? 0), 0);
  }

  allianceList(userId = null) {
    return Object.values(this.meta.alliances)
      .map((a) => ({
        id: a.id,
        name: a.name,
        tag: a.tag,
        members: a.members.length,
        points: this.#alliancePoints(a),
        open: !!a.open,
        applied: userId != null && (a.applications ?? []).some((x) => x.uid === userId),
      }))
      .sort((a, b) => b.points - a.points)
      .map((a, i) => ({ ...a, rank: i + 1 }));
  }

  allianceDetail(userId) {
    const a = this.allianceOf(userId);
    if (!a) return null;
    const members = a.members
      .map((uid) => {
        const info = this.playerInfo(uid);
        const role = uid === a.founder ? 'lider' : (a.officers ?? []).includes(uid) ? 'oficial' : 'miembro';
        return { id: uid, name: info?.name, city: this.islands.get(this.games.get(uid)?.state.home)?.name, island: this.games.get(uid)?.state.home, points: info?.score ?? 0, online: info?.online, founder: uid === a.founder, role };
      })
      .sort((x, y) => y.points - x.points);
    return {
      id: a.id,
      name: a.name,
      tag: a.tag,
      description: a.description,
      founder: a.founder,
      isFounder: a.founder === userId,
      canManage: this.#canManage(a, userId),
      open: !!a.open,
      points: this.#alliancePoints(a),
      members,
      diplomacy: this.#diplomacyOf(a.id),
      // Las solicitudes solo las ven quienes pueden aceptarlas
      applications: this.#canManage(a, userId)
        ? (a.applications ?? []).map((x) => ({ id: x.uid, name: this.users.get(x.uid)?.username ?? '¿?', points: this.games.get(x.uid)?.score() ?? 0, t: x.t, text: x.text }))
        : [],
    };
  }

  createAlliance(userId, name, tag) {
    name = String(name ?? '').trim();
    tag = String(tag ?? '').trim().toUpperCase();
    if (this.allianceOf(userId)) throw new UserError('Ya estás en una alianza.');
    if ((this.games.get(userId)?.level('ayuntamiento') ?? 0) < 2) throw new UserError('Necesitas el ayuntamiento a nivel 2 para fundar una alianza.');
    if (!ALLIANCE_RE.test(name)) throw new UserError('El nombre de la alianza debe tener entre 3 y 30 caracteres.');
    if (!TAG_RE.test(tag)) throw new UserError('La etiqueta debe tener entre 2 y 5 letras o números.');
    const all = Object.values(this.meta.alliances);
    if (all.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new UserError('Ya hay una alianza con ese nombre.');
    if (all.some((a) => a.tag === tag)) throw new UserError('Esa etiqueta ya está cogida.');
    const id = (this.meta.allianceSeq = (this.meta.allianceSeq ?? 0) + 1);
    this.meta.alliances[id] = { id, name, tag, founder: userId, members: [userId], description: '', created: Date.now() };
    this.memberOf.set(userId, id);
    this.rankingCache = null;
    this.announce(`🤝 ${this.users.get(userId).username} funda la alianza ${name} [${tag}]`);
    return this.allianceDetail(userId);
  }

  /** Líder u oficial: puede aceptar solicitudes, expulsar y moderar. */
  #canManage(a, userId) {
    return a.founder === userId || (a.officers ?? []).includes(userId);
  }

  /** Pedir entrar: en una alianza abierta se entra directamente; si no, queda la solicitud. */
  // ── Amigos ─────────────────────────────────────────────────────────────────
  // Se piden por el nombre; cuando el otro acepta, son amigos los dos. Así se ve
  // quién está conectado y se le escribe o se visita su perfil en un clic.

  #friendId(name) {
    const id = this.byName.get(String(name ?? '').trim().toLowerCase());
    if (id == null || !this.games.has(id)) throw new UserError('No hay ningún jugador con ese nombre.');
    return id;
  }

  #link(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const list = (this.meta.friends[x] ??= []);
      if (!list.includes(y)) list.push(y);
      this.meta.friendRequests[x] = (this.meta.friendRequests[x] ?? []).filter((id) => id !== y);
    }
  }

  /** Pedir amistad (si el otro ya te la había pedido, sois amigos al momento). */
  addFriend(userId, name) {
    const other = this.#friendId(name);
    if (other === userId) throw new UserError('No puedes añadirte a ti mismo.');
    if ((this.meta.friends[userId] ?? []).includes(other)) throw new UserError('Ya sois amigos.');
    if ((this.meta.friendRequests[userId] ?? []).includes(other)) {
      this.#link(userId, other);
      this.hostNews(other, `👥 ${this.users.get(userId).username} ha aceptado tu amistad`);
      this.pendingPush.add(other);
      return 'amigos';
    }
    const pending = (this.meta.friendRequests[other] ??= []);
    if (pending.includes(userId)) throw new UserError('Ya le has pedido amistad. Espera a que conteste.');
    const sent = Object.values(this.meta.friendRequests).filter((list) => list.includes(userId)).length;
    if (sent >= 30) throw new UserError('Tienes demasiadas solicitudes sin contestar.');
    if (pending.length >= 50) throw new UserError('Ese jugador tiene demasiadas solicitudes pendientes.');
    pending.push(userId);
    this.hostNews(other, `👥 ${this.users.get(userId).username} quiere ser tu amigo`);
    this.pendingPush.add(other);
    return 'pedida';
  }

  answerFriend(userId, name, accept) {
    const other = this.#friendId(name);
    const pending = this.meta.friendRequests[userId] ?? [];
    if (!pending.includes(other)) throw new UserError('Esa solicitud ya no existe.');
    if (accept) {
      this.#link(userId, other);
      this.hostNews(other, `👥 ${this.users.get(userId).username} ha aceptado tu amistad`);
      this.pendingPush.add(other);
    } else this.meta.friendRequests[userId] = pending.filter((id) => id !== other);
  }

  /** Dejar de ser amigos, o retirar una solicitud que mandaste. */
  removeFriend(userId, name) {
    const other = this.#friendId(name);
    for (const [x, y] of [[userId, other], [other, userId]]) this.meta.friends[x] = (this.meta.friends[x] ?? []).filter((id) => id !== y);
    this.meta.friendRequests[other] = (this.meta.friendRequests[other] ?? []).filter((id) => id !== userId);
  }

  /** Lista de amigos (con quién está conectado), solicitudes recibidas y enviadas. */
  friendList(userId) {
    const card = (id) => {
      const info = this.playerInfo(id);
      const user = this.users.get(id);
      if (!info || !user) return null;
      return {
        name: info.name,
        city: this.islands.get(this.games.get(id).state.home)?.name ?? '',
        score: info.score,
        online: info.online,
        lastSeen: this.games.get(id).state.lastSeen ?? user.lastSeen ?? 0,
        alliance: info.alliance?.tag ?? null,
        island: this.games.get(id).state.home,
      };
    };
    const friends = (this.meta.friends[userId] ?? []).map(card).filter(Boolean);
    friends.sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen);
    return {
      friends,
      incoming: (this.meta.friendRequests[userId] ?? []).map(card).filter(Boolean),
      outgoing: Object.entries(this.meta.friendRequests)
        .filter(([, list]) => list.includes(userId))
        .map(([id]) => card(Number(id)))
        .filter(Boolean),
    };
  }

  requestJoin(userId, allianceId, text = '') {
    const a = this.meta.alliances[Number(allianceId)];
    if (!a) throw new UserError('Esa alianza ya no existe.');
    if (this.allianceOf(userId)) throw new UserError('Ya estás en una alianza.');
    if (a.open) return this.joinAlliance(userId, a.id);
    if (a.members.length >= MAX_MEMBERS) throw new UserError(`La alianza está llena (${MAX_MEMBERS} miembros).`);
    a.applications ??= [];
    if (a.applications.some((x) => x.uid === userId)) throw new UserError('Ya has pedido entrar en esa alianza.');
    if (a.applications.length >= 30) throw new UserError('Esa alianza tiene demasiadas solicitudes pendientes.');
    a.applications.push({ uid: userId, t: Date.now(), text: String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) });
    this.announce(`📨 ${this.users.get(userId).username} pide entrar en la alianza`, `a:${a.id}`);
    for (const uid of [a.founder, ...(a.officers ?? [])]) this.pendingPush.add(uid);
    return null;
  }

  cancelApplication(userId, allianceId) {
    const a = this.meta.alliances[Number(allianceId)];
    if (!a) return;
    a.applications = (a.applications ?? []).filter((x) => x.uid !== userId);
  }

  /** Aceptar o rechazar a quien pide entrar (líder u oficiales). */
  answerApplication(userId, targetId, accept) {
    const a = this.allianceOf(userId);
    if (!a || !this.#canManage(a, userId)) throw new UserError('Solo el líder y los oficiales pueden responder a las solicitudes.');
    const app = (a.applications ?? []).find((x) => x.uid === targetId);
    if (!app) throw new UserError('Esa solicitud ya no está.');
    a.applications = a.applications.filter((x) => x !== app);
    const name = this.users.get(targetId)?.username ?? '¿?';
    if (!accept) {
      this.hostNews(targetId, `📨 La alianza ${a.name} [${a.tag}] no ha aceptado tu solicitud`);
      return this.allianceDetail(userId);
    }
    if (this.allianceOf(targetId)) throw new UserError(`${name} ya está en otra alianza.`);
    this.joinAlliance(targetId, a.id);
    this.hostNews(targetId, `🤝 ¡Te han aceptado en la alianza ${a.name} [${a.tag}]!`);
    this.pendingPush.add(targetId);
    return this.allianceDetail(userId);
  }

  /** El líder nombra o quita oficiales. */
  setOfficer(userId, targetId, on) {
    const a = this.allianceOf(userId);
    if (!a || a.founder !== userId) throw new UserError('Solo el líder nombra oficiales.');
    if (!a.members.includes(targetId) || targetId === userId) throw new UserError('Ese jugador no está en tu alianza.');
    a.officers = (a.officers ?? []).filter((uid) => uid !== targetId);
    if (on) a.officers.push(targetId);
    const name = this.users.get(targetId).username;
    this.announce(on ? `⭐ ${name} es ahora oficial de la alianza` : `${name} deja de ser oficial`, `a:${a.id}`);
    return this.allianceDetail(userId);
  }

  /** El líder cede el mando a otro miembro (y pasa a ser oficial). */
  transferLeadership(userId, targetId) {
    const a = this.allianceOf(userId);
    if (!a || a.founder !== userId) throw new UserError('Solo el líder puede ceder el mando.');
    if (!a.members.includes(targetId) || targetId === userId) throw new UserError('Ese jugador no está en tu alianza.');
    a.founder = targetId;
    a.officers = [...(a.officers ?? []).filter((uid) => uid !== targetId), userId];
    this.announce(`👑 ${this.users.get(targetId).username} lidera ahora la alianza`, `a:${a.id}`);
    for (const uid of a.members) this.pendingPush.add(uid);
    return this.allianceDetail(userId);
  }

  /** Abierta (entra quien quiera) o con solicitud. */
  setAllianceOpen(userId, open) {
    const a = this.allianceOf(userId);
    if (!a || a.founder !== userId) throw new UserError('Solo el líder decide cómo se entra en la alianza.');
    a.open = !!open;
    return this.allianceDetail(userId);
  }

  joinAlliance(userId, allianceId) {
    const a = this.meta.alliances[Number(allianceId)];
    if (!a) throw new UserError('Esa alianza ya no existe.');
    if (this.allianceOf(userId)) throw new UserError('Ya estás en una alianza.');
    if (a.members.length >= MAX_MEMBERS) throw new UserError(`La alianza está llena (${MAX_MEMBERS} miembros).`);
    a.members.push(userId);
    this.memberOf.set(userId, a.id);
    // Sus solicitudes a otras alianzas ya no hacen falta
    for (const other of Object.values(this.meta.alliances)) if (other.applications) other.applications = other.applications.filter((x) => x.uid !== userId);
    this.rankingCache = null;
    this.announce(`🤝 ${this.users.get(userId).username} se une a la alianza`, `a:${a.id}`);
    return this.allianceDetail(userId);
  }

  leaveAlliance(userId, { kickedBy } = {}) {
    const a = this.allianceOf(userId);
    if (!a) throw new UserError('No estás en ninguna alianza.');
    a.members = a.members.filter((uid) => uid !== userId);
    a.officers = (a.officers ?? []).filter((uid) => uid !== userId);
    this.memberOf.delete(userId);
    const name = this.users.get(userId).username;
    if (!a.members.length) {
      delete this.meta.alliances[a.id];
      delete this.meta.forums[a.id];
      for (const key of Object.keys(this.meta.diplomacy)) if (key.split('-').includes(String(a.id))) delete this.meta.diplomacy[key];
    } else {
      // Si se va el líder, manda el oficial más antiguo (o el miembro más antiguo)
      if (a.founder === userId) {
        a.founder = a.officers[0] ?? a.members[0];
        a.officers = a.officers.filter((uid) => uid !== a.founder);
      }
      this.announce(kickedBy ? `🤝 ${name} ha sido expulsado de la alianza` : `🤝 ${name} deja la alianza`, `a:${a.id}`);
    }
    this.rankingCache = null;
    this.#recallBrokenSupport();
  }

  kickMember(userId, targetId) {
    const a = this.allianceOf(userId);
    if (!a || !this.#canManage(a, userId)) throw new UserError('Solo el líder y los oficiales pueden expulsar.');
    if (targetId === userId || !a.members.includes(targetId)) throw new UserError('Ese jugador no está en tu alianza.');
    if (targetId === a.founder || (a.founder !== userId && (a.officers ?? []).includes(targetId))) throw new UserError('No puedes expulsar a alguien de tu mismo rango o superior.');
    this.leaveAlliance(targetId, { kickedBy: userId });
    return this.allianceDetail(userId);
  }

  /** Carta para todos los miembros de tu alianza. */
  allianceCircular(userId, subject, text) {
    const a = this.allianceOf(userId);
    if (!a) throw new UserError('No estás en ninguna alianza.');
    const to = a.members.filter((uid) => uid !== userId);
    if (!to.length) throw new UserError('Eres el único miembro de la alianza.');
    this.#deliverMail(userId, to, `[${a.tag}] Circular`, subject, text);
  }

  // ── Foro de la alianza ─────────────────────────────────────────────────────

  #forum(userId) {
    const a = this.allianceOf(userId);
    if (!a) throw new UserError('No estás en ninguna alianza.');
    this.meta.forums[a.id] ??= [];
    return { a, threads: this.meta.forums[a.id] };
  }

  #forumUnread(userId) {
    const a = this.allianceOf(userId);
    const threads = a ? (this.meta.forums[a.id] ?? []) : [];
    const seen = this.games.get(userId)?.state.forumSeen ?? {};
    const me = this.users.get(userId)?.username;
    return threads.filter((th) => th.lastBy !== me && th.last > (seen[th.id] ?? 0)).length;
  }

  /** Los temas del foro, los fijados primero y luego por la última respuesta. */
  forumList(userId) {
    const { a, threads } = this.#forum(userId);
    const seen = this.games.get(userId).state.forumSeen ?? {};
    const me = this.users.get(userId).username;
    return {
      canModerate: this.#canManage(a, userId),
      threads: threads
        .map((th) => ({
          id: th.id,
          title: th.title,
          author: th.author,
          t: th.t,
          last: th.last,
          lastBy: th.lastBy,
          count: th.posts.length,
          pinned: !!th.pinned,
          unread: th.lastBy !== me && th.last > (seen[th.id] ?? 0),
        }))
        .sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.last - x.last),
    };
  }

  /** Un tema entero; al leerlo queda marcado como leído. */
  forumThread(userId, id) {
    const { a, threads } = this.#forum(userId);
    const th = threads.find((x) => x.id === id);
    if (!th) throw new UserError('Ese tema ya no existe.');
    const game = this.games.get(userId);
    game.state.forumSeen ??= {};
    game.state.forumSeen[th.id] = th.last;
    // Olvidar lo leído de temas que ya no existen
    for (const key of Object.keys(game.state.forumSeen)) if (!threads.some((x) => x.id === Number(key))) delete game.state.forumSeen[key];
    game.dirty = true;
    const me = this.users.get(userId).username;
    return { ...th, canModerate: this.#canManage(a, userId), mine: th.author === me };
  }

  forumPost(userId, threadId, title, text) {
    const { a, threads } = this.#forum(userId);
    text = String(text ?? '').trim().slice(0, 3000);
    if (!text) throw new UserError('Escribe el mensaje.');
    const author = this.users.get(userId).username;
    const now = Date.now();
    const post = { id: (this.meta.postSeq = (this.meta.postSeq ?? 0) + 1), author, t: now, text };
    let th;
    if (threadId == null) {
      title = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (title.length < 3) throw new UserError('El título debe tener al menos 3 letras.');
      th = { id: (this.meta.threadSeq = (this.meta.threadSeq ?? 0) + 1), title, author, t: now, last: now, lastBy: author, pinned: false, posts: [post] };
      threads.push(th);
      // Si hay demasiados, se va el más viejo sin fijar
      if (threads.length > MAX_THREADS) {
        const old = threads.filter((x) => !x.pinned).sort((x, y) => x.last - y.last)[0];
        if (old) threads.splice(threads.indexOf(old), 1);
      }
      this.announce(`🗂️ ${author} abre un tema en el foro: «${title}»`, `a:${a.id}`);
    } else {
      th = threads.find((x) => x.id === threadId);
      if (!th) throw new UserError('Ese tema ya no existe.');
      th.posts.push(post);
      if (th.posts.length > MAX_POSTS) th.posts.splice(1, th.posts.length - MAX_POSTS);
      th.last = now;
      th.lastBy = author;
    }
    for (const uid of a.members) this.pendingPush.add(uid);
    return this.forumThread(userId, th.id);
  }

  /** Fijar o borrar un tema: quien lidera (o quien lo abrió, para borrarlo). */
  forumModerate(userId, threadId, op) {
    const { a, threads } = this.#forum(userId);
    const th = threads.find((x) => x.id === threadId);
    if (!th) throw new UserError('Ese tema ya no existe.');
    const leader = this.#canManage(a, userId);
    if (op === 'pin') {
      if (!leader) throw new UserError('Solo quien lidera la alianza puede fijar temas.');
      th.pinned = !th.pinned;
    } else if (op === 'delete') {
      if (!leader && th.author !== this.users.get(userId).username) throw new UserError('Solo puedes borrar los temas que has abierto tú.');
      threads.splice(threads.indexOf(th), 1);
    } else {
      throw new UserError('Esa acción no existe.');
    }
    for (const uid of a.members) this.pendingPush.add(uid);
  }

  // ── Diplomacia entre alianzas ──────────────────────────────────────────────

  /** Pactos, guerras y propuestas de una alianza, vistos desde ella. */
  #diplomacyOf(allianceId) {
    const out = [];
    for (const [key, rec] of Object.entries(this.meta.diplomacy)) {
      const [x, y] = key.split('-').map(Number);
      if (x !== allianceId && y !== allianceId) continue;
      const other = this.meta.alliances[x === allianceId ? y : x];
      if (!other) continue;
      out.push({
        id: other.id,
        name: other.name,
        tag: other.tag,
        type: rec.type,
        since: rec.since,
        proposal: rec.proposal ? { kind: rec.proposal.kind, mine: rec.proposal.from === allianceId } : null,
        war:
          rec.type === 'guerra'
            ? { kills: rec.kills[allianceId] ?? 0, losses: rec.kills[other.id] ?? 0, loot: rec.loot[allianceId] ?? 0, lootLost: rec.loot[other.id] ?? 0, battles: rec.battles ?? 0, declaredByUs: rec.by === allianceId }
            : null,
      });
    }
    const order = { guerra: 0, pacto: 1 };
    return out.sort((p, q) => (order[p.type] ?? 2) - (order[q.type] ?? 2) || p.name.localeCompare(q.name));
  }

  /**
   * Lo que hace quien lidera una alianza con otra: proponer un pacto, aceptar
   * o rechazar una propuesta, romper un pacto, declarar la guerra o pedir la paz.
   */
  diplomacy(userId, otherId, op) {
    const a = this.allianceOf(userId);
    if (!a || a.founder !== userId) throw new UserError('Solo quien lidera la alianza lleva la diplomacia.');
    const b = this.meta.alliances[Number(otherId)];
    if (!b || b.id === a.id) throw new UserError('Esa alianza no existe.');
    const key = pairKey(a.id, b.id);
    const rec = this.meta.diplomacy[key];
    const now = Date.now();
    const us = `${a.name} [${a.tag}]`;
    const them = `${b.name} [${b.tag}]`;
    const both = (text) => {
      this.announce(text, `a:${a.id}`);
      this.announce(text, `a:${b.id}`);
    };
    switch (op) {
      case 'pacto':
        if (rec?.type === 'pacto') throw new UserError('Ya tenéis un pacto de no agresión.');
        if (rec?.type === 'guerra') throw new UserError('Estáis en guerra: primero hay que firmar la paz.');
        if (rec?.proposal) throw new UserError('Ya hay una propuesta pendiente entre vosotros.');
        this.meta.diplomacy[key] = { type: null, since: now, proposal: { kind: 'pacto', from: a.id, t: now } };
        both(`🕊️ ${us} propone un pacto de no agresión a ${them}`);
        break;
      case 'paz':
        if (rec?.type !== 'guerra') throw new UserError('No estáis en guerra.');
        if (rec.proposal) throw new UserError('Ya hay una propuesta de paz pendiente.');
        rec.proposal = { kind: 'paz', from: a.id, t: now };
        both(`🕊️ ${us} ofrece la paz a ${them}`);
        break;
      case 'aceptar': {
        if (!rec?.proposal || rec.proposal.from === a.id) throw new UserError('No hay ninguna propuesta que aceptar.');
        if (rec.proposal.kind === 'pacto') {
          this.meta.diplomacy[key] = { type: 'pacto', since: now, proposal: null };
          this.announce(`🕊️ ${us} y ${them} firman un pacto de no agresión`);
        } else {
          delete this.meta.diplomacy[key];
          const n = rec.battles ?? 0;
          this.announce(`🕊️ ${us} y ${them} firman la paz${n ? ` tras ${n} ${n === 1 ? 'batalla' : 'batallas'}` : ''}`);
        }
        break;
      }
      case 'rechazar':
        if (!rec?.proposal) throw new UserError('No hay ninguna propuesta.');
        both(rec.proposal.from === a.id ? `📜 ${us} retira su propuesta a ${them}` : `📜 ${us} rechaza la propuesta de ${them}`);
        if (rec.type) rec.proposal = null;
        else delete this.meta.diplomacy[key];
        break;
      case 'romper':
        if (rec?.type !== 'pacto') throw new UserError('No tenéis ningún pacto.');
        delete this.meta.diplomacy[key];
        both(`📜 ${us} rompe el pacto de no agresión con ${them}`);
        break;
      case 'guerra':
        if (rec?.type === 'guerra') throw new UserError('Ya estáis en guerra.');
        this.meta.diplomacy[key] = { type: 'guerra', since: now, by: a.id, proposal: null, kills: {}, loot: {}, battles: 0 };
        this.announce(`⚔️ ${us} declara la guerra a ${them}${rec?.type === 'pacto' ? ' rompiendo su pacto' : ''}`);
        break;
      default:
        throw new UserError('Esa acción no existe.');
    }
    // Las relaciones cambian lo que ve cada miembro de las dos alianzas
    for (const uid of [...a.members, ...b.members]) this.pendingPush.add(uid);
    this.mapCache = null;
  }

  describeAlliance(userId, text) {
    const a = this.allianceOf(userId);
    if (!a || !this.#canManage(a, userId)) throw new UserError('Solo el líder y los oficiales pueden cambiar la descripción.');
    a.description = String(text ?? '').trim().slice(0, 500);
    return this.allianceDetail(userId);
  }

  // ── Mapa del mundo ─────────────────────────────────────────────────────────

  /**
   * Todo el archipiélago en pocas cifras: las ciudades de los jugadores y el
   * resto de islas como [x, z, tipo, colono]. Se recalcula cada medio minuto.
   */
  worldMap(userId) {
    if (!this.mapCache || Date.now() - this.mapCache.at > MAP_CACHE_MS || this.mapCache.size !== this.islands.size) {
      const cities = [];
      const islands = [];
      for (const isl of this.islands.values()) {
        if (isl.type === 'jugador') {
          const g = this.games.get(isl.owner);
          if (!g) continue;
          const a = this.allianceOf(isl.owner);
          const port = portOf(g.state);
          cities.push({
            id: isl.id,
            x: Math.round(isl.x),
            z: Math.round(isl.z),
            city: isl.name,
            uid: isl.owner,
            name: g.name,
            points: g.score(),
            protected: g.isProtected(),
            vacation: !!g.state.vacation,
            inactive: this.isInactive(isl.owner),
            color: g.state.banner?.color ?? null,
            emblem: g.state.banner?.emblem ?? null,
            aid: a?.id ?? null,
            tag: a?.tag ?? null,
            // Bloqueada u ocupada: { kind, name } de quien lo hace
            port: port && { kind: port.kind, name: port.name },
          });
        } else {
          const entry = [Math.round(isl.x), Math.round(isl.z), isl.type, this.islandStates.get(isl.id)?.colonizedBy ?? 0];
          if (isl.type === 'continente') entry.push(Math.round(isl.size * 2.4));
          islands.push(entry);
        }
      }
      this.mapCache = { at: Date.now(), size: this.islands.size, cities, islands };
    }
    // Lo que depende de quién mira: con quién tiene pacto o guerra su alianza
    const mine = this.memberOf.get(userId);
    const relations = {};
    if (mine != null) {
      relations[mine] = 'aliado';
      for (const [key, rec] of Object.entries(this.meta.diplomacy)) {
        const [x, y] = key.split('-').map(Number);
        if (rec.type && (x === mine || y === mine)) relations[x === mine ? y : x] = rec.type;
      }
    }
    const { cities, islands } = this.mapCache;
    return { cities, islands, relations, viewRadius: VIEW_RADIUS };
  }

  // ── Conexiones en vivo (WebSocket) ─────────────────────────────────────────

  addSocket(userId, ws) {
    if (!this.sockets.has(userId)) this.sockets.set(userId, new Set());
    this.sockets.get(userId).add(ws);
  }

  removeSocket(userId, ws) {
    const set = this.sockets.get(userId);
    set?.delete(ws);
    if (set && !set.size) this.sockets.delete(userId);
  }

  send(userId, msg) {
    const set = this.sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }

  /** Manda el estado nuevo a quien esté conectado y haya tenido cambios. */
  flushPush() {
    for (const uid of this.pendingPush) {
      if (this.sockets.has(uid) && this.games.has(uid)) this.send(uid, { type: 'snapshot', data: this.snapshot(uid) });
    }
    this.pendingPush.clear();
  }

  // ── Moderación ─────────────────────────────────────────────────────────────
  // Moderadores: nombres en la variable de entorno ADMINS, separados por comas.

  isAdmin(userId) {
    return this.admins.has(this.users.get(userId)?.username.toLowerCase());
  }

  isBanned(userId) {
    return !!this.meta.mod?.[userId]?.banned;
  }

  #target(adminId, name) {
    if (!this.isAdmin(adminId)) throw new UserError('Solo para moderadores.');
    const id = this.byName.get(String(name ?? '').trim().toLowerCase());
    if (id == null) throw new UserError('No hay ningún jugador con ese nombre.');
    if (this.isAdmin(id)) throw new UserError('No se puede moderar a otro moderador.');
    return id;
  }

  mute(adminId, name, minutes) {
    const id = this.#target(adminId, name);
    const m = Math.max(0, Math.min(60 * 24 * 30, Math.floor(Number(minutes) || 0)));
    this.meta.mod[id] = { ...this.meta.mod[id], mutedUntil: m ? Date.now() + m * 60_000 : 0 };
    this.announce(m ? `🔇 ${this.users.get(id).username} ha sido silenciado en el chat` : `🔈 ${this.users.get(id).username} puede volver a escribir`);
  }

  ban(adminId, name, reason, banned = true) {
    const id = this.#target(adminId, name);
    this.meta.mod[id] = { ...this.meta.mod[id], banned, reason: banned ? String(reason ?? '').slice(0, 200) : '' };
    if (banned) for (const ws of this.sockets.get(id) ?? []) ws.close(4003, 'Cuenta suspendida');
  }

  deleteChat(adminId, msgId) {
    if (!this.isAdmin(adminId)) throw new UserError('Solo para moderadores.');
    const id = Number(msgId);
    this.chat = this.chat.filter((m) => m.id !== id);
    this.meta.chatDeleted.push(id);
    if (this.meta.chatDeleted.length > 500) this.meta.chatDeleted.splice(0, this.meta.chatDeleted.length - 500);
    for (const uid of this.sockets.keys()) this.send(uid, { type: 'chat-delete', id });
  }

  broadcast(adminId, text) {
    if (!this.isAdmin(adminId)) throw new UserError('Solo para moderadores.');
    const clean = String(text ?? '').trim().slice(0, 300);
    if (!clean) throw new UserError('Escribe el anuncio.');
    this.announce(`📣 ${clean}`);
  }

  // ── Perfil y cuenta ────────────────────────────────────────────────────────

  profile(name) {
    const id = this.byName.get(String(name ?? '').trim().toLowerCase());
    const game = id != null ? this.games.get(id) : null;
    if (!game) throw new UserError('No hay ningún jugador con ese nombre.');
    const info = this.playerInfo(id);
    const rank = this.ranking(null).top.find((r) => r.name === info.name)?.rank ?? null;
    return {
      name: info.name,
      city: this.islands.get(game.state.home)?.name,
      island: game.state.home,
      alliance: info.alliance,
      points: info.score,
      rank,
      online: info.online,
      joined: this.users.get(id).created,
      townLevel: info.townLevel,
      colonies: game.state.colonies.map((c) => c.name),
      coloso: game.level('coloso'),
      victories: game.stats.victories,
      kills: game.stats.kills ?? 0,
      loot: game.stats.loot ?? 0,
      achievements: game.achievements(),
      hero: game.state.hero ? { name: game.state.hero.name, level: game.state.hero.level } : null,
      banner: game.state.banner ?? null,
      title: this.#titleOf(id),
      titleId: game.state.title ?? null,
      history: (game.state.history ?? []).map((h) => ({ day: h.day, points: h.points })),
      muted: (this.meta.mod[id]?.mutedUntil ?? 0) > Date.now(),
      banned: this.isBanned(id),
    };
  }

  async changePassword(userId, current, next) {
    const user = this.users.get(userId);
    if (typeof current !== 'string' || !verifyPassword(current, user.pass)) throw new UserError('La contraseña actual no es correcta.');
    if (typeof next !== 'string' || next.length < 6 || next.length > 100) throw new UserError('La contraseña nueva debe tener al menos 6 caracteres.');
    user.pass = hashPassword(next);
    await this.store.updatePassword(userId, user.pass);
  }

  // ── Correo ─────────────────────────────────────────────────────────────────

  sendMail(userId, toName, subject, text) {
    const toId = this.byName.get(String(toName ?? '').trim().toLowerCase());
    if (toId == null) throw new UserError('No hay ningún jugador con ese nombre.');
    this.#deliverMail(userId, [toId], this.users.get(toId).username, subject, text);
  }

  /** Deja una carta en el buzón de cada destinatario y una copia en los enviados. */
  #deliverMail(userId, recipients, toLabel, subject, text) {
    subject = String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(sin asunto)';
    text = String(text ?? '').trim().slice(0, 2000);
    if (!text) throw new UserError('Escribe el mensaje.');
    const from = this.users.get(userId).username;
    const id = (this.meta.mailSeq = (this.meta.mailSeq ?? 0) + 1);
    const base = { id, t: Date.now(), from, to: toLabel, subject, text };
    const put = (uid, box) => {
      const game = this.games.get(uid);
      game.state.mail ??= [];
      game.state.mail.unshift({ ...base, box, read: box === 'out' });
      if (game.state.mail.length > MAX_MAIL) game.state.mail.length = MAX_MAIL;
      game.dirty = true;
    };
    for (const uid of recipients) {
      put(uid, 'in');
      this.pendingPush.add(uid); // que vea el sobre al momento
    }
    if (!recipients.includes(userId)) put(userId, 'out');
  }

  mailbox(userId) {
    return this.games.get(userId).state.mail ?? [];
  }

  readMail(userId, id) {
    const game = this.games.get(userId);
    for (const m of game.state.mail ?? []) if (id === 'all' || m.id === Number(id)) m.read = true;
    game.dirty = true;
  }

  deleteMail(userId, id) {
    const game = this.games.get(userId);
    game.state.mail = (game.state.mail ?? []).filter((m) => m.id !== Number(id));
    game.dirty = true;
  }

  // ── Mercado del archipiélago (ofertas entre jugadores) ─────────────────────

  #cleanOffer(bag) {
    const entries = Object.entries(bag ?? {}).filter(([res]) => Object.hasOwn(RESOURCES, res));
    if (entries.length !== 1) throw new UserError('Cada lado de la oferta es un solo recurso.');
    const [res, raw] = entries[0];
    const n = Math.floor(Number(raw));
    if (!(n >= 1 && n <= 10_000_000)) throw new UserError('Cantidad no válida.');
    return { [res]: n };
  }

  listOffers(userId) {
    return this.meta.offers
      .map((o) => ({ ...o, sellerName: this.users.get(o.seller)?.username ?? '¿?', mine: o.seller === userId }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 100);
  }

  postOffer(userId, give, want) {
    give = this.#cleanOffer(give);
    want = this.#cleanOffer(want);
    if (Object.keys(give)[0] === Object.keys(want)[0]) throw new UserError('Elige dos recursos distintos.');
    const game = this.games.get(userId);
    if (game.level('mercado') < 1) throw new UserError('Necesitas un mercado para comerciar.');
    if (this.meta.offers.filter((o) => o.seller === userId).length >= MAX_OFFERS) throw new UserError(`Como mucho ${MAX_OFFERS} ofertas a la vez.`);
    if (!game.takeResources(give)) throw new UserError('No tienes esos recursos.');
    const id = (this.meta.offerSeq = (this.meta.offerSeq ?? 0) + 1);
    this.meta.offers.push({ id, seller: userId, give, want, t: Date.now() });
  }

  cancelOffer(userId, id) {
    const o = this.meta.offers.find((x) => x.id === Number(id));
    if (!o || o.seller !== userId) throw new UserError('Esa oferta no es tuya o ya no existe.');
    this.meta.offers = this.meta.offers.filter((x) => x !== o);
    this.games.get(userId).giveResources(o.give);
  }

  acceptOffer(userId, id) {
    const o = this.meta.offers.find((x) => x.id === Number(id));
    if (!o) throw new UserError('Alguien se te ha adelantado: esa oferta ya no existe.');
    if (o.seller === userId) throw new UserError('Es tu propia oferta.');
    const buyer = this.games.get(userId);
    if (!buyer.takeResources(o.want)) throw new UserError('No tienes lo que piden.');
    this.meta.offers = this.meta.offers.filter((x) => x !== o);
    buyer.giveResources(o.give);
    const name = this.users.get(userId).username;
    const seller = this.games.get(o.seller);
    seller?.giveResources(o.want, `⚖️ ${name} ha aceptado tu oferta del mercado`);
    for (const g of [buyer, seller]) if (g) g.state.stats.trades = (g.state.stats.trades ?? 0) + 1;
  }
}

/** Error que se puede enseñar tal cual al jugador. */
export class UserError extends Error {}

/** Clave de la relación entre dos alianzas (la misma en los dos sentidos). */
function pairKey(x, y) {
  return x < y ? `${x}-${y}` : `${y}-${x}`;
}
