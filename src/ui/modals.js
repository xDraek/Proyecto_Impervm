import { QUESTS } from '../game/data.js';
import { bag, fmtNum } from './format.js';

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

export function rankingHtml(game) {
  const rows = game
    .ranking()
    .map(
      (r) => `<tr class="${r.player ? 'me' : ''}"><td>${r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</td>
        <td>${r.player ? '⚜ ' : ''}${r.name}</td><td>${fmtNum(r.points)}</td></tr>`,
    )
    .join('');
  return `<div class="modal-card narrow">
    ${head('🏆', 'Clasificación', 'Un punto por cada 100 recursos invertidos en edificios, investigaciones y tropas')}
    <table class="ranking"><thead><tr><th>#</th><th>Imperio</th><th>Puntos</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">Los imperios rivales también crecen mientras no juegas.</p>
  </div>`;
}
