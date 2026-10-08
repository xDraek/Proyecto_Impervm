import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { universe } from '../src/config.js';
import { BUILDINGS, HERO_SKILLS, MISSION_TYPES, PLAYER_UNITS, POWERS, RESEARCH, RESOURCES, UNITS } from '../src/game/data.js';
import { readToken, signToken } from './auth.js';
import { openStore } from './store.js';
import { UserError, WorldServer } from './WorldServer.js';

// Servidor de Imperium: API JSON + archivos del juego.
//   npm run dev   → con Vite integrado (recarga en caliente) y datos en server/data/
//   npm start     → producción: sirve dist/ y usa Postgres si hay DATABASE_URL
//
// Variables de entorno: PORT, DATABASE_URL, AUTH_SECRET, GAME_SPEED, ADMINS (moderadores),
// DATA_FILE (archivo local).

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEV = process.argv.includes('--dev');
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT) || (DEV ? 5173 : 8080);
universe.speed = Math.max(1, Number(process.env.GAME_SPEED) || 1);

const store = await openStore({ databaseUrl: process.env.DATABASE_URL, file: process.env.DATA_FILE || join(ROOT, 'server', 'data', 'world.json') });
const world = new WorldServer(store);
await world.load();
if (!process.env.AUTH_SECRET && store.kind === 'postgres') {
  console.warn('Aviso: define AUTH_SECRET para que las sesiones no dependan del secreto guardado en la base de datos.');
}

// El mundo sigue vivo aunque nadie esté conectado
setInterval(() => {
  world.tick();
  world.flushPush();
}, 1000);
let saving = false;
setInterval(async () => {
  if (saving) return;
  saving = true;
  try {
    await world.persist();
  } catch (err) {
    console.error('Error al guardar:', err);
  } finally {
    saving = false;
  }
}, 10_000);

// ── Acciones permitidas ───────────────────────────────────────────────────────
// Nunca se llama a un método de Game con argumentos del cliente sin revisarlos:
// por ejemplo, el último parámetro de casi todos es la hora, y eso lo pone el servidor.

const own = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const int = (v) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : NaN);
function units(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of PLAYER_UNITS) {
    const n = int(raw[id]);
    if (n > 0) out[id] = n;
  }
  return out;
}
function resources(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const res of Object.keys(RESOURCES)) {
    const n = int(raw[res]);
    if (n > 0) out[res] = n;
  }
  return out;
}
const bad = () => ({ ok: false, reason: 'Petición no válida.' });

const ACTIONS = {
  upgrade: (g, [id]) => (own(BUILDINGS, id) ? g.upgrade(id) : bad()),
  cancel: (g) => g.cancel(),
  research: (g, [id]) => (own(RESEARCH, id) ? g.research(id) : bad()),
  cancelResearch: (g) => g.cancelResearch(),
  train: (g, [id, n]) => (own(UNITS, id) ? g.train(id, int(n)) : bad()),
  cancelTraining: (g, [b, i]) => ((b === 'cuartel' || b === 'puerto') && int(i) >= 0 ? g.cancelTraining(b, int(i)) : bad()),
  trade: (g, [from, to, n]) => (own(RESOURCES, from) && own(RESOURCES, to) ? g.trade(from, to, int(n)) : bad()),
  sendMission: (g, [type, target, u, load, opts]) =>
    own(MISSION_TYPES, type) && typeof target === 'string'
      ? g.sendMission(type, target, units(u), resources(load), { hero: opts?.hero === true, join: typeof opts?.join === 'string' && opts.join.length < 40 ? opts.join : undefined })
      : bad(),
  hireHero: (g, [name]) => g.hireHero(typeof name === 'string' ? name : ''),
  heroSkill: (g, [skill]) => (own(HERO_SKILLS, skill) ? g.heroSkill(skill) : bad()),
  recall: (g, [id]) => g.recall(int(id)),
  claimQuest: (g, [id]) => (typeof id === 'string' ? g.claimQuest(id) : bad()),
  claimDaily: (g) => g.claimDaily(),
  claimTask: (g, [id]) => (typeof id === 'string' ? g.claimTask(id) : bad()),
  castPower: (g, [id]) => (own(POWERS, id) ? g.castPower(id) : bad()),
  acceptVisitor: (g) => g.acceptVisitor(),
  dismissVisitor: (g) => g.dismissVisitor(),
  markReportsRead: (g) => g.markReportsRead(),
  upgradeColony: (g, [id]) => (typeof id === 'string' ? g.upgradeColony(id) : bad()),
  hireMercenaries: (g, [id]) => (typeof id === 'string' ? g.hireMercenaries(id) : bad()),
  setTitle: (g, [id]) => (typeof id === 'string' ? g.setTitle(id) : bad()),
  setBanner: (g, [color, emblem]) => (typeof color === 'string' && typeof emblem === 'string' ? g.setBanner(color, emblem) : bad()),
  equipRelic: (g, [id, on]) => (typeof id === 'string' ? g.equipRelic(id, on === true) : bad()),
  sellRelic: (g, [id]) => (typeof id === 'string' ? g.sellRelic(id) : bad()),
  donateWonder: (g, [id, bag]) => (typeof id === 'string' ? g.donateWonder(id, resources(bag)) : bad()),
  startVacation: (g) => g.startVacation(),
  endVacation: (g) => g.endVacation(),
};

