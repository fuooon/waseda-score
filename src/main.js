// ============================================
// Main Entry Point - App Router & Navigation
// ============================================

import './style.css';
import { loadGame, saveGame, clearGame } from './data.js';
import { initTeamMembers } from './team-members.js';
import { initGameSetup } from './game-setup.js';
import { initLineup } from './lineup.js';
import { initScoresheet, updateScoresheet } from './scoresheet.js';
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

  // Show/hide export button
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.style.display = pageId === 'scoresheet' ? '' : 'none';
  }
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
      if (page === 'game-setup') {
        // Start new game
        clearGame();
        currentGame = null;
        showPage('game-setup');
      } else {
        showPage(page);
      }
    });
  });

  // Init team members (always available)
  initTeamMembers();

  // Init game setup
  initGameSetup((game) => {
    currentGame = game;
    showPage('lineup');
    initLineup(game, {
      onComplete: (game) => {
        currentGame = game;
        showPage('scoresheet');
        initScoresheet(game);
        initExport(game);
      },
      onBack: () => {
        showPage('game-setup');
      }
    });
  });

  // Try to resume existing game
  const savedGame = loadGame();
  if (savedGame && savedGame.lineupFirst && savedGame.lineupFirst.length > 0 &&
      savedGame.lineupFirst.some(p => p.name)) {
    currentGame = savedGame;

    // Check if we have lineup data to go straight to scoresheet
    if (savedGame.lineupSecond && savedGame.lineupSecond.some(p => p.name)) {
      showPage('scoresheet');
      initScoresheet(currentGame);
      initExport(currentGame);
    } else {
      showPage('game-setup');
    }
  } else {
    showPage('game-setup');
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
