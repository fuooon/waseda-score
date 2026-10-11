// Adversarial tests for the scoring engine: realistic youth games entered only
// through recordPlateAppearance (the way the input panel does it), edits of old
// cells, game-end rules, legacy saves, junk input, and seeded property checks.

import { describe, it, expect } from 'vitest';
import {
  lineupSize, cellState, isBatterOut, isRunnerOut, isPlateAppearance, isPlacedRunner,
  parseKey, keyFor, leadoffFor, halfInning, inningRuns, scoreboard, liveState, playerLine,
  teamTotals, validateGame, nextOutNumber, gameEndState, recordPlateAppearance, clearCell,
  renumberOuts, ensureTiebreakRunners, normalizeGame, inningLabel,
} from '../src/scoring.js';
import { GameData, loadGame } from '../src/data.js';
import { RESULT_TYPES, RUNNER_EVENTS } from '../src/rules.js';
import { makeGame, lineup } from './helpers.js';
import { simulateGame, rng } from './sim.js';

// ============================================
// A scorer that drives the engine like the input panel
// ============================================

// bat(resultType, { pos, rbi, base, move, outNumber }) records the next batter of the
// live half-inning. move: { fromBase: toBase | 'out' | runner-out event type }.
// runner(base, eventType) records an event on the runner's own cell (steal, wild pitch,
// caught stealing, pickoff).
function scorer(game) {
  const live = () => {
    const l = liveState(game);
    if (l.gameOver) throw new Error('the game is over');
    ensureTiebreakRunners(game, l.teamKey, l.inning);
    return { ...l, half: halfInning(game, l.teamKey, l.inning) };
  };
  const s = {
    bat(resultType, { pos = '', rbi = 0, base, move = {}, outNumber } = {}) {
      const l = live();
      const updates = Object.entries(move).map(([from, to]) => {
        const runner = l.half.runners.find(x => x.base === Number(from));
        if (!runner) throw new Error(`no runner on base ${from}`);
        if (to === 'out') return { key: runner.key, out: true };
        if (typeof to === 'string') return { key: runner.key, out: true, eventType: to };
        return { key: runner.key, basesReached: to };
      });
      const result = { resultType, positions: pos, rbi, runnerEvents: [] };
      if (base !== undefined) result.basesReached = base;
      if (outNumber !== undefined) result.outNumber = outNumber;
      return recordPlateAppearance(game, { teamKey: l.teamKey, inning: l.inning, key: l.half.nextBatter.key }, result, updates);
    },
    runner(base, type) {
      const l = live();
      const runner = l.half.runners.find(x => x.base === base);
      if (!runner) throw new Error(`no runner on base ${base}`);
      const c = runner.cell;
      const isOut = RUNNER_EVENTS[type].isOut;
      const to = isOut ? base : base + 1;
      return recordPlateAppearance(game, { teamKey: l.teamKey, inning: l.inning, key: runner.key }, {
        resultType: c.resultType, positions: c.positions, rbi: c.rbi,
        basesReached: to, runnerEvents: [...c.runnerEvents, isOut ? { type } : { type, base: to }],
      });
    },
    k(n = 1) {
      let r;
      for (let i = 0; i < n; i++) r = s.bat('STRIKEOUT_SWING');
      return r;
    },
    where() {
      const l = liveState(game);
      return `${l.inning}${l.half}`;
    },
  };
  return s;
}

// Every invariant that must hold for a game made of legal plays.
function expectConsistent(game) {
  for (const teamKey of ['first', 'second']) {
    const inns = Object.keys(game.atBats[teamKey] || {}).map(Number);
    for (const inning of inns) {
      const h = halfInning(game, teamKey, inning);
      expect(h.runs).toBe(h.cells.filter(e => e.state === 'SCORED').length);
      expect(h.outs).toBeLessThanOrEqual(3);
      const nums = h.cells.filter(e => e.state === 'OUT').map(e => e.cell.outNumber).sort((a, b) => a - b);
      expect(nums).toEqual(nums.map((_, i) => i + 1));
      for (const e of h.cells) if (e.state !== 'OUT') expect(e.cell.outNumber).toBe(null);
      if (h.complete) expect(h.pa + h.placed).toBe(h.runs + h.lob + h.outs);
      expect(h.rbi).toBeLessThanOrEqual(h.runs);
    }
  }
  const sb = scoreboard(game);
  for (const teamKey of ['first', 'second']) {
    const line = sb[teamKey];
    expect(line.R).toBe(line.innings.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0));
    let r = 0;
    for (let b = 0; b < lineupSize(game, teamKey); b++) r += playerLine(game, teamKey, b).r;
    expect(r).toBe(line.R);
  }
}

// ============================================
// A full 7-inning game
// ============================================

