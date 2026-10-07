// Datos del juego: recursos, edificios, unidades, investigaciones e islas.
// Los requisitos (`requires`) mezclan edificios e investigaciones: los ids no se repiten.

export const RESOURCES = {
  madera: { name: 'Madera', icon: '🪵', color: '#c8935f', value: 1 },
  piedra: { name: 'Piedra', icon: '🪨', color: '#a9b1bb', value: 1.2 },
  comida: { name: 'Comida', icon: '🥖', color: '#9ccc65', value: 0.9 },
  hierro: { name: 'Hierro', icon: '🔩', color: '#8fa3bf', value: 1.6 },
  cristal: { name: 'Cristal', icon: '💎', color: '#7fd4ff', value: 2 },
  oro: { name: 'Oro', icon: '🪙', color: '#f2c94c', value: 2.5 },
};

export const RESOURCE_KEYS = Object.keys(RESOURCES);

// Lo que la isla produce por sí sola, sin edificios (por hora).
export const BASE_PRODUCTION = { madera: 60, piedra: 40, comida: 40, hierro: 0, cristal: 0, oro: 0 };

export const STARTING_RESOURCES = { madera: 500, piedra: 400, comida: 300, hierro: 0, cristal: 0, oro: 0 };

// ── Edificios ────────────────────────────────────────────────────────────────

export const BUILDINGS = {
  ayuntamiento: {
    name: 'Ayuntamiento',
    icon: '🏛️',
    description: 'El corazón de tu imperio. Cada nivel acelera las obras un 10 % y desbloquea nuevos edificios. Desde el nivel 3 tu isla llama la atención de los piratas.',
    baseCost: { madera: 200, piedra: 150 },
    costFactor: 1.8,
    baseTime: 90,
    startLevel: 1,
  },
  aserradero: {
    name: 'Aserradero',
    icon: '🪓',
    description: 'Tala los bosques de la isla y produce madera.',
    produces: 'madera',
    baseProduction: 60,
    baseCost: { madera: 60, piedra: 15 },
    costFactor: 1.5,
    baseTime: 30,
    startLevel: 1,
  },
  cantera: {
    name: 'Cantera',
    icon: '⛏️',
    description: 'Extrae bloques de piedra de la montaña.',
    produces: 'piedra',
    baseProduction: 45,
    baseCost: { madera: 50, piedra: 25 },
    costFactor: 1.5,
    baseTime: 35,
    startLevel: 1,
  },
  granja: {
    name: 'Granja',
    icon: '🌾',
    description: 'Campos de trigo y graneros. Produce la comida que necesitan tus tropas.',
    produces: 'comida',
    baseProduction: 50,
    baseCost: { madera: 70, piedra: 20 },
    costFactor: 1.5,
    baseTime: 35,
  },
  mina: {
    name: 'Mina de cristal',
    icon: '💎',
    description: 'Excava las vetas de cristal que hay bajo la isla.',
    produces: 'cristal',
    baseProduction: 25,
    baseCost: { madera: 120, piedra: 80 },
    costFactor: 1.6,
    baseTime: 60,
    requires: { ayuntamiento: 2 },
  },
  fundicion: {
    name: 'Fundición',
    icon: '🔥',
    description: 'Funde el mineral de la montaña y forja lingotes de hierro para armas y barcos.',
    produces: 'hierro',
    baseProduction: 25,
    baseCost: { madera: 140, piedra: 110 },
    costFactor: 1.6,
    baseTime: 65,
    requires: { ayuntamiento: 2, cantera: 2 },
  },
  mercado: {
    name: 'Mercado',
    icon: '⚖️',
    description: 'Los comerciantes pagan impuestos en oro y te dejan cambiar unos recursos por otros.',
    produces: 'oro',
    baseProduction: 15,
    baseCost: { madera: 150, piedra: 100, cristal: 40 },
    costFactor: 1.6,
    baseTime: 75,
    requires: { ayuntamiento: 3 },
  },
  almacen: {
    name: 'Almacén',
    icon: '📦',
    description: 'Amplía la capacidad máxima de todos los recursos y esconde una parte de cada uno, que los piratas no pueden robar.',
    baseCost: { madera: 100, piedra: 60 },
    costFactor: 1.7,
    baseTime: 45,
  },
  academia: {
    name: 'Academia',
    icon: '📚',
    description: 'Los sabios investigan nuevas técnicas. Cada nivel acelera las investigaciones un 10 % y desbloquea otras nuevas.',
    baseCost: { madera: 160, piedra: 140 },
    costFactor: 1.75,
    baseTime: 80,
    requires: { ayuntamiento: 2 },
  },
  templo: {
    name: 'Templo',
    icon: '🛕',
    description: 'Los sacerdotes ganan el favor de los dioses, que puedes gastar en poderes divinos. Cada nivel da más favor por hora y permite acumular más.',
    baseCost: { madera: 250, piedra: 350, cristal: 60 },
    costFactor: 1.7,
    baseTime: 110,
    requires: { ayuntamiento: 3, academia: 1 },
  },
  cuartel: {
    name: 'Cuartel',
    icon: '🛡️',
    description: 'Entrena tropas de tierra. Cada nivel entrena un 10 % más rápido y desbloquea nuevas unidades.',
    baseCost: { madera: 150, piedra: 100 },
    costFactor: 1.65,
    baseTime: 70,
    requires: { ayuntamiento: 2 },
  },
  puerto: {
    name: 'Puerto',
    icon: '⚓',
    description: 'Astillero y muelles. Construye barcos y permite tener una flota más en el mar por cada nivel.',
    baseCost: { madera: 200, piedra: 80 },
    costFactor: 1.7,
    baseTime: 90,
    requires: { ayuntamiento: 2 },
  },
  muralla: {
    name: 'Muralla',
    icon: '🏰',
    description: 'Rodea la ciudad. Cada nivel da un 10 % más de vida a los defensores y sus torres disparan a los asaltantes.',
    baseCost: { madera: 60, piedra: 250 },
    costFactor: 1.75,
    baseTime: 100,
    requires: { cuartel: 1 },
  },
  coloso: {
    name: 'Coloso',
    icon: '🗽',
    description: 'Una maravilla del mundo que vigila el mar. Cada nivel aumenta un 5 % toda la producción. Al nivel 10, tu imperio será leyenda.',
    baseCost: { madera: 5000, piedra: 8000, hierro: 2000, cristal: 3000, oro: 2000 },
    costFactor: 1.45,
    baseTime: 3600,
    maxLevel: 10,
    requires: { ayuntamiento: 8, arquitectura: 4 },
  },
};

