// ============================================
// Scoring engine
// ============================================
//
// Pure functions over a game object: a GameData instance or plain parsed JSON
// with the same fields. Nothing here touches the DOM or storage, and this
// module imports only rules.js (data.js imports this module, never the reverse).
//
// The rules and worked examples live in docs/scoring-rules.md; the examples are
// encoded as tests in tests/scoring.test.js.
//
// Vocabulary
//   half-inning  (teamKey, inning). 'first' bats in the top (表), 'second' in the bottom (裏).
//   cell         atBats[teamKey][inning][key]: everything one player did in that half-inning
//                (the plate appearance and what happened to him afterwards as a runner).
//   key          String(batterIdx + N * lap) for plate appearances (lap 1 = batting around),
//                'tb' + batterIdx for a runner placed on base by the tiebreak rule.
//   state        'OUT' | 'SCORED' | 'ON_BASE' | 'EMPTY' (no result chosen yet).
//   order        position in the batting order of the half-inning:
//                lap * N + ((batterIdx - leadoff + N) % N); placed runners are negative.

import { RESULT_TYPES, RUNNER_EVENTS, DEFAULT_INNINGS, MAX_INNINGS } from './rules.js';

const TEAM_KEYS = ['first', 'second'];
const PLACED_TYPE = 'TIEBREAK_RUNNER';
const PLACED_PREFIX = 'tb';
const BASE_NAMES = { 1: '一塁', 2: '二塁', 3: '三塁', 4: '本塁' };
const END_REASONS = ['', 'regulation', 'walkoff', 'called', 'time'];
const TIEBREAK_RUNNERS = ['none', '1B', '1B2B', '2B'];

// back = how many slots before the leadoff batter; base = where he is placed.
const TIEBREAK_LAYOUTS = {
  '1B2B': [{ back: 1, base: 1 }, { back: 2, base: 2 }],
  '1B': [{ back: 1, base: 1 }],
  '2B': [{ back: 1, base: 2 }],
};

const WALK_TYPES = new Set(['WALK', 'INTENTIONAL_WALK', 'HIT_BY_PITCH', 'INTERFERENCE']);
const BB_TYPES = new Set(['WALK', 'INTENTIONAL_WALK', 'HIT_BY_PITCH']);
const STRIKEOUT_TYPES = new Set(['STRIKEOUT_SWING', 'STRIKEOUT_LOOK', 'STRIKEOUT_WILD']);
const NEEDS_LESS_THAN_TWO_OUTS = new Set(['SACRIFICE_BUNT', 'SACRIFICE_FLY', 'INFIELD_FLY', 'DOUBLE_PLAY']);
const NEEDS_RUNNER = new Set(['SACRIFICE_BUNT', 'SACRIFICE_FLY', 'DOUBLE_PLAY', 'FIELDERS_CHOICE']);
const RBI_WARNING_TYPES = new Set(['FLYOUT', 'LINEOUT']);
// What a sacrifice-like result would be with two outs (C09 message).
const TWO_OUT_ALTERNATIVE = {
  SACRIFICE_BUNT: 'ゴロ（またはフライ）のアウト',
  SACRIFICE_FLY: 'フライアウト',
  INFIELD_FLY: 'フライアウト',
  DOUBLE_PLAY: 'ゴロのアウト',
};

// ============================================
// Small helpers
// ============================================

