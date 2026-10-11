import { describe, it, expect } from 'vitest';
import { lineupWarnings, LINEUP_SIZE } from '../src/lineup.js';
import { normalizeTeamName } from '../src/team-members.js';

const row = (name, position = '', memberId = '') => ({ name, number: '', position, bat: 'right', memberId });
const full = () => ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((p, i) => row(`P${i + 1}`, p));
const kinds = list => list.map(w => w.kind);

describe('lineupWarnings', () => {
  it('has 9 batting slots, also with DH', () => {
    expect(LINEUP_SIZE).toBe(9);
  });

  it('is quiet for a complete lineup and for an empty one', () => {
    expect(lineupWarnings(full())).toEqual([]);
    expect(lineupWarnings(Array.from({ length: 9 }, () => row('')))).toEqual([]);
    expect(lineupWarnings(undefined)).toEqual([]);
  });

  it('finds the same player twice (by member id or by name)', () => {
    const lineup = full();
    lineup[4] = row('P1', '');
    const w = lineupWarnings(lineup);
    expect(w.find(x => x.kind === 'duplicate-player').text).toBe('同じ選手「P1」が1番・5番に入っています');

    const byId = full();
    byId[0] = row('田中', '1', 'm1');
    byId[1] = row('田中', '2', 'm1');
    expect(kinds(lineupWarnings(byId))).toContain('duplicate-player');

    // two different registered players with the same name are not duplicates
    const twins = full();
    twins[0] = row('田中', '1', 'm1');
    twins[1] = row('田中', '2', 'm2');
    expect(kinds(lineupWarnings(twins))).not.toContain('duplicate-player');
  });

  it('finds positions used twice and positions nobody plays', () => {
    const lineup = full();
    lineup[1].position = '6';
    const w = lineupWarnings(lineup);
    expect(w.find(x => x.kind === 'duplicate-position').text).toBe('守備位置「遊撃手（6）」が2番・6番で重なっています');
    expect(w.find(x => x.kind === 'missing-position').text).toBe('まだ決まっていない守備位置：捕手（2）');
  });

  it('lists missing positions only once every slot has a name', () => {
    const partial = Array.from({ length: 9 }, () => row(''));
    partial[0] = row('A', '1');
    partial[1] = row('B', '2');
    expect(lineupWarnings(partial)).toEqual([]);
  });

  it('knows the DH rules', () => {
    const dh = full();
    dh[0].position = 'DH'; // the pitcher does not bat
    expect(lineupWarnings(dh, { useDH: true, pitcher: '投手くん' })).toEqual([]);
    expect(kinds(lineupWarnings(dh, { useDH: true }))).toEqual(['missing-pitcher']);
    expect(kinds(lineupWarnings(dh, { useDH: false }))).toEqual(['missing-position', 'dh-without-dh']);
  });

  it('points at skipped slots only, not slots below the last name', () => {
    const lineup = Array.from({ length: 9 }, () => row(''));
    lineup[0] = row('A');
    lineup[1] = row('B');
    expect(lineupWarnings(lineup)).toEqual([]);
    lineup[3] = row('D');
    expect(lineupWarnings(lineup)).toEqual([{ kind: 'missing-name', text: '名前が入っていない打順：3番' }]);
  });
});

describe('normalizeTeamName', () => {
  it('ignores width and extra spaces', () => {
    expect(normalizeTeamName('　ファイターズ　')).toBe('ファイターズ');
    expect(normalizeTeamName('ＡＢＣ  ジュニア')).toBe('ABC ジュニア');
    expect(normalizeTeamName(null)).toBe('');
  });
});
