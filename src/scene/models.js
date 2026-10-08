import * as THREE from 'three';
import { bakeStatic } from './util.js';

// Modelos low-poly procedurales. Cada edificio crece en detalle con su nivel.
// Convención: los helpers reciben la posición de la BASE del objeto (y = suelo).

export const C = {
  wall: '#efe2c4',
  wallDark: '#dccaa2',
  stone: '#aaa59b',
  stoneDark: '#7d7a73',
  wood: '#8b5a2b',
  woodDark: '#5e3b1c',
  woodLight: '#c08a4a',
  roofRed: '#b8442f',
  roofBlue: '#3f6fa8',
  roofGrey: '#5b6470',
  gold: '#f2c94c',
  crystal: '#6fd6ff',
  dark: '#2b2620',
  barn: '#a0522d',
  white: '#f4efe6',
  dirt: '#b59a6e',
  cloth: ['#d94f4f', '#4f8fd9', '#e3b23c', '#6bbf59'],
};

const materials = new Map();

export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!materials.has(key)) {
    materials.set(
      key,
      new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...extra }),
    );
  }
  return materials.get(key);
}

export function mesh(geo, color, extra) {
  const m = new THREE.Mesh(geo, mat(color, extra));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, extra) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), color, extra);
  m.position.set(x, y + h / 2, z);
  return m;
}

export function cyl(rTop, rBottom, h, seg, color, x = 0, y = 0, z = 0, extra) {
  const m = mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, extra);
  m.position.set(x, y + h / 2, z);
  return m;
}

/** Tejado a dos aguas con la cumbrera a lo largo de Z. */
export function gableRoof(w, h, d, color, x = 0, y = 0, z = 0) {
  const geo = new THREE.CylinderGeometry(1, 1, d, 3);
  geo.rotateX(-Math.PI / 2);
  geo.scale(w / Math.sqrt(3), h / 1.5, 1);
  geo.translate(0, h / 3, 0);
  const m = mesh(geo, color);
  m.position.set(x, y, z);
  return m;
}

export function pyramidRoof(w, h, color, x = 0, y = 0, z = 0) {
  const geo = new THREE.ConeGeometry(w * 0.72, h, 4);
  geo.rotateY(Math.PI / 4);
  const m = mesh(geo, color);
  m.position.set(x, y + h / 2, z);
  return m;
}

function log(len, r, x, y, z, rotY = 0) {
  const m = mesh(new THREE.CylinderGeometry(r, r, len, 7), C.wood);
  m.rotation.set(0, rotY, Math.PI / 2, 'YXZ');
  m.position.set(x, y + r, z);
  return m;
}

// ── Edificios ────────────────────────────────────────────────────────────────

function ayuntamiento(level) {
  const g = new THREE.Group();
  g.add(box(4.4, 0.35, 4.4, C.stone));
  g.add(box(1.8, 0.18, 0.7, C.stone, 0, 0, 2.5));

  const floors = 1 + Math.min(3, Math.floor(level / 3));
  let y = 0.35;
  let w = 3.3;
  let lastW = w;
  for (let i = 0; i < floors; i++) {
    g.add(box(w, 1.1, w, i % 2 ? C.wallDark : C.wall, 0, y, 0));
    for (const x of [-w / 3, 0, w / 3]) {
      const isDoor = i === 0 && x === 0;
      const h = isDoor ? 0.75 : 0.42;
      g.add(box(isDoor ? 0.6 : 0.32, h, 0.05, C.dark, x, y + (isDoor ? 0 : 0.38), w / 2 + 0.01, isDoor ? undefined : WINDOW_GLOW));
      g.add(box(0.05, 0.42, 0.32, C.dark, w / 2 + 0.01, y + 0.38, x, WINDOW_GLOW));
      g.add(box(0.05, 0.42, 0.32, C.dark, -w / 2 - 0.01, y + 0.38, x, WINDOW_GLOW));
    }
    y += 1.1;
    g.add(box(w + 0.24, 0.14, w + 0.24, C.stone, 0, y, 0));
    y += 0.14;
    lastW = w;
    w *= 0.8;
  }

  if (level >= 2) {
    for (const x of [-1.4, -0.7, 0.7, 1.4]) g.add(cyl(0.11, 0.13, 1.1, 8, C.white, x, 0.35, 2.0));
    g.add(box(3.4, 0.16, 0.5, C.stone, 0, 1.45, 2.0));
  }

  g.add(pyramidRoof(lastW + 0.3, 1.5, C.roofBlue, 0, y, 0));

  const top = y + 1.4;
  g.add(cyl(0.04, 0.04, 1.3, 6, C.dark, 0, top, 0));
  const flag = box(0.7, 0.4, 0.03, C.cloth[0], 0, 0, 0);
  flag.geometry.translate(0.35, 0, 0);
  flag.position.set(0, top + 1.0, 0);
  flag.userData.wave = true;
  g.add(flag);
  return g;
}

// ── Trabajadores ─────────────────────────────────────────────────────────────

const TOOL_HEADS = {
  martillo: (arm) => arm.add(box(0.07, 0.1, 0.1, '#4a4f57', 0.27, -0.05, 0, { metalness: 0.5, roughness: 0.4 })),
  hacha: (arm) => arm.add(box(0.05, 0.14, 0.03, '#c9ced6', 0.26, -0.1, 0, { metalness: 0.6, roughness: 0.35 })),
  pico: (arm) => arm.add(box(0.03, 0.24, 0.03, '#8a8f96', 0.27, -0.12, 0, { metalness: 0.4, roughness: 0.5 })),
  azada: (arm) => arm.add(box(0.03, 0.06, 0.12, '#8a8f96', 0.28, -0.09, 0)),
};

/**
 * Trabajador que golpea sin parar con su herramienta (martillo, hacha, pico o azada).
 * Mira hacia (tx, tz) desde (x, z); `base` y `amp` (radianes) fijan a qué altura golpea.
 */
function worker(tool, x, z, tx, tz, { phase = 0, color = '#8a5a3a', speed = 6, base = 0.15, amp = 0.6 } = {}) {
  const g = new THREE.Group();
  g.add(cyl(0.08, 0.11, 0.3, 6, color));
  g.add(box(0.17, 0.05, 0.17, '#5e3b1c', 0, 0, 0));
  const head = mesh(new THREE.SphereGeometry(0.065, 6, 5), '#e8c39e');
  head.position.y = 0.37;
  g.add(head);
  // El brazo con la herramienta sube y baja (gira sobre el hombro)
  const arm = new THREE.Group();
  arm.position.set(0.03, 0.27, 0.07);
  arm.add(box(0.3, 0.03, 0.03, C.woodDark, 0.15, -0.015, 0));
  TOOL_HEADS[tool](arm);
  arm.userData.wiggle = { base, amp, speed, phase };
  g.add(arm);
  g.scale.setScalar(1.5);
  g.position.set(x, 0, z);
  // El +X del trabajador apunta a lo que trabaja
  g.rotation.y = Math.atan2(-(tz - z), tx - x);
  return g;
}

/** Chispas que saltan del yunque cada vez que baja el martillo (que golpea a `speed`). */
function sparks(x, y, z, speed) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  for (let i = 0; i < 7; i++) {
    const s = mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), '#ffcf5a', { emissive: '#ff9a1a', emissiveIntensity: 2.2 });
    s.castShadow = false;
    const a = (i / 7) * Math.PI * 2;
    s.userData.dir = [Math.cos(a), Math.sin(a)];
    g.add(s);
  }
  g.userData.sparks = { speed };
  return g;
}