function toInt(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function toInning(inning) {
  const n = toInt(inning, 1);
  return n >= 1 ? n : 1;
}

function toTeam(teamKey) {
  return teamKey === 'second' ? 'second' : 'first';
}

function otherTeam(teamKey) {
  return teamKey === 'second' ? 'first' : 'second';
}

function halfName(teamKey) {
  return teamKey === 'second' ? 'bottom' : 'top';
}

function isObject(v) {
  return !!v && typeof v === 'object';
}

function eventsOf(cell) {
  return Array.isArray(cell?.runnerEvents) ? cell.runnerEvents : [];
}

function countEvents(cell, flag) {
  return eventsOf(cell).filter(e => RUNNER_EVENTS[e?.type]?.[flag]).length;
}

function basesOf(cell) {
  return toInt(cell?.basesReached, 0);
}

function rbiOf(cell) {
  return Math.max(0, toInt(cell?.rbi, 0));
}

function validOutNumber(value) {
  const n = toInt(value, 0);
  return n >= 1 ? n : null;
}

function isPlacedKey(key) {
  return String(key).startsWith(PLACED_PREFIX);
}

function lineupOf(game, teamKey) {
  const lineup = teamKey === 'second' ? game?.lineupSecond : game?.lineupFirst;
  return Array.isArray(lineup) ? lineup : [];
}

function teamAtBats(game, teamKey) {
  const team = game?.atBats?.[teamKey];
  return isObject(team) ? team : {};
}

function halfCells(game, teamKey, inning) {
  const half = teamAtBats(game, teamKey)[inning];
  return isObject(half) ? half : null;
}

function regulationInnings(game) {
  const n = toInt(game?.innings, 0);
  return n > 0 ? n : DEFAULT_INNINGS;
}

// ============================================
// Labels (also handy for UI text)
// ============================================

// '3回表' / '3回裏'
export function inningLabel(inning, teamKey) {
  return `${inning}回${teamKey === 'second' ? '裏' : '表'}`;
}

// '4番' or '4番 田中' when the lineup has a name.
export function batterLabel(game, teamKey, batterIdx) {
  const player = lineupOf(game, teamKey)[batterIdx];
  const name = player && typeof player.name === 'string' ? player.name.trim() : '';
  return `${batterIdx + 1}番${name ? ' ' + name : ''}`;
}

// ============================================
// Cells
// ============================================

export function lineupSize(game, teamKey) {
  return lineupOf(game, teamKey).length || 9;
}

export function isPlacedRunner(cell) {
  return isObject(cell) && cell.resultType === PLACED_TYPE;
}

export function isPlateAppearance(cell) {
  return isObject(cell) && !!cell.resultType && !isPlacedRunner(cell);
}

export function isBatterOut(cell) {
  return isObject(cell) && RESULT_TYPES[cell.resultType]?.isOut === true;
}

// Out after reaching base: an out runner event, or (legacy data) a non-out
// plate appearance whose basesReached is 0.
export function isRunnerOut(cell) {
  if (!isObject(cell) || !cell.resultType || isBatterOut(cell)) return false;
  if (countEvents(cell, 'isOut') > 0) return true;
  return isPlateAppearance(cell) && basesOf(cell) === 0;
}

export function cellState(cell) {
  if (!isObject(cell) || !cell.resultType) return 'EMPTY';
  if (isBatterOut(cell) || isRunnerOut(cell)) return 'OUT';
  return basesOf(cell) === 4 ? 'SCORED' : 'ON_BASE';
}

// ============================================
// Keys
// ============================================

export function parseKey(game, teamKey, key) {
  const s = String(key);
  if (isPlacedKey(s)) {
    const b = parseInt(s.slice(PLACED_PREFIX.length), 10);
    return { batterIdx: Number.isFinite(b) ? b : 0, lap: 0, isPlaced: true };
  }
  const k = Number(s);
  if (!Number.isInteger(k) || k < 0) return { batterIdx: -1, lap: 0, isPlaced: false };
  const N = lineupSize(game, teamKey);
  return { batterIdx: k % N, lap: Math.floor(k / N), isPlaced: false };
}

export function keyFor(game, teamKey, batterIdx, lap = 0) {
  return String(batterIdx + lineupSize(game, teamKey) * lap);
}

export function placedKey(batterIdx) {
  return PLACED_PREFIX + batterIdx;
}

// Entries of one half-inning: placed runners first (2B runner before 1B runner),
// then everyone else in batting order.
function buildEntries(raw, N, leadoff) {
  const entries = [];
  if (!raw) return entries;
  for (const [key, cell] of Object.entries(raw)) {
    if (!isObject(cell)) continue;
    let batterIdx;
    let lap = 0;
    let isPlaced;
    if (isPlacedKey(key)) {
      isPlaced = true;
      batterIdx = parseInt(key.slice(PLACED_PREFIX.length), 10);
      if (!Number.isFinite(batterIdx)) batterIdx = toInt(cell.batterIdx, 0);
    } else {
      const k = Number(key);
      if (!Number.isInteger(k) || k < 0) continue;
      isPlaced = isPlacedRunner(cell);
      batterIdx = isPlaced && Number.isInteger(cell.batterIdx) ? cell.batterIdx : k % N;
      lap = isPlaced ? 0 : Math.floor(k / N);
    }
    batterIdx = ((batterIdx % N) + N) % N;
    const rel = (batterIdx - leadoff + N) % N;
    const order = isPlaced ? rel - N : lap * N + rel;
    entries.push({ key, batterIdx, lap, order, cell, state: cellState(cell), isPlaced });
  }
  entries.sort((a, b) => (a.isPlaced === b.isPlaced ? a.order - b.order : a.isPlaced ? -1 : 1));
  return entries;
}

// ============================================
// Game analysis (computed from scratch on every query; games are tiny)
// ============================================

function basicHalf(game, teamKey, inning, leadoff, N) {
  const cells = buildEntries(halfCells(game, teamKey, inning), N, leadoff);
  const seq = cells.filter(e => !e.isPlaced && isPlateAppearance(e.cell));
  const h = {
    teamKey, inning, N, leadoff, cells, seq,
    outs: 0, runs: 0, rbi: 0, hits: 0, pa: 0, ab: 0, onBase: 0, errors: 0, placed: 0,
  };
  for (const e of cells) {
    if (e.state === 'OUT') h.outs++;
    else if (e.state === 'SCORED') h.runs++;
    else if (e.state === 'ON_BASE') h.onBase++;
    if (e.isPlaced) h.placed++;
    h.errors += countEvents(e.cell, 'chargesError');
  }
  for (const e of seq) {
    const type = RESULT_TYPES[e.cell.resultType];
    h.pa++;
    if (!type || type.isAtBat) h.ab++;
    if (type?.isHit) h.hits++;
    if (type?.chargesError) h.errors++;
    h.rbi += rbiOf(e.cell);
  }
  // Placed runners alone do not start a half-inning (they may be created
  // before the first pitch); anything that happened to them does.
  h.activity = cells.some(e => !e.isPlaced || eventsOf(e.cell).length > 0 || e.state !== 'ON_BASE');
  return h;
}

function lastInningWithData(game) {
  let last = 0;
  for (const teamKey of TEAM_KEYS) {
    for (const [inn, half] of Object.entries(teamAtBats(game, teamKey))) {
      const n = toInt(inn, 0);
      if (n >= 1 && isObject(half) && Object.values(half).some(isObject)) last = Math.max(last, n);
    }
  }
  return last;
}

function analyze(game, upTo = 0) {
  const regulation = regulationInnings(game);
  const lastData = lastInningWithData(game);
  const columns = Math.max(regulation, lastData);
  const limit = Math.max(columns, toInt(upTo, 0)) + 1;
  const halves = { first: [], second: [] };

  // Batting order continuity: each half starts after the last batter of the
  // team's latest earlier half that has plate appearances (spec §4).
  for (const teamKey of TEAM_KEYS) {
    const N = lineupSize(game, teamKey);
    let leadoff = 0;
    let prevLast = null;
    for (let n = 1; n <= limit; n++) {
      const h = basicHalf(game, teamKey, n, leadoff, N);
      h.prevLastBatterIdx = prevLast;
      halves[teamKey][n] = h;
      if (h.seq.length) {
        prevLast = h.seq[h.seq.length - 1].batterIdx;
        leadoff = (prevLast + 1) % N;
      }
    }
  }

  const order = [];
  for (let n = 1; n <= limit; n++) order.push(halves.first[n], halves.second[n]);
  let later = false;
  for (let i = order.length - 1; i >= 0; i--) {
    const h = order[i];
    h.index = i;
    h.laterActivity = later;
    h.done = h.outs >= 3 || later;
    if (h.activity) later = true;
  }

  const A = { game, regulation, lastData, columns, limit, halves, order };
  A.end = computeEnd(A);
  for (const h of order) h.complete = h.outs >= 3 || h.laterActivity || h.index === A.end.endIndex;
  return A;
}

function runsThrough(A, teamKey, index) {
  let sum = 0;
  for (const h of A.halves[teamKey]) if (h && h.index <= index) sum += h.runs;
  return sum;
}

// Game-end rules (spec §7).
function computeEnd(A) {
  const { game, halves, regulation, limit, order } = A;
  const teamActive = teamKey => halves[teamKey].some(h => h && h.activity);
  let found = null;

  // Rule-based ending needs both teams recorded (a parent may score only their own team).
  if (teamActive('first') && teamActive('second')) {
    let f = 0;
    let s = 0;
    for (let n = 1; n <= limit; n++) {
      const top = halves.first[n];
      const bottom = halves.second[n];
      if (!top.done) break;
      f += top.runs;
      if (n >= regulation && s > f) {
        found = { half: top, reason: 'regulation', skipBottomInning: n };
        break;
      }
      if (n >= regulation && bottom.activity && s + bottom.runs > f) {
        found = { half: bottom, reason: 'walkoff' };
        break;
      }
      if (!bottom.done) break;
      s += bottom.runs;
      if ((n >= regulation && f !== s) || n >= MAX_INNINGS) {
        found = { half: bottom, reason: 'regulation' };
        break;
      }
    }
  }

  const markedFinal = game?.status === 'final';
  if (!found && markedFinal) {
    // Ended by the user (called game, time limit, ...): at the last half-inning played.
    let last = null;
    for (const h of order) if (h.activity) last = h;
    found = { half: last, reason: '' };
    if (last && last.teamKey === 'first' &&
        runsThrough(A, 'second', last.index) > runsThrough(A, 'first', last.index)) {
      found.skipBottomInning = last.inning;
    }
  }

  if (!found) {
    return { final: false, endReason: '', computedReason: '', winner: null, skipBottomInning: null, endIndex: -1, endAt: null, runsAtEnd: null };
  }

  const skip = found.skipBottomInning ?? null;
  const total = teamKey => halves[teamKey].reduce(
    (sum, h) => (h && !(teamKey === 'second' && h.inning === skip) ? sum + h.runs : sum), 0);
  const runs = { first: total('first'), second: total('second') };
  const winner = runs.first > runs.second ? 'first' : runs.second > runs.first ? 'second' : null;
  const endIndex = found.half ? found.half.index : -1;
  const storedReason = markedFinal && END_REASONS.includes(game.endReason) ? game.endReason : '';
  return {
    final: true,
    endReason: storedReason || found.reason,
    computedReason: found.reason,
    winner,
    skipBottomInning: skip,
    endIndex,
    endAt: found.half ? { inning: found.half.inning, teamKey: found.half.teamKey } : null,
    runsAtEnd: { first: runsThrough(A, 'first', endIndex), second: runsThrough(A, 'second', endIndex) },
  };
}

function tiebreakLayout(game) {
  return TIEBREAK_LAYOUTS[game?.tiebreakerRunners] || null;
}

// The inning is played under the tiebreak rule: configured, reached, and tied when it started.
function isTiebreakHalf(A, inning) {
  const start = toInt(A.game?.tiebreakerInning, 0);
  if (!(start > 0) || inning < start || !tiebreakLayout(A.game)) return false;
  let f = 0;
  let s = 0;
  for (let i = 1; i < inning; i++) {
    f += A.halves.first[i]?.runs || 0;
    s += A.halves.second[i]?.runs || 0;
  }
  return f === s;
}

function expectedPlacedRunners(game, leadoff, N) {
  const layout = tiebreakLayout(game) || [];
  return layout.map(x => ({ batterIdx: (((leadoff - x.back) % N) + N) % N, base: x.base }));
}

function isSkipped(A, h) {
  return h.teamKey === 'second' && A.end.skipBottomInning === h.inning;
}

function publicHalf(A, teamKey, inning) {
  const h = A.halves[teamKey][inning];
  const E = A.end;
  const gameOver = E.final && h.index >= E.endIndex;
  const skipped = isSkipped(A, h);
  const last = h.seq.length ? h.seq[h.seq.length - 1] : null;

  let nextBatter = null;
  if (h.outs < 3 && !gameOver && !skipped) {
    const next = last ? last.order + 1 : 0;
    const lap = Math.floor(next / h.N);
    const batterIdx = (h.leadoff + (next % h.N)) % h.N;
    nextBatter = { batterIdx, lap, key: String(batterIdx + h.N * lap) };
  }

  const runners = h.cells
    .filter(e => e.state === 'ON_BASE')
    .map(e => ({ key: e.key, batterIdx: e.batterIdx, base: basesOf(e.cell), cell: e.cell, order: e.order, isPlaced: e.isPlaced }))
    .sort((a, b) => a.base - b.base || a.order - b.order);

  return {
    teamKey,
    inning,
    N: h.N,
    leadoff: h.leadoff,
    isTiebreak: isTiebreakHalf(A, inning),
    cells: h.cells,
    seq: h.seq,
    outs: h.outs,
    runs: h.runs,
    rbi: h.rbi,
    hits: h.hits,
    pa: h.pa,
    ab: h.ab,
    lob: h.complete ? h.onBase : 0,
    errors: h.errors,
    placed: h.placed,
    runners,
    started: h.activity,
    complete: h.complete,
    skipped,
    gameOver,
    nextBatter,
    lastBatterIdx: last ? last.batterIdx : null,
  };
}

// ============================================
// Queries
// ============================================

export function leadoffFor(game, teamKey, inning) {
  const n = toInning(inning);
  if (n <= 1) return 0;
  return analyze(game, n).halves[toTeam(teamKey)][n].leadoff;
}

export function halfInning(game, teamKey, inning) {
  const n = toInning(inning);
  return publicHalf(analyze(game, n), toTeam(teamKey), n);
}

function inningRunsFrom(A, teamKey, inning) {
  const h = A.halves[teamKey][inning];
  if (!h) return null;
  if (isSkipped(A, h)) return 'X';
  return h.activity ? h.runs : null;
}

// number | null (not started) | 'X' (bottom half not needed)
export function inningRuns(game, teamKey, inning) {
  const n = toInning(inning);
  return inningRunsFrom(analyze(game, n), toTeam(teamKey), n);
}

export function isTiebreakInning(game, inning) {
  const n = toInning(inning);
  return isTiebreakHalf(analyze(game, n), n);
}

function teamTotalsFrom(A, teamKey) {
  const t = { runs: 0, hits: 0, errors: 0, lob: 0, rbi: 0, pa: 0, ab: 0 };
  for (const h of A.halves[teamKey]) {
    if (!h || isSkipped(A, h)) continue;
    t.runs += h.runs;
    t.hits += h.hits;
    t.rbi += h.rbi;
    t.pa += h.pa;
    t.ab += h.ab;
    if (h.complete) t.lob += h.onBase;
  }
  // Errors committed by this team while fielding = errors charged in the opponent's half-innings.
  for (const h of A.halves[otherTeam(teamKey)]) {
    if (h && !isSkipped(A, h)) t.errors += h.errors;
  }
  return t;
}

export function teamTotals(game, teamKey) {
  return teamTotalsFrom(analyze(game), toTeam(teamKey));
}

export function scoreboard(game) {
  const A = analyze(game);
  const maxInning = A.columns;
  const columns = Array.from({ length: maxInning }, (_, i) => i + 1);
  const line = teamKey => {
    const t = teamTotalsFrom(A, teamKey);
    return {
      innings: columns.map(n => inningRunsFrom(A, teamKey, n)),
      R: t.runs,
      H: t.hits,
      E: t.errors,
      LOB: t.lob,
    };
  };
  return {
    maxInning,
    columns,
    first: line('first'),
    second: line('second'),
    final: A.end.final,
    winner: A.end.winner,
    endReason: A.end.endReason,
  };
}

export function gameEndState(game) {
  const E = analyze(game).end;
  return {
    final: E.final,
    endReason: E.endReason,
    winner: E.winner,
    skipBottomInning: E.skipBottomInning,
    endAt: E.endAt, // { inning, teamKey } of the half-inning the game ended in (null while in progress)
  };
}

export function liveState(game) {
  const A = analyze(game);
  const E = A.end;
  const make = (teamKey, inning, gameOver) => ({
    inning,
    half: halfName(teamKey),
    teamKey,
    halfInning: publicHalf(A, teamKey, inning),
    gameOver,
    endReason: gameOver ? E.endReason : '',
    winner: gameOver ? E.winner : null,
  });
  if (E.final) {
    const at = E.endAt || { inning: 1, teamKey: 'first' };
    return make(at.teamKey, at.inning, true);
  }
  for (const h of A.order) {
    if (!h.complete) return make(h.teamKey, h.inning, false);
  }
  const last = A.order[A.order.length - 1];
  return make(last.teamKey, last.inning, false);
}

export function playerLine(game, teamKey, batterIdx) {
  const A = analyze(game);
  const t = toTeam(teamKey);
  const b = toInt(batterIdx, -1);
  const line = { pa: 0, ab: 0, h: 0, rbi: 0, r: 0, bb: 0, so: 0, lob: 0 };
  for (const h of A.halves[t]) {
    if (!h || isSkipped(A, h)) continue;
    for (const e of h.cells) {
      if (e.batterIdx !== b) continue;
      if (e.state === 'SCORED') line.r++;
      if (e.state === 'ON_BASE' && h.complete) line.lob++;
      if (e.isPlaced || !isPlateAppearance(e.cell)) continue;
      const rt = e.cell.resultType;
      const type = RESULT_TYPES[rt];
      line.pa++;
      if (!type || type.isAtBat) line.ab++;
      if (type?.isHit) line.h++;
      line.rbi += rbiOf(e.cell);
      if (BB_TYPES.has(rt)) line.bb++;
      if (STRIKEOUT_TYPES.has(rt)) line.so++;
    }
  }
  return line;
}

export function nextOutNumber(game, teamKey, inning, excludeKey = null) {
  const raw = halfCells(game, toTeam(teamKey), toInning(inning));
  const skip = excludeKey === null || excludeKey === undefined ? null : String(excludeKey);
  let outs = 0;
  if (raw) {
    for (const [key, cell] of Object.entries(raw)) {
      if (key !== skip && cellState(cell) === 'OUT') outs++;
    }
  }
  return outs + 1;
}

// ============================================
// Consistency checks (spec §8)
// ============================================

function halfSortIndex(issue) {
  return (issue.inning - 1) * 2 + (issue.teamKey === 'second' ? 1 : 0);
}

export function validateGame(game) {
  const A = analyze(game);
  const issues = [];
  for (const h of A.order) {
    if (h.cells.length) checkHalf(A, h, issues);
  }
  checkGameEnd(A, issues);
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => halfSortIndex(a.issue) - halfSortIndex(b.issue) ||
      a.issue.id.localeCompare(b.issue.id) || a.i - b.i)
    .map(x => x.issue);
}

