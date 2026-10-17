import { CONFIG } from '../data/balance';
import { getItem } from '../data/items';
import { getScar } from '../data/scars';
import type { Knight, ScarEffect } from './types';

export interface EffectiveStats {
  maxHp: number;
  attack: number; // base + scars + buffs (without weapon)
  weaponBonus: number;
  defense: number; // base + scars + buffs (without armor)
  armorBonus: number;
  maxStamina: number;
  strikeCost: number;
  feintCost: number;
  guardRegen: number;
  move: number; // modifier to movement roll
  shopPct: number;
}

export function scarTotals(k: Knight): Required<ScarEffect> {
  const t: Required<ScarEffect> = {
    attack: 0, defense: 0, maxHp: 0, maxStamina: 0, move: 0, feintExtra: 0, guardRegen: 0, shopPct: 0,
  };
  for (const id of k.scars) {
    const e = getScar(id).effect;
    for (const key of Object.keys(e) as (keyof ScarEffect)[]) t[key] += e[key] ?? 0;
  }
  return t;
}

export function effectiveStats(k: Knight): EffectiveStats {
  const sc = scarTotals(k);
  return {
    maxHp: Math.max(5, k.baseMaxHp + sc.maxHp),
    attack: k.baseAttack + sc.attack + k.buffs.attack,
    weaponBonus: k.weapon ? getItem(k.weapon).bonus ?? 0 : 0,
    defense: k.baseDefense + sc.defense + k.buffs.defense,
    armorBonus: k.armor ? getItem(k.armor).bonus ?? 0 : 0,
    maxStamina: Math.max(2, k.baseStamina + sc.maxStamina + k.buffs.stamina),
    strikeCost: CONFIG.stamina.strikeCost,
    feintCost: CONFIG.stamina.feintCost + sc.feintExtra,
    guardRegen: Math.max(1, CONFIG.stamina.guardRegen + sc.guardRegen),
    move: sc.move,
    shopPct: sc.shopPct,
  };
}

export function shopPrice(k: Knight, base: number): number {
  return Math.ceil((base * (100 + effectiveStats(k).shopPct)) / 100);
}
