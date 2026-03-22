// ============================================
// Scoresheet - Main Score Recording View
// ============================================

import { POSITION_SHORT, RESULT_TYPES, RUNNER_EVENTS, saveGame } from './data.js';
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
  document.getElementById('add-inning-btn').addEventListener('click', addInning);
  document.getElementById('game-settings-btn').addEventListener('click', openGameSettings);
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

function addInning() {
  if (currentGame.innings < 12) {
    currentGame.innings++;
    saveGame(currentGame);
    updateScoresheet();
  } else {
    alert('イニング数は最大12回までです');
  }
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
  const statsCols = [
    { label: '安', width: '36px' },
    { label: '点', width: '36px' }, // Shortened to 打点 -> 点 to save space
    { label: '残', width: '36px' }
  ];
  statsCols.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    th.style.width = col.width;
    th.style.minWidth = col.width;
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

    // Build substitution history
    const subs = currentGame.getSubstitutionsForSlot(teamKey, bIdx);
    let subHtml = '';
    if (subs.length > 0) {
      subHtml = '<div class="player-subs">';
      for (const s of subs) {
        const typeLabel = s.type === 'PH' ? '打' : s.type === 'PR' ? '走' : '守';
        subHtml += `<div class="player-sub-entry">`;
        subHtml += `<span class="sub-type-badge">${typeLabel}</span>`;
        subHtml += `<span class="sub-old-name">${escapeHtml(s.oldPlayer.name)}</span>`;
        subHtml += `</div>`;
      }
      subHtml += '</div>';
    }

    playerTd.innerHTML = `
      <div class="player-name-row">
        <div>
          <div class="player-name">${orderNum}. ${escapeHtml(player.name || '---')}</div>
          <div class="player-detail">${player.number ? '#' + player.number : ''} ${posLabel}</div>
        </div>
        <button class="sub-btn" data-team="${teamKey}" data-batter="${bIdx}" title="選手交代">🔄</button>
      </div>
      ${subHtml}
    `;

    // Substitution button handler
    const subBtn = playerTd.querySelector('.sub-btn');
    subBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSubstitutionModal(teamKey, bIdx);
    });

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

    const statVals = [hits, rbis, lob];
    const statWidths = ['36px', '36px', '36px'];

    statVals.forEach((val, ci) => {
      const td = document.createElement('td');
      td.className = ci === 0 ? 'inning-total-cell' : '';
      td.style.cssText = `width: ${statWidths[ci]}; min-width: ${statWidths[ci]}; font-size: 0.85rem; font-weight: 600;`;
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
    td.style.cssText = 'font-weight: 700; font-size: 0.85rem; width: 36px; min-width: 36px;';
    td.textContent = val || '';
    totalRow.appendChild(td);
  });

  tbody.appendChild(totalRow);
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

