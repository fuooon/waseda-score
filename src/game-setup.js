// ============================================
// Game Setup (new game only)
// ============================================
//
// The form creates a new game, or updates the draft game when the user comes
// back from the lineup page with ← 戻る (the lineups already entered are kept).
// Settings of a game that has started are edited in the scoresheet's ⚙️ modal.

import { GameData, saveGame } from './data.js';
import { DEFAULT_INNINGS, INNINGS_OPTIONS, MAX_INNINGS } from './rules.js';
import { escapeHtml, localDateString } from './util.js';
import { getTeams, findTeamByName, getTeamById, normalizeTeamName } from './team-members.js';

const TEAM_SIDES = [
  { key: 'first', input: 'team-first', preset: 'team-first-preset', idField: 'teamFirstId', nameField: 'teamFirst' },
  { key: 'second', input: 'team-second', preset: 'team-second-preset', idField: 'teamSecondId', nameField: 'teamSecond' },
];
const TIEBREAK_INNING_OPTIONS = [4, 5, 6, 7, 8, 9, 10];
const TIEBREAK_RUNNER_VALUES = ['1B2B', '2B', '1B'];

let onSubmit = null;
let listenersBound = false;
let draftGame = null; // game being edited (not started yet); null = a new game
let tiebreakInningTouched = false;

const el = id => document.getElementById(id);

// ============================================
// Public API
// ============================================

// callback(game) is called after the form is submitted and the game saved.
export function initGameSetup(callback) {
  onSubmit = callback;
  if (listenersBound) return;
  listenersBound = true;
  fillStaticOptions();
  bindEvents();
  resetForm();
}

// Prepares the form each time the page is shown.
//   game: the draft game to edit (coming back from the lineup page), or null for a new game
export function showGameSetup({ game = null } = {}) {
  draftGame = game && !game.lineupDone ? game : null;
  if (draftGame) fillForm(draftGame);
  else resetForm();
  renderPresets();
  updateSubmitLabel();
}

// Re-renders the team presets, keeping what is selected (teams changed elsewhere).
export function refreshPresets() {
  renderPresets();
}

// ============================================
// Form
// ============================================

function fillStaticOptions() {
  const innings = el('game-innings');
  if (innings) {
    innings.innerHTML = INNINGS_OPTIONS.map(n =>
      `<option value="${n}"${n === DEFAULT_INNINGS ? ' selected' : ''}>${n}回</option>`).join('');
  }
  const tbInning = el('tiebreaker-inning');
  if (tbInning) {
    tbInning.innerHTML = TIEBREAK_INNING_OPTIONS.map(n => `<option value="${n}">${n}回から</option>`).join('');
  }
}

function bindEvents() {
  el('game-setup-form')?.addEventListener('submit', handleSubmit);

  el('game-tiebreaker')?.addEventListener('change', syncTiebreakVisibility);
  el('tiebreaker-inning')?.addEventListener('change', () => { tiebreakInningTouched = true; });
  el('game-innings')?.addEventListener('change', () => {
    if (!tiebreakInningTouched) setTiebreakInning(defaultTiebreakInning());
  });

  for (const side of TEAM_SIDES) {
    // Choosing a preset fills the name; typing a name selects the matching preset.
    el(side.preset)?.addEventListener('change', (e) => {
      const team = getTeamById(e.target.value);
      if (team) el(side.input).value = team.name;
    });
    el(side.input)?.addEventListener('input', () => syncPresetToName(side));
  }
}

function inningsValue() {
  const n = parseInt(el('game-innings')?.value, 10);
  return Number.isInteger(n) && n >= 1 && n <= MAX_INNINGS ? n : DEFAULT_INNINGS;
}

// Extra innings start right after the regulation innings (most youth rules).
function defaultTiebreakInning() {
  return Math.min(Math.max(inningsValue() + 1, TIEBREAK_INNING_OPTIONS[0]), TIEBREAK_INNING_OPTIONS[TIEBREAK_INNING_OPTIONS.length - 1]);
}

function setTiebreakInning(n) {
  const select = el('tiebreaker-inning');
  if (!select) return;
  if (![...select.options].some(o => Number(o.value) === n)) {
    select.insertAdjacentHTML('beforeend', `<option value="${n}">${n}回から</option>`);
  }
  select.value = String(n);
}

function setInnings(n) {
  const select = el('game-innings');
  if (!select) return;
  if (![...select.options].some(o => Number(o.value) === n)) {
    const options = [...new Set([...INNINGS_OPTIONS, n])].sort((a, b) => a - b);
    select.innerHTML = options.map(v => `<option value="${v}">${v}回</option>`).join('');
  }
  select.value = String(n);
}

