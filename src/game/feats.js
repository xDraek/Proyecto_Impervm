import { universe } from '../config.js';
import { FEATS, FEAT_THEMES, RESOURCES, RESOURCE_KEYS, UNITS } from './data.js';
import { economy, hash01, playerCombat, totalUnits } from './rules.js';

// Reglas puras de las Gestas de la Liga (eventos cooperativos). Las usan el
// servidor (WorldServer.#updateFeats, que convoca, resuelve las oleadas y paga)
// y el navegador (calendario y paneles). Nada de Three.js ni del DOM.

const HOUR = 3_600_000;
/** Horas de juego en milisegundos (con la velocidad del universo). */
export const featHours = (h) => (h * HOUR) / universe.speed;

// ── Calendario ───────────────────────────────────────────────────────────────
// Sale de la misma semilla que las temporadas, así que el servidor y el navegador
// saben siempre cuándo toca la próxima gesta.

export function featPeriod() {
  return Math.max(10 * 60_000, Math.round(featHours(FEATS.periodDays * 24)));
}

const themeIndex = (k, n) => Math.floor(hash01(universe.eventSeed ^ 0x7a1e5, k) * n);

/** El ciclo `k`: { k, theme, omen (presagios), start (lucha), end }. */
export function featCycle(k) {
  const offset = Math.floor(hash01(universe.eventSeed ^ 0x5eed, k) * featHours(FEATS.offsetHours));
  const omen = k * featPeriod() + offset;
  const start = omen + Math.round(featHours(FEATS.omenHours));
  const end = start + Math.round(featHours(FEATS.hours));
  // El tema no se repite dos veces seguidas (cuando haya más de uno)
  const keys = Object.keys(FEAT_THEMES);
  let i = themeIndex(k, keys.length);
  if (keys.length > 1 && i === themeIndex(k - 1, keys.length)) i = (i + 1) % keys.length;
  return { k, theme: keys[i], omen, start, end };
}

/** El ciclo en curso en el instante `t` o, si ya ha pasado, el siguiente. */
export function featAt(t) {
  const k = Math.floor(t / featPeriod());
  const c = featCycle(k);
  return t < c.end ? c : featCycle(k + 1);
}

/** En qué etapa está una gesta en `t`: 'calma', 'presagio', 'lucha' o 'fin'. */
export function featStage(f, t) {
  if (t < f.omen) return 'calma';
  if (t < f.start) return 'presagio';
  if (t < f.end) return 'lucha';
  return 'fin';
}

// ── Poder y coraza ───────────────────────────────────────────────────────────

/** Fuerza de combate de unas unidades: ataque más un tercio de la vida (solo las que combaten). */
export function forceOf(units, atkMul = 1, hpMul = 1) {
  let f = 0;
  for (const [id, n] of Object.entries(units ?? {})) {
    const u = UNITS[id];
    if (n > 0 && u?.atk > 0) f += n * (u.atk * atkMul + (u.hp * hpMul) / 3);
  }
  return f;
}

/** Parte de las unidades que combate en el mar (barcos de guerra) y en tierra. */
export function splitWar(units) {
  const sea = {};
  const land = {};
  for (const [id, n] of Object.entries(units ?? {})) {
    const u = UNITS[id];
    if (!(n > 0) || !(u?.atk > 0)) continue;
    (u.kind === 'barco' ? sea : land)[id] = n;
  }
  return { sea, land };
}

/**
 * Poder de un jugador al jurar: ataque y vida de sus barcos de guerra (AM, HM) y de su tierra
 * (AL, HL), con sus mejoras, contando lo que tiene en casa y en el mar pero no los mercenarios.
 */
export function featPower(state) {
  const { atkMul, hpMul } = playerCombat(state);
  const units = totalUnits(state);
  for (const c of state.mercs ?? []) units[c.unit] = Math.max(0, (units[c.unit] ?? 0) - c.count);
  const { sea, land } = splitWar(units);
  const sum = (u, key, mul) => Object.entries(u).reduce((a, [id, n]) => a + n * UNITS[id][key] * mul, 0);
  const P = { AM: sum(sea, 'atk', atkMul), HM: sum(sea, 'hp', hpMul), AL: sum(land, 'atk', atkMul), HL: sum(land, 'hp', hpMul) };
  P.f = P.AM + P.HM / 3 + P.AL + P.HL / 3;
  return P;
}

/**
 * Producción de referencia de un jugador (valor por hora y mezcla por recurso): la de sus
 * edificios, investigaciones y colonias con el Coloso, sin temporadas, poderes, reliquias ni
 * maravillas. Los premios se miden en horas de esto.
 */
