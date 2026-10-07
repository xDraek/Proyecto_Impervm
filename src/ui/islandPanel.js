import { ISLAND_TYPES, MISSION_TYPES, PLAYER_UNITS, RESOURCES, RESOURCE_KEYS, UNITS } from '../game/data.js';
import { colonyYield } from '../game/rules.js';
import { NEWBIE_POINTS } from '../game/Game.js';
import { bag, costList, escapeHtml, fmtAgo, fmtNum, fmtTime, unitList } from './format.js';

// Panel de una isla del archipiélago: lo que se sabe de ella y el formulario
// para mandar una flota (explorar, atacar o colonizar).

function playerSection(game, view) {
  const ally = view.alliance && game.alliance && view.alliance.id === game.alliance.id;
  const lines = [
    `<div class="info-row"><span>⚜ Gobernante</span><b>${escapeHtml(view.ownerName)}</b></div>`,
    `<div class="info-row"><span>🤝 Alianza</span><b>${view.alliance ? `${escapeHtml(view.alliance.name)} [${escapeHtml(view.alliance.tag)}]${ally ? ' · aliado' : ''}` : 'Ninguna'}</b></div>`,
    `<div class="info-row"><span>🏆 Puntos</span><b>${fmtNum(view.score)}</b></div>`,
    `<div class="info-row"><span>🏛️ Ayuntamiento</span><b>Nivel ${view.townLevel}</b></div>`,
  ];
  if (view.protected) lines.push(`<p class="hint ok">🛡️ Protección de novato: con menos de ${NEWBIE_POINTS} puntos nadie puede atacar esta ciudad.</p>`);
  const intel = view.intel;
  const spy = intel
    ? `<h4>Informe de tus espías <span class="muted small">(${fmtAgo(intel.t)})</span></h4>
      <div class="info-row"><span>Tropas en casa</span><span>${unitList(intel.garrison)}</span></div>
      <div class="info-row"><span>Recursos</span><span>${bag(intel.stock)}</span></div>
      <div class="info-row"><span>🏰 Muralla</span><b>Nivel ${intel.wall ?? 0}</b></div>`
    : '<p class="desc small">Manda un bote explorador para espiar sus tropas y sus recursos antes de atacar.</p>';
  const intro = ally
    ? 'Una ciudad aliada: no podéis atacaros, pero puedes mandarle recursos.'
    : 'La ciudad de otro jugador. Si la atacas y ganas, te llevas lo que quepa en tus barcos (salvo lo que esconde su almacén).';
  return `<p class="desc">${intro}</p>
    ${lines.join('')}${spy}
    <div class="modal-actions">
      <button class="ghost small" data-action="profile" data-name="${escapeHtml(view.ownerName)}">👤 Perfil</button>
      <button class="ghost small" data-action="mail-to" data-name="${escapeHtml(view.ownerName)}">✉️ Mensaje</button>
    </div>`;
}

