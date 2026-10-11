// ============================================
// Score Input Panel (modal #score-input-modal)
// ============================================
//
// openScoreInput(game, { teamKey, inning, key }, { onSave })
//   Opens the panel for one cell. On 確定 the game object is mutated through
//   scoring.recordPlateAppearance (runner advances are passed as runnerUpdates),
//   on クリア through scoring.clearCell; then onSave({ thirdOut, changedKeys, half })
//   is called. This module never saves the game or re-renders the sheet.
//
// The panel state is a plain object (createState) changed by small pure
// actions (selectResult, setRunnerTarget, ...), so the logic is testable
// without a DOM. The DOM part rebuilds the panel sections from the state after
// every tap and runs the change on a copy of the game for the live preview
// (cell drawing, plain-language readout and consistency warnings).

import './styles/input.css';
import { RESULT_TYPES, RUNNER_EVENTS, POSITION_FIELD_NAMES } from './rules.js';
import { escapeHtml, showToast } from './util.js';
import {
  halfInning, parseKey, nextOutNumber, cellState, recordPlateAppearance, clearCell,
  renumberOuts, validateGame, batterLabel, inningLabel,
} from './scoring.js';
import { describeCell, describeResult, fielderPath, baseName } from './describe.js';
import { renderCellHTML } from './cell-render.js';

// ============================================
// Constants
// ============================================

const PLACED_TYPE = 'TIEBREAK_RUNNER';

const CATEGORIES = [
  { id: 'out', title: 'アウト' },
  { id: 'hit', title: 'ヒット' },
  { id: 'walk', title: '四球・死球' },
  { id: 'sacrifice', title: '犠打・犠飛' },
  { id: 'other', title: 'その他（エラーなど）' },
];

// Small helper words under the result buttons, for parents new to scoring.
const RESULT_HINTS = {
  DOUBLE_PLAY: 'ゲッツー',
  INFIELD_FLY: '内野の高いフライ',
  WALK: 'フォアボール',
  INTENTIONAL_WALK: 'わざと四球',
  HIT_BY_PITCH: 'デッドボール',
  SACRIFICE_BUNT: '送りバント',
  SACRIFICE_FLY: '犠牲フライ',
  ERROR: '守備のミスで出塁',
  FIELDERS_CHOICE: '野手選択',
  STRIKEOUT_WILD: '三振だが一塁へ',
  INTERFERENCE: '捕手のじゃま',
};

// What the fielder numbers mean for each result (shown above the keypad).
const FIELDER_HELP = {
  GROUNDOUT: '打球を処理した野手の番号（例: ショートゴロで一塁アウトなら 6-3）',
  FLYOUT: '捕った野手の番号（例: センターフライなら 8）',
  LINEOUT: '捕った野手の番号（例: サードライナーなら 5）',
  INFIELD_FLY: '捕った（捕るはずだった）野手の番号（例: セカンドなら 4）',
  DOUBLE_PLAY: 'ボールが渡った順の野手の番号（例: ショート→セカンド→ファーストなら 6-4-3）',
  SACRIFICE_BUNT: 'バントを処理した野手の番号（例: ピッチャーが捕って一塁へ投げたら 1-3）',
  SACRIFICE_FLY: '捕った野手の番号（例: センターなら 8）',
  ERROR: 'エラーをした野手の番号（例: ショートのエラーなら 6）',
  FIELDERS_CHOICE: '打球を処理した野手と送球を受けた野手の番号（例: 6-4）',
};
const HIT_FIELDER_HELP = '打球の方向（例: レフトなら 7）';

// Fielder keys laid out like the field seen from home plate.
const FIELD_KEYS = [
  { k: '7', area: 'lf' }, { k: '8', area: 'cf' }, { k: '9', area: 'rf' },
  { k: '6', area: 'ss' }, { k: '4', area: '2b' },
  { k: '5', area: '3b' }, { k: '1', area: 'p' }, { k: '3', area: '1b' },
  { k: '2', area: 'c' },
];
const MAX_FIELDER_CHARS = 13;

const ROMAN = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };
const WALK_LIKE = new Set(['WALK', 'INTENTIONAL_WALK', 'HIT_BY_PITCH', 'INTERFERENCE']);
const OUT_EVENT_TYPES = Object.keys(RUNNER_EVENTS).filter(t => RUNNER_EVENTS[t].isOut);
const ADVANCE_EVENT_TYPES = Object.keys(RUNNER_EVENTS).filter(t => !RUNNER_EVENTS[t].isOut);
const SEVERITY = {
  error: { label: 'エラー', rank: 0 },
  warning: { label: '注意', rank: 1 },
  info: { label: '確認', rank: 2 },
};
const MAX_WARNINGS = 3;

// back (slots before the leadoff) -> base, per tiebreak setting (spec §4)
const TIEBREAK_BASES = { '1B2B': { 1: 1, 2: 2 }, '1B': { 1: 1 }, '2B': { 1: 2 } };

// ============================================
// Small helpers
// ============================================

const hasOwn = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

