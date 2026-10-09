// Sonido con Web Audio: la música de fondo y las gaviotas son pistas grabadas
// (public/audio); el mar, la lluvia y los efectos se sintetizan al momento.
// El navegador no deja sonar nada hasta que el jugador interactúa, así que el
// contexto se crea en el primer clic o tecla.

const MUTE_KEY = 'imperium.muted';
const MUSIC_KEY = 'imperium.music';
const MUSIC_VOLUME_KEY = 'imperium.musicVolume';
// Volumen de la música a tope (el deslizador va de 0 a 1 sobre esto)
const MUSIC_MAX = 0.65;

let ctx = null;
let master = null;
let ambience = null;
let muted = readMuted();

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
  if (musicOn()) startMusic();
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
}

// ── Gaviotas: la pista suena más o menos según las que pasen sobre la isla ────

let gullTrack = null;

/** Pista grabada en bucle que pasa por el volumen general (y se calla con el silencio). */
function track(url, volume) {
  const el = new Audio(url);
  el.loop = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  const gain = ctx.createGain();
  gain.gain.value = 0;
  ctx.createMediaElementSource(el).connect(gain).connect(master);
  return { el, gain, volume, playing: false };
}

function fade(t, level, seconds) {
  t.gain.gain.setTargetAtTime(level, ctx.currentTime, seconds);
  if (level > 0.001 && !t.playing) {
    t.playing = true;
    t.el.play().catch(() => (t.playing = false));
  }
}

/**
 * Cuántas gaviotas se oyen (de 0 a 1): la escena lo calcula según las que vuelan sobre
 * la isla cerca de donde miras. En el mapa, 0.
 */
export function setGulls(k) {
  if (!ctx || document.hidden) return;
  gullTrack ??= track('/audio/gaviotas.mp3', 0.55);
  const level = Math.max(0, Math.min(1, k)) * gullTrack.volume;
  fade(gullTrack, level, 1.2);
  // Sin gaviotas cerca, la pista se para del todo (no gasta nada)
  if (level < 0.001 && gullTrack.playing) {
    clearTimeout(gullTrack.stop);
    gullTrack.stop = setTimeout(() => {
      if (gullTrack.gain.gain.value < 0.002) {
        gullTrack.el.pause();
        gullTrack.playing = false;
      }
    }, 5000);
  }
}

// ── Música: el tema de Imperium en bucle ────────────────────────────────────

let music = null;

/** Volumen de la música elegido por el jugador, de 0 a 1 (por defecto, el de siempre). */
export function musicVolume() {
  try {
    const v = Number(localStorage.getItem(MUSIC_VOLUME_KEY));
    return localStorage.getItem(MUSIC_VOLUME_KEY) === null || !Number.isFinite(v) ? 0.7 : Math.max(0, Math.min(1, v));
  } catch {
    return 0.7;
  }
}

/** Sube o baja la música (0 a 1) al momento, con un fundido corto. */
export function setMusicVolume(v) {
  v = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(MUSIC_VOLUME_KEY, String(v));
  } catch {
    // sin almacenamiento: solo esta sesión
  }
  if (music) {
    music.volume = v * MUSIC_MAX;
    if (musicOn() && music.playing) music.gain.gain.setTargetAtTime(music.volume, ctx.currentTime, 0.08);
  }
}

export function musicOn() {
  try {
    return localStorage.getItem(MUSIC_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setMusic(on) {
  try {
    localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
  } catch {
    // sin almacenamiento: solo esta sesión
  }
  if (on) {
    ensure();
    startMusic();
  } else stopMusic();
}

function startMusic() {
  if (!ctx) return;
  music ??= track('/audio/tema.mp3', musicVolume() * MUSIC_MAX);
  fade(music, music.volume, 2);
}

function stopMusic() {
  if (!music) return;
  fade(music, 0, 0.6);
  const m = music;
  setTimeout(() => {
    if (!musicOn()) {
      m.el.pause();
      m.playing = false;
    }
  }, 3000);
}

// Con la pestaña en segundo plano, la música se pausa (y vuelve al volver)
document.addEventListener('visibilitychange', () => {
  if (!music) return;
  if (document.hidden) {
    music.el.pause();
    music.playing = false;
  } else if (musicOn()) fade(music, music.volume, 1);
});

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

/** Un metal (trompa o trompeta): diente de sierra con filtro que se abre al atacar la nota. */
function brass(freq, start, dur, vol = 0.07) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq * 0.985, start);
  osc.frequency.exponentialRampToValueAtTime(freq, start + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(freq * 1.2, start);
  filter.frequency.exponentialRampToValueAtTime(freq * 5, start + 0.06);
  filter.frequency.exponentialRampToValueAtTime(freq * 2.2, start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.03);
  g.gain.setTargetAtTime(vol * 0.7, start + 0.06, 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(filter).connect(g).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Campana: parciales inarmónicos que se apagan despacio. */
function bell(freq, start, vol = 0.08) {
  [[1, 1], [2.76, 0.45], [5.4, 0.22], [0.5, 0.3]].forEach(([k, a]) => tone(freq * k, start, 1.6 / Math.sqrt(k), { vol: vol * a }));
}

const SOUNDS = {
  /** Misión o encargo cumplido: una fanfarria corta de metales, inconfundible. */
  fanfare: (t) => {
    brass(392, t, 0.16);
    brass(392, t + 0.15, 0.12);
    brass(523, t + 0.28, 0.16);
    brass(659, t + 0.43, 0.16);
    brass(784, t + 0.58, 0.75, 0.08);
    brass(523, t + 0.58, 0.75, 0.04);
    [1568, 2093, 2637].forEach((f, i) => tone(f, t + 0.62 + i * 0.05, 0.6, { vol: 0.025 }));
  },
  /** Obra o investigación terminada: dos campanadas. */
  bell: (t) => {
    bell(660, t);
    bell(990, t + 0.22, 0.06);
  },
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
