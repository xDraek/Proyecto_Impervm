import { clock } from '../src/config.js';
import { WorldServer } from '../server/WorldServer.js';

// Ayudas para probar las reglas sin navegador: un mundo en memoria con unos
// cuantos jugadores listos para la guerra y un reloj que se adelanta a mano.

/** Almacén que no guarda nada: el mundo vive solo en memoria. */
class MemoryStore {
  constructor() {
    this.next = 1;
  }
  async load() {
    return { meta: {}, users: [], players: {}, islands: [], islandStates: {}, chat: [] };
  }
  async createUser() {
    return this.next++;
  }
  async save() {}
  async updatePassword() {}
  async updateEmail() {}
}

const RICH = { madera: 50000, piedra: 50000, comida: 50000, hierro: 50000, cristal: 50000, oro: 50000 };

/**
 * Un mundo con los jugadores `names`: fuera de la protección de novato, con puerto, mercado y un
 * almacén grande, muchos recursos y sin piratas (ayuntamiento 2). Todos conocen las ciudades de
 * los demás. `advance(ms)` adelanta el reloj y da una vuelta al bucle del servidor.
 */
export async function makeWorld(names = ['Lucio', 'Anibal', 'Pericles']) {
  const world = new WorldServer(new MemoryStore());
  await world.load();
  const players = [];
  for (const name of names) {
    const id = await world.register(name, 'secreto1', `${name}polis`, { email: `${name.toLowerCase()}@prueba.es` });
    const g = world.games.get(id);
    g.state.stats.spent = 100_000;
    Object.assign(g.state.buildings, { ayuntamiento: 2, puerto: 10, mercado: 3, almacen: 10, cuartel: 5 });
    g.state.resources = { ...RICH };
    players.push(g);
  }
  for (const a of players) for (const b of players) if (a !== b) a.state.known[b.state.home] = { explored: true };
  const advance = (ms) => {
    clock.offset += ms;
    world.tick();
  };
  /** Adelanta hasta justo después del instante `t`. */
  const until = (t) => advance(Math.max(0, t - clock.now()) + 10);
  return { world, players, advance, until };
}

/** La última flota que ha mandado un jugador. */
export const lastMission = (game) => game.state.missions.at(-1);

/** Manda una flota y avanza hasta que llega. Devuelve la misión. */
export function sendAndArrive(env, game, type, target, units, opts = {}, payload = null) {
  const res = game.sendMission(type, target, units, payload, opts);
  if (!res.ok) throw new Error(`No se pudo mandar ${type}: ${res.reason}`);
  const m = lastMission(game);
  env.until(m.arrive);
  return m;
}

/** Las unidades sin las que ya no quedan. */
export const alive = (units) => Object.fromEntries(Object.entries(units).filter(([, n]) => n > 0));
