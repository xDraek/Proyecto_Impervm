import { NEWBIE_POINTS } from '../game/Game.js';
import {
  ACHIEVEMENTS,
  BLOCKADE,
  BUILDINGS,
  COLONY,
  COLONY_COST,
  CONTEST_CATEGORIES,
  CONTEST_DAYS,
  CONTEST_PRIZES,
  DIPLOMACY,
  HERO,
  HERO_SKILLS,
  HORDE,
  ISLAND_TYPES,
  JOINT_MAX,
  LAND_UNITS,
  MERCENARIES,
  MERCENARY_HOURS,
  MISSION_TYPES,
  OCCUPATION,
  POWERS,
  PROTECTION,
  RELICS,
  RELIC_RARITY,
  RELIC_SLOTS,
  RESEARCH,
  RESOURCES,
  SHIP_UNITS,
  UNITS,
  VACATION,
  WONDERS,
  WONDER_LEVELS,
  WONDER_RESOURCES,
  WORLD_EVENTS,
  WORLD_EVENT_HOURS,
} from '../game/data.js';
import { producerOutput, protectedAmount, storageCapacity } from '../game/rules.js';
import { bag, escapeHtml, fmtDec, fmtNum } from './format.js';

// Guía del juego: capítulos con sus temas, un índice a un lado y un buscador.
// Las tablas salen de los datos del juego (data.js y rules.js), así que no se
// quedan viejas cuando cambian las cifras. Desde un panel se abre un tema con
// un botón `data-action="guide" data-topic="…"` y, dentro de una ventana, con
// `data-guide="…"`.

// ── Piezas para escribir los temas ───────────────────────────────────────────

const pct = (x) => `${Math.round(x * 100)} %`;
const tip = (html) => `<p class="guide-tip">💡 ${html}</p>`;
const warn = (html) => `<p class="guide-warn">⚠️ ${html}</p>`;
const see = (id, text) => `<button type="button" class="link guide-link" data-guide="${id}">${text}</button>`;
const list = (items) => `<ul class="guide-points">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

function table(head, rows) {
  return `<div class="guide-table-wrap"><table class="guide-table">
    <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

/** Requisitos legibles: «Cuartel 3 · Herrería 1». */
function needs(requires = {}) {
  const parts = Object.entries(requires).map(([id, n]) => `${(BUILDINGS[id] ?? RESEARCH[id])?.name ?? id} ${n}`);
  return `<span class="muted small">${parts.length ? parts.join(' · ') : '—'}</span>`;
}

const unitName = (id) => `${UNITS[id].icon} ${UNITS[id].name}${UNITS[id].elite ? ' ⭐' : ''}`;

// ── Tablas con los datos del juego ───────────────────────────────────────────

function buildingsTable() {
  return table(
    ['Edificio', 'Para qué sirve', 'Requisitos'],
    Object.values(BUILDINGS).map((b) => [`${b.icon} <b>${b.name}</b>`, b.description, needs(b.requires)]),
  );
}

function researchTable() {
  return table(
    ['Investigación', 'Efecto', 'Niveles', 'Requisitos'],
    Object.values(RESEARCH).map((r) => {
      const max = r.maxLevel ?? 10;
      const effect = max === 1 ? r.effect(1) : `${r.effect(1)} por nivel`;
      return [`${r.icon} <b>${r.name}</b>`, `${effect}<div class="muted small">${r.description}</div>`, max, needs(r.requires)];
    }),
  );
}

function landTable() {
  return table(
    ['Tropa', '⚔️', '❤️', 'Come', 'Plazas', 'Requisitos'],
    LAND_UNITS.map((id) => {
      const u = UNITS[id];
      const keep = u.pay ? `🥖 ${u.upkeep}/h<div class="small">🪙 ${fmtDec(u.pay)}/h</div>` : `🥖 ${u.upkeep}/h`;
      return [`<b>${unitName(id)}</b><div class="muted small">${u.description}</div>`, u.atk, u.hp, keep, u.size ?? 1, needs(u.requires)];
    }),
  );
}

function shipTable() {
  return table(
    ['Barco', '⚔️', '❤️', '💨', 'Tropas', '📦 Carga', 'Requisitos'],
    SHIP_UNITS.map((id) => {
      const u = UNITS[id];
      return [`<b>${unitName(id)}</b><div class="muted small">${u.description}</div>`, u.atk, u.hp, `×${fmtDec(u.speed)}`, u.capacity, fmtNum(u.cargo), needs(u.requires)];
    }),
  );
}

function storageTable() {
  const rows = [0, 1, 3, 5, 8, 10, 15].map((n) => {
    const s = { buildings: { almacen: n }, research: {} };
    return [n ? `Nivel ${n}` : 'Sin almacén', fmtNum(storageCapacity(s)), fmtNum(protectedAmount(s))];
  });
  return table(['Almacén', 'Máximo de cada recurso', 'Escondido (no se roba)'], rows);
}

function productionTable() {
  const ids = ['aserradero', 'cantera', 'granja', 'mina', 'fundicion', 'mercado'];
  const levels = [1, 5, 10, 15, 20];
  return table(
    ['Edificio', ...levels.map((n) => `Nv ${n}`)],
    ids.map((id) => [`${BUILDINGS[id].icon} ${BUILDINGS[id].name}`, ...levels.map((n) => `${fmtNum(producerOutput(id, n))}/h`)]),
  );
}

function missionsTable() {
  const rows = [
    ['explorar', 'Uno o más botes', 'Descubre qué hay en una isla. En una ciudad, espía sus tropas, sus recursos y su muralla.'],
    ['atacar', 'Tropas y barcos', 'Combate contra lo que haya y, si ganas, carga el botín que quepa en las bodegas.'],
    ['invadir', 'Tropas de tierra y barcos', `Como un ataque, pero si acabas con su ejército te quedas ocupando la ciudad (hasta ${OCCUPATION.hours} h).`],
    ['bloquear', 'Solo barcos de guerra', `Si vences a su flota, cierras su puerto (hasta ${BLOCKADE.hours} h).`],
    ['sabotaje', 'Botes', 'Queman parte de sus recursos o retrasan su obra… si no los pillan.'],
    ['transporte', 'Mercantes (o cualquier barco con bodega)', 'Lleva recursos a la ciudad de otro jugador.'],
    ['apoyo', 'Tropas y barcos', 'Defienden la ciudad de un aliado hasta que las retires.'],
    ['colonizar', 'Un mercante y los recursos de la colonia', 'Funda una colonia en una isla libre explorada.'],
    ['conquistar', 'Tropas, un mercante y los recursos', 'Asalta una ciudad bárbara y, si cae entera, la gobiernas.'],
    ['expedicion', 'Lo que quieras', 'Se adentra en el Mar de las Brumas: tesoros, barcos perdidos… o monstruos.'],
  ];
  return table(
    ['Misión', 'Qué mandas', 'Qué pasa'],
    rows.map(([id, what, text]) => [`${MISSION_TYPES[id].icon} <b>${MISSION_TYPES[id].name}</b>`, what, text]),
  );
}

