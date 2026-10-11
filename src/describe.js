// ============================================
// Plain-language descriptions of cells (pure, no DOM)
// ============================================
//
// Every function returns PLAIN TEXT (not HTML). Callers must escape it
// (escapeHtml) or assign it with textContent. Fielder paths that are not
// made of fielder numbers are left out, so the text never carries markup
// typed into the positions field.

import { RESULT_TYPES, RUNNER_EVENTS, POSITION_FIELD_NAMES } from './rules.js';

const BASE_NAMES = { 1: '一塁', 2: '二塁', 3: '三塁', 4: '本塁' };

// '一塁' | '二塁' | '三塁' | '本塁' ('' for anything else)
export function baseName(n) {
  return BASE_NAMES[n] || '';
}

// ============================================
// Fielder paths ("6-4-3")
// ============================================

const FULLWIDTH_DIGITS = /[０-９]/g;
const DASHES = /[‐‑‒–—―−－ー─━ｰ~〜～]/g;
const VALID_PATH = /^[1-9](?:-?[1-9])*$/;

// Returns the fielder path in half-width form ("６－３" → "6-3"), or '' when
// the text is not a sequence of fielder numbers.
export function fielderPath(positions) {
  if (positions === null || positions === undefined) return '';
  const text = String(positions)
    .replace(FULLWIDTH_DIGITS, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(DASHES, '-')
    .replace(/[\s・,、]+/g, '');
  return VALID_PATH.test(text) ? text : '';
}

function fielderCount(path) {
  return path.replace(/-/g, '').length;
}

function fieldName(path) {
  return path ? (POSITION_FIELD_NAMES[path.charAt(0)] || '') : '';
}

const OUTFIELD = { 7: true, 8: true, 9: true };

// ============================================
// Result phrases
// ============================================

// 'ショートゴロ', 'ピッチャーゴロ（1-3）', 'センターへの二塁打', '見逃し三振' ...
// Single-fielder paths are said with the fielder name only; longer paths are
// added in parentheses so the reader can match them with the sheet.
export function describeResult(resultType, positions) {
  const rt = RESULT_TYPES[resultType];
  if (!rt) return '';
  const path = rt.needsPositions ? fielderPath(positions) : '';
  const name = fieldName(path);
  const multi = path && fielderCount(path) > 1;
  const paren = multi ? `（${path}）` : '';

  switch (resultType) {
    case 'GROUNDOUT':
      return name ? `${name}ゴロ${paren}` : 'ゴロ';
    case 'FLYOUT':
      return name ? `${name}フライ${paren}` : 'フライ';
    case 'LINEOUT':
      return name ? `${name}ライナー${paren}` : 'ライナー';
    case 'STRIKEOUT_SWING':
      return '空振り三振';
    case 'STRIKEOUT_LOOK':
      return '見逃し三振';
    case 'DOUBLE_PLAY':
      return name ? `${name}ゴロの併殺打${paren}` : '併殺打（ダブルプレー）';
    case 'INFIELD_FLY':
      return name ? `インフィールドフライ（${name}）` : 'インフィールドフライ';
    case 'SINGLE':
      if (!name) return 'ヒット';
      return OUTFIELD[path.charAt(0)] ? `${name}前ヒット` : `${name}への内野安打`;
    case 'DOUBLE':
      return name ? `${name}への二塁打` : '二塁打';
    case 'TRIPLE':
      return name ? `${name}への三塁打` : '三塁打';
    case 'HOMERUN':
      return name ? `${name}へのホームラン` : 'ホームラン';
    case 'WALK':
      return '四球（フォアボール）';
    case 'INTENTIONAL_WALK':
      return '敬遠の四球';
    case 'HIT_BY_PITCH':
      return '死球（デッドボール）';
    case 'SACRIFICE_BUNT':
      if (!name) return '送りバント（犠打）';
      return `${name}前への送りバント（犠打${multi ? '・' + path : ''}）`;
    case 'SACRIFICE_FLY':
      return name ? `${name}への犠牲フライ${paren}` : '犠牲フライ';
    case 'ERROR':
      if (!name) return 'エラー';
      return multi ? `エラー（${path}）` : `${name}のエラー`;
    case 'FIELDERS_CHOICE':
      return name ? `${name}の野選（フィルダースチョイス${multi ? '・' + path : ''}）` : '野選（フィルダースチョイス）';
    case 'STRIKEOUT_WILD':
      return '振り逃げ';
    case 'INTERFERENCE':
      return '打撃妨害';
    case 'TIEBREAK_RUNNER':
      return 'タイブレークの置きランナー';
    default:
      return rt.label || '';
  }
}

// ============================================
// Runner events
// ============================================

// Phrase for an advance; base = base reached (null when unknown)
function advancePhrase(type, base) {
  const ev = RUNNER_EVENTS[type];
  if (base === 4) {
    switch (type) {
      case 'STOLEN_BASE': return 'ホームスチールで生還（得点）';
      case 'WILD_PITCH': return '暴投で生還（得点）';
      case 'PASSED_BALL': return '捕逸で生還（得点）';
      case 'BALK': return 'ボークで生還（得点）';
      case 'ADVANCE_ON_ERROR': return 'エラーの間に生還（得点）';
      default: return `${ev.label}で生還（得点）`;
    }
  }
  if (base) {
    const b = baseName(base);
    switch (type) {
      case 'STOLEN_BASE': return `${b}へ盗塁`;
      case 'WILD_PITCH': return `暴投で${b}へ`;
      case 'PASSED_BALL': return `捕逸で${b}へ`;
      case 'BALK': return `ボークで${b}へ`;
      case 'ADVANCE_ON_ERROR': return `エラーの間に${b}へ`;
      default: return `${ev.label}で${b}へ`;
    }
  }
  switch (type) {
    case 'STOLEN_BASE': return '盗塁';
    case 'WILD_PITCH': return '暴投で進塁';
    case 'PASSED_BALL': return '捕逸で進塁';
    case 'BALK': return 'ボークで進塁';
    case 'ADVANCE_ON_ERROR': return 'エラーの間に進塁';
    default: return ev.label;
  }
}

const OUT_EVENT_WORDS = { CAUGHT_STEALING: '盗塁死', PICKOFF: '牽制死', RUNNER_OUT: '走塁死' };

function outPhrase(type, base, outText) {
  const word = OUT_EVENT_WORDS[type] || RUNNER_EVENTS[type].label;
  return `${base ? baseName(base) + 'で' : ''}${word}${outText}`;
}

// ============================================
// Helpers
// ============================================

function validBase(b) {
  const n = Number(b);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

function toCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function outNumberText(outNumber) {
  const n = Number(outNumber);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? `【${n}アウト目】` : '';
}

function playerPrefix(playerName, orderNum) {
  const parts = [];
  const order = Number(orderNum);
  if (Number.isInteger(order) && order > 0) parts.push(`${order}番`);
  else if (typeof orderNum === 'string' && orderNum.trim()) parts.push(orderNum.trim());
  if (playerName !== null && playerName !== undefined && String(playerName).trim()) {
    parts.push(String(playerName).trim());
  }
  return parts.length ? parts.join(' ') + '：' : '';
}

export function validEvents(runnerEvents) {
  if (!Array.isArray(runnerEvents)) return [];
  return runnerEvents.filter(e => e && RUNNER_EVENTS[e.type]);
}

// ============================================
// Cell description
// ============================================

// One sentence for a cell, e.g.
//   "4番 田中：ショートゴロ（6-3）でアウト【1アウト目】"
//   "レフト前ヒット → 盗塁 → 得点（打点1）"
//   "四球で出塁 → 二塁で走塁死【2アウト目】"
// opts: { playerName, orderNum (1-based), startBase (placed runner's base) }
export function describeCell(cell, opts = {}) {
  if (!cell || typeof cell !== 'object') return '';
  const { playerName, orderNum } = opts || {};
  const rt = cell.resultType ? RESULT_TYPES[cell.resultType] : null;
  const events = validEvents(cell.runnerEvents);
  if (cell.resultType && !rt) return '';
  if (!rt && events.length === 0) return '';

  const prefix = playerPrefix(playerName, orderNum);
  const outText = outNumberText(cell.outNumber);
  const rbi = toCount(cell.rbi);
  const rbiText = rbi > 0 ? `（打点${rbi}）` : '';
  const phrase = rt ? describeResult(cell.resultType, cell.positions) : '';

  // Batter out: the cell holds only the batter's out.
  if (rt && rt.isOut) {
    let text = `${phrase}でアウト${outText}`;
    if (cell.resultType === 'DOUBLE_PLAY') text += '（走者と合わせて2アウト）';
    return prefix + text + rbiText;
  }

  const isPlaced = cell.resultType === 'TIEBREAK_RUNNER';
  const reached = validBase(cell.basesReached) || 0;

  if (cell.resultType === 'HOMERUN') {
    return `${prefix}${phrase}で得点${rbiText}`;
  }

  const parts = [];
  if (!rt) parts.push('打席結果が未入力');
  else if (isPlaced) parts.push(phrase);
  else if (rt.isHit) parts.push(phrase);
  else parts.push(`${phrase}で出塁`);

  // cur = base the reader knows the runner is on (null = unknown)
  let cur = isPlaced ? validBase(opts.startBase) : (rt ? Math.min(Math.max(rt.bases || 1, 1), 3) : null);
  let scoredSaid = false;
  let outSaid = false;

  for (const e of events) {
    const ev = RUNNER_EVENTS[e.type];
    const base = validBase(e.base);
    if (ev.isOut) {
      if (reached >= 1 && reached <= 3 && (cur === null || reached > cur) && (!base || reached < base)) {
        parts.push(`${baseName(reached)}へ進む`);
        cur = reached;
      }
      parts.push(outPhrase(e.type, base, outText));
      outSaid = true;
      break;
    }
    parts.push(advancePhrase(e.type, base));
    if (base) cur = base;
    else if (cur !== null) cur = Math.min(cur + 1, 4);
    if (base === 4) scoredSaid = true;
  }

  if (!outSaid) {
    if (rt && !isPlaced && reached === 0) {
      // Legacy data: a non-out result with no base reached = out on the bases.
      parts.push(`塁上でアウト${outText}`);
    } else if (reached === 4) {
      if (!scoredSaid) parts.push('得点');
    } else if (reached >= 1) {
      if (cur === null) {
        if (isPlaced) parts[0] += `（${baseName(reached)}）`;
        else parts.push(`${baseName(reached)}にいる`);
      } else if (reached > cur) {
        parts.push(`${baseName(reached)}へ進む`);
      }
    }
  }

  return prefix + parts.join(' → ') + rbiText;
}

// ============================================
// Half-inning summary
// ============================================

function slotLabel(batterIdx, lineup) {
  const idx = Number(batterIdx);
  if (!Number.isInteger(idx) || idx < 0) return '';
  const player = Array.isArray(lineup) ? lineup[idx] : null;
  const name = player && player.name ? String(player.name).trim() : '';
  return name ? `${idx + 1}番 ${name}` : `${idx + 1}番`;
}

// "打者5人：得点1・残塁1・アウト3 ✓"
// ✓ when the half is complete, pa + placed = runs + lob + outs, and it has
// 3 outs (or the game ended in it). Otherwise a short ⚠ reason is added.
// half = scoring.halfInning(...) result. opts.detail adds who scored / was left on base.
export function describeHalfInning(half, lineup, opts = {}) {
  if (!half || typeof half !== 'object') return '';
  const cells = Array.isArray(half.cells) ? half.cells : [];
  if (!half.started && cells.length === 0) return '';

  const pa = toCount(half.pa);
  const placed = cells.filter(c => c && c.isPlaced).length;
  const runs = toCount(half.runs);
  const outs = toCount(half.outs);
  const runners = Array.isArray(half.runners) ? half.runners : [];
  const onBase = half.complete ? toCount(half.lob) : runners.length;
  const detail = !!(opts && opts.detail);

  let runsText = `得点${runs}`;
  let baseText = `${half.complete ? '残塁' : '塁上'}${onBase}`;
  if (detail) {
    const scorers = cells.filter(c => c && c.state === 'SCORED').map(c => slotLabel(c.batterIdx, lineup)).filter(Boolean);
    if (scorers.length) runsText += `（${scorers.join('・')}）`;
    const left = runners.map(r => {
      const label = slotLabel(r.batterIdx, lineup);
      const b = baseName(r.base);
      return label && b ? `${label}＝${b}` : label;
    }).filter(Boolean);
    if (left.length) baseText += `（${left.join('・')}）`;
  }

  let text = `打者${pa}人`;
  if (placed) text += `＋置きランナー${placed}人`;
  text += `：${runsText}・${baseText}・アウト${outs}`;

  if (half.complete) {
    const total = pa + placed;
    const sum = runs + onBase + outs;
    // A half may end with fewer than 3 outs only when the game ended there
    // (gameOver / nextBatter null); with later data it means a missing out.
    const gameEnded = outs < 3 && (half.gameOver === true || half.nextBatter === null);
    if (total !== sum) text += ` ⚠ 人数が合いません（${total}人 ≠ 得点＋残塁＋アウト ${sum}）`;
    else if (outs > 3) text += ` ⚠ アウトが${outs}つあります`;
    else if (outs < 3 && !gameEnded) text += ` ⚠ アウトが${outs}つしかありません`;
    else text += gameEnded ? ' ✓（試合終了）' : ' ✓';
  } else {
    text += '（攻撃中）';
  }
  return text;
}