function aserradero(level) {
  const g = new THREE.Group();
  g.add(box(2.2, 1.2, 1.7, C.wood, -0.4, 0, -0.4));
  g.add(gableRoof(2.6, 0.9, 2.0, C.woodDark, -0.4, 1.2, -0.4));
  g.add(box(0.45, 0.75, 0.05, C.dark, -0.4, 0, 0.47));
  g.add(box(0.35, 0.3, 0.05, C.dark, -1.1, 0.55, 0.47, WINDOW_GLOW));

  // Mesa de sierra con disco giratorio
  g.add(box(1.3, 0.5, 0.55, C.woodLight, 1.1, 0, 0.8));
  const pivot = new THREE.Group();
  pivot.position.set(1.1, 0.72, 0.8);
  const saw = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), '#c9ced6', { metalness: 0.6, roughness: 0.35 });
  saw.rotation.x = Math.PI / 2;
  saw.userData.spin = { axis: 'y', speed: 6 };
  pivot.add(saw);
  g.add(pivot);
  g.add(log(1.2, 0.14, 1.1, 0.5, 0.8));

  const piles = [
    [-1.6, 1.2, 0.3],
    [0.6, -1.3, 0],
    [1.6, -0.6, 1.2],
    [-1.8, -1.5, 0.5],
    [0.2, 1.7, -0.2],
    [1.7, 0.4, 1.5],
  ];
  const n = Math.min(piles.length, 1 + Math.floor(level / 2));
  for (let i = 0; i < n; i++) {
    const [x, z, rot] = piles[i];
    const pile = new THREE.Group();
    pile.add(log(1.2, 0.15, 0, 0, -0.16), log(1.2, 0.15, 0, 0, 0.16), log(1.2, 0.15, 0, 0.26, 0));
    pile.position.set(x, 0, z);
    pile.rotation.y = rot;
    g.add(pile);
  }
  // Leñador partiendo troncos junto a la sierra
  g.add(box(0.3, 0.25, 0.3, C.woodLight, 0.2, 0, 1.55));
  g.add(worker('hacha', -0.25, 1.55, 0.2, 1.55, { color: '#6b8f3a', speed: 3.5, base: 0.25 }));
  return g;
}

function cantera(level) {
  const g = new THREE.Group();
  g.add(cyl(1.2, 1.0, 0.04, 10, '#6b6157', -0.3, 0, -0.1));
  const wall = mesh(new THREE.DodecahedronGeometry(1.1), C.stoneDark);
  wall.scale.set(1.4, 0.9, 0.7);
  wall.position.set(-0.4, 0.55, -1.3);
  g.add(wall);

  const n = Math.min(10, 2 + level);
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 4);
    const k = i % 4;
    const x = 0.7 + (k % 2) * 0.55 + layer * 0.12;
    const z = 0.4 + Math.floor(k / 2) * 0.55 + layer * 0.12;
    g.add(box(0.5, 0.4, 0.5, i % 3 ? C.stone : '#bdb7ab', x, layer * 0.4, z));
  }

  // Grúa de madera con brazo que oscila
  g.add(box(0.16, 2.4, 0.16, C.wood, -1.5, 0, 1.0));
  const jib = new THREE.Group();
  jib.position.set(-1.5, 2.3, 1.0);
  jib.add(box(1.8, 0.12, 0.12, C.wood, 0.8, 0, 0));
  jib.add(box(0.03, 1.2, 0.03, C.dark, 1.5, -1.2, 0));
  jib.add(box(0.35, 0.3, 0.35, C.stone, 1.5, -1.5, 0));
  jib.userData.swing = { speed: 0.6, amp: 0.7 };
  g.add(jib);
  // Cantero labrando un bloque
  g.add(box(0.45, 0.35, 0.45, '#bdb7ab', -0.2, 0, 1.2));
  g.add(worker('pico', -0.7, 1.35, -0.2, 1.2, { color: '#7a6a55', speed: 4, phase: 1, base: 0.45 }));
  return g;
}

function mina(level) {
  const g = new THREE.Group();
  const mound = mesh(new THREE.DodecahedronGeometry(1.6), C.stoneDark);
  mound.scale.set(1.1, 0.75, 0.9);
  mound.position.set(0, 0.4, -0.6);
  g.add(mound);

  g.add(box(0.8, 0.9, 0.3, C.dark, 0, 0, 0.75));
  g.add(box(0.14, 1.0, 0.14, C.wood, -0.47, 0, 0.9));
  g.add(box(0.14, 1.0, 0.14, C.wood, 0.47, 0, 0.9));
  g.add(box(1.15, 0.16, 0.2, C.wood, 0, 1.0, 0.9));
  g.add(box(0.06, 0.05, 1.3, C.stoneDark, -0.2, 0, 1.6));
  g.add(box(0.06, 0.05, 1.3, C.stoneDark, 0.2, 0, 1.6));
  g.add(box(0.55, 0.35, 0.6, '#5d646d', 0, 0.08, 1.7));

  const spots = [
    [-1.3, 0.2, 0.4],
    [1.3, 0.1, 0.3],
    [-0.8, 0.9, -0.9],
    [0.9, 0.8, -1.0],
    [0.0, 1.4, -0.7],
    [-1.6, 0.1, -0.8],
    [1.7, 0.1, -0.6],
  ];
  const n = Math.min(spots.length, 1 + level);
  const size = 0.8 + Math.min(level, 10) * 0.05;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = spots[i];
    const c = mesh(new THREE.OctahedronGeometry(0.3), C.crystal, {
      emissive: '#2aa8d8',
      emissiveIntensity: 0.6,
      roughness: 0.25,
    });
    c.scale.set(size, size * 2, size);
    c.position.set(x, y + 0.5 * size, z);
    c.rotation.z = (i % 2 ? 1 : -1) * 0.25;
    c.userData.spin = { axis: 'y', speed: 0.6 + i * 0.1 };
    g.add(c);
  }
  // Un cristal en la vagoneta
  const ore = mesh(new THREE.OctahedronGeometry(0.15), C.crystal, { emissive: '#2aa8d8', emissiveIntensity: 0.6 });
  ore.position.set(0, 0.55, 1.7);
  g.add(ore);
  // Minero picando la veta
  g.add(worker('pico', -1.0, 0.85, -1.3, 0.4, { color: '#55606b', speed: 4.5, phase: 2, base: 0.1 }));
  return g;
}

function stall(color) {
  const g = new THREE.Group();
  g.add(box(1.1, 0.5, 0.6, C.woodLight));
  for (const [x, z] of [[-0.5, -0.27], [0.5, -0.27], [-0.5, 0.27], [0.5, 0.27]]) {
    g.add(box(0.07, 1.3, 0.07, C.wood, x, 0, z));
  }
  const awning = box(1.35, 0.08, 0.95, color, 0, 0, 0);
  awning.position.y = 1.3;
  awning.rotation.x = 0.25;
  g.add(awning);
  g.add(box(0.2, 0.2, 0.2, C.cloth[(C.cloth.indexOf(color) + 1) % 4], -0.25, 0.5, 0));
  g.add(cyl(0.12, 0.12, 0.18, 8, C.gold, 0.25, 0.5, 0, { metalness: 0.5, roughness: 0.4 }));
  return g;
}

function mercado(level) {
  const g = new THREE.Group();
  const spots = [
    [-1.0, -0.8, 0],
    [1.0, -0.8, 0],
    [-1.1, 0.9, Math.PI],
    [1.1, 0.9, Math.PI],
  ];
  const n = Math.min(spots.length, 1 + Math.floor(level / 2));
  for (let i = 0; i < n; i++) {
    const [x, z, rot] = spots[i];
    const s = stall(C.cloth[i]);
    s.position.set(x, 0, z);
    s.rotation.y = rot;
    g.add(s);
  }
  // Montón de oro central, crece con el nivel
  const h = 0.3 + Math.min(level, 12) * 0.05;
  g.add(cyl(0.6, 0.65, 0.12, 12, C.stone, 0, 0, 0));
  g.add(mesh(new THREE.ConeGeometry(0.45, h, 9), C.gold, { metalness: 0.6, roughness: 0.35 }));
  g.children.at(-1).position.set(0, 0.12 + h / 2, 0);
  return g;
}

function almacen(level) {
  const g = new THREE.Group();
  g.add(box(3.0, 1.6, 2.3, C.barn, 0, 0, -0.2));
  g.add(gableRoof(3.4, 1.1, 2.6, C.roofGrey, 0, 1.6, -0.2));
  g.add(box(1.1, 1.15, 0.05, C.woodDark, 0, 0, 0.96));
  for (const s of [1, -1]) {
    const brace = box(0.08, 1.45, 0.03, C.white, 0, 0, 0.99);
    brace.position.y = 0.57;
    brace.rotation.z = s * 0.75;
    g.add(brace);
  }
  for (const x of [-1.5, 1.5]) g.add(box(0.12, 1.6, 0.12, C.white, x, 0, 0.95));

  const spots = [
    [-1.9, 0.6],
    [1.9, 0.5],
    [-1.8, -1.2],
    [1.9, -1.0],
    [-1.3, 1.5],
    [1.3, 1.5],
  ];
  const n = Math.min(spots.length, level);
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[i];
    if (i % 2) g.add(cyl(0.22, 0.22, 0.55, 10, C.woodLight, x, 0, z));
    else g.add(box(0.5, 0.5, 0.5, C.woodLight, x, 0, z));
  }
  return g;
}

