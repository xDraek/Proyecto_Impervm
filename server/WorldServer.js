import { clock, universe } from '../src/config.js';
import { RESOURCES } from '../src/game/data.js';
import { Game, newState } from '../src/game/Game.js';
import { freshIslandState, generateSector, homeIsland } from '../src/game/world.js';
import { hashPassword, newSecret, verifyPassword } from './auth.js';

// El mundo de todos los jugadores, en memoria. Implementa la interfaz `world`
// que usa Game (islas compartidas, información de otros jugadores, ataques).

const VIEW_RADIUS = 700; // leguas alrededor de tu isla que ves en el mapa
const ONLINE_MS = 5 * 60_000;
const MAX_CHAT = 300;
const MAX_MAIL = 60;
const MAX_MEMBERS = 20;
const MAX_OFFERS = 5;
const OFFER_DAYS = 3;
export const NAME_RE = /^[\p{L}\p{N}_ .-]{3,20}$/u;
const ALLIANCE_RE = /^[\p{L}\p{N}_ .'-]{3,30}$/u;
const TAG_RE = /^[\p{L}\p{N}]{2,5}$/u;

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
    this.meta.alliances ??= {};
    this.meta.offers ??= [];
    this.memberOf = new Map();
    for (const a of Object.values(this.meta.alliances)) for (const uid of a.members) this.memberOf.set(uid, a.id);
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
    const a = this.allianceOf(userId);
    return {
      name: user.username,
      score: game.score(),
      protected: game.isProtected(),
      townLevel: game.level('ayuntamiento'),
      online: Date.now() - user.lastSeen < ONLINE_MS,
      alliance: a ? { id: a.id, tag: a.tag, name: a.name } : null,
    };
  }

  sameAlliance(a, b) {
    const x = this.memberOf.get(a);
    return x != null && x === this.memberOf.get(b);
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

  announce(text, channel = 'global') {
    this.#pushChat({ name: null, text, system: true, channel });
  }

  #pushChat(data) {
    const msg = { id: (this.meta.chatSeq = (this.meta.chatSeq ?? 0) + 1), t: Date.now(), ...data };
    this.chat.push(msg);
    this.pendingChat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return msg;
  }

  // ── Bucle y guardado ───────────────────────────────────────────────────────

  tick() {
    const now = clock.now();
    for (const game of this.games.values()) game.update(now);
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
    const a = this.allianceOf(userId);
    // El correo va aparte (puede ser largo): aquí solo cuántos sin leer
    const { mail, ...state } = game.state;
    return {
      serverTime: now,
      speed: universe.speed,
      userId,
      username: user.username,
      alliance: a ? { id: a.id, tag: a.tag, name: a.name } : null,
      mailUnread: (mail ?? []).filter((m) => m.box === 'in' && !m.read).length,
      state,
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
        island: g.state.home,
        points: g.score(),
        colonies: g.state.colonies.length,
        coloso: g.level('coloso'),
        tag: this.allianceOf(id)?.tag ?? null,
      }));
      rows.sort((a, b) => b.points - a.points);
      rows.forEach((r, i) => (r.rank = i + 1));
      this.rankingCache = { at: Date.now(), rows, alliances: this.allianceList() };
    }
    const rows = this.rankingCache.rows;
    const me = rows.find((r) => r.id === userId) ?? null;
    return {
      top: rows.slice(0, 100).map(({ id, ...r }) => ({ ...r, me: id === userId })),
      me,
      total: rows.length,
      alliances: this.rankingCache.alliances,
    };
  }

  stats() {
    const now = Date.now();
    const online = [...this.users.values()].filter((u) => now - u.lastSeen < ONLINE_MS).length;
    return { players: this.users.size, online, top: this.ranking(null).top.slice(0, 5) };
  }

  addChat(userId, text, channel = 'global') {
    const user = this.users.get(userId);
    text = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) throw new UserError('Escribe algo.');
    let ch = 'global';
    if (channel === 'alianza') {
      const a = this.allianceOf(userId);
      if (!a) throw new UserError('No estás en ninguna alianza.');
      ch = `a:${a.id}`;
    }
    return this.#pushChat({ name: user.username, text, channel: ch });
  }

  /** Mensajes nuevos que puede leer el jugador: el canal global y el de su alianza. */
  chatSince(userId, after) {
    const a = this.allianceOf(userId);
    const mine = a ? `a:${a.id}` : null;
    return this.chat
      .filter((m) => m.id > after && (!m.channel || m.channel === 'global' || m.channel === mine))
      .map((m) => ({ ...m, channel: m.channel && m.channel !== 'global' ? 'alianza' : 'global' }));
  }

  // ── Alianzas ───────────────────────────────────────────────────────────────

  allianceOf(userId) {
    const id = this.memberOf?.get(userId);
    return id != null ? this.meta.alliances[id] : null;
  }

  #alliancePoints(a) {
    return a.members.reduce((sum, uid) => sum + (this.games.get(uid)?.score() ?? 0), 0);
  }

  allianceList() {
    return Object.values(this.meta.alliances)
      .map((a) => ({ id: a.id, name: a.name, tag: a.tag, members: a.members.length, points: this.#alliancePoints(a) }))
      .sort((a, b) => b.points - a.points)
      .map((a, i) => ({ ...a, rank: i + 1 }));
  }

  allianceDetail(userId) {
    const a = this.allianceOf(userId);
    if (!a) return null;
    const members = a.members
      .map((uid) => {
        const info = this.playerInfo(uid);
        return { id: uid, name: info?.name, city: this.islands.get(this.games.get(uid)?.state.home)?.name, island: this.games.get(uid)?.state.home, points: info?.score ?? 0, online: info?.online, founder: uid === a.founder };
      })
      .sort((x, y) => y.points - x.points);
    return { id: a.id, name: a.name, tag: a.tag, description: a.description, founder: a.founder, isFounder: a.founder === userId, points: this.#alliancePoints(a), members };
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

  joinAlliance(userId, allianceId) {
    const a = this.meta.alliances[Number(allianceId)];
    if (!a) throw new UserError('Esa alianza ya no existe.');
    if (this.allianceOf(userId)) throw new UserError('Ya estás en una alianza.');
    if (a.members.length >= MAX_MEMBERS) throw new UserError(`La alianza está llena (${MAX_MEMBERS} miembros).`);
    a.members.push(userId);
    this.memberOf.set(userId, a.id);
    this.rankingCache = null;
    this.announce(`🤝 ${this.users.get(userId).username} se une a la alianza`, `a:${a.id}`);
    return this.allianceDetail(userId);
  }

  leaveAlliance(userId, { kickedBy } = {}) {
    const a = this.allianceOf(userId);
    if (!a) throw new UserError('No estás en ninguna alianza.');
    a.members = a.members.filter((uid) => uid !== userId);
    this.memberOf.delete(userId);
    const name = this.users.get(userId).username;
    if (!a.members.length) {
      delete this.meta.alliances[a.id];
    } else {
      if (a.founder === userId) a.founder = a.members[0];
      this.announce(kickedBy ? `🤝 ${name} ha sido expulsado de la alianza` : `🤝 ${name} deja la alianza`, `a:${a.id}`);
    }
    this.rankingCache = null;
  }

  kickMember(userId, targetId) {
    const a = this.allianceOf(userId);
    if (!a || a.founder !== userId) throw new UserError('Solo quien lidera la alianza puede expulsar.');
    if (targetId === userId || !a.members.includes(targetId)) throw new UserError('Ese jugador no está en tu alianza.');
    this.leaveAlliance(targetId, { kickedBy: userId });
    return this.allianceDetail(userId);
  }

  describeAlliance(userId, text) {
    const a = this.allianceOf(userId);
    if (!a || a.founder !== userId) throw new UserError('Solo quien lidera la alianza puede cambiar la descripción.');
    a.description = String(text ?? '').trim().slice(0, 500);
    return this.allianceDetail(userId);
  }

  // ── Correo ─────────────────────────────────────────────────────────────────

  sendMail(userId, toName, subject, text) {
    const toId = this.byName.get(String(toName ?? '').trim().toLowerCase());
    if (toId == null) throw new UserError('No hay ningún jugador con ese nombre.');
    subject = String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(sin asunto)';
    text = String(text ?? '').trim().slice(0, 2000);
    if (!text) throw new UserError('Escribe el mensaje.');
    const from = this.users.get(userId).username;
    const to = this.users.get(toId).username;
    const id = (this.meta.mailSeq = (this.meta.mailSeq ?? 0) + 1);
    const base = { id, t: Date.now(), from, to, subject, text };
    const put = (uid, box) => {
      const game = this.games.get(uid);
      game.state.mail ??= [];
      game.state.mail.unshift({ ...base, box, read: box === 'out' });
      if (game.state.mail.length > MAX_MAIL) game.state.mail.length = MAX_MAIL;
      game.dirty = true;
    };
    put(toId, 'in');
    if (toId !== userId) put(userId, 'out');
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
    this.games.get(o.seller)?.giveResources(o.want, `⚖️ ${name} ha aceptado tu oferta del mercado`);
  }
}

/** Error que se puede enseñar tal cual al jugador. */
export class UserError extends Error {}