function checkHalf(A, h, issues) {
  const { game } = A;
  const inn = inningLabel(h.inning, h.teamKey);
  const who = b => batterLabel(game, h.teamKey, b);
  const at = e => `${inn} ${who(e.batterIdx)}：`;
  const add = (id, severity, key, message) => issues.push({
    id, severity, teamKey: h.teamKey, inning: h.inning, key: key === null || key === undefined ? null : String(key), message,
  });
  const endedHere = A.end.final && A.end.endIndex === h.index;

  // C01: RBIs can never exceed runs.
  if (h.rbi > h.runs) {
    add('C01', 'error', null, `${inn}：打点が${h.rbi}なのに得点は${h.runs}点です。ホームに還った走者のマスを開いて『得点』を選んでください。`);
  }

  // C02: at most three runners, one per base.
  const onBase = h.cells.filter(e => e.state === 'ON_BASE');
  if (onBase.length > 3) {
    add('C02', 'error', null, `${inn}：塁上に${onBase.length}人いることになっています（塁は3つだけです）。還った走者は『得点』、アウトになった走者は『走塁死』にしてください。`);
  }
  for (let base = 1; base <= 3; base++) {
    const same = onBase.filter(e => basesOf(e.cell) === base);
    if (same.length >= 2) {
      const names = same.map(e => who(e.batterIdx)).join('と');
      add('C02', h.complete ? 'error' : 'warning', same[same.length - 1].key,
        `${inn}：${names}が${same.length === 2 ? '両方とも' : '全員'}${BASE_NAMES[base]}にいます。押し出された走者の塁を進めてください。`);
    }
  }

  // C03: a finished half-inning has three outs (unless the game ended in it).
  if (h.complete && h.activity && h.outs < 3 && !endedHere) {
    const head = h.outs === 0
      ? `${inn}はアウトが1つも記録されていません。`
      : `${inn}はアウトが${h.outs}つしか記録されていません。`;
    add('C03', 'error', null, head + '三振・ゴロの入力漏れや、盗塁死・走塁死・併殺でアウトになった走者の記入漏れがないか確認してください。');
  }

  // C04: out count and out numbers.
  if (h.outs > 3) {
    add('C04', 'error', null, `${inn}：アウトが${h.outs}つあります。1イニングのアウトは3つまでです。`);
  }
  const byNumber = new Map();
  for (const e of h.cells) {
    const raw = e.cell.outNumber;
    const has = raw !== null && raw !== undefined && raw !== '';
    const num = Number(raw);
    // Shown in messages only when it reads as a number (never "NaN" or junk).
    const shown = has && Number.isFinite(num) ? String(raw) : '';
    if (e.state !== 'OUT') {
      if (has) {
        add('C04', 'error', e.key, shown
          ? `${at(e)}アウトではないのに「${shown}アウト目」の印が付いています。`
          : `${at(e)}アウトではないのに、アウトの印が付いています。`);
      }
      continue;
    }
    if (!has) {
      add('C04', 'error', e.key, `${at(e)}アウトですが、何アウト目かが記録されていません。`);
      continue;
    }
    if (!Number.isInteger(num) || num < 1 || num > 3) {
      if (!(h.outs > 3 && num > 3)) {
        add('C04', 'error', e.key, `${at(e)}アウトの番号${shown ? `（${shown}）` : ''}が正しくありません。1〜3のどれかです。`);
      }
      continue;
    }
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(e);
  }
  for (const [num, list] of byNumber) {
    if (list.length >= 2) {
      add('C04', 'error', list[list.length - 1].key, `${inn}：「${num}アウト目」が${list.length}人います。マスを開いてアウトの順番を直してください。`);
    }
  }

  // C06 / C07: batting order starts at the leadoff and has no gaps.
  const slots = h.cells.filter(e => !e.isPlaced);
  if (slots.length && slots[0].order !== 0) {
    const prev = h.prevLastBatterIdx;
    add('C06', 'error', slots[0].key,
      `${inn}の先頭打者は${who(h.leadoff)}のはずです` +
      (prev !== null ? `（前の回は${who(prev)}で終わりました）` : '') +
      `。${who(slots[0].batterIdx)}から記録されています。`);
  } else {
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].order !== slots[i - 1].order + 1) {
        add('C07', 'error', slots[i].key,
          `${inn}：${who(slots[i - 1].batterIdx)}の次に${who(slots[i].batterIdx)}が記録されていて、間の打者の結果が空いています。`);
      }
    }
  }

  // Per plate appearance, in batting order.
  let batterOuts = 0;
  let safeBefore = 0;
  let runnerOuts = h.cells.filter(e => e.isPlaced && e.state === 'OUT').length;
  let doublePlays = 0;
  for (const e of h.seq) {
    const c = e.cell;
    const rt = c.resultType;
    const type = RESULT_TYPES[rt];
    const label = type ? type.label : String(rt);
    const rbi = rbiOf(c);
    const outsBefore = batterOuts;                 // BO_before (lower bound of outs)
    const runnersBefore = h.placed + safeBefore;   // RB_before (upper bound of runners)

    // C05
    if (outsBefore >= 3) {
      add('C05', 'error', e.key, `${inn}：3アウトでチェンジした後に${who(e.batterIdx)}の打席が入っています。次の回の欄ではありませんか？`);
    }

    // C08
    if (rt === 'DOUBLE_PLAY') {
      doublePlays++;
      if (runnerOuts < doublePlays) {
        add('C08', 'error', e.key, `${at(e)}併殺打ですが、一緒にアウトになった走者のマスに『走塁死』が付いていません。`);
      }
    }

    // C09
    if (NEEDS_LESS_THAN_TWO_OUTS.has(rt) && outsBefore >= 2) {
      add('C09', 'error', e.key, `${at(e)}2アウトからは${label}になりません。普通の${TWO_OUT_ALTERNATIVE[rt]}です。`);
    } else if (NEEDS_RUNNER.has(rt) && runnersBefore === 0) {
      add('C09', 'error', e.key, `${at(e)}ランナーがいないのに${label}になっています。`);
    } else if (rt === 'INFIELD_FLY' && runnersBefore < 2) {
      add('C09', 'error', e.key, `${at(e)}インフィールドフライは0・1アウトで一・二塁か満塁のときだけです。`);
    }

    // C10
    if (rt === 'SACRIFICE_FLY' && rbi < 1) {
      add('C10', 'error', e.key, `${at(e)}犠牲フライは走者が還ったときだけ使います。打点を1にして、還った走者を『得点』にしてください（得点がなければ普通のフライアウトです）。`);
    }

    // C11
    if (rbi > 0) {
      if (type && !type.rbiAllowed && !RBI_WARNING_TYPES.has(rt)) {
        add('C11', 'error', e.key, `${at(e)}${label}には打点がつきません。`);
      } else if (isBatterOut(c) && validOutNumber(c.outNumber) === 3) {
        add('C11', 'error', e.key, `${at(e)}3アウト目のアウトの間の得点は認められません。打点を0にしてください。`);
      } else if (RBI_WARNING_TYPES.has(rt)) {
        add('C11', 'warning', e.key, `${at(e)}${label}で点が入ったなら『犠飛』では？`);
      } else if (rt === 'ERROR') {
        add('C11', 'warning', e.key, `${at(e)}エラーの間の得点には普通は打点がつきません。`);
      }
    }

    // C12
    if (rt === 'HOMERUN' && (basesOf(c) !== 4 || rbi < 1)) {
      add('C12', 'error', e.key, `${at(e)}ホームランは打者自身も得点し、打点は1以上です。`);
    }
    if (WALK_TYPES.has(rt)) {
      if (rbi > 1) {
        add('C12', 'error', e.key, `${at(e)}${label}の打点は最大1点（押し出し）です。`);
      } else if (rbi === 1 && runnersBefore < 3) {
        add('C12', 'error', e.key, `${at(e)}押し出しは満塁のときだけです。`);
      }
    } else if (rbi > 0) {
      const isHR = rt === 'HOMERUN';
      const max = Math.min(isHR ? 4 : 3, runnersBefore + (isHR ? 1 : 0));
      if (rbi > max) add('C12', 'error', e.key, `${at(e)}打点${rbi}は、塁上の走者の数から考えて多すぎます。`);
    }

    // C13
    if (isBatterOut(c) && (basesOf(c) > 0 || eventsOf(c).length > 0)) {
      add('C13', 'error', e.key, `${at(e)}${label}でアウトなのに、塁に出た（盗塁などの）記録があります。`);
    }

    // C15
    if (e.state === 'ON_BASE' || e.state === 'SCORED') {
      const advances = countEvents(c, 'advances');
      const expected = Math.min(4, (type ? type.bases : 1) + advances);
      if (basesOf(c) < expected) {
        add('C15', 'warning', e.key,
          `${at(e)}${label}${advances ? '（と盗塁など）' : ''}で${BASE_NAMES[expected]}まで進んだはずですが、${BASE_NAMES[basesOf(c)] || '塁に出ていない'}のままです。`);
      }
    }

    // C18 (info): legacy runner out without a reason.
    if (!isBatterOut(c) && basesOf(c) === 0 && countEvents(c, 'isOut') === 0) {
      add('C18', 'info', e.key, `${at(e)}アウトになった理由（盗塁死・走塁死）を記録すると、後で見返しやすくなります。`);
    }

    if (isBatterOut(c)) batterOuts++;
    else safeBefore++;
    if (isRunnerOut(c)) runnerOuts++;
  }

  // C14 and C18 (any cell)
  for (const e of h.cells) {
    const outEvents = countEvents(e.cell, 'isOut');
    if (outEvents > 1) {
      add('C14', 'error', e.key, `${at(e)}アウトの記録が${outEvents}つあります。走者がアウトになるのは1回だけです。`);
    } else if (outEvents === 1 && basesOf(e.cell) === 4) {
      add('C14', 'error', e.key, `${at(e)}『得点』と『アウト』の両方が記録されています。`);
    }
    if (!e.isPlaced && e.state === 'EMPTY') {
      add('C18', 'warning', e.key, `${at(e)}打席結果が選ばれていません。`);
    }
  }

  // C19: tiebreak runners.
  const placedEntries = h.cells.filter(e => e.isPlaced);
  if (!isTiebreakHalf(A, h.inning)) {
    if (placedEntries.length) {
      add('C19', 'warning', placedEntries[0].key, `${inn}はタイブレークの回ではないのに、置きランナーが入っています。`);
    }
  } else {
    const expected = expectedPlacedRunners(game, h.leadoff, h.N);
    const ok = placedEntries.length === expected.length && expected.every(x =>
      placedEntries.some(e => e.batterIdx === x.batterIdx && basesOf(e.cell) >= x.base));
    if (!ok) {
      const list = expected.map(x => `${who(x.batterIdx)}（${BASE_NAMES[x.base]}）`).join('と');
      add('C19', 'warning', placedEntries.length ? placedEntries[0].key : null,
        `${inn}：タイブレークの最初のランナーは${list}のはずです。`);
    }
  }
}

