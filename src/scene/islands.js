import * as THREE from 'three';
import { C, box, createShip, createSoldier, cyl, gableRoof, mat, mesh } from './models.js';
import { hashString, mountainGeometry, paintByNormal, plateauGeometry, polar, rng } from './util.js';

// Islas del archipiélago. La base (relieve, playa, árboles) no cambia; lo que hay
// encima depende de lo que sepas de ella (niebla, campamento, colonia…).

export const ISLAND_TOP = 0.3;
const WATER_Y = -0.7;
// Lo que hay encima de cada isla se construye a menor tamaño y luego se escala
const FEATURE_SCALE = 1.4;
const SEA = (WATER_Y - ISLAND_TOP) / FEATURE_SCALE; // nivel del mar en coordenadas del grupo

const PALETTES = {
  default: { grass: '#6fae4a', cliff: '#8a6a46', rock: '#7c7466' },
  piratas: { grass: '#5d8f3e', cliff: '#6e5a44', rock: '#5f5a52' },
  ruinas: { grass: '#9bb05a', cliff: '#9a8160', rock: '#857b6b' },
  kraken: { grass: '#4b5a4a', cliff: '#3f3a40', rock: '#2f2c33' },
};

/** Radio visible de una isla del mapa. */
export function islandRadius(isl) {
  return isl.size * 1.8;
}

export function createIslandBase(isl) {
  const R = islandRadius(isl);
  const seed = hashString(isl.id);
  const rand = rng(seed);
  const pal = PALETTES[isl.type] ?? PALETTES.default;
  const g = new THREE.Group();

  const geo = plateauGeometry(R, R * 0.86, 1.9, 22, seed % 1000, ISLAND_TOP);
  paintByNormal(geo, (ny, cy) => (ny > 0.7 ? pal.grass : cy > -0.6 ? pal.cliff : pal.rock));
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  land.receiveShadow = true;
  g.add(land);

  const sand = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.16, R * 1.32, 1.3, 24), mat(isl.type === 'kraken' ? '#6b6470' : '#e8d49a'));
  sand.position.y = -0.45 - 0.65;
  g.add(sand);

  // Un monte en un lado de la isla
  if (isl.type !== 'ruinas') {
    const a = rand() * 360;
    const hill = new THREE.Mesh(
      mountainGeometry(R * 0.38, R * (isl.type === 'kraken' ? 0.75 : 0.5), seed % 97, {
        snow: isl.type === 'kraken' ? '#2a2630' : '#e9ecef',
        grass: pal.grass,
        rock: pal.rock,
      }),
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
    );
    hill.position.copy(polar(R * 0.62, a, ISLAND_TOP - 0.05));
    g.add(hill);
    g.userData.hillAngle = a;
  }

  // Árboles por el borde, dejando libre el centro para lo que haya encima
  const trees = isl.type === 'kraken' ? 0 : Math.round(R * 1.6);
  const leafColors = isl.type === 'libre' && isl.specialty === 'madera' ? ['#2f7a43', '#3f8a3a'] : ['#3f8a3a', '#4f9a3a', '#2f7a43'];
  for (let i = 0; i < trees; i++) {
    const p = polar(R * (0.5 + rand() * 0.38), rand() * 360, ISLAND_TOP);
    if (g.userData.hillAngle !== undefined && p.distanceTo(polar(R * 0.62, g.userData.hillAngle, ISLAND_TOP)) < R * 0.42) continue;
    const t = tree(leafColors[i % leafColors.length], isl.type === 'ruinas' || rand() < 0.3);
    t.position.copy(p);
    t.scale.setScalar(0.8 + rand() * 0.6);
    t.rotation.y = rand() * Math.PI;
    g.add(t);
  }
  return g;
}

function tree(color, palm) {
  const t = new THREE.Group();
  if (palm) {
    const trunk = cyl(0.08, 0.12, 1.4, 5, C.woodLight);
    trunk.rotation.z = 0.15;
    t.add(trunk);
    for (let k = 0; k < 5; k++) {
      const leaf = box(0.9, 0.04, 0.22, '#4f9a3a', 0, 0, 0);
      leaf.geometry.translate(0.45, 0, 0);
      leaf.position.set(0.2, 1.35, 0);
      leaf.rotation.set(0, (k * Math.PI * 2) / 5, -0.35);
      t.add(leaf);
    }
    return t;
  }
  t.add(cyl(0.1, 0.15, 0.6, 6, C.woodDark));
  const leaves = mesh(new THREE.ConeGeometry(0.75, 1.5, 7), color);
  leaves.position.y = 1.25;
  t.add(leaves);
  return t;
}

