// ============================================
// Data Model & State Management
// ============================================

const POSITIONS = {
  1: '投手', 2: '捕手', 3: '一塁手', 4: '二塁手', 5: '三塁手',
  6: '遊撃手', 7: '左翼手', 8: '中堅手', 9: '右翼手'
};

const POSITION_SHORT = {
  1: '投', 2: '捕', 3: '一', 4: '二', 5: '三',
  6: '遊', 7: '左', 8: '中', 9: '右'
};

const BAT_LABELS = { right: '右', left: '左', switch: '両' };

const RESULT_TYPES = {
  // Outs
  GROUNDOUT: { id: 'GROUNDOUT', label: 'ゴロ', symbol: 'ゴ', batType: 'ground', category: 'out', needsPositions: true, isOut: true },
  FLYOUT: { id: 'FLYOUT', label: 'フライ', symbol: '飛', batType: 'fly', category: 'out', needsPositions: true, isOut: true },
  LINEOUT: { id: 'LINEOUT', label: 'ライナー', symbol: '直', batType: 'liner', category: 'out', needsPositions: true, isOut: true },
  STRIKEOUT_SWING: { id: 'STRIKEOUT_SWING', label: '空振り三振', symbol: 'SO', category: 'out', needsPositions: false, isOut: true },
  STRIKEOUT_LOOK: { id: 'STRIKEOUT_LOOK', label: '見逃し三振', symbol: '.SO', category: 'out', needsPositions: false, isOut: true },
  DOUBLE_PLAY: { id: 'DOUBLE_PLAY', label: '併殺打', symbol: 'DP', batType: 'ground', category: 'out', needsPositions: true, isOut: true, outsCount: 2 },
  INFIELD_FLY: { id: 'INFIELD_FLY', label: 'インフィールドフライ', symbol: 'IF', batType: 'fly', category: 'out', needsPositions: true, isOut: true },

  // Hits
  SINGLE: { id: 'SINGLE', label: '単打', symbol: '━', category: 'hit', needsPositions: true, isOut: false, bases: 1 },
  DOUBLE: { id: 'DOUBLE', label: '二塁打', symbol: '═', category: 'hit', needsPositions: true, isOut: false, bases: 2 },
  TRIPLE: { id: 'TRIPLE', label: '三塁打', symbol: '≡', category: 'hit', needsPositions: true, isOut: false, bases: 3 },
  HOMERUN: { id: 'HOMERUN', label: '本塁打', symbol: 'HR', category: 'hit', needsPositions: false, isOut: false, bases: 4 },

  // Walks
  WALK: { id: 'WALK', label: '四球', symbol: 'B', category: 'walk', needsPositions: false, isOut: false, bases: 1 },
  HIT_BY_PITCH: { id: 'HIT_BY_PITCH', label: '死球', symbol: 'DB', category: 'walk', needsPositions: false, isOut: false, bases: 1 },
  SACRIFICE_BUNT: { id: 'SACRIFICE_BUNT', label: '犠打', symbol: '□', category: 'walk', needsPositions: true, isOut: true },
  SACRIFICE_FLY: { id: 'SACRIFICE_FLY', label: '犠飛', symbol: '◇', category: 'walk', needsPositions: true, isOut: true },

  // Others
  ERROR: { id: 'ERROR', label: 'エラー', symbol: 'E', category: 'other', needsPositions: true, isOut: false, bases: 1 },
  FIELDERS_CHOICE: { id: 'FIELDERS_CHOICE', label: 'FC', symbol: 'FC', category: 'other', needsPositions: true, isOut: false, bases: 1 },
  INTERFERENCE: { id: 'INTERFERENCE', label: '打撃妨害', symbol: 'INT', category: 'other', needsPositions: false, isOut: false, bases: 1 },
};

const RUNNER_EVENTS = {
  STOLEN_BASE:    { id: 'STOLEN_BASE', label: '盗塁', symbol: 'S', color: '#1565C0' },
  CAUGHT_STEALING:{ id: 'CAUGHT_STEALING', label: '盗塁死', symbol: 'CS', color: '#D32F2F' },
  WILD_PITCH:     { id: 'WILD_PITCH', label: '暴投', symbol: 'WP', color: '#E65100' },
  PASSED_BALL:    { id: 'PASSED_BALL', label: '捕逸', symbol: 'PB', color: '#E65100' },
  BALK:           { id: 'BALK', label: 'ボーク', symbol: 'BK', color: '#E65100' },
  RUNNER_OUT:     { id: 'RUNNER_OUT', label: '走塁死', symbol: 'T.O', color: '#D32F2F' },
};

class TeamMember {
  constructor(data = {}) {
    this.id = data.id || crypto.randomUUID();
    this.name = data.name || '';
    this.number = data.number ?? '';
    this.bat = data.bat || 'right';
    this.position = data.position || '';
  }
}

class AtBatResult {
  constructor(data = {}) {
    this.resultType = data.resultType || null; // RESULT_TYPES key
    this.positions = data.positions || ''; // e.g. "6-3"
    this.rbi = data.rbi || 0;
    this.basesReached = data.basesReached || 0; // 0=out, 1=1B, 2=2B, 3=3B, 4=scored
    this.outNumber = data.outNumber || null; // which out in the inning (1, 2, 3)
    this.note = data.note || '';
    // Runner events during this at-bat: [{type: 'WILD_PITCH', description: ''}]
    this.runnerEvents = data.runnerEvents || [];
  }
}