describe('a full 7-inning game entered play by play', () => {
  // 先攻 A: 0,1,0,1,1,0,0 = 3 / 後攻 B: 2,0,3,0,0,1,X = 6
  function playG() {
    const game = makeGame();
    const s = scorer(game);
    // 1回表: 三者凡退
    s.bat('STRIKEOUT_SWING'); s.bat('GROUNDOUT', { pos: '6-3' }); s.bat('FLYOUT', { pos: '8' });
    // 1回裏: B1 単打, B2 四球, B3 二塁打で2者生還, B4 三振, B5 二ゴロ(進塁打), B6 飛
    s.bat('SINGLE', { pos: '7' });
    s.bat('WALK', { move: { 1: 2 } });
    s.bat('DOUBLE', { pos: '8', rbi: 2, base: 2, move: { 2: 4, 1: 4 } });
    s.bat('STRIKEOUT_LOOK');
    s.bat('GROUNDOUT', { pos: '4-3', move: { 2: 3 } });
    s.bat('FLYOUT', { pos: '9' });
    // 2回表: A4 二塁打, A5 適時打, A6 6-4-3 併殺, A7 ゴロ
    s.bat('DOUBLE', { pos: '7', base: 2 });
    s.bat('SINGLE', { pos: '9', rbi: 1, move: { 2: 4 } });
    s.bat('DOUBLE_PLAY', { pos: '6-4-3', move: { 1: 'out' } });
    s.bat('GROUNDOUT', { pos: '5-3' });
    // 2回裏: 三者三振
    s.k(3);
    // 3回表: A8 四球 → 盗塁死, A9 三振, A1 ゴロ
    s.bat('WALK');
    s.runner(1, 'CAUGHT_STEALING');
    s.bat('STRIKEOUT_SWING');
    s.bat('GROUNDOUT', { pos: '6-3' });
    // 3回裏: B1 E6, B2 犠打, B3 適時打, B4 2ラン, B5・B6 三振
    s.bat('ERROR', { pos: '6' });
    s.bat('SACRIFICE_BUNT', { pos: '1-3', move: { 1: 2 } });
    s.bat('SINGLE', { pos: '8', rbi: 1, move: { 2: 4 } });
    s.bat('HOMERUN', { pos: '7', rbi: 2, move: { 1: 4 } });
    s.k(2);
    // 4回表: A2 単打 → 盗塁, A3 単打, A4 犠飛, A5 野選, A6 三振
    s.bat('SINGLE', { pos: '7' });
    s.runner(1, 'STOLEN_BASE');
    s.bat('SINGLE', { pos: '8', move: { 2: 3 } });
    s.bat('SACRIFICE_FLY', { pos: '8', rbi: 1, move: { 3: 4 } });
    s.bat('FIELDERS_CHOICE', { pos: '6-4', move: { 1: 'out' } });
    s.k();
    // 4回裏: 三者凡退
    s.bat('GROUNDOUT', { pos: '6-3' }); s.bat('FLYOUT', { pos: '7' }); s.bat('LINEOUT', { pos: '6' });
    // 5回表: A7 ソロ本塁打, 三者三振
    s.bat('HOMERUN', { pos: '8', rbi: 1 });
    s.k(3);
    // 5回裏
    s.k(3);
    // 6回表: A2 死球 → 牽制死, A3・A4 ゴロ
    s.bat('HIT_BY_PITCH');
    s.runner(1, 'PICKOFF');
    s.bat('GROUNDOUT', { pos: '4-3' }); s.bat('GROUNDOUT', { pos: '6-3' });
    // 6回裏: B4 二塁打 → 暴投で三塁, B5 二ゴロで生還, 2三振
    s.bat('DOUBLE', { pos: '9', base: 2 });
    s.runner(2, 'WILD_PITCH');
    s.bat('GROUNDOUT', { pos: '4-3', rbi: 1, move: { 3: 4 } });
    s.k(2);
    // 7回表: A5・A6 単打, A7 三振, A8 4-6-3 併殺 → 試合終了（後攻リード、7回裏は X）
    s.bat('SINGLE', { pos: '7' });
    s.bat('SINGLE', { pos: '8', move: { 1: 2 } });
    s.k();
    const last = s.bat('DOUBLE_PLAY', { pos: '4-6-3', move: { 1: 'out' } });
    return { game, s, last };
  }

  it('produces the right scoreboard, totals and game end', () => {
    const { game, last } = playG();
    expect(last.thirdOut).toBe(true);
    const sb = scoreboard(game);
    expect(sb.columns).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sb.first.innings).toEqual([0, 1, 0, 1, 1, 0, 0]);
    expect(sb.second.innings).toEqual([2, 0, 3, 0, 0, 1, 'X']);
    expect(sb.first).toMatchObject({ R: 3, H: 7, E: 1, LOB: 2 });
    expect(sb.second).toMatchObject({ R: 6, H: 5, E: 0, LOB: 1 });
    expect(sb).toMatchObject({ final: true, winner: 'second', endReason: 'regulation' });
    expect(gameEndState(game)).toEqual({ final: true, endReason: 'regulation', winner: 'second', skipBottomInning: 7, endAt: { inning: 7, teamKey: 'first' } });
    expect(liveState(game)).toMatchObject({ inning: 7, half: 'top', teamKey: 'first', gameOver: true, endReason: 'regulation', winner: 'second' });
    expect(liveState(game).halfInning.nextBatter).toBe(null);
    expect(halfInning(game, 'second', 7)).toMatchObject({ skipped: true, gameOver: true, nextBatter: null, started: false });
    expect(teamTotals(game, 'first')).toEqual({ runs: 3, hits: 7, errors: 1, lob: 2, rbi: 3, pa: 26, ab: 23 });
    expect(teamTotals(game, 'second')).toEqual({ runs: 6, hits: 5, errors: 0, lob: 1, rbi: 6, pa: 25, ab: 23 });
    expect(validateGame(game)).toEqual([]);
    expectConsistent(game);
    expect(() => scorer(game).k()).toThrow('the game is over');
  });

  it('keeps batting order, out numbers and player lines straight', () => {
    const { game } = playG();
    expect([2, 3, 4, 5, 6, 7].map(n => leadoffFor(game, 'first', n))).toEqual([3, 7, 1, 6, 1, 4]);
    expect([2, 3, 4, 5, 6].map(n => leadoffFor(game, 'second', n))).toEqual([6, 0, 6, 0, 3]);
    // 2回表 DP: the runner (A5) is the 1st out, the batter (A6) the 2nd, A7 the 3rd.
    const top2 = game.atBats.first[2];
    expect([top2['4'].outNumber, top2['5'].outNumber, top2['6'].outNumber]).toEqual([1, 2, 3]);
    expect(top2['4']).toMatchObject({ basesReached: 1, runnerEvents: [{ type: 'RUNNER_OUT', base: 2 }] });
    // 3回表: caught stealing on A8's own cell is the 1st out.
    expect(game.atBats.first[3]['7']).toMatchObject({ resultType: 'WALK', basesReached: 1, outNumber: 1, runnerEvents: [{ type: 'CAUGHT_STEALING' }] });
    // B4: K, 2-run HR, double + WP + scored
    expect(playerLine(game, 'second', 3)).toEqual({ pa: 3, ab: 3, h: 2, rbi: 2, r: 2, bb: 0, so: 1, lob: 0 });
    // A2: groundout, single + steal + scored, HBP picked off
    expect(playerLine(game, 'first', 1)).toEqual({ pa: 3, ab: 2, h: 1, rbi: 0, r: 1, bb: 1, so: 0, lob: 0 });
    // A5: groundout... single doubled off, FC left on base, single left on base
    expect(playerLine(game, 'first', 4).lob).toBe(2);
  });

  it('gives the same answers for a GameData instance and its saved JSON', () => {
    const { game } = playG();
    const instance = Object.assign(new GameData(), JSON.parse(JSON.stringify(game)));
    const plain = JSON.parse(JSON.stringify(instance));
    const ask = g => JSON.stringify({
      sb: scoreboard(g), live: liveState(g), end: gameEndState(g), checks: validateGame(g),
      totals: ['first', 'second'].map(t => teamTotals(g, t)),
      lines: ['first', 'second'].map(t => [0, 1, 2, 3, 4, 5, 6, 7, 8].map(b => playerLine(g, t, b))),
      halves: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ['first', 'second'].map(t => [halfInning(g, t, n), inningRuns(g, t, n), leadoffFor(g, t, n), nextOutNumber(g, t, n)])),
      keys: [parseKey(g, 'first', '12'), keyFor(g, 'second', 4, 1)],
    });
    expect(ask(plain)).toBe(ask(instance));
    expect(instance.getTotalRuns('second')).toBe(6);
    expect(instance.getInningRuns('first', 4)).toBe(1);
    expect(instance.getHitCount('first')).toBe(7);
    expect(instance.getErrorCount('first')).toBe(1);
  });
});

// ============================================
// Batting around
// ============================================

describe('batting around', () => {
  it('records 11 plate appearances in one inning under keys 0–10', () => {
    const game = makeGame();
    const s = scorer(game);
    s.bat('SINGLE', { pos: '7' });
    s.bat('SINGLE', { pos: '8', move: { 1: 2 } });
    s.bat('WALK', { move: { 2: 3, 1: 2 } });
    s.bat('SINGLE', { pos: '9', rbi: 2, move: { 3: 4, 2: 4, 1: 2 } });
    s.bat('DOUBLE', { pos: '7', rbi: 2, base: 2, move: { 2: 4, 1: 4 } });
    s.bat('STRIKEOUT_SWING');
    s.bat('HOMERUN', { pos: '7', rbi: 2, move: { 2: 4 } });
    s.bat('WALK');
    s.bat('ERROR', { pos: '5', move: { 1: 2 } });
    expect(halfInning(game, 'first', 1).nextBatter).toEqual({ batterIdx: 0, lap: 1, key: '9' });
    s.bat('SINGLE', { pos: '8', rbi: 1, move: { 2: 4, 1: 2 } });
    expect(halfInning(game, 'first', 1).nextBatter).toEqual({ batterIdx: 1, lap: 1, key: '10' });
    const r = s.bat('DOUBLE_PLAY', { pos: '6-4-3', move: { 1: 'out' } });
    expect(r.thirdOut).toBe(true);
    expect(Object.keys(game.atBats.first[1]).sort((a, b) => a - b)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    const h = r.half;
    expect(h.seq.map(e => [e.batterIdx, e.lap])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [0, 1], [1, 1]]);
    expect(h).toMatchObject({ pa: 11, ab: 9, runs: 7, rbi: 7, hits: 6, outs: 3, lob: 1, errors: 1, lastBatterIdx: 1, complete: true });
    expect(h.pa + h.placed).toBe(h.runs + h.lob + h.outs);
    expect(leadoffFor(game, 'first', 2)).toBe(2);
    expect(playerLine(game, 'first', 0)).toMatchObject({ pa: 2, ab: 2, h: 2, r: 1 });
    expect(playerLine(game, 'first', 1)).toMatchObject({ pa: 2, ab: 2, h: 1, r: 1 });
    expect(parseKey(game, 'first', '10')).toEqual({ batterIdx: 1, lap: 1, isPlaced: false });
    expect(scoreboard(game).second.E).toBe(1);
    expect(validateGame(game)).toEqual([]);
    // The bottom half starts from 1番 and the top of the 2nd from 3番.
    expect(liveState(game)).toMatchObject({ inning: 1, half: 'bottom' });
    s.k(3);
    expect(liveState(game).halfInning.nextBatter).toEqual({ batterIdx: 2, lap: 0, key: '2' });
  });

  it('wraps into lap 2 (third time up) without colliding with lap 1 keys', () => {
    const game = makeGame();
    const s = scorer(game);
    // 19 batters reach and score one after another (solo home runs), then three outs.
    for (let i = 0; i < 19; i++) s.bat('HOMERUN', { pos: '7', rbi: 1 });
    expect(halfInning(game, 'first', 1).nextBatter).toEqual({ batterIdx: 1, lap: 2, key: '19' });
    s.k(3);
    const h = halfInning(game, 'first', 1);
    expect(h).toMatchObject({ pa: 22, runs: 19, outs: 3, lastBatterIdx: 3 });
    expect(leadoffFor(game, 'first', 2)).toBe(4);
    expect(playerLine(game, 'first', 0)).toMatchObject({ pa: 3, h: 3, r: 3, rbi: 3 });
    expect(validateGame(game)).toEqual([]);
  });
});