export function featProd(state, t = state.lastUpdate) {
  const eco = economy(state, t);
  const k = 1 + 0.05 * (state.buildings?.coloso ?? 0);
  const raw = {};
  let value = 0;
  for (const res of RESOURCE_KEYS) {
    raw[res] = (eco.base[res] + eco.buildings[res] + eco.research[res] + eco.colonies[res] + (res === 'oro' ? eco.taxes : 0)) * k;
    value += raw[res] * RESOURCES[res].value;
  }
  const mix = {};
  for (const res of RESOURCE_KEYS) if (raw[res] > 0) mix[res] = (raw[res] * RESOURCES[res].value) / value;
  return { value, mix };
}

/** «Imperios efectivos» de unas fuerzas: (Σf)² / Σf². Cuatro iguales son 4; uno muy grande y otros pequeños, poco más de 1. */
export function effectiveEmpires(forces) {
  let s = 0;
  let q = 0;
  for (const f of forces) {
    if (!(f > 0)) continue;
    s += f;
    q += f * f;
  }
  return q ? (s * s) / q : 0;
}

/** Coraza: qué parte del daño llega al enemigo con N imperios efectivos (de 0 a 1). */
export function featCoop(N) {
  const pts = FEATS.coop;
  if (N <= pts[0][0]) return 0;
  if (N >= pts.at(-1)[0]) return pts.at(-1)[1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (N <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (N - x0)) / (x1 - x0);
    }
  }
  return 1;
}

/**
 * Poder de un grupo de jugadores con el tope «el resto»: nadie pesa más que todos los demás
 * juntos (en cada componente), para que una ballena no dispare la dificultad.
 */
export function capByRest(powers) {
  const out = { AM: 0, HM: 0, AL: 0, HL: 0, f: 0 };
  for (const key of ['AM', 'HM', 'AL', 'HL', 'f']) {
    const total = powers.reduce((a, p) => a + (p[key] ?? 0), 0);
    out[key] = powers.reduce((a, p) => a + Math.min(p[key] ?? 0, total - (p[key] ?? 0)), 0);
  }
  return out;
}

/** Imperios efectivos de un juramento (con el tope «el resto»). */
export function pledgeEmpires(powers) {
  const total = powers.reduce((a, p) => a + p.f, 0);
  return effectiveEmpires(powers.map((p) => Math.min(p.f, total - p.f)));
}

// ── El enemigo ───────────────────────────────────────────────────────────────

/**
 * El enemigo de una gesta según el poder jurado (ya con su tope) y el nivel del sitio: cuántos
 * hijos echa en cada fase y los multiplicadores de las cabezas.
 */
export function featBoss(themeId, P, tier = 0) {
  const T = FEAT_THEMES[themeId].tune;
  const k = 1 + FEATS.tierStep * tier;
  return {
    sierpe: Math.max(3, Math.round((k * T.sierpes * Math.max(P.AM, 0.08 * P.AL)) / UNITS.sierpe.hp)),
    gigante: Math.max(10, Math.round((k * T.gigantes * P.AL) / UNITS.gigante.hp)),
    cabeza: T.heads,
    headHp: Math.max(0.5, (k * T.headHp * P.AL) / 100_000),
    headAtk: Math.max(0.2, (k * T.headAtk * P.HL) / 10_000),
    lava: k * T.lava * P.HL,
  };
}

/** Las fases de un tema: [{ unit, name, text, glory }]. */
export const featPhases = (themeId) => FEAT_THEMES[themeId].phases;

/** Vida de una fase con `n` hijos (la real, sin la coraza). */
export function phaseLife(boss, unit, n) {
  return n * UNITS[unit].hp * (unit === 'cabeza' ? boss.headHp : 1);
}

/** Qué parte de la vida total le queda al enemigo (de 0 a 1). */
export function bossLeft(themeId, boss) {
  let left = 0;
  let full = 0;
  for (const p of featPhases(themeId)) {
    left += phaseLife(boss, p.unit, boss[p.unit] ?? 0);
    full += phaseLife(boss, p.unit, boss.full[p.unit]);
  }
  return full ? left / full : 0;
}

// ── Premios ──────────────────────────────────────────────────────────────────

/**
 * Lo que se lleva cada juramentado al acabar. `players`: { uid: { prod, f, brought, glory, risk } };
 * `result`: 'victoria', 'media' o 'derrota'; `phasesWon`: fases vencidas; `tier`: nivel del sitio.
 * Devuelve { uid: { band (-1 nada, 0 bronce, 1 plata, 2 oro), effort, share, personal, pot, value,
 * blessing, top, heart, relic } } con los premios en valor (se pagan con `rewardBag`).
 */
