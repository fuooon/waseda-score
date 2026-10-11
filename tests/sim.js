// Deterministic game simulator for adversarial scoring tests.
//
// Plays are entered the way the input panel does it: always on the batter that
// liveState()/halfInning().nextBatter points to, with runner moves passed as
// runnerUpdates, and runner-only events (steal, wild pitch, caught stealing,
// pickoff) recorded by re-saving the runner's own cell. Every play is legal, so
// validateGame() must stay empty. An independent model (score, outs, batting
// order, game end) is kept alongside so the engine can be compared with it.

import {
  liveState, halfInning, recordPlateAppearance, ensureTiebreakRunners,
} from '../src/scoring.js';
import { makeGame } from './helpers.js';

// mulberry32: small seeded PRNG
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIEBREAK_BACK = { '1B2B': [[1, 1], [2, 2]], '1B': [[1, 1]], '2B': [[1, 2]] };

// Moves every runner according to `to(base) → newBase` (4 = scored, 'out').
function moveRunners(runners, to) {
  const moves = [];
  for (const r of runners) {
    const dest = to(r.base, r);
    if (dest !== r.base) moves.push({ runner: r, dest });
  }
  return moves;
}

// Forced advance (walk): only runners pushed by the batter move.
function forcedMoves(byBase) {
  const moves = [];
  if (!byBase[1]) return moves;
  if (byBase[2]) {
    if (byBase[3]) moves.push({ runner: byBase[3], dest: 4 });
    moves.push({ runner: byBase[2], dest: 3 });
  }
  moves.push({ runner: byBase[1], dest: 2 });
  return moves;
}

// Chooses one legal play for the current half-inning.
function choosePlay(r, half) {
  const byBase = {};
  for (const x of half.runners) byBase[x.base] = x;
  const runners = half.runners;
  const outs = half.outs;
  const opts = [
    ['K', 4], ['GO', 4], ['FO', 3], ['1B', 4], ['2B', 1.5], ['3B', 0.5], ['HR', 0.5],
    ['BB', 2], ['HBP', 0.5], ['E', 1], ['SW', 0.3],
  ];
  if (outs < 2 && byBase[3]) opts.push(['SF', 1.5]);
  if (outs < 2 && runners.length) opts.push(['SAC', 1.5]);
  if (outs < 2 && byBase[1]) opts.push(['DP', 1.5]);
  if (byBase[1]) opts.push(['FC', 1]);
  if (runners.length) opts.push(['SB', 1], ['WP', 0.6], ['CS', 0.6], ['PO', 0.4]);
  const total = opts.reduce((s, o) => s + o[1], 0);
  let x = r() * total;
  for (const [id, w] of opts) {
    x -= w;
    if (x < 0) return { id, byBase, runners, outs };
  }
  return { id: 'K', byBase, runners, outs };
}

