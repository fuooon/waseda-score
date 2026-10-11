import { describe, it, expect } from 'vitest';
import {
  cleanPositions, pressFielderKey, defaultRunnerTargets, suggestRbi, runnersBefore,
  createState, selectResult, setDest, setRunnerTarget, setRunnerOutBase, stepRbi, useSuggestedRbi,
  setOutNumber, pressKey, addEvent, removeEvent, buildSubmission, applyChange, blockReason,
  displayedOutNumber, outNumberChoices, cellWillBeOut, simulate,
} from '../src/score-input.js';
import { halfInning } from '../src/scoring.js';
import { makeGame, cells } from './helpers.js';

const top1 = key => ({ teamKey: 'first', inning: 1, key: String(key) });

function gameWith(specs, overrides = {}) {
  return makeGame({ atBats: { first: { 1: cells(specs) }, second: {} }, ...overrides });
}

function record(game, key, setup) {
  const S = createState(game, top1(key));
  setup(S);
  return { S, res: applyChange(game, S) };
}

const at = (game, key) => game.atBats.first[1][String(key)];

// ============================================
// Keypad
// ============================================

describe('fielder keypad', () => {
  it('builds a path from taps, normalising on save', () => {
    let raw = '';
    for (const k of ['6', '3']) raw = pressFielderKey(raw, k);
    expect(raw).toBe('63');
    expect(cleanPositions(raw)).toBe('6-3');
    raw = pressFielderKey(raw, 'bs');
    expect(raw).toBe('6');
    raw = pressFielderKey(pressFielderKey(raw, '-'), '-');
    expect(raw).toBe('6-');
    expect(cleanPositions(raw)).toBe('6');
    expect(pressFielderKey('', '-')).toBe('');
    expect(pressFielderKey('6-4', 'clr')).toBe('');
    expect(pressFielderKey('6', 'x')).toBe('6');
  });

  it('keeps legacy free text that is not a fielder path', () => {
    expect(cleanPositions('左中間')).toBe('左中間');
    expect(cleanPositions(' 6-4-3 ')).toBe('6-4-3');
  });
});

// ============================================
// Runner defaults and RBI
// ============================================

describe('defaultRunnerTargets', () => {
  const R = (key, base) => ({ key, base });

  it('home run sends everybody home', () => {
    expect(defaultRunnerTargets('HOMERUN', 4, [R('a', 1), R('b', 3)])).toEqual({ a: 4, b: 4 });
  });

  it('walks move only forced runners', () => {
    expect(defaultRunnerTargets('WALK', 1, [R('a', 1), R('b', 2), R('c', 3)])).toEqual({ a: 2, b: 3, c: 4 });
    expect(defaultRunnerTargets('HIT_BY_PITCH', 1, [R('a', 1), R('c', 3)])).toEqual({ a: 2, c: 'stay' });
    expect(defaultRunnerTargets('INTENTIONAL_WALK', 1, [R('b', 2)])).toEqual({ b: 'stay' });
  });

  it('hits push runners only as far as needed to make room for the batter', () => {
    expect(defaultRunnerTargets('SINGLE', 1, [R('b', 2)])).toEqual({ b: 'stay' });
    expect(defaultRunnerTargets('DOUBLE', 2, [R('a', 1), R('b', 2)])).toEqual({ a: 3, b: 4 });
  });

  it('outs leave runners alone, except sacrifices and a lone runner on a double play', () => {
    expect(defaultRunnerTargets('GROUNDOUT', 0, [R('a', 1)])).toEqual({ a: 'stay' });
    expect(defaultRunnerTargets('SACRIFICE_FLY', 0, [R('a', 1), R('c', 3)])).toEqual({ a: 'stay', c: 4 });
    expect(defaultRunnerTargets('SACRIFICE_BUNT', 0, [R('a', 1), R('b', 2)])).toEqual({ a: 2, b: 3 });
    expect(defaultRunnerTargets('SACRIFICE_BUNT', 0, [R('b', 2), R('c', 3)])).toEqual({ b: 'stay', c: 'stay' });
    expect(defaultRunnerTargets('DOUBLE_PLAY', 0, [R('a', 1)])).toEqual({ a: 'out' });
    expect(defaultRunnerTargets('DOUBLE_PLAY', 0, [R('a', 1), R('c', 3)])).toEqual({ a: 'stay', c: 'stay' });
  });
});

