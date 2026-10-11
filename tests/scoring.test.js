import { describe, it, expect } from 'vitest';
import {
  lineupSize, cellState, isBatterOut, isRunnerOut, isPlateAppearance, isPlacedRunner,
  parseKey, keyFor, leadoffFor, halfInning, inningRuns, scoreboard, liveState, playerLine,
  teamTotals, validateGame, nextOutNumber, gameEndState, recordPlateAppearance, clearCell,
  renumberOuts, ensureTiebreakRunners, normalizeGame, isTiebreakInning, inningLabel, batterLabel,
} from '../src/scoring.js';
import { VALID, INVALID } from './examples.js';
import {
  T, cell, cells, makeGame, keyAt, fillerSpecs, scoringSpecs, gameWithHalf, buildGame, ids,
} from './helpers.js';

// Builds the game for a spec example (E/X) and returns { game, teamKey, inning }.
function exampleGame(ex) {
  if (ex.gameEndsHere) {
    // Last inning, bottom half, tied 0-0 after the top.
    const game = makeGame({ innings: 1 });
    game.atBats.first[1] = cells(fillerSpecs(0));
    game.atBats.second[1] = cells(ex.cells);
    return { game, teamKey: 'second', inning: 1 };
  }
  const { game, inning } = gameWithHalf({ L: ex.L, cells: ex.cells });
  if (ex.tiebreak) {
    game.tiebreakerInning = inning;
    game.tiebreakerRunners = ex.tiebreak;
  }
  if (ex.completed) {
    // Data in a later half-inning makes this one complete.
    game.atBats.second[inning] = cells(fillerSpecs(0));
  }
  return { game, teamKey: 'first', inning };
}

function out(resultType, outNumber, extra = {}) {
  return { resultType, outNumber, ...extra };
}

// ============================================
// Spec examples
// ============================================

describe('spec examples E1–E12 (valid half-innings)', () => {
  for (const ex of VALID) {
    it(`${ex.id}: ${ex.note}`, () => {
      const { game, teamKey, inning } = exampleGame(ex);
      const h = halfInning(game, teamKey, inning);
      const e = ex.expect;
      expect(h.leadoff).toBe(ex.L);
      expect({
        outs: h.outs, runs: h.runs, rbi: h.rbi, hits: h.hits, lob: h.lob, pa: h.pa, ab: h.ab,
      }).toEqual({ outs: e.outs, runs: e.runs, rbi: e.rbi, hits: e.hits, lob: e.lob, pa: e.pa, ab: e.ab });
      expect(h.errors).toBe(e.errorsChargedToDefense || 0);
      expect(h.placed).toBe(e.placed || 0);
      expect(h.complete).toBe(true);
      expect(leadoffFor(game, teamKey, inning + 1)).toBe(e.nextLeadoff);
      // Reconciliation: PA + placed runners = runs + LOB + outs
      expect(h.pa + h.placed).toBe(h.runs + h.lob + h.outs);
      expect(validateGame(game)).toEqual([]);
    });
  }

  it('E10 is recognised as a tiebreak inning with the expected placed runners', () => {
    const ex = VALID.find(x => x.id === 'E10');
    const { game, inning } = exampleGame(ex);
    const h = halfInning(game, 'first', inning);
    expect(h.isTiebreak).toBe(true);
    expect(isTiebreakInning(game, inning)).toBe(true);
    expect(h.cells.slice(0, 2).map(c => [c.key, c.isPlaced])).toEqual([['tb2', true], ['tb3', true]]);
    expect(h.seq.map(c => c.key)).toEqual(['4', '5', '6']);
  });

  it('E11 ends the game with a walk-off (one out is enough)', () => {
    const { game } = exampleGame(VALID.find(x => x.id === 'E11'));
    expect(gameEndState(game)).toMatchObject({ final: true, endReason: 'walkoff', winner: 'second', skipBottomInning: null });
    const h = halfInning(game, 'second', 1);
    expect(h.complete).toBe(true);
    expect(h.nextBatter).toBe(null);
    const live = liveState(game);
    expect(live).toMatchObject({ inning: 1, half: 'bottom', teamKey: 'second', gameOver: true, endReason: 'walkoff', winner: 'second' });
  });

  it('E12 puts the second plate appearance of 1番 under key 9', () => {
    const { game } = exampleGame(VALID.find(x => x.id === 'E12'));
    const h = halfInning(game, 'first', 1);
    const second = h.seq[h.seq.length - 1];
    expect(second).toMatchObject({ key: '9', batterIdx: 0, lap: 1, order: 9 });
    expect(playerLine(game, 'first', 0)).toEqual({ pa: 2, ab: 2, h: 1, rbi: 0, r: 1, bb: 0, so: 0, lob: 0 });
  });
});

describe('spec examples X1–X6 (invalid half-innings)', () => {
  for (const ex of INVALID) {
    it(`${ex.id}: ${ex.note}`, () => {
      const { game } = exampleGame(ex);
      const issues = validateGame(game);
      const expected = ex.expectChecks.map(c => c.replace(/\(.*\)/, '')).sort();
      expect(ids(issues)).toEqual(expected);
      for (const c of ex.expectChecks) {
        const m = /^(C\d\d)\((\w+)\)$/.exec(c);
        if (m) expect(issues.filter(i => i.id === m[1]).every(i => i.severity === m[2])).toBe(true);
      }
      for (const issue of issues) {
        expect(issue.teamKey).toBe('first');
        expect(typeof issue.message).toBe('string');
        expect(issue.message.length).toBeGreaterThan(5);
      }
    });
  }

  it('X5 explains the expected leadoff with the previous batter and names', () => {
    const { game } = exampleGame(INVALID.find(x => x.id === 'X5'));
    const [issue] = validateGame(game);
    expect(issue).toMatchObject({ id: 'C06', severity: 'error', teamKey: 'first', inning: 2, key: '5' });
    expect(issue.message).toBe('2回表の先頭打者は4番 A4のはずです（前の回は3番 A3で終わりました）。6番 A6から記録されています。');
  });

  it('X1 message follows the spec wording', () => {
    const { game } = exampleGame(INVALID.find(x => x.id === 'X1'));
    expect(validateGame(game)[0].message).toBe('1回表：打点が1なのに得点は0点です。ホームに還った走者のマスを開いて『得点』を選んでください。');
  });
});

// ============================================
// Cell semantics
// ============================================

describe('cell state', () => {
  it('classifies batter outs, runner outs, scored and on-base cells', () => {
    expect(cellState(null)).toBe('EMPTY');
    expect(cellState(cell({}))).toBe('EMPTY');
    expect(cellState(cell({ resultType: 'GROUNDOUT' }))).toBe('OUT');
    expect(cellState(cell({ resultType: 'SINGLE', basesReached: 1 }))).toBe('ON_BASE');
    expect(cellState(cell({ resultType: 'SINGLE', basesReached: 4 }))).toBe('SCORED');
    expect(cellState(cell({ resultType: 'STRIKEOUT_WILD', basesReached: 1 }))).toBe('ON_BASE');
    expect(isBatterOut(cell({ resultType: 'SACRIFICE_FLY' }))).toBe(true);
    expect(isPlateAppearance(cell({ resultType: 'TIEBREAK_RUNNER', basesReached: 2 }))).toBe(false);
    expect(isPlacedRunner(cell({ resultType: 'TIEBREAK_RUNNER', basesReached: 2 }))).toBe(true);
  });

  it('counts CS, PICKOFF and RUNNER_OUT as outs', () => {
    for (const type of ['CAUGHT_STEALING', 'PICKOFF', 'RUNNER_OUT']) {
      const c = cell({ resultType: 'WALK', basesReached: 1, runnerEvents: [T(type)] });
      expect(isRunnerOut(c)).toBe(true);
      expect(cellState(c)).toBe('OUT');
    }
    const game = makeGame();
    game.atBats.first[1] = cells({
      0: { resultType: 'SINGLE', basesReached: 1, runnerEvents: [T('CAUGHT_STEALING')], outNumber: 1 },
      1: { resultType: 'WALK', basesReached: 1, runnerEvents: [T('PICKOFF')], outNumber: 2 },
      2: { resultType: 'HIT_BY_PITCH', basesReached: 2, runnerEvents: [T('RUNNER_OUT')], outNumber: 3 },
    });
    const h = halfInning(game, 'first', 1);
    expect(h.outs).toBe(3);
    expect(h.complete).toBe(true);
    expect(h.nextBatter).toBe(null);
    expect(validateGame(game)).toEqual([]);
  });

  it('treats legacy basesReached 0 on a hit as a runner out', () => {
    const c = cell({ resultType: 'SINGLE', basesReached: 0 });
    expect(isRunnerOut(c)).toBe(true);
    expect(cellState(c)).toBe('OUT');
    const game = makeGame();
    game.atBats.first[1] = cells({ 0: { resultType: 'SINGLE', basesReached: 0, outNumber: 1 } });
    expect(halfInning(game, 'first', 1).outs).toBe(1);
    expect(validateGame(game).map(i => [i.id, i.severity])).toEqual([['C18', 'info']]);
  });

  it('does not treat stolen bases or wild pitches as outs', () => {
    const c = cell({ resultType: 'WALK', basesReached: 3, runnerEvents: [T('STOLEN_BASE'), T('WILD_PITCH')] });
    expect(cellState(c)).toBe('ON_BASE');
  });
});

