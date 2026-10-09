import { UNITS } from './data.js';

// Combate por asaltos, al estilo OGame. Cada asalto los dos bandos disparan a la
// vez; el daño se reparte entre los tipos de unidad según su vida total. Las
// unidades sin ataque (mercantes, botes) no combaten: solo reciben daño cuando
// ya no queda ninguna unidad de combate en su bando.
//
// Un ataque por mar (`assault`) va en dos fases, como en Ikariam: primero luchan
// las flotas y, solo si el atacante se hace con el mar, desembarcan las tropas.

const MAX_ROUNDS = 6;

/**
 * @typedef {{ units: Record<string, number>, atkMul?: number, hpMul?: number, extraAtk?: number }} Side
 * @returns {{ winner: 'att'|'def'|'draw', rounds: number,
 *   att: { start: object, left: object, lost: object }, def: { start: object, left: object, lost: object } }}
 */
export function battle(attacker, defender, rand = Math.random) {
  const att = prepare(attacker);
  const def = prepare(defender);
  let rounds = 0;
  const log = []; // lo que queda de cada bando tras cada asalto (para las repeticiones)
  while (rounds < MAX_ROUNDS && count(att.left) > 0 && (count(def.left) > 0 || def.extraAtk > 0)) {
    rounds++;
    const toDef = damage(att, rand);
    const toAtt = damage(def, rand);
    hit(def, toDef, rand);
    hit(att, toAtt, rand);
    log.push({ att: { ...att.left }, def: { ...def.left } });
  }
  let winner = 'draw';
  if (!hasCombat(att.left)) winner = 'def';
  else if (count(def.left) === 0) winner = 'att';
  return { winner, rounds, att: summary(att), def: summary(def), log };
}

function prepare(side) {
  const start = {};
  for (const [id, n] of Object.entries(side.units)) if (n > 0) start[id] = Math.floor(n);
  return { start, left: { ...start }, atkMul: side.atkMul ?? 1, hpMul: side.hpMul ?? 1, extraAtk: side.extraAtk ?? 0 };
}

function summary(side) {
  const lost = {};
  for (const [id, n] of Object.entries(side.start)) {
    const d = n - (side.left[id] ?? 0);
    if (d > 0) lost[id] = d;
  }
  return { start: side.start, left: side.left, lost };
}

export function count(units) {
  return Object.values(units).reduce((s, n) => s + n, 0);
}

export function hasCombat(units) {
  return Object.entries(units).some(([id, n]) => n > 0 && UNITS[id].atk > 0);
}

/** Poder de ataque por asalto (sin azar), útil para estimaciones. */
export function power(units, atkMul = 1) {
  let p = 0;
  for (const [id, n] of Object.entries(units)) p += n * UNITS[id].atk * atkMul;
  return p;
}

function damage(side, rand) {
  return (power(side.left, side.atkMul) + side.extraAtk) * (0.9 + rand() * 0.2);
}

function hit(side, dmg, rand) {
  const alive = Object.entries(side.left).filter(([, n]) => n > 0);
  let targets = alive.filter(([id]) => UNITS[id].atk > 0);
  if (!targets.length) targets = alive;
  const hp = (id) => UNITS[id].hp * side.hpMul;
  const total = targets.reduce((s, [id, n]) => s + n * hp(id), 0);
  if (total <= 0) return;
  for (const [id, n] of targets) {
    const exact = (dmg * (n * hp(id))) / total / hp(id);
    let kills = Math.floor(exact);
    if (rand() < exact - kills) kills++;
    side.left[id] = Math.max(0, n - kills);
  }
}

// ── Ataque por mar: batalla naval y desembarco ───────────────────────────────

/** Fracción del ataque de los barcos que quedan a flote que bombardea la costa. */
export const NAVAL_SUPPORT = 0.25;

const isShip = (id) => UNITS[id].kind === 'barco';

/** Separa los barcos de las tropas de tierra. */
export function splitForces(units) {
  const sea = {};
  const land = {};
  for (const [id, n] of Object.entries(units ?? {})) if (n > 0) (isShip(id) ? sea : land)[id] = Math.floor(n);
  return { sea, land };
}

/** Plazas para tropas que ofrecen los barcos. */
export function seatsOf(ships) {
  return Object.entries(ships).reduce((s, [id, n]) => s + n * (UNITS[id].capacity ?? 0), 0);
}

/** Plazas que ocupan las tropas de tierra. */
export function seatsUsed(troops) {
  return Object.entries(troops).reduce((s, [id, n]) => s + n * (UNITS[id].size ?? 1), 0);
}

