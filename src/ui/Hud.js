import { play } from '../audio.js';
import { clock, universe } from '../config.js';
import { BUILDINGS, BUILDING_KEYS, ISLAND_TYPES, MISSION_TYPES, PLAYER_UNITS, POWERS, RESEARCH, RESOURCES, RESOURCE_KEYS, UNITS, VISITORS } from '../game/data.js';
import { HOUR_MS, canAfford, multiplyCost } from '../game/rules.js';
import { api } from '../net/api.js';
import { buildingPanel } from './buildingPanel.js';
import { bag, costItems, escapeHtml, fmtNum, fmtTime, unitList } from './format.js';
import { fleetFor, islandPanel, readFleet, readPayload } from './islandPanel.js';
import { questsHtml, rankingHtml } from './modals.js';
import { WorldMap } from './worldMap.js';
import { reportsHtml } from './reports.js';
import { Social } from './social.js';

const $ = (sel) => document.querySelector(sel);
const CHAT_KEY = 'imperium.chatRead2';

/**
 * Interfaz HTML sobre la escena 3D. Cada parte se regenera solo cuando cambia
 * su HTML (tras un cambio en la partida); lo que corre con el reloj (recursos,
 * barras, cuentas atrás, botones que dependen de lo que tienes) se refresca en
 * el sitio con atributos data-*, para no perder clics ni lo que estés tecleando.
 *
 * Las acciones van al servidor (`game` es un ClientGame): devuelven promesas.
 */