// Builds the engine calls for a play. Returns { calls, scored, outsAdded }.
// call = { key, result, updates } (key undefined = the next batter).
function buildPlay(r, p) {
  const { id, byBase, runners, outs } = p;
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const scoredOf = moves => moves.filter(m => m.dest === 4).length;
  const updatesOf = moves => moves.map(m => (m.dest === 'out'
    ? { key: m.runner.key, out: true }
    : { key: m.runner.key, basesReached: m.dest }));
  // result.out marks a batter out (not sent to the engine's sanitizer as a meaning).
  const pa = (result, moves = []) => ({
    calls: [{ result, updates: updatesOf(moves) }],
    scored: scoredOf(moves) + (result.basesReached === 4 ? 1 : 0),
    outsAdded: (result.out ? 1 : 0) + moves.filter(m => m.dest === 'out').length,
  });
  // Re-saves a runner's own cell with a new event (what the input panel does for a runner).
  const runnerCall = (runner, type, dest) => {
    const c = runner.cell;
    const ev = { type };
    return {
      key: runner.key,
      result: {
        resultType: c.resultType, positions: c.positions, rbi: c.rbi,
        basesReached: dest === 'out' ? c.basesReached : dest,
        runnerEvents: [...c.runnerEvents, dest === 'out' ? ev : { ...ev, base: dest }],
      },
      updates: [],
    };
  };
  switch (id) {
    case 'K': return pa({ resultType: pick(['STRIKEOUT_SWING', 'STRIKEOUT_LOOK']), out: true });
    case 'FO': return pa({ resultType: 'FLYOUT', positions: pick(['7', '8', '9', '6']), out: true });
    case 'GO': {
      const moves = outs < 2 ? moveRunners(runners, b => b + 1) : [];
      return pa({ resultType: 'GROUNDOUT', positions: pick(['6-3', '4-3', '5-3', '1-3']), rbi: scoredOf(moves), out: true }, moves);
    }
    case 'SF': {
      const moves = [{ runner: byBase[3], dest: 4 }];
      return pa({ resultType: 'SACRIFICE_FLY', positions: pick(['7', '8', '9']), rbi: 1, out: true }, moves);
    }
    case 'SAC': {
      const moves = moveRunners(runners, b => b + 1);
      return pa({ resultType: 'SACRIFICE_BUNT', positions: pick(['1-3', '2-3', '5-4']), rbi: scoredOf(moves), out: true }, moves);
    }
    case 'DP': {
      // Runner from first forced at second; with nobody out the others move up (no RBI).
      const moves = [{ runner: byBase[1], dest: 'out' }];
      if (outs === 0) {
        for (const x of runners) if (x.base > 1) moves.push({ runner: x, dest: x.base + 1 });
      }
      return pa({ resultType: 'DOUBLE_PLAY', positions: pick(['6-4-3', '4-6-3', '5-4-3']), out: true }, moves);
    }
    case 'FC': {
      // Runner from first out at second, batter safe at first.
      const moves = [{ runner: byBase[1], dest: 'out' }];
      if (outs < 2 && byBase[2]) {
        if (byBase[3]) moves.push({ runner: byBase[3], dest: 4 });
        moves.push({ runner: byBase[2], dest: 3 });
      }
      return pa({ resultType: 'FIELDERS_CHOICE', positions: '6-4', rbi: scoredOf(moves), basesReached: 1 }, moves);
    }
    case 'BB':
    case 'HBP': {
      const moves = forcedMoves(byBase);
      return pa({ resultType: id === 'BB' ? pick(['WALK', 'WALK', 'INTENTIONAL_WALK']) : 'HIT_BY_PITCH', rbi: scoredOf(moves), basesReached: 1 }, moves);
    }
    case 'SW': {
      // 振り逃げ: batter reaches first; forced runners move up, no RBI.
      const moves = forcedMoves(byBase);
      return pa({ resultType: 'STRIKEOUT_WILD', basesReached: 1 }, moves);
    }
    case 'E': {
      const moves = moveRunners(runners, b => b + 1);
      return pa({ resultType: 'ERROR', positions: pick(['6', '5', '4']), basesReached: 1 }, moves);
    }
    case '1B': {
      const taken = new Set([1]);
      const moves = [];
      for (const x of [...runners].sort((a, b) => b.base - a.base)) {
        let dest = x.base === 3 ? 4 : x.base + (r() < 0.5 ? 1 : 2);
        if (dest > 4) dest = 4;
        while (dest < 4 && taken.has(dest)) dest++;
        if (dest < 4) taken.add(dest);
        moves.push({ runner: x, dest });
      }
      return pa({ resultType: 'SINGLE', positions: pick(['7', '8', '9']), rbi: scoredOf(moves), basesReached: 1 }, moves);
    }
    case '2B': {
      const moves = runners.map(x => ({ runner: x, dest: x.base === 1 ? (r() < 0.5 ? 3 : 4) : 4 }));
      return pa({ resultType: 'DOUBLE', positions: pick(['7', '8', '9']), rbi: scoredOf(moves), basesReached: 2 }, moves);
    }
    case '3B': {
      const moves = runners.map(x => ({ runner: x, dest: 4 }));
      return pa({ resultType: 'TRIPLE', positions: pick(['8', '9']), rbi: scoredOf(moves), basesReached: 3 }, moves);
    }
    case 'HR': {
      const moves = runners.map(x => ({ runner: x, dest: 4 }));
      return pa({ resultType: 'HOMERUN', positions: pick(['7', '8', '9']), rbi: scoredOf(moves) + 1, basesReached: 4 }, moves);
    }
    case 'SB': {
      const free = runners.filter(x => x.base === 3 || !byBase[x.base + 1]);
      if (!free.length) return null;
      const x = pick(free);
      return { calls: [runnerCall(x, 'STOLEN_BASE', x.base + 1)], scored: x.base === 3 ? 1 : 0, outsAdded: 0, runnerOnly: true };
    }
    case 'WP': {
      const sorted = [...runners].sort((a, b) => b.base - a.base);
      return {
        calls: sorted.map(x => runnerCall(x, pick(['WILD_PITCH', 'PASSED_BALL', 'BALK']), x.base + 1)),
        scored: sorted.filter(x => x.base === 3).length, outsAdded: 0, runnerOnly: true,
      };
    }
    case 'CS':
    case 'PO': {
      const x = pick(runners);
      return { calls: [runnerCall(x, id === 'CS' ? 'CAUGHT_STEALING' : 'PICKOFF', 'out')], scored: 0, outsAdded: 1, runnerOnly: true };
    }
    default: return null;
  }
}

