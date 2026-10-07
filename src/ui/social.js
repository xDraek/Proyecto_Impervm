import { RESOURCES, RESOURCE_KEYS } from '../game/data.js';
import { api } from '../net/api.js';
import { bag, escapeHtml, fmtAgo, fmtDec, fmtNum } from './format.js';

// Alianza, correo y mercado del archipiélago: lo que se habla con otros
// jugadores. Los datos llegan del servidor aparte del estado de la partida.

const head = (icon, title, sub) => `
  <div class="panel-head"><span class="panel-icon">${icon}</span><div><h3>${title}</h3><div class="panel-lvl">${sub}</div></div>
  <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>`;

const resOptions = (sel) => RESOURCE_KEYS.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${RESOURCES[r].icon} ${RESOURCES[r].name}</option>`).join('');

export class Social {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.alliance = null;
    this.alliances = [];
    this.mail = [];
    this.mailTab = 'in';
    this.openMail = null;
    this.draft = null;
    this.offers = [];
    this.offersAt = 0;
  }

  /** Lanza una petición y avisa del error si lo hay. Devuelve los datos o null. */
  async #call(method, path, body, okText) {
    try {
      const data = await api(method, path, body);
      if (data.snapshot) this.game.applySnapshot(data.snapshot);
      if (okText) this.hud.toast(okText, 'success');
      return data;
    } catch (err) {
      this.hud.toast(err.message, 'error');
      return null;
    }
  }

  // ── Alianza ─────────────────────────────────────────────────────────────────

  async openAlliance() {
    this.hud.showModal('alliance', '<div class="modal-card"><p class="muted">Cargando…</p></div>');
    const [mine, list] = await Promise.all([this.#call('GET', '/api/alliance'), this.#call('GET', '/api/alliances')]);
    this.alliance = mine?.alliance ?? null;
    this.alliances = list?.alliances ?? [];
    this.renderAlliance();
  }

  renderAlliance() {
    if (this.hud.modalKind !== 'alliance') return;
    this.hud.showModal('alliance', this.alliance ? this.#allianceHtml(this.alliance) : this.#noAllianceHtml());
  }

  #allianceHtml(a) {
    const rows = a.members
      .map(
        (m) => `<tr>
          <td><span class="dot ${m.online ? 'on' : ''}"></span>${escapeHtml(m.name)}${m.founder ? ' 👑' : ''}<div class="muted small">${escapeHtml(m.city ?? '')}</div></td>
          <td>${fmtNum(m.points)}</td>
          <td class="row-actions">
            ${m.island ? `<button class="ghost small" data-action="goto" data-island="${m.island}" title="Ver en el mapa">🗺️</button>` : ''}
            ${m.name !== this.game.username ? `<button class="ghost small" data-action="mail-to" data-name="${escapeHtml(m.name)}" title="Mensaje">✉️</button>` : ''}
            ${a.isFounder && !m.founder ? `<button class="ghost small" data-action="kick" data-user="${m.id}" title="Expulsar">✕</button>` : ''}
          </td>
        </tr>`,
      )
      .join('');
    const description = a.isFounder
      ? `<form class="stack" data-form="description"><textarea name="text" maxlength="500" rows="3" placeholder="Mensaje para los miembros…">${escapeHtml(a.description ?? '')}</textarea>
          <button class="ghost small">Guardar descripción</button></form>`
      : a.description
        ? `<p class="desc">${escapeHtml(a.description)}</p>`
        : '';
    return `<div class="modal-card">
      ${head('🤝', `${escapeHtml(a.name)} <span class="tag">[${escapeHtml(a.tag)}]</span>`, `${a.members.length} miembros · ${fmtNum(a.points)} puntos`)}
      ${description}
      <table class="ranking"><thead><tr><th>Miembro</th><th>Puntos</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">Los miembros de una alianza no pueden atacarse entre sí. Usa el transporte para ayudarles con recursos.</p>
      <div class="modal-actions">
        <button class="primary small auto" data-action="alliance-chat">💬 Chat de la alianza</button>
        <button class="ghost small" data-action="leave">Dejar la alianza</button>
      </div>
    </div>`;
  }

  #noAllianceHtml() {
    const rows = this.alliances
      .map(
        (a) => `<tr><td>${a.rank}</td><td>${escapeHtml(a.name)} <span class="tag">[${escapeHtml(a.tag)}]</span></td><td>${a.members}</td><td>${fmtNum(a.points)}</td>
          <td><button class="ghost small" data-action="join" data-id="${a.id}">Unirse</button></td></tr>`,
      )
      .join('');
    return `<div class="modal-card">
      ${head('🤝', 'Alianzas', 'Juntos sois más fuertes: no os atacáis y tenéis chat propio')}
      <h4>Fundar una alianza</h4>
      <form class="inline-form" data-form="create">
        <input name="name" maxlength="30" placeholder="Nombre de la alianza" required />
        <input name="tag" maxlength="5" placeholder="Etiqueta" required class="short" />
        <button class="primary small auto">Fundar</button>
      </form>
      <h4>Unirse a una</h4>
      ${rows ? `<table class="ranking"><thead><tr><th>#</th><th>Alianza</th><th>Miembros</th><th>Puntos</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Todavía no hay ninguna. ¡Funda la primera!</p>'}
    </div>`;
  }

  // ── Correo ──────────────────────────────────────────────────────────────────

  async openMailbox(tab = this.mailTab) {
    this.mailTab = tab;
    this.openMail = null;
    this.hud.showModal('mail', '<div class="modal-card"><p class="muted">Cargando…</p></div>');
    const data = await this.#call('GET', '/api/mail');
    this.mail = data?.mail ?? [];
    this.renderMail();
  }

  compose(to = '', subject = '') {
    this.mailTab = 'write';
    this.draft = { to, subject };
    this.openMail = null;
    this.hud.showModal('mail', '');
    this.renderMail();
  }

  renderMail() {
    if (this.hud.modalKind !== 'mail') return;
    const unread = this.mail.filter((m) => m.box === 'in' && !m.read).length;
    const tabs = `<div class="tabs small-tabs">
      <button data-action="mail-tab" data-tab="in" class="${this.mailTab === 'in' ? 'active' : ''}">Recibidos${unread ? ` (${unread})` : ''}</button>
      <button data-action="mail-tab" data-tab="out" class="${this.mailTab === 'out' ? 'active' : ''}">Enviados</button>
      <button data-action="mail-tab" data-tab="write" class="${this.mailTab === 'write' ? 'active' : ''}">✏️ Escribir</button>
    </div>`;
    let body;
    if (this.mailTab === 'write') {
      const d = this.draft ?? {};
      body = `<form class="stack" data-form="mail">
        <input name="to" maxlength="20" placeholder="Para (nombre del jugador)" value="${escapeHtml(d.to ?? '')}" required />
        <input name="subject" maxlength="80" placeholder="Asunto" value="${escapeHtml(d.subject ?? '')}" />
        <textarea name="text" maxlength="2000" rows="7" placeholder="Escribe tu mensaje…" required></textarea>
        <button class="primary">Enviar</button>
      </form>`;
    } else if (this.openMail) {
      const m = this.openMail;
      body = `<article class="letter">
        <div class="muted small">${m.box === 'in' ? `De <b>${escapeHtml(m.from)}</b>` : `Para <b>${escapeHtml(m.to)}</b>`} · ${fmtAgo(m.t)}</div>
        <h4>${escapeHtml(m.subject)}</h4>
        <p>${escapeHtml(m.text).replace(/\n/g, '<br />')}</p>
        <div class="modal-actions">
          ${m.box === 'in' ? `<button class="primary small auto" data-action="reply" data-id="${m.id}">Responder</button>` : ''}
          <button class="ghost small" data-action="mail-back">Volver</button>
          <button class="ghost small" data-action="mail-delete" data-id="${m.id}">Borrar</button>
        </div>
      </article>`;
    } else {
      const list = this.mail.filter((m) => m.box === this.mailTab);
      body = list.length
        ? `<ul class="mail-list">${list
            .map(
              (m) => `<li data-action="mail-open" data-id="${m.id}" class="${m.read ? '' : 'unread'}">
                <span class="who">${escapeHtml(m.box === 'in' ? m.from : m.to)}</span>
                <span class="subject">${escapeHtml(m.subject)}</span>
                <span class="muted small">${fmtAgo(m.t)}</span></li>`,
            )
            .join('')}</ul>`
        : '<p class="muted">No hay mensajes.</p>';
    }
    this.hud.showModal('mail', `<div class="modal-card">${head('✉️', 'Correo', 'Mensajes privados entre jugadores')}${tabs}${body}</div>`);
  }

  // ── Mercado del archipiélago ───────────────────────────────────────────────

  /** Pide las ofertas si hace rato que no se miran (mientras el mercado está abierto). */
  async refreshOffers(force = false) {
    if (!force && Date.now() - this.offersAt < 15_000) return;
    this.offersAt = Date.now();
    const data = await this.#call('GET', '/api/market');
    if (data) {
      this.offers = data.offers;
      this.hud.render();
    }
  }

  marketHtml() {
    const rows = this.offers
      .map((o) => {
        const [gr, gn] = Object.entries(o.give)[0];
        const [wr, wn] = Object.entries(o.want)[0];
        const ratio = (wn * RESOURCES[wr].value) / (gn * RESOURCES[gr].value);
        const deal = ratio < 0.85 ? 'good' : ratio > 1.2 ? 'bad' : '';
        return `<li class="offer ${deal}">
          <div><b>${escapeHtml(o.sellerName)}</b> da ${bag(o.give)} por ${bag(o.want)}
            <div class="muted small">${fmtAgo(o.t)} · ${deal === 'good' ? 'buen trato' : deal === 'bad' ? 'caro' : 'precio justo'} (×${fmtDec(ratio)})</div></div>
          ${o.mine
            ? `<button class="ghost small" data-action="offer-cancel" data-id="${o.id}">Retirar</button>`
            : `<button class="primary small auto" data-action="offer-accept" data-id="${o.id}" data-need='${JSON.stringify(o.want)}' data-blocked="0">Aceptar</button>`}
        </li>`;
      })
      .join('');
    return `<h4>Mercado del archipiélago</h4>
      <p class="desc small">Ofertas de otros jugadores. Lo que ofreces queda apartado hasta que alguien acepta (o caduca a los 3 días).</p>
      <div class="offer-form">
        <label>Doy <select name="o-give">${resOptions('madera')}</select><input type="number" name="o-give-n" min="1" value="500" inputmode="numeric" /></label>
        <label>Pido <select name="o-want">${resOptions('cristal')}</select><input type="number" name="o-want-n" min="1" value="200" inputmode="numeric" /></label>
        <button class="primary small" data-action="offer-post">Publicar oferta</button>
      </div>
      ${rows ? `<ul class="offers">${rows}</ul>` : '<p class="muted small">No hay ofertas ahora mismo.</p>'}`;
  }

  // ── Acciones de los botones ────────────────────────────────────────────────

  /** Clic dentro de una ventana de alianza o correo. Devuelve true si lo ha gestionado. */
  async onModalClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return false;
    const { action } = btn.dataset;
    switch (action) {
      case 'join': {
        const data = await this.#call('POST', '/api/alliance/join', { id: btn.dataset.id }, '🤝 Te has unido a la alianza');
        if (data) {
          this.alliance = data.alliance;
          this.renderAlliance();
        }
        return true;
      }
      case 'leave': {
        if (!confirm('¿Seguro que quieres dejar la alianza?')) return true;
        const data = await this.#call('POST', '/api/alliance/leave', {}, 'Has dejado la alianza');
        if (data) await this.openAlliance();
        return true;
      }
      case 'kick': {
        if (!confirm('¿Expulsar a este miembro?')) return true;
        const data = await this.#call('POST', '/api/alliance/kick', { userId: Number(btn.dataset.user) });
        if (data) {
          this.alliance = data.alliance;
          this.renderAlliance();
        }
        return true;
      }
      case 'alliance-chat':
        this.hud.closeModal();
        this.hud.toggleChat(true, 'alianza');
        return true;
      case 'goto':
        this.hud.closeModal();
        this.hud.onSelect(btn.dataset.island);
        return true;
      case 'mail-to':
        this.compose(btn.dataset.name);
        return true;
      case 'mail-tab':
        this.mailTab = btn.dataset.tab;
        this.openMail = null;
        if (this.mailTab === 'write') this.draft = this.draft ?? {};
        this.renderMail();
        return true;
      case 'mail-open': {
        const m = this.mail.find((x) => x.id === Number(btn.dataset.id));
        this.openMail = m;
        this.renderMail();
        if (m && !m.read) {
          m.read = true;
          api('POST', '/api/mail/read', { id: m.id }).then(() => this.game.sync()).catch(() => {});
        }
        return true;
      }
      case 'mail-back':
        this.openMail = null;
        this.renderMail();
        return true;
      case 'reply': {
        const m = this.mail.find((x) => x.id === Number(btn.dataset.id));
        this.compose(m.from, m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`);
        return true;
      }
      case 'mail-delete': {
        const data = await this.#call('POST', '/api/mail/delete', { id: Number(btn.dataset.id) });
        if (data) {
          this.mail = data.mail;
          this.openMail = null;
          this.renderMail();
        }
        return true;
      }
    }
    return false;
  }

  async onModalSubmit(e) {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button');
    if (submit) submit.disabled = true;
    try {
      if (form.dataset.form === 'create') {
        const res = await this.#call('POST', '/api/alliance', { name: data.name, tag: data.tag }, '🤝 ¡Alianza fundada!');
        if (res) {
          this.alliance = res.alliance;
          this.renderAlliance();
        }
      } else if (form.dataset.form === 'description') {
        const res = await this.#call('POST', '/api/alliance/description', { text: data.text }, 'Descripción guardada');
        if (res) this.alliance = res.alliance;
      } else if (form.dataset.form === 'mail') {
        const res = await this.#call('POST', '/api/mail', { to: data.to, subject: data.subject, text: data.text }, '✉️ Mensaje enviado');
        if (res) {
          this.mail = res.mail;
          this.draft = null;
          this.mailTab = 'out';
          this.renderMail();
        }
      }
    } finally {
      if (submit?.isConnected) submit.disabled = false;
    }
  }

  /** Botones del mercado dentro del panel del edificio. */
  async onPanelAction(action, btn, root) {
    if (action === 'offer-post') {
      const give = { [root.querySelector('[name="o-give"]').value]: Number(root.querySelector('[name="o-give-n"]').value) };
      const want = { [root.querySelector('[name="o-want"]').value]: Number(root.querySelector('[name="o-want-n"]').value) };
      const data = await this.#call('POST', '/api/market', { give, want }, '⚖️ Oferta publicada');
      if (data) this.offers = data.offers;
    } else if (action === 'offer-accept' || action === 'offer-cancel') {
      btn.disabled = true;
      const path = action === 'offer-accept' ? '/api/market/accept' : '/api/market/cancel';
      const data = await this.#call('POST', path, { id: Number(btn.dataset.id) }, action === 'offer-accept' ? '⚖️ ¡Trato hecho!' : 'Oferta retirada');
      if (data) this.offers = data.offers;
      else this.refreshOffers(true);
    }
    this.hud.render();
  }
}