describe('keys and lineup size', () => {
  it('maps keys to batter slot and lap', () => {
    const game = makeGame();
    expect(lineupSize(game, 'first')).toBe(9);
    expect(parseKey(game, 'first', '3')).toEqual({ batterIdx: 3, lap: 0, isPlaced: false });
    expect(parseKey(game, 'first', 12)).toEqual({ batterIdx: 3, lap: 1, isPlaced: false });
    expect(parseKey(game, 'first', 'tb5')).toEqual({ batterIdx: 5, lap: 0, isPlaced: true });
    expect(keyFor(game, 'first', 3)).toBe('3');
    expect(keyFor(game, 'first', 3, 1)).toBe('12');
  });

  it('uses the lineup length (legacy DH games may have 10) and defaults to 9', () => {
    const game = makeGame({ lineupFirst: Array.from({ length: 10 }, () => ({ name: '' })), lineupSecond: [] });
    expect(lineupSize(game, 'first')).toBe(10);
    expect(lineupSize(game, 'second')).toBe(9);
    expect(keyFor(game, 'first', 0, 1)).toBe('10');
  });

  it('labels innings and batters', () => {
    const game = makeGame();
    game.lineupFirst[3].name = '  田中 ';
    game.lineupFirst[4].name = '';
    expect(inningLabel(3, 'first')).toBe('3回表');
    expect(inningLabel(3, 'second')).toBe('3回裏');
    expect(batterLabel(game, 'first', 3)).toBe('4番 田中');
    expect(batterLabel(game, 'first', 4)).toBe('5番');
  });
});

// ============================================
// Runs, RBI, LOB, totals
// ============================================

describe('runs and RBI', () => {
  it('counts a solo home run as one run (RBI is never added to runs)', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({ 0: { resultType: 'HOMERUN', rbi: 1, basesReached: 4 } });
    expect(halfInning(game, 'first', 1).runs).toBe(1);
    expect(inningRuns(game, 'first', 1)).toBe(1);
    expect(teamTotals(game, 'first')).toMatchObject({ runs: 1, rbi: 1, hits: 1 });
    expect(scoreboard(game).first.R).toBe(1);
  });

  it('counts a runner who scored plus the RBI hit as one run', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({
      0: { resultType: 'SINGLE', basesReached: 4 },
      1: { resultType: 'DOUBLE', rbi: 1, basesReached: 2 },
    });
    expect(halfInning(game, 'first', 1).runs).toBe(1);
  });

  it('counts a 3-run home run as three runs once the runners are marked scored', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({
      0: { resultType: 'SINGLE', basesReached: 4 },
      1: { resultType: 'WALK', basesReached: 4 },
      2: { resultType: 'HOMERUN', rbi: 3, basesReached: 4 },
    });
    expect(halfInning(game, 'first', 1)).toMatchObject({ runs: 3, rbi: 3 });
    expect(validateGame(game)).toEqual([]);
  });

  it('computes LOB only for finished half-innings and lists current runners', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({
      0: { resultType: 'WALK', basesReached: 2 },
      1: { resultType: 'SINGLE', basesReached: 1 },
      2: out('STRIKEOUT_SWING', 1),
    });
    let h = halfInning(game, 'first', 1);
    expect(h.complete).toBe(false);
    expect(h.lob).toBe(0);
    expect(h.runners.map(r => [r.key, r.base, r.order, r.isPlaced])).toEqual([['1', 1, 1, false], ['0', 2, 0, false]]);
    game.atBats.first[1][3] = cell(out('FLYOUT', 2, { positions: '8' }));
    game.atBats.first[1][4] = cell(out('GROUNDOUT', 3, { positions: '6-3' }));
    h = halfInning(game, 'first', 1);
    expect(h.complete).toBe(true);
    expect(h.lob).toBe(2);
    expect(playerLine(game, 'first', 0).lob).toBe(1);
    expect(scoreboard(game).first.LOB).toBe(2);
  });

  it('charges errors to the fielding team (ERROR, INTERFERENCE and errors on advances)', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({
      0: { resultType: 'ERROR', positions: '6', basesReached: 2, runnerEvents: [T('ADVANCE_ON_ERROR')] },
      1: { resultType: 'INTERFERENCE', basesReached: 1 },
    });
    expect(halfInning(game, 'first', 1).errors).toBe(3);
    expect(teamTotals(game, 'second').errors).toBe(3);
    expect(teamTotals(game, 'first').errors).toBe(0);
    expect(scoreboard(game).second.E).toBe(3);
  });

  it('builds player lines across innings and laps', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({
      0: { resultType: 'WALK', basesReached: 4 },
      1: { resultType: 'STRIKEOUT_LOOK', outNumber: 1 },
      2: { resultType: 'HIT_BY_PITCH', basesReached: 1 },
      3: { resultType: 'DOUBLE', rbi: 1, basesReached: 2 },
      4: out('GROUNDOUT', 2),
      5: out('FLYOUT', 3),
    });
    game.atBats.first[2] = cells({
      6: { resultType: 'SINGLE', basesReached: 1 },
    });
    expect(playerLine(game, 'first', 0)).toEqual({ pa: 1, ab: 0, h: 0, rbi: 0, r: 1, bb: 1, so: 0, lob: 0 });
    expect(playerLine(game, 'first', 1)).toEqual({ pa: 1, ab: 1, h: 0, rbi: 0, r: 0, bb: 0, so: 1, lob: 0 });
    expect(playerLine(game, 'first', 3)).toEqual({ pa: 1, ab: 1, h: 1, rbi: 1, r: 0, bb: 0, so: 0, lob: 1 });
    expect(playerLine(game, 'first', 6)).toEqual({ pa: 1, ab: 1, h: 1, rbi: 0, r: 0, bb: 0, so: 0, lob: 0 });
    expect(teamTotals(game, 'first')).toEqual({ runs: 1, hits: 2, errors: 0, lob: 2, rbi: 1, pa: 7, ab: 5 });
  });
});

// ============================================
// Batting order
// ============================================

