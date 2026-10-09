import { UNITS } from '../game/data.js';
import { unitIcon } from '../scene/portraits.js';
import { bag, escapeHtml, fmtAgo, fmtNum, unitList } from './format.js';

// Informes de combate, exploración y colonias.

const KIND_ICON = { reliquia: '🏺', ataque: '⚔️', defensa: '🏴‍☠️', exploracion: '🔭', colonia: '🚩', expedicion: '🧭', visita: '🧳', victoria: '🗽', ocupacion: '🦅' };

function sideTable(title, side) {
  const rows = Object.entries(side.start)
    .map(([id, n]) => {
      const lost = side.lost[id] ?? 0;
      return `<tr><td class="u-cell">${unitIcon(id)} ${UNITS[id].name}</td><td>${fmtNum(n)}</td><td class="${lost ? 'bad' : ''}">${lost ? `−${fmtNum(lost)}` : '0'}</td></tr>`;
    })
    .join('');
  return `<div class="side"><h5>${title}</h5>${
    rows ? `<table><thead><tr><th></th><th>Tropas</th><th>Bajas</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Nadie</p>'
  }</div>`;
}

/** Cómo se llama cada bando del combate desde el punto de vista del jugador. */
function sideTitles(r) {
  // En los asaltos piratas (y emboscadas de expedición) los piratas atacan
  const defending = r.kind === 'defensa' || r.defending;
  const attTitle = defending ? (r.enemy ? escapeHtml(r.enemy) : 'Piratas') : 'Tu ejército';
  const defTitle = defending ? (r.kind === 'defensa' ? 'Tus defensores' : 'Tu flota') : r.enemy ? escapeHtml(r.enemy) : 'Defensores';
  return { attTitle, defTitle };
}

/**
 * Repetición del combate: las dos fuerzas como barras que menguan asalto a
 * asalto. Usa lo que quedaba de cada bando tras cada asalto (`battle.log`).
 */
export function playReplay(btn, r) {
  const box = btn.nextElementSibling;
  if (!box) return;
  btn.disabled = true;
  // En los ataques por mar, cada fase (naval o en tierra) tiene su propia repetición
  const b = (btn.dataset.phase && r.battle[btn.dataset.phase]) || r.battle;
  const frames = [{ att: b.att.start, def: b.def.start }, ...b.log];
  const { attTitle, defTitle } = sideTitles(r);
  const sideHtml = (key, title) =>
    `<div class="rp-side" data-side="${key}"><h5>${title}</h5>${Object.entries(b[key].start)
      .map(([id, n]) => `<div class="rp-unit" data-u="${id}">${unitIcon(id, 'rp-icon')}<div class="rp-bar"><i style="width:100%"></i></div><b>${fmtNum(n)}</b></div>`)
      .join('') || '<p class="muted small">Nadie</p>'}</div>`;
  box.innerHTML = `<div class="rp-stage"><div class="rp-round">¡A las armas!</div><div class="rp-sides">${sideHtml('att', attTitle)}<div class="rp-vs">⚔️</div>${sideHtml('def', defTitle)}</div></div>`;
  let i = 0;
  const step = () => {
    if (!box.isConnected) return;
    i++;
    const round = box.querySelector('.rp-round');
    if (i >= frames.length) {
      const verdict = btn.dataset.phase ? 'Fin de la batalla' : ({ victoria: '🏆 Victoria', derrota: '💀 Derrota', empate: '🏳️ Nadie gana' }[r.outcome] ?? 'Fin del combate');
      round.textContent = `${verdict} · ${b.rounds} ${b.rounds === 1 ? 'asalto' : 'asaltos'}`;
      round.classList.add('done');
      btn.disabled = false;
      btn.textContent = '↻ Repetir';
      return;
    }
    round.textContent = `Asalto ${i} de ${frames.length - 1}`;
    for (const key of ['att', 'def']) {
      const side = box.querySelector(`[data-side="${key}"]`);
      side.classList.remove('hit');
      void side.offsetWidth; // reinicia la animación del golpe
      side.classList.add('hit');
      for (const row of side.querySelectorAll('.rp-unit')) {
        const id = row.dataset.u;
        const start = b[key].start[id];
        const now = frames[i][key][id] ?? 0;
        const before = frames[i - 1][key][id] ?? 0;
        row.querySelector('i').style.width = `${start ? (now / start) * 100 : 0}%`;
        row.querySelector('b').textContent = fmtNum(now);
        row.classList.toggle('dead', now === 0);
        if (before > now) {
          const pop = document.createElement('span');
          pop.className = 'rp-pop';
          pop.textContent = `−${fmtNum(before - now)}`;
          row.appendChild(pop);
          setTimeout(() => pop.remove(), 1000);
        }
      }
    }
    setTimeout(step, 1200);
  };
  setTimeout(step, 600);
}

/**
 * Ataque por mar: primero la batalla naval y luego la de tierra, cada una con sus bajas y su
 * repetición, y las tropas que se ahogaron al hundirse los barcos.
 */
function phasesHtml(r) {
  const b = r.battle;
  const { attTitle, defTitle } = sideTitles(r);
  const out = [];
  const phase = (key, heading) => {
    const p = b[key];
    out.push(`<h5 class="phase-head">${heading}</h5><div class="battle">${sideTable(attTitle, p.att)}${sideTable(defTitle, p.def)}</div>`);
    if (p.log?.length) out.push(`<button class="ghost small replay-btn" data-action="replay" data-phase="${key}" data-t="${r.t}">▶ Ver la batalla</button><div class="replay"></div>`);
  };
  // Una emboscada en alta mar solo tiene la batalla naval
  if (b.atSea) {
    phase('naval', '⚓ Batalla en alta mar');
    if (b.drowned) out.push(`<div class="info-row"><span>🌊 Ahogados al hundirse los barcos</span><span>${unitList(b.drowned)}</span></div>`);
    return out;
  }
  if (b.naval) phase('naval', `⚓ Batalla naval · ${b.seaWon ? 'los atacantes se hacen con el mar' : 'la flota defensora domina el mar'}`);
  else out.push('<h5 class="phase-head">⚓ Sin batalla naval: no había barcos de guerra defendiendo</h5>');
  if (b.drowned) out.push(`<div class="info-row"><span>🌊 Ahogados al hundirse los barcos</span><span>${unitList(b.drowned)}</span></div>`);
  if (b.land) phase('land', '⚔️ Batalla en tierra');
  else if (!b.seaWon) out.push('<h5 class="phase-head">⚔️ No hubo desembarco</h5>');
  else if (!b.landed) out.push('<h5 class="phase-head">⚔️ Nadie desembarcó: no había tropas de tierra</h5>');
  else out.push('<h5 class="phase-head">⚔️ Desembarco sin resistencia</h5>');
  return out;
}

function reportBody(r) {
  const parts = [];
  if (r.text) parts.push(`<p>${escapeHtml(r.text)}</p>`);
  if (r.battle && 'seaWon' in r.battle) parts.push(...phasesHtml(r));
  else if (r.battle) {
    const { attTitle, defTitle } = sideTitles(r);
    parts.push(`<div class="battle">${sideTable(attTitle, r.battle.att)}${sideTable(defTitle, r.battle.def)}</div>`);
    if (r.battle.log?.length) parts.push(`<button class="ghost small replay-btn" data-action="replay" data-t="${r.t}">▶ Ver el combate</button><div class="replay"></div>`);
  }
  if (r.battle) {
    if (!r.shared) parts.push(`<button class="ghost small" data-action="share-report" data-t="${r.t}">📢 Compartir en el chat</button>`);
    const notes = r.battle.rounds ? [`${r.battle.rounds} ${r.battle.rounds === 1 ? 'asalto' : 'asaltos'}`] : [];
    if (r.towers) notes.push(`las torres dispararon ${fmtNum(r.towers)} por asalto`);
    if (r.wall) notes.push(`fortificación enemiga +${Math.round(r.wall * 100)} %`);
    if (notes.length) parts.push(`<p class="muted small">${notes.join(' · ')}</p>`);
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

/** Un informe que otro jugador ha compartido en el chat. */
export function sharedReportHtml(m) {
  const r = { ...m.report, shared: true };
  return `<div class="modal-card">
    <div class="panel-head"><span class="panel-icon">📜</span><div><h3>${escapeHtml(r.title)}</h3><div class="panel-lvl">Informe compartido por ${escapeHtml(m.name)}${r.islandName ? ` · ${escapeHtml(r.islandName)}` : ''}</div></div>
    <button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
    <div class="r-body">${reportBody(r)}</div>
  </div>`;
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
    <button class="icon-btn help-btn" data-guide="combate" title="Cómo se combate (guía)">?</button><button class="icon-btn" data-action="close-modal" title="Cerrar">✕</button></div>
    <div class="reports">${items}</div>
  </div>`;
}