function granja(level) {
  const g = new THREE.Group();
  // Granero
  g.add(box(1.6, 1.1, 1.3, C.barn, -0.9, 0, -0.8));
  g.add(gableRoof(1.9, 0.8, 1.6, C.roofRed, -0.9, 1.1, -0.8));
  g.add(box(0.5, 0.7, 0.05, C.white, -0.9, 0, -0.14));
  // Campos de trigo: más parcelas con el nivel
  const fields = [
    [0.9, -0.9],
    [0.9, 0.4],
    [-0.6, 1.0],
    [0.9, 1.6],
    [-1.9, 0.6],
  ];
  const n = Math.min(fields.length, 1 + Math.floor(level / 2));
  for (let i = 0; i < n; i++) {
    const [x, z] = fields[i];
    g.add(box(1.2, 0.06, 1.0, '#7a5a34', x, 0, z));
    for (let r = 0; r < 4; r++) g.add(box(1.1, 0.22, 0.12, i % 2 ? '#e3c25a' : '#cfb24a', x, 0.06, z - 0.36 + r * 0.24));
  }
  // Molino a partir del nivel 3
  if (level >= 3) {
    g.add(cyl(0.32, 0.45, 1.9, 8, C.wall, -2.0, 0, -1.4));
    const cap = mesh(new THREE.ConeGeometry(0.45, 0.6, 8), C.roofRed);
    cap.position.set(-2.0, 2.2, -1.4);
    g.add(cap);
    const hub = new THREE.Group();
    hub.position.set(-2.0, 1.75, -0.98);
    for (let k = 0; k < 4; k++) {
      const blade = box(0.16, 1.1, 0.03, C.white, 0, 0, 0);
      blade.rotation.z = (k * Math.PI) / 2;
      hub.add(blade);
    }
    hub.userData.spin = { axis: 'z', speed: 1.4 };
    g.add(hub);
  }
  // Campesino trabajando el primer campo
  g.add(worker('azada', 0.15, -0.45, 0.7, -0.9, { color: '#3f6fa8', speed: 2.2, base: 0.05, amp: 0.55 }));
  // Cerca
  g.add(box(3.6, 0.3, 0.05, C.woodLight, 0, 0.1, 2.15));
  return g;
}

function fundicion(level) {
  const g = new THREE.Group();
  g.add(box(2.2, 1.3, 1.6, C.stoneDark, -0.3, 0, -0.5));
  g.add(gableRoof(2.5, 0.7, 1.9, C.roofGrey, -0.3, 1.3, -0.5));
  g.add(box(0.7, 0.6, 0.05, '#ff8a2a', -0.3, 0.1, 0.31, { emissive: '#ff6a00', emissiveIntensity: 1.2 }));
  const chimneys = Math.min(3, 1 + Math.floor(level / 3));
  for (let i = 0; i < chimneys; i++) {
    const x = -1.0 + i * 0.7;
    const h = 2.6 + i * 0.2;
    g.add(box(0.35, h, 0.35, C.stone, x, 0, -1.0));
    const smoke = new THREE.Group();
    smoke.position.set(x, h + 0.2, -1.0);
    for (let k = 0; k < 3; k++) {
      const puff = mesh(new THREE.IcosahedronGeometry(0.18 + k * 0.06, 0), '#9a9a9a', { transparent: true, opacity: 0.7 });
      puff.castShadow = false;
      puff.position.set(k * 0.12, k * 0.3, 0);
      smoke.add(puff);
    }
    smoke.userData.smoke = { phase: i * 1.7 };
    g.add(smoke);
  }
  // Yunque y lingotes
  g.add(box(0.5, 0.35, 0.3, C.dark, 1.3, 0, 0.6));
  g.add(box(0.7, 0.12, 0.3, '#4a4f57', 1.3, 0.35, 0.6, { metalness: 0.5, roughness: 0.4 }));
  const ingots = Math.min(9, 2 + level);
  for (let i = 0; i < ingots; i++) {
    const layer = Math.floor(i / 3);
    g.add(box(0.2, 0.14, 0.36, '#8fa3bf', 0.95 + (i % 3) * 0.24, layer * 0.14, -0.6, { metalness: 0.6, roughness: 0.35 }));
  }
  return g;
}

function academia(level) {
  const g = new THREE.Group();
  g.add(box(3.4, 0.3, 2.6, C.stone, 0, 0, 0));
  g.add(box(2.6, 1.6, 1.8, C.wall, 0, 0.3, -0.2));
  // Pórtico de columnas
  const cols = Math.min(6, 2 + Math.floor(level / 2));
  for (let i = 0; i < cols; i++) {
    const x = -1.25 + (2.5 * i) / Math.max(1, cols - 1);
    g.add(cyl(0.12, 0.14, 1.6, 8, C.white, x, 0.3, 0.95));
  }
  g.add(box(2.9, 0.18, 0.6, C.wallDark, 0, 1.9, 0.95));
  const pediment = gableRoof(0.62, 0.55, 2.9, C.wall, 0, 2.08, 0.95);
  pediment.rotation.y = Math.PI / 2;
  g.add(pediment);
  // Cúpula (dorada desde el nivel 4)
  const golden = level >= 4;
  const dome = mesh(
    new THREE.SphereGeometry(0.85, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    golden ? C.gold : C.roofBlue,
    golden ? { metalness: 0.5, roughness: 0.4 } : undefined,
  );
  dome.position.set(0, 1.9, -0.3);
  g.add(dome);
  g.add(cyl(0.05, 0.05, 0.5, 6, C.dark, 0, 2.7, -0.3));
  // Telescopio desde el nivel 3
  if (level >= 3) {
    const scope = new THREE.Group();
    scope.position.set(1.35, 0.3, -1.0);
    scope.add(box(0.06, 0.6, 0.06, C.wood, 0, 0, 0));
    const tube = cyl(0.08, 0.11, 0.9, 8, '#b08a3a', 0, 0, 0, { metalness: 0.6, roughness: 0.4 });
    tube.position.set(0, 0.75, 0.15);
    tube.rotation.x = 0.9;
    scope.add(tube);
    scope.userData.swing = { speed: 0.3, amp: 0.8 };
    g.add(scope);
  }
  return g;
}

function cuartel(level) {
  const g = new THREE.Group();
  // Barracón
  g.add(box(2.6, 1.0, 1.1, C.wood, 0, 0, -1.4));
  const roof = gableRoof(1.4, 0.7, 2.9, C.roofRed, 0, 1.0, -1.4);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  g.add(box(0.4, 0.65, 0.05, C.dark, 0, 0, -0.83));
  // Patio de armas con empalizada
  g.add(box(3.4, 0.03, 2.4, '#c7ad7c', 0, 0, 0.5));
  for (let i = 0; i < 12; i++) {
    const x = -1.7 + (3.4 * i) / 11;
    if (Math.abs(x) > 0.45) g.add(cyl(0.07, 0.07, 0.75, 5, C.woodDark, x, 0, 1.75));
  }
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) g.add(cyl(0.07, 0.07, 0.75, 5, C.woodDark, s * 1.7, 0, -0.65 + i * 0.6));
  // Estandartes
  const banners = Math.min(4, 1 + Math.floor(level / 2));
  for (let i = 0; i < banners; i++) {
    const x = -1.2 + i * 0.8;
    g.add(cyl(0.03, 0.03, 1.4, 5, C.dark, x, 1.0, -0.86));
    const flag = box(0.35, 0.45, 0.02, C.cloth[i % 4], 0, 0, 0);
    flag.geometry.translate(0.17, 0, 0);
    flag.position.set(x, 2.15, -0.86);
    flag.userData.wave = true;
    g.add(flag);
  }
  // Muñeco de entrenamiento
  g.add(cyl(0.04, 0.04, 0.8, 5, C.wood, 1.35, 0, -0.25));
  g.add(box(0.5, 0.06, 0.06, C.wood, 1.35, 0.55, -0.25));
  const dummy = mesh(new THREE.SphereGeometry(0.12, 8, 6), '#d8c08a');
  dummy.position.set(1.35, 0.9, -0.25);
  g.add(dummy);
  // Posiciones para las tropas que hay en casa
  g.userData.yard = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) g.userData.yard.push({ x: -1.1 + c * 0.5, z: 0.1 + r * 0.5 });
  return g;
}