describe('batting order', () => {
  it('starts the next inning after the last batter', () => {
    const game = makeGame();
    game.atBats.first[1] = cells(fillerSpecs(0, 1)); // 0 walks, 1-3 strike out
    expect(leadoffFor(game, 'first', 1)).toBe(0);
    expect(leadoffFor(game, 'first', 2)).toBe(4);
  });

  it('after a half that ended on a runner out, the batter at the plate leads off next (E8 rule)', () => {
    const { game, inning } = gameWithHalf({ L: 2, cells: VALID.find(x => x.id === 'E8').cells });
    expect(leadoffFor(game, 'first', inning + 1)).toBe(5);
    expect(halfInning(game, 'first', inning + 1).nextBatter).toEqual({ batterIdx: 5, lap: 0, key: '5' });
  });

  it('continues from the latest half with data when a half was left empty', () => {
    const game = makeGame();
    game.atBats.first[1] = cells(fillerSpecs(0, 0));
    expect(leadoffFor(game, 'first', 3)).toBe(3);
    game.atBats.first[3] = cells(fillerSpecs(3, 1));
    expect(leadoffFor(game, 'first', 4)).toBe(7);
    expect(validateGame(game)).toEqual([]);
  });

  it('wraps from 9番 to 1番 within an inning', () => {
    const game = makeGame();
    game.atBats.first[1] = cells(fillerSpecs(0, 3)); // 0-2 walk, 3-5 strike out
    game.atBats.first[2] = cells({ 6: { resultType: 'SINGLE', basesReached: 1 }, 7: { resultType: 'WALK', basesReached: 2 }, 8: out('GROUNDOUT', 1) });
    expect(halfInning(game, 'first', 2).nextBatter).toEqual({ batterIdx: 0, lap: 0, key: '0' });
  });

  it('sends the 10th plate appearance of an inning to key b+N (batting around)', () => {
    const game = makeGame();
    const specs = { ...VALID.find(x => x.id === 'E12').cells };
    delete specs[9];
    game.atBats.first[1] = cells(specs);
    let h = halfInning(game, 'first', 1);
    expect(h.pa).toBe(9);
    expect(h.nextBatter).toEqual({ batterIdx: 0, lap: 1, key: '9' });
    const res = recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: h.nextBatter.key }, { resultType: 'FLYOUT', positions: '8' });
    expect(game.atBats.first[1]['0'].resultType).toBe('SINGLE'); // first PA untouched
    expect(game.atBats.first[1]['9']).toMatchObject({ resultType: 'FLYOUT', outNumber: 3 });
    expect(res.thirdOut).toBe(true);
    h = res.half;
    expect(h.nextBatter).toBe(null);
    expect(leadoffFor(game, 'first', 2)).toBe(1);
  });

  it('wraps nextBatter into lap 1 when the inning started mid-order', () => {
    const game = makeGame();
    game.atBats.first[1] = cells(fillerSpecs(0, 1)); // next leadoff 4
    const specs = {};
    for (let i = 0; i < 9; i++) specs[keyAt(4, i)] = { resultType: 'HOMERUN', rbi: 1, basesReached: 4 };
    game.atBats.first[2] = cells(specs);
    expect(halfInning(game, 'first', 2).nextBatter).toEqual({ batterIdx: 4, lap: 1, key: '13' });
  });
});

// ============================================
// recordPlateAppearance / clearCell / renumberOuts
// ============================================