export const BUILDING_KEYS = Object.keys(BUILDINGS);

// ── Unidades ─────────────────────────────────────────────────────────────────
// atk: daño por asalto · hp: vida · upkeep: comida por hora · size: plazas en barco
// Barcos: speed (multiplicador), cargo (botín que cargan), capacity (plazas para tropas)

export const UNITS = {
  lancero: {
    name: 'Lancero',
    icon: '🔱',
    kind: 'tierra',
    building: 'cuartel',
    description: 'Infantería barata y dura. La base de cualquier defensa.',
    cost: { madera: 40, comida: 30 },
    time: 40,
    atk: 5,
    hp: 18,
    upkeep: 1,
    size: 1,
    requires: { cuartel: 1 },
  },
  arquero: {
    name: 'Arquero',
    icon: '🏹',
    kind: 'tierra',
    building: 'cuartel',
    description: 'Mucho daño a distancia, pero poca vida.',
    cost: { madera: 60, comida: 30 },
    time: 50,
    atk: 11,
    hp: 9,
    upkeep: 1,
    size: 1,
    requires: { cuartel: 2 },
  },
  espadachin: {
    name: 'Espadachín',
    icon: '⚔️',
    kind: 'tierra',
    building: 'cuartel',
    description: 'Soldado de élite con espada y escudo de hierro.',
    cost: { madera: 30, hierro: 45, comida: 40 },
    time: 75,
    atk: 15,
    hp: 24,
    upkeep: 2,
    size: 1,
    requires: { cuartel: 3, herreria: 1 },
  },
  caballero: {
    name: 'Caballero',
    icon: '🐎',
    kind: 'tierra',
    building: 'cuartel',
    description: 'Caballería pesada. Ocupa dos plazas en los barcos.',
    cost: { hierro: 90, comida: 80, oro: 25 },
    time: 140,
    atk: 28,
    hp: 38,
    upkeep: 3,
    size: 2,
    requires: { cuartel: 5, equitacion: 1 },
  },
  catapulta: {
    name: 'Catapulta',
    icon: '☄️',
    kind: 'tierra',
    building: 'cuartel',
    description: 'Derriba fortificaciones: cada catapulta resta un 6 % a la defensa de las murallas enemigas.',
    cost: { madera: 220, piedra: 120, hierro: 80 },
    time: 200,
    atk: 40,
    hp: 25,
    upkeep: 3,
    size: 3,
    siege: 0.06,
    requires: { cuartel: 6, asedio: 1 },
  },
  bote: {
    name: 'Bote explorador',
    icon: '🛶',
    kind: 'barco',
    building: 'puerto',
    description: 'Rápido y discreto. Descubre islas desconocidas sin entrar en combate.',
    cost: { madera: 80, comida: 20 },
    time: 40,
    atk: 0,
    hp: 6,
    upkeep: 1,
    speed: 2.2,
    cargo: 0,
    capacity: 0,
    explorer: true,
    requires: { puerto: 1 },
  },
  mercante: {
    name: 'Barco mercante',
    icon: '⛵',
    kind: 'barco',
    building: 'puerto',
    description: 'Transporta 12 soldados y mucho botín. No combate: solo se pierde si cae todo tu ejército.',
    cost: { madera: 160, piedra: 40 },
    time: 90,
    atk: 0,
    hp: 30,
    upkeep: 1,
    speed: 1,
    cargo: 500,
    capacity: 12,
    requires: { puerto: 1 },
  },
  trirreme: {
    name: 'Trirreme',
    icon: '🚣',
    kind: 'barco',
    building: 'puerto',
    description: 'Barco de guerra rápido con espolón.',
    cost: { madera: 240, hierro: 70, oro: 15 },
    time: 150,
    atk: 18,
    hp: 45,
    upkeep: 2,
    speed: 1.35,
    cargo: 120,
    capacity: 4,
    requires: { puerto: 3, navegacion: 1 },
  },
  galeon: {
    name: 'Galeón',
    icon: '🚢',
    kind: 'barco',
    building: 'puerto',
    description: 'Fortaleza flotante: cañones, bodega enorme y sitio para 15 soldados.',
    cost: { madera: 600, hierro: 250, cristal: 80, oro: 60 },
    time: 360,
    atk: 48,
    hp: 130,
    upkeep: 4,
    speed: 1.15,
    cargo: 400,
    capacity: 15,
    requires: { puerto: 6, navegacion: 3 },
  },

  // Unidades que solo usan los enemigos
  barbaro: { name: 'Bárbaro', icon: '🪓', kind: 'tierra', npc: true, atk: 7, hp: 15 },
  pirata: { name: 'Pirata', icon: '🏴‍☠️', kind: 'tierra', npc: true, atk: 11, hp: 17 },
  corsario: { name: 'Barco corsario', icon: '⛵', kind: 'barco', npc: true, atk: 20, hp: 50 },
  kraken: { name: 'Kraken', icon: '🐙', kind: 'barco', npc: true, atk: 260, hp: 2600 },
};