/** Estado visual de la isla según lo que sabe el jugador. */
export function islandLook(view) {
  if (view.colonized) return 'colonia';
  if (!view.explored) return 'niebla';
  if (view.type === 'ruinas') return view.looted ? 'ruinas-saqueadas' : 'ruinas';
  return view.type;
}

export function createIslandFeature(isl, look) {
  const R = islandRadius(isl) / FEATURE_SCALE;
  const rand = rng(hashString(isl.id) ^ 0x9e3779b9);
  const g = new THREE.Group();
  g.position.y = ISLAND_TOP;
  g.scale.setScalar(FEATURE_SCALE);
  const builders = {
    niebla: () => mist(g, R, rand),
    barbaros: () => camp(g, R, rand),
    piratas: () => fort(g, R),
    ruinas: () => ruins(g, R, rand, true),
    'ruinas-saqueadas': () => ruins(g, R, rand, false),
    libre: () => specialty(g, isl, R, rand),
    colonia: () => colony(g, isl, R, rand),
    kraken: () => lair(g, R, rand),
  };
  builders[look]?.();
  return g;
}

function mist(g, R, rand) {
  const material = new THREE.MeshStandardMaterial({ color: '#f4f7fb', flatShading: true, roughness: 1, transparent: true, opacity: 0.88 });
  const cloud = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(R * (0.28 + rand() * 0.2), 0), material);
    puff.position.copy(polar(R * (0.15 + rand() * 0.6), rand() * 360, 1.2 + rand() * 2.2));
    cloud.add(puff);
  }
  cloud.userData.spin = { axis: 'y', speed: 0.08 };
  g.add(cloud);
}

function camp(g, R, rand) {
  // Empalizada con una abertura
  const r = R * 0.42;
  for (let a = 0; a < 360; a += 12) {
    if (a > 160 && a < 200) continue;
    const stake = cyl(0.12, 0.12, 1.1 + rand() * 0.3, 5, C.woodDark);
    stake.position.add(polar(r, a));
    g.add(stake);
  }
  const hides = ['#a0784e', '#8b6a44', '#b89466'];
  for (let i = 0; i < 4; i++) {
    const tent = mesh(new THREE.ConeGeometry(0.9, 1.4, 5), hides[i % 3]);
    tent.position.copy(polar(r * 0.55, i * 90 + 30, 0.7));
    g.add(tent);
  }
  // Hoguera
  g.add(cyl(0.35, 0.4, 0.12, 8, C.stoneDark));
  const fire = mesh(new THREE.ConeGeometry(0.25, 0.6, 6), '#ff8a2a', { emissive: '#ff5a00', emissiveIntensity: 1.6 });
  fire.position.y = 0.4;
  fire.userData.flicker = true;
  g.add(fire);
  // Tótem con calavera
  g.add(cyl(0.12, 0.14, 2.0, 6, C.wood, r * 0.3, 0, -r * 0.5));
  const skull = mesh(new THREE.SphereGeometry(0.22, 8, 6), '#efe8d8');
  skull.position.set(r * 0.3, 2.15, -r * 0.5);
  g.add(skull);
  for (let i = 0; i < 3; i++) {
    const b = createSoldier('barbaro');
    b.scale.setScalar(1.8);
    b.position.copy(polar(r * 0.35, 200 + i * 50));
    b.rotation.y = rand() * Math.PI * 2;
    g.add(b);
  }
}

