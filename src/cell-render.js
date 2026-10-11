// ============================================
// Score cell drawing (早稲田式) - returns HTML strings, no event binding
// ============================================
//
// Cell layout (same as a paper scorebook):
//   top-left  = 三塁 area     | top-right    = 二塁 area
//   ----------------- diamond (base path) -----------------
//   bottom-left = 本塁 area   | bottom-right = 一塁 area (batting result)
// Centre of the diamond: out number Ⅰ Ⅱ Ⅲ, or ● when the player scored.
// Runner events are drawn as tags in the area of the base they happened at.
// The inning-end mark '//' is NOT drawn here: the sheet adds the class
// 'inning-end' to the <td class="score-cell"> (styled in styles/cell.css).

import './styles/cell.css';
import { escapeHtml } from './util.js';
import { describeCell, fielderPath, validEvents, resultTypeOf, runnerEventOf } from './describe.js';

const ROMAN = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };

// Symbols written together with the fielder numbers (E6, FC6-4, DP6-4-3, IF4)
const PREFIX_SYMBOLS = { DOUBLE_PLAY: 'DP', INFIELD_FLY: 'IF', ERROR: 'E', FIELDERS_CHOICE: 'FC' };

// Number of lines of the hit mark (━ ═ ≡)
const HIT_LINES = { SINGLE: 1, DOUBLE: 2, TRIPLE: 3 };

// Sample fielder paths for the symbol guide
const SAMPLE_POSITIONS = {
  GROUNDOUT: '6-3', FLYOUT: '8', LINEOUT: '5', DOUBLE_PLAY: '6-4-3', INFIELD_FLY: '4',
  SINGLE: '7', DOUBLE: '8', TRIPLE: '9', HOMERUN: '7',
  SACRIFICE_BUNT: '1-3', SACRIFICE_FLY: '8', ERROR: '6', FIELDERS_CHOICE: '6-4'
};

const MAX_RAW_POSITIONS = 6;

// ============================================
// Helpers
// ============================================