function checkGameEnd(A, issues) {
  const E = A.end;
  if (!E.final || E.endIndex < 0) return;
  const endHalf = A.order[E.endIndex];
  const endLabel = inningLabel(endHalf.inning, endHalf.teamKey) + (E.computedReason === 'walkoff' ? '（サヨナラ）' : '');

  // C16: records after the game ended.
  for (const h of A.order) {
    if (h.index <= E.endIndex || !h.activity) continue;
    const inn = inningLabel(h.inning, h.teamKey);
    const firstCell = h.cells.find(e => !e.isPlaced) || h.cells[0];
    const message = isSkipped(A, h)
      ? `${inn}：${h.inning}回表を終えて後攻チームがリードしているので、${h.inning}回裏の攻撃はありません（スコアボードは X）。`
      : `${inn}：試合はすでに${endLabel}で終わっているので、この回の記録は不要です。`;
    issues.push({ id: 'C16', severity: 'error', teamKey: h.teamKey, inning: h.inning, key: firstCell ? firstCell.key : null, message });
  }

  // C17: a walk-off ends when the winning run scores (except on a home run).
  if (E.computedReason === 'walkoff') {
    const margin = E.runsAtEnd.second - E.runsAtEnd.first;
    const last = endHalf.seq[endHalf.seq.length - 1];
    // RBIs prove the winning run had scored by the end of that plate appearance,
    // so nobody can bat after it.
    const needed = E.runsAtEnd.first - (E.runsAtEnd.second - endHalf.runs) + 1;
    let rbi = 0;
    const winning = endHalf.seq.findIndex(e => (rbi += rbiOf(e.cell)) >= needed);
    const after = winning >= 0 ? endHalf.seq[winning + 1] : null;
    if (after) {
      const who = b => batterLabel(A.game, endHalf.teamKey, b);
      issues.push({
        id: 'C17', severity: 'warning', teamKey: endHalf.teamKey, inning: endHalf.inning, key: after.key,
        message: `${inningLabel(endHalf.inning, endHalf.teamKey)}：${who(endHalf.seq[winning].batterIdx)}の打席で勝ち越し点が入り、その時点で試合終了（サヨナラ）です。そのあとの${who(after.batterIdx)}の打席は記録しないでください。`,
      });
    } else if (margin >= 2 && (!last || last.cell.resultType !== 'HOMERUN')) {
      issues.push({
        id: 'C17', severity: 'warning', teamKey: endHalf.teamKey, inning: endHalf.inning, key: last ? last.key : null,
        message: `${inningLabel(endHalf.inning, endHalf.teamKey)}：サヨナラの場合、勝ち越し点が入った時点で試合終了です（本塁打を除く）。その後の得点や打者が入っていないか確認してください。`,
      });
    }
  }
}

