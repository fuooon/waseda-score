// ============================================
// Scoresheet - main score recording view
// ============================================
//
// Everything on this page is derived from the recorded cells through
// scoring.js: runs, outs, runners, the next batter, totals and the checks.
// The only other state kept in the game is the viewing cursor
// (game.currentInning / currentHalf): ◀ ▶ move it and it never changes a record.
//
// Columns: one per (inning, lap). Lap 1+ columns ("3②") appear when the team
// batted around in that inning (or the next batter is due a second time).
// A placed tiebreak runner ('tb' + batterIdx) is drawn in his own row in the
// inning's first column; when that row also has a plate appearance there (the
// slot came up again in the same inning) the runner is shown as a small "TB"
// badge inside the cell, which opens the runner's own cell when tapped.

import './styles/sheet.css';
import { saveGame } from './data.js';
import { POSITION_SHORT, MAX_INNINGS, INNINGS_OPTIONS } from './rules.js';
import {
  halfInning, liveState, scoreboard, playerLine, validateGame, keyFor, parseKey,
  inningLabel, batterLabel, ensureTiebreakRunners, gameEndState, lineupSize,
} from './scoring.js';
import { renderCellHTML } from './cell-render.js';
import { describeCell, describeHalfInning, baseName } from './describe.js';
import * as scoreInput from './score-input.js';
import * as teamMembers from './team-members.js';
import { renderScoreboard } from './scoreboard.js';
import { escapeHtml, showToast } from './util.js';

let currentGame = null;
let listenersBound = false;
let extraColumnsUntil = 0; // inning columns added with ＋ (view only, not saved)
let checksExpanded = false;
let lastIssues = [];
let pendingOpenTimer = null;

const TEAM_KEYS = ['first', 'second'];
const LAP_MARKS = ['', '②', '③', '④', '⑤', '⑥'];
const SUB_TYPES = {
  PH: { label: '代打', short: '打', icon: '🏏' },
  PR: { label: '代走', short: '走', icon: '🏃' },
  DEF: { label: '守備', short: '守', icon: '🧤' },
};
const END_REASON_LABELS = { regulation: '', walkoff: 'サヨナラ', called: 'コールドゲーム', time: '時間切れ' };
const SEVERITY = {
  error: { label: 'エラー', rank: 3 },
  warning: { label: '注意', rank: 2 },
  info: { label: '確認', rank: 1 },
};
// Bases of the placed runners: [runner of slot leadoff-1, runner of slot leadoff-2].
const TIEBREAK_BASES = { '1B2B': [1, 2], '1B': [1], '2B': [2] };
const BASE_SHORT = { 1: '一', 2: '二', 3: '三' };
const FLASH_MS = 1800;

// ============================================
// Small helpers
// ============================================

const halfOf = teamKey => (teamKey === 'second' ? 'bottom' : 'top');
const teamOf = half => (half === 'bottom' ? 'second' : 'first');
const halfIndex = (inning, teamKey) => (inning - 1) * 2 + (teamKey === 'second' ? 1 : 0);
const fromHalfIndex = i => ({ inning: Math.floor(i / 2) + 1, teamKey: i % 2 ? 'second' : 'first' });

function el(id) {
  return document.getElementById(id);
}

function lineupOf(teamKey) {
  const lineup = teamKey === 'second' ? currentGame.lineupSecond : currentGame.lineupFirst;
  return Array.isArray(lineup) ? lineup : [];
}

function teamName(teamKey) {
  const name = teamKey === 'second' ? currentGame.teamSecond : currentGame.teamFirst;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || (teamKey === 'second' ? '後攻チーム' : '先攻チーム');
}

function viewCursor() {
  const inning = Math.min(MAX_INNINGS, Math.max(1, Math.trunc(Number(currentGame.currentInning)) || 1));
  return { inning, teamKey: teamOf(currentGame.currentHalf) };
}

function isSameHalf(a, b) {
  return !!a && !!b && a.inning === b.inning && a.teamKey === b.teamKey;
}

function persist() {
  try {
    saveGame(currentGame);
  } catch {
    showToast('保存できませんでした。端末の空き容量を確認してください。', 'error', 5000);
  }
}

function setCursor(inning, teamKey) {
  currentGame.currentInning = inning;
  currentGame.currentHalf = halfOf(teamKey);
  persist();
}

// Places tiebreak runners when the half-inning is a tiebreak half (idempotent).
function ensureTiebreakFor(inning, teamKey) {
  let changed = false;
  try {
    changed = ensureTiebreakRunners(currentGame, teamKey, inning);
  } catch {
    changed = false;
  }
  if (changed) persist();
  return changed;
}

function cellAt(teamKey, inning, key) {
  const half = currentGame.atBats?.[teamKey]?.[inning];
  return half && Object.prototype.hasOwnProperty.call(half, String(key)) ? half[String(key)] : null;
}

function issueKey(teamKey, inning, key) {
  return `${teamKey}|${inning}|${key}`;
}

function worse(a, b) {
  return (SEVERITY[a]?.rank || 0) >= (SEVERITY[b]?.rank || 0) ? a : b;
}

function resultLine(sb, live) {
  const f = sb.first.R;
  const s = sb.second.R;
  const outcome = live.winner ? `${teamName(live.winner)}の勝ち` : '引き分け';
  const reason = END_REASON_LABELS[live.endReason] || '';
  return `${teamName('first')} ${f} - ${s} ${teamName('second')}（${outcome}${reason ? '・' + reason : ''}）`;
}

// ============================================
// View model (computed once per render)
// ============================================

function computeView() {
  const game = currentGame;
  const sb = scoreboard(game);
  const live = liveState(game);
  const cursor = viewCursor();
  const columns = Math.min(MAX_INNINGS, Math.max(sb.maxInning, live.inning, cursor.inning, extraColumnsUntil));
  return { sb, live, cursor, columns, issues: validateGame(game) };
}

// Last half-inning the cursor may move to.
function cursorLimitIndex(view) {
  const maxInning = view.live.gameOver ? view.sb.maxInning : view.columns;
  return Math.max(
    halfIndex(maxInning, 'second'),
    halfIndex(view.live.inning, view.live.teamKey),
    halfIndex(view.cursor.inning, view.cursor.teamKey),
  );
}

function issueMarks(issues) {
  const cells = new Map();
  const halves = new Map();
  for (const issue of issues) {
    if (issue.severity !== 'error' && issue.severity !== 'warning') continue;
    const hk = `${issue.teamKey}|${issue.inning}`;
    halves.set(hk, worse(issue.severity, halves.get(hk)));
    if (issue.key !== null && issue.key !== undefined) {
      const ck = issueKey(issue.teamKey, issue.inning, issue.key);
      cells.set(ck, worse(issue.severity, cells.get(ck)));
    }
  }
  return { cells, halves };
}

// ============================================
// Public API
// ============================================

export function initScoresheet(game) {
  if (!game) return;
  if (game !== currentGame) {
    extraColumnsUntil = 0;
    checksExpanded = false;
  }
  currentGame = game;
  bindListenersOnce();

  const cursor = viewCursor();
  currentGame.currentInning = cursor.inning;
  currentGame.currentHalf = halfOf(cursor.teamKey);
  ensureTiebreakFor(cursor.inning, cursor.teamKey);
  const live = liveState(currentGame);
  if (!live.gameOver) ensureTiebreakFor(live.inning, live.teamKey);

  updateScoresheet();
  window.scrollTo(0, 0);
  requestAnimationFrame(() => scrollToCursor('auto', false));
}

export function updateScoresheet() {
  if (!currentGame) return;
  const view = computeView();
  lastIssues = view.issues;
  renderNav(view);
  renderScoreboard(el('score-summary'), currentGame);
  renderStatusBar(view);
  renderChecksPanel(view);
  renderTables(view);
}

