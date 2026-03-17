// ============================================
// Lineup Registration
// ============================================

import { POSITIONS, POSITION_SHORT, saveGame } from './data.js';
import { getMembersByTeamName } from './team-members.js';

let currentGame = null;
let currentTeam = 'first';
let onComplete = null;
let onBack = null;

export function initLineup(game, callbacks) {
  currentGame = game;
  onComplete = callbacks.onComplete;
  onBack = callbacks.onBack;

  renderLineup();
  bindEvents();
}

function bindEvents() {
  document.getElementById('lineup-tab-first').addEventListener('click', () => switchTeam('first'));
  document.getElementById('lineup-tab-second').addEventListener('click', () => switchTeam('second'));
  document.getElementById('lineup-start-btn').addEventListener('click', handleStart);
  document.getElementById('lineup-back-btn').addEventListener('click', () => {
    if (onBack) onBack();
  });
}

function switchTeam(team) {
  // Save current team's data before switching
  saveCurrentTeamLineup();
  currentTeam = team;
  document.getElementById('lineup-tab-first').classList.toggle('active', team === 'first');
  document.getElementById('lineup-tab-second').classList.toggle('active', team === 'second');
  renderLineup();
}

function renderLineup() {
  const container = document.getElementById('lineup-form-container');
  const teamName = currentGame.getTeamName(currentTeam);
  const members = getMembersByTeamName(teamName);
  const lineup = currentGame.getLineup(currentTeam);
  const numBatters = currentGame.useDH ? 10 : 9;

  let html = `<div class="form-card"><h3>${escapeHtml(teamName)} - 打順</h3>`;

  for (let i = 0; i < numBatters; i++) {
    const existing = lineup[i] || {};
    const orderLabel = currentGame.useDH && i === 9 ? 'DH' : (i + 1);

    html += `
      <div class="lineup-row">
        <div class="lineup-order">${orderLabel}</div>
        <div class="lineup-player-select">
          ${members.length > 0 ? `
            <select data-idx="${i}" class="lineup-member-select">
              <option value="">-- 選手を選択 --</option>
              ${members.map(m => `
                <option value="${m.id}" ${existing.memberId === m.id ? 'selected' : ''}>
                  ${m.number ? '#' + m.number + ' ' : ''}${escapeHtml(m.name)}
                </option>
              `).join('')}
              <option value="__manual__" ${existing.memberId === '__manual__' ? 'selected' : ''}>✏️ 手入力</option>
            </select>
            <input type="text" class="lineup-manual-input ${existing.memberId === '__manual__' ? '' : 'hidden'}"
              data-idx="${i}" placeholder="選手名" value="${existing.name && existing.memberId === '__manual__' ? escapeHtml(existing.name) : ''}" />
          ` : `
            <input type="text" class="lineup-manual-input" data-idx="${i}" placeholder="選手名"
              value="${existing.name ? escapeHtml(existing.name) : ''}" />
          `}
        </div>
        <div class="lineup-position-select">
          <select data-idx="${i}" class="lineup-pos-select">
            <option value="">守</option>
            ${Object.entries(POSITION_SHORT).map(([num, label]) => `
              <option value="${num}" ${String(existing.position) === String(num) ? 'selected' : ''}>
                ${num}${label}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
    `;
  }

  // Pitcher section
  const pitcherName = currentTeam === 'first' ? currentGame.pitcherFirst : currentGame.pitcherSecond;
  html += `
    <div class="lineup-pitcher-section">
      <h4>⚾ 先発投手</h4>
      <div class="lineup-player-select">
        ${members.length > 0 ? `
          <select id="lineup-pitcher-select-${currentTeam}" class="lineup-pitcher-member-select">
            <option value="">-- 選手を選択 --</option>
            ${members.map(m => `
              <option value="${m.id}">${m.number ? '#' + m.number + ' ' : ''}${escapeHtml(m.name)}</option>
            `).join('')}
            <option value="__manual__">✏️ 手入力</option>
          </select>
          <input type="text" id="lineup-pitcher-manual-${currentTeam}" class="lineup-manual-input hidden"
            placeholder="投手名" value="${pitcherName || ''}" />
        ` : `
          <input type="text" id="lineup-pitcher-manual-${currentTeam}" class="lineup-manual-input"
            placeholder="投手名" value="${pitcherName || ''}" />
        `}
      </div>
    </div>
  `;

  html += '</div>';
  container.innerHTML = html;

  // Bind select change events
  container.querySelectorAll('.lineup-member-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const manualInput = container.querySelector(`.lineup-manual-input[data-idx="${idx}"]`);
      if (e.target.value === '__manual__') {
        manualInput?.classList.remove('hidden');
        manualInput?.focus();
      } else {
        manualInput?.classList.add('hidden');
      }
    });
  });

  const pitcherMemberSelect = container.querySelector('.lineup-pitcher-member-select');
  if (pitcherMemberSelect) {
    pitcherMemberSelect.addEventListener('change', (e) => {
      const manualInput = document.getElementById(`lineup-pitcher-manual-${currentTeam}`);
      if (e.target.value === '__manual__') {
        manualInput?.classList.remove('hidden');
        manualInput?.focus();
      } else {
        manualInput?.classList.add('hidden');
      }
    });
  }
}

function collectLineup(teamKey) {
  const container = document.getElementById('lineup-form-container');
  const teamName = currentGame.getTeamName(teamKey);
  const members = getMembersByTeamName(teamName);
  const numBatters = currentGame.useDH ? 10 : 9;
  const lineup = [];

  for (let i = 0; i < numBatters; i++) {
    const memberSelect = container.querySelector(`.lineup-member-select[data-idx="${i}"]`);
    const manualInput = container.querySelector(`.lineup-manual-input[data-idx="${i}"]`);
    const posSelect = container.querySelector(`.lineup-pos-select[data-idx="${i}"]`);

    let name = '';
    let number = '';
    let bat = 'right';
    let memberId = '';

    if (memberSelect) {
      const selectedValue = memberSelect.value;
      if (selectedValue === '__manual__') {
        name = manualInput?.value?.trim() || '';
        memberId = '__manual__';
      } else if (selectedValue) {
        const member = members.find(m => m.id === selectedValue);
        if (member) {
          name = member.name;
          number = member.number;
          bat = member.bat;
          memberId = member.id;
        }
      }
    } else if (manualInput) {
      name = manualInput.value.trim();
      memberId = '__manual__';
    }

    const position = posSelect?.value || '';

    lineup.push({ name, number, position, bat, memberId });
  }

  return lineup;
}

function collectPitcher(teamKey) {
  const teamName = currentGame.getTeamName(teamKey);
  const members = getMembersByTeamName(teamName);
  const pitcherMemberSelect = document.querySelector('.lineup-pitcher-member-select');
  const pitcherManualInput = document.getElementById(`lineup-pitcher-manual-${teamKey}`);

  if (pitcherMemberSelect) {
    const val = pitcherMemberSelect.value;
    if (val === '__manual__') {
      return pitcherManualInput?.value?.trim() || '';
    } else if (val) {
      const member = members.find(m => m.id === val);
      return member ? member.name : '';
    }
  }
  return pitcherManualInput?.value?.trim() || '';
}

function handleStart() {
  // Save current team's lineup first
  saveCurrentTeamLineup();

  // Ensure both teams have the correct number of slots (even if empty)
  const numBatters = currentGame.useDH ? 10 : 9;
  for (const key of ['first', 'second']) {
    const lineup = currentGame.getLineup(key);
    while (lineup.length < numBatters) {
      lineup.push({ name: '', number: '', position: '', bat: 'right', memberId: '' });
    }
  }

  saveGame(currentGame);
  if (onComplete) onComplete(currentGame);
}

function saveCurrentTeamLineup() {
  const lineup = collectLineup(currentTeam);
  const pitcher = collectPitcher(currentTeam);

  if (currentTeam === 'first') {
    currentGame.lineupFirst = lineup;
    currentGame.pitcherFirst = pitcher;
  } else {
    currentGame.lineupSecond = lineup;
    currentGame.pitcherSecond = pitcher;
  }
}


function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
