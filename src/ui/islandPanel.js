import { ISLAND_TYPES, MISSION_TYPES, PLAYER_UNITS, RESOURCES, UNITS } from '../game/data.js';
import { colonyYield } from '../game/rules.js';
import { bag, costList, fmtNum, fmtTime, unitList } from './format.js';

// Panel de una isla del archipiélago: lo que se sabe de ella y el formulario
// para mandar una flota (explorar, atacar o colonizar).

function infoSection(game, view) {
  const t = ISLAND_TYPES[view.type];
  if (view.colonized) {
    const r = RESOURCES[view.specialty];
    return `<p class="desc">Tus colonos trabajan la isla y mandan sus cosechas a la capital.</p>
      <div class="effect"><span>${r.icon} Producción de la colonia</span><b class="up">+${fmtNum(colonyYield(view))}/h</b></div>`;
  }
  if (view.type === 'brumas') {
    return `<p class="desc">Más allá de las islas conocidas, una niebla que nunca se levanta. Las expediciones vuelven con tesoros, barcos perdidos… o no vuelven.</p>
      <p class="desc small">Hace falta Navegación 2. Cuantos más barcos y más bodega lleves, más botín puedes traer, pero también hay piratas y monstruos.</p>`;
  }
  if (!view.explored) {
    return '<p class="desc">Nadie sabe qué hay en esta isla. Envía un bote explorador para descubrirlo… o ataca a ciegas.</p>';
  }
  if (view.type === 'libre') {
    const r = RESOURCES[view.specialty];
    return `<p class="desc">Tierra fértil y deshabitada. Si fundas aquí una colonia producirá ${r.name.toLowerCase()} para tu imperio.</p>
      <div class="effect"><span>${r.icon} Producción como colonia</span><b class="up">+${fmtNum(colonyYield(view))}/h</b></div>`;
  }
  if (view.type === 'ruinas') {
    return view.looted
      ? '<p class="desc">Las ruinas ya han sido saqueadas. Solo quedan piedras y lagartijas.</p>'
      : `<p class="desc">Entre las columnas caídas brilla algo. Quien desembarque se llevará el tesoro:</p><div class="info-row"><span>Tesoro</span><span>${bag(view.treasure)}</span></div>`;
  }
  const lines = [
    `<div class="info-row"><span>Guarnición</span><span>${unitList(view.garrison)}</span></div>`,
    `<div class="info-row"><span>Botín acumulado</span><span>${bag(view.stock)}</span></div>`,
  ];
  if (view.wall) lines.push(`<div class="info-row"><span>🏰 Fortificación</span><b>+${Math.round(view.wall * 100)} % de vida</b></div>`);
  const flavor = {
    barbaros: 'Una tribu de bárbaros ha levantado aquí su campamento. Acumulan lo que roban y se rearman con el tiempo.',
    piratas: 'Guarida de piratas bien fortificada. Las catapultas ayudan a abrir brecha en sus muros.',
    kraken: 'Aquí duerme el Kraken, rodeado de barcos hundidos y del oro de mil naufragios.',
  }[view.type];
  return `<p class="desc">${flavor}</p>${lines.join('')}
    <p class="desc small">Se rearman por completo en unas ${fmtNum(view.regenHours)} h de juego. Solo te llevas el botín si acabas con toda la guarnición.</p>`;
}

function inboundSection(game, view) {
  if (!view.inbound.length) return '';
  const rows = view.inbound
    .map((m) => {
      const t = MISSION_TYPES[m.type];
      const until = m.phase === 'ida' ? m.arrive : m.back;
      return `<li><span>${t.icon} ${t.name} · ${m.phase === 'ida' ? 'de ida' : 'volviendo'}</span><span class="q-time" data-until="${until}"></span></li>`;
    })
    .join('');
  return `<h4>Flotas en camino</h4><ul class="mini-list">${rows}</ul>`;
}