describe('recordPlateAppearance', () => {
  const at = key => ({ teamKey: 'first', inning: 1, key });

  it('numbers new outs in recording order and keeps the number on re-edit', () => {
    const game = makeGame();
    let r = recordPlateAppearance(game, at(0), { resultType: 'GROUNDOUT', positions: '6-3' });
    expect(game.atBats.first[1]['0'].outNumber).toBe(1);
    expect(r.thirdOut).toBe(false);
    expect(r.changedKeys).toEqual(['0']);
    r = recordPlateAppearance(game, at(1), { resultType: 'FLYOUT', positions: '8' });
    expect(game.atBats.first[1]['1'].outNumber).toBe(2);
    expect(nextOutNumber(game, 'first', 1)).toBe(3);
    expect(nextOutNumber(game, 'first', 1, '1')).toBe(2);

    r = recordPlateAppearance(game, at(0), { resultType: 'GROUNDOUT', positions: '5-3' });
    expect(game.atBats.first[1]['0']).toMatchObject({ positions: '5-3', outNumber: 1 });
    expect(game.atBats.first[1]['1'].outNumber).toBe(2);
    expect(r.half.outs).toBe(2);
    expect(r.changedKeys).toEqual(['0']);
  });

  it('reports thirdOut only on the call that reaches three outs', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'STRIKEOUT_SWING' });
    recordPlateAppearance(game, at(1), { resultType: 'STRIKEOUT_SWING' });
    const r = recordPlateAppearance(game, at(2), { resultType: 'STRIKEOUT_LOOK' });
    expect(r.thirdOut).toBe(true);
    expect(r.half.complete).toBe(true);
    const again = recordPlateAppearance(game, at(2), { resultType: 'STRIKEOUT_SWING' });
    expect(again.thirdOut).toBe(false);
    expect(game.atBats.first[1]['2'].outNumber).toBe(3);
  });

  it('renumbers the remaining outs when an out becomes a hit', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'GROUNDOUT', positions: '6-3' });
    recordPlateAppearance(game, at(1), { resultType: 'FLYOUT', positions: '8' });
    recordPlateAppearance(game, at(2), { resultType: 'LINEOUT', positions: '6' });
    const r = recordPlateAppearance(game, at(0), { resultType: 'SINGLE', positions: '7', basesReached: 1 });
    const h = game.atBats.first[1];
    expect(h['0'].outNumber).toBe(null);
    expect(h['1'].outNumber).toBe(1);
    expect(h['2'].outNumber).toBe(2);
    expect(r.half.outs).toBe(2);
    expect(r.changedKeys.sort()).toEqual(['0', '1', '2']);
  });

  it('clearCell deletes the cell and renumbers outs', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'GROUNDOUT', positions: '6-3' });
    recordPlateAppearance(game, at(1), { resultType: 'FLYOUT', positions: '8' });
    recordPlateAppearance(game, at(2), { resultType: 'STRIKEOUT_SWING' });
    const r = clearCell(game, 'first', 1, 0);
    expect(game.atBats.first[1]['0']).toBeUndefined();
    expect(game.atBats.first[1]['1'].outNumber).toBe(1);
    expect(game.atBats.first[1]['2'].outNumber).toBe(2);
    expect(r.half.outs).toBe(2);
    clearCell(game, 'first', 1, '1');
    clearCell(game, 'first', 1, '2');
    expect(game.atBats.first[1]).toBeUndefined();
    expect(halfInning(game, 'first', 1).started).toBe(false);
  });

  it('records a double play: the runner gets the lower out number, two outs in total', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'SINGLE', positions: '8', basesReached: 1 });
    const r = recordPlateAppearance(game, at(1), { resultType: 'DOUBLE_PLAY', positions: '6-4-3' }, [{ key: '0', out: true }]);
    const h = game.atBats.first[1];
    expect(h['0'].runnerEvents).toEqual([{ type: 'RUNNER_OUT', base: 2 }]);
    expect(h['0'].basesReached).toBe(1);
    expect(h['0'].outNumber).toBe(1);
    expect(h['1'].outNumber).toBe(2);
    expect(r.half.outs).toBe(2);
    expect(r.changedKeys.sort()).toEqual(['0', '1']);
    expect(validateGame(game)).toEqual([]);
  });

  it('keeps the runner first on a DP even when the panel passes the pre-update number', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'WALK' });
    recordPlateAppearance(game, at(1), { resultType: 'DOUBLE_PLAY', positions: '4-6-3', outNumber: 1 }, [{ key: '0', out: true }]);
    expect(game.atBats.first[1]['0'].outNumber).toBe(1);
    expect(game.atBats.first[1]['1'].outNumber).toBe(2);
  });

  it('honours an explicit out number and shifts the others', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'WALK' });
    recordPlateAppearance(game, at(1), { resultType: 'STRIKEOUT_SWING' });
    recordPlateAppearance(game, at(2), { resultType: 'STRIKEOUT_SWING' });
    // 1番 was caught stealing during 2番's at-bat: make him the 1st out.
    recordPlateAppearance(game, at(0), { resultType: 'WALK', basesReached: 1, runnerEvents: [T('CAUGHT_STEALING')], outNumber: 1 });
    const h = game.atBats.first[1];
    expect([h['0'].outNumber, h['1'].outNumber, h['2'].outNumber]).toEqual([1, 2, 3]);
  });

  it('applies runner updates: advance, score, out with event type, and undo an out', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'WALK' });
    recordPlateAppearance(game, at(1), { resultType: 'SINGLE', basesReached: 1 }, [{ key: '0', basesReached: 2 }]);
    expect(game.atBats.first[1]['0'].basesReached).toBe(2);
    recordPlateAppearance(game, at(2), { resultType: 'DOUBLE', rbi: 1, basesReached: 2 }, [{ key: '0', basesReached: 4 }, { key: '1', basesReached: 3 }]);
    expect(halfInning(game, 'first', 1)).toMatchObject({ runs: 1, rbi: 1, outs: 0 });
    recordPlateAppearance(game, at(3), { resultType: 'STRIKEOUT_SWING' }, [{ key: '1', out: true, eventType: 'PICKOFF' }]);
    expect(game.atBats.first[1]['1']).toMatchObject({ basesReached: 3, outNumber: 1, runnerEvents: [{ type: 'PICKOFF', base: 3 }] });
    expect(game.atBats.first[1]['3'].outNumber).toBe(2);
    recordPlateAppearance(game, at(3), { resultType: 'STRIKEOUT_SWING' }, [{ key: '1', out: false }]);
    expect(game.atBats.first[1]['1']).toMatchObject({ runnerEvents: [], outNumber: null });
    expect(game.atBats.first[1]['3'].outNumber).toBe(1);
    expect(validateGame(game)).toEqual([]);
  });

  it('ignores runner updates for unknown keys, the batter himself and batter-out cells', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'GROUNDOUT', positions: '6-3' });
    const r = recordPlateAppearance(game, at(1), { resultType: 'SINGLE' }, [{ key: '0', out: true }, { key: '7', basesReached: 2 }, { key: '1', basesReached: 3 }]);
    expect(game.atBats.first[1]['0'].runnerEvents).toEqual([]);
    expect(game.atBats.first[1]['1'].basesReached).toBe(1);
    expect(game.atBats.first[1]['7']).toBeUndefined();
    expect(r.changedKeys).toEqual(['1']);
  });

  it('sanitizes the result', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'STRIKEOUT_SWING', positions: '6-3', rbi: 2, basesReached: 2, runnerEvents: [T('STOLEN_BASE')] });
    expect(game.atBats.first[1]['0']).toMatchObject({ positions: '', rbi: 0, basesReached: 0, runnerEvents: [], outNumber: 1 });
    recordPlateAppearance(game, at(1), { resultType: 'FLYOUT', positions: ' 8 ', rbi: 1 });
    expect(game.atBats.first[1]['1']).toMatchObject({ positions: '8', rbi: 0 });
    recordPlateAppearance(game, at(2), { resultType: 'SINGLE', rbi: 9, basesReached: 7, runnerEvents: [T('STOLEN_BASE'), T('BOGUS'), null] });
    expect(game.atBats.first[1]['2']).toMatchObject({ rbi: 4, basesReached: 4, runnerEvents: [{ type: 'STOLEN_BASE' }] });
    recordPlateAppearance(game, at(2), { resultType: 'SINGLE', rbi: -3, basesReached: '2' });
    expect(game.atBats.first[1]['2']).toMatchObject({ rbi: 0, basesReached: 2 });
    recordPlateAppearance(game, at(2), { resultType: 'SINGLE', rbi: '2', basesReached: 1 });
    expect(game.atBats.first[1]['2'].rbi).toBe(2);
    recordPlateAppearance(game, at(3), { resultType: 'HOMERUN', rbi: 1, basesReached: 1 });
    expect(game.atBats.first[1]['3'].basesReached).toBe(4);
    recordPlateAppearance(game, at(4), { resultType: 'WALK' });
    expect(game.atBats.first[1]['4']).toMatchObject({ basesReached: 1, positions: '' });
    recordPlateAppearance(game, at(5), { resultType: 'STRIKEOUT_WILD', rbi: 1 });
    expect(game.atBats.first[1]['5']).toMatchObject({ basesReached: 1, rbi: 0, outNumber: null });
  });

  it('keeps the note unless a new one is given', () => {
    const game = makeGame();
    recordPlateAppearance(game, at(0), { resultType: 'SINGLE', note: '初球' });
    recordPlateAppearance(game, at(0), { resultType: 'DOUBLE' });
    expect(game.atBats.first[1]['0'].note).toBe('初球');
    recordPlateAppearance(game, at(0), { resultType: 'DOUBLE', note: '' });
    expect(game.atBats.first[1]['0'].note).toBe('');
  });

  it('updates only base, runner events and note of a placed tiebreak runner', () => {
    const game = makeGame();
    game.atBats.first[1] = { tb8: cell({ resultType: 'TIEBREAK_RUNNER', basesReached: 1, batterIdx: 8 }) };
    recordPlateAppearance(game, at('tb8'), { resultType: 'SINGLE', positions: '7', rbi: 2, basesReached: 3, runnerEvents: [T('STOLEN_BASE')], note: 'x' });
    expect(game.atBats.first[1].tb8).toEqual({
      resultType: 'TIEBREAK_RUNNER', positions: '', rbi: 0, basesReached: 3, outNumber: null,
      runnerEvents: [{ type: 'STOLEN_BASE' }], note: 'x', batterIdx: 8,
    });
    recordPlateAppearance(game, at('tb8'), { runnerEvents: [T('CAUGHT_STEALING')] });
    expect(game.atBats.first[1].tb8).toMatchObject({ basesReached: 3, outNumber: 1 });
    expect(halfInning(game, 'first', 1).outs).toBe(1);
  });

  it('rejects a missing key', () => {
    expect(() => recordPlateAppearance(makeGame(), { teamKey: 'first', inning: 1 }, { resultType: 'WALK' })).toThrow(TypeError);
  });

  it('accepts a string inning and keeps keys as strings', () => {
    const game = makeGame();
    recordPlateAppearance(game, { teamKey: 'second', inning: '2', key: 4 }, { resultType: 'WALK' });
    expect(Object.keys(game.atBats.second[2])).toEqual(['4']);
  });
});

