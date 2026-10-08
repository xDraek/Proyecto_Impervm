import * as THREE from 'three';
import { bakeStatic } from './util.js';

// Modelos low-poly procedurales. Cada edificio crece en detalle con su nivel.
// Convención: los helpers reciben la posición de la BASE del objeto (y = suelo).

// Paleta del Mediterráneo clásico: caliza y mármol claros, tejas de terracota y azul egeo
export const C = {
  wall: '#f2e8d2',
  wallDark: '#e4d4b4',
  stone: '#d2c7ae',
  stoneDark: '#9f9480',
  marble: '#f4efe4',
  marbleDark: '#ddd3c0',
  wood: '#8b5a2b',
  woodDark: '#5e3b1c',
  woodLight: '#c08a4a',
  roofRed: '#c2603a',
  roofBlue: '#2f6db3',
  roofGrey: '#a5573a',
  gold: '#f2c94c',
  crystal: '#6fd6ff',
  dark: '#2b2620',
  barn: '#d9b98a',
  white: '#f6f1e7',
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


// ── Arquitectura clásica ─────────────────────────────────────────────────────
// Piezas comunes para que la ciudad parezca griega o romana: escalinatas,
// columnas con basa y capitel, frontones, tejados bajos de terracota y cúpulas.

/** Escalinata de `steps` peldaños; devuelve la altura de arriba. */
export function stylobate(g, w, d, steps = 3, x = 0, z = 0, stepH = 0.15) {
  for (let i = 0; i < steps; i++) g.add(box(w - i * 0.28, stepH, d - i * 0.28, i % 2 ? C.marbleDark : C.marble, x, i * stepH, z));
  return steps * stepH;
}

/** Columna con basa, fuste y capital. */
export function column(x, y, z, h, r = 0.12, color = C.marble) {
  const g = new THREE.Group();
  g.add(box(r * 2.5, 0.07, r * 2.5, color, 0, 0, 0));
  g.add(cyl(r * 0.85, r, h - 0.17, 10, color, 0, 0.07, 0));
  g.add(cyl(r * 1.35, r * 0.85, 0.06, 10, color, 0, h - 0.1, 0));
  g.add(box(r * 2.6, 0.06, r * 2.6, color, 0, h - 0.06, 0));
  g.position.set(x, y, z);
  return g;
}

/** Fila de `n` columnas de x0 a x1 (o, con `alongZ`, de z0 a z1 en la x dada). */
export function colonnade(g, { from, to, at, n, y, h, r = 0.12, alongZ = false, color }) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const v = from + (to - from) * t;
    g.add(alongZ ? column(at, y, v, h, r, color) : column(v, y, at, h, r, color));
  }
}

/** Tejado bajo a cuatro aguas de terracota. */
export function hipRoof(w, d, h, color = C.roofRed, x = 0, y = 0, z = 0) {
  const geo = new THREE.ConeGeometry(1, 1, 4);
  geo.rotateY(Math.PI / 4);
  geo.scale(w * 0.7071, h, d * 0.7071);
  geo.translate(0, h / 2, 0);
  const m = mesh(geo, color);
  m.position.set(x, y, z);
  return m;
}

/**
 * Tejado a dos aguas con frontón de mármol en los extremos (cumbrera a lo largo de Z):
 * el triángulo de la fachada queda mirando a +Z.
 */
export function pedimentRoof(w, h, d, x = 0, y = 0, z = 0, roof = C.roofRed) {
  const g = new THREE.Group();
  g.add(gableRoof(w, h, d, roof, 0, 0, 0));
  for (const s of [-1, 1]) {
    // Marco de mármol, tímpano pintado de azul y acroterias doradas en las esquinas
    g.add(gableRoof(w * 0.96, h * 0.92, 0.05, C.marble, 0, 0.02, s * (d / 2 + 0.02)));
    g.add(gableRoof(w * 0.74, h * 0.62, 0.02, '#4f6f9e', 0, 0.09, s * (d / 2 + 0.052)));
    const apex = mesh(new THREE.ConeGeometry(0.07, 0.16, 5), C.gold, { metalness: 0.5, roughness: 0.4 });
    apex.position.set(0, h + 0.06, s * (d / 2 + 0.02));
    g.add(apex);
    for (const k of [-1, 1]) g.add(box(0.07, 0.1, 0.07, C.gold, k * (w / 2 - 0.04), 0, s * (d / 2 + 0.02), { metalness: 0.5, roughness: 0.4 }));
  }
  // Tejas de cumbrera y antefijas a lo largo del alero
  const ridge = cyl(0.04, 0.04, d + 0.04, 6, '#a5502f', 0, 0, 0);
  ridge.rotation.x = Math.PI / 2;
  ridge.position.y = h;
  g.add(ridge);
  for (let k = 0; k <= Math.floor(d / 0.32); k++) for (const s of [-1, 1]) g.add(box(0.05, 0.07, 0.04, C.marble, s * (w / 2 + 0.01), -0.02, -d / 2 + 0.16 + k * 0.32));
  g.position.set(x, y, z);
  return g;
}

/**
 * Friso dórico alrededor de un arquitrabe de w × d (de y a y + h): triglifos azules
 * y metopas rojas, pintados como en los templos griegos.
 */
export function frieze(g, w, d, y, h = 0.2, x = 0, z = 0) {
  const step = 0.3;
  const faces = [
    [w, (u) => [x + u, z + d / 2 + 0.012], 0],
    [w, (u) => [x + u, z - d / 2 - 0.012], 0],
    [d, (u) => [x + w / 2 + 0.012, z + u], Math.PI / 2],
    [d, (u) => [x - w / 2 - 0.012, z + u], Math.PI / 2],
  ];
  for (const [len, at, rot] of faces) {
    const n = Math.max(2, Math.floor(len / step));
    for (let k = 0; k < n; k++) {
      const u = -len / 2 + (k + 0.5) * (len / n);
      const [px, pz] = at(u);
      const piece = box(k % 2 ? 0.11 : 0.07, h * 0.7, 0.02, k % 2 ? '#a8432f' : '#3f5f8f', px, y + h * 0.15, pz);
      piece.rotation.y = rot;
      g.add(piece);
    }
  }
}

/** Cúpula sobre un tambor; devuelve el grupo (su base va en y). */
export function dome(r, color = C.roofBlue, x = 0, y = 0, z = 0, drumH = 0.35, extra) {
  const g = new THREE.Group();
  g.add(cyl(r * 1.02, r * 1.05, drumH, 14, C.marble, 0, 0, 0));
  g.add(cyl(r * 1.1, r * 1.1, 0.06, 14, C.marbleDark, 0, drumH, 0));
  const cap = mesh(new THREE.SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), color, extra);
  cap.position.y = drumH + 0.06;
  g.add(cap);
  g.add(cyl(0.05, 0.08, 0.25, 6, C.gold, 0, drumH + 0.06 + r * 0.95, 0, { metalness: 0.5, roughness: 0.4 }));
  g.position.set(x, y, z);
  return g;
}

const AMPHORA = (() => {
  const pts = [
    [0.0, 0.0],
    [0.05, 0.02],
    [0.1, 0.12],
    [0.13, 0.25],
    [0.12, 0.36],
    [0.07, 0.44],
    [0.045, 0.5],
    [0.06, 0.54],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 8);
})();

/** Ánfora de barro (unos 0,55 de alto). */
export function amphora(x, y, z, color = '#b9643a', s = 1) {
  const m = new THREE.Mesh(AMPHORA.clone(), mat(color));
  m.castShadow = true;
  m.position.set(x, y, z);
  m.scale.setScalar(s);
  return m;
}

/** Estatua de mármol o bronce sobre su pedestal. */
export function statue(x, z, color = C.marble, h = 0.9, extra) {
  const g = new THREE.Group();
  g.add(box(0.36, 0.32, 0.36, C.marbleDark, 0, 0, 0));
  g.add(cyl(0.09, 0.16, h * 0.62, 7, color, 0, 0.32, 0, extra));
  const head = mesh(new THREE.SphereGeometry(0.08, 8, 6), color, extra);
  head.position.y = 0.32 + h * 0.62 + 0.07;
  g.add(head);
  const arm = box(0.05, h * 0.42, 0.05, color, 0.14, 0.32 + h * 0.3, 0, extra);
  arm.rotation.z = -0.5;
  g.add(arm);
  g.position.set(x, 0, z);
  return g;
}

/** Pérgola con parra (sombra para las mesas). */
export function pergola(w, d, h, x = 0, z = 0) {
  const g = new THREE.Group();
  for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) g.add(cyl(0.05, 0.06, h, 6, C.marble, px, 0, pz));
  for (const pz of [-d / 2, d / 2]) g.add(box(w + 0.2, 0.06, 0.07, C.woodDark, 0, h, pz));
  for (let i = 0; i < 5; i++) g.add(box(0.05, 0.05, d + 0.2, C.woodDark, -w / 2 + (w * i) / 4, h + 0.06, 0));
  const vines = ['#5f8f3a', '#6f9f45', '#4f7f32'];
  for (let i = 0; i < 7; i++) {
    const leaf = mesh(new THREE.DodecahedronGeometry(0.22), vines[i % 3]);
    leaf.position.set(-w / 2 + ((i * 0.61) % 1) * w, h + 0.12, -d / 2 + ((i * 0.37) % 1) * d);
    leaf.scale.y = 0.45;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}

// ── Árboles del Mediterráneo ─────────────────────────────────────────────────

/** Ciprés: alto, estrecho y verde oscuro. */
export function cypress(color = '#2f5e34') {
  const t = new THREE.Group();
  t.add(cyl(0.06, 0.08, 0.3, 5, C.woodDark));
  const body = mesh(new THREE.ConeGeometry(0.34, 2.4, 7), color);
  body.position.y = 1.45;
  const belly = mesh(new THREE.SphereGeometry(0.34, 7, 5), color);
  belly.position.y = 0.55;
  belly.scale.y = 1.4;
  t.add(body, belly);
  return t;
}

/** Olivo: tronco retorcido y copa gris verdosa. */
export function olive(color = '#829a5c') {
  const t = new THREE.Group();
  const trunk = cyl(0.08, 0.13, 0.7, 5, '#6b5a45');
  trunk.rotation.z = 0.25;
  t.add(trunk);
  for (const [x, y, z, s] of [[0.15, 0.85, 0, 0.5], [-0.25, 0.75, 0.15, 0.4], [0.05, 1.0, -0.25, 0.38]]) {
    const crown = mesh(new THREE.DodecahedronGeometry(s), color);
    crown.position.set(x, y, z);
    crown.scale.y = 0.7;
    t.add(crown);
  }
  return t;
}

