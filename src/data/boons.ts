import type { BoonDef } from '../core/types';

/** Level-up rewards: a knight picks one of three random offers. */
export const BOONS: BoonDef[] = [
  { id: 'vigor', name: 'Vigor', desc: '+5 max HP', effect: { maxHp: 5 } },
  { id: 'might', name: 'Might', desc: '+1 Attack', effect: { attack: 1 } },
  { id: 'bulwark', name: 'Bulwark', desc: '+1 Defense', effect: { defense: 1 } },
  { id: 'endurance', name: 'Endurance', desc: '+2 max Stamina', effect: { maxStamina: 2 } },
  { id: 'secondWind', name: 'Second Wind', desc: 'Guard restores +1 Stamina', effect: { guardRegen: 1 } },
  { id: 'fleetfoot', name: 'Fleet-foot', desc: '+1 to movement rolls', effect: { move: 1 } },
  { id: 'haggler', name: 'Haggler', desc: 'Shop prices -20%', effect: { shopPct: -20 } },
  { id: 'feinter', name: 'Trickster', desc: 'Feint costs 1 less Stamina', effect: { feintExtra: -1 } },
];

/** Victories (renown) needed for each level-up. */
export const LEVEL_THRESHOLDS = [2, 4, 7, 11, 16];

export function getBoon(id: string): BoonDef {
  const b = BOONS.find((x) => x.id === id);
  if (!b) throw new Error(`unknown boon ${id}`);
  return b;
}