function resultTypeOf(id) {
  return hasOwn(RESULT_TYPES, id) ? RESULT_TYPES[id] : null;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function lineupOf(game, teamKey) {
  if (game && typeof game.getLineup === 'function') return game.getLineup(teamKey) || [];
  const l = teamKey === 'second' ? game?.lineupSecond : game?.lineupFirst;
  return Array.isArray(l) ? l : [];
}

function teamNameOf(game, teamKey) {
  const name = teamKey === 'second' ? game?.teamSecond : game?.teamFirst;
  return typeof name === 'string' ? name.trim() : '';
}

function cellAt(game, teamKey, inning, key) {
  const half = game?.atBats?.[teamKey]?.[inning];
  const cell = half && hasOwn(half, key) ? half[key] : null;
  return cell && typeof cell === 'object' ? cell : null;
}

function validEvents(list) {
  return Array.isArray(list) ? list.filter(e => e && typeof e === 'object' && hasOwn(RUNNER_EVENTS, e.type)) : [];
}

function roman(n) {
  return ROMAN[n] || String(n);
}

// '6-' -> '6', '63' -> '6-3'; text that is not a fielder path (legacy input) is kept.
export function cleanPositions(raw) {
  const p = String(raw ?? '').trim().replace(/-+$/, '');
  return fielderPath(p) || p;
}

// Keypad reducer: k = '1'..'9' | '-' | 'bs' (backspace) | 'clr'
export function pressFielderKey(raw, k) {
  const s = String(raw ?? '');
  if (k === 'clr') return '';
  if (k === 'bs') return Array.from(s).slice(0, -1).join('');
  if (k === '-') return !s || s.endsWith('-') || s.length >= MAX_FIELDER_CHARS ? s : s + '-';
  if (/^[1-9]$/.test(k)) return s.length >= MAX_FIELDER_CHARS ? s : s + k;
  return s;
}

// What the keypad display shows: '63' -> '6-3', '6-' stays '6-'.
function fielderDisplay(raw) {
  return fielderPath(raw) || String(raw ?? '');
}

// ============================================
// Runner defaults and RBI suggestion (pure)
// ============================================

// Runners on base before this batter: placed runners and plate appearances
// earlier in the batting order (this cell excluded).
export function runnersBefore(half, key, order) {
  const k = String(key);
  return (half?.runners || []).filter(r => r.key !== k && (r.isPlaced || r.order < order));
}

// Minimal push: the batter stands on `from`; every runner at or behind the
// next occupied spot moves just far enough to keep one runner per base and
// nobody passed. A runner who is not forced stays.
function pushRunners(runners, from) {
  const targets = {};
  let floor = from;
  for (const r of [...runners].sort((a, b) => a.base - b.base)) {
    const t = r.base <= floor ? Math.min(floor + 1, 4) : r.base;
    targets[r.key] = t === r.base ? 'stay' : t;
    floor = Math.max(floor, t);
  }
  return targets;
}

// Default choice per runner key: 'stay' | 2 | 3 | 4 (scored) | 'out'.
// batterBase = base the batter reached on the play (non-out results).
export function defaultRunnerTargets(resultType, batterBase, runners) {
  const list = Array.isArray(runners) ? runners : [];
  const targets = {};
  for (const r of list) targets[r.key] = 'stay';
  const rt = resultTypeOf(resultType);
  if (!rt || resultType === PLACED_TYPE) return targets;

  if (resultType === 'HOMERUN') {
    for (const r of list) targets[r.key] = 4;
    return targets;
  }
  if (!rt.isOut) {
    // walks: forced runners only; hits, errors, FC: forced as far as the batter went
    const from = WALK_LIKE.has(resultType) ? 1 : clamp(toInt(batterBase, rt.bases), 1, 4);
    return { ...targets, ...pushRunners(list, from) };
  }
  if (resultType === 'SACRIFICE_FLY') {
    for (const r of list) if (r.base === 3) targets[r.key] = 4;
  } else if (resultType === 'SACRIFICE_BUNT') {
    // runners on first and second move up one base when the base ahead is free; third stays
    const occupied = new Set(list.map(r => r.base));
    for (const r of [...list].sort((a, b) => b.base - a.base)) {
      if (r.base <= 2 && !occupied.has(r.base + 1)) {
        targets[r.key] = r.base + 1;
        occupied.delete(r.base);
        occupied.add(r.base + 1);
      }
    }
  } else if (resultType === 'DOUBLE_PLAY' && list.length === 1) {
    targets[list[0].key] = 'out';
  }
  return targets;
}

// Runners sent home (+1 for the batter on a home run). No RBI for results
// that do not allow it, for errors (spec §2), or when the batter made the
// third out (no run counts then).
export function suggestRbi(resultType, targets, { thirdOut = false } = {}) {
  const rt = resultTypeOf(resultType);
  if (!rt || !rt.rbiAllowed || resultType === 'ERROR') return 0;
  if (rt.isOut && thirdOut) return 0;
  const scored = Object.values(targets || {}).filter(t => t === 4).length;
  return Math.min(4, scored + (resultType === 'HOMERUN' ? 1 : 0));
}

// ============================================
// Panel state (pure)
// ============================================

function placedStartBase(game, half, batterIdx, cell) {
  const layout = TIEBREAK_BASES[game?.tiebreakerRunners];
  const back = ((half.leadoff - batterIdx) % half.N + half.N) % half.N;
  if (layout && layout[back]) return layout[back];
  const reached = toInt(cell?.basesReached, 1);
  const advances = validEvents(cell?.runnerEvents).filter(e => !RUNNER_EVENTS[e.type].isOut).length;
  return clamp(reached - advances, 1, 2);
}

export function createState(game, target) {
  const teamKey = target?.teamKey === 'second' ? 'second' : 'first';
  const inning = Math.max(1, toInt(target?.inning, 1));
  const key = String(target?.key);
  const existing = cellAt(game, teamKey, inning, key);
  const parsed = parseKey(game, teamKey, key);
  const isPlaced = parsed.isPlaced || existing?.resultType === PLACED_TYPE;
  const batterIdx = isPlaced && Number.isInteger(existing?.batterIdx) && !parsed.isPlaced
    ? existing.batterIdx : parsed.batterIdx;
  const half = halfInning(game, teamKey, inning);
  const entry = half.cells.find(e => e.key === key);
  const order = entry ? entry.order
    : isPlaced ? -1 : parsed.lap * half.N + ((batterIdx - half.leadoff + half.N) % half.N);
  const player = lineupOf(game, teamKey)[batterIdx];
  const playerName = player && typeof player.name === 'string' ? player.name.trim() : '';

  const runners = isPlaced ? [] : runnersBefore(half, key, order).map(r => ({
    key: r.key,
    batterIdx: r.batterIdx,
    base: r.base,
    isPlaced: !!r.isPlaced,
    label: batterLabel(game, teamKey, r.batterIdx),
  }));

  const S = {
    game, teamKey, inning, key,
    batterIdx, lap: parsed.lap, order, isPlaced,
    playerName, orderNum: batterIdx + 1, teamName: teamNameOf(game, teamKey),
    existing,
    startBase: isPlaced ? placedStartBase(game, half, batterIdx, existing) : null,
    outsOthers: nextOutNumber(game, teamKey, inning, key) - 1,
    runners,
    // editable
    resultType: null,
    positions: '',
    dest: null,          // 1..4 | 'out' (batter-runner / placed runner)
    destRef: null,       // the non-out result the dest belongs to (to tell "advanced later")
    outType: 'RUNNER_OUT',
    outBase: 2,
    events: [],          // advance events of this cell's runner [{type, base}]
    targets: {},         // runner key -> 'stay' | 2 | 3 | 4 | 'out'
    runnerOutBase: {},   // runner key -> base where he was out
    touched: new Set(),  // runners the user set by hand
    runnersTouched: false,
    rbi: 0,
    rbiAuto: !existing,
    outNumber: null,
    outNumberTouched: false,
    existingOutNumber: null,
    resultsOpen: true,
    eventsOpen: false,
  };
  for (const r of runners) S.targets[r.key] = 'stay';

  if (existing) loadExisting(S, existing);
  else if (isPlaced) S.dest = S.startBase;
  return S;
}

function loadExisting(S, cell) {
  const rt = S.isPlaced ? RESULT_TYPES[PLACED_TYPE] : resultTypeOf(cell.resultType);
  if (!S.isPlaced && rt && cell.resultType !== PLACED_TYPE) S.resultType = cell.resultType;
  const type = S.isPlaced ? rt : resultTypeOf(S.resultType);
  S.resultsOpen = !S.isPlaced && !S.resultType;
  if (type?.needsPositions) {
    const raw = cell.positions === null || cell.positions === undefined ? '' : String(cell.positions).trim();
    S.positions = fielderPath(raw) || raw;
  }
  S.rbi = clamp(toInt(cell.rbi, 0), 0, 4);
  if (cellState(cell) === 'OUT') {
    const n = toInt(cell.outNumber, 0);
    if (n >= 1) S.existingOutNumber = n;
  }

  const events = validEvents(cell.runnerEvents);
  S.events = events.filter(e => !RUNNER_EVENTS[e.type].isOut).map(e => {
    const ev = { type: e.type };
    const b = toInt(e.base, 0);
    if (b >= 1 && b <= 4) ev.base = b;
    return ev;
  });
  S.eventsOpen = events.length > 0;

  if (!type || type.isOut) return;
  const reached = clamp(toInt(cell.basesReached, 0), 0, 4);
  const outEvent = events.find(e => RUNNER_EVENTS[e.type].isOut);
  if (outEvent) {
    S.dest = 'out';
    S.outType = outEvent.type;
    const b = toInt(outEvent.base, 0);
    S.outBase = b >= 1 && b <= 4 ? b
      : outEvent.type === 'PICKOFF' ? clamp(reached, 1, 3) : clamp(reached + 1, 2, 4);
  } else if (reached === 0 && !S.isPlaced) {
    // legacy: a non-out result with no base reached = out on the bases
    S.dest = 'out';
    S.outType = 'RUNNER_OUT';
    S.outBase = clamp(type.bases + 1, 2, 4);
  } else {
    S.dest = S.isPlaced ? Math.max(reached, 1) : reached;
  }
  if (!S.isPlaced && S.resultType !== 'HOMERUN') S.destRef = S.resultType;
}

// ---- derived values ----

function typeOf(S) {
  return S.isPlaced ? RESULT_TYPES[PLACED_TYPE] : resultTypeOf(S.resultType);
}

function batterIsOut(S) {
  return !S.isPlaced && !!typeOf(S)?.isOut;
}

// The cell's runner can still be on the bases (not a batter out, not a home run).
function runnerCanMove(S) {
  if (S.isPlaced) return true;
  const rt = typeOf(S);
  return !!rt && !rt.isOut && S.resultType !== 'HOMERUN';
}

export function cellWillBeOut(S) {
  return batterIsOut(S) || (runnerCanMove(S) && S.dest === 'out');
}

// Base the runner holds right after the batting result (placed: start base).
function baseZero(S) {
  if (S.isPlaced) return S.startBase || 1;
  const rt = typeOf(S);
  return rt ? clamp(rt.bases, 1, 3) : 1;
}

// Base reached through the recorded advance events (at least baseZero).
function chainTop(S) {
  let top = baseZero(S);
  for (const e of S.events) top = e.base ? Math.max(top, e.base) : Math.min(top + 1, 4);
  return Math.min(top, 4);
}

// A runner whose advance events already took him home cannot be put out.
function canBeOut(S) {
  return chainTop(S) < 4;
}

// Room for one more advance event: an out runner stops short of home.
function canAdvance(S) {
  return chainTop(S) < (S.dest === 'out' ? 3 : 4);
}

// Last base the runner reached safely.
function safeBase(S) {
  if (S.dest === 'out') return S.outType === 'PICKOFF' ? S.outBase : Math.max(S.outBase - 1, 1);
  if (typeof S.dest === 'number') return S.dest;
  return baseZero(S);
}

function outBaseChoices(S) {
  const min = Math.min(chainTop(S), 3);
  const list = [];
  if (S.outType === 'PICKOFF') for (let b = min; b <= 3; b++) list.push(b);
  else for (let b = min + 1; b <= 4; b++) list.push(b);
  return list;
}

function fixOutBase(S) {
  if (S.dest !== 'out') return;
  const choices = outBaseChoices(S);
  if (!choices.includes(S.outBase)) S.outBase = S.outBase < choices[0] ? choices[0] : choices[choices.length - 1];
}

function runnerOutsChosen(S) {
  return S.runners.filter(r => S.targets[r.key] === 'out').length;
}

export function outNumberChoices(S) {
  const max = clamp(S.outsOthers + runnerOutsChosen(S) + 1, 1, 3);
  return Array.from({ length: max }, (_, i) => i + 1);
}

function defaultOutNumber(S) {
  if (S.existingOutNumber) return S.existingOutNumber;
  return S.outsOthers + 1 + runnerOutsChosen(S);
}

export function displayedOutNumber(S) {
  if (S.outNumberTouched && outNumberChoices(S).includes(S.outNumber)) return S.outNumber;
  return defaultOutNumber(S);
}

function batterBaseForPush(S) {
  const rt = typeOf(S);
  if (!rt || rt.isOut) return 0;
  if (S.resultType === 'HOMERUN') return 4;
  if (S.dest === 'out') return Math.max(safeBase(S), rt.bases);
  return typeof S.dest === 'number' ? S.dest : rt.bases;
}

export function rbiSuggestion(S) {
  return suggestRbi(S.resultType, S.targets, { thirdOut: batterIsOut(S) && displayedOutNumber(S) >= 3 });
}

export function blockReason(S) {
  if (!S.isPlaced && !S.resultType) return '打席の結果を選んでください。';
  if (S.resultType === 'DOUBLE_PLAY') {
    const outs = runnerOutsChosen(S);
    if (outs > 1) return '併殺打でアウトになった走者は1人だけ選んでください（打者と合わせて2アウトです）。';
    if (outs === 0 && S.existing?.resultType !== 'DOUBLE_PLAY') {
      if (!S.runners.length) return '塁に走者がいないので、併殺打にはなりません。ゴロなど、ほかの結果を選んでください。';
      return '併殺打です。一緒にアウトになった走者を、下の「ランナー」欄で1人「アウト」にしてください。';
    }
  }
  return '';
}

// ---- actions ----

function applyRunnerDefaults(S) {
  // Editing a saved cell: what the runners did on this play is already
  // recorded in their own cells, so nothing moves unless the user says so.
  if (S.existing) return;
  if (S.resultType === 'HOMERUN') S.touched.clear();
  const defaults = defaultRunnerTargets(S.resultType, batterBaseForPush(S), S.runners);
  for (const r of S.runners) {
    if (!S.touched.has(r.key)) S.targets[r.key] = defaults[r.key];
    if (S.targets[r.key] === 'out' && !S.runnerOutBase[r.key]) S.runnerOutBase[r.key] = Math.min(r.base + 1, 4);
  }
}

function updateAutoRbi(S) {
  if (S.rbiAuto) S.rbi = rbiSuggestion(S);
}

function afterChange(S) {
  applyRunnerDefaults(S);
  updateAutoRbi(S);
}

export function selectResult(S, id) {
  if (S.isPlaced || !resultTypeOf(id) || id === PLACED_TYPE) return;
  S.resultsOpen = false;
  if (id === S.resultType) return;
  const next = RESULT_TYPES[id];
  S.resultType = id;
  if (!next.needsPositions) S.positions = '';
  if (!next.isOut && id !== 'HOMERUN') {
    // keep a destination the runner reached later (e.g. scored), else the result's base
    const ref = resultTypeOf(S.destRef);
    const advanced = S.dest === 'out' || (typeof S.dest === 'number' && !!ref && S.dest !== ref.bases);
    if (!advanced) S.dest = next.bases;
    else if (typeof S.dest === 'number') S.dest = Math.max(S.dest, next.bases);
    S.destRef = id;
    if (typeof S.dest === 'number' && S.dest < chainTop(S)) S.dest = chainTop(S);
    fixOutBase(S);
  }
  afterChange(S);
}

export function setDest(S, value) {
  if (!runnerCanMove(S)) return;
  if (value === 'out') {
    if (S.dest !== 'out' && canBeOut(S)) {
      const prev = typeof S.dest === 'number' ? Math.min(S.dest, 3) : baseZero(S);
      S.dest = 'out';
      S.outType = 'RUNNER_OUT';
      S.outBase = clamp(Math.max(prev, chainTop(S)) + 1, 2, 4);
      fixOutBase(S);
    }
  } else {
    const b = toInt(value, 0);
    if (b < 1 || b > 4) return;
    S.dest = Math.max(b, Math.min(chainTop(S), 4));
    if (!S.isPlaced) S.destRef = S.resultType;
  }
  afterChange(S);
}

export function setOutBase(S, base) {
  const b = toInt(base, 0);
  if (S.dest !== 'out' || !outBaseChoices(S).includes(b)) return;
  S.outBase = b;
  afterChange(S);
}

export function setRunnerTarget(S, key, value) {
  const r = S.runners.find(x => x.key === String(key));
  if (!r) return;
  let v = value;
  if (v !== 'stay' && v !== 'out') {
    v = toInt(v, 0);
    if (v <= r.base || v > 4) return;
  }
  S.targets[r.key] = v;
  S.touched.add(r.key);
  S.runnersTouched = true;
  if (v === 'out' && !S.runnerOutBase[r.key]) S.runnerOutBase[r.key] = Math.min(r.base + 1, 4);
  updateAutoRbi(S);
}

export function setRunnerOutBase(S, key, base) {
  const r = S.runners.find(x => x.key === String(key));
  const b = toInt(base, 0);
  if (!r || b < r.base || b > 4) return;
  S.runnerOutBase[r.key] = b;
}

export function stepRbi(S, delta) {
  S.rbi = clamp(S.rbi + toInt(delta, 0), 0, 4);
  S.rbiAuto = false;
}

export function useSuggestedRbi(S) {
  S.rbiAuto = true;
  updateAutoRbi(S);
}

export function setOutNumber(S, n) {
  const v = toInt(n, 0);
  if (!outNumberChoices(S).includes(v)) return;
  S.outNumber = v;
  S.outNumberTouched = true;
  updateAutoRbi(S);
}

export function pressKey(S, k) {
  S.positions = pressFielderKey(S.positions, k);
}

export function addEvent(S, type) {
  const ev = hasOwn(RUNNER_EVENTS, type) ? RUNNER_EVENTS[type] : null;
  if (!ev || !runnerCanMove(S)) return;
  S.eventsOpen = true;
  if (ev.isOut) {
    if (!canBeOut(S)) return;
    const safe = Math.min(S.dest === 'out' ? safeBase(S) : typeof S.dest === 'number' ? S.dest : baseZero(S), 3);
    S.dest = 'out';
    S.outType = type;
    S.outBase = type === 'PICKOFF' ? clamp(safe, 1, 3) : clamp(safe + 1, 2, 4);
    fixOutBase(S);
  } else {
    if (!canAdvance(S)) return;
    const base = chainTop(S) + 1;
    S.events.push({ type, base });
    if (S.dest === 'out') {
      if (safeBase(S) < base) S.outBase = S.outType === 'PICKOFF' ? Math.min(base, 3) : Math.min(base + 1, 4);
      fixOutBase(S);
    } else if (typeof S.dest !== 'number' || S.dest < base) {
      S.dest = base;
    }
  }
  afterChange(S);
}

// index in the displayed list: advance events first, then the out event.
export function removeEvent(S, index) {
  const i = toInt(index, -1);
  if (i < 0) return;
  if (i >= S.events.length) {
    if (S.dest === 'out') S.dest = Math.max(safeBase(S), 1);
  } else {
    const [removed] = S.events.splice(i, 1);
    const top = chainTop(S);
    if (typeof S.dest === 'number' && removed.base && S.dest === removed.base && S.dest > top) S.dest = top;
    fixOutBase(S);
  }
  afterChange(S);
}

// ---- submission ----

function eventsForSave(S) {
  const list = S.events.map(e => ({ ...e }));
  if (S.dest === 'out') list.push({ type: S.outType, base: S.outBase });
  return list;
}

// { result, runnerUpdates } for scoring.recordPlateAppearance
export function buildSubmission(S) {
  const runnerUpdates = [];
  for (const r of S.runners) {
    const t = S.targets[r.key];
    if (t === 'out') {
      const ob = clamp(toInt(S.runnerOutBase[r.key], r.base + 1), r.base, 4);
      const u = { key: r.key, out: true, eventType: 'RUNNER_OUT', base: ob };
      if (ob - 1 > r.base) u.basesReached = ob - 1;
      runnerUpdates.push(u);
    } else if (typeof t === 'number' && t > r.base) {
      runnerUpdates.push({ key: r.key, basesReached: t });
    }
  }

  let result;
  if (S.isPlaced) {
    result = { resultType: PLACED_TYPE, basesReached: safeBase(S), runnerEvents: eventsForSave(S) };
  } else {
    const rt = typeOf(S);
    const hr = S.resultType === 'HOMERUN';
    result = {
      resultType: S.resultType,
      positions: rt?.needsPositions ? cleanPositions(S.positions) : '',
      rbi: rt?.rbiAllowed ? clamp(toInt(S.rbi, 0), 0, 4) : 0,
      basesReached: !rt || rt.isOut ? 0 : hr ? 4 : safeBase(S),
      runnerEvents: !rt || rt.isOut || hr ? [] : eventsForSave(S),
    };
  }
  if (cellWillBeOut(S)) result.outNumber = displayedOutNumber(S);
  return { result, runnerUpdates };
}

function outNumbersOf(half) {
  const map = {};
  if (half) for (const [k, c] of Object.entries(half)) map[k] = c?.outNumber ?? null;
  return map;
}

// Records the panel's change into `game` (the real game, or a copy for the preview).
// Returns recordPlateAppearance's { half, thirdOut, changedKeys }.
export function applyChange(game, S) {
  const { result, runnerUpdates } = buildSubmission(S);
  const target = { teamKey: S.teamKey, inning: S.inning, key: S.key };
  const res = recordPlateAppearance(game, target, result, runnerUpdates);
  // The engine gives runners put out on the same play the lower numbers; an
  // out number the user picked by hand wins (e.g. a line-drive double play).
  if (S.outNumberTouched && result.outNumber) {
    const half = game.atBats?.[S.teamKey]?.[S.inning];
    const cell = half && half[S.key];
    if (cell && cellState(cell) === 'OUT' && cell.outNumber !== result.outNumber) {
      const before = outNumbersOf(half);
      cell.outNumber = result.outNumber;
      renumberOuts(game, S.teamKey, S.inning, S.key);
      const after = outNumbersOf(half);
      const extra = Object.keys(after).filter(k => before[k] !== after[k]);
      res.changedKeys = [...new Set([...res.changedKeys, ...extra, S.key])];
      res.half = halfInning(game, S.teamKey, S.inning);
    }
  }
  return res;
}

// Runs the change on a deep copy of the game: the cell as it will be saved,
// the runners' cells after the play and the consistency checks of this half-inning.
export function simulate(S) {
  if (!S.isPlaced && !S.resultType) return null;
  let copy;
  let res;
  try {
    copy = JSON.parse(JSON.stringify(S.game));
    res = applyChange(copy, S);
  } catch {
    return null;
  }
  const half = copy.atBats?.[S.teamKey]?.[S.inning] || {};
  const changed = res.changedKeys.filter(k => k !== S.key);
  const rank = x => (x.key === S.key ? 0 : changed.includes(x.key) ? 1 : 2) * 10 + (SEVERITY[x.severity]?.rank ?? 3);
  const issues = validateGame(copy)
    .filter(x => x.teamKey === S.teamKey && Number(x.inning) === S.inning)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
    .map(o => o.x);
  return {
    cell: half[S.key] || null,
    runnerCells: changed.filter(k => half[k]).map(k => ({ key: k, cell: half[k] })),
    issues,
    thirdOut: res.thirdOut,
  };
}

// ============================================
// Rendering (HTML strings)
// ============================================

function titleText(S) {
  const head = inningLabel(S.inning, S.teamKey);
  const who = `${S.orderNum}番${S.playerName ? ' ' + S.playerName : ''}`;
  if (S.isPlaced) return `${head} タイブレークの走者 ${who}`;
  return `${head} ${who}${S.lap >= 1 ? `（${S.lap + 1}巡目）` : ''}`;
}

function teamLine(S) {
  const side = S.teamKey === 'second' ? '後攻' : '先攻';
  return `${side}${S.teamName ? ' ' + S.teamName : ''}の攻撃`;
}

function miniDiamond(occupied) {
  const fill = b => (occupied.has(b) ? 'si-dia-on' : '');
  return `<svg class="si-dia" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M24 6 L42 24 L24 42 L6 24 Z" class="si-dia-path"/>
    <rect x="35" y="19" width="10" height="10" transform="rotate(45 40 24)" class="si-dia-base ${fill(1)}"/>
    <rect x="19" y="3" width="10" height="10" transform="rotate(45 24 8)" class="si-dia-base ${fill(2)}"/>
    <rect x="3" y="19" width="10" height="10" transform="rotate(45 8 24)" class="si-dia-base ${fill(3)}"/>
  </svg>`;
}

function outDots(n) {
  let s = '';
  for (let i = 1; i <= 3; i++) s += `<span class="si-dot${i <= n ? ' on' : ''}"></span>`;
  return s;
}

function renderSituation(S) {
  const team = `<p class="si-sit-team">${escapeHtml(teamLine(S))}</p>`;
  if (S.isPlaced) {
    return `<div class="si-situation">${team}
      <p class="si-help">タイブレークの回に、はじめから<b>${escapeHtml(baseName(S.startBase))}</b>に置かれた走者です。この走者がそのあとどうなったか（進んだ塁・得点・アウト）を選んでください。</p>
    </div>`;
  }
  const outs = S.outsOthers;
  const runners = [...S.runners].sort((a, b) => b.base - a.base);
  const runnerText = runners.length
    ? runners.map(r => `<li><span class="si-base-tag">${escapeHtml(baseName(r.base))}</span>${escapeHtml(r.label)}${r.isPlaced ? '<small>（置きランナー）</small>' : ''}</li>`).join('')
    : '<li class="si-muted">走者なし</li>';
  const heading = S.existing ? 'いまの状況（このマスを除く）' : 'この打者の前の状況';
  const over = outs >= 3
    ? '<p class="si-warn-line">この回はすでに3アウトです。次の回の欄ではありませんか？</p>' : '';
  return `<div class="si-situation">
    ${team}
    <div class="si-sit-box">
      ${miniDiamond(new Set(S.runners.map(r => r.base)))}
      <div class="si-sit-main">
        <p class="si-sit-head">${heading}</p>
        <p class="si-sit-outs"><span class="si-dots" aria-hidden="true">${outDots(Math.min(outs, 3))}</span><b>${outs}アウト</b></p>
        <ul class="si-sit-runners">${runnerText}</ul>
      </div>
    </div>
    ${over}
  </div>`;
}

function symbolHTML(rt) {
  if (rt.id === 'STRIKEOUT_SWING' || rt.id === 'STRIKEOUT_WILD') return '<span class="sym-k">K</span>';
  if (rt.id === 'STRIKEOUT_LOOK') return '<span class="sym-k sym-mirror">K</span>';
  return escapeHtml(rt.symbol || '');
}

function resultButton(rt, selected) {
  const hint = RESULT_HINTS[rt.id];
  return `<button type="button" class="si-rbtn cat-${rt.category}${selected ? ' is-selected' : ''}" data-act="result" data-id="${rt.id}" aria-pressed="${selected}">
    <span class="si-rbtn-sym">${symbolHTML(rt)}</span>
    <span class="si-rbtn-label${rt.label.length >= 8 ? ' is-long' : ''}">${escapeHtml(rt.label)}</span>
    ${hint ? `<span class="si-rbtn-hint">${escapeHtml(hint)}</span>` : ''}
  </button>`;
}

function renderResults(S) {
  if (S.isPlaced) return '';
  const rt = typeOf(S);
  if (rt && !S.resultsOpen) {
    return `<h4 class="si-h">打席の結果</h4>
      <div class="si-result-summary">
        ${resultButton(rt, true).replace('data-act="result"', 'data-act="results-toggle"')}
        <button type="button" class="si-link-btn" data-act="results-toggle">ほかの結果に変える</button>
      </div>`;
  }
  let html = '<h4 class="si-h">打席の結果を選んでください</h4>';
  for (const cat of CATEGORIES) {
    const types = Object.values(RESULT_TYPES).filter(t => t.category === cat.id && t.id !== PLACED_TYPE);
    if (!types.length) continue;
    html += `<div class="si-cat si-cat-${cat.id}"><p class="si-cat-title">${cat.title}</p>
      <div class="si-rgrid">${types.map(t => resultButton(t, t.id === S.resultType)).join('')}</div></div>`;
  }
  return html;
}

function renderFielders(S) {
  const rt = typeOf(S);
  if (S.isPlaced || !rt || !rt.needsPositions) return '';
  const optional = rt.isHit;
  const help = rt.isHit ? HIT_FIELDER_HELP : (FIELDER_HELP[rt.id] || '守備の番号');
  const value = fielderDisplay(S.positions);
  const desc = describeResult(S.resultType, cleanPositions(S.positions));
  const keys = FIELD_KEYS.map(({ k, area }) => `<button type="button" class="si-key si-key-${area}" data-act="key" data-k="${k}">
      <span class="si-key-num">${k}</span><span class="si-key-name">${escapeHtml(POSITION_FIELD_NAMES[k])}</span></button>`).join('');
  return `<h4 class="si-h">守備の番号${optional ? '<small>（わからなければ空でOK）</small>' : ''}</h4>
    <p class="si-help">${escapeHtml(help)}</p>
    <div class="si-fd">
      <span class="si-fd-value${value ? '' : ' is-empty'}" aria-live="polite">${value ? escapeHtml(value) : '未入力'}</span>
      <span class="si-fd-desc">${value && desc ? '→ ' + escapeHtml(desc) : ''}</span>
      <button type="button" class="si-small-btn" data-act="key" data-k="clr"${value ? '' : ' disabled'}>クリア</button>
    </div>
    <div class="si-keypad" role="group" aria-label="守備の番号">
      ${keys}
      <button type="button" class="si-key si-key-dash" data-act="key" data-k="-" aria-label="区切り"><span class="si-key-num">－</span><span class="si-key-name">区切り</span></button>
      <button type="button" class="si-key si-key-bs" data-act="key" data-k="bs" aria-label="1文字消す"><span class="si-key-num">⌫</span><span class="si-key-name">1つ消す</span></button>
    </div>`;
}

function segButton(act, value, label, selected, extra = '') {
  return `<button type="button" class="si-seg-btn${selected ? ' is-selected' : ''}${value === 'out' ? ' is-out' : ''}" data-act="${act}" data-v="${value}"${extra} aria-pressed="${selected}">${label}</button>`;
}

function renderDest(S) {
  if (!runnerCanMove(S)) {
    if (S.resultType === 'HOMERUN') {
      return '<p class="si-info-line">ホームラン：打者も、塁にいた走者も全員ホームに還ります（得点）。</p>';
    }
    return '';
  }
  const min = Math.min(chainTop(S), 4);
  let buttons = '';
  for (let b = S.isPlaced ? S.startBase : 1; b <= 3; b++) {
    const dis = b < min;
    buttons += segButton('dest', b, baseName(b), S.dest === b, dis ? ' disabled' : '');
  }
  buttons += segButton('dest', 4, '得点', S.dest === 4);
  buttons += segButton('dest', 'out', 'アウト', S.dest === 'out', S.dest !== 'out' && !canBeOut(S) ? ' disabled' : '');
  const who = S.isPlaced ? 'この走者' : '打者';
  let sub = '';
  if (S.dest === 'out') {
    const outLabel = RUNNER_EVENTS[S.outType]?.label || '走塁死';
    sub = `<div class="si-subrow"><span class="si-subrow-label">どこでアウト？</span>
      <div class="si-seg si-seg-sm">${outBaseChoices(S).map(b => segButton('outbase', b, baseName(b), S.outBase === b)).join('')}</div></div>
      <p class="si-help">アウトの種類：${escapeHtml(outLabel)}（盗塁死・牽制死のときは、下の「${S.isPlaced ? 'この走者' : 'この選手'}の走塁」で選び直せます）</p>`;
  }
  return `<h4 class="si-h">${who}は最後にどこまで進んだ？</h4>
    <div class="si-seg">${buttons}</div>
    ${sub}
    <p class="si-help">あとの打者のときに進んだ分は、その打者の画面の「ランナー」欄で選べます。</p>`;
}

function renderOutNumber(S) {
  if (!cellWillBeOut(S)) return '';
  const n = displayedOutNumber(S);
  if (n > 3) {
    return `<div class="si-outnum is-over"><p class="si-outnum-text">このアウトは <b>${n}つ目</b> になります。1イニングのアウトは3つまでです。</p></div>`;
  }
  const choices = outNumberChoices(S);
  if (choices.length < 2) {
    return `<div class="si-outnum">
    <p class="si-outnum-text">このアウトは <b class="si-roman">${roman(n)}</b>（${n}アウト目）</p>
  </div>`;
  }
  const btns = choices.map(i =>
    `<button type="button" class="si-onum-btn${i === n ? ' is-selected' : ''}" data-act="outnum" data-v="${i}" aria-pressed="${i === n}" aria-label="${i}アウト目">${roman(i)}</button>`).join('');
  return `<div class="si-outnum">
    <p class="si-outnum-text">このアウトは <b class="si-roman">${roman(n)}</b>（${n}アウト目）</p>
    <div class="si-onum-btns">${btns}</div>
    <p class="si-help">アウトになった順番が違うときだけ変えてください。</p>
  </div>`;
}

function renderRunners(S) {
  if (S.isPlaced || !S.runners.length) return '';
  const rt = typeOf(S);
  const notes = [];
  if (S.existing) notes.push('この打席のときの走者の動きは、記録済みのものがそのまま残っています。変えるときだけ選んでください。');
  if (S.resultType === 'DOUBLE_PLAY') notes.push('<b>併殺打</b>：一緒にアウトになった走者を1人「アウト」にしてください。');
  const thirdOut = batterIsOut(S) && displayedOutNumber(S) >= 3;
  const scoring = S.runners.some(r => S.targets[r.key] === 4);
  if (thirdOut && scoring) notes.push('<span class="si-warn-text">打者のアウトで3アウトなので、この間にホームに入っても得点になりません。</span>');
  else if (rt && !S.existing && S.runners.some(r => !S.touched.has(r.key) && S.targets[r.key] !== 'stay')) {
    notes.push('結果に合わせて自動で選んでいます（「自動」の印）。違うところだけ直してください。');
  }

  const rows = [...S.runners].sort((a, b) => b.base - a.base).map(r => {
    const t = S.targets[r.key];
    const keyAttr = ` data-key="${escapeHtml(r.key)}"`;
    let btns = segButton('runner', 'stay', 'そのまま', t === 'stay', keyAttr);
    for (let b = r.base + 1; b <= 3; b++) btns += segButton('runner', b, baseName(b), t === b, keyAttr);
    btns += segButton('runner', 4, '得点', t === 4, keyAttr);
    btns += segButton('runner', 'out', 'アウト', t === 'out', keyAttr);
    let sub = '';
    if (t === 'out') {
      const ob = S.runnerOutBase[r.key] || Math.min(r.base + 1, 4);
      let obBtns = '';
      for (let b = r.base; b <= 4; b++) obBtns += segButton('runner-outbase', b, baseName(b), ob === b, keyAttr);
      sub = `<div class="si-subrow"><span class="si-subrow-label">どこでアウト？</span><div class="si-seg si-seg-sm">${obBtns}</div></div>`;
    }
    const auto = !S.existing && rt && !S.touched.has(r.key) && t !== 'stay' ? '<span class="si-auto">自動</span>' : '';
    return `<div class="si-runner${t === 'out' ? ' is-out' : t === 4 ? ' is-scored' : ''}">
      <p class="si-runner-name"><span class="si-base-tag">${escapeHtml(baseName(r.base))}</span>${escapeHtml(r.label)}${r.isPlaced ? '<small>（置きランナー）</small>' : ''}${auto}</p>
      <div class="si-seg">${btns}</div>${sub}
    </div>`;
  }).join('');
  return `<h4 class="si-h">ランナー（この打席で走者はどうなった？）</h4>
    ${notes.map(n => `<p class="si-help">${n}</p>`).join('')}
    ${rows}`;
}

function renderRbi(S) {
  const rt = typeOf(S);
  if (S.isPlaced || !rt || !rt.rbiAllowed) return '';
  const sug = rbiSuggestion(S);
  const scored = S.runners.filter(r => S.targets[r.key] === 4).length;
  const hr = S.resultType === 'HOMERUN';
  let hint = '';
  if (S.rbiAuto) {
    hint = scored || hr
      ? `「得点」にした走者${scored}人${hr ? '＋打者自身' : ''}から自動で入れています。`
      : 'ホームに還った走者がいなければ 0 です。';
  } else if (S.rbi !== sug && (!S.existing || S.runnersTouched)) {
    hint = `目安は ${sug} です（「得点」にした走者${scored}人${hr ? '＋打者自身' : ''}）。 <button type="button" class="si-link-btn" data-act="rbi-auto">目安に合わせる</button>`;
  }
  const extra = [];
  if (S.resultType === 'ERROR') extra.push('エラーの間の得点には、ふつう打点はつきません。');
  if (WALK_LIKE.has(S.resultType)) extra.push('打点がつくのは、満塁で押し出しになったときだけ（1点）です。');
  if (S.resultType === 'SACRIFICE_FLY') extra.push('犠牲フライは、三塁走者が還ったときに使います（打点1）。');
  return `<h4 class="si-h">打点</h4>
    <div class="si-stepper">
      <button type="button" class="si-step-btn" data-act="rbi" data-v="-1" aria-label="打点を減らす"${S.rbi <= 0 ? ' disabled' : ''}>−</button>
      <span class="si-rbi-value" aria-live="polite">${S.rbi}</span>
      <button type="button" class="si-step-btn" data-act="rbi" data-v="1" aria-label="打点を増やす"${S.rbi >= 4 ? ' disabled' : ''}>＋</button>
      <span class="si-rbi-unit">点</span>
    </div>
    ${hint ? `<p class="si-help">${hint}</p>` : ''}
    ${extra.map(t => `<p class="si-help">${t}</p>`).join('')}`;
}

function renderEvents(S) {
  if (!runnerCanMove(S) || (!S.isPlaced && !S.resultType)) return '';
  const list = eventsForSave(S);
  const who = S.isPlaced ? 'この走者' : 'この選手';
  if (!S.eventsOpen && !list.length) {
    return `<button type="button" class="si-open-btn" data-act="events-open">＋ ${who}の盗塁・暴投・盗塁死などを記録する</button>`;
  }
  const btn = type => {
    const ev = RUNNER_EVENTS[type];
    const off = ev.isOut ? !canBeOut(S) : !canAdvance(S);
    return `<button type="button" class="si-ev-btn${ev.isOut ? ' is-out' : ''}" data-act="event-add" data-type="${type}" style="--ev:${ev.color}"${off ? ' disabled' : ''}>
      <span class="si-ev-sym">${escapeHtml(ev.symbol)}</span><span class="si-ev-label">${escapeHtml(ev.label.replace(/（.*）$/, ''))}</span></button>`;
  };
  const items = list.map((e, i) => {
    const ev = RUNNER_EVENTS[e.type];
    const label = ev.label.replace(/（.*）$/, '');
    const place = e.base === 4 ? (ev.isOut ? '本塁' : 'ホーム') : baseName(e.base);
    const where = place ? `（${place}${ev.isOut ? 'で' : 'へ'}）` : '';
    return `<li><span class="si-ev-tag" style="--ev:${ev.color}">${escapeHtml(ev.symbol)}</span>
      <span>${escapeHtml(label + where)}</span>
      <button type="button" class="si-ev-remove" data-act="event-remove" data-i="${i}" aria-label="${escapeHtml(ev.label)}を取り消す">✕</button></li>`;
  }).join('');
  return `<h4 class="si-h">${who}の走塁</h4>
    <p class="si-help">このあと盗塁や暴投で進んだとき、盗塁死・牽制死になったときに押します（1回で1つ先の塁へ）。</p>
    <div class="si-ev-btns">${[...ADVANCE_EVENT_TYPES, ...OUT_EVENT_TYPES].map(btn).join('')}</div>
    ${items ? `<ul class="si-ev-list">${items}</ul>` : ''}`;
}

function describeOpts(S) {
  return { playerName: S.playerName, orderNum: S.orderNum, startBase: S.isPlaced ? S.startBase : undefined };
}

function issueItem(x) {
  const sev = SEVERITY[x.severity] || SEVERITY.info;
  return `<li class="si-issue sev-${escapeHtml(x.severity)}"><span class="si-sev">${sev.label}</span><span>${escapeHtml(x.message)}</span></li>`;
}

function renderPreview(S, sim) {
  if (!sim || !sim.cell) {
    return `<h4 class="si-h">記録の確認</h4><p class="si-help">結果を選ぶと、ここにマスの絵と説明が出ます。</p>`;
  }
  const text = describeCell(sim.cell, describeOpts(S));
  const cellHtml = renderCellHTML(sim.cell, { isPlaced: S.isPlaced, startBase: S.startBase || undefined });
  const runnerLines = sim.runnerCells.map(({ key, cell }) => {
    const r = S.runners.find(x => x.key === key);
    const { batterIdx } = parseKey(S.game, S.teamKey, key);
    const idx = r ? r.batterIdx : batterIdx;
    const player = lineupOf(S.game, S.teamKey)[idx];
    return `<li>${escapeHtml(describeCell(cell, { playerName: player?.name || '', orderNum: idx + 1 }))}</li>`;
  }).join('');
  const shown = sim.issues.slice(0, MAX_WARNINGS);
  const more = sim.issues.length - shown.length;
  const issues = sim.issues.length
    ? `<ul class="si-issues">${shown.map(issueItem).join('')}</ul>${more > 0 ? `<p class="si-help">ほかに${more}件あります（記録チェックで確認できます）。</p>` : ''}`
    : '<p class="si-ok">✓ この回の記録に矛盾は見つかりません</p>';
  return `<h4 class="si-h">記録の確認</h4>
    <div class="si-preview">
      <div class="legend-cell si-preview-cell">${cellHtml}</div>
      <p class="si-preview-text">${escapeHtml(text)}</p>
    </div>
    ${runnerLines ? `<p class="si-sub-h">走者の記録</p><ul class="si-runner-lines">${runnerLines}</ul>` : ''}
    ${issues}
    ${sim.thirdOut ? '<p class="si-info-line">これで3アウト・チェンジです。</p>' : ''}`;
}

function renderFooterPreview(S, sim) {
  if (!sim || !sim.cell) return '';
  const text = describeCell(sim.cell, describeOpts(S));
  const n = sim.issues.filter(x => x.severity !== 'info').length;
  const badge = n ? `<span class="si-badge">⚠ ${n}</span>` : '<span class="si-badge ok">✓</span>';
  return `<button type="button" class="si-mini" data-act="goto-preview" aria-label="記録の確認へ">
    <span class="legend-cell si-mini-cell">${renderCellHTML(sim.cell, { forExport: true, isPlaced: S.isPlaced, startBase: S.startBase || undefined })}</span>
    <span class="si-mini-text">${escapeHtml(text)}</span>${badge}</button>`;
}

const SECTIONS = ['situation', 'results', 'fielders', 'dest', 'outnum', 'runners', 'rbi', 'events', 'preview'];

function skeleton(S) {
  return `<div class="si-root">
    <div class="si-scroll">${SECTIONS.map(s => `<section class="si-sec si-sec-${s}" data-sec="${s}"></section>`).join('')}</div>
    <div class="si-footer">
      <div class="si-footer-preview"></div>
      <p class="si-block" id="si-block-msg" role="status"></p>
      <div class="si-btns">
        <button type="button" class="btn btn-secondary si-btn-clear" data-act="clear">クリア</button>
        <button type="button" class="btn btn-secondary si-btn-cancel" data-act="cancel">キャンセル</button>
        <button type="button" class="btn btn-primary si-btn-confirm" data-act="confirm" aria-describedby="si-block-msg">確定</button>
      </div>
    </div>
  </div>`;
}

function render(S) {
  const root = S.root;
  if (!root) return;
  const sim = simulate(S);
  const html = {
    situation: renderSituation(S),
    results: renderResults(S),
    fielders: renderFielders(S),
    dest: renderDest(S),
    outnum: renderOutNumber(S),
    runners: renderRunners(S),
    rbi: renderRbi(S),
    events: renderEvents(S),
    preview: renderPreview(S, sim),
  };
  for (const name of SECTIONS) {
    const el = root.querySelector(`[data-sec="${name}"]`);
    if (!el) continue;
    el.innerHTML = html[name];
    el.hidden = !html[name];
  }
  root.querySelector('.si-footer-preview').innerHTML = renderFooterPreview(S, sim);
  const reason = blockReason(S);
  const block = root.querySelector('.si-block');
  block.textContent = reason;
  block.hidden = !reason;
  block.classList.toggle('is-alert', !!reason && S.alerted);
  const confirm = root.querySelector('.si-btn-confirm');
  confirm.classList.toggle('is-blocked', !!reason);
}

// ============================================
// DOM wiring
// ============================================

let staticBound = false;
let session = null; // state of the panel currently open (replaced on every open)
let downOnBackdrop = false;

// Phone back button: an open panel owns one browser-history entry, so "back"
// closes the panel instead of leaving the app.
let historyEntry = false; // our entry is the current one
let pendingBacks = 0;     // our own history.back() calls whose popstate is still to come

// Ghost taps: the second tap of a quick double tap that opened or closed the
// panel (or folded the result grid) lands on whatever is under the finger by
// then — another cell of the sheet, a keypad key, the backdrop. It is dropped.
const GHOST_MS = 450;
const GHOST_PX = 24;
const ghost = { x: 0, y: 0, until: 0 };
let lastDown = null; // { x, y, t, touch } of the latest pointerdown anywhere

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function armGhostGuard(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  ghost.x = x;
  ghost.y = y;
  ghost.until = now() + GHOST_MS;
}

function dropGhostClick(e) {
  if (!ghost.until || now() > ghost.until) return;
  // only a real double tap: a second click (detail 2) or a touch tap on the same spot
  const doubleTap = e.detail >= 2 || !!lastDown?.touch;
  if (!doubleTap || Math.abs(e.clientX - ghost.x) > GHOST_PX || Math.abs(e.clientY - ghost.y) > GHOST_PX) return;
  ghost.until = 0;
  e.preventDefault();
  e.stopImmediatePropagation();
}

// Bound when the module loads, so the tap that opens the panel the first time is seen.
function bindGlobalOnce() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  document.addEventListener('pointerdown', e => {
    lastDown = { x: e.clientX, y: e.clientY, t: now(), touch: e.pointerType === 'touch' };
  }, true);
  document.addEventListener('click', dropGhostClick, true);
  window.addEventListener('popstate', () => {
    if (pendingBacks > 0) {
      pendingBacks--;
      return;
    }
    if (!historyEntry) return;
    historyEntry = false;
    if (session) closeScoreInput();
  });
}
bindGlobalOnce();