/** Un árbol del Mediterráneo al azar: olivo, ciprés o pino piñonero. */
export function mediterraneanTree(r) {
  if (r < 0.4) return olive(r < 0.2 ? '#829a5c' : '#76925a');
  if (r < 0.75) return cypress(r < 0.58 ? '#2f5e34' : '#36683a');
  return stonePine(r < 0.88 ? '#476f3a' : '#3f6633');
}

/** Pino piñonero: tronco alto y copa ancha y plana, como una sombrilla. */
export function stonePine(color = '#476f3a') {
  const t = new THREE.Group();
  const trunk = cyl(0.07, 0.12, 1.7, 5, '#7a5a3c');
  trunk.rotation.z = -0.12;
  t.add(trunk);
  const crown = mesh(new THREE.DodecahedronGeometry(0.85), color);
  crown.position.set(0.2, 1.95, 0);
  crown.scale.set(1.25, 0.42, 1.1);
  t.add(crown);
  return t;
}

// ── Edificios ────────────────────────────────────────────────────────────────

function ayuntamiento(level) {
  // Palacio de gobierno: escalinata, sala rodeada de columnas, tejado de terracota y cúpula
  const g = new THREE.Group();
  const y0 = stylobate(g, 4.6, 4.6, 3);
  g.add(box(1.6, 0.3, 0.6, C.marble, 0, 0, 2.55));
  const h = 1.5;
  // Sala con puerta y ventanas entre las columnas
  g.add(box(2.9, h, 2.9, C.wall, 0, y0, 0));
  g.add(box(0.6, 0.85, 0.05, C.woodDark, 0, y0, 1.46));
  for (const x of [-0.9, 0.9]) g.add(box(0.3, 0.42, 0.05, C.dark, x, y0 + 0.65, 1.46, WINDOW_GLOW));
  for (const s of [-1, 1]) for (const z of [-0.8, 0.8]) g.add(box(0.05, 0.42, 0.3, C.dark, s * 1.46, y0 + 0.65, z, WINDOW_GLOW));
  // Peristilo: más columnas al frente con el nivel
  const front = Math.min(6, 4 + Math.floor(level / 4));
  colonnade(g, { from: -1.95, to: 1.95, at: 1.95, n: front, y: y0, h });
  colonnade(g, { from: -1.95, to: 1.95, at: -1.95, n: 4, y: y0, h });
  for (const x of [-1.95, 1.95]) colonnade(g, { from: -0.65, to: 0.65, at: x, n: 2, y: y0, h, alongZ: true });
  // Arquitrabe con friso y tejado
  g.add(box(4.25, 0.22, 4.25, C.marbleDark, 0, y0 + h, 0));
  frieze(g, 4.25, 4.25, y0 + h, 0.22);
  g.add(box(4.35, 0.06, 4.35, C.marble, 0, y0 + h + 0.22, 0));
  const top = y0 + h + 0.28;
  g.add(hipRoof(4.4, 4.4, 0.7, C.roofRed, 0, top, 0));
  // Cúpula desde el nivel 3 (dorada desde el 8) con su linterna de columnas a partir del 6
  let peak = top + 0.7;
  if (level >= 3) {
    const r = 0.95 + Math.min(level, 12) * 0.02;
    const drum = level >= 6 ? 0.7 : 0.35;
    const golden = level >= 8;
    g.add(dome(r, golden ? C.gold : C.roofBlue, 0, top + 0.35, 0, drum, golden ? { metalness: 0.55, roughness: 0.35 } : undefined));
    peak = top + 0.35 + drum + 0.06 + r + 0.2;
  }
  // Estatuas a los lados de la escalinata
  if (level >= 5) for (const x of [-1.6, 1.6]) g.add(statue(x, 2.55, level >= 9 ? C.gold : C.marble, 0.8, level >= 9 ? { metalness: 0.5, roughness: 0.4 } : undefined));
  // Estandarte
  g.add(cyl(0.035, 0.035, 1.2, 6, C.dark, 0, peak, 0));
  const flag = box(0.7, 0.4, 0.03, '#a8231a', 0, 0, 0);
  flag.geometry.translate(0.35, 0, 0);
  flag.position.set(0, peak + 0.95, 0);
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
  // Ágora: puestos con toldos delante de una stoa porticada
  const g = new THREE.Group();
  g.add(box(4.0, 0.04, 3.4, '#ddd0b4', 0, 0, 0));
  // Stoa al fondo
  g.add(box(3.8, 0.15, 1.1, C.marbleDark, 0, 0, -1.55));
  g.add(box(3.6, 1.35, 0.25, C.wall, 0, 0.15, -1.95));
  for (const x of [-1.2, 0, 1.2]) g.add(box(0.5, 0.7, 0.05, C.dark, x, 0.15, -1.81));
  colonnade(g, { from: -1.75, to: 1.75, at: -1.15, n: Math.min(7, 4 + Math.floor(level / 3)), y: 0.15, h: 1.35, r: 0.1 });
  g.add(box(3.8, 0.16, 1.1, C.marbleDark, 0, 1.5, -1.55));
  frieze(g, 3.8, 1.1, 1.5, 0.16, 0, -1.55);
  const roof = gableRoof(1.25, 0.4, 3.9, C.roofRed, 0, 1.66, -1.55);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  // Puestos
  const spots = [
    [-1.1, 0.2, 0],
    [1.1, 0.2, 0],
    [-1.15, 1.4, Math.PI],
    [1.15, 1.4, Math.PI],
  ];
  const n = Math.min(spots.length, 1 + Math.floor(level / 2));
  for (let i = 0; i < n; i++) {
    const [x, z, rot] = spots[i];
    const s = stall(C.cloth[i]);
    s.position.set(x, 0, z);
    s.rotation.y = rot;
    g.add(s);
  }
  // Fuente con el oro del mercado (crece con el nivel)
  const hgt = 0.3 + Math.min(level, 12) * 0.05;
  g.add(cyl(0.6, 0.65, 0.18, 12, C.marble, 0, 0, 0.8));
  g.add(mesh(new THREE.ConeGeometry(0.42, hgt, 9), C.gold, { metalness: 0.6, roughness: 0.35 }));
  g.children.at(-1).position.set(0, 0.18 + hgt / 2, 0.8);
  // Ánforas en venta
  for (let i = 0; i < Math.min(5, 1 + level); i++) g.add(amphora(-1.85 + i * 0.22, 0, 0.75 + (i % 2) * 0.2, i % 2 ? '#b9643a' : '#a5542f', 0.9));
  return g;
}

function almacen(level) {
  // Horreum: almacén de piedra con frontón y puerta en arco
  const g = new THREE.Group();
  g.add(box(3.3, 0.2, 2.6, C.marbleDark, 0, 0, -0.2));
  g.add(box(3.0, 1.55, 2.2, C.stone, 0, 0.2, -0.2));
  // Pilastras
  for (const x of [-1.5, -0.5, 0.5, 1.5]) g.add(box(0.16, 1.55, 0.08, C.marble, x, 0.2, 0.92));
  g.add(box(3.15, 0.18, 2.35, C.marbleDark, 0, 1.75, -0.2));
  g.add(pedimentRoof(3.2, 0.7, 2.45, 0, 1.93, -0.2));
  // Puerta en arco
  g.add(box(0.8, 0.8, 0.05, C.woodDark, 0, 0.2, 0.92));
  const arch = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12, 1, false, 0, Math.PI), C.woodDark);
  arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  arch.position.set(0, 1.0, 0.92);
  g.add(arch);
  // Ventanucos
  for (const x of [-1.0, 1.0]) g.add(box(0.3, 0.3, 0.05, C.dark, x, 1.0, 0.92, WINDOW_GLOW));
  // Ánforas y fardos alrededor (más con el nivel)
  const spots = [
    [-1.9, 0.6],
    [1.9, 0.5],
    [-1.85, -1.2],
    [1.95, -1.0],
    [-1.3, 1.45],
    [1.3, 1.45],
  ];
  const n = Math.min(spots.length, level);
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[i];
    if (i % 2) {
      g.add(amphora(x - 0.13, 0, z, '#b9643a'), amphora(x + 0.13, 0, z + 0.1, '#a5542f'), amphora(x, 0, z - 0.18, '#c2703f'));
    } else g.add(box(0.5, 0.45, 0.5, '#c9b48a', x, 0, z));
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
  // Biblioteca y escuela: templete con pórtico, frontón y cúpula
  const g = new THREE.Group();
  const y0 = stylobate(g, 3.6, 2.9, 2);
  g.add(box(2.6, 1.6, 1.8, C.wall, 0, y0, -0.25));
  g.add(box(0.5, 0.8, 0.05, C.woodDark, 0, y0, 0.66));
  for (const x of [-0.85, 0.85]) g.add(box(0.28, 0.45, 0.05, C.dark, x, y0 + 0.6, 0.66, WINDOW_GLOW));
  const cols = Math.min(6, 4 + Math.floor(level / 3));
  colonnade(g, { from: -1.3, to: 1.3, at: 1.05, n: cols, y: y0, h: 1.6 });
  // Arquitrabe con friso y tejado con el frontón mirando al frente
  g.add(box(3.05, 0.2, 2.75, C.marbleDark, 0, y0 + 1.6, -0.05));
  frieze(g, 3.05, 2.75, y0 + 1.6, 0.2, 0, -0.05);
  g.add(pedimentRoof(3.1, 0.6, 2.8, 0, y0 + 1.8, -0.05));
  // Cúpula que asoma del tejado (dorada desde el nivel 4)
  const golden = level >= 4;
  g.add(dome(0.75, golden ? C.gold : C.roofBlue, 0, y0 + 2.05, -0.45, 0.45, golden ? { metalness: 0.5, roughness: 0.4 } : undefined));
  // Telescopio desde el nivel 3
  if (level >= 3) {
    const scope = new THREE.Group();
    scope.position.set(1.45, y0, -1.0);
    scope.add(box(0.06, 0.6, 0.06, C.wood, 0, 0, 0));
    const tube = cyl(0.08, 0.11, 0.9, 8, '#b08a3a', 0, 0, 0, { metalness: 0.6, roughness: 0.4 });
    tube.position.set(0, 0.75, 0.15);
    tube.rotation.x = 0.9;
    scope.add(tube);
    scope.userData.swing = { speed: 0.3, amp: 0.8 };
    g.add(scope);
  }
  if (level >= 6) g.add(statue(-1.55, 1.2));
  return g;
}

