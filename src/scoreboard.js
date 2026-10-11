// ============================================
// Scoreboard - compact inning-by-inning board (#score-summary)
// ============================================
//
// Every number comes from scoring.scoreboard(game): runs per half-inning
// (blank = not played yet, 'X' = bottom half not needed), 計 (runs),
// 安 (hits) and 失 (errors committed while fielding).
// The half-inning being viewed (game.currentInning / currentHalf) is highlighted.
// Cells carry data-team / data-inning so the sheet can move the cursor on tap.

import { scoreboard } from './scoring.js';
import { escapeHtml } from './util.js';

const TEAM_KEYS = ['first', 'second'];

function teamLabel(game, teamKey) {
  const name = teamKey === 'first' ? game.teamFirst : game.teamSecond;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || (teamKey === 'first' ? '先攻' : '後攻');
}

function runsText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function renderScoreboard(container, game) {
  if (!container || !game) return;
  const sb = scoreboard(game);
  const viewTeam = game.currentHalf === 'bottom' ? 'second' : 'first';
  const viewInning = Number(game.currentInning) || 1;

  let html = '<table class="sb-table" aria-label="スコアボード"><thead><tr>';
  html += '<th class="sb-team-head" scope="col"><span class="sr-only">チーム</span></th>';
  for (const n of sb.columns) {
    const cls = n === viewInning ? ' class="sb-col-current"' : '';
    html += `<th scope="col"${cls}>${n}</th>`;
  }
  html += '<th class="sb-total" scope="col" title="得点の合計">計</th>';
  html += '<th class="sb-stat" scope="col" title="安打">安</th>';
  html += '<th class="sb-stat" scope="col" title="失策（守備のエラー）">失</th>';
  html += '</tr></thead><tbody>';

  for (const teamKey of TEAM_KEYS) {
    const line = sb[teamKey];
    const isWinner = sb.final && sb.winner === teamKey;
    const name = teamLabel(game, teamKey);
    html += `<tr class="sb-row-${teamKey}${isWinner ? ' sb-winner' : ''}">`;
    html += `<th class="sb-team" scope="row" title="${escapeHtml(name)}">` +
      `<span class="sb-side">${teamKey === 'first' ? '先' : '後'}</span>${escapeHtml(name)}</th>`;
    sb.columns.forEach((n, i) => {
      const value = line.innings[i];
      const cls = ['sb-cell'];
      if (value === null || value === undefined) cls.push('sb-empty');
      if (value === 'X') cls.push('sb-x');
      if (teamKey === viewTeam && n === viewInning) cls.push('active-cell');
      html += `<td class="${cls.join(' ')}" data-team="${teamKey}" data-inning="${n}">${runsText(value)}</td>`;
    });
    html += `<td class="sb-total">${line.R}</td>`;
    html += `<td class="sb-stat">${line.H}</td>`;
    html += `<td class="sb-stat">${line.E}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// TEMPORARY (phase 2): kept only until export.js stops importing it; removed per CONTRACT.
export function renderScoreboardForExport(game) {
  const box = { innerHTML: '' };
  renderScoreboard(box, game);
  return `<div style="background:#fff;padding:16px;">${box.innerHTML}</div>`;
}
