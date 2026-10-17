import type { MonsterDef } from '../core/types';

export const MONSTERS: Record<string, MonsterDef> = {
  direWolf: {
    id: 'direWolf', name: 'Dire Wolf', hp: 34, attack: 5, defense: 2, stamina: 14,
    weights: { strike: 44, guard: 20, feint: 36 }, opener: 'strike', habit: 'none',
    goldMin: 25, goldMax: 45, lootTier: 2,
    hint: 'Loves to bite (Strike) and dart in (Feint). Rarely guards.',
  },
  bogTroll: {
    id: 'bogTroll', name: 'Bog Troll', hp: 46, attack: 6, defense: 3, stamina: 14,
    weights: { strike: 30, guard: 40, feint: 30 }, opener: 'guard', habit: 'none',
    goldMin: 30, goldMax: 55, lootTier: 2,
    hint: 'Defensive. Often braces (Guard) - Feint punishes it.',
  },
  rustKnight: {
    id: 'rustKnight', name: 'Rust Knight', hp: 38, attack: 6, defense: 3, stamina: 14,
    weights: { strike: 33, guard: 33, feint: 34 }, opener: 'feint', habit: 'adaptive',
    goldMin: 35, goldMax: 60, lootTier: 3,
    hint: 'Adaptive: often counters the move you used last round.',
  },
  caveDrake: {
    id: 'caveDrake', name: 'Cave Drake', hp: 48, attack: 7, defense: 3, stamina: 14,
    weights: { strike: 44, guard: 26, feint: 30 }, opener: 'strike', habit: 'stubborn',
    goldMin: 40, goldMax: 70, lootTier: 3,
    hint: 'Stubborn: repeats a move that did not lose. Hits hard.',
  },
};

export const GUARDIAN: MonsterDef = {
  id: 'guardian', name: 'Hollow Warden', hp: 62, attack: 9, defense: 5, stamina: 14,
  weights: { strike: 36, guard: 28, feint: 36 }, opener: 'guard', habit: 'adaptive',
  goldMin: 0, goldMax: 0, lootTier: 4,
  hint: 'The Sanctum guardian. Adapts to your habits - vary your moves.',
};

export function getMonster(id: string): MonsterDef {
  if (id === GUARDIAN.id) return GUARDIAN;
  const m = MONSTERS[id];
  if (!m) throw new Error(`unknown monster ${id}`);
  return m;
}
