import * as THREE from 'three';

// Mar estilizado. Las olas y el color se calculan en la GPU:
// - La malla es más densa cerca del centro (donde mira la cámara casi siempre)
//   y más gruesa lejos, para tener facetas pequeñas sin millones de vértices.
// - Junto a la orilla las olas se calman, así nunca suben por encima de la
//   playa, y aparece agua clara poco profunda con espuma que va y viene.

export const MAX_SHORES = 24;
const SIZE = 900; // mitad del lado
const SEGMENTS = 320;

/** Reparte los vértices: 0,8 de separación en el centro, varias unidades en los bordes. */
function remap(u) {
  const a = Math.abs(u);
  return Math.sign(u) * SIZE * (0.15 * a + 0.85 * a ** 2.2);
}

/**
 * @param {{ x: number, z: number, r: number }[]} shores  islas: centro y radio de la orilla
 */
export function createWater(shores, level) {
  const geo = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, remap(pos.getX(i)), 0, remap(pos.getZ(i)));
  geo.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uShores: { value: Array.from({ length: MAX_SHORES }, (_, i) => new THREE.Vector3(shores[i]?.x ?? 1e5, shores[i]?.z ?? 1e5, shores[i]?.r ?? 0)) },
    uDeep: { value: new THREE.Color('#1f6fa8') },
    uShallow: { value: new THREE.Color('#3fc1c9') },
    uFoam: { value: new THREE.Color('#f4fbff') },
  };

  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    flatShading: true,
    roughness: 0.32,
    metalness: 0.05,
    transparent: true,
    opacity: 0.9,
  });

  const common = /* glsl */ `
    uniform float uTime;
    uniform vec3 uShores[${MAX_SHORES}];
    varying vec3 vWaterPos;
    float shoreDistance(vec2 p) {
      float d = 1e5;
      for (int i = 0; i < ${MAX_SHORES}; i++) d = min(d, length(p - uShores[i].xy) - uShores[i].z);
      return d;
    }
  `;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = common + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      vec2 p = position.xz;
      float calm = smoothstep(0.0, 10.0, shoreDistance(p));
      float wave = sin(p.x * 0.21 + uTime * 1.1) * 0.12
                 + cos(p.y * 0.17 - uTime * 0.9) * 0.10
                 + sin((p.x + p.y) * 0.11 + uTime * 0.7) * 0.08;
      transformed.y += wave * (0.3 + 0.7 * calm);
      vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader =
      /* glsl */ `
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      ` +
      common +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float d = shoreDistance(vWaterPos.xz);
        // Agua clara y poco profunda junto a la playa
        float shallow = 1.0 - smoothstep(0.0, 16.0, d);
        vec3 water = mix(uDeep, uShallow, shallow * shallow);
        // Espuma: una franja pegada a la arena y ondas que llegan a la orilla
        float edge = 1.0 - smoothstep(0.15, 1.1, d);
        // Ruido de baja frecuencia para que las ondas lleguen a trozos y no en anillos perfectos
        float n = sin(vWaterPos.x * 0.31 + uTime * 0.4) * sin(vWaterPos.z * 0.27 - uTime * 0.3)
                + 0.5 * sin((vWaterPos.x - vWaterPos.z) * 0.13 + uTime * 0.25);
        float breakUp = smoothstep(-0.2, 0.7, n);
        float ripple = smoothstep(0.82, 1.0, sin(d * 1.4 - uTime * 1.6)) * (1.0 - smoothstep(1.0, 7.0, d)) * breakUp;
        float foam = clamp(max(edge, ripple * 0.85), 0.0, 1.0);
        diffuseColor.rgb = mix(water, uFoam, foam);
        diffuseColor.a = mix(diffuseColor.a, 1.0, foam);`,
      );
  };
  // Que three.js no reutilice el programa de otro material estándar
  material.customProgramCacheKey = () => 'imperium-water';

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = level;
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

/** Cambia las orillas (con espuma) que tiene en cuenta el mar: las más cercanas. */
export function setShores(mesh, shores) {
  const list = mesh.userData.uniforms.uShores.value;
  for (let i = 0; i < MAX_SHORES; i++) {
    const s = shores[i];
    list[i].set(s?.x ?? 1e5, s?.z ?? 1e5, s?.r ?? 0);
  }
}
