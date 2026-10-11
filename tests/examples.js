// Worked examples from docs/scoring-rules.md §9 (one half-inning each).
// Omitted cell fields default to rbi:0, basesReached:0, outNumber:null, runnerEvents:[].
// nextLeadoff is a batterIdx (0 = 1番). E10 uses the v2 keys 'tb' + batterIdx for
// the placed tiebreak runners.

const T = type => ({ type });

export const VALID = [
  { id: 'E1', note: '三者凡退（1番ショートゴロ、2番センターフライ、3番空振り三振）', N: 9, L: 0, cells: {
    0: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 1 },
    1: { resultType: 'FLYOUT', positions: '8', outNumber: 2 },
    2: { resultType: 'STRIKEOUT_SWING', outNumber: 3 } },
  expect: { outs: 3, runs: 0, rbi: 0, hits: 0, lob: 0, pa: 3, ab: 3, nextLeadoff: 3 } },
  { id: 'E2', note: '4番レフト前、5番中堅への二塁打で4番生還、後続凡退', N: 9, L: 3, cells: {
    3: { resultType: 'SINGLE', positions: '7', basesReached: 4 },
    4: { resultType: 'DOUBLE', positions: '8', rbi: 1, basesReached: 2 },
    5: { resultType: 'STRIKEOUT_LOOK', outNumber: 1 },
    6: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 2 },
    7: { resultType: 'FLYOUT', positions: '9', outNumber: 3 } },
  expect: { outs: 3, runs: 1, rbi: 1, hits: 2, lob: 1, pa: 5, ab: 5, nextLeadoff: 8 } },
  { id: 'E3', note: '9番四球、1番2ラン本塁打', N: 9, L: 8, cells: {
    8: { resultType: 'WALK', basesReached: 4 },
    0: { resultType: 'HOMERUN', rbi: 2, basesReached: 4 },
    1: { resultType: 'GROUNDOUT', positions: '4-3', outNumber: 1 },
    2: { resultType: 'STRIKEOUT_SWING', outNumber: 2 },
    3: { resultType: 'LINEOUT', positions: '6', outNumber: 3 } },
  expect: { outs: 3, runs: 2, rbi: 2, hits: 1, lob: 0, pa: 5, ab: 4, nextLeadoff: 4 } },
  { id: 'E4', note: '1番E6で出塁→盗塁→暴投で生還（打点0）。守備側の失策+1', N: 9, L: 0, cells: {
    0: { resultType: 'ERROR', positions: '6', basesReached: 4, runnerEvents: [T('STOLEN_BASE'), T('WILD_PITCH')] },
    1: { resultType: 'GROUNDOUT', positions: '4-3', outNumber: 1 },
    2: { resultType: 'STRIKEOUT_SWING', outNumber: 2 },
    3: { resultType: 'FLYOUT', positions: '7', outNumber: 3 } },
  expect: { outs: 3, runs: 1, rbi: 0, hits: 0, lob: 0, pa: 4, ab: 4, errorsChargedToDefense: 1, nextLeadoff: 4 } },
  { id: 'E5', note: '5番二塁打、6番単打、7番6-4-3併殺（6番が二塁で封殺）の間に5番生還＝打点0', N: 9, L: 4, cells: {
    4: { resultType: 'DOUBLE', positions: '7', basesReached: 4 },
    5: { resultType: 'SINGLE', positions: '8', basesReached: 1, runnerEvents: [T('RUNNER_OUT')], outNumber: 1 },
    6: { resultType: 'DOUBLE_PLAY', positions: '6-4-3', outNumber: 2 },
    7: { resultType: 'STRIKEOUT_LOOK', outNumber: 3 } },
  expect: { outs: 3, runs: 1, rbi: 0, hits: 2, lob: 0, pa: 4, ab: 4, nextLeadoff: 8 } },
  { id: 'E6', note: '2番四球、3番犠打、4番単打、5番犠飛で2番生還、6番ゴロ（4番は残塁）', N: 9, L: 1, cells: {
    1: { resultType: 'WALK', basesReached: 4 },
    2: { resultType: 'SACRIFICE_BUNT', positions: '1-3', outNumber: 1 },
    3: { resultType: 'SINGLE', positions: '9', basesReached: 1 },
    4: { resultType: 'SACRIFICE_FLY', positions: '8', rbi: 1, outNumber: 2 },
    5: { resultType: 'GROUNDOUT', positions: '5-3', outNumber: 3 } },
  expect: { outs: 3, runs: 1, rbi: 1, hits: 1, lob: 1, pa: 5, ab: 2, nextLeadoff: 6 } },
  { id: 'E7', note: '四球・死球・四球で満塁→押し出し、その後3アウトで満塁残塁', N: 9, L: 6, cells: {
    6: { resultType: 'WALK', basesReached: 4 },
    7: { resultType: 'HIT_BY_PITCH', basesReached: 3 },
    8: { resultType: 'WALK', basesReached: 2 },
    0: { resultType: 'WALK', rbi: 1, basesReached: 1 },
    1: { resultType: 'STRIKEOUT_SWING', outNumber: 1 },
    2: { resultType: 'FLYOUT', positions: '7', outNumber: 2 },
    3: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 3 } },
  expect: { outs: 3, runs: 1, rbi: 1, hits: 0, lob: 3, pa: 7, ab: 3, nextLeadoff: 4 } },
  { id: 'E8', note: '3番単打、4・5番三振、6番の打席中に3番盗塁死→次の回は6番から', N: 9, L: 2, cells: {
    2: { resultType: 'SINGLE', positions: '7', basesReached: 1, runnerEvents: [T('CAUGHT_STEALING')], outNumber: 3 },
    3: { resultType: 'STRIKEOUT_SWING', outNumber: 1 },
    4: { resultType: 'STRIKEOUT_LOOK', outNumber: 2 } },
  expect: { outs: 3, runs: 0, rbi: 0, hits: 1, lob: 0, pa: 3, ab: 3, nextLeadoff: 5 } },
  { id: 'E9', note: '1番単打で二塁を狙ってアウト、2番単打、3番野選（2番が二塁で封殺）、4番一ゴロ（3番は二塁へ進み残塁）', N: 9, L: 0, cells: {
    0: { resultType: 'SINGLE', positions: '8', basesReached: 1, runnerEvents: [T('RUNNER_OUT')], outNumber: 1 },
    1: { resultType: 'SINGLE', positions: '7', basesReached: 1, runnerEvents: [T('RUNNER_OUT')], outNumber: 2 },
    2: { resultType: 'FIELDERS_CHOICE', positions: '6-4', basesReached: 2 },
    3: { resultType: 'GROUNDOUT', positions: '3', outNumber: 3 } },
  expect: { outs: 3, runs: 0, rbi: 0, hits: 2, lob: 1, pa: 4, ab: 4, nextLeadoff: 4 } },
  { id: 'E10', note: 'タイブレーク(1B2B, 継続打順, 前の回は4番で終了)。置きランナー 一塁=4番, 二塁=3番。5番犠打、6番2点適時打、7番4-6-3併殺', N: 9, L: 4, tiebreak: '1B2B', cells: {
    tb3: { resultType: 'TIEBREAK_RUNNER', basesReached: 4, batterIdx: 3 },
    tb2: { resultType: 'TIEBREAK_RUNNER', basesReached: 4, batterIdx: 2 },
    4: { resultType: 'SACRIFICE_BUNT', positions: '1-4', outNumber: 1 },
    5: { resultType: 'SINGLE', positions: '8', rbi: 2, basesReached: 1, runnerEvents: [T('RUNNER_OUT')], outNumber: 2 },
    6: { resultType: 'DOUBLE_PLAY', positions: '4-6-3', outNumber: 3 } },
  expect: { outs: 3, runs: 2, rbi: 2, hits: 1, lob: 0, pa: 3, ab: 2, placed: 2, nextLeadoff: 7 } },
  { id: 'E11', note: '最終回の裏・同点。1番四球、2番犠打、3番サヨナラ打（試合終了。アウト1でも完了扱い）', N: 9, L: 0, gameEndsHere: true, cells: {
    0: { resultType: 'WALK', basesReached: 4 },
    1: { resultType: 'SACRIFICE_BUNT', positions: '2-3', outNumber: 1 },
    2: { resultType: 'SINGLE', positions: '9', rbi: 1, basesReached: 1 } },
  expect: { outs: 1, runs: 1, rbi: 1, hits: 1, lob: 1, pa: 3, ab: 1, nextLeadoff: 3 } },
  { id: 'E12', note: '打者一巡。1番の2打席目は key=0+9=9', N: 9, L: 0, cells: {
    0: { resultType: 'SINGLE', positions: '7', basesReached: 4 },
    1: { resultType: 'WALK', basesReached: 4 },
    2: { resultType: 'DOUBLE', positions: '8', rbi: 2, basesReached: 4 },
    3: { resultType: 'SINGLE', positions: '9', rbi: 1, basesReached: 4 },
    4: { resultType: 'STRIKEOUT_SWING', outNumber: 1 },
    5: { resultType: 'HOMERUN', rbi: 2, basesReached: 4 },
    6: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 2 },
    7: { resultType: 'ERROR', positions: '5', basesReached: 2 },
    8: { resultType: 'WALK', basesReached: 1 },
    9: { resultType: 'FLYOUT', positions: '8', outNumber: 3 } },
  expect: { outs: 3, runs: 5, rbi: 5, hits: 4, lob: 2, pa: 10, ab: 8, errorsChargedToDefense: 1, nextLeadoff: 1 } },
];

