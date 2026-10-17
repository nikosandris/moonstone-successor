import type { ScarDef } from '../core/types';

export const SCARS: ScarDef[] = [
  { id: 'lostEye', name: 'Lost Eye', desc: '-1 Attack', effect: { attack: -1 } },
  { id: 'brokenHand', name: 'Broken Hand', desc: 'Feint costs +1 Stamina', effect: { feintExtra: 1 } },
  { id: 'hardened', name: 'Hardened', desc: '+1 Defense, -2 max HP', effect: { defense: 1, maxHp: -2 } },
  { id: 'limp', name: 'Limp', desc: '-1 to movement rolls', effect: { move: -1 } },
  { id: 'crackedRibs', name: 'Cracked Ribs', desc: '-4 max HP', effect: { maxHp: -4 } },
  { id: 'bloodFury', name: 'Blood Fury', desc: '+1 Attack, -1 Defense', effect: { attack: 1, defense: -1 } },
  { id: 'shakyGuard', name: 'Shaky Guard', desc: 'Guard restores 1 less Stamina', effect: { guardRegen: -1 } },
  { id: 'nightTerrors', name: 'Night Terrors', desc: '-2 max Stamina', effect: { maxStamina: -2 } },
  { id: 'coldResolve', name: 'Cold Resolve', desc: '+2 max Stamina, -1 Attack', effect: { maxStamina: 2, attack: -1 } },
  { id: 'debtMarked', name: 'Debt-Marked', desc: 'Shop prices +25%', effect: { shopPct: 25 } },
  { id: 'tenacious', name: 'Tenacious', desc: '+3 max HP, -1 to movement rolls', effect: { maxHp: 3, move: -1 } },
];

export function getScar(id: string): ScarDef {
  const s = SCARS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scar ${id}`);
  return s;
}