function pushHistoryEntry() {
  if (historyEntry) return;
  try {
    // after a reload with the panel open, the current entry is still ours: reuse it
    if (pendingBacks > 0 || !history.state?.scoreInput) history.pushState({ scoreInput: true }, '');
    historyEntry = true;
  } catch {
    // history not available
  }
}

function dropHistoryEntry() {
  if (!historyEntry) return;
  historyEntry = false;
  try {
    pendingBacks++;
    history.back();
  } catch {
    pendingBacks = Math.max(0, pendingBacks - 1);
  }
}

function els() {
  return {
    modal: document.getElementById('score-input-modal'),
    title: document.getElementById('score-input-title'),
    body: document.getElementById('score-input-body'),
  };
}

function bindStaticOnce(modal) {
  if (staticBound) return;
  staticBound = true;
  const closeBtn = document.getElementById('close-score-input');
  if (closeBtn) {
    closeBtn.addEventListener('click', e => {
      armGhostGuard(e.clientX, e.clientY);
      closeScoreInput();
    });
  }
  // backdrop tap (press and release both on the backdrop, so a scroll that ends there does not close)
  modal.addEventListener('pointerdown', e => { downOnBackdrop = e.target === modal; });
  modal.addEventListener('click', e => {
    if (e.target === modal && downOnBackdrop) {
      armGhostGuard(e.clientX, e.clientY);
      closeScoreInput();
    }
    downOnBackdrop = false;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && session && !modal.classList.contains('hidden')) {
      e.preventDefault();
      closeScoreInput();
    }
  });
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'score-input-title');
  modal.querySelector('.modal-content')?.setAttribute('tabindex', '-1');
}