function infoSection(game, view) {
  const t = ISLAND_TYPES[view.type];
  if (view.type === 'jugador') return playerSection(game, view);
  if (view.colonizedBy != null && !view.colonized) {
    const r = RESOURCES[view.specialty];
    return `<p class="desc">Colonia de <b>${escapeHtml(view.colonistName)}</b>. Produce ${r.icon} ${r.name.toLowerCase()} para su imperio.</p>`;
  }
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
  const hostile = ['barbaros', 'piratas', 'kraken', 'jugador'].includes(view.type);
  if (view.type !== 'brumas' && view.colonizedBy == null && (!view.explored || hostile)) types.push('atacar');
  if (view.type === 'jugador') types.push('transporte');
  if (view.type === 'jugador' && view.alliance && view.alliance.id === game.alliance?.id) types.push('apoyo');
  if (view.type === 'libre' && view.explored && view.colonizedBy == null) types.push('colonizar');

  const buttons = types
    .map((t) => {
      const label = t === 'explorar' && view.type === 'jugador' ? 'Espiar' : MISSION_TYPES[t].name;
      return `<button class="${t === 'atacar' ? 'danger' : 'primary'} small" data-action="mission" data-type="${t}">${MISSION_TYPES[t].icon} ${label}</button>`;
    })
    .join('');
  const cargoForm = types.includes('transporte')
    ? `<h4>Recursos para transportar</h4><div class="payload">${RESOURCE_KEYS.map(
        (r) => `<label title="${RESOURCES[r].name}">${RESOURCES[r].icon}<input type="number" name="p-${r}" min="0" placeholder="0" inputmode="numeric" /></label>`,
      ).join('')}</div><p class="hint">Si no eliges barcos, salen los mercantes que hagan falta.</p>`
    : '';
  const colony = types.includes('colonizar')
    ? `<div class="hint">Los colonos viajan en un mercante y se quedan con él. Llevan:</div>${costList(game.planMission('colonizar', view.id, { mercante: 1 }).cost ?? {}, game.resources)}`
    : '';
  return `<div class="section">
    <h4>Enviar flota <span class="muted small">(${game.missions.length}/${game.fleetSlots()} en el mar)</span></h4>
    <div class="fleet">${rows}</div>
    ${game.heroStatus() === 'casa' ? `<label class="hero-toggle"><input type="checkbox" name="with-hero" /> 🎖️ Que vaya ${escapeHtml(game.hero.name)} (Nv ${game.hero.level})</label>` : ''}
    <div class="fleet-summary" data-fleet-summary></div>
    ${cargoForm}
    ${colony}
    <div class="mission-buttons">${buttons}</div>
    ${hostile ? '<button class="ghost wide sim-btn" data-action="simulate">🎲 Simular el combate</button>' : ''}
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

/** Recursos elegidos para un transporte. */
export function readPayload(root) {
  const out = {};
  for (const input of root.querySelectorAll('input[name^="p-"]')) {
    const n = Math.floor(Number(input.value) || 0);
    if (n > 0) out[input.name.slice(2)] = n;
  }
  return out;
}

/**
 * Atajos cuando no eliges unidades: explorar manda un bote y un transporte,
 * los mercantes que hagan falta para la carga.
 */
export function fleetFor(game, type, units, payload = {}) {
  if (Object.keys(units).length) return units;
  if (type === 'explorar' && game.units.bote > 0) return { bote: 1 };
  if (type === 'transporte' && game.units.mercante > 0) {
    const total = Object.values(payload).reduce((a, b) => a + b, 0);
    const need = Math.max(1, Math.ceil(total / UNITS.mercante.cargo));
    return { mercante: Math.min(need, game.units.mercante) };
  }
  return units;
}

function refreshFleet(game, id, root) {
  const summary = root.querySelector('[data-fleet-summary]');
  if (!summary) return;
  const units = readFleet(root);
  const any = Object.keys(units).length > 0;
  const base = game.planMission('atacar', id, units, null, { hero: !!root.querySelector('[name="with-hero"]')?.checked });
  const text = any
    ? `👥 ${base.used}/${base.capacity} plazas · 📦 ${fmtNum(base.cargo)} de carga${base.seconds ? ` · ⏱ ${fmtTime(base.seconds)} de ida` : ''}`
    : 'Elige cuántas unidades mandas.';
  if (summary.textContent !== text) summary.textContent = text;

  // Si ninguna misión es posible, explicar por qué la última (la más "seria") no lo es
  let anyOk = false;
  let lastReason = '';
  const payload = readPayload(root);
  const opts = { hero: !!root.querySelector('[name="with-hero"]')?.checked };
  for (const btn of root.querySelectorAll('[data-action="mission"]')) {
    const plan = game.planMission(btn.dataset.type, id, fleetFor(game, btn.dataset.type, units, payload), payload, opts);
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
  let icon = view.colonized || view.colonizedBy != null ? '🚩' : view.explored ? t.icon : '❔';
  let sub = view.colonized ? 'Tu colonia' : view.explored ? `${t.name}${view.tier ? ` · Nv ${view.tier}` : ''}` : 'Isla desconocida';
  if (view.type === 'jugador') {
    icon = '🏰';
    sub = `Ciudad de ${escapeHtml(view.ownerName)}`;
  }
  const html = `
    <div class="panel-head">
      <span class="panel-icon">${icon}</span>
      <div>
        <h3>${escapeHtml(view.name)}</h3>
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