export const UNIT_KEYS = Object.keys(UNITS);
export const PLAYER_UNITS = UNIT_KEYS.filter((id) => !UNITS[id].npc);
export const LAND_UNITS = PLAYER_UNITS.filter((id) => UNITS[id].kind === 'tierra');
export const SHIP_UNITS = PLAYER_UNITS.filter((id) => UNITS[id].kind === 'barco');

// ── Investigaciones ──────────────────────────────────────────────────────────

export const RESEARCH = {
  silvicultura: {
    name: 'Silvicultura',
    icon: '🌲',
    description: 'Técnicas de tala y replantado.',
    effect: (n) => `+${n * 10} % de madera`,
    baseCost: { madera: 180, piedra: 120 },
    baseTime: 120,
    requires: { academia: 1 },
  },
  mineria: {
    name: 'Ingeniería minera',
    icon: '⛏️',
    description: 'Galerías más profundas y mejores herramientas.',
    effect: (n) => `+${n * 10} % de piedra y hierro`,
    baseCost: { madera: 150, piedra: 150 },
    baseTime: 130,
    requires: { academia: 1 },
  },
  agricultura: {
    name: 'Irrigación',
    icon: '💧',
    description: 'Acequias y molinos para regar los campos.',
    effect: (n) => `+${n * 10} % de comida`,
    baseCost: { madera: 160, piedra: 80 },
    baseTime: 110,
    requires: { academia: 1 },
  },
  cristalografia: {
    name: 'Cristalografía',
    icon: '🔬',
    description: 'Los sabios aprenden a tallar el cristal sin romperlo.',
    effect: (n) => `+${n * 10} % de cristal`,
    baseCost: { madera: 200, cristal: 120 },
    baseTime: 160,
    requires: { academia: 2, mineria: 1 },
  },
  arquitectura: {
    name: 'Arquitectura',
    icon: '📐',
    description: 'Planos, grúas y andamios mejores.',
    effect: (n) => `Obras un ${n * 8} % más rápidas`,
    baseCost: { madera: 300, piedra: 300, cristal: 60 },
    baseTime: 200,
    requires: { academia: 2 },
  },
  logistica: {
    name: 'Logística',
    icon: '🧺',
    description: 'Estanterías, toneles y un buen inventario.',
    effect: (n) => `+${n * 20} % de capacidad del almacén`,
    baseCost: { madera: 250, piedra: 250 },
    baseTime: 180,
    requires: { academia: 2, almacen: 2 },
  },
  comercio: {
    name: 'Comercio',
    icon: '📜',
    description: 'Contratos, letras de cambio y rutas comerciales.',
    effect: (n) => `+${n * 10} % de oro y mejores cambios en el mercado`,
    baseCost: { madera: 300, cristal: 150, oro: 50 },
    baseTime: 240,
    requires: { academia: 3, mercado: 1 },
  },
  herreria: {
    name: 'Herrería',
    icon: '⚒️',
    description: 'Armas de hierro templado. El nivel 1 permite entrenar espadachines.',
    effect: (n) => `+${n * 10} % de ataque`,
    baseCost: { madera: 150, hierro: 200 },
    baseTime: 200,
    requires: { academia: 2, fundicion: 1 },
  },
  armaduras: {
    name: 'Armaduras',
    icon: '🦺',
    description: 'Cotas de malla y escudos reforzados.',
    effect: (n) => `+${n * 10} % de vida de tus tropas`,
    baseCost: { piedra: 150, hierro: 250 },
    baseTime: 220,
    requires: { academia: 3, herreria: 1 },
  },
  equitacion: {
    name: 'Equitación',
    icon: '🐎',
    description: 'Cría de caballos de guerra. Permite entrenar caballeros.',
    effect: () => 'Desbloquea el caballero',
    baseCost: { comida: 600, hierro: 300, oro: 100 },
    baseTime: 400,
    maxLevel: 1,
    requires: { academia: 4, herreria: 2 },
  },
  asedio: {
    name: 'Ingeniería de asedio',
    icon: '☄️',
    description: 'Contrapesos, poleas y proyectiles de piedra. Permite construir catapultas.',
    effect: () => 'Desbloquea la catapulta',
    baseCost: { madera: 800, hierro: 500, cristal: 200 },
    baseTime: 600,
    maxLevel: 1,
    requires: { academia: 5, herreria: 3 },
  },
  navegacion: {
    name: 'Navegación',
    icon: '🧭',
    description: 'Brújulas y velas latinas. Nivel 1: trirremes. Nivel 2: expediciones al Mar de las Brumas. Nivel 3: galeones.',
    effect: (n) => `Flotas un ${n * 10} % más rápidas`,
    baseCost: { madera: 300, cristal: 100 },
    baseTime: 220,
    requires: { academia: 2, puerto: 2 },
  },
  cartografia: {
    name: 'Cartografía',
    icon: '🗺️',
    description: 'Cartas náuticas de todo el archipiélago. Cada nivel te deja fundar una colonia más.',
    effect: (n) => `${n} ${n === 1 ? 'colonia' : 'colonias'} como máximo`,
    baseCost: { madera: 500, cristal: 300, oro: 150 },
    baseTime: 360,
    maxLevel: 4,
    requires: { academia: 3, navegacion: 1 },
  },
};