// ============================================
// Listeners (bound once)
// ============================================

function bindListenersOnce() {
  if (listenersBound) return;
  listenersBound = true;

  el('prev-inning-btn')?.addEventListener('click', () => moveCursor(-1));
  el('next-inning-btn')?.addEventListener('click', () => moveCursor(1));
  el('add-inning-btn')?.addEventListener('click', addInning);
  el('game-settings-btn')?.addEventListener('click', openGameSettings);

  el('scoresheet-container')?.addEventListener('click', handleSheetClick);
  el('game-status-bar')?.addEventListener('click', handleStatusClick);
  el('checks-panel')?.addEventListener('click', handleChecksClick);
  el('score-summary')?.addEventListener('click', handleScoreboardClick);

  for (const [modalId, closeId] of [['substitution-modal', 'close-sub-modal'], ['game-settings-modal', 'close-settings-modal']]) {
    const modal = el(modalId);
    el(closeId)?.addEventListener('click', () => closeModal(modalId));
    modal?.addEventListener('click', e => {
      if (e.target === modal) closeModal(modalId);
    });
  }
  document.addEventListener('click', e => {
    // composedPath: the tapped node may already be replaced by a re-render
    if (checksExpanded && !e.composedPath().includes(el('checks-panel'))) {
      checksExpanded = false;
      renderChecksPanel({ issues: lastIssues });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (checksExpanded) {
      checksExpanded = false;
      renderChecksPanel({ issues: lastIssues });
    }
    for (const id of ['substitution-modal', 'game-settings-modal']) {
      if (el(id) && !el(id).classList.contains('hidden')) closeModal(id);
    }
  });
}

function openModal(id) {
  el(id)?.classList.remove('hidden');
}

function closeModal(id) {
  el(id)?.classList.add('hidden');
}

function handleSheetClick(e) {
  if (!currentGame) return;
  const badge = e.target.closest('.tb-badge');
  if (badge) {
    e.stopPropagation();
    const td = badge.closest('td');
    openCell(td.dataset.team, Number(td.dataset.inning), badge.dataset.key);
    return;
  }
  const player = e.target.closest('.sub-btn, td.player-cell[data-batter]');
  if (player) {
    openSubstitutionModal(player.dataset.team, Number(player.dataset.batter));
    return;
  }
  const footer = e.target.closest('.inning-footer');
  if (footer) {
    showHalfSummary(footer.dataset.team, Number(footer.dataset.inning));
    return;
  }
  const td = e.target.closest('td.score-cell');
  if (td) handleCellTap(td.dataset.team, Number(td.dataset.inning), td.dataset.key);
}

function handleStatusClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || !currentGame) return;
  if (btn.dataset.action === 'open-next') {
    openCell(btn.dataset.team, Number(btn.dataset.inning), btn.dataset.key);
  } else if (btn.dataset.action === 'goto-live') {
    const live = liveState(currentGame);
    goToHalf(live.inning, live.teamKey);
  }
}

function handleChecksClick(e) {
  if (!currentGame) return;
  const item = e.target.closest('.check-item');
  if (item) {
    const issue = lastIssues[Number(item.dataset.idx)];
    checksExpanded = false;
    renderChecksPanel({ issues: lastIssues });
    if (issue) goToIssue(issue);
    return;
  }
  if (e.target.closest('[data-action="toggle-checks"]')) {
    if (!lastIssues.length) {
      showToast('記録どうしの矛盾は見つかっていません。', 'success');
      return;
    }
    checksExpanded = !checksExpanded;
    renderChecksPanel({ issues: lastIssues });
  }
}

function handleScoreboardClick(e) {
  const td = e.target.closest('td.sb-cell[data-team]');
  if (!td || !currentGame) return;
  const inning = Number(td.dataset.inning);
  const teamKey = td.dataset.team;
  const view = computeView();
  if (halfIndex(inning, teamKey) > cursorLimitIndex(view)) return;
  goToHalf(inning, teamKey);
}

// ============================================
// Cursor (◀ ▶ ＋)
// ============================================

function goToHalf(inning, teamKey) {
  setCursor(inning, teamKey);
  ensureTiebreakFor(inning, teamKey);
  updateScoresheet();
  scrollToCursor();
}

function moveCursor(delta) {
  if (!currentGame) return;
  const view = computeView();
  const current = halfIndex(view.cursor.inning, view.cursor.teamKey);
  const next = Math.min(cursorLimitIndex(view), Math.max(0, current + delta));
  if (next === current) {
    if (delta < 0) showToast('これより前の回はありません。', 'info');
    else if (view.live.gameOver) showToast('試合は終了しています。', 'info');
    else showToast('これより先の回はまだありません。延長は＋で回を追加できます。', 'info');
    return;
  }
  const { inning, teamKey } = fromHalfIndex(next);
  goToHalf(inning, teamKey);
}

function addInning() {
  if (!currentGame) return;
  const view = computeView();
  if (view.columns >= MAX_INNINGS) {
    showToast(`回は${MAX_INNINGS}回までです。`, 'warning');
    return;
  }
  extraColumnsUntil = view.columns + 1;
  updateScoresheet();
  showToast(`${extraColumnsUntil}回の列を追加しました。`, 'info');
  const head = el('scoresheet-container')?.querySelector(`th.inning-head[data-inning="${extraColumnsUntil}"]`);
  if (head) revealInWrapper(head);
}

function renderNav(view) {
  const label = el('current-inning-label');
  if (label) {
    label.textContent = inningLabel(view.cursor.inning, view.cursor.teamKey);
    label.classList.toggle('is-live', isSameHalf(view.cursor, view.live) && !view.live.gameOver);
  }
  const index = halfIndex(view.cursor.inning, view.cursor.teamKey);
  el('prev-inning-btn')?.classList.toggle('at-limit', index <= 0);
  el('next-inning-btn')?.classList.toggle('at-limit', index >= cursorLimitIndex(view));
  el('add-inning-btn')?.classList.toggle('at-limit', view.columns >= MAX_INNINGS);
}

// ============================================
// Status bar (#game-status-bar)
// ============================================

