// All shared types. Everything in GameState is plain JSON-serialisable data.

export type Choice = 'strike' | 'guard' | 'feint';
export const CHOICES: Choice[] = ['strike', 'guard', 'feint'];

export type NodeType = 'home' | 'road' | 'village' | 'lair' | 'ruins' | 'sanctum';

export interface BoardNode {
  id: number;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  /** home: seat index that owns this home */
  seat?: number;
  /** lair: index of the Seal it guards (0..3) */
  seal?: number;
  /** lair: monster guarding it */
  monster?: string;
  /** village: stock of item ids */
  stock?: string[];
}

export interface BoardData {
  nodes: BoardNode[];
  edges: [number, number][];
}

export type MoonPhase = 'new' | 'waxing' | 'full' | 'waning';

export type ItemKind = 'weapon' | 'armor' | 'consumable';

export interface ConsumableEffect {
  heal?: number;
  attack?: number; // buff until next combat ends
  defense?: number;
  stamina?: number;
  move?: number; // added to next movement roll
  freeFlee?: boolean;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  tier: 0 | 1 | 2 | 3 | 4;
  price: number;
  /** weapon: attack bonus, armor: defense bonus */
  bonus?: number;
  effect?: ConsumableEffect;
  desc: string;
}

export interface MonsterDef {
  id: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  stamina: number;
  /** relative weights for choosing each move */
  weights: Record<Choice, number>;
  opener?: Choice;
  /** stubborn: repeats its last move after not losing a round. adaptive: often counters the player's last move */
  habit: 'none' | 'stubborn' | 'adaptive';
  goldMin: number;
  goldMax: number;
  lootTier: 1 | 2 | 3 | 4;
  hint: string;
}

export interface ScarEffect {
  attack?: number;
  defense?: number;
  maxHp?: number;
  maxStamina?: number;
  move?: number;
  feintExtra?: number;
  guardRegen?: number; // added to stamina restored by Guard (negative = worse)
  shopPct?: number; // % added to shop prices
}

export interface ScarDef {
  id: string;
  name: string;
  desc: string;
  effect: ScarEffect;
}

export interface Knight {
  id: number; // index in players array
  name: string;
  color: number;
  bot: boolean;
  seat: number; // home seat on the board
  pos: number;
  hp: number;
  baseMaxHp: number;
  baseAttack: number;
  baseDefense: number;
  baseStamina: number;
  gold: number;
  weapon: string | null;
  armor: string | null;
  consumables: string[];
  scars: string[];
  /** lair indices (0..3) whose Seal this knight holds */
  seals: number[];
  buffs: { attack: number; defense: number; stamina: number; move: number; freeFlee: boolean };
  downed: boolean;
  deaths: number;
  kills: number;
}

export type Stage =
  | 'roll'
  | 'move'
  | 'shop'
  | 'combat'
  | 'pvpOffer'
  | 'pvpLoot'
  | 'turnEnd'
  | 'gameOver';

export interface MonsterFighter {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
}

export interface Combat {
  kind: 'monster' | 'guardian' | 'pvp';
  /** knight id acting (current player) */
  a: number;
  /** knight id of rival (pvp only) */
  b: number | null;
  monster: MonsterFighter | null;
  monsterId: string | null;
  round: number; // rounds fully resolved
  staminaA: number;
  staminaB: number;
  maxStaminaA: number;
  maxStaminaB: number;
  choiceA: Choice | null;
  choiceB: Choice | null;
  lastA: Choice | null;
  lastB: Choice | null;
  lastWinner: 'a' | 'b' | 'tie' | null;
  /** lines describing the most recent resolved round */
  roundLog: string[];
  over: boolean;
  outcome: 'a' | 'b' | null; // winner side when over
}

export interface PendingLoot {
  winner: number;
  loser: number;
}

export interface LogEntry {
  day: number;
  text: string;
}

export interface GameState {
  seed: number;
  rng: number;
  day: number;
  current: number;
  /** how many knights have already played this day (the first knight rotates daily) */
  step: number;
  stage: Stage;
  moveRoll: number;
  players: Knight[];
  /** ruins node id -> day it can be explored again */
  ruinsReady: Record<number, number>;
  combat: Combat | null;
  pendingLoot: PendingLoot | null;
  /** knights on the node who can be challenged */
  challengeable: number[];
  log: LogEntry[];
  winner: number | null;
  endReason: 'sanctum' | 'dayCap' | null;
  stats: { itemUse: Record<string, number> };
}

export interface PlayerSetup {
  name: string;
  color: number;
  bot?: boolean;
}

export type Action =
  | { type: 'useItem'; slot: number; who?: number }
  | { type: 'roll' }
  | { type: 'move'; to: number }
  | { type: 'buy'; itemId: string }
  | { type: 'heal' }
  | { type: 'leave' }
  | { type: 'flee' }
  | { type: 'challenge'; target: number }
  | { type: 'choose'; side: 'a' | 'b'; choice: Choice }
  | { type: 'continue' }
  | { type: 'pvpLoot'; take: 'seal' | 'gold' }
  | { type: 'endTurn' };