function puerto(level) {
  // Raíz en la playa; -Z apunta mar adentro.
  const g = new THREE.Group();
  const len = 5 + Math.min(level, 8) * 0.25;
  for (let z = -0.6; z > -len; z -= 0.9) {
    for (const x of [-0.55, 0.55]) g.add(cyl(0.08, 0.08, 1.4, 6, C.woodDark, x, -1.0, z));
  }
  g.add(box(1.3, 0.12, len + 0.6, C.woodLight, 0, 0.3, -len / 2 + 0.1));
  // Almacén del muelle y mercancías
  g.add(box(1.4, 1.0, 1.1, C.wood, 2.0, 0, 0.3));
  g.add(gableRoof(1.6, 0.6, 1.3, C.roofGrey, 2.0, 1.0, 0.3));
  g.add(cyl(0.18, 0.18, 0.4, 8, C.woodLight, -1.4, 0, 0.6), box(0.4, 0.4, 0.4, C.woodLight, -1.9, 0, 0.2));
  // Grúa
  const crane = new THREE.Group();
  crane.position.set(0.5, 0.42, -1.2);
  crane.add(box(0.12, 1.6, 0.12, C.wood, 0, 0, 0));
  const jib = new THREE.Group();
  jib.position.y = 1.55;
  jib.add(box(1.4, 0.1, 0.1, C.wood, 0.55, 0, 0));
  jib.add(box(0.03, 0.7, 0.03, C.dark, 1.15, -0.7, 0));
  jib.userData.swing = { speed: 0.4, amp: 0.9 };
  crane.add(jib);
  g.add(crane);
  // Faro desde el nivel 4
  if (level >= 4) {
    // En la punta del muelle, sobre un islote de rocas
    const fx = 0;
    const fz = -len - 0.9;
    g.add(cyl(0.7, 0.95, 1.3, 8, C.stoneDark, fx, -1.1, fz));
    for (let i = 0; i < 4; i++) g.add(cyl(0.32, 0.36, 0.55, 8, i % 2 ? C.roofRed : C.white, fx, 0.2 + i * 0.55, fz));
    g.add(cyl(0.3, 0.3, 0.35, 8, '#fff2a8', fx, 2.4, fz, { emissive: '#ffd34a', emissiveIntensity: 1.5 }));
    const top = mesh(new THREE.ConeGeometry(0.4, 0.45, 8), C.roofRed);
    top.position.set(fx, 2.98, fz);
    g.add(top);
  }
  // Amarres para los barcos que hay en casa
  g.userData.docks = [];
  for (let z = -1.8; z > -len; z -= 2.0) for (const x of [-1.6, 1.6]) g.userData.docks.push({ x, z });
  return g;
}

function templo(level) {
  const g = new THREE.Group();
  // Escalinata de tres peldaños
  for (let i = 0; i < 3; i++) g.add(box(3.6 - i * 0.3, 0.16, 2.8 - i * 0.3, i % 2 ? C.wallDark : C.wall, 0, i * 0.16, 0));
  const base = 0.48;
  const w = 2.6;
  const d = 1.9;
  // Naos y columnata (más columnas con el nivel)
  g.add(box(w - 0.9, 1.4, d - 0.8, C.wall, 0, base, -0.05));
  const perSide = Math.min(6, 3 + Math.floor(level / 2));
  for (let i = 0; i < perSide; i++) {
    const x = -w / 2 + (w * i) / (perSide - 1);
    for (const z of [-d / 2, d / 2]) g.add(cyl(0.1, 0.12, 1.4, 8, C.white, x, base, z));
  }
  for (const x of [-w / 2, w / 2]) g.add(cyl(0.1, 0.12, 1.4, 8, C.white, x, base, 0));
  g.add(box(w + 0.3, 0.22, d + 0.3, C.wallDark, 0, base + 1.4, 0));
  const gold = level >= 5;
  g.add(gableRoof(d + 0.3, 0.6, w + 0.4, gold ? C.gold : C.roofRed, 0, base + 1.62, 0));
  g.children.at(-1).rotation.y = Math.PI / 2;
  // Altar con fuego sagrado delante del templo
  g.add(box(0.5, 0.45, 0.5, C.stone, 0, 0, 1.75));
  const fire = mesh(new THREE.ConeGeometry(0.18, 0.45, 6), '#ffb347', { emissive: '#ff7a00', emissiveIntensity: 1.6 });
  fire.position.set(0, 0.68, 1.75);
  fire.userData.flicker = true;
  g.add(fire);
  // Estatua del dios desde el nivel 3
  if (level >= 3) {
    g.add(box(0.35, 0.3, 0.35, C.stone, 1.55, 0, 1.4));
    const statue = mesh(new THREE.CylinderGeometry(0.1, 0.18, 0.7, 6), gold ? C.gold : '#cfd4da', gold ? { metalness: 0.6, roughness: 0.35 } : undefined);
    statue.position.set(1.55, 0.65, 1.4);
    g.add(statue);
    const head = mesh(new THREE.SphereGeometry(0.1, 8, 6), gold ? C.gold : '#cfd4da');
    head.position.set(1.55, 1.08, 1.4);
    g.add(head);
  }
  return g;
}

const BRONZE = { metalness: 0.55, roughness: 0.45 };

/** El Coloso se levanta por fases: pedestal, piernas, torso, cabeza y antorcha. */
function coloso(level) {
  const g = new THREE.Group();
  const done = level >= 10;
  const metal = done ? C.gold : '#a8743a';
  // Pedestal escalonado
  g.add(box(3.6, 0.5, 3.6, C.stone, 0, 0, 0), box(2.8, 0.6, 2.8, C.stoneDark, 0, 0.5, 0), box(2.2, 0.35, 2.2, C.stone, 0, 1.1, 0));
  const y0 = 1.45;
  const fig = new THREE.Group();
  fig.position.y = y0;
  // La figura mira hacia el mar (-Z)
  fig.rotation.y = Math.PI;
  g.add(fig);
  const part = (geo, x, y, z, rx = 0, rz = 0) => {
    const m = mesh(geo, metal, BRONZE);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    fig.add(m);
    return m;
  };
  if (level >= 1) {
    part(new THREE.BoxGeometry(0.45, 0.3, 0.7), -0.45, 0.15, 0.1);
    part(new THREE.BoxGeometry(0.45, 0.3, 0.7), 0.45, 0.15, 0.1);
  }
  if (level >= 2) {
    part(new THREE.CylinderGeometry(0.22, 0.26, 2.0, 7), -0.45, 1.3, 0);
    part(new THREE.CylinderGeometry(0.22, 0.26, 2.0, 7), 0.45, 1.3, 0);
  }
  if (level >= 4) {
    // Túnica y torso
    part(new THREE.CylinderGeometry(0.7, 0.95, 1.4, 8), 0, 2.6, 0);
    part(new THREE.CylinderGeometry(0.55, 0.7, 1.4, 8), 0, 3.95, 0);
  }
  if (level >= 6) {
    part(new THREE.CylinderGeometry(0.18, 0.2, 0.35, 7), 0, 4.8, 0);
    part(new THREE.SphereGeometry(0.42, 10, 8), 0, 5.25, 0);
    // Corona de rayos
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const ray = part(new THREE.ConeGeometry(0.06, 0.45, 4), Math.sin(a) * 0.38, 5.55, Math.cos(a) * 0.38);
      ray.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
    }
  }
  if (level >= 8) {
    // Brazo izquierdo abajo con escudo; brazo derecho alzado con la antorcha
    part(new THREE.CylinderGeometry(0.14, 0.16, 1.5, 6), -0.75, 3.7, 0, 0, -0.15);
    part(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10), -0.95, 3.4, 0.15, Math.PI / 2, 0);
    part(new THREE.CylinderGeometry(0.14, 0.16, 1.6, 6), 0.75, 5.0, 0, 0, 0.25);
    part(new THREE.CylinderGeometry(0.12, 0.08, 0.6, 6), 0.95, 6.05, 0);
  }
  if (done) {
    const flame = mesh(new THREE.ConeGeometry(0.22, 0.6, 7), '#ffcf5a', { emissive: '#ff9a00', emissiveIntensity: 2 });
    flame.position.set(0.95, 6.6, 0);
    flame.userData.flicker = true;
    fig.add(flame);
  } else {
    // Andamio permanente mientras la maravilla no esté terminada
    const h = 1 + Math.min(level, 9) * 0.65;
    const s = 1.5;
    for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) g.add(box(0.1, h, 0.1, C.woodLight, x, y0, z));
    for (let y = y0 + 0.9; y < y0 + h; y += 1.1) {
      g.add(box(2 * s, 0.07, 0.07, C.woodLight, 0, y, s), box(2 * s, 0.07, 0.07, C.woodLight, 0, y, -s));
      g.add(box(0.07, 0.07, 2 * s, C.woodLight, s, y, 0), box(0.07, 0.07, 2 * s, C.woodLight, -s, y, 0));
    }
  }
  return g;
}