function renderStatusBar(view) {
  const bar = el('game-status-bar');
  if (!bar) return;
  const game = currentGame;
  const { cursor, live, sb } = view;
  const half = halfInning(game, cursor.teamKey, cursor.inning);
  const isLive = isSameHalf(cursor, live);
  const afterEnd = live.gameOver && halfIndex(cursor.inning, cursor.teamKey) > halfIndex(live.inning, live.teamKey);

  let html = '';
  if (live.gameOver) {
    html += '<div class="status-final" role="status"><span class="status-final-title">試合終了</span>' +
      `<span class="status-final-result">${escapeHtml(resultLine(sb, live))}</span></div>`;
  }

  // Row 1: which half-inning is shown, and the outs
  const outs = Math.max(0, half.outs);
  const dots = '●'.repeat(Math.min(outs, 3)) + '○'.repeat(Math.max(0, 3 - outs));
  const tag = live.gameOver ? '' : isLive ? '<span class="status-tag status-tag-live">攻撃中</span>'
    : '<span class="status-tag">表示中</span>';
  html += '<div class="status-row status-row-head">' +
    `<span class="status-inning">${escapeHtml(inningLabel(cursor.inning, cursor.teamKey))}</span>${tag}` +
    `<span class="status-team">${escapeHtml(teamName(cursor.teamKey))}の攻撃</span>` +
    `<span class="status-outs" aria-label="${outs}アウト"><span class="out-dots" aria-hidden="true">${dots}</span>` +
    `<span class="out-label">${outs}アウト</span></span></div>`;

  // Row 2: runners (diamond + names) and the next batter / what happened
  const runners = half.runners || [];
  const occupied = new Set(runners.map(r => r.base));
  const leftOnBase = half.complete && runners.length > 0;
  const runnerText = runners.length
    ? runners.map(r => `<span class="status-runner"><b>${escapeHtml(baseName(r.base))}</b> ` +
      `${escapeHtml(batterLabel(game, cursor.teamKey, r.batterIdx))}${r.isPlaced ? '<small>（置き）</small>' : ''}</span>`).join('')
    : '<span class="status-runner status-runner-none">ランナーなし</span>';

  let action = '';
  if (afterEnd) {
    action = '<span class="status-note">試合は終わっているので、この回の記録はいりません。</span>';
  } else if (half.skipped) {
    action = `<span class="status-note">後攻チームがリードしているので、${cursor.inning}回裏の攻撃はありません（X）。</span>`;
  } else if (half.nextBatter && (isLive || (!half.complete && !live.gameOver))) {
    const nb = half.nextBatter;
    const lapText = nb.lap > 0 ? `<small>（${nb.lap + 1}打席目）</small>` : '';
    action = `<button type="button" class="status-next" data-action="open-next" data-team="${cursor.teamKey}" ` +
      `data-inning="${cursor.inning}" data-key="${escapeHtml(nb.key)}" aria-label="次の打者 ${escapeHtml(batterLabel(game, cursor.teamKey, nb.batterIdx))}。タップで入力">` +
      `<span class="status-next-label">次:</span><b>${escapeHtml(batterLabel(game, cursor.teamKey, nb.batterIdx))}</b>${lapText}` +
      '<span class="status-next-go" aria-hidden="true">›</span></button>';
  } else if (half.outs >= 3) {
    action = '<span class="status-note">3アウトでチェンジ</span>';
  } else if (live.gameOver && isLive) {
    action = '<span class="status-note">この回で試合終了</span>';
  } else if (half.complete && half.started) {
    action = `<span class="status-note">この回は終わっていますが、アウトが${outs}つしか記録されていません。</span>`;
  }
  html += '<div class="status-row status-row-main">' +
    `<span class="mini-diamond" role="img" aria-label="${runners.length ? runners.map(r => baseName(r.base)).join('・') + 'に走者' : 'ランナーなし'}">` +
    [2, 3, 1].map(b => `<span class="mini-base mb${b}${occupied.has(b) ? ' on' : ''}"></span>`).join('') +
    '<span class="mini-home"></span></span>' +
    `<div class="status-runners">${leftOnBase ? '<span class="status-runner-head">残塁</span>' : ''}${runnerText}</div>` +
    `<div class="status-action">${action}</div></div>`;

  // Row 3 (only when needed): back to the current half-inning, tiebreak notice
  let extra = '';
  if (!live.gameOver && !isLive) {
    extra += `<button type="button" class="status-goto" data-action="goto-live">いまの攻撃（${escapeHtml(inningLabel(live.inning, live.teamKey))}）に戻る ›</button>`;
  }
  if (half.isTiebreak && !half.skipped && !afterEnd) {
    extra += half.placed
      ? `<span class="status-tiebreak">タイブレーク：ノーアウト・置きランナー${half.placed}人から</span>`
      : '<span class="status-tiebreak">タイブレークの回：前の回が終わると置きランナーが自動で入ります</span>';
  }
  if (extra) html += `<div class="status-row status-row-extra">${extra}</div>`;

  bar.innerHTML = html;
}

// ============================================
// Checks panel (#checks-panel)
// ============================================

// Badge: "✓ 記録チェックOK" or "記録チェック ⚠ 3件（エラー1・注意2）"; the list
// opens as a dropdown over the sheet.
function renderChecksPanel(view) {
  const panel = el('checks-panel');
  if (!panel) return;
  const issues = view.issues || [];
  if (!issues.length) {
    checksExpanded = false;
    panel.innerHTML = '<button type="button" class="checks-badge checks-ok" data-action="toggle-checks">' +
      '<span class="checks-icon checks-lead" aria-hidden="true">✓</span><span class="checks-title">記録チェック</span>' +
      '<span class="checks-value"><span class="checks-icon checks-inline" aria-hidden="true">✓</span>OK</span></button>';
    return;
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] = (counts[issue.severity] || 0) + 1;
  const level = counts.error ? 'error' : counts.warning ? 'warning' : 'info';
  const breakdown = ['error', 'warning', 'info']
    .filter(s => counts[s])
    .map(s => `${SEVERITY[s].label}${counts[s]}`)
    .join('・');

  let html = `<button type="button" class="checks-badge checks-${level}" data-action="toggle-checks" aria-expanded="${checksExpanded}">` +
    '<span class="checks-title">記録チェック</span>' +
    `<span class="checks-value"><span class="checks-icon" aria-hidden="true">⚠</span> ${issues.length}件` +
    `<span class="checks-chevron" aria-hidden="true">${checksExpanded ? '▴' : '▾'}</span></span>` +
    `<span class="checks-breakdown">（${breakdown}）</span></button>`;
  if (checksExpanded) {
    html += '<div class="checks-dropdown"><p class="checks-dropdown-head">項目をタップすると、そのマスに移動します。</p><ol class="checks-list">';
    issues.forEach((issue, i) => {
      const sev = SEVERITY[issue.severity] ? issue.severity : 'info';
      const hasKey = issue.key !== null && issue.key !== undefined;
      const where = inningLabel(issue.inning, issue.teamKey) +
        (hasKey ? ` ${parseKey(currentGame, issue.teamKey, issue.key).batterIdx + 1}番のマス` : ' の得点欄');
      html += `<li><button type="button" class="check-item sev-${sev}" data-idx="${i}">` +
        `<span class="check-level">${SEVERITY[sev].label}</span>` +
        `<span class="check-msg">${escapeHtml(issue.message)}</span>` +
        `<span class="check-where">${escapeHtml(where)}へ ›</span></button></li>`;
    });
    html += '</ol></div>';
  }
  panel.innerHTML = html;
}

function goToIssue(issue) {
  const container = el('scoresheet-container');
  if (!container) return;
  const hasKey = issue.key !== null && issue.key !== undefined;
  let target = hasKey
    ? container.querySelector(`[data-team="${issue.teamKey}"][data-inning="${issue.inning}"][data-key="${CSS.escape(String(issue.key))}"]`)
    : container.querySelector(`.inning-footer[data-team="${issue.teamKey}"][data-inning="${issue.inning}"]`);
  if (target && target.classList.contains('tb-badge')) target = target.closest('td');
  if (!target) {
    showToast(`${inningLabel(issue.inning, issue.teamKey)}の欄が見つかりませんでした。`, 'warning');
    return;
  }
  revealInWrapper(target);
  if (hasKey) {
    flash([target]);
    clearTimeout(pendingOpenTimer);
    pendingOpenTimer = setTimeout(() => {
      if (cellAt(issue.teamKey, issue.inning, issue.key)) openCell(issue.teamKey, issue.inning, issue.key);
    }, 700);
  } else {
    flash([...container.querySelectorAll(`td[data-team="${issue.teamKey}"][data-inning="${issue.inning}"]`)]);
  }
}

function flash(elements) {
  for (const node of elements) {
    node.classList.remove('cell-flash');
    void node.offsetWidth; // restart the animation
    node.classList.add('cell-flash');
    setTimeout(() => node.classList.remove('cell-flash'), FLASH_MS);
  }
}

// ============================================
// Sheet tables
// ============================================

function renderTables(view) {
  const container = el('scoresheet-container');
  if (!container) return;
  const marks = issueMarks(view.issues);
  container.innerHTML = TEAM_KEYS.map(teamKey => teamTableHTML(teamKey, view, marks)).join('');
}

