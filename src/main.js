// ============================================
// Main Entry Point - App Router & Navigation
// ============================================
//
// Pages: game-setup → lineup → scoresheet are the main flow. help,
// team-members and history (and the lineup page in edit mode) are "sub pages":
// they remember where the user came from, and ← 戻る / the phone's back button
// return there. Nothing here deletes a game without asking: 🏟️ 新しい試合
// asks first and moves the current game to 過去の試合.
//
// Every init* function binds its listeners once; calling it again only swaps
// the game reference and re-renders.

import './style.css';
import './styles/flow.css';
import { loadGame, saveGame, clearGame } from './data.js';
import { initTeamMembers, refreshTeams, closeTeamMemberModals } from './team-members.js';
import { initGameSetup, showGameSetup, refreshPresets } from './game-setup.js';
import { initLineup, lineupCanLeave, getLineupMode, refreshLineup } from './lineup.js';
import { initScoresheet } from './scoresheet.js';
import { initExport } from './export.js';
import { renderHelp } from './help.js';
import {
  archiveGame, loadHistoryGame, initHistoryPage, renderHistoryList, gameHasData, isWorthArchiving,
  gameHasRecords, matchLabel,
} from './history.js';
import { showToast, formatDateJa } from './util.js';

const GAME_STORAGE_KEY = 'waseda-score-current-game';

const SUB_PAGES = new Set(['help', 'team-members', 'history']);

let currentGame = null;
let currentPage = null;
let pageStack = []; // pages to go back to from sub pages (bottom = a main page)
let historyEntryPushed = false; // a browser-history entry stands for the open sub page
let ignorePops = 0;

const el = id => document.getElementById(id);

// ============================================
// Page Navigation
// ============================================

function isSubPage(page) {
  return SUB_PAGES.has(page) || (page === 'lineup' && getLineupMode() === 'edit');
}

// A double tap on a button that changes the page would land its second tap on
// whatever the new page has at the same spot (e.g. 記録開始 → a score cell):
// the new page ignores taps for a moment.
const TAP_GUARD_MS = 400;
let tapGuardTimer = null;

function guardAgainstGhostTaps(page) {
  page.classList.add('page-entering');
  clearTimeout(tapGuardTimer);
  tapGuardTimer = setTimeout(() => page.classList.remove('page-entering'), TAP_GUARD_MS);
}

function showPage(pageId) {
  const page = el(`page-${pageId}`);
  if (!page) return;
  currentPage = pageId;
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p === page);
    if (p !== page) p.classList.remove('page-entering');
  });
  guardAgainstGhostTaps(page);
  if (pageId !== 'team-members') closeTeamMemberModals(); // never left open behind another page
  // Re-trigger the fade-in animation
  page.style.animation = 'none';
  void page.offsetHeight;
  page.style.animation = '';

  const exportBtn = el('export-btn');
  if (exportBtn) exportBtn.style.display = pageId === 'scoresheet' ? '' : 'none';
  document.body.dataset.page = pageId;

  window.scrollTo(0, 0);
  syncBrowserHistory();
}

// Forward navigation. Sub pages remember the page below them; a main page
// clears the stack.
function goTo(pageId) {
  if (pageId === currentPage) {
    showPage(pageId);
    return;
  }
  if (isSubPage(pageId)) {
    const i = pageStack.indexOf(pageId);
    if (i >= 0) pageStack.length = i; // already below us: go back to it instead of looping
    else if (currentPage) pageStack.push(currentPage);
  } else {
    pageStack = [];
  }
  showPage(pageId);
}

function fallbackPage() {
  if (!currentGame) return 'game-setup';
  return currentGame.lineupDone ? 'scoresheet' : 'lineup';
}

// ← 戻る on a sub page (also the phone's back button).
function goBack() {
  if (currentPage === 'lineup' && getLineupMode() === 'edit' && !lineupCanLeave()) {
    syncBrowserHistory();
    return;
  }
  let target = pageStack.pop() || fallbackPage();
  if (target === 'scoresheet' && !currentGame?.lineupDone) target = fallbackPage();
  if (target === 'lineup' && !currentGame) target = 'game-setup';
  if (target === 'scoresheet') {
    enterScoresheet();
  } else if (target === 'lineup' && getLineupMode() === 'edit' && !isSubPageBelow('scoresheet')) {
    openLineupDraft(); // the edit session is over; show the normal lineup page
  } else {
    // The forms keep what was typed; registered teams / players may have changed.
    if (target === 'game-setup') refreshPresets();
    if (target === 'lineup') refreshLineup();
    showPage(target);
  }
}

function isSubPageBelow(page) {
  return pageStack.includes(page);
}

// The phone's back button closes a sub page instead of leaving the app.
function syncBrowserHistory() {
  const wantEntry = pageStack.length > 0 && isSubPage(currentPage);
  if (wantEntry && !historyEntryPushed) {
    history.pushState({ wasedaSubPage: true }, '');
    historyEntryPushed = true;
  } else if (!wantEntry && historyEntryPushed) {
    historyEntryPushed = false;
    ignorePops++;
    history.back();
  }
}