function fleetForm(game, view) {
  if (game.level('puerto') < 1) return '<div class="section"><h4>Enviar flota</h4><p class="desc">Construye un puerto en tu isla para poder zarpar.</p></div>';
  const home = PLAYER_UNITS.filter((id) => game.units[id] > 0);
  if (!home.length) return '<div class="section"><h4>Enviar flota</h4><p class="desc">No tienes tropas ni barcos en casa. Entrénalos en el cuartel y el puerto.</p></div>';

  const rows = home
    .map((id) => {
      const u = UNITS[id];
      return `<div class="fleet-row">
        <span class="fleet-unit" title="${u.name}">${u.icon} ${u.name}</span>
        <span class="muted">${fmtNum(game.units[id])}</span>
        <input type="number" name="f-${id}" min="0" max="${game.units[id]}" placeholder="0" inputmode="numeric" aria-label="${u.name} a enviar" />
        <button class="ghost small" data-action="fleet-all" data-unit="${id}">Todos</button>
      </div>`;
    })
    .join('');

  const types = [];
  if (view.type === 'brumas') types.push('expedicion');
  else types.push('explorar');
  if (view.type !== 'brumas' && !view.colonized && (!view.explored || ['barbaros', 'piratas', 'kraken'].includes(view.type))) types.push('atacar');
  if (view.type === 'libre' && view.explored && !view.colonized) types.push('colonizar');

  const buttons = types
    .map((t) => `<button class="${t === 'atacar' ? 'danger' : 'primary'} small" data-action="mission" data-type="${t}">${MISSION_TYPES[t].icon} ${MISSION_TYPES[t].name}</button>`)
    .join('');
  const colony = types.includes('colonizar')
    ? `<div class="hint">Los colonos viajan en un mercante y se quedan con él. Llevan:</div>${costList(game.planMission('colonizar', view.id, { mercante: 1 }).cost ?? {}, game.resources)}`
    : '';
  return `<div class="section">
    <h4>Enviar flota <span class="muted small">(${game.missions.length}/${game.fleetSlots()} en el mar)</span></h4>
    <div class="fleet">${rows}</div>
    <div class="fleet-summary" data-fleet-summary></div>
    ${colony}
    <div class="mission-buttons">${buttons}</div>
    <div class="hint warn" data-fleet-reason></div>
  </div>`;
}

/** Unidades elegidas en el formulario de flota. */
export function readFleet(root) {
  const units = {};
  for (const input of root.querySelectorAll('input[name^="f-"]')) {
    const n = Math.floor(Number(input.value) || 0);
    if (n > 0) units[input.name.slice(2)] = n;
  }
  return units;
}

/** El botón de explorar, sin nada elegido, manda un bote. */
export function fleetFor(game, type, units) {
  if (type === 'explorar' && !Object.keys(units).length && game.units.bote > 0) return { bote: 1 };
  return units;
}

function refreshFleet(game, id, root) {
  const summary = root.querySelector('[data-fleet-summary]');
  if (!summary) return;
  const units = readFleet(root);
  const any = Object.keys(units).length > 0;
  const base = game.planMission('atacar', id, units);
  const text = any
    ? `👥 ${base.used}/${base.capacity} plazas · 📦 ${fmtNum(base.cargo)} de carga${base.seconds ? ` · ⏱ ${fmtTime(base.seconds)} de ida` : ''}`
    : 'Elige cuántas unidades mandas.';
  if (summary.textContent !== text) summary.textContent = text;

  // Si ninguna misión es posible, explicar por qué la última (la más "seria") no lo es
  let anyOk = false;
  let lastReason = '';
  for (const btn of root.querySelectorAll('[data-action="mission"]')) {
    const plan = game.planMission(btn.dataset.type, id, fleetFor(game, btn.dataset.type, units));
    btn.disabled = !plan.ok;
    btn.title = plan.ok ? `Llegada en ${fmtTime(plan.seconds)}` : plan.reason;
    anyOk ||= plan.ok;
    if (!plan.ok) lastReason = plan.reason;
  }
  const hint = any && !anyOk ? lastReason : '';
  const reason = root.querySelector('[data-fleet-reason]');
  if (reason && reason.textContent !== hint) reason.textContent = hint;
}

export function islandPanel(hud, id) {
  const game = hud.game;
  const view = game.island(id);
  const t = ISLAND_TYPES[view.type];
  const icon = view.colonized ? '🚩' : view.explored ? t.icon : '❔';
  const sub = view.colonized ? 'Tu colonia' : view.explored ? `${t.name}${view.tier ? ` · Nv ${view.tier}` : ''}` : 'Isla desconocida';
  const html = `
    <div class="panel-head">
      <span class="panel-icon">${icon}</span>
      <div>
        <h3>${view.name}</h3>
        <div class="panel-lvl">${sub} · a ${fmtNum(view.dist)} leguas</div>
      </div>
      <button class="icon-btn" data-action="close" title="Cerrar">✕</button>
    </div>
    ${infoSection(game, view)}
    ${inboundSection(game, view)}
    ${fleetForm(game, view)}`;
  return {
    html,
    refresh(root) {
      refreshFleet(game, id, root);
    },
  };
}