export const RESEARCH_KEYS = Object.keys(RESEARCH);
export const RESEARCH_COST_FACTOR = 1.9;

// ── Archipiélago ─────────────────────────────────────────────────────────────
// Las islas se generan por sectores en game/world.js.

export const ISLAND_TYPES = {
  barbaros: { name: 'Campamento bárbaro', icon: '🪓' },
  piratas: { name: 'Fortaleza pirata', icon: '☠️' },
  ruinas: { name: 'Ruinas antiguas', icon: '🏺' },
  libre: { name: 'Isla deshabitada', icon: '🌴' },
  kraken: { name: 'Guarida del Kraken', icon: '🐙' },
  brumas: { name: 'Mar abierto', icon: '🌫️' },
  jugador: { name: 'Ciudad', icon: '🏰' },
};

/** Recursos que viajan en el mercante para fundar una colonia (se multiplican por colonia). */
export const COLONY_COST = { madera: 1500, piedra: 1000, comida: 800, oro: 300 };

export const MISSION_TYPES = {
  explorar: { name: 'Explorar', icon: '🔭' },
  atacar: { name: 'Atacar', icon: '⚔️' },
  colonizar: { name: 'Colonizar', icon: '🚩' },
  expedicion: { name: 'Expedición', icon: '🧭' },
  transporte: { name: 'Transporte', icon: '📦' },
  apoyo: { name: 'Apoyo', icon: '🛡️' },
};

