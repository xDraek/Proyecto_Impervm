import { play } from '../audio.js';
import { clock, universe } from '../config.js';
import { BUILDINGS, BUILDING_KEYS, FEATS, ISLAND_TYPES, MISSION_TYPES, PLAYER_UNITS, POWERS, RESEARCH, RESOURCES, RESOURCE_KEYS, UNITS, VISITORS } from '../game/data.js';
import { HOUR_MS, canAfford, multiplyCost, upcomingWorldEvents } from '../game/rules.js';
import { api } from '../net/api.js';
import { armyHtml, armySummary, featWait } from './army.js';
import { buildingPanel } from './buildingPanel.js';
import { bag, costItems, escapeHtml, fmtNum, fmtTime, unitList } from './format.js';
import { fleetFor, islandPanel, readFleet, readPayload, readOpts } from './islandPanel.js';
import { questsHtml, rankingHtml } from './modals.js';
import { openGuide } from './guide.js';
import { Tutorial } from './tutorial.js';
import { WorldMap } from './worldMap.js';
import { reportsHtml, playReplay, sharedReportHtml } from './reports.js';
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

    // El marco (lo que se muestra u oculta) y dentro, el contenido que se desplaza
    this.panelBox = $('#panel');
    this.panel = $('#panel > .scroll');
    this.sidebar = $('#sidebar > .scroll');
    this.dockBox = $('#dock');
    this.dock = $('#dock > .scroll');
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
    this.allianceBtn = $('#alliance-btn');
    this.vacationEl = $('#vacation');
    this.social = new Social(this);
    this.worldMap = new WorldMap(this);

    this.#buildResources();

    this.panel.addEventListener('click', (e) => this.#onPanelClick(e));
    this.panel.addEventListener('input', () => this.#refreshPanel());
    this.panel.addEventListener('change', (e) => {
      // Cambiar el origen de la flota cambia las tropas que se pueden mandar
      if (e.target.name === 'from') {
        this.fleetFrom = e.target.value;
        this.#renderPanel();
      }
      this.#refreshPanel();
      // Al soltar el control de trabajadores, se aplica
      const id = e.target.dataset?.work;
      if (id) {
        const pct = Number(e.target.value);
        this.#run(null, () => this.game.setWork(id, pct), `👷 ${BUILDINGS[id].name}: ${pct} % de los trabajadores produciendo`, 'click');
      }
    });
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) e.target.closest('.card, .trade, .section')?.querySelector('[data-action="train"], [data-action="trade"]')?.click();
    });
    this.dock.addEventListener('click', (e) => this.#onDockClick(e));
    this.sidebar.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="army"]')) return this.openModal('army');
      const li = e.target.closest('[data-id], [data-select]');
      if (li) this.onSelect(li.dataset.id ?? li.dataset.select);
    });
    this.alert.addEventListener('click', () => this.onSelect(this.alertTarget ?? 'muralla'));
    this.viewBtn.addEventListener('click', () => this.onView(this.view === 'isla' ? 'mapa' : 'isla'));
    this.reportsBtn.addEventListener('click', () => this.openReports());
    this.questsBtn.addEventListener('click', () => this.openModal('quests'));
    this.armyBtn = $('#army-btn');
    this.armyBtn.addEventListener('click', () => this.openModal('army'));
    this.friendsBtn = $('#friends-btn');
    this.friendsBtn.addEventListener('click', () => this.social.openFriends());
    $('#rank-btn').addEventListener('click', () => this.openModal('ranking'));
    $('#map-btn').addEventListener('click', () => this.worldMap.open());
    this.favorEl.addEventListener('click', () => this.onSelect('templo'));
    this.eventEl = $('#event-pill');
    this.eventEl.addEventListener('click', () => this.openEvents());
    this.modal.addEventListener('click', async (e) => {
      if (e.target === this.modal || e.target.closest('[data-action="close-modal"]')) return this.closeModal();
      // Enlaces a un tema de la guía (dentro de la guía o desde otra ventana)
      const guide = e.target.closest('[data-guide]');
      if (guide) return openGuide(this, { topic: guide.dataset.guide });
      const task = e.target.closest('[data-action="claim-task"]');
      if (task && !task.disabled) return this.#run(task, () => game.claimTask(task.dataset.id), null, 'coins');
      // Ventana del ejército: retirar flotas, abrir el simulador o ir a un edificio o isla
      if (this.modalKind === 'army') {
        const recall = e.target.closest('[data-action="recall"]');
        if (recall) return this.#run(recall, () => game.recall(Number(recall.dataset.mission)), 'La flota da media vuelta.', 'sail');
        const plunder = e.target.closest('[data-action="plunder"]');
        if (plunder && !plunder.disabled) return this.#run(plunder, () => game.plunder(Number(plunder.dataset.mission)), null, 'coins');
        if (e.target.closest('[data-action="army-sim"]')) {
          const attacker = Object.fromEntries(Object.entries(game.units).filter(([, n]) => n > 0));
          return this.social.openSimulator({ attacker, title: 'Tu ejército en casa' });
        }
        const go = e.target.closest('[data-select]');
        if (go) {
          this.closeModal();
          return this.onSelect(go.dataset.select);
        }
      }
      const claim = e.target.closest('[data-action="claim"]');
      if (claim && !claim.disabled) return this.#run(claim, () => game.claimQuest(claim.dataset.id), null, 'coins');
      const share = e.target.closest('[data-action="share-report"]');
      if (share) {
        const channel = this.game.alliance && confirm('¿Compartirlo solo con tu alianza? (Cancelar = en el chat general)') ? 'alianza' : 'global';
        api('POST', '/api/chat/share', { t: Number(share.dataset.t), channel })
          .then(() => {
            this.toast('📢 Informe compartido en el chat', 'success');
            share.disabled = true;
          })
          .catch((err) => this.toast(err.message, 'error'));
        return;
      }
      const replay = e.target.closest('[data-action="replay"]');
      if (replay) {
        const report = this.modalKind === 'shared' ? this.sharedReport : this.game.reports.find((r) => r.t === Number(replay.dataset.t) && r.battle?.log);
        if (report) playReplay(replay, report);
        return;
      }
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
      const shared = e.target.closest('[data-shared]')?.dataset.shared;
      if (shared) {
        const m = this.chatMessages.find((x) => x.id === Number(shared));
        if (m?.report) {
          this.sharedReport = m.report;
          this.showModal('shared', sharedReportHtml(m));
        }
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
    $('#menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.menu.hidden = !this.menu.hidden;
      if (this.menu.hidden) return;
      const tag = game.alliance ? ` <span class="muted">[${escapeHtml(game.alliance.tag)}]</span>` : '';
      this.menu.querySelector('.menu-user').innerHTML = `<span class="menu-avatar">${escapeHtml(game.state.banner?.emblem ?? '⚜')}</span>
        <div><b>${escapeHtml(game.username ?? '')}</b>${tag}<div class="muted small">${escapeHtml(game.homeIsland?.name ?? '')} · ${fmtNum(game.score())} puntos</div></div>`;
      this.menu.querySelector('[name="sound"]').checked = settings.sound();
      this.menu.querySelector('[name="music"]').checked = settings.music();
      for (const [name, value] of [['music-volume', settings.musicVolume()], ['ambient-volume', settings.ambientVolume()]]) {
        const vol = Math.round(value * 100);
        this.menu.querySelector(`[name="${name}"]`).value = vol;
        this.menu.querySelector(`.volume-pct[data-for="${name}"]`).textContent = `${vol} %`;
      }
      this.menu.querySelector('[name="daynight"]').checked = settings.dayNight();
      this.menu.querySelector('[name="labels"]').checked = settings.labels();
      this.menu.querySelector('[name="quality"]').checked = settings.quality();
      this.menu.querySelector('[name="notify"]').checked = settings.notify();
    });
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target)) this.menu.hidden = true;
    });
    this.menu.addEventListener('change', (e) => {
      if (e.target.name === 'sound') settings.setSound(e.target.checked);
      if (e.target.name === 'music') {
        settings.setMusic(e.target.checked);
        // Puede haber vuelto a un volumen audible
        const vol = Math.round(settings.musicVolume() * 100);
        this.menu.querySelector('[name="music-volume"]').value = vol;
        this.menu.querySelector('.volume-pct[data-for="music-volume"]').textContent = `${vol} %`;
      }
      if (e.target.name === 'daynight') settings.setDayNight(e.target.checked);
      if (e.target.name === 'labels') settings.setLabels(e.target.checked);
      if (e.target.name === 'quality') settings.setQuality(e.target.checked);
      if (e.target.name === 'notify') settings.setNotify(e.target.checked).then((on) => (e.target.checked = on));
    });
    // Volumen de la música y del ambiente: cambian mientras se arrastra
    this.menu.addEventListener('input', (e) => {
      if (e.target.name !== 'music-volume' && e.target.name !== 'ambient-volume') return;
      const v = Number(e.target.value);
      if (e.target.name === 'music-volume') {
        settings.setMusicVolume(v / 100);
        this.menu.querySelector('[name="music"]').checked = settings.music();
      } else settings.setAmbientVolume(v / 100);
      this.menu.querySelector(`.volume-pct[data-for="${e.target.name}"]`).textContent = `${v} %`;
    });
    this.menu.querySelector('[data-action="guide"]').addEventListener('click', () => {
      this.menu.hidden = true;
      openGuide(this);
    });
    this.menu.querySelector('[data-action="vacation"]').addEventListener('click', () => {
      this.menu.hidden = true;
      this.social.openVacation();
    });
    this.vacationEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) this.social.openVacation();
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

    // Los paneles empiezan debajo de la barra superior, mida lo que mida (con sitio para los
    // adornos de su marco, que sobresalen por arriba)
    const topbar = $('#topbar');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--top', `${topbar.getBoundingClientRect().bottom + 30}px`);
    }).observe(topbar);

    this.render();
    if (!game.showcase) this.tutorial = new Tutorial(this);
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
    this.#reveal();
    this.modal.querySelector('details')?.setAttribute('open', '');
    this.game.markReportsRead();
  }

  /** Al abrir (no al redibujar) la ventana entra con su animación. */
  #reveal() {
    this.menu.hidden = true;
    if (!this.modal.hidden) return;
    this.modal.hidden = false;
    this.modal.classList.add('opening');
    clearTimeout(this.openingTimer);
    this.openingTimer = setTimeout(() => this.modal.classList.remove('opening'), 300);
  }

  /** Abre (o actualiza) una ventana con el HTML dado. */
  showModal(kind, html) {
    this.modalKind = kind;
    this.#reveal();
    if (html) this.#setHtml(this.modal, 'modal', html);
  }

  async openModal(kind) {
    this.modalKind = kind;
    this.cache.modal = '';
    this.#reveal();
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
    else if (this.modalKind === 'army') this.#setHtml(this.modal, 'modal', armyHtml(this.game));
    else if (this.modalKind === 'ranking' && this.ranking) this.#setHtml(this.modal, 'modal', rankingHtml(this.ranking, this.rankTab));
  }

  /** Regenera lo que dependa de la partida (solo si su HTML cambia). */
  render() {
    this.#renderSidebar();
    this.#renderPanel();
    this.#renderDock();
    this.#renderAlert();
    this.#renderVisitor();
    this.#renderVacation();
    this.#renderModal();
    const friendBadge = this.friendsBtn.querySelector('.badge');
    friendBadge.hidden = !this.game.friendRequests;
    friendBadge.textContent = this.game.friendRequests;
    // Una solicitud nueva con la ventana de amigos abierta: que aparezca sin cerrarla
    if (this.modalKind === 'friends' && !this.modal.hidden && this.social.friends && this.social.friendRequests !== this.game.friendRequests) {
      this.social.friendRequests = this.game.friendRequests;
      this.social.openFriends(null, { refresh: true });
    }
    const armyBadge = this.armyBtn.querySelector('.badge');
    armyBadge.hidden = !this.game.missions.length;
    armyBadge.textContent = this.game.missions.length;
    const forum = (this.game.forumUnread ?? 0) + (this.game.allianceApplications ?? 0);
    const fBadge = this.allianceBtn.querySelector('.badge');
    fBadge.hidden = !forum;
    fBadge.textContent = forum;
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
    // (la primera vez solo se cuenta: lo que ya estaba cumplido al entrar no suena)
    if (this.claimable !== undefined && claimable > this.claimable) {
      const q = this.game.activeQuests().find((x) => x.done);
      const task = this.game.dailyTasks().find((t) => t.done && !t.claimed && !this.tasksDone?.has(t.id));
      if (task) this.toast(`📋 Encargo cumplido: ${task.text}. ¡Cobra la recompensa!`, 'success');
      else if (q) this.toast(`📋 Misión cumplida: ${q.title}. ¡Reclama la recompensa!`, 'success');
      play('fanfare');
    }
    this.claimable = claimable;
    this.tasksDone = new Set(this.game.dailyTasks().filter((t) => t.done).map((t) => t.id));
    this.update();
  }

  /** Refresco rápido: recursos, barras y botones. */
  update() {
    this.#updateResources();
    this.#updateFavor();
    this.#updateEvent();
    this.#refreshLive(this.panel);
    this.#refreshLive(this.dock);
    this.#refreshLive(this.alert);
    this.#refreshLive(this.visitorEl);
    this.#refreshLive(this.vacationEl);
    this.#refreshLive(this.modal);
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
      const paused = !!game.state.vacation;
      const rate = paused ? 0 : prod[key];
      els.amount.textContent = fmtNum(amount);
      let rateText = `${rate < 0 ? '−' : '+'}${fmtNum(Math.abs(rate))}/h`;
      if (paused) rateText = '⏸️ vacaciones';
      else if (key === 'comida' && starving) rateText = '¡Hambruna!';
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
      else if (eco.closed && game.colonies().some((c) => c.specialty === key)) lines.push('Colonias: nada (tu puerto está en manos enemigas)');
      if (eco.tribute?.[key]) lines.push(`Tributo para los invasores: −${fmtNum(eco.tribute[key])}/h`);
      if (key === 'oro' && eco.taxes) lines.push(`Impuestos de los trabajadores libres: +${fmtNum(eco.taxes)}/h`);
      if (key === 'oro' && eco.pay) lines.push(`Paga de las tropas de élite: −${fmtNum(eco.pay)}/h`);
      if (eco.eventBonus?.[key]) lines.push(`Evento del archipiélago: +${Math.round(eco.eventBonus[key] * 100)} %`);
      if (key === 'comida' && eco.upkeep) lines.push(`Tropas: −${fmtNum(eco.upkeep)}/h`);
      if (starving) lines.push('Hambruna: la producción cae a la mitad');
      els.root.title = lines.join('\n');
    }
  }

  /** La temporada del archipiélago, con lo que le queda. */
  #updateEvent() {
    const ev = this.game.worldEvent();
    const left = fmtTime(Math.max(0, (ev.end - this.game.now()) / 1000));
    const text = ev.event ? `${ev.event.icon} ${left}` : `🌤️ ${left}`;
    if (this.eventEl.textContent !== text) this.eventEl.textContent = text;
    this.eventEl.classList.toggle('active', !!ev.event);
    const title = ev.event ? `${ev.event.name}: ${ev.event.text}\nTermina en ${left}. Clic para ver el calendario.` : `Mares tranquilos. La próxima temporada puede empezar en ${left}.\nClic para ver el calendario.`;
    if (this.eventEl.title !== title) this.eventEl.title = title;
  }

  openGuide(topic) {
    openGuide(this, { topic });
  }

  openEvents() {
    const now = this.game.now();
    const cur = this.game.worldEvent(now);
    const when = (t) => new Date(t).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const row = (ev, current) => `<div class="event-row ${current ? 'current' : ''} ${ev.event ? '' : 'calm'}">
        <span class="event-icon">${ev.event ? ev.event.icon : '🌤️'}</span>
        <div><b>${ev.event ? ev.event.name : 'Mares tranquilos'}</b><div class="small muted">${ev.event ? ev.event.text : 'Sin temporada especial.'}</div></div>
        <span class="small">${current ? `quedan ${fmtTime((ev.end - now) / 1000)}` : when(ev.start)}</span>
      </div>`;
    const next = upcomingWorldEvents(now, 4);
    this.showModal(
      'events',
      `<div class="modal-card narrow">
        <div class="panel-head"><span class="panel-icon">📅</span><div><h3>Calendario del archipiélago</h3><div class="panel-lvl">Temporadas para todos los jugadores a la vez</div></div>
        <button class="icon-btn help-btn" data-guide="eventos" title="Qué es esto (guía)">?</button><button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
        <h4>Ahora</h4>${row(cur, true)}
        <h4>Próximamente</h4>${next.map((ev) => row(ev, false)).join('')}
        <p class="muted small">Aprovecha la Fiebre del oro para guardar oro, el Festival de Poseidón para acumular favor o la Gran feria para cambiar en el mercado.</p>
      </div>`,
    );
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
      const status = game.heroStatus();
      const heroLine = status
        ? `<p class="hero-line" data-select="ayuntamiento">🎖️ ${escapeHtml(game.hero.name)} · Nv ${game.hero.level}${game.hero.points ? ' · ⭐' : ''}<span class="muted small">${{ casa: 'en casa', mision: 'en el mar', herido: 'herido' }[status]}</span></p>`
        : '';
      html = `${armySummary(game)}${heroLine}<h2>Edificios</h2><ul class="list">${items}</ul>`;
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
          if (v.colonized && !v.inbound.length) tag = `${v.colony?.upgradeEnd ? '🔨 ' : ''}Nv ${v.colony?.level ?? 1}`;
          if (v.type === 'jugador') tag = `${fmtNum(v.score)}`;
          const cls = [v.id === this.selected && 'active', !v.explored && 'empty', v.type === 'jugador' && 'player'].filter(Boolean).join(' ');
          const name = v.type === 'jugador' ? `${v.name} · ${v.ownerName}` : v.name;
          return `<li data-id="${v.id}" class="${cls}" title="${escapeHtml(name)}"><span class="b-icon">${icon}</span><span class="b-name">${escapeHtml(name)}</span><span class="b-lvl">${tag || '·'}</span></li>`;
        })
        .join('');
      html = `${armySummary(game)}<h2>Archipiélago</h2><ul class="list">${items}</ul>
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
      this.panelBox.hidden = true;
      this.panelView = null;
      this.panelId = null;
      this.cache.panel = '';
      return;
    }
    const view = BUILDINGS[id] ? buildingPanel(this, id) : islandPanel(this, id);
    this.panelView = view;
    this.panelBox.hidden = false;
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
    // Botones que se habilitan solos al llegar su hora (el saqueo de una ciudad ocupada)
    for (const el of root.querySelectorAll('[data-ready-at]')) {
      const off = now < Number(el.dataset.readyAt);
      if (el.disabled !== off) el.disabled = off;
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
    const site = e.target.closest('[data-select]');
    if (site && this.panel.contains(site) && !e.target.closest('[data-action]')) return this.onSelect(site.dataset.select);
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
        await this.#run(btn, () => game.upgrade(this.selected), null, 'hammer');
        break;
      case 'hire':
        await this.#run(btn, () => game.hireMercenaries(btn.dataset.id), null, 'coins');
        break;
      case 'relic-equip':
        await this.#run(btn, () => game.equipRelic(btn.dataset.id, btn.dataset.on === '1'), null, 'magic');
        break;
      case 'relic-sell':
        if (!confirm('¿Vender esta reliquia? No la volverás a ver.')) break;
        await this.#run(btn, () => game.sellRelic(btn.dataset.id), null, 'coins');
        break;
      case 'donate': {
        const bag = {};
        for (const input of root.querySelectorAll('input[name^="w-"]')) {
          const n = Math.floor(Number(input.value) || 0);
          if (n > 0) bag[input.name.slice(2)] = n;
        }
        const res = await this.#run(btn, () => game.donateWonder(this.selected, bag), '🏛️ ¡Gracias! Tu aporte ya está en la obra', 'coins');
        if (res?.ok) for (const input of root.querySelectorAll('input[name^="w-"]')) input.value = '';
        break;
      }
      case 'colony-upgrade':
        await this.#run(btn, () => game.upgradeColony(this.selected), '🔨 Los colonos se ponen manos a la obra', 'hammer');
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
        input.value = btn.dataset.max ?? game.units[btn.dataset.unit];
        this.#refreshPanel();
        break;
      }
      case 'mission': {
        const type = btn.dataset.type;
        const target = this.selected;
        const payload = readPayload(root);
        const opts = readOpts(root);
        const units = fleetFor(game, type, readFleet(root), payload, opts.from);
        const name = game.world.island(target)?.name ?? 'la isla';
        const res = await this.#run(btn, () => game.sendMission(type, target, units, payload, opts), opts.join ? `🤝 Tu flota se une al ataque contra ${name}` : `${MISSION_TYPES[type].icon} La flota zarpa hacia ${name}`, 'sail');
        if (res?.ok) for (const input of this.panel.querySelectorAll('input[name^="f-"], input[name^="p-"]')) input.value = '';
        break;
      }
      case 'recall':
        await this.#run(btn, () => game.recall(Number(btn.dataset.mission)), 'La flota da media vuelta.', 'sail');
        break;
      case 'plunder':
        await this.#run(btn, () => game.plunder(Number(btn.dataset.mission)), null, 'coins');
        break;
      case 'pledge-feat': {
        const site = btn.dataset.site;
        const f = game.island(site)?.feat;
        if (!confirm(`¿Jurar combatir a ${f?.enemy ?? 'la bestia'}? Si juras y no traes ninguna flota, serás perjuro: ceniza en tu producción y unos días sin poder jurar otra gesta.`)) break;
        await this.#run(btn, () => game.pledgeFeat(site), null, 'magic');
        break;
      }
      case 'break-port':
        if (!confirm(game.state.occupied ? '¿Atacar a los invasores con todo lo que tienes en casa?' : '¿Atacar la flota que bloquea tu puerto con tus barcos de guerra?')) break;
        await this.#run(btn, () => game.breakPort(), null, 'sail');
        break;
      case 'guide':
        openGuide(this, { topic: btn.dataset.topic });
        break;
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
        if (!Object.keys(attacker).length) for (const id of PLAYER_UNITS) if ((UNITS[id].atk > 0 || id === 'mercante') && game.units[id] > 0) attacker[id] = game.units[id];
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

    // Ataques conjuntos: a cuál te has unido, o cuántos aliados van con el tuyo
    const jointTag = (m) => {
      if (m.phase !== 'ida') return '';
      if (m.joint) return ` 🤝 con ${escapeHtml(m.leader ?? '')}`;
      const j = game.world.jointAttack?.(`${game.userId}-${m.id}`);
      return j?.allies ? ` 🤝 +${j.allies}` : '';
    };
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
    // Efectos de las gestas: la bendición del Olimpo y la ceniza del perjuro
    for (const [id, icon, title, hours] of [
      ['olimpo', '✨', `Bendición del Olimpo · +${Math.round(FEATS.reward.blessing * 100)} %`, FEATS.reward.blessingHours],
      ['ceniza', '🌫️', `Ceniza del perjuro · −${Math.round(FEATS.perjury.ash * 100)} %`, FEATS.perjury.hours],
    ]) {
      const until = game.buffUntil(id);
      if (until) rows.push(row({ icon, title, start: until - (hours * HOUR_MS) / universe.speed, end: until }));
    }
    for (const m of game.missions) {
      const t = MISSION_TYPES[m.type];
      const feat = m.feat != null && m.phase === 'estacionada' ? featWait(game, m) : null;
      if (feat) {
        rows.push(`<div class="dock-row" data-select="${m.target}">
          <div class="q-title"><span>${feat.icon} Esperando a ${escapeHtml(feat.enemy)}</span><span class="q-time" data-until="${feat.until}"></span></div>
          <button class="ghost small" data-action="recall" data-mission="${m.id}">Retirar</button></div>`);
        continue;
      }
      if (m.phase === 'estacionada') {
        const what = { invadir: '🦅 Ocupando', bloquear: '⛓️ Bloqueando' }[m.type] ?? '🛡️ Defendiendo';
        const until = m.until ? `<span class="q-time" data-until="${m.until}"></span>` : `<span class="muted small">${unitList(m.units)}</span>`;
        const ready = (m.plunderAt ?? 0) <= game.now();
        const plunder = m.type === 'invadir' ? `<button class="primary small" data-action="plunder" data-mission="${m.id}" data-ready-at="${m.plunderAt ?? 0}" ${ready ? '' : 'disabled'} title="Saquear su almacén y mandar el tributo a casa">💰 Saquear</button>` : '';
        rows.push(`<div class="dock-row" data-select="${m.target}">
          <div class="q-title"><span>${what} ${escapeHtml(m.targetName ?? '')}</span>${until}</div>
          ${plunder}<button class="ghost small" data-action="recall" data-mission="${m.id}">Retirar</button></div>`);
        continue;
      }
      if (m.type === 'tributo') {
        rows.push(row({ icon: t.icon, title: `Botín de ${escapeHtml(m.targetName ?? '')}`, start: m.turn ?? m.arrive, end: m.back, select: m.target }));
        continue;
      }
      const going = m.phase === 'ida';
      const start = going ? m.depart : (m.turn ?? (m.recalled ? (m.back + m.depart) / 2 : m.arrive));
      const end = going ? m.arrive : m.back;
      rows.push(
        row({
          icon: going ? t.icon : '⚓',
          title: `${going ? t.name : 'Vuelta de'} ${escapeHtml(m.targetName ?? game.world.island(m.target)?.name ?? '')}${m.fromName ? ` <span class="muted small">desde ${escapeHtml(m.fromName)}</span>` : ''}${m.hero ? ' 🎖️' : ''}${jointTag(m)}`,
          start,
          end,
          select: m.target,
          buttons: going ? `<button class="ghost small" data-action="recall" data-mission="${m.id}">Retirar</button>` : '',
        }),
      );
    }
    this.#setHtml(this.dock, 'dock', rows.join(''));
    this.dockBox.hidden = !rows.length;
  }

  async #onDockClick(e) {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'recall') {
        await this.#run(btn, () => this.game.recall(Number(btn.dataset.mission)), 'La flota da media vuelta.', 'sail');
        return;
      }
      if (action === 'plunder') {
        await this.#run(btn, () => this.game.plunder(Number(btn.dataset.mission)), null, 'coins');
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
    // Hordas en los continentes donde tienes colonias
    const lands = new Set(this.game.colonies().map((c) => this.game.world.island(c.id)?.land).filter(Boolean));
    const hordes = [...lands].map((id) => ({ id, isl: this.game.world.island(id), h: this.game.world.islandState(id)?.horde })).filter((x) => x.h && x.isl);
    const s = this.game.state;
    const port = s.occupied ?? s.blockade;
    const feat = this.#featCall();
    this.alert.hidden = !raid && !incoming.length && !hordes.length && !port && !feat;
    if (this.alert.hidden) {
      this.cache.alert = '';
      return;
    }
    this.alertTarget = port ? 'puerto' : raid || incoming.length ? 'muralla' : hordes.length ? hordes[0].id : feat.site;
    const lines = [];
    if (s.occupied) lines.push(`<div><b>🦅 ¡${escapeHtml(port.name)} ocupa tu ciudad!</b> Se llevan parte de lo que produces · se irán en <span data-until="${port.until}"></span></div>`);
    else if (s.blockade) lines.push(`<div><b>⛓️ ¡${escapeHtml(port.name)} bloquea tu puerto!</b> No zarpa ni entra nadie · como mucho <span data-until="${port.until}"></span></div>`);
    for (const x of hordes) {
      const left = Object.values(x.h.garrison).reduce((a, b) => a + b, 0);
      lines.push(`<div><b>🔥 ¡Horda en ${escapeHtml(x.isl.name)}!</b> ${fmtNum(left)} bárbaros · arrasará tus colonias en <span data-until="${x.h.deadline}"></span></div>`);
    }
    if (feat) lines.push(`<div><b>${feat.icon} ${escapeHtml(feat.title)}</b> ${feat.text} <span data-until="${feat.until}"></span></div>`);
    if (raid) lines.push(`<div><b>¡Piratas a la vista!</b> Llegan en <span data-until="${raid.arrival}"></span> · ${unitList(raid.army)}</div>`);
    for (const m of incoming.slice(0, 3)) {
      const what = { invadir: 'Invasión', bloquear: 'Bloqueo' }[m.type] ?? 'Ataque';
      lines.push(`<div><b>¡${what} de ${escapeHtml(m.from)}!</b> ${fmtNum(m.size)} unidades desde ${escapeHtml(m.fromIsland ?? '')} · llegan en <span data-until="${m.arrive}"></span></div>`);
    }
    const tip = port
      ? 'Pulsa para ver tu puerto y echarlos, o pide tropas de apoyo a tu alianza'
      : raid || incoming.length
        ? 'Defiende con tropas en casa, la muralla y la Égida del templo'
        : hordes.length
          ? 'Pulsa para ver la horda y mandar tus tropas contra ella'
          : 'Pulsa para ver la gesta en su continente';
    const html = `<span class="alert-icon">${s.occupied ? '🦅' : s.blockade ? '⛓️' : incoming.length ? '⚔️' : raid ? '🏴‍☠️' : hordes.length ? '🔥' : feat.icon}</span>
      <div>${lines.join('')}<div class="small">${tip}</div></div>`;
    this.#setHtml(this.alert, 'alert', html);
  }

  /** La gesta a la que te han convocado, si te toca hacer algo: jurar o mandar tu flota. */
  #featCall() {
    const f = this.game.featInfo();
    if (!f || (f.stage !== 'presagio' && f.stage !== 'lucha')) return null;
    const name = f.name;
    if (!f.pledged) {
      if (!f.convoked || !f.pledgeOpen) return null;
      return { site: f.site, icon: f.icon, title: `¡${f.enemy} despierta en ${name}!`, text: f.stage === 'presagio' ? 'Estás convocado: jura la gesta · emerge en' : 'Aún puedes jurar la gesta · próxima oleada en', until: f.stage === 'presagio' ? f.start : f.nextWave };
    }
    if (this.game.state.missions.some((m) => m.target === f.site && m.phase !== 'vuelta')) return null;
    return { site: f.site, icon: f.icon, title: `${f.enemy} en ${name}`, text: f.stage === 'presagio' ? 'Has jurado: manda tu flota · emerge en' : 'Has jurado y tu flota no está: mándala · próxima oleada en', until: f.stage === 'presagio' ? f.start : f.nextWave };
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

  #renderVacation() {
    const v = this.game.state.vacation;
    this.vacationEl.hidden = !v;
    if (!v) {
      this.cache.vacation = '';
      return;
    }
    const html = `<span class="alert-icon">🏖️</span>
      <div class="visitor-body"><b>Modo vacaciones</b>
        <div class="small">Tu isla descansa: no produce y nadie puede atacarla.${v.until > this.game.now() ? ` Puedes volver en <span data-until="${v.until}"></span>.` : ''}</div></div>
      <button class="primary small auto" data-action="vacation">Volver al juego</button>`;
    this.#setHtml(this.vacationEl, 'vacation', html);
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
    if (this.#addChat([message])) this.#renderChat();
  }

  /**
   * Añade mensajes que aún no estén: el mismo puede llegar a la vez por la conexión en vivo
   * y por la consulta que se hace al enviar (así no sale dos veces). Devuelve si ha añadido alguno.
   */
  #addChat(messages) {
    const known = new Set(this.chatMessages.map((m) => m.id));
    const fresh = messages.filter((m) => !known.has(m.id));
    if (!fresh.length) return false;
    this.chatMessages.push(...fresh);
    this.chatMessages.sort((a, b) => a.id - b.id);
    if (this.chatMessages.length > 200) this.chatMessages.splice(0, this.chatMessages.length - 200);
    this.chatLast = Math.max(this.chatLast, this.chatMessages.at(-1).id);
    return true;
  }

  removeChat(id) {
    this.chatMessages = this.chatMessages.filter((m) => m.id !== id);
    this.#renderChat();
  }

  async #fetchChat(scroll = false) {
    try {
      const { messages } = await api('GET', `/api/chat?after=${this.chatLast}`);
      if (this.#addChat(messages) || scroll) this.#renderChat(scroll);
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
          : `<div class="msg${m.name === this.game.username ? ' mine' : ''}"><b data-profile="${escapeHtml(m.name)}">${escapeHtml(m.name)}</b>${m.title ? `<em class="msg-title">${escapeHtml(m.title)}</em>` : ''} <span>${escapeHtml(m.text)}</span>${
              m.report ? `<button class="link small" data-shared="${m.id}">Ver informe ▶</button>` : ''
            }<time>${time}</time>${
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
