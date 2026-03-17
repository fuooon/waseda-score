// ============================================
// Game Setup
// ============================================

import { GameData, saveGame } from './data.js';

let onComplete = null;

export function initGameSetup(callback) {
  onComplete = callback;

  // Set today's date
  const dateInput = document.getElementById('game-date');
  dateInput.value = new Date().toISOString().split('T')[0];

  // Tiebreaker toggle
  const tbCheck = document.getElementById('game-tiebreaker');
  const tbOptions = document.getElementById('tiebreaker-options');
  tbCheck.addEventListener('change', () => {
    tbOptions.classList.toggle('hidden', !tbCheck.checked);
  });

  document.getElementById('game-setup-form').addEventListener('submit', handleSubmit);
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