function cuartel(level) {
  // Castro: barracones de piedra con pórtico y patio de armas cerrado por un muro bajo
  const g = new THREE.Group();
  g.add(box(2.9, 0.15, 1.3, C.marbleDark, 0, 0, -1.45));
  g.add(box(2.7, 1.05, 0.85, C.wall, 0, 0.15, -1.6));
  colonnade(g, { from: -1.25, to: 1.25, at: -0.95, n: 5, y: 0.15, h: 1.05, r: 0.09 });
  g.add(box(2.95, 0.14, 1.3, C.marbleDark, 0, 1.2, -1.45));
  g.add(hipRoof(3.0, 1.4, 0.45, C.roofRed, 0, 1.34, -1.45));
  g.add(box(0.4, 0.65, 0.05, C.woodDark, 0, 0.15, -1.17));
  // Patio de arena y muro bajo con puerta
  g.add(box(3.4, 0.03, 2.4, '#d8c49a', 0, 0, 0.5));
  for (const [x, z, w, d] of [[-1.1, 1.72, 1.2, 0.18], [1.1, 1.72, 1.2, 0.18], [-1.72, 0.45, 0.18, 2.4], [1.72, 0.45, 0.18, 2.4]]) g.add(box(w, 0.5, d, C.stone, x, 0, z));
  for (const x of [-0.5, 0.5]) g.add(box(0.26, 0.85, 0.26, C.marble, x, 0, 1.72));
  // Estandartes rojos con el águila dorada
  const banners = Math.min(4, 1 + Math.floor(level / 2));
  for (let i = 0; i < banners; i++) {
    const x = -1.2 + i * 0.8;
    g.add(cyl(0.03, 0.03, 1.5, 5, C.dark, x, 1.4, -0.85));
    g.add(box(0.12, 0.1, 0.06, C.gold, x, 2.9, -0.85, { metalness: 0.5, roughness: 0.4 }));
    const flag = box(0.34, 0.45, 0.02, '#a8231a', 0, 0, 0);
    flag.geometry.translate(0.17, 0, 0);
    flag.position.set(x, 2.55, -0.85);
    flag.userData.wave = true;
    g.add(flag);
  }
  // Poste de entrenamiento
  g.add(cyl(0.05, 0.05, 0.8, 5, C.wood, 1.3, 0, -0.25));
  g.add(box(0.5, 0.06, 0.06, C.wood, 1.3, 0.55, -0.25));
  const dummy = mesh(new THREE.SphereGeometry(0.12, 8, 6), '#d8c08a');
  dummy.position.set(1.3, 0.9, -0.25);
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
  // Muelle de piedra en la orilla, almacén porticado y mercancías
  g.add(box(4.6, 0.3, 1.0, C.stone, 0, 0.12, -0.35));
  g.add(box(1.5, 0.95, 1.0, C.wall, 2.05, 0, 0.45));
  colonnade(g, { from: 1.45, to: 2.65, at: -0.15, n: 3, y: 0, h: 0.95, r: 0.07 });
  g.add(box(1.6, 0.1, 1.35, C.marbleDark, 2.05, 0.95, 0.3));
  g.add(hipRoof(1.65, 1.4, 0.4, C.roofRed, 2.05, 1.05, 0.3));
  g.add(amphora(-1.45, 0.42, 0.0, '#b9643a'), amphora(-1.25, 0.42, 0.1, '#a5542f'), box(0.4, 0.4, 0.4, '#c9b48a', -1.9, 0.42, -0.1));
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
    // Torrecilla de piedra con el fuego arriba
    g.add(cyl(0.7, 0.95, 1.3, 8, C.stoneDark, fx, -1.1, fz));
    g.add(box(0.75, 1.3, 0.75, C.marble, fx, 0.2, fz));
    g.add(box(0.9, 0.1, 0.9, C.marbleDark, fx, 1.5, fz));
    g.add(cyl(0.3, 0.34, 0.8, 8, C.marble, fx, 1.6, fz));
    g.add(cyl(0.26, 0.26, 0.35, 8, '#fff2a8', fx, 2.4, fz, { emissive: '#ffd34a', emissiveIntensity: 1.5 }));
    const top = mesh(new THREE.ConeGeometry(0.38, 0.35, 8), C.roofRed);
    top.position.set(fx, 2.93, fz);
    g.add(top);
  }
  // Amarres para los barcos que hay en casa
  g.userData.docks = [];
  for (let z = -1.8; z > -len; z -= 2.0) for (const x of [-1.6, 1.6]) g.userData.docks.push({ x, z });
  return g;
}

function templo(level) {
  const g = new THREE.Group();
  const base = stylobate(g, 3.6, 2.8, 3, 0, 0, 0.16);
  const w = 2.6;
  const d = 1.9;
  // Naos y columnata (más columnas con el nivel)
  g.add(box(w - 0.9, 1.4, d - 0.8, C.wall, 0, base, -0.05));
  g.add(box(0.4, 0.75, 0.05, C.woodDark, 0, base, d / 2 - 0.44));
  const perSide = Math.min(6, 3 + Math.floor(level / 2));
  for (const z of [-d / 2, d / 2]) colonnade(g, { from: -w / 2, to: w / 2, at: z, n: perSide, y: base, h: 1.4, r: 0.11 });
  for (const x of [-w / 2, w / 2]) g.add(column(x, base, 0, 1.4, 0.11));
  g.add(box(w + 0.3, 0.22, d + 0.3, C.marbleDark, 0, base + 1.4, 0));
  frieze(g, w + 0.3, d + 0.3, base + 1.4, 0.22);
  const gold = level >= 5;
  // Frontones a los lados largos: la cumbrera va a lo ancho, como en los templos griegos
  const roof = pedimentRoof(d + 0.3, 0.6, w + 0.4, 0, base + 1.62, 0, gold ? C.gold : C.roofRed);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  // Altar con fuego sagrado delante del templo
  g.add(box(0.5, 0.45, 0.5, C.marble, 0, 0, 1.75));
  const fire = mesh(new THREE.ConeGeometry(0.18, 0.45, 6), '#ffb347', { emissive: '#ff7a00', emissiveIntensity: 1.6 });
  fire.position.set(0, 0.68, 1.75);
  fire.userData.flicker = true;
  g.add(fire);
  // Estatua del dios desde el nivel 3
  if (level >= 3) g.add(statue(1.55, 1.4, gold ? C.gold : C.marble, 1.0, gold ? { metalness: 0.6, roughness: 0.35 } : undefined));
  if (level >= 7) g.add(statue(-1.55, 1.4, gold ? C.gold : C.marble, 1.0, gold ? { metalness: 0.6, roughness: 0.35 } : undefined));
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

// ── Gente de la época ────────────────────────────────────────────────────────
// Figuras de unos 0,6 de alto que miran a +Z, con la mano derecha en +X: túnicas,
// togas, vestidos largos, velos, armaduras y lo que llevan en las manos.

const SKIN = ['#e8c39e', '#d9a87e', '#c48a5e', '#f0cfaa'];
const HAIR = ['#3a2a1e', '#5a3a22', '#2a2420', '#7a5a32', '#a8743a'];
const BRONZE_C = '#c9a24a';
const IRON = '#8a8f96';
const LEATHER = '#7a5230';

/** Brazo colgando del hombro (s = 1 derecho, -1 izquierdo); `pose`: abajo, adelante, arriba o en jarra. */
function arm(g, s, pose, sleeve, skin) {
  const a = new THREE.Group();
  a.position.set(s * 0.1, 0.43, 0);
  a.add(cyl(0.024, 0.026, 0.08, 5, sleeve, 0, -0.08, 0));
  a.add(cyl(0.019, 0.022, 0.13, 5, skin, 0, -0.2, 0));
  const hand = mesh(new THREE.SphereGeometry(0.022, 5, 4), skin);
  hand.position.y = -0.21;
  a.add(hand);
  if (pose === 'abajo') a.rotation.z = s * 0.12;
  if (pose === 'adelante') a.rotation.set(-1.15, 0, s * 0.15);
  if (pose === 'arriba') a.rotation.set(0, 0, s * 2.6);
  if (pose === 'saludo') a.rotation.set(-0.3, 0, s * 2.3);
  if (pose === 'cadera') a.rotation.set(0, 0, s * 0.6);
  g.add(a);
  return a;
}

/**
 * Una persona. Opciones: skin, hair, female, beard, long (vestido largo), color (ropa),
 * skirt (falda de otro color), drape (toga o manto cruzado), veil, shawl, belt, cloak,
 * cuirass, pteruges, greaves, helmet ('corintio' | 'legionario' | 'gorro' | 'panuelo'),
 * crest, arms: [derecho, izquierdo] (poses).
 */
export function figure(o) {
  const g = new THREE.Group();
  const skin = o.skin ?? SKIN[0];
  const hair = o.hair ?? HAIR[0];
  const top = o.cuirass ? (o.cuirassColor ?? BRONZE_C) : o.color;
  // Piernas y sandalias (o grebas)
  for (const s of [-1, 1]) {
    g.add(cyl(0.022, 0.026, 0.22, 5, o.greaves ? (o.cuirassColor ?? BRONZE_C) : skin, s * 0.04, 0.02, 0));
    g.add(box(0.05, 0.022, 0.085, '#5e3b1c', s * 0.04, 0, 0.012));
  }
  // Ropa: vestido hasta los pies o túnica hasta la rodilla
  if (o.long) g.add(cyl(0.08, 0.118, 0.32, 9, o.skirt ?? o.color, 0, 0.02, 0));
  else g.add(cyl(0.074, 0.098, 0.16, 9, o.color, 0, 0.2, 0));
  if (o.pteruges) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const strip = box(0.035, 0.09, 0.015, o.pteruges, Math.sin(a) * 0.088, 0.17, Math.cos(a) * 0.088);
    strip.rotation.y = a;
    g.add(strip);
  }
  // Torso y hombros
  g.add(cyl(0.068, 0.076, 0.16, 9, top, 0, 0.3, 0));
  g.add(box(0.19, 0.05, 0.09, top, 0, 0.415, 0));
  if (o.belt) g.add(cyl(0.079, 0.079, 0.022, 9, o.belt, 0, 0.32, 0));
  // Toga o manto cruzado del hombro izquierdo a la cadera derecha, y su caída por la izquierda
  if (o.drape) {
    const band = box(0.07, 0.3, 0.16, o.drape, 0, 0, 0);
    band.position.set(0.0, 0.31, 0.0);
    band.rotation.z = -0.6;
    band.scale.set(1, 1, 1);
    g.add(band);
    g.add(box(0.06, 0.34, 0.13, o.drape, -0.09, 0.1, 0));
  }
  if (o.shawl) g.add(box(0.22, 0.07, 0.17, o.shawl, 0, 0.39, 0), box(0.05, 0.2, 0.12, o.shawl, 0.1, 0.2, 0.02));
  // Capa a la espalda
  if (o.cloak) {
    const c = box(0.2, 0.36, 0.025, o.cloak, 0, 0.08, -0.075);
    c.rotation.x = 0.12;
    g.add(c);
  }
  // Brazos
  const [right = 'abajo', left = 'abajo'] = o.arms ?? [];
  const sleeve = o.cuirass ? (o.sleeve ?? o.color) : o.color;
  const ra = arm(g, 1, right, sleeve, skin);
  const la = arm(g, -1, left, sleeve, skin);
  // Cuello, cabeza, cara y pelo
  g.add(cyl(0.024, 0.028, 0.05, 5, skin, 0, 0.44, 0));
  const head = mesh(new THREE.SphereGeometry(0.058, 9, 7), skin);
  head.position.y = 0.535;
  g.add(head);
  for (const s of [-1, 1]) g.add(box(0.012, 0.012, 0.01, '#2a2018', s * 0.022, 0.538, 0.054));
  g.add(box(0.012, 0.022, 0.016, skin, 0, 0.52, 0.058));
  if (o.beard) g.add(box(0.075, 0.045, 0.04, hair, 0, 0.485, 0.035));
  if (!o.helmet && !o.veil) {
    const cap = mesh(new THREE.SphereGeometry(0.062, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    cap.position.set(0, 0.54, -0.006);
    cap.scale.set(1, 0.9, 1.02);
    g.add(cap);
    if (o.female) {
      const bun = mesh(new THREE.SphereGeometry(0.034, 7, 5), hair);
      bun.position.set(0, 0.565, -0.062);
      g.add(bun);
      if (o.band) g.add(cyl(0.063, 0.063, 0.014, 9, o.band, 0, 0.565, -0.004));
    }
  }
  if (o.veil) {
    const v = mesh(new THREE.SphereGeometry(0.068, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), o.veil);
    v.position.y = 0.535;
    g.add(v, box(0.13, 0.2, 0.03, o.veil, 0, 0.37, -0.058));
  }
  if (o.helmet) {
    const metal = o.helmet === 'corintio' ? BRONZE_C : o.helmet === 'legionario' ? IRON : o.helmet === 'gorro' ? LEATHER : '#b8442f';
    const h = mesh(new THREE.SphereGeometry(0.066, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    h.position.y = 0.535;
    g.add(h);
    if (o.helmet === 'corintio') g.add(box(0.03, 0.06, 0.02, metal, -0.045, 0.49, 0.05), box(0.03, 0.06, 0.02, metal, 0.045, 0.49, 0.05));
    if (o.helmet === 'legionario') g.add(box(0.12, 0.04, 0.04, metal, 0, 0.5, -0.05));
    if (o.helmet === 'panuelo') g.add(box(0.03, 0.05, 0.04, metal, 0.05, 0.53, -0.05));
    if (o.crest) {
      // Penacho de crin: de delante atrás (griego) o de lado a lado (centurión)
      if (o.helmet === 'corintio') {
        g.add(box(0.022, 0.06, 0.15, o.crest, 0, 0.59, 0));
        g.add(box(0.022, 0.04, 0.06, o.crest, 0, 0.56, -0.09));
      } else g.add(box(0.11, 0.035, 0.018, o.crest, 0, 0.59, 0));
    }
  }
  g.userData.hands = { right: ra, left: la };
  return g;
}

/** Algo en una mano: se pega al final del brazo, siguiendo su postura. */
function inHand(armGroup, obj, y = -0.22) {
  obj.position.y += y;
  armGroup.add(obj);
}

/** Lanza (en la mano derecha, vertical). */
function spear(g, h = 0.95) {
  g.add(cyl(0.011, 0.011, h, 4, C.woodDark, 0.135, 0.0, 0.03));
  g.add(mesh(new THREE.ConeGeometry(0.022, 0.08, 4), '#c9ced6'));
  g.children.at(-1).position.set(0.135, h + 0.04, 0.03);
}

/** Escudo redondo de bronce (aspis) en el brazo izquierdo, con su emblema. */
function aspis(g, color = BRONZE_C, emblem = '#a8231a') {
  const s = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 14), color);
  s.rotation.x = Math.PI / 2;
  s.position.set(-0.12, 0.3, 0.07);
  g.add(s);
  const e = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 8), emblem);
  e.rotation.x = Math.PI / 2;
  e.position.set(-0.12, 0.3, 0.085);
  g.add(e);
}

