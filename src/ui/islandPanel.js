import * as THREE from 'three';
import { BLOCKADE, COLONY, ISLAND_TYPES, MISSION_TYPES, OCCUPATION, OUTPOST_MISSIONS, PLAYER_UNITS, RESOURCES, RESOURCE_KEYS, UNITS, WONDERS, WONDER_LEVELS, WONDER_RESOURCES } from '../game/data.js';
import { colonyUpgrade, colonyYield } from '../game/rules.js';
import { NEWBIE_POINTS } from '../game/Game.js';
import { createIslandBase, createIslandFeature, islandLook } from '../scene/islands.js';
import { portrait, unitIcon } from '../scene/portraits.js';
import { bag, costList, escapeHtml, fmtAgo, fmtNum, fmtTime, unitList } from './format.js';

// Panel de una isla del archipiélago: lo que se sabe de ella y el formulario
// para mandar una flota (explorar, atacar o colonizar).

function playerSection(game, view) {
  const ally = view.alliance && game.alliance && view.alliance.id === game.alliance.id;
  const lines = [
    `<div class="info-row"><span>⚜ Gobernante</span><b>${escapeHtml(view.ownerName)}</b></div>`,
    `<div class="info-row"><span>🤝 Alianza</span><b>${view.alliance ? `${escapeHtml(view.alliance.name)} [${escapeHtml(view.alliance.tag)}]${ally ? ' · aliado' : view.relation === 'pacto' ? ' · 🕊️ pacto' : view.relation === 'guerra' ? ' · ⚔️ en guerra' : ''}` : 'Ninguna'}</b></div>`,
    `<div class="info-row"><span>🏆 Puntos</span><b>${fmtNum(view.score)}</b></div>`,
    `<div class="info-row"><span>🏛️ Ayuntamiento</span><b>Nivel ${view.townLevel}</b></div>`,
  ];
  if (view.vacation) lines.push('<p class="hint ok">🏖️ Está de vacaciones: su isla no se puede atacar ni espiar.</p>');
  else if (view.inactive) lines.push('<p class="hint">💤 Lleva más de una semana sin aparecer por su ciudad.</p>');
  if (view.protected) lines.push(`<p class="hint ok">🛡️ Protección de novato: con menos de ${NEWBIE_POINTS} puntos nadie puede atacar esta ciudad.</p>`);
  const port = view.port;
  if (port && port.by !== game.userId) {
    lines.push(
      port.kind === 'invadir'
        ? `<p class="hint warn">🦅 Ocupada por ${escapeHtml(port.name)} · se irán como mucho en <span data-until="${port.until}"></span>. Nadie más la puede atacar mientras tanto.</p>`
        : `<p class="hint warn">⛓️ ${escapeHtml(port.name)} bloquea su puerto · como mucho <span data-until="${port.until}"></span> más.</p>`,
    );
  }
  const intel = view.intel;
  const spy = intel
    ? `<h4>Informe de tus espías <span class="muted small">(${fmtAgo(intel.t)})</span></h4>
      <div class="info-row"><span>Tropas en casa</span><span>${unitList(intel.garrison)}</span></div>
      <div class="info-row"><span>Recursos</span><span>${bag(intel.stock)}</span></div>
      <div class="info-row"><span>🏰 Muralla</span><b>Nivel ${intel.wall ?? 0}</b></div>`
    : '<p class="desc small">Manda un bote explorador para espiar sus tropas y sus recursos antes de atacar.</p>';
  const intro = view.port?.by === game.userId
    ? view.port.kind === 'invadir'
      ? 'Una ciudad que ocupan tus tropas.'
      : 'Una ciudad cuyo puerto bloquean tus barcos.'
    : ally
    ? 'Una ciudad aliada: no podéis atacaros, pero puedes mandarle recursos.'
    : view.relation === 'pacto'
      ? 'Vuestras alianzas tienen un pacto de no agresión: no podéis atacaros mientras dure.'
      : view.relation === 'guerra'
        ? '⚔️ Vuestras alianzas están en guerra. Si la saqueas, tus barcos cargan un 20 % más de botín.'
        : 'La ciudad de otro jugador. Si la atacas y ganas, te llevas lo que quepa en tus barcos (salvo lo que esconde su almacén).';
  return `<p class="desc">${intro}</p>
    ${lines.join('')}${stationSection(game, view)}${spy}
    <div class="modal-actions">
      <button class="ghost small" data-action="profile" data-name="${escapeHtml(view.ownerName)}">👤 Perfil</button>
      <button class="ghost small" data-action="mail-to" data-name="${escapeHtml(view.ownerName)}">✉️ Mensaje</button>
    </div>`;
}