/** De vacaciones solo se puede volver, recoger cosas y deshacer lo que estaba en marcha. */
const VACATION_OK = new Set(['endVacation', 'markReportsRead', 'claimQuest', 'claimDaily', 'cancel', 'cancelResearch', 'cancelTraining', 'dismissVisitor']);

// ── Límites de peticiones ─────────────────────────────────────────────────────

const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  b.n++;
  return b.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000);

// ── HTTP ──────────────────────────────────────────────────────────────────────

/** Qué compresión acepta el navegador ('br', 'gzip' o null). */
function encodingFor(req) {
  const accept = String(req?.headers['accept-encoding'] ?? '')
    .split(',')
    .map((s) => s.trim().split(';')[0]);
  return accept.includes('br') ? 'br' : accept.includes('gzip') ? 'gzip' : null;
}

function compress(data, encoding, level = 'fast') {
  if (encoding === 'br') {
    return brotliCompressSync(data, { params: { [zlib.BROTLI_PARAM_QUALITY]: level === 'fast' ? 4 : 11, [zlib.BROTLI_PARAM_SIZE_HINT]: data.length } });
  }
  return gzipSync(data, { level: level === 'fast' ? 5 : 9 });
}

function send(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'accept-encoding' };
  // El estado de la partida pesa decenas de KB: comprimido, unas pocas
  const encoding = data.length > 1024 ? encodingFor(res.req) : null;
  if (encoding) {
    res.writeHead(status, { ...headers, 'content-encoding': encoding });
    return res.end(compress(data, encoding));
  }
  res.writeHead(status, headers);
  res.end(data);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new UserError('Petición demasiado grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new UserError('JSON no válido.');
  }
}

function authUser(req) {
  const header = req.headers.authorization ?? '';
  const uid = readToken(header.replace(/^Bearer /, ''), world.secret);
  if (uid == null || !world.games.has(uid) || world.isBanned(uid)) return null;
  world.seen(uid);
  return uid;
}

