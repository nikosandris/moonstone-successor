import { describe, expect, it } from 'vitest';
import { botAction } from '../src/core/bot';
import { applyAction, createGame } from '../src/core/game';
import { ruinsTierWeights } from '../src/data/balance';
import { setups } from './helpers';

function play(n: number, seed: number) {
  let s = createGame(setups(n).map((p) => ({ ...p, bot: true })), seed);
  let steps = 0;
  while (s.stage !== 'gameOver') {
    s = applyAction(s, botAction(s));
    if (++steps > 100000) throw new Error('no termination');
  }
  return s;
}

describe('bot', () => {
  it('plays complete games for 2, 3 and 4 knights without illegal actions', () => {
    for (const n of [2, 3, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const s = play(n, seed);
        expect(s.winner).not.toBeNull();
        expect(['sanctum', 'dayCap']).toContain(s.endReason);
      }
    }
  });
  it('is deterministic for a given seed', () => {
    const a = play(4, 21);
    const b = play(4, 21);
    expect(a).toEqual(b);
  });
  it('games stay within the day cap', () => {
    expect(play(4, 3).day).toBeLessThanOrEqual(40);
  });
});

describe('loot tiers', () => {
  it('later days shift ruins loot toward higher tiers', () => {
    const early = ruinsTierWeights(2);
    const late = ruinsTierWeights(35);
    const avg = (w: number[]) => w.reduce((t, x, i) => t + x * (i + 1), 0) / w.reduce((t, x) => t + x, 0);
    expect(avg(late)).toBeGreaterThan(avg(early));
    expect(early[3]).toBe(0);
  });
});