/** Tu bloqueo de esta ciudad o tu ocupación: tropas, tributo, saqueo y retirada. */
function stationSection(game, view) {
  const m = game.missions.find((x) => x.target === view.id && x.phase === 'estacionada' && (x.type === 'invadir' || x.type === 'bloquear'));
  if (!m) return '';
  if (m.type === 'bloquear') {
    return `<div class="port-box">
      <h4>⛓️ Bloqueas su puerto</h4>
      <p class="desc small">No zarpa nadie, no entran transportes ni mercaderes y sus colonias no le mandan nada. Puede intentar romperlo con sus barcos, o sus aliados con tropas de apoyo.</p>
      <div class="info-row"><span>Tu flota</span><span>${unitList(m.units)}</span></div>
      <div class="info-row"><span>Aguanta como mucho</span><b class="q-time" data-until="${m.until}"></b></div>
      <button class="ghost wide" data-action="recall" data-mission="${m.id}">⚓ Levantar el bloqueo</button>
    </div>`;
  }
  const owed = game.owed?.[m.id] ?? {};
  const ready = (m.plunderAt ?? 0) <= game.now();
  return `<div class="port-box occupied">
    <h4>🦅 Ocupas esta ciudad</h4>
    <p class="desc small">Te quedas el ${Math.round(OCCUPATION.tribute * 100)} % de lo que produce y controlas su puerto. Cada ${OCCUPATION.plunderHours} h puedes saquear su almacén: barcos requisados llevan a tu capital el tributo y lo saqueado. Para atacar desde aquí, elige «Zarpar desde ${escapeHtml(view.name)}» al mandar una flota a otra isla.</p>
    <div class="info-row"><span>Tropas ocupando</span><span>${unitList(m.units)}</span></div>
    <div class="info-row"><span>Tributo apartado</span><span>${bag(owed) || '<span class="muted">Nada todavía</span>'}</span></div>
    ${Object.keys(m.cargo ?? {}).length ? `<div class="info-row"><span>Botín guardado</span><span>${bag(m.cargo)}</span></div>` : ''}
    <div class="info-row"><span>Se acaba en</span><b class="q-time" data-until="${m.until}"></b></div>
    <button class="primary wide" data-action="plunder" data-mission="${m.id}" data-ready-at="${m.plunderAt ?? 0}" ${ready ? '' : 'disabled'}>💰 Saquear y mandarlo a casa</button>
    ${ready ? '' : `<p class="muted small">Podrás volver a saquear en <span data-until="${m.plunderAt}"></span>.</p>`}
    <button class="ghost wide" data-action="recall" data-mission="${m.id}">⚓ Retirar las tropas (se llevan el tributo)</button>
  </div>`;
}

