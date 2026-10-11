// ============================================
// Image Export (html2canvas)
// ============================================
//
// Two images:
//   - フルスコアシート: header + scoreboard + a clone of #scoresheet-container
//   - スコアボードのみ: header + scoreboard
// Every number comes from scoring.js. The sheet clone gets the class
// "exporting" (export.css / sheet.css drop the interactive decorations) and
// the clone itself is cleaned (no ids, no 🔄, no highlight, no check marks).
//
// The PNG blob and the File for Web Share are made when the preview is shown,
// so tapping 共有 calls navigator.share() right away (Safari only allows the
// share sheet while the tap is still being handled).

import html2canvas from 'html2canvas';
import { scoreboard, liveState, inningLabel, validateGame } from './scoring.js';
import { escapeHtml, formatDateJa, parseLocalDate, showToast } from './util.js';
import './styles/export.css';

// ============================================
// Constants
// ============================================

const TEAM_KEYS = ['first', 'second'];
const SIDE_LABELS = { first: '先攻', second: '後攻' };
const END_REASON_LABELS = { regulation: '', walkoff: 'サヨナラ', called: 'コールドゲーム', time: '時間切れ' };
const TIEBREAK_LABELS = { '1B2B': '一・二塁', '1B': '一塁', '2B': '二塁' };
const WEEKDAYS = '日月火水木金土';

const BACKGROUND = '#FFFEF9';
const PREFERRED_SCALE = 2;
// iOS Safari refuses canvases above ~16.7M pixels; stay well below.
const MAX_CANVAS_PIXELS = 14000000;
const MAX_CANVAS_SIDE = 8000;
// The image is laid out as on a wide screen whatever the device (cell sizes,
// font sizes), so a phone and a PC produce the same picture.
const RENDER_WINDOW_WIDTH = 1280;
// The live page lays the node out with phone media queries; leave room for the
// slightly larger desktop layout html2canvas uses.
const SIZE_SAFETY = 1.15;

const BUSY_LABEL = '⏳ 書き出し中…';
const OPTION_BUTTONS = { full: 'export-full-btn', board: 'export-board-btn' };

// Classes of the live sheet that only make sense on screen.
const SCREEN_ONLY_SELECTORS = ['.sub-btn', '.next-tag', '.footer-mark', '.total-label .player-detail'];
const SCREEN_ONLY_CLASSES = ['active-cell', 'active-col', 'next-batter', 'cell-flash', 'is-live', 'selected'];

const MSG = {
  failed: '画像を作れませんでした。もう一度お試しください。',
  tooLarge: '画像が大きすぎて作れませんでした。「スコアボードのみ」をお試しください。',
  noSheet: 'スコアシートがまだ表示されていないため、画像を作れませんでした。',
  shareFailed: '共有できませんでした。「ダウンロード」を使うか、画像を長押しして保存してください。',
  hintShare: '「共有」からLINEやメール、写真アプリに送れます。画像を長押ししても保存できます。',
  hintNoShare: 'この端末では「共有」が使えません。「ダウンロード」を押すか、画像を長押しして保存してください。',
};

// ============================================
// Pure helpers (exported for tests)
// ============================================

export function teamName(game, teamKey) {
  const raw = teamKey === 'second' ? game?.teamSecond : game?.teamFirst;
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name || SIDE_LABELS[teamKey === 'second' ? 'second' : 'first'];
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Characters that are not allowed in file names on Windows / macOS / Android,
// control and invisible direction characters, and any whitespace.
// eslint-disable-next-line no-control-regex
const FILENAME_UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿\s]+/g;