// ============================================
// Edits of earlier cells
// ============================================

describe('editing cells after later cells exist', () => {
  function threeOuts() {
    const game = makeGame();
    const s = scorer(game);
    s.bat('STRIKEOUT_SWING');
    s.bat('GROUNDOUT', { pos: '6-3' });
    const r = s.bat('FLYOUT', { pos: '8' });
    expect(r.thirdOut).toBe(true);
    return { game, s };
  }
  const nums = (game, keys) => keys.map(k => game.atBats.first[1][k]?.outNumber ?? null);

  it('re-saving an old out keeps every out number; changing positions touches one cell', () => {
    const { game } = threeOuts();
    const r = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '0' }, { resultType: 'STRIKEOUT_LOOK', outNumber: 1 });
    expect(r.changedKeys).toEqual(['0']);
    expect(r.thirdOut).toBe(false);
    expect(nums(game, ['0', '1', '2'])).toEqual([1, 2, 3]);
    const r2 = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '1' }, { resultType: 'GROUNDOUT', positions: '4-3', outNumber: 2 });
    expect(r2.changedKeys).toEqual(['1']);
    expect(nums(game, ['0', '1', '2'])).toEqual([1, 2, 3]);
  });

  it('clearing the 2nd out reopens the half; re-entering it with its number restores the order', () => {
    const { game, s } = threeOuts();
    const c = clearCell(game, 'first', 1, '1');
    expect(c.changedKeys.sort()).toEqual(['1', '2']);
    expect(nums(game, ['0', '1', '2'])).toEqual([1, null, 2]);
    expect(c.half).toMatchObject({ outs: 2, complete: false });
    expect(liveState(game)).toMatchObject({ inning: 1, half: 'top', gameOver: false });
    expect(validateGame(game).map(i => [i.id, i.key])).toEqual([['C07', '2']]);
    // The panel offers 1..outs+1 and the user picks Ⅱ for the re-entered batter.
    expect(nextOutNumber(game, 'first', 1, '1')).toBe(3);
    const r = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '1' }, { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 2 });
    expect(r.thirdOut).toBe(true);
    expect(nums(game, ['0', '1', '2'])).toEqual([1, 2, 3]);
    expect(validateGame(game)).toEqual([]);
    expect(s.where()).toBe('1bottom');
  });

  it('clearing the 2nd out without choosing a number puts it last (recording order)', () => {
    const { game } = threeOuts();
    clearCell(game, 'first', 1, 1);
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '1' }, { resultType: 'GROUNDOUT', positions: '6-3' });
    expect(nums(game, ['0', '1', '2'])).toEqual([1, 3, 2]);
    expect(validateGame(game)).toEqual([]);
  });

  it('an out changed to an error and back: numbers close up, the error is charged, the out comes back', () => {
    const { game } = threeOuts();
    const r1 = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '1' }, { resultType: 'ERROR', positions: '6', basesReached: 1 });
    expect(r1.changedKeys.sort()).toEqual(['1', '2']);
    expect(nums(game, ['0', '1', '2'])).toEqual([1, null, 2]);
    expect(r1.half).toMatchObject({ outs: 2, errors: 1, complete: false, nextBatter: { batterIdx: 3, lap: 0, key: '3' } });
    expect(r1.half.runners.map(x => [x.key, x.base])).toEqual([['1', 1]]);
    expect(scoreboard(game).second.E).toBe(1);
    expect(liveState(game)).toMatchObject({ inning: 1, half: 'top' });
    const r2 = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '1' }, { resultType: 'GROUNDOUT', positions: '6-3', basesReached: 1, outNumber: 2 });
    expect(r2.thirdOut).toBe(true);
    expect(game.atBats.first[1]['1']).toMatchObject({ basesReached: 0, runnerEvents: [], outNumber: 2 });
    expect(nums(game, ['0', '1', '2'])).toEqual([1, 2, 3]);
    expect(scoreboard(game).second.E).toBe(0);
    expect(validateGame(game)).toEqual([]);
  });

  it('an explicit out number can move an out later as well as earlier', () => {
    const { game } = threeOuts();
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '0' }, { resultType: 'STRIKEOUT_SWING', outNumber: 3 });
    expect(nums(game, ['0', '1', '2'])).toEqual([3, 1, 2]);
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '0' }, { resultType: 'STRIKEOUT_SWING', outNumber: 2 });
    expect(nums(game, ['0', '1', '2'])).toEqual([2, 1, 3]);
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '2' }, { resultType: 'FLYOUT', positions: '8', outNumber: 1 });
    expect(nums(game, ['0', '1', '2'])).toEqual([3, 2, 1]);
    // Too high a number means "last".
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '2' }, { resultType: 'FLYOUT', positions: '8', outNumber: 7 });
    expect(nums(game, ['0', '1', '2'])).toEqual([2, 1, 3]);
    expect(validateGame(game)).toEqual([]);
  });

  it('editing an early batter keeps the runner progress made by later batters', () => {
    const game = makeGame();
    const s = scorer(game);
    s.bat('SINGLE', { pos: '7' });
    s.bat('DOUBLE', { pos: '8', base: 2, move: { 1: 3 } });
    s.bat('SACRIFICE_FLY', { pos: '9', rbi: 1, move: { 3: 4 } });
    // The panel re-opens 1番 (who scored) to fix the direction of his hit and passes his current base.
    const cellNow = game.atBats.first[1]['0'];
    const r = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '0' }, { resultType: 'SINGLE', positions: '8', basesReached: cellNow.basesReached, runnerEvents: [] });
    expect(r.changedKeys).toEqual(['0']);
    expect(r.half).toMatchObject({ runs: 1, rbi: 1, outs: 1 });
    expect(r.half.runners.map(x => [x.key, x.base])).toEqual([['1', 2]]);
    expect(validateGame(game)).toEqual([]);
  });

  it('turning an early single into an out mid-inning shifts the out numbers after it in time, not in batting order', () => {
    const game = makeGame();
    const s = scorer(game);
    s.bat('SINGLE', { pos: '7' });
    s.bat('STRIKEOUT_SWING');
    s.bat('GROUNDOUT', { pos: '4-3', move: { 1: 2 } });
    // Later the parent notices 1番 was actually out on a liner.
    const r = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '0' }, { resultType: 'LINEOUT', positions: '6' });
    expect(r.thirdOut).toBe(true);
    expect(game.atBats.first[1]['0']).toMatchObject({ basesReached: 0, outNumber: 3 });
    // The out numbers are now out of batting order; the parent can fix it by picking Ⅰ.
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '0' }, { resultType: 'LINEOUT', positions: '6', outNumber: 1 });
    expect(nums(game, ['0', '1', '2'])).toEqual([1, 2, 3]);
    expect(validateGame(game)).toEqual([]);
  });
});

// ============================================
// Runner outs ending an inning, double plays, fielder's choice, pickoff
// ============================================