describe('suggestRbi', () => {
  it('counts runners sent home, plus the batter on a home run', () => {
    expect(suggestRbi('SINGLE', { a: 4, b: 3 })).toBe(1);
    expect(suggestRbi('HOMERUN', { a: 4, b: 4 })).toBe(3);
    expect(suggestRbi('HOMERUN', {})).toBe(1);
  });

  it('is 0 where no RBI is credited', () => {
    expect(suggestRbi('DOUBLE_PLAY', { a: 4 })).toBe(0);
    expect(suggestRbi('ERROR', { a: 4 })).toBe(0);
    expect(suggestRbi('GROUNDOUT', { a: 4 }, { thirdOut: true })).toBe(0);
    expect(suggestRbi('GROUNDOUT', { a: 4 })).toBe(1);
  });
});

describe('runnersBefore', () => {
  it('keeps placed runners and earlier batters, never this cell', () => {
    const half = { runners: [
      { key: 'tb8', order: -1, isPlaced: true, base: 2 },
      { key: '0', order: 0, base: 1 },
      { key: '2', order: 2, base: 1 },
    ] };
    expect(runnersBefore(half, '1', 1).map(r => r.key)).toEqual(['tb8', '0']);
    expect(runnersBefore(half, '0', 0).map(r => r.key)).toEqual(['tb8']);
  });
});

// ============================================
// Scenarios through the engine
// ============================================

