import { UNITS } from './data.js';

// Combate por asaltos, al estilo OGame. Cada asalto los dos bandos disparan a la
// vez; el daño se reparte entre los tipos de unidad según su vida total. Las
// unidades sin ataque (mercantes, botes) no combaten: solo reciben daño cuando
// ya no queda ninguna unidad de combate en su bando.

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
