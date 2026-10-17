// Simple heuristic bot. Pure: reads a state, returns the next Action for whoever must act.
import { CONFIG } from '../data/balance';
import { getItem } from '../data/items';
import { getMonster, GUARDIAN } from '../data/monsters';
import { allowedChoices } from './combat';
import {
  actorId, combatFighters, eventOptionBlock, knightFighter, monsterStatsForDay, sealCount, stealableSeals,
} from './game';
import { SANCTUM_ID, distancesFrom, node, reachable } from './graph';
import { daysLeftInPhase, daysUntilFull, isSanctumOpen } from './moon';
import { nextFloat } from './rng';
import { effectiveStats, shopPrice } from './stats';
import type { Action, Choice, GameState, Knight } from './types';

const dpr = (off: number, def: number) => Math.max(1, off + 3.5 - def);

/** >1 means "I probably win". Compares rounds-to-die vs rounds-to-kill under even play. */
function advantage(myHp: number, my: { offense: number; defense: number }, hisHp: number, his: { offense: number; defense: number }): number {
  return myHp / dpr(his.offense, my.defense) / (hisHp / dpr(my.offense, his.defense));
}

function advVsMonster(k: Knight, monsterId: string, day: number): number {
  const m = monsterStatsForDay(monsterId, day);
  return advantage(k.hp, knightFighter(k), m.hp, { offense: m.attack, defense: m.defense });
}

function advVsKnight(k: Knight, o: Knight): number {
  return advantage(k.hp, knightFighter(k), o.hp, knightFighter(o));
}