// ============================================
// Mutations
// ============================================

function ensureHalfObject(game, teamKey, inning) {
  if (!isObject(game.atBats)) game.atBats = { first: {}, second: {} };
  if (!isObject(game.atBats[teamKey])) game.atBats[teamKey] = {};
  if (!isObject(game.atBats[teamKey][inning])) game.atBats[teamKey][inning] = {};
  return game.atBats[teamKey][inning];
}

function snapshot(raw) {
  const s = {};
  if (raw) for (const [key, cell] of Object.entries(raw)) s[key] = JSON.stringify(cell);
  return s;
}

function diffKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(k => before[k] !== after[k]);
}

function countOutsIn(raw) {
  return raw ? Object.values(raw).filter(c => cellState(c) === 'OUT').length : 0;
}

function sanitizeEvents(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(e => isObject(e) && RUNNER_EVENTS[e.type])
    .map(e => {
      const event = { type: e.type };
      const base = toInt(e.base, 0);
      if (base >= 1 && base <= 4) event.base = base;
      if (typeof e.description === 'string' && e.description) event.description = e.description;
      return event;
    });
}

// Builds a plate-appearance cell from an input-panel result.
function sanitizeResult(result, existing) {
  const rt = RESULT_TYPES[result.resultType] && result.resultType !== PLACED_TYPE ? result.resultType : null;
  const type = RESULT_TYPES[rt];
  const cell = {
    resultType: rt,
    positions: '',
    rbi: 0,
    basesReached: 0,
    outNumber: null,
    runnerEvents: [],
    note: result.note !== undefined && result.note !== null ? String(result.note) : (existing?.note || ''),
  };
  if (!type) {
    // No result chosen: keep what is known about the runner (flagged by C18).
    cell.basesReached = clamp(toInt(result.basesReached, 0), 0, 4);
    cell.runnerEvents = sanitizeEvents(result.runnerEvents);
    return cell;
  }
  cell.positions = type.needsPositions && result.positions !== undefined && result.positions !== null
    ? String(result.positions).trim()
    : '';
  cell.rbi = type.rbiAllowed ? clamp(toInt(result.rbi, 0), 0, 4) : 0;
  if (type.isOut) {
    cell.basesReached = 0;
    cell.runnerEvents = [];
  } else if (rt === 'HOMERUN') {
    cell.basesReached = 4;
    cell.runnerEvents = sanitizeEvents(result.runnerEvents);
  } else {
    cell.basesReached = clamp(toInt(result.basesReached, type.bases), 0, 4);
    cell.runnerEvents = sanitizeEvents(result.runnerEvents);
  }
  return cell;
}

