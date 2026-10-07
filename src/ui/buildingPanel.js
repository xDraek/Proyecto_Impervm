import { BUILDINGS, RESEARCH, RESEARCH_KEYS, RESOURCES, RESOURCE_KEYS, UNITS, UNIT_KEYS } from '../game/data.js';
import { producerOutput, requirementName, storageCapacity, townSpeedup, wallBonus } from '../game/rules.js';
import { costList, fmtDec, fmtNum, fmtTime, unitList } from './format.js';

// Panel de detalle de un edificio. Devuelve el HTML y un `refresh` para las
// partes que cambian sin que cambie la partida (vista previa del mercado).

const effectRow = (label, now, next) =>
  `<div class="effect"><span>${label}</span><b>${now}</b><span class="arrow">→</span><b class="up">${next}</b></div>`;

const reqText = (missing) => missing.map((m) => `${requirementName(m)} ${m.level}`).join(', ');

function capacityAt(game, almacen) {
  return storageCapacity({ ...game.state, buildings: { ...game.state.buildings, almacen } });
}

function effectFor(game, id, level, next) {
  const b = BUILDINGS[id];
  if (b.produces) {
    const r = RESOURCES[b.produces];
    return effectRow(`${r.icon} Producción`, `${fmtNum(producerOutput(id, level))}/h`, `${fmtNum(producerOutput(id, next))}/h`);
  }
  switch (id) {
    case 'almacen':
      return effectRow('📦 Capacidad', fmtNum(capacityAt(game, level)), fmtNum(capacityAt(game, next)));
    case 'ayuntamiento':
      return effectRow('⚒️ Velocidad de obra', `+${townSpeedup(level)} %`, `+${townSpeedup(next)} %`);
    case 'academia':
      return effectRow('📚 Velocidad de investigación', `+${Math.max(0, level - 1) * 10} %`, `+${(next - 1) * 10} %`);
    case 'cuartel':
      return effectRow('🛡️ Velocidad de reclutamiento', `+${Math.max(0, level - 1) * 10} %`, `+${(next - 1) * 10} %`);
    case 'puerto':
      return effectRow('⚓ Flotas a la vez', level, next) + effectRow('🚢 Velocidad de los astilleros', `+${Math.max(0, level - 1) * 10} %`, `+${(next - 1) * 10} %`);
    case 'muralla': {
      const a = wallBonus(level);
      const b = wallBonus(next);
      return effectRow('❤️ Vida de los defensores', `+${Math.round(a.hp * 100)} %`, `+${Math.round(b.hp * 100)} %`) + effectRow('🏹 Daño de las torres', a.towers, b.towers);
    }
    default:
      return '';
  }
}

function upgradeSection(game, id) {
  const b = BUILDINGS[id];
  const level = game.level(id);
  const next = game.nextUpgrade(id);
  const q = game.queue;

  let label = level === 0 ? 'Construir' : `Mejorar a nivel ${next.level}`;
  let blocked = false;
  let hint = `<div class="hint" data-wait='${JSON.stringify(next.cost)}'></div>`;
  if (q?.id === id) {
    label = 'En construcción…';
    blocked = true;
    hint = `<div class="hint">Termina en <span data-until="${q.end}"></span></div>`;
  } else if (q) {
    label = 'Constructores ocupados';
    blocked = true;
    hint = `<div class="hint">Están trabajando en: ${BUILDINGS[q.id].name}</div>`;
  } else if (next.missing.length) {
    blocked = true;
    hint = '';
  } else if (next.exceedsStorage) {
    blocked = true;
    hint = '<div class="hint warn">El coste supera la capacidad del almacén. ¡Amplíalo primero!</div>';
  }

  return `
    ${effectFor(game, id, level, next.level)}
    <h4>${level === 0 ? 'Construcción' : `Nivel ${next.level}`}</h4>
    ${costList(next.cost, game.resources)}
    <div class="time">⏱ ${fmtTime(next.seconds)}</div>
    ${next.missing.length ? `<div class="reqs">🔒 Requiere ${reqText(next.missing)}</div>` : ''}
    <button class="primary" data-action="upgrade" data-need='${JSON.stringify(next.cost)}' data-blocked="${blocked ? 1 : 0}">${label}</button>
    ${hint}`;
}

// ── Academia ─────────────────────────────────────────────────────────────────