describe('recording through the panel', () => {
  it('single with the runner on second scoring: RBI 1 suggested and recorded', () => {
    const game = gameWith({ 0: { resultType: 'DOUBLE', positions: '7', basesReached: 2 } });
    const { S, res } = record(game, 1, s => {
      selectResult(s, 'SINGLE');
      pressKey(s, '8');
      expect(s.targets['0']).toBe('stay');
      setRunnerTarget(s, '0', 4);
      expect(s.rbi).toBe(1);
    });
    expect(S.runners.map(r => r.key)).toEqual(['0']);
    expect(at(game, 0).basesReached).toBe(4);
    expect(at(game, 1)).toMatchObject({ resultType: 'SINGLE', positions: '8', rbi: 1, basesReached: 1 });
    expect(res.half.runs).toBe(1);
    expect(res.changedKeys.sort()).toEqual(['0', '1']);
  });

  it('home run with two on: three runs, RBI 3', () => {
    const game = gameWith({
      0: { resultType: 'SINGLE', positions: '7', basesReached: 2 },
      1: { resultType: 'WALK', basesReached: 1 },
    });
    const { res } = record(game, 2, s => {
      selectResult(s, 'HOMERUN');
      expect(s.rbi).toBe(3);
    });
    expect(res.half.runs).toBe(3);
    expect(at(game, 2)).toMatchObject({ resultType: 'HOMERUN', rbi: 3, basesReached: 4 });
  });

  it('double play: needs exactly one runner out; runner gets Ⅰ, batter Ⅱ', () => {
    const game = gameWith({
      0: { resultType: 'SINGLE', positions: '7', basesReached: 2 },
      1: { resultType: 'WALK', basesReached: 1 },
    });
    // runners on 1st (key 1) and 2nd (key 0)
    const S = createState(game, top1(2));
    selectResult(S, 'DOUBLE_PLAY');
    expect(blockReason(S)).toMatch(/1人/);
    setRunnerTarget(S, '1', 'out');
    setRunnerTarget(S, '0', 'out');
    expect(blockReason(S)).toMatch(/1人だけ/);
    setRunnerTarget(S, '0', 3);
    expect(blockReason(S)).toBe('');
    expect(displayedOutNumber(S)).toBe(2);
    expect(S.rbi).toBe(0);
    const res = applyChange(game, S);
    expect(res.half.outs).toBe(2);
    expect(at(game, 1).outNumber).toBe(1);
    expect(at(game, 1).runnerEvents).toEqual([{ type: 'RUNNER_OUT', base: 2 }]);
    expect(at(game, 2).outNumber).toBe(2);
    expect(at(game, 0).basesReached).toBe(3);
  });

  it('double play with no runner is blocked', () => {
    const S = createState(gameWith({}), top1(0));
    selectResult(S, 'DOUBLE_PLAY');
    expect(blockReason(S)).toMatch(/走者がいない/);
  });

  it('walk with the bases loaded forces the runners and suggests RBI 1', () => {
    const game = gameWith({
      0: { resultType: 'SINGLE', positions: '7', basesReached: 3 },
      1: { resultType: 'SINGLE', positions: '8', basesReached: 2 },
      2: { resultType: 'WALK', basesReached: 1 },
    });
    const { res } = record(game, 3, s => {
      selectResult(s, 'WALK');
      expect(s.targets).toEqual({ 0: 4, 1: 3, 2: 2 });
      expect(s.rbi).toBe(1);
    });
    expect(res.half.runs).toBe(1);
    expect(res.half.runners.map(r => [r.key, r.base])).toEqual([['3', 1], ['2', 2], ['1', 3]]);
    expect(at(game, 3).rbi).toBe(1);
  });

  it('editing an out keeps its number', () => {
    const game = gameWith({
      0: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 1 },
      1: { resultType: 'FLYOUT', positions: '8', outNumber: 2 },
    });
    const S = createState(game, top1(0));
    expect(S.resultType).toBe('GROUNDOUT');
    expect(S.resultsOpen).toBe(false);
    expect(displayedOutNumber(S)).toBe(1);
    selectResult(S, 'LINEOUT');
    expect(displayedOutNumber(S)).toBe(1);
    applyChange(game, S);
    expect(at(game, 0)).toMatchObject({ resultType: 'LINEOUT', positions: '6-3', outNumber: 1 });
    expect(at(game, 1).outNumber).toBe(2);
  });

  it('out number picked by hand wins (line-drive double play, batter first)', () => {
    const game = gameWith({ 0: { resultType: 'SINGLE', positions: '7', basesReached: 1 } });
    const S = createState(game, top1(1));
    selectResult(S, 'DOUBLE_PLAY');
    setRunnerTarget(S, '0', 'out');
    setRunnerOutBase(S, '0', 1);
    expect(outNumberChoices(S)).toEqual([1, 2]);
    setOutNumber(S, 1);
    const res = applyChange(game, S);
    expect(at(game, 1).outNumber).toBe(1);
    expect(at(game, 0).outNumber).toBe(2);
    expect(at(game, 0).runnerEvents).toEqual([{ type: 'RUNNER_OUT', base: 1 }]);
    expect(res.changedKeys).toContain('0');
  });

  it('switching to a strikeout clears the hidden fielder numbers and RBI', () => {
    const game = gameWith({ 0: { resultType: 'TRIPLE', positions: '9', basesReached: 3 } });
    const S = createState(game, top1(1));
    selectResult(S, 'GROUNDOUT');
    pressKey(S, '6');
    pressKey(S, '3');
    setRunnerTarget(S, '0', 4);
    expect(S.rbi).toBe(1);
    selectResult(S, 'STRIKEOUT_SWING');
    expect(S.positions).toBe('');
    const { result } = buildSubmission(S);
    expect(result).toMatchObject({ resultType: 'STRIKEOUT_SWING', positions: '', rbi: 0, basesReached: 0, runnerEvents: [] });
    applyChange(game, S);
    expect(at(game, 1)).toMatchObject({ positions: '', rbi: 0 });
  });

  it('keeps a later-reached base when the hit type is corrected', () => {
    const game = gameWith({ 0: { resultType: 'SINGLE', positions: '7', basesReached: 4 } });
    const S = createState(game, top1(0));
    expect(S.dest).toBe(4);
    selectResult(S, 'DOUBLE');
    expect(S.dest).toBe(4);
    selectResult(S, 'GROUNDOUT');
    selectResult(S, 'SINGLE');
    expect(S.dest).toBe(4);
    applyChange(game, S);
    expect(at(game, 0).basesReached).toBe(4);
  });

  it('a fresh correction resets the destination to the new result', () => {
    const S = createState(gameWith({}), top1(0));
    selectResult(S, 'DOUBLE');
    expect(S.dest).toBe(2);
    selectResult(S, 'SINGLE');
    expect(S.dest).toBe(1);
  });

  it('batter out on the bases becomes a runner out event with an out number', () => {
    const game = gameWith({});
    const { S } = record(game, 0, s => {
      selectResult(s, 'SINGLE');
      setDest(s, 'out');
      expect(cellWillBeOut(s)).toBe(true);
      expect(displayedOutNumber(s)).toBe(1);
    });
    expect(at(game, 0)).toMatchObject({
      resultType: 'SINGLE', basesReached: 1, outNumber: 1, runnerEvents: [{ type: 'RUNNER_OUT', base: 2 }],
    });
    expect(S.outBase).toBe(2);
  });

  it('runner events move the runner and can be removed', () => {
    const S = createState(gameWith({}), top1(0));
    selectResult(S, 'SINGLE');
    addEvent(S, 'STOLEN_BASE');
    expect(S.dest).toBe(2);
    addEvent(S, 'WILD_PITCH');
    expect(S.dest).toBe(3);
    expect(buildSubmission(S).result.runnerEvents).toEqual([
      { type: 'STOLEN_BASE', base: 2 }, { type: 'WILD_PITCH', base: 3 },
    ]);
    removeEvent(S, 1);
    expect(S.dest).toBe(2);
    addEvent(S, 'CAUGHT_STEALING');
    expect(S.dest).toBe('out');
    expect(buildSubmission(S).result).toMatchObject({
      basesReached: 2, runnerEvents: [{ type: 'STOLEN_BASE', base: 2 }, { type: 'CAUGHT_STEALING', base: 3 }],
    });
    removeEvent(S, 1);
    expect(S.dest).toBe(2);
  });

  it('a runner who came home on his own events cannot also be put out', () => {
    const S = createState(gameWith({}), top1(0));
    selectResult(S, 'TRIPLE');
    addEvent(S, 'PASSED_BALL');
    expect(S.dest).toBe(4);
    addEvent(S, 'PICKOFF');
    setDest(S, 'out');
    expect(S.dest).toBe(4);
    expect(buildSubmission(S).result).toMatchObject({ basesReached: 4, runnerEvents: [{ type: 'PASSED_BALL', base: 4 }] });
  });

  it('a runner put out does not advance home on a later event', () => {
    const S = createState(gameWith({}), top1(0));
    selectResult(S, 'TRIPLE');
    setDest(S, 'out');
    expect(S.outBase).toBe(4);
    addEvent(S, 'WILD_PITCH');
    expect(buildSubmission(S).result).toMatchObject({ basesReached: 3, runnerEvents: [{ type: 'RUNNER_OUT', base: 4 }] });
    // a single, out at third: one advance (to second) still fits before the out
    const T = createState(gameWith({}), top1(0));
    selectResult(T, 'SINGLE');
    setDest(T, 'out');
    addEvent(T, 'STOLEN_BASE');
    expect(buildSubmission(T).result).toMatchObject({
      basesReached: 2, runnerEvents: [{ type: 'STOLEN_BASE', base: 2 }, { type: 'RUNNER_OUT', base: 3 }],
    });
  });

  it('RBI can be overridden and set back to the suggestion', () => {
    const game = gameWith({ 0: { resultType: 'DOUBLE', positions: '7', basesReached: 2 } });
    const S = createState(game, top1(1));
    selectResult(S, 'SINGLE');
    setRunnerTarget(S, '0', 4);
    stepRbi(S, 1);
    expect(S.rbi).toBe(2);
    stepRbi(S, 5);
    expect(S.rbi).toBe(4);
    useSuggestedRbi(S);
    expect(S.rbi).toBe(1);
  });

  it('editing does not move runners again', () => {
    const game = gameWith({
      0: { resultType: 'SINGLE', positions: '7', basesReached: 2 },
      1: { resultType: 'SINGLE', positions: '8', basesReached: 1 },
    });
    const S = createState(game, top1(1));
    selectResult(S, 'DOUBLE');
    expect(S.targets['0']).toBe('stay');
    expect(buildSubmission(S).runnerUpdates).toEqual([]);
  });

  it('placed tiebreak runner: destination and events only', () => {
    const game = makeGame({
      tiebreakerInning: 1, tiebreakerRunners: '2B',
      atBats: { first: { 1: cells({ tb8: { resultType: 'TIEBREAK_RUNNER', basesReached: 2, batterIdx: 8 } }) }, second: {} },
    });
    const S = createState(game, top1('tb8'));
    expect(S.isPlaced).toBe(true);
    expect(S.startBase).toBe(2);
    expect(S.dest).toBe(2);
    expect(blockReason(S)).toBe('');
    addEvent(S, 'WILD_PITCH');
    setDest(S, 4);
    applyChange(game, S);
    expect(at(game, 'tb8')).toMatchObject({ resultType: 'TIEBREAK_RUNNER', basesReached: 4, runnerEvents: [{ type: 'WILD_PITCH', base: 3 }] });
    expect(halfInning(game, 'first', 1).runs).toBe(1);
  });

  it('the preview runs on a copy and reports this half-inning only', () => {
    const game = gameWith({ 0: { resultType: 'SINGLE', positions: '7', basesReached: 1 } });
    const before = JSON.stringify(game);
    const S = createState(game, top1(1));
    expect(simulate(S)).toBeNull();
    selectResult(S, 'SINGLE');
    setRunnerTarget(S, '0', 'stay');
    const sim = simulate(S);
    expect(JSON.stringify(game)).toBe(before);
    expect(sim.cell).toMatchObject({ resultType: 'SINGLE', basesReached: 1 });
    expect(sim.issues.some(x => x.id === 'C02')).toBe(true);
    expect(sim.issues.every(x => x.teamKey === 'first' && x.inning === 1)).toBe(true);
  });
});