/** Deterministic pseudo-random float derived from the state (bots must not mutate state). */
function noise(s: GameState, salt: number): number {
  return nextFloat((s.rng ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0)[0];
}

function healSlot(k: Knight): number {
  let best = -1;
  let bestHeal = 0;
  k.consumables.forEach((id, i) => {
    const h = getItem(id).effect?.heal ?? 0;
    if (h > bestHeal) { bestHeal = h; best = i; }
  });
  return best;
}

function buffSlot(k: Knight): number {
  return k.consumables.findIndex((id) => {
    const e = getItem(id).effect!;
    return !!(e.attack || e.defense || e.stamina);
  });
}

/** `side` forces which combat side the bot decides for (used by the UI for duels with hidden choices). */
export function botAction(s: GameState, side?: 'a' | 'b'): Action {
  const k = s.players[actorId(s)];
  switch (s.stage) {
    case 'roll': {
      const hs = healSlot(k);
      if (hs >= 0 && k.hp <= effectiveStats(k).maxHp * 0.5) return { type: 'useItem', slot: hs };
      const bs = k.consumables.findIndex((id) => getItem(id).effect?.move);
      if (bs >= 0 && sealCount(s, k.id) >= CONFIG.sealsToEnter && isSanctumOpen(s.day)) return { type: 'useItem', slot: bs };
      return { type: 'roll' };
    }
    case 'move':
      return { type: 'move', to: chooseMove(s, k) };
    case 'shop':
      return shopAction(k);
    case 'combat':
      return combatAction(s, side);
    case 'pvpOffer': {
      const maxHp = effectiveStats(k).maxHp;
      const closeToWin = sealCount(s, k.id) >= CONFIG.sealsToEnter;
      let best: { id: number; score: number } | null = null;
      for (const id of s.challengeable) {
        const o = s.players[id];
        const adv = advVsKnight(k, o);
        const need = (closeToWin ? 2.5 : 1.8) + (stealableSeals(s, k.id, id).length > 0 ? 0 : 1.2);
        if (adv >= need && k.hp >= maxHp * 0.7) {
          const score = adv + sealCount(s, id) * 0.5;
          if (!best || score > best.score) best = { id, score };
        }
      }
      return best ? { type: 'challenge', target: best.id } : { type: 'leave' };
    }
    case 'pvpLoot': {
      const loser = s.pendingLoot!.loser;
      return { type: 'pvpLoot', take: stealableSeals(s, s.pendingLoot!.winner, loser).length > 0 ? 'seal' : 'gold' };
    }
    case 'event':
      return { type: 'eventChoice', index: eventChoice(s, k) };
    case 'levelUp':
      return { type: 'chooseBoon', id: chooseBoon(s, k) };
    case 'turnEnd':
      return { type: 'endTurn' };
    default:
      throw new Error('bot has nothing to do');
  }
}

// ---------------------------------------------------------------- events and level-ups

function eventChoice(s: GameState, k: Knight): number {
  const e = s.event!;
  const ok = (i: number) => eventOptionBlock(s, i) === null;
  const hpRatio = k.hp / effectiveStats(k).maxHp;
  switch (e.id) {
    case 'merchant': {
      const item = getItem(String(e.data.item));
      const cur = item.kind === 'weapon' ? k.weapon : item.kind === 'armor' ? k.armor : null;
      const upgrade = item.kind === 'consumable' ? k.consumables.length < 3 : (item.bonus ?? 0) > (cur ? getItem(cur).bonus ?? 0 : -1);
      return upgrade && ok(0) && k.gold - Number(e.data.price) >= 10 ? 0 : 1;
    }
    case 'ambush': {
      const adv = advVsMonster(k, String(e.data.monster), s.day);
      return adv >= 1 && hpRatio >= 0.45 ? 0 : 1;
    }
    case 'shrine':
      return hpRatio < 0.75 ? 0 : 1;
    case 'dice':
      return k.gold >= 80 && ok(0) ? 0 : 2;
    case 'traveler':
      return k.gold >= 40 && k.consumables.length < 3 ? 0 : 1;
    case 'wisp':
      return hpRatio > 0.6 && sealCount(s, k.id) < CONFIG.sealsToEnter ? 0 : 1;
    case 'hermit':
      return k.gold >= 90 ? 0 : 1;
    default:
      return e.options.length - 1;
  }
}

function chooseBoon(s: GameState, k: Knight): string {
  const pref = ['might', 'bulwark', 'vigor', 'endurance', 'secondWind', 'feinter', 'fleetfoot', 'haggler'];
  const offers = s.boonChoices!;
  void k;
  return [...offers].sort((a, b) => pref.indexOf(a) - pref.indexOf(b))[0];
}

// ---------------------------------------------------------------- movement

function chooseMove(s: GameState, k: Knight): number {
  const e = effectiveStats(k);
  const hpRatio = k.hp / e.maxHp;
  const seals = sealCount(s, k.id);
  const cands = reachable(k.pos, s.moveRoll);
  const upgradeWanted = k.gold >= 30;

  // pick a long-term goal to walk toward
  const dFrom = distancesFrom(k.pos);
  let goal: number | null = null;
  if (seals >= CONFIG.sealsToEnter) goal = SANCTUM_ID;
  else {
    let bestD = Infinity;
    for (const n of lairsFree(k)) {
      const adv = advVsMonster(k, n.monster!, s.day);
      if (adv >= 1.1 && dFrom[n.id] < bestD) { bestD = dFrom[n.id]; goal = n.id; }
    }
  }
  const dGoal = goal !== null ? distancesFrom(goal) : null;

  let best = cands[0];
  let bestScore = -Infinity;
  for (const id of cands) {
    const nd = node(id);
    let score = 0;
    switch (nd.type) {
      case 'lair': {
        if (k.seals.includes(nd.seal!)) { score = 2; break; }
        const adv = advVsMonster(k, nd.monster!, s.day);
        score = adv >= 1.1 && hpRatio >= 0.6 ? 100 + adv * 5 : -20;
        break;
      }
      case 'sanctum': {
        if (seals >= CONFIG.sealsToEnter) {
          if (isSanctumOpen(s.day)) {
            const adv = advVsMonster(k, GUARDIAN.id, s.day);
            const lastChance = daysLeftInPhase(s.day) <= 1;
            score = adv >= (lastChance ? 0.3 : 0.45) && hpRatio >= (lastChance ? 0.5 : 0.7) ? 200 : 12;
          } else score = daysUntilFull(s.day) <= 2 ? 25 : 8;
        } else score = 1;
        break;
      }
      case 'village':
        score = hpRatio < 0.65 && k.gold >= 8 ? 60 : upgradeWanted ? 45 : 8;
        break;
      case 'home':
        score = nd.seat === k.seat && hpRatio < 0.6 ? 50 : 3;
        break;
      case 'ruins':
        score = s.day >= (s.ruinsReady[nd.id] ?? 0) ? (hpRatio > 0.5 ? 30 : 12) : 2;
        break;
      default:
        score = 5;
    }
    // rivals standing here
    for (const o of s.players) {
      if (o.id === k.id || o.downed || o.pos !== id) continue;
      const adv = advVsKnight(k, o);
      score += adv >= 1.8 && hpRatio >= 0.7 && stealableSeals(s, k.id, o.id).length > 0 ? 20 + sealCount(s, o.id) * 15 : -10;
    }
    if (dGoal) score -= dGoal[id] * 3;
    score += noise(s, id) * 0.5;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

function lairsFree(k: Knight) {
  return [5, 6, 7, 8].map((i) => node(i)).filter((n) => n.type === 'lair' && !k.seals.includes(n.seal!));
}

// ---------------------------------------------------------------- shop

function shopAction(k: Knight): Action {
  const nd = node(k.pos);
  const stock = (nd.stock ?? []).map(getItem);
  const e = effectiveStats(k);
  const missing = e.maxHp - k.hp;
  if (missing > 0 && k.hp < e.maxHp * 0.5 && k.gold >= 5) return { type: 'heal' };

  // best equipment upgrade we can afford
  let pick: { id: string; gain: number } | null = null;
  for (const it of stock) {
    if (it.kind === 'consumable') continue;
    const cur = it.kind === 'weapon' ? k.weapon : k.armor;
    const gain = (it.bonus ?? 0) - (cur ? getItem(cur).bonus ?? 0 : -1);
    const price = shopPrice(k, it.price);
    if (gain > 0 && price <= k.gold && (!pick || gain > pick.gain)) pick = { id: it.id, gain };
  }
  if (pick) return { type: 'buy', itemId: pick.id };

  if (missing > 0 && k.hp < e.maxHp * 0.85 && k.gold >= 5) return { type: 'heal' };

  if (k.consumables.length < 2) {
    for (const id of ['potionL', 'potionS', 'whetstone', 'tonic', 'smoke']) {
      const it = stock.find((x) => x.id === id);
      if (it && shopPrice(k, it.price) <= k.gold - 10) return { type: 'buy', itemId: id };
    }
  }
  return { type: 'leave' };
}

// ---------------------------------------------------------------- combat

function combatAction(s: GameState, forced?: 'a' | 'b'): Action {
  const c = s.combat!;
  if (c.over) return { type: 'continue' };
  const side: 'a' | 'b' = forced ?? (c.choiceA === null ? 'a' : 'b');
  const k = side === 'a' ? s.players[c.a] : s.players[c.b!];
  const { a, b } = combatFighters(s);
  const me = side === 'a' ? a : b;
  const them = side === 'a' ? b : a;

  if (side === 'a' && c.round === 0 && c.kind !== 'pvp') {
    const m = c.monster!;
    const adv = advantage(k.hp, me, m.hp, them);
    if (adv < (c.kind === 'guardian' ? 0.4 : 0.7) && k.hp < effectiveStats(k).maxHp * 0.9) {
      const smoke = k.consumables.findIndex((id) => getItem(id).effect?.freeFlee);
      if (smoke >= 0 && !k.buffs.freeFlee) return { type: 'useItem', slot: smoke, who: k.id };
      return { type: 'flee' };
    }
  }
  // items before choosing
  const maxHp = effectiveStats(k).maxHp;
  const hs = healSlot(k);
  if (hs >= 0 && k.hp <= maxHp * 0.4) return { type: 'useItem', slot: hs, who: k.id };
  if (c.round === 0) {
    const bs = buffSlot(k);
    if (bs >= 0) return { type: 'useItem', slot: bs, who: k.id };
  }

  const allowed = allowedChoices(me);
  let choice: Choice;
  const r = noise(s, c.round * 7 + (side === 'a' ? 1 : 2));
  if (r < 0.1) choice = allowed[Math.floor(noise(s, 99) * allowed.length)];
  else if (c.kind === 'pvp') {
    const pr = allowed.map((x) => ({ strike: 0.4, guard: 0.3, feint: 0.3 }[x]));
    let t = noise(s, 55) * pr.reduce((x, y) => x + y, 0);
    choice = allowed[allowed.length - 1];
    for (let i = 0; i < allowed.length; i++) { t -= pr[i]; if (t < 0) { choice = allowed[i]; break; } }
  } else {
    choice = bestVsMonster(s, me, them, allowed);
  }
  return { type: 'choose', side, choice };
}

function bestVsMonster(s: GameState, me: ReturnType<typeof combatFighters>['a'], them: ReturnType<typeof combatFighters>['b'], allowed: Choice[]): Choice {
  const c = s.combat!;
  const def = getMonster(c.monsterId!);
  const theirAllowed = allowedChoices(them);
  const p: Record<Choice, number> = { strike: 0, guard: 0, feint: 0 };
  if (c.round === 0 && def.opener && theirAllowed.includes(def.opener)) p[def.opener] = 1;
  else {
    const tw = theirAllowed.reduce((t, x) => t + def.weights[x], 0);
    for (const x of theirAllowed) p[x] = def.weights[x] / tw;
  }
  const myD = dpr(me.offense, them.defense);
  const hisD = dpr(them.offense, me.defense);
  const beat: Record<Choice, Choice> = { strike: 'feint', feint: 'guard', guard: 'strike' };
  let best = allowed[0];
  let bestEv = -Infinity;
  for (const x of allowed) {
    let ev = 0;
    for (const m of ['strike', 'guard', 'feint'] as Choice[]) {
      if (p[m] === 0) continue;
      const u = x === m ? myD - hisD : beat[x] === m ? 2 * myD : -2 * hisD;
      ev += p[m] * u;
    }
    const cost = x === 'strike' ? me.strikeCost : x === 'feint' ? me.feintCost : 0;
    if (x !== 'guard' && me.stamina - cost < me.strikeCost) ev -= 1; // avoid running dry
    if (x === 'guard' && me.stamina < me.maxStamina) ev += 0.5;
    if (ev > bestEv) { bestEv = ev; best = x; }
  }
  return best;
}
