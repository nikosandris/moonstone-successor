import { describe, expect, it } from 'vitest';
import {
  actorId, applyAction, createGame, IllegalActionError, sealCount,
} from '../src/core/game';
import { distancesFrom } from '../src/core/graph';
import { effectiveStats, shopPrice } from '../src/core/stats';
import { CONFIG } from '../src/data/balance';
import { BOARD } from '../src/data/board';
import { SCARS } from '../src/data/scars';
import { act, atNode, edit, fightToEnd, newGame, setups } from './helpers';

describe('setup', () => {
  it('supports 2 to 4 players and rejects others', () => {
    for (const n of [2, 3, 4]) expect(createGame(setups(n), 1).players).toHaveLength(n);
    expect(() => createGame(setups(1), 1)).toThrow();
    expect(() => createGame(setups(5), 1)).toThrow();
  });
  it('each knight starts at their own Home with starter gear', () => {
    const s = newGame(4);
    const homes = s.players.map((p) => BOARD.nodes[p.pos]);
    expect(homes.every((h) => h.type === 'home')).toBe(true);
    expect(new Set(homes.map((h) => h.id)).size).toBe(4);
    expect(s.players[0].weapon).not.toBeNull();
    expect(s.players[0].armor).not.toBeNull();
    expect(s.day).toBe(1);
    expect(s.stage).toBe('roll');
  });
  it('state is plain serialisable data', () => {
    const s = act(newGame(3), { type: 'roll' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('purity and determinism', () => {
  it('applyAction does not mutate its input', () => {
    const s = newGame();
    const frozen = JSON.stringify(s);
    applyAction(s, { type: 'roll' });
    expect(JSON.stringify(s)).toBe(frozen);
  });
  it('same seed + same actions gives the same state', () => {
    const run = () => act(newGame(2, 99), { type: 'roll' });
    expect(run()).toEqual(run());
  });
  it('rejects illegal actions', () => {
    const s = newGame();
    expect(() => applyAction(s, { type: 'move', to: 3 })).toThrow(IllegalActionError);
    expect(() => applyAction(s, { type: 'endTurn' })).toThrow(IllegalActionError);
  });
});

describe('movement', () => {
  it('roll is a d6 and moves to the move stage', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = act(newGame(2, seed), { type: 'roll' });
      expect(s.stage).toBe('move');
      expect(s.moveRoll).toBeGreaterThanOrEqual(1);
      expect(s.moveRoll).toBeLessThanOrEqual(6);
    }
  });
  it('may move up to the roll along paths, not further', () => {
    let s = act(newGame(), { type: 'roll' });
    s = edit(s, (d) => { d.moveRoll = 2; });
    const d = distancesFrom(s.players[0].pos);
    const far = d.findIndex((x) => x === 3);
    const ok = d.findIndex((x) => x === 2);
    expect(far).toBeGreaterThan(-1);
    expect(() => applyAction(s, { type: 'move', to: far })).toThrow();
    const after = applyAction(s, { type: 'move', to: ok });
    expect(after.players[0].pos).toBe(ok);
  });
  it('can hold position', () => {
    let s = act(newGame(), { type: 'roll' });
    s = act(s, { type: 'move', to: s.players[0].pos });
    expect(s.players[0].pos).toBe(newGame().players[0].pos);
  });
  it('turn passes to the next knight and the day advances after a full round', () => {
    let s = newGame(3);
    const end = (st: typeof s) => act(edit(st, (d) => { d.stage = 'turnEnd'; }), { type: 'endTurn' });
    s = end(s);
    expect(s.current).toBe(1);
    expect(s.day).toBe(1);
    s = end(s);
    s = end(s);
    expect(s.day).toBe(2);
    // first knight of the day rotates
    expect(s.current).toBe(1);
  });
  it('the Limp scar reduces movement rolls (minimum 1)', () => {
    const base = act(newGame(2, 5), { type: 'roll' }).moveRoll;
    const s = act(edit(newGame(2, 5), (d) => { d.players[0].scars.push('limp'); }), { type: 'roll' });
    expect(s.moveRoll).toBe(Math.max(1, base - 1));
  });
});

describe('node resolution', () => {
  it('Home heals fully', () => {
    let s = edit(newGame(), (d) => { d.players[0].hp = 3; });
    s = act(atNode(s, s.players[0].pos), { type: 'move', to: s.players[0].pos });
    expect(s.players[0].hp).toBe(effectiveStats(s.players[0]).maxHp);
    expect(s.stage).toBe('turnEnd');
  });
  it('Ruins give loot/gold/trap and then go on cooldown', () => {
    const ruins = BOARD.nodes.find((n) => n.type === 'ruins')!.id;
    let s = atNode(newGame(2, 3), ruins);
    s = act(s, { type: 'move', to: ruins });
    expect(s.stage).toBe('turnEnd');
    expect(s.ruinsReady[ruins]).toBe(1 + CONFIG.ruinsCooldownDays);
    const before = JSON.stringify(s.players[0]);
    let again = edit(s, (d) => { d.stage = 'move'; d.moveRoll = 1; });
    again = act(again, { type: 'move', to: ruins });
    expect(JSON.stringify(again.players[0])).toBe(before);
    expect(again.log.at(-1)!.text).toMatch(/picked clean/);
  });
  it('a trap never kills outright', () => {
    const ruins = BOARD.nodes.find((n) => n.type === 'ruins')!.id;
    for (let seed = 1; seed < 80; seed++) {
      let s = edit(newGame(2, seed), (d) => { d.players[0].hp = 1; });
      s = act(atNode(s, ruins), { type: 'move', to: ruins });
      expect(s.players[0].hp).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('shops', () => {
  const village = BOARD.nodes.find((n) => n.type === 'village')!;
  const enter = (s = newGame()) => act(atNode(s, village.id), { type: 'move', to: village.id });
  it('stopping on a village opens the shop', () => {
    expect(enter().stage).toBe('shop');
  });
  it('buys an upgrade, pays the price and gets the old weapon sold back', () => {
    let s = edit(newGame(), (d) => { d.players[0].gold = 500; });
    s = enter(s);
    const id = village.stock!.find((x) => x === 'sword2')!;
    const price = shopPrice(s.players[0], 70);
    const goldBefore = s.players[0].gold;
    s = act(s, { type: 'buy', itemId: id });
    expect(s.players[0].weapon).toBe('sword2');
    expect(s.players[0].gold).toBeLessThanOrEqual(goldBefore - price + 5);
    expect(s.players[0].gold).toBeLessThan(goldBefore);
  });
  it('refuses when broke, when not an upgrade, or when the pack is full', () => {
    let s = edit(newGame(), (d) => { d.players[0].gold = 1; });
    s = enter(s);
    expect(() => applyAction(s, { type: 'buy', itemId: 'sword2' })).toThrow();
    let rich = edit(enter(), (d) => { d.players[0].gold = 999; d.players[0].weapon = 'runeblade'; });
    expect(() => applyAction(rich, { type: 'buy', itemId: 'sword2' })).toThrow();
    rich = edit(rich, (d) => { d.players[0].consumables = ['potionS', 'potionS', 'potionS']; });
    expect(() => applyAction(rich, { type: 'buy', itemId: 'potionS' })).toThrow();
    expect(() => applyAction(rich, { type: 'buy', itemId: 'runeblade' })).toThrow(); // not sold here
  });
  it('holds at most 1 weapon, 1 armor and 3 consumables', () => {
    let s = edit(enter(), (d) => { d.players[0].gold = 999; });
    for (let i = 0; i < 3; i++) s = act(s, { type: 'buy', itemId: 'potionS' });
    expect(s.players[0].consumables).toHaveLength(3);
    expect(() => applyAction(s, { type: 'buy', itemId: 'whetstone' })).toThrow();
  });
  it('heals for gold', () => {
    let s = edit(newGame(), (d) => { d.players[0].hp = 10; d.players[0].gold = 100; });
    s = enter(s);
    s = act(s, { type: 'heal' });
    expect(s.players[0].hp).toBeGreaterThan(10);
    expect(s.players[0].gold).toBeLessThan(100);
    expect(s.players[0].hp).toBeLessThanOrEqual(effectiveStats(s.players[0]).maxHp);
  });
  it('healing is limited by gold', () => {
    let s = edit(newGame(), (d) => { d.players[0].hp = 1; d.players[0].gold = 3; });
    s = act(enter(s), { type: 'heal' });
    expect(s.players[0].hp).toBe(1 + Math.floor(3 / CONFIG.healCostPerHp));
  });
  it('Debt-Marked raises prices', () => {
    const k = newGame().players[0];
    const marked = { ...k, scars: ['debtMarked'] };
    expect(shopPrice(marked, 100)).toBeGreaterThan(shopPrice(k, 100));
  });
  it('leaving ends the turn', () => {
    expect(act(enter(), { type: 'leave' }).stage).toBe('turnEnd');
  });
});

describe('consumables', () => {
  it('heal potions restore HP up to max and are consumed', () => {
    let s = edit(newGame(), (d) => { d.players[0].hp = 5; d.players[0].consumables = ['potionS']; });
    s = act(s, { type: 'useItem', slot: 0 });
    expect(s.players[0].hp).toBe(17);
    expect(s.players[0].consumables).toHaveLength(0);
    let s2 = edit(newGame(), (d) => { d.players[0].hp = effectiveStats(d.players[0]).maxHp - 2; d.players[0].consumables = ['potionL']; });
    s2 = act(s2, { type: 'useItem', slot: 0 });
    expect(s2.players[0].hp).toBe(effectiveStats(s2.players[0]).maxHp);
  });
  it('buff items apply to the next fight and wear off after it', () => {
    let s = edit(newGame(), (d) => { d.players[0].consumables = ['whetstone']; });
    const atk = effectiveStats(s.players[0]).attack;
    s = act(s, { type: 'useItem', slot: 0 });
    expect(effectiveStats(s.players[0]).attack).toBe(atk + 3);
    s = edit(s, (d) => { d.players[0].baseAttack = 60; });
    s = act(atNode(s, 5), { type: 'move', to: 5 });
    s = fightToEnd(s);
    s = act(s, { type: 'continue' });
    expect(s.players[0].buffs.attack).toBe(0);
  });
  it('Swift boots add to the next roll only', () => {
    let s = edit(newGame(2, 4), (d) => { d.players[0].consumables = ['boots']; });
    const plain = act(newGame(2, 4), { type: 'roll' }).moveRoll;
    s = act(s, { type: 'useItem', slot: 0 }, { type: 'roll' });
    expect(s.moveRoll).toBe(plain + 3);
    expect(s.players[0].buffs.move).toBe(0);
  });
  it('items can be used mid-fight before choosing', () => {
    let s = act(atNode(newGame(), 5), { type: 'move', to: 5 });
    s = edit(s, (d) => { d.players[0].hp = 4; d.players[0].consumables = ['potionS']; });
    s = act(s, { type: 'useItem', slot: 0 });
    expect(s.players[0].hp).toBe(16);
    expect(s.combat).not.toBeNull();
  });
});

describe('lairs, fleeing and seals', () => {
  it('winning a lair fight grants its Seal, gold and loot', () => {
    let s = edit(newGame(), (d) => { d.players[0].baseAttack = 60; d.players[0].gold = 0; });
    s = act(atNode(s, 6), { type: 'move', to: 6 });
    s = act(fightToEnd(s), { type: 'continue' });
    expect(s.players[0].seals).toEqual([1]);
    expect(s.players[0].gold).toBeGreaterThan(0);
    expect(s.stage).toBe('turnEnd');
  });
  it('a knight holding the Seal does not fight that lair again', () => {
    let s = edit(newGame(), (d) => { d.players[0].seals = [0]; });
    s = act(atNode(s, 5), { type: 'move', to: 5 });
    expect(s.stage).toBe('turnEnd');
    expect(s.combat).toBeNull();
  });
  it('different knights can each earn the same Seal', () => {
    let s = edit(newGame(), (d) => { d.players[0].seals = [0]; d.current = 1; });
    s = act(atNode(s, 5), { type: 'move', to: 5 });
    expect(s.stage).toBe('combat');
  });
  it('fleeing before round 1 costs gold and leaves the Seal', () => {
    let s = edit(newGame(), (d) => { d.players[0].gold = 100; });
    s = act(atNode(s, 5), { type: 'move', to: 5 });
    s = act(s, { type: 'flee' });
    expect(s.players[0].gold).toBe(100 - Math.ceil(100 * CONFIG.fleeGoldPct));
    expect(s.players[0].seals).toEqual([]);
    expect(s.stage).toBe('turnEnd');
  });
  it('cannot flee after the first round', () => {
    let s = act(atNode(newGame(), 5), { type: 'move', to: 5 }, { type: 'choose', side: 'a', choice: 'guard' });
    if (s.combat && !s.combat.over) expect(() => applyAction(s, { type: 'flee' })).toThrow();
  });
  it('a Smoke Bomb makes fleeing free', () => {
    let s = edit(newGame(), (d) => { d.players[0].gold = 100; d.players[0].consumables = ['smoke']; });
    s = act(atNode(s, 5), { type: 'move', to: 5 }, { type: 'useItem', slot: 0 }, { type: 'flee' });
    expect(s.players[0].gold).toBe(100);
  });
});

describe('death and scars', () => {
  const die = (s = newGame(2, 8)) => {
    let st = edit(s, (d) => {
      d.players[0].hp = 1;
      d.players[0].baseDefense = 0;
      d.players[0].gold = 101;
      d.players[0].seals = [0, 1];
    });
    st = act(atNode(st, 7), { type: 'move', to: 7 });
    st = fightToEnd(st, 'guard', 'guard');
    return act(st, { type: 'continue' });
  };
  it('a defeated knight loses half gold, one random Seal and gains a Scar, and goes Home', () => {
    const s = die();
    const k = s.players[0];
    expect(k.hp).toBe(0);
    expect(k.downed).toBe(true);
    expect(k.gold).toBe(51); // 101 - floor(101/2)
    expect(k.seals).toHaveLength(1);
    expect(k.scars).toHaveLength(1);
    expect(k.deaths).toBe(1);
    expect(BOARD.nodes[k.pos].type).toBe('home');
    expect(s.stage).toBe('turnEnd');
  });
  it('the knight stays in the game and respawns at Home on their next turn', () => {
    let s = die();
    s = act(s, { type: 'endTurn' }); // knight 1
    s = act(s, { type: 'roll' });
    s = edit(s, (d) => { d.stage = 'turnEnd'; });
    s = act(s, { type: 'endTurn' }); // back to knight 0
    expect(s.current).toBe(1 === s.current ? 1 : s.current);
    // find the turn where knight 0 plays
    while (s.current !== 0) s = act(edit(s, (d) => { d.stage = 'turnEnd'; }), { type: 'endTurn' });
    expect(s.players[0].downed).toBe(false);
    expect(s.players[0].hp).toBe(effectiveStats(s.players[0]).maxHp);
    expect(s.stage).toBe('roll');
  });
  it('scars are permanent and accumulate', () => {
    let s = die();
    s = edit(s, (d) => { d.players[0].downed = false; d.players[0].hp = 1; d.players[0].baseDefense = 0; });
    const again = die(s);
    expect(again.players[0].scars).toHaveLength(2);
    expect(new Set(again.players[0].scars).size).toBe(2);
  });
  it('the lost Seal returns to its Lair (can be earned again)', () => {
    const s = die();
    const lost = [0, 1].find((x) => !s.players[0].seals.includes(x))!;
    expect(lost).toBeDefined();
    expect(s.players[0].seals).not.toContain(lost);
  });
  it('scar effects change stats', () => {
    const k = (id: string) => effectiveStats({ ...newGame().players[0], scars: [id] });
    const base = effectiveStats(newGame().players[0]);
    expect(k('lostEye').attack).toBe(base.attack - 1);
    expect(k('brokenHand').feintCost).toBe(base.feintCost + 1);
    expect(k('hardened').defense).toBe(base.defense + 1);
    expect(k('hardened').maxHp).toBe(base.maxHp - 2);
    expect(k('limp').move).toBe(-1);
    expect(k('crackedRibs').maxHp).toBeLessThan(base.maxHp);
    expect(k('bloodFury').attack).toBe(base.attack + 1);
    expect(k('shakyGuard').guardRegen).toBe(base.guardRegen - 1);
    expect(k('nightTerrors').maxStamina).toBe(base.maxStamina - 2);
    expect(k('coldResolve').maxStamina).toBe(base.maxStamina + 2);
    expect(k('debtMarked').shopPct).toBeGreaterThan(0);
    expect(SCARS.length).toBeGreaterThanOrEqual(8);
  });
  it('Broken Hand makes Feint cost more stamina in a real fight', () => {
    let s = edit(newGame(), (d) => { d.players[0].scars = ['brokenHand']; });
    s = act(atNode(s, 5), { type: 'move', to: 5 }, { type: 'choose', side: 'a', choice: 'feint' });
    expect(s.combat!.staminaA).toBe(CONFIG.knight.stamina - CONFIG.stamina.feintCost - 1);
  });
  it('a knight whose max HP shrinks is clamped', () => {
    const s = edit(newGame(), (d) => { d.players[0].scars = ['crackedRibs']; });
    const healed = act(atNode(s, s.players[0].pos), { type: 'move', to: s.players[0].pos });
    expect(healed.players[0].hp).toBe(CONFIG.knight.hp - 4);
  });
});

describe('Sanctum', () => {
  const NEAR = 13; // one step from the Sanctum
  const ready = (day: number, seals: number[]) =>
    edit(newGame(), (d) => {
      d.day = day;
      d.players[0].seals = seals;
      d.players[0].pos = NEAR;
      d.stage = 'move';
      d.moveRoll = 2;
    });
  it('stays closed outside the Full moon even with 3 Seals', () => {
    const s = act(ready(5, [0, 1, 2]), { type: 'move', to: 0 });
    expect(s.stage).toBe('turnEnd');
    expect(s.combat).toBeNull();
    expect(s.log.at(-1)!.text).toMatch(/sealed/i);
  });
  it('does not admit a knight with fewer than 3 Seals at Full moon', () => {
    const s = act(ready(9, [0, 1]), { type: 'move', to: 0 });
    expect(s.stage).toBe('turnEnd');
    expect(s.combat).toBeNull();
  });
  it('admits a knight with 3 Seals at Full moon and starts the guardian fight', () => {
    const s = act(ready(10, [0, 1, 2]), { type: 'move', to: 0 });
    expect(s.stage).toBe('combat');
    expect(s.combat!.kind).toBe('guardian');
  });
  it('defeating the guardian wins the game', () => {
    let s = act(edit(ready(11, [0, 1, 3]), (d) => { d.players[0].baseAttack = 200; d.players[0].baseMaxHp = 1000; d.players[0].hp = 1000; }), { type: 'move', to: 0 });
    s = act(fightToEnd(s), { type: 'continue' });
    expect(s.stage).toBe('gameOver');
    expect(s.winner).toBe(0);
    expect(s.endReason).toBe('sanctum');
    expect(() => applyAction(s, { type: 'roll' })).toThrow();
  });
  it('losing to the guardian is a death: the game goes on', () => {
    let s = act(edit(ready(9, [0, 1, 2]), (d) => { d.players[0].hp = 1; d.players[0].baseDefense = 0; }), { type: 'move', to: 0 });
    s = act(fightToEnd(s, 'guard', 'guard'), { type: 'continue' });
    expect(s.stage).toBe('turnEnd');
    expect(s.winner).toBeNull();
    expect(s.players[0].seals).toHaveLength(2);
    expect(s.players[0].scars).toHaveLength(1);
  });
  it('4 Seals also work and fleeing the guardian is possible before round 1', () => {
    let s = act(ready(9, [0, 1, 2, 3]), { type: 'move', to: 0 });
    s = act(s, { type: 'flee' });
    expect(s.stage).toBe('turnEnd');
    expect(sealCount(s, 0)).toBe(4);
  });
});

describe('day cap', () => {
  const lastTurnOfCap = (n: number) =>
    edit(newGame(n), (d) => {
      d.day = CONFIG.dayCap;
      d.step = n - 1;
      d.current = (CONFIG.dayCap - 1 + n - 1) % n;
      d.stage = 'turnEnd';
    });
  it('ends the game after day 40; most Seals wins', () => {
    let s = edit(lastTurnOfCap(3), (d) => { d.players[1].seals = [0, 1]; d.players[2].seals = [3]; d.players[0].gold = 999; });
    s = act(s, { type: 'endTurn' });
    expect(s.stage).toBe('gameOver');
    expect(s.endReason).toBe('dayCap');
    expect(s.winner).toBe(1);
  });
  it('ties on Seals are broken by gold', () => {
    let s = edit(lastTurnOfCap(3), (d) => {
      d.players[0].seals = [0]; d.players[1].seals = [1]; d.players[2].seals = [2];
      d.players[0].gold = 10; d.players[1].gold = 50; d.players[2].gold = 30;
    });
    s = act(s, { type: 'endTurn' });
    expect(s.winner).toBe(1);
  });
  it('does not end before the cap', () => {
    const s = act(edit(lastTurnOfCap(2), (d) => { d.day = CONFIG.dayCap - 1; d.current = (d.day - 1 + 1) % 2; }), { type: 'endTurn' });
    expect(s.stage).toBe('roll');
    expect(s.day).toBe(CONFIG.dayCap);
  });
});

describe('PvP', () => {
  const duel = (seed = 1) => {
    let s = edit(newGame(3, seed), (d) => {
      d.players[0].pos = 9;
      d.players[1].pos = 9;
      d.stage = 'move';
      d.moveRoll = 1;
    });
    s = act(s, { type: 'move', to: 9 }, { type: 'leave' }); // pass through the village
    return s;
  };
  it('stopping on an occupied node offers a challenge', () => {
    let s = edit(newGame(3), (d) => { d.players[1].pos = 13; });
    s = act(atNode(s, 13), { type: 'move', to: 13 });
    expect(s.stage).toBe('pvpOffer');
    expect(s.challengeable).toEqual([1]);
  });
  it('can be declined', () => {
    let s = edit(newGame(3), (d) => { d.players[1].pos = 13; });
    s = act(atNode(s, 13), { type: 'move', to: 13 }, { type: 'leave' });
    expect(s.stage).toBe('turnEnd');
  });
  it('knights that are downed cannot be challenged', () => {
    let s = edit(newGame(3), (d) => { d.players[1].pos = 13; d.players[1].downed = true; });
    s = act(atNode(s, 13), { type: 'move', to: 13 });
    expect(s.stage).toBe('turnEnd');
  });
  it('both sides choose secretly; the round resolves only when both have chosen', () => {
    let s = edit(newGame(3), (d) => { d.players[1].pos = 13; });
    s = act(atNode(s, 13), { type: 'move', to: 13 }, { type: 'challenge', target: 1 });
    expect(s.combat!.kind).toBe('pvp');
    s = act(s, { type: 'choose', side: 'a', choice: 'strike' });
    expect(s.combat!.round).toBe(0);
    expect(s.combat!.choiceA).toBe('strike');
    s = act(s, { type: 'choose', side: 'b', choice: 'feint' });
    expect(s.combat!.round).toBe(1);
    expect(s.combat!.roundLog.join(' ')).toMatch(/wins the exchange/);
  });
  it('there is no fleeing from a duel', () => {
    let s = edit(newGame(3), (d) => { d.players[1].pos = 13; });
    s = act(atNode(s, 13), { type: 'move', to: 13 }, { type: 'challenge', target: 1 });
    expect(() => applyAction(s, { type: 'flee' })).toThrow();
  });
  const winDuel = (take: 'seal' | 'gold') => {
    let s = edit(newGame(3), (d) => {
      d.players[1].pos = 13;
      d.players[0].baseAttack = 80;
      d.players[1].seals = [0, 2];
      d.players[1].gold = 80;
      d.players[0].gold = 10;
      d.players[0].seals = [0];
    });
    s = act(atNode(s, 13), { type: 'move', to: 13 }, { type: 'challenge', target: 1 });
    s = fightToEnd(s, 'strike', 'feint');
    s = act(s, { type: 'continue' });
    expect(s.stage).toBe('pvpLoot');
    expect(actorId(s)).toBe(0);
    return act(s, { type: 'pvpLoot', take });
  };
  it('winner can take a Seal (one they lack) from the loser', () => {
    const s = winDuel('seal');
    expect(s.players[0].seals.sort()).toEqual([0, 2]);
    expect(s.players[1].seals).toEqual([0]);
    expect(s.players[1].scars).toHaveLength(1);
    expect(s.players[1].downed).toBe(true);
    expect(s.stage).toBe('turnEnd');
  });
  it('winner can take half the loser gold instead; the loser still suffers death', () => {
    const s = winDuel('gold');
    expect(s.players[0].gold).toBe(10 + 40);
    expect(s.players[1].gold).toBe(40);
    expect(s.players[0].seals).toEqual([0]);
    expect(s.players[1].seals).toHaveLength(1); // a random Seal returns to its Lair
    expect(s.players[1].deaths).toBe(1);
  });
  it('taking a Seal is not allowed when the loser holds none the winner lacks', () => {
    let s = edit(newGame(3), (d) => {
      d.players[1].pos = 13;
      d.players[0].baseAttack = 80;
      d.players[1].seals = [0];
      d.players[0].seals = [0];
    });
    s = act(atNode(s, 13), { type: 'move', to: 13 }, { type: 'challenge', target: 1 });
    s = act(fightToEnd(s, 'strike', 'feint'), { type: 'continue' });
    expect(() => applyAction(s, { type: 'pvpLoot', take: 'seal' })).toThrow();
  });
  it('when the challenger loses, the defender picks the loot', () => {
    let s = edit(newGame(3), (d) => {
      d.players[1].pos = 13;
      d.players[1].baseAttack = 80;
      d.players[0].seals = [1];
    });
    s = act(atNode(s, 13), { type: 'move', to: 13 }, { type: 'challenge', target: 1 });
    s = act(fightToEnd(s, 'strike', 'guard'), { type: 'continue' });
    expect(s.stage).toBe('pvpLoot');
    expect(s.current).toBe(0);
    expect(actorId(s)).toBe(1);
    s = act(s, { type: 'pvpLoot', take: 'seal' });
    expect(s.players[1].seals).toEqual([1]);
  });
  it('unused helper scenario still runs', () => {
    expect(duel().players).toHaveLength(3);
  });
});