// ── Vida en la isla ──────────────────────────────────────────────────────────

const CLOTHES = ['#b8442f', '#3f6fa8', '#e3b23c', '#6bbf59', '#8a5ab8', '#d9d2c3'];

/** Aldeano diminuto (0,5 de alto). */
export function createVillager(i) {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.1, 0.28, 6, CLOTHES[i % CLOTHES.length]));
  const head = mesh(new THREE.SphereGeometry(0.06, 6, 5), '#e8c39e');
  head.position.y = 0.34;
  g.add(head);
  if (i % 3 === 0) g.add(box(0.14, 0.14, 0.14, C.woodLight, 0, 0.36, -0.04));
  for (const m of g.children) m.castShadow = false;
  return g;
}

export function createGull() {
  const g = new THREE.Group();
  const white = mat('#f4f4f2');
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.5), white);
  g.add(body);
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.x = s * 0.07;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.22), white);
    blade.position.x = s * 0.35;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.031, 0.18), mat('#3a3a3a'));
    tip.position.x = s * 0.62;
    wing.add(blade, tip);
    wing.userData.side = s;
    g.add(wing);
  }
  return g;
}

/** Material de las ventanas: la escena las enciende al anochecer. */
export const WINDOW_GLOW = { emissive: '#ffb347', emissiveIntensity: 0 };

export function windowMaterial() {
  return mat(C.dark, WINDOW_GLOW);
}

export function wallHeight(level) {
  return 1.0 + Math.min(level, 10) * 0.12;
}

function muralla(level) {
  // Puerta principal; el resto del muro lo dibuja la escena alrededor de la ciudad.
  const g = new THREE.Group();
  const h = wallHeight(level);
  for (const x of [-1.3, 1.3]) {
    g.add(box(1.0, h + 0.8, 1.0, C.stone, x, 0, 0));
    for (const dx of [-0.35, 0, 0.35]) for (const dz of [-0.35, 0.35]) g.add(box(0.22, 0.3, 0.22, C.stone, x + dx, h + 0.8, dz));
  }
  g.add(box(1.7, 0.5, 0.8, C.stoneDark, 0, h - 0.1, 0));
  const pole = h + 1.1;
  g.add(cyl(0.03, 0.03, 1.0, 5, C.dark, 1.3, pole, 0));
  const flag = box(0.5, 0.32, 0.02, C.cloth[0], 0, 0, 0);
  flag.geometry.translate(0.25, 0, 0);
  flag.position.set(1.3, pole + 0.8, 0);
  flag.userData.wave = true;
  g.add(flag);
  return g;
}

function emptyPlot(id) {
  const g = new THREE.Group();
  if (id === 'puerto') {
    // Unas estacas en la orilla
    for (let i = 0; i < 3; i++) g.add(cyl(0.08, 0.08, 1.0, 6, C.woodDark, -0.5 + i * 0.5, -0.6, -1.2 - i * 0.4));
    g.add(box(0.08, 0.9, 0.08, C.wood, 1.2, 0, 0.4));
    g.add(box(0.7, 0.4, 0.06, C.woodLight, 1.2, 0.65, 0.42));
    return g;
  }
  const s = id === 'muralla' ? 0.9 : 1.5;
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) g.add(box(0.1, 0.6, 0.1, C.wood, x, 0, z));
  for (const [x, z, w, d] of [[0, -s, 2 * s, 0.03], [0, s, 2 * s, 0.03], [-s, 0, 0.03, 2 * s], [s, 0, 0.03, 2 * s]]) {
    g.add(box(w, 0.03, d, '#e9dcc0', x, 0.45, z));
  }
  g.add(box(0.08, 0.9, 0.08, C.wood, s * 0.6, 0, s + 0.4));
  g.add(box(0.7, 0.4, 0.06, C.woodLight, s * 0.6, 0.65, s + 0.42));
  return g;
}


// ── Edificios de la segunda ampliación ───────────────────────────────────────

export function smokeColumn(x, y, z, phase = 0) {
  const smoke = new THREE.Group();
  smoke.position.set(x, y, z);
  for (let k = 0; k < 3; k++) {
    const puff = mesh(new THREE.IcosahedronGeometry(0.16 + k * 0.05, 0), '#a8a8a8', { transparent: true, opacity: 0.65 });
    puff.castShadow = false;
    puff.position.set(k * 0.1, k * 0.3, 0);
    smoke.add(puff);
  }
  smoke.userData.smoke = { phase };
  return smoke;
}

function lantern(x, y, z) {
  const g = new THREE.Group();
  g.add(box(0.14, 0.18, 0.14, C.dark, x, y, z));
  g.add(box(0.1, 0.12, 0.1, '#ffd27a', x, y + 0.03, z, WINDOW_GLOW));
  return g;
}

function taberna(level) {
  const g = new THREE.Group();
  g.add(box(3.2, 0.2, 2.6, C.stone, 0, 0, -0.3));
  // Planta baja de piedra y piso de entramado de madera
  g.add(box(2.4, 1.1, 1.7, C.wall, 0, 0.2, -0.6));
  g.add(box(2.6, 0.95, 1.9, C.wallDark, 0, 1.3, -0.6));
  for (const x of [-1.25, -0.4, 0.4, 1.25]) g.add(box(0.08, 0.95, 0.06, C.woodDark, x, 1.3, 0.36));
  g.add(box(2.62, 0.08, 0.06, C.woodDark, 0, 1.75, 0.36));
  const roof = gableRoof(2.0, 0.85, 3.0, C.roofRed, 0, 2.25, -0.6);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  // Puerta, ventanas y balcón
  g.add(box(0.55, 0.8, 0.05, C.woodDark, 0, 0.2, 0.26));
  for (const x of [-0.8, 0.8]) g.add(box(0.36, 0.36, 0.05, C.dark, x, 0.55, 0.26, WINDOW_GLOW), box(0.36, 0.36, 0.05, C.dark, x, 1.5, 0.36, WINDOW_GLOW));
  g.add(box(1.4, 0.06, 0.5, C.wood, 0, 1.3, 0.6), box(1.4, 0.3, 0.04, C.woodLight, 0, 1.36, 0.84));
  // Chimenea humeante
  g.add(box(0.35, 1.2, 0.35, C.stone, 0.9, 2.2, -1.2));
  g.add(smokeColumn(0.9, 3.5, -1.2, 0.8));
  // Letrero colgante con una jarra
  g.add(box(0.06, 0.06, 0.6, C.woodDark, -1.2, 1.15, 0.55));
  const sign = box(0.5, 0.36, 0.04, C.woodLight, 0, 0, 0);
  sign.position.set(-1.2, 0.72, 0.8);
  sign.userData.wave = true;
  g.add(sign);
  g.add(box(0.16, 0.2, 0.05, C.gold, -1.2, 0.8, 0.83));
  // Terraza: mesas, bancos y barriles (más cuanto más nivel)
  const tables = Math.min(3, 1 + Math.floor(level / 3));
  for (let i = 0; i < tables; i++) {
    const x = -1.0 + i * 1.0;
    g.add(cyl(0.28, 0.28, 0.05, 8, C.woodLight, x, 0.42, 1.3), cyl(0.05, 0.05, 0.42, 5, C.woodDark, x, 0, 1.3));
    g.add(box(0.6, 0.06, 0.16, C.wood, x, 0.25, 1.75), box(0.6, 0.06, 0.16, C.wood, x, 0.25, 0.85));
    g.add(cyl(0.05, 0.05, 0.14, 6, '#e8d9a8', x + 0.08, 0.47, 1.3));
  }
  const barrels = Math.min(6, 2 + level);
  for (let i = 0; i < barrels; i++) {
    const b = cyl(0.2, 0.2, 0.5, 8, C.wood, 1.55, (i >= 3 ? 0.5 : 0), -1.2 + (i % 3) * 0.45);
    g.add(b);
  }
  g.add(lantern(-0.5, 2.05, 0.4), lantern(0.5, 2.05, 0.4));
  return g;
}