const VILLAGERS = [
  // Ciudadano con toga blanca sobre túnica anaranjada, saludando
  { color: '#d9822b', drape: '#f6f1e7', arms: ['saludo', 'abajo'], hair: HAIR[1] },
  // Mujer de amarillo y verde con velo claro
  { female: true, long: true, color: '#e8c547', skirt: '#4f8f4a', belt: '#3f6fa8', veil: '#f6f1e7', arms: ['cadera', 'abajo'] },
  // Guerrero con coraza, faldellín de cuero, capa roja y lanza
  { color: '#8a4a2a', cuirass: true, pteruges: LEATHER, cloak: '#b8442f', beard: true, hair: HAIR[3], arms: ['abajo', 'abajo'], extra: (g) => spear(g) },
  // Mujer de rojo con velo blanco y una jarra
  { female: true, long: true, color: '#c4552d', skirt: '#e3b23c', veil: '#f6f1e7', arms: ['adelante', 'abajo'], extra: (g) => inHand(g.userData.hands.right, amphora(0, -0.12, 0, '#c2703f', 0.3)) },
  // Guardia con casco de penacho y escudo redondo
  { color: '#a8231a', cuirass: true, pteruges: LEATHER, greaves: true, helmet: 'corintio', crest: '#a8231a', arms: ['abajo', 'adelante'], extra: (g) => (spear(g), aspis(g)) },
  // Aguadora de blanco con el ánfora al hombro
  { female: true, long: true, color: '#f6f1e7', belt: '#c9a24a', band: '#3f6fa8', hair: HAIR[4], arms: ['abajo', 'arriba'], extra: (g) => {
    const a = amphora(-0.12, 0.44, -0.02, '#b9643a', 0.45);
    a.rotation.z = 0.5;
    g.add(a);
  } },
  // Mujer de azul con chal anaranjado y pañuelo verde
  { female: true, long: true, color: '#3f7fc0', shawl: '#e08a3a', veil: '#4f8f4a', arms: ['adelante', 'adelante'] },
  // Erudito con toga blanca y un pergamino
  { color: '#ece4d4', long: true, drape: '#f6f1e7', beard: true, hair: HAIR[2], arms: ['adelante', 'abajo'], extra: (g) => {
    const scroll = cyl(0.016, 0.016, 0.11, 6, '#efe2c4', 0, 0, 0);
    scroll.rotation.z = Math.PI / 2;
    inHand(g.userData.hands.right, scroll, -0.23);
  } },
  // Sirvienta de gris con ribete verde y una bandeja con copas
  { female: true, long: true, color: '#9c9a94', belt: '#4f8f4a', band: '#4f8f4a', hair: HAIR[1], arms: ['adelante', 'adelante'], extra: (g) => {
    g.add(cyl(0.09, 0.09, 0.012, 10, BRONZE_C, 0, 0.36, 0.16));
    g.add(cyl(0.015, 0.012, 0.04, 6, C.gold, 0.03, 0.372, 0.16), cyl(0.015, 0.012, 0.04, 6, C.gold, -0.03, 0.372, 0.17));
  } },
];