export class Hud {
  constructor(game, { onSelect, onView, settings, onLogout }) {
    this.game = game;
    this.onSelect = onSelect;
    this.onView = onView;
    this.settings = settings;
    this.modalKind = null;
    this.ranking = null;
    this.claimable = game.claimableQuests();
    this.selected = null;
    this.view = 'isla';
    this.panelView = null;
    this.panelId = null;
    this.cache = {};
    this.chatMessages = [];
    this.chatLast = 0;
    this.chatChannel = 'global';
    this.rankTab = 'players';

    this.panel = $('#panel');
    this.sidebar = $('#sidebar');
    this.dock = $('#dock');
    this.alert = $('#alert');
    this.modal = $('#modal');
    this.viewBtn = $('#view-btn');
    this.reportsBtn = $('#reports-btn');
    this.questsBtn = $('#quests-btn');
    this.chatBtn = $('#chat-btn');
    this.chatEl = $('#chat');
    this.favorEl = $('#favor');
    this.visitorEl = $('#visitor');
    this.menu = $('#menu');
    this.mailBtn = $('#mail-btn');
    this.social = new Social(this);
    this.worldMap = new WorldMap(this);

    this.#buildResources();

    this.panel.addEventListener('click', (e) => this.#onPanelClick(e));
    this.panel.addEventListener('input', () => this.#refreshPanel());
    this.panel.addEventListener('change', () => this.#refreshPanel());
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) e.target.closest('.card, .trade, .section')?.querySelector('[data-action="train"], [data-action="trade"]')?.click();
    });
    this.dock.addEventListener('click', (e) => this.#onDockClick(e));
    this.sidebar.addEventListener('click', (e) => {
      const li = e.target.closest('[data-id], [data-select]');
      if (li) this.onSelect(li.dataset.id ?? li.dataset.select);
    });
    this.alert.addEventListener('click', () => this.onSelect('muralla'));
    this.viewBtn.addEventListener('click', () => this.onView(this.view === 'isla' ? 'mapa' : 'isla'));
    this.reportsBtn.addEventListener('click', () => this.openReports());
    this.questsBtn.addEventListener('click', () => this.openModal('quests'));
    $('#rank-btn').addEventListener('click', () => this.openModal('ranking'));
    $('#map-btn').addEventListener('click', () => this.worldMap.open());
    this.favorEl.addEventListener('click', () => this.onSelect('templo'));
    this.modal.addEventListener('click', async (e) => {
      if (e.target === this.modal || e.target.closest('[data-action="close-modal"]')) return this.closeModal();
      const claim = e.target.closest('[data-action="claim"]');
      if (claim && !claim.disabled) return this.#run(claim, () => game.claimQuest(claim.dataset.id), null, 'coins');
      const tab = e.target.closest('[data-action="rank-tab"]');
      if (tab) {
        this.rankTab = tab.dataset.tab;
        return this.#renderModal();
      }
      await this.social.onModalClick(e);
    });
    this.modal.addEventListener('submit', (e) => this.social.onModalSubmit(e));
    $('#alliance-btn').addEventListener('click', () => this.social.openAlliance());
    this.dailyBtn = $('#daily-btn');
    this.dailyBtn.addEventListener('click', () => this.social.openDaily());
    this.mailBtn.addEventListener('click', () => this.social.openMailbox('in'));
    this.visitorEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.action === 'accept') await this.#run(btn, () => game.acceptVisitor(), null, 'coins');
      else await this.#run(btn, () => game.dismissVisitor(), null, null);
    });

    // Chat
    this.chatBtn.addEventListener('click', () => this.toggleChat());
    this.chatEl.querySelector('[data-action="close-chat"]').addEventListener('click', () => this.toggleChat(false));
    this.chatEl.querySelector('.chat-form').addEventListener('submit', (e) => this.#sendChat(e));
    this.chatEl.querySelector('.chat-log').addEventListener('click', (e) => {
      const del = e.target.closest('[data-delete]')?.dataset.delete;
      if (del) {
        api('POST', '/api/admin/delete-chat', { id: Number(del) }).catch((err) => this.toast(err.message, 'error'));
        return;
      }
      const name = e.target.closest('[data-profile]')?.dataset.profile;
      if (name) this.social.openProfile(name);
    });
    this.chatEl.querySelector('.chat-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-channel]');
      if (b) this.toggleChat(true, b.dataset.channel);
    });
    try {
      this.chatRead = { global: 0, alianza: 0, ...JSON.parse(localStorage.getItem(CHAT_KEY) ?? '{}') };
    } catch {
      this.chatRead = { global: 0, alianza: 0 };
    }
    this.#pollChat();

    // Menú de opciones
    this.menu.querySelector('.menu-user').innerHTML = `⚜ <b>${escapeHtml(game.username ?? '')}</b><div class="muted small">${escapeHtml(game.homeIsland?.name ?? '')}</div>`;
    $('#menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.menu.hidden = !this.menu.hidden;
      this.menu.querySelector('[name="sound"]').checked = settings.sound();
      this.menu.querySelector('[name="daynight"]').checked = settings.dayNight();
      this.menu.querySelector('[name="notify"]').checked = settings.notify();
    });
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target)) this.menu.hidden = true;
    });
    this.menu.addEventListener('change', (e) => {
      if (e.target.name === 'sound') settings.setSound(e.target.checked);
      if (e.target.name === 'daynight') settings.setDayNight(e.target.checked);
      if (e.target.name === 'notify') settings.setNotify(e.target.checked).then((on) => (e.target.checked = on));
    });
    this.menu.querySelector('[data-action="password"]').addEventListener('click', () => {
      this.menu.hidden = true;
      this.social.openPassword();
    });
    this.menu.querySelector('[data-action="profile-me"]').addEventListener('click', () => {
      this.menu.hidden = true;
      this.social.openProfile(game.username);
    });
    this.menu.querySelector('[data-action="logout"]').addEventListener('click', () => onLogout());

    game.addEventListener('notify', (e) => this.toast(e.detail.text, e.detail.kind));
    game.addEventListener('change', () => this.render());
    game.addEventListener('offline', () => ($('#offline').hidden = false));
    game.addEventListener('online', () => ($('#offline').hidden = true));

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

  /** Abre (o actualiza) una ventana con el HTML dado. */
  showModal(kind, html) {
    this.modalKind = kind;
    this.modal.hidden = false;
    if (html) this.#setHtml(this.modal, 'modal', html);
  }

  async openModal(kind) {
    this.modalKind = kind;
    this.cache.modal = '';
    this.modal.hidden = false;
    if (kind === 'ranking') {
      this.modal.innerHTML = '<div class="modal-card narrow"><p class="muted">Cargando la clasificación…</p></div>';
      try {
        this.ranking = await this.game.fetchRanking();
      } catch (err) {
        this.modal.innerHTML = `<div class="modal-card narrow"><p class="muted">${escapeHtml(err.message)}</p></div>`;
        return;
      }
      if (this.modalKind !== 'ranking') return;
    }
    this.#renderModal();
  }

  closeModal() {
    this.modalKind = null;
    this.modal.hidden = true;
    this.modal.innerHTML = '';
  }

  #renderModal() {
    if (this.modalKind === 'quests') this.#setHtml(this.modal, 'modal', questsHtml(this.game));
    else if (this.modalKind === 'ranking' && this.ranking) this.#setHtml(this.modal, 'modal', rankingHtml(this.ranking, this.rankTab));
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
    this.dailyBtn.hidden = !this.game.dailyStatus().available;
    const mail = this.game.mailUnread ?? 0;
    const mBadge = this.mailBtn.querySelector('.badge');
    mBadge.hidden = !mail;
    mBadge.textContent = mail;
    // El título de la pestaña avisa aunque estés en otra
    const attack = this.game.raid || this.game.incoming?.length;
    document.title = `${attack ? '⚔️ ' : ''}${unread + mail ? `(${unread + mail}) ` : ''}Imperium`;

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

  /**
   * Lanza una acción en el servidor con el botón desactivado mientras tanto y
   * avisa del resultado.
   */
  async #run(btn, action, okText, sound = 'build') {
    if (btn) btn.disabled = true;
    let res;
    try {
      res = await action();
    } finally {
      if (btn?.isConnected) btn.disabled = false;
    }
    if (!res?.ok) {
      this.toast(res?.reason ?? 'No se ha podido.', 'error');
      play('error');
      return res;
    }
    if (sound) play(sound);
    if (okText) this.toast(typeof okText === 'function' ? okText(res) : okText, 'success');
    return res;
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
      const status = game.heroStatus();
      const heroLine = status
        ? `<p class="hero-line" data-select="ayuntamiento">🎖️ ${escapeHtml(game.hero.name)} · Nv ${game.hero.level}${game.hero.points ? ' · ⭐' : ''}<span class="muted small">${{ casa: 'en casa', mision: 'en el mar', herido: 'herido' }[status]}</span></p>`
        : '';
      html = `<h2>Edificios</h2><ul class="list">${items}</ul>
        <div class="army-block"><h2>Ejército</h2>${heroLine}${army ? `<ul class="army">${army}</ul>` : '<p class="muted small">Sin tropas en casa</p>'}${away}</div>`;
    } else {
      // Las islas que ves, de la más cercana a la más lejana
      const home = game.state.home;
      const views = game.world
        .islands()
        .filter((i) => i.id !== home)
        .map((i) => game.island(i.id))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 40);
      const items = views
        .map((v) => {
          const t = ISLAND_TYPES[v.type];
          let icon = v.explored ? t.icon : '❔';
          if (v.colonized) icon = '🚩';
          let tag = v.inbound.length ? '⛵' : v.explored && v.tier && !v.colonized ? `Nv ${v.tier}` : '';
          if (v.type === 'jugador') tag = `${fmtNum(v.score)}`;
          const cls = [v.id === this.selected && 'active', !v.explored && 'empty', v.type === 'jugador' && 'player'].filter(Boolean).join(' ');
          const name = v.type === 'jugador' ? `${v.name} · ${v.ownerName}` : v.name;
          return `<li data-id="${v.id}" class="${cls}" title="${escapeHtml(name)}"><span class="b-icon">${icon}</span><span class="b-name">${escapeHtml(name)}</span><span class="b-lvl">${tag || '·'}</span></li>`;
        })
        .join('');
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
    if (!id || (!BUILDINGS[id] && !this.game.world.island(id))) {
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
    const now = clock.now();
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
      if (el.dataset.pending) continue;
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

  async #onPanelClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const game = this.game;
    const root = this.panel;
    const action = btn.dataset.action;

    switch (action) {
      case 'close':
        this.onSelect(null);
        break;
      case 'upgrade':
        await this.#run(btn, () => game.upgrade(this.selected));
        break;
      case 'research': {
        const r = RESEARCH[btn.dataset.id];
        await this.#run(btn, () => game.research(btn.dataset.id), `${r.icon} Los sabios investigan ${r.name}`);
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
        await this.#run(btn, () => game.train(id, n), `${UNITS[id].icon} ${n} × ${UNITS[id].name} en camino`);
        break;
      }
      case 'cancel-train':
        await this.#run(btn, () => game.cancelTraining(btn.dataset.building, Number(btn.dataset.index)), 'Entrenamiento cancelado. Recursos devueltos.', null);
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
        await this.#run(btn, () => game.trade(from, to, amount), (res) => `⚖️ Cambiados ${RESOURCES[from].icon} ${fmtNum(res.paid)} por ${RESOURCES[to].icon} ${fmtNum(res.got)}`, 'coins');
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
        const target = this.selected;
        const payload = readPayload(root);
        const units = fleetFor(game, type, readFleet(root), payload);
        const name = game.world.island(target)?.name ?? 'la isla';
        const opts = { hero: !!root.querySelector('[name="with-hero"]')?.checked };
        const res = await this.#run(btn, () => game.sendMission(type, target, units, payload, opts), `${MISSION_TYPES[type].icon} La flota zarpa hacia ${name}`, 'sail');
        if (res?.ok) for (const input of this.panel.querySelectorAll('input[name^="f-"], input[name^="p-"]')) input.value = '';
        break;
      }
      case 'mail-to':
        this.social.compose(btn.dataset.name);
        break;
      case 'profile':
        this.social.openProfile(btn.dataset.name);
        break;
      case 'hire-hero': {
        const name = root.querySelector('[name="hero-name"]')?.value ?? '';
        await this.#run(btn, () => game.hireHero(name), null, 'success');
        break;
      }
      case 'hero-skill':
        await this.#run(btn, () => game.heroSkill(btn.dataset.skill), null, 'magic');
        break;
      case 'simulate': {
        const view = game.island(this.selected);
        const attacker = readFleet(root);
        if (!Object.keys(attacker).length) for (const id of PLAYER_UNITS) if (UNITS[id].atk > 0 && game.units[id] > 0) attacker[id] = game.units[id];
        const defender = view?.type === 'jugador' ? (view.intel?.garrison ?? {}) : (view?.garrison ?? {});
        const { atkMul, hpMul } = game.combatBonus();
        const wall = view?.type === 'jugador' ? 0.1 * (view.intel?.wall ?? 0) : (view?.wall ?? 0);
        const towers = view?.type === 'jugador' ? 10 * (view.intel?.wall ?? 0) : 0;
        this.social.openSimulator({ attacker, defender, atkMul, hpMul, wall, towers, title: `Contra ${view?.name ?? 'la isla'}` });
        break;
      }
      case 'offer-post':
      case 'offer-accept':
      case 'offer-cancel':
        await this.social.onPanelAction(action, btn, root);
        break;
      case 'power': {
        const p = POWERS[btn.dataset.id];
        const res = await this.#run(btn, () => game.castPower(btn.dataset.id), null, 'magic');
        if (res?.ok && btn.dataset.id === 'rayo') this.toast(`${p.icon} ¡Un rayo parte los mástiles piratas!`, 'success');
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
      const start = until - (p.duration * HOUR_MS) / universe.speed;
      rows.push(row({ icon: p.icon, title: p.name, start, end: until, select: 'templo' }));
    }
    for (const m of game.missions) {
      const t = MISSION_TYPES[m.type];
      if (m.phase === 'estacionada') {
        rows.push(`<div class="dock-row" data-select="${m.target}">
          <div class="q-title"><span>🛡️ Defendiendo ${escapeHtml(m.targetName ?? '')}</span><span class="muted small">${unitList(m.units)}</span></div>
          <button class="ghost small" data-action="recall" data-mission="${m.id}">Retirar</button></div>`);
        continue;
      }
      const going = m.phase === 'ida';
      const start = going ? m.depart : (m.turn ?? (m.recalled ? (m.back + m.depart) / 2 : m.arrive));
      const end = going ? m.arrive : m.back;
      rows.push(
        row({
          icon: going ? t.icon : '⚓',
          title: `${going ? t.name : 'Vuelta de'} ${escapeHtml(m.targetName ?? game.world.island(m.target)?.name ?? '')}${m.hero ? ' 🎖️' : ''}`,
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

  async #onDockClick(e) {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'recall') {
        await this.#run(btn, () => this.game.recall(Number(btn.dataset.mission)), 'La flota da media vuelta.', 'sail');
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
      if (action === 'cancel-build') await this.#run(btn, () => this.game.cancel(), 'Obra cancelada. Recursos devueltos.', null);
      if (action === 'cancel-research') await this.#run(btn, () => this.game.cancelResearch(), 'Investigación cancelada. Recursos devueltos.', null);
      return;
    }
    const rowEl = e.target.closest('[data-select]');
    if (rowEl) this.onSelect(rowEl.dataset.select);
  }

  // ── Avisos: piratas y ataques de otros jugadores ──────────────────────────

  #renderAlert() {
    const raid = this.game.raid;
    const incoming = this.game.incoming ?? [];
    this.alert.hidden = !raid && !incoming.length;
    if (this.alert.hidden) {
      this.cache.alert = '';
      return;
    }
    const lines = [];
    if (raid) lines.push(`<div><b>¡Piratas a la vista!</b> Llegan en <span data-until="${raid.arrival}"></span> · ${unitList(raid.army)}</div>`);
    for (const m of incoming.slice(0, 3)) {
      lines.push(`<div><b>¡Ataque de ${escapeHtml(m.from)}!</b> ${fmtNum(m.size)} unidades desde ${escapeHtml(m.fromIsland ?? '')} · llegan en <span data-until="${m.arrive}"></span></div>`);
    }
    const html = `<span class="alert-icon">${incoming.length ? '⚔️' : '🏴‍☠️'}</span>
      <div>${lines.join('')}<div class="small">Defiende con tropas en casa, la muralla y la Égida del templo</div></div>`;
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

  // ── Chat ──────────────────────────────────────────────────────────────────

  toggleChat(open = this.chatEl.hidden, channel = this.chatChannel) {
    this.chatEl.hidden = !open;
    if (!open) return;
    this.chatChannel = channel === 'alianza' && !this.game.alliance ? 'global' : channel;
    this.#renderChat(true);
    this.chatEl.querySelector('input').focus();
  }

  async #pollChat() {
    await this.#fetchChat();
    // Con la conexión en vivo los mensajes llegan solos; esto es solo por si acaso
    const wait = this.game.live ? 60_000 : this.chatEl.hidden ? 15_000 : 3_000;
    setTimeout(() => this.#pollChat(), wait);
  }

  /** Mensaje que llega por la conexión en vivo. */
  receiveChat(message) {
    if (message.id <= this.chatLast) return;
    this.chatMessages.push(message);
    if (this.chatMessages.length > 200) this.chatMessages.shift();
    this.chatLast = message.id;
    this.#renderChat();
  }

  removeChat(id) {
    this.chatMessages = this.chatMessages.filter((m) => m.id !== id);
    this.#renderChat();
  }

  async #fetchChat(scroll = false) {
    try {
      const { messages } = await api('GET', `/api/chat?after=${this.chatLast}`);
      if (messages.length) {
        this.chatMessages.push(...messages);
        if (this.chatMessages.length > 200) this.chatMessages.splice(0, this.chatMessages.length - 200);
        this.chatLast = messages.at(-1).id;
        this.#renderChat(scroll);
      }
    } catch {
      // se reintenta en la siguiente vuelta
    }
  }

  #renderChat(scroll = false) {
    const ch = this.chatChannel;
    const hasAlliance = !!this.game.alliance;
    for (const b of this.chatEl.querySelectorAll('[data-channel]')) {
      b.classList.toggle('active', b.dataset.channel === ch);
      if (b.dataset.channel === 'alianza') b.hidden = !hasAlliance;
    }
    this.chatEl.querySelector('.chat-sub').textContent =
      ch === 'alianza' ? `Solo para ${this.game.alliance?.name ?? 'tu alianza'}` : 'Todo el archipiélago lo lee';
    const log = this.chatEl.querySelector('.chat-log');
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.innerHTML = this.chatMessages
      .filter((m) => (m.channel ?? 'global') === ch)
      .map((m) => {
        const time = new Date(m.t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return m.system
          ? `<div class="msg system"><span>${escapeHtml(m.text)}</span><time>${time}</time></div>`
          : `<div class="msg${m.name === this.game.username ? ' mine' : ''}"><b data-profile="${escapeHtml(m.name)}">${escapeHtml(m.name)}</b> <span>${escapeHtml(m.text)}</span><time>${time}</time>${
              this.game.admin ? `<button class="msg-del" data-delete="${m.id}" title="Borrar mensaje">✕</button>` : ''
            }</div>`;
      })
      .join('');
    if (scroll || atBottom) log.scrollTop = log.scrollHeight;
    if (!this.chatEl.hidden) this.#markChatRead(ch);

    // Mensajes sin leer de otros jugadores, por canal y en total
    let total = 0;
    for (const channel of ['global', 'alianza']) {
      const n = this.chatMessages.filter((m) => (m.channel ?? 'global') === channel && m.id > this.chatRead[channel] && !m.system && m.name !== this.game.username).length;
      const tabBadge = this.chatEl.querySelector(`[data-channel="${channel}"] .badge`);
      tabBadge.hidden = !n;
      tabBadge.textContent = n > 9 ? '9+' : n;
      total += n;
    }
    const badge = this.chatBtn.querySelector('.badge');
    badge.hidden = !total;
    badge.textContent = total > 9 ? '9+' : total;
  }

  #markChatRead(channel) {
    const last = this.chatMessages.filter((m) => (m.channel ?? 'global') === channel).at(-1)?.id ?? 0;
    if (last <= this.chatRead[channel]) return;
    this.chatRead[channel] = last;
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(this.chatRead));
    } catch {
      // sin almacenamiento
    }
    queueMicrotask(() => this.#renderChat());
  }

  async #sendChat(e) {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      // Los moderadores pueden hacer anuncios con /anuncio
      if (this.game.admin && text.startsWith('/anuncio ')) await api('POST', '/api/admin/broadcast', { text: text.slice(9) });
      else await api('POST', '/api/chat', { text, channel: this.chatChannel });
      await this.#fetchChat(true);
    } catch (err) {
      input.value = text;
      this.toast(err.message, 'error');
    }
  }

  #setHtml(el, key, html) {
    if (this.cache[key] === html) return;
    this.cache[key] = html;
    el.innerHTML = html;
  }
}