/** Tropas que caben en `seats` plazas; las que no, se hunden con los barcos (en proporción). */
export function keepAboard(troops, seats) {
  const used = seatsUsed(troops);
  if (used <= seats) return { aboard: { ...troops }, drowned: {} };
  const k = Math.max(0, seats) / used;
  const aboard = {};
  const drowned = {};
  for (const [id, n] of Object.entries(troops)) {
    aboard[id] = Math.floor(n * k);
    if (n - aboard[id] > 0) drowned[id] = n - aboard[id];
  }
  return { aboard, drowned };
}

function merge(...bags) {
  const out = {};
  for (const b of bags) for (const [id, n] of Object.entries(b ?? {})) if (n > 0) out[id] = (out[id] ?? 0) + n;
  return out;
}

function lossOf(start, left) {
  const lost = {};
  for (const [id, n] of Object.entries(start)) if (n - (left[id] ?? 0) > 0) lost[id] = n - (left[id] ?? 0);
  return lost;
}

/**
 * Ataque por mar en dos fases.
 *
 * 1. Batalla naval: los barcos del atacante contra los del defensor (solo si el defensor tiene
 *    barcos de guerra). Si se hunden barcos y las tropas ya no caben a bordo, las que sobran se
 *    hunden con ellos. Si el defensor sigue teniendo barcos de guerra, no se puede desembarcar.
 * 2. Desembarco: con el mar libre, las tropas de tierra luchan contra las del defensor, con su
 *    muralla y sus torres; los barcos de guerra que quedan apoyan bombardeando la costa.
 *
 * `attacker`: { units, atkMul, hpMul }. `defender`: { units, atkMul, hpMul, navalHpMul, wallHp,
 * extraAtk } (`hpMul` vale para las dos fases; la muralla `wallHp` y las torres `extraAtk`, solo
 * en tierra; `navalHpMul`, solo en el mar).
 *
 * Con `needLanding`, el atacante solo gana si desembarca (para saquear una ciudad hacen falta
 * tropas en tierra); sin él, ganar el mar basta si el defensor no tiene a nadie en tierra.
 *
 * Devuelve lo mismo que `battle` (con el resumen de las dos fases juntas, ahogados incluidos en
 * las bajas del atacante) y además `naval`, `land`, `drowned`, `seaWon` y `landed`.
 */
export function assault(attacker, defender, { rand = Math.random, needLanding = false } = {}) {
  const A = splitForces(attacker.units);
  const D = splitForces(defender.units);
  const atkMul = attacker.atkMul ?? 1;
  const hpMul = attacker.hpMul ?? 1;
  const dAtk = defender.atkMul ?? 1;
  const dHp = defender.hpMul ?? 1;

  // 1. En el mar
  let naval = null;
  let seaLeft = { ...A.sea };
  let dSeaLeft = { ...D.sea };
  if (hasCombat(D.sea)) {
    naval = battle(
      { units: A.sea, atkMul, hpMul },
      { units: D.sea, atkMul: dAtk, hpMul: dHp + (defender.navalHpMul ?? 0) },
      rand,
    );
    seaLeft = naval.att.left;
    dSeaLeft = naval.def.left;
  }
  const seaWon = !hasCombat(dSeaLeft);
  const { aboard, drowned } = keepAboard(A.land, seatsOf(seaLeft));

  // 2. En tierra
  let land = null;
  let landLeft = aboard;
  let dLandLeft = { ...D.land };
  const landed = seaWon && count(aboard) > 0;
  if (landed && count(D.land) > 0) {
    const support = power(seaLeft, atkMul) * NAVAL_SUPPORT;
    land = battle(
      { units: aboard, atkMul, hpMul, extraAtk: support },
      { units: D.land, atkMul: dAtk, hpMul: dHp + (defender.wallHp ?? 0), extraAtk: defender.extraAtk ?? 0 },
      rand,
    );
    landLeft = land.att.left;
    dLandLeft = land.def.left;
  }

  let winner;
  if (!seaWon) winner = naval?.winner === 'def' ? 'def' : 'draw';
  else if (landed) winner = land ? land.winner : 'att';
  else winner = count(D.land) > 0 || needLanding ? 'draw' : 'att';

  const aStart = merge(A.sea, A.land);
  const dStart = merge(D.sea, D.land);
  const aLeft = merge(seaLeft, landLeft);
  const dLeft = merge(dSeaLeft, dLandLeft);
  return {
    winner,
    rounds: (naval?.rounds ?? 0) + (land?.rounds ?? 0),
    att: { start: aStart, left: aLeft, lost: lossOf(aStart, aLeft) },
    def: { start: dStart, left: dLeft, lost: lossOf(dStart, dLeft) },
    log: [],
    naval,
    land,
    drowned,
    seaWon,
    landed,
  };
}
