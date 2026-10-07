import { clock, universe } from '../src/config.js';
import { Game, newState } from '../src/game/Game.js';
import { freshIslandState, generateSector, homeIsland } from '../src/game/world.js';
import { hashPassword, newSecret, verifyPassword } from './auth.js';

// El mundo de todos los jugadores, en memoria. Implementa la interfaz `world`
// que usa Game (islas compartidas, información de otros jugadores, ataques).

const VIEW_RADIUS = 700; // leguas alrededor de tu isla que ves en el mapa
const ONLINE_MS = 5 * 60_000;
const MAX_CHAT = 100;
export const NAME_RE = /^[\p{L}\p{N}_ .-]{3,20}$/u;

export class WorldServer {
  constructor(store) {
    this.store = store;
    this.users = new Map(); // id → { id, username, pass, created, lastSeen }
    this.byName = new Map(); // nombre en minúsculas → id
    this.games = new Map(); // id → Game
    this.islands = new Map(); // id → isla (datos fijos)
    this.islandStates = new Map(); // id → estado compartido
    this.chat = [];
    this.dirtyIslands = new Set();
    this.newIslands = [];
    this.pendingChat = [];
    this.rankingCache = null;
  }

  async load() {
    const data = await this.store.load();
    this.meta = { sectors: 0, seed: Math.floor(Math.random() * 1e9), ...data.meta };
    if (!this.meta.secret) this.meta.secret = process.env.AUTH_SECRET || newSecret();
    this.secret = process.env.AUTH_SECRET || this.meta.secret;
    for (const isl of data.islands) this.islands.set(isl.id, isl);
    for (const [id, st] of Object.entries(data.islandStates)) this.islandStates.set(id, st);
    for (const isl of this.islands.values()) {
      if (isl.type !== 'jugador' && !this.islandStates.has(isl.id)) this.islandStates.set(isl.id, freshIslandState(isl, clock.now()));
    }
    for (const u of data.users) {
      this.users.set(u.id, { ...u, lastSeen: 0 });
      this.byName.set(u.username.toLowerCase(), u.id);
    }
    for (const [uid, state] of Object.entries(data.players)) {
      const id = Number(uid);
      if (this.users.has(id)) this.games.set(id, this.#makeGame(id, state));
    }
    this.chat = data.chat.slice(-MAX_CHAT);
    // Ponerse al día con lo que pasó mientras el servidor estuvo apagado
    this.tick();
    await this.persist(true);
  }

  #makeGame(userId, state) {
    const game = new Game({ state, world: this, userId, mode: 'server' });
    game.dirty = false;
    return game;
  }

  // ── Cuentas ────────────────────────────────────────────────────────────────

  async register(username, password, city) {
    username = String(username ?? '').trim();
    city = String(city ?? '').trim() || username;
    if (!NAME_RE.test(username)) throw new UserError('El nombre debe tener entre 3 y 20 letras o números.');
    if (!NAME_RE.test(city)) throw new UserError('El nombre de la ciudad debe tener entre 3 y 20 letras o números.');
    if (typeof password !== 'string' || password.length < 6 || password.length > 100) throw new UserError('La contraseña debe tener al menos 6 caracteres.');
    if (this.byName.has(username.toLowerCase())) throw new UserError('Ese nombre ya está cogido.');

    const created = Date.now();
    const pass = hashPassword(password);
    const id = await this.store.createUser({ username, pass, created });
    this.users.set(id, { id, username, pass, created, lastSeen: created });
    this.byName.set(username.toLowerCase(), id);

    // Cada jugador nuevo abre un sector del archipiélago
    const sector = this.meta.sectors++;
    const now = clock.now();
    const home = homeIsland(sector, id, city);
    const neutrals = generateSector(sector, this.meta.seed);
    for (const isl of [home, ...neutrals]) {
      this.islands.set(isl.id, isl);
      this.newIslands.push(isl);
      if (isl.type !== 'jugador') {
        this.islandStates.set(isl.id, freshIslandState(isl, now));
        this.dirtyIslands.add(isl.id);
      }
    }
    const game = this.#makeGame(id, newState({ now, home: home.id, name: username }));
    game.dirty = true;
    this.games.set(id, game);
    this.rankingCache = null;
    this.announce(`⚓ ${username} funda la ciudad de ${city}`);
    await this.persist(true);
    return id;
  }

