import { LAND_UNITS, MISSION_TYPES, SHIP_UNITS, UNITS } from '../game/data.js';
import { playerCombat } from '../game/rules.js';
import { unitIcon } from '../scene/portraits.js';
import { escapeHtml, fmtNum, unitList } from './format.js';

// Ventana del ejército: todo lo militar de un vistazo (tropas y barcos en casa,
// flotas en el mar, almirante, mercenarios y lo que se está entrenando).

/** Fuerza de un grupo de unidades con las mejoras del jugador. */
function strength(game, units) {
  const { atkMul, hpMul } = playerCombat(game.state);
  let atk = 0;
  let hp = 0;
  for (const [id, n] of Object.entries(units)) {
    atk += (UNITS[id]?.atk ?? 0) * n * atkMul;
    hp += (UNITS[id]?.hp ?? 0) * n * hpMul;
  }
  return { atk, hp };
}

function unitGrid(game, ids, empty, recruitIn) {
  const cards = ids
    .filter((id) => game.units[id] > 0)
    .map((id) => {
      const u = UNITS[id];
      return `<div class="army-card" title="${u.name}">
        ${unitIcon(id, 'army-art')}
        <div><b>${fmtNum(game.units[id])}</b><span>${u.name}</span><span class="muted small">⚔️ ${u.atk} · ❤️ ${u.hp}</span></div>
      </div>`;
    })
    .join('');
  return cards
    ? `<div class="army-grid">${cards}</div>`
    : `<p class="muted small">${empty} <button class="link small" data-select="${recruitIn}">Ir al ${recruitIn === 'cuartel' ? 'cuartel' : 'puerto'} →</button></p>`;
}

function fleetRows(game) {
  if (!game.missions.length) return '<p class="muted small">No tienes flotas en el mar.</p>';
  return game.missions
    .map((m) => {
      const t = MISSION_TYPES[m.type];
      const target = escapeHtml(m.targetName ?? game.world.island(m.target)?.name ?? '');
      let what;
      let when = '';
      let button = '';
      if (m.phase === 'estacionada') what = `🛡️ Defendiendo ${target}`;
      else if (m.phase === 'ida') {
        what = `${t.icon} ${t.name} · ${target}`;
        when = `llega en <span data-until="${m.arrive}"></span>`;
        button = `<button class="ghost small" data-action="recall" data-mission="${m.id}">Retirar</button>`;
      } else {
        what = `⚓ Vuelve de ${target}`;
        when = `en <span data-until="${m.back}"></span>`;
      }
      if (m.phase === 'estacionada') button = `<button class="ghost small" data-action="recall" data-mission="${m.id}">Retirar</button>`;
      return `<div class="fleet-line" data-select="${m.target}">
        <div><b>${what}${m.hero ? ' 🎖️' : ''}</b><div class="muted small">${unitList(m.units)}</div></div>
        <div class="fleet-when"><span class="small">${when}</span>${button}</div>
      </div>`;
    })
    .join('');
}

export function armyHtml(game) {
  const home = strength(game, game.units);
  const away = game.missions.reduce((acc, m) => {
    for (const [id, n] of Object.entries(m.units)) acc[id] = (acc[id] ?? 0) + n;
    return acc;
  }, {});
  const sea = strength(game, away);
  const land = LAND_UNITS.reduce((a, id) => a + (game.units[id] ?? 0), 0);
  const ships = SHIP_UNITS.reduce((a, id) => a + (game.units[id] ?? 0), 0);
  const eco = game.economy();

  // Almirante, mercenarios y entrenamiento
  const extras = [];
  const status = game.heroStatus();
  if (status) {
    const where = { casa: 'en casa', mision: 'con una flota', herido: 'herido, recuperándose' }[status];
    extras.push(`<div class="info-row" data-select="ayuntamiento"><span>🎖️ ${escapeHtml(game.hero.name)} · nivel ${game.hero.level}</span><b>${where}</b></div>`);
  }
  for (const c of game.state.mercs ?? []) {
    extras.push(`<div class="info-row" data-select="taberna"><span>⚔️ Mercenarios: ${fmtNum(c.count)} × ${UNITS[c.unit].name}</span><b>se van en <span data-until="${c.until}"></span></b></div>`);
  }
  for (const building of ['cuartel', 'puerto']) {
    const tq = game.training(building);
    if (!tq.length) continue;
    const left = tq.reduce((a, b) => a + b.count - (b.done ?? 0), 0);
    extras.push(`<div class="info-row" data-select="${building}"><span>🔨 Entrenando en el ${building}: ${fmtNum(left)} ${UNITS[tq[0].unit].name.toLowerCase()}${tq.length > 1 ? ' y más' : ''}</span><b><span data-until="${tq.at(-1).end}"></span></b></div>`);
  }

  return `<div class="modal-card wide army-modal">
    <div class="panel-head"><span class="panel-icon">⚔️</span><div><h3>Ejército</h3><div class="panel-lvl">Tus tropas, tus barcos y tus flotas</div></div>
      <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
    <div class="army-stats">
      <div><b>${fmtNum(home.atk)}</b><span>⚔️ Ataque en casa</span></div>
      <div><b>${fmtNum(home.hp)}</b><span>❤️ Vida en casa</span></div>
      <div><b>${fmtNum(sea.atk)}</b><span>⛵ Ataque en el mar</span></div>
      <div><b>${fmtNum(eco.upkeep)}/h</b><span>🥖 Comen</span></div>
    </div>
    <h4>🛡️ Tropas en casa · ${fmtNum(land)}</h4>
    ${unitGrid(game, LAND_UNITS, 'No tienes tropas en casa.', 'cuartel')}
    <h4>⚓ Barcos en el puerto · ${fmtNum(ships)}</h4>
    ${unitGrid(game, SHIP_UNITS, 'No tienes barcos en el puerto.', 'puerto')}
    <h4>🌊 Flotas en el mar · ${game.missions.length}/${game.fleetSlots()}</h4>
    <div class="fleet-lines">${fleetRows(game)}</div>
    ${extras.length ? `<h4>📋 Además</h4>${extras.join('')}` : ''}
    <div class="army-actions">
      <button class="ghost" data-select="cuartel">🛡️ Reclutar tropas</button>
      <button class="ghost" data-select="puerto">⚓ Construir barcos</button>
      <button class="ghost" data-action="army-sim">🎲 Simulador</button>
    </div>
  </div>`;
}

/** Resumen para lo alto de la barra lateral. */
export function armySummary(game) {
  const land = LAND_UNITS.reduce((a, id) => a + (game.units[id] ?? 0), 0);
  const ships = SHIP_UNITS.reduce((a, id) => a + (game.units[id] ?? 0), 0);
  const fleets = game.missions.length;
  return `<button class="army-summary" data-action="army" title="Ver el ejército (8)">
    <span class="army-summary-title">⚔️ Ejército</span>
    <span class="army-summary-counts"><span>🛡️ ${fmtNum(land)}</span><span>⚓ ${fmtNum(ships)}</span>${fleets ? `<span class="sea">⛵ ${fleets}</span>` : ''}</span>
  </button>`;
}
