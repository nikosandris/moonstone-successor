import { describe, expect, it } from 'vitest';
import { applyAction, eventOptionBlock } from '../src/core/game';
import { effectiveStats } from '../src/core/stats';
import { BOONS, LEVEL_THRESHOLDS } from '../src/data/boons';
import { EVENTS } from '../src/data/events';
import { GUARDIAN, MONSTERS, WANDERERS } from '../src/data/monsters';
import { SCARS } from '../src/data/scars';
import type { GameState } from '../src/core/types';
import { act, atNode, edit, fightToEnd, newGame } from './helpers';

const ROAD = 13;

/** Put knight 0 into a specific road event. */
function inEvent(id: string, seed = 1, patch: (d: GameState) => void = () => {}): GameState {
  for (let s0 = seed; s0 < seed + 400; s0++) {
    const s = act(atNode(edit(newGame(2, s0), patch), ROAD), { type: 'move', to: ROAD });
    if (s.stage === 'event' && s.event!.id === id) return s;
  }
  throw new Error(`no ${id} event found`);
}

describe('content counts', () => {
  it('has at least 8 monster types with distinct shapes and patterns', () => {
    const all = [...Object.values(MONSTERS), ...Object.values(WANDERERS), GUARDIAN];
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(new Set(all.map((m) => m.shape)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(all.map((m) => JSON.stringify(m.weights) + m.habit + m.opener)).size).toBe(all.length);
    for (const m of all) expect(m.tellMs).toBeGreaterThan(500);
  });
  it('has at least 6 road events, each with a choice', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(6);
    for (const e of EVENTS) expect(e.options.length).toBeGreaterThanOrEqual(2);
  });
  it('has at least 15 scars (Phase 1 eleven plus four more)', () => {
    expect(SCARS.length).toBeGreaterThanOrEqual(15);
  });
});

describe('road events', () => {
  it('stopping on a road can start an event (about half the time)', () => {
    let events = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = act(atNode(newGame(2, seed), ROAD), { type: 'move', to: ROAD });
      if (s.stage === 'event') events++;
    }
    expect(events).toBeGreaterThan(60);
    expect(events).toBeLessThan(140);
  });
  it('every event resolves through every option without errors', () => {
    for (const e of EVENTS) {
      const s = inEvent(e.id, 1, (d) => { d.players[0].gold = 200; });
      for (let i = 0; i < s.event!.options.length; i++) {
        const after = applyAction(s, { type: 'eventChoice', index: i });
        expect(['turnEnd', 'combat', 'pvpOffer']).toContain(after.stage);
        expect(after.event).toBeNull();
      }
    }
  });
  it('options that cost gold are blocked when broke', () => {
    const s = inEvent('hermit', 1, (d) => { d.players[0].gold = 5; });
    expect(eventOptionBlock(s, 0)).toMatch(/gold/i);
    expect(() => applyAction(s, { type: 'eventChoice', index: 0 })).toThrow();
    expect(eventOptionBlock(s, 1)).toBeNull();
  });
  it('an ambush fought to victory gives gold and renown but no Seal', () => {
    let s = inEvent('ambush', 1, (d) => { d.players[0].baseAttack = 60; d.players[0].gold = 0; });
    s = act(s, { type: 'eventChoice', index: 0 });
    expect(s.combat!.kind).toBe('wild');
    s = act(fightToEnd(s), { type: 'continue' });
    expect(s.players[0].seals).toEqual([]);
    expect(s.players[0].gold).toBeGreaterThan(0);
    expect(s.players[0].renown).toBe(1);
  });
  it('dice: win, lose or push by exactly the bet', () => {
    for (let seed = 1; seed < 60; seed += 7) {
      const s = inEvent('dice', seed, (d) => { d.players[0].gold = 100; });
      const after = applyAction(s, { type: 'eventChoice', index: 1 });
      expect([70, 100, 130]).toContain(after.players[0].gold);
    }
  });
  it('the hermit trains: 40 gold for 1 renown', () => {
    const s = act(inEvent('hermit', 1, (d) => { d.players[0].gold = 50; }), { type: 'eventChoice', index: 0 });
    expect(s.players[0].gold).toBe(10);
    expect(s.players[0].renown).toBe(1);
  });
});

describe('renown and level-ups', () => {
  it('crossing a threshold grants a boon choice at the start of the next turn', () => {
    let s = edit(newGame(2), (d) => { d.players[0].renown = LEVEL_THRESHOLDS[0] - 1; d.players[0].baseAttack = 60; });
    s = act(atNode(s, 5), { type: 'move', to: 5 });
    s = act(fightToEnd(s), { type: 'continue' });
    expect(s.players[0].pendingBoons).toBe(1);
    // advance to knight 0's next turn
    let guard = 0;
    do {
      s = act(edit(s, (d) => { d.stage = 'turnEnd'; d.boonChoices = null; }), { type: 'endTurn' });
    } while (s.current !== 0 && ++guard < 10);
    expect(s.stage).toBe('levelUp');
    expect(s.boonChoices).toHaveLength(3);
    const pick = s.boonChoices![0];
    s = act(s, { type: 'chooseBoon', id: pick });
    expect(s.players[0].boons).toEqual([pick]);
    expect(s.players[0].pendingBoons).toBe(0);
    expect(s.stage).toBe('roll');
  });
  it('boons change stats', () => {
    const k = newGame().players[0];
    const base = effectiveStats(k);
    expect(effectiveStats({ ...k, boons: ['might'] }).attack).toBe(base.attack + 1);
    expect(effectiveStats({ ...k, boons: ['vigor'] }).maxHp).toBe(base.maxHp + 5);
    expect(effectiveStats({ ...k, boons: ['feinter'] }).feintCost).toBe(base.feintCost - 1);
    expect(BOONS.length).toBeGreaterThanOrEqual(8);
  });
  it('cannot pick a boon that is not on offer', () => {
    const s = edit(newGame(), (d) => { d.stage = 'levelUp'; d.boonChoices = ['might', 'vigor', 'bulwark']; d.players[0].pendingBoons = 1; });
    expect(() => applyAction(s, { type: 'chooseBoon', id: 'haggler' })).toThrow();
  });
});

describe('new scars', () => {
  it('Burned Hands raises Strike cost; Frostbitten lowers Defense; Grim Veteran trades HP for Attack', () => {
    const k = newGame().players[0];
    const base = effectiveStats(k);
    expect(effectiveStats({ ...k, scars: ['burnedHands'] }).strikeCost).toBe(base.strikeCost + 1);
    expect(effectiveStats({ ...k, scars: ['frostbitten'] }).defense).toBe(base.defense - 1);
    const v = effectiveStats({ ...k, scars: ['veteran'] });
    expect(v.attack).toBe(base.attack + 1);
    expect(v.maxHp).toBe(base.maxHp - 3);
  });
  it('Haunted makes the lair monster hit harder in a real fight', () => {
    const plain = act(atNode(newGame(), 6), { type: 'move', to: 6 }).combat!.monster!.attack;
    const haunted = act(atNode(edit(newGame(), (d) => { d.players[0].scars = ['haunted']; }), 6), { type: 'move', to: 6 }).combat!.monster!.attack;
    expect(haunted).toBe(plain + 1);
  });
});
