import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { BUILDINGS, BUILDING_KEYS, ISLANDS, ISLAND_TYPES, LAND_UNITS, SHIP_UNITS } from '../game/data.js';
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
  disposeTree,
  mat,
  wallHeight,
  windowMaterial,
} from './models.js';
import { createIslandBase, createIslandFeature, islandLook, islandRadius, shoreRadius } from './islands.js';
import { mountainGeometry, paintByNormal, plateauGeometry, polar, rng } from './util.js';
import { createWater } from './water.js';

const HORIZON = '#cfe8f7';
const WATER_Y = -0.7;
const ISLAND_R = 19;
const BEACH_Y = -0.5;
const ROAD_R = 10.4;
const WALL_R = 11.7;
const GATE_ANGLE = 15;
const HARBOR_R = 30; // radio por el que las flotas rodean la isla al salir
const RAID_FROM = 260;
const HOME_SHORE = 21.7; // donde la playa de tu isla corta el agua

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
  academia: { r: 7.8, angle: 60 },
  almacen: { r: 7.8, angle: 145 },
  templo: { r: 7.8, angle: 195 },
  cuartel: { r: 7.8, angle: 245 },
  mercado: { r: 7.8, angle: 330 },
  granja: { r: 15, angle: 72 },
  aserradero: { r: 15, angle: 125 },
  cantera: { r: 15, angle: 178 },
  mina: { r: 15, angle: 236 },
  fundicion: { r: 15, angle: 292 },
  coloso: { r: 15, angle: 345, ring: 1.15 },
  muralla: { r: WALL_R, angle: GATE_ANGLE, hit: 1.8, ring: 0.7 },
  puerto: { r: 20.4, angle: GATE_ANGLE, y: BEACH_Y, hit: 3.2, hitZ: -2.6 },
};
const INNER = ['academia', 'almacen', 'templo', 'cuartel', 'mercado'];
const OUTER = ['granja', 'aserradero', 'cantera', 'mina', 'fundicion', 'coloso'];
const MOUNTAINS = [
  { angle: 207, r: 18.6, radius: 3.4, height: 6.2 },
  { angle: 190, r: 20.2, radius: 2.2, height: 3.8 },
  { angle: 224, r: 20.4, radius: 2.0, height: 3.2 },
];
const VIEWS = {
  isla: { offset: new THREE.Vector3(26, 27, 36), min: 14, max: 90 },
  mapa: { offset: new THREE.Vector3(0, 420, 250), min: 60, max: 900 },
};
const SHIP_PRIORITY = ['galeon', 'trirreme', 'mercante', 'bote'];

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
   * @param {{ onSelect: (id: string|null) => void }} handlers
   */
  constructor(container, game, { onSelect }) {
    this.container = container;
    this.game = game;
    this.onSelect = onSelect;
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

    this.#setupRenderer();
    this.#setupScene();
    this.#buildIsland();
    this.#buildSlots();
    this.#buildArchipelago();
    this.#buildClouds();
    this.#buildLife();
    this.#setupInput();
    this.sync();

    game.addEventListener('change', () => this.sync());
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
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 120 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.skyKey = null;
    this.#updateSky(Date.now());

    // Mar estilizado: olas en la GPU, agua clara y espuma junto a cada orilla
    const shores = [{ x: 0, z: 0, r: HOME_SHORE }];
    for (const isl of ISLANDS) {
      const p = polar(isl.dist, isl.angle);
      shores.push({ x: p.x, z: p.z, r: shoreRadius(isl) });
    }
    this.water = createWater(shores, WATER_Y);
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
    const key = Math.round(s * 100);
    if (key === this.skyKey) return;
    this.skyKey = key;

    const step = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    const [from, to, k] = s >= 0 ? [SKIES.dusk, SKIES.day, step(0, 0.35, s)] : [SKIES.dusk, SKIES.night, step(0, 0.35, -s)];
    const col = (name) => new THREE.Color(from[name]).lerp(new THREE.Color(to[name]), k);
    const num = (name) => from[name] + (to[name] - from[name]) * k;

    const top = col('top');
    const horizon = col('horizon');
    const ctx = this.skyCtx;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(1, `#${horizon.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    this.sky.needsUpdate = true;
    this.scene.fog.color.copy(horizon);

    this.sun.color.copy(col('sun'));
    this.sun.intensity = num('sunI');
    this.hemi.color.copy(col('hemi'));
    this.hemi.intensity = num('hemiI');
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
    const geo = plateauGeometry(ISLAND_R, ISLAND_R - 1.6, 2.2, 48, 0, 0);
    paintByNormal(geo, (ny, cy) => (ny > 0.7 ? '#6fae4a' : cy > -0.8 ? '#8a6a46' : '#7c7466'));
    const island = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    island.receiveShadow = true;
    island.castShadow = true;
    scene.add(island);

    const sand = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R + 2.5, ISLAND_R + 4.2, 1.6, 48), mat('#e8d49a'));
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
    for (const id of OUTER) road(LAYOUT[id].angle, ROAD_R, LAYOUT[id].r - 2.2);
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

    // Bosque (más denso junto al aserradero) y rocas, sin pisar nada
    const rand = rng(7);
    const blockers = [
      { p: new THREE.Vector3(), r: 4.2 },
      ...Object.entries(LAYOUT)
        .filter(([id]) => id !== 'ayuntamiento')
        .map(([, l]) => ({ p: polar(l.r, l.angle), r: 3.5 })),
      ...MOUNTAINS.map((m) => ({ p: polar(m.r, m.angle), r: m.radius + 0.6 })),
    ];
    const free = (p) => {
      const r = Math.hypot(p.x, p.z);
      if (r > ISLAND_R - 1.3) return false;
      if (r > ROAD_R - 1.0 && r < WALL_R + 0.9) return false;
      for (const rd of this.roads) {
        const a = THREE.MathUtils.degToRad(rd.deg);
        const along = p.x * Math.sin(a) + p.z * Math.cos(a);
        const across = Math.abs(p.x * Math.cos(a) - p.z * Math.sin(a));
        if (along > rd.from - 0.5 && along < rd.to + 0.5 && across < rd.width / 2 + 0.7) return false;
      }
      return blockers.every((b) => b.p.distanceTo(p) > b.r);
    };
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.6, 6);
    const leafGeo = new THREE.ConeGeometry(0.75, 1.5, 7);
    const leafColors = ['#3f8a3a', '#4f9a3a', '#2f7a43'];
    const forest = polar(16.5, LAYOUT.aserradero.angle);
    let trees = 0;
    for (let tries = 0; tries < 1200 && trees < 95; tries++) {
      const p = tries % 3 === 0 ? forest.clone().add(polar(rand() * 6, rand() * 360)) : polar(3.5 + rand() * 15, rand() * 360);
      if (!free(p)) continue;
      blockers.push({ p, r: 0.9 });
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, mat(C.woodDark));
      trunk.position.y = 0.3;
      const leaves = new THREE.Mesh(leafGeo, mat(leafColors[trees % 3]));
      leaves.position.y = 1.25;
      const leaves2 = new THREE.Mesh(leafGeo, mat(leafColors[(trees + 1) % 3]));
      leaves2.position.y = 1.85;
      leaves2.scale.setScalar(0.7);
      for (const m of [trunk, leaves, leaves2]) m.castShadow = m.receiveShadow = true;
      t.add(trunk, leaves, leaves2);
      t.position.copy(p);
      t.scale.setScalar(0.75 + rand() * 0.55);
      t.rotation.y = rand() * Math.PI;
      scene.add(t);
      trees++;
    }
    const rockGeo = new THREE.DodecahedronGeometry(0.4);
    for (let i = 0, placed = 0; i < 400 && placed < 20; i++) {
      const p = polar(4 + rand() * 14, rand() * 360);
      if (!free(p)) continue;
      const rock = new THREE.Mesh(rockGeo, mat(C.stone));
      rock.position.set(p.x, 0.1, p.z);
      rock.scale.set(0.6 + rand(), 0.5 + rand() * 0.5, 0.6 + rand());
      rock.castShadow = rock.receiveShadow = true;
      scene.add(rock);
      placed++;
    }

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
      root.add(hit);
      this.hitTargets.push(hit);
      root.updateMatrixWorld(true);
      const center = hit.getWorldPosition(new THREE.Vector3()).setY(pos.y);

      const el = document.createElement('div');
      el.className = 'label';
      el.innerHTML = `<span class="label-name">${BUILDINGS[id].name}</span><span class="label-lvl"></span><span class="label-bar"><i></i></span>`;
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

  #buildArchipelago() {
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (const isl of ISLANDS) {
      const pos = polar(isl.dist, isl.angle);
      const radius = islandRadius(isl);
      const group = new THREE.Group();
      group.position.copy(pos);
      group.add(createIslandBase(isl));
      this.scene.add(group);

      const hit = new THREE.Mesh(new THREE.CylinderGeometry(radius + 2, radius + 2, 10, 16), hitMat);
      hit.position.y = 3;
      hit.userData.slot = isl.id;
      group.add(hit);
      this.hitTargets.push(hit);

      const el = document.createElement('div');
      el.className = 'label isl';
      el.innerHTML = `<span class="label-name">${isl.name}</span><span class="label-lvl"></span>`;
      const label = new CSS2DObject(el);
      // Debajo de la isla en pantalla, para no taparla
      label.position.set(pos.x, 0, pos.z + radius * 1.35 + 3);
      label.visible = false;
      this.scene.add(label);

      this.islands[isl.id] = { isl, pos, radius, group, feature: null, look: null, label, el };
    }

    // Etiqueta de tu isla en el mapa
    const el = document.createElement('div');
    el.className = 'label isl home';
    el.innerHTML = '<span class="label-name">⚜ Tu isla</span>';
    this.homeLabel = new CSS2DObject(el);
    this.homeLabel.position.set(0, 0, ISLAND_R + 9);
    this.homeLabel.visible = false;
    this.scene.add(this.homeLabel);
  }

  #buildClouds() {
    const rand = rng(42);
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.95 });
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
    for (let i = 0; i < 7; i++) {
      const gull = createGull();
      gull.userData.fly = { r: 9 + rand() * 18, h: 9 + rand() * 6, speed: (0.15 + rand() * 0.15) * (i % 2 ? 1 : -1), phase: rand() * Math.PI * 2 };
      this.scene.add(gull);
      this.gulls.push(gull);
    }
  }

  /** Aldeanos paseando por la ronda y la avenida del puerto (más cuanto más grande es la ciudad). */
  #syncVillagers() {
    const n = Math.min(26, 4 + 2 * this.game.level('ayuntamiento'));
    if (n === this.villagers.length) return;
    for (const v of this.villagers) this.lifeGroup.remove(v);
    this.villagers = [];
    const rand = rng(1234);
    for (let i = 0; i < n; i++) {
      const v = createVillager(i);
      const avenue = i % 3 === 0;
      v.userData.walk = avenue
        ? { avenue, s: 4 + rand() * 13, dir: rand() < 0.5 ? 1 : -1, speed: 0.5 + rand() * 0.4, lane: (rand() - 0.5) * 0.8 }
        : { avenue, a: rand() * Math.PI * 2, dir: rand() < 0.5 ? 1 : -1, speed: 0.45 + rand() * 0.45, lane: rand() < 0.5 ? -0.22 : 0.22 };
      this.lifeGroup.add(v);
      this.villagers.push(v);
    }
  }

  #updateLife(dt, t) {
    const gate = THREE.MathUtils.degToRad(GATE_ANGLE);
    this.villagers.forEach((v, i) => {
      const w = v.userData.walk;
      const bob = Math.abs(Math.sin(t * 9 + i)) * 0.04;
      if (w.avenue) {
        w.s += w.dir * w.speed * dt;
        if (w.s > 17.4 || w.s < 3.8) w.dir *= -1;
        v.position.set(Math.sin(gate) * w.s + Math.cos(gate) * w.lane, bob, Math.cos(gate) * w.s - Math.sin(gate) * w.lane);
        v.rotation.y = gate + (w.dir > 0 ? 0 : Math.PI);
      } else {
        w.a += (w.dir * w.speed * dt) / ROAD_R;
        const r = ROAD_R + w.lane;
        v.position.set(Math.sin(w.a) * r, bob, Math.cos(w.a) * r);
        v.rotation.y = w.a + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    });
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
    this.#syncVillagers();
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
      const key = `${level}|${building}`;
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
    const gaps = [{ a: GATE_ANGLE, w: 9 }, ...OUTER.map((id) => ({ a: LAYOUT[id].angle, w: 4.5 }))];
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
      const look = islandLook(view);
      if (entry.look !== look) {
        entry.look = look;
        if (entry.feature) {
          entry.group.remove(entry.feature);
          disposeTree(entry.feature);
        }
        entry.feature = createIslandFeature(entry.isl, look);
        entry.group.add(entry.feature);
      }
      const t = ISLAND_TYPES[entry.isl.type];
      let status = !view.explored ? '❔ Inexplorada' : `${t.icon} ${t.name}`;
      if (view.colonized) status = '🚩 Tu colonia';
      if (view.explored && view.tier && !view.colonized) status += ` · Nv ${view.tier}`;
      if (view.inbound.length) status += ' · ⛵';
      entry.el.querySelector('.label-lvl').textContent = status;
      entry.el.classList.toggle('colony', view.colonized);
      entry.el.classList.toggle('unknown', !view.explored);
    }
  }

  #routeTo(target) {
    const entry = this.islands[target];
    const a0 = GATE_ANGLE;
    const a1 = entry.isl.angle;
    let delta = ((a1 - a0 + 540) % 360) - 180;
    const points = [polar(26, a0), polar(HARBOR_R, a0)];
    const steps = Math.ceil(Math.abs(delta) / 15);
    for (let i = 1; i <= steps; i++) points.push(polar(HARBOR_R, a0 + (delta * i) / steps));
    points.push(polar(entry.isl.dist - entry.radius * 1.35 - 2, a1));
    return new Route(points);
  }

  #syncFleets() {
    const missions = this.game.missions;
    const alive = new Set(missions.map((m) => m.id));
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
        if (d.spin || d.swing || d.wave || d.smoke || d.flicker || d.bob || d.wiggle) this.animated.push(o);
      });
    for (const slot of Object.values(this.slots)) {
      collect(slot.building);
      collect(slot.scaffold);
    }
    for (const isl of Object.values(this.islands)) collect(isl.feature);
    for (const f of this.fleets.values()) collect(f.group);
    collect(this.raidGroup);
  }

  // ── Bucle ─────────────────────────────────────────────────────────────────

  update(dt, t) {
    const now = Date.now();

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
    this.#updateSky(now);
    this.#updateLife(dt, t);

    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > cloud.userData.span) cloud.position.x = -cloud.userData.span;
    }

    for (const o of this.animated) {
      const { spin, swing, wave, smoke, flicker, bob, wiggle } = o.userData;
      if (spin) o.rotation[spin.axis] += spin.speed * dt;
      if (swing) o.rotation.y = Math.sin(t * swing.speed) * swing.amp;
      if (wave) o.rotation.y = Math.sin(t * 3) * 0.3;
      if (flicker) o.scale.set(1, 1 + Math.sin(t * 13 + o.id) * 0.18, 1);
      if (bob) {
        o.position.y = bob.base + Math.sin(t * bob.speed + o.id) * bob.amp;
        o.rotation.z = Math.sin(t * bob.speed * 0.8 + o.id) * 0.05;
      }
      if (wiggle) o.rotation.z = wiggle.base + Math.sin(t * wiggle.speed + wiggle.phase) * wiggle.amp;
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
      if (m.phase === 'ida') {
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

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}