export function closeScoreInput() {
  const { modal, body } = els();
  session = null;
  if (modal) modal.classList.add('hidden');
  if (body) body.innerHTML = '';
  dropHistoryEntry();
}

function scrollToSection(S, name) {
  const el = S.root?.querySelector(`[data-sec="${name}"]`);
  const scroller = S.root?.querySelector('.si-scroll');
  if (el && scroller && !el.hidden) scroller.scrollTo({ top: Math.max(el.offsetTop - 8, 0), behavior: 'smooth' });
}

function finish(S, res) {
  closeScoreInput();
  if (S.onSave) S.onSave({ thirdOut: !!res.thirdOut, changedKeys: res.changedKeys || [], half: res.half });
}

function onConfirm(S) {
  const reason = blockReason(S);
  if (reason) {
    S.alerted = true;
    render(S);
    scrollToSection(S, !S.resultType && !S.isPlaced ? 'results' : 'runners');
    return;
  }
  let res;
  try {
    res = applyChange(S.game, S);
  } catch (err) {
    console.error(err);
    showToast('記録できませんでした。もう一度お試しください。', 'error');
    return;
  }
  finish(S, res);
}

function onClear(S) {
  if (!S.existing) {
    // nothing saved yet: start the panel over
    const fresh = createState(S.game, { teamKey: S.teamKey, inning: S.inning, key: S.key });
    Object.assign(S, fresh, { root: S.root, onSave: S.onSave, alerted: false });
    render(S);
    return;
  }
  const text = describeCell(S.existing, describeOpts(S));
  const msg = `このマスの記録を消しますか？\n${text ? `（${text}）\n` : ''}ほかの走者のマスは変わりません。`;
  if (!window.confirm(msg)) return;
  let res;
  try {
    res = clearCell(S.game, S.teamKey, S.inning, S.key);
  } catch (err) {
    console.error(err);
    showToast('消せませんでした。もう一度お試しください。', 'error');
    return;
  }
  finish(S, { thirdOut: false, changedKeys: res.changedKeys, half: res.half });
}

