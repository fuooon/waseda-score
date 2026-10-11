// ============================================
// Past games (history) and JSON backup
// ============================================
//
// Starting a new game archives the current one here instead of deleting it.
// History is stored as [{ id, savedAt, game }] (game = plain JSON), newest
// first, at most MAX_HISTORY games. The backup file holds the teams, the
// current game and the history, so a parent can move to a new phone or recover
// after the browser cleared its storage.

import {
  Team, loadTeams, saveTeams, teamsFromData, saveGame, loadGame, loadGameData, gameFromData,
  loadHistoryEntries, saveHistoryEntries,
} from './data.js';
import { teamTotals } from './scoring.js';
import { escapeHtml, formatDateJa, localDateString, showToast } from './util.js';

export const MAX_HISTORY = 30;
export const BACKUP_APP = 'waseda-score';
export const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const toPlain = value => JSON.parse(JSON.stringify(value));

// ============================================
// What a game contains
// ============================================

// At least one recorded cell (plate appearance, placed runner, ...).
export function gameHasRecords(game) {
  const atBats = game?.atBats;
  if (!isPlainObject(atBats)) return false;
  return ['first', 'second'].some(teamKey => {
    const team = atBats[teamKey];
    return isPlainObject(team) && Object.values(team).some(half => isPlainObject(half) && Object.keys(half).length > 0);
  });
}

function hasLineupNames(game) {
  return [game?.lineupFirst, game?.lineupSecond].some(lineup =>
    Array.isArray(lineup) && lineup.some(p => p && String(p.name || '').trim()));
}

// Worth keeping in the history: records or entered lineups.
export function isWorthArchiving(game) {
  return !!game && (gameHasRecords(game) || hasLineupNames(game));
}

// Anything the user typed (asks before throwing the game away).
export function gameHasData(game) {
  if (!game) return false;
  return isWorthArchiving(game) || [game.teamFirst, game.teamSecond, game.field]
    .some(v => String(v || '').trim());
}

// "ファイターズ 対 ジャイアンツ" with 先攻 / 後攻 for missing names.
export function matchLabel(game) {
  const first = String(game?.teamFirst || '').trim() || '先攻';
  const second = String(game?.teamSecond || '').trim() || '後攻';
  return `${first} 対 ${second}`;
}

// ============================================
// History storage
// ============================================

function toTime(value) {
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}

function sortAndTrim(entries) {
  const sorted = [...entries].sort((a, b) => toTime(b.savedAt) - toTime(a.savedAt));
  return { kept: sorted.slice(0, MAX_HISTORY), dropped: sorted.slice(MAX_HISTORY) };
}

// One history list item.
export function summarizeEntry(entry) {
  const game = entry?.game || {};
  let scoreFirst = 0;
  let scoreSecond = 0;
  try {
    scoreFirst = teamTotals(game, 'first').runs;
    scoreSecond = teamTotals(game, 'second').runs;
  } catch {
    // unreadable records: show 0 - 0 rather than hiding the game
  }
  return {
    id: entry.id,
    date: typeof game.date === 'string' ? game.date : '',
    teamFirst: typeof game.teamFirst === 'string' ? game.teamFirst : '',
    teamSecond: typeof game.teamSecond === 'string' ? game.teamSecond : '',
    scoreFirst,
    scoreSecond,
    savedAt: toTime(entry.savedAt),
    field: typeof game.field === 'string' ? game.field : '',
    status: game.status === 'final' ? 'final' : 'in_progress',
    hasRecords: gameHasRecords(game),
  };
}

// Puts the game into the history (replacing an older copy with the same id).
// Returns { ok, skipped, dropped: [summaries of games pushed out by the limit] }.
export function archiveGame(game, { now = Date.now() } = {}) {
  if (!isWorthArchiving(game)) return { ok: true, skipped: true, dropped: [] };
  const entry = { id: String(game.id), savedAt: now, game: toPlain(game) };
  const others = loadHistoryEntries().filter(e => e.id !== entry.id);
  const { kept, dropped } = sortAndTrim([entry, ...others]);
  const ok = saveHistoryEntries(kept);
  return { ok, skipped: false, dropped: ok ? dropped.map(summarizeEntry) : [] };
}

