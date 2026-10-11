import { describe, it, expect } from 'vitest';
import {
  addSlotSubstitution, removeSlotSubstitution, playerAfterUndo, syncSlotSubstitutions,
} from '../src/scoresheet.js';
import { makeGame } from './helpers.js';

// Slot 0 of the first team starts as A1 #1 at position '1' (helpers.lineup).
const slot = game => game.lineupFirst[0];
const chain = game => game.substitutions.map(s => [
  s.type, s.inning, s.oldPlayer.name, s.oldPlayer.position, s.newPlayer.name, s.newPlayer.position,
]);

function sub(type, inning, newPlayer, extra = {}) {
  return { type, teamKey: 'first', inning, batterIdx: 0, newPlayer, ...extra };
}

describe('substitutions of a batting slot', () => {
  it('puts the new player in the lineup and keeps the history a chain', () => {
    const g = makeGame();
    addSlotSubstitution(g, sub('PH', 3, { name: '代打', number: '20', position: '' }, { keepPosition: true }));
    addSlotSubstitution(g, sub('DEF', 4, { name: '守備', number: '21', position: '7' }));
    expect(slot(g)).toMatchObject({ name: '守備', number: '21', position: '7' });
    expect(chain(g)).toEqual([
      ['PH', 3, 'A1', '1', '代打', '1'],
      ['DEF', 4, '代打', '1', '守備', '7'],
    ]);
  });

  it('orders by inning even when an earlier substitution is recorded later', () => {
    const g = makeGame();
    addSlotSubstitution(g, sub('PH', 5, { name: 'B', number: '', position: '' }, { keepPosition: true }));
    addSlotSubstitution(g, sub('PR', 2, { name: 'A', number: '', position: '' }, { keepPosition: true }));
    expect(slot(g).name).toBe('B');
    const byInning = [...g.substitutions].sort((x, y) => x.inning - y.inning);
    expect(byInning.map(s => [s.oldPlayer.name, s.newPlayer.name])).toEqual([['A1', 'A'], ['A', 'B']]);
  });

  it('undoing the last substitution brings the previous player back', () => {
    const g = makeGame();
    addSlotSubstitution(g, sub('PH', 3, { name: '代打', number: '20', position: '' }, { keepPosition: true }));
    const s = g.substitutions[0];
    expect(playerAfterUndo(g, s).name).toBe('A1');
    removeSlotSubstitution(g, s);
    expect(g.substitutions).toEqual([]);
    expect(slot(g)).toMatchObject({ name: 'A1', number: '1', position: '1' });
  });

  it('undoing a middle substitution keeps the current player and repairs the chain', () => {
    const g = makeGame();
    addSlotSubstitution(g, sub('PR', 1, { name: '代走', number: '', position: '' }, { keepPosition: true }));
    addSlotSubstitution(g, sub('DEF', 2, { name: '代走', number: '', position: '6' }, { positionOnly: true }));
    addSlotSubstitution(g, sub('PH', 3, { name: '代打', number: '', position: '' }, { keepPosition: true }));
    expect(slot(g).position).toBe('6');
    removeSlotSubstitution(g, g.substitutions[1]); // the position change
    // the pinch hitter took over the position of the player he replaced: back to '1'
    expect(slot(g)).toMatchObject({ name: '代打', position: '1' });
    expect(chain(g)).toEqual([
      ['PR', 1, 'A1', '1', '代走', '1'],
      ['PH', 3, '代走', '1', '代打', '1'],
    ]);
    removeSlotSubstitution(g, g.substitutions[0]);
    expect(chain(g)).toEqual([['PH', 3, 'A1', '1', '代打', '1']]);
    expect(slot(g).name).toBe('代打');
  });

  it('keeps a chosen position when an earlier position change is undone', () => {
    const g = makeGame();
    addSlotSubstitution(g, sub('DEF', 2, { name: 'A1', number: '1', position: '6' }, { positionOnly: true }));
    addSlotSubstitution(g, sub('DEF', 4, { name: '守備', number: '', position: '9' }));
    removeSlotSubstitution(g, g.substitutions[0]);
    expect(slot(g)).toMatchObject({ name: '守備', position: '9' });
  });

  it('carries lineup-page edits of the current player into the history', () => {
    const g = makeGame();
    addSlotSubstitution(g, sub('PH', 2, { name: '代打A', number: '', position: '' }, { keepPosition: true }));
    addSlotSubstitution(g, sub('PR', 4, { name: '代走B', number: '', position: '' }, { keepPosition: true }));
    // the lineup page corrects the name, number and position of the player in the slot
    Object.assign(slot(g), { name: '代走Bさん', number: '77', position: '9' });
    expect(syncSlotSubstitutions(g, 'first', 0)).toBe(true);
    expect(syncSlotSubstitutions(g, 'first', 0)).toBe(false);
    expect(g.substitutions[1].newPlayer).toMatchObject({ name: '代走Bさん', number: '77', position: '9' });
    // undoing the earlier pinch hitter must not bring the old name back
    removeSlotSubstitution(g, g.substitutions[0]);
    expect(slot(g)).toMatchObject({ name: '代走Bさん', number: '77', position: '9' });
    expect(g.substitutions[0].oldPlayer.name).toBe('A1');
  });

  it('a position-only change keeps the player', () => {
    const g = makeGame();
    addSlotSubstitution(g, sub('DEF', 3, { name: 'A1', number: '1', position: '5' }, { positionOnly: true }));
    expect(slot(g)).toMatchObject({ name: 'A1', number: '1', position: '5' });
    expect(chain(g)).toEqual([['DEF', 3, 'A1', '1', 'A1', '5']]);
  });

  it('ignores substitutions of other slots and teams', () => {
    const g = makeGame();
    addSlotSubstitution(g, { type: 'PH', teamKey: 'second', inning: 2, batterIdx: 0, newPlayer: { name: 'X', number: '', position: '' }, keepPosition: true });
    addSlotSubstitution(g, { type: 'PH', teamKey: 'first', inning: 2, batterIdx: 1, newPlayer: { name: 'Y', number: '', position: '' }, keepPosition: true });
    expect(slot(g).name).toBe('A1');
    expect(g.lineupSecond[0].name).toBe('X');
    expect(g.lineupFirst[1].name).toBe('Y');
    expect(removeSlotSubstitution(g, { teamKey: 'first', batterIdx: 0 })).toBe(false);
  });
});