describe('recording the spec examples through the API', () => {
  const at = key => ({ teamKey: 'first', inning: 1, key });

  it('E5: double, single, 6-4-3 double play with the runner from third scoring, strikeout', () => {
    const game = makeGame();
    game.atBats.first[1] = cells(fillerSpecs(0, 1)); // next leadoff 5番 (idx 4)
    const at2 = key => ({ teamKey: 'first', inning: 2, key });
    recordPlateAppearance(game, at2(4), { resultType: 'DOUBLE', positions: '7' });
    recordPlateAppearance(game, at2(5), { resultType: 'SINGLE', positions: '8' }, [{ key: '4', basesReached: 3 }]);
    const dp = recordPlateAppearance(game, at2(6), { resultType: 'DOUBLE_PLAY', positions: '6-4-3' },
      [{ key: '5', out: true }, { key: '4', basesReached: 4 }]);
    expect(dp.half.outs).toBe(2);
    const k = recordPlateAppearance(game, at2(7), { resultType: 'STRIKEOUT_LOOK' });
    expect(k.thirdOut).toBe(true);
    const ex = VALID.find(x => x.id === 'E5');
    const h = halfInning(game, 'first', 2);
    expect({ outs: h.outs, runs: h.runs, rbi: h.rbi, hits: h.hits, lob: h.lob, pa: h.pa, ab: h.ab })
      .toEqual({ outs: 3, runs: 1, rbi: 0, hits: 2, lob: 0, pa: 4, ab: 4 });
    for (const [key, spec] of Object.entries(ex.cells)) {
      expect(game.atBats.first[2][key]).toMatchObject({ resultType: spec.resultType, outNumber: spec.outNumber ?? null, basesReached: spec.basesReached ?? 0 });
    }
    expect(game.atBats.first[2]['5'].runnerEvents).toEqual([{ type: 'RUNNER_OUT', base: 2 }]);
    expect(leadoffFor(game, 'first', 3)).toBe(ex.expect.nextLeadoff);
    expect(validateGame(game)).toEqual([]);
  });

  it('E8: the third out is a caught stealing recorded on the runner cell', () => {
    const game = makeGame();
    // 1回: 1-2番 walk, 3-5番 K; 2回: 6-8番 walk, 9-2番 K → 3回は3番 (idx 2) から
    game.atBats.first = { 1: cells(fillerSpecs(0, 2)), 2: cells(fillerSpecs(5, 3)) };
    const at3 = key => ({ teamKey: 'first', inning: 3, key });
    expect(leadoffFor(game, 'first', 3)).toBe(2);
    recordPlateAppearance(game, at3(2), { resultType: 'SINGLE', positions: '7' });
    recordPlateAppearance(game, at3(3), { resultType: 'STRIKEOUT_SWING' });
    recordPlateAppearance(game, at3(4), { resultType: 'STRIKEOUT_LOOK' });
    expect(halfInning(game, 'first', 3).nextBatter).toEqual({ batterIdx: 5, lap: 0, key: '5' });
    const cs = recordPlateAppearance(game, at3(2), { resultType: 'SINGLE', positions: '7', basesReached: 1, runnerEvents: [T('CAUGHT_STEALING')] });
    expect(cs.thirdOut).toBe(true);
    expect(game.atBats.first[3]['2']).toMatchObject({ outNumber: 3, runnerEvents: [{ type: 'CAUGHT_STEALING' }] });
    expect(cs.half.nextBatter).toBe(null);
    expect(leadoffFor(game, 'first', 4)).toBe(5);
    // The other team was never recorded: its earlier halves count as done, 3回裏 is next.
    expect(liveState(game)).toMatchObject({ inning: 3, half: 'bottom', gameOver: false });
    expect(validateGame(game)).toEqual([]);
  });
});

describe('renumberOuts', () => {
  it('compacts numbers, removes numbers from non-outs, and orders unnumbered outs by batting order', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({
      0: out('GROUNDOUT', 3),
      1: { resultType: 'SINGLE', basesReached: 1, outNumber: 2 },
      2: out('FLYOUT', null),
      3: out('LINEOUT', 1),
    });
    renumberOuts(game, 'first', 1);
    const h = game.atBats.first[1];
    expect([h['3'].outNumber, h['0'].outNumber, h['2'].outNumber, h['1'].outNumber]).toEqual([1, 2, 3, null]);
  });
});

// ============================================
// Tiebreak
// ============================================

describe('ensureTiebreakRunners', () => {
  // 2 innings, 0-0; both teams: 1回 1-3番, 2回 4-6番 → next leadoff 7番 (idx 6).
  function tiedGame(mode, extra = {}) {
    const game = makeGame({ innings: 2, tiebreakerInning: 3, tiebreakerRunners: mode, ...extra });
    game.atBats.first[1] = cells(fillerSpecs(0, 0));
    game.atBats.first[2] = cells(fillerSpecs(3, 0));
    game.atBats.second[1] = cells(fillerSpecs(0, 0));
    game.atBats.second[2] = cells(fillerSpecs(3, 0));
    return game;
  }

  it('places 1B2B runners from the previous two batters, once', () => {
    const game = tiedGame('1B2B');
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(true);
    expect(game.atBats.first[3]).toEqual({
      tb5: { resultType: 'TIEBREAK_RUNNER', positions: '', rbi: 0, basesReached: 1, outNumber: null, runnerEvents: [], note: '', batterIdx: 5 },
      tb4: { resultType: 'TIEBREAK_RUNNER', positions: '', rbi: 0, basesReached: 2, outNumber: null, runnerEvents: [], note: '', batterIdx: 4 },
    });
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(false);
    const h = halfInning(game, 'first', 3);
    expect(h).toMatchObject({ isTiebreak: true, placed: 2, started: false, pa: 0, leadoff: 6 });
    expect(h.runners.map(r => [r.key, r.base])).toEqual([['tb5', 1], ['tb4', 2]]);
    expect(h.nextBatter).toEqual({ batterIdx: 6, lap: 0, key: '6' });
    // Placed runners alone do not start the half: the scoreboard stays blank, the live half is still 3回表.
    expect(inningRuns(game, 'first', 3)).toBe(null);
    expect(liveState(game)).toMatchObject({ inning: 3, half: 'top', gameOver: false });
    expect(ensureTiebreakRunners(game, 'second', 3)).toBe(true);
    expect(Object.keys(game.atBats.second[3]).sort()).toEqual(['tb4', 'tb5']);
    expect(validateGame(game)).toEqual([]);
  });

  it('places a single runner for 1B and 2B', () => {
    let game = tiedGame('1B');
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(true);
    expect(Object.keys(game.atBats.first[3])).toEqual(['tb5']);
    expect(game.atBats.first[3].tb5.basesReached).toBe(1);
    game = tiedGame('2B');
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(true);
    expect(Object.keys(game.atBats.first[3])).toEqual(['tb5']);
    expect(game.atBats.first[3].tb5.basesReached).toBe(2);
  });

  it('does nothing when not tied, not configured, too early or the previous inning is unfinished', () => {
    let game = tiedGame('1B2B');
    game.atBats.first[2] = cells(scoringSpecs(3, 1));
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(false); // 1-0 after 2 → the game is over anyway
    game = tiedGame('none');
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(false);
    game = tiedGame('1B2B', { tiebreakerInning: 0 });
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(false);
    game = tiedGame('1B2B');
    expect(ensureTiebreakRunners(game, 'first', 2)).toBe(false);
    game = tiedGame('1B2B');
    delete game.atBats.second[2][keyAt(3, 2)]; // 2回裏 has only 2 outs
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(false);
  });

  it('does nothing once the game is marked final', () => {
    const game = tiedGame('1B2B', { status: 'final', endReason: 'time' });
    expect(ensureTiebreakRunners(game, 'first', 3)).toBe(false);
  });
});

// ============================================
// Game end, scoreboard, live state
// ============================================

