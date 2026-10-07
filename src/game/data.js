export const RESOURCES = {
  madera: { name: 'Madera', icon: '🪵', color: '#c8935f' },
  piedra: { name: 'Piedra', icon: '🪨', color: '#a9b1bb' },
  cristal: { name: 'Cristal', icon: '💎', color: '#7fd4ff' },
  oro: { name: 'Oro', icon: '🪙', color: '#f2c94c' },
};

export const RESOURCE_KEYS = Object.keys(RESOURCES);

// Lo que la isla produce por sí sola, sin edificios (por hora).
export const BASE_PRODUCTION = { madera: 60, piedra: 40, cristal: 0, oro: 0 };

export const STARTING_RESOURCES = { madera: 500, piedra: 400, cristal: 0, oro: 0 };

export const BUILDINGS = {
  ayuntamiento: {
    name: 'Ayuntamiento',
    icon: '🏛️',
    description: 'El corazón de tu imperio. Cada nivel acelera las obras un 10 % y desbloquea nuevos edificios.',
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
  mercado: {
    name: 'Mercado',
    icon: '⚖️',
    description: 'Los comerciantes pagan impuestos en oro a tu tesoro.',
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
};

export const BUILDING_KEYS = Object.keys(BUILDINGS);
