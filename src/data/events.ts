// Road events: text and options. The effects live in src/core/game.ts (resolveEvent).
export interface EventDef {
  id: string;
  title: string;
  text: string;
  /** option labels; `{x}` placeholders are filled from the rolled event data */
  options: { label: string; hint: string }[];
  weight: number;
}

export const EVENTS: EventDef[] = [
  {
    id: 'merchant', weight: 16, title: 'Wandering Merchant',
    text: 'A hooded peddler opens a cart of oddities. "For you, a moonlight price."',
    options: [
      { label: 'Buy {item} for {price}g', hint: '{desc}' },
      { label: 'Move on', hint: 'Keep your gold' },
    ],
  },
  {
    id: 'ambush', weight: 22, title: 'Ambush!',
    text: 'Something lunges from the bracken: a {monster}!',
    options: [
      { label: 'Fight', hint: 'Gold, loot and renown - no Seal' },
      { label: 'Run for it', hint: 'Drop {flee} gold' },
    ],
  },
  {
    id: 'shrine', weight: 14, title: 'Roadside Shrine',
    text: 'A moss-grown shrine to a forgotten saint. Coins glint in the offering bowl.',
    options: [
      { label: 'Pray', hint: 'Heal 10 HP and a blessing for your next fight' },
      { label: 'Plunder the bowl', hint: '+25 gold, but the saint may strike back' },
    ],
  },
  {
    id: 'dice', weight: 14, title: 'Bone Dice by the Fire',
    text: 'Three drovers around a fire rattle a cup of bone dice. "Fancy a throw, knight? Highest die wins."',
    options: [
      { label: 'Bet 10 gold', hint: 'Win 10 on a higher roll, ties push' },
      { label: 'Bet 30 gold', hint: 'Win 30 on a higher roll, ties push' },
      { label: 'Walk away', hint: 'Keep your purse' },
    ],
  },
  {
    id: 'traveler', weight: 12, title: 'Wounded Traveler',
    text: 'A pilgrim lies by the road, clutching a satchel. "Water... a little coin..."',
    options: [
      { label: 'Help (10 gold)', hint: 'They share something from the satchel' },
      { label: 'Ride past', hint: 'Nothing happens' },
    ],
  },
  {
    id: 'wisp', weight: 10, title: 'Will-o\'-the-Wisp',
    text: 'A pale light bobs off the road, beckoning into the fog.',
    options: [
      { label: 'Follow the light', hint: 'Teleport somewhere... or get lost (-6 HP)' },
      { label: 'Stay on the road', hint: 'Safe' },
    ],
  },
  {
    id: 'hermit', weight: 12, title: 'Old Sword-Hermit',
    text: 'A scarred hermit eyes your stance. "Sloppy. Forty gold and I will fix it."',
    options: [
      { label: 'Train (40 gold)', hint: '+1 renown toward your next level-up' },
      { label: 'Decline', hint: 'Keep your gold' },
    ],
  },
];

export function getEventDef(id: string): EventDef {
  const e = EVENTS.find((x) => x.id === id);
  if (!e) throw new Error(`unknown event ${id}`);
  return e;
}
