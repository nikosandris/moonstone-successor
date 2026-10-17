import type { MonsterDef } from '../core/types';

export const MONSTERS: Record<string, MonsterDef> = {
  direWolf: {
    id: 'direWolf', name: 'Dire Wolf', hp: 34, attack: 5, defense: 2, stamina: 14,
    weights: { strike: 44, guard: 20, feint: 36 }, opener: 'strike', habit: 'none',
    goldMin: 25, goldMax: 45, lootTier: 2,
    hint: 'Loves to bite (Strike) and dart in (Feint). Rarely guards.',
    tellMs: 1000, shape: 'beast', color: 0x6b6f80, strongPhase: 'full', weakPhase: 'new',
  },
  bogTroll: {
    id: 'bogTroll', name: 'Bog Troll', hp: 46, attack: 6, defense: 3, stamina: 14,
    weights: { strike: 30, guard: 40, feint: 30 }, opener: 'guard', habit: 'none',
    goldMin: 30, goldMax: 55, lootTier: 2,
    hint: 'Defensive. Often braces (Guard) - Feint punishes it.',
    tellMs: 1200, shape: 'brute', color: 0x4f6b3a, strongPhase: 'waxing', weakPhase: 'waning',
  },
  rustKnight: {
    id: 'rustKnight', name: 'Rust Knight', hp: 38, attack: 6, defense: 3, stamina: 14,
    weights: { strike: 33, guard: 33, feint: 34 }, opener: 'feint', habit: 'adaptive',
    goldMin: 35, goldMax: 60, lootTier: 3,
    hint: 'Adaptive: often counters the move you used last round.',
    tellMs: 900, shape: 'armored', color: 0x8a5a3a, strongPhase: 'waning', weakPhase: 'waxing',
  },
  caveDrake: {
    id: 'caveDrake', name: 'Cave Drake', hp: 48, attack: 7, defense: 3, stamina: 14,
    weights: { strike: 44, guard: 26, feint: 30 }, opener: 'strike', habit: 'stubborn',
    goldMin: 40, goldMax: 70, lootTier: 3,
    hint: 'Stubborn: repeats a move that did not lose. Hits hard.',
    tellMs: 1050, shape: 'drake', color: 0x7a2f2f, strongPhase: 'new', weakPhase: 'full',
  },
};

/** Wandering monsters met in road ambushes: no Seal, but gold and loot. */
export const WANDERERS: Record<string, MonsterDef> = {
  bandit: {
    id: 'bandit', name: 'Road Bandit', hp: 26, attack: 4, defense: 2, stamina: 14,
    weights: { strike: 40, guard: 30, feint: 30 }, opener: 'feint', habit: 'none',
    goldMin: 20, goldMax: 40, lootTier: 1,
    hint: 'Opens with a feint, then fights fair. Greedy: rarely guards twice.',
    tellMs: 950, shape: 'armored', color: 0x5a4a3a, strongPhase: 'waning', weakPhase: 'full',
  },
  giantSpider: {
    id: 'giantSpider', name: 'Giant Spider', hp: 22, attack: 5, defense: 1, stamina: 14,
    weights: { strike: 25, guard: 15, feint: 60 }, opener: 'feint', habit: 'stubborn',
    goldMin: 15, goldMax: 30, lootTier: 2,
    hint: 'Mostly feints and keeps doing what works. Strike it.',
    tellMs: 800, shape: 'spider', color: 0x3a2a3a, strongPhase: 'new', weakPhase: 'full',
  },
  marshSerpent: {
    id: 'marshSerpent', name: 'Marsh Serpent', hp: 30, attack: 4, defense: 2, stamina: 14,
    weights: { strike: 50, guard: 25, feint: 25 }, opener: 'strike', habit: 'adaptive',
    goldMin: 18, goldMax: 34, lootTier: 1,
    hint: 'Lunges often and learns your last move.',
    tellMs: 900, shape: 'serpent', color: 0x2f5a4a, strongPhase: 'waxing', weakPhase: 'waning',
  },
  boneGolem: {
    id: 'boneGolem', name: 'Bone Golem', hp: 40, attack: 5, defense: 4, stamina: 14,
    weights: { strike: 30, guard: 50, feint: 20 }, opener: 'guard', habit: 'none',
    goldMin: 30, goldMax: 50, lootTier: 2,
    hint: 'Slow and armoured. Braces half the time - feint past it.',
    tellMs: 1300, shape: 'golem', color: 0x8a8a7a, strongPhase: 'full', weakPhase: 'new',
  },
};

export const GUARDIAN: MonsterDef = {
  id: 'guardian', name: 'Hollow Warden', hp: 66, attack: 10, defense: 5, stamina: 14,
  weights: { strike: 36, guard: 28, feint: 36 }, opener: 'guard', habit: 'adaptive',
  goldMin: 0, goldMax: 0, lootTier: 4,
  hint: 'The Sanctum guardian. Adapts to your habits - vary your moves.',
  tellMs: 850, shape: 'wraith', color: 0x5a5fa0,
};

export function getMonster(id: string): MonsterDef {
  if (id === GUARDIAN.id) return GUARDIAN;
  const m = MONSTERS[id] ?? WANDERERS[id];
  if (!m) throw new Error(`unknown monster ${id}`);
  return m;
}