describe('runner outs', () => {
  it('an inning ended by a caught stealing: the batter at the plate leads off next inning', () => {
    const game = makeGame();
    const s = scorer(game);
    s.k(2); // 1番, 2番
    s.bat('SINGLE', { pos: '7' }); // 3番
    const r = s.runner(1, 'CAUGHT_STEALING'); // during 4番's at-bat
    expect(r.thirdOut).toBe(true);
    expect(r.changedKeys).toEqual(['2']);
    expect(r.half).toMatchObject({ outs: 3, complete: true, nextBatter: null, lob: 0, lastBatterIdx: 2, pa: 3 });
    expect(game.atBats.first[1]['2']).toMatchObject({ basesReached: 1, outNumber: 3, runnerEvents: [{ type: 'CAUGHT_STEALING' }] });
    expect(liveState(game)).toMatchObject({ inning: 1, half: 'bottom' });
    s.k(3);
    expect(liveState(game)).toMatchObject({ inning: 2, half: 'top' });
    expect(leadoffFor(game, 'first', 2)).toBe(3);
    expect(liveState(game).halfInning.nextBatter).toEqual({ batterIdx: 3, lap: 0, key: '3' });
    s.bat('GROUNDOUT', { pos: '6-3' });
    expect(validateGame(game)).toEqual([]);
  });

  it('a pickoff of a placed tiebreak runner counts as an out of that half', () => {
    const game = makeGame({ innings: 1, tiebreakerInning: 2, tiebreakerRunners: '2B' });
    const s = scorer(game);
    s.k(3); s.k(3);
    expect(liveState(game)).toMatchObject({ inning: 2, half: 'top', gameOver: false });
    const r = s.runner(2, 'PICKOFF');
    expect(r.half).toMatchObject({ outs: 1, placed: 1, pa: 0, started: true });
    expect(game.atBats.first[2].tb2).toMatchObject({ resultType: 'TIEBREAK_RUNNER', basesReached: 2, outNumber: 1, runnerEvents: [{ type: 'PICKOFF' }] });
    expect(inningRuns(game, 'first', 2)).toBe(0);
    s.k(2);
    expect(halfInning(game, 'first', 2)).toMatchObject({ outs: 3, complete: true, pa: 2, placed: 1, lob: 0 });
    expect(validateGame(game)).toEqual([]);
  });

  it('a double play without picking the runner is flagged, and fixed by adding the runner out', () => {
    const game = makeGame();
    const s = scorer(game);
    s.bat('SINGLE', { pos: '7' });
    const r = s.bat('DOUBLE_PLAY', { pos: '6-4-3' }); // runner not chosen
    expect(r.half.outs).toBe(1);
    expect(validateGame(game).map(i => i.id)).toContain('C08');
    // Re-save the DP with the runner update: the runner becomes the 1st out.
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '1' }, { resultType: 'DOUBLE_PLAY', positions: '6-4-3', outNumber: 1 }, [{ key: '0', out: true }]);
    const h = halfInning(game, 'first', 1);
    expect(h.outs).toBe(2);
    // The batter keeps the number he had; the runner is numbered after him.
    expect([game.atBats.first[1]['0'].outNumber, game.atBats.first[1]['1'].outNumber]).toEqual([2, 1]);
    expect(validateGame(game)).toEqual([]);
  });

  it('a fielder\'s choice with nobody on is flagged (C09), and with a runner it is clean', () => {
    const game = makeGame();
    const s = scorer(game);
    s.bat('FIELDERS_CHOICE', { pos: '6-4' });
    expect(validateGame(game).map(i => i.id)).toEqual(['C09']);
    clearCell(game, 'first', 1, '0');
    s.bat('WALK');
    s.bat('FIELDERS_CHOICE', { pos: '6-4', move: { 1: 'out' } });
    const h = halfInning(game, 'first', 1);
    expect(h).toMatchObject({ outs: 1, hits: 0, ab: 1, pa: 2 });
    expect(h.runners.map(x => [x.key, x.base])).toEqual([['1', 1]]);
    expect(validateGame(game)).toEqual([]);
  });

  it('a triple play (DP batter + two runner outs) is three outs and ends the inning', () => {
    const game = makeGame();
    const s = scorer(game);
    s.bat('SINGLE', { pos: '7' });
    s.bat('WALK', { move: { 1: 2 } });
    // The input panel lists runners by base (1st first); the lead runner is still the 1st out.
    const r = s.bat('DOUBLE_PLAY', { pos: '5-4-3', move: { 1: 'out', 2: 'out' } });
    expect(r.thirdOut).toBe(true);
    expect(r.half).toMatchObject({ outs: 3, complete: true, lob: 0 });
    expect(['0', '1', '2'].map(k => game.atBats.first[1][k].outNumber)).toEqual([1, 2, 3]);
    expect(validateGame(game)).toEqual([]);
  });
});

// ============================================
// Game end: walk-off, skipped bottom half, extra innings, tiebreak
// ============================================