function fort(g, R) {
  const s = R * 0.36;
  // Muros
  for (const [x, z, w, d] of [[0, -s, 2 * s, 0.5], [0, s, 2 * s, 0.5], [-s, 0, 0.5, 2 * s], [s, 0, 0.5, 2 * s]]) {
    g.add(box(w, 1.4, d, C.stoneDark, x, 0, z));
  }
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
    g.add(cyl(0.6, 0.7, 2.2, 7, C.stone, x, 0, z));
    const top = mesh(new THREE.ConeGeometry(0.75, 0.8, 7), '#3a2a20');
    top.position.set(x, 2.6, z);
    g.add(top);
  }
  // Torre del homenaje y bandera negra
  g.add(box(1.8, 2.8, 1.8, C.stone, 0, 0, 0));
  g.add(cyl(0.05, 0.05, 2.0, 5, C.dark, 0, 2.8, 0));
  const flag = box(1.0, 0.65, 0.03, '#111111', 0, 0, 0);
  flag.geometry.translate(0.5, 0, 0);
  flag.position.set(0, 4.4, 0);
  flag.userData.wave = true;
  g.add(flag);
  const skull = box(0.28, 0.28, 0.04, '#f4efe6', 0.5, 4.4, 0.02);
  g.add(skull);
  // Cañones
  for (const a of [0, 90, 180, 270]) {
    const c = box(0.26, 0.26, 0.9, C.dark);
    c.position.copy(polar(s + 0.4, a, 1.25));
    c.rotation.y = THREE.MathUtils.degToRad(a);
    g.add(c);
  }
  // Barco corsario fondeado
  const ship = createShip('corsario');
  ship.scale.setScalar(2.2);
  ship.position.copy(polar(R * 1.35, 140, SEA));
  ship.rotation.y = Math.PI * 0.3;
  ship.userData.bob = { amp: 0.1, speed: 1.2, base: SEA };
  g.add(ship);
}

function ruins(g, R, rand, treasure) {
  const r = R * 0.3;
  for (let i = 0; i < 7; i++) {
    const a = i * (360 / 7);
    const h = 0.6 + rand() * 2.2;
    const col = cyl(0.25, 0.28, h, 8, '#e3dccb');
    col.position.add(polar(r, a));
    g.add(col);
    if (rand() < 0.4) {
      const top = box(0.75, 0.2, 0.75, '#d6cdb7', 0, 0, 0);
      top.position.copy(polar(r, a, h));
      g.add(top);
    }
  }
  // Arco
  g.add(box(0.5, 2.4, 0.5, '#d6cdb7', -0.9, 0, -r - 1.2), box(0.5, 2.4, 0.5, '#d6cdb7', 0.9, 0, -r - 1.2));
  g.add(box(2.4, 0.45, 0.6, '#cfc5ad', 0, 2.4, -r - 1.2));
  // Columna caída y bloques
  const fallen = cyl(0.25, 0.28, 2.2, 8, '#e3dccb');
  fallen.rotation.z = Math.PI / 2;
  fallen.position.set(r + 1.4, 0.25, 0.6);
  g.add(fallen);
  for (let i = 0; i < 6; i++) {
    const b = box(0.4 + rand() * 0.4, 0.3, 0.4 + rand() * 0.4, '#cfc5ad', 0, 0, 0);
    b.position.copy(polar(r + 1 + rand() * 1.5, rand() * 360, 0.15));
    b.rotation.y = rand() * Math.PI;
    g.add(b);
  }
  if (treasure) {
    g.add(box(0.7, 0.45, 0.5, C.woodDark, 0, 0, 0));
    const gold = mesh(new THREE.ConeGeometry(0.32, 0.35, 8), C.gold, { metalness: 0.6, roughness: 0.3, emissive: '#b8860b', emissiveIntensity: 0.5 });
    gold.position.y = 0.6;
    g.add(gold);
  }
}

function specialty(g, isl, R, rand) {
  const spots = (n, fn) => {
    for (let i = 0; i < n; i++) {
      const p = polar(R * (0.05 + rand() * 0.35), rand() * 360);
      fn(p, i);
    }
  };
  if (isl.specialty === 'madera') {
    spots(10, (p, i) => {
      const t = tree(i % 2 ? '#2f7a43' : '#3f8a3a', false);
      t.position.copy(p);
      t.scale.setScalar(1.1 + rand() * 0.5);
      g.add(t);
    });
  } else if (isl.specialty === 'piedra' || isl.specialty === 'hierro') {
    const color = isl.specialty === 'hierro' ? '#9a5a3a' : C.stone;
    spots(9, (p) => {
      const rock = mesh(new THREE.DodecahedronGeometry(0.6 + rand() * 0.6), color);
      rock.position.copy(p).setY(0.3);
      rock.scale.y = 0.7;
      g.add(rock);
    });
  } else if (isl.specialty === 'comida') {
    spots(6, (p, i) => {
      const patch = box(1.6, 0.25, 1.2, i % 2 ? '#e3c25a' : '#cfb24a', p.x, 0, p.z);
      patch.rotation.y = rand() * Math.PI;
      g.add(patch);
    });
  } else if (isl.specialty === 'cristal') {
    spots(7, (p) => {
      const c = mesh(new THREE.OctahedronGeometry(0.45), C.crystal, { emissive: '#2aa8d8', emissiveIntensity: 0.7, roughness: 0.25 });
      c.scale.set(1, 2.2, 1);
      c.position.copy(p).setY(0.9);
      c.userData.spin = { axis: 'y', speed: 0.5 };
      g.add(c);
    });
  } else if (isl.specialty === 'oro') {
    spots(6, (p) => {
      const n = mesh(new THREE.DodecahedronGeometry(0.35 + rand() * 0.3), C.gold, { metalness: 0.7, roughness: 0.3, emissive: '#8a6a00', emissiveIntensity: 0.4 });
      n.position.copy(p).setY(0.25);
      g.add(n);
    });
  }
}

