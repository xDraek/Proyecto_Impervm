import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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
  column,
  cyl,
  cypress,
  dome,
  olive,
  statue,
  stylobate,
  WINDOW_GLOW,
  disposeTree,
  fishingPier,
  smokeColumn,
  gableRoof,
  hipRoof,
  mat,
  mediterraneanTree,
  palmTree,
  mesh,
  wallHeight,
  windowMaterial,
} from './models.js';
import { createIslandBase, createIslandFeature, islandExtent, islandLook, islandRadius, ownerColor, shoreRadius } from './islands.js';
import { escapeHtml } from '../ui/format.js';
import { Batch, bakeStatic, hashString, mountainGeometry, paintByNormal, plateauGeometry, polar, rng, surfaceDetail } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWater, setShores } from './water.js';
import { coastFactor, coastMax, islandCoast, shapeGeometry } from './coast.js';
import { clock } from '../config.js';
import { setGulls, setRain, thunder } from '../audio.js';

const HORIZON = '#cfe8f7';
const WATER_Y = -0.7;
const ISLAND_R = 32.5; // radio medio de la costa de tu isla (la forma real la da this.coast)
const COAST_MIN = 27.5; // nunca menos: los edificios de fuera tienen que caber
const BEACH_Y = -0.5;
const ROAD_R = 13.4;
const WALL_R = 15.0;
const GATE_ANGLE = 15;
const RAID_FROM = 280;
const TAU = Math.PI * 2;
// Avenida del puerto: carriles para los carros en el centro y una acera a cada lado. Los carros dan
// la vuelta junto a la plaza y junto a la playa; la gente, un poco antes, para no cruzarse nunca
// con el círculo que barre un carro al girar.
const AVENUE_W = 3.2;
// Las calles van empedradas con losas de caliza: la gente y los carros pisan por encima
const PAVE_Y = 0.035;
const FLAGSTONES = ['#e2d8c2', '#d9cdb3', '#ebe3d0', '#d2c5a8', '#e6dcc8', '#dcd0b6'];
const KERBS = ['#e9e0cc', '#ddd2bb', '#e4dac4'];
// Tierra y hierba seca entre las losas
const JOINTS = '#a89676';
const AVENUE_IN = 6.2;
const CART_TURN_R = 1.75;
// Lo que tarda en virar en redondo un pesquero
const BOAT_TURN = 3.2;

// Ciclo de día y noche (un día dura 20 minutos reales)
const DAY_MS = 20 * 60 * 1000;
const SKIES = {
  day: { top: '#4a93d6', horizon: '#c4dff0', sun: '#ffeed2', sunI: 2.15, hemi: '#d6e9f7', hemiI: 1.05 },
  dusk: { top: '#3d5b9c', horizon: '#f4b27c', sun: '#ffb070', sunI: 1.5, hemi: '#f0c8a8', hemiI: 0.95 },
  night: { top: '#0c1733', horizon: '#2b3d6b', sun: '#9fb6ff', sunI: 0.55, hemi: '#6b7fae', hemiI: 0.6 },
};

