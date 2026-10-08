import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { BUILDINGS, BUILDING_KEYS, ISLAND_TYPES, LAND_UNITS, SHIP_UNITS } from '../game/data.js';
import {
  C,
  box,
  createBuilding,
  createGull,
  createScaffold,
  createShip,
  createSoldier,
  createVillager,
  cyl,
  WINDOW_GLOW,
  disposeTree,
  smokeColumn,
  gableRoof,
  mat,
  mesh,
  wallHeight,
  windowMaterial,
} from './models.js';
import { createIslandBase, createIslandFeature, islandLook, islandRadius, shoreRadius } from './islands.js';
import { escapeHtml } from '../ui/format.js';
import { Batch, bakeStatic, mountainGeometry, paintByNormal, plateauGeometry, polar, rng } from './util.js';
import { createWater, setShores } from './water.js';
import { clock } from '../config.js';
import { setRain, thunder } from '../audio.js';

const HORIZON = '#cfe8f7';
const WATER_Y = -0.7;
const ISLAND_R = 25;
const BEACH_Y = -0.5;
const ROAD_R = 11.2;
const WALL_R = 12.6;
const GATE_ANGLE = 15;
const HARBOR_R = 38; // radio por el que las flotas rodean la isla al salir
const RAID_FROM = 280;
const HOME_SHORE = 27.7; // donde la playa de tu isla corta el agua

// Ciclo de día y noche (un día dura 20 minutos reales)
const DAY_MS = 20 * 60 * 1000;
const SKIES = {
  day: { top: '#4a9be0', horizon: '#cfe8f7', sun: '#fff3dc', sunI: 2.6, hemi: '#dff1ff', hemiI: 1.3 },
  dusk: { top: '#3d5b9c', horizon: '#f4b27c', sun: '#ffb070', sunI: 1.5, hemi: '#f0c8a8', hemiI: 0.95 },
  night: { top: '#0c1733', horizon: '#2b3d6b', sun: '#9fb6ff', sunI: 0.55, hemi: '#6b7fae', hemiI: 0.6 },
};

// Disposición de la isla. Ángulo 0 = hacia +Z (la cámara mira desde unos 36°).
const LAYOUT = {
  ayuntamiento: { r: 0, angle: 0 },
  academia: { r: 8, angle: 45 },
  almacen: { r: 8, angle: 100 },
  templo: { r: 8, angle: 155 },
  cuartel: { r: 8, angle: 210 },
  mercado: { r: 8, angle: 265 },
  taberna: { r: 8, angle: 320 },
  granja: { r: 18, angle: 60 },
  aserradero: { r: 18, angle: 100 },
  forja: { r: 18, angle: 140 },
  cantera: { r: 18, angle: 178 },
  mina: { r: 18, angle: 216 },
  fundicion: { r: 18, angle: 254 },
  torre: { r: 18, angle: 292 },
  coloso: { r: 18, angle: 330, ring: 1.15 },
  astillero: { r: 22.4, angle: 40, hit: 3.0 },
  faro: { r: 23, angle: 352 },
  muralla: { r: WALL_R, angle: GATE_ANGLE, hit: 1.8, ring: 0.7 },
  puerto: { r: ISLAND_R + 1.4, angle: GATE_ANGLE, y: BEACH_Y, hit: 3.2, hitZ: -2.6 },
};
const INNER = ['academia', 'almacen', 'templo', 'cuartel', 'mercado', 'taberna'];
const OUTER = ['granja', 'aserradero', 'forja', 'cantera', 'mina', 'fundicion', 'torre', 'coloso'];
const COAST = ['astillero', 'faro'];
const MOUNTAINS = [
  { angle: 197, r: 22.6, radius: 4.2, height: 7.6 },
  { angle: 176, r: 24.2, radius: 2.5, height: 4.4 },
  { angle: 220, r: 24.2, radius: 2.4, height: 3.8 },
  { angle: 236, r: 23.6, radius: 1.8, height: 2.8 },
];
const VIEWS = {
  isla: { offset: new THREE.Vector3(33, 34, 46), min: 16, max: 115 },
  mapa: { offset: new THREE.Vector3(0, 420, 250), min: 60, max: 900 },
};
const SHIP_PRIORITY = ['dromon', 'galeon', 'trirreme', 'brulote', 'mercante', 'bote'];

// Clima: cada media hora real cambia (igual para todos, sale de la hora)
const WEATHER_MS = 30 * 60 * 1000;
const WEATHERS = [
  { id: 'despejado', p: 0.55, dark: 0, rain: 0 },
  { id: 'nublado', p: 0.2, dark: 0.35, rain: 0 },
  { id: 'lluvia', p: 0.17, dark: 0.55, rain: 0.7 },
  { id: 'tormenta', p: 0.08, dark: 0.8, rain: 1, storm: true },
];
const RAIN_DROPS = 1600;

/** El tiempo que hace en el instante `t`. */
export function weatherAt(t) {
  const n = Math.floor(t / WEATHER_MS);
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  let r = x - Math.floor(x);
  for (const w of WEATHERS) {
    if (r < w.p) return w;
    r -= w.p;
  }
  return WEATHERS[0];
}

/** Polilínea recorrible por longitud de arco (u en [0, 1]). */
class Route {
  constructor(points) {
    this.points = points;
    this.lengths = [0];
    for (let i = 1; i < points.length; i++) this.lengths.push(this.lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    this.total = this.lengths.at(-1) || 1;
  }

  at(u, out = new THREE.Vector3(), dir = new THREE.Vector3()) {
    const d = THREE.MathUtils.clamp(u, 0, 1) * this.total;
    let i = 1;
    while (i < this.points.length - 1 && this.lengths[i] < d) i++;
    const a = this.points[i - 1];
    const b = this.points[i];
    const seg = this.lengths[i] - this.lengths[i - 1] || 1;
    out.lerpVectors(a, b, (d - this.lengths[i - 1]) / seg);
    dir.subVectors(b, a).normalize();
    return out;
  }
}

export class World {
  /**
   * @param {HTMLElement} container
   * @param {import('../game/Game.js').Game} game
   * @param {{ onSelect?: (id: string|null) => void, showcase?: boolean }} options
   *   showcase: escaparate de la pantalla principal (la cámara gira sola y no se puede tocar nada)
   */
  constructor(container, game, { onSelect = () => {}, showcase = false } = {}) {
    this.container = container;
    this.game = game;
    this.onSelect = onSelect;
    this.showcase = showcase;
    this.slots = {};
    this.islands = {};
    this.fleets = new Map();
    this.selected = null;
    this.hovered = null;
    this.animated = [];
    this.clouds = [];
    this.view = 'isla';
    this.dayNight = true;
    this.villagers = [];
    this.gulls = [];
    this.carts = [];
    this.boats = [];
    this.dolphins = [];
    this.weather = { dark: 0, rain: 0, storm: false, flash: 0, rainSound: -1 };
    this.fx = [];
    // Los combates que ya había al entrar no se vuelven a ver
    this.fxSeen = Math.max(0, ...(game.reports ?? []).map((r) => r.t));

    this.#setupRenderer();
    this.#setupScene();
    this.#buildIsland();
    this.#buildSlots();
    this.#buildHomeLabel();
    this.#syncArchipelago();
    this.#buildClouds();
    this.#buildLife();
    this.#setupInput();
    this.sync();

    game.addEventListener('change', () => this.sync());
    // Han aparecido o desaparecido islas en el mapa (por ejemplo, un vecino nuevo)
    game.addEventListener('world', () => {
      this.#syncArchipelago();
      this.sync();
    });
    if (showcase) {
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.35;
      this.controls.enableZoom = false;
      this.controls.enableRotate = false;
      for (const slot of Object.values(this.slots)) slot.label.visible = false;
    }
  }

  /** Posición de una isla del mundo relativa a la tuya (tu isla está en el origen). */
  #relPos(isl) {
    const home = this.game.homeIsland;
    return new THREE.Vector3(isl.x - (home?.x ?? 0), 0, isl.z - (home?.z ?? 0));
  }

  /** Centro de un edificio o isla en el mundo. */
  centerOf(id) {
    if (this.slots[id]) return this.slots[id].center.clone();
    if (this.islands[id]) return this.islands[id].pos.clone();
    return new THREE.Vector3();
  }

  select(id) {
    this.selected = id;
    this.selectRing.visible = !!id;
    if (!id) return;
    const { center, radius } = this.#ringFor(id);
    this.selectRing.position.copy(center);
    this.selectRing.scale.setScalar(radius);
    this.focusTarget = this.islands[id] ? new THREE.Vector3(center.x, 0, center.z) : center.clone().setY(0);
  }

