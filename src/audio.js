// Sonido sintetizado con Web Audio: no hay archivos que cargar.
// El navegador no deja sonar nada hasta que el jugador interactúa, así que el
// contexto se crea en el primer clic o tecla.

const MUTE_KEY = 'imperium.muted';

let ctx = null;
let master = null;
let ambience = null;
let muted = readMuted();
let gullTimer = null;

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  startAmbience();
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c?.state === 'suspended') c.resume();
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // sin almacenamiento: no pasa nada
  }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.1);
}

// ── Ambiente: oleaje y gaviotas ──────────────────────────────────────────────

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // Ruido marrón: más grave y suave que el blanco, suena a mar
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function startAmbience() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(6);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  const gain = ctx.createGain();
  gain.gain.value = 0.18;
  // Las olas van y vienen
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.1;
  lfo.connect(lfoGain).connect(gain.gain);
  src.connect(filter).connect(gain).connect(master);
  src.start();
  lfo.start();
  ambience = gain;
  scheduleGull();
}

function scheduleGull() {
  clearTimeout(gullTimer);
  gullTimer = setTimeout(() => {
    if (!document.hidden) gull();
    scheduleGull();
  }, 7000 + Math.random() * 14000);
}

function gull() {
  const t = ctx.currentTime;
  const calls = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < calls; i++) {
    const start = t + i * 0.22;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1500, start);
    osc.frequency.exponentialRampToValueAtTime(900, start + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.035, start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + 0.2);
  }
}

// ── Lluvia y truenos ─────────────────────────────────────────────────────────

let rain = null;

/** Intensidad de la lluvia (0 a 1): un siseo de ruido blanco filtrado. */
export function setRain(k) {
  if (!ctx) return;
  if (!rain) {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.6;
    rain = ctx.createGain();
    rain.gain.value = 0;
    src.connect(filter).connect(rain).connect(master);
    src.start();
  }
  rain.gain.setTargetAtTime(0.09 * k, ctx.currentTime, 1.5);
}

/** Un trueno lejano: un golpe grave de ruido que se apaga despacio. */
export function thunder(power = 1) {
  if (!ctx || muted || document.hidden) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(3);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, t);
  filter.frequency.exponentialRampToValueAtTime(120, t + 2.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 * power, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + 3);
}

/** El ambiente baja en el mapa (estás lejos de la orilla). */
export function setAmbienceLevel(k) {
  if (ambience) ambience.gain.setTargetAtTime(0.18 * k, ctx.currentTime, 0.5);
}

// ── Efectos ──────────────────────────────────────────────────────────────────

function tone(freq, start, dur, { type = 'sine', vol = 0.15, slide = 0 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

const SOUNDS = {
  click: (t) => tone(660, t, 0.06, { type: 'triangle', vol: 0.06 }),
  build: (t) => {
    tone(220, t, 0.09, { type: 'square', vol: 0.05 });
    tone(196, t + 0.12, 0.09, { type: 'square', vol: 0.05 });
  },
  success: (t) => [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.09, 0.35, { vol: 0.09 })),
  coins: (t) => [1320, 1760, 1480].forEach((f, i) => tone(f, t + i * 0.06, 0.15, { type: 'triangle', vol: 0.06 })),
  error: (t) => tone(180, t, 0.25, { type: 'sawtooth', vol: 0.05, slide: 0.7 }),
  horn: (t) => {
    tone(110, t, 1.1, { type: 'sawtooth', vol: 0.08 });
    tone(165, t, 1.1, { type: 'sawtooth', vol: 0.04 });
  },
  magic: (t) => [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.5, { vol: 0.06 })),
  sail: (t) => tone(300, t, 0.5, { type: 'sine', vol: 0.06, slide: 1.6 }),
};

export function play(name) {
  if (!ctx || muted) return;
  SOUNDS[name]?.(ctx.currentTime);
}