// ── Templo ───────────────────────────────────────────────────────────────────
// duration: horas de juego que dura el efecto (0 = instantáneo).

export const POWERS = {
  cosecha: {
    name: 'Cosecha abundante',
    icon: '🌾',
    description: '+25 % de toda la producción durante 2 horas.',
    cost: 60,
    duration: 2,
  },
  inspiracion: {
    name: 'Inspiración',
    icon: '🦉',
    description: 'La obra y la investigación en curso terminan un 30 % antes.',
    cost: 50,
    duration: 0,
  },
  viento: {
    name: 'Viento favorable',
    icon: '🌬️',
    description: 'Tus flotas en el mar se ahorran la mitad de lo que les queda de trayecto.',
    cost: 70,
    duration: 0,
  },
  egida: {
    name: 'Égida',
    icon: '🛡️',
    description: '+50 % de vida para los defensores de tu isla durante 3 horas.',
    cost: 80,
    duration: 3,
  },
  rayo: {
    name: 'Ira de los dioses',
    icon: '⚡',
    description: 'Un rayo hunde el 40 % de la flota pirata que se acerca.',
    cost: 120,
    duration: 0,
  },
};

export const POWER_KEYS = Object.keys(POWERS);

// ── Misiones (objetivos con recompensa) ──────────────────────────────────────
// goal(game) → [actual, objetivo]. Se muestran en orden, unas pocas a la vez.

const lvl = (id, n) => (g) => [Math.min(g.level(id), n), n];
const res = (id, n) => (g) => [Math.min(g.researchLevel(id), n), n];
const stat = (key, n) => (g) => [Math.min(g.stats[key] ?? 0, n), n];

