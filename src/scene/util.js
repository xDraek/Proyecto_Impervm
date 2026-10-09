import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

/**
 * Junta muchas piezas estáticas (árboles, casas, rocas…) en una o dos mallas:
 * cada pieza guarda su color en los vértices, así que se dibujan de una vez.
 * Las ventanas que se encienden de noche van en una malla aparte con su material.
 */
export class Batch {
  constructor(glowMaterial = null) {
    this.colored = [];
    this.glow = [];
    this.glowMaterial = glowMaterial;
  }

  /** Añade un objeto (malla o grupo) tal como está colocado. */
  add(obj) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      // Piezas que ya traen su color por vértice (cascos de barco, figuras horneadas…): se respeta
      const own = o.material.vertexColors ? g.attributes.color : null;
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      g.applyMatrix4(o.matrixWorld);
      if (this.glowMaterial && o.material === this.glowMaterial) {
        this.glow.push(g);
        return;
      }
      const c = o.material.color ?? new THREE.Color('#ffffff');
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        if (own) {
          colors[i * 3] = own.getX(i) * c.r;
          colors[i * 3 + 1] = own.getY(i) * c.g;
          colors[i * 3 + 2] = own.getZ(i) * c.b;
        } else c.toArray(colors, i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.colored.push(g);
    });
    obj.traverse((o) => o.geometry?.dispose());
    return this;
  }

  /** La malla (o mallas) resultante. */
  build({ shadows = true } = {}) {
    const group = new THREE.Group();
    if (this.colored.length) {
      const m = new THREE.Mesh(mergeGeometries(this.colored), batchMaterial());
      m.castShadow = m.receiveShadow = shadows;
      group.add(m);
    }
    if (this.glow.length) {
      const m = new THREE.Mesh(mergeGeometries(this.glow), this.glowMaterial);
      m.castShadow = shadows;
      group.add(m);
    }
    for (const g of [...this.colored, ...this.glow]) g.dispose();
    this.colored = [];
    this.glow = [];
    return group;
  }
}

let sharedBatchMaterial = null;
function batchMaterial() {
  return (sharedBatchMaterial ??= surfaceDetail(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }), 'batch'));
}

/**
 * Detalle de superficie sin texturas, calculado en la GPU a partir de la posición en el mundo:
 * veta en todo (piedra, madera, hierba), hiladas de sillares en los muros claros y filas de tejas
 * en los tejados de terracota. Se desvanece con la distancia para que no parpadee.
 * `kind` distingue el programa en la caché de three.js.
 */
export function surfaceDetail(material, kind, { masonry = true } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vDetailPos;
        float dHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float dNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        // 0 sobre la línea y 1 fuera, con antialias; se borra cuando las líneas son más finas que un píxel
        float dLine(float x, float w) {
          float aa = fwidth(x);
          float fx = fract(x);
          float d = min(fx, 1.0 - fx);
          return mix(smoothstep(w, w + aa * 1.5, d), 1.0, smoothstep(0.25, 0.6, aa));
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec3 fn = normalize(cross(dFdx(vDetailPos), dFdy(vDetailPos)));
          vec3 base = diffuseColor.rgb;
          float lum = dot(base, vec3(0.299, 0.587, 0.114));
          float near = 1.0 - smoothstep(45.0, 110.0, distance(cameraPosition, vDetailPos));
          // Veta: dos escalas de ruido
          float grain = dNoise(vDetailPos * 2.3) * 0.6 + dNoise(vDetailPos * 9.0) * 0.4;
          float k = mix(1.0, 0.91 + 0.16 * grain, 0.35 + 0.65 * near);
          vec2 side = normalize(vec2(-fn.z, fn.x) + 1e-5);
          float u = dot(vDetailPos.xz, side);
          bool terracotta = base.r > base.g * 1.3 && base.r > base.b * 1.55 && lum > 0.12;
          #ifdef DETAIL_MASONRY
          if (terracotta && fn.y > 0.15 && fn.y < 0.97) {
            // Tejas: hiladas a lo largo del tejado y canales hacia abajo
            float rows = dLine(vDetailPos.y * 9.0, 0.07);
            float ribs = 0.9 + 0.1 * abs(fract(u * 6.0) - 0.5) * 2.0;
            k *= mix(1.0, mix(0.8, 1.0, rows) * ribs, near);
          } else if (abs(fn.y) < 0.35 && lum > 0.55) {
            // Muros claros: sillares con juntas, cada hilada desplazada media pieza
            float row = vDetailPos.y * 4.2;
            float joints = dLine(row, 0.04) * dLine(u * 1.9 + floor(row) * 0.5, 0.03);
            k *= mix(1.0, mix(0.86, 1.0, joints), near);
          }
          #endif
          diffuseColor.rgb *= k;
        }`,
      );
    if (masonry) shader.defines = { ...(shader.defines ?? {}), DETAIL_MASONRY: '' };
  };
  material.customProgramCacheKey = () => `imperium-detail-${kind}`;
  return material;
}

const ANIMATED = ['spin', 'swing', 'wave', 'smoke', 'flicker', 'bob', 'wiggle', 'sparks'];

/**
 * Funde en una sola malla las piezas de `root` que no se mueven ni brillan
 * (las ventanas que se encienden de noche van en otra). Lo animado, lo
 * transparente y lo que emite luz se queda como estaba. Devuelve `root`.
 */
export function bakeStatic(root, glowMaterial = null) {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const batch = new Batch(glowMaterial);
  const baked = [];
  const visit = (obj) => {
    if (obj !== root && ANIMATED.some((k) => obj.userData[k])) return;
    if (obj.isMesh) {
      const m = obj.material;
      const keep = Array.isArray(m) || m.transparent || (m.vertexColors && !obj.geometry.attributes.color) || (m !== glowMaterial && m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0);
      if (!keep) baked.push(obj);
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);
  if (baked.length < 2) return root;
  for (const mesh of baked) {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    if (glowMaterial && mesh.material === glowMaterial) batch.glow.push(g);
    else if (mesh.material.vertexColors) {
      // Ya trae sus colores por vértice (relieve, montes, piezas ya fundidas)
      const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      g.setAttribute('color', src.attributes.color.clone());
      batch.colored.push(g);
    } else {
      const c = mesh.material.color;
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      batch.colored.push(g);
    }
    mesh.geometry.dispose();
    mesh.parent.remove(mesh);
  }
  const merged = batch.build();
  // El grupo fundido va en el origen de `root`, que ya tiene su posición y escala
  root.add(...merged.children);
  return root;
}