function placedCellFrom(game, teamKey, key, existing, result) {
  const batterIdx = isPlacedKey(key) ? parseKey(game, teamKey, key).batterIdx : toInt(existing?.batterIdx, parseKey(game, teamKey, key).batterIdx);
  const cell = existing || {
    resultType: PLACED_TYPE, positions: '', rbi: 0, basesReached: 1, outNumber: null, runnerEvents: [], note: '', batterIdx,
  };
  cell.resultType = PLACED_TYPE;
  if (!Number.isInteger(cell.batterIdx)) cell.batterIdx = batterIdx;
  if (result.basesReached !== undefined && result.basesReached !== null && result.basesReached !== '') {
    cell.basesReached = clamp(toInt(result.basesReached, basesOf(cell) || 1), 1, 4);
  }
  if (Array.isArray(result.runnerEvents)) cell.runnerEvents = sanitizeEvents(result.runnerEvents);
  if (result.note !== undefined && result.note !== null) cell.note = String(result.note);
  return cell;
}

// Gives an out its number: an explicit choice, else the number it already had,
// else the next free one. Non-outs lose their number.
function assignOutNumber(game, teamKey, inning, key, cell, previous, explicit = null) {
  if (cellState(cell) !== 'OUT') {
    cell.outNumber = null;
    return;
  }
  if (explicit !== null) cell.outNumber = explicit;
  else if (previous !== null) cell.outNumber = previous;
  else cell.outNumber = nextOutNumber(game, teamKey, inning, key);
}

