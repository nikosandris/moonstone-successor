import { CONFIG, SEAL_GOLD_BONUS, ruinsTierWeights } from '../data/balance';
import { ITEMS, START_ARMOR, START_WEAPON, getItem, lootPool } from '../data/items';
import { BOONS, LEVEL_THRESHOLDS, getBoon } from '../data/boons';
import { EVENTS } from '../data/events';
import { getMonster, GUARDIAN, WANDERERS } from '../data/monsters';
import { SCARS } from '../data/scars';
import { isAllowed, monsterChoose, resolveRound, type Fighter } from './combat';
import { distancesFrom, homeNode, node } from './graph';
import { isSanctumOpen, moonEffect, phaseForDay } from './moon';
import { reachable as reachableNodes } from './graph';
import { Rng, seedToState } from './rng';
import { effectiveStats, shopPrice } from './stats';
import type {
  Action, Choice, Combat, GameState, ItemDef, Knight, MonsterFighter, PlayerSetup,
} from './types';

export class IllegalActionError extends Error {}

const MAX_LOG = 80;

// ---------------------------------------------------------------- setup

const SEATS_BY_COUNT: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

export function createGame(setups: PlayerSetup[], seed: number): GameState {
  if (setups.length < 2 || setups.length > 4) throw new Error('2 to 4 players required');
  const seats = SEATS_BY_COUNT[setups.length];
  const players: Knight[] = setups.map((p, i) => ({
    id: i,
    name: p.name,
    color: p.color,
    bot: !!p.bot,
    seat: seats[i],
    pos: homeNode(seats[i]),
    hp: CONFIG.knight.hp,
    baseMaxHp: CONFIG.knight.hp,
    baseAttack: CONFIG.knight.attack,
    baseDefense: CONFIG.knight.defense,
    baseStamina: CONFIG.knight.stamina,
    gold: CONFIG.startGold,
    weapon: START_WEAPON,
    armor: START_ARMOR,
    consumables: [],
    scars: [],
    seals: [],
    buffs: { attack: 0, defense: 0, stamina: 0, move: 0, freeFlee: false },
    downed: false,
    deaths: 0,
    kills: 0,
    duelsWon: 0,
    renown: 0,
    boons: [],
    pendingBoons: 0,
    goldEarned: 0,
  }));
  const s: GameState = {
    seed,
    rng: seedToState(seed),
    day: 1,
    current: 0,
    step: 0,
    order: players.map((p) => p.id),
    stage: 'roll',
    moveRoll: 0,
    players,
    ruinsReady: {},
    combat: null,
    pendingLoot: null,
    challengeable: [],
    event: null,
    boonChoices: null,
    log: [],
    winner: null,
    endReason: null,
    stats: { itemUse: {} },
  };
  log(s, `The hunt begins. Day 1 - ${phaseForDay(1)} moon.`);
  rollInitiative(s);
  s.current = s.order[0];
  startTurn(s);
  return s;
}

// ---------------------------------------------------------------- helpers

function clone(s: GameState): GameState {
  return structuredClone(s);
}