export const INVALID = [
  { id: 'X1', note: '還った1番を得点にし忘れ', N: 9, L: 0, cells: {
    0: { resultType: 'SINGLE', positions: '7', basesReached: 1 },
    1: { resultType: 'DOUBLE', positions: '8', rbi: 1, basesReached: 2 },
    2: { resultType: 'STRIKEOUT_SWING', outNumber: 1 },
    3: { resultType: 'FLYOUT', positions: '9', outNumber: 2 },
    4: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 3 } }, expectChecks: ['C01'] },
  { id: 'X2', note: '3アウト後に4番', N: 9, L: 0, cells: {
    0: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 1 },
    1: { resultType: 'FLYOUT', positions: '8', outNumber: 2 },
    2: { resultType: 'STRIKEOUT_SWING', outNumber: 3 },
    3: { resultType: 'SINGLE', positions: '7', basesReached: 1 } }, expectChecks: ['C05'] },
  { id: 'X3', note: '2アウトから犠飛・打点0', N: 9, L: 0, cells: {
    0: { resultType: 'TRIPLE', positions: '8', basesReached: 3 },
    1: { resultType: 'STRIKEOUT_SWING', outNumber: 1 },
    2: { resultType: 'STRIKEOUT_LOOK', outNumber: 2 },
    3: { resultType: 'SACRIFICE_FLY', positions: '9', outNumber: 3 } }, expectChecks: ['C09', 'C10'] },
  { id: 'X4', note: '併殺なのに走者アウトの記入がなく、アウト2つで次の回へ', N: 9, L: 0, completed: true, cells: {
    0: { resultType: 'SINGLE', positions: '7', basesReached: 1 },
    1: { resultType: 'DOUBLE_PLAY', positions: '6-4-3', outNumber: 2 },
    2: { resultType: 'GROUNDOUT', positions: '5-3', outNumber: 3 } }, expectChecks: ['C03', 'C08'] },
  { id: 'X5', note: '前の回は3番で終了（L=3）なのに6番から記録', N: 9, L: 3, cells: {
    5: { resultType: 'GROUNDOUT', positions: '6-3', outNumber: 1 },
    6: { resultType: 'FLYOUT', positions: '8', outNumber: 2 },
    7: { resultType: 'STRIKEOUT_SWING', outNumber: 3 } }, expectChecks: ['C06'] },
  { id: 'X6', note: 'HRなのに打点0／二塁打なのに一塁／同じ塁に2人（進行中）', N: 9, L: 0, cells: {
    0: { resultType: 'HOMERUN', basesReached: 4 },
    1: { resultType: 'DOUBLE', positions: '9', basesReached: 1 },
    2: { resultType: 'SINGLE', positions: '7', basesReached: 1 } }, expectChecks: ['C02(warning)', 'C12', 'C15'] },
];