function forja(level) {
  const g = new THREE.Group();
  g.add(box(3.0, 0.15, 2.4, C.stoneDark, 0, 0, -0.2));
  // Cobertizo abierto
  for (const [x, z] of [[-1.3, -1.2], [1.3, -1.2], [-1.3, 0.6], [1.3, 0.6]]) g.add(box(0.14, 1.6, 0.14, C.woodDark, x, 0.15, z));
  const roof = gableRoof(3.0, 0.7, 2.2, C.roofGrey, 0, 1.75, -0.3);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  // Horno con boca encendida y chimenea
  g.add(box(1.2, 1.2, 0.9, C.stone, -0.6, 0.15, -0.95));
  g.add(box(0.5, 0.4, 0.05, '#ff8a2a', -0.6, 0.35, -0.48, { emissive: '#ff5a00', emissiveIntensity: 1.5 }));
  g.add(box(0.4, 1.8, 0.4, C.stone, -0.6, 1.35, -1.2));
  g.add(smokeColumn(-0.6, 3.3, -1.2, 1.9));
  // Yunque, martillo y piedra de afilar que gira
  g.add(box(0.3, 0.35, 0.25, C.dark, 0.6, 0.15, -0.2));
  g.add(box(0.55, 0.12, 0.25, '#4a4f57', 0.6, 0.5, -0.2, { metalness: 0.5, roughness: 0.4 }));
  g.add(worker('martillo', 0.1, -0.2, 0.6, -0.2, { color: '#7a4a2a', speed: 7, base: 0.95, amp: 0.45 }));
  g.add(sparks(0.6, 0.64, -0.2, 7));
  const wheel = new THREE.Group();
  wheel.position.set(0.8, 0.6, 0.55);
  const stone = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 12), '#b9b2a6');
  stone.rotation.z = Math.PI / 2;
  wheel.add(stone);
  wheel.userData.spin = { axis: 'x', speed: 2.5 };
  g.add(wheel);
  g.add(box(0.1, 0.45, 0.4, C.wood, 0.8, 0.15, 0.55));
  // Armero con lanzas y escudos
  const weapons = Math.min(7, 3 + level);
  for (let i = 0; i < weapons; i++) g.add(cyl(0.02, 0.02, 1.2, 4, C.woodDark, -1.1 + i * 0.12, 0.15, 0.85));
  g.add(box(1.0, 0.06, 0.1, C.wood, -0.75, 0.9, 0.85));
  for (let i = 0; i < Math.min(3, 1 + Math.floor(level / 2)); i++) {
    const shield = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 10), C.cloth[i % 4]);
    shield.rotation.x = Math.PI / 2;
    shield.position.set(1.15, 0.6 + i * 0.05, -0.4 + i * 0.4);
    shield.rotation.z = Math.PI / 2;
    g.add(shield);
  }
  return g;
}

function torre(level) {
  const g = new THREE.Group();
  const h = 3.6 + Math.min(level, 10) * 0.22;
  g.add(cyl(1.15, 1.3, 0.3, 10, C.stoneDark));
  g.add(cyl(0.85, 1.0, h, 10, C.stone, 0, 0.3, 0));
  // Saeteras y puerta
  g.add(box(0.4, 0.7, 0.05, C.woodDark, 0, 0.3, 0.97));
  for (let i = 1; i < 4; i++) g.add(box(0.1, 0.35, 0.05, C.dark, 0, 0.3 + (h * i) / 4, 0.92, WINDOW_GLOW));
  // Almenas y tejado
  const top = 0.3 + h;
  g.add(cyl(1.1, 1.0, 0.25, 10, C.stone, 0, top, 0));
  for (let a = 0; a < 360; a += 45) {
    const m = box(0.3, 0.32, 0.3, C.stone, 0, 0, 0);
    m.position.set(Math.sin((a * Math.PI) / 180) * 0.95, top + 0.25, Math.cos((a * Math.PI) / 180) * 0.95);
    g.add(m);
  }
  // Brasero de vigía
  g.add(cyl(0.25, 0.15, 0.25, 8, C.dark, 0, top + 0.25, 0));
  const fire = mesh(new THREE.ConeGeometry(0.2, 0.45, 6), '#ffb347', { emissive: '#ff7a00', emissiveIntensity: 1.6 });
  fire.position.set(0, top + 0.72, 0);
  fire.userData.flicker = true;
  g.add(fire);
  // Arqueros de guardia (más con el nivel)
  const guards = Math.min(3, 1 + Math.floor(level / 3));
  for (let i = 0; i < guards; i++) {
    const s = createSoldier('arquero');
    s.scale.setScalar(1.1);
    s.position.set(Math.sin(i * 2.1) * 0.6, top + 0.25, Math.cos(i * 2.1) * 0.6);
    s.rotation.y = i * 2.1;
    g.add(s);
  }
  g.add(cyl(0.03, 0.03, 1.2, 5, C.dark, 0.7, top + 0.25, -0.5));
  const flag = box(0.5, 0.32, 0.02, C.cloth[1], 0, 0, 0);
  flag.geometry.translate(0.25, 0, 0);
  flag.position.set(0.7, top + 1.25, -0.5);
  flag.userData.wave = true;
  g.add(flag);
  return g;
}

function faro(level) {
  const g = new THREE.Group();
  // Peñas y casita del farero
  for (const [x, z, s] of [[-0.9, 0.6, 0.7], [0.8, 0.8, 0.55], [0.2, -1.0, 0.6]]) {
    const r = mesh(new THREE.DodecahedronGeometry(s), C.stoneDark);
    r.position.set(x, s * 0.4, z);
    r.scale.y = 0.6;
    g.add(r);
  }
  g.add(box(1.2, 0.8, 1.0, C.wall, 1.3, 0, -0.2), gableRoof(1.4, 0.5, 1.2, C.roofBlue, 1.3, 0.8, -0.2));
  g.add(box(0.25, 0.25, 0.05, C.dark, 1.3, 0.35, 0.31, WINDOW_GLOW));
  // Torre a franjas
  const h = 4.4 + Math.min(level, 10) * 0.2;
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const r0 = 0.75 - (i / bands) * 0.25;
    const r1 = 0.75 - ((i + 1) / bands) * 0.25;
    g.add(cyl(r1, r0, h / bands, 10, i % 2 ? C.roofRed : C.white, 0, (h * i) / bands, 0));
  }
  // Linterna con su luz y el haz que gira
  g.add(cyl(0.62, 0.62, 0.12, 10, C.dark, 0, h, 0));
  g.add(cyl(0.38, 0.38, 0.6, 10, '#fff2a8', 0, h + 0.12, 0, { emissive: '#ffd34a', emissiveIntensity: 1.8 }));
  const cap = mesh(new THREE.ConeGeometry(0.5, 0.55, 10), C.roofRed);
  cap.position.y = h + 1.0;
  g.add(cap);
  const beam = new THREE.Group();
  beam.position.y = h + 0.42;
  const ray = new THREE.Mesh(new THREE.ConeGeometry(0.9, 9, 12, 1, true), mat('#fff3b0', { transparent: true, opacity: 0.16, emissive: '#fff3b0', emissiveIntensity: 1, depthWrite: false, side: THREE.DoubleSide }));
  ray.rotation.z = Math.PI / 2;
  ray.position.x = 4.6;
  beam.add(ray);
  beam.userData.spin = { axis: 'y', speed: 0.7 };
  g.add(beam);
  return g;
}

