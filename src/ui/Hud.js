import { play } from '../audio.js';
import { GAME_SPEED } from '../config.js';
import {
  BUILDINGS,
  BUILDING_KEYS,
  ISLANDS,
  ISLAND_BY_ID,
  ISLAND_TYPES,
  MISSION_TYPES,
  PLAYER_UNITS,
  POWERS,
  RESEARCH,
  RESOURCES,
  RESOURCE_KEYS,
  UNITS,
  VISITORS,
} from '../game/data.js';
import { HOUR_MS, canAfford, multiplyCost } from '../game/rules.js';
import { buildingPanel } from './buildingPanel.js';
import { bag, costItems, fmtNum, fmtTime, unitList } from './format.js';
import { fleetFor, islandPanel, readFleet } from './islandPanel.js';
import { questsHtml, rankingHtml } from './modals.js';
import { reportsHtml } from './reports.js';

const $ = (sel) => document.querySelector(sel);

/**
 * Interfaz HTML sobre la escena 3D. Cada parte se regenera solo cuando cambia
 * su HTML (tras un cambio en la partida); lo que corre con el reloj (recursos,
 * barras, cuentas atrás, botones que dependen de lo que tienes) se refresca en
 * el sitio con atributos data-*, para no perder clics ni lo que estés tecleando.
 */