// Plays one game. `onStep(game, model)` runs after every play.
// Options: innings, tiebreakerInning, tiebreakerRunners, N (lineup size), maxSteps.
export function simulateGame(seed, options = {}, onStep = null) {
  const r = rng(seed);
  const N = options.N ?? 9;
  const game = makeGame({
    innings: options.innings ?? 7,
    tiebreakerInning: options.tiebreakerInning ?? 0,
    tiebreakerRunners: options.tiebreakerRunners ?? 'none',
  });
  if (N !== 9) {
    game.lineupFirst = game.lineupFirst.slice(0, Math.min(N, 9));
    game.lineupSecond = game.lineupSecond.slice(0, Math.min(N, 9));
    while (game.lineupFirst.length < N) game.lineupFirst.push({ name: `A${game.lineupFirst.length + 1}` });
    while (game.lineupSecond.length < N) game.lineupSecond.push({ name: `B${game.lineupSecond.length + 1}` });
  }
  const regulation = game.innings;

  // Independent model.
  const model = {
    inning: 1, teamKey: 'first', over: false, winner: null, endReason: '',
    score: { first: 0, second: 0 }, outs: 0,
    halfRuns: { first: {}, second: {} },
    halfRbi: { first: {}, second: {} },
    nextIdx: { first: 0, second: 0 }, // batting order slot due up
    plays: [], placedExpected: [],
  };
  const maxSteps = options.maxSteps ?? 1500;

  for (let step = 0; step < maxSteps && !model.over; step++) {
    const live = liveState(game);
    if (live.gameOver) throw new Error(`engine says game over, model does not (step ${step}, ${model.inning} ${model.teamKey})`);
    if (live.inning !== model.inning || live.teamKey !== model.teamKey) {
      throw new Error(`live half ${live.inning}${live.teamKey} != model ${model.inning}${model.teamKey} (seed ${seed}, step ${step})`);
    }
    const { teamKey, inning } = model;
    // Tiebreak: placed runners when the half starts.
    if (model.outs === 0 && !(model.halfRuns[teamKey][inning] >= 0)) {
      model.halfRuns[teamKey][inning] = 0;
      model.halfRbi[teamKey][inning] = 0;
      const created = ensureTiebreakRunners(game, teamKey, inning);
      const tiebreak = options.tiebreakerInning > 0 && inning >= options.tiebreakerInning &&
        options.tiebreakerRunners !== 'none' && tiedBefore(model, inning);
      model.placedExpected = tiebreak
        ? (TIEBREAK_BACK[options.tiebreakerRunners] || []).map(([back, base]) => ({ batterIdx: (model.nextIdx[teamKey] - back + N * 2) % N, base }))
        : [];
      if (created !== (model.placedExpected.length > 0)) {
        throw new Error(`ensureTiebreakRunners returned ${created} at ${inning} ${teamKey} (seed ${seed})`);
      }
      const placed = halfInning(game, teamKey, inning).runners
        .filter(x => x.isPlaced).map(x => ({ batterIdx: x.batterIdx, base: x.base }))
        .sort((a, b) => a.base - b.base);
      const want = [...model.placedExpected].sort((a, b) => a.base - b.base);
      if (JSON.stringify(placed) !== JSON.stringify(want)) {
        throw new Error(`placed runners ${JSON.stringify(placed)} != ${JSON.stringify(want)} at ${inning} ${teamKey} (seed ${seed})`);
      }
    }
    const half = halfInning(game, teamKey, inning);
    if (!half.nextBatter) throw new Error(`no next batter in a live half (seed ${seed})`);
    if (half.nextBatter.batterIdx !== model.nextIdx[teamKey]) {
      throw new Error(`next batter ${half.nextBatter.batterIdx} != model ${model.nextIdx[teamKey]} at ${inning} ${teamKey} (seed ${seed})`);
    }

    // Choose a play; in a walk-off spot, a non-HR play may not score more than the winning run.
    let play = null;
    for (let tries = 0; tries < 20 && !play; tries++) {
      const p = choosePlay(r, half);
      const built = buildPlay(r, p);
      if (!built) continue;
      if (teamKey === 'second' && inning >= regulation && p.id !== 'HR') {
        const needed = model.score.first - model.score.second + 1;
        if (built.scored > needed) continue;
      }
      // A run on the play that makes the third out does not count (5.08(a)): skip such plays.
      if (model.outs + built.outsAdded >= 3 && built.scored > 0) continue;
      play = built;
      play.id = p.id;
    }
    if (!play) play = { ...buildPlay(r, { id: 'K', byBase: {}, runners: [], outs: model.outs }), id: 'K' };

    let last = null;
    for (const call of play.calls) {
      const key = call.key ?? half.nextBatter.key;
      last = recordPlateAppearance(game, { teamKey, inning, key }, call.result, call.updates);
    }
    model.plays.push({ inning, teamKey, id: play.id, scored: play.scored });
    if (!play.runnerOnly) model.nextIdx[teamKey] = (model.nextIdx[teamKey] + 1) % N;
    model.score[teamKey] += play.scored;
    model.halfRuns[teamKey][inning] += play.scored;
    model.halfRbi[teamKey][inning] += play.calls.reduce((s, c) => s + (c.key === undefined ? (c.result.rbi || 0) : 0), 0);
    const outsBefore = model.outs;
    model.outs += play.outsAdded;
    model.lastResult = last;
    model.thirdOutExpected = outsBefore < 3 && model.outs >= 3;

    advanceModel(model, regulation);
    if (onStep) onStep(game, model, last, { ...play, inning, teamKey });
  }
  if (!model.over) throw new Error(`game did not end in ${maxSteps} plays (seed ${seed})`);
  return { game, model };
}