// Per-inning info for one team: half-inning, cells by key, columns.
function teamInnings(teamKey, view) {
  const game = currentGame;
  const N = lineupSize(game, teamKey);
  const bases = TIEBREAK_BASES[game.tiebreakerRunners] || [];
  const list = [];
  for (let inning = 1; inning <= view.columns; inning++) {
    const half = halfInning(game, teamKey, inning);
    const byKey = new Map();
    let laps = 1;
    let endKey = null;
    for (const e of half.cells) {
      byKey.set(String(e.key), e);
      if (!e.isPlaced) laps = Math.max(laps, e.lap + 1);
      if (e.state === 'OUT' && Number(e.cell.outNumber) === 3) endKey = String(e.key);
    }
    if (half.nextBatter) laps = Math.max(laps, half.nextBatter.lap + 1);
    laps = Math.min(laps, LAP_MARKS.length);
    const startBase = b => {
      const back = (((half.leadoff - b) % N) + N) % N;
      return back >= 1 ? bases[back - 1] : undefined;
    };
    list[inning] = { inning, half, byKey, laps, endKey, startBase };
  }
  return list;
}

function teamTableHTML(teamKey, view, marks) {
  const game = currentGame;
  const lineup = lineupOf(teamKey);
  const N = lineupSize(game, teamKey);
  const innings = teamInnings(teamKey, view);
  const isViewTeam = view.cursor.teamKey === teamKey;
  const live = view.live;
  const subsBySlot = new Map();
  for (const sub of game.substitutions || []) {
    if (!sub || sub.teamKey !== teamKey) continue;
    const b = Number(sub.batterIdx);
    if (!subsBySlot.has(b)) subsBySlot.set(b, []);
    subsBySlot.get(b).push(sub);
  }

  const cols = [];
  for (let inning = 1; inning <= view.columns; inning++) {
    for (let lap = 0; lap < innings[inning].laps; lap++) cols.push({ inning, lap, info: innings[inning] });
  }

  // Header
  let html = `<div class="scoresheet-team" id="scoresheet-${teamKey}">`;
  html += `<div class="team-label team-label-${teamKey}"><span class="team-side">${teamKey === 'first' ? '先攻' : '後攻'}</span>` +
    `<span class="team-name">${escapeHtml(teamName(teamKey))}</span>` +
    `<span class="team-runs">${view.sb[teamKey].R}点</span></div>`;
  html += `<table class="scoresheet-table" data-team="${teamKey}"><thead><tr>`;
  html += '<th class="player-header" scope="col">打順 / 選手</th>';
  for (const c of cols) {
    const active = isViewTeam && c.inning === view.cursor.inning;
    const cls = ['inning-head'];
    if (active) cls.push('active-col');
    if (c.lap) cls.push('lap-head');
    const tb = c.lap === 0 && c.info.half.isTiebreak ? '<span class="tb-mark" title="タイブレーク">TB</span>' : '';
    const title = c.lap ? ` title="${c.inning}回の打者一巡（${c.lap + 1}打席目）"` : '';
    html += `<th class="${cls.join(' ')}" scope="col" data-inning="${c.inning}"${title}>${c.inning}${LAP_MARKS[c.lap]}${tb}</th>`;
  }
  html += '<th class="stat-head" scope="col" title="安打の数">安打</th>' +
    '<th class="stat-head" scope="col" title="打点（還した走者の数）">打点</th>' +
    '<th class="stat-head" scope="col" title="残塁（塁に残ったまま攻撃が終わった数）">残塁</th>';
  html += '</tr></thead><tbody>';

  // Batting-order rows
  const totals = { h: 0, rbi: 0, lob: 0, pa: 0 };
  for (let b = 0; b < N; b++) {
    const player = lineup[b] || {};
    const subs = subsBySlot.get(b) || [];
    const subInnings = new Set(subs.map(s => Number(s.inning)));
    html += `<tr data-batter="${b}">`;
    html += playerCellHTML(teamKey, b, player, subs);
    for (const c of cols) {
      html += scoreCellHTML(teamKey, b, c, { view, marks, isViewTeam, live, subStart: c.lap === 0 && subInnings.has(c.inning) && c.inning > 1 });
    }
    const line = playerLine(game, teamKey, b);
    totals.h += line.h;
    totals.rbi += line.rbi;
    totals.lob += line.lob;
    totals.pa += line.pa;
    const show = v => (line.pa > 0 || line.r > 0 || line.lob > 0 ? String(v) : '');
    html += `<td class="stat-cell">${show(line.h)}</td><td class="stat-cell">${show(line.rbi)}</td><td class="stat-cell">${show(line.lob)}</td>`;
    html += '</tr>';
  }

  // Footer: runs per inning (+ check mark) and the column totals
  html += '<tr class="total-row">';
  html += '<td class="player-cell total-label"><div class="player-name">各回の得点</div>' +
    '<div class="player-detail">タップで回のまとめ</div></td>';
  for (let inning = 1; inning <= view.columns; inning++) {
    const info = innings[inning];
    const runs = view.sb[teamKey].innings[inning - 1];
    const sev = marks.halves.get(`${teamKey}|${inning}`);
    let mark = '';
    if (sev) mark = `<span class="footer-mark footer-${sev}" title="記録チェックに${sev === 'error' ? 'エラー' : '注意'}があります">⚠</span>`;
    else if (info.half.complete && info.half.started && !info.half.skipped) mark = '<span class="footer-mark footer-ok" title="人数の計算が合っています">✓</span>';
    const cls = ['inning-footer'];
    if (isViewTeam && inning === view.cursor.inning) cls.push('active-col');
    if (sev) cls.push(`has-check-${sev}`);
    const text = runs === null || runs === undefined ? '' : String(runs);
    html += `<td class="${cls.join(' ')}" colspan="${info.laps}" data-team="${teamKey}" data-inning="${inning}">` +
      `<span class="footer-runs">${escapeHtml(text)}</span>${mark}</td>`;
  }
  const played = totals.pa > 0 || view.sb[teamKey].R > 0;
  const sum = v => (played ? String(v) : '');
  html += `<td class="stat-cell stat-total">${sum(totals.h)}</td><td class="stat-cell stat-total">${sum(totals.rbi)}</td>` +
    `<td class="stat-cell stat-total">${sum(totals.lob)}</td>`;
  html += '</tr></tbody></table></div>';
  return html;
}

function playerCellHTML(teamKey, b, player, subs) {
  const pos = player.position ? POSITION_SHORT[player.position] || '' : '';
  const number = player.number !== undefined && player.number !== null && String(player.number).trim() !== ''
    ? `#${escapeHtml(player.number)}` : '';
  const name = player.name && String(player.name).trim() ? player.name : '---';
  let subHtml = '';
  if (subs.length) {
    const ordered = subs.map((s, i) => ({ s, i })).sort((x, y) => (Number(x.s.inning) || 0) - (Number(y.s.inning) || 0) || x.i - y.i);
    subHtml = '<div class="player-subs">' + ordered.map(({ s }) => {
      const type = SUB_TYPES[s.type] || SUB_TYPES.DEF;
      const inning = Number(s.inning) ? `<span class="sub-inning">${Number(s.inning)}回</span>` : '';
      const what = s.positionOnly
        ? `<span class="sub-pos-change">${escapeHtml(POSITION_SHORT[s.oldPlayer?.position] || '－')}→${escapeHtml(POSITION_SHORT[s.newPlayer?.position] || '－')}</span>`
        : `<span class="sub-old-name">${escapeHtml(s.oldPlayer?.name || '---')}</span>`;
      return `<div class="player-sub-entry"><span class="sub-type-badge">${type.short}</span>${inning}${what}</div>`;
    }).join('') + '</div>';
  }
  return `<td class="player-cell" data-team="${teamKey}" data-batter="${b}">` +
    '<div class="player-name-row"><div class="player-main">' +
    `<div class="player-name"><span class="player-order">${b + 1}</span>${escapeHtml(name)}</div>` +
    `<div class="player-detail">${number}${number && pos ? ' ' : ''}${escapeHtml(pos)}</div></div>` +
    `<button type="button" class="sub-btn" data-team="${teamKey}" data-batter="${b}" title="選手交代" aria-label="${b + 1}番の選手交代">🔄</button>` +
    `</div>${subHtml}</td>`;
}