function renderCellContent(result) {
  if (!result) return '';
  // Handle runner-events-only (no bat result)
  const hasResult = result.resultType && RESULT_TYPES[result.resultType];
  const hasEvents = result.runnerEvents && result.runnerEvents.length > 0;
  if (!hasResult && !hasEvents) return '';

  const rt = hasResult ? RESULT_TYPES[result.resultType] : null;

  const basesReached = result.basesReached || 0;
  const outNum = result.outNumber || 0;
  const posText = result.positions || '';

  // Roman numerals for outs
  const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ'];

  let html = `<div class="cell-content">`;

  // Draw traditional background lines using CSS divs
  html += `<div class="bg-line line-v-main"></div>`;
  html += `<div class="bg-line line-h-cross"></div>`;
  html += `<div class="bg-line line-v-cross"></div>`;

  // Diamond classes for base paths
  let diamondClasses = 'diamond-graphic';
  if (basesReached >= 1) diamondClasses += ' b1';
  if (basesReached >= 2) diamondClasses += ' b2';
  if (basesReached >= 3) diamondClasses += ' b3';
  if (basesReached >= 4) diamondClasses += ' b4';
  if (basesReached >= 4) diamondClasses += ' hr'; // For center circle

  html += `<div class="${diamondClasses}"></div>`;

  // Out number inside diamond
  if (outNum > 0 && ROMAN[outNum]) {
    html += `<div class="out-number-text">${ROMAN[outNum]}</div>`;
  }



  if (posText) {
    let formattedPosText = posText;
    if (rt?.batType && posText.length > 0) {
      const firstChar = posText.charAt(0);
      const rest = posText.substring(1);
      const trajClass = `traj-${rt.batType}`;
      formattedPosText = `<span class="traj-mark ${trajClass}">${firstChar}</span>${rest}`;
    }

    const isHit = rt?.category === 'hit';
    const textColor = isHit ? '#D32F2F' : '#333';
    
    let innerHtml = formattedPosText;
    if (result.resultType === 'SACRIFICE_BUNT') {
      innerHtml = `<div class="sac-bunt-wrap">${formattedPosText}</div>`;
    } else if (result.resultType === 'SACRIFICE_FLY') {
      // Create a triangle SVG that scales with the text bounds
      innerHtml = `<div class="sac-fly-wrap"><svg viewBox="0 0 26 26" preserveAspectRatio="none"><polygon points="13,2 2,24 24,24" fill="none" stroke="var(--color-blue)" stroke-width="1.5"/></svg><span>${formattedPosText}</span></div>`;
    }
    
    html += `<div class="cell-positions" style="color: ${textColor}">${innerHtml}</div>`;
  }
  if (rt && !posText && rt.symbol) {
    // Avoid redundant symbols if it's a hit (cell-hit-line will show the line or HR)
    if (rt.category !== 'hit') {
      html += `<div class="cell-symbol">${rt.symbol}</div>`;
    }
  }


  if (outNum === 3) {
    html += `<div class="cell-inning-end">//</div>`;
  }

  // Runner events labels
  if (hasEvents) {
    const labels = result.runnerEvents.map(e => {
      const ev = RUNNER_EVENTS[e.type];
      return ev ? `<span class="cell-event-tag" style="color:${ev.color}">${ev.symbol}</span>` : '';
    }).join('');
    html += `<div class="cell-events">${labels}</div>`;
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

// ============================================
// Substitution Modal
// ============================================

function openSubstitutionModal(teamKey, batterIdx) {
  const modal = document.getElementById('substitution-modal');
  const title = document.getElementById('sub-modal-title');
  const body = document.getElementById('sub-modal-body');
  const lineup = currentGame.getLineup(teamKey);
  const player = lineup[batterIdx] || {};

  title.textContent = `${batterIdx + 1}番 ${player.name || '---'} → 交代`;

  body.innerHTML = `
    <div class="sub-type-selector">
      <button class="sub-type-btn selected" data-type="PH">🏏 代打</button>
      <button class="sub-type-btn" data-type="PR">🏃 代走</button>
      <button class="sub-type-btn" data-type="DEF">🧤 守備交代</button>
    </div>
    <div class="form-group" style="margin-top: 12px;">
      <label>新しい選手名</label>
      <input type="text" id="sub-new-name" placeholder="選手名" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>背番号</label>
        <input type="text" id="sub-new-number" placeholder="#" style="width: 60px;" />
      </div>
      <div class="form-group">
        <label>守備位置</label>
        <select id="sub-new-position">
          <option value="">そのまま</option>
          ${Object.entries(POSITION_SHORT).map(([num, label]) => `
            <option value="${num}">${num}${label}</option>
          `).join('')}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button id="sub-cancel-btn" class="btn btn-secondary" style="flex:1;">キャンセル</button>
      <button id="sub-confirm-btn" class="btn btn-primary" style="flex:2;">交代を実行</button>
    </div>
  `;

  let selectedType = 'PH';

  body.querySelectorAll('.sub-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.sub-type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedType = btn.dataset.type;
    });
  });

  body.querySelector('#sub-cancel-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  body.querySelector('#sub-confirm-btn').addEventListener('click', () => {
    const newName = body.querySelector('#sub-new-name').value.trim();
    if (!newName) {
      alert('選手名を入力してください');
      return;
    }

    const newNumber = body.querySelector('#sub-new-number').value.trim();
    const newPosition = body.querySelector('#sub-new-position').value;

    const sub = {
      type: selectedType,
      teamKey,
      inning: currentGame.currentInning,
      batterIdx,
      oldPlayer: {
        name: player.name,
        number: player.number,
        position: player.position,
      },
      newPlayer: {
        name: newName,
        number: newNumber,
        position: newPosition || player.position,
      },
    };

    currentGame.addSubstitution(sub);
    saveGame(currentGame);
    modal.classList.add('hidden');
    updateScoresheet();
  });

  document.getElementById('close-sub-modal').onclick = () => {
    modal.classList.add('hidden');
  };

  modal.classList.remove('hidden');
  body.querySelector('#sub-new-name').focus();
}

// ============================================
// Game Settings Edit Modal
// ============================================

function openGameSettings() {
  const modal = document.getElementById('game-settings-modal');

  // Populate current values
  document.getElementById('edit-game-date').value = currentGame.date || '';
  document.getElementById('edit-team-first').value = currentGame.teamFirst || '';
  document.getElementById('edit-team-second').value = currentGame.teamSecond || '';
  document.getElementById('edit-game-field').value = currentGame.field || '';
  document.getElementById('edit-start-time').value = currentGame.startTime || '';
  document.getElementById('edit-end-time').value = currentGame.endTime || '';

  document.getElementById('close-settings-modal').onclick = () => {
    modal.classList.add('hidden');
  };

  document.getElementById('settings-save-btn').onclick = () => {
    currentGame.date = document.getElementById('edit-game-date').value;
    currentGame.teamFirst = document.getElementById('edit-team-first').value.trim();
    currentGame.teamSecond = document.getElementById('edit-team-second').value.trim();
    currentGame.field = document.getElementById('edit-game-field').value.trim();
    currentGame.startTime = document.getElementById('edit-start-time').value || '';
    currentGame.endTime = document.getElementById('edit-end-time').value || '';

    saveGame(currentGame);
    modal.classList.add('hidden');
    updateScoresheet();
  };

  modal.classList.remove('hidden');
}
