import * as THREE from 'three';

/** Punto en el plano del mar a `r` del origen. Ángulo 0 = hacia +Z. */
export function polar(r, deg, y = 0) {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(r * Math.sin(a), y, r * Math.cos(a));
}

export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Colorea cada triángulo según la inclinación de su cara y su altura media. */
export function paintByNormal(geo, pick) {
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

/** Meseta low-poly con bordes irregulares, con la cara superior en y = top. */
export function plateauGeometry(rTop, rBottom, height, segments, seed, top = 0) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, height, segments, 2).toNonIndexed();
  geo.translate(0, top - height / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.hypot(x, z) < 1e-3) continue;
    const isTop = y > top - 0.01;
    const k = 1 + (hash(Math.round(x * 10), Math.round(y * 10) + seed, Math.round(z * 10)) - 0.5) * (isTop ? 0.08 : 0.16);
    pos.setXYZ(i, x * k, y, z * k);
  }
  return geo;
}

/** Montaña cónica deformada (base en y = 0). */
export function mountainGeometry(radius, height, seed, colors) {
  const mg = new THREE.ConeGeometry(radius, height, 7, 3);
  const mp = mg.attributes.position;
  const half = height / 2;
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    if (y <= -half + 1e-3 || y >= half - 1e-3) continue;
    const x = mp.getX(i);
    const z = mp.getZ(i);
    const hx = Math.round(x * 10);
    const hy = Math.round(y * 10);
    const hz = Math.round(z * 10);
    const k = 1 + (hash(hx, hy, seed) - 0.5) * 0.35;
    mp.setXYZ(i, x * k, y + (hash(hx, hy, hz) - 0.5) * 0.3, z * k);
  }
  const geo = mg.toNonIndexed();
  geo.translate(0, half - 0.05, 0);
  paintByNormal(geo, (ny, cy) => (cy > height * 0.72 ? colors.snow : ny > 0.75 ? colors.grass : colors.rock));
  return geo;
}