function islandsTable() {
  const rows = [
    ['barbaros', 'Una guarnición que se rearma en unas horas y acumula botín. El blanco ideal para tus primeros ataques.'],
    ['piratas', 'Más gente, barcos corsarios y fortificación. Lleva catapultas para abrir brecha.'],
    ['ruinas', 'Un tesoro para el primero que llegue: basta con explorarlas. A veces esconden una reliquia.'],
    ['libre', 'Tierra deshabitada donde fundar una colonia que produce un recurso.'],
    ['kraken', 'El monstruo de los mares y el oro de mil naufragios. Si cae, una reliquia asegurada.'],
    ['brumas', 'El Mar de las Brumas: solo se va de expedición.'],
    ['ciudadela', 'Ciudades bárbaras amuralladas de los continentes: mucho botín, y se pueden conquistar.'],
    ['continente', 'Tierras grandes entre sectores, con ciudades bárbaras, valles para colonizar y una maravilla.'],
    ['jugador', 'La ciudad de otro jugador.'],
  ];
  return table(
    ['Isla', 'Qué hay'],
    rows.map(([id, text]) => [`${ISLAND_TYPES[id].icon} <b>${ISLAND_TYPES[id].name}</b>`, text]),
  );
}

function powersTable() {
  return table(
    ['Poder', 'Favor', 'Efecto'],
    Object.values(POWERS).map((p) => [`${p.icon} <b>${p.name}</b>`, `🙏 ${p.cost}`, p.description]),
  );
}

function relicsTable() {
  return table(
    ['Reliquia', 'Rareza', 'Efecto', 'Se vende por'],
    Object.values(RELICS).map((r) => {
      const rar = RELIC_RARITY[r.rarity];
      return [`${r.icon} <b>${r.name}</b>`, `<span class="guide-rarity" style="--rar:${rar.color}">${rar.name}</span>`, r.text, `🪙 ${fmtNum(rar.sell)}`];
    }),
  );
}

function eventsTable() {
  return table(
    ['Temporada', 'Efecto'],
    Object.values(WORLD_EVENTS).map((e) => [`${e.icon} <b>${e.name}</b>`, e.text]),
  );
}

function wondersTable() {
  const top = WONDER_LEVELS.length;
  return table(
    ['Maravilla', 'Efecto en todo tu imperio'],
    Object.values(WONDERS).map((w) => [`${w.icon} <b>${w.name}</b>`, `${w.text(1)} por nivel <span class="muted small">(${w.text(top)} al nivel ${top})</span>`]),
  );
}

function heroTable() {
  return table(
    ['Habilidad', 'Por cada punto'],
    Object.values(HERO_SKILLS).map((s) => [`${s.icon} <b>${s.name}</b>`, s.text(1)]),
  );
}

function mercsTable() {
  return table(
    ['Compañía', 'Tropa', 'Cuántos vienen', 'Precio por soldado'],
    Object.values(MERCENARIES).map((m) => [`${m.icon} <b>${m.name}</b>`, unitName(m.unit), `${fmtDec(m.base)} y ${fmtDec(m.per)} más por cada nivel de taberna`, bag(m.price)]),
  );
}

function contestTable() {
  return table(
    ['Categoría', 'Qué cuenta'],
    Object.values(CONTEST_CATEGORIES).map((c) => [`${c.icon} <b>${c.name}</b>`, c.unit]),
  );
}

function achievementsList() {
  return `<ul class="guide-chips">${ACHIEVEMENTS.map((a) => `<li>${a.icon} <b>${a.name}</b><span class="muted small">${a.text}</span></li>`).join('')}</ul>`;
}

// ── Los temas ────────────────────────────────────────────────────────────────

