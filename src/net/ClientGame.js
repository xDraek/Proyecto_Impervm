import { clock, universe } from '../config.js';
import { Game } from '../game/Game.js';
import { api } from './api.js';
import { ClientWorld } from './ClientWorld.js';

// La partida en el navegador: un espejo de la del servidor. Entre dos estados
// solo hace correr la producción; cuando toca un suceso (una obra que termina,
// una flota que llega…) o cada pocos segundos, pide el estado nuevo. Las
// acciones se mandan al servidor, que es quien decide.

const SYNC_MS = 8000;
/** Con la conexión en vivo abierta, el servidor avisa de los cambios: basta con preguntar de tarde en tarde. */
const LIVE_SYNC_MS = 45_000;
const MIN_GAP_MS = 1500;

export class ClientGame extends Game {
  static async connect() {
    const snap = await api('GET', '/api/state');
    const game = new ClientGame({ state: snap.state, world: new ClientWorld(), userId: snap.userId, mode: 'mirror' });
    game.applySnapshot(snap, { first: true });
    return game;
  }

  applySnapshot(snap, { first = false } = {}) {
    clock.offset = snap.serverTime - Date.now();
    universe.speed = snap.speed ?? universe.speed;
    universe.eventSeed = snap.eventSeed ?? universe.eventSeed;
    this.username = snap.username;
    this.alliance = snap.alliance ?? null;
    this.admin = !!snap.admin;
    this.mailUnread = snap.mailUnread ?? 0;
    this.forumUnread = snap.forumUnread ?? 0;
    this.allianceApplications = snap.applications ?? 0;
    this.friendRequests = snap.friendRequests ?? 0;
    const islandsChanged = this.world.apply(snap.world);
    this.state = snap.state;
    this.incoming = snap.incoming ?? [];
    this.world.joints = snap.joint ?? [];
    this.traffic = snap.traffic ?? [];
    this.support = snap.support ?? [];
    this.due = false;
    this.lastSync = Date.now();
    this.#showNotes(first);
    this.dispatchEvent(new Event('change'));
    if (islandsChanged && !first) this.dispatchEvent(new Event('world'));
  }

  /** Avisos nuevos del servidor (obras terminadas, ataques…), una sola vez cada uno. */
  #showNotes(first) {
    const key = `imperium.lastNote.${this.userId}`;
    let last = this.lastNote;
    if (last == null) {
      try {
        last = Number(localStorage.getItem(key)) || 0;
      } catch {
        last = 0;
      }
    }
    const fresh = this.state.notes.filter((n) => n.id > last);
    if (fresh.length) {
      last = Math.max(...fresh.map((n) => n.id));
      const shown = first ? fresh.slice(-4) : fresh;
      for (const n of shown) this.dispatchEvent(new CustomEvent('notify', { detail: n }));
      if (first && fresh.length > 4) {
        this.dispatchEvent(new CustomEvent('notify', { detail: { text: `Y ${fresh.length - 4} cosas más mientras no estabas. Mira los informes 📜`, kind: 'info' } }));
      }
      try {
        localStorage.setItem(key, String(last));
      } catch {
        // sin almacenamiento
      }
    }
    this.lastNote = last;
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      this.applySnapshot(await api('GET', '/api/state'));
      if (this.offline) {
        this.offline = false;
        this.dispatchEvent(new Event('online'));
      }
    } catch (err) {
      if (err.status === 401) this.dispatchEvent(new Event('logout'));
      else if (!this.offline) {
        this.offline = true;
        this.dispatchEvent(new Event('offline'));
      }
      this.lastSync = Date.now();
    } finally {
      this.syncing = false;
    }
  }

  start() {
    this.timer = setInterval(() => {
      const since = Date.now() - this.lastSync;
      if ((this.due && since > MIN_GAP_MS) || since > (this.live ? LIVE_SYNC_MS : SYNC_MS)) this.sync();
    }, 500);
  }

  async #act(action, ...args) {
    try {
      const { result, snapshot } = await api('POST', '/api/action', { action, args });
      this.applySnapshot(snapshot);
      return result;
    } catch (err) {
      if (err.status === 401) this.dispatchEvent(new Event('logout'));
      return { ok: false, reason: err.message };
    }
  }

  upgrade(id) {
    return this.#act('upgrade', id);
  }

  cancel() {
    return this.#act('cancel');
  }

  research(id) {
    return this.#act('research', id);
  }

  cancelResearch() {
    return this.#act('cancelResearch');
  }

  train(id, n) {
    return this.#act('train', id, n);
  }

  cancelTraining(building, index) {
    return this.#act('cancelTraining', building, index);
  }

  trade(from, to, n) {
    return this.#act('trade', from, to, n);
  }

  sendMission(type, target, units, payload, opts = {}) {
    return this.#act('sendMission', type, target, units, payload, opts);
  }

  hireHero(name) {
    return this.#act('hireHero', name);
  }

  heroSkill(skill) {
    return this.#act('heroSkill', skill);
  }

  setWork(id, pct) {
    return this.#act('setWork', id, pct);
  }

  hireMercenaries(id) {
    return this.#act('hireMercenaries', id);
  }

  setTitle(id) {
    return this.#act('setTitle', id);
  }

  setBanner(color, emblem) {
    return this.#act('setBanner', color, emblem);
  }

  equipRelic(id, on) {
    return this.#act('equipRelic', id, on);
  }

  sellRelic(id) {
    return this.#act('sellRelic', id);
  }

  donateWonder(id, bag) {
    return this.#act('donateWonder', id, bag);
  }

  upgradeColony(id) {
    return this.#act('upgradeColony', id);
  }

  startVacation() {
    return this.#act('startVacation');
  }

  endVacation() {
    return this.#act('endVacation');
  }

  recall(id) {
    return this.#act('recall', id);
  }

  claimQuest(id) {
    return this.#act('claimQuest', id);
  }

  claimTask(id) {
    return this.#act('claimTask', id);
  }

  claimDaily() {
    return this.#act('claimDaily');
  }

  castPower(id) {
    return this.#act('castPower', id);
  }

  acceptVisitor() {
    return this.#act('acceptVisitor');
  }

  dismissVisitor() {
    return this.#act('dismissVisitor');
  }

  markReportsRead() {
    if (!this.unreadReports) return Promise.resolve({ ok: true });
    for (const r of this.state.reports) r.read = true;
    this.dispatchEvent(new Event('change'));
    return this.#act('markReportsRead');
  }

  fetchRanking() {
    return api('GET', '/api/ranking');
  }

  fetchMap() {
    return api('GET', '/api/map');
  }
}
