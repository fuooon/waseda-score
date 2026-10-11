// Builders for scoring tests: plain game objects shaped like a saved GameData.

export const T = type => ({ type });

export function cell(spec = {}) {
  return {
    resultType: null, positions: '', rbi: 0, basesReached: 0, outNumber: null, runnerEvents: [], note: '',
    ...spec,
    runnerEvents: (spec.runnerEvents || []).map(e => ({ ...e })),
  };
}

export function cells(specs) {
  const out = {};
  for (const [key, spec] of Object.entries(specs)) out[key] = cell(spec);
  return out;
}

export function lineup(prefix, n = 9) {
  return Array.from({ length: n }, (_, i) => ({
    name: `${prefix}${i + 1}`, number: String(i + 1), position: String(i + 1), bat: 'right', memberId: '',
  }));
}

export function makeGame(overrides = {}) {
  return {
    id: 'test-game', date: '2026-10-11', teamFirst: '先攻', teamSecond: '後攻', field: '',
    innings: 7, useDH: false, startTime: '', endTime: '',
    tiebreakerInning: 0, tiebreakerRunners: 'none', gameResult: '', status: 'in_progress', endReason: '',
    lineupFirst: lineup('A'), lineupSecond: lineup('B'), pitcherFirst: '', pitcherSecond: '',
    atBats: { first: {}, second: {} }, currentInning: 1, currentHalf: 'top',
    substitutions: [], lineupDone: true, version: 2,
    ...overrides,
  };
}

// Key of the i-th plate appearance (0-based) of a half-inning that starts at leadoff L.
export function keyAt(L, i, N = 9) {
  return String(((L + i) % N) + N * Math.floor(i / N));
}

// `walks` walks (runners forced along, nobody scores), then three strikeouts.
export function fillerSpecs(L, walks = 0, N = 9) {
  const out = {};
  for (let i = 0; i < walks; i++) out[keyAt(L, i, N)] = { resultType: 'WALK', basesReached: walks - i };
  for (let j = 0; j < 3; j++) out[keyAt(L, walks + j, N)] = { resultType: 'STRIKEOUT_SWING', outNumber: j + 1 };
  return out;
}

// `runs` solo home runs, then three strikeouts.
export function scoringSpecs(L, runs, N = 9) {
  const out = {};
  for (let i = 0; i < runs; i++) out[keyAt(L, i, N)] = { resultType: 'HOMERUN', positions: '7', rbi: 1, basesReached: 4 };
  for (let j = 0; j < 3; j++) out[keyAt(L, runs + j, N)] = { resultType: 'STRIKEOUT_SWING', outNumber: j + 1 };
  return out;
}

// Walks per filler inning so that the next leadoff becomes L (each filler advances 3..6 batters).
export function fillerPlan(L, N = 9) {
  if (L % N === 0) return [];
  for (let k = 1; k < 10; k++) {
    for (let total = 3 * k; total <= 6 * k; total++) {
      if (total % N !== L % N) continue;
      const plan = [];
      let rest = total - 3 * k;
      for (let i = 0; i < k; i++) {
        const w = Math.min(3, rest);
        plan.push(w);
        rest -= w;
      }
      return plan;
    }
  }
  throw new Error(`no filler plan for L=${L}`);
}

// A game where `teamKey` bats `specs` with leadoff L; filler half-innings come first.
// The other team has no data. Returns { game, inning }.
export function gameWithHalf({ L = 0, cells: specs, teamKey = 'first', N = 9, ...overrides }) {
  const game = makeGame(overrides);
  let lead = 0;
  let inning = 1;
  for (const walks of fillerPlan(L, N)) {
    game.atBats[teamKey][inning] = cells(fillerSpecs(lead, walks, N));
    lead = (lead + 3 + walks) % N;
    inning++;
  }
  game.atBats[teamKey][inning] = cells(specs);
  return { game, inning };
}

// Whole game from runs per inning, e.g. { first: [0,1,0], second: [1,0,null] }
// (null = no data). custom[teamKey][inning] = L => specs overrides an inning.
export function buildGame({ first = [], second = [], custom = {}, ...overrides } = {}) {
  const game = makeGame(overrides);
  const N = 9;
  for (const [teamKey, runsList] of [['first', first], ['second', second]]) {
    let L = 0;
    const innings = Math.max(runsList.length, ...Object.keys(custom[teamKey] || {}).map(Number), 0);
    for (let inning = 1; inning <= innings; inning++) {
      const make = custom[teamKey]?.[inning];
      const runs = runsList[inning - 1];
      let specs;
      if (make) specs = make(L);
      else if (runs === null || runs === undefined) continue;
      else specs = scoringSpecs(L, runs, N);
      game.atBats[teamKey][inning] = cells(specs);
      const pa = Object.keys(specs).filter(k => !k.startsWith('tb')).length;
      L = (L + pa) % N;
    }
  }
  return game;
}

export function ids(issues) {
  return [...new Set(issues.map(i => i.id))].sort();
}