describe('game end through play-by-play', () => {
  // Plays the regulation innings 1..n with one solo home run per team in the 1st.
  function tiedThrough(n, overrides = {}) {
    const game = makeGame({ innings: 7, ...overrides });
    const s = scorer(game);
    for (let i = 1; i <= n; i++) {
      if (i === 1) s.bat('HOMERUN', { pos: '7', rbi: 1 });
      s.k(3);
      if (i === 1) s.bat('HOMERUN', { pos: '8', rbi: 1 });
      s.k(3);
    }
    return { game, s };
  }

  it('walk-off single in the bottom of the 7th ends the game with one out', () => {
    const { game, s } = tiedThrough(6);
    s.k(3); // 7回表
    expect(liveState(game)).toMatchObject({ inning: 7, half: 'bottom', gameOver: false });
    s.bat('WALK');
    s.bat('SACRIFICE_BUNT', { pos: '2-3', move: { 1: 2 } });
    const r = s.bat('SINGLE', { pos: '9', rbi: 1, move: { 2: 4 } });
    expect(r.thirdOut).toBe(false);
    expect(r.half).toMatchObject({ outs: 1, runs: 1, complete: true, gameOver: true, nextBatter: null, lob: 1 });
    expect(liveState(game)).toMatchObject({ inning: 7, half: 'bottom', teamKey: 'second', gameOver: true, endReason: 'walkoff', winner: 'second' });
    expect(gameEndState(game)).toEqual({ final: true, endReason: 'walkoff', winner: 'second', skipBottomInning: null, endAt: { inning: 7, teamKey: 'second' } });
    expect(scoreboard(game)).toMatchObject({ final: true, winner: 'second', endReason: 'walkoff', maxInning: 7 });
    expect(scoreboard(game).second.innings[6]).toBe(1);
    expect(validateGame(game)).toEqual([]);
    expect(ensureTiebreakRunners(game, 'first', 8)).toBe(false);
    // Anything entered afterwards is flagged: a batter after the winning hit (C17)...
    recordPlateAppearance(game, { teamKey: 'second', inning: 7, key: '4' }, { resultType: 'STRIKEOUT_SWING' });
    const c17 = validateGame(game);
    expect(c17.map(i => [i.id, i.severity, i.key])).toEqual([['C17', 'warning', '4']]);
    expect(c17[0].message).toBe('7回裏：4番 B4の打席で勝ち越し点が入り、その時点で試合終了（サヨナラ）です。そのあとの5番 B5の打席は記録しないでください。');
    // ... and a later half-inning (C16).
    clearCell(game, 'second', 7, '4');
    const lead8 = String(leadoffFor(game, 'first', 8));
    recordPlateAppearance(game, { teamKey: 'first', inning: 8, key: lead8 }, { resultType: 'SINGLE' });
    const c16 = validateGame(game);
    expect(c16.map(i => [i.id, i.inning, i.teamKey, i.key])).toEqual([['C16', 8, 'first', lead8]]);
    expect(c16[0].message).toBe('8回表：試合はすでに7回裏（サヨナラ）で終わっているので、この回の記録は不要です。');
  });

  it('a walk-off home run counts every run (no C17)', () => {
    const { game, s } = tiedThrough(6);
    s.k(3);
    s.bat('SINGLE', { pos: '7' });
    s.bat('WALK', { move: { 1: 2 } });
    s.bat('HOMERUN', { pos: '8', rbi: 3, move: { 2: 4, 1: 4 } });
    expect(gameEndState(game)).toMatchObject({ final: true, endReason: 'walkoff' });
    expect(scoreboard(game).second.R).toBe(4);
    expect(validateGame(game)).toEqual([]);
  });

  it("does not play the bottom of the last inning when the home team leads: 'X' and no next batter", () => {
    const game = makeGame({ innings: 3 });
    const s = scorer(game);
    s.k(3);
    s.bat('HOMERUN', { pos: '7', rbi: 1 }); s.k(3);
    s.k(3); s.k(3);
    // 3回表 with two outs: still in progress.
    s.k(2);
    expect(liveState(game)).toMatchObject({ inning: 3, half: 'top', gameOver: false });
    expect(inningRuns(game, 'second', 3)).toBe(null);
    const r = s.k();
    expect(r.thirdOut).toBe(true);
    expect(r.half.gameOver).toBe(true);
    expect(liveState(game)).toMatchObject({ inning: 3, half: 'top', gameOver: true, winner: 'second', endReason: 'regulation' });
    expect(inningRuns(game, 'second', 3)).toBe('X');
    expect(halfInning(game, 'second', 3)).toMatchObject({ skipped: true, nextBatter: null });
    expect(scoreboard(game).second.innings).toEqual([1, 0, 'X']);
    expect(ensureTiebreakRunners(game, 'second', 3)).toBe(false);
    expect(validateGame(game)).toEqual([]);
    // A cell typed into the X half is flagged with the reason.
    recordPlateAppearance(game, { teamKey: 'second', inning: 3, key: String(leadoffFor(game, 'second', 3)) }, { resultType: 'WALK' });
    const issues = validateGame(game);
    expect(issues.map(i => i.id)).toEqual(['C16']);
    expect(issues[0].message).toBe('3回裏：3回表を終えて後攻チームがリードしているので、3回裏の攻撃はありません（スコアボードは X）。');
    expect(scoreboard(game).second.R).toBe(1);
  });

  it('goes to extra innings in a 7-inning game and ends after the bottom of the 9th', () => {
    const { game, s } = tiedThrough(7);
    expect(liveState(game)).toMatchObject({ inning: 8, half: 'top', gameOver: false });
    expect(scoreboard(game).maxInning).toBe(7);
    s.k(3);
    expect(scoreboard(game).maxInning).toBe(8);
    s.k(3);
    expect(liveState(game)).toMatchObject({ inning: 9, half: 'top', gameOver: false });
    s.bat('TRIPLE', { pos: '9', base: 3 });
    s.bat('GROUNDOUT', { pos: '6-3', rbi: 1, move: { 3: 4 } });
    s.k(2);
    expect(liveState(game)).toMatchObject({ inning: 9, half: 'bottom', gameOver: false });
    s.bat('DOUBLE', { pos: '8', base: 2 });
    s.k(2);
    const r = s.bat('FLYOUT', { pos: '9' });
    expect(r.thirdOut).toBe(true);
    const sb = scoreboard(game);
    expect(sb.columns).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sb.first.innings).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(sb.second.innings).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sb).toMatchObject({ final: true, winner: 'first', endReason: 'regulation' });
    expect(sb.second.LOB).toBe(1);
    expect(gameEndState(game).endAt).toEqual({ inning: 9, teamKey: 'second' });
    expect(liveState(game)).toMatchObject({ inning: 9, half: 'bottom', gameOver: true, winner: 'first' });
    expect(validateGame(game)).toEqual([]);
    expectConsistent(game);
  });

  it('plays both halves of a tiebreak inning with placed runners and ends on a walk-off', () => {
    const { game, s } = tiedThrough(7, { tiebreakerInning: 8, tiebreakerRunners: '1B2B' });
    // Before the 8th starts nothing is placed; the live half places them.
    expect(liveState(game)).toMatchObject({ inning: 8, half: 'top' });
    const L = leadoffFor(game, 'first', 8);
    expect(ensureTiebreakRunners(game, 'first', 8)).toBe(true);
    let h = halfInning(game, 'first', 8);
    expect(h).toMatchObject({ isTiebreak: true, placed: 2, started: false, outs: 0 });
    expect(h.runners.map(x => [x.batterIdx, x.base])).toEqual([[(L + 8) % 9, 1], [(L + 7) % 9, 2]]);
    expect(h.nextBatter.batterIdx).toBe(L);
    expect(inningRuns(game, 'first', 8)).toBe(null);
    // 8回表: run-scoring single, then three outs (runners left on 2nd and 3rd... and 1st)
    s.bat('SINGLE', { pos: '7', rbi: 1, move: { 2: 4, 1: 3 } });
    s.k(3);
    h = halfInning(game, 'first', 8);
    expect(h).toMatchObject({ runs: 1, outs: 3, placed: 2, pa: 4, lob: 2, complete: true });
    expect(h.pa + h.placed).toBe(h.runs + h.lob + h.outs);
    // 8回裏: placed runners too (tied when the inning started), two-run double = walk-off
    expect(ensureTiebreakRunners(game, 'second', 8)).toBe(true);
    expect(halfInning(game, 'second', 8).isTiebreak).toBe(true);
    const r = s.bat('DOUBLE', { pos: '8', rbi: 2, base: 2, move: { 2: 4, 1: 4 } });
    expect(r.half).toMatchObject({ runs: 2, outs: 0, gameOver: true, nextBatter: null });
    expect(gameEndState(game)).toMatchObject({ final: true, endReason: 'walkoff', winner: 'second', endAt: { inning: 8, teamKey: 'second' } });
    const sb = scoreboard(game);
    expect(sb.first.innings).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
    expect(sb.second.innings).toEqual([1, 0, 0, 0, 0, 0, 0, 2]);
    expect([sb.first.R, sb.second.R]).toEqual([2, 3]);
    // Placed runners who scored count as runs for their lineup slot, not as plate appearances.
    const tbSlot = h.cells.find(e => e.isPlaced && e.state === 'SCORED').batterIdx;
    expect(playerLine(game, 'first', tbSlot).r).toBeGreaterThanOrEqual(1);
    expect(teamTotals(game, 'first').pa).toBe(4 + 3 * 6 + 4);
    expect(validateGame(game)).toEqual([]);
    expectConsistent(game);
  });

  it('a tiebreak inning that is not tied at the start gets no placed runners', () => {
    const { game, s } = tiedThrough(6, { tiebreakerInning: 7, tiebreakerRunners: '1B2B' });
    expect(ensureTiebreakRunners(game, 'first', 7)).toBe(true);
    s.bat('SINGLE', { pos: '7', rbi: 1, move: { 2: 4, 1: 3 } });
    s.k(3);
    expect(ensureTiebreakRunners(game, 'second', 7)).toBe(true); // tied when the 7th started
    s.k(3);
    expect(gameEndState(game)).toMatchObject({ final: true, winner: 'first', endReason: 'regulation' });
    expect(ensureTiebreakRunners(game, 'first', 8)).toBe(false);
    expect(validateGame(game)).toEqual([]);
  });

  it('a manual end (called game) stops at the half being played without C03', () => {
    const game = makeGame({ innings: 7 });
    const s = scorer(game);
    s.bat('HOMERUN', { pos: '7', rbi: 1 }); s.k(3);
    s.k(3);
    s.bat('SINGLE', { pos: '7' }); s.k();
    game.status = 'final';
    game.endReason = 'time';
    expect(gameEndState(game)).toMatchObject({ final: true, endReason: 'time', winner: 'first', endAt: { inning: 2, teamKey: 'first' } });
    expect(liveState(game)).toMatchObject({ inning: 2, half: 'top', gameOver: true });
    expect(halfInning(game, 'first', 2)).toMatchObject({ complete: true, lob: 1, nextBatter: null });
    expect(scoreboard(game).first.innings.slice(0, 2)).toEqual([1, 0]);
    expect(scoreboard(game).second.innings.slice(0, 2)).toEqual([0, null]);
    expect(validateGame(game)).toEqual([]);
  });
});

// ============================================
// Legacy saves
// ============================================

