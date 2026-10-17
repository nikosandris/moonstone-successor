import { describe, expect, it } from 'vitest';
import { daysUntilFull, isSanctumOpen, phaseForDay } from '../src/core/moon';
import { monsterStatsForDay } from '../src/core/game';
import { MONSTERS } from '../src/data/monsters';
import { MOON_EFFECTS } from '../src/data/balance';

describe('moon phases', () => {
  it('4 days per phase, cycling New, Waxing, Full, Waning', () => {
    const seq = [1, 4, 5, 8, 9, 12, 13, 16, 17, 21, 25, 29].map(phaseForDay);
    expect(seq).toEqual(['new', 'new', 'waxing', 'waxing', 'full', 'full', 'waning', 'waning', 'new', 'waxing', 'full', 'waning']);
  });
  it('the Sanctum is open only during the Full moon', () => {
    expect(isSanctumOpen(8)).toBe(false);
    expect(isSanctumOpen(9)).toBe(true);
    expect(isSanctumOpen(12)).toBe(true);
    expect(isSanctumOpen(13)).toBe(false);
    expect(isSanctumOpen(26)).toBe(true);
  });
  it('counts days until Full', () => {
    expect(daysUntilFull(1)).toBe(8);
    expect(daysUntilFull(9)).toBe(0);
    expect(daysUntilFull(13)).toBe(12);
  });
  it('monsters are stronger at Full and weaker at New', () => {
    const def = MONSTERS.bogTroll;
    const newM = monsterStatsForDay('bogTroll', 1);
    const fullM = monsterStatsForDay('bogTroll', 9);
    const waxM = monsterStatsForDay('bogTroll', 5);
    expect(waxM.hp).toBe(def.hp);
    expect(waxM.attack).toBe(def.attack);
    expect(fullM.hp).toBeGreaterThan(waxM.hp);
    expect(fullM.attack).toBe(def.attack + MOON_EFFECTS.full.attack);
    expect(newM.hp).toBeLessThan(waxM.hp);
    expect(newM.attack).toBe(def.attack + MOON_EFFECTS.new.attack);
    expect(newM.defense).toBeLessThan(fullM.defense);
  });
  it('the moon effect is applied to a lair fight', async () => {
    const { act, atNode, newGame } = await import('./helpers');
    const s = act(atNode(newGame(), 5, 9), { type: 'move', to: 5 });
    expect(s.combat!.monster!.hp).toBe(monsterStatsForDay('direWolf', 9).hp);
    const s2 = act(atNode(newGame(), 5, 1), { type: 'move', to: 5 });
    expect(s2.combat!.monster!.hp).toBeLessThan(s.combat!.monster!.hp);
  });
});
