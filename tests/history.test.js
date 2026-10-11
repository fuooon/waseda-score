import { describe, it, expect, beforeEach } from 'vitest';
import {
  archiveGame, listHistory, loadHistoryGame, deleteHistoryGame, gameHasRecords, gameHasData,
  isWorthArchiving, matchLabel, buildBackup, parseBackup, applyBackup, MAX_HISTORY, BACKUP_APP,
} from '../src/history.js';
import {
  GameData, Team, TeamMember, saveGame, loadGame, saveTeams, loadTeams, clearGame, STORAGE_KEYS,
} from '../src/data.js';
import { lineup, cells } from './helpers.js';

function memoryStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    get size() { return store.size; },
  };
}

function playedGame({ id, date = '2026-10-11', first = 'ファイターズ', second = 'ジャイアンツ' } = {}) {
  const game = new GameData();
  if (id) game.id = id;
  game.date = date;
  game.teamFirst = first;
  game.teamSecond = second;
  game.lineupFirst = lineup('A');
  game.lineupSecond = lineup('B');
  game.lineupDone = true;
  // 1回表: 1番ヒット → 2番二塁打で生還、3人アウト
  game.atBats.first[1] = cells({
    0: { resultType: 'SINGLE', positions: '7', basesReached: 4 },
    1: { resultType: 'DOUBLE', positions: '8', rbi: 1, basesReached: 2 },
    2: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 1 },
    3: { resultType: 'STRIKEOUT_SWING', outNumber: 2 },
    4: { resultType: 'FLYOUT', positions: '9', outNumber: 3 },
  });
  return game;
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage();
});

describe('what a game contains', () => {
  it('tells records, lineups and typed info apart', () => {
    const empty = new GameData();
    expect(gameHasRecords(empty)).toBe(false);
    expect(isWorthArchiving(empty)).toBe(false);
    expect(gameHasData(empty)).toBe(false);

    const named = new GameData();
    named.teamFirst = 'A';
    expect(gameHasData(named)).toBe(true);
    expect(isWorthArchiving(named)).toBe(false);

    const withLineup = new GameData();
    withLineup.lineupFirst = [{ name: '田中' }];
    expect(isWorthArchiving(withLineup)).toBe(true);
    expect(gameHasRecords(withLineup)).toBe(false);

    expect(gameHasRecords(playedGame())).toBe(true);
    expect(gameHasRecords({ atBats: { first: { 1: {} }, second: {} } })).toBe(false);
    expect(gameHasRecords(null)).toBe(false);
  });

  it('labels missing team names as 先攻 / 後攻', () => {
    expect(matchLabel({ teamFirst: '', teamSecond: ' ' })).toBe('先攻 対 後攻');
    expect(matchLabel({ teamFirst: 'A', teamSecond: 'B' })).toBe('A 対 B');
  });
});

describe('history', () => {
  it('archives a game and lists it with scores from the scoring engine', () => {
    const game = playedGame({ id: 'g1' });
    const result = archiveGame(game, { now: 1000 });
    expect(result).toMatchObject({ ok: true, skipped: false, dropped: [] });
    const list = listHistory();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'g1', date: '2026-10-11', teamFirst: 'ファイターズ', teamSecond: 'ジャイアンツ',
      scoreFirst: 1, scoreSecond: 0, savedAt: 1000, status: 'in_progress', hasRecords: true,
    });
  });

  it('does not archive an empty game', () => {
    expect(archiveGame(new GameData())).toMatchObject({ ok: true, skipped: true });
    expect(listHistory()).toEqual([]);
  });

  it('lists newest first and replaces an older copy of the same game', () => {
    archiveGame(playedGame({ id: 'a', date: '2026-10-01' }), { now: 1 });
    archiveGame(playedGame({ id: 'b', date: '2026-10-02' }), { now: 2 });
    const again = playedGame({ id: 'a', date: '2026-10-01' });
    again.teamFirst = '改名';
    archiveGame(again, { now: 3 });
    const list = listHistory();
    expect(list.map(h => h.id)).toEqual(['a', 'b']);
    expect(list[0].teamFirst).toBe('改名');
  });

  it(`keeps at most ${MAX_HISTORY} games and reports the dropped one`, () => {
    for (let i = 0; i < MAX_HISTORY; i++) archiveGame(playedGame({ id: `g${i}` }), { now: 100 + i });
    const result = archiveGame(playedGame({ id: 'new' }), { now: 1000 });
    expect(result.dropped.map(d => d.id)).toEqual(['g0']);
    const list = listHistory();
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].id).toBe('new');
    expect(list.some(h => h.id === 'g0')).toBe(false);
  });

  it('loads an archived game as a normalized GameData copy', () => {
    archiveGame(playedGame({ id: 'g1' }), { now: 1 });
    const game = loadHistoryGame('g1');
    expect(game).toBeInstanceOf(GameData);
    expect(game.getTotalRuns('first')).toBe(1);
    expect(game.lineupDone).toBe(true);
    // a copy: changing it does not change the stored history
    game.teamFirst = 'X';
    expect(loadHistoryGame('g1').teamFirst).toBe('ファイターズ');
    expect(loadHistoryGame('missing')).toBe(null);
  });

  it('deletes one game', () => {
    archiveGame(playedGame({ id: 'a' }), { now: 1 });
    archiveGame(playedGame({ id: 'b' }), { now: 2 });
    expect(deleteHistoryGame('a')).toBe(true);
    expect(deleteHistoryGame('a')).toBe(false);
    expect(listHistory().map(h => h.id)).toEqual(['b']);
  });

  it('skips junk entries in storage', () => {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify([null, 5, { id: 'x' }, { id: 'y', game: 'no' },
      { id: 'ok', savedAt: 1, game: playedGame({ id: 'ok' }) }]));
    expect(listHistory().map(h => h.id)).toEqual(['ok']);
    localStorage.setItem(STORAGE_KEYS.HISTORY, '{broken');
    expect(listHistory()).toEqual([]);
  });

  it('reports a failed write instead of throwing', () => {
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    const result = archiveGame(playedGame({ id: 'g1' }));
    expect(result.ok).toBe(false);
    expect(saveGame(playedGame())).toBe(false);
  });
});