/** Vecino de la ciudad (cada `i` es una persona distinta, con su ropa y lo que lleva). */
export function createVillager(i) {
  const kind = VILLAGERS[i % VILLAGERS.length];
  const g = figure({ ...kind, skin: SKIN[i % SKIN.length], hair: kind.hair ?? HAIR[(i * 3) % HAIR.length] });
  kind.extra?.(g);
  // Una sola pieza por persona (son muchas) y del tamaño de las puertas de la ciudad
  bakeStatic(g);
  g.traverse((m) => (m.castShadow = false));
  g.scale.setScalar(0.75);
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
  // Puerta principal (tan ancha como la avenida: pasan los carros y la gente por las aceras);
  // el resto del muro lo dibuja la escena alrededor de la ciudad.
  const g = new THREE.Group();
  const h = wallHeight(level);
  for (const x of [-2.15, 2.15]) {
    g.add(box(1.0, h + 0.8, 1.0, C.stone, x, 0, 0));
    for (const dx of [-0.35, 0, 0.35]) for (const dz of [-0.35, 0.35]) g.add(box(0.22, 0.3, 0.22, C.stone, x + dx, h + 0.8, dz));
  }
  g.add(box(3.5, 0.5, 0.8, C.stoneDark, 0, h - 0.1, 0));
  const pole = h + 1.1;
  g.add(cyl(0.03, 0.03, 1.0, 5, C.dark, 2.15, pole, 0));
  const flag = box(0.5, 0.32, 0.02, C.cloth[0], 0, 0, 0);
  flag.geometry.translate(0.25, 0, 0);
  flag.position.set(2.15, pole + 0.8, 0);
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
  // Casa de comidas mediterránea: dos plantas encaladas, contraventanas azules y una pérgola con parra
  const g = new THREE.Group();
  g.add(box(3.2, 0.15, 2.6, C.marbleDark, 0, 0, -0.3));
  g.add(box(2.4, 1.1, 1.6, C.wall, 0, 0.15, -0.7));
  g.add(box(1.7, 0.85, 1.4, '#f3dcb0', -0.3, 1.25, -0.8));
  g.add(hipRoof(1.95, 1.65, 0.45, C.roofRed, -0.3, 2.1, -0.8));
  // Azotea con barandilla a la derecha
  g.add(box(0.7, 0.2, 1.5, C.wall, 0.85, 1.25, -0.7));
  // Puerta, ventanas con contraventanas azules
  g.add(box(0.55, 0.8, 0.05, C.woodDark, 0.3, 0.15, 0.11));
  for (const x of [-0.7]) {
    g.add(box(0.34, 0.36, 0.05, C.dark, x, 0.5, 0.11, WINDOW_GLOW));
    for (const s of [-1, 1]) g.add(box(0.13, 0.38, 0.04, C.roofBlue, x + s * 0.25, 0.49, 0.13));
  }
  for (const x of [-0.65, 0.05]) {
    g.add(box(0.3, 0.32, 0.05, C.dark, x, 1.5, -0.08, WINDOW_GLOW));
    for (const s of [-1, 1]) g.add(box(0.11, 0.34, 0.04, C.roofBlue, x + s * 0.21, 1.49, -0.06));
  }
  // Chimenea humeante
  g.add(box(0.3, 0.6, 0.3, C.wall, -0.9, 2.1, -1.2));
  g.add(smokeColumn(-0.9, 2.85, -1.2, 0.8));
  // Letrero colgante con una jarra
  g.add(box(0.06, 0.06, 0.6, C.woodDark, -1.2, 1.15, 0.35));
  const sign = box(0.5, 0.36, 0.04, C.woodLight, 0, 0, 0);
  sign.position.set(-1.2, 0.72, 0.6);
  sign.userData.wave = true;
  g.add(sign);
  g.add(box(0.16, 0.2, 0.05, C.gold, -1.2, 0.8, 0.63));
  // Terraza bajo la parra: mesas y bancos (más con el nivel)
  g.add(pergola(2.6, 1.1, 1.35, 0, 1.25));
  const tables = Math.min(3, 1 + Math.floor(level / 3));
  for (let i = 0; i < tables; i++) {
    const x = -0.9 + i * 0.9;
    g.add(cyl(0.26, 0.26, 0.05, 8, C.marble, x, 0.42, 1.25), cyl(0.05, 0.05, 0.42, 5, C.marbleDark, x, 0, 1.25));
    g.add(box(0.55, 0.06, 0.16, C.wood, x, 0.25, 1.65), box(0.55, 0.06, 0.16, C.wood, x, 0.25, 0.85));
    g.add(cyl(0.05, 0.04, 0.14, 6, '#b9643a', x + 0.08, 0.47, 1.25));
  }
  // Ánforas de vino
  const jars = Math.min(6, 2 + level);
  for (let i = 0; i < jars; i++) g.add(amphora(1.4 + (i % 2) * 0.22, 0, -1.3 + Math.floor(i / 2) * 0.32, i % 3 ? '#b9643a' : '#a5542f'));
  g.add(lantern(-0.5, 1.9, 0.15), lantern(0.6, 1.9, 0.15));
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
  // Faro de piedra al estilo del de Alejandría: base cuadrada, cuerpo octogonal y linterna redonda con fuego
  const g = new THREE.Group();
  for (const [x, z, s] of [[-1.0, 0.7, 0.7], [0.9, 0.9, 0.55], [0.3, -1.1, 0.6]]) {
    const r = mesh(new THREE.DodecahedronGeometry(s), C.stoneDark);
    r.position.set(x, s * 0.4, z);
    r.scale.y = 0.6;
    g.add(r);
  }
  // Casita del farero
  g.add(box(1.1, 0.75, 0.9, C.wall, 1.35, 0, -0.3), hipRoof(1.25, 1.05, 0.35, C.roofRed, 1.35, 0.75, -0.3));
  g.add(box(0.22, 0.22, 0.05, C.dark, 1.35, 0.32, 0.16, WINDOW_GLOW));
  const k = 1 + Math.min(level, 10) * 0.04;
  // Base cuadrada con su cornisa
  const h1 = 2.0 * k;
  g.add(box(1.5, 0.25, 1.5, C.marbleDark, 0, 0, 0));
  g.add(box(1.3, h1, 1.3, C.marble, 0, 0.25, 0));
  for (let i = 1; i < 4; i++) g.add(box(0.08, 0.22, 0.05, C.dark, 0, 0.25 + (h1 * i) / 4, 0.66, WINDOW_GLOW));
  let y = 0.25 + h1;
  g.add(box(1.5, 0.12, 1.5, C.marbleDark, 0, y, 0));
  y += 0.12;
  // Cuerpo octogonal
  const h2 = 1.5 * k;
  g.add(cyl(0.55, 0.6, h2, 8, C.marble, 0, y, 0));
  y += h2;
  g.add(cyl(0.72, 0.72, 0.1, 8, C.marbleDark, 0, y, 0));
  y += 0.1;
  // Linterna de columnas con el fuego
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    g.add(cyl(0.04, 0.04, 0.6, 5, C.marble, Math.cos(ang) * 0.38, y, Math.sin(ang) * 0.38));
  }
  g.add(cyl(0.3, 0.3, 0.45, 10, '#fff2a8', 0, y + 0.05, 0, { emissive: '#ffd34a', emissiveIntensity: 1.8 }));
  const lamp = y + 0.3;
  y += 0.6;
  g.add(mesh(new THREE.ConeGeometry(0.5, 0.35, 10), C.roofRed));
  g.children.at(-1).position.y = y + 0.17;
  // Estatua de bronce en lo alto
  const god = cyl(0.06, 0.1, 0.45, 6, C.gold, 0, y + 0.3, 0, { metalness: 0.55, roughness: 0.4 });
  g.add(god);
  const beam = new THREE.Group();
  beam.position.y = lamp;
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

// Los que no tienen sitio alrededor (están en la costa, sobre rocas o rodean la isla)
const NO_ADORN = new Set(['puerto', 'muralla', 'faro', 'astillero', 'coloso']);

/**
 * Escalones de prosperidad comunes a todos los edificios: con el nivel ganan un enlosado
 * y cipreses en maceta (5), pebeteros y una estatua (10) y un remate dorado con estandartes (15).
 */
function adorn(g, id, level) {
  if (NO_ADORN.has(id) || level < 5) return;
  g.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(g);
  const hx = Math.max(1.2, Math.min(2.1, (box3.max.x - box3.min.x) / 2));
  const hz = Math.max(1.0, Math.min(2.0, (box3.max.z - box3.min.z) / 2));
  const front = hz + 0.35;
  // Enlosado y cipreses en maceta a la entrada
  g.add(box(hx * 2 + 0.6, 0.03, hz * 2 + 0.6, '#ddd0b4', 0, 0, 0));
  for (const s of [-1, 1]) {
    g.add(cyl(0.16, 0.12, 0.22, 8, '#b9643a', s * (hx + 0.1), 0, front));
    const tree = cypress('#2f5e34');
    tree.scale.setScalar(0.42);
    tree.position.set(s * (hx + 0.1), 0.2, front);
    g.add(tree);
  }
  if (level >= 10) {
    // Pebeteros de mármol que arden de noche y una estatua a un lado
    for (const s of [-1, 1]) {
      g.add(cyl(0.07, 0.09, 0.75, 8, C.marble, s * (hx - 0.35), 0, front + 0.15));
      g.add(cyl(0.17, 0.08, 0.13, 8, '#8a6a3a', s * (hx - 0.35), 0.75, front + 0.15), cyl(0.12, 0.12, 0.03, 8, C.dark, s * (hx - 0.35), 0.88, front + 0.15, WINDOW_GLOW));
    }
    g.add(statue(-(hx + 0.45), 0, C.marble, 0.8));
  }
  if (level >= 15) {
    // Remate dorado en lo más alto y estandartes rojos a los lados
    const top = box3.max.y;
    const finial = mesh(new THREE.SphereGeometry(0.14, 8, 6), C.gold, { metalness: 0.55, roughness: 0.35 });
    finial.position.set(0, top + 0.12, 0);
    g.add(finial);
    for (const s of [-1, 1]) {
      g.add(cyl(0.025, 0.025, 1.6, 5, C.dark, s * (hx + 0.35), 0, -hz * 0.5));
      const flag = box(0.42, 0.55, 0.02, '#a8231a', 0, 0, 0);
      flag.geometry.translate(0.21, 0, 0);
      flag.position.set(s * (hx + 0.35), 1.25, -hz * 0.5);
      flag.userData.wave = true;
      g.add(flag);
    }
  }
}

export function createBuilding(id, level) {
  if (level <= 0) return bakeStatic(emptyPlot(id));
  const model = FACTORIES[id](level);
  adorn(model, id, level);
  // Lo que no se mueve se funde en una sola malla: muchas menos llamadas de dibujo
  const g = bakeStatic(model, windowMaterial());
  if (id !== 'puerto' && id !== 'muralla' && id !== 'coloso') g.scale.setScalar(1 + Math.min(level, 15) * 0.025);
  return g;
}

// ── Tropas y barcos ──────────────────────────────────────────────────────────

/** Escudo rectangular de legionario (scutum) con su umbo dorado. */
function scutum(g, color = '#a8231a') {
  g.add(box(0.17, 0.3, 0.03, color, -0.12, 0.15, 0.08));
  g.add(box(0.02, 0.3, 0.032, C.gold, -0.12, 0.15, 0.081));
  const boss = mesh(new THREE.SphereGeometry(0.03, 6, 4), C.gold);
  boss.position.set(-0.12, 0.3, 0.1);
  g.add(boss);
}

/** Caballo (de pie, mirando a +Z). Devuelve la altura del lomo. */
function horse(g, color = '#7a5230') {
  g.add(box(0.2, 0.2, 0.52, color, 0, 0.3, 0));
  for (const [x, z] of [[-0.07, -0.2], [0.07, -0.2], [-0.07, 0.2], [0.07, 0.2]]) {
    g.add(cyl(0.025, 0.03, 0.3, 5, color, x, 0, z));
    g.add(box(0.05, 0.03, 0.05, '#2a2420', x, 0, z));
  }
  const neck = box(0.1, 0.24, 0.12, color, 0, 0, 0);
  neck.position.set(0, 0.46, 0.25);
  neck.rotation.x = 0.5;
  g.add(neck);
  const head = box(0.09, 0.09, 0.2, color, 0, 0, 0);
  head.position.set(0, 0.56, 0.36);
  head.rotation.x = 0.35;
  g.add(head);
  g.add(box(0.03, 0.18, 0.1, '#2a2420', 0, 0.44, 0.22));
  const tail = box(0.05, 0.2, 0.05, '#2a2420', 0, 0.24, -0.28);
  tail.rotation.x = -0.4;
  g.add(tail);
  g.add(box(0.22, 0.03, 0.22, '#a8231a', 0, 0.5, 0));
  return 0.42;
}