  login(username, password) {
    const id = this.byName.get(String(username ?? '').trim().toLowerCase());
    const user = id != null ? this.users.get(id) : null;
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.pass)) throw new UserError('Nombre o contraseña incorrectos.');
    return id;
  }

  seen(userId) {
    const u = this.users.get(userId);
    if (u) u.lastSeen = Date.now();
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
    return {
      name: user.username,
      score: game.score(),
      protected: game.isProtected(),
      townLevel: game.level('ayuntamiento'),
      online: Date.now() - user.lastSeen < ONLINE_MS,
    };
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

  spyPlayer(ownerId, t) {
    const target = this.games.get(ownerId);
    if (!target) return null;
    target.update(t);
    return { name: target.name, ...target.spyReport() };
  }

  attackPlayer(ownerId, payload, t) {
    const target = this.games.get(ownerId);
    if (!target) return null;
    // Que el defensor llegue al momento del ataque (si no está ya ocupado)
    target.update(t);
    const res = target.receiveAttack(payload, t);
    target.dirty = true;
    return res;
  }

  announce(text) {
    const msg = { id: (this.meta.chatSeq = (this.meta.chatSeq ?? 0) + 1), t: Date.now(), name: null, text, system: true };
    this.chat.push(msg);
    this.pendingChat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
  }

  // ── Bucle y guardado ───────────────────────────────────────────────────────

  tick() {
    const now = clock.now();
    for (const game of this.games.values()) game.update(now);
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
    for (const m of game.state.missions) ids.add(m.target);
    for (const c of game.state.colonies) ids.add(c.id);
    const islands = [...ids].map((id) => this.islands.get(id)).filter(Boolean);
    const states = {};
    const players = {};
    for (const isl of islands) {
      const rt = this.islandStates.get(isl.id);
      if (rt) states[isl.id] = rt;
      if (isl.owner != null) players[isl.owner] = this.playerInfo(isl.owner);
      if (rt?.colonizedBy != null) players[rt.colonizedBy] = this.playerInfo(rt.colonizedBy);
    }
    return {
      serverTime: now,
      speed: universe.speed,
      userId,
      username: user.username,
      state: game.state,
      world: { islands, states, players },
      incoming: this.incoming(game.state.home),
    };
  }

  /** Flotas de otros jugadores que vienen a atacar esta isla. */
  incoming(homeId) {
    const list = [];
    for (const [uid, other] of this.games) {
      for (const m of other.state.missions) {
        if (m.target !== homeId || m.phase !== 'ida' || m.type !== 'atacar') continue;
        const from = this.islands.get(other.state.home);
        const size = Object.values(m.units).reduce((a, b) => a + b, 0);
        list.push({ id: `${uid}-${m.id}`, from: other.name, fromIsland: from?.name, x: from?.x, z: from?.z, depart: m.depart, arrive: m.arrive, size });
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
        points: g.score(),
        colonies: g.state.colonies.length,
        coloso: g.level('coloso'),
      }));
      rows.sort((a, b) => b.points - a.points);
      rows.forEach((r, i) => (r.rank = i + 1));
      this.rankingCache = { at: Date.now(), rows };
    }
    const rows = this.rankingCache.rows;
    const me = rows.find((r) => r.id === userId) ?? null;
    return { top: rows.slice(0, 100).map(({ id, ...r }) => ({ ...r, me: id === userId })), me, total: rows.length };
  }

  stats() {
    const now = Date.now();
    const online = [...this.users.values()].filter((u) => now - u.lastSeen < ONLINE_MS).length;
    return { players: this.users.size, online, top: this.ranking(null).top.slice(0, 5) };
  }

  addChat(userId, text) {
    const user = this.users.get(userId);
    text = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) throw new UserError('Escribe algo.');
    const msg = { id: (this.meta.chatSeq = (this.meta.chatSeq ?? 0) + 1), t: Date.now(), name: user.username, text };
    this.chat.push(msg);
    this.pendingChat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return msg;
  }

  chatSince(after) {
    return this.chat.filter((m) => m.id > after);
  }
}

/** Error que se puede enseñar tal cual al jugador. */
export class UserError extends Error {}