// Where a runner was put out, when the input panel does not say.
function guessOutBase(type, cell) {
  const b = basesOf(cell);
  if (type === 'PICKOFF') return b >= 1 && b <= 3 ? b : null;
  return b >= 0 && b <= 3 ? b + 1 : null;
}

function applyRunnerUpdate(game, teamKey, inning, raw, batterKey, update) {
  if (!isObject(update) || update.key === undefined || update.key === null) return null;
  const key = String(update.key);
  const cell = raw[key];
  if (key === batterKey || !isObject(cell) || isBatterOut(cell)) return null;
  const wasOut = cellState(cell) === 'OUT';
  const previous = wasOut ? validOutNumber(cell.outNumber) : null;

  if (update.basesReached !== undefined && update.basesReached !== null && update.basesReached !== '') {
    cell.basesReached = clamp(toInt(update.basesReached, basesOf(cell)), 1, 4);
  }
  if (update.out === true) {
    const events = eventsOf(cell).slice();
    if (!events.some(e => RUNNER_EVENTS[e?.type]?.isOut)) {
      const type = RUNNER_EVENTS[update.eventType]?.isOut ? update.eventType : 'RUNNER_OUT';
      const event = { type };
      const base = update.base !== undefined && update.base !== null
        ? clamp(toInt(update.base, 1), 1, 4)
        : guessOutBase(type, cell);
      if (base) event.base = base;
      events.push(event);
    }
    cell.runnerEvents = events;
    if (basesOf(cell) === 4) cell.basesReached = 3; // an out runner did not score
  } else if (update.out === false) {
    cell.runnerEvents = eventsOf(cell).filter(e => !RUNNER_EVENTS[e?.type]?.isOut);
  }
  assignOutNumber(game, teamKey, inning, key, cell, previous);
  return key;
}

// Records (or re-records) one cell. Runner updates are applied first so that on a
// double play the runner gets the lower out number.
// result.outNumber counts as an explicit choice only when it differs from the number
// the engine would give by default (the cell's existing number, or nextOutNumber
// before the runner updates) — so an input panel may always pass the displayed value.
export function recordPlateAppearance(game, target, result = {}, runnerUpdates = []) {
  if (target?.key === undefined || target?.key === null || target?.key === '') {
    throw new TypeError('recordPlateAppearance: target.key is required');
  }
  const teamKey = toTeam(target.teamKey);
  const inning = toInning(target.inning);
  const key = String(target.key);
  const res = isObject(result) ? result : {};
  const raw = ensureHalfObject(game, teamKey, inning);
  const before = snapshot(raw);
  const outsBefore = countOutsIn(raw);

  const existing = isObject(raw[key]) ? raw[key] : null;
  const wasOut = cellState(existing) === 'OUT';
  const previous = wasOut ? validOutNumber(existing.outNumber) : null;
  const defaultNumber = previous !== null ? previous : nextOutNumber(game, teamKey, inning, key);
  const requested = validOutNumber(res.outNumber);
  const explicit = requested !== null && requested !== defaultNumber ? requested : null;

  // Lead runner first, so that when one play retires two runners the out numbers
  // do not depend on the order the input panel listed them in.
  const updates = (Array.isArray(runnerUpdates) ? runnerUpdates : [])
    .map((update, i) => ({ update, i, base: isObject(update) ? basesOf(raw[String(update.key)]) : 0 }))
    .sort((a, b) => b.base - a.base || a.i - b.i);
  for (const { update } of updates) {
    applyRunnerUpdate(game, teamKey, inning, raw, key, update);
  }

  const placed = isPlacedKey(key) || isPlacedRunner(existing) || res.resultType === PLACED_TYPE;
  const cell = placed ? placedCellFrom(game, teamKey, key, existing, res) : sanitizeResult(res, existing);
  raw[key] = cell;
  assignOutNumber(game, teamKey, inning, key, cell, previous, explicit);
  renumberOuts(game, teamKey, inning, explicit !== null ? key : null);

  const half = halfInning(game, teamKey, inning);
  return {
    half,
    thirdOut: outsBefore < 3 && half.outs >= 3,
    changedKeys: diffKeys(before, snapshot(game.atBats[teamKey][inning])),
  };
}

export function clearCell(game, teamKey, inning, key) {
  const t = toTeam(teamKey);
  const n = toInning(inning);
  const k = String(key);
  const raw = halfCells(game, t, n);
  const before = snapshot(raw);
  if (raw && Object.prototype.hasOwnProperty.call(raw, k)) {
    delete raw[k];
    if (Object.keys(raw).length === 0) delete game.atBats[t][n];
    else renumberOuts(game, t, n);
  }
  return {
    half: halfInning(game, t, n),
    changedKeys: diffKeys(before, snapshot(halfCells(game, t, n))),
  };
}

