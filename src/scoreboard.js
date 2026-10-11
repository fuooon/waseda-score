// ============================================
// Scoreboard - compact inning-by-inning board (#score-summary)
// ============================================
//
// Every number comes from scoring.scoreboard(game): runs per half-inning
// (blank = not played yet, 'X' = bottom half not needed), 計 (runs),
// 安 (hits) and 失 (errors committed while fielding).
// The half-inning being viewed (game.currentInning / currentHalf) is highlighted.
// Cells carry data-team / data-inning so the sheet can move the cursor on tap.

import { scoreboard, liveState } from './scoring.js';
import { MAX_INNINGS } from './rules.js';
import { escapeHtml } from './util.js';

const TEAM_KEYS = ['first', 'second'];

function teamLabel(game, teamKey) {
  const name = teamKey === 'first' ? game.teamFirst : game.teamSecond;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || (teamKey === 'first' ? '先攻チーム' : '後攻チーム');
}

function runsText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

// opts.columns: number of inning columns to show (the sheet passes its own so
// both line up). By default: the scoreboard's columns, plus the inning being
// played or viewed (an extra inning shows up before it has any record).
export function renderScoreboard(container, game, opts = {}) {
  if (!container || !game) return;
  const sb = scoreboard(game);
  const viewTeam = game.currentHalf === 'bottom' ? 'second' : 'first';
  const viewInning = Number(game.currentInning) || 1;
  let count = Number(opts.columns);
  if (!Number.isInteger(count) || count < 1) {
    const live = liveState(game);
    count = Math.max(sb.maxInning, viewInning, live.gameOver ? 0 : live.inning);
  }
  count = Math.min(MAX_INNINGS, Math.max(count, sb.maxInning));
  const columns = Array.from({ length: count }, (_, i) => i + 1);

  let html = '<table class="sb-table" aria-label="スコアボード"><thead><tr>';
  html += '<th class="sb-team-head" scope="col"><span class="sr-only">チーム</span></th>';
  for (const n of columns) {
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
    columns.forEach((n, i) => {
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