const ip = (req) => (req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? '').trim();

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /api/stats') return send(res, 200, world.stats());

    if (route === 'POST /api/register' || route === 'POST /api/login') {
      if (limited(`auth:${ip(req)}`, 10, 60_000)) return send(res, 429, { error: 'Demasiados intentos. Espera un minuto.' });
      const body = await readJson(req);
      const registering = route === 'POST /api/register';
      const uid = registering ? await world.register(body.username, body.password, body.city) : world.login(body.username, body.password);
      world.seen(uid);
      // Al crear la cuenta se entrega el código de recuperación (solo esta vez)
      const recovery = registering ? await world.issueRecovery(uid) : undefined;
      return send(res, 200, { token: signToken(uid, world.secret), recovery });
    }
    if (route === 'POST /api/recover') {
      if (limited(`auth:${ip(req)}`, 10, 60_000)) return send(res, 429, { error: 'Demasiados intentos. Espera un minuto.' });
      const body = await readJson(req);
      const { id, recovery } = await world.recover(body.username, body.code, body.password);
      world.seen(id);
      return send(res, 200, { token: signToken(id, world.secret), recovery });
    }

    const uid = authUser(req);
    if (uid == null) return send(res, 401, { error: 'Tienes que iniciar sesión.' });

    if (route === 'GET /api/state') return send(res, 200, world.snapshot(uid));

    if (route === 'POST /api/action') {
      if (limited(`act:${uid}`, 40, 10_000)) return send(res, 429, { error: 'Vas demasiado rápido.' });
      const { action, args } = await readJson(req);
      const handler = own(ACTIONS, action) ? ACTIONS[action] : null;
      if (!handler) return send(res, 400, { error: 'Acción desconocida.' });
      const game = world.games.get(uid);
      const result =
        game.state.vacation && !VACATION_OK.has(action)
          ? { ok: false, reason: '🏖️ Estás de vacaciones: vuelve al juego desde ⚙ para hacer eso.' }
          : handler(game, Array.isArray(args) ? args : []);
      // Si va hacia otra ciudad, que su dueño lo vea llegar al momento
      if (action === 'sendMission' && result?.ok) {
        const owner = world.island(String(args[1]))?.owner;
        if (owner != null) world.pendingPush.add(owner);
        // Quien dirige un ataque se entera de que un aliado se une, y la alianza ve el ataque al momento
        const joined = args[4]?.join ? world.jointAttack(args[4].join) : null;
        if (joined) world.hostNews(joined.leaderId, `🤝 ${game.name} se une a tu ataque contra ${joined.targetName}`);
        for (const member of world.allianceOf(uid)?.members ?? []) world.pendingPush.add(member);
      }
      const snapshot = world.snapshot(uid);
      world.pendingPush.delete(uid); // ya lo recibe en la respuesta
      return send(res, 200, { result, snapshot });
    }

    if (route === 'GET /api/ranking') return send(res, 200, { ...world.ranking(uid), contest: world.contestView(uid) });
    if (route === 'GET /api/map') return send(res, 200, world.worldMap(uid));

    if (route === 'GET /api/chat') return send(res, 200, { messages: world.chatSince(uid, int(url.searchParams.get('after')) || 0) });
    if (route === 'POST /api/chat/share') {
      if (limited(`chat:${uid}`, 5, 10_000)) return send(res, 429, { error: 'Espera un poco antes de escribir otra vez.' });
      const { t, channel } = await readJson(req);
      return send(res, 200, { message: world.shareReport(uid, Number(t), channel) });
    }
    if (route === 'POST /api/chat') {
      if (limited(`chat:${uid}`, 5, 10_000)) return send(res, 429, { error: 'Espera un poco antes de escribir otra vez.' });
      const { text, channel } = await readJson(req);
      return send(res, 200, { message: world.addChat(uid, text, channel) });
    }

    // Moderación
    if (req.method === 'POST' && url.pathname.startsWith('/api/admin/')) {
      const body = await readJson(req);
      const sub = url.pathname.slice('/api/admin/'.length);
      if (sub === 'mute') world.mute(uid, body.name, body.minutes);
      else if (sub === 'ban') world.ban(uid, body.name, body.reason, true);
      else if (sub === 'unban') world.ban(uid, body.name, '', false);
      else if (sub === 'delete-chat') world.deleteChat(uid, body.id);
      else if (sub === 'broadcast') world.broadcast(uid, body.text);
      else if (sub === 'reset') return send(res, 200, { password: await world.adminResetPassword(uid, body.name) });
      else return send(res, 404, { error: 'No existe.' });
      return send(res, 200, { ok: true });
    }

    // Perfil y cuenta
    if (route === 'GET /api/profile') return send(res, 200, { profile: world.profile(url.searchParams.get('name')) });
    if (route === 'POST /api/city') {
      const { name } = await readJson(req);
      world.renameCity(uid, name);
      return send(res, 200, { snapshot: world.snapshot(uid) });
    }
    if (route === 'POST /api/recovery') {
      if (limited(`auth:${ip(req)}`, 10, 60_000)) return send(res, 429, { error: 'Demasiados intentos. Espera un minuto.' });
      const { password } = await readJson(req);
      return send(res, 200, { recovery: await world.regenerateRecovery(uid, password) });
    }
    if (route === 'POST /api/password') {
      if (limited(`auth:${ip(req)}`, 10, 60_000)) return send(res, 429, { error: 'Demasiados intentos. Espera un minuto.' });
      const { current, next } = await readJson(req);
      await world.changePassword(uid, current, next);
      return send(res, 200, { ok: true });
    }

    // Alianzas
    if (route === 'GET /api/alliances') return send(res, 200, { alliances: world.allianceList(uid) });
    if (route === 'GET /api/alliance') return send(res, 200, { alliance: world.allianceDetail(uid) });
    if (req.method === 'POST' && url.pathname.startsWith('/api/alliance')) {
      if (limited(`social:${uid}`, 20, 10_000)) return send(res, 429, { error: 'Vas demasiado rápido.' });
      const body = await readJson(req);
      const sub = url.pathname.slice('/api/alliance'.length);
      if (sub === '') world.createAlliance(uid, body.name, body.tag);
      else if (sub === '/join') world.requestJoin(uid, int(body.id), body.text);
      else if (sub === '/cancel') world.cancelApplication(uid, int(body.id));
      else if (sub === '/answer') world.answerApplication(uid, int(body.userId), body.accept === true);
      else if (sub === '/officer') world.setOfficer(uid, int(body.userId), body.on === true);
      else if (sub === '/transfer') world.transferLeadership(uid, int(body.userId));
      else if (sub === '/open') world.setAllianceOpen(uid, body.open === true);
      else if (sub === '/leave') world.leaveAlliance(uid);
      else if (sub === '/kick') world.kickMember(uid, int(body.userId));
      else if (sub === '/description') world.describeAlliance(uid, body.text);
      else if (sub === '/diplomacy') world.diplomacy(uid, int(body.id), String(body.op ?? ''));
      else if (sub === '/circular') {
        if (limited(`mail:${uid}`, 5, 60_000)) return send(res, 429, { error: 'Has mandado muchos mensajes seguidos. Espera un minuto.' });
        world.allianceCircular(uid, body.subject, body.text);
      }
      else return send(res, 404, { error: 'No existe.' });
      return send(res, 200, { alliance: world.allianceDetail(uid), snapshot: world.snapshot(uid) });
    }

    // Foro de la alianza
    if (route === 'GET /api/forum') return send(res, 200, world.forumList(uid));
    if (route === 'GET /api/forum/thread') return send(res, 200, { thread: world.forumThread(uid, int(url.searchParams.get('id'))), snapshot: world.snapshot(uid) });
    if (req.method === 'POST' && url.pathname.startsWith('/api/forum')) {
      const body = await readJson(req);
      const sub = url.pathname.slice('/api/forum'.length);
      if (sub === '' || sub === '/reply') {
        if (limited(`forum:${uid}`, 6, 60_000)) return send(res, 429, { error: 'Escribes muy deprisa. Espera un minuto.' });
        const thread = world.forumPost(uid, sub === '' ? null : int(body.id), body.title, body.text);
        return send(res, 200, { thread, snapshot: world.snapshot(uid) });
      }
      if (sub === '/pin' || sub === '/delete') {
        world.forumModerate(uid, int(body.id), sub.slice(1));
        return send(res, 200, world.forumList(uid));
      }
      return send(res, 404, { error: 'No existe.' });
    }

    // Correo
    if (route === 'GET /api/mail') return send(res, 200, { mail: world.mailbox(uid) });
    if (route === 'POST /api/mail') {
      if (limited(`mail:${uid}`, 5, 60_000)) return send(res, 429, { error: 'Has mandado muchos mensajes seguidos. Espera un minuto.' });
      const { to, subject, text } = await readJson(req);
      world.sendMail(uid, to, subject, text);
      return send(res, 200, { mail: world.mailbox(uid) });
    }
    if (route === 'POST /api/mail/read' || route === 'POST /api/mail/delete') {
      const { id } = await readJson(req);
      if (route.endsWith('read')) world.readMail(uid, id === 'all' ? 'all' : int(id));
      else world.deleteMail(uid, int(id));
      return send(res, 200, { mail: world.mailbox(uid) });
    }

    // Mercado del archipiélago
    if (route === 'GET /api/market') return send(res, 200, { offers: world.listOffers(uid) });
    if (req.method === 'POST' && url.pathname.startsWith('/api/market')) {
      if (limited(`social:${uid}`, 20, 10_000)) return send(res, 429, { error: 'Vas demasiado rápido.' });
      const body = await readJson(req);
      const sub = url.pathname.slice('/api/market'.length);
      if (sub === '') world.postOffer(uid, body.give, body.want);
      else if (sub === '/accept') world.acceptOffer(uid, int(body.id));
      else if (sub === '/cancel') world.cancelOffer(uid, int(body.id));
      else return send(res, 404, { error: 'No existe.' });
      return send(res, 200, { offers: world.listOffers(uid), snapshot: world.snapshot(uid) });
    }

    return send(res, 404, { error: 'No existe.' });
  } catch (err) {
    if (err instanceof UserError) return send(res, 400, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Error del servidor.' });
  }
}

