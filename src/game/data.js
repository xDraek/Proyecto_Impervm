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
    description: 'Amplía la capacidad máxima de todos los recursos.',
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
    description: 'Brújulas y velas latinas. Nivel 1: trirremes. Nivel 3: galeones.',
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
// angle/dist: posición respecto a tu isla (0° = hacia la cámara inicial).
// loot: botín acumulado { max total, rate por hora, mix de recursos }.

export const ISLAND_TYPES = {
  barbaros: { name: 'Campamento bárbaro', icon: '🪓' },
  piratas: { name: 'Fortaleza pirata', icon: '☠️' },
  ruinas: { name: 'Ruinas antiguas', icon: '🏺' },
  libre: { name: 'Isla deshabitada', icon: '🌴' },
  kraken: { name: 'Guarida del Kraken', icon: '🐙' },
};

export const ISLANDS = [
  {
    id: 'gaviotas', name: 'Isla de las Gaviotas', angle: 18, dist: 68, size: 6, type: 'barbaros', tier: 1,
    garrison: { barbaro: 8 }, regenHours: 6, loot: { max: 1500, rate: 150, mix: { madera: 0.5, comida: 0.5 } },
  },
  {
    id: 'faro', name: 'Cayo del Faro', angle: 72, dist: 82, size: 4.5, type: 'ruinas',
    treasure: { piedra: 600, cristal: 300, oro: 150 },
  },
  { id: 'esmeralda', name: 'Cayo Esmeralda', angle: 122, dist: 74, size: 7, type: 'libre', specialty: 'madera', yield: 150 },
  {
    id: 'cuervo', name: 'Roca del Cuervo', angle: 165, dist: 92, size: 5.5, type: 'barbaros', tier: 2,
    garrison: { barbaro: 18, arquero: 6 }, regenHours: 6, loot: { max: 3200, rate: 260, mix: { madera: 0.3, piedra: 0.3, comida: 0.4 } },
  },
  { id: 'ancla', name: 'Islote del Ancla', angle: 212, dist: 84, size: 6, type: 'libre', specialty: 'comida', yield: 160 },
  {
    id: 'bruma', name: 'Isla Brumosa', angle: 268, dist: 80, size: 6.5, type: 'barbaros', tier: 2,
    garrison: { barbaro: 14, arquero: 10 }, regenHours: 6, loot: { max: 3000, rate: 240, mix: { piedra: 0.4, hierro: 0.3, comida: 0.3 } },
  },
  { id: 'salitre', name: 'Monte Salitre', angle: 318, dist: 96, size: 8, type: 'libre', specialty: 'piedra', yield: 130 },
  {
    id: 'ceniza', name: 'Isla Ceniza', angle: 350, dist: 128, size: 5, type: 'ruinas',
    treasure: { hierro: 1200, cristal: 800, oro: 500 },
  },
  {
    id: 'penon', name: 'Peñón Rojo', angle: 52, dist: 138, size: 7, type: 'barbaros', tier: 3,
    garrison: { barbaro: 40, arquero: 22 }, regenHours: 8, loot: { max: 7000, rate: 450, mix: { madera: 0.25, piedra: 0.25, hierro: 0.25, cristal: 0.25 } },
  },
  { id: 'dorada', name: 'Bahía Dorada', angle: 140, dist: 142, size: 7.5, type: 'libre', specialty: 'oro', yield: 70 },
  {
    id: 'tormenta', name: 'Cabo Tormenta', angle: 194, dist: 152, size: 8, type: 'piratas', tier: 4,
    garrison: { pirata: 45, corsario: 6 }, wall: 0.2, regenHours: 10,
    loot: { max: 14000, rate: 700, mix: { hierro: 0.3, cristal: 0.3, oro: 0.4 } },
  },
  { id: 'triton', name: 'Arrecife del Tritón', angle: 246, dist: 166, size: 6, type: 'libre', specialty: 'cristal', yield: 90 },
  {
    id: 'calavera', name: 'Isla Calavera', angle: 298, dist: 178, size: 9, type: 'piratas', tier: 5,
    garrison: { pirata: 90, corsario: 14 }, wall: 0.3, regenHours: 12,
    loot: { max: 24000, rate: 1000, mix: { madera: 0.2, hierro: 0.3, cristal: 0.2, oro: 0.3 } },
  },
  { id: 'herrumbre', name: 'Isla Herrumbre', angle: 8, dist: 190, size: 6.5, type: 'libre', specialty: 'hierro', yield: 110 },
  {
    id: 'kraken', name: 'Fosa del Kraken', angle: 98, dist: 222, size: 8, type: 'kraken', tier: 7,
    garrison: { kraken: 1, corsario: 10 }, wall: 0.4, regenHours: 36,
    loot: { max: 60000, rate: 1200, mix: { hierro: 0.2, cristal: 0.3, oro: 0.5 } },
  },
];

export const ISLAND_BY_ID = Object.fromEntries(ISLANDS.map((i) => [i.id, i]));

/** Recursos que viajan en el mercante para fundar una colonia (se multiplican por colonia). */
export const COLONY_COST = { madera: 1500, piedra: 1000, comida: 800, oro: 300 };

export const MISSION_TYPES = {
  explorar: { name: 'Explorar', icon: '🔭' },
  atacar: { name: 'Atacar', icon: '⚔️' },
  colonizar: { name: 'Colonizar', icon: '🚩' },
};
