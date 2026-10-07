// Copia en el navegador de la parte del mundo que ve el jugador (la manda el
// servidor en cada estado). Tiene la misma interfaz `world` que usa Game.

export class ClientWorld {
  constructor() {
    this.islandMap = new Map();
    this.states = {};
    this.players = {};
    this.version = 0;
  }

  /** Actualiza con los datos del servidor. Devuelve si ha cambiado el conjunto de islas. */
  apply({ islands, states, players }) {
    const before = [...this.islandMap.keys()].sort().join();
    this.islandMap = new Map(islands.map((i) => [i.id, i]));
    this.states = states;
    this.players = players;
    const changed = [...this.islandMap.keys()].sort().join() !== before;
    if (changed) this.version++;
    return changed;
  }

  island(id) {
    return this.islandMap.get(id) ?? null;
  }

  islandState(id) {
    return this.states[id] ?? null;
  }

  playerInfo(userId) {
    return this.players[userId] ?? null;
  }

  /** Relación con otro jugador tal como la calcula el servidor ('aliado', 'pacto', 'guerra' o null). */
  relation(_me, other) {
    return this.players[other]?.rel ?? null;
  }

  sameAlliance(me, other) {
    return this.relation(me, other) === 'aliado';
  }

  islands() {
    return [...this.islandMap.values()];
  }

  islandsNear(homeId, radius) {
    const home = this.island(homeId);
    if (!home) return [];
    return this.islands()
      .map((i) => ({ ...i, d: Math.hypot(i.x - home.x, i.z - home.z) }))
      .filter((i) => i.d <= radius)
      .sort((a, b) => a.d - b.d);
  }
}