function researchCard(game, id) {
  const r = RESEARCH[id];
  const level = game.researchLevel(id);
  const nx = game.nextResearch(id);
  const rq = game.researchQueue;
  const active = rq?.id === id;
  const lvl = level ? `<span class="card-lvl">Nv ${level}</span>` : '';

  if (nx.missing.length && !level) {
    return `<div class="card locked">
      <div class="card-head"><span class="card-icon">${r.icon}</span><div class="card-title"><b>${r.name}</b>
      <div class="card-sub">🔒 Requiere ${reqText(nx.missing)}</div></div></div></div>`;
  }

  const effect = `<div class="card-sub">${level ? r.effect(level) : r.description}${nx.maxed ? '' : ` <span class="up">→ ${r.effect(nx.level)}</span>`}</div>`;
  let body;
  if (nx.maxed) {
    body = '<div class="hint ok">Nivel máximo alcanzado</div>';
  } else if (active) {
    body = `<div class="progress"><i data-bar data-start="${rq.start}" data-end="${rq.end}"></i></div>
      <div class="hint">Nivel ${rq.level} en <span data-until="${rq.end}"></span></div>`;
  } else {
    const blocked = !!rq || nx.missing.length > 0 || nx.exceedsStorage || game.level('academia') < 1;
    body = `
      ${nx.missing.length ? `<div class="reqs">🔒 Requiere ${reqText(nx.missing)}</div>` : ''}
      <div class="card-row">${costList(nx.cost, game.resources)}<span class="time">⏱ ${fmtTime(nx.seconds)}</span></div>
      <button class="primary small" data-action="research" data-id="${id}" data-need='${JSON.stringify(nx.cost)}' data-blocked="${blocked ? 1 : 0}">
        ${rq ? 'Academia ocupada' : nx.exceedsStorage ? 'No cabe en el almacén' : `Investigar nivel ${nx.level}`}
      </button>`;
  }
  return `<div class="card${active ? ' active' : ''}">
    <div class="card-head"><span class="card-icon">${r.icon}</span><div class="card-title"><b>${r.name}</b> ${lvl}${effect}</div></div>
    ${body}</div>`;
}

function academiaSection(game) {
  if (game.level('academia') < 1) return '<h4>Investigaciones</h4><p class="desc">Construye la academia para empezar a investigar.</p>';
  return `<h4>Investigaciones</h4><div class="cards">${RESEARCH_KEYS.map((id) => researchCard(game, id)).join('')}</div>`;
}

// ── Cuartel y puerto ─────────────────────────────────────────────────────────

function unitStats(u, game) {
  const { atkMul, hpMul } = game.combatBonus();
  const parts = [];
  if (u.atk) parts.push(`⚔️ ${fmtDec(u.atk * atkMul)}`);
  parts.push(`❤️ ${fmtDec(u.hp * hpMul)}`);
  if (u.kind === 'barco') {
    if (u.capacity) parts.push(`👥 ${u.capacity}`);
    if (u.cargo) parts.push(`📦 ${fmtNum(u.cargo)}`);
    parts.push(`💨 ×${fmtDec(u.speed)}`);
  } else if (u.size > 1) {
    parts.push(`👥 ${u.size} plazas`);
  }
  parts.push(`🥖 ${u.upkeep}/h`);
  return parts.map((p) => `<span>${p}</span>`).join('');
}

function unitCard(game, id) {
  const u = UNITS[id];
  const info = game.unitInfo(id);
  const home = game.units[id] ?? 0;
  const homeTag = home ? `<span class="card-lvl">${fmtNum(home)} en casa</span>` : '';
  if (info.missing.length) {
    return `<div class="card locked">
      <div class="card-head"><span class="card-icon">${u.icon}</span><div class="card-title"><b>${u.name}</b> ${homeTag}
      <div class="card-sub">🔒 Requiere ${reqText(info.missing)}</div></div></div></div>`;
  }
  const input = `n-${id}`;
  return `<div class="card">
    <div class="card-head"><span class="card-icon">${u.icon}</span><div class="card-title"><b>${u.name}</b> ${homeTag}
      <div class="card-sub">${u.description}</div></div></div>
    <div class="stats">${unitStats(u, game)}</div>
    <div class="card-row">${costList(u.cost, game.resources, input)}<span class="time">⏱ ${fmtTime(info.seconds)} c/u</span></div>
    <div class="train-row">
      <input type="number" name="${input}" min="1" value="1" inputmode="numeric" aria-label="Cantidad de ${u.name}" />
      <button class="ghost small" data-action="max" data-unit="${id}">Máx</button>
      <button class="primary small" data-action="train" data-unit="${id}" data-need='${JSON.stringify(u.cost)}' data-count="${input}" data-blocked="0">Reclutar</button>
    </div>
  </div>`;
}

function trainingQueue(game, building) {
  const q = game.training(building);
  if (!q.length) return '';
  const rows = q
    .map((b, i) => {
      const u = UNITS[b.unit];
      const head = i === 0;
      return `<li>
        <span>${u.icon} ${head ? `${b.done}/${b.count}` : b.count} ${u.name}</span>
        <span class="progress"><i data-bar data-start="${b.start}" data-end="${b.end}"></i></span>
        <span class="q-time" data-until="${b.end}"></span>
        <button class="icon-btn tiny" data-action="cancel-train" data-building="${building}" data-index="${i}" title="Cancelar y recuperar recursos">✕</button>
      </li>`;
    })
    .join('');
  return `<h4>En entrenamiento</h4><ul class="train-queue">${rows}</ul>`;
}

