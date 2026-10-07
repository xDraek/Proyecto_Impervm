import { RESOURCES, UNITS } from '../game/data.js';

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export function fmtNum(n) {
  return nf.format(Math.floor(n));
}

export function fmtDec(n) {
  return nf1.format(n);
}

export function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return '∞';
  const s = Math.max(0, Math.ceil(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function fmtAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/** Elementos <li> de una lista de costes, marcando lo que falta. */
export function costItems(cost, have, mult = 1) {
  return Object.entries(cost)
    .map(([res, n]) => {
      const need = n * mult;
      const ok = have[res] >= need;
      return `<li class="${ok ? 'ok' : 'missing'}" title="${RESOURCES[res].name}">${RESOURCES[res].icon} ${fmtNum(need)}</li>`;
    })
    .join('');
}

/** Lista de costes que se refresca sola (ver Hud#refreshLive). */
export function costList(cost, have, countInput = '') {
  const attrs = `data-cost='${JSON.stringify(cost)}'${countInput ? ` data-count="${countInput}"` : ''}`;
  return `<ul class="costs" ${attrs}>${costItems(cost, have)}</ul>`;
}

/** Recursos en línea: "🪵 100 🪨 50". */
export function bag(b) {
  const parts = Object.entries(b ?? {})
    .filter(([, n]) => n > 0)
    .map(([res, n]) => `<span class="bag-item" title="${RESOURCES[res].name}">${RESOURCES[res].icon} ${fmtNum(n)}</span>`);
  return parts.join(' ') || '<span class="muted">nada</span>';
}

/** Unidades en línea: "🔱 12 · 🏹 8". */
export function unitList(units) {
  const parts = Object.entries(units ?? {})
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `<span class="bag-item" title="${UNITS[id].name}">${UNITS[id].icon} ${fmtNum(n)}</span>`);
  return parts.join(' ') || '<span class="muted">ninguna</span>';
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
