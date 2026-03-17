// ============================================
// Game Setup
// ============================================

import { GameData, saveGame, loadTeams } from './data.js';

let onComplete = null;
let teams = [];

export function initGameSetup(callback) {
  onComplete = callback;
  teams = loadTeams();

  // Populate presets
  renderPresets();

  // Set today's date
  const dateInput = document.getElementById('game-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

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

  const game = new GameData();
  game.date = document.getElementById('game-date').value;
  game.teamFirst = document.getElementById('team-first').value.trim();
  game.teamSecond = document.getElementById('team-second').value.trim();
  game.field = document.getElementById('game-field').value.trim();
  game.innings = parseInt(document.getElementById('game-innings').value, 10);
  game.useDH = document.getElementById('game-dh').checked;
  game.startTime = document.getElementById('game-start-time').value || '';
  game.endTime = document.getElementById('game-end-time').value || '';

  const tbCheck = document.getElementById('game-tiebreaker');
  if (tbCheck.checked) {
    game.tiebreakerInning = parseInt(document.getElementById('tiebreaker-inning').value, 10);
    game.tiebreakerRunners = document.getElementById('tiebreaker-runners').value;
  }

  saveGame(game);
  if (onComplete) onComplete(game);
}