describe('game end and scoreboard', () => {
  // G1: 7回制, 先攻 0,1,0,2,0,0,0 = 3, 後攻 1,0,2,0,1,0,X = 4
  const G1 = () => buildGame({ first: [0, 1, 0, 2, 0, 0, 0], second: [1, 0, 2, 0, 1, 0, null] });

  it("G1: shows 'X' for the unneeded bottom of the last inning", () => {
    const game = G1();
    const sb = scoreboard(game);
    expect(sb.maxInning).toBe(7);
    expect(sb.columns).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sb.first.innings).toEqual([0, 1, 0, 2, 0, 0, 0]);
    expect(sb.second.innings).toEqual([1, 0, 2, 0, 1, 0, 'X']);
    expect(sb.first).toMatchObject({ R: 3, H: 3, E: 0, LOB: 0 });
    expect(sb.second).toMatchObject({ R: 4, H: 4, E: 0, LOB: 0 });
    expect(sb).toMatchObject({ final: true, winner: 'second', endReason: 'regulation' });
    expect(inningRuns(game, 'second', 7)).toBe('X');
    expect(gameEndState(game)).toEqual({ final: true, endReason: 'regulation', winner: 'second', skipBottomInning: 7, endAt: { inning: 7, teamKey: 'first' } });
    expect(liveState(game)).toMatchObject({ inning: 7, half: 'top', gameOver: true, winner: 'second' });
    expect(halfInning(game, 'second', 7)).toMatchObject({ skipped: true, nextBatter: null, started: false });
    expect(validateGame(game)).toEqual([]);
  });

  it('shows null for half-innings not played yet', () => {
    const game = buildGame({ first: [0, 1], second: [2] });
    const sb = scoreboard(game);
    expect(sb.first.innings).toEqual([0, 1, null, null, null, null, null]);
    expect(sb.second.innings).toEqual([2, null, null, null, null, null, null]);
    expect(sb).toMatchObject({ final: false, winner: null, endReason: '' });
    expect(inningRuns(game, 'second', 2)).toBe(null);
    expect(liveState(game)).toMatchObject({ inning: 2, half: 'bottom', teamKey: 'second', gameOver: false });
  });

  it('shows 0 for a played scoreless half and the in-progress half', () => {
    const game = makeGame();
    game.atBats.first[1] = cells({ 0: out('GROUNDOUT', 1) });
    expect(inningRuns(game, 'first', 1)).toBe(0);
    expect(liveState(game)).toMatchObject({ inning: 1, half: 'top', gameOver: false });
    expect(liveState(game).halfInning.nextBatter).toEqual({ batterIdx: 1, lap: 0, key: '1' });
  });

  it('adds columns for extra innings and continues when tied', () => {
    const game = buildGame({ first: [0, 0, 0, 0, 0, 0, 1, 0], second: [0, 0, 0, 0, 0, 0, 1] });
    const sb = scoreboard(game);
    expect(sb.maxInning).toBe(8);
    expect(sb.second.innings[7]).toBe(null);
    expect(sb.final).toBe(false);
    expect(liveState(game)).toMatchObject({ inning: 8, half: 'bottom', gameOver: false });
  });

  it('ends after the bottom of the last inning when not tied', () => {
    const game = buildGame({ first: [0, 0, 0, 0, 0, 0, 2], second: [0, 0, 0, 0, 0, 0, 1] });
    expect(gameEndState(game)).toMatchObject({ final: true, endReason: 'regulation', winner: 'first', skipBottomInning: null });
  });

  it('detects a walk-off before three outs', () => {
    const game = buildGame({
      first: [1, 0, 0, 0, 0, 0, 0],
      second: [0, 0, 0, 0, 0, 0],
      custom: { second: { 7: L => ({ [keyAt(L, 0)]: { resultType: 'DOUBLE', basesReached: 4 }, [keyAt(L, 1)]: { resultType: 'HOMERUN', rbi: 2, basesReached: 4 } }) } },
    });
    expect(gameEndState(game)).toMatchObject({ final: true, endReason: 'walkoff', winner: 'second' });
    expect(scoreboard(game).second.innings[6]).toBe(2);
    expect(halfInning(game, 'second', 7)).toMatchObject({ complete: true, nextBatter: null, outs: 0 });
    expect(validateGame(game)).toEqual([]); // margin 1, and a HR anyway
  });

  it('uses the manual end (status final) at the last half played', () => {
    const game = buildGame({ first: [0, 3], second: [1], status: 'final', endReason: 'called' });
    game.atBats.first[2] = cells({ ...scoringSpecs(3, 3) });
    delete game.atBats.first[2][keyAt(3, 5)]; // only 2 outs when the game was called
    const end = gameEndState(game);
    expect(end).toMatchObject({ final: true, endReason: 'called', winner: 'first', skipBottomInning: null, endAt: { inning: 2, teamKey: 'first' } });
    expect(halfInning(game, 'first', 2).complete).toBe(true);
    expect(validateGame(game)).toEqual([]); // no C03 for the half the game ended in
    expect(liveState(game)).toMatchObject({ inning: 2, half: 'top', gameOver: true, endReason: 'called' });
  });

  it("marks the bottom 'X' when a manually ended game stopped after the top with the home team ahead", () => {
    const game = buildGame({ first: [0, 0, 0, 0, 0], second: [10, 0, 0, 0], status: 'final', endReason: 'called' });
    const sb = scoreboard(game);
    expect(sb.second.innings.slice(0, 5)).toEqual([10, 0, 0, 0, 'X']);
    expect(sb.winner).toBe('second');
  });

  it('does not end by rule when only one team is recorded', () => {
    const game = buildGame({ first: [], second: [1, 0, 0, 0, 0, 0, 0] });
    expect(gameEndState(game).final).toBe(false);
    expect(validateGame(game)).toEqual([]);
  });

  it('ends tied at the maximum inning as a draw', () => {
    const zeros = Array(12).fill(0);
    const game = buildGame({ first: zeros, second: zeros });
    expect(gameEndState(game)).toMatchObject({ final: true, winner: null, endAt: { inning: 12, teamKey: 'second' } });
  });
});

// ============================================
// validateGame: every check fires on a minimal bad case
// ============================================

