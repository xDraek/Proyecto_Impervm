import * as THREE from 'three';

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
      g.add(box(isDoor ? 0.6 : 0.32, h, 0.05, C.dark, x, y + (isDoor ? 0 : 0.38), w / 2 + 0.01));
      g.add(box(0.05, 0.42, 0.32, C.dark, w / 2 + 0.01, y + 0.38, x));
      g.add(box(0.05, 0.42, 0.32, C.dark, -w / 2 - 0.01, y + 0.38, x));
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

function aserradero(level) {
  const g = new THREE.Group();
  g.add(box(2.2, 1.2, 1.7, C.wood, -0.4, 0, -0.4));
  g.add(gableRoof(2.6, 0.9, 2.0, C.woodDark, -0.4, 1.2, -0.4));
  g.add(box(0.45, 0.75, 0.05, C.dark, -0.4, 0, 0.47));
  g.add(box(0.35, 0.3, 0.05, C.dark, -1.1, 0.55, 0.47));

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

const FACTORIES = { ayuntamiento, aserradero, cantera, granja, mina, fundicion, mercado, almacen, academia, cuartel, puerto, muralla };

export function createBuilding(id, level) {
  if (level <= 0) return emptyPlot(id);
  const g = FACTORIES[id](level);
  if (id !== 'puerto' && id !== 'muralla') g.scale.setScalar(1 + Math.min(level, 15) * 0.025);
  return g;
}

// ── Tropas y barcos ──────────────────────────────────────────────────────────

const UNIT_COLORS = {
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
