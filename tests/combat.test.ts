import { describe, expect, it } from 'vitest';
import {
  allowedChoices, baseDamage, matchup, monsterChoose, resolveRound, staminaAfter, type Fighter,
} from '../src/core/combat';
import { Rng, seedToState } from '../src/core/rng';
import { CONFIG } from '../src/data/balance';
import { MONSTERS } from '../src/data/monsters';
import { act, atNode, edit, fightToEnd, newGame } from './helpers';
import { applyAction } from '../src/core/game';

const fighter = (over: Partial<Fighter> = {}): Fighter => ({
  offense: 5, defense: 2, stamina: 8, maxStamina: 8, strikeCost: 2, feintCost: 2, guardRegen: 3, ...over,
});

describe('matchups', () => {
  it('Strike beats Feint, Feint beats Guard, Guard beats Strike', () => {
    expect(matchup('strike', 'feint')).toBe('a');
    expect(matchup('feint', 'guard')).toBe('a');
    expect(matchup('guard', 'strike')).toBe('a');
    expect(matchup('feint', 'strike')).toBe('b');
    expect(matchup('guard', 'feint')).toBe('b');
    expect(matchup('strike', 'guard')).toBe('b');
  });
  it('same choice is a tie', () => {
    for (const c of ['strike', 'guard', 'feint'] as const) expect(matchup(c, c)).toBe('tie');
  });
});

describe('damage', () => {
  it('is offense + d6 - defense', () => {
    expect(baseDamage(5, 2, 4)).toBe(7);
  });
  it('has a minimum of 1', () => {
    expect(baseDamage(1, 20, 1)).toBe(1);
  });
  it('winner deals double, loser deals nothing', () => {
    const rng = new Rng({ rng: seedToState(3) });
    const r = resolveRound(fighter(), fighter({ defense: 1 }), 'strike', 'feint', rng);
    expect(r.winner).toBe('a');
    expect(r.dmgToA).toBe(0);
    expect(r.dmgToB).toBe(2 * baseDamage(5, 1, r.rollA!));
    expect(r.rollB).toBeNull();
  });
  it('ties trade normal (single) damage', () => {
    const rng = new Rng({ rng: seedToState(4) });
    const r = resolveRound(fighter(), fighter({ offense: 7 }), 'guard', 'guard', rng);
    expect(r.winner).toBe('tie');
    expect(r.dmgToB).toBe(baseDamage(5, 2, r.rollA!));
    expect(r.dmgToA).toBe(baseDamage(7, 2, r.rollB!));
  });
  it('defense (including armor) reduces damage', () => {
    expect(baseDamage(6, 5, 3)).toBeLessThan(baseDamage(6, 2, 3));
  });
});

describe('stamina', () => {
  it('Strike and Feint cost stamina, Guard restores it (capped)', () => {
    expect(staminaAfter(fighter({ stamina: 5 }), 'strike')).toBe(3);
    expect(staminaAfter(fighter({ stamina: 5 }), 'feint')).toBe(3);
    expect(staminaAfter(fighter({ stamina: 5 }), 'guard')).toBe(8);
    expect(staminaAfter(fighter({ stamina: 7 }), 'guard')).toBe(8);
  });
  it('at 0 stamina only Guard is allowed', () => {
    expect(allowedChoices(fighter({ stamina: 0 }))).toEqual(['guard']);
    expect(allowedChoices(fighter({ stamina: 1 }))).toEqual(['guard']);
    expect(allowedChoices(fighter({ stamina: 2 })).sort()).toEqual(['feint', 'guard', 'strike']);
  });
  it('a higher feint cost can lock out Feint while Strike remains', () => {
    const f = fighter({ stamina: 2, feintCost: 3 });
    expect(allowedChoices(f)).toContain('strike');
    expect(allowedChoices(f)).not.toContain('feint');
  });
  it('the engine rejects a Strike with no stamina', () => {
    let s = atNode(newGame(), 5);
    s = act(s, { type: 'move', to: 5 });
    s = edit(s, (d) => { d.combat!.staminaA = 0; });
    expect(() => applyAction(s, { type: 'choose', side: 'a', choice: 'strike' })).toThrow();
    expect(() => applyAction(s, { type: 'choose', side: 'a', choice: 'guard' })).not.toThrow();
  });
  it('stamina really changes during a fight', () => {
    let s = atNode(newGame(), 5);
    s = act(s, { type: 'move', to: 5 }, { type: 'choose', side: 'a', choice: 'strike' });
    expect(s.combat!.staminaA).toBe(CONFIG.knight.stamina - CONFIG.stamina.strikeCost);
  });
});

describe('monster move selection', () => {
  it('only picks allowed moves and respects weights', () => {
    const rng = new Rng({ rng: seedToState(11) });
    const counts = { strike: 0, guard: 0, feint: 0 };
    const def = MONSTERS.bogTroll;
    for (let i = 0; i < 600; i++) {
      counts[monsterChoose(def, fighter(), { round: 3, lastSelf: null, lastOther: null, lastWinner: null }, rng)]++;
    }
    expect(counts.guard).toBeGreaterThan(counts.strike);
    expect(counts.guard).toBeGreaterThan(counts.feint);
    const rng2 = new Rng({ rng: seedToState(12) });
    for (let i = 0; i < 100; i++) {
      expect(monsterChoose(def, fighter({ stamina: 0 }), { round: 2, lastSelf: null, lastOther: null, lastWinner: null }, rng2)).toBe('guard');
    }
  });
  it('uses its opener on round 0', () => {
    const rng = new Rng({ rng: seedToState(5) });
    expect(monsterChoose(MONSTERS.direWolf, fighter(), { round: 0, lastSelf: null, lastOther: null, lastWinner: null }, rng)).toBe('strike');
  });
  it('adaptive monsters often counter the last player move', () => {
    const rng = new Rng({ rng: seedToState(6) });
    let guard = 0;
    for (let i = 0; i < 300; i++) {
      if (monsterChoose(MONSTERS.rustKnight, fighter(), { round: 2, lastSelf: null, lastOther: 'strike', lastWinner: null }, rng) === 'guard') guard++;
    }
    expect(guard).toBeGreaterThan(150);
  });
});

describe('full fights through the engine', () => {
  it('a mighty knight beats a lair monster and the fight can be continued', () => {
    let s = atNode(newGame(), 5);
    s = edit(s, (d) => { d.players[0].baseAttack = 60; });
    s = act(s, { type: 'move', to: 5 });
    expect(s.stage).toBe('combat');
    s = fightToEnd(s);
    expect(s.combat!.over).toBe(true);
    expect(s.combat!.outcome).toBe('a');
    s = act(s, { type: 'continue' });
    expect(s.players[0].seals).toEqual([0]);
  });
  it('simultaneous knockout leaves the sturdier fighter alive on 1 HP', () => {
    // identical-ish duel: both 1 HP, tie round
    let s = atNode(newGame(), 1);
    s = edit(s, (d) => {
      d.players[1].pos = 1;
      d.players[0].hp = 1;
      d.players[1].hp = 1;
      d.stage = 'pvpOffer';
      d.challengeable = [1];
    });
    s = act(s, { type: 'challenge', target: 1 }, { type: 'choose', side: 'a', choice: 'guard' }, { type: 'choose', side: 'b', choice: 'guard' });
    expect(s.combat!.over).toBe(true);
    const winner = s.combat!.outcome === 'a' ? 0 : 1;
    const loser = 1 - winner;
    expect(s.players[winner].hp).toBe(1);
    expect(s.players[loser].hp).toBe(0);
  });
});