describe('validateGame checks', () => {
  function issuesFor(specs, opts = {}) {
    const { game } = gameWithHalf({ L: 0, cells: specs, ...opts });
    return validateGame(game);
  }
  function find(issues, id) {
    return issues.filter(i => i.id === id);
  }

  it('C01 runs < RBI', () => {
    const issues = issuesFor(INVALID[0].cells);
    expect(find(issues, 'C01')[0]).toMatchObject({ severity: 'error', inning: 1, key: null });
  });

  it('C02 four runners on base (error) and two on one base (warning while in progress, error when finished)', () => {
    let issues = issuesFor({
      0: { resultType: 'SINGLE', basesReached: 3 }, 1: { resultType: 'SINGLE', basesReached: 2 },
      2: { resultType: 'SINGLE', basesReached: 1 }, 3: { resultType: 'WALK', basesReached: 1 },
    });
    expect(find(issues, 'C02').map(i => i.severity)).toEqual(['error', 'warning']);
    expect(find(issues, 'C02')[0].message).toContain('塁上に4人');
    expect(find(issues, 'C02')[1].message).toBe('1回表：3番 A3と4番 A4が両方とも一塁にいます。押し出された走者の塁を進めてください。');
    issues = issuesFor({
      0: { resultType: 'WALK', basesReached: 1 }, 1: { resultType: 'WALK', basesReached: 1 },
      2: out('STRIKEOUT_SWING', 1), 3: out('STRIKEOUT_SWING', 2), 4: out('STRIKEOUT_SWING', 3),
    });
    expect(find(issues, 'C02').map(i => [i.severity, i.key])).toEqual([['error', '1']]);
  });

  it('C03 finished half with fewer than three outs', () => {
    const { game } = exampleGame(INVALID.find(x => x.id === 'X4'));
    expect(find(validateGame(game), 'C03')[0].message).toContain('1回表はアウトが2つしか記録されていません');
    const g2 = makeGame();
    g2.atBats.first[1] = cells({ 0: { resultType: 'SINGLE', basesReached: 1 } });
    g2.atBats.second[1] = cells(fillerSpecs(0));
    expect(find(validateGame(g2), 'C03')[0].message).toContain('1回表はアウトが1つも記録されていません');
  });

  it('C04 more than three outs, duplicate numbers, numbers on non-outs, missing numbers', () => {
    let issues = issuesFor({ 0: out('STRIKEOUT_SWING', 1), 1: out('STRIKEOUT_SWING', 2), 2: out('STRIKEOUT_SWING', 3), 3: out('STRIKEOUT_SWING', 4) });
    expect(find(issues, 'C04').map(i => i.message)).toEqual(['1回表：アウトが4つあります。1イニングのアウトは3つまでです。']);
    issues = issuesFor({ 0: out('GROUNDOUT', 1), 1: out('FLYOUT', 1) });
    expect(find(issues, 'C04')[0]).toMatchObject({ key: '1', message: '1回表：「1アウト目」が2人います。マスを開いてアウトの順番を直してください。' });
    issues = issuesFor({ 0: { resultType: 'SINGLE', basesReached: 1, outNumber: 1 } });
    expect(find(issues, 'C04')[0].key).toBe('0');
    issues = issuesFor({ 0: out('GROUNDOUT', null) });
    expect(find(issues, 'C04')[0].message).toContain('何アウト目かが記録されていません');
    issues = issuesFor({ 0: out('GROUNDOUT', 7) });
    expect(find(issues, 'C04')[0].message).toContain('アウトの番号（7）');
  });

  it('C05 plate appearance after three batter outs', () => {
    const issues = issuesFor(INVALID.find(x => x.id === 'X2').cells);
    expect(find(issues, 'C05')[0]).toMatchObject({ key: '3', severity: 'error' });
  });

  it('C06 wrong leadoff (inning 1)', () => {
    const issues = issuesFor({ 2: out('GROUNDOUT', 1) });
    expect(find(issues, 'C06')[0].message).toBe('1回表の先頭打者は1番 A1のはずです。3番 A3から記録されています。');
    expect(find(issues, 'C07')).toEqual([]);
  });

  it('C07 gap in the batting order', () => {
    const issues = issuesFor({ 0: out('GROUNDOUT', 1), 2: out('FLYOUT', 2) });
    expect(find(issues, 'C07')[0]).toMatchObject({
      key: '2', message: '1回表：1番 A1の次に3番 A3が記録されていて、間の打者の結果が空いています。',
    });
  });

  it('C08 double play without the runner out', () => {
    const issues = issuesFor(INVALID.find(x => x.id === 'X4').cells);
    expect(find(issues, 'C08')[0]).toMatchObject({ key: '1', message: '1回表 2番 A2：併殺打ですが、一緒にアウトになった走者のマスに『走塁死』が付いていません。' });
  });

  it('C09 sacrifice with two outs, without runners, infield fly without two runners', () => {
    let issues = issuesFor(INVALID.find(x => x.id === 'X3').cells);
    expect(find(issues, 'C09')[0].message).toBe('1回表 4番 A4：2アウトからは犠飛になりません。普通のフライアウトです。');
    issues = issuesFor({ 0: out('SACRIFICE_BUNT', 1, { positions: '1-3' }) });
    expect(find(issues, 'C09')[0].message).toContain('ランナーがいないのに犠打');
    issues = issuesFor({ 0: { resultType: 'FIELDERS_CHOICE', basesReached: 1 } });
    expect(find(issues, 'C09')[0].message).toContain('ランナーがいないのに野選');
    issues = issuesFor({ 0: { resultType: 'SINGLE', basesReached: 1 }, 1: out('INFIELD_FLY', 1, { positions: '6' }) });
    expect(find(issues, 'C09')[0].message).toContain('インフィールドフライは0・1アウトで一・二塁か満塁');
  });

  it('C10 sacrifice fly without RBI', () => {
    const issues = issuesFor({ 0: { resultType: 'TRIPLE', basesReached: 3 }, 1: out('SACRIFICE_FLY', 1, { positions: '8' }) });
    expect(ids(issues)).toEqual(['C10']);
  });

  it('C11 RBI on results that cannot drive in runs', () => {
    let issues = issuesFor({ 0: { resultType: 'TRIPLE', basesReached: 4 }, 1: out('STRIKEOUT_SWING', 1, { rbi: 1 }) });
    expect(find(issues, 'C11')[0]).toMatchObject({ severity: 'error', message: '1回表 2番 A2：空振り三振には打点がつきません。' });
    issues = issuesFor({ 0: { resultType: 'TRIPLE', basesReached: 4 }, 1: out('STRIKEOUT_SWING', 1), 2: out('STRIKEOUT_SWING', 2), 3: out('GROUNDOUT', 3, { rbi: 1 }) });
    expect(find(issues, 'C11')[0]).toMatchObject({ severity: 'error', key: '3' });
    expect(find(issues, 'C11')[0].message).toContain('3アウト目');
    issues = issuesFor({ 0: { resultType: 'TRIPLE', basesReached: 4 }, 1: out('FLYOUT', 1, { rbi: 1 }) });
    expect(find(issues, 'C11')[0]).toMatchObject({ severity: 'warning', message: '1回表 2番 A2：フライで点が入ったなら『犠飛』では？' });
    issues = issuesFor({ 0: { resultType: 'TRIPLE', basesReached: 4 }, 1: { resultType: 'ERROR', rbi: 1, basesReached: 1 } });
    expect(find(issues, 'C11')[0].severity).toBe('warning');
    expect(ids(issues)).toEqual(['C11']);
  });

  it('C12 home run without RBI, too many RBI, walk RBI without bases loaded', () => {
    let issues = issuesFor({ 0: { resultType: 'HOMERUN', basesReached: 4 } });
    expect(find(issues, 'C12')[0].message).toContain('ホームランは打者自身も得点し');
    issues = issuesFor({ 0: { resultType: 'WALK', basesReached: 4 }, 1: { resultType: 'SINGLE', rbi: 2, basesReached: 1 } });
    expect(find(issues, 'C12')[0].message).toBe('1回表 2番 A2：打点2は、塁上の走者の数から考えて多すぎます。');
    issues = issuesFor({ 0: { resultType: 'WALK', basesReached: 4 }, 1: { resultType: 'WALK', rbi: 1, basesReached: 1 } });
    expect(find(issues, 'C12')[0].message).toContain('押し出しは満塁のときだけです');
    issues = issuesFor({ 0: { resultType: 'HIT_BY_PITCH', rbi: 2, basesReached: 1 } });
    expect(find(issues, 'C12')[0].message).toContain('死球の打点は最大1点');
  });

  it('C13 batter out with base or runner events', () => {
    const issues = issuesFor({ 0: out('GROUNDOUT', 1, { basesReached: 1, runnerEvents: [T('STOLEN_BASE')] }) });
    expect(find(issues, 'C13')[0].message).toBe('1回表 1番 A1：ゴロでアウトなのに、塁に出た（盗塁などの）記録があります。');
  });

  it('C14 scored and out at once, or two outs for one runner', () => {
    let issues = issuesFor({ 0: { resultType: 'SINGLE', basesReached: 4, runnerEvents: [T('CAUGHT_STEALING')], outNumber: 1 } });
    expect(find(issues, 'C14')[0].message).toContain('『得点』と『アウト』の両方');
    issues = issuesFor({ 0: { resultType: 'SINGLE', basesReached: 2, runnerEvents: [T('CAUGHT_STEALING'), T('RUNNER_OUT')], outNumber: 1 } });
    expect(find(issues, 'C14')[0].message).toContain('アウトの記録が2つ');
  });

  it('C15 base below what the result implies', () => {
    const issues = issuesFor({ 0: { resultType: 'WALK', basesReached: 1, runnerEvents: [T('STOLEN_BASE')] } });
    expect(find(issues, 'C15')[0]).toMatchObject({ severity: 'warning', message: '1回表 1番 A1：四球（と盗塁など）で二塁まで進んだはずですが、一塁のままです。' });
  });

  it('C16 records after the game ended', () => {
    const game = buildGame({
      first: [0, 1, 0, 2, 0, 0, 0], second: [1, 0, 2, 0, 1, 0],
      custom: { second: { 7: L => ({ [keyAt(L, 0)]: out('GROUNDOUT', 1) }) } },
    });
    const issues = validateGame(game);
    expect(ids(issues)).toEqual(['C16']);
    expect(issues[0]).toMatchObject({
      teamKey: 'second', inning: 7, severity: 'error',
      message: '7回裏：7回表を終えて後攻チームがリードしているので、7回裏の攻撃はありません（スコアボードは X）。',
    });
    expect(scoreboard(game).second.innings[6]).toBe('X');
    expect(scoreboard(game).second.R).toBe(4);

    const walkoff = buildGame({
      first: [1, 0, 0, 0, 0, 0, 0, 0], second: [0, 0, 0, 0, 0, 0],
      custom: { second: { 7: L => ({ [keyAt(L, 0)]: { resultType: 'HOMERUN', rbi: 1, basesReached: 4 }, [keyAt(L, 1)]: { resultType: 'HOMERUN', rbi: 1, basesReached: 4 } }) } },
    });
    const w = validateGame(walkoff);
    expect(ids(w)).toEqual(['C16']);
    expect(w[0]).toMatchObject({ teamKey: 'first', inning: 8, message: '8回表：試合はすでに7回裏（サヨナラ）で終わっているので、この回の記録は不要です。' });
  });

  it('C17 walk-off with a margin of two or more without a home run (G2)', () => {
    const game = buildGame({
      first: [0, 0, 0, 3, 0, 0, 0], second: [0, 0, 0, 3, 0, 0],
      custom: { second: { 7: L => ({
        [keyAt(L, 0)]: { resultType: 'SINGLE', basesReached: 4 },
        [keyAt(L, 1)]: { resultType: 'SINGLE', basesReached: 4 },
        [keyAt(L, 2)]: { resultType: 'SINGLE', basesReached: 4 },
        [keyAt(L, 3)]: { resultType: 'DOUBLE', rbi: 3, basesReached: 2 },
      }) } },
    });
    const issues = validateGame(game);
    expect(ids(issues)).toEqual(['C17']);
    expect(issues[0]).toMatchObject({ severity: 'warning', teamKey: 'second', inning: 7 });
    expect(gameEndState(game)).toMatchObject({ endReason: 'walkoff', winner: 'second' });
  });

  it('C18 missing result (warning) and runner out without a reason (info)', () => {
    let issues = issuesFor({ 0: { resultType: null, runnerEvents: [T('STOLEN_BASE')] } });
    expect(find(issues, 'C18')[0]).toMatchObject({ severity: 'warning', message: '1回表 1番 A1：打席結果が選ばれていません。' });
    issues = issuesFor({ 0: { resultType: 'WALK', basesReached: 0, outNumber: 1 } });
    expect(find(issues, 'C18')[0].severity).toBe('info');
  });

  it('C19 wrong tiebreak runners, and placed runners outside a tiebreak inning', () => {
    const { game, inning } = gameWithHalf({
      L: 4, tiebreakerRunners: '1B2B', cells: {
        tb3: { resultType: 'TIEBREAK_RUNNER', basesReached: 2, batterIdx: 3 },
        4: out('STRIKEOUT_SWING', 1), 5: out('STRIKEOUT_SWING', 2), 6: out('STRIKEOUT_SWING', 3),
      },
    });
    game.tiebreakerInning = inning;
    let issues = validateGame(game);
    expect(ids(issues)).toEqual(['C19']);
    expect(issues[0].message).toBe('2回表：タイブレークの最初のランナーは4番 A4（一塁）と3番 A3（二塁）のはずです。');
    game.tiebreakerInning = 0;
    issues = validateGame(game);
    expect(issues[0].message).toBe('2回表はタイブレークの回ではないのに、置きランナーが入っています。');
  });

  it('returns issues sorted by half-inning and check id', () => {
    const game = makeGame();
    game.atBats.second[1] = cells({ 0: { resultType: 'HOMERUN', basesReached: 4 } });
    game.atBats.first[1] = cells({ 1: out('GROUNDOUT', 1) });
    game.atBats.first[2] = cells({ 0: { resultType: 'SINGLE', rbi: 1, basesReached: 1 } });
    const issues = validateGame(game);
    expect(issues.map(i => `${i.inning}${i.teamKey[0]}:${i.id}`)).toEqual(['1f:C03', '1f:C06', '1s:C03', '1s:C12', '2f:C01', '2f:C06', '2f:C12']);
  });
});