function scoreCellHTML(teamKey, b, c, ctx) {
  const game = currentGame;
  const { info } = c;
  const { half } = info;
  const key = keyFor(game, teamKey, b, c.lap);
  const entry = info.byKey.get(key);
  const placed = c.lap === 0 ? info.byKey.get('tb' + b) : null;
  const cls = ['score-cell'];
  let dataKey = key;
  let inner = '';

  if (entry) {
    inner = renderCellHTML(entry.cell);
    if (inner) cls.push('has-result');
  }
  if (placed) {
    const startBase = info.startBase(b);
    if (entry) {
      // Same slot batted again in this inning: the placed runner becomes a badge.
      const where = placed.state === 'SCORED' ? '生還' : placed.state === 'OUT' ? 'アウト'
        : BASE_SHORT[Number(placed.cell.basesReached)] ? BASE_SHORT[Number(placed.cell.basesReached)] + '塁' : '';
      const text = describeCell(placed.cell, { startBase });
      inner += `<span class="tb-badge state-${placed.state.toLowerCase()}" data-key="${escapeHtml(placed.key)}" role="button" ` +
        `title="${escapeHtml(text)}" aria-label="置きランナー：${escapeHtml(text)}">TB ${where}</span>`;
      cls.push('has-tb-badge');
    } else {
      inner = renderCellHTML(placed.cell, { isPlaced: true, startBase });
      cls.push('has-result', 'placed-runner');
      dataKey = placed.key;
    }
  }

  const isActive = ctx.isViewTeam && c.inning === ctx.view.cursor.inning;
  if (isActive) cls.push('active-cell');
  if (c.lap) cls.push('lap-cell');
  if (ctx.subStart) cls.push('sub-start');
  if (info.endKey && [dataKey, key, placed?.key].includes(info.endKey)) cls.push('inning-end');

  let sev = ctx.marks.cells.get(issueKey(teamKey, c.inning, dataKey));
  if (dataKey !== key) sev = worse(sev, ctx.marks.cells.get(issueKey(teamKey, c.inning, key)));
  if (placed && entry) sev = worse(sev, ctx.marks.cells.get(issueKey(teamKey, c.inning, placed.key)));
  if (sev) cls.push(`has-check-${sev}`);

  // Next batter: only where the user is recording (viewing half, or the live half).
  const nb = half.nextBatter;
  const showNext = nb && !entry && nb.key === key && isActive && (!half.complete || isSameHalf(ctx.view.cursor, ctx.live));
  if (showNext) {
    cls.push('next-batter');
    inner += '<span class="next-tag" aria-hidden="true">次</span>';
  }

  const label = `${inningLabel(c.inning, teamKey)}${c.lap ? `（${c.lap + 1}打席目）` : ''} ${batterLabel(game, teamKey, b)}`;
  return `<td class="${cls.join(' ')}" data-team="${teamKey}" data-inning="${c.inning}" data-key="${escapeHtml(dataKey)}"` +
    `${inner ? '' : ` aria-label="${escapeHtml(label)}（未記録）"`}>${inner}</td>`;
}

// ============================================
// Cell tap → input panel
// ============================================

// Warning shown before recording into an empty cell that would break the
// batting order (or lands after the half-inning / the game ended). '' = fine.
function continuityWarning(teamKey, inning, key) {
  const game = currentGame;
  const parsed = parseKey(game, teamKey, key);
  if (parsed.isPlaced) return '';
  const half = halfInning(game, teamKey, inning);
  const live = liveState(game);
  const label = inningLabel(inning, teamKey);
  const who = batterLabel(game, teamKey, parsed.batterIdx);
  const here = halfIndex(inning, teamKey);
  const liveIdx = halfIndex(live.inning, live.teamKey);

  if (live.gameOver && here > liveIdx) {
    return `試合は${inningLabel(live.inning, live.teamKey)}で終わっています。\n${label}の${who}の欄に記録しますか？`;
  }
  if (half.skipped) {
    return `${label}は攻撃のない回です（X）。\n${who}の欄に記録しますか？`;
  }
  if (half.outs >= 3) {
    return `${label}はもう3アウトで終わっています。\n${who}の欄に記録しますか？（次の回の欄ではありませんか？）`;
  }
  if (half.nextBatter && half.nextBatter.key !== String(key)) {
    const nb = half.nextBatter;
    const next = batterLabel(game, teamKey, nb.batterIdx) + (nb.lap > 0 ? `（${nb.lap + 1}打席目）` : '');
    const mine = who + (parsed.lap > 0 ? `（${parsed.lap + 1}打席目）` : '');
    return `次の打者は${next}です。\n${mine}の欄に記録しますか？`;
  }
  if (!live.gameOver && here > liveIdx) {
    return `いまは${inningLabel(live.inning, live.teamKey)}（${teamName(live.teamKey)}の攻撃）の途中です。\n${label}の${who}の欄に記録しますか？`;
  }
  return '';
}

function handleCellTap(teamKey, inning, key) {
  if (!teamKey || !inning || key === undefined) return;
  if (!cellAt(teamKey, inning, key)) {
    const warning = continuityWarning(teamKey, inning, key);
    if (warning && !window.confirm(warning)) return;
  }
  openCell(teamKey, inning, key);
}

function openCell(teamKey, inning, key) {
  const open = scoreInput.openScoreInput;
  if (typeof open !== 'function') {
    showToast('入力画面を開けませんでした。', 'error');
    return;
  }
  clearTimeout(pendingOpenTimer);
  const before = { live: liveState(currentGame), final: gameEndState(currentGame).final };
  open(currentGame, { teamKey, inning, key: String(key) }, {
    onSave: result => afterSave(teamKey, inning, before, result || {}),
  });
}

function afterSave(teamKey, inning, before, result) {
  const game = currentGame;
  persist();
  const live = liveState(game);
  const cursor = viewCursor();
  const edited = { inning, teamKey };
  const wasViewing = isSameHalf(edited, cursor);
  const wasLive = isSameHalf(edited, before.live);
  let moved = false;

  if (live.gameOver && !before.final) {
    setCursor(live.inning, live.teamKey);
    showToast(`試合終了：${resultLine(scoreboard(game), live)}`, 'success', 5000);
    moved = true;
  } else if (result.thirdOut && (wasViewing || wasLive) && !live.gameOver && !isSameHalf(live, edited)) {
    setCursor(live.inning, live.teamKey);
    ensureTiebreakFor(live.inning, live.teamKey);
    showToast(`3アウト チェンジ → ${inningLabel(live.inning, live.teamKey)}`, 'success');
    moved = true;
  } else if (!wasViewing) {
    const half = halfInning(game, teamKey, inning);
    if (!half.complete) {
      setCursor(inning, teamKey);
      moved = true;
    }
  }
  updateScoresheet();
  if (moved) scrollToCursor();
  else revealNextBatter();
}

// ============================================
// Scrolling inside the sheet
// ============================================