const TROOPS = {
  lancero: { color: '#b8442f', helmet: 'corintio', greaves: true, arms: ['abajo', 'adelante'], extra: (g) => (spear(g), aspis(g, '#8b5a2b', '#e3b23c')) },
  hondero: { color: '#c9b48a', belt: LEATHER, hair: HAIR[3], arms: ['arriba', 'abajo'], extra: (g) => {
    g.add(cyl(0.006, 0.006, 0.22, 4, C.woodDark, 0.2, 0.62, 0));
    g.add(box(0.05, 0.05, 0.05, C.stone, 0.2, 0.84, 0));
    g.add(box(0.08, 0.09, 0.05, LEATHER, -0.09, 0.2, 0.07));
  } },
  arquero: { color: '#3f8a3a', helmet: 'gorro', belt: LEATHER, arms: ['abajo', 'adelante'], extra: (g) => {
    const bow = mesh(new THREE.TorusGeometry(0.17, 0.011, 4, 12, Math.PI), C.woodDark);
    bow.position.set(-0.13, 0.32, 0.15);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    g.add(bow);
    const quiver = cyl(0.03, 0.03, 0.22, 6, LEATHER, 0.05, 0.28, -0.08);
    quiver.rotation.z = -0.35;
    g.add(quiver);
    for (let k = 0; k < 3; k++) g.add(box(0.012, 0.06, 0.012, '#e8e2d0', 0.1 + k * 0.012, 0.5, -0.08));
  } },
  espadachin: { color: '#a8231a', cuirass: true, cuirassColor: IRON, pteruges: LEATHER, greaves: true, helmet: 'legionario', crest: '#a8231a', arms: ['adelante', 'adelante'], extra: (g) => {
    scutum(g);
    g.add(box(0.03, 0.03, 0.18, '#c9ced6', 0.12, 0.3, 0.17));
  } },
  hoplita: { color: '#a8231a', cuirass: true, pteruges: '#e8e2d0', greaves: true, helmet: 'corintio', crest: '#a8231a', cloak: '#a8231a', arms: ['abajo', 'adelante'], extra: (g) => (spear(g, 1.05), aspis(g)) },
  barbaro: { color: '#6b4a2a', skin: SKIN[2], beard: true, hair: '#c8862a', belt: '#3a2a1e', arms: ['abajo', 'abajo'], extra: (g) => {
    g.add(box(0.22, 0.08, 0.12, '#a07a50', 0, 0.39, 0));
    g.add(cyl(0.012, 0.012, 0.32, 4, C.woodDark, 0.12, 0.05, 0.03));
    g.add(box(0.03, 0.08, 0.07, '#c9ced6', 0.12, 0.3, 0.07));
  } },
  // Élites
  espartano: { color: '#8f1d16', cuirass: true, pteruges: '#8f1d16', greaves: true, helmet: 'corintio', crest: '#8f1d16', cloak: '#a8231a', beard: true, arms: ['abajo', 'adelante'], extra: (g) => {
    spear(g, 1.1);
    aspis(g, BRONZE_C, '#a8231a');
    // La lambda de Lacedemonia en el escudo
    const l = box(0.02, 0.1, 0.012, '#f4efe4', -0.11, 0.25, 0.092);
    l.rotation.z = 0.35;
    const r = box(0.02, 0.1, 0.012, '#f4efe4', -0.13, 0.25, 0.092);
    r.rotation.z = -0.35;
    g.add(l, r);
  } },
  sagitario: { color: '#5aa0c8', belt: LEATHER, helmet: 'gorro', hair: HAIR[1], greaves: true, arms: ['adelante', 'adelante'], extra: (g) => {
    const bow = mesh(new THREE.TorusGeometry(0.2, 0.012, 4, 14, Math.PI), '#4a2e18');
    bow.position.set(0, 0.36, 0.2);
    bow.rotation.set(0, 0, Math.PI / 2);
    g.add(bow);
    g.add(box(0.012, 0.012, 0.3, '#e8e2d0', 0, 0.36, 0.2));
    const quiver = cyl(0.035, 0.03, 0.26, 6, '#8f1d16', 0.05, 0.28, -0.08);
    quiver.rotation.z = -0.35;
    g.add(quiver);
    for (let k = 0; k < 4; k++) g.add(box(0.012, 0.07, 0.012, '#f4efe4', 0.1 + k * 0.012, 0.52, -0.08));
  } },
  pirata: { color: '#e8e2d0', belt: '#b8442f', helmet: 'panuelo', beard: true, hair: HAIR[2], arms: ['abajo', 'abajo'], extra: (g) => {
    const blade = box(0.025, 0.24, 0.05, '#c9ced6', 0.13, 0.04, 0.04);
    blade.rotation.z = 0.15;
    g.add(blade);
    g.add(box(0.06, 0.02, 0.06, C.gold, 0.13, 0.28, 0.04));
  } },
};

/** Figurita de una unidad de tierra (unos 0,5 de alto). */
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
  if (id === 'catafracto') {
    // Caballo y jinete cubiertos de escamas de hierro, con lanza larga (contus)
    const back = horse(g, '#5a4636');
    g.add(box(0.24, 0.16, 0.5, IRON, 0, 0.3, 0), box(0.12, 0.16, 0.14, IRON, 0, 0.42, 0.28));
    for (let k = 0; k < 5; k++) g.add(box(0.245, 0.012, 0.5, '#6e737a', 0, 0.33 + k * 0.025, 0));
    const rider = figure({ color: '#4a4f57', cuirass: true, cuirassColor: IRON, greaves: true, helmet: 'legionario', crest: '#c9a24a', cloak: '#6a2a7a', arms: ['adelante', 'abajo'] });
    spear(rider, 1.2);
    rider.scale.setScalar(0.72);
    rider.position.set(0, back - 0.1, -0.02);
    g.add(rider);
    return g;
  }
  if (id === 'elefante') {
    // Elefante con su torre de arqueros y el cornaca en el cuello
    const grey = '#8a8c8f';
    const body = mesh(new THREE.SphereGeometry(0.32, 10, 8), grey);
    body.scale.set(0.95, 0.85, 1.35);
    body.position.y = 0.62;
    g.add(body);
    for (const [x, z] of [[-0.17, -0.25], [0.17, -0.25], [-0.17, 0.25], [0.17, 0.25]]) g.add(cyl(0.085, 0.09, 0.42, 7, grey, x, 0, z));
    const head = mesh(new THREE.SphereGeometry(0.2, 9, 7), grey);
    head.position.set(0, 0.78, 0.48);
    g.add(head);
    for (const s of [-1, 1]) {
      const ear = box(0.03, 0.24, 0.2, '#7d7f82', s * 0.2, 0.68, 0.42);
      ear.rotation.y = s * 0.5;
      g.add(ear);
      const tusk = mesh(new THREE.ConeGeometry(0.025, 0.25, 5), '#f4efe4');
      tusk.position.set(s * 0.09, 0.58, 0.68);
      tusk.rotation.x = -1.2;
      g.add(tusk);
    }
    const trunk = cyl(0.04, 0.07, 0.42, 7, grey, 0, 0, 0);
    trunk.position.set(0, 0.3, 0.64);
    trunk.rotation.x = 0.25;
    g.add(trunk);
    const tail = box(0.03, 0.22, 0.03, grey, 0, 0.5, -0.45);
    tail.rotation.x = -0.3;
    g.add(tail);
    // Gualdrapa roja y la torre de madera con escudos
    g.add(box(0.5, 0.06, 0.6, '#a8231a', 0, 0.86, -0.05), box(0.52, 0.03, 0.62, C.gold, 0, 0.84, -0.05));
    g.add(box(0.4, 0.3, 0.4, C.wood, 0, 0.92, -0.08));
    for (const [x, z] of [[-0.18, -0.26], [0.18, -0.26], [-0.18, 0.1], [0.18, 0.1]]) g.add(box(0.06, 0.1, 0.06, C.wood, x, 1.22, z));
    for (const s of [-1, 1]) {
      const sh = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 10), BRONZE_C);
      sh.rotation.z = Math.PI / 2;
      sh.position.set(s * 0.21, 1.06, -0.08);
      g.add(sh);
    }
    const archer = figure({ color: '#5aa0c8', helmet: 'gorro', arms: ['adelante', 'adelante'] });
    archer.scale.setScalar(0.55);
    archer.position.set(0, 1.1, -0.08);
    g.add(archer);
    const mahout = figure({ color: '#e3b23c', skin: SKIN[2], arms: ['adelante', 'adelante'] });
    mahout.scale.setScalar(0.5);
    mahout.position.set(0, 0.82, 0.3);
    g.add(mahout);
    g.scale.setScalar(0.85);
    return g;
  }
  if (id === 'caballero') {
    // Jinete con capa azul y lanza sobre su caballo
    const back = horse(g);
    const rider = figure({ color: '#3f6fa8', cuirass: true, helmet: 'corintio', crest: '#f6f1e7', cloak: '#3f6fa8', arms: ['adelante', 'abajo'] });
    spear(rider, 0.9);
    rider.scale.setScalar(0.72);
    rider.position.set(0, back - 0.1, -0.02);
    g.add(rider);
    return g;
  }
  const t = TROOPS[id] ?? TROOPS.lancero;
  const fig = figure({ ...t, skin: t.skin ?? SKIN[0], hair: t.hair ?? HAIR[0] });
  t.extra?.(fig);
  fig.scale.setScalar(0.82);
  g.add(fig);
  return g;
}

// ── Barcos de la época ──────────────────────────────────────────────────────
// Cascos de madera con curva (más anchos en el centro y con la borda que sube hacia
// proa y popa), franja pintada, espolón de bronce, ojos en la proa, filas de remos,
// velas cuadradas a rayas y jarcias. Proa hacia +Z y línea de flotación en y = 0.

let hullMaterial = null;

/**
 * Casco por secciones a lo largo de la eslora. `full` controla lo panzudo que es
 * (más bajo, más redondo, como un mercante) y `rise` cuánto sube la borda en los extremos.
 */