function colonySection(game, view) {
  const col = view.colony ?? {};
  const r = RESOURCES[col.specialty ?? view.specialty];
  const level = col.level ?? 1;
  const yieldAt = (n) => colonyYield({ yield: col.yield ?? view.yield, level: n });
  let upgrade;
  if (col.upgradeEnd) {
    upgrade = `<p class="hint">🔨 Los colonos amplían la colonia al nivel ${level + 1}: terminan en <span data-until="${col.upgradeEnd}"></span>.</p>`;
  } else if (level >= COLONY.maxLevel) {
    upgrade = '<p class="hint ok">🚩 La colonia ya no puede crecer más.</p>';
  } else {
    const { cost, seconds } = colonyUpgrade(level);
    const busy = game.colonies().some((c) => c.upgradeEnd);
    upgrade = `<h4>Ampliar a nivel ${level + 1}</h4>
      <div class="effect"><span>${r.icon} Producción</span><b class="up">+${fmtNum(yieldAt(level))} → +${fmtNum(yieldAt(level + 1))}/h</b></div>
      ${costList(cost, game.resources)}
      <button class="primary" data-action="colony-upgrade" data-need='${JSON.stringify(cost)}' data-blocked="${busy ? 1 : 0}">🔨 Ampliar · ${fmtTime(seconds)}</button>
      ${busy ? '<p class="muted small">Ya estás ampliando otra colonia: solo hay colonos para una obra a la vez.</p>' : ''}`;
  }
  const raided = col.raidedUntil > game.now() ? `<p class="hint">🔥 Saqueada por la horda: vuelve a producir en <span data-until="${col.raidedUntil}"></span>.</p>` : '';
  return `${raided}<p class="desc">${col.conquered ? 'La ciudad que conquistaste a los bárbaros: tus colonos la gobiernan y mandan su producción a la capital.' : 'Tus colonos trabajan la isla y mandan sus cosechas a la capital.'}</p>
    <div class="info-row"><span>🚩 Nivel</span><b>${level} / ${COLONY.maxLevel}</b></div>
    <div class="effect"><span>${r.icon} Producción de la colonia</span><b class="up">+${fmtNum(yieldAt(level))}/h</b></div>
    ${upgrade}`;
}

/** Un continente: lo que hay en él, para ir a cada sitio. */
function continentSection(game, view) {
  const sites = game.world
    .islands()
    .filter((i) => i.land === view.id)
    .map((i) => game.island(i.id));
  const rows = sites
    .map((s) => {
      const t = ISLAND_TYPES[s.type];
      const what = !s.explored ? '❔ Sin explorar' : s.colonized ? '🚩 Tu colonia' : s.colonizedBy != null ? `🚩 Colonia de ${escapeHtml(s.colonistName)}` : `${t.icon} ${s.typeName}${s.tier ? ` · Nv ${s.tier}` : ''}`;
      return `<li data-select="${escapeHtml(s.id)}"><span><b>${escapeHtml(s.name)}</b><div class="muted small">${what}</div></span><span class="muted small">›</span></li>`;
    })
    .join('');
  return `${hordeSection(view)}<p class="desc">Un pequeño continente entre los sectores del archipiélago. Tierra adentro hay ciudades bárbaras bien defendidas y valles fértiles donde fundar colonias.</p>
    <ul class="mini-list site-list">${rows}</ul>
    ${wonderSection(game, view)}`;
}

/** Una horda bárbara en el continente: cuánto le queda, cuándo ataca y quién la está mermando. */
function hordeSection(view) {
  const h = view.horde;
  if (!h) return '';
  const pct = Math.round((h.left / Math.max(1, h.total)) * 100);
  const top = h.top.map((x) => `<li class="${x.me ? 'me' : ''}"><span>${escapeHtml(x.name)}</span><b>${fmtNum(x.kills)}</b></li>`).join('');
  return `<div class="horde-box">
    <h4>🔥 ¡Horda bárbara!</h4>
    <p class="desc small">Si no cae antes de que acabe la cuenta atrás, arrasará las colonias de este continente: no producirán durante un día. Todos los que luchen se reparten el botín según los bárbaros que abatan.</p>
    <div class="info-row"><span>Ataca en</span><b class="q-time" data-until="${h.deadline}"></b></div>
    <div class="info-row"><span>Fuerzas</span><span>${unitList(h.garrison)}</span></div>
    <div class="progress horde-bar"><i style="width:${pct}%"></i></div>
    <p class="muted small">Quedan ${fmtNum(h.left)} de ${fmtNum(h.total)} bárbaros</p>
    ${top ? `<h5>Más bárbaros abatidos</h5><ol class="mini-rank contest-list">${top}</ol>` : ''}
  </div>`;
}