export function featRewards(players, { result, phasesWon = 0, tier = 0 }) {
  const R = FEATS.reward;
  const ids = Object.keys(players);
  const totalGlory = ids.reduce((a, id) => a + (players[id].glory ?? 0), 0);
  const won = result === 'victoria' || result === 'media';
  const scale = (1 + FEATS.rewardStep * tier) * (result === 'media' ? 0.5 : 1);
  const out = {};
  for (const id of ids) {
    const p = players[id];
    const effort = p.f > 0 ? (p.brought ?? 0) / p.f : 0;
    const share = totalGlory ? (p.glory ?? 0) / totalGlory : 0;
    let band = -1;
    if (share >= R.minGlory) for (let b = 0; b < R.effort.length; b++) if (effort >= R.effort[b]) band = b;
    out[id] = { band, effort, share, personal: 0, pot: 0, value: 0, blessing: 0, top: false, heart: false, relic: null };
  }
  // Distinciones: más gloria y mayor esfuerzo (con un mínimo de gloria)
  const byGlory = ids.filter((id) => out[id].band >= 0).sort((a, b) => out[b].share - out[a].share);
  const top = won ? byGlory[0] : null;
  const heart = won ? ids.filter((id) => id !== top && out[id].band >= 0 && out[id].share >= R.heartMinGlory).sort((a, b) => out[b].effort - out[a].effort)[0] : null;
  if (top) out[top].top = true;
  if (heart) out[heart].heart = true;
  // Botín personal: horas de tu producción según tu tramo, sin pasar de lo que arriesgaste
  if (won) {
    for (const id of ids) {
      const o = out[id];
      if (o.band < 0) continue;
      const hours = R.hours[o.band] * (o.top ? R.topBonus : 1);
      o.personal = Math.min(hours * players[id].prod, R.riskCap * (players[id].risk ?? 0)) * scale;
      if (o.band >= 1) o.blessing = result === 'media' ? R.blessingHours / 2 : R.blessingHours;
    }
  }
  // Bote común: horas de la producción de todos, repartido por gloria con un techo por cabeza
  const potShare = result === 'victoria' ? 1 : result === 'media' ? 0.5 : R.phasePot.slice(0, phasesWon).reduce((a, b) => a + b, 0);
  const pot = R.pot * ids.reduce((a, id) => a + players[id].prod, 0) * (1 + FEATS.rewardStep * tier) * potShare;
  const eligible = ids.filter((id) => out[id].band >= 0 && out[id].share > 0);
  let left = pot;
  let open = eligible.slice();
  // Se llena por gloria; lo que pasa del techo se reparte entre los demás
  for (let guard = 0; guard < 20 && left > 1e-6 && open.length; guard++) {
    const g = open.reduce((a, id) => a + out[id].share, 0);
    let spill = 0;
    const next = [];
    for (const id of open) {
      const want = (left * out[id].share) / g;
      const room = R.potCap * pot - out[id].pot;
      const give = Math.min(want, room);
      out[id].pot += give;
      spill += want - give;
      if (room - give > 1e-6) next.push(id);
    }
    left = spill;
    open = next;
  }
  // Reliquias: el primero y el corazón seguras; los demás, una probabilidad según su tramo
  for (const id of ids) {
    const o = out[id];
    o.value = o.personal + o.pot;
    if (!won || o.band < 0) continue;
    if (o.top || o.heart) o.relic = { legendaria: 100 };
    else if (result === 'victoria' && byGlory.indexOf(id) > 0 && byGlory.indexOf(id) <= 2) o.relic = { epica: 70, legendaria: 30 };
    else if (result === 'victoria') o.relic = { chance: R.relicChance[o.band], weights: { rara: 60, epica: 35, legendaria: 5 } };
  }
  return out;
}

/** Un premio en valor convertido en recursos: el 60 % en la mezcla de lo que produces y el 40 % en oro y cristal. */
export function rewardBag(value, mix) {
  const bag = {};
  const add = (res, v) => {
    const n = Math.floor(v / RESOURCES[res].value);
    if (n > 0) bag[res] = (bag[res] ?? 0) + n;
  };
  const keys = Object.keys(mix ?? {});
  if (keys.length) for (const res of keys) add(res, value * 0.6 * mix[res]);
  else add('madera', value * 0.6);
  add('oro', value * 0.2);
  add('cristal', value * 0.2);
  return bag;
}

/** Lo que valen unas unidades (su coste, con el valor de cada recurso): mide lo que arriesgas. */
export function unitsValue(units) {
  let v = 0;
  for (const [id, n] of Object.entries(units ?? {})) {
    if (!(n > 0)) continue;
    for (const [res, c] of Object.entries(UNITS[id]?.cost ?? {})) v += n * c * RESOURCES[res].value;
  }
  return v;
}