function syncTiebreakVisibility() {
  el('tiebreaker-options')?.classList.toggle('hidden', !el('game-tiebreaker')?.checked);
}

function resetForm() {
  el('game-setup-form')?.reset();
  el('game-date').value = localDateString();
  for (const side of TEAM_SIDES) el(side.input).value = '';
  el('game-field').value = '';
  el('game-start-time').value = '';
  el('game-end-time').value = '';
  setInnings(DEFAULT_INNINGS);
  el('game-dh').checked = false;
  el('game-tiebreaker').checked = false;
  tiebreakInningTouched = false;
  setTiebreakInning(defaultTiebreakInning());
  el('tiebreaker-runners').value = '1B2B';
  syncTiebreakVisibility();
}

function fillForm(game) {
  el('game-date').value = game.date || '';
  for (const side of TEAM_SIDES) el(side.input).value = game[side.nameField] || '';
  el('game-field').value = game.field || '';
  el('game-start-time').value = game.startTime || '';
  el('game-end-time').value = game.endTime || '';
  setInnings(Number(game.innings) || DEFAULT_INNINGS);
  el('game-dh').checked = !!game.useDH;
  const tbInning = Number(game.tiebreakerInning) || 0;
  el('game-tiebreaker').checked = tbInning > 0;
  tiebreakInningTouched = tbInning > 0;
  setTiebreakInning(tbInning > 0 ? tbInning : defaultTiebreakInning());
  el('tiebreaker-runners').value = TIEBREAK_RUNNER_VALUES.includes(game.tiebreakerRunners) ? game.tiebreakerRunners : '1B2B';
  syncTiebreakVisibility();
}

function updateSubmitLabel() {
  const btn = el('game-setup-submit');
  if (btn) btn.textContent = draftGame ? 'スタメン入力に戻る →' : 'スタメン登録へ →';
}

// ============================================
// Team presets (registered teams)
// ============================================

function renderPresets() {
  const teams = getTeams();
  for (const side of TEAM_SIDES) {
    const select = el(side.preset);
    if (!select) continue;
    select.innerHTML = '<option value="">登録チームから選ぶ</option>' +
      teams.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    const input = el(side.input);
    const linked = getTeamById(draftGame?.[side.idField]);
    // The draft's team was renamed in メンバー管理 meanwhile: follow the new name
    // while the field still holds the name saved with the draft (keeps the link
    // to the team's players).
    if (linked && normalizeTeamName(input.value) === normalizeTeamName(draftGame[side.nameField])) {
      input.value = linked.name;
    }
    const team = linked && normalizeTeamName(linked.name) === normalizeTeamName(input.value)
      ? linked
      : findTeamByName(input.value);
    select.value = team ? team.id : '';
    select.classList.toggle('hidden', teams.length === 0);
  }
}

function syncPresetToName(side) {
  const select = el(side.preset);
  if (!select) return;
  const team = findTeamByName(el(side.input).value);
  select.value = team ? team.id : '';
}

// Team id for the typed name: the chosen preset when it still matches, else any team with that name.
function teamIdFor(side, name) {
  const chosen = getTeamById(el(side.preset)?.value);
  if (chosen && normalizeTeamName(chosen.name) === normalizeTeamName(name)) return chosen.id;
  return findTeamByName(name)?.id || '';
}

// ============================================
// Submit
// ============================================

function handleSubmit(e) {
  e.preventDefault();

  // Coming back from the lineup page updates that game: its lineups are kept.
  const game = draftGame || new GameData();
  game.date = el('game-date').value || '';
  for (const side of TEAM_SIDES) {
    const name = el(side.input).value.trim();
    game[side.nameField] = name;
    game[side.idField] = teamIdFor(side, name);
  }
  game.field = el('game-field').value.trim();
  game.innings = inningsValue();
  game.useDH = el('game-dh').checked;
  game.startTime = el('game-start-time').value || '';
  game.endTime = el('game-end-time').value || '';

  if (el('game-tiebreaker').checked) {
    game.tiebreakerInning = parseInt(el('tiebreaker-inning').value, 10) || defaultTiebreakInning();
    const runners = el('tiebreaker-runners').value;
    game.tiebreakerRunners = TIEBREAK_RUNNER_VALUES.includes(runners) ? runners : '1B2B';
  } else {
    game.tiebreakerInning = 0;
    game.tiebreakerRunners = 'none';
  }
  game.lineupDone = false;

  saveGame(game); // on failure a toast is shown; the game still works from memory
  draftGame = game;
  if (onSubmit) onSubmit(game);
}