// Newest first, at most MAX_HISTORY items:
// [{ id, date, teamFirst, teamSecond, scoreFirst, scoreSecond, savedAt, field, status, hasRecords }]
export function listHistory() {
  return sortAndTrim(loadHistoryEntries()).kept.map(summarizeEntry);
}

// A normalized GameData copy of an archived game, or null.
export function loadHistoryGame(id) {
  const entry = loadHistoryEntries().find(e => e.id === id);
  return entry ? gameFromData(toPlain(entry.game)) : null;
}

export function deleteHistoryGame(id) {
  const entries = loadHistoryEntries();
  const rest = entries.filter(e => e.id !== id);
  if (rest.length === entries.length) return false;
  return saveHistoryEntries(rest);
}

// ============================================
// Backup (JSON file)
// ============================================

export function buildBackup({ now = new Date() } = {}) {
  return {
    app: BACKUP_APP,
    kind: 'backup',
    backupVersion: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    teams: toPlain(loadTeams()),
    currentGame: loadGameData(),
    history: loadHistoryEntries(),
  };
}

// Downloads every stored thing as one JSON file. Returns the Blob.
export function exportAllData() {
  const data = buildBackup();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const filename = `waseda-score-backup-${localDateString()}.json`;
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return blob;
}

function looksLikeGame(value) {
  return isPlainObject(value) && (isPlainObject(value.atBats) || Array.isArray(value.lineupFirst) || Array.isArray(value.lineupSecond));
}

// Reads and checks a backup file's text.
//   → { ok: true, data: { teams, currentGame, history }, summary } | { ok: false, error }
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'ファイルを読み込めませんでした。このアプリで保存したバックアップ（.json）を選んでください。' };
  }
  if (!isPlainObject(raw) || raw.app !== BACKUP_APP) {
    return { ok: false, error: 'このファイルは早稲田式スコアブックのバックアップではないようです。' };
  }
  if (Number(raw.backupVersion) > BACKUP_VERSION) {
    return { ok: false, error: '新しいバージョンのアプリで作られたバックアップです。アプリを最新にしてから読み込んでください。' };
  }

  let skipped = 0;
  const teams = teamsFromData(raw.teams);
  if (Array.isArray(raw.teams)) skipped += raw.teams.length - teams.length;

  const history = [];
  const seen = new Set();
  for (const e of Array.isArray(raw.history) ? raw.history : []) {
    const game = isPlainObject(e) && looksLikeGame(e.game) ? gameFromData(e.game) : null;
    if (!game || seen.has(game.id)) {
      skipped++;
      continue;
    }
    seen.add(game.id);
    history.push({ id: String(game.id), savedAt: toTime(e.savedAt), game: toPlain(game) });
  }

  let currentGame = null;
  if (raw.currentGame !== null && raw.currentGame !== undefined) {
    currentGame = looksLikeGame(raw.currentGame) ? gameFromData(raw.currentGame) : null;
    if (!currentGame) skipped++;
  }

  if (teams.length === 0 && history.length === 0 && !currentGame) {
    return { ok: false, error: 'バックアップの中に読み込めるデータがありませんでした。' };
  }
  return {
    ok: true,
    data: { teams, currentGame, history },
    summary: {
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      teams: teams.length,
      members: teams.reduce((n, t) => n + t.members.length, 0),
      history: history.length,
      currentGame: currentGame ? matchLabel(currentGame) : '',
      skipped,
    },
  };
}

function isUntouchedDefaultTeam(team) {
  return team.name === 'マイチーム' && team.members.length === 0;
}

const nameKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