// Scrolls the sheet (and the page when the sheet does not scroll itself) so
// that `target` is visible beside the sticky player column and header row.
// opts.alignBlock: an element (the team's sheet) to bring to the top instead,
// when the target is still visible that way. opts.moveWindow: false = never
// scroll the page itself (used when the page is first shown).
function revealInWrapper(target, { behavior = 'smooth', alignBlock = null, moveWindow = true } = {}) {
  const wrapper = el('scoresheet-wrapper');
  if (!wrapper || !target) return;
  const w = wrapper.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const table = target.closest('table');
  const playerHead = table?.querySelector('.player-header');
  const headRow = table?.querySelector('thead');
  const leftInset = target.classList.contains('player-cell') ? 0 : playerHead ? playerHead.getBoundingClientRect().width : 0;
  const topInset = headRow ? headRow.getBoundingClientRect().height : 0;

  let dx = 0;
  if (r.left < w.left + leftInset) dx = r.left - (w.left + leftInset) - 8;
  else if (r.right > w.right) dx = Math.min(r.right - w.right + 8, r.left - (w.left + leftInset) - 8);

  const canScrollY = wrapper.scrollHeight > wrapper.clientHeight + 1;
  let dy = 0;
  if (canScrollY) {
    const alignTop = alignBlock ? alignBlock.getBoundingClientRect().top - w.top - 4 : null;
    if (alignTop !== null && r.bottom - alignTop <= w.bottom - 4) dy = alignTop;
    else if (r.top < w.top + topInset) dy = r.top - (w.top + topInset) - 8;
    else if (r.bottom > w.bottom) dy = r.bottom - w.bottom + 8;
  }
  if (dx || dy) wrapper.scrollBy({ left: dx, top: dy, behavior });

  if (!canScrollY && moveWindow) {
    const header = el('app-header');
    const top = (header ? header.getBoundingClientRect().bottom : 0) + topInset;
    if (r.top < top) window.scrollBy({ top: r.top - top - 8, behavior });
    else if (r.bottom > window.innerHeight) window.scrollBy({ top: r.bottom - window.innerHeight + 8, behavior });
  }
}

function scrollToCursor(behavior = 'smooth', moveWindow = true) {
  const container = el('scoresheet-container');
  if (!container || !currentGame) return;
  const { inning, teamKey } = viewCursor();
  const target = container.querySelector(`td.next-batter[data-team="${teamKey}"]`) ||
    container.querySelector(`td.score-cell.active-cell[data-team="${teamKey}"][data-inning="${inning}"]`);
  if (target) revealInWrapper(target, { behavior, alignBlock: target.closest('.scoresheet-team'), moveWindow });
}

function revealNextBatter() {
  const target = el('scoresheet-container')?.querySelector('td.next-batter');
  if (target) revealInWrapper(target);
}

// ============================================
// Half-inning summary (footer tap)
// ============================================

function showHalfSummary(teamKey, inning) {
  const half = halfInning(currentGame, teamKey, inning);
  const label = inningLabel(inning, teamKey);
  if (half.skipped) {
    showToast(`${label}：後攻チームがリードしているので攻撃はありません（X）。`, 'info', 5000);
    return;
  }
  const text = describeHalfInning(half, lineupOf(teamKey), { detail: true });
  const problems = lastIssues.filter(i => i.teamKey === teamKey && i.inning === inning && i.severity !== 'info').length;
  const extra = problems ? `（記録チェック ⚠ ${problems}件）` : '';
  showToast(`${label}のまとめ　${text || 'まだ記録がありません。'}${extra}`, problems || text.includes('⚠') ? 'warning' : 'info', 7000);
}

// ============================================
// Substitution modal
// ============================================

function playerSnapshot(p = {}) {
  const snap = {
    name: p.name || '',
    number: p.number === undefined || p.number === null ? '' : String(p.number),
    position: p.position || '',
  };
  if (p.memberId) snap.memberId = p.memberId;
  return snap;
}

// Substitutions of one batting slot in playing order (inning, then record order).
function orderedSlotSubs(teamKey, b) {
  return (currentGame.substitutions || [])
    .map((s, i) => ({ s, i }))
    .filter(x => x.s && x.s.teamKey === teamKey && Number(x.s.batterIdx) === b)
    .sort((x, y) => (Number(x.s.inning) || 0) - (Number(y.s.inning) || 0) || x.i - y.i)
    .map(x => x.s);
}

// The player who started in the slot (before any substitution).
function slotStarter(teamKey, b) {
  const subs = orderedSlotSubs(teamKey, b);
  return subs.length ? playerSnapshot(subs[0].oldPlayer) : playerSnapshot(lineupOf(teamKey)[b]);
}

// Replays the slot's substitutions from the starter: rewrites each oldPlayer
// so the history stays a chain, and puts the resulting player in the lineup.
function recomputeSlot(teamKey, b, starter) {
  let cur = playerSnapshot(starter);
  for (const sub of orderedSlotSubs(teamKey, b)) {
    sub.oldPlayer = playerSnapshot(cur);
    const np = sub.newPlayer || {};
    const next = sub.positionOnly
      ? { ...cur }
      : { name: np.name || '', number: np.number === undefined || np.number === null ? '' : String(np.number), position: cur.position };
    if (!sub.positionOnly && np.memberId) next.memberId = np.memberId;
    if (np.position) next.position = np.position;
    if (sub.positionOnly) sub.newPlayer = { ...playerSnapshot(next) };
    cur = next;
  }
  const lineup = lineupOf(teamKey);
  if (!lineup[b]) lineup[b] = { name: '', number: '', position: '', bat: 'right', memberId: '' };
  const entry = lineup[b];
  entry.name = cur.name;
  entry.number = cur.number;
  entry.position = cur.position;
  entry.memberId = cur.memberId || '';
}

function openSubstitutionModal(teamKey, b) {
  if (!currentGame || !Number.isInteger(b)) return;
  renderSubstitutionBody(teamKey, b);
  openModal('substitution-modal');
}

