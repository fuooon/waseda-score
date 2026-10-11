import { describe, it, expect } from 'vitest';
import { RESULT_TYPES, RUNNER_EVENTS } from '../src/rules.js';
import {
  describeCell, describeResult, describeHalfInning, baseName, fielderPath,
} from '../src/describe.js';

const T = (type, base) => (base ? { type, base } : { type });
const XSS = '<img src=x onerror=alert(1)>';

function clean(text) {
  expect(typeof text).toBe('string');
  expect(text).not.toMatch(/undefined|NaN|null|\[object/);
}

// ============================================
// baseName / fielderPath
// ============================================

describe('baseName', () => {
  it('names the four bases', () => {
    expect(baseName(1)).toBe('一塁');
    expect(baseName(2)).toBe('二塁');
    expect(baseName(3)).toBe('三塁');
    expect(baseName(4)).toBe('本塁');
  });
  it('returns empty text for anything else', () => {
    expect(baseName(0)).toBe('');
    expect(baseName(5)).toBe('');
    expect(baseName(undefined)).toBe('');
    expect(baseName('x')).toBe('');
  });
});

describe('fielderPath', () => {
  it('normalises full-width digits and dashes', () => {
    expect(fielderPath('６－３')).toBe('6-3');
    expect(fielderPath('6ー4ー3')).toBe('6-4-3');
    expect(fielderPath(' 6-3 ')).toBe('6-3');
    expect(fielderPath('63')).toBe('63');
  });
  it('rejects text that is not fielder numbers', () => {
    expect(fielderPath('')).toBe('');
    expect(fielderPath(null)).toBe('');
    expect(fielderPath('0')).toBe('');
    expect(fielderPath('6--3')).toBe('');
    expect(fielderPath('遊ゴロ')).toBe('');
    expect(fielderPath(XSS)).toBe('');
  });
});

// ============================================
// describeResult
// ============================================

describe('describeResult', () => {
  it('describes fielded outs by fielder', () => {
    expect(describeResult('GROUNDOUT', '6-3')).toBe('ショートゴロ（6-3）');
    expect(describeResult('GROUNDOUT', '1-3')).toBe('ピッチャーゴロ（1-3）');
    expect(describeResult('GROUNDOUT', '3')).toBe('ファーストゴロ');
    expect(describeResult('FLYOUT', '8')).toBe('センターフライ');
    expect(describeResult('LINEOUT', '5')).toBe('サードライナー');
    expect(describeResult('DOUBLE_PLAY', '6-4-3')).toBe('ショートゴロの併殺打（6-4-3）');
    expect(describeResult('INFIELD_FLY', '4')).toBe('インフィールドフライ（セカンド）');
  });

  it('describes hits by the direction of the first fielder', () => {
    expect(describeResult('SINGLE', '7')).toBe('レフト前ヒット');
    expect(describeResult('SINGLE', '8')).toBe('センター前ヒット');
    expect(describeResult('SINGLE', '6')).toBe('ショートへの内野安打');
    expect(describeResult('DOUBLE', '8')).toBe('センターへの二塁打');
    expect(describeResult('TRIPLE', '9')).toBe('ライトへの三塁打');
    expect(describeResult('HOMERUN', '7')).toBe('レフトへのホームラン');
  });

  it('falls back to a plain word without fielder numbers', () => {
    expect(describeResult('SINGLE', '')).toBe('ヒット');
    expect(describeResult('DOUBLE')).toBe('二塁打');
    expect(describeResult('TRIPLE', null)).toBe('三塁打');
    expect(describeResult('HOMERUN', '')).toBe('ホームラン');
    expect(describeResult('GROUNDOUT', '')).toBe('ゴロ');
    expect(describeResult('FLYOUT', '')).toBe('フライ');
  });

  it('describes walks, strikeouts, sacrifices and other results', () => {
    expect(describeResult('STRIKEOUT_SWING')).toBe('空振り三振');
    expect(describeResult('STRIKEOUT_LOOK')).toBe('見逃し三振');
    expect(describeResult('STRIKEOUT_WILD')).toBe('振り逃げ');
    expect(describeResult('WALK')).toContain('四球');
    expect(describeResult('INTENTIONAL_WALK')).toContain('敬遠');
    expect(describeResult('HIT_BY_PITCH')).toContain('死球');
    expect(describeResult('SACRIFICE_BUNT', '1-3')).toBe('ピッチャー前への送りバント（犠打・1-3）');
    expect(describeResult('SACRIFICE_BUNT', '')).toBe('送りバント（犠打）');
    expect(describeResult('SACRIFICE_FLY', '8')).toBe('センターへの犠牲フライ');
    expect(describeResult('ERROR', '6')).toBe('ショートのエラー');
    expect(describeResult('ERROR', '5-3')).toBe('エラー（5-3）');
    expect(describeResult('FIELDERS_CHOICE', '6-4')).toBe('ショートの野選（フィルダースチョイス・6-4）');
    expect(describeResult('INTERFERENCE')).toBe('打撃妨害');
    expect(describeResult('TIEBREAK_RUNNER')).toBe('タイブレークの置きランナー');
  });

  it('accepts full-width fielder numbers', () => {
    expect(describeResult('GROUNDOUT', '６－３')).toBe('ショートゴロ（6-3）');
  });

  it('returns a clean non-empty phrase for every RESULT_TYPE', () => {
    for (const id of Object.keys(RESULT_TYPES)) {
      for (const pos of ['', '6-3', '8', XSS, undefined]) {
        const text = describeResult(id, pos);
        clean(text);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain('<');
      }
    }
  });

  it('ignores fielder numbers for results that do not use them', () => {
    expect(describeResult('WALK', '6')).toBe(describeResult('WALK'));
  });

  it('returns empty text for unknown types', () => {
    expect(describeResult('BOGUS', '6')).toBe('');
    expect(describeResult(undefined)).toBe('');
    expect(describeResult(null)).toBe('');
  });
});

// ============================================
// describeCell
// ============================================

describe('describeCell', () => {
  it('describes a fielded out with player, order and out number', () => {
    const cell = { resultType: 'GROUNDOUT', positions: '6-3', rbi: 0, basesReached: 0, outNumber: 1, runnerEvents: [] };
    expect(describeCell(cell, { playerName: '田中', orderNum: 4 })).toBe('4番 田中：ショートゴロ（6-3）でアウト【1アウト目】');
  });

  it('describes the runner journey and RBI', () => {
    const cell = { resultType: 'SINGLE', positions: '7', rbi: 1, basesReached: 4, outNumber: null, runnerEvents: [T('STOLEN_BASE')] };
    expect(describeCell(cell)).toBe('レフト前ヒット → 盗塁 → 得点（打点1）');
  });

  it('describes a runner out on the bases', () => {
    const cell = { resultType: 'WALK', positions: '', rbi: 0, basesReached: 1, outNumber: 2, runnerEvents: [T('RUNNER_OUT', 2)] };
    expect(describeCell(cell)).toBe('四球（フォアボール）で出塁 → 二塁で走塁死【2アウト目】');
  });

  it('uses the base of each event when known (E4)', () => {
    const cell = { resultType: 'ERROR', positions: '6', basesReached: 4, runnerEvents: [T('STOLEN_BASE', 2), T('WILD_PITCH', 3)] };
    expect(describeCell(cell)).toBe('ショートのエラーで出塁 → 二塁へ盗塁 → 暴投で三塁へ → 得点');
    const noBase = { resultType: 'ERROR', positions: '6', basesReached: 4, runnerEvents: [T('STOLEN_BASE'), T('WILD_PITCH')] };
    expect(describeCell(noBase)).toBe('ショートのエラーで出塁 → 盗塁 → 暴投で進塁 → 得点');
  });

  it('merges a scoring event with the run', () => {
    const cell = { resultType: 'TRIPLE', positions: '9', basesReached: 4, runnerEvents: [T('WILD_PITCH', 4)] };
    expect(describeCell(cell)).toBe('ライトへの三塁打 → 暴投で生還（得点）');
  });

  it('mentions how far the runner went when no event explains it', () => {
    const cell = { resultType: 'SINGLE', positions: '8', basesReached: 3, runnerEvents: [] };
    expect(describeCell(cell)).toBe('センター前ヒット → 三塁へ進む');
    const outLater = { resultType: 'SINGLE', positions: '8', basesReached: 2, outNumber: 3, runnerEvents: [T('CAUGHT_STEALING', 3)] };
    expect(describeCell(outLater)).toBe('センター前ヒット → 二塁へ進む → 三塁で盗塁死【3アウト目】');
  });

  it('describes a double play and a home run', () => {
    expect(describeCell({ resultType: 'DOUBLE_PLAY', positions: '6-4-3', outNumber: 2 }))
      .toBe('ショートゴロの併殺打（6-4-3）でアウト【2アウト目】（走者と合わせて2アウト）');
    expect(describeCell({ resultType: 'HOMERUN', positions: '7', rbi: 2, basesReached: 4 }, { orderNum: 1 }))
      .toBe('1番：レフトへのホームランで得点（打点2）');
  });

  it('describes a sacrifice fly with its RBI', () => {
    expect(describeCell({ resultType: 'SACRIFICE_FLY', positions: '8', rbi: 1, outNumber: 2 }))
      .toBe('センターへの犠牲フライでアウト【2アウト目】（打点1）');
  });

  it('describes legacy runner outs (non-out result, no base reached)', () => {
    expect(describeCell({ resultType: 'SINGLE', positions: '7', basesReached: 0, outNumber: 1 }))
      .toBe('レフト前ヒット → 塁上でアウト【1アウト目】');
  });

  it('describes placed tiebreak runners', () => {
    expect(describeCell({ resultType: 'TIEBREAK_RUNNER', basesReached: 4 })).toBe('タイブレークの置きランナー → 得点');
    expect(describeCell({ resultType: 'TIEBREAK_RUNNER', basesReached: 2 })).toBe('タイブレークの置きランナー（二塁）');
    expect(describeCell({ resultType: 'TIEBREAK_RUNNER', basesReached: 3 }, { startBase: 2 })).toBe('タイブレークの置きランナー → 三塁へ進む');
  });

  it('describes every runner event with and without a base', () => {
    for (const id of Object.keys(RUNNER_EVENTS)) {
      const ev = RUNNER_EVENTS[id];
      for (const base of [undefined, 2, 3, 4]) {
        const cell = {
          resultType: 'SINGLE', positions: '7', rbi: 0,
          basesReached: ev.isOut ? 1 : (base || 2), outNumber: ev.isOut ? 1 : null,
          runnerEvents: [T(id, base)],
        };
        const text = describeCell(cell);
        clean(text);
        expect(text.startsWith('レフト前ヒット → ')).toBe(true);
        if (ev.isOut) expect(text).toContain('【1アウト目】');
        if (base && base < 4) expect(text).toContain(baseName(base));
      }
    }
  });

  it('never prints undefined/NaN for any result, base, out number or event mix', () => {
    const eventSets = [[], [T('STOLEN_BASE')], [T('WILD_PITCH', 3), T('CAUGHT_STEALING')], [{ type: 'BOGUS' }], 'x', null];
    for (const id of Object.keys(RESULT_TYPES)) {
      for (const basesReached of [0, 1, 2, 3, 4, undefined, 'x', NaN]) {
        for (const outNumber of [null, 1, 2, 3, undefined, 'x']) {
          for (const runnerEvents of eventSets) {
            const cell = { resultType: id, positions: '6-3', rbi: NaN, basesReached, outNumber, runnerEvents };
            const text = describeCell(cell, { playerName: undefined, orderNum: NaN });
            clean(text);
            expect(text.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('returns empty text for empty or unknown cells', () => {
    expect(describeCell(null)).toBe('');
    expect(describeCell(undefined)).toBe('');
    expect(describeCell({})).toBe('');
    expect(describeCell({ resultType: null, runnerEvents: [] })).toBe('');
    expect(describeCell({ resultType: 'BOGUS', runnerEvents: [T('STOLEN_BASE')] })).toBe('');
  });

  it('describes a runner-only legacy cell', () => {
    expect(describeCell({ resultType: null, runnerEvents: [T('STOLEN_BASE')] })).toBe('打席結果が未入力 → 盗塁');
  });

  it('does not copy markup from the positions field', () => {
    const text = describeCell({ resultType: 'GROUNDOUT', positions: XSS, outNumber: 1 });
    expect(text).toBe('ゴロでアウト【1アウト目】');
  });

  it('builds the player prefix from what is known', () => {
    const cell = { resultType: 'WALK', basesReached: 1 };
    expect(describeCell(cell, { orderNum: 5 })).toBe('5番：四球（フォアボール）で出塁');
    expect(describeCell(cell, { playerName: '鈴木' })).toBe('鈴木：四球（フォアボール）で出塁');
    expect(describeCell(cell, { playerName: '  ', orderNum: 0 })).toBe('四球（フォアボール）で出塁');
  });
});

// ============================================
// describeHalfInning
// ============================================

function half(overrides) {
  return {
    teamKey: 'first', inning: 1, N: 9, leadoff: 0, isTiebreak: false,
    cells: [], seq: [], outs: 0, runs: 0, rbi: 0, hits: 0, pa: 0, ab: 0, lob: 0, errors: 0,
    runners: [], started: true, complete: false, nextBatter: null, lastBatterIdx: null,
    ...overrides,
  };
}

const c = (batterIdx, state, isPlaced = false) => ({ key: String(batterIdx), batterIdx, lap: 0, order: batterIdx, cell: {}, state, isPlaced });

describe('describeHalfInning', () => {
  const lineup = [{ name: '佐藤' }, { name: '鈴木' }, { name: '高橋' }, { name: '田中' }, { name: '伊藤' }];

  it('summarises a complete half-inning with a check mark (E2)', () => {
    const h = half({
      cells: [c(3, 'SCORED'), c(4, 'ON_BASE'), c(5, 'OUT'), c(6, 'OUT'), c(7, 'OUT')],
      pa: 5, runs: 1, outs: 3, lob: 1, complete: true,
      runners: [{ key: '4', batterIdx: 4, base: 2, cell: {} }],
    });
    expect(describeHalfInning(h, lineup)).toBe('打者5人：得点1・残塁1・アウト3 ✓');
    expect(describeHalfInning(h, lineup, { detail: true }))
      .toBe('打者5人：得点1（4番 田中）・残塁1（5番 伊藤＝二塁）・アウト3 ✓');
  });

  it('counts placed runners (E10)', () => {
    const h = half({
      cells: [c(3, 'SCORED', true), c(2, 'SCORED', true), c(4, 'OUT'), c(5, 'OUT'), c(6, 'OUT')],
      pa: 3, runs: 2, outs: 3, lob: 0, complete: true,
    });
    expect(describeHalfInning(h, lineup)).toBe('打者3人＋置きランナー2人：得点2・残塁0・アウト3 ✓');
  });

  it('warns when the numbers do not add up', () => {
    const h = half({ cells: [c(0, 'OUT'), c(1, 'OUT'), c(2, 'OUT')], pa: 3, runs: 0, outs: 3, lob: 1, complete: true });
    const text = describeHalfInning(h, lineup);
    expect(text).toContain('⚠ 人数が合いません');
    expect(text).not.toContain('✓');
  });

  it('warns about a missing out when later innings were recorded (X4)', () => {
    const h = half({
      cells: [c(0, 'ON_BASE'), c(1, 'OUT'), c(2, 'OUT')], pa: 3, runs: 0, outs: 2, lob: 1, complete: true,
      nextBatter: { batterIdx: 3, lap: 0, key: '3' },
    });
    expect(describeHalfInning(h, lineup)).toBe('打者3人：得点0・残塁1・アウト2 ⚠ アウトが2つしかありません');
  });

  it('accepts fewer than 3 outs when the game ended in the half (E11)', () => {
    const h = half({
      cells: [c(0, 'SCORED'), c(1, 'OUT'), c(2, 'ON_BASE')], pa: 3, runs: 1, outs: 1, lob: 1, complete: true, nextBatter: null,
    });
    expect(describeHalfInning(h, lineup)).toBe('打者3人：得点1・残塁1・アウト1 ✓（試合終了）');
  });

  it('shows runners on base while the half is in progress', () => {
    const h = half({
      cells: [c(0, 'ON_BASE'), c(1, 'OUT')], pa: 2, outs: 1, lob: 1,
      runners: [{ key: '0', batterIdx: 0, base: 1, cell: {} }],
    });
    expect(describeHalfInning(h, lineup)).toBe('打者2人：得点0・塁上1・アウト1（攻撃中）');
  });

  it('returns empty text for a half that has not started', () => {
    expect(describeHalfInning(half({ started: false }), lineup)).toBe('');
    expect(describeHalfInning(null, lineup)).toBe('');
  });

  it('never prints undefined/NaN with missing fields or lineup', () => {
    const text = describeHalfInning({ started: true, complete: true, cells: [c(0, 'SCORED')] }, undefined, { detail: true });
    clean(text);
    expect(text).toContain('1番');
  });
});
