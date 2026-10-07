import { QUESTS } from '../game/data.js';
import { bag, escapeHtml, fmtNum } from './format.js';

// Ventanas de misiones y de clasificación.

const head = (icon, title, sub) => `
  <div class="panel-head"><span class="panel-icon">${icon}</span><div><h3>${title}</h3><div class="panel-lvl">${sub}</div></div>
  <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>`;

function rewardHtml(reward) {
  const { favor, ...rest } = reward;
  return `${Object.keys(rest).length ? bag(rest) : ''}${favor ? ` <span class="bag-item">🙏 ${favor}</span>` : ''}`;
}

export function questsHtml(game) {
  const active = game.activeQuests();
  const doneCount = QUESTS.length - game.questsLeft();
  const items = active.length
    ? active
        .map((q) => {
          const pct = Math.round((q.current / q.target) * 100);
          return `<div class="quest ${q.done ? 'done' : ''}">
            <div class="quest-head"><b>${q.title}</b><span class="muted small">${fmtNum(q.current)} / ${fmtNum(q.target)}</span></div>
            <p>${q.text}</p>
            <div class="progress"><i style="width:${pct}%"></i></div>
            <div class="quest-foot"><span class="small">Recompensa: ${rewardHtml(q.reward)}</span>
              <button class="primary small" data-action="claim" data-id="${q.id}" ${q.done ? '' : 'disabled'}>${q.done ? 'Reclamar' : 'En curso'}</button></div>
          </div>`;
        })
        .join('')
    : '<p class="muted">¡Has completado todas las misiones! Tu nombre se cantará en los puertos de todo el archipiélago.</p>';
  return `<div class="modal-card">
    ${head('📋', 'Misiones', `${doneCount} de ${QUESTS.length} completadas`)}
    <div class="quests">${items}</div>
  </div>`;
}

const medal = (n) => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : n);

export function rankingHtml({ top, me, total, alliances = [] }, tab = 'players') {
  const tabs = `<div class="tabs small-tabs">
    <button data-action="rank-tab" data-tab="players" class="${tab === 'players' ? 'active' : ''}">Jugadores</button>
    <button data-action="rank-tab" data-tab="alliances" class="${tab === 'alliances' ? 'active' : ''}">Alianzas</button></div>`;
  let table;
  if (tab === 'alliances') {
    const rows = alliances
      .map((a) => `<tr><td>${medal(a.rank)}</td><td>${escapeHtml(a.name)} <span class="tag">[${escapeHtml(a.tag)}]</span><div class="muted small">${a.members} miembros</div></td><td>${fmtNum(a.points)}</td></tr>`)
      .join('');
    table = rows
      ? `<table class="ranking"><thead><tr><th>#</th><th>Alianza</th><th>Puntos</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">Todavía no hay alianzas.</p>';
  } else {
    const row = (r) => `<tr class="${r.me ? 'me' : ''}"><td>${medal(r.rank)}</td>
      <td>${r.me ? '⚜ ' : ''}${escapeHtml(r.name)}${r.tag ? ` <span class="tag">[${escapeHtml(r.tag)}]</span>` : ''}
        <div class="muted small">${escapeHtml(r.city)}${r.colonies ? ` · 🚩 ${r.colonies}` : ''}${r.coloso ? ` · 🗽 ${r.coloso}` : ''}</div></td>
      <td>${fmtNum(r.points)}</td>
      <td>${r.me ? '' : `<button class="ghost small" data-action="goto" data-island="${r.island}" title="Ver en el mapa">🗺️</button>`}</td></tr>`;
    const mine = me && !top.some((r) => r.me) ? row({ ...me, me: true }) : '';
    table = `<table class="ranking"><thead><tr><th>#</th><th>Imperio</th><th>Puntos</th><th></th></tr></thead><tbody>${top.map(row).join('')}${mine}</tbody></table>`;
  }
  return `<div class="modal-card narrow">
    ${head('🏆', 'Clasificación', `${fmtNum(total)} imperios · un punto por cada 100 recursos invertidos`)}
    ${tabs}${table}
  </div>`;
}