class GameData {
  constructor() {
    this.id = crypto.randomUUID();
    this.date = '';
    this.teamFirst = '';
    this.teamSecond = '';
    this.field = '';
    this.innings = 7;
    this.useDH = false;
    this.startTime = '';  // e.g. "08:58"
    this.endTime = '';    // e.g. "10:23"
    this.tiebreakerInning = 0; // 0 = no tiebreaker, else inning number
    this.tiebreakerRunners = 'none'; // 'none', '1B', '1B2B', '2B'
    this.gameResult = ''; // '', 'win', 'loss', 'draw', 'lottery_win', 'lottery_loss'
    this.lineupFirst = []; // array of {name, number, position, bat}
    this.lineupSecond = [];
    this.pitcherFirst = '';
    this.pitcherSecond = '';
    // atBats[teamKey][inning][batterIndex] = AtBatResult
    this.atBats = { first: {}, second: {} };
    this.currentInning = 1;
    this.currentHalf = 'top'; // 'top' = first team batting, 'bottom' = second team
    this.outsInInning = 0;
    // substitutions: [{type: 'PH'|'PR'|'DEF', teamKey, inning, batterIdx, newPlayer: {name, number, position}, oldPlayer: {name, number, position}}]
    this.substitutions = [];
  }

  addSubstitution(sub) {
    this.substitutions.push(sub);
    // Update lineup
    const lineup = this.getLineup(sub.teamKey);
    if (lineup[sub.batterIdx]) {
      lineup[sub.batterIdx].name = sub.newPlayer.name;
      lineup[sub.batterIdx].number = sub.newPlayer.number || '';
      if (sub.newPlayer.position) {
        lineup[sub.batterIdx].position = sub.newPlayer.position;
      }
    }
  }

  getSubstitutionsForSlot(teamKey, batterIdx) {
    return this.substitutions.filter(s => s.teamKey === teamKey && s.batterIdx === batterIdx);
  }

  getTeamName(teamKey) {
    return teamKey === 'first' ? this.teamFirst : this.teamSecond;
  }

  getBattingTeam() {
    return this.currentHalf === 'top' ? 'first' : 'second';
  }

  getLineup(teamKey) {
    return teamKey === 'first' ? this.lineupFirst : this.lineupSecond;
  }

  getAtBat(teamKey, inning, batterIdx) {
    if (!this.atBats[teamKey][inning]) return null;
    return this.atBats[teamKey][inning][batterIdx] || null;
  }

  setAtBat(teamKey, inning, batterIdx, result) {
    if (!this.atBats[teamKey][inning]) {
      this.atBats[teamKey][inning] = {};
    }
    this.atBats[teamKey][inning][batterIdx] = result;
  }

  getInningRuns(teamKey, inning) {
    const inningData = this.atBats[teamKey][inning];
    if (!inningData) return 0;
    let runs = 0;
    for (const batResult of Object.values(inningData)) {
      if (batResult && batResult.basesReached === 4) runs++;
      if (batResult) runs += (batResult.rbi || 0);
    }
    // Simplified: count RBIs
    return runs;
  }

  getTotalRuns(teamKey) {
    let total = 0;
    for (let i = 1; i <= 12; i++) {
      total += this.getInningRuns(teamKey, i);
    }
    return total;
  }

  getHitCount(teamKey) {
    let count = 0;
    const hits = ['SINGLE', 'DOUBLE', 'TRIPLE', 'HOMERUN'];
    for (const inningData of Object.values(this.atBats[teamKey])) {
      for (const batResult of Object.values(inningData)) {
        if (batResult && hits.includes(batResult.resultType)) count++;
      }
    }
    return count;
  }

  getErrorCount(teamKey) {
    // Errors are counted against the fielding team
    const oppKey = teamKey === 'first' ? 'second' : 'first';
    let count = 0;
    for (const inningData of Object.values(this.atBats[oppKey])) {
      for (const batResult of Object.values(inningData)) {
        if (batResult && batResult.resultType === 'ERROR') count++;
      }
    }
    return count;
  }
}

// ============================================
// Storage
// ============================================

const STORAGE_KEYS = {
  MEMBERS: 'waseda-score-members',
  GAME: 'waseda-score-current-game',
};

function saveMembers(members) {
  localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(members));
}

function loadMembers() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.MEMBERS);
    if (!data) return [];
    return JSON.parse(data).map(m => new TeamMember(m));
  } catch {
    return [];
  }
}

function saveGame(game) {
  localStorage.setItem(STORAGE_KEYS.GAME, JSON.stringify(game));
}

function loadGame() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.GAME);
    if (!data) return null;
    const parsed = JSON.parse(data);
    const game = new GameData();
    Object.assign(game, parsed);
    return game;
  } catch {
    return null;
  }
}

function clearGame() {
  localStorage.removeItem(STORAGE_KEYS.GAME);
}

export {
  POSITIONS, POSITION_SHORT, BAT_LABELS, RESULT_TYPES, RUNNER_EVENTS,
  TeamMember, AtBatResult, GameData,
  saveMembers, loadMembers, saveGame, loadGame, clearGame
};
