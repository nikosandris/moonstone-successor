import { beforeEach, describe, expect, it } from 'vitest';
import { act, newGame } from './helpers';

// minimal in-memory localStorage for the node test environment
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

describe('save and resume', () => {
  beforeEach(() => store.clear());
  it('round-trips the full game state', async () => {
    const { saveGame, loadGame, saveInfo } = await import('../src/ui/save');
    const s = act(newGame(3, 9), { type: 'roll' });
    saveGame(s);
    expect(loadGame()).toEqual(s);
    expect(saveInfo()!.names).toEqual(['P1', 'P2', 'P3']);
  });
  it('clears the save when the game is over and ignores corrupt data', async () => {
    const { saveGame, loadGame } = await import('../src/ui/save');
    saveGame({ ...newGame(), stage: 'gameOver' });
    expect(loadGame()).toBeNull();
    store.set('moonblood.save.v2', '{not json');
    expect(loadGame()).toBeNull();
    store.set('moonblood.save.v2', JSON.stringify({ state: { players: 'x' } }));
    expect(loadGame()).toBeNull();
  });
});