// One part of a file name: unsafe characters → '_', no leading/trailing dots
// or underscores, at most `maxLength` characters; '' → fallback.
export function sanitizeFilename(value, fallback = '', maxLength = 30) {
  let s = String(value ?? '');
  try {
    s = s.normalize('NFC');
  } catch {
    // keep as is
  }
  s = s.replace(FILENAME_UNSAFE, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  s = Array.from(s).slice(0, maxLength).join('').replace(/[_.]+$/, '');
  return s || fallback;
}

// score_2026-10-11_先攻チーム_vs_後攻チーム.png (board image: ..._board.png)
export function exportFilename(game, kind = 'full') {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(game?.date || '') ? game.date : '';
  const first = sanitizeFilename(game?.teamFirst, SIDE_LABELS.first);
  const second = sanitizeFilename(game?.teamSecond, SIDE_LABELS.second);
  const parts = ['score'];
  if (date) parts.push(date);
  parts.push(`${first}_vs_${second}`);
  if (kind === 'board') parts.push('board');
  return `${parts.join('_')}.png`;
}

// '2026/10/11（日）' ('' when the date is missing or invalid)
export function formatGameDate(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return '';
  return `${formatDateJa(dateStr)}（${WEEKDAYS[d.getDay()]}）`;
}

function parseTime(str) {
  const m = /^(\d{1,2}):(\d{2})/.exec(trimmed(str));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? { h, min } : null;
}

function timeText(t) {
  return `${t.h}:${String(t.min).padStart(2, '0')}`;
}

function durationText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

// '9:00〜10:45（1時間45分）', '9:00 開始', '10:45 終了' or ''.
export function formatTimeRange(start, end) {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s && e) {
    const minutes = (e.h * 60 + e.min) - (s.h * 60 + s.min);
    const duration = minutes > 0 && minutes <= 12 * 60 ? `（${durationText(minutes)}）` : '';
    return `${timeText(s)}〜${timeText(e)}${duration}`;
  }
  if (s) return `${timeText(s)} 開始`;
  if (e) return `${timeText(e)} 終了`;
  return '';
}

// Where an unfinished game stands: '3回裏の途中まで' / '3回表まで' / '試合前'.
function progressText(game) {
  const live = liveState(game);
  if (live.halfInning && live.halfInning.started) return `${inningLabel(live.inning, live.teamKey)}の途中まで`;
  const prev = live.teamKey === 'second'
    ? { inning: live.inning, teamKey: 'first' }
    : { inning: live.inning - 1, teamKey: 'second' };
  if (prev.inning < 1) return '試合前';
  return `${inningLabel(prev.inning, prev.teamKey)}まで`;
}

// { final, status: '試合終了'|'途中経過', text } — the result in one plain sentence.
export function resultSummary(game, sb = scoreboard(game)) {
  const R = { first: sb.first.R, second: sb.second.R };
  if (sb.final) {
    const reason = END_REASON_LABELS[sb.endReason] || '';
    if (sb.winner) {
      const loser = sb.winner === 'first' ? 'second' : 'first';
      const detail = [`${R[sb.winner]} - ${R[loser]}`, reason].filter(Boolean).join('・');
      return { final: true, status: '試合終了', text: `${teamName(game, sb.winner)}の勝ち（${detail}）` };
    }
    const detail = [`${R.first} - ${R.second}`, reason].filter(Boolean).join('・');
    return { final: true, status: '試合終了', text: `引き分け（${detail}）` };
  }
  const score = `${teamName(game, 'first')} ${R.first} - ${R.second} ${teamName(game, 'second')}`;
  return { final: false, status: '途中経過', text: `${score}（${progressText(game)}）` };
}

// Title, date / field / time / innings, matchup, result, starting pitchers, tiebreak rule.
export function buildHeaderHTML(game, sb = scoreboard(game)) {
  const result = resultSummary(game, sb);
  const first = teamName(game, 'first');
  const second = teamName(game, 'second');

  const innings = Number(game?.innings);
  const meta = [
    formatGameDate(game?.date),
    trimmed(game?.field),
    formatTimeRange(game?.startTime, game?.endTime),
    Number.isInteger(innings) && innings > 0 ? `${innings}回制` : '',
  ].filter(Boolean);

  let html = '<div class="export-header">';
  html += '<div class="export-title-row"><h2 class="export-title">試合結果</h2>' +
    `<span class="export-status ${result.final ? 'is-final' : 'is-progress'}">${escapeHtml(result.status)}</span></div>`;
  if (meta.length) {
    html += `<p class="export-meta">${meta.map(m => `<span class="export-meta-item">${escapeHtml(m)}</span>`)
      .join('<span class="export-sep">・</span>')}</p>`;
  }
  html += '<p class="export-matchup">' +
    `<span class="export-side">${SIDE_LABELS.first}</span><span class="export-team">${escapeHtml(first)}</span>` +
    '<span class="export-vs">vs</span>' +
    `<span class="export-side">${SIDE_LABELS.second}</span><span class="export-team">${escapeHtml(second)}</span></p>`;
  html += `<p class="export-result${result.final ? ' is-final' : ''}">${escapeHtml(result.text)}</p>`;

  const pitchers = TEAM_KEYS
    .map(teamKey => ({ teamKey, name: trimmed(teamKey === 'first' ? game?.pitcherFirst : game?.pitcherSecond) }))
    .filter(p => p.name);
  if (pitchers.length) {
    html += '<p class="export-sub"><span class="export-label">先発投手</span>' +
      pitchers.map(p => `<span class="export-pitcher">${escapeHtml(teamName(game, p.teamKey))}：${escapeHtml(p.name)}</span>`)
        .join('<span class="export-sep">／</span>') + '</p>';
  }

  const tbInning = Number(game?.tiebreakerInning);
  const tbRunners = TIEBREAK_LABELS[game?.tiebreakerRunners];
  if (Number.isInteger(tbInning) && tbInning > 0 && tbRunners) {
    html += '<p class="export-sub"><span class="export-label">タイブレーク</span>' +
      `${escapeHtml(`${tbInning}回から（ノーアウト・走者${tbRunners}で開始）`)}</p>`;
  }

  html += '</div>';
  return html;
}

