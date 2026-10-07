import { BUILDINGS, BUILDING_KEYS, RESOURCES, RESOURCE_KEYS } from '../game/data.js';
import { producerOutput, storageCapacity, townSpeedup } from '../game/rules.js';
import { fmtNum, fmtTime } from './format.js';

const $ = (sel) => document.querySelector(sel);

/**
 * Interfaz HTML sobre la escena 3D. Las partes con botones solo se regeneran
 * cuando cambia su "firma", para que los clics no se pierdan entre refrescos.
 */
export class Hud {
  constructor(game, { onSelect }) {
    this.game = game;
    this.onSelect = onSelect;
    this.selected = null;
    this.panelSig = '';
    this.listSig = '';
    this.queueSig = '';

    this.#buildResources();
    this.#buildList();

    this.panel = $('#panel');
    this.panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.onSelect(null);
      const up = e.target.closest('[data-upgrade]');
      if (up && !up.disabled) {
        const res = game.upgrade(this.selected);
        if (!res.ok) this.toast(res.reason, 'error');
      }
    });

    this.queueEl = $('#queue');
    this.queueEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cancel]');
      if (!btn) return;
      if (btn.dataset.armed) {
        game.cancel();
        this.toast('Obra cancelada. Recursos devueltos.');
      } else {
        btn.dataset.armed = '1';
        btn.textContent = '¿Seguro?';
        setTimeout(() => {
          delete btn.dataset.armed;
          btn.textContent = 'Cancelar';
        }, 3000);
      }
    });

    $('#menu-btn').addEventListener('click', () => {
      if (confirm('¿Reiniciar la partida? Perderás todo el progreso.')) {
        game.reset();
        this.toast('Nueva partida iniciada.');
      }
    });

    game.addEventListener('completed', (e) => {
      const { id, level } = e.detail;
      this.toast(`${BUILDINGS[id].icon} ${BUILDINGS[id].name} ha alcanzado el nivel ${level}`, 'success');
    });
    game.addEventListener('change', () => this.update());

    this.update();
  }

  select(id) {
    this.selected = id;
    this.panelSig = '';
    this.update();
  }

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }

  update() {
    this.#updateResources();
    this.#updateList();
    this.#updatePanel();
    this.#updateQueue();
  }

  // ── Recursos ──────────────────────────────────────────────────────────────

  #buildResources() {
    const wrap = $('#resources');
    this.resEls = {};
    for (const key of RESOURCE_KEYS) {
      const r = RESOURCES[key];
      const el = document.createElement('div');
      el.className = 'res';
      el.style.setProperty('--res', r.color);
      el.innerHTML = `
        <span class="res-icon">${r.icon}</span>
        <span class="res-body">
          <span class="res-amount"></span>
          <span class="res-rate"></span>
          <span class="res-bar"><i></i></span>
        </span>`;
      wrap.appendChild(el);
      this.resEls[key] = {
        root: el,
        amount: el.querySelector('.res-amount'),
        rate: el.querySelector('.res-rate'),
        bar: el.querySelector('.res-bar i'),
      };
    }
  }

  #updateResources() {
    const prod = this.game.production();
    const cap = this.game.capacity();
    for (const key of RESOURCE_KEYS) {
      const els = this.resEls[key];
      const amount = this.game.resources[key];
      const full = amount >= cap;
      els.amount.textContent = fmtNum(amount);
      els.rate.textContent = full ? 'Almacén lleno' : `+${fmtNum(prod[key])}/h`;
      els.bar.style.width = `${Math.min(100, (amount / cap) * 100)}%`;
      els.root.classList.toggle('full', full);
      els.root.title = `${RESOURCES[key].name}: ${fmtNum(amount)} / ${fmtNum(cap)}\nProducción: ${fmtNum(prod[key])} por hora`;
    }
  }

  // ── Lista de edificios ────────────────────────────────────────────────────

  #buildList() {
    const list = $('#building-list');
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-id]');
      if (li) this.onSelect(li.dataset.id);
    });
    this.listEl = list;
  }

  #updateList() {
    const q = this.game.queue;
    const sig = BUILDING_KEYS.map((id) => `${id}${this.game.level(id)}`).join() + (q?.id ?? '') + this.selected;
    if (sig === this.listSig) return;
    this.listSig = sig;
    this.listEl.innerHTML = BUILDING_KEYS.map((id) => {
      const b = BUILDINGS[id];
      const level = this.game.level(id);
      const cls = [id === this.selected && 'active', q?.id === id && 'building', level === 0 && 'empty']
        .filter(Boolean)
        .join(' ');
      return `<li data-id="${id}" class="${cls}">
        <span class="b-icon">${b.icon}</span>
        <span class="b-name">${b.name}</span>
        <span class="b-lvl">${q?.id === id ? '🔨' : level > 0 ? level : '—'}</span>
      </li>`;
    }).join('');
  }

  // ── Panel de detalle ──────────────────────────────────────────────────────

  #updatePanel() {
    const id = this.selected;
    if (!id) {
      this.panel.hidden = true;
      this.panelSig = '';
      return;
    }
    this.panel.hidden = false;
    const game = this.game;
    const next = game.nextUpgrade(id);
    const q = game.queue;
    const have = game.resources;
    const affordMask = Object.entries(next.cost).map(([r, n]) => (have[r] >= n ? 1 : 0)).join('');
    const sig = [id, game.level(id), q?.id ?? '', affordMask, next.missing.length, game.level('almacen'), game.level('ayuntamiento')].join('|');

    if (sig !== this.panelSig) {
      this.panelSig = sig;
      this.panel.innerHTML = this.#panelHtml(id, next);
    }

    const wait = this.panel.querySelector('[data-wait]');
    if (wait) {
      const s = game.secondsUntilAffordable(next.cost);
      wait.textContent = Number.isFinite(s) ? `Tendrás los recursos en ${fmtTime(s)}` : 'Con la producción actual no llegarás nunca';
    }
  }

  #panelHtml(id, next) {
    const game = this.game;
    const b = BUILDINGS[id];
    const level = game.level(id);
    const q = game.queue;

    let effect = '';
    if (b.produces) {
      const r = RESOURCES[b.produces];
      const now = producerOutput(id, level);
      const then = producerOutput(id, next.level);
      effect = `<div class="effect"><span>${r.icon} Producción</span><b>${fmtNum(now)}/h</b><span class="arrow">→</span><b class="up">${fmtNum(then)}/h</b></div>`;
    } else if (id === 'almacen') {
      effect = `<div class="effect"><span>📦 Capacidad</span><b>${fmtNum(storageCapacity(level))}</b><span class="arrow">→</span><b class="up">${fmtNum(storageCapacity(next.level))}</b></div>`;
    } else if (id === 'ayuntamiento') {
      effect = `<div class="effect"><span>⚒️ Velocidad de obra</span><b>+${townSpeedup(level)} %</b><span class="arrow">→</span><b class="up">+${townSpeedup(next.level)} %</b></div>`;
    }

    const costs = Object.entries(next.cost)
      .map(([res, n]) => {
        const ok = game.resources[res] >= n;
        return `<li class="${ok ? 'ok' : 'missing'}" title="${RESOURCES[res].name}">${RESOURCES[res].icon} ${fmtNum(n)}</li>`;
      })
      .join('');

    const reqs = next.missing.length
      ? `<div class="reqs">🔒 Requiere ${next.missing.map((m) => `${BUILDINGS[m.id].name} nivel ${m.level}`).join(', ')}</div>`
      : '';

    let label = level === 0 ? 'Construir' : `Mejorar a nivel ${next.level}`;
    let disabled = false;
    let hint = '';
    if (q?.id === id) {
      label = 'En construcción…';
      disabled = true;
    } else if (q) {
      label = 'Constructores ocupados';
      disabled = true;
      hint = `<div class="hint">Están trabajando en: ${BUILDINGS[q.id].name}</div>`;
    } else if (next.missing.length) {
      disabled = true;
    } else if (next.exceedsStorage) {
      disabled = true;
      hint = '<div class="hint warn">El coste supera la capacidad del almacén. ¡Amplíalo primero!</div>';
    } else if (!next.affordable) {
      disabled = true;
      hint = '<div class="hint" data-wait></div>';
    }

    return `
      <div class="panel-head">
        <span class="panel-icon">${b.icon}</span>
        <div>
          <h3>${b.name}</h3>
          <div class="panel-lvl">${level > 0 ? `Nivel ${level}` : 'Sin construir'}</div>
        </div>
        <button class="icon-btn" data-close title="Cerrar">✕</button>
      </div>
      <p class="desc">${b.description}</p>
      ${effect}
      <h4>${level === 0 ? 'Construcción' : `Nivel ${next.level}`}</h4>
      <ul class="costs">${costs}</ul>
      <div class="time">⏱ ${fmtTime(next.seconds)}</div>
      ${reqs}
      <button class="primary" data-upgrade ${disabled ? 'disabled' : ''}>${label}</button>
      ${hint}`;
  }

  // ── Cola de obras ─────────────────────────────────────────────────────────

  #updateQueue() {
    const q = this.game.queue;
    if (!q) {
      this.queueEl.hidden = true;
      this.queueSig = '';
      return;
    }
    this.queueEl.hidden = false;
    const sig = `${q.id}${q.level}${q.start}`;
    if (sig !== this.queueSig) {
      this.queueSig = sig;
      const b = BUILDINGS[q.id];
      this.queueEl.innerHTML = `
        <div class="q-title"><span>🔨 ${b.name} → nivel ${q.level}</span><span class="q-time"></span></div>
        <div class="q-bar"><i></i></div>
        <button class="ghost" data-cancel>Cancelar</button>`;
    }
    const now = Date.now();
    const p = Math.min(1, (now - q.start) / (q.end - q.start));
    this.queueEl.querySelector('.q-bar i').style.width = `${(p * 100).toFixed(1)}%`;
    this.queueEl.querySelector('.q-time').textContent = fmtTime((q.end - now) / 1000);
  }
}
