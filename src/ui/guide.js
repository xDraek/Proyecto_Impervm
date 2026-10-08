import { NEWBIE_POINTS } from '../game/Game.js';
import { CONTEST_DAYS, HORDE, JOINT_MAX, RELIC_SLOTS, VACATION, WONDER_LEVELS } from '../game/data.js';
import { escapeHtml } from './format.js';

// Guía del juego: todo lo que hay que saber, por temas y con buscador.

const TOPICS = [
  {
    icon: '🚀',
    title: 'Primeros pasos',
    body: `<p>Tu isla produce recursos sin parar, también con el juego cerrado. Gástalos en mejorar edificios: cada mejora produce más o desbloquea cosas nuevas.</p>
      <p>Como en Ikariam, el juego <b>no tiene final</b> ni condición de victoria: tu imperio crece mientras quieras jugar, y cada semana hay competición y premios.</p>
      <p>Sigue las <b>misiones</b> (📋): te dicen qué hacer y dan recompensas. Cada día tienes además <b>encargos</b> y un <b>regalo diario</b> 🎁.</p>`,
  },
  {
    icon: '🪵',
    title: 'Recursos y almacén',
    body: `<p>Madera, piedra, comida, hierro, cristal y oro. La isla da un poco de cada uno y los edificios productores, mucho más.</p>
      <p>El <b>almacén</b> sube el máximo de cada recurso y esconde una parte que nadie te puede robar. Si el almacén está lleno, lo que se produce se pierde.</p>
      <p>Las tropas <b>comen</b>: si la comida llega a cero hay hambruna y toda la producción cae a la mitad. La taberna reduce lo que comen.</p>
      <p>En la <b>taberna</b> también se contratan <b>mercenarios</b> por un día, pagando oro: útiles para una defensa urgente o un ataque puntual.</p>
      <p><b>Trabajadores</b> 👷: en el aserradero, la cantera, la granja, la mina y la fundición eliges qué parte de los trabajadores produce. Los demás comercian y pagan impuestos en oro (la mitad de lo que valdría lo que dejan de producir): útil cuando el almacén se llena o te falta oro.</p>`,
  },
  {
    icon: '🏛️',
    title: 'Edificios e investigaciones',
    body: `<p>El <b>ayuntamiento</b> acelera las obras y desbloquea edificios. Solo se construye una cosa a la vez.</p>
      <p>La <b>academia</b> investiga mejoras: más producción, mejores armas, barcos más rápidos, colonias (Cartografía)… También de una en una.</p>`,
  },
  {
    icon: '⚔️',
    title: 'Tropas, barcos y combate',
    body: `<p>El cuartel entrena tropas de tierra y el puerto construye barcos. Las tropas viajan dentro de los barcos (cada barco tiene plazas) y los barcos cargan el botín.</p>
      <p>El combate dura hasta 6 asaltos: los dos bandos disparan a la vez y el daño se reparte entre los tipos de unidad. Los barcos sin ataque (mercantes, botes) solo caen si cae todo tu ejército.</p>
      <p>La <b>muralla</b> da vida a los defensores y sus torres disparan; la <b>torre de vigía</b> añade arqueros. Las <b>catapultas</b> abren brecha en las fortificaciones enemigas. Usa el <b>simulador</b> 🎲 antes de atacar.</p>`,
  },
  {
    icon: '⛵',
    title: 'Flotas y misiones',
    body: `<p>Pulsa una isla del mapa (tecla M) y elige qué mandas: <b>explorar</b> (botes), <b>atacar</b>, <b>colonizar</b>, <b>conquistar</b>, <b>expedición</b> a la niebla, <b>transporte</b> o <b>apoyo</b> a un aliado.</p>
      <p>El puerto limita cuántas flotas tienes en el mar a la vez. Puedes retirar una flota que aún no ha llegado.</p>`,
  },
  {
    icon: '🗺️',
    title: 'El archipiélago',
    body: `<p>Cada jugador nuevo abre un sector con su isla y una docena de islas neutrales: campamentos bárbaros 🪓 y fortalezas piratas ☠️ que se rearman con el tiempo, ruinas 🏺 con un tesoro para el primero que llegue, islas libres 🌴 para colonizar, la guarida del Kraken 🐙 y el Mar de las Brumas 🌫️ para las expediciones.</p>
      <p>El <b>mapa del mundo</b> 🌍 enseña todo el archipiélago, con las ciudades coloreadas según vuestra relación.</p>`,
  },
  {
    icon: '🏯',
    title: 'Continentes, conquista y maravillas',
    body: `<p>Entre los sectores hay pequeños continentes con <b>ciudades bárbaras</b> amuralladas y valles fértiles. Si tu ejército acaba con toda la guarnición de una ciudad bárbara en una misión de <b>conquista</b>, pasa a ser tuya.</p>
      <p>Cada continente tiene una <b>maravilla</b> de ${WONDER_LEVELS.length} niveles que levantan entre todos los que tienen colonia allí. Todos ellos reciben su efecto.</p>
      <p><b>Invasiones</b> 🔥: cada pocos días desembarca una horda bárbara en los continentes con colonias. Cualquiera puede atacarla durante ${HORDE.warnHours} h y el botín se reparte según los bárbaros que abatió cada uno. Si nadie la detiene, las colonias del continente no producen en ${HORDE.ravageHours} h.</p>`,
  },
  {
    icon: '🚩',
    title: 'Colonias',
    body: `<p>Con Cartografía puedes fundar colonias en islas libres (o conquistar ciudades bárbaras). Cada colonia manda su recurso a tu capital y se puede ampliar hasta el nivel 10.</p>`,
  },
  {
    icon: '🏴‍☠️',
    title: 'Piratas',
    body: `<p>Desde el ayuntamiento 3 llegan piratas de vez en cuando. Los verás venir con tiempo: entrena defensores, sube la muralla o pide apoyo a tus aliados. Si los rechazas, te dejan su botín.</p>`,
  },
  {
    icon: '🏰',
    title: 'Otros jugadores',
    body: `<p>Espía sus ciudades con botes y atácalas para llevarte lo que quepa en tus barcos (salvo lo que esconde su almacén). Con menos de ${NEWBIE_POINTS} puntos tienes <b>protección de novato</b>: nadie te ataca y tú no atacas a jugadores.</p>
      <p>Verás llegar los ataques: aviso arriba, la flota en el mapa y ⚔️ en el título de la pestaña.</p>
      <p><b>Sabotaje</b> 🔥: tus botes se cuelan en una ciudad rival para quemar parte de lo que no está en su almacén o retrasar su obra. Son más fáciles de pillar que los espías: cuidado con su muralla y su torre de vigía.</p>`,
  },
  {
    icon: '🤝',
    title: 'Alianzas',
    body: `<p>Funda una o pide entrar en una. El líder 👑 y sus oficiales ⭐ aceptan las solicitudes. Los aliados no pueden atacarse y tienen chat, foro y circulares.</p>
      <p><b>Apoyo</b>: manda tropas a defender la ciudad de un aliado. <b>Ataques conjuntos</b>: súmate al ataque de un aliado (hasta ${JOINT_MAX} aliados) y combatís como un solo ejército.</p>
      <p><b>Diplomacia</b>: pactos de no agresión y guerras entre alianzas, con marcador de bajas y botín.</p>`,
  },
  {
    icon: '⚖️',
    title: 'Comercio',
    body: `<p>En el <b>mercado</b> cambias recursos al momento (con comisión) o publicas ofertas para otros jugadores. Los <b>transportes</b> llevan recursos en mercantes a la ciudad de cualquiera.</p>`,
  },
  {
    icon: '🛕',
    title: 'Templo y poderes',
    body: `<p>El templo acumula <b>favor</b> de los dioses, que gastas en poderes: cosecha abundante, inspiración para obras e investigaciones, vientos favorables, la égida que protege tu isla o un rayo contra los piratas.</p>`,
  },
  {
    icon: '🎖️',
    title: 'Almirante',
    body: `<p>Un héroe que se contrata en el ayuntamiento. Acompaña a una flota o defiende tu isla, gana experiencia en cada combate y con cada nivel le das un punto de ataque, defensa, botín o navegación. Si su flota cae, vuelve herido y tarda en recuperarse.</p>`,
  },
  {
    icon: '🏺',
    title: 'Reliquias',
    body: `<p>Objetos míticos que aparecen en expediciones, ruinas, conquistas y en la guarida del Kraken. Lleva hasta ${RELIC_SLOTS} equipadas desde el ayuntamiento; las demás se venden por oro.</p>`,
  },
  {
    icon: '📅',
    title: 'Eventos, clima y calendario',
    body: `<p>Cada pocas horas puede empezar una temporada para todos: Fiebre del oro, Festival de Poseidón, Gran feria… El calendario (arriba) enseña las próximas. El clima (lluvia, tormentas) es solo ambientación.</p>`,
  },
  {
    icon: '🏅',
    title: 'Competición semanal',
    body: `<p>Cada ${CONTEST_DAYS} días se premia a los tres mejores en saqueo, militar y construcción, contando solo lo hecho esa semana. Los ganadores quedan en el salón de la fama.</p>`,
  },
  {
    icon: '🏖️',
    title: 'Modo vacaciones',
    body: `<p>Si te vas unos días: nadie te ataca ni te espía y no llegan piratas, pero tu isla tampoco produce. Dura al menos ${VACATION.minHours} horas. Se activa desde ⚙.</p>`,
  },
  {
    icon: '🔑',
    title: 'Tu cuenta',
    body: `<p>Tu cuenta va unida a tu <b>correo</b>: al crearla te mandamos un enlace para confirmarlo, y tu ciudad se funda al abrirlo. Puedes entrar con tu nombre o con tu correo.</p>
      <p>Si olvidas la contraseña, pulsa «¿Has olvidado tu contraseña?» en la pantalla de inicio y te llegará un enlace para poner otra. El correo se cambia en ⚙ → Cuenta y contraseña.</p>`,
  },
  {
    icon: '⌨️',
    title: 'Cámara y atajos de teclado',
    body: `<p><b>M</b>: cambiar entre tu isla y el archipiélago · <b>Esc</b>: cerrar ventanas y paneles · <b>?</b>: esta guía.</p>
      <p><b>1</b> misiones · <b>2</b> chat · <b>3</b> correo · <b>4</b> alianza · <b>5</b> clasificación · <b>6</b> mapa del mundo · <b>7</b> informes.</p>
      <p><b>Cámara</b>: arrastra para moverte, arrastra con el botón derecho (o Mayús) para girar y usa la rueda para acercarte hacia el ratón. Con el teclado: <b>WASD</b> o flechas para moverte, <b>Q</b>/<b>E</b> para girar, <b>+</b>/<b>−</b> para acercar y <b>C</b> para centrar. Doble clic en el suelo o el mar para ir allí. En el móvil, un dedo mueve y dos acercan y giran.</p>`,
  },
];

const plain = (html) => html.replace(/<[^>]+>/g, ' ').toLowerCase();

export function openGuide(hud, query = '') {
  const q = query.trim().toLowerCase();
  const found = TOPICS.filter((t) => !q || t.title.toLowerCase().includes(q) || plain(t.body).includes(q));
  const items = found
    .map((t, i) => `<details class="guide-topic" ${q || i === 0 ? 'open' : ''}><summary>${t.icon} ${t.title}</summary><div class="guide-body">${t.body}</div></details>`)
    .join('');
  hud.showModal(
    'guide',
    `<div class="modal-card">
      <div class="panel-head"><span class="panel-icon">📖</span><div><h3>Guía del juego</h3><div class="panel-lvl">Todo lo que hay que saber para gobernar tu imperio</div></div>
      <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
      <input class="guide-search" type="search" placeholder="Buscar: colonias, piratas, alianza…" value="${escapeHtml(query)}" />
      <div class="guide-list">${items || '<p class="muted">No hay nada sobre eso.</p>'}</div>
    </div>`,
  );
  const input = hud.modal.querySelector('.guide-search');
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    openGuide(hud, input.value);
    const again = hud.modal.querySelector('.guide-search');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}