// Keeps out numbers 1..k without gaps in their current order (ties: batting order;
// outs without a number go last). Non-outs lose their number.
// priorityKey: the out whose number the user just chose; it ends up with exactly that
// number (or the last one when it is too high) and the other outs shift around it.
export function renumberOuts(game, teamKey, inning, priorityKey = null) {
  const t = toTeam(teamKey);
  const n = toInning(inning);
  const raw = halfCells(game, t, n);
  if (!raw) return;
  const entries = buildEntries(raw, lineupSize(game, t), leadoffFor(game, t, n));
  const rank = new Map(entries.map((e, i) => [e.key, i]));
  const pk = priorityKey === null || priorityKey === undefined ? null : String(priorityKey);
  const outs = [];
  let pinned = null;
  for (const e of entries) {
    if (e.state !== 'OUT') {
      if (e.cell.outNumber !== null && e.cell.outNumber !== undefined) e.cell.outNumber = null;
    } else if (e.key === pk) {
      pinned = e;
    } else {
      outs.push(e);
    }
  }
  outs.sort((a, b) => {
    const na = validOutNumber(a.cell.outNumber);
    const nb = validOutNumber(b.cell.outNumber);
    if (na !== nb) {
      if (na === null) return 1;
      if (nb === null) return -1;
      return na - nb;
    }
    return rank.get(a.key) - rank.get(b.key);
  });
  if (pinned) {
    const wanted = validOutNumber(pinned.cell.outNumber);
    outs.splice(wanted === null ? outs.length : Math.min(wanted - 1, outs.length), 0, pinned);
  }
  outs.forEach((e, i) => { e.cell.outNumber = i + 1; });
}

// Places the tiebreak runners (continuing batting order, spec §4) when the inning
// is a tiebreak inning, the previous inning is complete, the game is not over and
// no placed runner exists yet. Returns true when cells were created.
export function ensureTiebreakRunners(game, teamKey, inning) {
  const t = toTeam(teamKey);
  const n = toInning(inning);
  const A = analyze(game, n);
  if (!isTiebreakHalf(A, n)) return false;
  if (n > 1 && !(A.halves.first[n - 1].complete && A.halves.second[n - 1].complete)) return false;
  const h = A.halves[t][n];
  if (A.end.final && h.index >= A.end.endIndex) return false;
  if (h.cells.some(e => e.isPlaced)) return false;

  const raw = ensureHalfObject(game, t, n);
  let changed = false;
  for (const x of expectedPlacedRunners(game, h.leadoff, h.N)) {
    const key = placedKey(x.batterIdx);
    if (raw[key]) continue;
    raw[key] = {
      resultType: PLACED_TYPE, positions: '', rbi: 0, basesReached: x.base,
      outNumber: null, runnerEvents: [], note: '', batterIdx: x.batterIdx,
    };
    changed = true;
  }
  return changed;
}

// ============================================
// Migration of saved games
// ============================================

function normalizeCell(cell) {
  cell.resultType = typeof cell.resultType === 'string' && cell.resultType ? cell.resultType : null;
  cell.positions = cell.positions === undefined || cell.positions === null ? '' : String(cell.positions);
  cell.rbi = Math.max(0, toInt(cell.rbi, 0));
  cell.basesReached = clamp(toInt(cell.basesReached, 0), 0, 4);
  cell.outNumber = validOutNumber(cell.outNumber);
  cell.runnerEvents = sanitizeEvents(cell.runnerEvents);
  cell.note = cell.note === undefined || cell.note === null ? '' : String(cell.note);
}

// Brings a saved game (any version) to the v2 model. Mutates and returns it.
export function normalizeGame(game) {
  if (!isObject(game)) return game;
  const legacy = game.version !== 2;
  delete game.outsInInning;

  if (!isObject(game.atBats)) game.atBats = {};
  for (const teamKey of TEAM_KEYS) {
    if (!isObject(game.atBats[teamKey])) game.atBats[teamKey] = {};
    const team = game.atBats[teamKey];
    for (const [inn, half] of Object.entries(team)) {
      if (!isObject(half) || toInt(inn, 0) < 1) {
        delete team[inn];
        continue;
      }
      for (const [key, cell] of Object.entries(half)) {
        if (isObject(cell)) normalizeCell(cell);
        else delete half[key];
      }
      if (Object.keys(half).length === 0) delete team[inn];
    }
  }

  const innings = toInt(game.innings, 0);
  game.innings = innings > 0 ? innings : DEFAULT_INNINGS;
  game.status = game.status === 'final' ? 'final' : 'in_progress';
  game.endReason = END_REASONS.includes(game.endReason) ? game.endReason : '';
  game.tiebreakerInning = Math.max(0, toInt(game.tiebreakerInning, 0));
  game.tiebreakerRunners = TIEBREAK_RUNNERS.includes(game.tiebreakerRunners) ? game.tiebreakerRunners : 'none';
  if (typeof game.gameResult !== 'string') game.gameResult = '';
  if (!Array.isArray(game.lineupFirst)) game.lineupFirst = [];
  if (!Array.isArray(game.lineupSecond)) game.lineupSecond = [];
  if (typeof game.pitcherFirst !== 'string') game.pitcherFirst = '';
  if (typeof game.pitcherSecond !== 'string') game.pitcherSecond = '';
  if (!Array.isArray(game.substitutions)) game.substitutions = [];
  game.useDH = !!game.useDH;
  game.currentInning = Math.max(1, toInt(game.currentInning, 1));
  game.currentHalf = game.currentHalf === 'bottom' ? 'bottom' : 'top';
  if (typeof game.lineupDone !== 'boolean') {
    // Before v2 the lineup was saved only when both teams were entered.
    game.lineupDone = game.lineupFirst.length > 0 && game.lineupSecond.length > 0;
  }

  // Out numbers: v1 numbered them with one global counter, so renumber legacy
  // games in batting order; v2 numbers keep their order and are only compacted.
  for (const teamKey of TEAM_KEYS) {
    for (const inn of Object.keys(game.atBats[teamKey])) {
      if (legacy) {
        for (const cell of Object.values(game.atBats[teamKey][inn])) cell.outNumber = null;
      }
      renumberOuts(game, teamKey, inn);
    }
  }

  game.version = 2;
  return game;
}
