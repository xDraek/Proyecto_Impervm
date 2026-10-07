import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { BUILDINGS, BUILDING_KEYS } from '../game/data.js';
import { C, box, createBuilding, createScaffold, cyl, disposeTree, mat } from './models.js';

const SKY_TOP = '#4a9be0';
const HORIZON = '#cfe8f7';
const WATER_Y = -0.7;
const RING_RADIUS = 7.6;

// Disposición de la isla: el ayuntamiento en el centro, el resto en anillo.
// Ángulo 0 = hacia la cámara (+Z).
const SLOT_ANGLES = { mercado: 0, almacen: 72, aserradero: 144, cantera: 216, mina: 288 };
const MOUNTAINS = [
  { angle: 252, r: 10.6, radius: 3.2, height: 5.8 },
  { angle: 232, r: 11.9, radius: 2.0, height: 3.6 },
  { angle: 272, r: 12.0, radius: 1.8, height: 3.0 },
];

function polar(r, deg) {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(r * Math.sin(a), 0, r * Math.cos(a));
}

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
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
    this.selected = null;
    this.hovered = null;
    this.animated = [];
    this.clouds = [];

    this.#setupRenderer();
    this.#setupScene();
    this.#buildIsland();
    this.#buildSlots();
    this.#buildClouds();
    this.#setupInput();
    this.sync();

    game.addEventListener('change', () => this.sync());
  }

  get slotIds() {
    return BUILDING_KEYS;
  }

  slotPosition(id) {
    return this.slots[id].pos.clone();
  }

  select(id) {
    this.selected = id;
    this.selectRing.visible = !!id;
    if (id) {
      const p = this.slots[id].pos;
      this.selectRing.position.set(p.x, 0.16, p.z);
      this.focusTarget = p.clone();
    }
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

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);
    this.camera.position.set(20, 21, 27);

    const controls = new OrbitControls(this.camera, r.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 12;
    controls.maxDistance = 60;
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
      controls.maxDistance = 90;
      this.camera.position.multiplyScalar(1 / this.camera.aspect ** 0.75);
    }
  }

  #setupScene() {
    const scene = new THREE.Scene();
    this.scene = scene;

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(1, HORIZON);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    const sky = new THREE.CanvasTexture(canvas);
    sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = sky;
    scene.fog = new THREE.Fog(HORIZON, 70, 210);

    scene.add(new THREE.HemisphereLight('#dff1ff', '#5a7a3a', 1.3));
    const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
    sun.position.set(22, 38, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 100 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);

    // Mar con oleaje low-poly (los vértices se mueven en CPU)
    const waterGeo = new THREE.PlaneGeometry(320, 320, 90, 90);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterBase = Float32Array.from(waterGeo.attributes.position.array);
    this.water = new THREE.Mesh(
      waterGeo,
      new THREE.MeshStandardMaterial({
        color: '#2f8fc4',
        flatShading: true,
        roughness: 0.35,
        metalness: 0.05,
        transparent: true,
        opacity: 0.92,
      }),
    );
    this.water.position.y = WATER_Y;
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  #buildIsland() {
    const scene = this.scene;

    // Meseta de hierba con acantilados
    const geo = new THREE.CylinderGeometry(13, 11.5, 2.2, 36, 2).toNonIndexed();
    geo.translate(0, -1.1, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-3) continue;
      const k = 1 + (hash(Math.round(x * 10), Math.round(y * 10), Math.round(z * 10)) - 0.5) * (y > -0.01 ? 0.08 : 0.16);
      pos.setXYZ(i, x * k, y, z * k);
    }
    this.#paintByNormal(geo, (ny, cy) => (ny > 0.7 ? '#6fae4a' : cy > -0.8 ? '#8a6a46' : '#7c7466'));
    const island = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    island.receiveShadow = true;
    island.castShadow = true;
    scene.add(island);

    // Playa
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(15.4, 17, 1.6, 40), mat('#e8d49a'));
    sand.position.y = -0.5 - 0.8;
    sand.receiveShadow = true;
    scene.add(sand);

    // Plaza central y caminos hacia cada parcela
    const plaza = cyl(3.4, 3.4, 0.04, 28, '#cbbfa8');
    plaza.castShadow = false;
    scene.add(plaza);
    for (const deg of Object.values(SLOT_ANGLES)) {
      const mid = polar((3.2 + RING_RADIUS - 2.2) / 2, deg);
      const path = box(1.0, 0.03, RING_RADIUS - 2.2 - 3.2 + 0.4, '#c9b48a', mid.x, 0, mid.z);
      path.rotation.y = THREE.MathUtils.degToRad(deg);
      path.castShadow = false;
      scene.add(path);
    }

    // Montañas detrás de la cantera
    for (const m of MOUNTAINS) {
      const mg = new THREE.ConeGeometry(m.radius, m.height, 7, 3);
      const mp = mg.attributes.position;
      const half = m.height / 2;
      for (let i = 0; i < mp.count; i++) {
        const y = mp.getY(i);
        if (y <= -half + 1e-3 || y >= half - 1e-3) continue;
        const x = mp.getX(i);
        const z = mp.getZ(i);
        const hx = Math.round(x * 10);
        const hy = Math.round(y * 10);
        const hz = Math.round(z * 10);
        const k = 1 + (hash(hx, hy, m.angle) - 0.5) * 0.35;
        mp.setXYZ(i, x * k, y + (hash(hx, hy, hz) - 0.5) * 0.3, z * k);
      }
      const geoM = mg.toNonIndexed();
      geoM.translate(0, half - 0.05, 0);
      this.#paintByNormal(geoM, (ny, cy) => (cy > m.height * 0.72 ? '#f4f6f8' : ny > 0.75 ? '#7d9a52' : '#8c8780'));
      const mountain = new THREE.Mesh(geoM, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
      mountain.position.copy(polar(m.r, m.angle));
      mountain.castShadow = mountain.receiveShadow = true;
      scene.add(mountain);
    }

    // Bosque y rocas, evitando parcelas, montañas y la plaza
    const rand = rng(7);
    const blockers = [
      { p: new THREE.Vector3(), r: 4.2 },
      ...Object.values(SLOT_ANGLES).map((deg) => ({ p: polar(RING_RADIUS, deg), r: 3.6 })),
      ...MOUNTAINS.map((m) => ({ p: polar(m.r, m.angle), r: m.radius + 0.6 })),
    ];
    const free = (p) => blockers.every((b) => b.p.distanceTo(p) > b.r);
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.6, 6);
    const leafGeo = new THREE.ConeGeometry(0.75, 1.5, 7);
    const leafColors = ['#3f8a3a', '#4f9a3a', '#2f7a43'];
    let trees = 0;
    for (let tries = 0; tries < 400 && trees < 40; tries++) {
      const p = polar(3.5 + rand() * 8.8, rand() * 360);
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
    for (let i = 0, placed = 0; i < 200 && placed < 14; i++) {
      const p = polar(4 + rand() * 9, rand() * 360);
      if (!free(p)) continue;
      const rock = new THREE.Mesh(rockGeo, mat(C.stone));
      rock.position.set(p.x, 0.1, p.z);
      rock.scale.set(0.6 + rand(), 0.5 + rand() * 0.5, 0.6 + rand());
      rock.castShadow = rock.receiveShadow = true;
      scene.add(rock);
      placed++;
    }
  }

  #paintByNormal(geo, pick) {
    geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      col.set(pick(n.y, (a.y + b.y + c.y) / 3));
      for (let k = 0; k < 3; k++) col.toArray(colors, (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  #buildSlots() {
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.hitTargets = [];

    for (const id of BUILDING_KEYS) {
      const pos = id === 'ayuntamiento' ? new THREE.Vector3() : polar(RING_RADIUS, SLOT_ANGLES[id]);
      const root = new THREE.Group();
      root.position.copy(pos);
      // Que los edificios miren hacia la plaza
      if (id !== 'ayuntamiento') root.rotation.y = Math.atan2(-pos.x, -pos.z);
      else root.rotation.y = 0;
      this.scene.add(root);

      if (id !== 'ayuntamiento') {
        const plot = cyl(2.3, 2.4, 0.12, 28, C.dirt);
        plot.castShadow = false;
        root.add(plot);
      }

      const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 5, 12), hitMat);
      hit.position.y = 2.5;
      hit.userData.slot = id;
      root.add(hit);
      this.hitTargets.push(hit);

      const el = document.createElement('div');
      el.className = 'label';
      el.innerHTML = `<span class="label-name">${BUILDINGS[id].name}</span><span class="label-lvl"></span><span class="label-bar"><i></i></span>`;
      const label = new CSS2DObject(el);
      this.scene.add(label);

      this.slots[id] = { id, pos, root, label, el, key: null, building: null, scaffold: null, pop: 1 };
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

  #buildClouds() {
    const rand = rng(42);
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.95 });
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < puffs; k++) {
        const puff = new THREE.Mesh(geo, material);
        puff.position.set(k * 1.3 - puffs * 0.6, rand() * 0.6, (rand() - 0.5) * 1.2);
        puff.scale.setScalar(1 + rand() * 0.9);
        cloud.add(puff);
      }
      cloud.position.set((rand() - 0.5) * 140, 16 + rand() * 10, (rand() - 0.5) * 100);
      cloud.userData.speed = 0.8 + rand() * 1.2;
      this.scene.add(cloud);
      this.clouds.push(cloud);
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

  // ── Sincronización con la partida ──────────────────────────────────────────

  sync() {
    const q = this.game.queue;
    for (const id of BUILDING_KEYS) {
      const slot = this.slots[id];
      const level = this.game.level(id);
      const building = q?.id === id;
      const key = `${level}|${building}`;
      if (slot.key === key) continue;
      const leveledUp = slot.key !== null && Number(slot.key.split('|')[0]) < level;
      slot.key = key;

      if (slot.building) {
        slot.root.remove(slot.building);
        disposeTree(slot.building);
      }
      if (slot.scaffold) {
        slot.root.remove(slot.scaffold);
        disposeTree(slot.scaffold);
        slot.scaffold = null;
      }

      slot.building = createBuilding(id, level);
      slot.building.position.y = id === 'ayuntamiento' ? 0.04 : 0.12;
      slot.baseScale = slot.building.scale.x;
      slot.root.add(slot.building);
      const height = new THREE.Box3().setFromObject(slot.building).max.y;

      if (building) {
        slot.scaffold = createScaffold(level > 0 ? height - 0.2 : 2.2);
        slot.scaffold.position.y = 0.12;
        slot.root.add(slot.scaffold);
      }
      if (leveledUp) slot.pop = 0;

      slot.label.position.set(slot.pos.x, Math.max(height, building ? 2.6 : 0) + 0.9, slot.pos.z);
      slot.el.querySelector('.label-lvl').textContent = level > 0 ? `Nv ${level}` : 'Parcela libre';
      slot.el.classList.toggle('building', building);
      slot.el.classList.toggle('empty', level === 0);

      this.#collectAnimated();
    }
  }

  #collectAnimated() {
    this.animated = [];
    for (const slot of Object.values(this.slots)) {
      for (const part of [slot.building, slot.scaffold]) {
        part?.traverse((o) => {
          if (o.userData.spin || o.userData.swing || o.userData.wave) this.animated.push(o);
        });
      }
    }
  }

  // ── Bucle ─────────────────────────────────────────────────────────────────

  update(dt, t) {
    // Encuadrar el edificio seleccionado moviendo cámara y objetivo a la vez
    if (this.focusTarget) {
      const target = this.controls.target;
      const step = this.focusTarget.clone().sub(target).multiplyScalar(1 - Math.exp(-dt * 4));
      target.add(step);
      this.camera.position.add(step);
      if (target.distanceTo(this.focusTarget) < 0.01) this.focusTarget = null;
    }
    this.controls.update(dt);

    // Oleaje
    const pos = this.water.geometry.attributes.position;
    const base = this.waterBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      pos.array[i * 3 + 1] = Math.sin(x * 0.18 + t * 1.1) * 0.16 + Math.cos(z * 0.23 + t * 0.8) * 0.14;
    }
    pos.needsUpdate = true;

    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > 80) cloud.position.x = -80;
    }

    for (const o of this.animated) {
      const { spin, swing, wave } = o.userData;
      if (spin) o.rotation[spin.axis] += spin.speed * dt;
      if (swing) o.rotation.y = Math.sin(t * swing.speed) * swing.amp;
      if (wave) o.rotation.y = Math.sin(t * 3) * 0.3;
    }

    // Progreso de la obra en la etiqueta
    const q = this.game.queue;
    for (const slot of Object.values(this.slots)) {
      if (slot.pop < 1) {
        slot.pop = Math.min(1, slot.pop + dt * 2.5);
        slot.building.scale.setScalar(slot.baseScale * (1 + Math.sin(slot.pop * Math.PI) * 0.18));
      }
      if (q?.id === slot.id) {
        const p = Math.min(1, (Date.now() - q.start) / (q.end - q.start));
        slot.el.querySelector('.label-bar i').style.width = `${(p * 100).toFixed(1)}%`;
      }
    }

    this.selectRing.material.opacity = 0.65 + Math.sin(t * 4) * 0.3;
    const showHover = this.hovered && this.hovered !== this.selected;
    this.hoverRing.visible = !!showHover;
    if (showHover) {
      const p = this.slots[this.hovered].pos;
      this.hoverRing.position.set(p.x, 0.15, p.z);
    }

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