const TOPICS = {
  inicio: {
    icon: '🚀',
    title: 'Primeros pasos',
    body: () => `<p>Gobiernas una ciudad en una isla de un archipiélago que comparten todos los jugadores. Tu isla <b>produce recursos sin parar</b>, también con el juego cerrado, y tú decides en qué gastarlos: mejorar edificios, investigar, entrenar tropas y botar barcos.</p>
      <p>Como en Ikariam, el juego <b>no tiene final</b> ni condición de victoria: tu imperio crece mientras quieras jugar. Cada semana hay una ${see('competicion', 'competición')} con premios, y la clasificación premia todo lo que inviertes.</p>
      <h5>Un buen comienzo</h5>
      <ol class="guide-steps">
        <li><b>Sube los productores</b>: aserradero, cantera y granja. Son la base de todo.</li>
        <li><b>Construye el almacén</b> antes de que se llene: lo que no cabe se pierde.</li>
        <li><b>Ayuntamiento 2</b> desbloquea la academia, el cuartel, el puerto y la mina de cristal.</li>
        <li><b>Investiga</b> las mejoras de producción y, con el puerto, manda un <b>bote</b> a explorar las islas cercanas.</li>
        <li>Entrena unos <b>lanceros</b>, súbelos a un mercante y saquea un campamento bárbaro 🪓.</li>
        <li>Antes del <b>ayuntamiento 3</b> prepara defensas: a partir de ahí llegan ${see('defensa', 'piratas')}.</li>
      </ol>
      ${tip('Sigue las <b>misiones</b> 📋: marcan el camino y cada una da una recompensa. Si te pierdes, vuelve aquí con la tecla <b>?</b>.')}`,
  },
  pantalla: {
    icon: '🖥️',
    title: 'La pantalla',
    body: () => `${list([
      '<b>Arriba</b>: tus recursos (pasa el ratón por encima para ver de dónde sale cada uno y cuánto ganas o pierdes por hora), la temporada del archipiélago, el favor de los dioses y los botones de cada ventana.',
      '<b>A la izquierda</b>: tus edificios o, en el mapa, las islas que conoces. Pulsa uno para abrir su panel.',
      '<b>A la derecha</b>: el panel de lo que hayas elegido (mejorar, entrenar, mandar flotas…).',
      '<b>Abajo</b>: lo que está en marcha —obras, investigaciones, reclutas y flotas— con su cuenta atrás.',
      '<b>Avisos</b>: un recuadro rojo arriba cuando vienen piratas, una flota enemiga o una horda, o cuando te bloquean o te ocupan. Púlsalo para ir a defenderte.',
      '<b>El mapa</b> (tecla <b>M</b>): el archipiélago alrededor de tu isla, con las flotas navegando. El 🌍 <b>mapa del mundo</b> enseña todo, con las ciudades coloreadas según vuestra relación.',
    ])}
      ${tip(`En ${see('atajos', 'Cámara y atajos')} tienes todas las teclas.`)}`,
  },
  objetivos: {
    icon: '📋',
    title: 'Misiones, encargos y regalos',
    body: () => `${list([
      '<b>Misiones</b> 📋: objetivos en orden, unos pocos a la vez. Al cumplirlos, reclama la recompensa.',
      '<b>Encargos diarios</b>: cada día tocan tres tareas adaptadas a tu ciudad (construir, entrenar, saquear, comerciar…). Si cumples los tres hay un premio extra.',
      '<b>Regalo diario</b> 🎁: entra cada día para recogerlo. Cuantos más días seguidos, mejor (el séptimo es el bueno), y crece con el nivel del ayuntamiento. Si te saltas un día, la racha vuelve a empezar.',
      `<b>Logros</b>: se ganan solos y salen en tu ${see('perfil', 'perfil')}.`,
    ])}`,
  },

  recursos: {
    icon: '🪵',
    title: 'Recursos, almacén y comida',
    body: () => `<p>Hay seis recursos: ${Object.values(RESOURCES)
      .map((r) => `${r.icon} ${r.name.toLowerCase()}`)
      .join(', ')}. La isla da por sí sola un poco de madera, piedra y comida; los <b>edificios productores</b> dan mucho más, y cada nivel rinde algo más que el anterior:</p>
      ${productionTable()}
      <p>A eso se suman las ${see('investigacion', 'investigaciones')} (+10 % por nivel), tus ${see('colonias', 'colonias')}, el Coloso (+5 % de todo por nivel), las ${see('eventos', 'temporadas')} y algunas ${see('reliquias', 'reliquias')}.</p>
      <h5>El almacén</h5>
      <p>Cada recurso tiene un <b>máximo</b>: lo que se produce con el almacén lleno se pierde. Además, el almacén <b>esconde</b> una parte de cada recurso que nadie puede robar ni quemar (ni piratas, ni saqueadores, ni saboteadores). Logística sube el máximo un 20 % por nivel.</p>
      ${storageTable()}
      <h5>La comida</h5>
      <p>Las tropas y los barcos <b>comen</b> cada hora, estén en casa o en el mar. Si la comida llega a cero hay <b>hambruna</b>: el resto de la producción cae a la mitad. La taberna reduce lo que comen (−4 % por nivel, hasta −40 %). Las ${see('unidades', 'tropas de élite')} además cobran una paga en oro.</p>
      ${tip('La barra de arriba ya descuenta lo que comen y cobran tus tropas: si una cifra sale en rojo, ese recurso está bajando.')}`,
  },
  trabajadores: {
    icon: '👷',
    title: 'Trabajadores e impuestos',
    body: () => `<p>En el aserradero, la cantera, la granja, la mina y la fundición eliges qué parte de los trabajadores <b>produce</b> (de 10 en 10 %). Los demás se dedican a comerciar y pagan <b>impuestos en oro</b>: la mitad de lo que valdría lo que dejan de producir.</p>
      ${tip('Útil cuando un recurso se te acumula con el almacén lleno, o cuando te falta oro para la paga de la élite o para investigar.')}`,
  },
  edificios: {
    icon: '🏛️',
    title: 'Edificios',
    body: () => `<p>Solo se construye <b>una obra a la vez</b>. El ayuntamiento acelera las obras un 10 % por nivel y Arquitectura otro 8 %. Si cancelas una obra recuperas lo que costó. Cada edificio pide otros (o investigaciones) para poder construirse:</p>
      ${buildingsTable()}
      <p class="muted small">Al subir de nivel ganan detalle: enlosado y cipreses (nivel 5), pebeteros y estatua (10) y remate dorado con estandartes (15). El Coloso no tiene tope: cada nivel suma producción y cada cinco se anuncia a todo el archipiélago.</p>`,
  },
  investigacion: {
    icon: '📚',
    title: 'Investigaciones',
    body: () => `<p>La <b>academia</b> investiga de una en una (cada nivel de academia la acelera un 10 %) y cada nivel cuesta bastante más que el anterior. Algunas tienen un solo nivel y desbloquean unidades:</p>
      ${researchTable()}`,
  },
  comercio: {
    icon: '⚖️',
    title: 'Mercado y comercio',
    body: () => `${list([
      '<b>Cambiar en el mercado</b>: cambias un recurso por otro al momento. Cada recurso vale distinto (el oro y el cristal valen más) y el mercader se queda una comisión: empiezas recibiendo la mitad de lo justo, y cada nivel de mercado y de Comercio mejora el cambio un 4 %, hasta el 92 %. La Gran feria lo mejora otro 15 %.',
      '<b>Ofertas entre jugadores</b>: en el mercado publicas qué das y qué pides (hasta 5 ofertas, que caducan a los 3 días). Lo que ofreces queda apartado hasta que alguien acepta o la retiras.',
      '<b>Transportes</b>: manda mercantes con recursos a la ciudad de cualquier jugador. Si no eliges barcos, salen los que hagan falta.',
      `<b>Mercader ambulante</b>: de vez en cuando atraca uno que compra lo que te sobra y paga mejor que el mercado (ver ${see('visitantes', 'Visitantes')}).`,
    ])}
      ${warn('Con el puerto bloqueado u ocupado no puedes cambiar en el mercado ni recibir transportes.')}`,
  },

  unidades: {
    icon: '🛡️',
    title: 'Tropas y barcos',
    body: () => `<p>El <b>cuartel</b> entrena tropas de tierra y el <b>puerto</b> bota barcos (el astillero los construye más rápido y desbloquea los de guerra). Para ir a otra isla, las tropas viajan <b>dentro de los barcos</b>: cada barco tiene plazas y cada tropa ocupa las suyas.</p>
      <h5>Tropas de tierra</h5>
      ${landTable()}
      <h5>Barcos</h5>
      ${shipTable()}
      <p><b>⭐ Tropas de élite</b>: mucho más fuertes, pero además de comer cobran una <b>paga en oro</b> cada hora, estén en casa o en el mar. Si el oro se acaba, desertan las que más cobran hasta que la paga cuadre. Se desbloquean con <b>Táctica militar</b> (y los elefantes, con <b>Doma de elefantes</b>).</p>
      ${tip('Los mercantes no combaten, pero llevan muchas tropas y mucho botín. Los botes son rápidos y solo sirven para explorar, espiar y sabotear.')}`,
  },
  combate: {
    icon: '⚔️',
    title: 'Cómo se combate',
    body: () => `<p>Los ataques por mar van en <b>dos fases</b>, como en Ikariam:</p>
      <ol class="guide-steps">
        <li><b>Batalla naval</b>: tus barcos de guerra contra los suyos. Si su flota sigue a flote, no puedes desembarcar y vuelves con lo que quede. Si se hunden barcos y tus tropas ya no caben en los que quedan, las que sobran <b>se ahogan</b>.</li>
        <li><b>Desembarco</b>: con el mar libre, tus tropas de tierra luchan contra las suyas, con su muralla y sus torres, y tus barcos de guerra bombardean la costa con una cuarta parte de su ataque. <b>Sin tropas de tierra no se puede saquear.</b></li>
      </ol>
      <p>Cada batalla dura como mucho <b>6 asaltos</b>. En cada uno, los dos bandos disparan a la vez y el daño se reparte entre los tipos de unidad según su vida. Las unidades sin ataque (mercantes, botes) solo reciben daño cuando ya no queda nadie que las proteja. Si tras el sexto asalto siguen los dos en pie, nadie gana y el atacante se retira.</p>
      <h5>Qué te hace más fuerte</h5>
      ${table(
        ['Mejora', 'Efecto'],
        [
          [`${RESEARCH.herreria.icon} ${RESEARCH.herreria.name} (investigación)`, '+10 % de ataque por nivel'],
          [`${BUILDINGS.forja.icon} ${BUILDINGS.forja.name}`, '+3 % de ataque por nivel'],
          [`${RESEARCH.armaduras.icon} ${RESEARCH.armaduras.name} (investigación)`, '+10 % de vida por nivel'],
          [`${RESEARCH.tactica.icon} ${RESEARCH.tactica.name} (investigación)`, '+3 % de ataque y de vida por nivel'],
          ['🏰 Muralla (al defender)', '+10 % de vida y 10 de daño de sus torres por nivel'],
          ['👁️ Torre de vigía (al defender)', '8 de daño de sus arqueros por nivel'],
          ['🗼 Faro (al defender)', '+4 % de vida de tus barcos por nivel'],
          ['☄️ Catapultas (al atacar)', 'Cada una resta un 6 % a la fortificación enemiga'],
          [`🎖️ ${see('almirante', 'Almirante')}, 🏺 ${see('reliquias', 'reliquias')} y ${see('continentes', 'maravillas')}`, 'Más ataque, vida, carga o velocidad'],
        ],
      )}
      ${tip('Antes de atacar, espía y pulsa <b>🎲 Simular el combate</b> en el panel de la isla. En los informes 📜 puedes ver la repetición de cada batalla y compartirla en el chat.')}`,
  },
  defensa: {
    icon: '🏴‍☠️',
    title: 'Defender tu ciudad',
    body: () => `<p>Cuando te atacan defienden todas tus tropas y barcos <b>que estén en casa</b>, las tropas de apoyo de tus aliados, la muralla y sus torres. Tu flota es la primera línea: si vence a la suya, no llegan a desembarcar.</p>
      <h5>Piratas</h5>
      <p>Desde el <b>ayuntamiento 3</b> llegan piratas cada pocas horas, cada vez más fuertes. Los ves venir unos minutos antes (aviso arriba y su flota en el mapa). Si te vencen, se llevan parte de lo que no esconde el almacén; si los rechazas, te dejan su botín.</p>
      <h5>Cómo prepararte</h5>
      ${list([
        'Ten en casa tropas que aguanten (hoplitas, espartanos) y algunos barcos de guerra.',
        'Sube la <b>muralla</b>, la <b>torre de vigía</b> y el <b>faro</b>.',
        `Invoca la <b>Égida</b> (+50 % de vida a los defensores durante 3 h) o la <b>Ira de los dioses</b> contra los piratas (ver ${see('templo', 'Templo')}).`,
        `Pide <b>tropas de apoyo</b> a tu ${see('alianzas', 'alianza')} o contrata ${see('mercenarios', 'mercenarios')}.`,
        'Sube el almacén: lo que esconde no se lo lleva nadie.',
      ])}
      <p>Con menos de <b>${NEWBIE_POINTS} puntos</b> tienes <b>protección de novato</b>: ningún jugador te puede atacar (los piratas, sí).</p>
      ${tip(`Si te bloquean el puerto o te ocupan la ciudad, mira ${see('invasiones', 'Invasiones y ocupación')}.`)}`,
  },
  almirante: {
    icon: '🎖️',
    title: 'El almirante',
    body: () => `<p>Un héroe que se contrata en el <b>ayuntamiento</b> (desde el nivel ${HERO.requires.ayuntamiento}, por ${bag(HERO.cost)}). Puede acompañar a una de tus flotas (marca la casilla al mandarla) o quedarse en casa defendiendo.</p>
      <p>Gana experiencia con los enemigos que abate y llega hasta el nivel ${HERO.maxLevel}. Con cada nivel te da un punto para una habilidad:</p>
      ${heroTable()}
      ${warn(`Si su flota cae, o pierdes una defensa con él en casa, vuelve herido y tarda ${HERO.woundHours} h en recuperarse.`)}`,
  },
  mercenarios: {
    icon: '🗡️',
    title: 'Mercenarios',
    body: () => `<p>En la <b>taberna</b> se contratan compañías de mercenarios durante ${MERCENARY_HOURS} h. Cada compañía se puede contratar una vez al día, y vienen más cuanto más alta esté la taberna:</p>
      ${mercsTable()}
      <p>Pasado el plazo se marchan los que sigan vivos. A veces llegan también <b>mercenarios de paso</b> al puerto que se quedan para siempre a cambio de oro.</p>
      ${tip('Son perfectos para una defensa urgente o un ataque puntual sin cargar con su comida para siempre.')}`,
  },

  flotas: {
    icon: '⛵',
    title: 'Flotas y misiones',
    body: () => `<p>Pulsa una isla (en el mapa, tecla <b>M</b>, o en la lista de la izquierda), elige qué unidades mandas y la misión:</p>
      ${missionsTable()}
      <h5>Viajes</h5>
      ${list([
        'La flota va a la velocidad de su <b>barco más lento</b>. Navegación (+10 % por nivel), el faro (+4 %), el almirante, las reliquias y el Templo de Poseidón la aceleran. El poder <b>Viento favorable</b> ahorra media travesía a las flotas que ya navegan.',
        'El <b>puerto</b> limita cuántas flotas tienes en el mar a la vez: una por nivel.',
        'Puedes <b>retirar</b> una flota que aún no ha llegado: deshace lo andado. Las tropas de apoyo, los bloqueos y las ocupaciones se retiran cuando quieras.',
        'Las islas que no conoces hay que <b>explorarlas</b> primero con un bote.',
      ])}
      ${tip('Si no eliges unidades, explorar manda un bote, y un transporte, los mercantes que hagan falta para la carga.')}`,
  },
  archipielago: {
    icon: '🗺️',
    title: 'El archipiélago',
    body: () => `<p>Cada jugador nuevo abre un <b>sector</b> con su isla y una docena de islas neutrales alrededor. Entre los sectores hay ${see('continentes', 'continentes')}.</p>
      ${islandsTable()}
      <p>Los campamentos, las fortalezas y las ciudades bárbaras <b>se rearman con el tiempo</b> y van acumulando botín. Solo te lo llevas si acabas con toda su guarnición; si no queda nadie, la isla queda arrasada hasta que se recupera.</p>`,
  },
  expediciones: {
    icon: '🧭',
    title: 'Expediciones',
    body: () => `<p>Con <b>Navegación 2</b> puedes mandar flotas al <b>Mar de las Brumas</b> 🌫️. Cuanta más bodega lleves, más botín puedes traer. Lo que puede pasar:</p>
      ${table(
        ['Suceso', 'Probabilidad'],
        [
          ['📦 Un pecio con la bodega llena', '28 %'],
          ['🌫️ Solo niebla: vuelves sin nada', '18 %'],
          ['⛵ Barcos abandonados que se unen a tu flota', '12 %'],
          ['🏴‍☠️ Emboscada pirata (hay combate)', '12 %'],
          ['💰 Un tesoro en una isla perdida', '8 %'],
          ['🧭 Perdidos: tardáis el doble en volver', '8 %'],
          ['🐍 Una serpiente marina hunde parte de la flota', '7 %'],
          ['🗺️ Cartas náuticas con islas nuevas', '4 %'],
          ['🛕 Un altar olvidado: +50 de favor', '3 %'],
        ],
      )}
      <p>Si la expedición sale bien, a veces aparece además una ${see('reliquias', 'reliquia')}.</p>
      ${tip('Lleva algunos barcos de guerra: así las emboscadas son mucho menos peligrosas.')}`,
  },
  colonias: {
    icon: '🚩',
    title: 'Colonias',
    body: () => `${list([
      '<b>Cartografía</b> te deja tener una colonia por nivel (hasta 4).',
      `Para fundarla, explora una isla libre 🌴 y manda un <b>mercante</b> con los colonos y sus recursos: ${bag(COLONY_COST)} la primera, y cada colonia más cuesta un 50 % más. El mercante se queda en la colonia.`,
      'Cada colonia <b>manda un recurso a tu capital</b> cada hora.',
      `Se amplían desde su panel hasta el nivel ${COLONY.maxLevel}: cada nivel produce un ${pct(COLONY.yieldPerLevel)} más de lo que daba al fundarla. Solo una ampliación a la vez.`,
      `También cuentan como colonias las <b>ciudades bárbaras conquistadas</b> (ver ${see('continentes', 'Continentes')}).`,
    ])}
      ${warn('Si te bloquean el puerto o te ocupan la ciudad, tus colonias no te pueden mandar nada mientras dure.')}`,
  },
  continentes: {
    icon: '🏯',
    title: 'Continentes, maravillas y hordas',
    body: () => `<p>Entre los sectores hay pequeños continentes con <b>ciudades bárbaras</b> 🏯 amuralladas y tierras libres para colonizar.</p>
      <h5>Conquista</h5>
      <p>Espía una ciudad bárbara y mándale una misión de <b>conquista</b>: tropas para vencer a la guarnición y un mercante con los colonos. Si cae <b>toda</b> la guarnición, la ciudad pasa a ser tu colonia (y a veces guarda una reliquia).</p>
      <h5>Maravillas</h5>
      <p>Cada continente tiene una maravilla de ${WONDER_LEVELS.length} niveles que levantan entre <b>todos los que tienen colonia allí</b>, aportando ${WONDER_RESOURCES.map((r) => RESOURCES[r].name.toLowerCase()).join(', ')} desde el panel del continente. Todos ellos reciben su efecto en todo su imperio:</p>
      ${wondersTable()}
      <p class="muted small">Recursos aportados en total para cada nivel: ${WONDER_LEVELS.map((n) => fmtNum(n)).join(' · ')}.</p>
      <h5>Hordas bárbaras 🔥</h5>
      <p>Cada pocos días desembarca una horda en los continentes con colonias, más grande cuantos más colonos haya. Durante <b>${HORDE.warnHours} h</b> cualquiera puede atacarla (es lo único que se puede atacar en un continente). Si cae, el botín (${bag(HORDE.reward)}) se reparte según los bárbaros que abatió cada uno, y el mejor puede llevarse una reliquia. Si nadie la detiene, las colonias del continente <b>no producen en ${HORDE.ravageHours} h</b>.</p>`,
  },

  jugadores: {
    icon: '🏰',
    title: 'Atacar a otros jugadores',
    body: () => `<p>Puedes atacar la ciudad de cualquier jugador que no sea de tu alianza ni tenga un pacto con ella. Si ganas, te llevas lo que quepa en tus barcos, salvo lo que esconde su almacén.</p>
      ${list([
        `<b>Protección de novato</b>: con menos de ${NEWBIE_POINTS} puntos nadie te ataca, pero tú tampoco puedes atacar, sabotear, bloquear ni invadir a otros jugadores.`,
        '<b>Vacaciones</b>: a quien está de vacaciones no se le puede atacar ni espiar.',
        `<b>Guerra</b>: si vuestras alianzas están en guerra, tus barcos cargan un ${pct(DIPLOMACY.warLoot)} más de botín y las bajas cuentan en el marcador de la guerra.`,
        `<b>Ataques conjuntos</b>: hasta ${JOINT_MAX} aliados pueden sumar su flota al ataque de otro y combatir como un solo ejército. El botín se reparte según la bodega de cada uno.`,
        'El defensor ve venir tu flota: aviso arriba, la flota en su mapa y ⚔️ en el título de su pestaña.',
        `<b>Límite de ataques</b>: como mucho ${PROTECTION.attacksPerDay} ataques, invasiones o bloqueos contra el mismo jugador cada 24 h, para que nadie acose a otro sin descanso. Entre alianzas en guerra no hay límite. En el panel de su ciudad ves cuántos llevas.`,
      ])}
      ${tip(`Espía antes de atacar (${see('espionaje', 'Espionaje y sabotaje')}) y usa el simulador. Para quedarte con su ciudad, mira ${see('invasiones', 'Invasiones')}.`)}`,
  },
  espionaje: {
    icon: '🔭',
    title: 'Espionaje y sabotaje',
    body: () => `<h5>Espiar</h5>
      <p>Manda un <b>bote</b> a explorar una ciudad: vuelve con sus tropas en casa, sus recursos y el nivel de su muralla. Sus vigías pueden hundirlo: un 8 % por nivel de muralla y un 4 % por nivel de torre de vigía (como mucho, un 70 %).</p>
      <h5>Sabotear</h5>
      <p>Los saboteadores también van en botes. Si no los pillan, o <b>retrasan la obra</b> en marcha (un 30 % de lo que le queda, como mucho una hora) o <b>queman</b> parte de lo que no esconde su almacén. Son más fáciles de pillar que los espías: un 15 % de base, más un 8 % por nivel de muralla y un 5 % por nivel de torre (como mucho, un 85 %). Si los pillan, pierdes los botes.</p>
      ${tip('El <b>Yelmo de Hades</b> hace que tus espías y saboteadores se dejen ver la mitad de veces.')}`,
  },
  bloqueos: {
    icon: '⛓️',
    title: 'Bloquear un puerto',
    body: () => `<p>Manda <b>solo barcos de guerra</b> a la ciudad de otro jugador con la misión <b>Bloquear</b>. Al llegar luchan contra su flota (y la de los aliados que la defiendan). Si se hacen con el mar, se quedan frente a la ciudad como mucho <b>${BLOCKADE.hours} h</b>. Mientras dure el bloqueo:</p>
      ${list(['De su puerto <b>no zarpa ninguna flota</b>.', 'No entran <b>transportes</b> ni <b>mercaderes</b> (no puede cambiar en el mercado).', 'Sus <b>colonias</b> no le pueden mandar nada.'])}
      <p>Un puerto solo lo puede bloquear un jugador a la vez. Tus barcos siguen comiendo de tus graneros, y puedes <b>levantar el bloqueo</b> cuando quieras desde la actividad de abajo, el panel de la ciudad o la ventana del ejército.</p>
      ${tip(`Bloquea antes de ${see('invasiones', 'invadir')}: así no le llegan refuerzos ni recursos. Si después la invades, la flota del bloqueo vuelve a casa sola.`)}`,
  },
  invasiones: {
    icon: '🦅',
    title: 'Invasiones y ocupación',
    body: () => `<p><b>Invadir</b> es un ataque con tropas de tierra. Si desembarcan, acaban con <b>todo su ejército</b> y te quedan soldados, se quedan <b>ocupando la ciudad</b> como mucho <b>${OCCUPATION.hours} h</b> (además del botín del asalto). Mientras la ocupas:</p>
      ${list([
        'Controlas su <b>puerto</b>, con los mismos efectos que un bloqueo.',
        `Te quedas el <b>${pct(OCCUPATION.tribute)} de todo lo que produce</b> como tributo, que se va apartando.`,
        `Cada <b>${OCCUPATION.plunderHours} h</b> puedes <b>saquear</b> su almacén (hasta la mitad de lo que no esconde, lo que quepa en tus barcos). Unos barcos requisados llevan a tu capital lo saqueado, el tributo apartado y el botín que llevaban tus tropas.`,
        `Puedes <b>lanzar flotas desde allí</b>: al mandar una flota a otra isla, elige «Zarpar desde…» y la ciudad ocupada. Desde ella puedes atacar, espiar, sabotear, bloquear e invadir. Las tropas salen de las que la ocupan (siempre tiene que quedarse al menos una de tierra) y vuelven a ella; si mientras tanto la pierdes, siguen hasta tu capital.`,
        'Nadie más puede atacar, invadir ni sabotear esa ciudad.',
      ])}
      <p>Puedes tener como mucho <b>${OCCUPATION.max} invasiones</b> a la vez. Si retiras las tropas o se acaba el tiempo, vuelven a casa con el tributo pendiente.</p>
      <p>🛡️ <b>Protección</b>: cuando una ciudad se libra de un bloqueo o una ocupación (por la razón que sea), queda <b>${PROTECTION.shieldHours} h</b> a salvo de nuevos bloqueos e invasiones; los ataques normales sí pueden llegar, con su límite diario. Si invades una ciudad protegida, tus tropas la saquean pero no se quedan. La protección se pierde si esa ciudad bloquea o invade a otra.</p>
      <h5>Si te bloquean o te ocupan</h5>
      ${list([
        'Ve al <b>puerto</b> (o pulsa el aviso rojo): ahí ves quién es, cuánto le queda y el tributo apartado.',
        '<b>Romper el bloqueo</b>: atacas su flota con tus barcos de guerra (el faro les da más vida).',
        '<b>Expulsar a los invasores</b>: atacas con todo lo que tengas en casa, tropas y barcos. Puedes entrenar tropas nuevas mientras estás ocupado.',
        'Las <b>tropas de apoyo</b> de tu alianza combaten contra ellos al llegar y, si vencen, se quedan defendiéndote.',
        'Si los echas, el tributo que no se llevaron se queda en tu almacén.',
        'Mientras dure no puedes irte de vacaciones.',
        `Cuando termine, tendrás ${PROTECTION.shieldHours} h de protección contra nuevos bloqueos e invasiones.`,
      ])}
      ${tip('Si las dos alianzas firman un pacto o pasáis a ser aliados, el bloqueo o la ocupación terminan solos.')}`,
  },
  alianzas: {
    icon: '🤝',
    title: 'Alianzas y diplomacia',
    body: () => `${list([
      '<b>Fundar o entrar</b>: para fundar una hace falta el ayuntamiento 2 (hasta 20 miembros). En las alianzas con solicitud, el líder 👑 o un oficial ⭐ tiene que aceptarte; en las abiertas entras directamente.',
      'Los miembros <b>no pueden atacarse</b>, ven las ciudades de los demás sin espiarlas y tienen <b>chat</b>, <b>foro</b> y <b>circulares</b> por correo.',
      '<b>Apoyo</b> 🛡️: manda tropas y barcos a defender la ciudad de un aliado. Se quedan hasta que las retires y siguen comiendo de tus graneros. Si su ciudad está bloqueada u ocupada, luchan para liberarla.',
      `<b>Ataques conjuntos</b> 🤝: cuando un aliado ataca a otro jugador, en el panel de esa ciudad puedes unirte a su ataque (hasta ${JOINT_MAX} aliados). Tu flota acompasa la marcha para llegar a la vez.`,
      `<b>Diplomacia</b>: el líder puede proponer un <b>pacto de no agresión</b> (no os podéis atacar) o declarar la <b>guerra</b> (${pct(DIPLOMACY.warLoot)} más de botín y un marcador de bajas y botín de cada bando).`,
      '<b>Amigos</b> 👥 y <b>correo</b> ✉️: añade amigos de cualquier alianza y escribe a quien quieras. En el chat puedes compartir tus informes de batalla.',
    ])}`,
  },

  templo: {
    icon: '🛕',
    title: 'Templo y poderes',
    body: () => `<p>El templo acumula <b>favor</b> de los dioses: 6 por hora por cada nivel, hasta un máximo de 100 más 60 por nivel (el Festival de Poseidón lo duplica). Lo gastas en poderes:</p>
      ${powersTable()}
      ${tip('Inspiración rinde más en obras e investigaciones largas, y Viento favorable cuando tienes varias flotas lejos.')}`,
  },
  reliquias: {
    icon: '🏺',
    title: 'Reliquias',
    body: () => `<p>Objetos míticos que aparecen en expediciones, ruinas, conquistas de ciudades bárbaras, hordas y en la guarida del Kraken. Equipa hasta <b>${RELIC_SLOTS}</b> desde el ayuntamiento; las demás se pueden vender por oro.</p>
      ${relicsTable()}`,
  },
  eventos: {
    icon: '📅',
    title: 'Temporadas del archipiélago',
    body: () => `<p>Cada ${WORLD_EVENT_HOURS} h puede empezar una temporada para todos los jugadores a la vez. El calendario (arriba, junto a los recursos) enseña la actual y las próximas:</p>
      ${eventsTable()}
      <p class="muted small">El clima (lluvia, tormentas, día y noche) es solo ambientación.</p>`,
  },
  visitantes: {
    icon: '🧳',
    title: 'Visitantes',
    body: () => `<p>Cada pocas horas llega alguien a tu isla:</p>
      ${list([
        '🧳 <b>Mercader ambulante</b>: compra lo que más te sobra y paga en hierro, cristal u oro, mejor que el mercado. Se va en una hora.',
        '🗡️ <b>Mercenarios de paso</b>: se unen a tu ejército para siempre a cambio de oro. Se van en una hora.',
        '🕯️ <b>Peregrinos</b>: dejan favor en tu templo (u oro, si no tienes templo).',
        '🛟 <b>Restos de un naufragio</b>: madera, hierro y comida gratis.',
      ])}`,
  },
  competicion: {
    icon: '🏅',
    title: 'Clasificación y competición',
    body: () => `<p>Ganas <b>un punto por cada 100 recursos</b> que inviertes en obras, investigaciones, tropas y colonias. La clasificación 🏆 ordena a todos los imperios por puntos y tiene también tablas militar (enemigos abatidos), de saqueo y de alianzas.</p>
      <h5>Competición semanal</h5>
      <p>Cada ${CONTEST_DAYS} días se premia a los tres mejores de cada categoría, contando <b>solo lo hecho esa semana</b>:</p>
      ${contestTable()}
      <p>Premios: 🥇 ${bag(CONTEST_PRIZES[0])} · 🥈 ${bag(CONTEST_PRIZES[1])} · 🥉 ${bag(CONTEST_PRIZES[2])}. Los ganadores quedan en el salón de la fama.</p>`,
  },
  perfil: {
    icon: '👤',
    title: 'Perfil, logros y estandarte',
    body: () => `<p>Tu perfil (⚙ → Mi perfil) enseña tus puntos, tu alianza, una gráfica de cómo ha crecido tu imperio y tus logros. Desde ahí puedes:</p>
      ${list(['Elegir un <b>título</b> entre los logros que hayas ganado: sale junto a tu nombre.', 'Elegir el <b>estandarte</b>: el color de tus banderas y tu emblema. Así ven los demás tu isla.', 'Cambiar el <b>nombre de tu ciudad</b> (una vez por semana).'])}
      <h5>Logros</h5>
      ${achievementsList()}`,
  },
  vacaciones: {
    icon: '🏖️',
    title: 'Modo vacaciones',
    body: () => `<p>Si te vas unos días, actívalo desde ⚙: nadie te puede atacar ni espiar y no llegan piratas ni visitantes, pero tu isla tampoco produce ni consume. Dura al menos <b>${VACATION.minHours} h</b> y, al volver, tienes que esperar ${VACATION.cooldownHours} h para irte otra vez.</p>
      ${warn('Para irte no puede haber flotas tuyas fuera, ni piratas o flotas enemigas de camino, ni un bloqueo u ocupación en tu ciudad.')}`,
  },
  cuenta: {
    icon: '🔑',
    title: 'Tu cuenta',
    body: () => `${list([
      'Tu cuenta va unida a tu <b>correo</b>: al crearla te llega un enlace para confirmarlo, y tu ciudad se funda al abrirlo. Puedes entrar con tu nombre o con tu correo.',
      'Si olvidas la contraseña, pulsa «¿Has olvidado tu contraseña?» en la pantalla de inicio y te llegará un enlace para poner otra.',
      'El correo y la contraseña se cambian en ⚙ → Cuenta y contraseña.',
      'En ⚙ también puedes activar los <b>avisos del navegador</b> para enterarte de los ataques con la pestaña en segundo plano.',
    ])}`,
  },
  atajos: {
    icon: '⌨️',
    title: 'Cámara y atajos de teclado',
    body: () => `${table(
      ['Tecla', 'Qué hace'],
      [
        ['<kbd>M</kbd>', 'Cambiar entre tu isla y el archipiélago'],
        ['<kbd>Esc</kbd>', 'Cerrar la ventana, el menú o el panel abierto'],
        ['<kbd>?</kbd>', 'Esta guía'],
        ['<kbd>1</kbd> … <kbd>9</kbd>', 'Misiones, chat, correo, alianza, clasificación, mapa del mundo, informes, ejército y amigos'],
        ['<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> o flechas', 'Mover la cámara'],
        ['<kbd>Q</kbd> / <kbd>E</kbd>', 'Girar'],
        ['<kbd>+</kbd> / <kbd>−</kbd>', 'Acercar y alejar'],
        ['<kbd>C</kbd>', 'Centrar la vista'],
      ],
    )}
      <p><b>Con el ratón</b>: arrastra para moverte, arrastra con el botón derecho (o con Mayús) para girar y usa la rueda para acercarte hacia donde apuntas. Doble clic en el suelo o el mar para ir allí. <b>En el móvil</b>, un dedo mueve y dos acercan y giran.</p>`,
  },
};