// The sections are rebuilt on every tap: keep keyboard focus on the same button
// (or on the panel when it is gone) instead of losing it to the page.
function refocus(S, old) {
  const esc = v => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
  const sel = ['act', 'v', 'key', 'id', 'k', 'type', 'i']
    .filter(n => old.dataset[n] !== undefined)
    .map(n => `[data-${n}="${esc(old.dataset[n])}"]`).join('');
  const next = sel && S.root.querySelector(sel);
  const target = next && !next.disabled ? next : S.root.closest('.modal-content');
  target?.focus({ preventScroll: true });
}

const GHOST_ACTS = new Set(['result', 'results-toggle', 'events-open', 'cancel', 'clear', 'confirm']);

function handleClick(S, e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || session !== S || !S.root.contains(btn) || btn.disabled) return;
  const v = btn.dataset.v;
  const scrollAfter = { name: null };
  // taps that close the panel or move things under the finger
  if (GHOST_ACTS.has(btn.dataset.act) && (btn.dataset.act !== 'result' || S.resultsOpen)) {
    armGhostGuard(e.clientX, e.clientY);
  }
  switch (btn.dataset.act) {
    case 'result': {
      const wasOpen = S.resultsOpen;
      selectResult(S, btn.dataset.id);
      if (wasOpen) scrollAfter.name = 'results';
      break;
    }
    case 'results-toggle': S.resultsOpen = !S.resultsOpen; break;
    case 'key': pressKey(S, btn.dataset.k); break;
    case 'dest': setDest(S, v === 'out' ? 'out' : Number(v)); break;
    case 'outbase': setOutBase(S, Number(v)); break;
    case 'outnum': setOutNumber(S, Number(v)); break;
    case 'runner': setRunnerTarget(S, btn.dataset.key, v === 'stay' || v === 'out' ? v : Number(v)); break;
    case 'runner-outbase': setRunnerOutBase(S, btn.dataset.key, Number(v)); break;
    case 'rbi': stepRbi(S, Number(v)); break;
    case 'rbi-auto': useSuggestedRbi(S); break;
    case 'events-open': S.eventsOpen = true; break;
    case 'event-add': addEvent(S, btn.dataset.type); break;
    case 'event-remove': removeEvent(S, Number(btn.dataset.i)); break;
    case 'goto-preview': scrollToSection(S, 'preview'); return;
    case 'cancel': closeScoreInput(); return;
    case 'clear':
      onClear(S);
      armGhostGuard(e.clientX, e.clientY); // again: the confirm() may have taken a while
      return;
    case 'confirm': onConfirm(S); return;
    default: return;
  }
  const hadFocus = document.activeElement === btn;
  render(S);
  if (hadFocus) refocus(S, btn);
  if (scrollAfter.name) scrollToSection(S, scrollAfter.name);
}

export function openScoreInput(game, target, { onSave } = {}) {
  const { modal, title, body } = els();
  if (!modal || !body || !game || !target || target.key === undefined || target.key === null) return;
  bindStaticOnce(modal);
  // the tap that opened the panel (a sheet cell, "次: 5番"...): its double is a ghost
  if (lastDown && now() - lastDown.t < 1000) armGhostGuard(lastDown.x, lastDown.y);
  const S = createState(game, target);
  S.onSave = typeof onSave === 'function' ? onSave : null;
  S.alerted = false;
  session = S;
  if (title) title.textContent = titleText(S);
  body.innerHTML = skeleton(S);
  S.root = body.firstElementChild;
  S.root.addEventListener('click', e => handleClick(S, e));
  render(S);
  modal.classList.remove('hidden');
  S.root.querySelector('.si-scroll').scrollTop = 0;
  // keyboard focus into the panel (a plain box: no soft keyboard)
  modal.querySelector('.modal-content')?.focus({ preventScroll: true });
  pushHistoryEntry();
}