function astillero(level) {
  // -Z mira al mar: la grada baja hacia la playa
  const g = new THREE.Group();
  g.add(box(3.4, 0.15, 2.0, C.woodDark, 0, 0, 0.6));
  // Grada inclinada con un casco a medio hacer
  const slip = box(1.4, 0.12, 4.2, C.woodLight, 0, 0, 0);
  slip.position.set(-0.6, 0.1, -1.6);
  slip.rotation.x = -0.12;
  g.add(slip);
  const ribs = Math.min(8, 4 + level);
  for (let i = 0; i < ribs; i++) {
    const z = -0.2 - i * 0.42;
    const y = 0.35 + (z + 0.2) * 0.12;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 4, 10, Math.PI), mat(C.wood));
    rib.position.set(-0.6, y + 0.55, z);
    rib.rotation.z = Math.PI;
    rib.castShadow = true;
    g.add(rib);
  }
  g.add(box(0.12, 0.12, ribs * 0.42 + 0.4, C.woodDark, -0.6, 0.12, -0.2 - (ribs * 0.42) / 2));
  // Andamio y grúa
  for (const z of [-0.6, -2.2]) g.add(box(0.1, 2.0, 0.1, C.woodLight, 0.4, 0.1, z), box(0.1, 2.0, 0.1, C.woodLight, -1.6, 0.1, z));
  g.add(box(2.1, 0.08, 0.08, C.woodLight, -0.6, 2.0, -0.6), box(2.1, 0.08, 0.08, C.woodLight, -0.6, 2.0, -2.2));
  const crane = new THREE.Group();
  crane.position.set(1.3, 0.15, -0.6);
  crane.add(box(0.14, 2.4, 0.14, C.wood, 0, 0, 0));
  const jib = new THREE.Group();
  jib.position.y = 2.35;
  jib.add(box(1.8, 0.1, 0.1, C.wood, -0.7, 0, 0), box(0.03, 0.8, 0.03, C.dark, -1.5, -0.8, 0));
  jib.userData.swing = { speed: 0.35, amp: 0.7 };
  crane.add(jib);
  g.add(crane);
  // Taller y pilas de troncos
  g.add(box(1.4, 1.0, 1.1, C.wood, 1.0, 0.15, 1.0), gableRoof(1.6, 0.6, 1.3, C.roofRed, 1.0, 1.15, 1.0));
  const piles = Math.min(3, 1 + Math.floor(level / 3));
  for (let p = 0; p < piles; p++) {
    for (let i = 0; i < 3; i++) g.add(log(1.4, 0.13, -1.2 + p * 0.0, 0.15 + i * 0.24, 0.9 + p * 0.45 - 0.1 * i, 0));
  }
  return g;
}

const FACTORIES = { ayuntamiento, aserradero, cantera, granja, mina, fundicion, mercado, almacen, academia, templo, cuartel, puerto, muralla, coloso, taberna, forja, torre, faro, astillero };

export function createBuilding(id, level) {
  if (level <= 0) return bakeStatic(emptyPlot(id));
  // Lo que no se mueve se funde en una sola malla: muchas menos llamadas de dibujo
  const g = bakeStatic(FACTORIES[id](level), windowMaterial());
  if (id !== 'puerto' && id !== 'muralla' && id !== 'coloso') g.scale.setScalar(1 + Math.min(level, 15) * 0.025);
  return g;
}

// ── Tropas y barcos ──────────────────────────────────────────────────────────

const UNIT_COLORS = {
  hondero: '#9a7b4f',
  hoplita: '#b08d3c',
  lancero: '#b8442f',
  arquero: '#3f8a3a',
  espadachin: '#6a7380',
  caballero: '#3f6fa8',
  barbaro: '#7a5230',
  pirata: '#2b2620',
};

/** Figurita de una unidad de tierra (unos 0,6 de alto). */
export function createSoldier(id) {
  const g = new THREE.Group();
  if (id === 'catapulta') {
    g.add(box(0.5, 0.12, 0.7, C.wood, 0, 0.08, 0));
    for (const [x, z] of [[-0.27, -0.25], [0.27, -0.25], [-0.27, 0.25], [0.27, 0.25]]) {
      const w = cyl(0.1, 0.1, 0.05, 8, C.woodDark, x, 0, z);
      w.rotation.z = Math.PI / 2;
      w.position.y = 0.1;
      g.add(w);
    }
    const arm = box(0.06, 0.06, 0.8, C.woodLight, 0, 0, 0);
    arm.position.set(0, 0.35, 0);
    arm.rotation.x = 0.6;
    g.add(arm);
    g.add(box(0.14, 0.1, 0.14, C.stone, 0, 0.55, -0.3));
    return g;
  }
  const color = UNIT_COLORS[id] ?? C.roofRed;
  let base = 0;
  if (id === 'caballero') {
    g.add(box(0.2, 0.22, 0.6, '#7a5230', 0, 0.22, 0));
    for (const [x, z] of [[-0.07, -0.22], [0.07, -0.22], [-0.07, 0.22], [0.07, 0.22]]) g.add(box(0.05, 0.22, 0.05, '#5e3b1c', x, 0, z));
    g.add(box(0.12, 0.2, 0.18, '#7a5230', 0, 0.4, 0.3));
    base = 0.44;
  }
  g.add(cyl(0.09, 0.12, 0.32, 7, color, 0, base, 0));
  const head = mesh(new THREE.SphereGeometry(0.075, 8, 6), '#e8c39e');
  head.position.y = base + 0.4;
  g.add(head);
  g.add(cyl(0.085, 0.085, 0.05, 7, id === 'pirata' ? '#b8442f' : '#8a8f96', 0, base + 0.44, 0));
  if (id === 'lancero' || id === 'caballero') g.add(cyl(0.015, 0.015, 0.8, 4, C.woodDark, 0.13, base, 0.02));
  if (id === 'espadachin' || id === 'pirata' || id === 'barbaro') g.add(box(0.03, 0.3, 0.05, '#c9ced6', 0.14, base + 0.12, 0.05));
  if (id === 'espadachin' || id === 'lancero') g.add(box(0.03, 0.2, 0.16, color, -0.12, base + 0.08, 0));
  if (id === 'hondero') {
    // Honda girando sobre la cabeza y zurrón de piedras
    g.add(cyl(0.008, 0.008, 0.3, 4, C.woodDark, 0.12, base + 0.32, 0));
    g.add(box(0.06, 0.06, 0.06, C.stone, 0.12, base + 0.62, 0));
    g.add(box(0.1, 0.1, 0.06, '#7a5230', -0.1, base + 0.06, 0.06));
  }
  if (id === 'hoplita') {
    // Gran escudo redondo de bronce, penacho y lanza
    const shield = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 12), '#c9a24a', { metalness: 0.5, roughness: 0.45 });
    shield.rotation.x = Math.PI / 2;
    shield.position.set(0, base + 0.2, 0.13);
    g.add(shield);
    g.add(box(0.03, 0.1, 0.16, '#b8442f', 0, base + 0.48, 0));
    g.add(cyl(0.015, 0.015, 0.9, 4, C.woodDark, 0.13, base, 0.02));
  }
  if (id === 'arquero') {
    const bow = mesh(new THREE.TorusGeometry(0.14, 0.012, 4, 10, Math.PI), C.woodDark);
    bow.position.set(0.12, base + 0.22, 0);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    g.add(bow);
  }
  return g;
}

function hull(w, h, l, bow, color) {
  // Casco visto desde arriba; tras girarlo, la proa apunta a +Z
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, l / 2);
  shape.lineTo(w / 2, l / 2);
  shape.lineTo(w / 2, -l / 2 + bow);
  shape.lineTo(0, -l / 2);
  shape.lineTo(-w / 2, -l / 2 + bow);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h * 0.35, 0);
  return mesh(geo, color);
}