// Merges a parsed backup into storage. Same team / game ids take the backup's
// version (history: the newer one); teams and games only on this device stay.
// The device's current game is moved to the history when the backup has another one.
export function applyBackup(data, { now = Date.now() } = {}) {
  const result = { teams: 0, history: 0, currentGame: false, ok: true };

  // Teams
  if (data.teams.length) {
    const backupIds = new Set(data.teams.map(t => t.id));
    const backupNames = new Set(data.teams.map(t => nameKey(t.name)));
    const deviceOnly = loadTeams()
      .filter(t => !backupIds.has(t.id) && !isUntouchedDefaultTeam(t))
      .map(t => (backupNames.has(nameKey(t.name)) ? new Team({ ...t, name: `${t.name}（この端末）` }) : t));
    const merged = [...data.teams, ...deviceOnly];
    result.ok = saveTeams(merged) && result.ok;
    result.teams = data.teams.length;
  }

  // History (+ the device's current game when it is replaced)
  const byId = new Map(loadHistoryEntries().map(e => [e.id, e]));
  for (const e of data.history) {
    const existing = byId.get(e.id);
    if (!existing || toTime(e.savedAt) >= toTime(existing.savedAt)) byId.set(e.id, e);
  }
  const deviceGame = data.currentGame ? loadGame() : null;
  if (deviceGame && deviceGame.id !== data.currentGame.id && isWorthArchiving(deviceGame)) {
    byId.set(String(deviceGame.id), { id: String(deviceGame.id), savedAt: now, game: toPlain(deviceGame) });
  }
  if (data.history.length || deviceGame) {
    result.ok = saveHistoryEntries(sortAndTrim([...byId.values()]).kept) && result.ok;
  }
  result.history = data.history.length;

  // Current game
  if (data.currentGame) {
    result.ok = saveGame(data.currentGame) && result.ok;
    result.currentGame = true;
  }
  return result;
}

function backupConfirmText(summary, { replacesDeviceGame = false } = {}) {
  // Only dates written by exportAllData (ISO); Date() guesses at anything else.
  const when = /^\d{4}-\d{2}-\d{2}T/.test(summary.exportedAt) ? new Date(summary.exportedAt) : null;
  const whenText = when && !Number.isNaN(when.getTime())
    ? `（${when.toLocaleDateString('ja-JP')} ${when.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} に保存）` : '';
  const lines = [`バックアップを読み込みます${whenText}。`];
  if (summary.teams) lines.push(`・チーム ${summary.teams}（選手 ${summary.members}人）`);
  if (summary.history) lines.push(`・過去の試合 ${summary.history}試合`);
  if (summary.currentGame) lines.push(`・記録中の試合（${summary.currentGame}）`);
  if (summary.skipped) lines.push(`※ 読めなかったデータが${summary.skipped}件ありました（読み飛ばします）`);
  lines.push('');
  lines.push('同じチーム・同じ試合はバックアップの内容になります。この端末にしかないチームや試合は残ります。');
  if (replacesDeviceGame) lines.push('いま記録中の試合は「過去の試合」に移します。');
  lines.push('読み込みますか？');
  return lines.join('\n');
}

// Reads a backup file chosen by the user, asks, and merges it.
// On success fires 'app:data-imported' so the app reloads its state.
export async function importAllData(file, { confirmFn } = {}) {
  const ask = confirmFn || (msg => window.confirm(msg));
  if (!file) return { ok: false };
  if (file.size > MAX_BACKUP_BYTES) {
    showToast('ファイルが大きすぎます。このアプリのバックアップを選んでください。', 'error', 5000);
    return { ok: false };
  }
  let text;
  try {
    text = await file.text();
  } catch {
    showToast('ファイルを読み込めませんでした。', 'error', 5000);
    return { ok: false };
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) {
    showToast(parsed.error, 'error', 6000);
    return parsed;
  }
  const deviceGame = parsed.data.currentGame ? loadGame() : null;
  const replacesDeviceGame = !!deviceGame && deviceGame.id !== parsed.data.currentGame.id && isWorthArchiving(deviceGame);
  if (!ask(backupConfirmText(parsed.summary, { replacesDeviceGame }))) return { ok: false, cancelled: true };

  const result = applyBackup(parsed.data);
  if (result.ok) {
    showToast('バックアップを読み込みました', 'success');
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('app:data-imported', { detail: result }));
  }
  return result;
}