function runsText(value) {
  return value === null || value === undefined ? '' : String(value);
}

// Inning-by-inning board: blank = not played, 'X' = bottom half not needed.
export function buildBoardHTML(game, sb = scoreboard(game)) {
  let html = '<table class="export-board"><thead><tr>';
  html += '<th class="eb-team-head" scope="col">チーム</th>';
  for (const n of sb.columns) html += `<th class="eb-inning" scope="col">${escapeHtml(n)}</th>`;
  html += '<th class="eb-total" scope="col">計</th>' +
    '<th class="eb-stat" scope="col">安打</th>' +
    '<th class="eb-stat" scope="col">失策</th>' +
    '<th class="eb-stat" scope="col">残塁</th>';
  html += '</tr></thead><tbody>';
  for (const teamKey of TEAM_KEYS) {
    const line = sb[teamKey];
    const isWinner = !!sb.final && sb.winner === teamKey;
    html += `<tr class="eb-row eb-row-${teamKey}${isWinner ? ' eb-winner' : ''}">`;
    html += `<th class="eb-team" scope="row"><span class="eb-side">${SIDE_LABELS[teamKey]}</span>` +
      `<span class="eb-name">${escapeHtml(teamName(game, teamKey))}</span>` +
      `${isWinner ? '<span class="eb-win">勝</span>' : ''}</th>`;
    sb.columns.forEach((n, i) => {
      const value = line.innings[i];
      const cls = ['eb-cell'];
      if (value === null || value === undefined) cls.push('eb-empty');
      if (value === 'X') cls.push('eb-x');
      html += `<td class="${cls.join(' ')}">${escapeHtml(runsText(value))}</td>`;
    });
    html += `<td class="eb-total">${escapeHtml(line.R)}</td>` +
      `<td class="eb-stat">${escapeHtml(line.H)}</td>` +
      `<td class="eb-stat">${escapeHtml(line.E)}</td>` +
      `<td class="eb-stat">${escapeHtml(line.LOB)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// Plain-language key for a non-expert reading the image.
export function buildBoardNoteHTML(sb) {
  const notes = [];
  const all = TEAM_KEYS.flatMap(t => sb[t].innings);
  if (all.includes('X')) notes.push('X＝後攻がリードしていたため、その回の裏の攻撃はありません');
  if (all.some(v => v === null || v === undefined)) notes.push('空欄＝まだ攻撃していない回');
  notes.push('失策＝そのチームが守備でしたエラーの数');
  return `<p class="export-board-note">${notes.map(escapeHtml).join('　')}</p>`;
}

// Device-pixel scale for html2canvas that keeps the canvas within browser limits.
export function canvasScale(width, height, preferred = PREFERRED_SCALE) {
  if (!(width > 0 && height > 0)) return preferred;
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const bySide = Math.min(MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
  const scale = Math.min(preferred, byArea, bySide);
  return Math.max(0.5, Math.floor(scale * 100) / 100);
}

// ============================================
// State
// ============================================

let currentGame = null;
let bound = false;
let busy = false;
let jobToken = 0; // bumped on close: a job that finishes after that is dropped
let prepared = null; // { kind, filename, blob, file, objectUrl, canShare }
const buttonLabels = new Map();

function el(id) {
  return document.getElementById(id);
}

// ============================================
// Init (idempotent)
// ============================================

export function initExport(game) {
  currentGame = game || null;
  if (bound || typeof document === 'undefined') return;
  bound = true;

  el('export-btn')?.addEventListener('click', openExportModal);
  el('close-export-btn')?.addEventListener('click', closeExportModal);
  el('export-full-btn')?.addEventListener('click', () => runExport('full'));
  el('export-board-btn')?.addEventListener('click', () => runExport('board'));
  el('export-download-btn')?.addEventListener('click', handleDownload);
  el('export-share-btn')?.addEventListener('click', handleShare);

  const modal = el('export-modal');
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeExportModal(); // backdrop tap
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isModalOpen()) closeExportModal();
  });
}

// ============================================
// Modal
// ============================================

function isModalOpen() {
  const modal = el('export-modal');
  return !!modal && !modal.classList.contains('hidden');
}

function openExportModal() {
  if (!currentGame) return;
  resetPreview();
  updateChecksNote();
  el('export-modal')?.classList.remove('hidden');
}

function closeExportModal() {
  jobToken++;
  el('export-modal')?.classList.add('hidden');
  resetPreview();
}

function resetPreview() {
  el('export-preview')?.classList.add('hidden');
  const img = el('export-image');
  if (img) img.removeAttribute('src');
  const share = el('export-share-btn');
  if (share) share.style.display = 'none';
  releasePrepared();
}

function releasePrepared() {
  if (prepared?.objectUrl) {
    const url = prepared.objectUrl;
    // a download started from this URL may still be reading it
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  prepared = null;
}

// "記録チェック" summary at the top of the modal (spec §8: check before exporting).
function updateChecksNote() {
  const modal = el('export-modal');
  const content = modal?.querySelector('.modal-content');
  if (!content) return;
  let note = el('export-checks-note');
  if (!note) {
    note = document.createElement('p');
    note.id = 'export-checks-note';
    const title = content.querySelector('h3');
    if (title) title.insertAdjacentElement('afterend', note);
    else content.prepend(note);
  }
  let count = 0;
  try {
    count = validateGame(currentGame).filter(i => i.severity === 'error' || i.severity === 'warning').length;
  } catch {
    count = 0;
  }
  note.className = `export-checks-note ${count ? 'has-issues' : 'is-ok'}`;
  note.textContent = count
    ? `⚠ 記録チェックで気になる点が${count}件あります。画像にする前に、スコアシートの「記録チェック」で確かめておくと安心です。`
    : '✓ 記録チェックOK：おかしな点はありません。';
}

function setBusy(kind) {
  busy = !!kind;
  el('export-modal')?.querySelector('.modal-content')?.setAttribute('aria-busy', busy ? 'true' : 'false');
  for (const [k, id] of Object.entries(OPTION_BUTTONS)) {
    const btn = el(id);
    if (!btn) continue;
    if (!buttonLabels.has(id)) buttonLabels.set(id, btn.textContent.trim());
    btn.disabled = busy;
    btn.classList.toggle('is-busy', kind === k);
    btn.textContent = kind === k ? BUSY_LABEL : buttonLabels.get(id);
  }
}

// ============================================
// Building the image
// ============================================

class ExportError extends Error {}

function cloneSheet(source) {
  const clone = source.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.add('export-sheet-body');
  clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  clone.querySelectorAll(SCREEN_ONLY_SELECTORS.join(',')).forEach(n => n.remove());
  for (const cls of SCREEN_ONLY_CLASSES) {
    clone.querySelectorAll(`.${cls}`).forEach(n => n.classList.remove(cls));
  }
  clone.querySelectorAll('[class*="has-check-"]').forEach(n => {
    for (const cls of [...n.classList]) if (cls.startsWith('has-check-')) n.classList.remove(cls);
  });
  clone.querySelectorAll('[style*="animation"]').forEach(n => { n.style.animation = 'none'; });
  return clone;
}

function buildExportNode(game, kind) {
  const sb = scoreboard(game);
  const node = document.createElement('div');
  node.className = `export-sheet exporting export-sheet-${kind}`;
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = buildHeaderHTML(game, sb) +
    `<div class="export-board-wrap">${buildBoardHTML(game, sb)}${buildBoardNoteHTML(sb)}</div>`;
  if (kind === 'full') {
    const source = el('scoresheet-container');
    if (!source || !source.querySelector('table')) throw new ExportError(MSG.noSheet);
    node.appendChild(cloneSheet(source));
  }
  return node;
}

function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

async function renderNode(node) {
  document.body.appendChild(node);
  try {
    const scale = canvasScale(node.scrollWidth * SIZE_SAFETY, node.scrollHeight * SIZE_SAFETY);
    return await html2canvas(node, {
      backgroundColor: BACKGROUND,
      scale,
      useCORS: true,
      logging: false,
      windowWidth: Math.max(RENDER_WINDOW_WIDTH, window.innerWidth || 0),
      // the app itself is not needed in html2canvas' copy of the page
      ignoreElements: n => n.id === 'app',
    });
  } finally {
    node.remove();
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new ExportError(MSG.tooLarge));
    if (!canvas || !canvas.width || !canvas.height) {
      fail();
      return;
    }
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(blob => (blob ? resolve(blob) : fail()), 'image/png');
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const bytes = atob(dataUrl.split(',')[1] || '');
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      resolve(new Blob([buf], { type: 'image/png' }));
    } catch {
      fail();
    }
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function makeFile(blob, filename) {
  try {
    return new File([blob], filename, { type: 'image/png', lastModified: Date.now() });
  } catch {
    return null; // very old browsers without the File constructor
  }
}

function fileShareable(file) {
  if (!file || typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

async function runExport(kind) {
  if (busy || !currentGame) return;
  const game = currentGame;
  const token = jobToken;
  setBusy(kind);
  try {
    await nextFrame(); // paint "書き出し中…" before html2canvas takes the main thread
    const node = buildExportNode(game, kind);
    const canvas = await renderNode(node);
    const blob = await canvasToBlob(canvas);
    const dataUrl = await blobToDataURL(blob);
    if (token !== jobToken || !isModalOpen()) return; // closed meanwhile
    showPreview({ kind, blob, dataUrl, filename: exportFilename(game, kind), game });
  } catch (err) {
    console.error('Export error:', err);
    if (token === jobToken) showToast(err instanceof ExportError ? err.message : MSG.failed, 'error', 5000);
  } finally {
    setBusy(null);
  }
}

function showPreview({ kind, blob, dataUrl, filename, game }) {
  releasePrepared();
  const file = makeFile(blob, filename);
  prepared = {
    kind,
    filename,
    blob,
    file,
    objectUrl: URL.createObjectURL(blob),
    canShare: fileShareable(file),
    title: `${teamName(game, 'first')} vs ${teamName(game, 'second')}`,
  };

  const img = el('export-image');
  if (img) {
    img.alt = kind === 'full' ? 'スコアシートの画像' : 'スコアボードの画像';
    img.src = dataUrl;
  }
  const share = el('export-share-btn');
  if (share) share.style.display = prepared.canShare ? '' : 'none';

  const preview = el('export-preview');
  if (!preview) return;
  let hint = el('export-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'export-hint';
    hint.className = 'export-hint';
    preview.appendChild(hint);
  }
  hint.textContent = prepared.canShare ? MSG.hintShare : MSG.hintNoShare;
  preview.classList.remove('hidden');
  // bring the image and the ダウンロード / 共有 buttons into view inside the modal
  const target = hint || preview;
  try {
    target.scrollIntoView({ block: 'end', behavior: 'smooth' });
  } catch {
    target.scrollIntoView(false); // old browsers without scrollIntoView options
  }
}

// ============================================
// Download / share
// ============================================

function handleDownload() {
  if (!prepared) return;
  const link = document.createElement('a');
  link.href = prepared.objectUrl;
  link.download = prepared.filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function shareFailed(err) {
  if (err && err.name === 'AbortError') return; // the user closed the share sheet
  console.error('Share error:', err);
  showToast(MSG.shareFailed, 'error', 5000);
}

// Synchronous up to navigator.share(): the blob/File were prepared beforehand.
function handleShare() {
  const p = prepared;
  if (!p || !p.file || !p.canShare) {
    showToast(MSG.shareFailed, 'error', 5000);
    return;
  }
  let pending;
  try {
    pending = navigator.share({ files: [p.file], title: p.title });
  } catch (err) {
    shareFailed(err);
    return;
  }
  Promise.resolve(pending).catch(shareFailed);
}
