// Central tuning knobs. Edit these to balance the game (then run `npm run sim`).
import type { MoonPhase } from '../core/types';

export const CONFIG = {
  dayCap: 40,
  daysPerPhase: 4,
  sealsToEnter: 3,
  startGold: 40,
  knight: { hp: 36, attack: 3, defense: 1, stamina: 8 },
  stamina: { strikeCost: 2, feintCost: 2, guardRegen: 3 },
  healCostPerHp: 1.5,
  fleeGoldPct: 0.2,
  fleeGoldMin: 5,
  ruinsCooldownDays: 3,
  sellBackPct: 0.5,
  ruins: {
    // relative weights of ruin outcomes
    weights: { gold: 30, loot: 35, trap: 25, nothing: 10 },
    goldMin: 12,
    goldMax: 35,
    trapMin: 4,
    trapMax: 10,
  },
  pvpHalfGold: 0.5,
  deathGoldLoss: 0.5,
};

export const PHASES: MoonPhase[] = ['new', 'waxing', 'full', 'waning'];

export const PHASE_NAMES: Record<MoonPhase, string> = {
  new: 'New Moon',
  waxing: 'Waxing Moon',
  full: 'Full Moon',
  waning: 'Waning Moon',
};

/** Monster modifiers per moon phase. hpMult multiplies HP, others are additive. */
export const MOON_EFFECTS: Record<MoonPhase, { hpMult: number; attack: number; defense: number; text: string }> = {
  new: { hpMult: 0.8, attack: -1, defense: -1, text: 'Monsters are weakened (-20% HP, -1 ATK, -1 DEF)' },
  waxing: { hpMult: 1, attack: 0, defense: 0, text: 'Monsters are normal' },
  full: { hpMult: 1.3, attack: 2, defense: 1, text: 'Monsters are empowered (+30% HP, +2 ATK, +1 DEF)' },
  waning: { hpMult: 0.9, attack: 0, defense: 0, text: 'Monsters are slightly weakened (-10% HP)' },
};

/** Loot tier weights for ruins by day range (index = moon cycle phase of the game). */
export function ruinsTierWeights(day: number): [number, number, number, number] {
  if (day <= 8) return [60, 35, 5, 0];
  if (day <= 16) return [30, 45, 22, 3];
  if (day <= 28) return [12, 38, 38, 12];
  return [5, 25, 45, 25];
}

export const SEAL_GOLD_BONUS = 20;