function tiedBefore(model, inning) {
  let f = 0;
  let s = 0;
  for (let i = 1; i < inning; i++) {
    f += model.halfRuns.first[i] || 0;
    s += model.halfRuns.second[i] || 0;
  }
  return f === s;
}

// Game flow per spec §7: skip the bottom half, walk-off, extra innings, 12-inning cap.
function advanceModel(model, regulation) {
  const { score } = model;
  const n = model.inning;
  if (model.teamKey === 'second' && n >= regulation && score.second > score.first) {
    model.over = true;
    model.endReason = 'walkoff';
    model.winner = 'second';
    model.endAt = { inning: n, teamKey: 'second' };
    return;
  }
  if (model.outs < 3) return;
  if (model.teamKey === 'first') {
    if (n >= regulation && score.second > score.first) {
      model.over = true;
      model.endReason = 'regulation';
      model.winner = 'second';
      model.skipBottomInning = n;
      model.endAt = { inning: n, teamKey: 'first' };
      return;
    }
    model.teamKey = 'second';
  } else {
    if ((n >= regulation && score.first !== score.second) || n >= 12) {
      model.over = true;
      model.endReason = 'regulation';
      model.winner = score.first > score.second ? 'first' : score.second > score.first ? 'second' : null;
      model.endAt = { inning: n, teamKey: 'second' };
      return;
    }
    model.teamKey = 'first';
    model.inning = n + 1;
  }
  model.outs = 0;
}

