import { UNITS } from '../game/data.js';
import { bag, escapeHtml, fmtAgo, fmtNum, unitList } from './format.js';

// Informes de combate, exploración y colonias.

const KIND_ICON = { ataque: '⚔️', defensa: '🏴‍☠️', exploracion: '🔭', colonia: '🚩', expedicion: '🧭', visita: '🧳', victoria: '🗽' };

function sideTable(title, side) {
  const rows = Object.entries(side.start)
    .map(([id, n]) => {
      const lost = side.lost[id] ?? 0;
      return `<tr><td>${UNITS[id].icon} ${UNITS[id].name}</td><td>${fmtNum(n)}</td><td class="${lost ? 'bad' : ''}">${lost ? `−${fmtNum(lost)}` : '0'}</td></tr>`;
    })
    .join('');
  return `<div class="side"><h5>${title}</h5>${
    rows ? `<table><thead><tr><th></th><th>Tropas</th><th>Bajas</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Nadie</p>'
  }</div>`;
}

function reportBody(r) {
  const parts = [];
  if (r.text) parts.push(`<p>${escapeHtml(r.text)}</p>`);
  if (r.battle) {
    // En los asaltos piratas (y emboscadas de expedición) los piratas atacan
    const defending = r.kind === 'defensa' || r.defending;
    const attTitle = defending ? (r.enemy ? escapeHtml(r.enemy) : 'Piratas') : 'Tu ejército';
    const defTitle = defending ? (r.kind === 'defensa' ? 'Tus defensores' : 'Tu flota') : r.enemy ? escapeHtml(r.enemy) : 'Defensores';
    parts.push(`<div class="battle">${sideTable(attTitle, r.battle.att)}${sideTable(defTitle, r.battle.def)}</div>`);
    const notes = [`${r.battle.rounds} ${r.battle.rounds === 1 ? 'asalto' : 'asaltos'}`];
    if (r.towers) notes.push(`las torres dispararon ${fmtNum(r.towers)} por asalto`);
    if (r.wall) notes.push(`fortificación enemiga +${Math.round(r.wall * 100)} %`);
    parts.push(`<p class="muted small">${notes.join(' · ')}</p>`);
  }
  if (r.intel) {
    parts.push(`<div class="info-row"><span>Guarnición vista</span><span>${unitList(r.intel.garrison)}</span></div>`);
    if (Object.keys(r.intel.stock).length) parts.push(`<div class="info-row"><span>Botín acumulado</span><span>${bag(r.intel.stock)}</span></div>`);
  }
  if (r.loot && Object.keys(r.loot).length) {
    const label = r.kind === 'defensa' ? 'Se han llevado' : 'Botín';
    parts.push(`<div class="info-row"><span>${label}</span><span>${bag(r.loot)}</span></div>`);
  }
  if (r.lostUnits) parts.push(`<div class="info-row"><span>Barcos y tropas perdidos</span><span>${unitList(r.lostUnits)}</span></div>`);
  if (r.reward) parts.push(`<div class="info-row"><span>Botín de los piratas</span><span>${bag(r.reward)}</span></div>`);
  return parts.join('');
}

export function reportsHtml(reports) {
  const items = reports.length
    ? reports
        .map((r) => {
          const where = escapeHtml(r.islandName ?? (r.island ? 'Una isla' : 'Tu isla'));
          return `<details class="report ${r.outcome ?? ''} ${r.read ? '' : 'unread'}">
            <summary>
              <span class="r-icon">${KIND_ICON[r.kind] ?? '📜'}</span>
              <span class="r-title">${escapeHtml(r.title)}</span>
              <span class="r-meta">${where} · ${fmtAgo(r.t)}</span>
            </summary>
            <div class="r-body">${reportBody(r)}</div>
          </details>`;
        })
        .join('')
    : '<p class="muted">Todavía no hay informes. Explora el archipiélago o espera a los piratas.</p>';
  return `<div class="modal-card">
    <div class="panel-head"><span class="panel-icon">📜</span><div><h3>Informes</h3><div class="panel-lvl">Combates, exploraciones y colonias</div></div>
    <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
    <div class="reports">${items}</div>
  </div>`;
}
