import { describe, it, expect, beforeEach } from 'vitest';
import {
  GameData, AtBatResult, POSITIONS, POSITION_SHORT, BAT_LABELS, RESULT_TYPES, RUNNER_EVENTS,
  saveGame, loadGame, clearGame,
} from '../src/data.js';
import * as rules from '../src/rules.js';
import { cells, fillerSpecs, lineup } from './helpers.js';

function memoryStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
}

describe('data.js re-exports', () => {
  it('re-exports the rule constants from rules.js', () => {
    expect(POSITIONS).toBe(rules.POSITIONS);
    expect(POSITION_SHORT).toBe(rules.POSITION_SHORT);
    expect(BAT_LABELS).toBe(rules.BAT_LABELS);
    expect(RESULT_TYPES).toBe(rules.RESULT_TYPES);
    expect(RUNNER_EVENTS).toBe(rules.RUNNER_EVENTS);
  });
});

describe('GameData', () => {
  it('has the v2 defaults', () => {
    const game = new GameData();
    expect(typeof game.id).toBe('string');
    expect(game.id.length).toBeGreaterThan(5);
    expect(new GameData().id).not.toBe(game.id);
    expect(game).toMatchObject({
      innings: 7, status: 'in_progress', endReason: '', lineupDone: false, version: 2,
      tiebreakerInning: 0, tiebreakerRunners: 'none', currentInning: 1, currentHalf: 'top',
      atBats: { first: {}, second: {} },
    });
    expect('outsInInning' in game).toBe(false);
  });

  it('gets and sets cells with string or number keys', () => {
    const game = new GameData();
    game.setAtBat('first', 1, 3, new AtBatResult({ resultType: 'SINGLE', basesReached: 1 }));
    expect(game.getAtBat('first', 1, '3').resultType).toBe('SINGLE');
    expect(game.getAtBat('first', 1, 3).basesReached).toBe(1);
    game.setAtBat('first', 1, 'tb2', { resultType: 'TIEBREAK_RUNNER', basesReached: 2, batterIdx: 2 });
    expect(game.getAtBat('first', 1, 'tb2').batterIdx).toBe(2);
    expect(game.getAtBat('first', 2, 0)).toBe(null);
    expect(game.getAtBat('second', 1, 0)).toBe(null);
    game.setAtBat('first', 1, 3, null);
    expect(game.getAtBat('first', 1, 3)).toBe(null);
  });

  it('AtBatResult keeps explicit zeros and copies runner events', () => {
    const events = [{ type: 'STOLEN_BASE' }];
    const r = new AtBatResult({ resultType: 'WALK', basesReached: 0, rbi: 0, outNumber: 2, runnerEvents: events });
    expect(r).toMatchObject({ resultType: 'WALK', basesReached: 0, rbi: 0, outNumber: 2, positions: '', note: '' });
    expect(r.runnerEvents).toEqual(events);
    expect(r.runnerEvents[0]).not.toBe(events[0]);
  });

  it('aggregates delegate to the scoring engine (runs = players who scored)', () => {
    const game = new GameData();
    game.lineupFirst = lineup('A');
    game.lineupSecond = lineup('B');
    // E3: 9番四球、1番2ラン本塁打 — 2 runs (not 4)
    game.atBats.first[1] = cells(fillerSpecs(0, 2)); // next leadoff 5
    game.atBats.first[2] = cells(fillerSpecs(5, 0)); // next leadoff 8
    game.atBats.first[3] = cells({
      8: { resultType: 'WALK', basesReached: 4 },
      0: { resultType: 'HOMERUN', rbi: 2, basesReached: 4 },
      1: { resultType: 'GROUNDOUT', positions: '4-3', outNumber: 1 },
      2: { resultType: 'STRIKEOUT_SWING', outNumber: 2 },
      3: { resultType: 'LINEOUT', positions: '6', outNumber: 3 },
    });
    game.atBats.second[1] = cells({
      0: { resultType: 'ERROR', positions: '6', basesReached: 1 },
      1: { resultType: 'INTERFERENCE', basesReached: 2 },
    });
    expect(game.getInningRuns('first', 3)).toBe(2);
    expect(game.getInningRuns('first', 1)).toBe(0);
    expect(game.getInningRuns('first', 5)).toBe(0);
    expect(game.getTotalRuns('first')).toBe(2);
    expect(game.getHitCount('first')).toBe(1);
    expect(game.getErrorCount('first')).toBe(2); // committed by 先攻 while fielding
    expect(game.getErrorCount('second')).toBe(0);
  });

  it('keeps the old helper methods', () => {
    const game = new GameData();
    game.teamFirst = 'A';
    game.teamSecond = 'B';
    game.lineupFirst = lineup('A');
    expect(game.getTeamName('first')).toBe('A');
    expect(game.getTeamName('second')).toBe('B');
    expect(game.getLineup('first')).toBe(game.lineupFirst);
    expect(game.getBattingTeam()).toBe('first');
    game.addSubstitution({ type: 'PH', teamKey: 'first', inning: 2, batterIdx: 3, newPlayer: { name: '代打', number: '20' }, oldPlayer: { name: 'A4' } });
    expect(game.lineupFirst[3]).toMatchObject({ name: '代打', number: '20', position: '4' });
    expect(game.getSubstitutionsForSlot('first', 3)).toHaveLength(1);
  });
});

describe('loadGame', () => {
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });

  it('returns a normalized GameData for a legacy save', () => {
    localStorage.setItem('waseda-score-current-game', JSON.stringify({
      id: 'legacy', teamFirst: 'A', teamSecond: 'B', innings: 9,
      lineupFirst: lineup('A'), lineupSecond: lineup('B'),
      atBats: { first: { 1: {
        0: { resultType: 'GROUNDOUT', positions: '6-3', rbi: 0, basesReached: 0, outNumber: 3, note: '', runnerEvents: [] },
        1: { resultType: 'HOMERUN', positions: '', rbi: 1, basesReached: 4, outNumber: null, note: '', runnerEvents: [] },
        2: { resultType: 'FLYOUT', positions: '8', rbi: 0, basesReached: 0, outNumber: 1, note: '', runnerEvents: [] },
      } }, second: {} },
      currentInning: 1, currentHalf: 'top', outsInInning: 1, substitutions: [],
    }));
    const game = loadGame();
    expect(game).toBeInstanceOf(GameData);
    expect('outsInInning' in game).toBe(false);
    expect(game).toMatchObject({ id: 'legacy', innings: 9, version: 2, status: 'in_progress', lineupDone: true });
    // v1 numbers came from a buggy global counter: renumbered in batting order.
    expect(game.getAtBat('first', 1, 0).outNumber).toBe(1);
    expect(game.getAtBat('first', 1, 2).outNumber).toBe(2);
    expect(game.getTotalRuns('first')).toBe(1);
  });

  it('round-trips through saveGame and returns null when nothing or junk is stored', () => {
    expect(loadGame()).toBe(null);
    const game = new GameData();
    game.teamFirst = 'A';
    saveGame(game);
    expect(loadGame()).toMatchObject({ id: game.id, teamFirst: 'A', version: 2 });
    clearGame();
    expect(loadGame()).toBe(null);
    localStorage.setItem('waseda-score-current-game', '{oops');
    expect(loadGame()).toBe(null);
    localStorage.setItem('waseda-score-current-game', 'null');
    expect(loadGame()).toBe(null);
  });
});
