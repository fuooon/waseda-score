// ============================================
// Baseball rule constants (no dependencies)
// ============================================
//
// Every module that needs result-type semantics imports them from here so the
// scoring engine, the scoresheet, the input panel and the symbol guide can
// never disagree about what a result means.

export const POSITIONS = {
  1: '投手', 2: '捕手', 3: '一塁手', 4: '二塁手', 5: '三塁手',
  6: '遊撃手', 7: '左翼手', 8: '中堅手', 9: '右翼手', DH: '指名打者'
};

export const POSITION_SHORT = {
  1: '投', 2: '捕', 3: '一', 4: '二', 5: '三',
  6: '遊', 7: '左', 8: '中', 9: '右', DH: '指'
};

// Names used in plain-language descriptions ("ショートゴロ", "レフト前ヒット").
export const POSITION_FIELD_NAMES = {
  1: 'ピッチャー', 2: 'キャッチャー', 3: 'ファースト', 4: 'セカンド', 5: 'サード',
  6: 'ショート', 7: 'レフト', 8: 'センター', 9: 'ライト'
};

export const BAT_LABELS = { right: '右', left: '左', switch: '両' };

// Field meanings:
//   category        'out' | 'hit' | 'walk' | 'sacrifice' | 'other' | 'runner'  (input-panel grouping)
//   batType         'ground' | 'fly' | 'liner'  (trajectory mark for fielded balls)
//   needsPositions  show the fielder-number input (for hits it is the direction, optional)
//   isOut           the batter is out on this play
//   bases           default base the batter reaches (0 for outs, 4 = home run)
//   isPA            counts as a plate appearance (打席); false only for placed runners
//   isAtBat         counts as an official at-bat (打数)
//   isHit           counts as a hit (安打)
//   rbiAllowed      an RBI can be credited on this result (validation still checks plausibility)
//   chargesError    one error is charged to the fielding team (失策)
//   outsCount       informational: outs made by the whole play (DP = 2). The engine
//                   counts outs per cell (batter cell + runner cell), never by this number.
//   needsRunnerOut  the play also retires a runner, who must be chosen in the input panel
//   mirrorSymbol    draw the symbol mirrored (見逃し三振 = reversed K)
export const RESULT_TYPES = {
  // Outs
  GROUNDOUT: { id: 'GROUNDOUT', label: 'ゴロ', symbol: 'ゴ', batType: 'ground', category: 'out', needsPositions: true, isOut: true, bases: 0, isPA: true, isAtBat: true, isHit: false, rbiAllowed: true, chargesError: false },
  FLYOUT: { id: 'FLYOUT', label: 'フライ', symbol: '飛', batType: 'fly', category: 'out', needsPositions: true, isOut: true, bases: 0, isPA: true, isAtBat: true, isHit: false, rbiAllowed: false, chargesError: false },
  LINEOUT: { id: 'LINEOUT', label: 'ライナー', symbol: '直', batType: 'liner', category: 'out', needsPositions: true, isOut: true, bases: 0, isPA: true, isAtBat: true, isHit: false, rbiAllowed: false, chargesError: false },
  STRIKEOUT_SWING: { id: 'STRIKEOUT_SWING', label: '空振り三振', symbol: 'K', category: 'out', needsPositions: false, isOut: true, bases: 0, isPA: true, isAtBat: true, isHit: false, rbiAllowed: false, chargesError: false },
  STRIKEOUT_LOOK: { id: 'STRIKEOUT_LOOK', label: '見逃し三振', symbol: 'K', mirrorSymbol: true, category: 'out', needsPositions: false, isOut: true, bases: 0, isPA: true, isAtBat: true, isHit: false, rbiAllowed: false, chargesError: false },
  DOUBLE_PLAY: { id: 'DOUBLE_PLAY', label: '併殺打', symbol: 'DP', batType: 'ground', category: 'out', needsPositions: true, isOut: true, bases: 0, isPA: true, isAtBat: true, isHit: false, rbiAllowed: false, chargesError: false, outsCount: 2, needsRunnerOut: true },
  INFIELD_FLY: { id: 'INFIELD_FLY', label: 'インフィールドフライ', symbol: 'IF', batType: 'fly', category: 'out', needsPositions: true, isOut: true, bases: 0, isPA: true, isAtBat: true, isHit: false, rbiAllowed: false, chargesError: false },

  // Hits
  SINGLE: { id: 'SINGLE', label: '単打', symbol: '━', category: 'hit', needsPositions: true, isOut: false, bases: 1, isPA: true, isAtBat: true, isHit: true, rbiAllowed: true, chargesError: false },
  DOUBLE: { id: 'DOUBLE', label: '二塁打', symbol: '═', category: 'hit', needsPositions: true, isOut: false, bases: 2, isPA: true, isAtBat: true, isHit: true, rbiAllowed: true, chargesError: false },
  TRIPLE: { id: 'TRIPLE', label: '三塁打', symbol: '≡', category: 'hit', needsPositions: true, isOut: false, bases: 3, isPA: true, isAtBat: true, isHit: true, rbiAllowed: true, chargesError: false },
  HOMERUN: { id: 'HOMERUN', label: '本塁打', symbol: 'HR', category: 'hit', needsPositions: true, isOut: false, bases: 4, isPA: true, isAtBat: true, isHit: true, rbiAllowed: true, chargesError: false },

  // Walks / hit by pitch
  WALK: { id: 'WALK', label: '四球', symbol: 'B', category: 'walk', needsPositions: false, isOut: false, bases: 1, isPA: true, isAtBat: false, isHit: false, rbiAllowed: true, chargesError: false },
  INTENTIONAL_WALK: { id: 'INTENTIONAL_WALK', label: '敬遠', symbol: 'IB', category: 'walk', needsPositions: false, isOut: false, bases: 1, isPA: true, isAtBat: false, isHit: false, rbiAllowed: true, chargesError: false },
  HIT_BY_PITCH: { id: 'HIT_BY_PITCH', label: '死球', symbol: 'DB', category: 'walk', needsPositions: false, isOut: false, bases: 1, isPA: true, isAtBat: false, isHit: false, rbiAllowed: true, chargesError: false },

  // Sacrifices
  SACRIFICE_BUNT: { id: 'SACRIFICE_BUNT', label: '犠打', symbol: '□', category: 'sacrifice', needsPositions: true, isOut: true, bases: 0, isPA: true, isAtBat: false, isHit: false, rbiAllowed: true, chargesError: false },
  SACRIFICE_FLY: { id: 'SACRIFICE_FLY', label: '犠飛', symbol: '◇', batType: 'fly', category: 'sacrifice', needsPositions: true, isOut: true, bases: 0, isPA: true, isAtBat: false, isHit: false, rbiAllowed: true, chargesError: false },

  // Others
  ERROR: { id: 'ERROR', label: 'エラー', symbol: 'E', category: 'other', needsPositions: true, isOut: false, bases: 1, isPA: true, isAtBat: true, isHit: false, rbiAllowed: true, chargesError: true },
  FIELDERS_CHOICE: { id: 'FIELDERS_CHOICE', label: '野選(FC)', symbol: 'FC', category: 'other', needsPositions: true, isOut: false, bases: 1, isPA: true, isAtBat: true, isHit: false, rbiAllowed: true, chargesError: false },
  STRIKEOUT_WILD: { id: 'STRIKEOUT_WILD', label: '振り逃げ', symbol: 'K', category: 'other', needsPositions: false, isOut: false, bases: 1, isPA: true, isAtBat: true, isHit: false, rbiAllowed: false, chargesError: false },
  INTERFERENCE: { id: 'INTERFERENCE', label: '打撃妨害', symbol: 'INT', category: 'other', needsPositions: false, isOut: false, bases: 1, isPA: true, isAtBat: false, isHit: false, rbiAllowed: true, chargesError: true },

  // Not a plate appearance: runner placed on base at the start of a tiebreak inning.
  TIEBREAK_RUNNER: { id: 'TIEBREAK_RUNNER', label: 'タイブレークの走者', symbol: 'TB', category: 'runner', needsPositions: false, isOut: false, bases: 1, isPA: false, isAtBat: false, isHit: false, rbiAllowed: false, chargesError: false },
};

