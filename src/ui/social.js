import { universe } from '../config.js';
import { ACHIEVEMENTS, BANNER_COLORS, BANNER_EMBLEMS, DAILY_REWARDS, RESOURCES, RESOURCE_KEYS, VACATION } from '../game/data.js';
import { api } from '../net/api.js';
import { bag, escapeHtml, fmtAgo, fmtDec, fmtNum, fmtTime } from './format.js';
import { runSimulation, simulatorHtml } from './simulator.js';

/** Ventanas que gestiona este módulo. */
export const SOCIAL_MODALS = ['alliance', 'mail', 'profile', 'daily', 'welcome', 'password', 'sim', 'friends'];

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
    this.allianceTab = 'members';
    this.forum = null;
    this.thread = null;
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
          <td><span class="dot ${m.online ? 'on' : ''}"></span><button class="link" data-action="profile" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</button>${m.role === 'lider' ? ' <span title="Líder">👑</span>' : m.role === 'oficial' ? ' <span title="Oficial">⭐</span>' : ''}<div class="muted small">${escapeHtml(m.city ?? '')}</div></td>
          <td>${fmtNum(m.points)}</td>
          <td class="row-actions">
            ${m.island ? `<button class="ghost small" data-action="goto" data-island="${m.island}" title="Ver en el mapa">🗺️</button>` : ''}
            ${m.name !== this.game.username ? `<button class="ghost small" data-action="mail-to" data-name="${escapeHtml(m.name)}" title="Mensaje">✉️</button>` : ''}
            ${a.isFounder && !m.founder ? `<button class="ghost small" data-action="officer" data-user="${m.id}" data-on="${m.role === 'oficial' ? 0 : 1}" title="${m.role === 'oficial' ? 'Quitar de oficial' : 'Nombrar oficial'}">${m.role === 'oficial' ? '☆' : '⭐'}</button><button class="ghost small" data-action="transfer" data-user="${m.id}" data-name="${escapeHtml(m.name)}" title="Cederle el liderazgo">👑</button>` : ''}
            ${a.canManage && !m.founder && m.name !== this.game.username && (a.isFounder || m.role !== 'oficial') ? `<button class="ghost small" data-action="kick" data-user="${m.id}" title="Expulsar">✕</button>` : ''}
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
      <div class="tabs small-tabs">
        <button data-action="ally-tab" data-tab="members" class="${this.allianceTab === 'members' ? 'active' : ''}">👥 Miembros</button>
        <button data-action="ally-tab" data-tab="forum" class="${this.allianceTab === 'forum' ? 'active' : ''}">🗂️ Foro${this.game.forumUnread ? ` (${this.game.forumUnread})` : ''}</button>
      </div>
      ${
        this.allianceTab === 'forum'
          ? this.#forumHtml()
          : `${description}
      <table class="ranking"><thead><tr><th>Miembro</th><th>Puntos</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">Los miembros de una alianza no pueden atacarse entre sí. Usa el transporte para ayudarles con recursos.</p>
      <div class="modal-actions">
        <button class="primary small auto" data-action="alliance-chat">💬 Chat de la alianza</button>
        ${a.members.length > 1 ? '<button class="ghost small" data-action="circular">📜 Circular</button>' : ''}
        <button class="ghost small" data-action="leave">Dejar la alianza</button>
      </div>
      ${this.#applicationsHtml(a)}
      ${a.isFounder ? `<label class="toggle-row"><input type="checkbox" data-action="alliance-open" ${a.open ? 'checked' : ''} /> Alianza abierta: entra quien quiera, sin solicitud</label>` : ''}
      ${this.#diplomacyHtml(a)}`
      }
    </div>`;
  }

  // ── Foro de la alianza ──────────────────────────────────────────────────────

  async #loadForum() {
    const data = await this.#call('GET', '/api/forum');
    this.forum = data ?? { threads: [] };
  }

  async #openThread(id) {
    const data = await this.#call('GET', `/api/forum/thread?id=${id}`);
    if (data) this.thread = data.thread;
    else await this.#loadForum();
    this.renderAlliance();
  }

  #forumHtml() {
    if (!this.forum) return '<p class="muted">Cargando el foro…</p>';
    const text = (s) => escapeHtml(s).replace(/\n/g, '<br />');
    if (this.thread) {
      const th = this.thread;
      const posts = th.posts
        .map((p) => `<article class="post"><div class="post-head"><button class="link" data-action="profile" data-name="${escapeHtml(p.author)}">${escapeHtml(p.author)}</button><span class="muted small">${fmtAgo(p.t)}</span></div><p>${text(p.text)}</p></article>`)
        .join('');
      return `<div class="thread-head">
          <button class="ghost small" data-action="forum-back">← Temas</button>
          <h4>${th.pinned ? '📌 ' : ''}${escapeHtml(th.title)}</h4>
          <div class="row-actions">
            ${th.canModerate ? `<button class="ghost small" data-action="forum-pin" data-id="${th.id}">${th.pinned ? 'Desfijar' : '📌 Fijar'}</button>` : ''}
            ${th.canModerate || th.mine ? `<button class="ghost small" data-action="forum-delete" data-id="${th.id}" title="Borrar el tema">🗑️</button>` : ''}
          </div>
        </div>
        <div class="posts">${posts}</div>
        <form class="stack" data-form="forum-reply" data-id="${th.id}">
          <textarea name="text" rows="3" maxlength="3000" placeholder="Escribe tu respuesta…" required></textarea>
          <button class="primary small auto">Responder</button>
        </form>`;
    }
    const rows = this.forum.threads
      .map(
        (th) => `<li data-action="forum-open" data-id="${th.id}" class="${th.unread ? 'unread' : ''}">
          <span class="who">${th.pinned ? '📌 ' : ''}${escapeHtml(th.title)}</span>
          <span class="muted small">${th.count} ${th.count === 1 ? 'mensaje' : 'mensajes'} · ${escapeHtml(th.lastBy)}, ${fmtAgo(th.last)}</span></li>`,
      )
      .join('');
    return `<details class="new-thread" ${this.forum.threads.length ? '' : 'open'}>
        <summary>✏️ Abrir un tema nuevo</summary>
        <form class="stack" data-form="forum-new">
          <input name="title" maxlength="80" minlength="3" placeholder="Título" required />
          <textarea name="text" rows="4" maxlength="3000" placeholder="¿Qué quieres contar a la alianza?" required></textarea>
          <button class="primary small auto">Publicar</button>
        </form>
      </details>
      ${rows ? `<ul class="mail-list forum-list">${rows}</ul>` : '<p class="muted">Todavía no hay ningún tema. Abre el primero: planes de ataque, quién necesita recursos, reglas de la alianza…</p>'}`;
  }

  #applicationsHtml(a) {
    if (!a.canManage) return '';
    const rows = a.applications
      .map(
        (x) => `<div class="diplo-row"><div><button class="link" data-action="profile" data-name="${escapeHtml(x.name)}">${escapeHtml(x.name)}</button> <span class="muted small">· ${fmtNum(x.points)} pts · ${fmtAgo(x.t)}</span>${x.text ? `<div class="small">“${escapeHtml(x.text)}”</div>` : ''}</div>
          <div class="row-actions"><button class="primary small" data-action="answer" data-user="${x.id}" data-accept="1">✔ Aceptar</button><button class="ghost small" data-action="answer" data-user="${x.id}" data-accept="0">✕</button></div></div>`,
      )
      .join('');
    return `<h4>📨 Solicitudes de ingreso ${a.applications.length ? `(${a.applications.length})` : ''}</h4>${rows || '<p class="muted small">Nadie ha pedido entrar.</p>'}`;
  }

  #diplomacyHtml(a) {
    const since = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const btn = (op, id, text, cls = 'ghost') => (a.isFounder ? `<button class="${cls} small" data-action="diplo" data-op="${op}" data-id="${id}">${text}</button>` : '');
    const rows = a.diplomacy
      .map((d) => {
        const name = `${escapeHtml(d.name)} <span class="tag">[${escapeHtml(d.tag)}]</span>`;
        let status;
        let actions = '';
        if (d.type === 'guerra') {
          const w = d.war;
          status = `<span class="rel war">⚔️ En guerra</span> desde el ${since(d.since)}${w.declaredByUs ? ' (la declarasteis vosotros)' : ''}
            <div class="war-score"><span>🗡️ Abatidos <b>${fmtNum(w.kills)}</b></span><span>💀 Perdidos <b>${fmtNum(w.losses)}</b></span><span>💰 Saqueado <b>${fmtNum(w.loot)}</b></span><span>🏚️ Os han robado <b>${fmtNum(w.lootLost)}</b></span></div>`;
          if (d.proposal?.mine) actions = `<span class="muted small">Habéis ofrecido la paz</span>${btn('rechazar', d.id, 'Retirar')}`;
          else if (d.proposal) actions = `<span class="muted small">Os ofrecen la paz</span>${btn('aceptar', d.id, '🕊️ Firmar la paz', 'primary')}${btn('rechazar', d.id, 'Rechazar')}`;
          else actions = btn('paz', d.id, '🕊️ Ofrecer la paz');
        } else if (d.type === 'pacto') {
          status = `<span class="rel pact">🕊️ Pacto de no agresión</span> desde el ${since(d.since)}`;
          actions = `${btn('romper', d.id, 'Romper el pacto')}${btn('guerra', d.id, '⚔️ Declarar la guerra')}`;
        } else {
          status = d.proposal?.mine ? '📜 Les habéis propuesto un pacto' : '📜 Os proponen un pacto de no agresión';
          actions = d.proposal?.mine ? btn('rechazar', d.id, 'Retirar') : `${btn('aceptar', d.id, '🕊️ Aceptar', 'primary')}${btn('rechazar', d.id, 'Rechazar')}`;
        }
        return `<div class="diplo-row"><div><b>${name}</b><div class="small">${status}</div></div><div class="row-actions">${actions}</div></div>`;
      })
      .join('');
    const busy = new Set(a.diplomacy.map((d) => d.id));
    const others = this.alliances.filter((x) => x.id !== a.id && !busy.has(x.id));
    const form =
      a.isFounder && others.length
        ? `<form class="inline-form" data-form="diplo">
            <select name="id">${others.map((x) => `<option value="${x.id}">${escapeHtml(x.name)} [${escapeHtml(x.tag)}] · ${fmtNum(x.points)} pts</option>`).join('')}</select>
            <button class="ghost small" name="op" value="pacto">🕊️ Proponer pacto</button>
            <button class="ghost small danger" name="op" value="guerra">⚔️ Declarar la guerra</button>
          </form>`
        : '';
    if (!rows && !form) return '';
    return `<h4>Diplomacia</h4>
      ${rows || '<p class="muted small">Sin pactos ni guerras.</p>'}
      ${form}
      <p class="muted small">Con un pacto de no agresión no podéis atacaros. En guerra, vuestros barcos cargan un 20 % más de botín cuando saqueáis al enemigo, y se lleva la cuenta de cada batalla. ${a.isFounder ? '' : 'La diplomacia la lleva quien lidera la alianza.'}</p>`;
  }

  #noAllianceHtml() {
    const rows = this.alliances
      .map(
        (a) => `<tr><td>${a.rank}</td><td>${escapeHtml(a.name)} <span class="tag">[${escapeHtml(a.tag)}]</span><div class="muted small">${a.open ? 'Abierta' : 'Con solicitud'}</div></td><td>${a.members}</td><td>${fmtNum(a.points)}</td>
          <td>${
            a.applied
              ? `<button class="ghost small" data-action="cancel-apply" data-id="${a.id}" title="Retirar la solicitud">⏳ Pedido ✕</button>`
              : `<button class="ghost small" data-action="join" data-id="${a.id}" data-open="${a.open ? 1 : 0}">${a.open ? 'Unirse' : 'Pedir entrar'}</button>`
          }</td></tr>`,
      )
      .join('');
    return `<div class="modal-card">
      ${head('🤝', 'Alianzas', 'Juntos sois más fuertes: no os atacáis y tenéis chat propio')}
      <p class="muted small">En las alianzas con solicitud, el líder o un oficial tiene que aceptarte. Puedes pedir entrar en varias a la vez.</p>
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

  compose(to = '', subject = '', circular = false) {
    this.mailTab = 'write';
    this.draft = { to, subject, circular };
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
        ${d.circular
          ? `<input value="📜 Para toda la alianza${this.game.alliance ? ` [${escapeHtml(this.game.alliance.tag)}]` : ''}" disabled />`
          : `<input name="to" maxlength="20" placeholder="Para (nombre del jugador)" value="${escapeHtml(d.to ?? '')}" required />`}
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

  // ── Perfil ──────────────────────────────────────────────────────────────────

  async openProfile(name) {
    this.hud.showModal('profile', '<div class="modal-card narrow"><p class="muted">Cargando…</p></div>');
    const data = await this.#call('GET', `/api/profile?name=${encodeURIComponent(name)}`);
    if (!data || this.hud.modalKind !== 'profile') return;
    const p = data.profile;
    const earned = new Set(p.achievements);
    const meView = p.name === this.game.username;
    const medals = ACHIEVEMENTS.map(
      (a) =>
        `<li class="${earned.has(a.id) ? 'got' : ''} ${p.titleId === a.id ? 'titled' : ''}" title="${a.name}: ${a.text}"><span>${a.icon}</span><b>${a.name}</b><small>${a.text}</small>${
          meView && earned.has(a.id) ? `<button class="link small" data-action="set-title" data-id="${p.titleId === a.id ? '' : a.id}">${p.titleId === a.id ? 'Quitar título' : 'Usar de título'}</button>` : ''
        }</li>`,
    ).join('');
    const me = p.name === this.game.username;
    this.hud.showModal(
      'profile',
      `<div class="modal-card">
        ${head(p.banner?.emblem ?? '👤', `${escapeHtml(p.name)}${p.alliance ? ` <span class="tag">[${escapeHtml(p.alliance.tag)}]</span>` : ''}`, `${p.title ? `«${escapeHtml(p.title)}» · ` : ''}${p.online ? '🟢 En línea' : 'Desconectado'} · en el archipiélago desde ${new Date(p.joined).toLocaleDateString('es-ES')}`)}
        <div class="stat-grid">
          <div><b>${p.rank ?? '—'}</b><span>puesto</span></div>
          <div><b>${fmtNum(p.points)}</b><span>puntos</span></div>
          <div><b>${p.townLevel}</b><span>ayuntamiento</span></div>
          <div><b>${fmtNum(p.victories)}</b><span>victorias</span></div>
          <div><b>${fmtNum(p.kills ?? 0)}</b><span>bajas enemigas</span></div>
          <div><b>${fmtNum(p.loot ?? 0)}</b><span>botín</span></div>
        </div>
        <div class="info-row"><span>🏰 Ciudad</span><b>${escapeHtml(p.city ?? '')}</b></div>
        <div class="info-row"><span>🤝 Alianza</span><b>${p.alliance ? escapeHtml(p.alliance.name) : 'Ninguna'}</b></div>
        ${p.colonies.length ? `<div class="info-row"><span>🚩 Colonias</span><span>${p.colonies.map(escapeHtml).join(', ')}</span></div>` : ''}
        ${p.coloso ? `<div class="info-row"><span>🗽 Coloso</span><b>Nivel ${p.coloso}</b></div>` : ''}
        ${historyChart(p.history)}
        ${me ? this.#bannerHtml(p) : ''}
        <h4>Logros (${earned.size}/${ACHIEVEMENTS.length})</h4>
        <ul class="medals">${medals}</ul>
        ${p.hero ? `<div class="info-row"><span>🎖️ Almirante</span><b>${escapeHtml(p.hero.name)} · nivel ${p.hero.level}</b></div>` : ''}
        <div class="modal-actions">
          ${me ? '' : `<button class="primary small auto" data-action="mail-to" data-name="${escapeHtml(p.name)}">✉️ Mandar un mensaje</button>`}
          ${me ? '' : `<button class="ghost small" data-action="goto" data-island="${p.island}">🗺️ Ver su ciudad</button>`}
          ${me ? '' : `<button class="ghost small" data-action="friend-add" data-name="${escapeHtml(p.name)}">👥 Añadir amigo</button>`}
        </div>
        ${this.game.admin && !me
          ? `<div class="admin-tools"><b>🛠️ Moderación</b>${p.muted ? ' · silenciado' : ''}${p.banned ? ' · suspendido' : ''}
              <div class="modal-actions">
                <button class="ghost small" data-action="mod" data-op="mute" data-minutes="60" data-name="${escapeHtml(p.name)}">🔇 1 h</button>
                <button class="ghost small" data-action="mod" data-op="mute" data-minutes="1440" data-name="${escapeHtml(p.name)}">🔇 24 h</button>
                <button class="ghost small" data-action="mod" data-op="mute" data-minutes="0" data-name="${escapeHtml(p.name)}">🔈 Quitar silencio</button>
                <button class="ghost small" data-action="mod" data-op="${p.banned ? 'unban' : 'ban'}" data-name="${escapeHtml(p.name)}">${p.banned ? '✅ Readmitir' : '⛔ Suspender'}</button>
                <button class="ghost small" data-action="mod" data-op="reset" data-name="${escapeHtml(p.name)}">🔑 Contraseña temporal</button>
              </div></div>`
          : ''}
      </div>`,
    );
    bindCharts(this.hud.modal);
  }

  /** Tu estandarte (color y emblema) y el nombre de tu ciudad. */
  #bannerHtml(p) {
    const cur = p.banner ?? { color: BANNER_COLORS[0], emblem: '⚜' };
    const colors = BANNER_COLORS.map(
      (c) => `<button class="swatch ${c === cur.color ? 'on' : ''}" style="--c:${c}" data-action="banner" data-color="${c}" data-emblem="${escapeHtml(cur.emblem)}" title="Color"></button>`,
    ).join('');
    const emblems = BANNER_EMBLEMS.map(
      (e) => `<button class="emblem ${e === cur.emblem ? 'on' : ''}" data-action="banner" data-color="${cur.color}" data-emblem="${e}">${e}</button>`,
    ).join('');
    return `<div class="section banner-edit">
      <h4>🎨 Tu estandarte</h4>
      <p class="desc small">Ondea en tus banderas, en tus colonias y en tu ciudad tal como la ven los demás.</p>
      <div class="swatches">${colors}</div>
      <div class="emblems">${emblems}</div>
      <form class="inline-form" data-form="rename-city">
        <input name="name" maxlength="20" placeholder="Nuevo nombre de tu ciudad" value="${escapeHtml(p.city ?? '')}" />
        <button class="ghost small">Renombrar</button>
      </form>
      <p class="muted small">Puedes cambiar el nombre de la ciudad una vez por semana.</p>
    </div>`;
  }

  // ── Recompensa diaria y bienvenida ─────────────────────────────────────────

  openDaily() {
    const d = this.game.dailyStatus();
    const days = DAILY_REWARDS.map((r, i) => {
      const n = i + 1;
      const cls = n < d.day || (!d.available && n === d.day) ? 'done' : n === d.day ? 'today' : '';
      return `<li class="${cls}"><b>Día ${n}</b>${bag(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'favor')))}${r.favor ? `<span class="bag-item">🙏 ${r.favor}</span>` : ''}</li>`;
    }).join('');
    this.hud.showModal(
      'daily',
      `<div class="modal-card">
        ${head('🎁', 'Regalo diario', d.available ? `Racha de ${d.streak} ${d.streak === 1 ? 'día' : 'días'}. ¡Vuelve mañana para seguirla!` : 'Ya lo has recogido hoy. Vuelve mañana.')}
        <ol class="daily">${days}</ol>
        <p class="muted small">Las cantidades crecen con el nivel de tu ayuntamiento. Si te saltas un día, la racha vuelve a empezar.</p>
        ${d.available ? `<button class="primary" data-action="claim-daily">Recoger ${bag(Object.fromEntries(Object.entries(d.reward).filter(([k]) => k !== 'favor')))}${d.reward.favor ? ` · 🙏 ${d.reward.favor}` : ''}</button>` : ''}
      </div>`,
    );
  }

  openWelcome() {
    this.hud.showModal(
      'welcome',
      `<div class="modal-card">
        ${head('⚜', `Bienvenido a Imperium, ${escapeHtml(this.game.username)}`, `Tu ciudad: ${escapeHtml(this.game.homeIsland?.name ?? '')}`)}
        <ol class="welcome">
          <li><span>🏛️</span><div><b>Haz crecer tu isla.</b> Pulsa un edificio para mejorarlo. Los recursos se producen solos, también con el juego cerrado.</div></li>
          <li><span>📋</span><div><b>Sigue las misiones.</b> Te guían paso a paso y te dan recompensas.</div></li>
          <li><span>🗺️</span><div><b>Explora el mapa</b> (tecla M). Con un puerto y botes descubrirás bárbaros, ruinas, tierras libres… y a tus vecinos.</div></li>
          <li><span>🛡️</span><div><b>Tienes protección de novato</b> hasta los 100 puntos: nadie te atacará. Aprovecha para prepararte, que después llegan piratas y vecinos con hambre.</div></li>
          <li><span>🤝</span><div><b>Únete a una alianza</b> o funda la tuya: os defenderéis, comerciaréis y tendréis chat propio.</div></li>
        </ol>
        <button class="primary" data-action="welcome-done">¡A jugar!</button>
      </div>`,
    );
  }

  // ── Modo vacaciones ─────────────────────────────────────────────────────────

  openVacation() {
    const now = this.game.now();
    const st = this.game.vacationStatus(now);
    const span = (h) => fmtTime((h * 3600) / universe.speed);
    let body;
    if (st.active) {
      body = `<p>Estás de vacaciones desde el ${new Date(st.since).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>
        ${st.canEnd ? '<p class="hint ok">Ya puedes volver cuando quieras.</p>' : `<p class="hint">Podrás volver dentro de ${fmtTime((st.until - now) / 1000)}.</p>`}
        <div class="modal-actions"><button class="primary auto" data-action="vacation-end" ${st.canEnd ? '' : 'disabled'}>⚓ Volver al juego</button></div>`;
    } else {
      const wait = st.readyAt > now ? ` Podrás irte dentro de ${fmtTime((st.readyAt - now) / 1000)}.` : '';
      body = `<p class="desc">¿Te vas unos días? Deja tu isla a buen recaudo.</p>
        <ul class="vac-list">
          <li>🛡️ Nadie puede atacar ni espiar tu ciudad.</li>
          <li>⏸️ La isla no produce ni gasta: las tropas tampoco comen.</li>
          <li>🏴‍☠️ No llegan piratas ni visitantes.</li>
          <li>🔒 No puedes construir, investigar, reclutar ni zarpar (lo que ya estaba en marcha termina).</li>
          <li>⏳ Duran al menos ${span(VACATION.minHours)}; al volver tendrás que esperar ${span(VACATION.cooldownHours)} para irte otra vez.</li>
        </ul>
        ${st.reason ? `<p class="hint">${escapeHtml(st.reason)}${wait}</p>` : ''}
        <div class="modal-actions"><button class="primary auto" data-action="vacation-start" ${st.reason ? 'disabled' : ''}>🏖️ Irme de vacaciones</button></div>`;
    }
    this.hud.showModal('vacation', `<div class="modal-card narrow">${head('🏖️', 'Modo vacaciones', st.active ? 'Tu isla descansa' : 'Para cuando no puedas jugar')}${body}</div>`);
  }

  async openPassword() {
    const email = (await api('GET', '/api/email').catch(() => null))?.email;
    this.hud.showModal(
      'password',
      `<div class="modal-card narrow">
        ${head('🔑', 'Cuenta y contraseña', escapeHtml(this.game.username))}
        <h4>🔑 Contraseña</h4>
        <form class="stack" data-form="password">
          <input type="password" name="current" placeholder="Contraseña actual" autocomplete="current-password" required />
          <input type="password" name="next" placeholder="Contraseña nueva (6 o más caracteres)" autocomplete="new-password" minlength="6" required />
          <input type="password" name="next2" placeholder="Repite la nueva" autocomplete="new-password" required />
          <button class="primary">Cambiar</button>
        </form>
        <h4>✉️ Correo</h4>
        <p class="desc small">${email ? `Tu cuenta usa <b>${escapeHtml(email)}</b>. Si olvidas la contraseña, te mandamos allí un enlace para poner otra.` : 'Tu cuenta aún no tiene correo.'}</p>
        <form class="stack" data-form="email">
          <input type="email" name="email" placeholder="Correo nuevo" autocomplete="email" maxlength="120" required />
          <input type="password" name="password" placeholder="Tu contraseña actual" autocomplete="current-password" required />
          <button class="ghost">Cambiar el correo</button>
        </form>
        <p class="hint small email-sent" hidden></p>
      </div>`,
    );
  }

  // ── Amigos ─────────────────────────────────────────────────────────────────

  async openFriends(data = null) {
    data ??= await this.#call('GET', '/api/friends');
    if (!data) return;
    this.friends = data;
    const person = (f, buttons) => `<li class="friend${f.online ? ' online' : ''}">
        <span class="dot" title="${f.online ? 'Conectado ahora' : 'Desconectado'}"></span>
        <div class="friend-who" data-action="profile" data-name="${escapeHtml(f.name)}">
          <b>${f.alliance ? `[${escapeHtml(f.alliance)}] ` : ''}${escapeHtml(f.name)}</b>
          <span class="muted small">${escapeHtml(f.city)} · ${fmtNum(f.score)} pts · ${f.online ? 'conectado' : f.lastSeen ? `visto ${fmtAgo(Date.now() - f.lastSeen)}` : 'sin conectar'}</span>
        </div>
        <div class="friend-actions">${buttons}</div>
      </li>`;
    const friends = data.friends
      .map((f) =>
        person(
          f,
          `<button class="icon-btn tiny" data-action="mail-to" data-name="${escapeHtml(f.name)}" title="Mandar un mensaje">✉️</button>
           <button class="icon-btn tiny" data-action="goto" data-island="${f.island}" title="Ver su ciudad">🗺️</button>
           <button class="icon-btn tiny" data-action="friend-remove" data-name="${escapeHtml(f.name)}" title="Dejar de ser amigos">✕</button>`,
        ),
      )
      .join('');
    const incoming = data.incoming
      .map((f) =>
        person(
          f,
          `<button class="primary small" data-action="friend-answer" data-accept="1" data-name="${escapeHtml(f.name)}">Aceptar</button>
           <button class="ghost small" data-action="friend-answer" data-name="${escapeHtml(f.name)}">No</button>`,
        ),
      )
      .join('');
    const outgoing = data.outgoing.map((f) => person(f, `<button class="ghost small" data-action="friend-remove" data-name="${escapeHtml(f.name)}">Retirar</button>`)).join('');
    const online = data.friends.filter((f) => f.online).length;
    this.hud.showModal(
      'friends',
      `<div class="modal-card narrow friends-modal">
        ${head('👥', 'Amigos', data.friends.length ? `${online} de ${data.friends.length} conectados` : 'Añade a otros capitanes por su nombre')}
        <form class="friend-add" data-form="friend-add">
          <input type="text" name="name" placeholder="Nombre del jugador" maxlength="20" autocomplete="off" required />
          <button class="primary small">Añadir</button>
        </form>
        ${incoming ? `<h4>📨 Quieren ser tus amigos</h4><ul class="friends">${incoming}</ul>` : ''}
        <h4>👥 Tus amigos</h4>
        ${friends ? `<ul class="friends">${friends}</ul>` : '<p class="muted small">Todavía no tienes amigos. Escribe el nombre de un jugador para pedirle amistad, o pulsa «Añadir amigo» en su perfil.</p>'}
        ${outgoing ? `<h4>⏳ Esperando respuesta</h4><ul class="friends">${outgoing}</ul>` : ''}
      </div>`,
    );
  }

  openSimulator(preset) {
    this.hud.showModal('sim', simulatorHtml(preset));
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
        const open = btn.dataset.open === '1';
        const text = open ? '' : prompt('¿Quieres decirles algo? (opcional)') ?? null;
        if (text === null) return true;
        const data = await this.#call('POST', '/api/alliance/join', { id: btn.dataset.id, text }, open ? '🤝 Te has unido a la alianza' : '📨 Solicitud enviada: el líder o un oficial te responderá');
        if (data?.alliance) {
          this.alliance = data.alliance;
          this.renderAlliance();
        } else if (data) await this.openAlliance();
        return true;
      }
      case 'cancel-apply': {
        const data = await this.#call('POST', '/api/alliance/cancel', { id: btn.dataset.id }, 'Solicitud retirada');
        if (data) await this.openAlliance();
        return true;
      }
      case 'answer':
      case 'officer':
      case 'transfer': {
        if (action === 'transfer' && !confirm(`¿Ceder el liderazgo a ${btn.dataset.name}? Pasarás a ser oficial.`)) return true;
        const path = { answer: '/api/alliance/answer', officer: '/api/alliance/officer', transfer: '/api/alliance/transfer' }[action];
        const data = await this.#call('POST', path, { userId: Number(btn.dataset.user), accept: btn.dataset.accept === '1', on: btn.dataset.on === '1' });
        if (data) {
          this.alliance = data.alliance;
          this.renderAlliance();
        }
        return true;
      }
      case 'alliance-open': {
        const data = await this.#call('POST', '/api/alliance/open', { open: btn.checked }, btn.checked ? 'La alianza ahora es abierta' : 'Ahora hay que pedir permiso para entrar');
        if (data) this.alliance = data.alliance;
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
      case 'ally-tab':
        this.allianceTab = btn.dataset.tab;
        this.thread = null;
        if (this.allianceTab === 'forum') {
          this.forum = null;
          this.renderAlliance();
          await this.#loadForum();
        }
        this.renderAlliance();
        return true;
      case 'forum-open':
        await this.#openThread(Number(btn.dataset.id));
        return true;
      case 'forum-back':
        this.thread = null;
        await this.#loadForum();
        this.renderAlliance();
        return true;
      case 'forum-pin':
      case 'forum-delete': {
        const op = action === 'forum-pin' ? 'pin' : 'delete';
        if (op === 'delete' && !confirm('¿Borrar este tema con todas sus respuestas?')) return true;
        const data = await this.#call('POST', `/api/forum/${op}`, { id: Number(btn.dataset.id) });
        if (!data) return true;
        if (op === 'delete') {
          this.thread = null;
          this.forum = data;
        } else {
          await this.#openThread(Number(btn.dataset.id));
          return true;
        }
        this.renderAlliance();
        return true;
      }
      case 'vacation-start': {
        if (!confirm('¿Irte de vacaciones? Tu isla dejará de producir y no podrás volver hasta que pase el tiempo mínimo.')) return true;
        btn.disabled = true;
        const res = await this.game.startVacation();
        if (!res.ok) this.hud.toast(res.reason, 'error');
        this.openVacation();
        return true;
      }
      case 'vacation-end': {
        btn.disabled = true;
        const res = await this.game.endVacation();
        if (!res.ok) this.hud.toast(res.reason, 'error');
        else this.hud.closeModal();
        return true;
      }
      case 'diplo': {
        const { op, id } = btn.dataset;
        if (op === 'guerra' && !confirm('¿Declarar la guerra? Se anunciará a todo el archipiélago.')) return true;
        if (op === 'romper' && !confirm('¿Romper el pacto de no agresión?')) return true;
        const data = await this.#call('POST', '/api/alliance/diplomacy', { id: Number(id), op });
        if (data) {
          this.alliance = data.alliance;
          this.renderAlliance();
        }
        return true;
      }
      case 'circular':
        this.compose('', '', true);
        return true;
      case 'alliance-chat':
        this.hud.closeModal();
        this.hud.toggleChat(true, 'alianza');
        return true;
      case 'goto':
        // Una isla lejana que no está en tu parte del mapa: se busca en el mapa del mundo
        if (!this.game.world.island(btn.dataset.island)) {
          this.hud.worldMap.open(btn.dataset.island);
          return true;
        }
        this.hud.closeModal();
        this.hud.onSelect(btn.dataset.island);
        return true;
      case 'profile':
        this.openProfile(btn.dataset.name);
        return true;
      case 'mod': {
        const { op, name, minutes } = btn.dataset;
        let reason = '';
        if (op === 'ban') {
          reason = prompt(`¿Por qué suspendes a ${name}?`) ?? '';
          if (!reason) return true;
        }
        if (op === 'reset') {
          if (!confirm(`¿Dar a ${name} una contraseña temporal? La suya dejará de valer.`)) return true;
          const res = await this.#call('POST', '/api/admin/reset', { name });
          if (res) prompt(`Contraseña temporal de ${name} (pásasela y que la cambie al entrar):`, res.password);
          return true;
        }
        const body = op === 'mute' ? { name, minutes: Number(minutes) } : { name, reason };
        const res = await this.#call('POST', `/api/admin/${op}`, body, 'Hecho');
        if (res) this.openProfile(name);
        return true;
      }
      case 'claim-daily': {
        btn.disabled = true;
        const res = await this.game.claimDaily();
        if (!res.ok) this.hud.toast(res.reason, 'error');
        this.openDaily();
        return true;
      }
      case 'welcome-done':
        try {
          localStorage.setItem(`imperium.welcome.${this.game.userId}`, '1');
        } catch {
          // sin almacenamiento
        }
        this.hud.closeModal();
        if (this.game.dailyStatus().available) this.openDaily();
        return true;
      case 'mail-to':
        this.compose(btn.dataset.name);
        return true;
      case 'friend-add': {
        const res = await this.#call('POST', '/api/friends/add', { name: btn.dataset.name });
        if (res) this.hud.toast(res.result === 'amigos' ? `👥 Ya sois amigos` : `👥 Solicitud de amistad enviada a ${btn.dataset.name}`, 'success');
        return true;
      }
      case 'friend-answer': {
        const res = await this.#call('POST', '/api/friends/answer', { name: btn.dataset.name, accept: btn.dataset.accept === '1' });
        if (res) this.openFriends(res);
        return true;
      }
      case 'friend-remove': {
        if (!confirm(`¿Quitar a ${btn.dataset.name} de tus amigos?`)) return true;
        const res = await this.#call('POST', '/api/friends/remove', { name: btn.dataset.name });
        if (res) this.openFriends(res);
        return true;
      }
      case 'set-title': {
        const res = await this.game.setTitle(btn.dataset.id);
        if (!res.ok) this.hud.toast(res.reason, 'error');
        else this.openProfile(this.game.username);
        return true;
      }
      case 'banner': {
        const res = await this.game.setBanner(btn.dataset.color, btn.dataset.emblem);
        if (!res.ok) this.hud.toast(res.reason, 'error');
        else this.openProfile(this.game.username);
        return true;
      }
      case 'mail-tab':
        this.mailTab = btn.dataset.tab;
        this.openMail = null;
        if (this.mailTab === 'write') this.draft = this.draft?.circular ? {} : (this.draft ?? {});
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
      } else if (form.dataset.form === 'forum-new' || form.dataset.form === 'forum-reply') {
        const reply = form.dataset.form === 'forum-reply';
        const res = await this.#call('POST', reply ? '/api/forum/reply' : '/api/forum', reply ? { id: Number(form.dataset.id), text: data.text } : { title: data.title, text: data.text });
        if (res) {
          this.thread = res.thread;
          this.renderAlliance();
          this.hud.modal.querySelector('.posts')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
        }
      } else if (form.dataset.form === 'diplo') {
        const op = e.submitter?.value;
        if (op === 'guerra' && !confirm('¿Declarar la guerra? Se anunciará a todo el archipiélago.')) return;
        const res = await this.#call('POST', '/api/alliance/diplomacy', { id: Number(data.id), op });
        if (res) {
          this.alliance = res.alliance;
          this.renderAlliance();
        }
      } else if (form.dataset.form === 'description') {
        const res = await this.#call('POST', '/api/alliance/description', { text: data.text }, 'Descripción guardada');
        if (res) this.alliance = res.alliance;
      } else if (form.dataset.form === 'sim') {
        runSimulation(form);
      } else if (form.dataset.form === 'password') {
        if (data.next !== data.next2) {
          this.hud.toast('Las contraseñas nuevas no coinciden.', 'error');
          return;
        }
        const res = await this.#call('POST', '/api/password', { current: data.current, next: data.next }, '🔑 Contraseña cambiada');
        if (res) this.hud.closeModal();
      } else if (form.dataset.form === 'rename-city') {
        const res = await this.#call('POST', '/api/city', { name: data.name }, '🏰 Tu ciudad tiene nombre nuevo');
        if (res) this.openProfile(this.game.username);
      } else if (form.dataset.form === 'friend-add') {
        const res = await this.#call('POST', '/api/friends/add', { name: data.name });
        if (res) {
          this.hud.toast(res.result === 'amigos' ? '👥 Ya sois amigos' : `👥 Solicitud enviada a ${data.name}`, 'success');
          this.openFriends(res);
        }
      } else if (form.dataset.form === 'email') {
        const res = await this.#call('POST', '/api/email', { email: data.email, password: data.password }, '✉️ Te hemos mandado un correo para confirmarlo');
        const hint = this.hud.modal.querySelector('.email-sent');
        if (res && hint) {
          hint.hidden = false;
          hint.innerHTML = `Abre el enlace que te hemos mandado a <b>${escapeHtml(res.email)}</b> para confirmar el cambio. Hasta entonces sigues con el correo de antes.`;
          form.reset();
        }
      } else if (form.dataset.form === 'mail') {
        const res = this.draft?.circular
          ? await this.#call('POST', '/api/alliance/circular', { subject: data.subject, text: data.text }, '📜 Circular enviada a toda la alianza')
          : await this.#call('POST', '/api/mail', { to: data.to, subject: data.subject, text: data.text }, '✉️ Mensaje enviado');
        if (res && this.draft?.circular) {
          this.draft = null;
          await this.openMailbox('out');
          return;
        }
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

/**
 * Evolución de los puntos día a día: una sola serie, así que sin leyenda (la
 * nombra el título). Línea fina, cuadrícula discreta y lectura al pasar el ratón.
 */
function historyChart(history = []) {
  if (history.length < 2) return '<h4>📈 Evolución</h4><p class="muted small">La gráfica aparecerá cuando lleve al menos dos días en el archipiélago.</p>';
  const W = 320;
  const H = 110;
  const pad = { l: 34, r: 8, t: 10, b: 20 };
  const vals = history.map((h) => h.points);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = Math.max(1, max - min);
  const x = (i) => pad.l + (i / (history.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const pts = history.map((h, i) => `${x(i).toFixed(1)},${y(h.points).toFixed(1)}`).join(' ');
  const area = `${pad.l},${H - pad.b} ${pts} ${x(history.length - 1).toFixed(1)},${H - pad.b}`;
  const today = Math.floor(Date.now() / 86_400_000);
  const ago = (d) => (today - d === 0 ? 'hoy' : `hace ${today - d} d`);
  const data = JSON.stringify(history.map((h, i) => ({ x: x(i), y: y(h.points), label: `${ago(h.day)} · ${fmtNum(h.points)} puntos` })));
  return `<h4>📈 Puntos de los últimos ${history.length} días</h4>
    <div class="chart" data-points='${escapeHtml(data)}'>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Puntos de ${fmtNum(min)} a ${fmtNum(max)} en ${history.length} días">
        ${[0, 0.5, 1].map((k) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + k * (H - pad.t - pad.b)}" y2="${pad.t + k * (H - pad.t - pad.b)}" class="grid" />`).join('')}
        <text x="${pad.l - 4}" y="${pad.t + 4}" class="axis" text-anchor="end">${fmtNum(max)}</text>
        <text x="${pad.l - 4}" y="${H - pad.b}" class="axis" text-anchor="end">${fmtNum(min)}</text>
        <text x="${pad.l}" y="${H - 4}" class="axis">${ago(history[0].day)}</text>
        <text x="${W - pad.r}" y="${H - 4}" class="axis" text-anchor="end">hoy</text>
        <polygon points="${area}" class="area" />
        <polyline points="${pts}" class="line" />
        <line class="cross" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden" />
        <circle class="dot" r="4" visibility="hidden" />
        <rect class="hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" />
      </svg>
      <div class="chart-tip" hidden></div>
    </div>`;
}

/** Lectura de la gráfica al pasar el ratón (o el dedo): línea vertical, punto y valor. */
export function bindCharts(root) {
  for (const chart of root.querySelectorAll('.chart[data-points]')) {
    const points = JSON.parse(chart.dataset.points);
    const svg = chart.querySelector('svg');
    const cross = svg.querySelector('.cross');
    const dot = svg.querySelector('.dot');
    const tip = chart.querySelector('.chart-tip');
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
      const p = points.reduce((best, q) => (Math.abs(q.x - vx) < Math.abs(best.x - vx) ? q : best));
      for (const el of [cross, dot]) el.setAttribute('visibility', 'visible');
      cross.setAttribute('x1', p.x);
      cross.setAttribute('x2', p.x);
      dot.setAttribute('cx', p.x);
      dot.setAttribute('cy', p.y);
      tip.hidden = false;
      tip.textContent = p.label;
      tip.style.left = `${(p.x / svg.viewBox.baseVal.width) * 100}%`;
    };
    const leave = () => {
      for (const el of [cross, dot]) el.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    svg.querySelector('.hit').addEventListener('pointermove', move);
    svg.querySelector('.hit').addEventListener('pointerleave', leave);
  }
}