function handlePopState() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  if (!historyEntryPushed) return;
  historyEntryPushed = false;
  // The phone's back button closes an open dialog first and stays on the page.
  if (closeTeamMemberModals()) {
    syncBrowserHistory();
    return;
  }
  goBack();
}

// ============================================
// Game flow
// ============================================

function enterScoresheet() {
  if (!currentGame) {
    showGameSetup();
    goTo('game-setup');
    return;
  }
  pageStack = [];
  showPage('scoresheet'); // visible first so the sheet can measure and scroll
  initScoresheet(currentGame);
  initExport(currentGame);
}

// Asks the browser not to clear our storage on its own (Safari clears sites
// that were not used for a while). Asked when a game starts rather than on the
// first visit, because some browsers (Firefox) show a permission prompt.
function requestPersistentStorage() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    // not available
  }
}

const lineupCallbacks = {
  onComplete: (game) => {
    currentGame = game;
    enterScoresheet();
    requestPersistentStorage();
  },
  onBack: (game) => {
    currentGame = game;
    showGameSetup({ game });
    goTo('game-setup');
  },
  onEditDone: (game) => {
    currentGame = game;
    showToast('スタメンを保存しました', 'success', 2000);
    enterScoresheet();
  },
  onEditCancel: () => goBack(),
};

function openLineupDraft() {
  if (!currentGame) return;
  initLineup(currentGame, lineupCallbacks, { mode: 'new' });
  pageStack = [];
  showPage('lineup');
}

function openLineupEdit() {
  if (!currentGame) return;
  if (!currentGame.lineupDone) {
    openLineupDraft();
    return;
  }
  const from = currentPage;
  initLineup(currentGame, lineupCallbacks, { mode: 'edit' });
  // lineup is a sub page now (edit mode): remember where we came from
  if (from && from !== 'lineup') pageStack = [...pageStack.filter(p => p !== from), from];
  if (!pageStack.length) pageStack = ['scoresheet'];
  showPage('lineup');
}

// Goes back to the game in progress (or its unfinished lineup).
function resumeCurrentGame() {
  if (!currentGame) {
    goTo('game-setup');
    return;
  }
  if (currentGame.lineupDone) enterScoresheet();
  else if (currentPage === 'lineup' && getLineupMode() === 'new') showPage('lineup');
  else openLineupDraft();
}

// Archives the current game (when it has anything worth keeping).
// Returns false when the user chose to stop.
function archiveCurrentGame() {
  if (!currentGame || !isWorthArchiving(currentGame)) return true;
  const result = archiveGame(currentGame);
  if (!result.ok) {
    return confirm('いまの試合を「過去の試合」に保存できませんでした。\n保存しないまま続けますか？（いまの試合の記録は消えます）');
  }
  if (result.dropped.length) {
    const old = result.dropped[0];
    showToast(`いまの試合を「過去の試合」に保存しました（いちばん古い ${old.date ? formatDateJa(old.date) + ' の' : ''}試合は上限30試合を超えたので消えました）`, 'info', 5000);
  } else {
    showToast('いまの試合を「過去の試合」に保存しました', 'success', 3000);
  }
  return true;
}

function startNewGame() {
  if (!leaveLineupEditGuard()) return;
  if (currentGame && gameHasData(currentGame)) {
    const keep = isWorthArchiving(currentGame);
    const message = keep
      ? `いまの試合（${matchLabel(currentGame)}）を終えて、新しい試合を始めますか？\n\nいまの試合は「📚 過去の試合」に保存されるので、あとで開けます。`
      : '入力中の試合情報を消して、新しい試合を始めますか？';
    if (!confirm(message)) return;
    if (!archiveCurrentGame()) return;
  }
  // Confirmed above (or nothing was entered): the old game is in the history now.
  clearGame();
  currentGame = null;
  showGameSetup({ game: null });
  goTo('game-setup');
}

function openHistoryGame(id) {
  if (!leaveLineupEditGuard()) return;
  if (currentGame && id === currentGame.id) {
    resumeCurrentGame();
    return;
  }
  const game = loadHistoryGame(id);
  if (!game) {
    showToast('この試合を読み込めませんでした', 'error', 4000);
    renderHistoryList();
    return;
  }
  if (currentGame && gameHasData(currentGame)) {
    const message = `${matchLabel(game)} の試合を開きます。\nいま記録中の試合（${matchLabel(currentGame)}）は「過去の試合」に保存します。よろしいですか？`;
    if (!confirm(message)) return;
    if (!archiveCurrentGame()) return;
  }
  currentGame = game;
  saveGame(currentGame);
  if (currentGame.lineupDone || gameHasRecords(currentGame)) {
    currentGame.lineupDone = true;
    enterScoresheet();
  } else {
    openLineupDraft();
  }
  showToast(`${matchLabel(game)} の試合を開きました`, 'success', 2500);
}

function openHelp() {
  renderHelp(el('help-content'));
  goTo('help');
}