function renderSubstitutionBody(teamKey, b) {
  const game = currentGame;
  const title = el('sub-modal-title');
  const body = el('sub-modal-body');
  if (!body) return;
  const lineup = lineupOf(teamKey);
  const player = lineup[b] || {};
  const view = computeView();
  const defaultInning = view.cursor.inning;
  const subs = orderedSlotSubs(teamKey, b);
  const rawTeamName = String((teamKey === 'second' ? game.teamSecond : game.teamFirst) || '').trim();
  const members = rawTeamName && typeof teamMembers.getMembersByTeamName === 'function'
    ? (teamMembers.getMembersByTeamName(rawTeamName) || []).filter(m => m && m.name)
    : [];
  const inLineup = new Set(lineup.map(p => p && p.name).filter(Boolean));
  const posOptions = Object.keys(POSITION_SHORT).filter(p => p !== 'DH' || game.useDH || player.position === 'DH');

  if (title) title.textContent = `${b + 1}番の選手交代（${teamKey === 'first' ? '先攻' : '後攻'}）`;

  const current = `${escapeHtml(player.name || '---')}${player.number ? ` #${escapeHtml(player.number)}` : ''}` +
    `${player.position ? `（${escapeHtml(POSITION_SHORT[player.position] || player.position)}）` : ''}`;

  let html = `<p class="sub-current">いまの${b + 1}番：<b>${current}</b></p>`;
  html += '<div class="sub-type-selector" role="radiogroup" aria-label="交代の種類">' +
    Object.entries(SUB_TYPES).map(([type, t]) =>
      `<button type="button" class="sub-type-btn${type === 'PH' ? ' selected' : ''}" data-type="${type}" role="radio" aria-checked="${type === 'PH'}">${t.icon} ${t.label}</button>`).join('') +
    '</div>';
  html += '<p class="sub-type-hint" id="sub-type-hint">打席に別の選手が立つときです。</p>';
  html += '<div class="form-row sub-form-row">' +
    `<div class="form-group"><label for="sub-inning">何回から</label><select id="sub-inning">` +
    Array.from({ length: view.columns }, (_, i) => i + 1).map(n =>
      `<option value="${n}"${n === defaultInning ? ' selected' : ''}>${n}回</option>`).join('') +
    '</select></div>' +
    `<div class="form-group"><label for="sub-new-position">守備位置</label><select id="sub-new-position"><option value="">そのまま</option>` +
    posOptions.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(POSITION_SHORT[p])}（${escapeHtml(p)}）</option>`).join('') +
    '</select></div></div>';
  if (members.length) {
    html += '<div class="form-group"><label for="sub-member">登録メンバーから選ぶ</label><select id="sub-member"><option value="">-- 選ぶ --</option>' +
      members.map((m, i) => `<option value="${i}">${escapeHtml(m.name)}${m.number !== '' && m.number !== undefined && m.number !== null ? ` #${escapeHtml(m.number)}` : ''}` +
        `${inLineup.has(m.name) ? '（出場中）' : ''}</option>`).join('') +
      '</select></div>';
  }
  html += '<div class="form-row sub-form-row">' +
    '<div class="form-group sub-name-group"><label for="sub-new-name">新しい選手の名前</label>' +
    '<input type="text" id="sub-new-name" placeholder="名前" autocomplete="off" /></div>' +
    '<div class="form-group sub-number-group"><label for="sub-new-number">背番号</label>' +
    '<input type="text" id="sub-new-number" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="#" autocomplete="off" /></div>' +
    '</div>';
  html += '<div class="sub-actions"><button type="button" id="sub-cancel-btn" class="btn btn-secondary">閉じる</button>' +
    '<button type="button" id="sub-confirm-btn" class="btn btn-primary">交代を記録</button></div>';

  if (subs.length) {
    html += `<div class="sub-history"><h4>${b + 1}番のこれまでの交代</h4><ul>` + subs.map(s => {
      const idx = game.substitutions.indexOf(s);
      const type = SUB_TYPES[s.type] || SUB_TYPES.DEF;
      const what = s.positionOnly
        ? `${escapeHtml(s.newPlayer?.name || s.oldPlayer?.name || '')}：${escapeHtml(POSITION_SHORT[s.oldPlayer?.position] || '－')} → ${escapeHtml(POSITION_SHORT[s.newPlayer?.position] || '－')}`
        : `${escapeHtml(s.oldPlayer?.name || '---')} → <b>${escapeHtml(s.newPlayer?.name || '---')}</b>`;
      return `<li><span class="sub-type-badge">${type.short}</span><span class="sub-hist-text">${Number(s.inning) || '?'}回 ${type.label}：${what}</span>` +
        `<button type="button" class="btn btn-small btn-secondary sub-undo-btn" data-idx="${idx}">取消</button></li>`;
    }).join('') + '</ul></div>';
  }
  body.innerHTML = html;

  let selectedType = 'PH';
  const hint = body.querySelector('#sub-type-hint');
  const nameInput = body.querySelector('#sub-new-name');
  const HINTS = {
    PH: '打席に別の選手が立つときです。',
    PR: '塁にいる選手が別の選手と代わるときです。',
    DEF: '守備の選手が代わるときです。名前を空欄にすると、守備位置の変更だけを記録します。',
  };
  body.querySelectorAll('.sub-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.sub-type-btn').forEach(x => {
        x.classList.toggle('selected', x === btn);
        x.setAttribute('aria-checked', String(x === btn));
      });
      selectedType = btn.dataset.type;
      hint.textContent = HINTS[selectedType];
      nameInput.placeholder = selectedType === 'DEF' ? '名前（守備位置だけなら空欄）' : '名前';
    });
  });

  body.querySelector('#sub-member')?.addEventListener('change', e => {
    const m = members[Number(e.target.value)];
    if (!m) return;
    nameInput.value = m.name || '';
    body.querySelector('#sub-new-number').value = m.number === undefined || m.number === null ? '' : String(m.number);
    if (selectedType === 'DEF' && m.position && body.querySelector(`#sub-new-position option[value="${CSS.escape(String(m.position))}"]`)) {
      body.querySelector('#sub-new-position').value = m.position;
    }
  });

  body.querySelector('#sub-cancel-btn').addEventListener('click', () => closeModal('substitution-modal'));

  body.querySelector('#sub-confirm-btn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    const number = body.querySelector('#sub-new-number').value.trim();
    const position = body.querySelector('#sub-new-position').value;
    const inning = Number(body.querySelector('#sub-inning').value) || defaultInning;
    const memberSel = body.querySelector('#sub-member');
    const member = memberSel && memberSel.value !== '' ? members[Number(memberSel.value)] : null;
    const positionOnly = selectedType === 'DEF' && !name;

    if (!name && selectedType !== 'DEF') {
      showToast('新しい選手の名前を入力してください。', 'warning');
      return;
    }
    if (positionOnly && (!position || position === player.position)) {
      showToast('守備位置を選んでください（名前が空欄のときは守備位置の変更だけを記録します）。', 'warning');
      return;
    }

    const starter = slotStarter(teamKey, b);
    const sub = {
      type: selectedType,
      teamKey,
      inning,
      batterIdx: b,
      oldPlayer: playerSnapshot(player),
      newPlayer: positionOnly
        ? { ...playerSnapshot(player), position }
        : { name, number, position: position || player.position || '' },
    };
    if (positionOnly) sub.positionOnly = true;
    if (!positionOnly && member && member.name === name && member.id) sub.newPlayer.memberId = member.id;
    if (typeof game.addSubstitution === 'function') game.addSubstitution(sub);
    else (game.substitutions = game.substitutions || []).push(sub);
    recomputeSlot(teamKey, b, starter);
    persist();
    closeModal('substitution-modal');
    updateScoresheet();
    const type = SUB_TYPES[selectedType];
    showToast(positionOnly
      ? `${b + 1}番 ${player.name || ''}：守備位置を${POSITION_SHORT[position] || position}に変更（${inning}回から）`
      : `${b + 1}番：${player.name || '---'} → ${name}（${type.label}・${inning}回から）`, 'success');
  });

  body.querySelectorAll('.sub-undo-btn').forEach(btn => {
    btn.addEventListener('click', () => undoSubstitution(teamKey, b, Number(btn.dataset.idx)));
  });
}

function undoSubstitution(teamKey, b, idx) {
  const game = currentGame;
  const sub = game.substitutions?.[idx];
  if (!sub || sub.teamKey !== teamKey || Number(sub.batterIdx) !== b) return;
  const starter = slotStarter(teamKey, b);
  const type = SUB_TYPES[sub.type] || SUB_TYPES.DEF;
  const remaining = orderedSlotSubs(teamKey, b).filter(s => s !== sub);
  // Who plays in the slot after the undo (the player of the last remaining substitution).
  let after = playerSnapshot(starter);
  for (const s of remaining) {
    if (s.positionOnly) after = { ...after, position: s.newPlayer?.position || after.position };
    else after = { ...after, name: s.newPlayer?.name || '', position: s.newPlayer?.position || after.position };
  }
  const message = `${Number(sub.inning) || '?'}回の${type.label}（${sub.positionOnly ? '守備位置の変更' : `${sub.oldPlayer?.name || '---'} → ${sub.newPlayer?.name || '---'}`}）を取り消しますか？\n` +
    `${b + 1}番は ${after.name || '---'} になります。`;
  if (!window.confirm(message)) return;

  game.substitutions.splice(idx, 1);
  recomputeSlot(teamKey, b, starter);
  persist();
  updateScoresheet();
  renderSubstitutionBody(teamKey, b);
  showToast(`交代を取り消しました。${b + 1}番は ${after.name || '---'} です。`, 'success');
}

// ============================================
// Game settings modal
// ============================================

function lastInningWithData() {
  let last = 0;
  for (const teamKey of TEAM_KEYS) {
    for (const [inn, half] of Object.entries(currentGame.atBats?.[teamKey] || {})) {
      if (half && typeof half === 'object' && Object.keys(half).length) last = Math.max(last, Number(inn) || 0);
    }
  }
  return last;
}