// ── Archivos del juego (producción) ───────────────────────────────────────────

const DIST = join(ROOT, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, url) {
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'No.' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html'); // la página es una sola
  }
  try {
    await stat(file);
  } catch {
    res.writeHead(404);
    return res.end('Falta compilar el juego: npm run build');
  }
  const immutable = file.includes(`${join('dist', 'assets')}`);
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', vary: 'accept-encoding' };
  // Código, estilos y la página se mandan comprimidos (se comprimen una vez y se guardan)
  const encoding = /javascript|css|html|json|svg/.test(type) ? encodingFor(req) : null;
  if (encoding) {
    const key = `${encoding}:${file}`;
    if (!compressed.has(key)) compressed.set(key, compress(await readFile(file), encoding, 'max'));
    res.writeHead(200, { ...headers, 'content-encoding': encoding });
    return res.end(compressed.get(key));
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

const compressed = new Map();

let vite = null;
if (DEV) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  if (vite) return vite.middlewares(req, res);
  return serveStatic(req, res, url);
});

// Conexión en vivo: el servidor empuja estados y mensajes del chat al momento
// Los mensajes grandes (el estado de la partida) van comprimidos si el navegador lo admite
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: { threshold: 2048 } });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return; // otras conexiones (p. ej. la recarga de Vite) no son nuestras
  const uid = readToken(url.searchParams.get('token'), world.secret);
  if (uid == null || !world.games.has(uid) || world.isBanned(uid)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    world.addSocket(uid, ws);
    world.seen(uid);
    ws.alive = true;
    ws.on('pong', () => {
      ws.alive = true;
      world.seen(uid);
    });
    ws.on('message', () => {}); // el cliente no manda nada por aquí: las acciones van por la API
    ws.on('close', () => world.removeSocket(uid, ws));
  });
});
// Latido: cierra las conexiones muertas
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) ws.terminate();
    else {
      ws.alive = false;
      ws.ping();
    }
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`Imperium en http://localhost:${PORT} · datos: ${store.kind} · velocidad ×${universe.speed} · ${world.users.size} jugadores`);
});

async function shutdown() {
  console.log('Guardando el mundo…');
  try {
    await world.persist(true);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
