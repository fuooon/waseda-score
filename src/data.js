// ============================================
// Data Model & State Management
// ============================================

import {
  POSITIONS, POSITION_SHORT, BAT_LABELS, RESULT_TYPES, RUNNER_EVENTS, DEFAULT_INNINGS
} from './rules.js';
import { generateId } from './util.js';
import { halfInning, teamTotals, normalizeGame } from './scoring.js';

class TeamMember {
  constructor(data = {}) {
    this.id = data.id || generateId();
    this.name = data.name || '';
    this.number = data.number ?? '';
    this.bat = data.bat || 'right';
    this.position = data.position || '';
  }
}

class Team {
  constructor(data = {}) {
    this.id = data.id || generateId();
    this.name = data.name || '新しいチーム';
    this.members = (data.members || []).map(m => new TeamMember(m));
  }
}

// One cell of the scoresheet: everything one player did in one half-inning.
// Cells are usually built by scoring.recordPlateAppearance (which sanitizes them);
// this class only gives the shape and defaults.
class AtBatResult {
  constructor(data = {}) {
    this.resultType = data.resultType || null; // RESULT_TYPES key
    this.positions = data.positions || ''; // fielders, e.g. "6-3"
    this.rbi = data.rbi ?? 0;
    // Furthest base this player SAFELY reached: 1..3 on base, 4 = scored.
    // 0 for batter outs. A runner put out later keeps his last safe base and
    // gets an out runner event (CAUGHT_STEALING / PICKOFF / RUNNER_OUT).
    this.basesReached = data.basesReached ?? 0;
    this.outNumber = data.outNumber ?? null; // display "何アウト目" (1..3), kept gap-free by the engine
    this.note = data.note || '';
    // What happened to THIS player as a runner: [{ type: 'STOLEN_BASE', base?: 2 }]
    this.runnerEvents = Array.isArray(data.runnerEvents) ? data.runnerEvents.map(e => ({ ...e })) : [];
    if (data.batterIdx !== undefined) this.batterIdx = data.batterIdx; // placed tiebreak runners
  }
}

class GameData {
  constructor() {
    this.id = generateId();
    this.date = '';
    this.teamFirst = '';
    this.teamSecond = '';
    this.field = '';
    this.innings = DEFAULT_INNINGS;
    this.useDH = false;
    this.startTime = '';  // e.g. "08:58"
    this.endTime = '';    // e.g. "10:23"
    this.tiebreakerInning = 0; // 0 = no tiebreaker, else inning number
    this.tiebreakerRunners = 'none'; // 'none', '1B', '1B2B', '2B'
    this.gameResult = ''; // '', 'win', 'loss', 'draw', 'lottery_win', 'lottery_loss'
    this.status = 'in_progress'; // 'in_progress' | 'final'
    this.endReason = ''; // '' | 'regulation' | 'walkoff' | 'called' | 'time'
    this.lineupFirst = []; // array of {name, number, position, bat, memberId}
    this.lineupSecond = [];
    this.pitcherFirst = '';
    this.pitcherSecond = '';
    // atBats[teamKey][inning][key] = cell; key = String(batterIdx + N * lap) or 'tb' + batterIdx
    this.atBats = { first: {}, second: {} };
    // The half-inning the user is viewing / recording (a cursor, not game state).
    this.currentInning = 1;
    this.currentHalf = 'top'; // 'top' = first team batting, 'bottom' = second team
    // substitutions: [{type: 'PH'|'PR'|'DEF', teamKey, inning, batterIdx, newPlayer: {name, number, position}, oldPlayer: {name, number, position}}]
    this.substitutions = [];
    this.lineupDone = false;
    this.version = 2;
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

  // key: string or number (batterIdx + N * lap, or 'tb' + batterIdx)
  getAtBat(teamKey, inning, key) {
    const half = this.atBats?.[teamKey]?.[inning];
    if (!half) return null;
    return half[String(key)] || null;
  }

  setAtBat(teamKey, inning, key, result) {
    if (!this.atBats[teamKey]) this.atBats[teamKey] = {};
    if (!this.atBats[teamKey][inning]) {
      this.atBats[teamKey][inning] = {};
    }
    if (result === null || result === undefined) {
      delete this.atBats[teamKey][inning][String(key)];
    } else {
      this.atBats[teamKey][inning][String(key)] = result;
    }
  }

  // Runs = players who scored in that half-inning (RBIs are never added).
  getInningRuns(teamKey, inning) {
    return halfInning(this, teamKey, inning).runs;
  }

  getTotalRuns(teamKey) {
    return teamTotals(this, teamKey).runs;
  }

  getHitCount(teamKey) {
    return teamTotals(this, teamKey).hits;
  }

  // Errors committed by this team while fielding.
  getErrorCount(teamKey) {
    return teamTotals(this, teamKey).errors;
  }
}

// ============================================
// Storage
// ============================================

const STORAGE_KEYS = {
  MEMBERS: 'waseda-score-members',
  TEAMS: 'waseda-score-teams',
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

function saveTeams(teams) {
  localStorage.setItem(STORAGE_KEYS.TEAMS, JSON.stringify(teams));
}

function loadTeams() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.TEAMS);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return parsed.map(t => new Team(t));
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const game = new GameData();
    // Own keys only: a saved "__proto__" key would otherwise replace the prototype
    // (Object.assign uses the setter) and strip the GameData methods.
    for (const key of Object.keys(parsed)) {
      if (key !== '__proto__') game[key] = parsed[key];
    }
    // Fields that tell normalizeGame how old the save is must come from the save,
    // not from the constructor defaults.
    game.version = parsed.version ?? 1;
    if (typeof parsed.lineupDone !== 'boolean') delete game.lineupDone;
    return normalizeGame(game);
  } catch {
    return null;
  }
}

function clearGame() {
  localStorage.removeItem(STORAGE_KEYS.GAME);
}

export {
  POSITIONS, POSITION_SHORT, BAT_LABELS, RESULT_TYPES, RUNNER_EVENTS,
  TeamMember, Team, AtBatResult, GameData,
  saveMembers, loadMembers, saveTeams, loadTeams, saveGame, loadGame, clearGame
};