describe('legacy saved games', () => {
  // What the v1 app saved: global out counter (outsInInning), DH games with 10 batters,
  // a DP numbered only once, runner outs as basesReached 0 without a number,
  // RBIs that the old code added to runs, events with empty descriptions, no status/version.
  function legacySave() {
    const tenMen = lineup('A', 10);
    tenMen[9].position = 'DH';
    return {
      id: 'legacy-1', date: '2025-06-01', teamFirst: '若葉', teamSecond: 'ひばり', field: '市民球場',
      innings: 9, useDH: true, startTime: '09:00', endTime: '',
      tiebreakerInning: 0, tiebreakerRunners: 'none', gameResult: '',
      lineupFirst: tenMen, lineupSecond: lineup('B'), pitcherFirst: '', pitcherSecond: '',
      atBats: {
        first: {
          1: {
            0: { resultType: 'GROUNDOUT', positions: '6-3', rbi: 0, basesReached: 0, outNumber: 1, note: '', runnerEvents: [] },
            1: { resultType: 'SINGLE', positions: '7', rbi: 0, basesReached: 0, outNumber: null, note: '', runnerEvents: [] },
            2: { resultType: 'DOUBLE_PLAY', positions: '6-4-3', rbi: 0, basesReached: 0, outNumber: 2, note: '', runnerEvents: [] },
          },
          2: {
            3: { resultType: 'SINGLE', positions: '8', rbi: 0, basesReached: 4, outNumber: null, note: '', runnerEvents: [{ type: 'STOLEN_BASE', description: '' }] },
            4: { resultType: 'HOMERUN', positions: '', rbi: 2, basesReached: 4, outNumber: null, note: '', runnerEvents: [] },
            5: { resultType: 'STRIKEOUT_SWING', positions: '', rbi: 0, basesReached: 0, outNumber: 3, note: '', runnerEvents: [] },
            6: { resultType: 'STRIKEOUT_LOOK', positions: '', rbi: 0, basesReached: 0, outNumber: 3, note: '', runnerEvents: [] },
            7: { resultType: 'FLYOUT', positions: '9', rbi: 0, basesReached: 0, outNumber: 1, note: '', runnerEvents: [] },
          },
        },
        second: {
          1: {
            0: { resultType: 'WALK', positions: '', rbi: 0, basesReached: 2, outNumber: null, note: '', runnerEvents: [{ type: 'STOLEN_BASE', description: '' }] },
            1: { resultType: 'STRIKEOUT_SWING', positions: '', rbi: 0, basesReached: 0, outNumber: 1, note: '', runnerEvents: [] },
            2: { resultType: 'STRIKEOUT_SWING', positions: '', rbi: 0, basesReached: 0, outNumber: 2, note: '', runnerEvents: [] },
            3: { resultType: 'GROUNDOUT', positions: '4-3', rbi: 0, basesReached: 0, outNumber: 3, note: '', runnerEvents: [] },
          },
        },
      },
      currentInning: 2, currentHalf: 'bottom', outsInInning: 1,
      substitutions: [],
    };
  }

  function checkLegacy(game) {
    expect('outsInInning' in game).toBe(false);
    expect(game).toMatchObject({ version: 2, status: 'in_progress', endReason: '', innings: 9, lineupDone: true, currentInning: 2, currentHalf: 'bottom' });
    expect(lineupSize(game, 'first')).toBe(10);
    const t1 = game.atBats.first[1];
    expect([t1[0].outNumber, t1[1].outNumber, t1[2].outNumber]).toEqual([1, 2, 3]);
    expect(isRunnerOut(t1[1])).toBe(true);
    const t2 = game.atBats.first[2];
    expect([5, 6, 7].map(k => t2[k].outNumber)).toEqual([1, 2, 3]);
    expect(t2[3].runnerEvents).toEqual([{ type: 'STOLEN_BASE' }]);
    expect(leadoffFor(game, 'first', 2)).toBe(3);
    expect(leadoffFor(game, 'first', 3)).toBe(8);
    const sb = scoreboard(game);
    expect(sb.maxInning).toBe(9);
    expect(sb.first.innings.slice(0, 3)).toEqual([0, 2, null]); // not 4: RBIs are not runs
    expect(sb.second.innings.slice(0, 2)).toEqual([0, null]);
    expect(sb.second.LOB).toBe(1);
    expect(liveState(game)).toMatchObject({ inning: 2, half: 'bottom', gameOver: false });
    // Only the reminder that the old runner out has no reason.
    const issues = validateGame(game);
    expect(issues.map(i => [i.id, i.severity, i.inning, i.teamKey, i.key])).toEqual([['C18', 'info', 1, 'first', '1']]);
    expect(issues[0].message).toBe('1回表 2番 A2：アウトになった理由（盗塁死・走塁死）を記録すると、後で見返しやすくなります。');
  }

  it('normalizeGame migrates the plain JSON', () => {
    const game = normalizeGame(JSON.parse(JSON.stringify(legacySave())));
    checkLegacy(game);
    // Idempotent: a second pass changes nothing.
    const copy = JSON.parse(JSON.stringify(game));
    expect(normalizeGame(game)).toEqual(copy);
  });

  it('loadGame migrates it into a GameData instance', () => {
    const store = new Map([['waseda-score-current-game', JSON.stringify(legacySave())]]);
    const saved = globalThis.localStorage;
    globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
    try {
      const game = loadGame();
      expect(game).toBeInstanceOf(GameData);
      checkLegacy(game);
      expect(game.getInningRuns('first', 2)).toBe(2);
      expect(game.getTotalRuns('first')).toBe(2);
    } finally {
      globalThis.localStorage = saved;
    }
  });

  it('a legacy save continues correctly in the v2 engine (10-man order wraps at 10)', () => {
    const game = normalizeGame(JSON.parse(JSON.stringify(legacySave())));
    const s = scorer(game);
    s.k(3); // 2回裏
    expect(liveState(game)).toMatchObject({ inning: 3, half: 'top' });
    expect(liveState(game).halfInning.nextBatter).toEqual({ batterIdx: 8, lap: 0, key: '8' });
    s.bat('SINGLE', { pos: '7' }); // 9番
    expect(liveState(game).halfInning.nextBatter).toEqual({ batterIdx: 9, lap: 0, key: '9' }); // DH, 10番
    s.k(3);
    expect(leadoffFor(game, 'first', 4)).toBe(2);
    expect(validateGame(game).map(i => i.id)).toEqual(['C18']);
  });

  it('a legacy runner out without a number and v1 duplicates are numbered in batting order', () => {
    const game = normalizeGame({
      atBats: {
        first: {
          1: {
            0: { resultType: 'SINGLE', basesReached: 0 },
            1: { resultType: 'STRIKEOUT_SWING', outNumber: 1 },
            2: { resultType: 'STRIKEOUT_SWING', outNumber: 1 },
          },
        },
      },
      outsInInning: 2,
    });
    expect([0, 1, 2].map(k => game.atBats.first[1][k].outNumber)).toEqual([1, 2, 3]);
    expect(game.atBats.first[1][0]).toMatchObject({ positions: '', rbi: 0, runnerEvents: [], note: '' });
    expect(halfInning(game, 'first', 1)).toMatchObject({ outs: 3, complete: true, lob: 0 });
  });
});

// ============================================
// Junk, empty games and empty lineups
// ============================================

describe('empty games, empty lineups and junk', () => {
  const everyQuery = g => {
    const out = [];
    for (const teamKey of ['first', 'second']) {
      out.push(lineupSize(g, teamKey), teamTotals(g, teamKey), playerLine(g, teamKey, 0), parseKey(g, teamKey, '9'), keyFor(g, teamKey, 1, 1));
      for (const n of [1, 2, 13]) {
        out.push(halfInning(g, teamKey, n), inningRuns(g, teamKey, n), leadoffFor(g, teamKey, n), nextOutNumber(g, teamKey, n));
      }
    }
    out.push(scoreboard(g), liveState(g), validateGame(g), gameEndState(g));
    return out;
  };

  it('every query works on empty and malformed games', () => {
    for (const g of [{}, null, undefined, makeGame(), { atBats: null, lineupFirst: null, innings: 'x' }, { atBats: { first: [], second: 5 } }, new GameData()]) {
      expect(() => everyQuery(g)).not.toThrow();
      expect(validateGame(g)).toEqual([]);
      expect(liveState(g)).toMatchObject({ inning: 1, half: 'top', gameOver: false });
      expect(scoreboard(g)).toMatchObject({ maxInning: 7, final: false, winner: null });
    }
  });

  it('cell predicates accept junk', () => {
    for (const c of [null, undefined, 0, 'x', {}, { resultType: '' }, { resultType: 'NOPE', basesReached: 'a' }]) {
      expect(() => [cellState(c), isBatterOut(c), isRunnerOut(c), isPlateAppearance(c), isPlacedRunner(c)]).not.toThrow();
    }
    expect(cellState({ resultType: '' })).toBe('EMPTY');
    expect(cellState(null)).toBe('EMPTY');
  });

  it('a lineup of length 0 bats as nine unnamed slots', () => {
    const game = makeGame({ lineupFirst: [], lineupSecond: [] });
    const s = scorer(game);
    expect(lineupSize(game, 'first')).toBe(9);
    // Nine walks: bases loaded after three, then a run is forced in on each walk.
    s.bat('WALK');
    s.bat('WALK', { move: { 1: 2 } });
    s.bat('WALK', { move: { 2: 3, 1: 2 } });
    for (let i = 3; i < 9; i++) s.bat('WALK', { rbi: 1, move: { 3: 4, 2: 3, 1: 2 } });
    expect(halfInning(game, 'first', 1)).toMatchObject({ runs: 6, rbi: 6, nextBatter: { batterIdx: 0, lap: 1, key: '9' } });
    s.bat('SINGLE', { pos: '7', rbi: 1, move: { 3: 4, 2: 3, 1: 2 } });
    expect(validateGame(game)).toEqual([]);
    // A mistake is explained with the slot number only.
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '4' }, { resultType: 'WALK', rbi: 2, basesReached: 4 });
    const issues = validateGame(game);
    expect(issues.map(i => i.message)).toEqual([
      '1回表：打点が8なのに得点は7点です。ホームに還った走者のマスを開いて『得点』を選んでください。',
      '1回表 5番：四球の打点は最大1点（押し出し）です。',
    ]);
  });

  it('a batter label without a name is just the slot number', () => {
    const game = makeGame({ lineupFirst: [{ name: '' }, { name: null }, {}] });
    game.atBats.first[1] = { 1: { resultType: 'GROUNDOUT', outNumber: 1, runnerEvents: [] } };
    const [c06] = validateGame(game);
    expect(c06.id).toBe('C06');
    expect(c06.message).toBe('1回表の先頭打者は1番のはずです。2番から記録されています。');
  });

  it('messages never show NaN or junk out numbers', () => {
    const game = makeGame();
    game.atBats.first[1] = {
      0: { resultType: 'SINGLE', basesReached: 1, outNumber: NaN, runnerEvents: [] },
      1: { resultType: 'GROUNDOUT', outNumber: 'x', runnerEvents: [] },
      2: { resultType: 'GROUNDOUT', outNumber: Infinity, runnerEvents: [] },
    };
    const messages = validateGame(game).map(i => i.message);
    expect(messages).toContain('1回表 1番 A1：アウトではないのに、アウトの印が付いています。');
    expect(messages).toContain('1回表 2番 A2：アウトの番号が正しくありません。1〜3のどれかです。');
    for (const m of messages) expect(m).not.toMatch(/undefined|NaN|null|Infinity/);
  });

  it('recording into a junk game repairs the containers it needs', () => {
    const game = { atBats: { first: 'junk' } };
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: 0 }, { resultType: 'STRIKEOUT_SWING' });
    expect(game.atBats.first[1]['0'].outNumber).toBe(1);
    expect(clearCell(game, 'second', 4, 2).changedKeys).toEqual([]);
    expect(() => renumberOuts(game, 'second', 4)).not.toThrow();
  });
});

