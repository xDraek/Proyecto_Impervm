import { hashString, rng } from './util.js';

// Contornos de isla. Cada costa es una serie de Fourier corta:
//   radio(θ) = R · forma(θ),   forma(θ) = 1 + Σ a_k · cos(kθ + p_k),  k = 1..4
// con θ medido como en `polar` (0 hacia +Z, θ = atan2(x, z)). Así salen salientes, bahías y
// cabos que parecen de verdad, y la misma forma sirve para el relieve, la playa y la espuma
// del agua (que se calcula en la GPU con estos ocho números).

const AMPS = [0.035, 0.1, 0.065, 0.04];

/** Forma al azar (pero siempre la misma para la misma semilla). `rough` la hace más o menos irregular. */
export function coastFromSeed(seed, rough = 1) {
  const rand = rng(seed);
  return AMPS.map((m) => ({ a: m * (0.55 + rand() * 0.9) * rough, p: rand() * Math.PI * 2 }));
}

/** Forma que mejor se ajusta a una silueta dada por radios relativos repartidos en el círculo. */
export function coastFromSamples(samples) {
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  return [1, 2, 3, 4].map((k) => {
    let re = 0;
    let im = 0;
    samples.forEach((s, i) => {
      const th = (i / n) * Math.PI * 2;
      re += s * Math.cos(k * th);
      im -= s * Math.sin(k * th);
    });
    return { a: ((2 / n) * Math.hypot(re, im)) / mean, p: Math.atan2(im, re) };
  });
}

/** Factor del radio en la dirección θ (radianes). */
export function coastFactor(h, theta) {
  let f = 1;
  for (let i = 0; i < h.length; i++) f += h[i].a * Math.cos((i + 1) * theta + h[i].p);
  return f;
}

/** Cotas del factor (para reservar sitio y no pisar otras islas). */
export function coastMax(h) {
  return 1 + h.reduce((a, x) => a + x.a, 0);
}

export function coastMin(h) {
  return 1 - h.reduce((a, x) => a + x.a, 0);
}

const memo = new Map();

/** La forma de una isla del mapa: los continentes salen de su silueta guardada; las ciudades, más redondas. */
export function islandCoast(isl) {
  if (memo.has(isl.id)) return memo.get(isl.id);
  let h;
  if (isl.type === 'continente' && isl.shape?.length) h = coastFromSamples(isl.shape);
  else h = coastFromSeed(hashString(String(isl.id)), isl.type === 'jugador' ? 0.7 : 1.15);
  memo.set(isl.id, h);
  return h;
}

/**
 * Deforma una geometría centrada en el origen: escala x y z de cada vértice por el factor de su
 * dirección. `h` es una forma (coastFactor) o una función θ → factor.
 */
export function shapeGeometry(geo, h) {
  const factor = typeof h === 'function' ? h : (theta) => coastFactor(h, theta);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (Math.hypot(x, z) < 1e-4) continue;
    const f = factor(Math.atan2(x, z));
    pos.setX(i, x * f);
    pos.setZ(i, z * f);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