describe('backup', () => {
  function seedDevice() {
    const team = new Team({ name: 'ファイターズ', members: [new TeamMember({ name: '田中', number: '1' })] });
    saveTeams([team]);
    saveGame(playedGame({ id: 'current' }));
    archiveGame(playedGame({ id: 'old', date: '2026-09-01' }), { now: 5 });
    return team;
  }

  it('round-trips teams, the current game and the history', () => {
    const team = seedDevice();
    const backup = buildBackup({ now: new Date('2026-10-11T10:00:00Z') });
    expect(backup).toMatchObject({ app: BACKUP_APP, exportedAt: '2026-10-11T10:00:00.000Z' });

    globalThis.localStorage = memoryStorage(); // a new phone
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toMatchObject({ teams: 1, members: 1, history: 1, currentGame: 'ファイターズ 対 ジャイアンツ', skipped: 0 });

    const result = applyBackup(parsed.data);
    expect(result).toMatchObject({ ok: true, teams: 1, history: 1, currentGame: true });
    expect(loadTeams()).toHaveLength(1);
    expect(loadTeams()[0]).toMatchObject({ id: team.id, name: 'ファイターズ' });
    expect(loadGame().id).toBe('current');
    expect(loadGame().getTotalRuns('first')).toBe(1);
    expect(listHistory().map(h => h.id)).toEqual(['old']);
  });

  it('keeps device-only data and moves the device game to the history', () => {
    seedDevice();
    const backup = buildBackup();

    globalThis.localStorage = memoryStorage();
    saveTeams([new Team({ name: 'マイチーム' }), new Team({ name: '相手チーム', members: [{ name: '佐藤' }] })]);
    saveGame(playedGame({ id: 'device-game', first: '端末' }));

    applyBackup(parseBackup(JSON.stringify(backup)).data, { now: 99 });
    // the untouched default team is dropped, the device's own team stays
    expect(loadTeams().map(t => t.name)).toEqual(['ファイターズ', '相手チーム']);
    expect(loadGame().id).toBe('current');
    expect(listHistory().map(h => h.id)).toEqual(['device-game', 'old']);
  });

  it('renames a device team that has the same name as a backup team', () => {
    seedDevice();
    const backup = buildBackup();
    globalThis.localStorage = memoryStorage();
    saveTeams([new Team({ name: 'ファイターズ', members: [{ name: '別の選手' }] })]);
    applyBackup(parseBackup(JSON.stringify(backup)).data);
    expect(loadTeams().map(t => t.name)).toEqual(['ファイターズ', 'ファイターズ（この端末）']);
  });

  it('rejects files that are not backups, with a plain message', () => {
    expect(parseBackup('{oops')).toMatchObject({ ok: false });
    expect(parseBackup('{oops').error).toMatch(/読み込めません/);
    expect(parseBackup(JSON.stringify({ hello: 1 })).error).toMatch(/バックアップではない/);
    expect(parseBackup(JSON.stringify({ app: BACKUP_APP, backupVersion: 99 })).error).toMatch(/新しいバージョン/);
    expect(parseBackup(JSON.stringify({ app: BACKUP_APP, teams: [], history: [] })).error).toMatch(/読み込めるデータ/);
  });

  it('skips broken entries but reads the rest', () => {
    const parsed = parseBackup(JSON.stringify({
      app: BACKUP_APP,
      teams: [null, { name: 'A', members: [null, { name: 'x' }] }],
      currentGame: 'nope',
      history: [{ id: 'bad', game: 5 }, { savedAt: 7, game: playedGame({ id: 'good' }) }, { game: playedGame({ id: 'good' }) }],
    }));
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toMatchObject({ teams: 1, members: 1, history: 1, currentGame: '', skipped: 4 });
    expect(parsed.data.history[0]).toMatchObject({ id: 'good', savedAt: 7 });
  });

  it('does not touch the current game when the backup has none', () => {
    saveGame(playedGame({ id: 'mine' }));
    const backup = { app: BACKUP_APP, teams: [{ name: 'T' }], currentGame: null, history: [] };
    applyBackup(parseBackup(JSON.stringify(backup)).data);
    expect(loadGame().id).toBe('mine');
    expect(listHistory()).toEqual([]);
    clearGame();
  });
});