// ============================================
// Property checks over seeded random games
// ============================================

const SIM_CONFIGS = [
  {},
  { tiebreakerInning: 8, tiebreakerRunners: '1B2B' },
  { innings: 5, tiebreakerInning: 5, tiebreakerRunners: '1B' },
  { innings: 6, tiebreakerInning: 7, tiebreakerRunners: '2B' },
  { innings: 3, N: 10 },
];

describe('seeded random legal games (model-based)', () => {
  const SEEDS = 40;

  it('every step keeps the invariants and validateGame stays empty', () => {
    const seen = { walkoff: 0, skip: 0, extra: 0, lap1: 0, tiebreak: 0, runnerThirdOut: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const options = SIM_CONFIGS[seed % SIM_CONFIGS.length];
      const { game, model } = simulateGame(seed, options, (g, m, last, play) => {
        // thirdOut is reported exactly on the play that makes the third out.
        expect(last.thirdOut, `seed ${seed} ${play.id}`).toBe(m.thirdOutExpected);
        if (m.thirdOutExpected && play.runnerOnly) seen.runnerThirdOut++;
        // The engine's score and live situation agree with the model.
        expect(teamTotals(g, 'first').runs).toBe(m.score.first);
        expect(teamTotals(g, 'second').runs).toBe(m.score.second);
        const issues = validateGame(g);
        expect(issues, `seed ${seed} after ${play.id} in ${play.inning}${play.teamKey}`).toEqual([]);
        const h = last.half;
        expect(h.runs).toBe(m.halfRuns[play.teamKey][play.inning]);
        expect(h.rbi).toBe(m.halfRbi[play.teamKey][play.inning]);
        expect(h.outs).toBeLessThanOrEqual(3);
      });
      expectConsistent(game);
      // Game end agrees with the model.
      const end = gameEndState(game);
      expect(end).toMatchObject({ final: true, endReason: model.endReason, winner: model.winner, endAt: model.endAt });
      expect(end.skipBottomInning).toBe(model.skipBottomInning ?? null);
      expect(liveState(game)).toMatchObject({ gameOver: true, inning: model.endAt.inning, teamKey: model.endAt.teamKey });
      const sb = scoreboard(game);
      expect([sb.first.R, sb.second.R]).toEqual([model.score.first, model.score.second]);
      for (const teamKey of ['first', 'second']) {
        sb[teamKey].innings.forEach((v, i) => {
          const n = i + 1;
          if (teamKey === 'second' && n === model.skipBottomInning) expect(v).toBe('X');
          else expect(v).toBe(model.halfRuns[teamKey][n] ?? null);
        });
      }
      if (model.endReason === 'walkoff') seen.walkoff++;
      if (model.skipBottomInning) seen.skip++;
      if (model.endAt.inning > game.innings) seen.extra++;
      for (const teamKey of ['first', 'second']) {
        for (const half of Object.values(game.atBats[teamKey])) {
          const N = lineupSize(game, teamKey);
          if (Object.keys(half).some(k => !k.startsWith('tb') && Number(k) >= N)) seen.lap1++;
          if (Object.keys(half).some(k => k.startsWith('tb'))) seen.tiebreak++;
        }
      }
    }
    // The generator really reached the interesting situations.
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });

  it('saving, loading and normalizing a game changes nothing (v2) and keeps outs valid (legacy)', () => {
    for (let seed = 101; seed <= 115; seed++) {
      const { game } = simulateGame(seed, SIM_CONFIGS[seed % SIM_CONFIGS.length]);
      const json = JSON.stringify(game);
      const again = normalizeGame(JSON.parse(json));
      expect(JSON.stringify(again)).toBe(json);
      // Treated as a v1 save: out numbers are redone in batting order, still 1..k per half.
      const legacy = JSON.parse(json);
      delete legacy.version;
      normalizeGame(legacy);
      expectConsistent(legacy);
      expect(JSON.stringify(scoreboard(legacy))).toBe(JSON.stringify(scoreboard(game)));
      expect(validateGame(legacy)).toEqual([]);
    }
  });

  it('random corruptions produce plain-Japanese messages that point at real cells', () => {
    const RT = Object.keys(RESULT_TYPES);
    const EV = Object.keys(RUNNER_EVENTS);
    const ids = new Set();
    for (let seed = 201; seed <= 260; seed++) {
      const { game } = simulateGame(seed, SIM_CONFIGS[seed % SIM_CONFIGS.length]);
      const r = rng(seed);
      const pick = a => a[Math.floor(r() * a.length)];
      const halves = [];
      for (const t of ['first', 'second']) for (const inn of Object.keys(game.atBats[t])) halves.push([t, inn]);
      for (let m = 0; m < 1 + Math.floor(r() * 4); m++) {
        const [t, inn] = pick(halves);
        const half = game.atBats[t][inn];
        const keys = half ? Object.keys(half) : [];
        if (!keys.length) continue;
        const k = pick(keys);
        const c = half[k];
        switch (Math.floor(r() * 10)) {
          case 0: delete half[k]; break;
          case 1: c.resultType = pick(RT); break;
          case 2: c.rbi = Math.floor(r() * 5); break;
          case 3: c.basesReached = Math.floor(r() * 5); break;
          case 4: c.outNumber = pick([1, 2, 3, 4, null, 0, 'x', NaN]); break;
          case 5: c.runnerEvents = [...(c.runnerEvents || []), { type: pick(EV) }]; break;
          case 6: half[String(Math.floor(r() * 12))] = c; delete half[k]; break;
          case 7: c.resultType = null; break;
          case 8: game.atBats[t][Number(inn) + 1] = { ...(game.atBats[t][Number(inn) + 1] || {}), [String(Math.floor(r() * 9))]: { resultType: pick(RT), basesReached: 1, rbi: 0, runnerEvents: [], outNumber: null } }; break;
          default: half['tb' + Math.floor(r() * 9)] = { resultType: 'TIEBREAK_RUNNER', basesReached: 1 + Math.floor(r() * 3), rbi: 0, runnerEvents: [], outNumber: null };
        }
      }
      if (r() < 0.2) game.lineupFirst = r() < 0.5 ? [] : game.lineupFirst.slice(0, 3);
      if (r() < 0.2) { game.status = 'final'; game.endReason = pick(['called', 'time', '', 'bogus']); }
      const issues = validateGame(game);
      for (const i of issues) {
        ids.add(i.id);
        expect(i.message).not.toMatch(/undefined|NaN|null|\[object|function/);
        expect(['error', 'warning', 'info']).toContain(i.severity);
        expect(['first', 'second']).toContain(i.teamKey);
        expect(Number.isInteger(i.inning) && i.inning >= 1).toBe(true);
        expect(i.message.startsWith(inningLabel(i.inning, i.teamKey))).toBe(true);
        if (i.key !== null) expect(Object.keys(game.atBats[i.teamKey][i.inning])).toContain(i.key);
        // A message about one cell names that batter.
        if (i.key !== null && !i.key.startsWith('tb') && !['C02', 'C04', 'C16', 'C17', 'C19'].includes(i.id)) {
          const b = parseKey(game, i.teamKey, i.key).batterIdx;
          expect(i.message).toContain(`${b + 1}番`);
        }
      }
      expect(() => [scoreboard(game), liveState(game), gameEndState(game)]).not.toThrow();
    }
    expect(ids.size).toBeGreaterThanOrEqual(12);
  });
});

// ============================================
// Contract: names and shapes other modules code against
// ============================================

describe('scoring.js contract', () => {
  it('exports every contracted function', async () => {
    const api = await import('../src/scoring.js');
    const names = [
      'lineupSize', 'cellState', 'isBatterOut', 'isRunnerOut', 'isPlateAppearance', 'isPlacedRunner',
      'parseKey', 'keyFor', 'leadoffFor', 'halfInning', 'inningRuns', 'scoreboard', 'liveState',
      'playerLine', 'teamTotals', 'validateGame', 'nextOutNumber', 'gameEndState',
      'recordPlateAppearance', 'clearCell', 'renumberOuts', 'ensureTiebreakRunners', 'normalizeGame',
    ];
    for (const name of names) expect(typeof api[name], name).toBe('function');
  });

  it('returns the contracted shapes', () => {
    const game = makeGame();
    const s = scorer(game);
    s.bat('SINGLE', { pos: '7' });
    const rec = s.bat('GROUNDOUT', { pos: '4-3', move: { 1: 2 } });
    expect(Object.keys(rec)).toEqual(expect.arrayContaining(['half', 'thirdOut', 'changedKeys']));
    const h = rec.half;
    for (const k of ['teamKey', 'inning', 'N', 'leadoff', 'isTiebreak', 'cells', 'seq', 'outs', 'runs', 'rbi', 'hits', 'pa', 'ab',
      'lob', 'errors', 'runners', 'started', 'complete', 'nextBatter', 'lastBatterIdx']) {
      expect(h, k).toHaveProperty(k);
    }
    expect(Object.keys(h.cells[0])).toEqual(expect.arrayContaining(['key', 'batterIdx', 'lap', 'order', 'cell', 'state', 'isPlaced']));
    expect(h.seq.every(e => h.cells.includes(e))).toBe(true);
    expect(Object.keys(h.runners[0])).toEqual(expect.arrayContaining(['key', 'batterIdx', 'base', 'cell']));
    expect(h.nextBatter).toEqual({ batterIdx: 2, lap: 0, key: '2' });
    expect(Object.keys(liveState(game))).toEqual(expect.arrayContaining(['inning', 'half', 'teamKey', 'halfInning', 'gameOver', 'endReason', 'winner']));
    const sb = scoreboard(game);
    expect(Object.keys(sb)).toEqual(expect.arrayContaining(['maxInning', 'columns', 'first', 'second', 'final', 'winner', 'endReason']));
    expect(Object.keys(sb.first)).toEqual(expect.arrayContaining(['innings', 'R', 'H', 'E', 'LOB']));
    expect(Object.keys(playerLine(game, 'first', 0)).sort()).toEqual(['ab', 'bb', 'h', 'lob', 'pa', 'r', 'rbi', 'so']);
    expect(Object.keys(teamTotals(game, 'first')).sort()).toEqual(['ab', 'errors', 'hits', 'lob', 'pa', 'rbi', 'runs']);
    expect(Object.keys(gameEndState(game))).toEqual(expect.arrayContaining(['final', 'endReason', 'winner', 'skipBottomInning']));
    expect(Object.keys(clearCell(game, 'first', 1, '1'))).toContain('half');
    expect(typeof ensureTiebreakRunners(game, 'first', 1)).toBe('boolean');
    expect(normalizeGame(game)).toBe(game);
    game.atBats.first[1]['5'] = { resultType: 'GROUNDOUT', outNumber: 1, runnerEvents: [] };
    const issue = validateGame(game)[0];
    expect(Object.keys(issue).sort()).toEqual(['id', 'inning', 'key', 'message', 'severity', 'teamKey']);
  });
});

describe('order independence and walk-off checks', () => {
  it('numbers runner outs of one play lead runner first, whatever order the panel passes', () => {
    for (const order of [[0, 1], [1, 0]]) {
      const game = makeGame();
      recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '0' }, { resultType: 'SINGLE', basesReached: 2 });
      recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '1' }, { resultType: 'WALK' });
      const updates = [{ key: '0', out: true }, { key: '1', out: true }];
      recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: '2' }, { resultType: 'DOUBLE_PLAY', positions: '5-4-3' }, order.map(i => updates[i]));
      const h = game.atBats.first[1];
      expect([h['0'].outNumber, h['1'].outNumber, h['2'].outNumber]).toEqual([1, 2, 3]);
      expect(h['0'].runnerEvents).toEqual([{ type: 'RUNNER_OUT', base: 3 }]);
    }
  });

  it('C17 does not fire when the winning RBI is the last plate appearance or the run scored without an RBI', () => {
    // Trailing 0-2 in the bottom of the last inning: two-run HR ties it, a later RBI single wins it.
    const game = makeGame({ innings: 1 });
    const s = scorer(game);
    s.bat('HOMERUN', { pos: '7', rbi: 1 });
    s.bat('HOMERUN', { pos: '7', rbi: 1 });
    s.k(3);
    s.bat('SINGLE', { pos: '7' });
    s.bat('HOMERUN', { pos: '8', rbi: 2, move: { 1: 4 } });
    s.bat('DOUBLE', { pos: '8', base: 2 });
    s.k();
    s.bat('SINGLE', { pos: '9', rbi: 1, move: { 2: 4 } });
    expect(gameEndState(game)).toMatchObject({ final: true, endReason: 'walkoff' });
    expect(validateGame(game)).toEqual([]);
    // Same, but the winning run scores on an error (no RBI): nothing to flag either.
    const g2 = makeGame({ innings: 1 });
    const s2 = scorer(g2);
    s2.k(3);
    s2.bat('DOUBLE', { pos: '8', base: 2 });
    s2.bat('ERROR', { pos: '6', move: { 2: 4 } });
    expect(gameEndState(g2)).toMatchObject({ final: true, endReason: 'walkoff' });
    expect(validateGame(g2)).toEqual([]);
  });

  it('C17 flags a plate appearance after the winning RBI even with a one-run margin', () => {
    const game = makeGame({ innings: 1 });
    const s = scorer(game);
    s.k(3);
    s.bat('TRIPLE', { pos: '9', base: 3 });
    s.bat('SACRIFICE_FLY', { pos: '8', rbi: 1, move: { 3: 4 } });
    // The parent kept going after the game was over.
    recordPlateAppearance(game, { teamKey: 'second', inning: 1, key: '2' }, { resultType: 'GROUNDOUT', positions: '6-3' });
    const issues = validateGame(game);
    expect(issues.map(i => [i.id, i.key])).toEqual([['C17', '2']]);
    expect(issues[0].message).toBe('1回裏：2番 B2の打席で勝ち越し点が入り、その時点で試合終了（サヨナラ）です。そのあとの3番 B3の打席は記録しないでください。');
  });
});

describe('loadGame with damaged saves', () => {
  function withStorage(value, fn) {
    const store = new Map([['waseda-score-current-game', value]]);
    const saved = globalThis.localStorage;
    globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
    try {
      return fn();
    } finally {
      globalThis.localStorage = saved;
    }
  }

  it('returns null for saves that are not a game object', () => {
    for (const v of ['[]', 'null', '"text"', '42', '{broken']) {
      expect(withStorage(v, () => loadGame()), v).toBe(null);
    }
  });

  it('keeps the GameData methods even when the save has a "__proto__" key', () => {
    const game = withStorage('{"__proto__": {"x": 1}, "teamFirst": "若葉", "version": 2}', () => loadGame());
    expect(game).toBeInstanceOf(GameData);
    expect(game.getTeamName('first')).toBe('若葉');
    expect(game.x).toBeUndefined();
  });
});