function recordedEndText() {
  const g = currentGame;
  // What the records alone say (ignoring a manual "試合終了").
  const probe = { ...g, status: 'in_progress', endReason: '' };
  const end = gameEndState(probe);
  if (!end.final || !end.endAt) {
    return '記録では、試合はまだ続いています。コールドや時間切れで終わったときは「試合終了」にしてください。';
  }
  const sb = scoreboard(probe);
  const outcome = end.winner ? `${teamName(end.winner)}の勝ち` : '引き分け';
  const reason = END_REASON_LABELS[end.endReason] ? `・${END_REASON_LABELS[end.endReason]}` : '';
  return `記録では${inningLabel(end.endAt.inning, end.endAt.teamKey)}で試合が終わっています（${sb.first.R} - ${sb.second.R}・${outcome}${reason}）。`;
}

function openGameSettings() {
  if (!currentGame) return;
  const g = currentGame;
  const body = el('settings-modal-body');
  if (!body) return;
  const lastData = lastInningWithData();
  const innings = Number(g.innings) || 7;
  const inningOptions = [...new Set([...INNINGS_OPTIONS, innings])].sort((a, b) => a - b);
  const tbInning = Number(g.tiebreakerInning) || 0;
  const tbOptions = [...new Set([5, 6, 7, 8, 9, 10, ...(tbInning ? [tbInning] : [])])].sort((a, b) => a - b);
  const tbRunners = ['1B2B', '2B', '1B'].includes(g.tiebreakerRunners) ? g.tiebreakerRunners : '1B2B';
  const status = g.status === 'final' ? 'final' : 'in_progress';
  const attr = v => escapeHtml(v === undefined || v === null ? '' : v);

  body.innerHTML = `
    <form id="settings-form" class="settings-form" novalidate>
      <div class="form-group">
        <label for="set-date">日付</label>
        <input type="date" id="set-date" value="${attr(g.date)}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="set-team-first">先攻チーム</label>
          <input type="text" id="set-team-first" value="${attr(g.teamFirst)}" placeholder="チーム名" autocomplete="off" />
        </div>
        <div class="vs-label">VS</div>
        <div class="form-group">
          <label for="set-team-second">後攻チーム</label>
          <input type="text" id="set-team-second" value="${attr(g.teamSecond)}" placeholder="チーム名" autocomplete="off" />
        </div>
      </div>
      <div class="form-group">
        <label for="set-field">球場</label>
        <input type="text" id="set-field" value="${attr(g.field)}" placeholder="球場名" autocomplete="off" />
      </div>
      <div class="form-row form-row-pair">
        <div class="form-group">
          <label for="set-start">開始時刻</label>
          <input type="time" id="set-start" value="${attr(g.startTime)}" />
        </div>
        <div class="form-group">
          <label for="set-end">終了時刻</label>
          <input type="time" id="set-end" value="${attr(g.endTime)}" />
        </div>
      </div>
      <fieldset class="settings-section">
        <legend>回数とタイブレーク</legend>
        <div class="form-row form-row-pair">
          <div class="form-group">
            <label for="set-innings">何回まで（規定）</label>
            <select id="set-innings">
              ${inningOptions.map(n => `<option value="${n}"${n === innings ? ' selected' : ''}${n < lastData && n !== innings ? ' disabled' : ''}>${n}回</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="set-tb-inning">タイブレーク</label>
            <select id="set-tb-inning">
              <option value="0"${tbInning ? '' : ' selected'}>なし</option>
              ${tbOptions.map(n => `<option value="${n}"${n === tbInning ? ' selected' : ''}>${n}回から</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group" id="set-tb-runners-group">
          <label for="set-tb-runners">タイブレークの置きランナー</label>
          <select id="set-tb-runners">
            <option value="1B2B"${tbRunners === '1B2B' ? ' selected' : ''}>一塁・二塁（前の回の最後の2人）</option>
            <option value="2B"${tbRunners === '2B' ? ' selected' : ''}>二塁だけ</option>
            <option value="1B"${tbRunners === '1B' ? ' selected' : ''}>一塁だけ</option>
          </select>
        </div>
        ${lastData > Math.min(...inningOptions) ? `<p class="settings-hint">記録がある回（${lastData}回）より少ない回数にはできません。</p>` : ''}
      </fieldset>
      <fieldset class="settings-section">
        <legend>試合の状態</legend>
        <div class="form-row form-row-pair">
          <div class="form-group">
            <label for="set-status">状態</label>
            <select id="set-status">
              <option value="in_progress"${status === 'in_progress' ? ' selected' : ''}>試合中</option>
              <option value="final"${status === 'final' ? ' selected' : ''}>試合終了</option>
            </select>
          </div>
          <div class="form-group" id="set-end-reason-group">
            <label for="set-end-reason">終わり方</label>
            <select id="set-end-reason">
              <option value=""${!g.endReason ? ' selected' : ''}>記録から判断</option>
              <option value="regulation"${g.endReason === 'regulation' ? ' selected' : ''}>規定の回まで</option>
              <option value="walkoff"${g.endReason === 'walkoff' ? ' selected' : ''}>サヨナラ</option>
              <option value="called"${g.endReason === 'called' ? ' selected' : ''}>コールドゲーム</option>
              <option value="time"${g.endReason === 'time' ? ' selected' : ''}>時間切れ</option>
            </select>
          </div>
        </div>
        <p class="settings-hint">${escapeHtml(recordedEndText())}</p>
      </fieldset>
      <button type="button" id="set-lineup-btn" class="btn btn-secondary settings-lineup-btn">📝 スタメン（打順・名前・守備）を編集</button>
      <div class="settings-actions">
        <button type="button" id="set-cancel-btn" class="btn btn-secondary">キャンセル</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>`;

  const form = body.querySelector('#settings-form');
  const statusSel = form.querySelector('#set-status');
  const reasonGroup = form.querySelector('#set-end-reason-group');
  const tbSel = form.querySelector('#set-tb-inning');
  const tbRunnersGroup = form.querySelector('#set-tb-runners-group');
  const syncVisibility = () => {
    reasonGroup.classList.toggle('is-disabled', statusSel.value !== 'final');
    form.querySelector('#set-end-reason').disabled = statusSel.value !== 'final';
    tbRunnersGroup.classList.toggle('hidden', tbSel.value === '0');
  };
  syncVisibility();
  statusSel.addEventListener('change', () => {
    syncVisibility();
    const end = form.querySelector('#set-end');
    if (statusSel.value === 'final' && !end.value) {
      const now = new Date();
      end.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
  });
  tbSel.addEventListener('change', syncVisibility);

  form.querySelector('#set-cancel-btn').addEventListener('click', () => closeModal('game-settings-modal'));
  form.querySelector('#set-lineup-btn').addEventListener('click', () => {
    closeModal('game-settings-modal');
    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'lineup-edit' } }));
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    saveSettings(form);
  });

  openModal('game-settings-modal');
}

function saveSettings(form) {
  const g = currentGame;
  const value = id => form.querySelector(id).value;
  g.date = value('#set-date');
  g.teamFirst = value('#set-team-first').trim();
  g.teamSecond = value('#set-team-second').trim();
  g.field = value('#set-field').trim();
  g.startTime = value('#set-start') || '';
  g.endTime = value('#set-end') || '';
  const innings = Number(value('#set-innings'));
  if (Number.isInteger(innings) && innings >= 1 && innings <= MAX_INNINGS) g.innings = innings;
  const tbInning = Number(value('#set-tb-inning')) || 0;
  g.tiebreakerInning = tbInning;
  g.tiebreakerRunners = tbInning ? value('#set-tb-runners') : 'none';
  g.status = value('#set-status') === 'final' ? 'final' : 'in_progress';
  g.endReason = g.status === 'final' ? value('#set-end-reason') : '';

  const live = liveState(g);
  if (!live.gameOver) ensureTiebreakFor(live.inning, live.teamKey);
  persist();
  closeModal('game-settings-modal');
  updateScoresheet();
  showToast('試合設定を保存しました。', 'success');
}
