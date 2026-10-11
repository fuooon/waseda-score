import { describe, it, expect } from 'vitest';
import { RESULT_TYPES, RUNNER_EVENTS } from '../src/rules.js';
import { renderCellHTML, renderLegendSample, SAMPLE_POSITIONS } from '../src/cell-render.js';
import { helpHTML } from '../src/help.js';
import { describeResult } from '../src/describe.js';

const T = (type, base) => (base ? { type, base } : { type });
const XSS = '<img src=x onerror=alert(1)>';
const ALLOWED_TAGS = new Set(['div', 'span', 'svg', 'polygon']);

function cellFor(resultType, extra = {}) {
  const rt = RESULT_TYPES[resultType];
  return {
    resultType,
    positions: SAMPLE_POSITIONS[resultType] || '',
    rbi: 0,
    basesReached: rt.isOut ? 0 : rt.bases,
    outNumber: rt.isOut ? 1 : null,
    runnerEvents: [],
    ...extra,
  };
}

function tagsOf(html) {
  return [...html.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9-]*)/g)].map(m => m[1].toLowerCase());
}

function clean(html) {
  expect(typeof html).toBe('string');
  expect(html).not.toMatch(/undefined|NaN|\[object/);
  for (const tag of tagsOf(html)) expect(ALLOWED_TAGS.has(tag)).toBe(true);
  expect(html).not.toMatch(/onerror|javascript:/i);
}

// Text content without tags (to check what the reader sees)
function textOf(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
}

describe('renderCellHTML: every result type', () => {
  for (const id of Object.keys(RESULT_TYPES)) {
    it(`draws ${id}`, () => {
      const html = renderCellHTML(cellFor(id));
      clean(html);
      expect(html).toContain('class="cell-content');
      expect(html).toContain('diamond-graphic');
      expect(html).toContain('cell-result');
      expect(html).not.toContain('//');
    });
  }

  it('returns empty text for empty or unknown cells', () => {
    expect(renderCellHTML(null)).toBe('');
    expect(renderCellHTML(undefined)).toBe('');
    expect(renderCellHTML({})).toBe('');
    expect(renderCellHTML({ resultType: 'BOGUS', runnerEvents: [] })).toBe('');
    expect(renderCellHTML({ resultType: null, runnerEvents: [{ type: 'BOGUS' }] })).toBe('');
  });
});

describe('renderCellHTML: notation', () => {
  it('draws hit marks with the fielder number', () => {
    expect(renderCellHTML(cellFor('SINGLE'))).toContain('hit-mark hit-1');
    expect(renderCellHTML(cellFor('DOUBLE'))).toContain('hit-mark hit-2');
    expect(renderCellHTML(cellFor('TRIPLE'))).toContain('hit-mark hit-3');
    const hr = renderCellHTML(cellFor('HOMERUN'));
    expect(textOf(hr)).toContain('HR');
    expect(textOf(hr)).toContain('7');
    expect(hr).toContain('is-hit');
    // hit kept even without a fielder number
    expect(renderCellHTML(cellFor('SINGLE', { positions: '' }))).toContain('hit-mark hit-1');
    expect(textOf(renderCellHTML(cellFor('HOMERUN', { positions: '' })))).toContain('HR');
  });

  it('keeps the symbol together with the fielder numbers', () => {
    expect(textOf(renderCellHTML(cellFor('ERROR', { positions: '6' })))).toContain('E6');
    expect(textOf(renderCellHTML(cellFor('FIELDERS_CHOICE', { positions: '6' })))).toContain('FC6');
    expect(textOf(renderCellHTML(cellFor('INFIELD_FLY', { positions: '4' })))).toContain('IF4');
    const fc = textOf(renderCellHTML(cellFor('FIELDERS_CHOICE', { positions: '6-4' })));
    expect(fc).toContain('FC');
    expect(fc).toContain('6-4');
    const dp = textOf(renderCellHTML(cellFor('DOUBLE_PLAY', { positions: '6-4-3', outNumber: 2 })));
    expect(dp).toContain('DP');
    expect(dp).toContain('6-4-3');
    expect(dp).toContain('Ⅱ');
  });

  it('shows a symbol when the fielder number is missing', () => {
    expect(textOf(renderCellHTML(cellFor('ERROR', { positions: '' })))).toContain('E');
    expect(textOf(renderCellHTML(cellFor('DOUBLE_PLAY', { positions: '' })))).toContain('DP');
  });

  it('draws K and a mirrored K for strikeouts', () => {
    const swing = renderCellHTML(cellFor('STRIKEOUT_SWING'));
    const look = renderCellHTML(cellFor('STRIKEOUT_LOOK'));
    expect(swing).toContain('class="sym-k"');
    expect(swing).not.toContain('sym-mirror');
    expect(look).toContain('sym-k sym-mirror');
    expect(swing).toContain('Ⅰ');
  });

  it('draws 振り逃げ as K with the batter on first and no out number', () => {
    const html = renderCellHTML(cellFor('STRIKEOUT_WILD'));
    expect(html).toContain('sym-k');
    expect(html).toContain('振逃');
    expect(html).toMatch(/diamond-graphic b1"/);
    expect(html).not.toContain('out-number-text');
  });

  it('writes B, IB, DB and INT', () => {
    expect(textOf(renderCellHTML(cellFor('WALK')))).toBe('B');
    expect(textOf(renderCellHTML(cellFor('INTENTIONAL_WALK')))).toBe('IB');
    expect(textOf(renderCellHTML(cellFor('HIT_BY_PITCH')))).toBe('DB');
    expect(textOf(renderCellHTML(cellFor('INTERFERENCE')))).toBe('INT');
  });

  it('boxes sacrifice bunts (□) and draws a diamond around sacrifice flies (◇)', () => {
    const bunt = renderCellHTML(cellFor('SACRIFICE_BUNT'));
    expect(bunt).toContain('sac-bunt-wrap');
    expect(textOf(bunt)).toContain('1-3');
    const fly = renderCellHTML(cellFor('SACRIFICE_FLY', { rbi: 1 }));
    expect(fly).toContain('sac-fly-wrap');
    expect(fly).toContain('<polygon points="50,3 97,50 50,97 3,50"/>');
    expect(textOf(fly)).toContain('8');
    expect(renderCellHTML(cellFor('SACRIFICE_BUNT', { positions: '' }))).toContain('sac-bunt-wrap empty');
    expect(renderCellHTML(cellFor('SACRIFICE_FLY', { positions: '' }))).toContain('sac-fly-wrap empty');
  });

  it('marks ground, fly and liner trajectories on the first fielder', () => {
    expect(renderCellHTML(cellFor('GROUNDOUT'))).toContain('<span class="traj-mark traj-ground">6</span>-3');
    expect(renderCellHTML(cellFor('FLYOUT'))).toContain('<span class="traj-mark traj-fly">8</span>');
    expect(renderCellHTML(cellFor('LINEOUT'))).toContain('<span class="traj-mark traj-liner">5</span>');
    expect(renderCellHTML(cellFor('GROUNDOUT'))).toContain('has-traj-ground');
  });

  it('draws the base path, the run mark and the out number', () => {
    const scored = renderCellHTML(cellFor('SINGLE', { basesReached: 4 }));
    expect(scored).toMatch(/diamond-graphic b1 b2 b3 b4 hr"/);
    expect(scored).toContain('state-scored');
    expect(scored).not.toContain('out-number-text');
    const onBase = renderCellHTML(cellFor('WALK', { basesReached: 2 }));
    expect(onBase).toMatch(/diamond-graphic b1 b2"/);
    expect(onBase).toContain('state-onbase');
    for (const n of [1, 2, 3]) {
      const out = renderCellHTML(cellFor('FLYOUT', { outNumber: n }));
      expect(out).toContain(`<div class="out-number-text">${['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][n]}</div>`);
      expect(out).toContain('state-out');
    }
    expect(renderCellHTML(cellFor('FLYOUT', { outNumber: 7 }))).not.toContain('out-number-text');
  });

  it('never draws the inning-end mark itself', () => {
    const html = renderCellHTML(cellFor('GROUNDOUT', { outNumber: 3 }));
    expect(html).not.toContain('//');
    expect(html).not.toContain('inning-end');
  });

  it('separates the description title from export output', () => {
    const cell = cellFor('GROUNDOUT');
    expect(renderCellHTML(cell)).toContain('title="ショートゴロ（6-3）でアウト【1アウト目】"');
    expect(renderCellHTML(cell, { forExport: true })).not.toContain('title=');
  });
});

describe('renderCellHTML: runner events', () => {
  it('draws every runner event as its own tag', () => {
    for (const id of Object.keys(RUNNER_EVENTS)) {
      const ev = RUNNER_EVENTS[id];
      const html = renderCellHTML(cellFor('SINGLE', {
        basesReached: ev.isOut ? 1 : 2, outNumber: ev.isOut ? 2 : null, runnerEvents: [T(id)],
      }));
      clean(html);
      expect(html).toContain(`>${ev.symbol}</span>`);
      expect(html).toContain('cell-event-tag');
      if (ev.isOut) {
        expect(html).toContain('ev-out');
        expect(html).toContain('Ⅱ');
        expect(html).toContain('state-out');
      }
    }
  });

  it('puts tags in the area of the base they happened at', () => {
    const html = renderCellHTML(cellFor('SINGLE', {
      basesReached: 4, runnerEvents: [T('STOLEN_BASE', 2), T('WILD_PITCH', 3), T('PASSED_BALL', 4)],
    }));
    expect(html).toMatch(/ev-q2">[^]*?>S<\/span><\/div>/);
    expect(html).toMatch(/ev-q3">[^]*?>WP<\/span><\/div>/);
    expect(html).toMatch(/ev-q4">[^]*?>PB<\/span><\/div>/);
    // separate tags, never glued together
    expect(html.match(/class="cell-event-tag"/g)).toHaveLength(3);
  });

  it('infers the base from the order of events when it is missing', () => {
    const html = renderCellHTML(cellFor('SINGLE', {
      basesReached: 3, runnerEvents: [T('STOLEN_BASE'), T('WILD_PITCH')],
    }));
    expect(html).toMatch(/ev-q2">[^]*?>S</);
    expect(html).toMatch(/ev-q3">[^]*?>WP</);
    const cs = renderCellHTML(cellFor('WALK', { basesReached: 1, outNumber: 1, runnerEvents: [T('CAUGHT_STEALING')] }));
    expect(cs).toMatch(/ev-q2">[^]*?>CS</);
    const po = renderCellHTML(cellFor('WALK', { basesReached: 1, outNumber: 1, runnerEvents: [T('PICKOFF')] }));
    expect(po).toMatch(/cr-events">[^]*?>PO</);
  });

  it('draws a runner-only cell', () => {
    const html = renderCellHTML({ resultType: null, basesReached: 2, runnerEvents: [T('STOLEN_BASE', 2)] });
    clean(html);
    expect(html).toContain('>S</span>');
  });
});

describe('renderCellHTML: tiebreak placed runner', () => {
  it('draws TB and the unrun part of the path dashed', () => {
    const html = renderCellHTML({ resultType: 'TIEBREAK_RUNNER', basesReached: 4, runnerEvents: [], batterIdx: 3 }, { isPlaced: true, startBase: 2 });
    clean(html);
    expect(html).toContain('tb-tag');
    expect(html).toContain('is-placed');
    expect(html).toMatch(/diamond-graphic b1 b2 b3 b4 p1 p2 hr"/);
    const onSecond = renderCellHTML({ resultType: 'TIEBREAK_RUNNER', basesReached: 2, runnerEvents: [] });
    expect(onSecond).toMatch(/diamond-graphic b1 b2 p1 p2"/);
    expect(onSecond).not.toContain('out-number-text');
  });
});

describe('renderCellHTML: escaping', () => {
  it('escapes markup typed into the positions field', () => {
    for (const id of Object.keys(RESULT_TYPES)) {
      const html = renderCellHTML(cellFor(id, { positions: XSS }));
      clean(html);
      expect(html).not.toContain('<img');
    }
    const html = renderCellHTML(cellFor('GROUNDOUT', { positions: '"><script>alert(1)</script>' }));
    clean(html);
    expect(html).not.toContain('<script');
  });

  it('shortens long free text', () => {
    const html = renderCellHTML(cellFor('GROUNDOUT', { positions: 'abcdefghijkl' }));
    expect(textOf(html)).toContain('abcdef…');
  });

  it('survives broken field values', () => {
    for (const id of Object.keys(RESULT_TYPES)) {
      const html = renderCellHTML({ resultType: id, positions: 123, rbi: 'x', basesReached: 'x', outNumber: NaN, runnerEvents: 'x' });
      clean(html);
    }
  });
});

describe('renderLegendSample', () => {
  it('draws a sample for every result type', () => {
    for (const id of Object.keys(RESULT_TYPES)) {
      const html = renderLegendSample(id);
      clean(html);
      expect(html).toContain('class="legend-cell"');
      expect(html).toContain('cell-content');
      expect(html).not.toContain('title=');
    }
  });

  it('accepts options for events, out numbers and the inning-end mark', () => {
    const html = renderLegendSample('GROUNDOUT', { outNumber: 3, inningEnd: true });
    expect(html).toContain('legend-cell inning-end');
    expect(html).toContain('Ⅲ');
    const ev = renderLegendSample('SINGLE', { basesReached: 2, runnerEvents: [T('STOLEN_BASE', 2)] });
    expect(ev).toContain('>S</span>');
    expect(renderLegendSample(null, { cell: { resultType: 'WALK', basesReached: 4 } })).toContain('hr');
    expect(renderLegendSample('BOGUS')).toBe('');
  });
});

describe('help guide (generated from the same definitions)', () => {
  const html = helpHTML();

  it('lists every result type with its sample and example sentence', () => {
    for (const rt of Object.values(RESULT_TYPES)) {
      expect(html).toContain(rt.label);
      if (rt.id !== 'TIEBREAK_RUNNER') {
        expect(html).toContain('例: ' + describeResult(rt.id, SAMPLE_POSITIONS[rt.id] || ''));
      }
    }
    // one sample cell per result type at least
    expect((html.match(/class="legend-cell/g) || []).length).toBeGreaterThanOrEqual(Object.keys(RESULT_TYPES).length);
  });

  it('lists every runner event', () => {
    for (const ev of Object.values(RUNNER_EVENTS)) {
      expect(html).toContain(`>${ev.symbol}</span>${ev.label}`);
    }
  });

  it('explains out numbers, runs and the inning-end mark', () => {
    expect(html).toContain('legend-cell inning-end');
    expect(html).toContain('得点 ＋ 残塁 ＋ アウト');
    expect(html).toContain('記録チェック');
  });

  it('has no stray values or old base letters', () => {
    expect(html).not.toMatch(/undefined|NaN|\[object/);
    expect(html).not.toMatch(/>[A-D]<\/span><span>[一二三本]塁/);
    expect(html).not.toMatch(/onclick=/);
  });
});

// ============================================
// Verifier cases
// ============================================

describe('renderCellHTML: runner journeys', () => {
  it('single → stolen base → scored', () => {
    const html = renderCellHTML({ resultType: 'SINGLE', positions: '7', basesReached: 4, runnerEvents: [T('STOLEN_BASE', 2)] });
    expect(html).toMatch(/diamond-graphic b1 b2 b3 b4 hr"/);
    expect(html).toMatch(/ev-q2">[^]*?>S<\/span><\/div>/);
    expect(html).toContain('hit-mark hit-1');
    expect(html).toContain('state-scored');
    expect(html).not.toContain('out-number-text');
  });

  it('walk, then forced out at second', () => {
    const html = renderCellHTML({ resultType: 'WALK', basesReached: 1, outNumber: 2, runnerEvents: [T('RUNNER_OUT', 2)] });
    expect(html).toMatch(/diamond-graphic b1"/);
    expect(html).toMatch(/ev-q2">[^]*?ev-out[^]*?>T\.O<\/span><\/div>/);
    expect(html).toContain('<div class="out-number-text">Ⅱ</div>');
    expect(html).toContain('state-out');
  });

  it('home run: full path, run mark, HR above the direction', () => {
    const html = renderCellHTML({ resultType: 'HOMERUN', positions: '8', rbi: 3, basesReached: 4 });
    expect(html).toMatch(/diamond-graphic b1 b2 b3 b4 hr"/);
    expect(textOf(html)).toBe('HR8');
    expect(html).toContain('is-hit');
  });

  it('double play: batter cell (DP + path + out number) and runner cell (T.O)', () => {
    const batter = renderCellHTML({ resultType: 'DOUBLE_PLAY', positions: '6-4-3', outNumber: 3 });
    expect(textOf(batter)).toBe('Ⅲ' + 'DP6-4-3');
    expect(batter).toMatch(/diamond-graphic"/);
    const runner = renderCellHTML({ resultType: 'SINGLE', positions: '8', basesReached: 1, outNumber: 2, runnerEvents: [T('RUNNER_OUT')] });
    expect(runner).toMatch(/ev-q2">[^]*?>T\.O</);
    expect(runner).toContain('Ⅱ');
  });

  it('caught stealing for the 3rd out', () => {
    const html = renderCellHTML({ resultType: 'SINGLE', positions: '7', basesReached: 1, outNumber: 3, runnerEvents: [T('CAUGHT_STEALING')] });
    expect(html).toMatch(/ev-q2">[^]*?>CS</);
    expect(html).toContain('Ⅲ');
    expect(html).toContain('state-out');
  });

  it('places an out without a base after the last base reached safely', () => {
    // reached third on later hits, then caught stealing home
    const home = renderCellHTML({ resultType: 'SINGLE', positions: '9', basesReached: 3, outNumber: 1, runnerEvents: [T('CAUGHT_STEALING')] });
    expect(home).toMatch(/ev-q4">[^]*?>CS</);
    // picked off at second after a double
    const po = renderCellHTML({ resultType: 'DOUBLE', positions: '8', basesReached: 2, outNumber: 1, runnerEvents: [T('PICKOFF')] });
    expect(po).toMatch(/ev-q2">[^]*?>PO</);
    // forced out at third after moving to second
    const to = renderCellHTML({ resultType: 'WALK', basesReached: 2, outNumber: 2, runnerEvents: [T('RUNNER_OUT')] });
    expect(to).toMatch(/ev-q3">[^]*?>T\.O</);
  });

  it('placed tiebreak runner who scored: dashed unrun path, TB tag, run mark', () => {
    const html = renderCellHTML({ resultType: 'TIEBREAK_RUNNER', basesReached: 4, runnerEvents: [] }, { isPlaced: true, startBase: 2 });
    expect(html).toMatch(/diamond-graphic b1 b2 b3 b4 p1 p2 hr"/);
    expect(html).toContain('state-scored');
    expect(html).toContain('title="タイブレークの置きランナー（二塁） → 得点"');
    const fromFirst = renderCellHTML({ resultType: 'TIEBREAK_RUNNER', basesReached: 4, runnerEvents: [T('WILD_PITCH', 2)] }, { isPlaced: true, startBase: 1 });
    expect(fromFirst).toMatch(/diamond-graphic b1 b2 b3 b4 p1 hr"/);
    expect(fromFirst).toMatch(/ev-q2">[^]*?>WP</);
  });
});

describe('renderCellHTML: fielder numbers and sizes', () => {
  it('normalises fielder numbers typed without dashes or in full width', () => {
    expect(textOf(renderCellHTML(cellFor('GROUNDOUT', { positions: '63' })))).toContain('6-3');
    expect(textOf(renderCellHTML(cellFor('DOUBLE_PLAY', { positions: '６４３' })))).toContain('6-4-3');
  });

  it('picks a smaller size for longer paths and wide free text', () => {
    expect(renderCellHTML(cellFor('FLYOUT', { positions: '8' }))).toContain('cell-result fs-l');
    expect(renderCellHTML(cellFor('GROUNDOUT', { positions: '6-3' }))).toContain('cell-result fs-m');
    expect(renderCellHTML(cellFor('GROUNDOUT', { positions: '6-4-3' }))).toContain('cell-result fs-s');
    expect(renderCellHTML(cellFor('GROUNDOUT', { positions: '1-6-4-3' }))).toContain('cell-result fs-xs');
    // 3 full-width characters are as wide as 6 half-width ones
    expect(renderCellHTML(cellFor('GROUNDOUT', { positions: '遊ゴロ' }))).toContain('cell-result fs-xs');
  });
});

describe('renderCellHTML: hostile or broken data', () => {
  it('ignores prototype keys used as result or event types', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(renderCellHTML({ resultType: key, basesReached: 1, runnerEvents: [] })).toBe('');
      const html = renderCellHTML({ resultType: 'SINGLE', positions: '7', basesReached: 2, runnerEvents: [{ type: key }, T('STOLEN_BASE', 2)] });
      clean(html);
      expect(html.match(/class="cell-event-tag"/g)).toHaveLength(1);
      expect(renderLegendSample(key)).toBe('');
    }
  });

  it('never lets quotes or markup out of the title attribute or the text', () => {
    const nasty = ['"onmouseover="alert(1)', "'><svg onload=alert(1)>", '6-3"><img src=x>', '&lt;b&gt;'];
    for (const id of Object.keys(RESULT_TYPES)) {
      for (const positions of nasty) {
        const html = renderCellHTML(cellFor(id, { positions, runnerEvents: [T('STOLEN_BASE', 2)] }));
        clean(html);
        expect(html).not.toMatch(/<(img|svg onload|script)/i);
        expect(html).not.toMatch(/"onmouseover=/);
        // every attribute value is closed by its own quote
        for (const m of html.matchAll(/<[a-z]+((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/g)) expect(m[0]).not.toContain('="="');
      }
    }
    // already-escaped text is escaped again (shown literally, not decoded)
    expect(renderCellHTML(cellFor('GROUNDOUT', { positions: '&lt;b&gt;' }))).toContain('&amp;lt;b&amp;…');
  });
});

describe('renderLegendSample: same drawing as the sheet', () => {
  for (const id of Object.keys(RESULT_TYPES)) {
    it(`${id} sample equals the export cell`, () => {
      const rt = RESULT_TYPES[id];
      const cell = {
        resultType: id, positions: SAMPLE_POSITIONS[id] || '', rbi: 0,
        basesReached: rt.isOut ? 0 : rt.bases, outNumber: rt.isOut ? 1 : null, runnerEvents: [],
      };
      const sample = renderLegendSample(id);
      expect(sample).toBe(`<div class="legend-cell" aria-hidden="true">${renderCellHTML(cell, { forExport: true })}</div>`);
    });
  }
});

describe('help guide: runner-event examples', () => {
  it('uses example sentences that do not skip a base', () => {
    const html = helpHTML();
    for (const sentence of [
      '例: レフト前ヒット → 二塁へ盗塁',
      '例: ライトへの三塁打 → 暴投で生還（得点）',
      '例: レフト前ヒット → 二塁へ盗塁 → 捕逸で三塁へ',
      '例: レフト前ヒット → ボークで二塁へ',
      '例: センターへの二塁打 → エラーの間に三塁へ',
      '例: レフト前ヒット → 二塁で盗塁死【1アウト目】',
      '例: レフト前ヒット → 一塁で牽制死【2アウト目】',
      '例: レフト前ヒット → 二塁へ進む → 三塁で走塁死【1アウト目】',
    ]) expect(html).toContain(sentence);
  });
});

describe('renderHelp', () => {
  it('falls back to #help-content and binds its click handler once', async () => {
    const { renderHelp } = await import('../src/help.js');
    const listeners = [];
    const el = { innerHTML: '', dataset: {}, addEventListener: (type, fn) => listeners.push(type) };
    const saved = globalThis.document;
    globalThis.document = { getElementById: id => (id === 'help-content' ? el : null) };
    try {
      renderHelp();
      renderHelp();
      renderHelp(el);
    } finally {
      if (saved === undefined) delete globalThis.document;
      else globalThis.document = saved;
    }
    expect(el.innerHTML).toBe(helpHTML());
    expect(listeners).toEqual(['click']);
  });
});
