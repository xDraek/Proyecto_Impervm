import * as THREE from 'three';
import { createBuilding, createShip, createSoldier, cyl, disposeTree } from './models.js';

// Retratos para los menús: el mismo modelo 3D del juego, dibujado una vez en un lienzo aparte
// y guardado como imagen. Si el navegador no puede (sin WebGL), se devuelve null y los menús
// se quedan con el emoji de siempre.

const cache = new Map();
let stage = null;
let failed = false;

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#e8f4ff', '#5a7a3a', 1.4));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 2;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  // Luz de contra para despegar la silueta del fondo
  const rim = new THREE.DirectionalLight('#9fc8ff', 0.9);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 400);
  return { renderer, scene, sun, rim, camera };
}

/** Peana de hierba (edificios) o de piedra (tropas) para que la figura no flote. */
function pedestal(kind, radius) {
  const g = new THREE.Group();
  if (kind === 'ship' || kind === 'dock' || kind === 'island') {
    const sea = cyl(radius, radius, 0.06, 40, '#3f8fc0');
    sea.position.y = -0.05;
    g.add(sea);
    return g;
  }
  const top = kind === 'building' ? '#6fae4a' : '#9a917f';
  const side = kind === 'building' ? '#8a6a46' : '#7d7466';
  const rock = cyl(radius * 0.98, radius, radius * 0.12, 40, side);
  rock.position.y = -radius * 0.06 - 0.02;
  const lawn = cyl(radius * 0.98, radius * 0.98, 0.04, 40, top);
  lawn.position.y = -0.02;
  g.add(rock, lawn);
  return g;
}

function toBlobUrl(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) }));
}

/**
 * Imagen (URL) de un edificio a un nivel, una tropa, un barco o una isla.
 * @param {'building'|'unit'|'ship'|'island'} kind
 * @param {{ level?: number, width?: number, height?: number, model?: () => THREE.Object3D }} opts
 *   model: para las islas, quien construye el modelo (el id debe distinguir su aspecto)
 */
export function portrait(kind, id, { level = 1, width = 320, height = 180, model: build = null } = {}) {
  const key = `${kind}|${id}|${level}|${width}x${height}`;
  if (cache.has(key)) return cache.get(key);
  if (failed) return null;
  let url = null;
  try {
    stage ??= setup();
    const { renderer, scene, sun, rim, camera } = stage;
    const model = build ? build() : kind === 'building' ? createBuilding(id, Math.max(1, level)) : kind === 'ship' ? createShip(id) : createSoldier(id);
    if (kind === 'ship') model.rotation.y = -0.9;
    if (kind === 'unit') model.rotation.y = 0.5;
    const root = new THREE.Group();
    root.add(model);
    root.updateMatrixWorld(true);
    // La caja de lo sólido: los haces de luz, estelas y humos no cuentan para el encuadre
    const box = new THREE.Box3();
    model.traverse((o) => {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.isMesh && o.visible && !m?.transparent) box.expandByObject(o);
    });
    if (box.isEmpty()) box.setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const base = pedestal(id === 'puerto' ? 'dock' : kind, Math.max(size.x, size.z) * (kind === 'building' ? 0.68 : kind === 'ship' ? 1.6 : kind === 'island' ? 0.75 : 0.85));
    base.position.set(center.x, box.min.y, center.z);
    root.add(base);
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(root);

    // Encuadre: desde arriba y en diagonal, como se ve en la isla; se proyectan las esquinas
    // del modelo (no de la peana) y se acerca o aleja la cámara hasta que llene el recuadro
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    camera.aspect = width / height;
    const dir = new THREE.Vector3(0.95, kind === 'building' || kind === 'island' ? 0.7 : 0.5, 1.3).normalize();
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const target = sphere.center.clone();
    let dist = sphere.radius * 4;
    const margin = kind === 'building' || kind === 'island' ? 0.86 : kind === 'ship' ? 1 : 0.95;
    const p = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.near = dist / 30;
      camera.far = dist * 6;
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      camera.updateMatrixWorld();
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const c of corners) {
        p.copy(c).project(camera);
        [x0, x1, y0, y1] = [Math.min(x0, p.x), Math.max(x1, p.x), Math.min(y0, p.y), Math.max(y1, p.y)];
      }
      // Recentrar: mover el objetivo lo que se ha desviado el centro en pantalla
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      target.addScaledVector(right, ((x0 + x1) / 2) * halfH * camera.aspect).addScaledVector(up, ((y0 + y1) / 2) * halfH);
      dist *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / margin;
    }
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);

    const r = sphere.radius;
    sun.position.copy(sphere.center).add(new THREE.Vector3(r * 1.2, r * 2.2, r * 1.6));
    sun.target.position.copy(sphere.center);
    Object.assign(sun.shadow.camera, { left: -r * 1.4, right: r * 1.4, top: r * 1.4, bottom: -r * 1.4, near: 0.1, far: r * 6 });
    sun.shadow.camera.updateProjectionMatrix();
    rim.position.copy(sphere.center).add(new THREE.Vector3(-r * 2, r, -r * 2));

    renderer.setSize(width * 2, height * 2, false);
    renderer.render(scene, camera);
    url = toBlobUrl(renderer.domElement.toDataURL('image/webp', 0.9));
    scene.remove(root);
    disposeTree(root);
  } catch (err) {
    console.warn('No se pudo dibujar el retrato', err);
    failed = true;
  }
  cache.set(key, url);
  return url;
}

/** Retrato en <img> o, si no se puede, el emoji de siempre. */
export function portraitImg(kind, id, fallback, { level, width, height, cls = 'card-art' } = {}) {
  const url = portrait(kind, id, { level, width, height });
  return url ? `<img class="${cls}" src="${url}" alt="" draggable="false" />` : `<span class="card-icon">${fallback}</span>`;
}

/**
 * Dibuja los retratos poco a poco cuando el navegador está libre, para que los menús
 * se abran al momento. `jobs` es una lista de [kind, id, opciones].
 */
export function warmPortraits(jobs) {
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 60));
  const queue = [...jobs];
  const step = (deadline) => {
    while (queue.length && deadline.timeRemaining() > 6) {
      const [kind, id, opts] = queue.shift();
      portrait(kind, id, opts);
    }
    if (queue.length && !failed) idle(step);
  };
  idle(step);
}