function colony(g, isl, R, rand) {
  specialty(g, isl, R, rand);
  const roofs = [C.roofRed, C.roofBlue, C.roofRed, C.roofGrey];
  for (let i = 0; i < 4; i++) {
    const h = new THREE.Group();
    h.add(box(1.3, 0.9, 1.0, C.wall));
    h.add(gableRoof(1.5, 0.6, 1.2, roofs[i], 0, 0.9, 0));
    h.position.copy(polar(R * 0.45, 200 + i * 40));
    h.rotation.y = rand() * Math.PI;
    g.add(h);
  }
  g.add(cyl(0.06, 0.06, 3.2, 6, C.dark));
  const flag = box(1.1, 0.7, 0.03, C.cloth[0], 0, 0, 0);
  flag.geometry.translate(0.55, 0, 0);
  flag.position.y = 2.8;
  flag.userData.wave = true;
  g.add(flag);
  g.add(box(0.5, 0.5, 0.04, C.gold, 0.55, 2.8, 0.03));
  const ship = createShip('mercante');
  ship.scale.setScalar(2);
  ship.position.copy(polar(R * 1.3, 20, SEA));
  ship.rotation.y = Math.PI / 2;
  ship.userData.bob = { amp: 0.08, speed: 1.1, base: SEA };
  g.add(ship);
}

function lair(g, R, rand) {
  // Agujas de roca negra
  for (let i = 0; i < 9; i++) {
    const spike = mesh(new THREE.ConeGeometry(0.5 + rand() * 0.5, 2.5 + rand() * 3, 5), i % 2 ? '#2f2c33' : '#3f3a40');
    spike.position.copy(polar(R * (0.15 + rand() * 0.5), rand() * 360, 1.2));
    spike.rotation.z = (rand() - 0.5) * 0.4;
    g.add(spike);
  }
  // Remolino
  const whirl = new THREE.Mesh(new THREE.TorusGeometry(R * 1.55, 0.35, 4, 40), mat('#1d4e6e', { transparent: true, opacity: 0.8 }));
  whirl.rotation.x = Math.PI / 2;
  whirl.position.y = SEA + 0.05;
  whirl.userData.spin = { axis: 'z', speed: 0.6 };
  g.add(whirl);
  // Tentáculos que salen del agua
  for (let i = 0; i < 6; i++) {
    const t = tentacle(rand);
    t.position.copy(polar(R * 1.25, i * 60 + rand() * 20, SEA - 0.3));
    t.rotation.y = THREE.MathUtils.degToRad(i * 60) + Math.PI;
    g.add(t);
  }
  // Ojos que brillan en la cueva
  for (const x of [-0.5, 0.5]) {
    const eye = mesh(new THREE.SphereGeometry(0.18, 8, 6), '#ffe14a', { emissive: '#ffcc00', emissiveIntensity: 2 });
    eye.position.set(x, 1.0, R * 0.55);
    g.add(eye);
  }
}

function tentacle(rand) {
  const root = new THREE.Group();
  let parent = root;
  const segments = 6;
  for (let i = 0; i < segments; i++) {
    const r = 0.55 * (1 - i / segments) + 0.08;
    const seg = new THREE.Group();
    seg.add(cyl(r * 0.8, r, 1.1, 7, i % 2 ? '#6b3b7a' : '#7a4a8a'));
    seg.position.y = i === 0 ? 0 : 1.0;
    seg.userData.wiggle = { base: -0.22, amp: 0.18, speed: 0.9 + rand() * 0.4, phase: i * 0.6 + rand() * 3 };
    parent.add(seg);
    parent = seg;
  }
  return root;
}