// Events that happen to the runner whose cell they are stored in
// (not to the batter at the plate when they happened).
//   isOut         the runner is out (counts as one out for the half-inning)
//   advances      the runner moves up at least one base
//   chargesError  one error is charged to the fielding team
export const RUNNER_EVENTS = {
  STOLEN_BASE: { id: 'STOLEN_BASE', label: '盗塁', symbol: 'S', color: '#1565C0', isOut: false, advances: true, chargesError: false },
  WILD_PITCH: { id: 'WILD_PITCH', label: '暴投', symbol: 'WP', color: '#E65100', isOut: false, advances: true, chargesError: false },
  PASSED_BALL: { id: 'PASSED_BALL', label: '捕逸', symbol: 'PB', color: '#E65100', isOut: false, advances: true, chargesError: false },
  BALK: { id: 'BALK', label: 'ボーク', symbol: 'BK', color: '#E65100', isOut: false, advances: true, chargesError: false },
  ADVANCE_ON_ERROR: { id: 'ADVANCE_ON_ERROR', label: '失策で進塁', symbol: 'E', color: '#6A1B9A', isOut: false, advances: true, chargesError: true },
  CAUGHT_STEALING: { id: 'CAUGHT_STEALING', label: '盗塁死', symbol: 'CS', color: '#D32F2F', isOut: true, advances: false, chargesError: false },
  PICKOFF: { id: 'PICKOFF', label: '牽制死', symbol: 'PO', color: '#D32F2F', isOut: true, advances: false, chargesError: false },
  RUNNER_OUT: { id: 'RUNNER_OUT', label: '走塁死（封殺・タッチアウト）', symbol: 'T.O', color: '#D32F2F', isOut: true, advances: false, chargesError: false },
};

export const HIT_TYPES = Object.values(RESULT_TYPES).filter(t => t.isHit).map(t => t.id);

export const MAX_INNINGS = 12;
export const DEFAULT_INNINGS = 7;
export const INNINGS_OPTIONS = [5, 6, 7, 9];