export class Hud {
  constructor(game, { onSelect, onView, settings }) {
    this.game = game;
    this.onSelect = onSelect;
    this.onView = onView;
    this.settings = settings;
    this.modalKind = null;
    this.claimable = game.claimableQuests();
    this.selected = null;
    this.view = 'isla';
    this.panelView = null;
    this.panelId = null;
    this.cache = {};

    this.panel = $('#panel');
    this.sidebar = $('#sidebar');
    this.dock = $('#dock');
    this.alert = $('#alert');
    this.modal = $('#modal');
    this.viewBtn = $('#view-btn');
    this.reportsBtn = $('#reports-btn');
    this.questsBtn = $('#quests-btn');
    this.favorEl = $('#favor');
    this.visitorEl = $('#visitor');
    this.menu = $('#menu');

    this.#buildResources();

    this.panel.addEventListener('click', (e) => this.#onPanelClick(e));
    this.panel.addEventListener('input', () => this.#refreshPanel());
    this.panel.addEventListener('change', () => this.#refreshPanel());
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) e.target.closest('.card, .trade, .section')?.querySelector('[data-action="train"], [data-action="trade"]')?.click();
    });
    this.dock.addEventListener('click', (e) => this.#onDockClick(e));
    this.sidebar.addEventListener('click', (e) => {
      const li = e.target.closest('[data-id]');
      if (li) this.onSelect(li.dataset.id);
    });
    this.alert.addEventListener('click', () => this.onSelect('muralla'));
    this.viewBtn.addEventListener('click', () => this.onView(this.view === 'isla' ? 'mapa' : 'isla'));
    this.reportsBtn.addEventListener('click', () => this.openReports());
    this.questsBtn.addEventListener('click', () => this.openModal('quests'));
    $('#rank-btn').addEventListener('click', () => this.openModal('ranking'));
    this.favorEl.addEventListener('click', () => this.onSelect('templo'));
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-action="close-modal"]')) this.closeModal();
      const claim = e.target.closest('[data-action="claim"]');
      if (claim && !claim.disabled) {
        const res = game.claimQuest(claim.dataset.id);
        if (res.ok) play('coins');
        else this.toast(res.reason, 'error');
      }
    });
    this.visitorEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.action === 'accept') {
        const res = game.acceptVisitor();
        if (res.ok) play('coins');
        else this.toast(res.reason, 'error');
      } else {
        game.dismissVisitor();
      }
    });

    // Menú de opciones
    $('#menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.menu.hidden = !this.menu.hidden;
      this.menu.querySelector('[name="sound"]').checked = settings.sound();
      this.menu.querySelector('[name="daynight"]').checked = settings.dayNight();
    });
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target)) this.menu.hidden = true;
    });
    this.menu.addEventListener('change', (e) => {
      if (e.target.name === 'sound') settings.setSound(e.target.checked);
      if (e.target.name === 'daynight') settings.setDayNight(e.target.checked);
    });
    this.menu.querySelector('[data-action="reset"]').addEventListener('click', () => {
      this.menu.hidden = true;
      if (confirm('¿Reiniciar la partida? Perderás todo el progreso.')) {
        game.reset();
        this.onSelect(null);
        this.toast('Nueva partida iniciada.');
      }
    });

    game.addEventListener('notify', (e) => this.toast(e.detail.text, e.detail.kind));
    game.addEventListener('change', () => this.render());

    // Los paneles empiezan justo debajo de la barra superior, mida lo que mida
    const topbar = $('#topbar');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--top', `${topbar.getBoundingClientRect().bottom + 10}px`);
    }).observe(topbar);

    this.render();
  }

  select(id) {
    this.selected = id;
    this.render();
  }

  setView(view) {
    this.view = view;
    this.viewBtn.innerHTML = view === 'isla' ? '🗺️ <span>Mapa</span>' : '🏝️ <span>Mi isla</span>';
    this.viewBtn.classList.toggle('active', view === 'mapa');
    this.render();
  }

  toast(text, kind = 'info') {
    const wrap = $('#toasts');
    while (wrap.children.length >= 5) wrap.firstChild.remove();
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    wrap.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }

  openReports() {
    this.modalKind = 'reports';
    this.modal.innerHTML = reportsHtml(this.game.reports);
    this.modal.hidden = false;
    this.modal.querySelector('details')?.setAttribute('open', '');
    this.game.markReportsRead();
  }

  openModal(kind) {
    this.modalKind = kind;
    this.cache.modal = '';
    this.modal.hidden = false;
    this.#renderModal();
  }

  closeModal() {
    this.modalKind = null;
    this.modal.hidden = true;
    this.modal.innerHTML = '';
  }

  #renderModal() {
    if (this.modalKind === 'quests') this.#setHtml(this.modal, 'modal', questsHtml(this.game));
    else if (this.modalKind === 'ranking') this.#setHtml(this.modal, 'modal', rankingHtml(this.game));
  }

  /** Regenera lo que dependa de la partida (solo si su HTML cambia). */
  render() {
    this.#renderSidebar();
    this.#renderPanel();
    this.#renderDock();
    this.#renderAlert();
    this.#renderVisitor();
    this.#renderModal();
    const unread = this.game.unreadReports;
    const badge = this.reportsBtn.querySelector('.badge');
    badge.hidden = !unread;
    badge.textContent = unread;

    // Avisar cuando una misión queda lista para reclamar
    const claimable = this.game.claimableQuests();
    const qBadge = this.questsBtn.querySelector('.badge');
    qBadge.hidden = !claimable;
    qBadge.textContent = claimable;
    if (claimable > this.claimable) {
      const q = this.game.activeQuests().find((x) => x.done);
      if (q) this.toast(`📋 Misión cumplida: ${q.title}. ¡Reclama la recompensa!`, 'success');
    }
    this.claimable = claimable;
    this.update();
  }

  /** Refresco rápido: recursos, barras y botones. */
  update() {
    this.#updateResources();
    this.#updateFavor();
    this.#refreshLive(this.panel);
    this.#refreshLive(this.dock);
    this.#refreshLive(this.alert);
    this.#refreshLive(this.visitorEl);
    this.panelView?.refresh?.(this.panel);
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
    const game = this.game;
    const eco = game.economy();
    const starving = game.starving(eco);
    const prod = starving ? eco.hungry : eco.net;
    const cap = game.capacity();
    for (const key of RESOURCE_KEYS) {
      const els = this.resEls[key];
      const amount = game.resources[key];
      const full = amount >= cap;
      const rate = prod[key];
      els.amount.textContent = fmtNum(amount);
      let rateText = `${rate < 0 ? '−' : '+'}${fmtNum(Math.abs(rate))}/h`;
      if (key === 'comida' && starving) rateText = '¡Hambruna!';
      else if (full && rate > 0) rateText = 'Lleno';
      els.rate.textContent = rateText;
      els.bar.style.width = `${Math.min(100, (amount / cap) * 100)}%`;
      els.root.classList.toggle('full', full);
      els.root.classList.toggle('negative', rate < 0 || (key === 'comida' && starving));
      const lines = [
        `${RESOURCES[key].name}: ${fmtNum(amount)} / ${fmtNum(cap)}`,
        `Isla: +${fmtNum(eco.base[key])}/h`,
        `Edificios: +${fmtNum(eco.buildings[key])}/h`,
      ];
      if (eco.research[key]) lines.push(`Investigación: +${fmtNum(eco.research[key])}/h`);
      if (eco.colonies[key]) lines.push(`Colonias: +${fmtNum(eco.colonies[key])}/h`);
      if (key === 'comida' && eco.upkeep) lines.push(`Tropas: −${fmtNum(eco.upkeep)}/h`);
      if (starving) lines.push('Hambruna: la producción cae a la mitad');
      els.root.title = lines.join('\n');
    }
  }

  #updateFavor() {
    const game = this.game;
    const show = game.level('templo') > 0;
    this.favorEl.hidden = !show;
    if (!show) return;
    const text = `🙏 ${fmtNum(game.favor)}`;
    if (this.favorEl.textContent !== text) this.favorEl.textContent = text;
    this.favorEl.title = `Favor de los dioses: ${fmtNum(game.favor)} / ${fmtNum(game.favorMax())}\nClic para abrir el templo`;
  }

  // ── Barra lateral ─────────────────────────────────────────────────────────

  #renderSidebar() {
    const game = this.game;
    let html;
    if (this.view === 'isla') {
      const q = game.queue;
      const items = BUILDING_KEYS.map((id) => {
        const b = BUILDINGS[id];
        const level = game.level(id);
        const locked = level === 0 && game.nextUpgrade(id).missing.length > 0;
        const cls = [id === this.selected && 'active', q?.id === id && 'building', level === 0 && 'empty', locked && 'locked'].filter(Boolean).join(' ');
        const tag = q?.id === id ? '🔨' : level > 0 ? level : locked ? '🔒' : '—';
        return `<li data-id="${id}" class="${cls}" title="${b.name}"><span class="b-icon">${b.icon}</span><span class="b-name">${b.name}</span><span class="b-lvl">${tag}</span></li>`;
      }).join('');
      const army = PLAYER_UNITS.filter((id) => game.units[id] > 0)
        .map((id) => `<li title="${UNITS[id].name}"><span>${UNITS[id].icon}</span><span class="b-name">${UNITS[id].name}</span><b>${fmtNum(game.units[id])}</b></li>`)
        .join('');
      const away = game.missions.length ? `<p class="muted small">${game.missions.length} ${game.missions.length === 1 ? 'flota' : 'flotas'} en el mar</p>` : '';
      html = `<h2>Edificios</h2><ul class="list">${items}</ul>
        <div class="army-block"><h2>Ejército</h2>${army ? `<ul class="army">${army}</ul>` : '<p class="muted small">Sin tropas en casa</p>'}${away}</div>`;
    } else {
      const items = ISLANDS.map((isl) => {
        const v = game.island(isl.id);
        const t = ISLAND_TYPES[isl.type];
        const icon = v.colonized ? '🚩' : v.explored ? t.icon : '❔';
        const tag = v.inbound.length ? '⛵' : v.explored && isl.tier && !v.colonized ? `Nv ${isl.tier}` : '';
        const cls = [isl.id === this.selected && 'active', !v.explored && 'empty'].filter(Boolean).join(' ');
        return `<li data-id="${isl.id}" class="${cls}" title="${isl.name}"><span class="b-icon">${icon}</span><span class="b-name">${isl.name}</span><span class="b-lvl">${tag || '·'}</span></li>`;
      }).join('');
      html = `<h2>Archipiélago</h2><ul class="list">${items}</ul>
        <div class="army-block">
          <p class="muted small">⛵ Flotas: ${game.missions.length}/${game.fleetSlots()} · 🚩 Colonias: ${game.colonies().length}/${game.maxColonies()}</p>
        </div>`;
    }
    this.#setHtml(this.sidebar, 'sidebar', html);
  }

  // ── Panel de detalle ──────────────────────────────────────────────────────

  #renderPanel() {
    const id = this.selected;
    if (!id) {
      this.panel.hidden = true;
      this.panelView = null;
      this.panelId = null;
      this.cache.panel = '';
      return;
    }
    const view = BUILDINGS[id] ? buildingPanel(this, id) : islandPanel(this, id);
    this.panelView = view;
    this.panel.hidden = false;
    if (this.panelId === id && this.cache.panel === view.html) return;

    // Conservar lo que haya escrito el jugador si sigue en el mismo panel
    const same = this.panelId === id;
    const saved = {};
    if (same) for (const el of this.panel.querySelectorAll('input[name], select[name]')) saved[el.name] = el.value;
    const active = document.activeElement;
    const focused = same && this.panel.contains(active) && active.name ? active.name : null;
    const scroll = this.panel.scrollTop;

    this.panel.innerHTML = view.html;
    this.cache.panel = view.html;
    this.panelId = id;
    if (same) {
      for (const el of this.panel.querySelectorAll('input[name], select[name]')) if (el.name in saved) el.value = saved[el.name];
      this.panel.scrollTop = scroll;
      if (focused) this.panel.querySelector(`[name="${focused}"]`)?.focus();
    } else {
      this.panel.scrollTop = 0;
    }
  }

  #refreshPanel() {
    this.#refreshLive(this.panel);
    this.panelView?.refresh?.(this.panel);
  }

  #countOf(root, name) {
    if (!name) return 1;
    const input = root.querySelector(`[name="${name}"]`);
    return Math.max(1, Math.floor(Number(input?.value) || 1));
  }

  /** Actualiza en el sitio los elementos con atributos data-* "vivos". */
  #refreshLive(root) {
    if (!root || root.hidden) return;
    const now = Date.now();
    const have = this.game.resources;
    for (const el of root.querySelectorAll('[data-until]')) {
      const text = fmtTime((Number(el.dataset.until) - now) / 1000);
      if (el.textContent !== text) el.textContent = text;
    }
    for (const el of root.querySelectorAll('[data-bar]')) {
      const start = Number(el.dataset.start);
      const end = Number(el.dataset.end);
      const p = Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
      el.style.width = `${(p * 100).toFixed(1)}%`;
    }
    for (const el of root.querySelectorAll('.costs[data-cost]')) {
      const html = costItems(JSON.parse(el.dataset.cost), have, this.#countOf(root, el.dataset.count));
      if (el.innerHTML !== html) el.innerHTML = html;
    }
    for (const el of root.querySelectorAll('[data-need]')) {
      const cost = multiplyCost(JSON.parse(el.dataset.need), this.#countOf(root, el.dataset.count));
      el.disabled = el.dataset.blocked === '1' || !canAfford(have, cost);
    }
    for (const el of root.querySelectorAll('[data-wait]')) {
      const cost = JSON.parse(el.dataset.wait);
      let text = '';
      if (!canAfford(have, cost)) {
        const s = this.game.secondsUntilAffordable(cost);
        text = Number.isFinite(s) ? `Tendrás los recursos en ${fmtTime(s)}` : 'Con la producción actual no llegarás nunca';
      }
      if (el.textContent !== text) el.textContent = text;
    }
  }

  #onPanelClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const game = this.game;
    const root = this.panel;
    const action = btn.dataset.action;
    const report = (res, okText, sound = 'build') => {
      if (!res?.ok) {
        this.toast(res?.reason ?? 'No se ha podido.', 'error');
        play('error');
        return;
      }
      play(sound);
      if (okText) this.toast(okText, 'success');
    };

    switch (action) {
      case 'close':
        this.onSelect(null);
        break;
      case 'upgrade':
        report(game.upgrade(this.selected));
        break;
      case 'research': {
        const r = RESEARCH[btn.dataset.id];
        report(game.research(btn.dataset.id), `${r.icon} Los sabios investigan ${r.name}`);
        break;
      }
      case 'max': {
        const input = root.querySelector(`[name="n-${btn.dataset.unit}"]`);
        input.value = Math.max(1, game.maxAffordable(btn.dataset.unit));
        this.#refreshPanel();
        break;
      }
      case 'train': {
        const id = btn.dataset.unit;
        const n = this.#countOf(root, `n-${id}`);
        report(game.train(id, n), `${UNITS[id].icon} ${n} × ${UNITS[id].name} en camino`);
        break;
      }
      case 'cancel-train':
        game.cancelTraining(btn.dataset.building, Number(btn.dataset.index));
        this.toast('Entrenamiento cancelado. Recursos devueltos.');
        break;
      case 'trade-max': {
        const from = root.querySelector('[name="t-from"]').value;
        root.querySelector('[name="t-amount"]').value = Math.floor(game.resources[from]);
        this.#refreshPanel();
        break;
      }
      case 'trade': {
        const from = root.querySelector('[name="t-from"]').value;
        const to = root.querySelector('[name="t-to"]').value;
        const amount = Number(root.querySelector('[name="t-amount"]').value);
        const res = game.trade(from, to, amount);
        report(res, res.ok ? `⚖️ Cambiados ${RESOURCES[from].icon} ${fmtNum(res.paid)} por ${RESOURCES[to].icon} ${fmtNum(res.got)}` : null, 'coins');
        break;
      }
      case 'open-map':
        this.onView('mapa');
        break;
      case 'fleet-all': {
        const input = root.querySelector(`[name="f-${btn.dataset.unit}"]`);
        input.value = game.units[btn.dataset.unit];
        this.#refreshPanel();
        break;
      }
      case 'mission': {
        const type = btn.dataset.type;
        const units = fleetFor(game, type, readFleet(root));
        const isl = ISLAND_BY_ID[this.selected];
        const res = game.sendMission(type, this.selected, units);
        if (res.ok) for (const input of root.querySelectorAll('input[name^="f-"]')) input.value = '';
        report(res, `${MISSION_TYPES[type].icon} La flota zarpa hacia ${isl.name}`, 'sail');
        break;
      }
      case 'power': {
        const p = POWERS[btn.dataset.id];
        report(game.castPower(btn.dataset.id), null, 'magic');
        if (btn.dataset.id === 'rayo') this.toast(`${p.icon} ¡Un rayo parte los mástiles piratas!`, 'success');
        break;
      }
    }
  }

  // ── Actividad en curso ────────────────────────────────────────────────────

  #renderDock() {
    const game = this.game;
    const rows = [];
    const row = ({ icon, title, start, end, select, buttons = '' }) =>
      `<div class="dock-row" ${select ? `data-select="${select}"` : ''}>
        <div class="q-title"><span>${icon} ${title}</span><span class="q-time" data-until="${end}"></span></div>
        <div class="q-bar"><i data-bar data-start="${start}" data-end="${end}"></i></div>
        ${buttons}
      </div>`;

    const q = game.queue;
    if (q) {
      const b = BUILDINGS[q.id];
      rows.push(row({ icon: '🔨', title: `${b.name} → nivel ${q.level}`, start: q.start, end: q.end, select: q.id, buttons: '<button class="ghost small" data-action="cancel-build">Cancelar</button>' }));
    }
    const rq = game.researchQueue;
    if (rq) {
      const r = RESEARCH[rq.id];
      rows.push(row({ icon: r.icon, title: `${r.name} → nivel ${rq.level}`, start: rq.start, end: rq.end, select: 'academia', buttons: '<button class="ghost small" data-action="cancel-research">Cancelar</button>' }));
    }
    for (const building of ['cuartel', 'puerto']) {
      const tq = game.training(building);
      if (!tq.length) continue;
      const head = tq[0];
      const u = UNITS[head.unit];
      const more = tq.length > 1 ? ` (+${tq.length - 1})` : '';
      rows.push(row({ icon: u.icon, title: `${head.done}/${head.count} ${u.name}${more}`, start: head.start, end: tq.at(-1).end, select: building }));
    }
    for (const [id, p] of Object.entries(POWERS)) {
      const until = game.buffUntil(id);
      if (!until) continue;
      const start = until - (p.duration * HOUR_MS) / GAME_SPEED;
      rows.push(row({ icon: p.icon, title: p.name, start, end: until, select: 'templo' }));
    }
    for (const m of game.missions) {
      const isl = ISLAND_BY_ID[m.target];
      const t = MISSION_TYPES[m.type];
      const going = m.phase === 'ida';
      const start = going ? m.depart : (m.turn ?? (m.recalled ? (m.back + m.depart) / 2 : m.arrive));
      const end = going ? m.arrive : m.back;
      rows.push(
        row({
          icon: going ? t.icon : '⚓',
          title: `${going ? t.name : 'Vuelta de'} ${isl.name}`,
          start,
          end,
          select: m.target,
          buttons: going ? `<button class="ghost small" data-action="recall" data-mission="${m.id}">Retirar</button>` : '',
        }),
      );
    }
    this.#setHtml(this.dock, 'dock', rows.join(''));
    this.dock.hidden = !rows.length;
  }

  #onDockClick(e) {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'recall') {
        this.game.recall(Number(btn.dataset.mission));
        this.toast('La flota da media vuelta.');
        return;
      }
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = '¿Seguro?';
        setTimeout(() => {
          delete btn.dataset.armed;
          btn.textContent = 'Cancelar';
        }, 3000);
        return;
      }
      if (action === 'cancel-build') this.game.cancel();
      if (action === 'cancel-research') this.game.cancelResearch();
      this.toast('Cancelado. Recursos devueltos.');
      return;
    }
    const rowEl = e.target.closest('[data-select]');
    if (rowEl) this.onSelect(rowEl.dataset.select);
  }

  // ── Aviso de piratas ──────────────────────────────────────────────────────

  #renderAlert() {
    const raid = this.game.raid;
    this.alert.hidden = !raid;
    if (!raid) {
      this.cache.alert = '';
      return;
    }
    const html = `<span class="alert-icon">🏴‍☠️</span>
      <div><b>¡Piratas a la vista!</b> Llegan en <span data-until="${raid.arrival}"></span>
      <div class="small">${unitList(raid.army)} · Defiende con tropas en casa y la muralla</div></div>`;
    this.#setHtml(this.alert, 'alert', html);
  }

  #renderVisitor() {
    const v = this.game.visitor;
    this.visitorEl.hidden = !v;
    if (!v) {
      this.cache.visitor = '';
      return;
    }
    const info = VISITORS[v.kind];
    const offer = v.units ? unitList(v.units) : bag(v.get);
    const html = `<span class="alert-icon">${info.icon}</span>
      <div class="visitor-body"><b>${info.name}</b> · se va en <span data-until="${v.expires}"></span>
        <div class="small">Te ofrece ${offer} a cambio de ${bag(v.give)}</div></div>
      <button class="primary small auto" data-action="accept" data-need='${JSON.stringify(v.give)}' data-blocked="0">Aceptar</button>
      <button class="ghost small" data-action="dismiss">No</button>`;
    this.#setHtml(this.visitorEl, 'visitor', html);
  }

  #setHtml(el, key, html) {
    if (this.cache[key] === html) return;
    this.cache[key] = html;
    el.innerHTML = html;
  }
}
