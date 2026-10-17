import type { ItemDef } from '../core/types';

const W = (id: string, name: string, tier: ItemDef['tier'], price: number, bonus: number): ItemDef => ({
  id, name, kind: 'weapon', tier, price, bonus, desc: `+${bonus} Attack`,
});
const A = (id: string, name: string, tier: ItemDef['tier'], price: number, bonus: number): ItemDef => ({
  id, name, kind: 'armor', tier, price, bonus, desc: `+${bonus} Defense`,
});

export const ITEMS: ItemDef[] = [
  // Weapons (12)
  W('rustySword', 'Rusty Sword', 0, 5, 1),
  W('sword1', 'Iron Sword', 1, 30, 2),
  W('axe1', 'Hand Axe', 1, 30, 2),
  W('spear1', 'Short Spear', 1, 35, 2),
  W('mace', 'Flanged Mace', 1, 40, 3),
  W('sword2', 'Steel Sword', 2, 70, 4),
  W('warhammer', 'War Hammer', 2, 75, 4),
  W('halberd', 'Halberd', 2, 85, 5),
  W('silverBlade', 'Silver Blade', 3, 130, 6),
  W('greataxe', 'Greataxe', 3, 140, 7),
  W('moonSpear', 'Moonlit Spear', 4, 220, 8),
  W('runeblade', 'Runeblade', 4, 260, 9),
  // Armors (9)
  A('paddedCoat', 'Padded Coat', 0, 5, 1),
  A('jerkin', 'Leather Jerkin', 1, 25, 1),
  A('leatherVest', 'Boiled Vest', 1, 35, 2),
  A('hide', 'Hide Armor', 1, 40, 2),
  A('studded', 'Studded Coat', 2, 65, 3),
  A('chain', 'Chain Hauberk', 2, 80, 4),
  A('scale', 'Scale Mail', 3, 125, 5),
  A('plate', 'Plate Cuirass', 3, 150, 6),
  A('moonMail', 'Moonforged Plate', 4, 240, 8),
  // Consumables (7)
  { id: 'potionS', name: 'Healing Draught', kind: 'consumable', tier: 1, price: 18, effect: { heal: 12 }, desc: 'Heal 12 HP' },
  { id: 'potionL', name: 'Greater Draught', kind: 'consumable', tier: 2, price: 40, effect: { heal: 28 }, desc: 'Heal 28 HP' },
  { id: 'whetstone', name: 'Whetstone', kind: 'consumable', tier: 1, price: 20, effect: { attack: 3 }, desc: '+3 Attack until next fight ends' },
  { id: 'tonic', name: 'Iron Tonic', kind: 'consumable', tier: 1, price: 20, effect: { defense: 3 }, desc: '+3 Defense until next fight ends' },
  { id: 'brew', name: 'Vigor Brew', kind: 'consumable', tier: 2, price: 25, effect: { stamina: 4 }, desc: '+4 max Stamina until next fight ends' },
  { id: 'boots', name: 'Swift Boots Charm', kind: 'consumable', tier: 2, price: 25, effect: { move: 3 }, desc: '+3 to your next movement roll' },
  { id: 'smoke', name: 'Smoke Bomb', kind: 'consumable', tier: 1, price: 22, effect: { freeFlee: true }, desc: 'Next flee costs no gold' },
];

const byId = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): ItemDef {
  const it = byId.get(id);
  if (!it) throw new Error(`unknown item ${id}`);
  return it;
}

export const START_WEAPON = 'rustySword';
export const START_ARMOR = 'paddedCoat';

/** Items that can drop as loot, by kind and tier (tier 0 is starter gear only). */
export function lootPool(tier: number, kind?: ItemDef['kind']): ItemDef[] {
  return ITEMS.filter((i) => i.tier === tier && (!kind || i.kind === kind));
}
