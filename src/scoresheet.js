// ============================================
// Scoresheet - Main Score Recording View
// ============================================

import { POSITION_SHORT, RESULT_TYPES, saveGame } from './data.js';
import { initScoreInput } from './score-input.js';
import { renderScoreboard } from './scoreboard.js';

let currentGame = null;

export function initScoresheet(game) {
  currentGame = game;
  renderScoresheetTable('first');
  renderScoresheetTable('second');
  updateInningLabel();
  renderScoreSummary();

  document.getElementById('prev-inning-btn').addEventListener('click', prevInning);
  document.getElementById('next-inning-btn').addEventListener('click', nextInning);
}

export function updateScoresheet() {
  renderScoresheetTable('first');
  renderScoresheetTable('second');
  updateInningLabel();
  renderScoreSummary();
}

function prevInning() {
  if (currentGame.currentHalf === 'bottom') {
    currentGame.currentHalf = 'top';
  } else if (currentGame.currentInning > 1) {
    currentGame.currentInning--;
    currentGame.currentHalf = 'bottom';
  }
  currentGame.outsInInning = 0;
  saveGame(currentGame);
  updateInningLabel();
  renderScoreSummary();
}

function nextInning() {
  if (currentGame.currentHalf === 'top') {
    currentGame.currentHalf = 'bottom';
  } else if (currentGame.currentInning < 12) {
    currentGame.currentInning++;
    currentGame.currentHalf = 'top';
  }
  currentGame.outsInInning = 0;
  saveGame(currentGame);
  updateInningLabel();
  renderScoreSummary();
}

function updateInningLabel() {
  const label = document.getElementById('current-inning-label');
  const halfText = currentGame.currentHalf === 'top' ? '表' : '裏';
  label.textContent = `${currentGame.currentInning}回${halfText}`;
}

function renderScoreSummary() {
  const container = document.getElementById('score-summary');
  renderScoreboard(container, currentGame);
}

