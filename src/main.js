// ============================================
// Main Entry Point - App Router & Navigation
// ============================================

import './style.css';
import { GameData, loadGame, saveGame, clearGame } from './data.js';
import { initTeamMembers } from './team-members.js';
import { initGameSetup, openGameSetup } from './game-setup.js';
import { initLineup } from './lineup.js';
import { initScoresheet } from './scoresheet.js';
import { initExport } from './export.js';

let currentGame = null;

// ============================================
// Page Navigation
// ============================================

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) {
    page.classList.add('active');
    // Re-trigger animation
    page.style.animation = 'none';
    page.offsetHeight; // reflow
    page.style.animation = '';
  }
  window.scrollTo(0, 0);

  // Show/hide export button
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.style.display = pageId === 'scoresheet' ? '' : 'none';
  }
}

function showScoresheet() {
  showPage('scoresheet');
  initScoresheet(currentGame);
  initExport(currentGame);
}

function showLineup() {
  showPage('lineup');
  initLineup(currentGame, {
    onComplete: (game) => {
      currentGame = game;
      showScoresheet();
    },
    onBack: () => {
      showScoresheet();
    }
  });
}

function showGameSetup() {
  openGameSetup(currentGame);
  showPage('game-setup');
}

// ============================================
// Game Lifecycle
// ============================================

function createBlankGame() {
  const game = new GameData();
  game.date = new Date().toISOString().split('T')[0];
  game.innings = 9;
  for (const key of ['first', 'second']) {
    const lineup = game.getLineup(key);
    while (lineup.length < 9) {
      lineup.push({ name: '', number: '', position: '', bat: 'right', memberId: '' });
    }
  }
  return game;
}

function startNewGame() {
  if (!confirm('現在の試合データを削除して、新しい試合を始めますか？')) return;
  clearGame();
  currentGame = createBlankGame();
  saveGame(currentGame);
  showScoresheet();
}

// ============================================
// Side Menu
// ============================================

function openMenu() {
  document.getElementById('side-menu').classList.remove('hidden');
  document.getElementById('side-menu-overlay').classList.remove('hidden');
}

function closeMenu() {
  document.getElementById('side-menu').classList.add('hidden');
  document.getElementById('side-menu-overlay').classList.add('hidden');
}

// ============================================
// App Initialization
// ============================================

function init() {
  // Menu
  document.getElementById('menu-btn').addEventListener('click', openMenu);
  document.getElementById('close-menu-btn').addEventListener('click', closeMenu);
  document.getElementById('side-menu-overlay').addEventListener('click', closeMenu);

  // Menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      closeMenu();
      if (page === 'new-game') {
        startNewGame();
      } else if (page === 'game-setup') {
        showGameSetup();
      } else if (page === 'lineup') {
        showLineup();
      } else if (page === 'scoresheet') {
        showScoresheet();
      } else {
        showPage(page);
      }
    });
  });

  // Lineup shortcut on the scoresheet header
  document.getElementById('lineup-btn').addEventListener('click', showLineup);

  // Init team members (always available)
  initTeamMembers();

  // Init game setup form (saving returns to the scoresheet)
  initGameSetup((game) => {
    currentGame = game;
    showScoresheet();
  });

  // Load saved game, or start a blank one — the scoresheet is the home screen
  currentGame = loadGame() || createBlankGame();
  saveGame(currentGame);
  showScoresheet();
}

// Start
document.addEventListener('DOMContentLoaded', init);