export const QUESTS = [
  { id: 'q-aserradero', title: 'Más madera', text: 'Mejora el aserradero a nivel 2.', goal: lvl('aserradero', 2), reward: { madera: 150, piedra: 100 } },
  { id: 'q-granja', title: 'Pan para todos', text: 'Construye la granja.', goal: lvl('granja', 1), reward: { comida: 250, madera: 100 } },
  { id: 'q-cantera', title: 'Cimientos', text: 'Mejora la cantera a nivel 2.', goal: lvl('cantera', 2), reward: { piedra: 200 } },
  { id: 'q-almacen', title: 'Un lugar para todo', text: 'Construye el almacén.', goal: lvl('almacen', 1), reward: { madera: 200, piedra: 150 } },
  { id: 'q-ayto2', title: 'Villa en crecimiento', text: 'Mejora el ayuntamiento a nivel 2.', goal: lvl('ayuntamiento', 2), reward: { madera: 300, piedra: 300, comida: 200 } },
  { id: 'q-academia', title: 'Amor al saber', text: 'Construye la academia.', goal: lvl('academia', 1), reward: { madera: 250, piedra: 250 } },
  { id: 'q-silvi', title: 'Primeros sabios', text: 'Investiga Silvicultura.', goal: res('silvicultura', 1), reward: { madera: 400 } },
  { id: 'q-cuartel', title: 'Hombres de armas', text: 'Construye el cuartel.', goal: lvl('cuartel', 1), reward: { comida: 300, madera: 200 } },
  { id: 'q-lanceros', title: 'La primera guardia', text: 'Ten 10 lanceros en tu ejército.', goal: (g) => [Math.min(g.armyCount('lancero'), 10), 10], reward: { comida: 300, madera: 300 } },
  { id: 'q-puerto', title: 'Rumbo al mar', text: 'Construye el puerto.', goal: lvl('puerto', 1), reward: { madera: 400, piedra: 200 } },
  { id: 'q-explora', title: 'Tierra a la vista', text: 'Explora una isla del archipiélago.', goal: (g) => [Math.min(g.exploredCount(), 1), 1], reward: { madera: 300, comida: 300 } },
  { id: 'q-fundicion', title: 'Edad del hierro', text: 'Construye la fundición.', goal: lvl('fundicion', 1), reward: { piedra: 400, comida: 200 } },
  { id: 'q-ayto3', title: 'Ciudad', text: 'Mejora el ayuntamiento a nivel 3. ¡Cuidado con los piratas!', goal: lvl('ayuntamiento', 3), reward: { madera: 600, piedra: 600, hierro: 200 } },
  { id: 'q-muralla', title: 'Puertas cerradas', text: 'Construye la muralla.', goal: lvl('muralla', 1), reward: { piedra: 600 } },
  { id: 'q-saqueo', title: 'Botín bárbaro', text: 'Gana un ataque contra una isla enemiga.', goal: stat('victories', 1), reward: { hierro: 300, oro: 100 } },
  { id: 'q-mercado', title: 'Comerciantes', text: 'Construye el mercado.', goal: lvl('mercado', 1), reward: { oro: 200, cristal: 150 } },
  { id: 'q-defensa', title: 'Ni un paso atrás', text: 'Rechaza un asalto pirata.', goal: stat('raidsRepelled', 1), reward: { oro: 300, hierro: 300 } },
  { id: 'q-templo', title: 'Favor divino', text: 'Construye el templo.', goal: lvl('templo', 1), reward: { cristal: 300, oro: 150 } },
  { id: 'q-poder', title: 'Los dioses escuchan', text: 'Invoca un poder divino.', goal: stat('powers', 1), reward: { favor: 40 } },
  { id: 'q-tesoro', title: 'Cazatesoros', text: 'Encuentra el tesoro de unas ruinas.', goal: stat('treasures', 1), reward: { oro: 300 } },
  { id: 'q-cartografia', title: 'Cartas náuticas', text: 'Investiga Cartografía.', goal: res('cartografia', 1), reward: { madera: 800, comida: 800 } },
  { id: 'q-colonia', title: 'Nuevo mundo', text: 'Funda tu primera colonia.', goal: (g) => [Math.min(g.colonies().length, 1), 1], reward: { oro: 500, cristal: 400 } },
  { id: 'q-expedicion', title: 'Más allá de la niebla', text: 'Vuelve de una expedición al Mar de las Brumas.', goal: stat('expeditions', 1), reward: { hierro: 600, oro: 300 } },
  { id: 'q-ejercito', title: 'Gran ejército', text: 'Ten 100 tropas de tierra.', goal: (g) => [Math.min(g.landArmy(), 100), 100], reward: { comida: 2000, hierro: 800 } },
  { id: 'q-saqueos', title: 'Terror de los mares', text: 'Gana 10 ataques.', goal: stat('victories', 10), reward: { oro: 1500, cristal: 1000 } },
  { id: 'q-ayto8', title: 'Capital del archipiélago', text: 'Mejora el ayuntamiento a nivel 8.', goal: lvl('ayuntamiento', 8), reward: { madera: 5000, piedra: 5000, oro: 1000 } },
  { id: 'q-kraken', title: 'Matador de monstruos', text: 'Derrota al Kraken.', goal: stat('kraken', 1), reward: { oro: 5000, cristal: 5000 } },
  { id: 'q-coloso1', title: 'Primera piedra', text: 'Empieza el Coloso (nivel 1).', goal: lvl('coloso', 1), reward: { oro: 2000, hierro: 2000 } },
  { id: 'q-coloso', title: 'Leyenda eterna', text: 'Termina el Coloso (nivel 10).', goal: lvl('coloso', 10), reward: { oro: 20000 } },
];

// ── Visitantes que llegan a la isla de vez en cuando ─────────────────────────

// ── Recompensa diaria ────────────────────────────────────────────────────────
// Un regalo por día seguido que entras (el séptimo es el mejor). Se multiplica
// por el nivel del ayuntamiento para que siga valiendo la pena.

export const DAILY_REWARDS = [
  { madera: 200, piedra: 150 },
  { comida: 300, madera: 150 },
  { piedra: 250, hierro: 80 },
  { cristal: 120, comida: 200 },
  { hierro: 150, oro: 60 },
  { cristal: 200, oro: 100 },
  { oro: 250, cristal: 250, favor: 30 },
];