/** La maravilla del continente: su nivel, lo que falta y quién ha aportado. */
function wonderSection(game, view) {
  const w = view.wonder;
  if (!w) return '';
  const def = WONDERS[w.id];
  const prev = WONDER_LEVELS[w.level - 1] ?? 0;
  const pct = w.next ? Math.round(((w.progress - prev) / (w.next - prev)) * 100) : 100;
  const donors = Object.entries(w.donors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([uid, n]) => `<li><span>${escapeHtml(game.world.playerInfo(Number(uid))?.name ?? (Number(uid) === game.userId ? game.username : 'Un colono'))}</span><b>${fmtNum(n)}</b></li>`)
    .join('');
  const form = !w.next
    ? '<p class="hint ok">✨ La maravilla está terminada.</p>'
    : w.member
      ? `<div class="payload">${WONDER_RESOURCES.map((r) => `<label title="${RESOURCES[r].name}">${RESOURCES[r].icon}<input type="number" name="w-${r}" min="0" placeholder="0" inputmode="numeric" /></label>`).join('')}</div>
        <button class="primary wide" data-action="donate">🏛️ Aportar a la maravilla</button>`
      : '<p class="desc small">Funda una colonia en este continente (o conquista una de sus ciudades) para ayudar a levantarla y recibir su efecto.</p>';
  return `<div class="section wonder">
    <h4>${def.icon} ${def.name} · nivel ${w.level}/${WONDER_LEVELS.length}</h4>
    <p class="desc small">La construyen entre todos los que tienen colonia en el continente, y todos ellos reciben su efecto en todo su imperio.</p>
    <div class="effect"><span>Efecto</span><b class="up">${w.level ? def.text(w.level) : 'Ninguno todavía'}${w.next ? ` → ${def.text(w.level + 1)}` : ''}</b></div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    <p class="muted small">${w.next ? `${fmtNum(w.progress)} / ${fmtNum(w.next)} recursos para el nivel ${w.level + 1}` : `${fmtNum(w.progress)} recursos aportados`}</p>
    ${donors ? `<h5>Quién más ha aportado</h5><ul class="mini-list donors">${donors}</ul>` : ''}
    ${form}
  </div>`;
}

function infoSection(game, view) {
  const t = ISLAND_TYPES[view.type];
  if (view.type === 'continente') return continentSection(game, view);
  if (view.land) {
    const land = game.world.island(view.land);
    const inner = infoSectionFor(game, view, t);
    return `<p class="hint">🗺️ En el continente <b>${escapeHtml(land?.name ?? '')}</b></p>${inner}`;
  }
  return infoSectionFor(game, view, t);
}

function infoSectionFor(game, view, t) {
  if (view.type === 'jugador') return playerSection(game, view);
  if (view.colonizedBy != null && !view.colonized && view.type === 'ciudadela') {
    return `<p class="desc">Ciudad bárbara conquistada por <b>${escapeHtml(view.colonistName)}</b>. Ya no quedan bárbaros: su bandera ondea sobre la empalizada.</p>`;
  }
  if (view.colonizedBy != null && !view.colonized) {
    const r = RESOURCES[view.specialty];
    return `<p class="desc">Colonia de <b>${escapeHtml(view.colonistName)}</b>. Produce ${r.icon} ${r.name.toLowerCase()} para su imperio.</p>`;
  }
  if (view.colonized) return colonySection(game, view);
  if (view.type === 'brumas') {
    return `<p class="desc">Más allá de las islas conocidas, una niebla que nunca se levanta. Las expediciones vuelven con tesoros, barcos perdidos… o no vuelven.</p>
      <p class="desc small">Hace falta Navegación 2. Cuantos más barcos y más bodega lleves, más botín puedes traer, pero también hay piratas y monstruos.</p>`;
  }
  if (!view.explored) {
    return '<p class="desc">Nadie sabe qué hay en esta isla. Envía un bote explorador para descubrirlo: hasta entonces no puedes hacer nada más en ella.</p>';
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
    ciudadela: 'Una ciudad bárbara amurallada tierra adentro: muchos guerreros y mucho botín. Lleva catapultas para abrir brecha en su empalizada.',
    piratas: 'Guarida de piratas bien fortificada. Las catapultas ayudan a abrir brecha en sus muros.',
    kraken: 'Aquí duerme el Kraken, rodeado de barcos hundidos y del oro de mil naufragios.',
  }[view.type];
  return `<p class="desc">${flavor}</p>${lines.join('')}
    <p class="desc small">Se rearman por completo en unas ${fmtNum(view.regenHours)} h de juego. Solo te llevas el botín si acabas con toda la guarnición.</p>`;
}