function validBase(b) {
  const n = Number(b);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

function reachedBase(cell) {
  const n = Number(cell.basesReached);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 0;
}

// Fielder numbers as displayed: normalised path, or the raw text (escaped,
// shortened) when it is not a fielder path (legacy free-text input).
function positionsDisplay(positions) {
  const path = fielderPath(positions);
  if (path) return { text: path, isPath: true };
  const raw = positions === null || positions === undefined ? '' : String(positions).trim();
  if (!raw) return { text: '', isPath: false };
  const chars = Array.from(raw);
  const text = chars.length > MAX_RAW_POSITIONS ? chars.slice(0, MAX_RAW_POSITIONS).join('') + '…' : raw;
  return { text, isPath: false };
}

// Positions HTML with the trajectory mark on the first fielder (ゴロ/フライ/ライナー)
function positionsHTML(pos, batType) {
  if (!pos.text) return '';
  if (!batType || !pos.isPath) return escapeHtml(pos.text);
  const first = pos.text.charAt(0);
  const rest = pos.text.slice(1);
  return `<span class="traj-mark traj-${batType}">${escapeHtml(first)}</span>${escapeHtml(rest)}`;
}

// Display width in half-width units (full-width characters count 2)
function displayWidth(text) {
  let w = 0;
  for (const ch of Array.from(text)) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}

function sizeClass(len) {
  if (len <= 2) return 'fs-l';
  if (len <= 3) return 'fs-m';
  if (len <= 5) return 'fs-s';
  return 'fs-xs';
}

function line(content, extra = '') {
  return `<div class="cr-line${extra ? ' ' + extra : ''}">${content}</div>`;
}

// ============================================
// Batting result (bottom-right / 一塁 area)
// ============================================

function resultHTML(rt, cell, preLines = []) {
  const id = rt.id;
  const pos = rt.needsPositions ? positionsDisplay(cell.positions) : { text: '', isPath: false };
  const posLen = displayWidth(pos.text);
  const lines = preLines.slice();
  let cls = '';
  let len = 1;

  if (HIT_LINES[id]) {
    cls = 'is-hit';
    const mark = `<span class="hit-mark hit-${HIT_LINES[id]}"></span>`;
    lines.push(line(mark + positionsHTML(pos, null), 'cr-pos'));
    len = Math.max(2, posLen + 1);
  } else if (id === 'HOMERUN') {
    cls = 'is-hit';
    lines.push(line('HR', 'cr-sym'));
    if (pos.text) lines.push(line(positionsHTML(pos, null), 'cr-pos'));
    len = Math.max(2, posLen);
  } else if (id === 'STRIKEOUT_SWING' || id === 'STRIKEOUT_LOOK') {
    const mirror = rt.mirrorSymbol ? ' sym-mirror' : '';
    lines.push(line(`<span class="sym-k${mirror}">K</span>`));
  } else if (id === 'STRIKEOUT_WILD') {
    lines.push(line('<span class="sym-k">K</span>'));
    lines.push(line('振逃', 'cr-note'));
  } else if (id === 'SACRIFICE_BUNT') {
    const inner = pos.text ? positionsHTML(pos, null) : '';
    lines.push(line(`<span class="sac-bunt-wrap${inner ? '' : ' empty'}">${inner}</span>`));
    len = Math.max(2, posLen + 1);
  } else if (id === 'SACRIFICE_FLY') {
    const inner = pos.text ? positionsHTML(pos, null) : '';
    lines.push(line(
      `<span class="sac-fly-wrap${inner ? '' : ' empty'}">` +
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon points="50,3 97,50 50,97 3,50"/></svg>' +
      `<span class="sac-fly-text">${inner}</span></span>`));
    len = Math.max(2, posLen + 1);
  } else if (id === 'TIEBREAK_RUNNER') {
    lines.push(line('<span class="tb-tag">TB</span>'));
  } else if (PREFIX_SYMBOLS[id]) {
    const sym = PREFIX_SYMBOLS[id];
    const posHtml = positionsHTML(pos, rt.batType);
    if (!pos.text) {
      lines.push(line(sym, 'cr-sym'));
      len = sym.length;
    } else if (sym.length + posLen <= 3) {
      lines.push(line(`<span class="cr-sym-inline">${sym}</span>${posHtml}`, 'cr-pos' + trajClass(rt, pos)));
      len = sym.length + posLen;
    } else {
      lines.push(line(sym, 'cr-sym'));
      lines.push(line(posHtml, 'cr-pos' + trajClass(rt, pos)));
      len = posLen;
    }
  } else if (rt.needsPositions) {
    // Fielded outs: fielder numbers with the trajectory mark
    if (pos.text) {
      lines.push(line(positionsHTML(pos, rt.batType), 'cr-pos' + trajClass(rt, pos)));
      len = posLen;
    } else {
      // No fielder recorded (legacy data): fall back to the short symbol
      lines.push(line(escapeHtml(rt.symbol || ''), 'cr-pos'));
      len = 1;
    }
  } else {
    // B, IB, DB, INT ...
    lines.push(line(escapeHtml(rt.symbol || '')));
    len = Array.from(rt.symbol || '').length;
  }

  return `<div class="cell-result ${sizeClass(len)}${cls ? ' ' + cls : ''}">${lines.join('')}</div>`;
}

function trajClass(rt, pos) {
  return rt.batType && pos.isPath ? ` has-traj-${rt.batType}` : '';
}

// ============================================
// Runner events (tags in the area of the base)
// ============================================

// Decides the base area of every event. Explicit e.base wins; otherwise the
// runner is assumed to move one base per advancing event, and an out happens
// after the last base reached safely (basesReached): a pick-off at that base,
// any other out at the next one.
function placeEvents(events, startBase, reached) {
  const byBase = { 1: [], 2: [], 3: [], 4: [] };
  let cur = startBase;
  for (const e of events) {
    const ev = runnerEventOf(e.type);
    let base = validBase(e.base);
    if (!base) {
      if (ev.isOut) {
        const last = Math.min(Math.max(cur, reached), 3);
        base = e.type === 'PICKOFF' ? last : last + 1;
      } else {
        base = Math.min(cur + 1, 4);
      }
    }
    byBase[base].push(e);
    if (!ev.isOut) cur = base;
  }
  return byBase;
}

function eventTagsHTML(list) {
  return list.map(e => {
    const ev = runnerEventOf(e.type);
    const outCls = ev.isOut ? ' ev-out' : '';
    return `<span class="cell-event-tag${outCls}" style="color:${ev.color};border-color:${ev.color}" title="${escapeHtml(ev.label)}">${escapeHtml(ev.symbol)}</span>`;
  }).join('');
}

// ============================================
// Public API
// ============================================

// Inner HTML of <td class="score-cell">.
// opts: { isPlaced?: boolean, startBase?: 1|2 (placed runner's base), forExport?: boolean }
export function renderCellHTML(cell, opts = {}) {
  if (!cell || typeof cell !== 'object') return '';
  const options = opts || {};
  const rt = cell.resultType ? resultTypeOf(cell.resultType) : null;
  const events = validEvents(cell.runnerEvents);
  if (!rt && events.length === 0) return '';

  const isPlaced = !!options.isPlaced || cell.resultType === 'TIEBREAK_RUNNER';
  const batterOut = !!(rt && rt.isOut);
  const reached = batterOut ? 0 : reachedBase(cell);
  const hasOutEvent = events.some(e => runnerEventOf(e.type).isOut);
  const runnerOut = !batterOut && (hasOutEvent || (!!rt && !isPlaced && reached === 0));
  const isOut = batterOut || runnerOut;
  const scored = !isOut && reached === 4;
  const state = isOut ? 'out' : scored ? 'scored' : 'onbase';

  const advances = events.filter(e => !runnerEventOf(e.type).isOut).length;
  let startBase = validBase(options.startBase);
  if (isPlaced && !startBase) startBase = Math.min(Math.max(reached - advances, 1), 2);
  const firstBase = isPlaced ? startBase : rt ? Math.min(Math.max(rt.bases || 1, 1), 3) : 1;

  const rootCls = ['cell-content', 'wcell', `state-${state}`];
  if (isPlaced) rootCls.push('is-placed');
  if (rt) rootCls.push('rt-' + rt.id.toLowerCase().replace(/_/g, '-'));

  let html = '';
  if (!options.forExport) {
    const text = describeCell(cell, { startBase: validBase(options.startBase) || undefined });
    if (text) html += `<div class="${rootCls.join(' ')}" title="${escapeHtml(text)}">`;
    else html += `<div class="${rootCls.join(' ')}">`;
  } else {
    html += `<div class="${rootCls.join(' ')}">`;
  }

  // Grid lines
  html += '<div class="bg-line line-h-cross"></div><div class="bg-line line-v-cross"></div>';

  // Base path
  const dia = ['diamond-graphic'];
  for (let b = 1; b <= reached; b++) dia.push('b' + b);
  if (isPlaced) {
    // the part of the path the placed runner did not run is drawn dashed
    for (let b = 1; b <= Math.min(startBase, reached); b++) dia.push('p' + b);
  }
  if (scored) dia.push('hr');
  html += `<div class="${dia.join(' ')}"></div>`;

  // Out number (Ⅰ Ⅱ Ⅲ) in the centre
  const outNum = Number(cell.outNumber);
  if (isOut && ROMAN[outNum]) {
    html += `<div class="out-number-text">${ROMAN[outNum]}</div>`;
  }

  // Runner events by base area
  const byBase = placeEvents(events, firstBase || 1, reached);
  [2, 3, 4].forEach(b => {
    if (byBase[b].length) html += `<div class="cell-events ev-q${b}">${eventTagsHTML(byBase[b])}</div>`;
  });

  // Batting result (+ events at first base, e.g. pick-off)
  const pre = byBase[1].length ? [line(eventTagsHTML(byBase[1]), 'cr-events')] : [];
  if (rt) html += resultHTML(rt, cell, pre);
  else if (pre.length) html += `<div class="cell-result fs-m">${pre.join('')}</div>`;

  html += '</div>';
  return html;
}

// Sample cell for the symbol guide.
// opts: { positions?, basesReached?, outNumber?, runnerEvents?, rbi?, cell? (full override),
//         inningEnd?: boolean, large?: boolean, startBase? }
export function renderLegendSample(resultType, opts = {}) {
  const options = opts || {};
  const rt = resultTypeOf(resultType);
  let cell = options.cell || null;
  if (!cell) {
    if (!rt) return '';
    cell = {
      resultType,
      positions: options.positions !== undefined ? options.positions : (SAMPLE_POSITIONS[resultType] || ''),
      rbi: options.rbi || 0,
      basesReached: options.basesReached !== undefined ? options.basesReached : (rt.isOut ? 0 : rt.bases),
      outNumber: options.outNumber !== undefined ? options.outNumber : (rt.isOut ? 1 : null),
      runnerEvents: options.runnerEvents || [],
    };
  }
  const cls = ['legend-cell'];
  if (options.inningEnd) cls.push('inning-end');
  if (options.large) cls.push('legend-cell-lg');
  const inner = renderCellHTML(cell, { forExport: true, startBase: options.startBase });
  return `<div class="${cls.join(' ')}" aria-hidden="true">${inner}</div>`;
}

export { SAMPLE_POSITIONS };