function shipHull({ len, beam, depth, rise = 0.2, full = 0.6, color, band, deck = '#c9a26a', bandH = 0.08 }) {
  hullMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const N = 14;
  const cWood = new THREE.Color(color);
  const cBand = new THREE.Color(band);
  const cDeck = new THREE.Color(deck);
  const stations = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -len / 2 + len * t;
    const hw = Math.max(0.004, (beam / 2) * Math.pow(Math.sin(Math.PI * t), full));
    const top = depth * 0.38 + rise * Math.pow(2 * t - 1, 4);
    // Media sección: borda, fin de la franja, costado, pantoque y quilla
    const half = [
      [hw, top],
      [hw * 0.99, top - bandH],
      [hw * 0.9, -depth * 0.3],
      [hw * 0.55, -depth * 0.78],
      [0, -depth],
    ];
    const ring = [...half, ...half.slice(0, 4).reverse().map(([x, y]) => [-x, y])];
    stations.push({ z, ring, top, hw });
  }
  const pos = [];
  const col = [];
  const quad = (a, b, c, d, color) => {
    for (const p of [a, b, c, a, c, d]) pos.push(...p);
    for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < N; i++) {
    const A = stations[i];
    const B = stations[i + 1];
    for (let k = 0; k < A.ring.length - 1; k++) {
      const p = (s, j) => [s.ring[j][0], s.ring[j][1], s.z];
      // La franja pintada va arriba, a los dos lados
      const band0 = k === 0 || k === A.ring.length - 2;
      quad(p(A, k), p(B, k), p(B, k + 1), p(A, k + 1), band0 ? cBand : cWood);
    }
    // Cubierta, un poco por debajo de la borda
    const d = (s, x) => [x, s.top - 0.025, s.z];
    quad(d(A, -A.hw * 0.97), d(B, -B.hw * 0.97), d(B, B.hw * 0.97), d(A, A.hw * 0.97), cDeck);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, hullMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  const station = (t) => stations[Math.round(Math.min(1, Math.max(0, t)) * N)];
  return {
    mesh: m,
    /** Altura de la borda en un punto de la eslora (t de 0 en popa a 1 en proa). */
    top: (t) => station(t).top,
    /** Media manga a la altura z. */
    half: (z) => station((z + len / 2) / len).hw,
  };
}

/** Cuerda (o palo fino) entre dos puntos. */
function rope(a, b, r = 0.007, color = '#5e4a32') {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 4), color);
  m.castShadow = false;
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/**
 * Mástil con su verga y una vela cuadrada a rayas (o lisa), con las jarcias a proa y popa.
 * La vela va orientada en ángulo (`brace`), como cuando se cazan las vergas al viento,
 * para que se vea desde cualquier lado.
 */
function squareRig(g, { z, h, w, sh, colors = ['#f4efe6'], stripes = 7, bow, stern, y0 = 0.1, brace = 0.5 }) {
  g.add(cyl(0.035, 0.045, h, 6, C.woodDark, 0, y0, z));
  const top = y0 + h;
  const rig = new THREE.Group();
  rig.position.set(0, 0, z);
  rig.rotation.y = brace;
  const yard = cyl(0.025, 0.025, w + 0.25, 5, C.woodDark, 0, 0, 0);
  yard.rotation.z = Math.PI / 2;
  yard.position.set(0, top - 0.12, 0.04);
  rig.add(yard);
  // La vela, hinchada por el viento: cada franja un poco más adelante en el centro
  for (let i = 0; i < stripes; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / stripes;
    const belly = Math.cos((x / w) * Math.PI) * 0.08;
    rig.add(box(w / stripes + 0.004, sh, 0.02, colors[i % colors.length], x, top - 0.14 - sh, 0.07 + belly));
  }
  const foot = cyl(0.02, 0.02, w + 0.1, 5, C.woodDark, 0, 0, 0);
  foot.rotation.z = Math.PI / 2;
  foot.position.set(0, top - 0.14 - sh, 0.08);
  rig.add(foot);
  // Escotas de las esquinas de la vela a la borda
  for (const s of [-1, 1]) rig.add(rope(new THREE.Vector3(s * (w / 2), top - 0.14 - sh, 0.08), new THREE.Vector3(s * 0.3, y0 + 0.05, -0.5)));
  g.add(rig);
  // Estay a proa y a popa
  const head = new THREE.Vector3(0, top, z);
  if (bow) g.add(rope(head, bow));
  if (stern) g.add(rope(head, stern));
}

/** Vela latina (triangular), como las de los dromones. */
function lateenSail(g, z, h, w, color, stripe) {
  g.add(cyl(0.04, 0.05, h, 6, C.woodDark, 0, 0.2, z));
  const spar = cyl(0.022, 0.022, w * 1.5, 5, C.woodDark, 0, 0, 0);
  spar.rotation.x = 1.05;
  spar.position.set(0, h * 0.75, z);
  g.add(spar);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-w * 0.6, h * 0.95);
  shape.lineTo(w * 0.55, h * 0.3);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  const s = mesh(geo, color);
  s.rotation.y = Math.PI / 2;
  s.position.set(0.04, 0.35, z);
  g.add(s);
  if (stripe) {
    const band = box(0.025, 0.08, w * 0.5, stripe, 0.05, h * 0.55, z + 0.05);
    band.rotation.x = -0.5;
    g.add(band);
  }
}

/** Remos a los dos lados: `rows` filas de `n` remos entre z0 y z1, metidos en el agua. */
function oars(g, { n, rows = 1, z0, z1, x, y, len = 0.75 }) {
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
      for (const s of [-1, 1]) {
        const a = new THREE.Vector3(s * (x - r * 0.04), y + r * 0.09, z);
        const b = new THREE.Vector3(s * (x + len * 0.85), -0.08, z - 0.06);
        g.add(rope(a, b, 0.012, C.woodLight));
        const blade = box(0.03, 0.12, 0.07, C.woodLight, b.x, b.y - 0.06, b.z);
        blade.rotation.z = s * 0.5;
        g.add(blade);
      }
    }
  }
}

/** Ojo pintado a cada lado de la proa (para ver el camino y espantar el mal). */
function bowEyes(g, z, x, y, r = 0.07) {
  for (const s of [-1, 1]) {
    for (const [rr, color, dx] of [[r, '#f4efe6', 0], [r * 0.6, '#2f6db3', 0.006], [r * 0.3, '#111111', 0.012]]) {
      const e = mesh(new THREE.CylinderGeometry(rr, rr, 0.01, 10), color);
      e.rotation.z = Math.PI / 2;
      e.position.set(s * (x + dx), y, z);
      e.castShadow = false;
      g.add(e);
    }
  }
}

/** Espolón de bronce a ras de agua. */
function ram(g, z, w = 0.12) {
  const r = mesh(new THREE.ConeGeometry(w, 0.45, 4), '#b08a3a', { metalness: 0.55, roughness: 0.4 });
  r.rotation.x = Math.PI / 2;
  r.position.set(0, -0.05, z + 0.18);
  g.add(r);
}

/** Popa curvada hacia dentro (aphlaston) o cuello de cisne (mercantes romanos). */
function sternPost(g, z, y, swan = false, color = C.woodDark) {
  const curl = mesh(new THREE.TorusGeometry(0.2, 0.035, 5, 9, Math.PI * 1.1), color);
  curl.rotation.y = Math.PI / 2;
  curl.position.set(0, y + 0.18, z + 0.12);
  g.add(curl);
  if (swan) {
    const head = mesh(new THREE.SphereGeometry(0.06, 6, 5), C.gold, { metalness: 0.5, roughness: 0.4 });
    head.position.set(0, y + 0.3, z + 0.3);
    g.add(head);
  }
}

/** Remos de gobierno a popa. */
function steering(g, z, x, y) {
  for (const s of [-1, 1]) {
    g.add(rope(new THREE.Vector3(s * x, y + 0.15, z + 0.2), new THREE.Vector3(s * (x + 0.12), -0.15, z - 0.35), 0.018, C.woodDark));
    g.add(box(0.03, 0.2, 0.12, C.woodDark, s * (x + 0.12), -0.25, z - 0.38));
  }
}

/** Escudos redondos colgados de la borda. */
function railShields(g, n, z0, z1, x, y, colors) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
    for (const s of [-1, 1]) {
      const sh = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10), colors[i % colors.length]);
      sh.rotation.z = Math.PI / 2;
      sh.position.set(s * x, y, z);
      g.add(sh);
    }
  }
}

/** Cabezas de los remeros asomando por la cubierta. */
function rowers(g, n, z0, z1, x, y) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
    for (const s of [-1, 1]) {
      const h = mesh(new THREE.SphereGeometry(0.045, 6, 4), i % 3 ? '#5a3a22' : '#3a2a1e');
      h.position.set(s * x, y, z);
      h.castShadow = false;
      g.add(h);
    }
  }
}

function addFlag(g, x, y, z, color, w = 0.4, h = 0.25) {
  const flag = box(w, h, 0.02, color, 0, 0, 0);
  flag.geometry.translate(w / 2, 0, 0);
  flag.position.set(x, y, z);
  flag.userData.wave = true;
  g.add(flag);
}