  setView(view) {
    if (view === this.view) return;
    this.view = view;
    const v = VIEWS[view];
    const target = new THREE.Vector3();
    const offset = v.offset.clone();
    if (this.camera.aspect < 1) offset.multiplyScalar(1 / this.camera.aspect ** 0.6);
    this.focusTarget = null;
    this.camTween = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: target.clone().add(offset),
      toTarget: target,
    };
    this.controls.minDistance = Math.min(this.controls.minDistance, v.min);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, v.max);
    for (const slot of Object.values(this.slots)) slot.label.visible = view === 'isla';
    for (const isl of Object.values(this.islands)) isl.label.visible = view === 'mapa';
  }

  // ── Montaje ────────────────────────────────────────────────────────────────

  #setupRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // Mapeo de tonos de cine: luces más suaves y colores con más cuerpo
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.container.appendChild(r.domElement);
    this.renderer = r;

    this.labelRenderer = new CSS2DRenderer();
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    this.container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 3000);
    this.camera.position.copy(VIEWS.isla.offset);

    const controls = new OrbitControls(this.camera, r.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = VIEWS.isla.min;
    controls.maxDistance = VIEWS.isla.max;
    controls.maxPolarAngle = 1.32;
    controls.target.set(0, 0, 0);
    this.controls = controls;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = this.container;
      if (!w || !h) return;
      r.setSize(w, h);
      this.labelRenderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(this.container);
    resize();

    // En pantallas verticales, alejar la cámara para que quepa la isla
    if (this.camera.aspect < 1) {
      controls.maxDistance = 130;
      this.camera.position.multiplyScalar(1 / this.camera.aspect ** 0.75);
    }
  }

  #setupScene() {
    const scene = new THREE.Scene();
    this.scene = scene;

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    this.skyCtx = canvas.getContext('2d');
    this.sky = new THREE.CanvasTexture(canvas);
    this.sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.sky;
    scene.fog = new THREE.Fog(HORIZON, 80, 260);

    this.hemi = new THREE.HemisphereLight('#dff1ff', '#5a7a3a', 1.3);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
    this.sun = sun;
    sun.position.set(26, 44, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 140 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2.5; // bordes de sombra suaves
    scene.add(sun, sun.target);
    this.skyKey = null;
    this.#updateSky(clock.now());

    // Mar estilizado: olas en la GPU, agua clara y espuma junto a cada orilla
    this.water = createWater([{ x: 0, z: 0, r: HOME_SHORE }], WATER_Y);
    this.waterTime = this.water.userData.uniforms.uTime;
    scene.add(this.water);
  }

  /** Activa o desactiva el ciclo de día y noche (si no, siempre es de día). */
  setDayNight(on) {
    this.dayNight = on;
    this.skyKey = null;
  }

  #updateSky(now) {
    // s: altura del sol entre -1 (medianoche) y 1 (mediodía)
    const phase = (now % DAY_MS) / DAY_MS;
    const s = this.dayNight ? Math.sin(phase * Math.PI * 2) : 1;
    const dark = this.weather?.dark ?? 0;
    const key = `${Math.round(s * 100)}|${Math.round(dark * 40)}`;
    if (key === this.skyKey) return;
    this.skyKey = key;

    const step = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    const [from, to, k] = s >= 0 ? [SKIES.dusk, SKIES.day, step(0, 0.35, s)] : [SKIES.dusk, SKIES.night, step(0, 0.35, -s)];
    const col = (name) => new THREE.Color(from[name]).lerp(new THREE.Color(to[name]), k);
    const num = (name) => from[name] + (to[name] - from[name]) * k;

    // Con mal tiempo el cielo se vuelve gris plomo
    const grey = new THREE.Color(s >= 0 ? '#7d8794' : '#252a33');
    const top = col('top').lerp(grey, dark * 0.95);
    const horizon = col('horizon').lerp(grey, dark * 0.85);
    const ctx = this.skyCtx;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(1, `#${horizon.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    this.sky.needsUpdate = true;
    this.scene.fog.color.copy(horizon);

    this.sun.color.copy(col('sun'));
    this.sun.intensity = num('sunI') * (1 - 0.8 * dark);
    this.hemi.color.copy(col('hemi')).lerp(new THREE.Color('#9aa3ad'), dark * 0.7);
    this.hemi.intensity = num('hemiI') * (1 - 0.45 * dark);
    this.hemiBase = this.hemi.intensity;
    this.cloudMaterial?.color.set('#ffffff').lerp(new THREE.Color('#7f8894'), dark);
    // De día el sol cruza el cielo; de noche la luna sale por el lado contrario
    const a = phase * Math.PI * 2;
    this.sun.position.set(Math.cos(a) * 34, 14 + Math.abs(s) * 32, 18 + Math.sin(a) * 10);
    // Ventanas y faroles encendidos al anochecer
    windowMaterial().emissiveIntensity = step(0.15, -0.25, s) * 1.4;
    this.night = step(0.1, -0.3, s);
  }

  #buildIsland() {
    const scene = this.scene;

    // Meseta de hierba con acantilados
    const geo = plateauGeometry(ISLAND_R, ISLAND_R - 1.6, 2.2, 64, 0, 0);
    paintByNormal(geo, (ny, cy) => (ny > 0.7 ? '#6fae4a' : cy > -0.8 ? '#8a6a46' : '#7c7466'));
    const island = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    island.receiveShadow = true;
    island.castShadow = true;
    scene.add(island);

    const sand = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R + 2.5, ISLAND_R + 4.2, 1.6, 64), mat('#e8d49a'));
    sand.position.y = BEACH_Y - 0.8;
    sand.receiveShadow = true;
    scene.add(sand);

    // Plaza, calles radiales, ronda interior y avenida hasta el puerto
    const plaza = cyl(3.4, 3.4, 0.04, 28, '#cbbfa8');
    plaza.castShadow = false;
    scene.add(plaza);
    this.roads = [];
    const road = (deg, from, to, width = 1.0) => {
      const mid = polar((from + to) / 2, deg);
      const path = box(width, 0.03, to - from, '#c9b48a', mid.x, 0, mid.z);
      path.rotation.y = THREE.MathUtils.degToRad(deg);
      path.castShadow = false;
      scene.add(path);
      this.roads.push({ deg, from, to, width });
    };
    for (const id of INNER) road(LAYOUT[id].angle, 3.2, LAYOUT[id].r - 2.2);
    for (const id of [...OUTER, ...COAST]) road(LAYOUT[id].angle, ROAD_R, LAYOUT[id].r - 2.2);
    road(GATE_ANGLE, 3.2, ISLAND_R - 0.9, 1.3);
    const ringGeo = new THREE.RingGeometry(ROAD_R - 0.45, ROAD_R + 0.45, 72);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, mat('#c9b48a'));
    ring.position.y = 0.025;
    ring.receiveShadow = true;
    scene.add(ring);
    // Rampa de la avenida hasta la playa
    const rampLen = 2.6;
    const rampMid = polar(ISLAND_R - 0.9 + rampLen / 2 - 0.1, GATE_ANGLE, -0.22);
    const ramp = box(1.3, 0.08, rampLen, '#c9b48a', 0, 0, 0);
    ramp.position.copy(rampMid);
    ramp.rotation.set(Math.atan2(0.5, rampLen), THREE.MathUtils.degToRad(GATE_ANGLE), 0, 'YXZ');
    scene.add(ramp);

    // Montañas detrás de la cantera y la mina
    for (const m of MOUNTAINS) {
      const mountain = new THREE.Mesh(
        mountainGeometry(m.radius, m.height, m.angle, { snow: '#f4f6f8', grass: '#7d9a52', rock: '#8c8780' }),
        new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
      );
      mountain.position.copy(polar(m.r, m.angle));
      mountain.castShadow = mountain.receiveShadow = true;
      scene.add(mountain);
    }

    // Lo que no se puede pisar: edificios, montañas, calles y la muralla
    const rand = rng(7);
    const blockers = [
      { p: new THREE.Vector3(), r: 4.2 },
      ...Object.entries(LAYOUT)
        .filter(([id]) => id !== 'ayuntamiento' && id !== 'puerto' && id !== 'muralla')
        .map(([, l]) => ({ p: polar(l.r, l.angle), r: 3.6 })),
      ...MOUNTAINS.map((m) => ({ p: polar(m.r, m.angle), r: m.radius + 0.6 })),
    ];
    const free = (p, pad = 0.7) => {
      const r = Math.hypot(p.x, p.z);
      if (r > ISLAND_R - 1.3) return false;
      if (r > ROAD_R - 1.0 && r < WALL_R + 0.9) return false;
      for (const rd of this.roads) {
        const a = THREE.MathUtils.degToRad(rd.deg);
        const along = p.x * Math.sin(a) + p.z * Math.cos(a);
        const across = Math.abs(p.x * Math.cos(a) - p.z * Math.sin(a));
        if (along > rd.from - 0.5 && along < rd.to + 0.5 && across < rd.width / 2 + pad) return false;
      }
      return blockers.every((b) => b.p.distanceTo(p) > b.r);
    };
    // Todo lo que no se mueve va junto en una sola malla: se pueden poner muchos más detalles
    const decor = new Batch(windowMaterial());
    const place = (obj, p, rotY = 0, scale = 1) => {
      obj.position.copy(p);
      obj.rotation.y = rotY;
      obj.scale.setScalar(scale);
      decor.add(obj);
    };

    // Campos de cultivo y un prado con ovejas junto a la granja
    const farm = LAYOUT.granja;
    const crops = ['#e3c25a', '#cfb24a', '#8fbf4a', '#d9b44a'];
    for (let ring = 0; ring < 3; ring++) {
      for (let k = -2; k <= 2; k++) {
        const p = polar(farm.r + 3.2 + ring * 1.8, farm.angle + k * 9);
        if (!free(p, 0.4)) continue;
        blockers.push({ p, r: 1.0 });
        const field = new THREE.Group();
        field.add(box(1.6, 0.1, 1.25, '#8a6a46'));
        for (let row = 0; row < 4; row++) field.add(box(1.5, 0.12, 0.18, crops[(ring + k + 9) % 4], 0, 0.1, -0.45 + row * 0.3));
        place(field, p, THREE.MathUtils.degToRad(farm.angle + k * 9));
      }
    }
    for (let i = 0; i < 7; i++) {
      const p = polar(farm.r + 2.2 + rand() * 4, farm.angle + 28 + rand() * 14);
      if (!free(p, 0.3)) continue;
      place(sheep(), p, rand() * Math.PI * 2, 0.9 + rand() * 0.3);
    }

    // Barrios: las casas van apareciendo al subir el ayuntamiento (primero dentro de la muralla)
    this.houseSpots = [];
    for (let tries = 0; tries < 2500 && this.houseSpots.length < 70; tries++) {
      const inside = tries % 3 !== 2;
      const p = inside
        ? polar(4.7 + rand() * (ROAD_R - 6.0), rand() * 360)
        : polar(WALL_R + 1.4 + rand() * (ISLAND_R - WALL_R - 3.2), rand() * 360);
      if (!free(p, 0.75)) continue;
      blockers.push({ p, r: 1.3 });
      this.houseSpots.push({
        p,
        inside,
        rot: Math.atan2(-p.x, -p.z) + (rand() - 0.5) * 0.5,
        w: 0.9 + rand() * 0.5,
        d: 0.8 + rand() * 0.35,
        h: 0.7 + rand() * 0.3,
        roof: Math.floor(rand() * 5),
        tall: rand() < 0.4,
        chimney: rand() < 0.4,
      });
    }
    this.houseSpots.sort((a, b) => Number(b.inside) - Number(a.inside) || a.p.length() - b.p.length());
    this.houseGroup = new THREE.Group();
    scene.add(this.houseGroup);

    // Farolas a los lados de la avenida del puerto (se encienden de noche)
    const gate = THREE.MathUtils.degToRad(GATE_ANGLE);
    for (let d = 4.6; d < ISLAND_R - 1.5; d += 3.1) {
      if (Math.abs(d - WALL_R) < 1.4) continue;
      for (const side of [-1, 1]) {
        const p = new THREE.Vector3(Math.sin(gate) * d + Math.cos(gate) * side * 1.05, 0, Math.cos(gate) * d - Math.sin(gate) * side * 1.05);
        const lamp = new THREE.Group();
        lamp.add(cyl(0.05, 0.07, 1.5, 6, C.dark));
        lamp.add(box(0.2, 0.22, 0.2, C.dark, 0, 1.5, 0), box(0.14, 0.16, 0.14, C.dark, 0, 1.53, 0, WINDOW_GLOW));
        place(lamp, p);
      }
    }

    // Bosque (más denso junto al aserradero)
    const leafColors = ['#3f8a3a', '#4f9a3a', '#2f7a43', '#5a9e3c'];
    const forest = polar(ISLAND_R - 3.5, LAYOUT.aserradero.angle + 8);
    let trees = 0;
    for (let tries = 0; tries < 2600 && trees < 190; tries++) {
      const p = tries % 3 === 0 ? forest.clone().add(polar(rand() * 7, rand() * 360)) : polar(3.5 + rand() * (ISLAND_R - 4), rand() * 360);
      if (!free(p)) continue;
      blockers.push({ p, r: 0.85 });
      place(pine(leafColors[trees % 4], rand() < 0.2), p, rand() * Math.PI, 0.7 + rand() * 0.6);
      trees++;
    }
    // Arbustos y flores
    const flowers = ['#e86a8a', '#f2c94c', '#ffffff', '#b07ad9', '#ff8a5a'];
    for (let i = 0, placed = 0; i < 900 && placed < 90; i++) {
      const p = polar(3 + rand() * (ISLAND_R - 3.5), rand() * 360);
      if (!free(p, 0.3)) continue;
      placed++;
      const bush = new THREE.Group();
      bush.add(mesh(new THREE.DodecahedronGeometry(0.32), placed % 3 ? '#4f9a3a' : '#3f8a3a'));
      bush.children[0].position.y = 0.2;
      if (placed % 2) for (let k = 0; k < 3; k++) bush.add(box(0.1, 0.1, 0.1, flowers[(placed + k) % 5], Math.sin(k * 2.1) * 0.25, 0.3, Math.cos(k * 2.1) * 0.25));
      place(bush, p, 0, 0.7 + rand() * 0.6);
    }
    // Rocas
    const rockGeo = new THREE.DodecahedronGeometry(0.4);
    for (let i = 0, placed = 0; i < 600 && placed < 34; i++) {
      const p = polar(4 + rand() * (ISLAND_R - 5), rand() * 360);
      if (!free(p)) continue;
      const rock = new THREE.Mesh(rockGeo, mat(placed % 3 ? C.stone : C.stoneDark));
      rock.position.set(p.x, 0.1, p.z);
      rock.scale.set(0.6 + rand(), 0.5 + rand() * 0.5, 0.6 + rand());
      decor.add(rock);
      placed++;
    }

    // La playa: palmeras, barcas varadas, redes y cabañas de pescadores
    const busy = [GATE_ANGLE, LAYOUT.astillero.angle, LAYOUT.faro.angle];
    const nearBusy = (a, w) => busy.some((b) => Math.abs(((a - b + 540) % 360) - 180) < w);
    for (let i = 0; i < 34; i++) {
      const a = rand() * 360;
      if (nearBusy(a, 12)) continue;
      place(palm(), polar(ISLAND_R + 1.3 + rand() * 1.6, a, BEACH_Y), rand() * Math.PI, 0.9 + rand() * 0.5);
    }
    for (let i = 0; i < 5; i++) {
      const a = 40 + i * 62 + rand() * 20;
      if (nearBusy(a, 16)) continue;
      const boat = createShip('bote');
      boat.rotation.set(0.05, THREE.MathUtils.degToRad(a) + Math.PI / 2, 0.25);
      boat.position.copy(polar(ISLAND_R + 2.4, a, BEACH_Y + 0.08));
      boat.scale.setScalar(1.7);
      decor.add(boat);
      // Red tendida a secar
      const net = new THREE.Group();
      net.add(box(0.06, 0.8, 0.06, C.woodDark, -0.6, 0, 0), box(0.06, 0.8, 0.06, C.woodDark, 0.6, 0, 0), box(1.2, 0.5, 0.03, '#c9b48a', 0, 0.25, 0));
      place(net, polar(ISLAND_R + 1.4, a + 6, BEACH_Y), THREE.MathUtils.degToRad(a));
    }
    for (const a of [GATE_ANGLE + 52, GATE_ANGLE + 200, GATE_ANGLE + 255]) {
      if (nearBusy(a, 14)) continue;
      const hut = new THREE.Group();
      hut.add(box(1.4, 0.9, 1.1, C.woodLight));
      hut.add(gableRoof(1.6, 0.6, 1.3, '#9c7a4a', 0, 0.9, 0));
      hut.add(box(0.35, 0.55, 0.05, C.woodDark, 0, 0, 0.56));
      for (const x of [-0.5, 0.5]) hut.add(cyl(0.06, 0.06, 1.0, 5, C.woodDark, x, -0.6, -0.6));
      place(hut, polar(ISLAND_R + 1.9, a, BEACH_Y), THREE.MathUtils.degToRad(a) + Math.PI);
    }
    scene.add(decor.build());

    this.wallGroup = new THREE.Group();
    scene.add(this.wallGroup);
  }

  #buildSlots() {
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.hitTargets = [];

    for (const id of BUILDING_KEYS) {
      const l = LAYOUT[id];
      const pos = polar(l.r, l.angle, l.y ?? 0);
      const root = new THREE.Group();
      root.position.copy(pos);
      // Que los edificios miren hacia la plaza
      if (id !== 'ayuntamiento') root.rotation.y = Math.atan2(-pos.x, -pos.z);
      this.scene.add(root);

      if (id !== 'ayuntamiento' && id !== 'puerto' && id !== 'muralla') {
        const plot = cyl(2.3, 2.4, 0.12, 28, C.dirt);
        plot.castShadow = false;
        root.add(plot);
      }

      const hitR = l.hit ?? 2.6;
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(hitR, hitR, 5, 12), hitMat);
      hit.position.set(0, 2.5, l.hitZ ?? 0);
      hit.userData.slot = id;
      hit.visible = false;
      root.add(hit);
      this.hitTargets.push(hit);
      root.updateMatrixWorld(true);
      const center = hit.getWorldPosition(new THREE.Vector3()).setY(pos.y);

      const el = document.createElement('div');
      el.className = 'label';
      el.innerHTML = `<span class="label-name">${BUILDINGS[id].name}</span><span class="label-lvl"></span><span class="label-bar"><i></i></span><span class="label-mini">${BUILDINGS[id].icon} <b></b></span>`;
      const label = new CSS2DObject(el);
      this.scene.add(label);

      this.slots[id] = { id, pos, center, root, label, el, key: null, building: null, scaffold: null, extras: null, extrasKey: null, pop: 1, ring: l.ring ?? 1 };
    }

    const ringGeo = new THREE.RingGeometry(2.55, 2.85, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true }));
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);
    this.hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 }));
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
  }

  /** Crea las islas que acaban de aparecer en tu mapa y quita las que ya no están. */
  #syncArchipelago() {
    const hitMat = (this.hitMat ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    const home = this.game.state.home;
    const visible = this.game.world.islands().filter((i) => i.id !== home);
    const ids = new Set(visible.map((i) => i.id));
    for (const [id, entry] of Object.entries(this.islands)) {
      if (ids.has(id)) continue;
      this.scene.remove(entry.group, entry.label);
      disposeTree(entry.group);
      this.hitTargets = this.hitTargets.filter((h) => h !== entry.hit);
      delete this.islands[id];
    }
    for (const isl of visible) {
      if (this.islands[isl.id]) continue;
      const pos = this.#relPos(isl);
      const radius = islandRadius(isl);
      const group = new THREE.Group();
      group.position.copy(pos);
      group.add(createIslandBase(isl));
      this.scene.add(group);

      // El continente se pulsa por su suelo; sus asentamientos, más altos, tienen prioridad
      const flat = isl.type === 'continente';
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(radius + 2, radius + 2, flat ? 0.6 : 10, 16), hitMat);
      hit.position.y = flat ? 0.2 : 3;
      hit.userData.slot = isl.id;
      hit.visible = false; // solo para el ratón: no se dibuja
      group.add(hit);
      this.hitTargets.push(hit);

      const el = document.createElement('div');
      el.className = 'label isl';
      el.innerHTML = `<span class="label-name">${escapeHtml(isl.name)}</span><span class="label-lvl"></span>`;
      const label = new CSS2DObject(el);
      // Debajo de la isla en pantalla, para no taparla
      label.position.set(pos.x, 0, pos.z + (isl.land ? radius * 0.75 : radius * 1.35 + 3));
      label.visible = this.view === 'mapa';
      this.scene.add(label);

      this.islands[isl.id] = { isl, pos, radius, group, hit, feature: null, look: null, label, el };
    }
    // Espuma en las orillas más cercanas (el mar admite un número limitado)
    const shores = Object.values(this.islands)
      .map((e) => ({ x: e.pos.x, z: e.pos.z, r: shoreRadius(e.isl), d: e.pos.length() }))
      .filter((e) => e.r > 0)
      .sort((a, b) => a.d - b.d);
    setShores(this.water, [{ x: 0, z: 0, r: HOME_SHORE }, ...shores]);
  }

  #buildHomeLabel() {
    const el = document.createElement('div');
    el.className = 'label isl home';
    el.innerHTML = `<span class="label-name">${this.game.state.banner?.emblem ?? '⚜'} ${escapeHtml(this.game.homeIsland?.name ?? 'Tu isla')}</span>`;
    this.homeLabel = new CSS2DObject(el);
    this.homeLabel.position.set(0, 0, ISLAND_R + 9);
    this.homeLabel.visible = false;
    this.scene.add(this.homeLabel);
  }

  #buildClouds() {
    const rand = rng(42);
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.95 });
    this.cloudMaterial = material;
    for (let i = 0; i < 22; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < puffs; k++) {
        const puff = new THREE.Mesh(geo, material);
        puff.position.set(k * 1.3 - puffs * 0.6, rand() * 0.6, (rand() - 0.5) * 1.2);
        puff.scale.setScalar(1 + rand() * 0.9);
        cloud.add(puff);
      }
      const near = i < 8;
      cloud.position.set((rand() - 0.5) * (near ? 140 : 560), 18 + rand() * 12, (rand() - 0.5) * (near ? 100 : 500));
      if (!near) cloud.scale.setScalar(2 + rand() * 1.5);
      cloud.userData.speed = 0.8 + rand() * 1.2;
      cloud.userData.span = near ? 80 : 300;
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  #buildLife() {
    this.lifeGroup = new THREE.Group();
    this.scene.add(this.lifeGroup);
    const rand = rng(99);
    // Pesqueros que faenan alrededor de la isla
    for (let i = 0; i < 4; i++) {
      const boat = createShip(i === 3 ? 'mercante' : 'bote');
      boat.scale.setScalar(i === 3 ? 2.2 : 2.4);
      boat.userData.sail = { r: ISLAND_R + 9 + rand() * 12, speed: (2 + rand() * 1.5) * (i % 2 ? 1 : -1), phase: rand() * Math.PI * 2 };
      this.lifeGroup.add(boat);
      this.boats.push(boat);
    }
    // Delfines que saltan de vez en cuando
    for (let i = 0; i < 3; i++) {
      const d = dolphin();
      d.visible = false;
      d.userData.jump = { next: 2 + rand() * 6 + i * 3, t: -1 };
      this.lifeGroup.add(d);
      this.dolphins.push(d);
    }
    // Carros de bueyes por la avenida del puerto
    for (let i = 0; i < 2; i++) {
      const c = cart();
      c.userData.walk = { avenue: true, s: 6 + i * 9, dir: i ? -1 : 1, speed: 0.6, lane: i ? 0.35 : -0.35 };
      this.lifeGroup.add(c);
      this.carts.push(c);
    }
    // Lluvia: gotas como trazos cortos que caen alrededor de lo que miras
    const pos = new Float32Array(RAIN_DROPS * 6);
    this.rainSeeds = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.rainSeeds[i * 3] = rand() * 2 - 1;
      this.rainSeeds[i * 3 + 1] = rand() * 2 - 1;
      this.rainSeeds[i * 3 + 2] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#d6e6f5', transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.flashLight = new THREE.AmbientLight('#dfe8ff', 0);
    this.scene.add(this.flashLight);
    // Una sola luz para los combates (crear luces nuevas obligaría a recompilar todos los materiales)
    this.fxLight = new THREE.PointLight('#ffb070', 0, 40);
    this.scene.add(this.fxLight);
    for (let i = 0; i < 7; i++) {
      const gull = createGull();
      gull.userData.fly = { r: 12 + rand() * 24, h: 10 + rand() * 7, speed: (0.15 + rand() * 0.15) * (i % 2 ? 1 : -1), phase: rand() * Math.PI * 2 };
      this.scene.add(gull);
      this.gulls.push(gull);
    }
  }

  /** Aldeanos paseando por la ronda y la avenida del puerto (más cuanto más grande es la ciudad). */
  #syncVillagers() {
    const n = Math.min(34, 6 + 2 * this.game.level('ayuntamiento'));
    if (n === this.villagers.length) return;
    for (const v of this.villagers) this.lifeGroup.remove(v);
    this.villagers = [];
    const rand = rng(1234);
    for (let i = 0; i < n; i++) {
      const v = createVillager(i);
      const avenue = i % 3 === 0;
      v.userData.walk = avenue
        ? { avenue, s: 4 + rand() * (ISLAND_R - 6), dir: rand() < 0.5 ? 1 : -1, speed: 0.5 + rand() * 0.4, lane: (rand() - 0.5) * 0.8 }
        : { avenue, a: rand() * Math.PI * 2, dir: rand() < 0.5 ? 1 : -1, speed: 0.45 + rand() * 0.45, lane: rand() < 0.5 ? -0.22 : 0.22 };
      this.lifeGroup.add(v);
      this.villagers.push(v);
    }
  }

  /** Humo, fuego y destellos donde acaba de haber un combate (en tu isla o en otra). */
  #syncBattles() {
    if (this.showcase) return;
    const fresh = (this.game.reports ?? []).filter((r) => r.t > this.fxSeen && (r.battle || r.kind === 'defensa'));
    if (!fresh.length) return;
    this.fxSeen = Math.max(...fresh.map((r) => r.t));
    for (const r of fresh.slice(0, 4)) {
      const atHome = r.kind === 'defensa' || (r.defending && r.kind !== 'expedicion');
      const target = atHome ? null : this.islands[r.island];
      if (!atHome && !target) continue;
      // En casa, junto a la muralla por el lado que ve la cámara
      const pos = atHome ? polar(WALL_R + 2, 10 + ((r.t / 997) % 50)) : target.pos.clone();
      const size = atHome ? 6 : Math.max(5, target.radius * 0.7);
      this.#battleFx(pos, size, r.outcome);
    }
  }

  #battleFx(pos, size, outcome) {
    const group = new THREE.Group();
    group.position.copy(pos);
    const parts = [];
    const fire = ['#ff8a2a', '#ffb347', '#ff5a1f'];
    for (let i = 0; i < 20; i++) {
      const isFire = i % 3 !== 0;
      const material = new THREE.MeshStandardMaterial({
        color: isFire ? fire[i % 3] : '#5a5550',
        emissive: isFire ? fire[i % 3] : '#000000',
        emissiveIntensity: isFire ? 1.6 : 0,
        transparent: true,
        opacity: 0.9,
        flatShading: true,
        depthWrite: false,
      });
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(isFire ? 0.9 : 1.4, 0), material);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * size;
      puff.userData.fx = { x: Math.sin(a) * d, z: Math.cos(a) * d, delay: Math.random() * 1.2, rise: 3 + Math.random() * 5, grow: isFire ? 2 : 3.5 };
      group.add(puff);
      parts.push(puff);
    }
    this.scene.add(group);
    this.fx.push({ group, parts, pos: pos.clone().setY(3), size, t: 0, life: 4.2, win: outcome === 'victoria' });
  }

  #updateFx(dt) {
    const last = this.fx.at(-1);
    if (last) {
      // El destello del combate más reciente parpadea y se apaga
      this.fxLight.position.copy(last.pos);
      this.fxLight.distance = last.size * 5;
      this.fxLight.intensity = last.t < 2.4 ? (2 + Math.sin(last.t * 30) * 1.5) * (1 - last.t / 2.4) * 6 : 0;
    } else this.fxLight.intensity = 0;
    for (const f of this.fx) {
      f.t += dt;
      for (const p of f.parts) {
        const d = p.userData.fx;
        const k = Math.max(0, f.t - d.delay) / (f.life - d.delay);
        p.visible = f.t >= d.delay && k < 1;
        if (!p.visible) continue;
        p.position.set(d.x, 0.5 + k * d.rise, d.z);
        p.scale.setScalar(0.4 + k * d.grow);
        p.material.opacity = 0.95 * (1 - k * k);
      }
    }
    for (const f of this.fx.filter((x) => x.t >= x.life)) {
      this.scene.remove(f.group);
      for (const p of f.parts) {
        p.geometry.dispose();
        p.material.dispose();
      }
    }
    this.fx = this.fx.filter((x) => x.t < x.life);
  }

  /** Lluvia, cielo encapotado y relámpagos según el tiempo que haga. */
  #updateWeather(dt, now, dist) {
    const w = this.weather;
    const target = this.showcase ? WEATHERS[0] : (WEATHERS.find((x) => x.id === this.weatherOverride) ?? weatherAt(now));
    const k = Math.min(1, dt * 0.25);
    w.dark += (target.dark - w.dark) * k;
    w.rain += (target.rain - w.rain) * k;
    w.storm = !!target.storm;
    if (Math.abs(w.rain - w.rainSound) > 0.03) {
      w.rainSound = w.rain;
      setRain(this.view === 'isla' ? w.rain : w.rain * 0.4);
    }

    // Gotas alrededor del objetivo de la cámara (más grandes y dispersas en el mapa)
    this.rain.visible = w.rain > 0.02;
    if (this.rain.visible) {
      this.rain.material.opacity = 0.45 * w.rain;
      const span = THREE.MathUtils.clamp(dist * 0.7, 30, 260);
      const height = span * 0.8;
      const len = span * 0.025;
      const c = this.controls.target;
      const pos = this.rain.geometry.attributes.position.array;
      const fall = (now / 1000) * 0.9;
      const drops = Math.round(RAIN_DROPS * Math.min(1, 0.3 + w.rain));
      for (let i = 0; i < RAIN_DROPS; i++) {
        const o = i * 6;
        if (i >= drops) {
          pos.fill(0, o, o + 6);
          continue;
        }
        const x = c.x + this.rainSeeds[i * 3] * span;
        const z = c.z + this.rainSeeds[i * 3 + 1] * span;
        const y = WATER_Y + ((this.rainSeeds[i * 3 + 2] - fall) % 1 + 1) % 1 * height;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        pos[o + 3] = x + len * 0.25;
        pos[o + 4] = y - len;
        pos[o + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // Con lluvia se ve menos lejos
    this.scene.fog.near *= 1 - 0.5 * w.rain;
    this.scene.fog.far *= 1 - 0.55 * w.rain;

    // Relámpagos en las tormentas
    w.flash = Math.max(0, w.flash - dt * 4);
    if (w.storm && w.dark > 0.6 && Math.random() < dt * 0.12) {
      w.flash = 1;
      const power = 0.5 + Math.random() * 0.5;
      setTimeout(() => thunder(power), 500 + Math.random() * 1800);
    }
    this.flashLight.intensity = w.flash * w.flash * 3;
  }

  /** Casas de los barrios: más cuanto más grande es el ayuntamiento. */
  #syncHouses() {
    const level = this.game.level('ayuntamiento');
    const n = Math.min(this.houseSpots.length, 8 + level * 5);
    const key = `${n}|${level >= 4}`;
    if (this.housesKey === key) return;
    this.housesKey = key;
    for (const c of [...this.houseGroup.children]) {
      this.houseGroup.remove(c);
      disposeTree(c);
    }
    const roofs = [C.roofRed, C.roofBlue, C.roofRed, '#a0522d', C.roofGrey];
    const batch = new Batch(windowMaterial());
    this.houseSpots.slice(0, n).forEach((s, i) => {
      const h = new THREE.Group();
      const floors = s.tall && level >= 4 ? 2 : 1;
      const wallH = s.h * floors;
      h.add(box(s.w, wallH, s.d, i % 4 === 0 ? C.wallDark : C.wall));
      if (floors > 1) h.add(box(s.w + 0.04, 0.06, s.d + 0.04, C.woodDark, 0, s.h, 0));
      h.add(gableRoof(s.w + 0.2, 0.5, s.d + 0.22, roofs[s.roof], 0, wallH, 0));
      h.add(box(0.26, 0.42, 0.04, C.woodDark, 0, 0, s.d / 2 + 0.01));
      for (let f = 0; f < floors; f++) {
        for (const x of [-s.w * 0.3, s.w * 0.3]) h.add(box(0.18, 0.18, 0.04, C.dark, x, 0.3 + f * s.h + (f ? 0 : 0.05), s.d / 2 + 0.01, WINDOW_GLOW));
      }
      if (s.chimney) h.add(box(0.16, 0.5, 0.16, C.stone, s.w * 0.25, wallH + 0.1, -s.d * 0.2));
      h.position.copy(s.p);
      h.rotation.y = s.rot;
      // Humo en algunas chimeneas (no en todas, para no recargar)
      if (s.chimney && i % 2 === 0) {
        const top = new THREE.Vector3(s.w * 0.25, wallH + 0.7, -s.d * 0.2).applyEuler(new THREE.Euler(0, s.rot, 0)).add(s.p);
        const smoke = smokeColumn(top.x, top.y, top.z, i * 0.37);
        smoke.scale.setScalar(0.7);
        this.houseGroup.add(smoke);
      }
      batch.add(h);
    });
    this.houseGroup.add(batch.build());
    this.#collectAnimated();
  }

  #updateLife(dt, t) {
    const gate = THREE.MathUtils.degToRad(GATE_ANGLE);
    [...this.villagers, ...this.carts].forEach((v, i) => {
      const w = v.userData.walk;
      const bob = v.userData.cart ? 0 : Math.abs(Math.sin(t * 9 + i)) * 0.04;
      if (w.avenue) {
        w.s += w.dir * w.speed * dt;
        if (w.s > ISLAND_R - 1.8 || w.s < 3.8) w.dir *= -1;
        v.position.set(Math.sin(gate) * w.s + Math.cos(gate) * w.lane, bob, Math.cos(gate) * w.s - Math.sin(gate) * w.lane);
        v.rotation.y = gate + (w.dir > 0 ? 0 : Math.PI);
      } else {
        w.a += (w.dir * w.speed * dt) / ROAD_R;
        const r = ROAD_R + w.lane;
        v.position.set(Math.sin(w.a) * r, bob, Math.cos(w.a) * r);
        v.rotation.y = w.a + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    });
    for (const [i, boat] of this.boats.entries()) {
      const f = boat.userData.sail;
      const a = f.phase + (t * f.speed) / f.r;
      boat.position.set(Math.sin(a) * f.r, WATER_Y + Math.sin(t * 1.3 + i) * 0.08, Math.cos(a) * f.r);
      boat.rotation.set(0, a + (f.speed > 0 ? Math.PI / 2 : -Math.PI / 2), Math.sin(t * 1.1 + i) * 0.06);
    }
    for (const d of this.dolphins) {
      const j = d.userData.jump;
      j.next -= dt;
      if (j.t < 0 && j.next <= 0) {
        // Un salto cerca de la costa, en una dirección al azar
        const a = Math.random() * Math.PI * 2;
        const r = ISLAND_R + 8 + Math.random() * 20;
        j.from = new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r);
        j.dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        j.t = 0;
        d.visible = true;
      }
      if (j.t >= 0) {
        j.t += dt / 1.4;
        const p = Math.min(1, j.t);
        d.position.copy(j.from).addScaledVector(j.dir, p * 7);
        d.position.y = WATER_Y - 0.6 + Math.sin(p * Math.PI) * 2.4;
        d.rotation.set(Math.cos(p * Math.PI) * -0.9, Math.atan2(j.dir.x, j.dir.z), 0, 'YXZ');
        if (p >= 1) {
          j.t = -1;
          j.next = 4 + Math.random() * 9;
          d.visible = false;
        }
      }
    }
    for (const [i, gull] of this.gulls.entries()) {
      const f = gull.userData.fly;
      const a = f.phase + t * f.speed;
      gull.position.set(Math.sin(a) * f.r, f.h + Math.sin(t * 0.7 + i) * 0.8, Math.cos(a) * f.r);
      gull.rotation.set(0, a + (f.speed > 0 ? Math.PI / 2 : -Math.PI / 2), f.speed > 0 ? -0.25 : 0.25);
      for (const wing of gull.children) {
        if (wing.userData.side) wing.rotation.z = wing.userData.side * Math.sin(t * 7 + i) * 0.45;
      }
    }
  }

  #setupInput() {
    if (this.showcase) return;
    const el = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;

    const pick = (e) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, this.camera);
      return raycaster.intersectObjects(this.hitTargets, false)[0]?.object.userData.slot ?? null;
    };

    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      down = null;
      this.onSelect(pick(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      this.hovered = pick(e);
      el.style.cursor = this.hovered ? 'pointer' : '';
    });
    el.addEventListener('pointerleave', () => {
      this.hovered = null;
    });
  }

  #ringFor(id) {
    if (this.islands[id]) {
      const isl = this.islands[id];
      return { center: new THREE.Vector3(isl.pos.x, -0.25, isl.pos.z), radius: (isl.radius * 1.45) / 2.7 };
    }
    const slot = this.slots[id];
    return { center: slot.center.clone().setY(slot.center.y + 0.16), radius: slot.ring };
  }

  // ── Sincronización con la partida ──────────────────────────────────────────

  sync() {
    this.#syncBattles();
    this.#syncVillagers();
    this.#syncHouses();
    this.#syncBuildings();
    this.#syncWall();
    this.#syncExtras();
    this.#syncIslands();
    this.#syncFleets();
    this.#syncRaid();
    this.#collectAnimated();
  }

  #syncBuildings() {
    const q = this.game.queue;
    for (const id of BUILDING_KEYS) {
      const slot = this.slots[id];
      const level = this.game.level(id);
      const building = q?.id === id;
      const key = `${level}|${building}|${this.game.state.banner?.color ?? ''}`;
      if (slot.key === key) continue;
      const leveledUp = slot.key !== null && Number(slot.key.split('|')[0]) < level;
      slot.key = key;

      for (const part of ['building', 'scaffold']) {
        if (slot[part]) {
          slot.root.remove(slot[part]);
          disposeTree(slot[part]);
          slot[part] = null;
        }
      }
      slot.extras = null;
      slot.extrasKey = null;

      slot.building = createBuilding(id, level);
      paintBanner(slot.building, this.game.state.banner?.color);
      slot.building.position.y = id === 'ayuntamiento' ? 0.04 : id === 'puerto' || id === 'muralla' ? 0 : 0.12;
      slot.baseScale = slot.building.scale.x;
      slot.root.add(slot.building);
      slot.root.updateMatrixWorld(true);
      const top = new THREE.Box3().setFromObject(slot.building).max.y;

      if (building) {
        slot.scaffold = createScaffold(level > 0 ? top - slot.pos.y - 0.2 : 2.2);
        slot.scaffold.position.y = slot.building.position.y;
        if (id === 'puerto') slot.scaffold.position.z = 0.6;
        slot.root.add(slot.scaffold);
      }
      if (leveledUp) slot.pop = 0;

      slot.label.position.set(slot.center.x, Math.max(top, slot.pos.y + (building ? 2.6 : 0)) + 0.9, slot.center.z);
      slot.el.querySelector('.label-lvl').textContent = level > 0 ? `Nv ${level}` : id === 'puerto' || id === 'muralla' ? 'Sin construir' : 'Parcela libre';
      slot.el.querySelector('.label-mini b').textContent = level > 0 ? level : '·';
      slot.level = level;
      slot.el.classList.toggle('building', building);
      slot.el.classList.toggle('empty', level === 0);
    }
  }

  #syncWall() {
    const level = this.game.level('muralla');
    if (this.wallLevel === level) return;
    this.wallLevel = level;
    for (const child of [...this.wallGroup.children]) {
      this.wallGroup.remove(child);
      disposeTree(child);
    }
    if (level <= 0) return;
    const h = wallHeight(level);
    const gaps = [{ a: GATE_ANGLE, w: 8 }, ...[...OUTER, ...COAST].map((id) => ({ a: LAYOUT[id].angle, w: 4 }))];
    const blocked = (a) => gaps.some((g) => Math.abs(((a - g.a + 540) % 360) - 180) < g.w);
    const step = 4;
    const len = 2 * WALL_R * Math.sin(THREE.MathUtils.degToRad(step / 2)) + 0.06;
    for (let a = 0; a < 360; a += step) {
      if (blocked(a)) continue;
      const seg = box(len, h, 0.55, C.stone, 0, 0, 0);
      seg.position.copy(polar(WALL_R, a, h / 2));
      seg.rotation.y = THREE.MathUtils.degToRad(a);
      this.wallGroup.add(seg);
      if (level >= 2 && (a / step) % 2 === 0) {
        const merlon = box(0.4, 0.3, 0.6, C.stone, 0, 0, 0);
        merlon.position.copy(polar(WALL_R, a, h + 0.15));
        merlon.rotation.y = seg.rotation.y;
        this.wallGroup.add(merlon);
      }
    }
    if (level >= 3) {
      for (let a = 45; a < 360; a += 45) {
        if (blocked(a)) continue;
        const tower = cyl(0.8, 0.9, h + 1.1, 8, C.stone);
        tower.position.add(polar(WALL_R, a));
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.0, 8), mat(C.roofBlue));
        roof.position.copy(polar(WALL_R, a, h + 1.6));
        roof.castShadow = true;
        this.wallGroup.add(tower, roof);
      }
    }
    bakeStatic(this.wallGroup);
  }

  /** Tropas en el patio del cuartel y barcos amarrados en el puerto. */
  #syncExtras() {
    const units = this.game.units;
    const fill = (slot, ids, spotsKey, make) => {
      if (!slot.building) return;
      const counts = ids.map((id) => units[id] ?? 0);
      const key = counts.join(',');
      if (slot.extrasKey === key && slot.extras) return;
      slot.extrasKey = key;
      if (slot.extras) {
        slot.building.remove(slot.extras);
        disposeTree(slot.extras);
      }
      slot.extras = new THREE.Group();
      slot.building.add(slot.extras);
      const spots = slot.building.userData[spotsKey] ?? [];
      const total = counts.reduce((a, b) => a + b, 0);
      if (!total || !spots.length) return;
      // Reparto proporcional de los huecos, con al menos uno por tipo presente
      const list = [];
      ids.forEach((id, i) => {
        if (!counts[i]) return;
        const k = Math.max(1, Math.round((counts[i] / total) * spots.length));
        for (let j = 0; j < k; j++) list.push(id);
      });
      list.slice(0, spots.length).forEach((id, i) => make(slot.extras, id, spots[i], i));
      bakeStatic(slot.extras);
    };

    fill(this.slots.cuartel, LAND_UNITS, 'yard', (g, id, spot, i) => {
      const s = createSoldier(id);
      s.position.set(spot.x, 0.03, spot.z);
      s.rotation.y = Math.PI + (i % 3 - 1) * 0.15;
      s.scale.setScalar(1.1);
      g.add(s);
    });
    fill(this.slots.puerto, SHIP_UNITS, 'docks', (g, id, spot) => {
      const s = createShip(id);
      s.position.set(spot.x, WATER_Y - BEACH_Y, spot.z);
      s.rotation.y = Math.PI;
      s.userData.bob = { amp: 0.06, speed: 1.3 + spot.z * 0.1, base: WATER_Y - BEACH_Y };
      g.add(s);
    });
  }

  #syncIslands() {
    for (const [id, entry] of Object.entries(this.islands)) {
      const view = this.game.island(id);
      if (!view) continue;
      // El color de la bandera de quien gobierna la isla también cambia el modelo
      const ownerId = view.type === 'jugador' ? view.owner : view.colonizedBy;
      const bannerColor = ownerId === this.game.userId ? this.game.state.banner?.color : this.game.world.playerInfo(ownerId)?.banner?.color;
      const look = `${islandLook(view)}|${bannerColor ?? ''}`;
      if (entry.look !== look) {
        entry.look = look;
        if (entry.feature) {
          entry.group.remove(entry.feature);
          disposeTree(entry.feature);
        }
        entry.feature = createIslandFeature({ ...entry.isl, colonizedBy: view.colonizedBy, bannerColor }, look);
        entry.group.add(entry.feature);
      }
      const t = ISLAND_TYPES[entry.isl.type];
      let status = !view.explored ? '❔ Inexplorada' : `${t.icon} ${view.typeName}`;
      const ally = view.alliance && view.alliance.id === this.game.alliance?.id;
      if (view.type === 'jugador') {
        const tag = view.alliance ? `[${view.alliance.tag}] ` : '';
        status = `${this.game.world.playerInfo(view.owner)?.banner?.emblem ?? '🏰'} ${tag}${view.ownerName} · ${view.score} pts${view.protected ? ' · 🛡️' : ''}${view.vacation ? ' · 🏖️' : view.inactive ? ' · 💤' : ''}${view.relation === 'guerra' ? ' · ⚔️' : view.relation === 'pacto' ? ' · 🕊️' : ''}`;
      } else if (view.colonized) status = `🚩 Tu colonia · Nv ${view.colony?.level ?? 1}${view.colony?.upgradeEnd ? ' 🔨' : ''}`;
      else if (view.colonizedBy != null) status = `🚩 Colonia de ${view.colonistName}`;
      else if (view.explored && view.tier) status += ` · Nv ${view.tier}`;
      if (view.type === 'continente') status = view.horde ? `🔥 ¡Horda! ${view.horde.left} bárbaros` : `🗺️ Continente · maravilla nivel ${view.wonder?.level ?? 0}`;
      if (view.inbound.length) status += ' · ⛵';
      entry.el.querySelector('.label-lvl').textContent = status;
      entry.el.classList.toggle('colony', !!view.colonized);
      entry.el.classList.toggle('ally', !!ally);
      entry.el.classList.toggle('pact', view.relation === 'pacto');
      entry.el.classList.toggle('war', view.relation === 'guerra' || (view.type === 'continente' && !!view.horde));
      // Lo que más importa al jugador se queda con la etiqueta entera cuando no caben todas
      entry.prio = view.type === 'continente' && view.horde ? 400 : view.colonized ? 350 : view.type === 'jugador' ? 300 : view.type === 'continente' ? 250 : view.explored ? 100 : 0;
      entry.el.classList.toggle('player', view.type === 'jugador');
      entry.el.classList.toggle('unknown', !view.explored);
    }
  }

  /** Ruta desde tu puerto: rodea tu isla y sale en línea recta hacia el destino. */
  #routeTo(target) {
    const entry = this.islands[target];
    const pos = entry ? entry.pos : new THREE.Vector3(0, 0, 200);
    const dist = pos.length();
    const a0 = GATE_ANGLE;
    const a1 = THREE.MathUtils.radToDeg(Math.atan2(pos.x, pos.z));
    const delta = ((a1 - a0 + 540) % 360) - 180;
    const points = [polar(ISLAND_R + 7, a0), polar(HARBOR_R, a0)];
    const steps = Math.ceil(Math.abs(delta) / 15);
    for (let i = 1; i <= steps; i++) points.push(polar(HARBOR_R, a0 + (delta * i) / steps));
    points.push(polar(Math.max(HARBOR_R + 5, dist - (entry?.radius ?? 10) * 1.35 - 2), a1));
    return new Route(points);
  }

  #syncFleets() {
    const missions = this.game.missions;
    const incoming = this.game.incoming ?? [];
    const traffic = this.game.traffic ?? [];
    const alive = new Set([...missions.map((m) => m.id), ...incoming.map((m) => `in-${m.id}`), ...traffic.map((m) => `tr-${m.id}`)]);
    for (const [id, f] of this.fleets) {
      if (alive.has(id)) continue;
      for (const o of [f.group, f.line]) {
        this.scene.remove(o);
        disposeTree(o);
      }
      this.fleets.delete(id);
    }
    for (const m of missions) {
      if (this.fleets.has(m.id)) continue;
      const route = this.#routeTo(m.target);
      const type = SHIP_PRIORITY.find((s) => m.units[s]) ?? 'mercante';
      const group = new THREE.Group();
      const ship = createShip(type);
      group.add(ship);
      const ships = Object.entries(m.units).filter(([u]) => SHIP_UNITS.includes(u)).reduce((a, [, n]) => a + n, 0);
      if (ships > 1) {
        const escort = createShip(type === 'bote' ? 'bote' : 'mercante');
        escort.position.set(1.6, 0, -1.8);
        group.add(escort);
      }
      group.scale.setScalar(2.6);
      this.scene.add(group);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(route.points.map((p) => p.clone().setY(0.3)));
      const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: m.type === 'atacar' ? '#ff9a8a' : '#ffffff', dashSize: 3, gapSize: 2.5, transparent: true, opacity: 0.7 }));
      line.computeLineDistances();
      this.scene.add(line);
      this.fleets.set(m.id, { group, line, route });
    }
    // Flotas de otros jugadores que pasan cerca: solo el barco, sin ruta ni detalles
    const home = this.game.homeIsland;
    for (const m of traffic) {
      const key = `tr-${m.id}`;
      if (this.fleets.has(key)) continue;
      const from = new THREE.Vector3(m.fx - home.x, 0, m.fz - home.z);
      const to = new THREE.Vector3(m.tx - home.x, 0, m.tz - home.z);
      const dir = to.clone().sub(from).normalize();
      const route = new Route([from.clone().addScaledVector(dir, 22), to.clone().addScaledVector(dir, -14)]);
      const group = new THREE.Group();
      group.add(createShip(m.ship));
      this.scene.add(group);
      const line = new THREE.Group(); // sin línea: no se sabe adónde va
      this.fleets.set(key, { group, line, route, traffic: m });
    }
    for (const m of incoming) {
      const key = `in-${m.id}`;
      if (this.fleets.has(key)) continue;
      // Del puerto enemigo hasta la entrada del tuyo
      const home = this.game.homeIsland;
      const from = new THREE.Vector3(m.x - home.x, 0, m.z - home.z);
      const to = from.clone().setLength(ISLAND_R + 10);
      const route = new Route([from.clone().setLength(Math.max(ISLAND_R + 20, from.length() - 25)), to]);
      const group = new THREE.Group();
      group.add(createShip('trirreme'));
      const escort = createShip('mercante');
      escort.position.set(1.6, 0, -1.8);
      group.add(escort);
      group.scale.setScalar(2.6);
      this.scene.add(group);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(route.points.map((p) => p.clone().setY(0.3)));
      const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: '#ff5a4a', dashSize: 4, gapSize: 3, transparent: true, opacity: 0.85 }));
      line.computeLineDistances();
      this.scene.add(line);
      this.fleets.set(key, { group, line, route, incoming: m });
    }
  }

  #syncRaid() {
    const raid = this.game.raid;
    const key = raid ? raid.spawn : null;
    if (this.raidKey === key) return;
    this.raidKey = key;
    if (this.raidGroup) {
      this.scene.remove(this.raidGroup, this.raidLine);
      disposeTree(this.raidGroup);
      disposeTree(this.raidLine);
      this.raidGroup = null;
    }
    if (!raid) return;
    // Siempre por el lado que ve la cámara al empezar, para que se vean llegar
    const angle = -50 + ((raid.spawn / 997) % 140);
    this.raidRoute = new Route([polar(RAID_FROM, angle), polar(ISLAND_R + 9, angle)]);
    this.raidGroup = new THREE.Group();
    const ships = Math.min(4, 1 + (raid.army.corsario ?? 0) + Math.floor((raid.army.pirata ?? 0) / 15));
    for (let i = 0; i < ships; i++) {
      const s = createShip('corsario');
      s.position.set((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 2.2, 0, -Math.ceil(i / 2) * 2.4);
      this.raidGroup.add(s);
    }
    this.raidGroup.scale.setScalar(2.6);
    this.scene.add(this.raidGroup);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(this.raidRoute.points.map((p) => p.clone().setY(0.3)));
    this.raidLine = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: '#ff5a4a', dashSize: 4, gapSize: 3, transparent: true, opacity: 0.8 }));
    this.raidLine.computeLineDistances();
    this.scene.add(this.raidLine);
  }

  #collectAnimated() {
    this.animated = [];
    const collect = (root) =>
      root?.traverse((o) => {
        const d = o.userData;
        if (d.spin || d.swing || d.wave || d.smoke || d.flicker || d.bob || d.wiggle || d.sparks) this.animated.push(o);
      });
    for (const slot of Object.values(this.slots)) {
      collect(slot.building);
      collect(slot.scaffold);
    }
    collect(this.houseGroup);
    for (const isl of Object.values(this.islands)) collect(isl.feature);
    for (const f of this.fleets.values()) collect(f.group);
    collect(this.raidGroup);
  }

  // ── Bucle ─────────────────────────────────────────────────────────────────

  update(dt, t) {
    const now = clock.now();

    // Cambio de vista: interpolar cámara y objetivo
    if (this.camTween) {
      const tw = this.camTween;
      tw.t = Math.min(1, tw.t + dt * 1.1);
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) {
        this.camTween = null;
        const v = VIEWS[this.view];
        this.controls.minDistance = v.min;
        this.controls.maxDistance = this.camera.aspect < 1 ? v.max * 1.4 : v.max;
      }
    } else if (this.focusTarget) {
      // Encuadrar lo seleccionado moviendo cámara y objetivo a la vez
      const target = this.controls.target;
      const step = this.focusTarget.clone().sub(target).multiplyScalar(1 - Math.exp(-dt * 4));
      target.add(step);
      this.camera.position.add(step);
      if (target.distanceTo(this.focusTarget) < 0.01) this.focusTarget = null;
    }
    this.controls.update(dt);

    // Niebla según lo lejos que esté la cámara
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.scene.fog.near = dist * 0.9 + 25;
    this.scene.fog.far = dist * 2.6 + 160;
    this.homeLabel.visible = this.view === 'mapa';

    this.waterTime.value = t;
    this.#updateWeather(dt, now, dist);
    this.#updateFx(dt);
    this.#updateSky(now);
    this.#updateLife(dt, t);

    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > cloud.userData.span) cloud.position.x = -cloud.userData.span;
    }

    for (const o of this.animated) {
      const { spin, swing, wave, smoke, flicker, bob, wiggle, sparks } = o.userData;
      if (spin) o.rotation[spin.axis] += spin.speed * dt;
      if (swing) o.rotation.y = Math.sin(t * swing.speed) * swing.amp;
      if (wave) o.rotation.y = Math.sin(t * 3) * 0.3;
      if (flicker) o.scale.set(1, 1 + Math.sin(t * 13 + o.id) * 0.18, 1);
      if (bob) {
        o.position.y = bob.base + Math.sin(t * bob.speed + o.id) * bob.amp;
        o.rotation.z = Math.sin(t * bob.speed * 0.8 + o.id) * 0.05;
      }
      if (wiggle) o.rotation.z = wiggle.base + Math.sin(t * wiggle.speed + wiggle.phase) * wiggle.amp;
      if (sparks) {
        // Saltan cuando el martillo llega abajo (seno en -1) y se apagan al caer
        const f = ((((t * sparks.speed - 1.5 * Math.PI) / (2 * Math.PI)) % 1) + 1) % 1;
        o.children.forEach((s, k) => {
          const [dx, dz] = s.userData.dir;
          const r = f * (0.25 + (k % 3) * 0.08);
          s.position.set(dx * r, f * 0.45 - f * f * 0.55, dz * r);
          s.scale.setScalar(Math.max(0.01, 1 - f));
        });
      }
      if (smoke) {
        o.children.forEach((puff, k) => {
          const f = (t * 0.35 + smoke.phase + k / o.children.length) % 1;
          puff.position.set(f * 0.3, f * 1.6, 0);
          puff.scale.setScalar(0.5 + f * 1.1);
        });
      }
    }

    // Flotas en el mar (más grandes en el mapa para que se distingan)
    const shipScale = THREE.MathUtils.clamp(dist / 60, 2.6, 4.5);
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (const m of this.game.missions) {
      const f = this.fleets.get(m.id);
      if (!f) continue;
      let u;
      let back = false;
      if (m.phase === 'estacionada') {
        u = 1;
      } else if (m.phase === 'ida') {
        u = (now - m.depart) / (m.arrive - m.depart);
      } else {
        back = true;
        const turn = m.turn ?? (m.recalled ? (m.back + m.depart) / 2 : m.arrive);
        const u0 = Math.min(1, (turn - m.depart) / (m.arrive - m.depart));
        u = u0 * THREE.MathUtils.clamp((m.back - now) / (m.back - turn), 0, 1);
      }
      f.route.at(u, pos, dir);
      if (back) dir.negate();
      f.group.position.set(pos.x, WATER_Y + Math.sin(t * 1.4 + m.id) * 0.12, pos.z);
      f.group.rotation.y = Math.atan2(dir.x, dir.z);
      f.group.scale.setScalar(shipScale);
      f.line.visible = this.view === 'mapa';
    }

    for (const f of this.fleets.values()) {
      if (!f.traffic) continue;
      const m = f.traffic;
      const back = m.phase === 'vuelta';
      const u = back ? 1 - (now - m.arrive) / Math.max(1, (m.back ?? m.arrive) - m.arrive) : (now - m.depart) / (m.arrive - m.depart);
      f.route.at(THREE.MathUtils.clamp(u, 0, 1), pos, dir);
      if (back) dir.negate();
      f.group.position.set(pos.x, WATER_Y + Math.sin(t * 1.2 + pos.x) * 0.12, pos.z);
      f.group.rotation.y = Math.atan2(dir.x, dir.z);
      f.group.scale.setScalar(shipScale * 0.85);
    }

    for (const f of this.fleets.values()) {
      if (!f.incoming) continue;
      const m = f.incoming;
      f.route.at((now - m.depart) / (m.arrive - m.depart), pos, dir);
      f.group.position.set(pos.x, WATER_Y + Math.sin(t * 1.3) * 0.12, pos.z);
      f.group.rotation.y = Math.atan2(dir.x, dir.z);
      f.group.scale.setScalar(shipScale);
      f.line.visible = this.view === 'mapa';
    }

    if (this.raidGroup) {
      const raid = this.game.raid;
      if (raid) {
        const u = (now - raid.spawn) / (raid.arrival - raid.spawn);
        this.raidRoute.at(u, pos, dir);
        this.raidGroup.position.set(pos.x, WATER_Y + Math.sin(t * 1.2) * 0.15, pos.z);
        this.raidGroup.rotation.y = Math.atan2(dir.x, dir.z);
        this.raidGroup.scale.setScalar(shipScale);
      }
      this.raidLine.visible = this.view === 'mapa';
    }

    // Construcciones: rebote al subir de nivel y barra de progreso
    const q = this.game.queue;
    for (const slot of Object.values(this.slots)) {
      if (slot.pop < 1) {
        slot.pop = Math.min(1, slot.pop + dt * 2.5);
        slot.building.scale.setScalar(slot.baseScale * (1 + Math.sin(slot.pop * Math.PI) * 0.18));
      }
      if (q?.id === slot.id) {
        const p = Math.min(1, (now - q.start) / (q.end - q.start));
        slot.el.querySelector('.label-bar i').style.width = `${(p * 100).toFixed(1)}%`;
      }
    }

    this.selectRing.material.opacity = 0.65 + Math.sin(t * 4) * 0.3;
    const showHover = this.hovered && this.hovered !== this.selected;
    this.hoverRing.visible = !!showHover;
    if (showHover) {
      const { center, radius } = this.#ringFor(this.hovered);
      this.hoverRing.position.copy(center).setY(center.y - 0.01);
      this.hoverRing.scale.setScalar(radius);
    }

    this.frame = (this.frame ?? 0) + 1;
    if (this.frame % 3 === 0) this.#declutter();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /**
   * Etiquetas sin amontonarse: de la más importante a la menos, cada una se queda entera si cabe;
   * si pisa a otra se encoge (icono y nivel, o solo el nombre de la isla) y, si ni así cabe, se esconde.
   * Al pasar el ratón o seleccionar algo, su etiqueta pasa la primera.
   */
  #declutter() {
    if (this.showcase) return;
    const items = [];
    const boost = (id) => (id === this.selected ? 2000 : id === this.hovered ? 1500 : 0);
    if (this.view === 'isla') {
      const q = this.game.queue;
      for (const s of Object.values(this.slots)) {
        const prio = boost(s.id) + (q?.id === s.id ? 1000 : 0) + (s.id === 'ayuntamiento' ? 600 : 0) + (s.level ?? 0) * 10;
        items.push({ el: s.el, obj: s.label, prio, island: false });
      }
    } else {
      const target = this.controls.target;
      for (const [id, e] of Object.entries(this.islands)) {
        items.push({ el: e.el, obj: e.label, prio: boost(id) + (e.prio ?? 0) - e.pos.distanceTo(target) * 0.5, island: true });
      }
      if (this.homeLabel.visible) items.push({ el: this.homeLabel.element, obj: this.homeLabel, prio: 1200, island: true });
    }
    const W = this.renderer.domElement.clientWidth;
    const H = this.renderer.domElement.clientHeight;
    const v = (this.tmpV ??= new THREE.Vector3());
    const placed = [];
    const hits = (r) => placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
    const rect = (x, y, w, h) => ({ x0: x - w / 2 - 2, x1: x + w / 2 + 2, y0: y - h / 2 - 1, y1: y + h / 2 + 1 });
    items.sort((a, b) => b.prio - a.prio);
    for (const it of items) {
      const { el, obj } = it;
      if (!obj.visible) continue;
      v.copy(obj.position).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) continue;
      const x = ((v.x + 1) / 2) * W;
      const y = ((1 - v.y) / 2) * H;
      // El tamaño entero se mide una vez (y otra si cambia el texto)
      const text = el.textContent;
      if (el._text !== text || !el._full) {
        el.classList.remove('lbl-compact', 'lbl-hidden');
        el._state = 'full';
        el._full = { w: el.offsetWidth, h: el.offsetHeight };
        // Aún sin dibujar (detrás de la cámara): se mide en otra vuelta
        if (!el._full.w) {
          el._full = null;
          continue;
        }
        const name = el.firstElementChild;
        el._mini = it.island ? { w: name.offsetWidth + 14, h: name.offsetHeight + 6 } : { w: 38, h: 20 };
        el._text = text;
      }
      let state = 'hidden';
      for (const [s, size] of [['full', el._full], ['compact', el._mini]]) {
        const r = rect(x, y, size.w, size.h);
        if (hits(r)) continue;
        placed.push(r);
        state = s;
        break;
      }
      if (el._state !== state) {
        el._state = state;
        el.classList.toggle('lbl-compact', state === 'compact');
        el.classList.toggle('lbl-hidden', state === 'hidden');
      }
    }
  }
}

// ── Piezas de decoración de la isla ─────────────────────────────────────────

function pine(color, round) {
  const t = new THREE.Group();
  t.add(cyl(0.1, 0.15, 0.6, 6, C.woodDark));
  if (round) {
    const crown = mesh(new THREE.DodecahedronGeometry(0.75), color);
    crown.position.y = 1.2;
    t.add(crown);
    return t;
  }
  const leaves = mesh(new THREE.ConeGeometry(0.75, 1.5, 7), color);
  leaves.position.y = 1.25;
  const top = mesh(new THREE.ConeGeometry(0.75, 1.5, 7), color);
  top.position.y = 1.85;
  top.scale.setScalar(0.7);
  t.add(leaves, top);
  return t;
}

function palm() {
  const t = new THREE.Group();
  const trunk = cyl(0.08, 0.12, 1.5, 5, C.woodLight);
  trunk.rotation.z = 0.15;
  t.add(trunk);
  for (let k = 0; k < 6; k++) {
    const leaf = box(0.95, 0.04, 0.24, k % 2 ? '#4f9a3a' : '#3f8a3a', 0, 0, 0);
    leaf.geometry.translate(0.47, 0, 0);
    leaf.position.set(0.22, 1.45, 0);
    leaf.rotation.set(0, (k * Math.PI * 2) / 6, -0.35);
    t.add(leaf);
  }
  return t;
}

function sheep() {
  const g = new THREE.Group();
  g.add(box(0.42, 0.26, 0.28, '#f4f1e8', 0, 0.14, 0));
  g.add(box(0.14, 0.14, 0.14, '#3a332c', 0.26, 0.26, 0));
  for (const [x, z] of [[-0.14, -0.09], [0.14, -0.09], [-0.14, 0.09], [0.14, 0.09]]) g.add(box(0.05, 0.14, 0.05, '#3a332c', x, 0, z));
  return g;
}

function dolphin() {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.5, 10, 8), '#6d7f8f');
  body.scale.set(0.55, 0.5, 1.6);
  g.add(body);
  const belly = mesh(new THREE.SphereGeometry(0.45, 8, 6), '#c9d3db');
  belly.scale.set(0.45, 0.3, 1.3);
  belly.position.y = -0.12;
  g.add(belly);
  const fin = mesh(new THREE.ConeGeometry(0.16, 0.45, 4), '#5d6e7d');
  fin.position.set(0, 0.32, -0.1);
  fin.rotation.x = -0.4;
  g.add(fin);
  const tail = box(0.7, 0.05, 0.25, '#5d6e7d', 0, -0.02, -0.85);
  g.add(tail);
  const snout = mesh(new THREE.ConeGeometry(0.12, 0.4, 6), '#6d7f8f');
  snout.rotation.x = Math.PI / 2;
  snout.position.z = 0.9;
  g.add(snout);
  return g;
}

function cart() {
  const g = new THREE.Group();
  g.userData.cart = true;
  // Buey delante (+Z) y carro con sacos detrás
  g.add(box(0.36, 0.34, 0.75, '#8a6a4a', 0, 0.22, 0.7));
  g.add(box(0.24, 0.24, 0.28, '#7a5a3a', 0, 0.38, 1.15));
  for (const [x, z] of [[-0.12, 0.45], [0.12, 0.45], [-0.12, 0.95], [0.12, 0.95]]) g.add(box(0.07, 0.22, 0.07, '#5e3b1c', x, 0, z));
  g.add(box(0.05, 0.05, 0.6, C.woodDark, 0, 0.35, 0.1));
  g.add(box(0.7, 0.32, 0.9, C.wood, 0, 0.28, -0.5));
  for (const x of [-0.4, 0.4]) {
    const wheel = cyl(0.24, 0.24, 0.06, 10, C.woodDark, 0, 0, 0);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.24, -0.5);
    g.add(wheel);
  }
  for (const [x, c] of [[-0.15, '#e9dcc0'], [0.17, '#d8c49a']]) g.add(box(0.28, 0.24, 0.32, c, x, 0.6, -0.5));
  return g;
}

/** Las banderas (las que ondean con el color principal) toman el color del estandarte del jugador. */
function paintBanner(root, color) {
  if (!color) return;
  const base = mat(C.cloth[0]);
  root.traverse((o) => {
    if (o.isMesh && o.userData.wave && o.material === base) o.material = mat(color);
  });
}
