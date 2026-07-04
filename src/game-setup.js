// ============================================
// Game Setup - edits the current game's info
// ============================================

import { saveGame, loadTeams } from './data.js';

let onSaved = null;
let currentGame = null;
let teams = [];

export function initGameSetup(callback) {
  onSaved = callback;

  // Tiebreaker toggle
  const tbCheck = document.getElementById('game-tiebreaker');
  const tbOptions = document.getElementById('tiebreaker-options');
  if (tbCheck && tbOptions) {
    tbCheck.addEventListener('change', () => {
      tbOptions.classList.toggle('hidden', !tbCheck.checked);
    });
  }

  // Handle preset change
  document.getElementById('team-first-preset')?.addEventListener('change', (e) => {
    const nameInput = document.getElementById('team-first');
    if (e.target.value) {
      const team = teams.find(t => t.id === e.target.value);
      if (team && nameInput) nameInput.value = team.name;
    }
  });
  document.getElementById('team-second-preset')?.addEventListener('change', (e) => {
    const nameInput = document.getElementById('team-second');
    if (e.target.value) {
      const team = teams.find(t => t.id === e.target.value);
      if (team && nameInput) nameInput.value = team.name;
    }
  });

  document.getElementById('game-setup-form').addEventListener('submit', handleSubmit);
}

// Called every time the page is shown, so the form reflects the current game
export function openGameSetup(game) {
  currentGame = game;
  teams = loadTeams();
  renderPresets();
  populateForm(game);
}

function populateForm(game) {
  document.getElementById('game-date').value = game.date || new Date().toISOString().split('T')[0];
  document.getElementById('team-first').value = game.teamFirst || '';
  document.getElementById('team-second').value = game.teamSecond || '';
  document.getElementById('game-field').value = game.field || '';
  document.getElementById('game-start-time').value = game.startTime || '';
  document.getElementById('game-dh').checked = !!game.useDH;

  const tbCheck = document.getElementById('game-tiebreaker');
  const tbOptions = document.getElementById('tiebreaker-options');
  tbCheck.checked = game.tiebreakerInning > 0;
  tbOptions.classList.toggle('hidden', !tbCheck.checked);
  if (game.tiebreakerInning > 0) {
    document.getElementById('tiebreaker-inning').value = String(game.tiebreakerInning);
    document.getElementById('tiebreaker-runners').value = game.tiebreakerRunners || 'none';
  }
}

function renderPresets() {
  const selects = document.querySelectorAll('.team-preset-select');
  selects.forEach(sel => {
    sel.innerHTML = '<option value="">-- プリセットを選択 --</option>' +
      teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function handleSubmit(e) {
  e.preventDefault();
  if (!currentGame) return;

  const game = currentGame;
  game.date = document.getElementById('game-date').value;
  game.teamFirst = document.getElementById('team-first').value.trim();
  game.teamSecond = document.getElementById('team-second').value.trim();
  game.field = document.getElementById('game-field').value.trim();
  game.useDH = document.getElementById('game-dh').checked;
  game.startTime = document.getElementById('game-start-time').value || '';

  const tbCheck = document.getElementById('game-tiebreaker');
  if (tbCheck.checked) {
    game.tiebreakerInning = parseInt(document.getElementById('tiebreaker-inning').value, 10);
    game.tiebreakerRunners = document.getElementById('tiebreaker-runners').value;
  } else {
    game.tiebreakerInning = 0;
    game.tiebreakerRunners = 'none';
  }

  // Keep lineup slot count in sync when DH is switched on
  const numBatters = game.useDH ? 10 : 9;
  for (const key of ['first', 'second']) {
    const lineup = game.getLineup(key);
    while (lineup.length < numBatters) {
      lineup.push({ name: '', number: '', position: '', bat: 'right', memberId: '' });
    }
  }

  saveGame(game);
  if (onSaved) onSaved(game);
}