function inboundSection(game, view) {
  const moving = view.inbound.filter((m) => m.phase !== 'estacionada');
  if (!moving.length) return '';
  const rows = moving
    .map((m) => {
      const t = MISSION_TYPES[m.type];
      const until = m.phase === 'ida' ? m.arrive : m.back;
      return `<li><span>${t.icon} ${t.name} · ${m.phase === 'ida' ? 'de ida' : 'volviendo'}</span><span class="q-time" data-until="${until}"></span></li>`;
    })
    .join('');
  return `<h4>Flotas en camino</h4><ul class="mini-list">${rows}</ul>`;
}

/** Ciudades ocupadas desde las que puede zarpar una flota hacia `targetId`. */
function outpostsFor(game, targetId) {
  return game.occupations().filter((m) => m.target !== targetId);
}

/** Tropas disponibles en el origen elegido (`from`: id de la ocupación, o nada para tu capital). */
export function poolFor(game, from) {
  if (from == null) return game.units;
  return game.occupations().find((m) => m.id === from)?.units ?? {};
}

function fleetForm(hud, game, view) {
  if (view.type === 'continente' && !view.horde) return '';
  if (game.level('puerto') < 1) return '<div class="section"><h4>Enviar flota</h4><p class="desc">Construye un puerto en tu isla para poder zarpar.</p></div>';
  // Origen: tu capital o una ciudad que ocupas
  const outposts = outpostsFor(game, view.id);
  const base = outposts.find((m) => String(m.id) === String(hud.fleetFrom ?? '')) ?? null;
  const pool = base ? base.units : game.units;
  const fromSelect = outposts.length
    ? `<label class="joint-pick">⚓ Zarpar desde <select name="from">
        <option value="">${escapeHtml(game.homeIsland?.name ?? 'tu capital')} (tu capital)</option>
        ${outposts.map((m) => `<option value="${m.id}" ${m === base ? 'selected' : ''}>🦅 ${escapeHtml(m.targetName)} (ocupada)</option>`).join('')}
      </select></label>`
    : '';
  const closed = !base && game.portClosed() ? `<p class="hint warn">${game.state.occupied ? '🦅 Tu ciudad está ocupada' : '⛓️ Tu puerto está bloqueado'}: no puede zarpar ninguna flota desde tu capital.${outposts.length ? ' Puedes zarpar desde una ciudad que ocupes.' : ''}</p>` : '';
  const home = PLAYER_UNITS.filter((id) => pool[id] > 0);
  if (!home.length) {
    const empty = base ? `No te quedan tropas en ${escapeHtml(base.targetName)}.` : 'No tienes tropas ni barcos en casa. Entrénalos en el cuartel y el puerto.';
    return `<div class="section"><h4>Enviar flota</h4>${fromSelect}${closed}<p class="desc">${empty}</p></div>`;
  }

  const rows = home
    .map((id) => {
      const u = UNITS[id];
      return `<div class="fleet-row">
        <span class="fleet-unit u-cell" title="${u.name}">${unitIcon(id)} ${u.name}</span>
        <span class="muted">${fmtNum(pool[id])}</span>
        <input type="number" name="f-${id}" min="0" max="${pool[id]}" placeholder="0" inputmode="numeric" aria-label="${u.name} a enviar" />
        <button class="ghost small" data-action="fleet-all" data-unit="${id}" data-max="${pool[id]}">Todos</button>
      </div>`;
    })
    .join('');

  const types = [];
  if (view.type === 'brumas') types.push('expedicion');
  else if (view.type !== 'continente') types.push('explorar');
  // Sin explorar, lo único que se puede hacer es mandar un bote a mirar
  const known = view.explored;
  const hostile = known && (['barbaros', 'ciudadela', 'piratas', 'kraken', 'jugador'].includes(view.type) || (view.type === 'continente' && !!view.horde));
  if (view.type !== 'brumas' && view.colonizedBy == null && hostile) types.push('atacar');
  const enemyCity = known && view.type === 'jugador' && !(view.alliance && view.alliance.id === game.alliance?.id);
  if (enemyCity) types.push('invadir', 'bloquear', 'sabotaje');
  if (known && view.type === 'jugador') types.push('transporte');
  if (view.type === 'jugador' && view.alliance && view.alliance.id === game.alliance?.id) types.push('apoyo');
  if (view.type === 'libre' && view.explored && view.colonizedBy == null) types.push('colonizar');
  if (view.type === 'ciudadela' && view.explored && view.colonizedBy == null) types.push('conquistar');
  // Desde una ciudad ocupada solo se lanzan ataques y espías
  const allowed = base ? types.filter((t) => OUTPOST_MISSIONS.includes(t)) : types;

  const buttons = allowed
    .map((t) => {
      const label = t === 'explorar' && view.type === 'jugador' ? 'Espiar' : t === 'sabotaje' ? 'Sabotear' : t === 'bloquear' ? 'Bloquear' : MISSION_TYPES[t].name;
      return `<button class="${['atacar', 'invadir', 'bloquear'].includes(t) ? 'danger' : 'primary'} small" data-action="mission" data-type="${t}">${MISSION_TYPES[t].icon} ${label}</button>`;
    })
    .join('');
  const warHint = enemyCity
    ? `<p class="hint small">🦅 <b>Invadir</b>: si tus tropas desembarcan y acaban con su ejército, se quedan ocupando la ciudad (${OCCUPATION.hours} h como mucho): te llevas tributo, saqueas su almacén y atacas desde allí. ⛓️ <b>Bloquear</b>: solo barcos de guerra; si vencen a su flota, cierran su puerto ${BLOCKADE.hours} h como mucho.</p>`
    : '';
  const cargoForm = types.includes('transporte')
    ? `<h4>Recursos para transportar</h4><div class="payload">${RESOURCE_KEYS.map(
        (r) => `<label title="${RESOURCES[r].name}">${RESOURCES[r].icon}<input type="number" name="p-${r}" min="0" placeholder="0" inputmode="numeric" /></label>`,
      ).join('')}</div><p class="hint">Si no eliges barcos, salen los mercantes que hagan falta.</p>`
    : '';
  const colony = types.includes('colonizar')
    ? `<div class="hint">Los colonos viajan en un mercante y se quedan con él. Llevan:</div>${costList(game.planMission('colonizar', view.id, { mercante: 1 }).cost ?? {}, game.resources)}`
    : types.includes('conquistar')
      ? `<div class="hint">🏴 Para conquistarla, tus tropas tienen que acabar con toda la guarnición. Los colonos van en un mercante, se quedan con él y llevan:</div>${costList(game.planMission('conquistar', view.id, { mercante: 1, lancero: 1 }).cost ?? {}, game.resources)}`
      : '';
  return `<div class="section">
    <h4>Enviar flota <span class="muted small">(${game.fleetsAtSea()}/${game.fleetSlots()} en el mar)</span></h4>
    ${fromSelect}${closed}
    <div class="fleet">${rows}</div>
    ${game.heroStatus() === 'casa' && !base ? `<label class="hero-toggle"><input type="checkbox" name="with-hero" /> 🎖️ Que vaya ${escapeHtml(game.hero.name)} (Nv ${game.hero.level})</label>` : ''}
    ${jointSelect(game, view)}
    <div class="fleet-summary" data-fleet-summary></div>
    ${cargoForm}
    ${colony}
    <div class="mission-buttons">${buttons}</div>
    ${warHint}
    ${hostile ? '<button class="ghost wide sim-btn" data-action="simulate">🎲 Simular el combate</button>' : ''}
    <div class="hint warn" data-fleet-reason></div>
  </div>`;
}