const SHIPS = {
  bote(g) {
    // Barca de remos con su remero
    const hull = shipHull({ len: 1.15, beam: 0.48, depth: 0.24, rise: 0.08, full: 0.55, color: '#b98a52', band: '#2f6db3', bandH: 0.05 });
    g.add(hull.mesh);
    oars(g, { n: 1, z0: -0.1, z1: 0.1, x: 0.2, y: 0.08, len: 0.45 });
    const man = figure({ color: '#c9b48a', hair: '#3a2a1e', arms: ['adelante', 'adelante'] });
    man.scale.setScalar(0.5);
    man.position.set(0, -0.02, -0.05);
    g.add(man);
    g.add(box(0.14, 0.1, 0.12, '#c9b48a', 0, 0.02, 0.3), amphora(0.08, -0.02, -0.38, '#b9643a', 0.35));
  },
  mercante(g) {
    // Corbita: barriga ancha, popa en cuello de cisne, vela cuadrada y ánforas en cubierta
    const hull = shipHull({ len: 2.3, beam: 1.0, depth: 0.5, rise: 0.22, full: 0.4, color: '#9a6a3c', band: '#c4552d' });
    g.add(hull.mesh);
    sternPost(g, -1.15, hull.top(0), true, '#9a6a3c');
    squareRig(g, { z: 0.15, h: 1.75, w: 1.15, sh: 0.85, colors: ['#efe4cc', '#e2d4b4'], stripes: 6, bow: new THREE.Vector3(0, 0.35, 1.1), stern: new THREE.Vector3(0, 0.45, -1.0) });
    // Caseta de popa con tejado de terracota
    g.add(box(0.5, 0.28, 0.4, C.wall, 0, hull.top(0.25) - 0.05, -0.7), hipRoof(0.58, 0.48, 0.16, C.roofRed, 0, hull.top(0.25) + 0.23, -0.7));
    for (let i = 0; i < 6; i++) g.add(amphora(-0.25 + (i % 3) * 0.25, hull.top(0.5) - 0.05, 0.45 + Math.floor(i / 3) * 0.22, i % 2 ? '#b9643a' : '#a5542f', 0.45));
    steering(g, -0.85, hull.half(-0.85) + 0.03, hull.top(0.1));
  },
  trirreme(g) {
    // Trirreme: casco largo y fino, tres filas de remos, espolón, ojos en la proa y vela a rayas
    const hull = shipHull({ len: 3.0, beam: 0.72, depth: 0.42, rise: 0.3, full: 0.75, color: '#c8a070', band: '#2b2620' });
    g.add(hull.mesh);
    ram(g, 1.5);
    bowEyes(g, 1.18, hull.half(1.18) + 0.005, hull.top(0.9) - 0.12);
    sternPost(g, -1.5, hull.top(0));
    const bowCurl = mesh(new THREE.TorusGeometry(0.1, 0.03, 4, 7, Math.PI), C.woodDark);
    bowCurl.rotation.y = -Math.PI / 2;
    bowCurl.position.set(0, hull.top(1) + 0.06, 1.42);
    g.add(bowCurl);
    // Pasarela de los remeros (sobresale por los costados)
    for (const s of [-1, 1]) g.add(box(0.08, 0.06, 2.0, '#8b5a2b', s * 0.36, hull.top(0.5) - 0.12, 0));
    oars(g, { n: 9, rows: 3, z0: -0.95, z1: 1.0, x: 0.38, y: hull.top(0.5) - 0.2, len: 0.7 });
    rowers(g, 8, -0.85, 0.9, 0.22, hull.top(0.5) + 0.0);
    squareRig(g, { z: 0.1, h: 1.6, w: 1.15, sh: 0.8, colors: ['#f4efe6', '#2f5fa8'], stripes: 9, bow: new THREE.Vector3(0, hull.top(1), 1.4), stern: new THREE.Vector3(0, hull.top(0) + 0.1, -1.35) });
    steering(g, -1.15, hull.half(-1.15) + 0.03, hull.top(0.1));
  },
  galeon(g) {
    // Quinquerreme: gran barco de guerra con torres, catapulta, escudos en la borda y dos filas de remos
    const hull = shipHull({ len: 3.4, beam: 1.15, depth: 0.6, rise: 0.3, full: 0.6, color: '#7a5230', band: '#a8231a' });
    g.add(hull.mesh);
    ram(g, 1.7, 0.16);
    bowEyes(g, 1.3, hull.half(1.3) + 0.005, hull.top(0.9) - 0.15, 0.09);
    sternPost(g, -1.7, hull.top(0));
    oars(g, { n: 10, rows: 2, z0: -1.1, z1: 1.1, x: 0.56, y: hull.top(0.5) - 0.22, len: 0.75 });
    railShields(g, 6, -1.0, 1.0, 0.58, hull.top(0.5) - 0.02, ['#c9a24a', '#a8231a', '#f4efe6']);
    // Torres de madera a proa y popa
    for (const z of [0.95, -1.05]) {
      g.add(box(0.55, 0.45, 0.5, '#8b5a2b', 0, hull.top(0.5) - 0.06, z));
      for (const [x, zz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) g.add(box(0.1, 0.1, 0.1, '#8b5a2b', x, hull.top(0.5) + 0.39, z + zz));
    }
    // Catapulta en cubierta
    g.add(box(0.3, 0.08, 0.4, C.wood, 0.25, hull.top(0.5) - 0.05, 0.4));
    const arm = box(0.04, 0.04, 0.45, C.woodLight, 0, 0, 0);
    arm.position.set(0.25, hull.top(0.5) + 0.15, 0.4);
    arm.rotation.x = 0.6;
    g.add(arm);
    squareRig(g, { z: -0.1, h: 2.2, w: 1.5, sh: 1.0, colors: ['#efe4cc', '#efe4cc', '#a8231a'], stripes: 9, bow: new THREE.Vector3(0, hull.top(1), 1.6), stern: new THREE.Vector3(0, hull.top(0) + 0.1, -1.6) });
    addFlag(g, 0, hull.top(0.5) + 2.35, -0.1, '#a8231a');
    steering(g, -1.3, hull.half(-1.3) + 0.03, hull.top(0.1));
  },
  corsario(g) {
    // Hemiolia pirata: casco oscuro, una fila de remos y vela negra con una calavera
    const hull = shipHull({ len: 2.2, beam: 0.85, depth: 0.45, rise: 0.25, full: 0.65, color: '#3a2a20', band: '#7a1f1a' });
    g.add(hull.mesh);
    ram(g, 1.1, 0.1);
    bowEyes(g, 0.85, hull.half(0.85) + 0.005, hull.top(0.9) - 0.1, 0.06);
    sternPost(g, -1.1, hull.top(0), false, '#2b2017');
    oars(g, { n: 6, z0: -0.7, z1: 0.75, x: 0.42, y: hull.top(0.5) - 0.15, len: 0.6 });
    squareRig(g, { z: 0.15, h: 1.7, w: 1.05, sh: 0.8, colors: ['#26221f'], stripes: 5, bow: new THREE.Vector3(0, hull.top(1), 1.05), stern: new THREE.Vector3(0, hull.top(0), -1.0) });
    g.add(cyl(0.16, 0.16, 0.02, 10, '#e8e2d0', 0, 1.25, 0.3));
    g.children.at(-1).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) g.add(box(0.05, 0.05, 0.02, '#26221f', s * 0.05, 1.28, 0.32));
    addFlag(g, 0, 1.92, 0.15, '#111111');
  },
  brulote(g) {
    // Brulote: barca vieja cargada de brea en llamas
    const hull = shipHull({ len: 1.8, beam: 0.72, depth: 0.38, rise: 0.15, full: 0.55, color: '#3b2a1e', band: '#8a2f22' });
    g.add(hull.mesh);
    squareRig(g, { z: 0.1, h: 1.35, w: 0.8, sh: 0.6, colors: ['#8a2f22', '#6e241b'], stripes: 4, bow: new THREE.Vector3(0, hull.top(1), 0.85), stern: new THREE.Vector3(0, hull.top(0), -0.8) });
    for (const [x, z] of [[-0.15, -0.45], [0.15, -0.45], [0, 0.55]]) {
      g.add(cyl(0.12, 0.12, 0.25, 8, '#2b2017', x, hull.top(0.5) - 0.05, z));
      const flame = mesh(new THREE.ConeGeometry(0.1, 0.32, 6), '#ff8a2a', { emissive: '#ff5a00', emissiveIntensity: 1.8 });
      flame.position.set(x, hull.top(0.5) + 0.36, z);
      flame.userData.flicker = true;
      g.add(flame);
    }
  },
  liburna(g) {
    // Liburna: birreme ligera y rápida, con espolón, ojos y vela roja y blanca
    const hull = shipHull({ len: 2.5, beam: 0.62, depth: 0.38, rise: 0.28, full: 0.8, color: '#a8784a', band: '#a8231a' });
    g.add(hull.mesh);
    ram(g, 1.25, 0.1);
    bowEyes(g, 0.98, hull.half(0.98) + 0.005, hull.top(0.9) - 0.1, 0.06);
    sternPost(g, -1.25, hull.top(0));
    oars(g, { n: 8, rows: 2, z0: -0.85, z1: 0.85, x: 0.32, y: hull.top(0.5) - 0.18, len: 0.65 });
    railShields(g, 4, -0.6, 0.7, 0.33, hull.top(0.5) - 0.02, ['#a8231a', '#f4efe6']);
    squareRig(g, { z: 0.1, h: 1.5, w: 1.0, sh: 0.72, colors: ['#f4efe6', '#a8231a'], stripes: 7, bow: new THREE.Vector3(0, hull.top(1), 1.2), stern: new THREE.Vector3(0, hull.top(0) + 0.1, -1.15) });
    addFlag(g, 0, hull.top(0.5) + 1.62, 0.1, '#a8231a', 0.35, 0.2);
    steering(g, -0.95, hull.half(-0.95) + 0.03, hull.top(0.1));
  },
  dromon(g) {
    // Dromón: el gran barco de guerra, con dos velas latinas, dos filas de remos, castillo y sifón de fuego
    const hull = shipHull({ len: 4.0, beam: 1.2, depth: 0.6, rise: 0.32, full: 0.6, color: '#5a3a22', band: '#2f6db3' });
    g.add(hull.mesh);
    ram(g, 2.0, 0.14);
    bowEyes(g, 1.55, hull.half(1.55) + 0.005, hull.top(0.9) - 0.15, 0.09);
    sternPost(g, -2.0, hull.top(0), false, '#3a2a20');
    g.add(cyl(0.06, 0.09, 0.6, 6, '#b08a3a', 0, hull.top(0.95), 1.75, { metalness: 0.5 }));
    g.children.at(-1).rotation.x = 1.2;
    // Castillo de popa dorado
    g.add(box(1.0, 0.35, 0.8, '#6b4423', 0, hull.top(0.15) - 0.06, -1.45), box(0.9, 0.06, 0.6, C.gold, 0, hull.top(0.15) + 0.29, -1.45));
    oars(g, { n: 11, rows: 2, z0: -1.25, z1: 1.35, x: 0.58, y: hull.top(0.5) - 0.24, len: 0.8 });
    railShields(g, 7, -1.1, 1.2, 0.6, hull.top(0.5) - 0.02, ['#2f6db3', '#c9a24a', '#a8231a', '#f4efe6']);
    lateenSail(g, 0.8, 2.6, 1.4, '#efe4cc', '#2f6db3');
    lateenSail(g, -0.55, 2.2, 1.1, '#efe4cc', '#a8231a');
    addFlag(g, 0, 2.85, 0.8, '#2f6db3', 0.5, 0.3);
  },
};

/** Barco (unos 2 de eslora) con la proa hacia +Z y la línea de flotación en y = 0. */
export function createShip(type) {
  const g = new THREE.Group();
  (SHIPS[type] ?? SHIPS.mercante)(g);
  // Lo que no se mueve, en una sola pieza: hay muchos barcos a la vez en el mar
  return bakeStatic(g);
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
