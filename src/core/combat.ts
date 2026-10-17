import type { Choice, MonsterDef } from './types';
import type { Rng } from './rng';

/** What the combat maths needs to know about one side. */
export interface Fighter {
  offense: number; // Attack + weapon bonus
  defense: number; // Defense + armor bonus
  stamina: number;
  maxStamina: number;
  strikeCost: number;
  feintCost: number;
  guardRegen: number;
}

/** Strike beats Feint, Feint beats Guard, Guard beats Strike. */
const BEATS: Record<Choice, Choice> = { strike: 'feint', feint: 'guard', guard: 'strike' };

export function beats(a: Choice, b: Choice): boolean {
  return BEATS[a] === b;
}

/** The choice that beats `c`. */
export function counterTo(c: Choice): Choice {
  return (Object.keys(BEATS) as Choice[]).find((k) => BEATS[k] === c)!;
}

export function matchup(a: Choice, b: Choice): 'a' | 'b' | 'tie' {
  if (a === b) return 'tie';
  return beats(a, b) ? 'a' : 'b';
}

export function choiceCost(c: Choice, f: Pick<Fighter, 'strikeCost' | 'feintCost'>): number {
  return c === 'strike' ? f.strikeCost : c === 'feint' ? f.feintCost : 0;
}

export function allowedChoices(f: Fighter): Choice[] {
  const out: Choice[] = ['guard'];
  if (f.stamina >= f.strikeCost) out.unshift('strike');
  if (f.stamina >= f.feintCost) out.push('feint');
  return out;
}

export function isAllowed(f: Fighter, c: Choice): boolean {
  return allowedChoices(f).includes(c);
}

/** Stamina after playing `c`. Strike/Feint spend, Guard restores (capped). */
export function staminaAfter(f: Fighter, c: Choice): number {
  if (c === 'guard') return Math.min(f.maxStamina, f.stamina + f.guardRegen);
  return f.stamina - choiceCost(c, f);
}

/** Base hit: attacker offense + d6 - defender defense, minimum 1. */
export function baseDamage(offense: number, defense: number, d6: number): number {
  return Math.max(1, offense + d6 - defense);
}

export interface RoundResult {
  winner: 'a' | 'b' | 'tie';
  dmgToA: number;
  dmgToB: number;
  rollA: number | null;
  rollB: number | null;
  staminaA: number;
  staminaB: number;
}

export function resolveRound(a: Fighter, b: Fighter, ca: Choice, cb: Choice, rng: Rng): RoundResult {
  const winner = matchup(ca, cb);
  let dmgToA = 0;
  let dmgToB = 0;
  let rollA: number | null = null;
  let rollB: number | null = null;
  if (winner === 'a' || winner === 'tie') {
    rollA = rng.d6();
    dmgToB = baseDamage(a.offense, b.defense, rollA) * (winner === 'a' ? 2 : 1);
  }
  if (winner === 'b' || winner === 'tie') {
    rollB = rng.d6();
    dmgToA = baseDamage(b.offense, a.defense, rollB) * (winner === 'b' ? 2 : 1);
  }
  return { winner, dmgToA, dmgToB, rollA, rollB, staminaA: staminaAfter(a, ca), staminaB: staminaAfter(b, cb) };
}

/** Monster move selection: weighted pattern with an optional habit. */
export function monsterChoose(
  def: MonsterDef,
  fighter: Fighter,
  ctx: { round: number; lastSelf: Choice | null; lastOther: Choice | null; lastWinner: 'a' | 'b' | 'tie' | null },
  rng: Rng,
): Choice {
  const allowed = allowedChoices(fighter);
  if (ctx.round === 0 && def.opener && allowed.includes(def.opener)) return def.opener;
  // monster is side 'b'
  if (def.habit === 'adaptive' && ctx.lastOther && rng.float() < 0.5) {
    const c = counterTo(ctx.lastOther);
    if (allowed.includes(c)) return c;
  }
  if (def.habit === 'stubborn' && ctx.lastSelf && ctx.lastWinner !== 'a' && rng.float() < 0.6) {
    if (allowed.includes(ctx.lastSelf)) return ctx.lastSelf;
  }
  return rng.weighted(allowed, allowed.map((c) => def.weights[c]));
}