function log(s: GameState, text: string): void {
  s.log.push({ day: s.day, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

export function currentKnight(s: GameState): Knight {
  return s.players[s.current];
}

/** Which knight must act right now (differs from the current player only when a rival wins PvP loot). */
export function actorId(s: GameState): number {
  return s.stage === 'pvpLoot' && s.pendingLoot ? s.pendingLoot.winner : s.current;
}

export function sealsOf(s: GameState, id: number): number[] {
  return s.players[id].seals;
}

export function sealCount(s: GameState, id: number): number {
  return s.players[id].seals.length;
}

/** Seals the rival holds that `winner` does not yet have (what a PvP win can take). */
export function stealableSeals(s: GameState, winner: number, loser: number): number[] {
  return s.players[loser].seals.filter((x) => !s.players[winner].seals.includes(x));
}

function clampHp(k: Knight): void {
  k.hp = Math.max(0, Math.min(k.hp, effectiveStats(k).maxHp));
}

export function knightFighter(k: Knight, stamina?: number, maxStamina?: number): Fighter {
  const e = effectiveStats(k);
  return {
    offense: e.attack + e.weaponBonus,
    defense: e.defense + e.armorBonus,
    stamina: stamina ?? e.maxStamina,
    maxStamina: maxStamina ?? e.maxStamina,
    strikeCost: e.strikeCost,
    feintCost: e.feintCost,
    guardRegen: e.guardRegen,
  };
}

function monsterFighterStats(m: MonsterFighter, stamina: number, maxStamina: number): Fighter {
  return {
    offense: m.attack,
    defense: m.defense,
    stamina,
    maxStamina,
    strikeCost: CONFIG.stamina.strikeCost,
    feintCost: CONFIG.stamina.feintCost,
    guardRegen: CONFIG.stamina.guardRegen,
  };
}

/** Fighters for both sides of the current combat. */
export function combatFighters(s: GameState): { a: Fighter; b: Fighter } {
  const c = s.combat;
  if (!c) throw new Error('no combat');
  const a = knightFighter(s.players[c.a], c.staminaA, c.maxStaminaA);
  const b = c.monster
    ? monsterFighterStats(c.monster, c.staminaB, c.maxStaminaB)
    : knightFighter(s.players[c.b!], c.staminaB, c.maxStaminaB);
  return { a, b };
}

export function combatHp(s: GameState, side: 'a' | 'b'): { hp: number; maxHp: number } {
  const c = s.combat!;
  if (side === 'a') return { hp: s.players[c.a].hp, maxHp: effectiveStats(s.players[c.a]).maxHp };
  if (c.monster) return { hp: c.monster.hp, maxHp: c.monster.maxHp };
  return { hp: s.players[c.b!].hp, maxHp: effectiveStats(s.players[c.b!]).maxHp };
}

/** Monster stats for a day: general moon effect, then the monster's own phase affinity. */
export function monsterStatsForDay(monsterId: string, day: number, foeAttack = 0): MonsterFighter {
  const def = getMonster(monsterId);
  const m = moonEffect(day);
  const phase = phaseForDay(day);
  const aff = def.strongPhase === phase ? CONFIG.affinity.strong : def.weakPhase === phase ? CONFIG.affinity.weak : null;
  const hp = Math.max(1, Math.round(def.hp * m.hpMult * (aff?.hpMult ?? 1)));
  return {
    id: def.id,
    name: def.name,
    hp,
    maxHp: hp,
    attack: Math.max(1, def.attack + m.attack + (aff?.attack ?? 0) + foeAttack),
    defense: Math.max(0, def.defense + m.defense),
  };
}

/** Short text for a monster's affinity on a given day, or null. */
export function affinityText(monsterId: string, day: number): string | null {
  const def = getMonster(monsterId);
  const phase = phaseForDay(day);
  if (def.strongPhase === phase) return `${def.name} is at its strongest under this moon`;
  if (def.weakPhase === phase) return `${def.name} is weakened under this moon`;
  return null;
}

function gainGold(k: Knight, n: number): void {
  k.gold += n;
  k.goldEarned += n;
}

/** A victory: renown, and a level-up offer once a threshold is crossed. */
function addRenown(s: GameState, k: Knight, n = 1): void {
  k.renown += n;
  while (k.boons.length + k.pendingBoons < LEVEL_THRESHOLDS.length && k.renown >= LEVEL_THRESHOLDS[k.boons.length + k.pendingBoons]) {
    k.pendingBoons += 1;
    log(s, `${k.name} gains renown and will level up at the start of their next turn!`);
  }
}

function offerBoons(s: GameState): void {
  const rng = new Rng(s);
  const pool = BOONS.map((b) => b.id);
  const picks: string[] = [];
  while (picks.length < 3) {
    const id = rng.pick(pool);
    if (!picks.includes(id)) picks.push(id);
  }
  s.boonChoices = picks;
  s.stage = 'levelUp';
}

export function fleeCost(k: Knight): number {
  if (k.buffs.freeFlee) return 0;
  return Math.min(k.gold, Math.max(CONFIG.fleeGoldMin, Math.ceil(k.gold * CONFIG.fleeGoldPct)));
}

// ---------------------------------------------------------------- items

function sellValue(item: ItemDef): number {
  return Math.floor(item.price * CONFIG.sellBackPct);
}

/** Give an item to a knight: equips if better, otherwise converts to gold. Returns log text. */
function awardItem(k: Knight, item: ItemDef): string {
  if (item.kind === 'consumable') {
    if (k.consumables.length < 3) {
      k.consumables.push(item.id);
      return `${k.name} takes ${item.name}.`;
    }
    const g = sellValue(item);
    k.gold += g;
    return `${k.name}'s pack is full; sells ${item.name} for ${g}g.`;
  }
  const cur = item.kind === 'weapon' ? k.weapon : k.armor;
  const curBonus = cur ? getItem(cur).bonus ?? 0 : -1;
  if ((item.bonus ?? 0) > curBonus) {
    if (cur) k.gold += sellValue(getItem(cur));
    if (item.kind === 'weapon') k.weapon = item.id;
    else k.armor = item.id;
    return `${k.name} equips ${item.name} (${item.desc}).`;
  }
  const g = sellValue(item);
  k.gold += g;
  return `${k.name} finds ${item.name} but it is no upgrade; sells it for ${g}g.`;
}

function randomLoot(s: GameState, tier: number): ItemDef {
  const rng = new Rng(s);
  let pool = lootPool(tier);
  if (pool.length === 0) pool = ITEMS.filter((i) => i.tier >= 1);
  return rng.pick(pool);
}

function rollTier(s: GameState): number {
  const rng = new Rng(s);
  const w = ruinsTierWeights(s.day);
  return rng.weighted([1, 2, 3, 4], w);
}

// ---------------------------------------------------------------- turn flow

function startTurn(s: GameState): void {
  const k = currentKnight(s);
  s.stage = 'roll';
  s.combat = null;
  s.challengeable = [];
  if (k.downed) {
    k.downed = false;
    k.pos = homeNode(k.seat);
    k.hp = effectiveStats(k).maxHp;
    log(s, `${k.name} rises at Home, scarred but alive.`);
  }
  if (k.pendingBoons > 0) offerBoons(s);
}

function endGameByCap(s: GameState): void {
  const ranked = [...s.players].sort(
    (a, b) => sealCount(s, b.id) - sealCount(s, a.id) || b.gold - a.gold || a.id - b.id,
  );
  s.winner = ranked[0].id;
  s.endReason = 'dayCap';
  s.stage = 'gameOver';
  log(s, `Day ${CONFIG.dayCap} has ended. ${ranked[0].name} wins with the most Seals.`);
}

function advanceTurn(s: GameState): void {
  const n = s.players.length;
  s.step += 1;
  if (s.step >= n) {
    s.step = 0;
    s.day += 1;
    if (s.day > CONFIG.dayCap) {
      s.day = CONFIG.dayCap;
      endGameByCap(s);
      return;
    }
    log(s, `Day ${s.day} dawns - ${phaseForDay(s.day)} moon.`);
  }
  if (s.step === 0) rollInitiative(s);
  s.current = s.order[s.step];
  startTurn(s);
}

/** Seeded shuffle of the day's turn order: every seat is equally likely to act first on any day. */
function rollInitiative(s: GameState): void {
  const rng = new Rng(s);
  const order = s.players.map((p) => p.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  s.order = order;
  log(s, `Initiative: ${order.map((id) => s.players[id].name).join(', ')}.`);
}

/** Knight who plays after the current one, or null if a new day (and new initiative) comes next. */
export function nextKnightId(s: GameState): number | null {
  return s.step + 1 < s.order.length ? s.order[s.step + 1] : null;
}

/** After a node has been resolved: PvP offer if a rival shares the node, otherwise end of turn. */
function afterEncounter(s: GameState): void {
  const k = currentKnight(s);
  s.combat = null;
  const rivals = s.players.filter((p) => p.id !== k.id && p.pos === k.pos && !p.downed && p.hp > 0);
  if (!k.downed && k.hp > 0 && rivals.length > 0) {
    s.challengeable = rivals.map((p) => p.id);
    s.stage = 'pvpOffer';
  } else {
    s.challengeable = [];
    s.stage = 'turnEnd';
  }
}

// ---------------------------------------------------------------- nodes

function resolveNode(s: GameState): void {
  const k = currentKnight(s);
  const nd = node(k.pos);
  const rng = new Rng(s);
  switch (nd.type) {
    case 'home':
      if (nd.seat === k.seat) {
        k.hp = effectiveStats(k).maxHp;
        log(s, `${k.name} rests at Home and is fully healed.`);
      } else {
        log(s, `${k.name} stands at a rival's Home.`);
      }
      break;
    case 'road':
      if (rng.float() < CONFIG.roadEventChance) {
        startEvent(s);
        return;
      }
      log(s, `${k.name} travels the road to ${nd.name}.`);
      break;
    case 'village':
      log(s, `${k.name} enters ${nd.name}.`);
      s.stage = 'shop';
      return;
    case 'lair': {
      if (!k.seals.includes(nd.seal!)) {
        log(s, `${k.name} enters the ${nd.name}...`);
        startCombat(s, 'monster', k.id, null, nd.monster!);
        return;
      }
      log(s, `${k.name} already holds the Seal of the ${nd.name}.`);
      break;
    }
    case 'ruins': {
      if (s.day < (s.ruinsReady[nd.id] ?? 0)) {
        log(s, `${nd.name} has already been picked clean.`);
        break;
      }
      s.ruinsReady[nd.id] = s.day + CONFIG.ruinsCooldownDays;
      const w = CONFIG.ruins.weights;
      const outcome = rng.weighted(['gold', 'loot', 'trap', 'nothing'] as const, [w.gold, w.loot, w.trap, w.nothing]);
      if (outcome === 'gold') {
        const g = rng.int(CONFIG.ruins.goldMin, CONFIG.ruins.goldMax);
        gainGold(k, g);
        log(s, `${k.name} finds ${g} gold in ${nd.name}.`);
      } else if (outcome === 'loot') {
        const item = randomLoot(s, rollTier(s));
        log(s, `${k.name} searches ${nd.name}: ${awardItem(k, item)}`);
      } else if (outcome === 'trap') {
        const dmg = rng.int(CONFIG.ruins.trapMin, CONFIG.ruins.trapMax);
        k.hp = Math.max(1, k.hp - dmg);
        log(s, `A trap in ${nd.name}! ${k.name} takes ${dmg} damage.`);
      } else {
        log(s, `${k.name} searches ${nd.name} but finds nothing.`);
      }
      break;
    }
    case 'sanctum': {
      const seals = sealCount(s, k.id);
      if (isSanctumOpen(s.day) && seals >= CONFIG.sealsToEnter) {
        log(s, `${k.name} enters the open Sanctum with ${seals} Seals. The Warden awakens!`);
        startCombat(s, 'guardian', k.id, null, GUARDIAN.id);
        return;
      }
      if (!isSanctumOpen(s.day)) log(s, `The Sanctum is sealed. It opens only under the Full moon.`);
      else log(s, `The Sanctum is open, but ${k.name} holds only ${seals} of ${CONFIG.sealsToEnter} Seals.`);
      break;
    }
  }
  afterEncounter(s);
}

// ---------------------------------------------------------------- road events

function startEvent(s: GameState): void {
  const k = currentKnight(s);
  const rng = new Rng(s);
  const def = rng.weighted(EVENTS, EVENTS.map((e) => e.weight));
  const data: Record<string, string | number> = {};
  if (def.id === 'merchant') {
    const item = randomLoot(s, rollTier(s));
    data.item = item.id;
    data.price = Math.max(5, Math.round(item.price * 0.7));
  } else if (def.id === 'ambush') {
    data.monster = rng.pick(Object.keys(WANDERERS));
    data.flee = fleeCost(k);
  }
  const fill = (str: string) =>
    str
      .replace('{item}', data.item ? getItem(String(data.item)).name : '')
      .replace('{price}', String(data.price ?? ''))
      .replace('{desc}', data.item ? getItem(String(data.item)).desc : '')
      .replace('{monster}', data.monster ? getMonster(String(data.monster)).name : '')
      .replace('{flee}', String(data.flee ?? ''));
  s.event = {
    id: def.id,
    title: def.title,
    text: fill(def.text),
    options: def.options.map((o) => ({ label: fill(o.label), hint: fill(o.hint) })),
    data,
  };
  s.stage = 'event';
  log(s, `${k.name} on the road: ${def.title}.`);
}

/** Why an event option cannot be picked right now, or null. */
export function eventOptionBlock(s: GameState, index: number): string | null {
  const e = s.event;
  const k = currentKnight(s);
  if (!e || index < 0 || index >= e.options.length) return 'No such option';
  const cost: Record<string, number[]> = { merchant: [Number(e.data.price)], dice: [10, 30], traveler: [10], hermit: [40] };
  const c = cost[e.id]?.[index];
  if (c !== undefined && k.gold < c) return 'Not enough gold';
  if (e.id === 'merchant' && index === 0) {
    const item = getItem(String(e.data.item));
    if (item.kind === 'consumable' && k.consumables.length >= 3) return 'Pack is full';
  }
  return null;
}

function resolveEvent(s: GameState, index: number): void {
  const e = s.event!;
  const k = currentKnight(s);
  const rng = new Rng(s);
  s.event = null;
  switch (e.id) {
    case 'merchant':
      if (index === 0) {
        const item = getItem(String(e.data.item));
        k.gold -= Number(e.data.price);
        log(s, `${k.name} pays ${e.data.price}g. ${awardItem(k, item)}`);
      } else log(s, `${k.name} waves the merchant off.`);
      break;
    case 'ambush':
      if (index === 0) {
        startCombat(s, 'wild', k.id, null, String(e.data.monster));
        return;
      }
      {
        const cost = fleeCost(k);
        k.gold -= cost;
        k.buffs.freeFlee = false;
        log(s, `${k.name} escapes${cost ? `, dropping ${cost} gold` : ''}.`);
      }
      break;
    case 'shrine':
      if (index === 0) {
        k.hp = Math.min(effectiveStats(k).maxHp, k.hp + 10);
        if (rng.float() < 0.5) k.buffs.attack += 2;
        else k.buffs.defense += 2;
        log(s, `${k.name} prays. Wounds close and a blessing settles on them.`);
      } else {
        gainGold(k, 25);
        if (rng.float() < 0.4) {
          k.hp = Math.max(1, k.hp - 6);
          log(s, `${k.name} takes 25 gold - and the saint's curse burns for 6 damage.`);
        } else log(s, `${k.name} pockets 25 gold from the shrine.`);
      }
      break;
    case 'dice': {
      if (index === 2) { log(s, `${k.name} walks away from the dice.`); break; }
      const bet = index === 0 ? 10 : 30;
      const me = rng.d6();
      const them = rng.d6();
      if (me > them) { gainGold(k, bet); log(s, `${k.name} throws ${me} against ${them} and wins ${bet} gold!`); }
      else if (me < them) { k.gold -= bet; log(s, `${k.name} throws ${me} against ${them} and loses ${bet} gold.`); }
      else log(s, `${k.name} and the drovers both throw ${me}. The bet is pushed.`);
      break;
    }
    case 'traveler':
      if (index === 0) {
        k.gold -= 10;
        const pool = ITEMS.filter((i) => i.kind === 'consumable' && i.tier <= 2);
        log(s, `${k.name} helps the traveler. ${awardItem(k, rng.pick(pool))}`);
      } else log(s, `${k.name} rides past.`);
      break;
    case 'wisp':
      if (index === 0) {
        if (rng.float() < 0.5) {
          const options = reachableNodes(k.pos, 99).filter((id) => ['village', 'ruins', 'lair'].includes(node(id).type));
          const to = rng.pick(options);
          k.pos = to;
          log(s, `The wisp leads ${k.name} through the fog to ${node(to).name}!`);
        } else {
          k.hp = Math.max(1, k.hp - 6);
          log(s, `${k.name} is lost in the fog and stumbles through brambles (-6 HP).`);
        }
      } else log(s, `${k.name} keeps to the road.`);
      break;
    case 'hermit':
      if (index === 0) {
        k.gold -= 40;
        log(s, `The hermit drills ${k.name} until dawn.`);
        addRenown(s, k);
      } else log(s, `${k.name} declines the hermit's offer.`);
      break;
  }
  afterEncounter(s);
}

// ---------------------------------------------------------------- combat

function startCombat(
  s: GameState,
  kind: Combat['kind'],
  a: number,
  b: number | null,
  monsterId: string | null,
): void {
  const ka = s.players[a];
  const ea = effectiveStats(ka);
  let monster: MonsterFighter | null = null;
  let maxStaminaB: number;
  if (monsterId) {
    monster = monsterStatsForDay(monsterId, s.day, ea.foeAttack);
    maxStaminaB = getMonster(monsterId).stamina;
  } else {
    maxStaminaB = effectiveStats(s.players[b!]).maxStamina;
  }
  s.combat = {
    kind, a, b, monster, monsterId,
    round: 0,
    staminaA: ea.maxStamina,
    staminaB: maxStaminaB,
    maxStaminaA: ea.maxStamina,
    maxStaminaB,
    choiceA: null, choiceB: null, lastA: null, lastB: null, lastWinner: null,
    perfectA: false, perfectB: false, lastPerfect: null,
    roundLog: [],
    over: false,
    outcome: null,
  };
  s.stage = 'combat';
  if (monster) {
    const m = moonEffect(s.day);
    log(s, `${monster.name} (HP ${monster.maxHp}, ATK ${monster.attack}, DEF ${monster.defense}) - ${m.text}.`);
  } else {
    log(s, `${ka.name} challenges ${s.players[b!].name}!`);
  }
}

const CHOICE_LABEL: Record<Choice, string> = { strike: 'Strike', guard: 'Guard', feint: 'Feint' };

function playRound(s: GameState): void {
  const c = s.combat!;
  const rng = new Rng(s);
  const { a, b } = combatFighters(s);
  const ca = c.choiceA!;
  const cb = c.choiceB!;
  const ka = s.players[c.a];
  const nameB = c.monster ? c.monster.name : s.players[c.b!].name;
  const res = resolveRound(a, b, ca, cb, rng);
  // a perfectly timed read (arena) makes the winning blow land harder
  const perfectSide = res.winner === 'a' && c.perfectA ? 'a' : res.winner === 'b' && c.perfectB ? 'b' : null;
  if (perfectSide === 'a') res.dmgToB = Math.round(res.dmgToB * CONFIG.perfectMult);
  if (perfectSide === 'b') res.dmgToA = Math.round(res.dmgToA * CONFIG.perfectMult);
  c.lastPerfect = perfectSide;
  c.perfectA = false;
  c.perfectB = false;

  const lines: string[] = [`${ka.name}: ${CHOICE_LABEL[ca]}   ${nameB}: ${CHOICE_LABEL[cb]}`];
  if (res.winner === 'tie') lines.push('Same move - both trade blows.');
  else lines.push(`${res.winner === 'a' ? ka.name : nameB} wins the exchange (${perfectSide ? 'PERFECT read: ' : ''}double damage${perfectSide ? ' x' + CONFIG.perfectMult : ''}).`);
  if (res.dmgToB > 0) lines.push(`${ka.name} deals ${res.dmgToB} to ${nameB} (d6=${res.rollA}).`);
  if (res.dmgToA > 0) lines.push(`${nameB} deals ${res.dmgToA} to ${ka.name} (d6=${res.rollB}).`);

  // item usage stats
  for (const k of [ka, c.b !== null ? s.players[c.b] : null]) {
    if (!k) continue;
    if (k.weapon) s.stats.itemUse[k.weapon] = (s.stats.itemUse[k.weapon] ?? 0) + 1;
    if (k.armor) s.stats.itemUse[k.armor] = (s.stats.itemUse[k.armor] ?? 0) + 1;
  }

  const hpA0 = ka.hp;
  const hpB0 = combatHp(s, 'b').hp;
  ka.hp = Math.max(0, ka.hp - res.dmgToA);
  if (c.monster) c.monster.hp = Math.max(0, c.monster.hp - res.dmgToB);
  else s.players[c.b!].hp = Math.max(0, s.players[c.b!].hp - res.dmgToB);
  c.staminaA = res.staminaA;
  c.staminaB = res.staminaB;
  c.round += 1;
  c.lastA = ca;
  c.lastB = cb;
  c.lastWinner = res.winner;
  c.choiceA = null;
  c.choiceB = null;

  const hpA = ka.hp;
  const hpB = combatHp(s, 'b').hp;
  if (hpA <= 0 || hpB <= 0) {
    let winner: 'a' | 'b';
    if (hpA <= 0 && hpB <= 0) {
      // simultaneous knockout: higher HP going into the round survives with 1 HP; a tie favours side b
      winner = hpA0 > hpB0 ? 'a' : 'b';
      lines.push('Both fall at once - the sturdier fighter barely stays standing.');
    } else winner = hpB <= 0 ? 'a' : 'b';
    const setHp = (side: 'a' | 'b', v: number) => {
      if (side === 'a') ka.hp = v;
      else if (c.monster) c.monster.hp = v;
      else s.players[c.b!].hp = v;
    };
    setHp(winner, Math.max(1, combatHp(s, winner).hp));
    setHp(winner === 'a' ? 'b' : 'a', 0);
    c.over = true;
    c.outcome = winner;
    lines.push(`${winner === 'a' ? ka.name : nameB} is victorious!`);
  }
  c.roundLog = lines;
}

function clearCombatBuffs(k: Knight): void {
  k.buffs.attack = 0;
  k.buffs.defense = 0;
  k.buffs.stamina = 0;
  clampHp(k);
}

/** Apply death: penalties, scar, respawn flag. goldTo / sealTo name a PvP winner who intercepts a penalty. */
function killKnight(s: GameState, id: number, opts: { goldTo?: number; sealTo?: number } = {}): void {
  const rng = new Rng(s);
  const k = s.players[id];
  k.deaths += 1;
  k.downed = true;
  k.hp = 0;
  const lost = Math.floor(k.gold * CONFIG.deathGoldLoss);
  k.gold -= lost;
  const notes: string[] = [`${k.name} falls!`];
  if (lost > 0) {
    if (opts.goldTo !== undefined) {
      gainGold(s.players[opts.goldTo], lost);
      notes.push(`${s.players[opts.goldTo].name} takes ${lost} gold.`);
    } else notes.push(`${lost} gold is lost.`);
  }
  if (k.seals.length > 0) {
    const takeable = opts.sealTo !== undefined ? stealableSeals(s, opts.sealTo, id) : [];
    const sealIdx = rng.pick(takeable.length > 0 ? takeable : k.seals);
    k.seals.splice(k.seals.indexOf(sealIdx), 1);
    if (takeable.length > 0 && opts.sealTo !== undefined) {
      s.players[opts.sealTo].seals.push(sealIdx);
      notes.push(`${s.players[opts.sealTo].name} takes Seal ${sealIdx + 1}.`);
    } else notes.push(`Seal ${sealIdx + 1} returns to its Lair.`);
  }
  const have = new Set(k.scars);
  const candidates = SCARS.filter((x) => !have.has(x.id));
  const scar = rng.pick(candidates.length ? candidates : SCARS);
  k.scars.push(scar.id);
  notes.push(`Gains the scar "${scar.name}" (${scar.desc}).`);
  k.pos = homeNode(k.seat);
  k.buffs = { attack: 0, defense: 0, stamina: 0, move: 0, freeFlee: false };
  log(s, notes.join(' '));
}

function finishCombat(s: GameState): void {
  const c = s.combat!;
  const ka = s.players[c.a];
  if (c.kind === 'pvp') {
    const kb = s.players[c.b!];
    clearCombatBuffs(ka);
    clearCombatBuffs(kb);
    const winner = c.outcome === 'a' ? ka : kb;
    const loser = c.outcome === 'a' ? kb : ka;
    winner.kills += 1;
    winner.duelsWon += 1;
    addRenown(s, winner);
    s.pendingLoot = { winner: winner.id, loser: loser.id };
    s.combat = null;
    s.stage = 'pvpLoot';
    log(s, `${winner.name} defeats ${loser.name} and may claim a Seal or half their gold.`);
    return;
  }
  clearCombatBuffs(ka);
  if (c.outcome === 'b') {
    log(s, `${ka.name} is defeated by ${c.monster!.name}.`);
    killKnight(s, ka.id);
    s.combat = null;
    s.stage = 'turnEnd';
    return;
  }
  ka.kills += 1;
  if (c.kind === 'wild') {
    const def = getMonster(c.monsterId!);
    const rng = new Rng(s);
    const gold = rng.int(def.goldMin, def.goldMax);
    gainGold(ka, gold);
    addRenown(s, ka);
    const item = rng.float() < 0.6 ? randomLoot(s, def.lootTier) : null;
    log(s, `${ka.name} defeats the ${def.name}! +${gold} gold.${item ? ' ' + awardItem(ka, item) : ''}`);
    afterEncounter(s);
    return;
  }
  if (c.kind === 'guardian') {
    s.winner = ka.id;
    s.endReason = 'sanctum';
    s.stage = 'gameOver';
    s.combat = null;
    log(s, `${ka.name} slays the Hollow Warden and claims the Sanctum! VICTORY.`);
    return;
  }
  const nd = node(ka.pos);
  const def = getMonster(c.monsterId!);
  const rng = new Rng(s);
  const gold = rng.int(def.goldMin, def.goldMax) + SEAL_GOLD_BONUS;
  gainGold(ka, gold);
  ka.seals.push(nd.seal!);
  addRenown(s, ka);
  const item = randomLoot(s, def.lootTier);
  log(s, `${ka.name} slays ${def.name}! Seal ${nd.seal! + 1} claimed, +${gold} gold. ${awardItem(ka, item)}`);
  afterEncounter(s);
}

// ---------------------------------------------------------------- queries (used by UI, bot and reducer)

/** Why a knight cannot buy `itemId` right now, or null if the purchase is fine. */
export function buyCheck(k: Knight, itemId: string): string | null {
  const nd = node(k.pos);
  if (!nd.stock || !nd.stock.includes(itemId)) return 'Not sold here';
  const item = getItem(itemId);
  if (k.gold < shopPrice(k, item.price)) return 'Not enough gold';
  if (item.kind === 'consumable') return k.consumables.length >= 3 ? 'Pack is full' : null;
  const cur = item.kind === 'weapon' ? k.weapon : k.armor;
  return (item.bonus ?? 0) > (cur ? getItem(cur).bonus ?? 0 : -1) ? null : 'No upgrade';
}

/** How much healing the knight can buy in a village and what it costs. */
export function healQuote(k: Knight): { hp: number; cost: number } {
  const missing = effectiveStats(k).maxHp - k.hp;
  const unit = (CONFIG.healCostPerHp * (100 + effectiveStats(k).shopPct)) / 100;
  const hp = Math.max(0, Math.min(missing, Math.floor(k.gold / unit)));
  return { hp, cost: Math.ceil(hp * unit) };
}

/**
 * The move the monster will make this round if side a acts now. Exact, because the monster draws its
 * move from the RNG before anything else when side a chooses. The arena uses it to telegraph.
 */
export function previewMonsterChoice(s: GameState): Choice | null {
  const c = s.combat;
  if (!c || c.over || c.kind === 'pvp' || !c.monsterId) return null;
  const holder = { rng: s.rng };
  return monsterChoose(
    getMonster(c.monsterId),
    combatFighters(s).b,
    { round: c.round, lastSelf: c.lastB, lastOther: c.lastA, lastWinner: c.lastWinner },
    new Rng(holder),
  );
}

export function canFlee(s: GameState): boolean {
  const c = s.combat;
  return !!c && !c.over && c.kind !== 'pvp' && c.round === 0 && c.choiceA === null;
}

// ---------------------------------------------------------------- reducer

function need(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new IllegalActionError(msg);
}

export function applyAction(state: GameState, action: Action): GameState {
  const s = clone(state);
  need(s.stage !== 'gameOver', 'game is over');
  const k = currentKnight(s);
  const rng = new Rng(s);

  switch (action.type) {
    case 'useItem': {
      const who = s.players[action.who ?? s.current];
      need(!!who, 'no such knight');
      const inCombat = s.stage === 'combat' && !!s.combat && !s.combat.over;
      if (inCombat) {
        const c = s.combat!;
        const side = who.id === c.a ? 'a' : who.id === c.b ? 'b' : null;
        need(side !== null, 'not in this fight');
        need(side === 'a' ? c.choiceA === null : c.choiceB === null, 'already chose this round');
      } else {
        need(s.stage === 'roll' && who.id === s.current, 'cannot use items now');
      }
      const id = who.consumables[action.slot];
      need(!!id, 'empty slot');
      const eff = getItem(id).effect!;
      who.consumables.splice(action.slot, 1);
      s.stats.itemUse[id] = (s.stats.itemUse[id] ?? 0) + 1;
      const notes: string[] = [];
      if (eff.heal) {
        const before = who.hp;
        who.hp = Math.min(effectiveStats(who).maxHp, who.hp + eff.heal);
        notes.push(`heals ${who.hp - before} HP`);
      }
      if (eff.attack) { who.buffs.attack += eff.attack; notes.push(`+${eff.attack} Attack`); }
      if (eff.defense) { who.buffs.defense += eff.defense; notes.push(`+${eff.defense} Defense`); }
      if (eff.stamina) {
        who.buffs.stamina += eff.stamina;
        notes.push(`+${eff.stamina} max Stamina`);
        if (inCombat) {
          const c = s.combat!;
          if (who.id === c.a) { c.maxStaminaA += eff.stamina; c.staminaA += eff.stamina; }
          else { c.maxStaminaB += eff.stamina; c.staminaB += eff.stamina; }
        }
      }
      if (eff.move) { who.buffs.move += eff.move; notes.push(`+${eff.move} to next move`); }
      if (eff.freeFlee) { who.buffs.freeFlee = true; notes.push('next flee is free'); }
      log(s, `${who.name} uses ${getItem(id).name}: ${notes.join(', ')}.`);
      return s;
    }

    case 'roll': {
      need(s.stage === 'roll', 'not rolling now');
      const e = effectiveStats(k);
      const base = rng.d6();
      const total = Math.max(1, base + e.move + k.buffs.move);
      k.buffs.move = 0;
      s.moveRoll = total;
      s.stage = 'move';
      log(s, `${k.name} rolls a ${base}${total !== base ? ` (${total} with modifiers)` : ''}.`);
      return s;
    }

    case 'move': {
      need(s.stage === 'move', 'not moving now');
      need(node(action.to) !== undefined, 'bad node');
      need(distancesFrom(k.pos)[action.to] <= s.moveRoll, 'too far');
      if (action.to !== k.pos) {
        k.pos = action.to;
        log(s, `${k.name} moves to ${node(action.to).name}.`);
      } else log(s, `${k.name} holds position at ${node(k.pos).name}.`);
      resolveNode(s);
      return s;
    }

    case 'buy': {
      need(s.stage === 'shop', 'not in a shop');
      const why = buyCheck(k, action.itemId);
      need(why === null, why ?? '');
      const item = getItem(action.itemId);
      const price = shopPrice(k, item.price);
      if (item.kind === 'consumable') k.consumables.push(item.id);
      else {
        const cur = item.kind === 'weapon' ? k.weapon : k.armor;
        if (cur) k.gold += sellValue(getItem(cur));
        if (item.kind === 'weapon') k.weapon = item.id;
        else k.armor = item.id;
      }
      k.gold -= price;
      log(s, `${k.name} buys ${item.name} for ${price}g.`);
      return s;
    }

    case 'heal': {
      need(s.stage === 'shop', 'not in a shop');
      const q = healQuote(k);
      need(q.hp > 0, 'nothing to heal or cannot afford it');
      k.gold -= q.cost;
      k.hp += q.hp;
      log(s, `${k.name} pays ${q.cost}g for ${q.hp} HP of healing.`);
      return s;
    }

    case 'leave': {
      need(s.stage === 'shop' || s.stage === 'pvpOffer', 'nothing to leave');
      if (s.stage === 'shop') afterEncounter(s);
      else {
        s.challengeable = [];
        s.stage = 'turnEnd';
      }
      return s;
    }

    case 'flee': {
      need(canFlee(s), 'cannot flee now');
      const cost = fleeCost(k);
      k.gold -= cost;
      k.buffs.freeFlee = false;
      clearCombatBuffs(k);
      log(s, `${k.name} flees${cost ? `, dropping ${cost} gold` : ' unharmed'}.`);
      afterEncounter(s);
      return s;
    }

    case 'challenge': {
      need(s.stage === 'pvpOffer', 'no challenge possible');
      need(s.challengeable.includes(action.target), 'target not available');
      startCombat(s, 'pvp', k.id, action.target, null);
      s.challengeable = [];
      return s;
    }

    case 'choose': {
      need(s.stage === 'combat' && !!s.combat && !s.combat.over, 'no round to play');
      const c = s.combat!;
      const { a, b } = combatFighters(s);
      if (action.side === 'a') {
        need(c.choiceA === null, 'already chosen');
        need(isAllowed(a, action.choice), 'not enough stamina');
        c.choiceA = action.choice;
        c.perfectA = !!action.perfect;
      } else {
        need(c.kind === 'pvp', 'side b is controlled by the game');
        need(c.choiceB === null, 'already chosen');
        need(isAllowed(b, action.choice), 'not enough stamina');
        c.choiceB = action.choice;
        c.perfectB = !!action.perfect;
      }
      if (c.kind !== 'pvp' && c.choiceA) {
        c.choiceB = monsterChoose(
          getMonster(c.monsterId!),
          b,
          { round: c.round, lastSelf: c.lastB, lastOther: c.lastA, lastWinner: c.lastWinner },
          rng,
        );
      }
      if (c.choiceA && c.choiceB) playRound(s);
      return s;
    }

    case 'continue': {
      need(s.stage === 'combat' && !!s.combat && s.combat.over, 'combat not finished');
      finishCombat(s);
      return s;
    }

    case 'pvpLoot': {
      need(s.stage === 'pvpLoot' && !!s.pendingLoot, 'no loot to claim');
      const { winner, loser } = s.pendingLoot!;
      if (action.take === 'seal') {
        need(stealableSeals(s, winner, loser).length > 0, 'rival holds no Seal you lack');
        killKnight(s, loser, { sealTo: winner });
      } else killKnight(s, loser, { goldTo: winner });
      s.pendingLoot = null;
      s.stage = 'turnEnd';
      return s;
    }

    case 'eventChoice': {
      need(s.stage === 'event' && !!s.event, 'no event');
      const why = eventOptionBlock(s, action.index);
      need(why === null, why ?? '');
      resolveEvent(s, action.index);
      return s;
    }

    case 'chooseBoon': {
      need(s.stage === 'levelUp' && !!s.boonChoices && s.boonChoices.includes(action.id), 'not on offer');
      k.boons.push(action.id);
      k.pendingBoons -= 1;
      clampHp(k);
      if (getBoon(action.id).effect.maxHp) k.hp += getBoon(action.id).effect.maxHp!;
      clampHp(k);
      log(s, `${k.name} levels up: ${getBoon(action.id).name} (${getBoon(action.id).desc}).`);
      s.boonChoices = null;
      if (k.pendingBoons > 0) offerBoons(s);
      else s.stage = 'roll';
      return s;
    }

    case 'endTurn': {
      need(s.stage === 'turnEnd', 'turn is not over');
      advanceTurn(s);
      return s;
    }
  }
}