// ============================================
// History page (#page-history)
// ============================================

let pageBound = false;
let pageCallbacks = {};

//   callbacks: { onOpen(id), currentGameId(), currentGame() }
export function initHistoryPage(callbacks = {}) {
  pageCallbacks = callbacks;
  if (pageBound || typeof document === 'undefined') return;
  pageBound = true;

  document.getElementById('history-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('history-open-btn')) {
      pageCallbacks.onOpen?.(id);
    } else if (btn.classList.contains('history-delete-btn')) {
      const item = listHistory().find(h => h.id === id);
      if (!item) return;
      const label = `${item.date ? formatDateJa(item.date) + ' ' : ''}${matchLabel(item)}`;
      if (!confirm(`「${label}」の記録を削除しますか？\n削除すると元に戻せません。`)) return;
      if (deleteHistoryGame(id)) showToast('削除しました', 'success', 2000);
      renderHistoryList();
    }
  });

  document.getElementById('backup-export-btn')?.addEventListener('click', () => {
    try {
      exportAllData();
      showToast('バックアップのファイルを保存しました（ダウンロードを確認してください）', 'success', 4000);
    } catch {
      showToast('バックアップを作れませんでした', 'error', 5000);
    }
  });

  const fileInput = document.getElementById('backup-file-input');
  document.getElementById('backup-import-btn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // choosing the same file again fires 'change' again
    if (!file) return;
    await importAllData(file);
    renderHistoryList();
  });
}

function savedAtText(time) {
  if (!time) return '';
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function renderHistoryList() {
  const container = typeof document !== 'undefined' ? document.getElementById('history-list') : null;
  if (!container) return;
  const currentId = pageCallbacks.currentGameId?.() || null;
  // The game being recorded is shown as it is now, not as it was archived.
  const live = currentId ? pageCallbacks.currentGame?.() : null;
  const items = listHistory().map(item => (live && item.id === currentId
    ? { ...summarizeEntry({ id: item.id, savedAt: item.savedAt, game: toPlain(live) }), savedAt: item.savedAt }
    : item));

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>まだ保存された試合はありません。<br>「🏟️ 新しい試合」を始めると、それまでの試合がここに入ります。</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const id = escapeHtml(item.id);
    const isCurrent = item.id === currentId;
    const first = String(item.teamFirst || '').trim() || '先攻';
    const second = String(item.teamSecond || '').trim() || '後攻';
    const dateText = (item.date && formatDateJa(item.date)) || '日付なし';
    const status = !item.hasRecords ? 'スタメンのみ' : (item.status === 'final' ? '試合終了' : '途中まで記録');
    return `
      <div class="history-item${isCurrent ? ' is-current' : ''}" data-id="${id}">
        <div class="history-main">
          <div class="history-date">${escapeHtml(dateText)}${item.field ? `<span class="history-field">${escapeHtml(item.field)}</span>` : ''}</div>
          <div class="history-score">
            <span class="history-team">${escapeHtml(first)}</span>
            <span class="history-runs">${item.scoreFirst} - ${item.scoreSecond}</span>
            <span class="history-team">${escapeHtml(second)}</span>
          </div>
          <div class="history-meta">${isCurrent ? '<span class="history-badge">記録中</span>' : ''}${escapeHtml(status)}${item.savedAt ? `・保存 ${escapeHtml(savedAtText(item.savedAt))}` : ''}</div>
        </div>
        <div class="history-actions">
          <button type="button" class="btn btn-primary btn-small history-open-btn" data-id="${id}">${isCurrent ? '戻る' : '開く'}</button>
          ${isCurrent ? '' : `<button type="button" class="btn btn-secondary btn-small history-delete-btn" data-id="${id}" aria-label="${escapeHtml(dateText)}の試合を削除">削除</button>`}
        </div>
      </div>`;
  }).join('');
}