// ── Logros ───────────────────────────────────────────────────────────────────
// Se ganan solos al cumplirse y se enseñan en el perfil del jugador.

export const ACHIEVEMENTS = [
  { id: 'saqueador', icon: '⚔️', name: 'Saqueador', text: 'Gana 10 ataques', check: (g) => g.stats.victories >= 10 },
  { id: 'conquistador', icon: '👑', name: 'Conquistador', text: 'Gana 50 ataques', check: (g) => g.stats.victories >= 50 },
  { id: 'azote', icon: '🗡️', name: 'Azote de reyes', text: 'Saquea 5 ciudades de otros jugadores', check: (g) => g.stats.pvpWins >= 5 },
  { id: 'muralla', icon: '🏰', name: 'Inexpugnable', text: 'Rechaza 5 asaltos', check: (g) => g.stats.raidsRepelled >= 5 },
  { id: 'explorador', icon: '🔭', name: 'Explorador', text: 'Explora 10 islas', check: (g) => g.exploredCount() >= 10 },
  { id: 'navegante', icon: '🧭', name: 'Lobo de mar', text: 'Completa 10 expediciones', check: (g) => g.stats.expeditions >= 10 },
  { id: 'colono', icon: '🚩', name: 'Fundador', text: 'Ten 3 colonias', check: (g) => g.colonies().length >= 3 },
  { id: 'tesoros', icon: '🏺', name: 'Cazatesoros', text: 'Encuentra 2 tesoros', check: (g) => g.stats.treasures >= 2 },
  { id: 'mercader', icon: '⚖️', name: 'Mercader', text: 'Cierra 10 tratos en el mercado', check: (g) => (g.stats.trades ?? 0) >= 10 },
  { id: 'generoso', icon: '📦', name: 'Buen vecino', text: 'Entrega 10 transportes', check: (g) => (g.stats.transports ?? 0) >= 10 },
  { id: 'devoto', icon: '🛕', name: 'Devoto', text: 'Invoca 20 poderes divinos', check: (g) => g.stats.powers >= 20 },
  { id: 'constante', icon: '📅', name: 'Constante', text: 'Entra 7 días seguidos', check: (g) => (g.state.daily?.best ?? 0) >= 7 },
  { id: 'imperio', icon: '🏛️', name: 'Imperio', text: 'Llega a 10.000 puntos', check: (g) => g.score() >= 10000 },
  { id: 'kraken', icon: '🐙', name: 'Matador del Kraken', text: 'Derrota al Kraken', check: (g) => g.stats.kraken >= 1 },
  { id: 'leyenda', icon: '🗽', name: 'Leyenda', text: 'Termina el Coloso', check: (g) => g.level('coloso') >= 10 },
];

// ── Almirante (héroe) ────────────────────────────────────────────────────────
// Acompaña a una flota o se queda defendiendo la isla. Gana experiencia en
// cada combate y, con cada nivel, un punto para una de sus cuatro habilidades.

export const HERO = {
  cost: { oro: 600, comida: 400 },
  requires: { ayuntamiento: 3 },
  maxLevel: 30,
  /** Experiencia total para llegar a `level`. */
  xpFor: (level) => Math.round(80 * (level - 1) ** 1.6),
  woundHours: 2,
};

export const HERO_SKILLS = {
  ataque: { name: 'Ataque', icon: '⚔️', text: (n) => `+${n * 3} % de ataque de la flota que acompaña`, per: 0.03 },
  defensa: { name: 'Defensa', icon: '🛡️', text: (n) => `+${n * 3} % de vida de los defensores mientras esté en casa`, per: 0.03 },
  botin: { name: 'Botín', icon: '💰', text: (n) => `+${n * 5} % de carga de la flota que acompaña`, per: 0.05 },
  velocidad: { name: 'Navegación', icon: '💨', text: (n) => `Su flota navega un ${n * 4} % más rápido`, per: 0.04 },
};

export const VISITORS = {
  mercader: { name: 'Mercader ambulante', icon: '🧳' },
  mercenarios: { name: 'Mercenarios', icon: '🗡️' },
  peregrinos: { name: 'Peregrinos', icon: '🕯️' },
  naufragio: { name: 'Restos de un naufragio', icon: '🛟' },
};
