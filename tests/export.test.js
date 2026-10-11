import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename, exportFilename, formatGameDate, formatTimeRange, resultSummary,
  buildHeaderHTML, buildBoardHTML, buildBoardNoteHTML, canvasScale, teamName,
} from '../src/export.js';
import { GameData } from '../src/data.js';
import { scoreboard, validateGame } from '../src/scoring.js';
import { simulateGame } from './sim.js';
import { makeGame, cells, scoringSpecs, fillerSpecs } from './helpers.js';

// A finished 7-inning game (seed 22): 4 - 5, the home team leads after the top
// of the 7th, so the bottom of the 7th is 'X'.
function finishedGame(overrides = {}) {
  const { game } = simulateGame(22, { innings: 7 });
  const data = Object.assign(new GameData(), game, {
    teamFirst: '青葉ファイターズ', teamSecond: '緑町スターズ', field: '市民球場',
    startTime: '09:00', endTime: '10:45', pitcherFirst: '山田', pitcherSecond: '鈴木',
    ...overrides,
  });
  return data;
}

// Rows of the board as arrays of cell texts (header row first).
function boardRows(html) {
  return [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(m =>
    [...m[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map(c => c[1].replace(/<[^>]+>/g, '')));
}

describe('sanitizeFilename', () => {
  it('replaces characters that Windows / macOS / Android do not allow', () => {
    expect(sanitizeFilename('A:B?')).toBe('A_B');
    expect(sanitizeFilename('a/b\\c*d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
    expect(sanitizeFilename('タイガース　Jr. 2')).toBe('タイガース_Jr._2');
    expect(sanitizeFilename('tab\tnew\nline')).toBe('tab_new_line');
  });

  it('drops leading / trailing dots and underscores and invisible direction marks', () => {
    expect(sanitizeFilename('..hidden..')).toBe('hidden');
    expect(sanitizeFilename('  name  ')).toBe('name');
    expect(sanitizeFilename('gnp.‮exe')).toBe('gnp._exe');
  });

  it('falls back when nothing is left', () => {
    expect(sanitizeFilename('', '先攻')).toBe('先攻');
    expect(sanitizeFilename(null, '後攻')).toBe('後攻');
    expect(sanitizeFilename(' :?* ', 'x')).toBe('x');
  });

  it('limits the length without splitting characters', () => {
    const long = '😀'.repeat(50);
    const out = sanitizeFilename(long, '', 30);
    expect(Array.from(out)).toHaveLength(30);
    expect(out).toBe('😀'.repeat(30));
  });
});

describe('exportFilename', () => {
  it('uses date and both team names', () => {
    expect(exportFilename({ date: '2026-10-11', teamFirst: 'A', teamSecond: 'B' })).toBe('score_2026-10-11_A_vs_B.png');
  });

  it('uses 先攻 / 後攻 for empty names and sanitizes', () => {
    expect(exportFilename({ date: '2026-10-11', teamFirst: '', teamSecond: '  ' })).toBe('score_2026-10-11_先攻_vs_後攻.png');
    expect(exportFilename({ date: '2026-10-11', teamFirst: 'A:B?', teamSecond: 'C*' })).toBe('score_2026-10-11_A_B_vs_C.png');
  });

  it('marks the board image and skips an invalid date', () => {
    expect(exportFilename({ date: '2026-10-11', teamFirst: 'A', teamSecond: 'B' }, 'board')).toBe('score_2026-10-11_A_vs_B_board.png');
    expect(exportFilename({ date: '', teamFirst: 'A', teamSecond: 'B' })).toBe('score_A_vs_B.png');
    expect(exportFilename({ date: '../etc', teamFirst: 'A', teamSecond: 'B' })).toBe('score_A_vs_B.png');
  });
});

describe('dates and times', () => {
  it('formats the date as a local date with the weekday', () => {
    expect(formatGameDate('2026-10-11')).toBe('2026/10/11（日）');
    expect(formatGameDate('')).toBe('');
    expect(formatGameDate('2026-13-45x')).toBe('');
  });

  it('formats start / end time and the game length', () => {
    expect(formatTimeRange('09:00', '10:45')).toBe('9:00〜10:45（1時間45分）');
    expect(formatTimeRange('08:58', '10:58')).toBe('8:58〜10:58（2時間）');
    expect(formatTimeRange('13:10', '13:55')).toBe('13:10〜13:55（45分）');
    expect(formatTimeRange('10:00', '09:00')).toBe('10:00〜9:00');
    expect(formatTimeRange('09:30', '')).toBe('9:30 開始');
    expect(formatTimeRange('', '11:00')).toBe('11:00 終了');
    expect(formatTimeRange('', '')).toBe('');
    expect(formatTimeRange('25:00', 'abc')).toBe('');
  });
});

describe('buildBoardHTML', () => {
  it('shows every inning, X for the unneeded bottom half and R H E LOB from scoring.scoreboard', () => {
    const game = finishedGame();
    expect(validateGame(game)).toEqual([]);
    const sb = scoreboard(game);
    const rows = boardRows(buildBoardHTML(game, sb));
    expect(rows[0]).toEqual(['チーム', '1', '2', '3', '4', '5', '6', '7', '計', '安打', '失策', '残塁']);
    expect(rows[1][0]).toBe('先攻青葉ファイターズ');
    expect(rows[2][0]).toBe('後攻緑町スターズ勝');
    expect(rows[1].slice(1, 8)).toEqual(sb.first.innings.map(String));
    expect(rows[2].slice(1, 8)).toEqual(['0', '0', '1', '1', '0', '3', 'X']);
    expect(rows[1].slice(8)).toEqual([sb.first.R, sb.first.H, sb.first.E, sb.first.LOB].map(String));
    expect(rows[2].slice(8)).toEqual([sb.second.R, sb.second.H, sb.second.E, sb.second.LOB].map(String));
    expect(sb.first.R).toBe(4);
    expect(sb.second.R).toBe(5);
  });

  it('leaves half-innings that were not played blank (not 0)', () => {
    const game = makeGame({ atBats: { first: { 1: cells(scoringSpecs(0, 1)) }, second: {} } });
    const rows = boardRows(buildBoardHTML(game));
    expect(rows[1].slice(1, 8)).toEqual(['1', '', '', '', '', '', '']);
    expect(rows[2].slice(1, 8)).toEqual(['', '', '', '', '', '', '']);
    expect(buildBoardHTML(game)).toContain('eb-empty');
    expect(buildBoardHTML(game)).not.toContain('eb-winner');
  });

  it('shows 0 for a played scoreless half-inning', () => {
    const game = makeGame({ atBats: { first: { 1: cells(fillerSpecs(0)) }, second: {} } });
    expect(boardRows(buildBoardHTML(game))[1][1]).toBe('0');
  });

  it('escapes team names', () => {
    const game = makeGame({ teamFirst: '<img src=x onerror="alert(1)">', teamSecond: 'A&B' });
    const html = buildBoardHTML(game);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('A&amp;B');
  });

  it('uses 先攻 / 後攻 for empty team names', () => {
    expect(teamName({ teamFirst: '  ' }, 'first')).toBe('先攻');
    expect(teamName({}, 'second')).toBe('後攻');
    const rows = boardRows(buildBoardHTML(makeGame({ teamFirst: '', teamSecond: '' })));
    expect(rows[1][0]).toBe('先攻先攻');
    expect(rows[2][0]).toBe('後攻後攻');
  });

  it('explains X and blanks in plain words only when they appear', () => {
    const finished = scoreboard(finishedGame());
    expect(buildBoardNoteHTML(finished)).toContain('X＝後攻がリード');
    expect(buildBoardNoteHTML(finished)).not.toContain('空欄');
    const early = scoreboard(makeGame({ atBats: { first: { 1: cells(fillerSpecs(0)) }, second: {} } }));
    expect(buildBoardNoteHTML(early)).toContain('空欄＝まだ攻撃していない回');
    expect(buildBoardNoteHTML(early)).not.toContain('X＝');
  });
});

describe('buildHeaderHTML / resultSummary', () => {
  it('has title, date, field, time, matchup, pitchers and the winner', () => {
    const game = finishedGame();
    const html = buildHeaderHTML(game);
    expect(html).toContain('試合結果');
    expect(html).toContain('試合終了');
    expect(html).toContain('2026/10/11（日）');
    expect(html).toContain('市民球場');
    expect(html).toContain('9:00〜10:45（1時間45分）');
    expect(html).toMatch(/先攻<\/span><span class="export-team">青葉ファイターズ<\/span><span class="export-vs">vs<\/span><span class="export-side">後攻<\/span><span class="export-team">緑町スターズ/);
    expect(html).toContain('緑町スターズの勝ち（5 - 4）');
    expect(html).toContain('先発投手');
    expect(html).toContain('青葉ファイターズ：山田');
    expect(html).toContain('緑町スターズ：鈴木');
    expect(html).toContain('<span class="export-sep">・</span><span class="export-meta-item">7回制</span>');
  });

  it('escapes every user string (field, names, pitchers)', () => {
    const evil = '<img src=x onerror="window.__x=1">';
    const game = finishedGame({ field: evil, teamFirst: evil, pitcherSecond: evil });
    const html = buildHeaderHTML(game);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__x=1&quot;&gt;');
  });

  it('omits missing pieces and shows the progress of an unfinished game', () => {
    const game = makeGame({
      date: '', field: '', teamFirst: 'A', teamSecond: 'B',
      atBats: { first: { 1: cells(scoringSpecs(0, 2)) }, second: {} },
    });
    const html = buildHeaderHTML(game);
    expect(html).toContain('<p class="export-meta"><span class="export-meta-item">7回制</span></p>');
    expect(html).not.toContain('先発投手');
    expect(html).not.toContain('タイブレーク');
    expect(html).toContain('途中経過');
    expect(resultSummary(game).text).toBe('A 2 - 0 B（1回表まで）');
  });

  it('describes a half-inning in progress and a game not started', () => {
    const inProgress = makeGame({
      teamFirst: 'A', teamSecond: 'B',
      atBats: { first: { 1: cells({ 0: { resultType: 'STRIKEOUT_SWING', outNumber: 1 } }) }, second: {} },
    });
    expect(resultSummary(inProgress).text).toBe('A 0 - 0 B（1回表の途中まで）');
    expect(resultSummary(makeGame({ teamFirst: 'A', teamSecond: 'B' })).text).toBe('A 0 - 0 B（試合前）');
  });

  it('names the end reason and draws', () => {
    const walkoff = Object.assign(new GameData(), simulateGame(14, { innings: 7 }).game, { teamFirst: 'A', teamSecond: 'B' });
    expect(resultSummary(walkoff)).toMatchObject({ final: true, text: 'Bの勝ち（9 - 8・サヨナラ）' });
    const called = makeGame({
      teamFirst: 'A', teamSecond: 'B', status: 'final', endReason: 'called',
      atBats: { first: { 1: cells(scoringSpecs(0, 1)) }, second: { 1: cells(scoringSpecs(0, 1)) } },
    });
    expect(resultSummary(called).text).toBe('引き分け（1 - 1・コールドゲーム）');
  });

  it('shows the tiebreak rule when set', () => {
    const html = buildHeaderHTML(makeGame({ tiebreakerInning: 6, tiebreakerRunners: '1B2B' }));
    expect(html).toContain('6回から（ノーアウト・走者一・二塁で開始）');
    expect(buildHeaderHTML(makeGame({ tiebreakerInning: 6, tiebreakerRunners: 'none' }))).not.toContain('タイブレーク');
  });
});

describe('canvasScale', () => {
  it('keeps 2x for normal sizes', () => {
    expect(canvasScale(1500, 2000)).toBe(2);
    expect(canvasScale(700, 400)).toBe(2);
  });

  it('shrinks very large images under the browser canvas limits', () => {
    const s = canvasScale(2400, 2600);
    expect(s).toBeLessThan(2);
    expect(2400 * s * 2600 * s).toBeLessThanOrEqual(14000000);
    const tall = canvasScale(1000, 9000);
    expect(9000 * tall).toBeLessThanOrEqual(8000);
  });

  it('handles unknown sizes', () => {
    expect(canvasScale(0, 0)).toBe(2);
  });
});