function sail(w, h, color, x, y, z) {
  return box(w, h, 0.03, color, x, y, z + 0.06);
}

const SHIP_COLORS = {
  bote: { hull: C.woodLight },
  mercante: { hull: C.wood, sail: '#f4efe6' },
  trirreme: { hull: C.woodDark, sail: '#b8442f' },
  galeon: { hull: '#6b4423', sail: '#f4efe6' },
  corsario: { hull: '#3a2a20', sail: '#26221f' },
  brulote: { hull: '#3b2a1e', sail: '#8a2f22' },
  dromon: { hull: '#5a3a22', sail: '#e9dcc0' },
};

/** Barco (unos 2 de eslora) con la proa hacia +Z y la línea de flotación en y = 0. */
export function createShip(type) {
  const g = new THREE.Group();
  const col = SHIP_COLORS[type] ?? SHIP_COLORS.mercante;
  if (type === 'bote') {
    g.add(hull(0.45, 0.22, 1.1, 0.35, col.hull));
    for (const s of [-1, 1]) {
      const oar = box(0.5, 0.03, 0.05, C.woodDark, s * 0.35, 0.05, 0);
      oar.rotation.z = s * -0.3;
      g.add(oar);
    }
    g.add(box(0.12, 0.12, 0.12, C.roofRed, 0, 0.08, -0.2));
    return g;
  }
  if (type === 'trirreme') {
    g.add(hull(0.75, 0.4, 2.9, 0.7, col.hull));
    g.add(box(0.06, 0.06, 0.5, '#8a8f96', 0, -0.05, 1.6, { metalness: 0.6 }));
    for (let i = 0; i < 7; i++) {
      for (const s of [-1, 1]) {
        const oar = box(0.7, 0.025, 0.04, C.woodLight, s * 0.6, 0.02, -1.0 + i * 0.3);
        oar.rotation.z = s * -0.35;
        g.add(oar);
      }
    }
    g.add(cyl(0.04, 0.04, 1.6, 6, C.woodDark, 0, 0.2, 0.1));
    g.add(sail(1.0, 0.8, col.sail, 0, 0.85, 0.1));
    return g;
  }
  if (type === 'brulote') {
    // Barco pequeño cargado de barriles de brea encendidos
    g.add(hull(0.7, 0.35, 1.8, 0.5, col.hull));
    g.add(cyl(0.04, 0.04, 1.4, 6, C.woodDark, 0, 0.15, 0.1));
    g.add(sail(0.8, 0.6, col.sail, 0, 0.65, 0.1));
    for (const [x, z] of [[-0.15, -0.45], [0.15, -0.45], [0, 0.55]]) {
      g.add(cyl(0.12, 0.12, 0.25, 8, '#2b2017', x, 0.12, z));
      const flame = mesh(new THREE.ConeGeometry(0.1, 0.32, 6), '#ff8a2a', { emissive: '#ff5a00', emissiveIntensity: 1.8 });
      flame.position.set(x, 0.52, z);
      flame.userData.flicker = true;
      g.add(flame);
    }
    return g;
  }
  if (type === 'dromon') {
    // Gran barco de guerra: dos velas latinas, dos filas de remos y sifón de fuego en la proa
    g.add(hull(1.2, 0.6, 4.0, 1.0, col.hull));
    g.add(box(1.1, 0.35, 0.9, '#6b4423', 0, 0.25, -1.45));
    g.add(box(0.9, 0.06, 0.5, C.gold, 0, 0.6, -1.45));
    g.add(cyl(0.06, 0.09, 0.6, 6, '#8a6a3a', 0, 0.4, 1.75, { metalness: 0.5 }));
    for (const [z, hgt, w] of [[0.8, 2.6, 1.4], [-0.6, 2.2, 1.1]]) {
      g.add(cyl(0.05, 0.06, hgt, 6, C.woodDark, 0, 0.25, z));
      const s = sail(w, 1.0, col.sail, 0, 0.9, z);
      s.rotation.z = 0.25;
      g.add(s);
    }
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 9; i++) {
        for (const side of [-1, 1]) {
          const oar = box(0.8, 0.025, 0.04, C.woodLight, side * (0.65 + row * 0.1), -0.02 + row * 0.12, -1.3 + i * 0.32);
          oar.rotation.z = side * -0.35;
          g.add(oar);
        }
      }
    }
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) g.add(cyl(0.12, 0.12, 0.04, 8, C.cloth[i % 4], side * 0.6, 0.22, -1.0 + i * 0.45));
    const flag = box(0.5, 0.3, 0.02, C.cloth[1], 0, 0, 0);
    flag.geometry.translate(0.25, 0, 0);
    flag.position.set(0, 2.9, 0.8);
    flag.userData.wave = true;
    g.add(flag);
    return g;
  }
  if (type === 'galeon') {
    g.add(hull(1.15, 0.6, 3.3, 0.9, col.hull));
    g.add(box(1.1, 0.45, 0.8, '#7a5230', 0, 0.25, -1.1));
    g.add(box(0.9, 0.06, 0.5, C.gold, 0, 0.55, 1.2));
    for (const [z, hgt] of [[0.6, 2.6], [-0.4, 2.2]]) {
      g.add(cyl(0.05, 0.06, hgt, 6, C.woodDark, 0, 0.25, z));
      g.add(sail(1.3, 0.8, col.sail, 0, 0.95, z), sail(1.0, 0.6, col.sail, 0, 1.85, z));
    }
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g.add(box(0.05, 0.08, 0.08, C.dark, s * 0.58, 0.12, -0.6 + i * 0.4));
    const flag = box(0.4, 0.25, 0.02, C.cloth[0], 0, 0, 0);
    flag.geometry.translate(0.2, 0, 0);
    flag.position.set(0, 2.85, 0.6);
    flag.userData.wave = true;
    g.add(flag);
    return g;
  }
  // Mercante y corsario
  g.add(hull(0.9, 0.45, 2.2, 0.6, col.hull));
  g.add(box(0.8, 0.3, 0.55, col.hull, 0, 0.15, -0.75));
  g.add(cyl(0.05, 0.05, 1.9, 6, C.woodDark, 0, 0.2, 0.15));
  g.add(sail(1.1, 0.9, col.sail, 0, 0.75, 0.15));
  if (type === 'corsario') {
    g.add(box(0.25, 0.25, 0.02, '#f4efe6', 0, 1.05, 0.25));
    const flag = box(0.4, 0.25, 0.02, '#111111', 0, 0, 0);
    flag.geometry.translate(0.2, 0, 0);
    flag.position.set(0, 2.0, 0.15);
    flag.userData.wave = true;
    g.add(flag);
  } else {
    g.add(box(0.3, 0.25, 0.3, C.woodLight, 0, 0.1, 0.55), cyl(0.12, 0.12, 0.3, 8, C.woodLight, 0.2, 0.1, -0.1));
  }
  return g;
}

/** Andamio que rodea un edificio en obras. */
export function createScaffold(height) {
  const g = new THREE.Group();
  const s = 1.9;
  const h = Math.max(2.2, height);
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) g.add(box(0.08, h, 0.08, C.woodLight, x, 0, z));
  for (let y = 0.9; y < h; y += 0.9) {
    g.add(box(2 * s, 0.06, 0.06, C.woodLight, 0, y, s), box(2 * s, 0.06, 0.06, C.woodLight, 0, y, -s));
    g.add(box(0.06, 0.06, 2 * s, C.woodLight, s, y, 0), box(0.06, 0.06, 2 * s, C.woodLight, -s, y, 0));
  }
  const crane = new THREE.Group();
  crane.position.set(s, h, s);
  crane.add(box(2.4, 0.1, 0.1, '#e0a020', -0.9, 0, 0));
  crane.add(box(0.03, 0.8, 0.03, C.dark, -1.8, -0.8, 0));
  crane.userData.spin = { axis: 'y', speed: 0.5 };
  g.add(box(0.12, 0.5, 0.12, '#e0a020', s, h - 0.5, s));
  g.add(crane);
  return g;
}

export function disposeTree(obj) {
  obj.traverse((o) => o.geometry?.dispose());
}
