import { UNITS, UNIT_KEYS } from '../game/data.js';
import { assault, seatsOf, seatsUsed, splitForces } from '../game/combat.js';
import { unitIcon } from '../scene/portraits.js';
import { fmtDec, fmtNum } from './format.js';

// Simulador de combate, como el de OGame: repite la batalla muchas veces con
// las mismas reglas que el servidor y enseña qué suele pasar. Como los ataques
// de verdad, va en dos fases: primero las flotas y, con el mar libre, el desembarco.

const RUNS = 200;
const ATTACKERS = UNIT_KEYS.filter((id) => !UNITS[id].npc);
const DEFENDERS = UNIT_KEYS;

function inputs(prefix, ids, values) {
  return ids
    .map((id) => {
      const u = UNITS[id];
      return `<label title="${u.name}"><span class="u-cell">${unitIcon(id)} ${u.name}</span><input type="number" min="0" name="${prefix}-${id}" value="${values[id] ?? ''}" placeholder="0" inputmode="numeric" /></label>`;
    })
    .join('');
}

/**
 * @param {{ attacker?: object, defender?: object, wall?: number, atkMul?: number, hpMul?: number, title?: string }} preset
 */
export function simulatorHtml(preset = {}) {
  return `<div class="modal-card wide">
    <div class="panel-head"><span class="panel-icon">🎲</span><div><h3>Simulador de combate</h3>
      <div class="panel-lvl">${preset.title ?? 'Prueba un ataque antes de mandarlo'}</div></div>
      <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
    <form class="sim" data-form="sim">
      <fieldset><legend>Atacante</legend>${inputs('a', ATTACKERS, preset.attacker ?? {})}
        <label><span>⚔️ Bono de ataque %</span><input type="number" name="a-atk" value="${Math.round(((preset.atkMul ?? 1) - 1) * 100)}" /></label>
        <label><span>❤️ Bono de vida %</span><input type="number" name="a-hp" value="${Math.round(((preset.hpMul ?? 1) - 1) * 100)}" /></label>
      </fieldset>
      <fieldset><legend>Defensor</legend>${inputs('d', DEFENDERS, preset.defender ?? {})}
        <label><span>🏰 Muralla / fortificación % (en tierra)</span><input type="number" name="d-wall" value="${Math.round((preset.wall ?? 0) * 100)}" /></label>
        <label><span>🏹 Daño de las torres (en tierra)</span><input type="number" name="d-towers" value="${preset.towers ?? 0}" /></label>
        <label><span>🗼 Faro: vida de sus barcos %</span><input type="number" name="d-naval" value="${Math.round((preset.naval ?? 0) * 100)}" /></label>
      </fieldset>
      <button class="primary">Simular ${RUNS} combates</button>
    </form>
    <div class="sim-result" data-sim-result></div>
  </div>`;
}

/** Lee el formulario, simula y pinta el resultado. */
export function runSimulation(form) {
  const data = Object.fromEntries(new FormData(form));
  const pick = (prefix, ids) => {
    const out = {};
    for (const id of ids) {
      const n = Math.floor(Number(data[`${prefix}-${id}`]) || 0);
      if (n > 0) out[id] = n;
    }
    return out;
  };
  const attacker = pick('a', ATTACKERS);
  const defender = pick('d', DEFENDERS);
  const out = form.closest('.modal-card').querySelector('[data-sim-result]');
  if (!Object.keys(attacker).length) {
    out.innerHTML = '<p class="hint warn">Pon alguna tropa en el atacante.</p>';
    return;
  }
  // Como al zarpar: las tropas tienen que caber en los barcos
  const { sea, land } = splitForces(attacker);
  if (seatsUsed(land) > seatsOf(sea)) {
    out.innerHTML = `<p class="hint warn">Faltan plazas en los barcos: ${seatsUsed(land)}/${seatsOf(sea)}. Añade mercantes o barcos de guerra.</p>`;
    return;
  }
  const att = { units: attacker, atkMul: 1 + (Number(data['a-atk']) || 0) / 100, hpMul: 1 + (Number(data['a-hp']) || 0) / 100 };
  const def = {
    units: defender,
    wallHp: (Number(data['d-wall']) || 0) / 100,
    extraAtk: Number(data['d-towers']) || 0,
    navalHpMul: (Number(data['d-naval']) || 0) / 100,
  };
  // Contra una ciudad hace falta desembarcar para ganar
  const city = !Object.keys(defender).some((id) => UNITS[id].npc);

  const wins = { att: 0, def: 0, draw: 0 };
  const lostA = {};
  const lostD = {};
  let rounds = 0;
  let seaWins = 0;
  let naval = 0;
  let drowned = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = assault(att, def, { needLanding: city });
    wins[r.winner]++;
    rounds += r.rounds;
    if (r.naval) naval++;
    if (r.seaWon) seaWins++;
    drowned += Object.values(r.drowned).reduce((a, b) => a + b, 0);
    for (const [id, n] of Object.entries(r.att.lost)) lostA[id] = (lostA[id] ?? 0) + n;
    for (const [id, n] of Object.entries(r.def.lost)) lostD[id] = (lostD[id] ?? 0) + n;
  }
  const pct = (n) => `${Math.round((n / RUNS) * 100)} %`;
  const table = (start, lost) =>
    Object.entries(start)
      .map(([id, n]) => {
        const avg = (lost[id] ?? 0) / RUNS;
        return `<tr><td class="u-cell">${unitIcon(id)} ${UNITS[id].name}</td><td>${fmtNum(n)}</td><td class="${avg ? 'bad' : ''}">−${fmtDec(avg)}</td></tr>`;
      })
      .join('') || '<tr><td colspan="3" class="muted">Nadie</td></tr>';
  out.innerHTML = `
    <div class="sim-odds">
      <div class="win"><b>${pct(wins.att)}</b><span>gana el atacante</span></div>
      <div><b>${pct(wins.draw)}</b><span>retirada</span></div>
      <div class="lose"><b>${pct(wins.def)}</b><span>gana el defensor</span></div>
    </div>
    <p class="muted small">${naval ? `⚓ El atacante se hace con el mar en el ${pct(seaWins)} de las batallas navales.` : '⚓ No hay batalla naval: el defensor no tiene barcos de guerra.'}${drowned ? ` 🌊 De media se ahogan ${fmtDec(drowned / RUNS)} soldados al hundirse sus barcos.` : ''}</p>
    <p class="muted small">De media, ${fmtDec(rounds / RUNS)} asaltos en total. Bajas medias:</p>
    <div class="battle">
      <div class="side"><h5>Atacante</h5><table><thead><tr><th></th><th>Tropas</th><th>Bajas</th></tr></thead><tbody>${table(attacker, lostA)}</tbody></table></div>
      <div class="side"><h5>Defensor</h5><table><thead><tr><th></th><th>Tropas</th><th>Bajas</th></tr></thead><tbody>${table(defender, lostD)}</tbody></table></div>
    </div>`;
}
