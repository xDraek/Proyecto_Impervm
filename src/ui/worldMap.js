import { ISLAND_TYPES, UNITS } from '../game/data.js';
import { travelSeconds } from '../game/rules.js';
import { escapeHtml, fmtNum, fmtTime } from './format.js';

// Mapa de todo el archipiélago: las ciudades de todos los jugadores y las
// islas de cada sector, en un lienzo que se arrastra y se acerca con la rueda.

const REL = {
  yo: { color: '#f2c94c', name: 'Tu ciudad' },
  aliado: { color: '#8fd18a', name: 'Tu alianza' },
  pacto: { color: '#6fb6ff', name: 'Pacto' },
  guerra: { color: '#ff6b5b', name: 'En guerra' },
  otro: { color: '#efe6d2', name: 'Otros imperios' },
};

const ISLAND_COLOR = {
  barbaros: '#b8834f',
  piratas: '#8a8f96',
  ruinas: '#d6c08a',
  libre: '#6dbb63',
  kraken: '#a46ad1',
  brumas: '#b9cbd6',
};

const head = (icon, title, sub) => `
  <div class="panel-head"><span class="panel-icon">${icon}</span><div><h3>${title}</h3><div class="panel-lvl">${sub}</div></div>
  <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>`;

export class WorldMap {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.data = null;
    this.selected = null;
  }

  async open(focusId = null) {
    this.hud.showModal('worldmap', `<div class="modal-card wide"><p class="muted">Desplegando las cartas náuticas…</p></div>`);
    let data;
    try {
      data = await this.game.fetchMap();
    } catch (err) {
      if (this.hud.modalKind === 'worldmap') this.hud.showModal('worldmap', `<div class="modal-card wide"><p class="muted">${escapeHtml(err.message)}</p></div>`);
      return;
    }
    if (this.hud.modalKind !== 'worldmap') return;
    this.data = data;
    this.#mount(focusId);
  }

  #relation(uid, aid) {
    if (uid === this.game.userId) return 'yo';
    return (aid != null && this.data.relations[aid]) || 'otro';
  }

  #mount(focusId) {
    const { cities, islands } = this.data;
    this.byUid = new Map(cities.map((c) => [c.uid, c]));
    this.home = this.byUid.get(this.game.userId) ?? cities[0] ?? { x: 0, z: 0 };
    const wars = cities.filter((c) => this.#relation(c.uid, c.aid) === 'guerra').length;
    const legend = Object.entries(REL)
      .map(([, r]) => `<span><i style="background:${r.color}"></i>${r.name}</span>`)
      .join('');
    const names = cities.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.city)}</option>`).join('');
    this.hud.showModal(
      'worldmap',
      `<div class="modal-card wide worldmap">
        ${head('🌍', 'Mapa del mundo', `${fmtNum(cities.length)} imperios · ${fmtNum(islands.length)} islas${wars ? ` · ⚔️ ${wars} ciudades enemigas` : ''}`)}
        <div class="wm-tools">
          <form class="inline-form wm-search"><input name="q" list="wm-names" placeholder="Buscar jugador o ciudad…" autocomplete="off" /><datalist id="wm-names">${names}</datalist><button class="ghost small">Buscar</button></form>
          <button class="ghost small" data-wm="home" title="Volver a tu ciudad">⚜ Mi ciudad</button>
          <button class="ghost small" data-wm="in" title="Acercar">＋</button>
          <button class="ghost small" data-wm="out" title="Alejar">－</button>
        </div>
        <div class="wm-wrap"><canvas></canvas><div class="wm-tip" hidden></div></div>
        <div class="wm-legend">${legend}<span><i class="ring"></i>Lo que ves desde tu ciudad</span></div>
        <div class="wm-info"><p class="muted small">Arrastra para moverte, usa la rueda para acercarte y pulsa una ciudad para ver quién vive en ella.</p></div>
      </div>`,
    );
    const root = this.hud.modal.querySelector('.worldmap');
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tip = root.querySelector('.wm-tip');
    this.info = root.querySelector('.wm-info');
    this.cx = this.home.x;
    this.cz = this.home.z;
    this.scale = 0;
    this.selected = null;

    root.querySelector('.wm-search').addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.#search(new FormData(e.target).get('q'));
    });
    root.querySelector('.wm-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-wm]');
      if (!b) return;
      if (b.dataset.wm === 'home') this.#focus(this.home, true);
      else this.#zoomAt(b.dataset.wm === 'in' ? 1.6 : 1 / 1.6);
    });
    this.#bindPointer();
    const ro = new ResizeObserver(() => {
      if (!this.canvas.isConnected) return ro.disconnect();
      this.#resize();
    });
    ro.observe(this.canvas.parentElement);
    this.#resize();
    const focus = focusId && cities.find((c) => c.id === focusId);
    if (focus) this.#focus(focus, true);
  }

  #resize() {
    const wrap = this.canvas.parentElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = wrap.clientWidth;
    this.h = wrap.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.scale) this.scale = this.w / 2800;
    this.#draw();
  }

  // ── Coordenadas ─────────────────────────────────────────────────────────────

  #toScreen(x, z) {
    return [(x - this.cx) * this.scale + this.w / 2, (z - this.cz) * this.scale + this.h / 2];
  }

  #toWorld(px, py) {
    return [(px - this.w / 2) / this.scale + this.cx, (py - this.h / 2) / this.scale + this.cz];
  }

  #clampScale(s) {
    let ext = 1500;
    for (const c of this.data.cities) ext = Math.max(ext, Math.abs(c.x - this.home.x), Math.abs(c.z - this.home.z));
    return Math.min(1.2, Math.max(this.w / (ext * 2.6), s));
  }

  #zoomAt(factor, px = this.w / 2, py = this.h / 2) {
    const [wx, wz] = this.#toWorld(px, py);
    this.scale = this.#clampScale(this.scale * factor);
    // Que el punto bajo el ratón siga en el mismo sitio
    this.cx = wx - (px - this.w / 2) / this.scale;
    this.cz = wz - (py - this.h / 2) / this.scale;
    this.#draw();
  }

  #focus(target, select = false) {
    this.cx = target.x;
    this.cz = target.z;
    this.scale = Math.max(this.scale, this.#clampScale(this.w / 1400));
    if (select && target.uid != null) this.#select({ kind: 'city', item: target });
    this.#draw();
  }

  #search(q) {
    q = String(q ?? '').trim().toLowerCase();
    if (!q) return;
    const list = this.data.cities;
    const hit =
      list.find((c) => c.name.toLowerCase() === q || c.city.toLowerCase() === q) ??
      list.find((c) => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || (c.tag && c.tag.toLowerCase() === q.replace(/[[\]]/g, '')));
    if (hit) this.#focus(hit, true);
    else this.hud.toast('No hay ninguna ciudad con ese nombre.', 'error');
  }

  // ── Ratón y dedos ───────────────────────────────────────────────────────────

  #bindPointer() {
    const c = this.canvas;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
        drag = null;
      } else {
        drag = { x: e.offsetX, y: e.offsetY, cx: this.cx, cz: this.cz, moved: false };
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.#zoomAt((pinch.scale * (d / pinch.d)) / this.scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      if (drag) {
        const dx = e.offsetX - drag.x;
        const dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          this.cx = drag.cx - dx / this.scale;
          this.cz = drag.cz - dy / this.scale;
          this.tip.hidden = true;
          this.#draw();
          return;
        }
      }
      this.#hover(e.offsetX, e.offsetY);
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && !drag.moved && e.type === 'pointerup') {
        const hit = this.#hit(e.offsetX, e.offsetY);
        this.#select(hit);
        this.#draw();
      }
      drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => (this.tip.hidden = true));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.#zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY);
      },
      { passive: false },
    );
  }

  /** Lo que hay bajo el puntero: una ciudad (con preferencia) o una isla. */
  #hit(px, py) {
    let best = null;
    let bestD = 14;
    for (const city of this.data.cities) {
      const [x, y] = this.#toScreen(city.x, city.z);
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) {
        best = { kind: 'city', item: city };
        bestD = d;
      }
    }
    if (best) return best;
    bestD = 8;
    for (const isl of this.data.islands) {
      const [x, y] = this.#toScreen(isl[0], isl[1]);
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) {
        best = { kind: 'island', item: isl };
        bestD = d;
      }
    }
    return best;
  }

  #hover(px, py) {
    const hit = this.#hit(px, py);
    this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    if (!hit) {
      this.tip.hidden = true;
      return;
    }
    let text;
    if (hit.kind === 'city') {
      const c = hit.item;
      text = `🏰 ${c.tag ? `[${c.tag}] ` : ''}${c.name} · ${c.city} · ${fmtNum(c.points)} pts`;
    } else {
      const [, , type, colonist] = hit.item;
      const t = ISLAND_TYPES[type];
      const owner = colonist ? this.byUid.get(colonist) : null;
      text = owner ? `🚩 Colonia de ${owner.name}` : `${t?.icon ?? ''} ${t?.name ?? type}`;
    }
    this.tip.textContent = text;
    this.tip.hidden = false;
    this.tip.style.left = `${Math.min(px + 14, this.w - this.tip.offsetWidth - 6)}px`;
    this.tip.style.top = `${py + 14}px`;
  }

  // ── Ficha de lo seleccionado ────────────────────────────────────────────────

  #select(hit) {
    this.selected = hit;
    if (!hit) {
      this.info.innerHTML = '<p class="muted small">Pulsa una ciudad para ver quién vive en ella.</p>';
      return;
    }
    const pos = hit.kind === 'city' ? hit.item : { x: hit.item[0], z: hit.item[1] };
    const dist = Math.round(Math.hypot(pos.x - this.home.x, pos.z - this.home.z));
    const trip = fmtTime(travelSeconds(this.game.state, dist, UNITS.trirreme.speed));
    const far = `<span class="muted small">a ${fmtNum(dist)} leguas · ⛵ ${trip} en trirreme</span>`;
    if (hit.kind === 'city') {
      const c = hit.item;
      const rel = this.#relation(c.uid, c.aid);
      const me = rel === 'yo';
      const visible = !!this.game.world.island(c.id);
      this.info.innerHTML = `<div class="wm-card">
        <div><b>🏰 ${escapeHtml(c.city)}</b> <span class="rel-chip" style="--rel:${REL[rel].color}">${REL[rel].name}</span>
          <div class="small">${me ? 'Tu capital' : `de <b>${escapeHtml(c.name)}</b>`}${c.tag ? ` <span class="tag">[${escapeHtml(c.tag)}]</span>` : ''} · ${fmtNum(c.points)} puntos${c.protected ? ' · 🛡️ novato' : ''}</div>
          ${me ? '' : far}</div>
        <div class="row-actions">
          ${me ? '' : `<button class="ghost small" data-action="profile" data-name="${escapeHtml(c.name)}">👤 Perfil</button><button class="ghost small" data-action="mail-to" data-name="${escapeHtml(c.name)}">✉️</button>`}
          ${visible ? `<button class="primary small" data-action="goto" data-island="${escapeHtml(c.id)}">${me ? '⚜ Ir a casa' : '⚓ Ir'}</button>` : '<span class="muted small">Fuera del alcance de tus barcos</span>'}
        </div></div>`;
    } else {
      const [, , type, colonist] = hit.item;
      const t = ISLAND_TYPES[type];
      const owner = colonist ? this.byUid.get(colonist) : null;
      this.info.innerHTML = `<div class="wm-card"><div><b>${t?.icon ?? ''} ${owner ? `Colonia de ${escapeHtml(owner.name)}` : (t?.name ?? type)}</b><div>${far}</div></div></div>`;
    }
  }

  // ── Dibujo ──────────────────────────────────────────────────────────────────

  #draw() {
    if (!this.canvas?.isConnected || !this.w) return;
    const { ctx, w, h, scale } = this;
    const sea = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    sea.addColorStop(0, '#1f5f86');
    sea.addColorStop(1, '#0d2f47');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, w, h);

    // Cuadrícula de leguas
    const step = scale > 0.25 ? 250 : scale > 0.08 ? 500 : 1000;
    const [x0, z0] = this.#toWorld(0, 0);
    const [x1, z1] = this.#toWorld(w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.#toScreen(x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let z = Math.floor(z0 / step) * step; z <= z1; z += step) {
      const [, sy] = this.#toScreen(0, z);
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    // Lo que ves desde tu ciudad
    const [hx, hy] = this.#toScreen(this.home.x, this.home.z);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(242,201,76,0.45)';
    ctx.beginPath();
    ctx.arc(hx, hy, this.data.viewRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const inView = (x, y, m = 40) => x > -m && y > -m && x < w + m && y < h + m;

    // Islas de los sectores
    const r = Math.max(1.6, 20 * scale);
    for (const [x, z, type, colonist] of this.data.islands) {
      const [sx, sy] = this.#toScreen(x, z);
      if (!inView(sx, sy)) continue;
      ctx.fillStyle = ISLAND_COLOR[type] ?? '#888';
      ctx.globalAlpha = type === 'brumas' ? 0.45 : 0.85;
      ctx.beginPath();
      ctx.arc(sx, sy, type === 'brumas' ? r * 1.6 : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (colonist) {
        const owner = this.byUid.get(colonist);
        ctx.strokeStyle = REL[owner ? this.#relation(owner.uid, owner.aid) : 'otro'].color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Ciudades
    const cr = Math.max(3.5, 28 * scale);
    const labels = scale > 0.09;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const c of this.data.cities) {
      const [sx, sy] = this.#toScreen(c.x, c.z);
      if (!inView(sx, sy, 80)) continue;
      const rel = this.#relation(c.uid, c.aid);
      const color = REL[rel].color;
      const selected = this.selected?.kind === 'city' && this.selected.item === c;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = rel === 'otro' ? 0 : 10;
      ctx.beginPath();
      ctx.arc(sx, sy, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (c.protected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(sx, sy, cr + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, cr + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (labels || selected || rel === 'yo') {
        const text = `${c.tag ? `[${c.tag}] ` : ''}${c.name}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,20,30,0.85)';
        ctx.strokeText(text, sx, sy - cr - 6);
        ctx.fillStyle = rel === 'otro' ? '#f3ead8' : color;
        ctx.fillText(text, sx, sy - cr - 6);
      }
    }

    // Escala
    const bar = step * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(12, h - 18, bar, 3);
    ctx.textAlign = 'left';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillText(`${fmtNum(step)} leguas`, 12, h - 24);
  }
}