function renderScoresheetTable(teamKey) {
  const container = document.getElementById('scoresheet-container');

  // Remove existing table for this team if any
  const existingTable = container.querySelector(`#scoresheet-${teamKey}`);
  if (existingTable) existingTable.remove();

  const lineup = currentGame.getLineup(teamKey);
  const teamName = currentGame.getTeamName(teamKey);
  const innings = currentGame.innings;

  const wrapper = document.createElement('div');
  wrapper.id = `scoresheet-${teamKey}`;
  wrapper.style.marginBottom = '16px';

  const teamLabel = document.createElement('div');
  teamLabel.style.cssText = 'padding: 8px 12px; background: var(--color-green); color: white; font-weight: 700; border-radius: 8px 8px 0 0; font-size: 0.95rem;';
  teamLabel.textContent = `${teamKey === 'first' ? '【先攻】' : '【後攻】'} ${teamName}`;
  wrapper.appendChild(teamLabel);

  const table = document.createElement('table');
  table.className = 'scoresheet-table';

  // Header row
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const playerTh = document.createElement('th');
  playerTh.className = 'player-header';
  playerTh.textContent = '打順 / 選手';
  headerRow.appendChild(playerTh);

  for (let i = 1; i <= innings; i++) {
    const th = document.createElement('th');
    th.textContent = i;
    headerRow.appendChild(th);
  }

  // Extension innings
  for (let i = innings + 1; i <= 12; i++) {
    if (hasDataInInning(teamKey, i)) {
      const th = document.createElement('th');
      th.textContent = i;
      headerRow.appendChild(th);
    }
  }

  // Total columns
  ['安', '打点', '残'].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    th.style.background = 'var(--color-accent)';
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows
  const tbody = document.createElement('tbody');
  const numBatters = lineup.length || 9;

  for (let bIdx = 0; bIdx < numBatters; bIdx++) {
    const player = lineup[bIdx] || {};
    const tr = document.createElement('tr');

    // Player cell
    const playerTd = document.createElement('td');
    playerTd.className = 'player-cell';
    const orderNum = bIdx + 1;
    const posLabel = player.position ? POSITION_SHORT[player.position] || '' : '';
    playerTd.innerHTML = `
      <div class="player-name">${orderNum}. ${escapeHtml(player.name || '---')}</div>
      <div class="player-detail">${player.number ? '#' + player.number : ''} ${posLabel}</div>
    `;
    tr.appendChild(playerTd);

    // Inning cells
    const maxInning = Math.max(innings, getMaxInningWithData(teamKey));
    for (let inn = 1; inn <= maxInning; inn++) {
      const td = document.createElement('td');
      td.className = 'score-cell';
      const result = currentGame.getAtBat(teamKey, inn, bIdx);

      if (result) {
        td.classList.add('has-result');
        td.innerHTML = renderCellContent(result);
      }

      // Highlight current inning
      const isCurrentTeam = (teamKey === 'first' && currentGame.currentHalf === 'top') ||
                           (teamKey === 'second' && currentGame.currentHalf === 'bottom');
      if (isCurrentTeam && inn === currentGame.currentInning) {
        td.classList.add('active-cell');
      }

      td.addEventListener('click', () => handleCellClick(teamKey, inn, bIdx));
      tr.appendChild(td);
    }

    // Stats cells
    const hits = countPlayerHits(teamKey, bIdx);
    const rbis = countPlayerRBIs(teamKey, bIdx);
    const lob = countPlayerLOB(teamKey, bIdx);

    [hits, rbis, lob].forEach((val, ci) => {
      const td = document.createElement('td');
      td.className = ci === 0 ? 'inning-total-cell' : '';
      td.style.cssText = 'width: 36px; font-size: 0.85rem; font-weight: 600;';
      td.textContent = val || '';
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }

  // Inning run total row
  const totalRow = document.createElement('tr');
  totalRow.className = 'total-row';
  const totalLabel = document.createElement('td');
  totalLabel.className = 'player-cell';
  totalLabel.innerHTML = '<div class="player-name">合計</div>';
  totalRow.appendChild(totalLabel);

  const maxInning = Math.max(innings, getMaxInningWithData(teamKey));
  for (let inn = 1; inn <= maxInning; inn++) {
    const td = document.createElement('td');
    td.style.cssText = 'font-size: 1rem;';
    const runs = currentGame.getInningRuns(teamKey, inn);
    td.textContent = runs || '';
    totalRow.appendChild(td);
  }

  // Total stats
  const totalHits = currentGame.getHitCount(teamKey);
  const totalRuns = currentGame.getTotalRuns(teamKey);
  [totalHits, totalRuns, ''].forEach(val => {
    const td = document.createElement('td');
    td.style.cssText = 'font-weight: 700; font-size:0.85rem;';
    td.textContent = val || '';
    totalRow.appendChild(td);
  });

  tbody.appendChild(totalRow);
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

function renderCellContent(result) {
  if (!result || !result.resultType) return '';

  const rt = RESULT_TYPES[result.resultType];
  if (!rt) return '';

  let html = '<div class="cell-content">';

  // Out number
  if (result.outNumber) {
    html += `<div class="cell-out-number">${result.outNumber}</div>`;
  }

  // Diamond with base paths
  html += '<div class="cell-diamond">';
  const basesReached = result.basesReached || 0;
  html += `<div class="base base-1 ${basesReached >= 1 ? 'reached' : ''}"></div>`;
  html += `<div class="base base-2 ${basesReached >= 2 ? 'reached' : ''}"></div>`;
  html += `<div class="base base-3 ${basesReached >= 3 ? 'reached' : ''}"></div>`;
  html += `<div class="base base-home ${basesReached >= 4 ? 'scored' : ''}"></div>`;
  html += '</div>';

  // Result text
  const posText = result.positions || '';
  const symbolText = rt.symbol;
  html += `<div class="cell-result-text">${posText ? posText + '<br>' : ''}${symbolText}</div>`;

  // Hit symbol at bottom
  if (rt.category === 'hit') {
    html += `<div class="cell-hit-symbol">${rt.symbol}</div>`;
  }

  html += '</div>';
  return html;
}

function handleCellClick(teamKey, inning, batterIdx) {
  initScoreInput(currentGame, teamKey, inning, batterIdx, (result) => {
    if (result) {
      // Calculate out number
      if (result.resultType && RESULT_TYPES[result.resultType]?.isOut) {
        currentGame.outsInInning++;
        result.outNumber = currentGame.outsInInning;
        if (currentGame.outsInInning >= 3) {
          currentGame.outsInInning = 0;
        }
      }
      currentGame.setAtBat(teamKey, inning, batterIdx, result);
    } else {
      // Clear the cell
      if (currentGame.atBats[teamKey][inning]) {
        delete currentGame.atBats[teamKey][inning][batterIdx];
      }
    }
    saveGame(currentGame);
    updateScoresheet();
  });
}

function hasDataInInning(teamKey, inning) {
  const data = currentGame.atBats[teamKey][inning];
  return data && Object.keys(data).length > 0;
}

function getMaxInningWithData(teamKey) {
  let max = currentGame.innings;
  for (let i = 1; i <= 12; i++) {
    if (hasDataInInning(teamKey, i)) max = Math.max(max, i);
  }
  return max;
}

function countPlayerHits(teamKey, batterIdx) {
  const hits = ['SINGLE', 'DOUBLE', 'TRIPLE', 'HOMERUN'];
  let count = 0;
  for (const inningData of Object.values(currentGame.atBats[teamKey])) {
    const r = inningData[batterIdx];
    if (r && hits.includes(r.resultType)) count++;
  }
  return count;
}

function countPlayerRBIs(teamKey, batterIdx) {
  let count = 0;
  for (const inningData of Object.values(currentGame.atBats[teamKey])) {
    const r = inningData[batterIdx];
    if (r) count += (r.rbi || 0);
  }
  return count;
}

function countPlayerLOB(teamKey, batterIdx) {
  // Simplified: not tracking LOB per batter in this version
  return '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