const CHAPTERS = [
  { title: 'Empezar', topics: ['inicio', 'pantalla', 'objetivos'] },
  { title: 'Economía', topics: ['recursos', 'trabajadores', 'edificios', 'investigacion', 'comercio'] },
  { title: 'Ejército', topics: ['unidades', 'combate', 'defensa', 'almirante', 'mercenarios'] },
  { title: 'El mar', topics: ['flotas', 'archipielago', 'expediciones', 'colonias', 'continentes'] },
  { title: 'Otros jugadores', topics: ['jugadores', 'espionaje', 'bloqueos', 'invasiones', 'alianzas'] },
  { title: 'Más', topics: ['templo', 'reliquias', 'eventos', 'visitantes', 'competicion', 'perfil', 'vacaciones', 'cuenta', 'atajos'] },
];

/** Todos los temas en el orden del índice. */
const ORDER = CHAPTERS.flatMap((c) => c.topics);

// ── La ventana ───────────────────────────────────────────────────────────────

const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

/** Resalta `q` en el texto (no dentro de las etiquetas). */
function highlight(html, q) {
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return `>${html}<`.replace(/>([^<]+)</g, (m, text) => `>${text.replace(re, '<mark>$&</mark>')}<`).slice(1, -1);
}

function navHtml(current, matches) {
  return CHAPTERS.map(
    (c) => `<div class="guide-chapter"><h5>${c.title}</h5>${c.topics
      .map((id) => {
        const t = TOPICS[id];
        const cls = [id === current && 'active', matches && !matches.has(id) && 'dim'].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-guide="${id}">${t.icon} ${t.title}</button>`;
      })
      .join('')}</div>`,
  ).join('');
}

function articleHtml(id) {
  const t = TOPICS[id];
  const i = ORDER.indexOf(id);
  const chapter = CHAPTERS.find((c) => c.topics.includes(id));
  const prev = ORDER[i - 1];
  const next = ORDER[i + 1];
  return `<div class="guide-crumb">${chapter.title} · ${chapter.topics.indexOf(id) + 1} de ${chapter.topics.length}</div>
    <h4 class="guide-title">${t.icon} ${t.title}</h4>
    <div class="guide-body">${t.body()}</div>
    <div class="guide-pager">
      ${prev ? `<button type="button" class="ghost small" data-guide="${prev}">← ${TOPICS[prev].title}</button>` : '<span></span>'}
      ${next ? `<button type="button" class="ghost small" data-guide="${next}">${TOPICS[next].title} →</button>` : ''}
    </div>`;
}

function resultsHtml(ids, q) {
  if (!ids.length) return `<p class="muted">No hay nada sobre «${escapeHtml(q)}». Prueba con otra palabra.</p>`;
  return `<p class="muted small">${ids.length === 1 ? 'Un tema habla' : `${ids.length} temas hablan`} de «${escapeHtml(q)}»</p>${ids
    .map((id) => {
      const t = TOPICS[id];
      return `<section class="guide-result"><h4 class="guide-title"><button type="button" class="link" data-guide="${id}">${t.icon} ${t.title}</button></h4><div class="guide-body">${highlight(t.body(), q)}</div></section>`;
    })
    .join('')}`;
}

/**
 * Abre la guía. `topic`: el tema que enseñar (si no, el último que se leyó);
 * `query`: lo que se busca (enseña todos los temas que lo mencionan).
 */
export function openGuide(hud, { topic, query = '' } = {}) {
  if (topic && TOPICS[topic]) hud.guideTopic = topic;
  const current = TOPICS[hud.guideTopic] ? hud.guideTopic : ORDER[0];
  const q = query.trim().toLowerCase();
  const found = q ? ORDER.filter((id) => TOPICS[id].title.toLowerCase().includes(q) || plain(TOPICS[id].body()).includes(q)) : null;
  hud.showModal(
    'guide',
    `<div class="modal-card guide-card">
      <div class="panel-head"><span class="panel-icon">📖</span><div><h3>Guía del juego</h3><div class="panel-lvl">Todo lo que hay que saber para gobernar tu imperio</div></div>
      <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
      <input class="guide-search" type="search" placeholder="🔎 Buscar en la guía: colonias, piratas, bloqueo…" value="${escapeHtml(query)}" aria-label="Buscar en la guía" />
      <div class="guide-layout">
        <nav class="guide-nav" aria-label="Temas de la guía">${navHtml(q ? null : current, found ? new Set(found) : null)}</nav>
        <article class="guide-article">${q ? resultsHtml(found, q) : articleHtml(current)}</article>
      </div>
    </div>`,
  );
  if (!q) {
    hud.modal.scrollTop = 0;
    // Que se vea el tema abierto en el índice (en el móvil es una tira horizontal)
    const active = hud.modal.querySelector('.guide-nav .active');
    const nav = active?.closest('.guide-nav');
    if (nav) {
      nav.scrollLeft = active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2;
      nav.scrollTop = active.offsetTop - nav.clientHeight / 2 + active.offsetHeight / 2;
    }
  }
  const input = hud.modal.querySelector('.guide-search');
  // Si el HTML no ha cambiado, la ventana no se rehace y el buscador ya escucha
  if (input.dataset.bound) return;
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    openGuide(hud, { query: input.value });
    const again = hud.modal.querySelector('.guide-search');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}