// ============================================
// normalizeGame
// ============================================

describe('normalizeGame', () => {
  it('migrates a legacy game: removes outsInInning, fills v2 fields, renumbers duplicate outs', () => {
    const legacy = {
      id: 'old', date: '2025-05-01', teamFirst: 'A', teamSecond: 'B', innings: 9, useDH: false,
      tiebreakerInning: 0, tiebreakerRunners: 'none', gameResult: '',
      lineupFirst: [{ name: 'x' }], lineupSecond: [{ name: 'y' }],
      atBats: {
        first: {
          1: {
            0: { resultType: 'GROUNDOUT', positions: '6-3', rbi: 0, basesReached: 0, outNumber: 3, note: '', runnerEvents: [] },
            1: { resultType: 'FLYOUT', positions: '8', rbi: 0, basesReached: 0, outNumber: 1, note: '', runnerEvents: [] },
            2: { resultType: 'STRIKEOUT_SWING', positions: '', rbi: 0, basesReached: 0, outNumber: 1, note: '', runnerEvents: [] },
            3: { resultType: 'SINGLE', positions: '7', rbi: 0, basesReached: 1, outNumber: 2, note: '', runnerEvents: [{ type: 'STOLEN_BASE', description: '' }] },
          },
          2: {},
        },
        second: { 1: { 0: null } },
      },
      currentInning: 2, currentHalf: 'top', outsInInning: 2, substitutions: [],
    };
    const game = normalizeGame(legacy);
    expect(game).toBe(legacy);
    expect('outsInInning' in game).toBe(false);
    expect(game).toMatchObject({ version: 2, status: 'in_progress', endReason: '', innings: 9, lineupDone: true });
    const h = game.atBats.first[1];
    expect([h[0].outNumber, h[1].outNumber, h[2].outNumber, h[3].outNumber]).toEqual([1, 2, 3, null]);
    expect(h[3].runnerEvents).toEqual([{ type: 'STOLEN_BASE' }]);
    expect(game.atBats.first[2]).toBeUndefined();
    expect(game.atBats.second).toEqual({});
    expect(validateGame(game).filter(i => i.id === 'C04')).toEqual([]);
  });

  it('fills defaults on an almost empty object and keeps v2 out order', () => {
    const game = normalizeGame({ version: 2, atBats: { first: { 1: { 0: { resultType: 'WALK', basesReached: 1, runnerEvents: [T('PICKOFF')], outNumber: 2 }, 1: { resultType: 'GROUNDOUT', outNumber: 1 } } } } });
    expect(game).toMatchObject({ innings: 7, status: 'in_progress', tiebreakerRunners: 'none', lineupDone: false, currentHalf: 'top', currentInning: 1 });
    expect(game.atBats.second).toEqual({});
    expect(game.atBats.first[1][1].outNumber).toBe(1);
    expect(game.atBats.first[1][0].outNumber).toBe(2);
    expect(game.atBats.first[1][1]).toMatchObject({ positions: '', rbi: 0, basesReached: 0, runnerEvents: [], note: '' });
  });

  it('is idempotent and tolerates junk', () => {
    expect(normalizeGame(null)).toBe(null);
    const game = normalizeGame({ atBats: 'junk', status: 'weird', endReason: 'x', innings: '5' });
    expect(game).toMatchObject({ atBats: { first: {}, second: {} }, status: 'in_progress', endReason: '', innings: 5 });
    const copy = JSON.parse(JSON.stringify(game));
    expect(normalizeGame(game)).toEqual(copy);
  });
});

// ============================================
// Robustness
// ============================================

describe('robustness', () => {
  it('works on an empty game', () => {
    const game = makeGame();
    expect(halfInning(game, 'first', 1)).toMatchObject({ outs: 0, started: false, complete: false, leadoff: 0, nextBatter: { batterIdx: 0, lap: 0, key: '0' } });
    expect(liveState(game)).toMatchObject({ inning: 1, half: 'top', gameOver: false });
    expect(validateGame(game)).toEqual([]);
    expect(scoreboard(game).first.innings).toEqual([null, null, null, null, null, null, null]);
  });

  it('works on a plain object without lineups or atBats', () => {
    const game = {};
    expect(lineupSize(game, 'first')).toBe(9);
    expect(halfInning(game, 'second', 3).leadoff).toBe(0);
    expect(validateGame(game)).toEqual([]);
    recordPlateAppearance(game, { teamKey: 'first', inning: 1, key: 0 }, { resultType: 'SINGLE' });
    expect(game.atBats.first[1][0].basesReached).toBe(1);
  });

  it('ignores non-numeric keys and null cells', () => {
    const game = makeGame();
    game.atBats.first[1] = { foo: cell({ resultType: 'SINGLE', basesReached: 1 }), 0: null, 1: cell(out('GROUNDOUT', 1)) };
    expect(halfInning(game, 'first', 1).outs).toBe(1);
  });
});