function openHistory() {
  renderHistoryList();
  goTo('history');
}

function openTeamMembers() {
  initTeamMembers();
  goTo('team-members');
}

// Leaving the lineup editor to a main page asks before discarding edits (also
// when the editor is below the current sub page, e.g. help opened from it).
function leaveLineupEditGuard() {
  const editorOpen = currentPage === 'lineup' || pageStack.includes('lineup');
  if (editorOpen && getLineupMode() === 'edit') return lineupCanLeave();
  return true;
}

function navigate(page) {
  switch (page) {
    case 'scoresheet':
      if (!leaveLineupEditGuard()) return;
      resumeCurrentGame();
      break;
    case 'lineup-edit':
      openLineupEdit();
      break;
    case 'lineup':
      resumeCurrentGame();
      break;
    case 'help':
      openHelp();
      break;
    case 'team-members':
      openTeamMembers();
      break;
    case 'history':
      openHistory();
      break;
    case 'game-setup':
    case 'new-game':
      startNewGame();
      break;
    default:
      break;
  }
}

// ============================================
// Side Menu
// ============================================

function openMenu() {
  updateMenu();
  el('side-menu').classList.remove('hidden');
  el('side-menu-overlay').classList.remove('hidden');
}

function closeMenu() {
  el('side-menu').classList.add('hidden');
  el('side-menu-overlay').classList.add('hidden');
}

function updateMenu() {
  const resume = el('menu-resume-item');
  if (resume) {
    resume.classList.toggle('hidden', !currentGame);
    const btn = resume.querySelector('.menu-item');
    if (btn) btn.textContent = currentGame && !currentGame.lineupDone ? '📝 スタメン入力に戻る' : '📋 スコアシートに戻る';
  }
  document.querySelectorAll('.menu-item').forEach(item => {
    const page = item.dataset.page;
    const active = (page === 'scoresheet' && (currentPage === 'scoresheet' || (currentPage === 'lineup' && getLineupMode() === 'new')))
      || page === currentPage;
    item.classList.toggle('current', active);
  });
}

// ============================================
// Data restored from a backup
// ============================================

function handleDataImported(e) {
  refreshTeams();
  refreshPresets();
  if (e?.detail?.currentGame) {
    // The backup replaced the current game. The pages below this one (setup
    // form, lineup draft or lineup edit) still show the old game and would
    // save it over the restored one: give every module the restored game and
    // make ← 戻る open it.
    currentGame = loadGame();
    pageStack = [];
    showGameSetup({ game: currentGame });
    if (currentGame?.lineupDone) {
      initScoresheet(currentGame);
      initExport(currentGame);
    } else if (currentGame) {
      initLineup(currentGame, lineupCallbacks, { mode: 'new' });
    }
  }
  renderHistoryList();
  updateMenu();
}

// ============================================
// App Initialization
// ============================================

function bindAppEvents() {
  el('menu-btn').addEventListener('click', openMenu);
  el('close-menu-btn').addEventListener('click', closeMenu);
  el('side-menu-overlay').addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('side-menu').classList.contains('hidden')) closeMenu();
  });

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      closeMenu();
      navigate(item.dataset.page);
    });
  });

  for (const id of ['help-back-btn', 'members-back-btn', 'history-back-btn']) {
    el(id)?.addEventListener('click', goBack);
  }

  document.addEventListener('app:navigate', (e) => navigate(e.detail?.page));
  // The same game open in two tabs would overwrite each other's records.
  window.addEventListener('storage', (e) => {
    if (e.key === GAME_STORAGE_KEY && currentGame) {
      showToast('別のタブ（ウィンドウ）でこの試合が変更されました。記録が上書きされないよう、どちらか一方だけで記録してください。', 'warning', 8000);
    }
  });
  document.addEventListener('app:data-imported', handleDataImported);
  window.addEventListener('popstate', handlePopState);
}

function init() {
  bindAppEvents();
  initTeamMembers();
  initGameSetup((game) => {
    // The form saved a new game over the current one: keep the old one in the
    // history (normally it was archived already by 🏟️ 新しい試合).
    if (currentGame && currentGame !== game && currentGame.id !== game.id) archiveCurrentGame();
    currentGame = game;
    openLineupDraft();
  });
  initHistoryPage({
    onOpen: openHistoryGame,
    currentGameId: () => currentGame?.id || null,
    currentGame: () => currentGame,
  });

  // Resume where the user left off.
  const saved = loadGame();
  if (saved && (saved.lineupDone || gameHasRecords(saved))) {
    currentGame = saved;
    if (!currentGame.lineupDone) {
      currentGame.lineupDone = true; // records exist: the game has started
      saveGame(currentGame);
    }
    enterScoresheet();
  } else if (saved) {
    // Lineup not finished: back to the lineup page with what was entered.
    currentGame = saved;
    showGameSetup({ game: saved });
    openLineupDraft();
  } else {
    showGameSetup({ game: null });
    showPage('game-setup');
  }
}

// Start
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