// Disposición de la isla. Ángulo 0 = hacia +Z (la cámara mira desde unos 36°).
const LAYOUT = {
  ayuntamiento: { r: 0, angle: 0 },
  academia: { r: 9.6, angle: 45 },
  almacen: { r: 9.6, angle: 100 },
  templo: { r: 9.6, angle: 155 },
  cuartel: { r: 9.6, angle: 210 },
  mercado: { r: 9.6, angle: 265 },
  taberna: { r: 9.6, angle: 320 },
  granja: { r: 22, angle: 60 },
  aserradero: { r: 22, angle: 100 },
  forja: { r: 22, angle: 140 },
  // La cantera y la mina, al pie de su monte (#layoutFor las arrima a él)
  cantera: { foot: true, angle: 178 },
  mina: { foot: true, angle: 216 },
  fundicion: { r: 22, angle: 254 },
  torre: { r: 22, angle: 292 },
  coloso: { r: 22, angle: 330, ring: 1.15 },
  // Los de la costa se colocan según la orilla real (#layoutFor)
  astillero: { coast: -2.6, angle: 40, hit: 3.0 },
  faro: { coast: -2.0, angle: 352 },
  muralla: { r: WALL_R, angle: GATE_ANGLE, hit: 2.8, ring: 0.95 },
  puerto: { coast: 1.4, angle: GATE_ANGLE, y: BEACH_Y, hit: 3.2, hitZ: -2.6 },
};
const INNER = ['academia', 'almacen', 'templo', 'cuartel', 'mercado', 'taberna'];
const OUTER = ['granja', 'aserradero', 'forja', 'cantera', 'mina', 'fundicion', 'torre', 'coloso'];
const COAST = ['astillero', 'faro'];
// Sierra junto a la costa, a `inset` de la orilla. La cantera y la mina están excavadas en la
// falda de su monte (`behind`): la cantera es un tajo en la roca y la mina, una galería.
const MOUNTAINS = [
  { angle: 178, inset: 2.4, radius: 4.6, height: 7.6, behind: 'cantera' },
  { angle: 197, inset: 2.6, radius: 4.4, height: 9.4 },
  { angle: 216, inset: 2.4, radius: 4.5, height: 8.0, behind: 'mina' },
  { angle: 160, inset: 1.2, radius: 2.6, height: 4.4 },
  { angle: 236, inset: 1.4, radius: 2.6, height: 4.2 },
];
const VIEWS = {
  isla: { offset: new THREE.Vector3(44, 48, 64), min: 16, max: 150 },
  mapa: { offset: new THREE.Vector3(0, 420, 250), min: 60, max: 900 },
};
const SHIP_PRIORITY = ['dromon', 'galeon', 'liburna', 'trirreme', 'brulote', 'mercante', 'bote'];

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
    // Tu isla no es un círculo: su costa sale de su identificador (la ven igual los demás jugadores)
    this.homeCoast = islandCoast(game.homeIsland ?? { id: 'escaparate', type: 'jugador' });
    this.coastMaxR = ISLAND_R * coastMax(this.homeCoast);
    this.harborR = this.coastMaxR + 9;
    this.layout = this.#layoutFor();
    this.mountains = MOUNTAINS.map((m) => ({ ...m, r: this.coast(m.angle) - m.inset }));
    this.onSelect = onSelect;
    this.showcase = showcase;
    this.slots = {};
    this.islands = {};
    this.fleets = new Map();
    this.selected = null;
    this.hovered = null;
    // Edificio señalado en la lista de la izquierda (como si tuviera el ratón encima)
    this.listHover = null;
    // Letreros de los edificios: solo los que importan (o todos, con la opción o con Alt pulsado)
    this.labelsAlways = false;
    this.altLabels = false;
    this.animated = [];
    this.clouds = [];
    this.view = 'isla';
    this.dayNight = true;
    this.villagers = [];
    this.gulls = [];
    this.carts = [];
    this.boats = [];
    this.dolphins = [];
    // Ovejas del prado de la granja (pastan, levantan la cabeza y dan unos pasos)
    this.flock = [];
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
      this.controls.enablePan = false;
      for (const slot of Object.values(this.slots)) slot.label.visible = false;
    }
  }

  /** Radio de la costa de tu isla en la dirección `deg` (grados, 0 hacia +Z). */
  coast(deg) {
    return Math.max(COAST_MIN, ISLAND_R * coastFactor(this.homeCoast, THREE.MathUtils.degToRad(deg)));
  }

  /** La disposición de los edificios, con los de la costa puestos en la orilla real. */
  #layoutFor() {
    const out = {};
    for (const [id, l] of Object.entries(LAYOUT)) {
      if (l.coast != null) out[id] = { ...l, r: this.coast(l.angle) + l.coast };
      else if (l.foot) {
        // Con la espalda metida en la falda del monte
        const m = MOUNTAINS.find((x) => x.behind === id);
        out[id] = { ...l, r: this.coast(m.angle) - m.inset - m.radius * 0.72 - 1.3 };
      } else out[id] = { ...l };
    }
    return out;
  }

  /** Lo que el agua necesita de la orilla de tu isla (para la espuma). */
  #homeShore() {
    return { x: 0, z: 0, r: ISLAND_R + 2.7, h: this.homeCoast };
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
    r.toneMappingExposure = 1.0;
    this.container.appendChild(r.domElement);
    this.renderer = r;

    this.labelRenderer = new CSS2DRenderer();
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    this.container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 3000);
    this.camera.position.copy(VIEWS.isla.offset);

    // Como en los juegos de ciudades: arrastrar mueve la vista, el botón derecho (o Mayús + arrastrar)
    // la gira y la rueda acerca hacia donde apunta el ratón. En el móvil, un dedo mueve y dos acercan y giran.
    const controls = new OrbitControls(this.camera, r.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.zoomToCursor = true;
    controls.zoomSpeed = 1.15;
    controls.rotateSpeed = 0.6;
    controls.minDistance = VIEWS.isla.min;
    controls.maxDistance = VIEWS.isla.max;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = 1.32;
    controls.target.set(0, 0, 0);
    // Si el jugador mueve la cámara, deja de seguir lo seleccionado
    controls.addEventListener('start', () => {
      this.focusTarget = null;
      this.nudge = null;
    });
    this.controls = controls;
    this.keys = new Set();

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = this.container;
      if (!w || !h) return;
      r.setSize(w, h);
      this.labelRenderer.setSize(w, h);
      this.composer?.setSize(w, h);
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
    Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 170 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2.5; // bordes de sombra suaves
    scene.add(sun, sun.target);
    this.skyKey = null;
    this.#updateSky(clock.now());

    // Mar estilizado: olas en la GPU, agua clara y espuma junto a cada orilla
    this.water = createWater([this.#homeShore()], WATER_Y);
    this.waterTime = this.water.userData.uniforms.uTime;
    scene.add(this.water);
  }

  /**
   * Calidad gráfica. Alta: resplandor en fuegos, ventanas y faros, bordes suaves (MSAA),
   * sombras de más resolución y más píxeles. Baja: lo justo, para móviles y equipos modestos.
   */
  setQuality(high) {
    this.high = !!high;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.high ? 2 : 1.25));
    const size = this.high ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.high && !this.composer) {
      const { clientWidth: w, clientHeight: h } = this.container;
      const target = new THREE.WebGLRenderTarget(w || 1, h || 1, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(r, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      // Solo brilla lo que emite luz (fuegos, ventanas de noche, faros, chispas) y algún destello del sol
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2 || 1, h / 2 || 1), 0.32, 0.45, 0.92);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    }
    if (this.composer) {
      this.composer.setPixelRatio(r.getPixelRatio());
      this.composer.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1);
    }
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

  /**
   * Empedrado de las calles, la ronda y la avenida: losas de caliza irregulares con juntas de
   * tierra y un bordillo de bloques a cada lado (abierto en los cruces). Todo en una sola malla.
   */
  #paving() {
    const batch = new Batch();
    const rand = rng(53);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const piece = (w, h, d, color, x, z, rot) => {
      const m = box(w, h, d, color, 0, 0, 0);
      m.position.set(x, 0.005 + h / 2, z);
      m.rotation.y = rot;
      batch.add(m);
    };
    // Un tramo recto: `u` a lo largo (radial), `v` a lo ancho
    const strip = (deg, from, to, width) => {
      const a = THREE.MathUtils.degToRad(deg);
      const at = (u, v) => [Math.sin(a) * u + Math.cos(a) * v, Math.cos(a) * u - Math.sin(a) * v];
      const kerb = 0.13;
      const inner = width - 2 * kerb - 0.04;
      for (let u = from; u < to - 0.1; ) {
        const d = Math.min(to - u, 0.3 + rand() * 0.16);
        for (let v = -inner / 2; v < inner / 2 - 0.08; ) {
          const w = Math.min(inner / 2 - v, 0.28 + rand() * 0.26);
          const [x, z] = at(u + d / 2, v + w / 2);
          piece(w - 0.045, 0.028 + rand() * 0.01, d - 0.045, pick(FLAGSTONES), x, z, a + (rand() - 0.5) * 0.06);
          v += w;
        }
        u += d;
      }
      // Bordillos: bloques largos, algo más altos que las losas
      for (const side of [-1, 1]) {
        for (let u = from; u < to - 0.15; ) {
          const d = Math.min(to - u, 0.45 + rand() * 0.35);
          const [x, z] = at(u + d / 2, side * (width / 2 - kerb / 2));
          piece(kerb, 0.07, d - 0.03, pick(KERBS), x, z, a);
          u += d;
        }
      }
    };
    for (const rd of this.roads) {
      // Las calles de fuera arrancan de la ronda (que ya va empedrada)
      const from = Math.abs(rd.from - ROAD_R) < 0.01 ? ROAD_R + 0.45 : rd.from;
      strip(rd.deg, Math.max(from, 3.4), rd.to, rd.width);
    }
    // La ronda: losas en dos filas y bordillos, abiertos donde la cruzan las calles
    const crossing = (deg, outer) =>
      this.roads.some((rd) => {
        const reaches = outer ? rd.to > ROAD_R : rd.from < ROAD_R && rd.to > ROAD_R;
        const gap = THREE.MathUtils.radToDeg((rd.width / 2 + 0.25) / ROAD_R);
        return reaches && Math.abs(((deg - rd.deg + 540) % 360) - 180) < gap;
      });
    const avenue = this.roads.find((rd) => rd.width === AVENUE_W);
    const onAvenue = (deg) => avenue && Math.abs(((deg - avenue.deg + 540) % 360) - 180) < THREE.MathUtils.radToDeg(avenue.width / 2 / ROAD_R);
    // Cada fila con sus propias juntas, a matajunta
    for (const r of [ROAD_R - 0.155, ROAD_R + 0.155]) {
      for (let deg = rand() * 2; deg < 360; ) {
        const step = THREE.MathUtils.radToDeg((0.28 + rand() * 0.24) / r);
        const mid = deg + step / 2;
        const a = THREE.MathUtils.degToRad(mid);
        if (!onAvenue(mid)) piece(step * (Math.PI / 180) * r - 0.045, 0.028 + rand() * 0.01, 0.26, pick(FLAGSTONES), Math.sin(a) * r, Math.cos(a) * r, a + (rand() - 0.5) * 0.04);
        deg += step;
      }
    }
    for (const [r, outer] of [[ROAD_R - 0.385, false], [ROAD_R + 0.385, true]]) {
      for (let deg = 0; deg < 360; ) {
        const step = THREE.MathUtils.radToDeg((0.45 + rand() * 0.35) / r);
        const mid = deg + step / 2;
        if (!crossing(mid, outer)) {
          const a = THREE.MathUtils.degToRad(mid);
          piece(step * (Math.PI / 180) * r - 0.03, 0.07, 0.13, pick(KERBS), Math.sin(a) * r, Math.cos(a) * r, a);
        }
        deg += step;
      }
    }
    const mesh = batch.build({ shadows: false });
    mesh.traverse((o) => (o.receiveShadow = true));
    return mesh;
  }

  #buildIsland() {
    const scene = this.scene;

    // Meseta de hierba con acantilados
    // La misma forma que this.coast (con su mínimo), como factor sobre el radio medio
    const shape = (theta) => this.coast(THREE.MathUtils.radToDeg(theta)) / ISLAND_R;
    const geo = shapeGeometry(plateauGeometry(ISLAND_R, ISLAND_R - 1.6, 2.2, 96, 0, 0), shape);
    // Junto a la avenida, el borde exacto (sin las irregularidades del acantilado): así la rampa
    // baja justo hasta la playa y el puerto
    const gatePos = geo.attributes.position;
    const gateTheta = THREE.MathUtils.degToRad(GATE_ANGLE);
    for (let i = 0; i < gatePos.count; i++) {
      const x = gatePos.getX(i);
      const z = gatePos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1) continue;
      const th = Math.atan2(x, z);
      if (Math.abs(((th - gateTheta + 3 * Math.PI) % TAU) - Math.PI) * r > AVENUE_W / 2 + 3) continue;
      const edge = shape(th) * (ISLAND_R - 1.6 * Math.min(1, -gatePos.getY(i) / 2.2));
      gatePos.setXYZ(i, Math.sin(th) * edge, gatePos.getY(i), Math.cos(th) * edge);
    }
    geo.computeVertexNormals();
    paintByNormal(geo, (ny, cy) => (ny > 0.7 ? '#86ab4e' : cy > -0.8 ? '#a17f55' : '#8c8070'));
    const island = new THREE.Mesh(geo, surfaceDetail(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), 'ground', { masonry: false }));
    island.receiveShadow = true;
    island.castShadow = true;
    scene.add(island);

    const sand = new THREE.Mesh(shapeGeometry(new THREE.CylinderGeometry(ISLAND_R + 2.5, ISLAND_R + 4.2, 1.6, 96).toNonIndexed(), shape), mat('#e8d49a'));
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
      const path = box(width, 0.02, to - from, JOINTS, mid.x, 0, mid.z);
      path.rotation.y = THREE.MathUtils.degToRad(deg);
      path.castShadow = false;
      scene.add(path);
      this.roads.push({ deg, from, to, width });
    };
    const L = this.layout;
    const gateCoast = this.coast(GATE_ANGLE);
    for (const id of INNER) road(L[id].angle, 3.2, L[id].r - 2.2);
    for (const id of [...OUTER, ...COAST]) road(L[id].angle, ROAD_R, L[id].r - 2.2);
    road(GATE_ANGLE, 3.2, gateCoast - 0.9, AVENUE_W);
    const ringGeo = new THREE.RingGeometry(ROAD_R - 0.45, ROAD_R + 0.45, 72);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, mat(JOINTS));
    ring.position.y = 0.02;
    ring.receiveShadow = true;
    scene.add(ring);
    scene.add(this.#paving());
    // Rampa de la avenida hasta la playa
    const rampLen = 2.6;
    const rampMid = polar(gateCoast - 0.9 + rampLen / 2 - 0.1, GATE_ANGLE, -0.22);
    const ramp = box(AVENUE_W, 0.08, rampLen, '#d9cdb3', 0, 0, 0);
    ramp.position.copy(rampMid);
    ramp.rotation.set(Math.atan2(0.5, rampLen), THREE.MathUtils.degToRad(GATE_ANGLE), 0, 'YXZ');
    scene.add(ramp);

    // Montañas detrás de la cantera y la mina (el monte de la cantera es de mármol)
    for (const m of this.mountains) {
      const rock = m.behind === 'cantera' ? '#d8d1c2' : '#8c8780';
      const mountain = new THREE.Mesh(
        mountainGeometry(m.radius, m.height, m.angle, { snow: '#f4f6f8', grass: '#7d9a52', rock }),
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
      ...Object.entries(L)
        .filter(([id]) => id !== 'ayuntamiento' && id !== 'puerto' && id !== 'muralla')
        .map(([, l]) => ({ p: polar(l.r, l.angle), r: 2.8 })),
      ...this.mountains.map((m) => ({ p: polar(m.r, m.angle), r: m.radius + 0.6 })),
    ];
    const coastAt = (p) => this.coast(THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z)));
    // Un punto al azar en tierra, entre `from` del centro y `margin` antes de la orilla (repartido por área)
    const inland = (from, margin) => {
      const deg = rand() * 360;
      const to = this.coast(deg) - margin;
      return polar(from + Math.sqrt(rand()) * Math.max(0, to - from), deg);
    };
    /**
     * ¿Cabe aquí algo de radio `size`? Lejos de la orilla, la muralla, las calles (`pad` de margen)
     * y de lo que ya hay. Los árboles son «blandos»: se pueden tocar entre ellos y con las matas.
     */
    // Zonas enteras donde no va nada más (ni hierba): los campos de la granja
    const zones = [];
    // La explanada del astillero, que llega hasta la playa: sin hierba ni árboles encima
    {
      const c = polar(L.astillero.r, L.astillero.angle);
      const rot = Math.atan2(-c.x, -c.z);
      zones.push((q, margin) => {
        const dx = q.x - c.x;
        const dz = q.z - c.z;
        const x = dx * Math.cos(rot) - dz * Math.sin(rot);
        const z = dx * Math.sin(rot) + dz * Math.cos(rot);
        return Math.abs(x) < 4.5 + margin && z > -2.4 - margin && z < 2.3 + margin;
      });
    }
    const free = (p, pad = 0.7, size = 0) => {
      const r = Math.hypot(p.x, p.z);
      if (r + size > coastAt(p) - 1.3) return false;
      if (zones.some((inZone) => inZone(p, size + 0.15))) return false;
      if (r + size > ROAD_R - 1.0 && r - size < WALL_R + 0.9) return false;
      for (const rd of this.roads) {
        const a = THREE.MathUtils.degToRad(rd.deg);
        const along = p.x * Math.sin(a) + p.z * Math.cos(a);
        const across = Math.abs(p.x * Math.cos(a) - p.z * Math.sin(a));
        if (along > rd.from - 0.5 - size && along < rd.to + 0.5 + size && across < rd.width / 2 + pad + size) return false;
      }
      return blockers.every((b) => b.p.distanceTo(p) > b.r + (b.soft ? 0 : size));
    };
    // La hierba crece en todo lo que no sea edificio, calle, muralla o montaña (también bajo los árboles)
    const fixed = blockers.slice();
    const lawn = (p) => {
      if (zones.some((inZone) => inZone(p, 0.05))) return false;
      const r = Math.hypot(p.x, p.z);
      if (r > coastAt(p) - 0.9 || (r > ROAD_R - 0.9 && r < WALL_R + 0.8)) return false;
      for (const rd of this.roads) {
        const a = THREE.MathUtils.degToRad(rd.deg);
        const along = p.x * Math.sin(a) + p.z * Math.cos(a);
        const across = Math.abs(p.x * Math.cos(a) - p.z * Math.sin(a));
        if (along > rd.from - 0.3 && along < rd.to + 0.3 && across < rd.width / 2 + 0.12) return false;
      }
      return fixed.every((b) => b.p.distanceTo(p) > b.r * 0.9);
    };
    // Todo lo que no se mueve va junto en una sola malla: se pueden poner muchos más detalles
    const decor = new Batch(windowMaterial());
    const place = (obj, p, rotY = 0, scale = 1) => {
      obj.position.copy(p);
      obj.rotation.y = rotY;
      obj.scale.setScalar(scale);
      decor.add(obj);
    };

    // Campos de cultivo agrupados en la pradera de detrás de la granja: un mosaico de parcelas
    // pegadas unas a otras (trigo, cebada, hortalizas, barbecho y amapolas en las lindes) sin hierba
    // ni árboles por medio, una cerca de piedra seca alrededor, almiares y un espantapájaros
    const farm = L.granja;
    const farmPos = polar(farm.r, farm.angle);
    const farmRot = Math.atan2(-farmPos.x, -farmPos.z);
    // De las coordenadas de la granja (z negativa: hacia fuera de la ciudad) a las de la isla
    const fromFarm = (x, z) =>
      new THREE.Vector3(farmPos.x + x * Math.cos(farmRot) + z * Math.sin(farmRot), 0, farmPos.z - x * Math.sin(farmRot) + z * Math.cos(farmRot));
    const fieldRand = rng(91);
    const CROPS = [
      { kind: 'trigo', colors: ['#e3c25a', '#d9b44a', '#ecd06a'], h: 0.24 },
      { kind: 'cebada', colors: ['#cdbf6a', '#c2b55e', '#d6c977'], h: 0.2 },
      { kind: 'huerta', colors: ['#5f9a3a', '#6fae4a', '#4f8a32'], h: 0.14 },
      { kind: 'trigo', colors: ['#e3c25a', '#d9b44a', '#ecd06a'], h: 0.24 },
      { kind: 'barbecho', colors: ['#6e4f2c', '#7a5a34'], h: 0.06 },
      { kind: 'verde', colors: ['#8fbf4a', '#86b544', '#9ac955'], h: 0.16 },
    ];
    const plots = [];
    const FW = 1.6;
    const FD = 1.3;
    // Lo que ocupa todo el mosaico, en coordenadas de la granja
    const area = { x0: -2.5 * FW, x1: 2.5 * FW, z0: -(3.35 + 2.5 * FD), z1: -(3.35 - 0.5 * FD) };
    const toFarm = (q) => {
      const dx = q.x - farmPos.x;
      const dz = q.z - farmPos.z;
      return { x: dx * Math.cos(farmRot) - dz * Math.sin(farmRot), z: dx * Math.sin(farmRot) + dz * Math.cos(farmRot) };
    };
    for (let ring = 0; ring < 3; ring++) {
      for (let k = -2; k <= 2; k++) {
        const x = k * FW;
        const z = -(3.35 + ring * FD);
        const p = fromFarm(x, z);
        // Detrás de la granja es su sitio: solo se salta una parcela si se sale a la playa o pisa un monte
        const offIsland = Math.hypot(p.x, p.z) + 0.9 > coastAt(p) - 1.3;
        if (offIsland || this.mountains.some((m) => polar(m.r, m.angle).distanceTo(p) < m.radius + 1.4)) continue;
        plots.push({ x, z, p });
        const crop = CROPS[Math.floor(fieldRand() * CROPS.length)];
        const w = FW;
        const d = FD;
        const field = new THREE.Group();
        field.add(box(w, 0.06, d, '#7a5a34'));
        const rows = crop.kind === 'huerta' ? 4 : 6;
        for (let row = 0; row < rows; row++) {
          const rz = -d / 2 + 0.12 + (row * (d - 0.24)) / (rows - 1);
          if (crop.kind === 'huerta') {
            // Hileras de coles y lechugas
            for (let c = 0; c < 7; c++) {
              const head = mesh(new THREE.DodecahedronGeometry(0.08 + fieldRand() * 0.03), crop.colors[(row + c) % 3]);
              head.position.set(-w / 2 + 0.14 + c * ((w - 0.28) / 6), 0.1, rz);
              head.scale.y = 0.75;
              field.add(head);
            }
          } else if (crop.kind === 'barbecho') {
            field.add(box(w - 0.08, 0.05, 0.08, crop.colors[row % 2], 0, 0.06, rz));
          } else {
            field.add(box(w - 0.1, crop.h * (0.85 + fieldRand() * 0.3), 0.13, crop.colors[row % 3], 0, 0.06, rz));
          }
        }
        // Amapolas en alguna linde
        if (crop.kind === 'trigo' && fieldRand() < 0.6) {
          for (let f = 0; f < 6; f++) {
            const poppy = mesh(new THREE.DodecahedronGeometry(0.035), '#d23a2a');
            poppy.position.set(-w / 2 + fieldRand() * w, 0.12, d / 2 - 0.03);
            field.add(poppy);
          }
        }
        place(field, p.clone().setY(0.01), farmRot);
      }
    }
    // Todo el mosaico (y la cerca) queda libre de hierba, árboles, casas y piedras
    zones.push((q, margin) => {
      const f = toFarm(q);
      return f.x > area.x0 - 0.45 - margin && f.x < area.x1 + 0.45 + margin && f.z > area.z0 - 0.45 - margin && f.z < area.z1 + 0.4 + margin;
    });
    // Cerca de piedra seca alrededor del mosaico (con su entrada por el camino)
    if (plots.length) {
      const xs = plots.map((f) => f.x);
      const zs = plots.map((f) => f.z);
      const x0 = Math.min(...xs) - FW / 2 - 0.22;
      const x1 = Math.max(...xs) + FW / 2 + 0.22;
      const z0 = Math.min(...zs) - FD / 2 - 0.22;
      const z1 = Math.max(...zs) + FD / 2 + 0.22;
      const wall = (ax, az, bx, bz) => {
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.5));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const q = fromFarm(ax + (bx - ax) * t, az + (bz - az) * t);
          const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2), mat(i % 3 ? C.stone : C.stoneDark));
          stone.position.set(q.x, 0.08, q.z);
          stone.scale.set(1.4, 0.75, 1.0);
          stone.rotation.y = fieldRand() * Math.PI;
          decor.add(stone);
        }
      };
      wall(x0, z0, x1, z0);
      wall(x0, z0, x0, z1);
      wall(x1, z0, x1, z1);
      // Por delante (hacia la casa) la cerca deja paso al camino
      wall(x0, z1, -0.6, z1);
      wall(0.3, z1, x1, z1);
      // Almiares en la linde y un espantapájaros en un trigal
      for (const [hx, hz] of [[x1 + 1.05, z0 + 0.6], [x1 + 1.1, z0 + 1.45]]) {
        const q = fromFarm(hx, hz);
        if (!free(q, 0.2, 0.35)) continue;
        blockers.push({ p: q, r: 0.4 });
        const stack = new THREE.Group();
        stack.add(cyl(0.28, 0.32, 0.34, 9, '#d9b45a'));
        const top = mesh(new THREE.ConeGeometry(0.3, 0.42, 9), '#cfa84e');
        top.position.y = 0.55;
        stack.add(top);
        place(stack, q);
      }
      const mid = plots[Math.floor(plots.length / 2)];
      const crow = new THREE.Group();
      crow.add(box(0.04, 0.75, 0.04, C.woodDark), box(0.5, 0.04, 0.04, C.woodDark, 0, 0.55, 0));
      crow.add(box(0.2, 0.26, 0.1, '#8a5a3a', 0, 0.42, 0));
      const hat = mesh(new THREE.ConeGeometry(0.13, 0.12, 7), '#c9a65a');
      hat.position.y = 0.82;
      crow.add(hat);
      place(crow, mid.p.clone().setY(0.05), farmRot);
    }

    // Barrios: las casas van apareciendo al subir el ayuntamiento (primero dentro de la muralla)
    this.houseSpots = [];
    for (let tries = 0; tries < 2500 && this.houseSpots.length < 70; tries++) {
      const inside = tries % 3 !== 2;
      const p = inside
        ? polar(4.7 + rand() * (ROAD_R - 6.0), rand() * 360)
        : inland(WALL_R + 1.4, 3.2);
      if (!free(p, 0.75, 0.95)) continue;
      blockers.push({ p, r: 1.0 });
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

    // El rebaño, en el prado de la granja (donde no hay casas ni campos)
    for (let i = 0; i < 60 && this.flock.length < 10; i++) {
      const p = polar(farm.r + 2.2 + rand() * 4.5, farm.angle + 20 + rand() * 26);
      // Cada una pasta en su corro: se mueve un poco alrededor de donde está
      if (!free(p, 0.3, 0.55)) continue;
      blockers.push({ p, r: 0.55 });
      const s = sheep();
      s.position.copy(p);
      s.rotation.y = rand() * Math.PI * 2;
      s.scale.setScalar(0.95 + rand() * 0.3);
      s.userData.graze = { home: p.clone(), state: 'pace', t: rand() * 6, speed: 0, phase: rand() * 10 };
      scene.add(s);
      this.flock.push(s);
    }

    // Pebeteros de mármol a los lados de la avenida del puerto (arden de noche)
    const gate = THREE.MathUtils.degToRad(GATE_ANGLE);
    for (let d = AVENUE_IN + 0.8; d < gateCoast - 3.4; d += 3.1) {
      if (Math.abs(d - WALL_R) < 1.4 || Math.abs(d - ROAD_R) < 1.2) continue;
      for (const side of [-1, 1]) {
        const p = new THREE.Vector3(Math.sin(gate) * d + Math.cos(gate) * side * 2.05, 0, Math.cos(gate) * d - Math.sin(gate) * side * 2.05);
        const lamp = new THREE.Group();
        lamp.add(box(0.26, 0.12, 0.26, C.marbleDark), cyl(0.07, 0.09, 1.2, 8, C.marble, 0, 0.12, 0), box(0.2, 0.06, 0.2, C.marble, 0, 1.32, 0));
        lamp.add(cyl(0.2, 0.09, 0.16, 8, '#8a6a3a', 0, 1.38, 0, { metalness: 0.5, roughness: 0.45 }), cyl(0.15, 0.15, 0.04, 8, C.dark, 0, 1.52, 0, WINDOW_GLOW));
        place(lamp, p);
        blockers.push({ p, r: 0.3 });
      }
    }

    // ── Campiña: avenida de cipreses, estatuas en la puerta, viñedo, olivar y santuarios ──
    const reserve = (p, r) => {
      blockers.push({ p, r });
      fixed.push({ p, r });
    };
    const gateRad = THREE.MathUtils.degToRad(GATE_ANGLE);
    const onAvenue = (d, side) => new THREE.Vector3(Math.sin(gateRad) * d + Math.cos(gateRad) * side, 0, Math.cos(gateRad) * d - Math.sin(gateRad) * side);
    for (let d = WALL_R + 3.2; d < gateCoast - 2; d += 2.3) {
      for (const side of [-2.95, 2.95]) {
        const p = onAvenue(d, side);
        if (!free(p, 0, 0.45)) continue;
        place(cypress('#2f5e34'), p, 0, 0.5 + rand() * 0.12);
        reserve(p, 0.45);
      }
    }
    for (const side of [-3.15, 3.15]) {
      const p = onAvenue(WALL_R + 1.5, side);
      if (!free(p, 0, 0.4)) continue;
      place(statue(0, 0, C.marble, 0.95), p, gateRad + Math.PI);
      reserve(p, 0.4);
    }
    // Un círculo libre de radio `r` fuera de la muralla, sin casas, campos ni calles dentro (o null)
    const patch = (r) => {
      for (let i = 0; i < 200; i++) {
        const p = inland(WALL_R + 2 + r, r + 1.2);
        if (free(p, 0.2, r)) return p;
      }
      return null;
    };
    // Viñedo: hileras de cepas con racimos
    const vineyard = patch(4.6);
    if (vineyard) {
      const g = new THREE.Group();
      for (let row = 0; row < 5; row++) {
        const z = -2 + row;
        g.add(box(6.3, 0.03, 0.04, '#8a6a3a', 0, 0.48, z));
        for (let k = 0; k < 7; k++) {
          const x = -3 + k;
          g.add(box(0.05, 0.55, 0.05, C.woodDark, x, 0, z));
          const leaf = mesh(new THREE.DodecahedronGeometry(0.27), k % 2 ? '#5f8f3a' : '#6f9f45');
          leaf.position.set(x + 0.5, 0.5, z);
          leaf.scale.set(1.4, 0.7, 0.8);
          g.add(leaf);
          if ((k + row) % 2 === 0) {
            const grapes = mesh(new THREE.SphereGeometry(0.08, 5, 4), '#5a2a6a');
            grapes.position.set(x + 0.6, 0.34, z + 0.12);
            g.add(grapes);
          }
        }
      }
      place(g, vineyard, rand() * Math.PI);
      reserve(vineyard, 4.6);
    }
    // Olivar: hileras de olivos
    const grove = patch(5.6);
    if (grove) {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        for (let k = 0; k < 4; k++) {
          const t = olive(i % 2 ? '#829a5c' : '#76925a');
          t.position.set(-3 + i * 2 + (rand() - 0.5) * 0.4, 0, -3 + k * 2 + (rand() - 0.5) * 0.4);
          t.scale.setScalar(0.85 + rand() * 0.3);
          t.rotation.y = rand() * Math.PI;
          g.add(t);
        }
      }
      place(g, grove, rand() * Math.PI);
      reserve(grove, 5.6);
    }
    // Santuarios: un templete redondo de columnas con su estatua
    for (let k = 0; k < 2; k++) {
      const spot = patch(2.6);
      if (!spot) continue;
      const g = new THREE.Group();
      const y0 = stylobate(g, 3.2, 3.2, 3, 0, 0, 0.12);
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2;
        g.add(column(Math.sin(ang) * 1.1, y0, Math.cos(ang) * 1.1, 1.4, 0.09));
      }
      g.add(cyl(1.35, 1.35, 0.12, 12, C.marbleDark, 0, y0 + 1.4, 0));
      g.add(dome(1.05, k ? C.roofBlue : C.roofRed, 0, y0 + 1.52, 0, 0.15));
      g.add(statue(0, 0, C.marble, 0.7));
      place(g, spot, rand() * Math.PI);
      reserve(spot, 2.6);
    }

    // Arboleda mediterránea (más densa junto al aserradero): olivos, cipreses y pinos piñoneros
    const forest = polar(this.coast(L.aserradero.angle + 8) - 3.5, L.aserradero.angle + 8);
    let trees = 0;
    for (let tries = 0; tries < 2600 && trees < 190; tries++) {
      const p = tries % 3 === 0 ? forest.clone().add(polar(rand() * 7, rand() * 360)) : inland(3.5, 1);
      // Lo que abre su copa: el pino piñonero mucho más que el olivo o el ciprés
      const kind = rand();
      const scale = 0.7 + rand() * 0.45;
      const crown = (kind >= 0.75 ? 1.3 : kind >= 0.4 ? 0.5 : 0.8) * scale;
      if (!free(p, 0.7, crown + 0.2)) continue;
      blockers.push({ p, r: crown, soft: true });
      place(mediterraneanTree(kind), p, rand() * Math.PI, scale);
      trees++;
    }
    // Arbustos y flores
    const flowers = ['#e86a8a', '#f2c94c', '#ffffff', '#b07ad9', '#f08fb0'];
    for (let i = 0, placed = 0; i < 900 && placed < 90; i++) {
      const p = inland(3, 0.5);
      if (!free(p, 0.3, 0.45)) continue;
      blockers.push({ p, r: 0.4, soft: true });
      placed++;
      const bush = new THREE.Group();
      bush.add(mesh(new THREE.DodecahedronGeometry(0.32), placed % 3 ? '#6b8f45' : '#5a7f3a'));
      bush.children[0].position.y = 0.2;
      if (placed % 2) for (let k = 0; k < 3; k++) bush.add(box(0.1, 0.1, 0.1, flowers[(placed + k) % 5], Math.sin(k * 2.1) * 0.25, 0.3, Math.cos(k * 2.1) * 0.25));
      place(bush, p, 0, 0.7 + rand() * 0.6);
    }
    // Hierba y flores por todos los prados (con su propio azar para no mover lo demás)
    this.#buildGrass(lawn);
    // Rocas
    const rockGeo = new THREE.DodecahedronGeometry(0.4);
    for (let i = 0, placed = 0; i < 600 && placed < 34; i++) {
      const p = inland(4, 1);
      if (!free(p, 0.7, 0.6)) continue;
      blockers.push({ p, r: 0.6, soft: true });
      const rock = new THREE.Mesh(rockGeo, mat(placed % 3 ? C.stone : C.stoneDark));
      rock.position.set(p.x, 0.1, p.z);
      rock.scale.set(0.6 + rand(), 0.5 + rand() * 0.5, 0.6 + rand());
      decor.add(rock);
      placed++;
    }

    // La playa: barcas varadas, redes, cabañas y embarcaderos; luego palmeras donde quede sitio
    const onBeach = [];
    const onSand = (p, r) => onBeach.push({ p, r });
    const busy = [GATE_ANGLE, L.astillero.angle, L.faro.angle];
    const nearBusy = (a, w) => busy.some((b) => Math.abs(((a - b + 540) % 360) - 180) < w);
    for (const a of [GATE_ANGLE + 52, GATE_ANGLE + 200, GATE_ANGLE + 255]) {
      if (nearBusy(a, 14)) continue;
      const hp = polar(this.coast(a) + 1.0, a, BEACH_Y);
      // La puerta y el porche miran al mar
      place(fishermansHut(), hp, THREE.MathUtils.degToRad(a));
      onSand(hp, 1.7);
    }
    // Embarcaderos de pesca con su barca amarrada
    for (const a of [GATE_ANGLE + 128, GATE_ANGLE + 300]) {
      if (nearBusy(a, 16)) continue;
      // El rellano de piedra en la orilla y el muelle ya sobre el agua
      place(fishingPier(), polar(this.coast(a) + 1.8, a, BEACH_Y + 0.12), THREE.MathUtils.degToRad(a));
      for (let d = 0; d < 6; d += 1.2) onSand(polar(this.coast(a) + 1.8 + d, a, BEACH_Y), 1.8);
    }
    // Barcas varadas con su red tendida a secar
    for (let i = 0; i < 5; i++) {
      const a = 40 + i * 62 + rand() * 20;
      const bp = polar(this.coast(a) + 2.4, a, BEACH_Y + 0.08);
      const np = polar(this.coast(a + 6) + 1.4, a + 6, BEACH_Y);
      if (nearBusy(a, 16) || onBeach.some((b) => b.p.distanceTo(bp) < b.r + 2.0 || b.p.distanceTo(np) < b.r + 0.9)) continue;
      const boat = createShip('bote');
      boat.rotation.set(0.05, THREE.MathUtils.degToRad(a) + Math.PI / 2, 0.25);
      boat.position.copy(bp);
      boat.scale.setScalar(1.7);
      decor.add(boat);
      onSand(boat.position, 2.0);
      // Red de pesca tendida a secar entre dos palos, con sus corchos, y otra amontonada al pie
      place(dryingNet(), np, THREE.MathUtils.degToRad(a));
      onSand(np, 0.9);
    }
    // Palmeras: ni encima de una barca o cabaña ni pegadas unas a otras
    for (let i = 0; i < 34; i++) {
      const a = rand() * 360;
      if (nearBusy(a, 12)) continue;
      const p = polar(this.coast(a) + 1.3 + rand() * 1.6, a, BEACH_Y);
      if (onBeach.some((b) => b.p.distanceTo(p) < b.r + 1.1)) continue;
      place(palmTree(rand), p, rand() * Math.PI, 0.85 + rand() * 0.4);
      onSand(p, 0.6);
    }
    scene.add(decor.build());

    this.wallGroup = new THREE.Group();
    scene.add(this.wallGroup);
  }

  #buildSlots() {
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.hitTargets = [];

    for (const id of BUILDING_KEYS) {
      const l = this.layout[id];
      const pos = polar(l.r, l.angle, l.y ?? 0);
      const root = new THREE.Group();
      root.position.copy(pos);
      // Que los edificios miren hacia la plaza
      if (id !== 'ayuntamiento') root.rotation.y = Math.atan2(-pos.x, -pos.z);
      this.scene.add(root);

      // La granja no tiene solar: la casa y la era están sobre la hierba
      if (id !== 'ayuntamiento' && id !== 'puerto' && id !== 'muralla' && id !== 'granja') {
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

  /**
   * Cuánto puede crecer cada isla del mapa (las neutrales hasta un 30 %, los continentes un 15 %)
   * sin pisar a ninguna vecina: si dos se acercarían demasiado, se reparten el hueco según su
   * tamaño; tu isla y las de los demás jugadores no cambian de tamaño. Entre isla e isla queda
   * siempre un canal por el que pasan los barcos, y alrededor de la tuya, un anillo de mar libre.
   */
  #growths(visible) {
    const items = visible
      .filter((isl) => !isl.land && isl.type !== 'brumas')
      .map((isl) => {
        const fixed = isl.type === 'jugador';
        const want = fixed ? 1 : isl.type === 'continente' ? 1.15 : 1.3;
        return { id: isl.id, pos: this.#relPos(isl), want, g: want, fixed, ext: islandExtent({ ...isl, grow: want }) };
      });
    items.push({ id: '', pos: new THREE.Vector3(), want: 1, g: 1, fixed: true, ext: this.coastMaxR + 13 });
    const GAP = 5;
    for (const a of items) {
      if (a.fixed) continue;
      for (const b of items) {
        if (a === b) continue;
        const d = a.pos.distanceTo(b.pos);
        if (a.ext + b.ext + GAP <= d) continue;
        const room = b.fixed ? d - GAP - b.ext : ((d - GAP) * a.ext) / (a.ext + b.ext);
        a.g = Math.min(a.g, (a.want * room) / a.ext);
      }
    }
    return new Map(items.map((x) => [x.id, Math.max(0.8, Math.floor(x.g * 50) / 50)]));
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
    // Cada isla crece todo lo que le deja el sitio hasta sus vecinas (si cambia, se rehace)
    const grows = this.#growths(visible);
    for (const raw of visible) {
      const grow = grows.get(raw.id) ?? 1;
      const old = this.islands[raw.id];
      if (old && Math.abs(old.isl.grow - grow) < 0.02) continue;
      if (old) {
        this.scene.remove(old.group, old.label);
        disposeTree(old.group);
        this.hitTargets = this.hitTargets.filter((h) => h !== old.hit);
        delete this.islands[raw.id];
      }
      const isl = { ...raw, grow };
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
    this.mapRadius = Math.max(120, ...Object.values(this.islands).map((e) => e.pos.length() + e.radius));
    // Lo que ocupa cada isla en el mar: las flotas las rodean y los pesqueros no las atraviesan
    this.islandObstacles = Object.values(this.islands)
      .map((e) => ({ id: e.isl.id, p: e.pos, core: islandExtent(e.isl), r: islandExtent(e.isl) + 3 }))
      .filter((o) => o.core > 0);
    // Espuma en las orillas más cercanas (el mar admite un número limitado)
    const shores = Object.values(this.islands)
      .map((e) => ({ x: e.pos.x, z: e.pos.z, r: shoreRadius(e.isl), h: islandCoast(e.isl), d: e.pos.length() }))
      .filter((e) => e.r > 0)
      .sort((a, b) => a.d - b.d);
    setShores(this.water, [this.#homeShore(), ...shores]);
  }

  /**
   * Miles de matas de hierba que se mecen con el viento y flores sueltas, en dos mallas
   * instanciadas (dos llamadas de dibujo para todo).
   */
  #buildGrass(free) {
    const rand = rng(321);
    const blade = new THREE.ConeGeometry(0.045, 0.36, 3);
    blade.translate(0, 0.18, 0);
    const parts = [];
    for (let k = 0; k < 3; k++) {
      const g = blade.clone();
      g.rotateZ(0.28);
      g.rotateY((k * Math.PI * 2) / 3 + 0.4);
      parts.push(g);
    }
    const tuft = mergeGeometries(parts);
    const wind = this.waterTime;
    const sway = (material, key, height) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = wind;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 root = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float bend = sin(uTime * 1.7 + root.x * 0.6 + root.z * 0.45) * 0.09 + sin(uTime * 3.1 + root.z) * 0.03;
          float tip = clamp(position.y / ${height}, 0.0, 1.0);
          transformed.x += bend * tip;
          transformed.z += bend * tip * 0.6;`,
        );
      };
      material.customProgramCacheKey = () => key;
      return material;
    };
    const greens = ['#7fa84a', '#6d9a40', '#8fb456', '#9db55a', '#a7b65e', '#5f8f3a'];
    const flowers = ['#f2f0e6', '#f08fb0', '#f2c94c', '#b07ad9', '#e86a5a'];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const spots = [];
    for (let i = 0; i < 24000 && spots.length < 7000; i++) {
      const deg = rand() * 360;
      const p = polar(2.5 + Math.sqrt(rand()) * (this.coast(deg) - 3), deg);
      if (free(p)) spots.push(p);
    }
    const grass = new THREE.InstancedMesh(tuft, sway(new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 'imperium-grass', '0.36'), spots.length);
    spots.forEach((p, i) => {
      dummy.position.set(p.x, 0.02, p.z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(0.9 + rand() * 0.9);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
      grass.setColorAt(i, color.set(greens[Math.floor(rand() * greens.length)]));
    });
    grass.receiveShadow = true;
    this.scene.add(grass);

    const petal = new THREE.IcosahedronGeometry(0.06, 0);
    petal.translate(0, 0.24, 0);
    const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.24, 3);
    stem.translate(0, 0.12, 0);
    const flowerGeo = mergeGeometries([petal.toNonIndexed(), stem.toNonIndexed()]);
    const blooms = spots.filter(() => rand() < 0.12);
    const field = new THREE.InstancedMesh(flowerGeo, sway(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), 'imperium-flowers', '0.3'), blooms.length);
    blooms.forEach((p, i) => {
      dummy.position.set(p.x + 0.15, 0.02, p.z - 0.1);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.8 + rand() * 0.6);
      dummy.updateMatrix();
      field.setMatrixAt(i, dummy.matrix);
      field.setColorAt(i, color.set(flowers[Math.floor(rand() * flowers.length)]));
    });
    this.scene.add(field);
  }

  #buildHomeLabel() {
    const el = document.createElement('div');
    el.className = 'label isl home';
    el.innerHTML = `<span class="label-name">${this.game.state.banner?.emblem ?? '⚜'} ${escapeHtml(this.game.homeIsland?.name ?? 'Tu isla')}</span>`;
    this.homeLabel = new CSS2DObject(el);
    this.homeLabel.position.set(0, 0, this.coast(0) + 9);
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
    // Pesqueros que faenan alrededor de la isla, cada uno por su círculo (así nunca se cruzan entre ellos)
    for (let i = 0; i < 5; i++) {
      const merchant = i % 3 === 0;
      const boat = createShip(merchant ? 'mercante' : 'bote');
      boat.scale.setScalar(merchant ? 2.2 : 2.4);
      boat.userData.sail = { r: this.coastMaxR + 6.5 + i * 3.6, a: rand() * TAU, dir: i % 2 ? 1 : -1, speed: 2 + rand() * 1.5, turn: 0, size: merchant ? 2.6 : 1.5 };
      this.lifeGroup.add(boat);
      this.boats.push(boat);
    }
    // Delfines que saltan de vez en cuando
    for (let i = 0; i < 4; i++) {
      const d = dolphin();
      d.visible = false;
      d.userData.jump = { next: 2 + rand() * 6 + i * 3, t: -1 };
      this.lifeGroup.add(d);
      this.dolphins.push(d);
    }
    // Carros de bueyes por la avenida del puerto
    for (let i = 0; i < 4; i++) {
      const c = cart();
      c.userData.walk = { avenue: true, cart: true, s: AVENUE_IN + 1.5 + i * 5.5, dir: i % 2 ? -1 : 1, speed: 0.7 + i * 0.04 };
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
    for (let i = 0; i < 12; i++) {
      const gull = createGull();
      // Cada una a su distancia: dan vueltas sin chocar aunque vayan en sentidos contrarios
      gull.userData.fly = { r: 14 + i * 2.5, h: 10 + rand() * 7, speed: (0.15 + rand() * 0.15) * (i % 2 ? 1 : -1), phase: rand() * Math.PI * 2 };
      this.scene.add(gull);
      this.gulls.push(gull);
    }
  }

  /** Aldeanos paseando por la ronda y la avenida del puerto (más cuanto más grande es la ciudad). */
  #syncVillagers() {
    const n = Math.min(56, 8 + 3 * this.game.level('ayuntamiento'));
    if (n === this.villagers.length) return;
    for (const v of this.villagers) this.lifeGroup.remove(v);
    this.villagers = [];
    const rand = rng(1234);
    for (let i = 0; i < n; i++) {
      const v = createVillager(i);
      const avenue = i % 3 === 0;
      v.userData.walk = avenue
        ? { avenue, side: rand() < 0.5 ? 1 : -1, s: AVENUE_IN + 2.5 + rand() * (this.coast(GATE_ANGLE) - AVENUE_IN - 8), dir: rand() < 0.5 ? 1 : -1, speed: 0.5 + rand() * 0.4 }
        : { avenue, a: rand() * TAU, dir: rand() < 0.5 ? 1 : -1, speed: 0.45 + rand() * 0.45 };
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
    // Casas del Mediterráneo: paredes encaladas u ocres, tejados bajos de terracota o azoteas, puertas y contraventanas azules
    const walls = ['#f6f1e7', '#f2e8d2', '#f3dcb0', '#ece0cf', '#f6f1e7', '#efd9bd'];
    const roofs = [C.roofRed, '#b85a36', C.roofRed, null, '#cf7046'];
    const batch = new Batch(windowMaterial());
    this.houseSpots.slice(0, n).forEach((s, i) => {
      const h = new THREE.Group();
      const floors = s.tall && level >= 4 ? 2 : 1;
      const wallH = s.h * floors;
      const wall = walls[i % walls.length];
      const blue = i % 3 !== 1;
      h.add(box(s.w, wallH, s.d, wall));
      // Zócalo de piedra y cornisa bajo el tejado
      h.add(box(s.w + 0.04, 0.1, s.d + 0.04, C.stone, 0, 0, 0));
      h.add(box(s.w + 0.06, 0.05, s.d + 0.06, C.marbleDark, 0, wallH - 0.05, 0));
      if (floors > 1) h.add(box(s.w + 0.04, 0.05, s.d + 0.04, C.marbleDark, 0, s.h, 0));
      if (roofs[s.roof]) h.add(hipRoof(s.w + 0.18, s.d + 0.18, 0.32, roofs[s.roof], 0, wallH, 0));
      else {
        // Azotea con su pretil (y una pérgola en algunas)
        h.add(box(s.w + 0.06, 0.12, s.d + 0.06, wall, 0, wallH, 0));
        h.add(box(s.w - 0.1, 0.02, s.d - 0.1, '#c9a27a', 0, wallH + 0.11, 0));
        if (i % 2) for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) h.add(box(0.04, 0.35, 0.04, C.woodDark, x * s.w * 0.35, wallH + 0.12, z * s.d * 0.3));
        if (i % 2) h.add(box(s.w * 0.8, 0.04, s.d * 0.7, '#6b8f45', 0, wallH + 0.47, 0));
      }
      h.add(box(0.34, 0.48, 0.03, C.marble, 0, 0, s.d / 2 + 0.005), box(0.26, 0.42, 0.04, blue ? C.roofBlue : C.woodDark, 0, 0, s.d / 2 + 0.012));
      for (let f = 0; f < floors; f++) {
        for (const x of [-s.w * 0.3, s.w * 0.3]) {
          const y = 0.3 + f * s.h + (f ? 0 : 0.05);
          h.add(box(0.16, 0.18, 0.04, C.dark, x, y, s.d / 2 + 0.01, WINDOW_GLOW));
          if (blue && f) for (const k of [-1, 1]) h.add(box(0.06, 0.19, 0.03, C.roofBlue, x + k * 0.12, y, s.d / 2 + 0.02));
        }
      }
      // Macetas de flores junto a la puerta
      if (i % 4 === 0) h.add(amphoraPot(s.w * 0.35, s.d / 2 + 0.12));
      if (s.chimney && i % 3 === 0) h.add(box(0.16, 0.4, 0.16, wall, s.w * 0.25, wallH + 0.1, -s.d * 0.2));
      h.position.copy(s.p);
      h.rotation.y = s.rot;
      // Humo en algunas chimeneas (no en todas, para no recargar)
      if (s.chimney && i % 6 === 0) {
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

  /**
   * Aldeanos y carros. Cada sentido va por su carril (los carros por el centro de la avenida y la
   * gente por las aceras y la ronda), nadie adelanta atravesando al de delante, se ceden el paso
   * donde se cruzan y dan la vuelta en los extremos solo cuando tienen sitio.
   */
  #updateWalkers(dt, t) {
    const gate = THREE.MathUtils.degToRad(GATE_ANGLE);
    const gx = Math.sin(gate);
    const gz = Math.cos(gate);
    const coastGate = this.coast(GATE_ANGLE);
    // Dónde dan la vuelta: los carros en los extremos y la gente fuera del círculo que barren
    const margin = CART_TURN_R + 0.45;
    const endOf = (w) => (w.dir > 0 ? coastGate - 2.6 - (w.cart ? 0 : margin) : AVENUE_IN + (w.cart ? 0 : margin));
    const laneOf = (w, dir = w.dir) => {
      if (!w.avenue) return dir > 0 ? 0.24 : -0.24;
      return w.cart ? -dir * 0.45 : w.side * (dir > 0 ? 1.1 : 1.46);
    };
    const onAvenue = (s, lane) => new THREE.Vector3(gx * s + gz * lane, 0, gz * s - gx * lane);
    // Primero los carros: si dos se esperan mutuamente, pasa antes el que va antes en la lista
    const movers = [...this.carts, ...this.villagers];
    const state = movers.map((v) => {
      const w = v.userData.walk;
      w.lane ??= laneOf(w);
      const fwd = new THREE.Vector3();
      let pos;
      if (w.avenue) {
        pos = onAvenue(w.s, w.lane);
        fwd.set(gx * w.dir, 0, gz * w.dir);
      } else {
        const r = ROAD_R + w.lane;
        pos = new THREE.Vector3(Math.sin(w.a) * r, 0, Math.cos(w.a) * r);
        fwd.set(Math.cos(w.a) * w.dir, 0, -Math.sin(w.a) * w.dir);
      }
      // Huella: un punto con radio (persona) o un segmento con radio (buey y carro)
      const cart = !!w.cart;
      return { w, pos, fwd, cart, r: cart ? 0.42 : 0.17, back: cart ? 0.85 : 0, front: cart ? 1.1 : 0 };
    });
    const tmp = new THREE.Vector3();
    const reach = (p, o) => {
      if (!o.cart) return p.distanceTo(o.pos) - o.r;
      tmp.subVectors(p, o.pos);
      const k = THREE.MathUtils.clamp(tmp.dot(o.fwd), -o.back, o.front);
      return tmp.addScaledVector(o.fwd, -k).length() - o.r;
    };
    // ¿Quién tiene a quién en el tramo de delante? (si hay alguien un poco más allá, va más despacio)
    const blocker = state.map((a, i) => {
      if (a.w.turn > 0 || a.w.pending) return { j: -1, slow: 1 };
      const look = a.cart ? 0.4 : 0.3;
      const probes = [1, 2, 3].map((k) => a.pos.clone().addScaledVector(a.fwd, a.front + (look * k) / 3));
      const far = a.pos.clone().addScaledVector(a.fwd, a.front + (a.cart ? 0.9 : 0.7));
      let j = -1;
      let best = Infinity;
      let slow = 1;
      state.forEach((b, k) => {
        if (k === i) return;
        const d = Math.min(...probes.map((q) => reach(q, b)));
        if (d < a.r && d < best) {
          best = d;
          j = k;
        } else if (reach(far, b) < a.r) slow = 0.45;
      });
      return { j, slow };
    });
    // Un carro que lleva un rato parado ante la ronda pide paso: la gente de la ronda espera antes de
    // pisar su carril hasta que haya cruzado. Cada petición: el tramo de avenida que ocupa (o va a
    // ocupar) el carro y la franja de su carril.
    const claims = state.filter((a) => a.cart && a.w.claim).map(({ w }) => {
      const front = w.s + w.dir * 1.1;
      const tail = w.s - w.dir * 0.85;
      const [lo, hi] = w.dir > 0 ? [tail - 0.3, front + 1.0] : [front - 1.0, tail + 0.3];
      return { lo, hi, x0: w.lane - 1.0, x1: w.lane + 1.0 };
    });
    const ringX = (w) => ((((w.a - gate) % TAU) + TAU + Math.PI) % TAU - Math.PI) * ROAD_R;
    // Si se esperan en círculo (A a B y B a A…), pasa el que menos roza al otro: nunca se atascan
    const clearance = (i) => {
      const a = state[i];
      const b = state[blocker[i].j];
      let c = Infinity;
      for (let d = 0.1; d <= 0.9; d += 0.1) c = Math.min(c, reach(a.pos.clone().addScaledVector(a.fwd, a.front + d), b) - a.r);
      return c;
    };
    const pass = new Set();
    blocker.forEach((b, i) => {
      const cycle = [i];
      let k = b.j;
      while (k >= 0 && k !== i && cycle.length <= state.length) {
        cycle.push(k);
        k = blocker[k].j;
      }
      if (k !== i || Math.min(...cycle) !== i) return;
      const c = cycle.map(clearance);
      pass.add(cycle[c.indexOf(Math.max(...c))]);
    });

    // En un extremo: da la vuelta si el sitio adonde va (o el círculo que barre el carro) está libre
    const tryTurn = (a, i) => {
      const w = a.w;
      const back = -w.dir;
      let clear;
      if (w.cart) {
        // Espera a que el carro que acaba de girar se aparte (los que vienen detrás no estorban)
        const c = onAvenue(w.s, 0);
        clear = state.every((b, k) => k === i || (b.cart ? b.w.dir === w.dir || reach(c, b) > CART_TURN_R : b.pos.distanceTo(c) > CART_TURN_R + b.r));
      } else {
        const spot = onAvenue(w.s, laneOf(w, back));
        clear = state.every((b, k) => k === i || reach(spot, b) > a.r + 0.05);
      }
      w.pending = !clear;
      if (clear) {
        w.dir = back;
        w.turnTime = w.cart ? 2.4 : 0.8;
        w.turn = w.turnTime;
      }
    };

    state.forEach((a, i) => {
      const w = a.w;
      const v = movers[i];
      // Cambio de carril suave (al dar la vuelta)
      const rate = dt * (w.cart ? 0.5 : 0.6);
      w.lane += THREE.MathUtils.clamp(laneOf(w) - w.lane, -rate, rate);
      let moving = false;
      if (w.turn > 0) w.turn = Math.max(0, w.turn - dt);
      else if (w.pending) tryTurn(a, i);
      else {
        let go = blocker[i].j < 0 || pass.has(i) ? blocker[i].slow : 0;
        if (!w.avenue && claims.length) {
          const x = ringX(w);
          const line = ROAD_R + w.lane;
          const halt = (c) => line >= c.lo && line <= c.hi && (w.dir > 0 ? x < c.x0 && x > c.x0 - 0.7 : x > c.x1 && x < c.x1 + 0.7);
          if (claims.some(halt)) go = 0;
        }
        if (w.cart) {
          // Cerca del cruce: si no puede pasar en un momento, pide paso hasta haber cruzado
          const front = w.s + w.dir * 1.1;
          const tail = w.s - w.dir * 0.85;
          const before = (ROAD_R - front) * w.dir > -0.5 && (ROAD_R - front) * w.dir < 1.6;
          const crossed = (tail - ROAD_R) * w.dir > 0.6;
          w.waitT = go === 0 && before ? (w.waitT ?? 0) + dt : 0;
          if (w.waitT > 1) w.claim = true;
          if (crossed || (!before && !w.claim)) w.claim = false;
        }
        const step = w.dir * w.speed * go * dt;
        if (w.avenue) {
          w.s += step;
          moving = step !== 0;
          const end = endOf(w);
          if ((w.s - end) * w.dir >= 0) {
            w.s = end;
            tryTurn(a, i);
          }
        } else if (step) {
          w.a = (w.a + step / ROAD_R + TAU) % TAU;
          moving = true;
        }
      }
      const bob = PAVE_Y + (!w.cart && moving ? Math.abs(Math.sin(t * 9 + i)) * 0.04 : 0);
      if (w.cart) v.userData.roll?.(moving || w.turn > 0 ? w.speed * dt : 0, t);
      if (w.avenue) {
        v.position.copy(onAvenue(w.s, w.lane)).setY(bob);
        let heading = gate + (w.dir > 0 ? 0 : Math.PI);
        if (w.turn > 0) {
          const p = 1 - w.turn / w.turnTime;
          heading += (1 - p * p * (3 - 2 * p)) * Math.PI;
        }
        v.rotation.y = heading;
      } else {
        const r = ROAD_R + w.lane;
        v.position.set(Math.sin(w.a) * r, bob, Math.cos(w.a) * r);
        v.rotation.y = w.a + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    });
  }

  /** Lo que los barcos pequeños y los delfines no deben atravesar: las islas vecinas y las flotas. */
  #seaObstacles() {
    const out = (this.islandObstacles ?? []).slice();
    for (const f of this.fleets.values()) out.push({ p: f.group.position, r: f.group.scale.x * (f.group.children.length > 1 ? 2.6 : 1.8) });
    if (this.raidGroup) out.push({ p: this.raidGroup.position, r: this.raidGroup.scale.x * 3.4 });
    return out;
  }

  /**
   * Las ovejas: casi siempre pastan con la cabeza gacha; de vez en cuando la levantan a mirar o dan
   * unos pasos (sin salir de su corro) moviendo las patas.
   */
  #updateFlock(dt, t) {
    for (const s of this.flock) {
      const g = s.userData.graze;
      const { head, legs } = s.userData;
      g.t -= dt;
      if (g.t <= 0) {
        // Siguiente cosa que hacer
        const r = Math.random();
        if (r < 0.55) {
          g.state = 'pace';
          g.t = 4 + Math.random() * 6;
        } else if (r < 0.8) {
          g.state = 'look';
          g.t = 1.5 + Math.random() * 2.5;
        } else {
          g.state = 'walk';
          g.t = 1.2 + Math.random() * 2;
          // Hacia un sitio de su corro
          const a = Math.random() * TAU;
          const to = g.home.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.random() * 0.35));
          g.heading = Math.atan2(to.x - s.position.x, to.z - s.position.z);
        }
      }
      let pitch = 0.95 + Math.sin(t * 3 + g.phase) * 0.06;
      let step = 0;
      if (g.state === 'look') pitch = -0.05 + Math.sin(t * 0.8 + g.phase) * 0.05;
      else if (g.state === 'walk') {
        pitch = 0.25;
        // Gira despacio hacia donde va y avanza
        const diff = ((g.heading - s.rotation.y + Math.PI * 3) % TAU) - Math.PI;
        s.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.2);
        if (Math.abs(diff) < 0.6) {
          const v = 0.28 * dt * s.scale.x;
          s.position.x += Math.sin(s.rotation.y) * v;
          s.position.z += Math.cos(s.rotation.y) * v;
          step = 1;
          if (s.position.distanceTo(g.home) > 0.4) g.t = 0;
        }
      }
      head.rotation.x += (pitch - head.rotation.x) * Math.min(1, dt * 4);
      legs.forEach((leg, k) => (leg.rotation.x = step * Math.sin(t * 9 + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.45));
    }
  }

  #updateLife(dt, t) {
    this.#updateWalkers(dt, t);
    this.#updateFlock(dt, t);
    const obstacles = this.#seaObstacles();
    // Pesqueros: cada uno por su círculo; si una flota o una isla les corta el paso, viran en redondo
    for (const [i, boat] of this.boats.entries()) {
      const f = boat.userData.sail;
      const blocked = (dir) =>
        obstacles.some((o) => {
          if (Math.abs(Math.hypot(o.p.x, o.p.z) - f.r) > o.r + f.size) return false;
          const ahead = ((((Math.atan2(o.p.x, o.p.z) - f.a) * dir) % TAU) + TAU) % TAU;
          return ahead * f.r < o.r + f.size + 5;
        });
      let v = f.speed;
      let heading = f.a + (f.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (f.turn > 0) {
        // Frena, vira y vuelve a arrancar en el otro sentido
        f.turn = Math.max(0, f.turn - dt);
        const p = 1 - f.turn / BOAT_TURN;
        v = f.speed * 0.5 * (p < 0.5 ? -(1 - 2 * p) : 2 * p - 1);
        heading += (1 - p * p * (3 - 2 * p)) * Math.PI;
      } else if (blocked(f.dir)) {
        v = 0;
        // Si por detrás hay sitio, da media vuelta; si está encerrado entre dos, espera fondeado
        if (!blocked(-f.dir)) {
          f.dir = -f.dir;
          f.turn = BOAT_TURN;
          heading += Math.PI;
        }
      }
      f.a = (f.a + (f.dir * v * dt) / f.r + TAU) % TAU;
      boat.position.set(Math.sin(f.a) * f.r, WATER_Y + Math.sin(t * 1.3 + i) * 0.08, Math.cos(f.a) * f.r);
      boat.rotation.set(0, heading, Math.sin(t * 1.1 + i) * 0.06);
      // Si su círculo pasa por dentro de una isla vecina, ahí no se ve
      boat.visible = !(this.islandObstacles ?? []).some((o) => o.p.distanceTo(boat.position) < o.core);
    }
    for (const d of this.dolphins) {
      const j = d.userData.jump;
      j.next -= dt;
      if (j.t < 0 && j.next <= 0) {
        // Un salto entre la costa y la bocana, lejos del puerto, de los embarcaderos y de los barcos
        const deg = Math.random() * 360;
        const r0 = this.coast(deg) + 7.5;
        const r = r0 + Math.random() * Math.max(0, this.harborR - 2 - r0);
        const from = polar(r, deg);
        const nearPort = Math.abs(((deg - GATE_ANGLE + 540) % 360) - 180) < 25;
        const crowded = [...obstacles, ...this.boats.map((b) => ({ p: b.position, r: b.userData.sail.size }))].some((o) => o.p.distanceTo(from) < o.r + 9);
        if (nearPort || crowded) j.next = 0.5;
        else {
          const a = THREE.MathUtils.degToRad(deg);
          j.from = from;
          j.dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
          j.t = 0;
          d.visible = true;
        }
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
      // Aleteo: el ala entera sube y baja y la punta la sigue con algo de retraso; a ratos planean
      const glide = Math.sin(t * 0.35 + i * 1.7) > 0.3;
      const beat = glide ? 0.12 + Math.sin(t * 1.5 + i) * 0.05 : Math.sin(t * 7 + i) * 0.5;
      const tip = glide ? -0.08 : Math.sin(t * 7 + i - 0.7) * 0.35;
      for (const wing of gull.children) {
        if (!wing.userData.side) continue;
        wing.rotation.z = wing.userData.side * beat;
        wing.userData.outer.rotation.z = wing.userData.side * tip;
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

    // Doble clic en el suelo o en el mar: la cámara va hasta ese punto
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    el.addEventListener('dblclick', (e) => {
      if (pick(e)) return;
      const p = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(ground, p)) this.focusTarget = p.setY(0);
    });

    // Teclado: WASD o flechas para moverse, Q/E para girar, +/- para acercar y C para centrar
    const KEYS = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', q: 'rotl', e: 'rotr', '+': 'in', '=': 'in', '-': 'out', _: 'out' };
    const typing = (e) => e.target.matches?.('input, textarea, select, [contenteditable]');
    window.addEventListener('keydown', (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'c') return this.recenter();
      const action = KEYS[key];
      if (!action) return;
      if (key.startsWith('arrow')) e.preventDefault();
      this.keys.add(action);
      this.focusTarget = null;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(KEYS[e.key.toLowerCase()]));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.altLabels = false;
    });
    // Con Alt pulsado se ven los nombres de todos los edificios
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        this.altLabels = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        this.altLabels = false;
      }
    });
  }

  /** Vuelve a la vista de siempre de la isla o del archipiélago. */
  recenter() {
    const v = VIEWS[this.view];
    const offset = v.offset.clone();
    if (this.camera.aspect < 1) offset.multiplyScalar(1 / this.camera.aspect ** 0.6);
    this.focusTarget = null;
    this.camTween = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: offset, toTarget: new THREE.Vector3() };
  }

  /** Un empujón a la cámara desde los botones de la pantalla: girar o acercar un poco, con suavidad. */
  nudgeCamera({ rotate = 0, zoom = 1 }) {
    this.focusTarget = null;
    this.nudge = { rotate, zoom: Math.log(zoom), left: 0.35, total: 0.35 };
  }

  /** Movimiento con el teclado y los botones, y que la vista no se salga del mundo. */
  #moveCamera(dt) {
    const cam = this.camera;
    const target = this.controls.target;
    const offset = cam.position.clone().sub(target);
    const dist = offset.length();
    const k = this.keys;
    if (k.size) {
      const fwd = offset.clone().setY(0).normalize().negate();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const speed = dist * 0.85 * dt;
      const move = new THREE.Vector3()
        .addScaledVector(fwd, (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0))
        .addScaledVector(right, (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0));
      if (move.lengthSq()) {
        move.normalize().multiplyScalar(speed);
        target.add(move);
        cam.position.add(move);
      }
      const rot = ((k.has('rotl') ? 1 : 0) - (k.has('rotr') ? 1 : 0)) * 1.6 * dt;
      const zoom = (k.has('in') ? -1 : 0) + (k.has('out') ? 1 : 0);
      if (rot || zoom) this.#orbit(rot, Math.exp(zoom * 1.3 * dt));
    }
    if (this.nudge) {
      const step = Math.min(dt, this.nudge.left);
      const f = step / this.nudge.total;
      this.nudge.left -= step;
      this.#orbit(this.nudge.rotate * f, Math.exp(this.nudge.zoom * f));
      if (this.nudge.left <= 0) this.nudge = null;
    }
    // Límite: la isla y su costa, o el archipiélago conocido
    if (!this.camTween) {
      const maxR = this.view === 'isla' ? this.coastMaxR + 14 : (this.mapRadius ?? 300) + 40;
      const r = Math.hypot(target.x, target.z);
      if (r > maxR) {
        const back = new THREE.Vector3(target.x, 0, target.z).multiplyScalar(maxR / r - 1);
        target.add(back);
        cam.position.add(back);
      }
    }
  }

  /**
   * Las gaviotas se oyen de vez en cuando (unos segundos cada medio minuto o minuto y medio), y solo
   * si vuelan sobre la isla cerca de donde miras (en la vista de la isla).
   */
  #gullSound(dt) {
    this.gullClock = (this.gullClock ?? 0) + dt;
    if (this.gullClock < 0.4 || this.showcase) return;
    const step = this.gullClock;
    this.gullClock = 0;
    // Entre graznido y graznido, silencio
    const call = (this.gullCall ??= { wait: 10 + Math.random() * 20, left: 0 });
    if (call.left > 0) call.left -= step;
    else {
      call.wait -= step;
      if (call.wait <= 0) {
        call.left = 4 + Math.random() * 4;
        call.wait = 30 + Math.random() * 60;
      }
    }
    if (call.left <= 0) {
      setGulls(0);
      return;
    }
    let k = 0;
    if (this.view === 'isla') {
      const target = this.controls.target;
      for (const g of this.gulls) {
        if (Math.hypot(g.position.x, g.position.z) > this.coast(THREE.MathUtils.radToDeg(Math.atan2(g.position.x, g.position.z))) + 3) continue;
        k += Math.max(0, 1 - g.position.distanceTo(target) / 38);
      }
    }
    setGulls(Math.min(1, k / 1.5));
  }

  /** Gira la cámara alrededor de lo que mira y la acerca o aleja (dentro de los límites). */
  #orbit(angle, scale) {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    if (angle) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    if (scale !== 1) offset.setLength(THREE.MathUtils.clamp(offset.length() * scale, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(target).add(offset);
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
    this.#syncSiege();
    this.#collectAnimated();
  }

  /** Color de las banderas de tu ciudad: el tuyo o, si te han ocupado, el del invasor. */
  #homeBanner() {
    const occ = this.game.state.occupied;
    if (occ) return occ.banner ?? ownerColor({ owner: occ.by });
    return this.game.state.banner?.color;
  }

  /**
   * Flota enemiga anclada frente a la bocana de tu puerto mientras te bloquean u ocupan: cuatro
   * barcos de guerra de costado que se mecen con las olas.
   */
  #syncSiege() {
    const s = this.game.state;
    const info = s.occupied ?? s.blockade;
    const key = info ? `${s.occupied ? 'o' : 'b'}-${info.by}-${info.mission}` : null;
    if (this.siegeKey === key) return;
    this.siegeKey = key;
    if (this.siegeGroup) {
      this.scene.remove(this.siegeGroup);
      disposeTree(this.siegeGroup);
      this.siegeGroup = null;
    }
    if (!info) return;
    const g = new THREE.Group();
    ['dromon', 'trirreme', 'galeon', 'trirreme'].forEach((type, i) => {
      const deg = GATE_ANGLE + (i - 1.5) * 9;
      const p = polar(this.coast(deg) + 15 + (i % 2) * 4, deg);
      g.add(anchoredShip(type, p, 2.6, i));
    });
    this.scene.add(g);
    this.siegeGroup = g;
  }

  #syncBuildings() {
    const q = this.game.queue;
    for (const id of BUILDING_KEYS) {
      const slot = this.slots[id];
      const level = this.game.level(id);
      const building = q?.id === id;
      const key = `${level}|${building}|${this.#homeBanner() ?? ''}`;
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
      paintBanner(slot.building, this.#homeBanner());
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
    const gaps = [{ a: GATE_ANGLE, w: 8 }, ...[...OUTER, ...COAST].map((id) => ({ a: this.layout[id].angle, w: 3.4 }))];
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
        // Torres redondas con cornisa y un tejado bajo de terracota
        const tower = cyl(0.8, 0.9, h + 1.1, 8, C.stone);
        tower.position.add(polar(WALL_R, a));
        const cornice = cyl(0.98, 0.98, 0.16, 8, C.marbleDark);
        cornice.position.add(polar(WALL_R, a, h + 1.1));
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.6, 8), mat(C.roofRed));
        roof.position.copy(polar(WALL_R, a, h + 1.56));
        roof.castShadow = true;
        this.wallGroup.add(tower, cornice, roof);
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
      // Una ciudad ocupada luce el estandarte de quien la ocupa
      const port = view.type === 'jugador' ? view.port : null;
      const occupier = port?.kind === 'invadir' ? (port.by === this.game.userId ? this.game.state.banner?.color : port.banner) ?? ownerColor({ owner: port.by }) : null;
      const bannerColor = occupier ?? (ownerId === this.game.userId ? this.game.state.banner?.color : this.game.world.playerInfo(ownerId)?.banner?.color);
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
      this.#syncIslandSiege(entry, port);
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
      if (port) status += port.kind === 'invadir' ? ` · 🦅 Ocupada${port.by === this.game.userId ? ' por ti' : ''}` : ` · ⛓️ Bloqueada${port.by === this.game.userId ? ' por ti' : ''}`;
      else if (view.shield) status += ' · 🛡️ Recién liberada';
      if (view.inbound.length) status += ' · ⛵';
      entry.el.querySelector('.label-lvl').textContent = status;
      entry.el.classList.toggle('colony', !!view.colonized);
      entry.el.classList.toggle('ally', !!ally);
      entry.el.classList.toggle('pact', view.relation === 'pacto');
      entry.el.classList.toggle('war', view.relation === 'guerra' || (view.type === 'continente' && !!view.horde));
      entry.el.classList.toggle('sieged', !!port);
      // Lo que más importa al jugador se queda con la etiqueta entera cuando no caben todas
      entry.prio = view.type === 'continente' && view.horde ? 400 : view.colonized ? 350 : view.type === 'jugador' ? 300 : view.type === 'continente' ? 250 : view.explored ? 100 : 0;
      entry.el.classList.toggle('player', view.type === 'jugador');
      entry.el.classList.toggle('unknown', !view.explored);
    }
  }

  /** Barcos anclados junto a una ciudad del mapa que está bloqueada u ocupada (del lado que mira hacia ti). */
  #syncIslandSiege(entry, port) {
    const key = port ? `${port.kind}-${port.by}` : null;
    if (entry.siegeKey === key) return;
    entry.siegeKey = key;
    if (entry.siege) {
      entry.group.remove(entry.siege);
      disposeTree(entry.siege);
      entry.siege = null;
    }
    if (!port) return;
    const g = new THREE.Group();
    const toward = Math.atan2(-entry.pos.x, -entry.pos.z);
    const r = islandExtent(entry.isl) + 3;
    const types = port.kind === 'invadir' ? ['mercante', 'trirreme'] : ['trirreme', 'dromon', 'trirreme'];
    types.forEach((type, i) => {
      const a = toward + (i - (types.length - 1) / 2) * 0.32;
      g.add(anchoredShip(type, new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r), 3.2, i));
    });
    entry.group.add(g);
    entry.siege = g;
  }

  /**
   * Camino por mar de `a` a `b` que no pasa por encima de ninguna isla (ni de la tuya): búsqueda A*
   * en una rejilla y luego se tensa la cuerda para dejar pocos tramos rectos. Las islas de donde
   * sale o adonde llega no cuentan (se sale y se llega por su orilla).
   */
  #navigate(a, b) {
    a = a.clone().setY(0);
    b = b.clone().setY(0);
    const near = (o, p) => Math.hypot(p.x - o.p.x, p.z - o.p.z) < o.r + 0.5;
    const obstacles = (this.islandObstacles ?? []).map((o) => ({ p: o.p, r: o.core + 4 })).filter((o) => !near(o, a) && !near(o, b));
    const homeR = (x, z) => this.coast(THREE.MathUtils.radToDeg(Math.atan2(x, z))) + 6;
    const home = Math.hypot(a.x, a.z) > homeR(a.x, a.z) - 0.5 && Math.hypot(b.x, b.z) > homeR(b.x, b.z) - 0.5;
    const blockedAt = (x, z, pad) => (home && Math.hypot(x, z) < homeR(x, z) + pad) || obstacles.some((o) => Math.hypot(x - o.p.x, z - o.p.z) < o.r + pad);
    const clear = (p, q) => {
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 1.5));
      for (let i = 0; i <= n; i++) if (blockedAt(p.x + ((q.x - p.x) * i) / n, p.z + ((q.z - p.z) * i) / n, 0)) return false;
      return true;
    };
    if (clear(a, b)) return [a, b];

    const CELL = 3;
    const minX = Math.min(a.x, b.x) - 90;
    const minZ = Math.min(a.z, b.z) - 90;
    const W = Math.ceil((Math.max(a.x, b.x) + 90 - minX) / CELL) + 1;
    const H = Math.ceil((Math.max(a.z, b.z) + 90 - minZ) / CELL) + 1;
    if (W * H > 120000) return [a, b];
    const cellOf = (p) => Math.round((p.z - minZ) / CELL) * W + Math.round((p.x - minX) / CELL);
    const at = (k) => new THREE.Vector3(minX + (k % W) * CELL, 0, minZ + Math.floor(k / W) * CELL);
    const blocked = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const c = at(k);
      blocked[k] = blockedAt(c.x, c.z, 2) ? 1 : 0;
    }
    const s0 = cellOf(a);
    const t0 = cellOf(b);
    blocked[s0] = blocked[t0] = 0;
    const tx = t0 % W;
    const tz = Math.floor(t0 / W);
    const h = (k) => {
      const dx = Math.abs((k % W) - tx);
      const dz = Math.abs(Math.floor(k / W) - tz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    const g = new Float32Array(W * H).fill(Infinity);
    const from = new Int32Array(W * H).fill(-1);
    // Montículo binario de [f, celda]
    const heap = [];
    const push = (f, k) => {
      heap.push([f, k]);
      for (let n = heap.length - 1; n > 0; ) {
        const up = (n - 1) >> 1;
        if (heap[up][0] <= heap[n][0]) break;
        [heap[up], heap[n]] = [heap[n], heap[up]];
        n = up;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let n = 0; ; ) {
          const l = 2 * n + 1;
          let m = n;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (l + 1 < heap.length && heap[l + 1][0] < heap[m][0]) m = l + 1;
          if (m === n) break;
          [heap[m], heap[n]] = [heap[n], heap[m]];
          n = m;
        }
      }
      return top;
    };
    g[s0] = 0;
    push(h(s0), s0);
    let found = false;
    while (heap.length) {
      const [f, k] = pop();
      if (k === t0) {
        found = true;
        break;
      }
      if (f - h(k) > g[k] + 1e-4) continue;
      const x = k % W;
      const z = Math.floor(k / W);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const n = nz * W + nx;
          if (blocked[n]) continue;
          const cost = g[k] + (dx && dz ? 1.414 : 1);
          if (cost >= g[n]) continue;
          g[n] = cost;
          from[n] = k;
          push(cost + h(n), n);
        }
      }
    }
    if (!found) return [a, b];
    const cells = [];
    for (let k = t0; k >= 0 && k !== s0; k = from[k]) cells.push(at(k));
    const path = [a, ...cells.reverse().slice(0, -1), b];
    // Tensar la cuerda: desde cada punto, al más lejano que se ve sin tocar ninguna isla
    const out = [a];
    for (let k = 0; k < path.length - 1; ) {
      let far = k + 1;
      while (far + 1 < path.length && clear(path[k], path[far + 1])) far++;
      out.push(path[far]);
      k = far;
    }
    return out;
  }

  /** Cuánto apartarse del centro de una isla para salir o llegar por mar (o `fallback` si no se conoce). */
  #offshore(p, fallback) {
    if (p.length() < 3) return this.coastMaxR + 10;
    const o = (this.islandObstacles ?? []).find((x) => x.p.distanceTo(p) < 3);
    return o ? o.core + 4 : fallback;
  }

  /**
   * Ruta desde tu puerto: sale por la bocana y va hasta el destino rodeando las islas. `lane` (0..2)
   * separa a la salida y a la llegada las flotas que van al mismo sitio, para que no se monten.
   */
  #routeTo(target, lane = 1) {
    const entry = this.islands[target];
    const pos = entry ? entry.pos.clone().setY(0) : new THREE.Vector3(0, 0, 200);
    // Más allá del muelle y del faro del puerto
    const a0 = GATE_ANGLE + (lane - 1) * 4;
    const mouth = polar(this.coast(a0) + 12, a0);
    // Se detiene frente a la isla, cada flota en su sitio
    const toward = pos.clone().normalize();
    const side = new THREE.Vector3(toward.z, 0, -toward.x);
    const stop = (entry ? islandExtent(entry.isl) : 10) + 4;
    const end = pos.clone().addScaledVector(toward, -stop).addScaledVector(side, (lane - 1) * 4.5);
    return new Route(this.#navigate(mouth, end));
  }

  /** Ruta entre dos islas que no son la tuya (flotas que zarpan de una ciudad ocupada). */
  #routeBetween(fromId, toId) {
    const at = (id) => this.islands[id]?.pos.clone().setY(0) ?? null;
    const from = at(fromId);
    const to = at(toId);
    if (!from || !to) return this.#routeTo(toId);
    const dir = to.clone().sub(from).normalize();
    const a = from.clone().addScaledVector(dir, this.#offshore(from, 14));
    const b = to.clone().addScaledVector(dir, -this.#offshore(to, 14));
    return new Route(this.#navigate(a, b));
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
      const route = m.from ? this.#routeBetween(m.from, m.target) : this.#routeTo(m.target, hashString(String(m.id)) % 3);
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
      const hostile = m.type === 'atacar' || m.type === 'invadir' || m.type === 'bloquear';
      const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: hostile ? '#ff9a8a' : m.type === 'tributo' ? '#ffd27a' : '#ffffff', dashSize: 3, gapSize: 2.5, transparent: true, opacity: 0.7 }));
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
      const a = from.clone().addScaledVector(dir, this.#offshore(from, 22));
      const b = to.clone().addScaledVector(dir, -this.#offshore(to, 14));
      const route = new Route(this.#navigate(a, b));
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
      const deg = THREE.MathUtils.radToDeg(Math.atan2(from.x, from.z));
      const to = polar(this.coast(deg) + 12, deg);
      const start = from.clone().setLength(Math.max(this.coastMaxR + 20, from.length() - this.#offshore(from, 25)));
      const route = new Route(this.#navigate(start, to));
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
    this.raidRoute = new Route(this.#navigate(polar(RAID_FROM, angle), polar(this.coast(angle) + 9, angle)));
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
    for (const isl of Object.values(this.islands)) {
      collect(isl.feature);
      collect(isl.siege);
    }
    collect(this.siegeGroup);
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
    this.#moveCamera(dt);
    this.controls.update(dt);
    this.#gullSound(dt);

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
    const hovered = this.hovered ?? this.listHover;
    const showHover = hovered && hovered !== this.selected && (this.slots[hovered] || this.islands[hovered]);
    this.hoverRing.visible = !!showHover;
    if (showHover) {
      const { center, radius } = this.#ringFor(hovered);
      this.hoverRing.position.copy(center).setY(center.y - 0.01);
      this.hoverRing.scale.setScalar(radius);
    }

    this.frame = (this.frame ?? 0) + 1;
    if (this.frame % 3 === 0) this.#declutter();
    if (this.high && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /**
   * Etiquetas sin amontonarse: de la más importante a la menos, cada una se queda entera si cabe;
   * si pisa a otra se encoge (icono y nivel, o solo el nombre de la isla) y, si ni así cabe, se esconde.
   * Al pasar el ratón o seleccionar algo, su etiqueta pasa la primera.
   * En tu isla, para que no tapen la ciudad, solo se ven los letreros del edificio que señalas
   * (con el ratón o en la lista), del seleccionado y del que se está construyendo; todos, si lo
   * pide la opción del menú o mientras se tiene pulsado Alt.
   */
  #declutter() {
    if (this.showcase) return;
    const items = [];
    const pointed = this.hovered ?? this.listHover;
    const boost = (id) => (id === this.selected ? 2000 : id === pointed ? 1500 : 0);
    if (this.view === 'isla') {
      const q = this.game.queue;
      const all = this.labelsAlways || this.altLabels;
      for (const s of Object.values(this.slots)) {
        const prio = boost(s.id) + (q?.id === s.id ? 1000 : 0) + (s.id === 'ayuntamiento' ? 600 : 0) + (s.level ?? 0) * 10;
        items.push({ el: s.el, obj: s.label, prio, island: false, hide: !all && prio < 1000 });
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
      if (it.hide) {
        if (el._state !== 'hidden') {
          el._state = 'hidden';
          el.classList.remove('lbl-compact');
          el.classList.add('lbl-hidden');
        }
        continue;
      }
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

/** Maceta de barro con flores, para la puerta de las casas. */
function amphoraPot(x, z) {
  const g = new THREE.Group();
  g.add(cyl(0.1, 0.07, 0.16, 7, '#b9643a', x, 0, z));
  g.add(box(0.16, 0.1, 0.16, '#e86a8a', x, 0.16, z));
  return g;
}

/**
 * Red de pesca tendida a secar: dos palos con un cabo, la malla colgando combada (hilos cruzados),
 * corchos en la relinga y un montón de red al pie.
 */
function dryingNet() {
  const g = new THREE.Group();
  const W = 1.3;
  const H = 0.95;
  for (const x of [-W / 2, W / 2]) g.add(box(0.05, H + 0.1, 0.05, C.woodDark, x, 0, 0));
  g.add(box(W, 0.02, 0.02, '#8a7350', 0, H, 0));
  const twine = '#7a6a48';
  // Comba de la red: más baja en el centro
  const sag = (x) => 0.12 * (1 - (2 * x / W) ** 2);
  const cols = 9;
  for (let i = 0; i < cols; i++) {
    const x = -W / 2 + 0.06 + (i * (W - 0.12)) / (cols - 1);
    const len = H - 0.18 - sag(x);
    g.add(box(0.012, len, 0.012, twine, x, H - len, 0.01));
  }
  for (let j = 0; j < 6; j++) {
    const y = H - 0.05 - j * 0.12;
    for (let i = 0; i < cols - 1; i++) {
      const x0 = -W / 2 + 0.06 + (i * (W - 0.12)) / (cols - 1);
      const x1 = x0 + (W - 0.12) / (cols - 1);
      const y0 = y - sag(x0) * (j / 5);
      const y1 = y - sag(x1) * (j / 5);
      const seg = box(Math.hypot(x1 - x0, y1 - y0), 0.012, 0.012, twine, 0, 0, 0);
      seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.01);
      seg.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      g.add(seg);
    }
  }
  // Corchos en lo alto
  for (let i = 0; i < 6; i++) {
    const cork = mesh(new THREE.SphereGeometry(0.035, 6, 4), i % 2 ? '#d98a3a' : '#e8d2a0');
    cork.position.set(-W / 2 + 0.15 + i * ((W - 0.3) / 5), H - 0.03, 0.02);
    g.add(cork);
  }
  // Red amontonada al pie
  for (let k = 0; k < 4; k++) {
    const lump = mesh(new THREE.DodecahedronGeometry(0.14 - k * 0.02), k % 2 ? '#8a7350' : '#7a6a48');
    lump.position.set(0.25 + k * 0.08, 0.05, 0.28 + (k % 2) * 0.08);
    lump.scale.y = 0.45;
    g.add(lump);
  }
  return g;
}

/**
 * Caseta de pescadores como las de las islas: cubo encalado sobre un zócalo de piedra, azotea con
 * pretil, puerta y ventanuco azules mirando al mar, porche de cañizo con banco y mesa, remos
 * apoyados en la pared, cestos con la pesca y una cuerda con pescado secándose.
 * El frente (puerta y porche) mira a +Z.
 */
function fishermansHut() {
  const g = new THREE.Group();
  const blue = '#2c5ea8';
  g.add(box(1.4, 0.1, 1.05, C.stone, 0, 0, 0));
  g.add(box(1.3, 0.85, 0.95, C.white, 0, 0.1, 0));
  g.add(box(1.34, 0.08, 0.99, C.wall, 0, 0.95, 0), box(1.2, 0.02, 0.85, '#d9c7a4', 0, 1.0, 0));
  // Puerta y ventanuco azules con marco de piedra
  g.add(box(0.4, 0.62, 0.04, C.stone, -0.25, 0.1, 0.48), box(0.3, 0.56, 0.05, blue, -0.25, 0.1, 0.485));
  g.add(box(0.26, 0.24, 0.04, C.stone, 0.35, 0.45, 0.48), box(0.18, 0.16, 0.05, blue, 0.35, 0.49, 0.485));
  // Porche de cañizo sobre cuatro palos, con banco y mesa
  for (const [x, z] of [[-0.6, 0.52], [0.6, 0.52], [-0.6, 1.0], [0.6, 1.0]]) g.add(box(0.05, 0.85, 0.05, C.woodDark, x, 0, z));
  const reeds = box(1.35, 0.04, 0.6, '#cdb27a', 0, 0.85, 0.78);
  reeds.rotation.x = -0.08;
  g.add(reeds);
  for (let k = 0; k < 6; k++) g.add(box(0.02, 0.05, 0.6, '#a88a52', -0.6 + k * 0.24, 0.87, 0.78));
  g.add(box(0.7, 0.05, 0.2, C.woodLight, 0.15, 0.25, 0.65), box(0.05, 0.25, 0.18, C.woodDark, -0.15, 0, 0.65), box(0.05, 0.25, 0.18, C.woodDark, 0.45, 0, 0.65));
  g.add(box(0.36, 0.05, 0.3, C.woodLight, 0.25, 0.42, 0.88), box(0.05, 0.42, 0.05, C.woodDark, 0.25, 0, 0.88));
  // Remos apoyados en la pared
  for (const x of [0.62, 0.72]) {
    const oar = box(0.03, 1.0, 0.03, C.woodLight, 0, 0, 0);
    oar.position.set(x, 0.5, 0.15);
    oar.rotation.z = 0.25;
    g.add(oar);
    g.add(box(0.1, 0.22, 0.02, C.woodLight, x + 0.12, 0.05, 0.15));
  }
  // Cestos con la pesca y una cuerda con pescado secándose
  for (const [x, z] of [[-0.85, 0.7], [-0.82, 0.98]]) {
    g.add(cyl(0.13, 0.1, 0.18, 8, '#a8844e', x, 0, z));
    const fish = mesh(new THREE.SphereGeometry(0.06, 6, 4), '#9fb3bf');
    fish.scale.set(1.6, 0.6, 0.8);
    fish.position.set(x, 0.2, z);
    g.add(fish);
  }
  g.add(box(1.2, 0.012, 0.012, '#8a7350', 0, 0.72, 1.0));
  for (let k = 0; k < 5; k++) {
    const fish = mesh(new THREE.SphereGeometry(0.045, 6, 4), '#a9b8c2');
    fish.scale.set(0.6, 1.8, 0.5);
    fish.position.set(-0.45 + k * 0.22, 0.62, 1.0);
    g.add(fish);
  }
  return g;
}

/**
 * Oveja: vellón lanudo de bolas, patas y cara oscuras, orejas caídas. Mira hacia +Z; la cabeza
 * (userData.head) gira en el cuello para pastar y las patas (userData.legs) en la cadera para andar.
 */
function sheep() {
  const g = new THREE.Group();
  const wool = ['#f4f1e8', '#ece6d8', '#f7f4ec'];
  const dark = '#2f2a25';
  const body = mesh(new THREE.SphereGeometry(0.2, 9, 7), wool[0]);
  body.scale.set(0.85, 0.78, 1.2);
  body.position.y = 0.32;
  g.add(body);
  // Rizos del vellón por encima y por los lados
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const puff = mesh(new THREE.DodecahedronGeometry(0.075 + (k % 3) * 0.012), wool[k % 3]);
    puff.position.set(Math.sin(a) * 0.12, 0.4 + (k % 2) * 0.04, Math.cos(a) * 0.17);
    g.add(puff);
  }
  const tail = mesh(new THREE.DodecahedronGeometry(0.05), wool[1]);
  tail.position.set(0, 0.36, -0.25);
  g.add(tail);
  // Patas con su pezuña (giran en la cadera)
  const legs = [];
  for (const [x, z] of [[-0.08, 0.12], [0.08, 0.12], [-0.08, -0.12], [0.08, -0.12]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.24, z);
    const shin = cyl(0.022, 0.02, 0.22, 5, dark, 0, -0.24, 0);
    leg.add(shin, cyl(0.026, 0.026, 0.03, 5, '#1c1915', 0, -0.24, 0));
    g.add(leg);
    legs.push(leg);
  }
  // Cabeza: cara negra alargada, orejas caídas y un mechón de lana en la frente
  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.2);
  const face = mesh(new THREE.SphereGeometry(0.07, 7, 6), dark);
  face.scale.set(0.8, 0.85, 1.35);
  face.position.set(0, 0, 0.09);
  head.add(face);
  for (const s of [-1, 1]) {
    const ear = box(0.08, 0.025, 0.04, dark, s * 0.07, 0.01, 0.06);
    ear.rotation.z = s * -0.5;
    head.add(ear);
    const eye = mesh(new THREE.SphereGeometry(0.012, 5, 4), '#e8dcc0');
    eye.position.set(s * 0.045, 0.025, 0.12);
    head.add(eye);
  }
  const tuft = mesh(new THREE.DodecahedronGeometry(0.055), wool[2]);
  tuft.position.set(0, 0.05, 0.04);
  head.add(tuft);
  head.rotation.x = 0.9;
  g.add(head);
  g.userData.head = head;
  g.userData.legs = legs;
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

/** Rueda de carro de radios: llanta, cubo y ocho radios (gira en su eje X). */
function cartWheel(r) {
  const w = new THREE.Group();
  const rim = mesh(new THREE.TorusGeometry(r, 0.035, 5, 16), '#6e4a2a');
  rim.rotation.y = Math.PI / 2;
  w.add(rim);
  const hub = cyl(0.06, 0.06, 0.1, 8, '#4a3220', 0, 0, 0);
  hub.rotation.z = Math.PI / 2;
  hub.position.y = 0;
  w.add(hub);
  for (let k = 0; k < 8; k++) {
    const spoke = box(0.025, r * 2 - 0.04, 0.035, '#8b5a2b', 0, 0, 0);
    spoke.position.y = 0;
    spoke.rotation.x = (k * Math.PI) / 8;
    w.add(spoke);
  }
  w.userData.rig = true;
  return w;
}

/**
 * Carro de bueyes: un buey rojizo con la cara blanca y los cuernos en lira, uncido al yugo, y una
 * carreta de tablas con estacas, ruedas de radios y cargada de sacos de arpillera y un cesto. Mira
 * hacia +Z. Al andar giran las ruedas y el buey mueve las patas (userData.roll).
 */
function cart() {
  const g = new THREE.Group();
  g.userData.cart = true;
  const hide = '#9a5a32';
  const cream = '#eadfca';
  const hoof = '#2a2420';
  // ── El buey, delante ──
  const ox = new THREE.Group();
  ox.position.set(0, 0, 0.78);
  const body = mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), hide);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 1.15);
  body.position.set(0, 0.5, 0);
  ox.add(body);
  // Barriga clara y la cruz algo levantada
  const belly = mesh(new THREE.CapsuleGeometry(0.13, 0.3, 3, 8), cream);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, 0.42, 0.02);
  ox.add(belly);
  const withers = mesh(new THREE.SphereGeometry(0.15, 8, 6), hide);
  withers.position.set(0, 0.6, 0.2);
  ox.add(withers);
  const legs = [];
  for (const [x, z] of [[-0.1, 0.24], [0.1, 0.24], [-0.1, -0.24], [0.1, -0.24]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.4, z);
    leg.add(cyl(0.045, 0.04, 0.22, 6, hide, 0, -0.22, 0), cyl(0.035, 0.035, 0.16, 6, cream, 0, -0.36, 0));
    leg.add(box(0.075, 0.05, 0.085, hoof, 0, -0.4, 0.005));
    leg.userData.rig = true;
    ox.add(leg);
    legs.push(leg);
  }
  // Cabeza: cara blanca, morro oscuro, orejas y cuernos en lira
  const head = new THREE.Group();
  head.position.set(0, 0.58, 0.42);
  // Testuz ancho y la cara que se estrecha hacia el morro, inclinada hacia abajo
  const brow = mesh(new THREE.SphereGeometry(0.095, 8, 6), cream);
  brow.scale.set(1.05, 0.9, 0.9);
  head.add(brow);
  const face = mesh(new THREE.CylinderGeometry(0.055, 0.085, 0.24, 7), cream);
  face.rotation.x = Math.PI / 2 + 0.6;
  face.position.set(0, -0.08, 0.09);
  head.add(face);
  const muzzle = mesh(new THREE.SphereGeometry(0.065, 7, 5), '#5a4a40');
  muzzle.scale.set(1.1, 0.8, 0.9);
  muzzle.position.set(0, -0.17, 0.17);
  head.add(muzzle);
  for (const s of [-1, 1]) {
    // Orejas caídas a los lados y cuernos que salen hacia fuera y se curvan hacia arriba
    const ear = box(0.1, 0.035, 0.06, hide, s * 0.13, -0.02, -0.01);
    ear.rotation.z = s * -0.4;
    head.add(ear);
    const horn = cyl(0.026, 0.032, 0.14, 6, '#e8dcc2', 0, 0, 0);
    horn.position.set(s * 0.15, 0.05, -0.02);
    horn.rotation.z = (s * -Math.PI) / 2;
    head.add(horn);
    const up = mesh(new THREE.ConeGeometry(0.024, 0.16, 6), '#e8dcc2');
    up.position.set(s * 0.25, 0.11, -0.02);
    up.rotation.z = -s * 0.35;
    head.add(up);
    const tip = mesh(new THREE.ConeGeometry(0.012, 0.05, 5), '#4a4038');
    tip.position.set(s * 0.278, 0.2, -0.02);
    tip.rotation.z = -s * 0.35;
    head.add(tip);
    const eye = mesh(new THREE.SphereGeometry(0.017, 5, 4), '#1c1915');
    eye.position.set(s * 0.075, -0.02, 0.07);
    head.add(eye);
  }
  ox.add(head);
  // Cola con su borla
  const tail = cyl(0.015, 0.015, 0.38, 4, hide, 0, 0, 0);
  tail.position.set(0, 0.42, -0.42);
  tail.rotation.x = 0.15;
  ox.add(tail, box(0.05, 0.08, 0.05, '#3a2a1e', 0, 0.2, -0.44));
  // Yugo sobre la cruz, atado con correas, y la lanza que va al carro
  ox.add(box(0.62, 0.08, 0.09, '#8b5a2b', 0, 0.74, 0.28));
  for (const s of [-1, 1]) {
    ox.add(box(0.03, 0.26, 0.11, '#4a3220', s * 0.17, 0.5, 0.28));
    ox.add(cyl(0.05, 0.05, 0.05, 6, '#a38457', s * 0.24, 0.73, 0.28));
  }
  g.add(ox);
  // Dos varas, una a cada lado del buey, del frente del carro a los extremos del yugo
  for (const sx of [-1, 1]) {
    const from = new THREE.Vector3(sx * 0.3, 0.5, 0.06);
    const to = new THREE.Vector3(sx * 0.27, 0.74, 1.06);
    const d = to.clone().sub(from);
    const shaft = mesh(new THREE.BoxGeometry(0.055, 0.055, d.length()), '#7a5230');
    shaft.position.copy(from).addScaledVector(d, 0.5);
    shaft.lookAt(shaft.position.clone().add(d));
    g.add(shaft);
    // Atadura de cuerda donde la vara se une al yugo
    g.add(cyl(0.045, 0.045, 0.07, 6, '#a38457', to.x, to.y - 0.035, to.z));
  }

  // ── La carreta, detrás ──
  const cz = -0.42;
  const wood = ['#8b5a2b', '#7a4f26', '#946232'];
  g.add(box(0.7, 0.06, 1.05, '#6e4a2a', 0, 0.4, cz));
  for (const s of [-1, 1]) {
    // Laterales de dos tablas y estacas que asoman por arriba
    for (const [y, k] of [[0.46, 0], [0.6, 1]]) g.add(box(0.04, 0.12, 1.05, wood[k], s * 0.35, y, cz));
    for (const z of [-0.47, 0, 0.47]) g.add(box(0.05, 0.4, 0.05, '#5e3b1c', s * 0.37, 0.4, cz + z));
  }
  for (const s of [-1, 1]) {
    for (const [y, k] of [[0.46, 2], [0.6, 0]]) g.add(box(0.66, 0.12, 0.04, wood[k], 0, y, cz + s * 0.51));
  }
  // Eje y ruedas
  g.add(box(0.95, 0.06, 0.06, '#4a3220', 0, 0.25, cz));
  const wheels = [];
  for (const s of [-1, 1]) {
    const wheel = cartWheel(0.28);
    wheel.position.set(s * 0.45, 0.28, cz);
    g.add(wheel);
    wheels.push(wheel);
  }
  // La carga: sacos de arpillera atados por arriba y un cesto de mimbre
  const sack = (x, y, z, s, c) => {
    const bag = mesh(new THREE.SphereGeometry(0.14, 8, 6), c);
    bag.scale.set(s, s * 1.1, s);
    bag.position.set(x, y, z);
    g.add(bag);
    // La boca fruncida y atada, con la tela abierta en flor por encima
    const neck = mesh(new THREE.ConeGeometry(0.06 * s, 0.09 * s, 6), c);
    neck.position.set(x, y + 0.16 * s, z);
    g.add(neck, cyl(0.028 * s, 0.028 * s, 0.03, 6, '#8a7350', x, y + 0.17 * s, z));
    g.add(cyl(0.05 * s, 0.02 * s, 0.05 * s, 6, c, x, y + 0.19 * s, z));
  };
  sack(-0.14, 0.58, cz - 0.28, 1.0, '#d9c9a3');
  sack(0.15, 0.58, cz - 0.2, 0.95, '#cfbd94');
  sack(0.12, 0.58, cz + 0.22, 1.0, '#d9c9a3');
  sack(0.02, 0.8, cz - 0.05, 0.9, '#e2d4b0');
  g.add(cyl(0.15, 0.12, 0.2, 10, '#b08a4e', -0.13, 0.43, cz + 0.22));
  for (const y of [0.48, 0.56]) g.add(cyl(0.155, 0.155, 0.02, 10, '#8a6a3a', -0.13, y, cz + 0.22));

  // Al andar: giran las ruedas y el buey mueve las patas en diagonal
  let travelled = 0;
  g.userData.roll = (dist, t) => {
    travelled += dist;
    for (const w of wheels) w.rotation.x = travelled / 0.28;
    const k = dist > 0 ? 1 : 0;
    legs.forEach((leg, i) => (leg.rotation.x = k * Math.sin(t * 6 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.4));
  };
  return bakeStatic(g);
}

/** Las banderas (las que ondean con el color principal) toman el color del estandarte del jugador. */
/** Un barco fondeado en `p` (en el agua), de costado respecto a la isla, que se mece con las olas. */
function anchoredShip(type, p, scale, i) {
  const ship = createShip(type);
  ship.position.set(p.x, WATER_Y, p.z);
  // De proa a lo largo de la costa: así se ve de lado desde la isla
  ship.rotation.y = Math.atan2(p.z, -p.x);
  ship.scale.setScalar(scale);
  ship.userData.bob = { amp: 0.1, speed: 1 + i * 0.17, base: WATER_Y };
  return ship;
}

function paintBanner(root, color) {
  if (!color) return;
  const base = mat(C.cloth[0]);
  root.traverse((o) => {
    if (o.isMesh && o.userData.wave && o.material === base) o.material = mat(color);
  });
}