function recruitSection(game, building) {
  const title = building === 'puerto' ? 'Astillero' : 'Reclutar';
  if (game.level(building) < 1) return `<h4>${title}</h4><p class="desc">Constrúyelo para empezar a ${building === 'puerto' ? 'botar barcos' : 'entrenar tropas'}.</p>`;
  const ids = UNIT_KEYS.filter((id) => UNITS[id].building === building);
  let extra = '';
  if (building === 'puerto') {
    extra = `<div class="effect"><span>⛵ Flotas en el mar</span><b>${game.missions.length} / ${game.fleetSlots()}</b></div>
      <button class="ghost wide" data-action="open-map">🗺️ Abrir el mapa del archipiélago</button>`;
  }
  return `${extra}${trainingQueue(game, building)}<h4>${title}</h4><div class="cards">${ids.map((id) => unitCard(game, id)).join('')}</div>`;
}

// ── Mercado ──────────────────────────────────────────────────────────────────

function marketSection(game) {
  if (game.level('mercado') < 1) return '';
  const opts = (sel) => RESOURCE_KEYS.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${RESOURCES[r].icon} ${RESOURCES[r].name}</option>`).join('');
  return `<h4>Cambiar recursos</h4>
    <div class="trade">
      <label>Das <select name="t-from">${opts('madera')}</select></label>
      <div class="train-row">
        <input type="number" name="t-amount" min="1" value="100" inputmode="numeric" aria-label="Cantidad a cambiar" />
        <button class="ghost small" data-action="trade-max">Todo</button>
      </div>
      <label>Recibes <select name="t-to">${opts('oro')}</select></label>
      <div class="hint" data-trade-preview></div>
      <button class="primary" data-action="trade">Cambiar</button>
    </div>`;
}

function refreshMarket(game, root) {
  const out = root.querySelector('[data-trade-preview]');
  if (!out) return;
  const from = root.querySelector('[name="t-from"]').value;
  const to = root.querySelector('[name="t-to"]').value;
  const amount = Math.max(0, Math.floor(Number(root.querySelector('[name="t-amount"]').value) || 0));
  if (from === to) {
    out.textContent = 'Elige dos recursos distintos.';
    return;
  }
  const rate = game.tradeRate(from, to);
  const get = Math.floor(amount * rate);
  const text = `Recibes ${RESOURCES[to].icon} ${fmtNum(get)} · 1 ${RESOURCES[from].icon} = ${fmtDec(rate)} ${RESOURCES[to].icon}`;
  if (out.textContent !== text) out.textContent = text;
}

// ── Otros ────────────────────────────────────────────────────────────────────

function wallSection(game) {
  const units = Object.fromEntries(Object.entries(game.units).filter(([, n]) => n > 0));
  const raid = game.raid;
  return `<h4>Defensa de la isla</h4>
    <div class="info-row"><span>Tropas en casa</span><span>${unitList(units)}</span></div>
    <div class="info-row"><span>Amenaza pirata</span><b>Nv ${game.raidTier()}</b></div>
    ${raid ? `<div class="hint warn">🏴‍☠️ Asalto pirata en <span data-until="${raid.arrival}"></span>: ${unitList(raid.army)}</div>` : ''}
    <p class="desc small">Las tropas que están en casa (también los barcos) defienden la isla. La amenaza crece con el tamaño de tu ciudad.</p>`;
}

function townSection(game) {
  const eco = game.economy();
  return `<h4>Tu imperio</h4>
    <div class="info-row"><span>🚩 Colonias</span><b>${game.colonies().length} / ${game.maxColonies()}</b></div>
    <div class="info-row"><span>🥖 Mantenimiento de tropas</span><b>${fmtNum(eco.upkeep)}/h</b></div>
    <div class="info-row"><span>🏴‍☠️ Amenaza pirata</span><b>${game.level('ayuntamiento') >= 3 ? `Nv ${game.raidTier()}` : 'Ninguna aún'}</b></div>`;
}

export function buildingPanel(hud, id) {
  const game = hud.game;
  const b = BUILDINGS[id];
  const level = game.level(id);
  let extra = '';
  if (id === 'academia') extra = academiaSection(game);
  else if (id === 'cuartel' || id === 'puerto') extra = recruitSection(game, id);
  else if (id === 'mercado') extra = marketSection(game);
  else if (id === 'muralla') extra = wallSection(game);
  else if (id === 'ayuntamiento') extra = townSection(game);

  const html = `
    <div class="panel-head">
      <span class="panel-icon">${b.icon}</span>
      <div>
        <h3>${b.name}</h3>
        <div class="panel-lvl">${level > 0 ? `Nivel ${level}` : 'Sin construir'}</div>
      </div>
      <button class="icon-btn" data-action="close" title="Cerrar">✕</button>
    </div>
    <p class="desc">${b.description}</p>
    ${upgradeSection(game, id)}
    ${extra ? `<div class="section">${extra}</div>` : ''}`;

  return {
    html,
    refresh(root) {
      if (id === 'mercado') refreshMarket(game, root);
    },
  };
}