/** Ataques de tu alianza hacia esta ciudad a los que puedes sumar tu flota. */
function jointSelect(game, view) {
  if (view.type !== 'jugador') return '';
  const joints = (game.world.joints ?? []).filter((j) => j.target === view.id && j.leaderId !== game.userId);
  if (!joints.length) return '';
  const left = (t) => fmtTime(Math.max(0, (t - game.now()) / 1000));
  return `<label class="joint-pick">🤝 <select name="join">
      <option value="">Ataque propio</option>
      ${joints.map((j) => `<option value="${escapeHtml(j.key)}">Unirse al ataque de ${escapeHtml(j.leader)} (llega en ${left(j.arrive)}${j.allies ? `, con ${j.allies} más` : ''})</option>`).join('')}
    </select></label>`;
}

/** Opciones de la flota: almirante y ataque conjunto. */
export function readOpts(root) {
  const from = root.querySelector('[name="from"]')?.value;
  return { hero: !!root.querySelector('[name="with-hero"]')?.checked, join: root.querySelector('[name="join"]')?.value || undefined, from: from ? Number(from) : undefined };
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
export function fleetFor(game, type, units, payload = {}, from) {
  if (Object.keys(units).length) return units;
  const pool = poolFor(game, from);
  if ((type === 'explorar' || type === 'sabotaje') && pool.bote > 0) return { bote: 1 };
  if (type === 'transporte' && pool.mercante > 0) {
    const total = Object.values(payload).reduce((a, b) => a + b, 0);
    const need = Math.max(1, Math.ceil(total / UNITS.mercante.cargo));
    return { mercante: Math.min(need, pool.mercante) };
  }
  return units;
}

function refreshFleet(game, id, root) {
  const summary = root.querySelector('[data-fleet-summary]');
  if (!summary) return;
  const units = readFleet(root);
  const any = Object.keys(units).length > 0;
  const base = game.planMission('atacar', id, units, null, readOpts(root));
  const text = any
    ? `👥 ${base.used}/${base.capacity} plazas · 📦 ${fmtNum(base.cargo)} de carga${base.seconds ? ` · ⏱ ${fmtTime(base.seconds)} de ida` : ''}`
    : 'Elige cuántas unidades mandas.';
  if (summary.textContent !== text) summary.textContent = text;

  // Si ninguna misión es posible, explicar por qué la última (la más "seria") no lo es
  let anyOk = false;
  let lastReason = '';
  const payload = readPayload(root);
  const opts = readOpts(root);
  for (const btn of root.querySelectorAll('[data-action="mission"]')) {
    const plan = game.planMission(btn.dataset.type, id, fleetFor(game, btn.dataset.type, units, payload, opts.from), payload, opts);
    btn.disabled = !plan.ok;
    btn.title = plan.ok ? `Llegada en ${fmtTime(plan.seconds)}` : plan.reason;
    anyOk ||= plan.ok;
    if (!plan.ok) lastReason = plan.reason;
  }
  const hint = any && !anyOk ? lastReason : '';
  const reason = root.querySelector('[data-fleet-reason]');
  if (reason && reason.textContent !== hint) reason.textContent = hint;
}

/** La isla tal como se ve en el mapa, en pequeño (con la bandera de quien la gobierne). */
function islandArt(game, view) {
  const isl = game.world.island(view.id);
  if (!isl || view.type === 'brumas') return '';
  const ownerId = view.type === 'jugador' ? view.owner : view.colonizedBy;
  const bannerColor = ownerId === game.userId ? game.state.banner?.color : game.world.playerInfo(ownerId)?.banner?.color;
  const look = `${islandLook(view)}|${bannerColor ?? ''}`;
  const url = portrait('island', `${view.id}|${look}`, {
    width: 340,
    height: 150,
    model: () => {
      const g = new THREE.Group();
      g.add(createIslandBase(isl), createIslandFeature({ ...isl, colonizedBy: view.colonizedBy, bannerColor }, look));
      return g;
    },
  });
  return url ? `<div class="building-art island-art"><img src="${url}" alt="" draggable="false" /></div>` : '';
}

export function islandPanel(hud, id) {
  const game = hud.game;
  const view = game.island(id);
  const t = ISLAND_TYPES[view.type];
  let icon = view.colonized || view.colonizedBy != null ? '🚩' : view.explored ? t.icon : '❔';
  let sub = view.colonized ? `Tu colonia · nivel ${view.colony?.level ?? 1}` : view.explored ? `${view.typeName}${view.tier ? ` · Nv ${view.tier}` : ''}` : 'Isla desconocida';
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
    ${islandArt(game, view)}
    ${infoSection(game, view)}
    ${inboundSection(game, view)}
    ${fleetForm(hud, game, view)}`;
  return {
    html,
    refresh(root) {
      refreshFleet(game, id, root);
    },
  };
}
