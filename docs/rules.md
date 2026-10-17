# Moonblood - rules

## Overview

2-4 knights race around a map of 31 places. They fight lair monsters for **Seals**, duel each other, shop, loot ruins, and try to enter the **Sanctum** during the **Full moon** holding at least **3 Seals** to beat its guardian.

## Setup

- 2 to 4 knights (each may be human or bot). Each starts on its own **Home** node: 4 players use all four corners, 2 players sit opposite each other, 3 players use three corners.
- Every knight starts with **36 HP, Attack 3, Defense 1, Stamina 8, 40 gold**, a Rusty Sword (+1 Attack) and a Padded Coat (+1 Defense), no consumables, no scars, no Seals.

## Time and the moon

- A knight's turn is one move. One full round of all knights is **1 day**. At every dawn the turn order (**initiative**) is shuffled at random, so no seat is favoured. Today's order is shown in the side panel.
- **4 days = 1 moon phase.** Phases cycle New (days 1-4), Waxing (5-8), **Full (9-12)**, Waning (13-16), New (17-20) ... Full again on days 25-28.
- The current day and phase are always shown in the side panel.
- **Moon effect on monsters** (every monster is modified when a fight starts):

| Phase | Monster HP | Attack | Defense |
| --- | --- | --- | --- |
| New | -20% | -1 | -1 |
| Waxing | normal | normal | normal |
| Full | +30% | +2 | +1 |
| Waning | -10% | normal | normal |

**Moon affinity:** each monster also has its own strong phase (+15% HP, +1 Attack) and weak phase (-15% HP, -1 Attack), on top of the table above. The arena and the node info show it.

## Turn

0. If you earned a level-up, choose your boon first (see Renown).
1. (Optional) use a consumable.
2. **Roll a d6.** Scar modifiers and boots may change it (minimum 1).
3. **Move up to that many steps** along paths (you may stop earlier, or stay put). You may walk through other nodes and other knights without effect; only the node you stop on resolves.
4. **Resolve the node** (below), then, if a rival is on the same node, you may challenge them.
5. End the turn (device passes to the next knight).

## Nodes

| Node | Effect |
| --- | --- |
| **Home** | Your own Home heals you fully. A rival's Home does nothing. |
| **Road** | Half the time a **road event** (below); otherwise nothing. |
| **Village** | Shop (4 villages, each sells 2 weapons, 2 armors, 2 consumables) and a healer (1.5 gold per HP). Buying a weapon or armor replaces yours (the old one is sold back for half its value). Equipment is bought only if it is an upgrade. |
| **Lair** | A monster guards the lair's Seal. If you do not hold that Seal yet, you must fight (or flee). Winning gives the Seal, gold and a loot item. |
| **Ruins** | Random: gold (30%), loot (35%, better tiers later in the game), a trap that deals 4-10 damage but never kills (25%), or nothing (10%). After exploring, a ruin is picked clean for 3 days. |
| **Sanctum** | See below. |

### Road events

When a road event happens you choose what to do:

| Event | Choices |
| --- | --- |
| Wandering Merchant | Buy a random item at 70% of its price, or move on. |
| Ambush! | Fight a wandering monster (gold, maybe loot, renown - no Seal), or run and drop the flee cost. |
| Roadside Shrine | Pray: heal 10 and +2 Attack or Defense for your next fight. Plunder: +25 gold, 40% chance of a 6-damage curse (never lethal). |
| Bone Dice | Bet 10 or 30 gold: you and the drovers each roll a d6; higher wins the bet, a tie is a push. Or walk away. |
| Wounded Traveler | Pay 10 gold for a random potion or charm, or ride past. |
| Will-o'-the-Wisp | Follow: 50% teleport to a random village, ruins or lair; 50% lose 6 HP (never lethal). Or stay. |
| Old Sword-Hermit | Pay 40 gold for +1 renown, or decline. |

### Seals

There are **4 Seals**, one per Lair. Seals are held per knight: every knight can earn each Seal by beating its lair monster, and a knight who already holds a lair's Seal is not challenged there again. Seals can be lost by dying (it "returns to its Lair": you must beat the monster again) or taken by a duel winner.

## The Sanctum and winning

- The Sanctum is **open only during the Full moon**.
- A knight stopping on the Sanctum while it is open **and** holding **3 or more Seals** must fight the **Hollow Warden** (HP 66, Attack 10, Defense 5 before moon effects; adaptive moves). Winning the fight **wins the game**.
- Losing counts as a death. The game goes on. Fleeing before round 1 is allowed (costs gold).
- If the Sanctum is closed or the knight has fewer than 3 Seals, nothing happens (the knight may wait there and enter when it opens by holding position on a later turn).
- **Day cap:** if day 40 ends without a winner, the knight with the most Seals wins; ties are broken by gold, then by seat order.

## Combat

Fights are played in rounds. Both sides choose in secret:

- **Strike** beats **Feint**, **Feint** beats **Guard**, **Guard** beats **Strike**.
- The winner of the matchup deals **double damage**; the loser deals **none**.
- **Same choice = tie**: both deal normal damage.
- **Damage** = attacker Attack + weapon bonus + d6, minus defender Defense + armor bonus, **minimum 1** (then doubled for the matchup winner).
- **Stamina** (fighters start each fight full): **Strike costs 2, Feint costs 2, Guard restores 3** (capped at max). A move you cannot afford is unavailable; at under 2 Stamina only Guard is allowed.
- A fight ends when one side reaches 0 HP. If both reach 0 in the same round, the side with more HP going into that round survives with 1 HP (a tie favours the defender / monster).
- Consumables can be used before choosing a move in a round.

### Arena mode (default) and Classic mode

- **Arena:** a side-view duel. A monster winds up the move the rules engine will really play. A **blue ward** means Guard. A raised weapon glowing **red** means Strike. A weapon that **flickers gold** means Feint. Strike and Feint look the same for the first half of the wind-up. Answer before the impact with J/K/L (also A/S/D, 1/2/3, arrow keys) or the big buttons. No answer counts as Guard ("hesitated"). How long the wind-up lasts depends on the monster: 1.4-2.3 s on the default Normal reaction setting. Relaxed (x1.33) and Expert (x0.64) are in Settings, and the Slow animation setting stretches it further. Pressing in the last 30% (the gold end of the timing arc) is a perfect read: a won exchange deals x1.5 damage.
- **Duels in the arena:** both knights press at the same time on one device. The left player uses A/S/D or the left buttons, the right player J/K/L or the right buttons. A press only shows "READY"; both moves are revealed at the clash.
- **Classic:** choose from buttons. Duels between two humans use pass-the-device screens and a tap-to-reveal.
- The rules, damage and odds are identical in both modes.

### Monsters

Monsters choose moves from **weighted patterns**, with a signature opener and sometimes a habit, so players can learn them.

| Monster | Where | HP | ATK | DEF | Pattern | Strong / weak moon |
| --- | --- | --- | --- | --- | --- | --- |
| Dire Wolf | Wolf Den (N) | 34 | 5 | 2 | Strike 44 / Guard 20 / Feint 36, opens Strike | Full / New |
| Bog Troll | Troll Bog (E) | 46 | 6 | 3 | Strike 30 / Guard 40 / Feint 30, opens Guard | Waxing / Waning |
| Rust Knight | Rust Keep (S) | 38 | 6 | 3 | Even, opens Feint, **adaptive** (often counters your last move) | Waning / Waxing |
| Cave Drake | Drake Cave (W) | 48 | 7 | 3 | Strike 44 / Guard 26 / Feint 30, opens Strike, **stubborn** (repeats a move that did not lose) | New / Full |
| Road Bandit | ambush | 26 | 4 | 2 | Strike 40 / Guard 30 / Feint 30, opens Feint | Waning / Full |
| Giant Spider | ambush | 22 | 5 | 1 | Feint 60 / Strike 25 / Guard 15, stubborn | New / Full |
| Marsh Serpent | ambush | 30 | 4 | 2 | Strike 50 / Guard 25 / Feint 25, adaptive | Waxing / Waning |
| Bone Golem | ambush | 40 | 5 | 4 | Guard 50 / Strike 30 / Feint 20, opens Guard | Full / New |
| Hollow Warden | Sanctum | 66 | 10 | 5 | Strike 36 / Guard 28 / Feint 36, opens Guard, adaptive | - |

Monsters have 14 Stamina and follow the same Stamina rules.

### Fleeing

Before round 1 of a **monster** fight a knight may flee, losing 20% of their gold (minimum 5, or all of it). A Smoke Bomb makes it free. There is no fleeing from a duel.

## Death and Scars

A knight who drops to 0 HP **stays in the game**:

- loses **half their gold**,
- loses **one random Seal** (it returns to its Lair),
- gains one **permanent Scar** (not a duplicate while unseen ones remain),
- is placed on their Home node and **respawns at full HP at the start of their next turn**. While fallen they cannot be challenged.

Scars (15 types, listed in the panel and drawn on the knight in the arena):

| Scar | Effect |
| --- | --- |
| Lost Eye | -1 Attack |
| Broken Hand | Feint costs +1 Stamina |
| Hardened | +1 Defense, -2 max HP |
| Limp | -1 to movement rolls |
| Cracked Ribs | -4 max HP |
| Blood Fury | +1 Attack, -1 Defense |
| Shaky Guard | Guard restores 1 less Stamina |
| Night Terrors | -2 max Stamina |
| Cold Resolve | +2 max Stamina, -1 Attack |
| Debt-Marked | Shop prices +25% |
| Tenacious | +3 max HP, -1 to movement rolls |
| Burned Hands | Strike costs +1 Stamina |
| Frostbitten | -1 Defense |
| Grim Veteran | +1 Attack, -3 max HP |
| Haunted | Monsters you fight get +1 Attack |

## Renown and level-ups

Every victory earns 1 renown: lair monsters, ambushes and duels all count, and so does training with the Sword-Hermit. At **2, 4, 7, 11 and 16** renown you level up. At the start of your next turn you choose **1 of 3 random boons**, which last the whole game:

| Boon | Effect |
| --- | --- |
| Vigor | +5 max HP |
| Might | +1 Attack |
| Bulwark | +1 Defense |
| Endurance | +2 max Stamina |
| Second Wind | Guard restores +1 Stamina |
| Fleet-foot | +1 to movement rolls |
| Haggler | Shop prices -20% |
| Trickster | Feint costs 1 less Stamina |

## Duels (PvP)

- Stopping on a node with another (standing) knight lets you **challenge** them after your node resolves. They cannot refuse.
- Both knights choose secretly each round. With two humans on one device the game shows **pass-the-device** screens and a **tap to reveal** screen; nothing is stored until the reveal.
- The duel is fought to 0 HP. The loser suffers the normal **death** penalties, but the **winner chooses** what they intercept:
  - **Take a Seal**: the Seal the loser would lose goes to the winner instead of returning to its Lair (only a Seal the winner does not already hold; otherwise this option is unavailable), or
  - **Take half the gold**: the half the loser would lose goes to the winner instead of vanishing.
- If the challenger loses, the defender picks the spoils.

## Items

Equipment: **one weapon** (adds Attack) and **one armor** (adds Defense). Pack: **up to 3 consumables**. Loot that is no upgrade (or does not fit in the pack) is sold automatically for half its value. Tiers 1-4: shops sell up to tier 3; ruins and lair loot reach tier 4 later in the game.

**Weapons (12):** Rusty Sword +1 (start), Iron Sword +2, Hand Axe +2, Short Spear +2, Flanged Mace +3, Steel Sword +4, War Hammer +4, Halberd +5, Silver Blade +6, Greataxe +7, Moonlit Spear +8, Runeblade +9.

**Armors (9):** Padded Coat +1 (start), Leather Jerkin +1, Boiled Vest +2, Hide Armor +2, Studded Coat +3, Chain Hauberk +4, Scale Mail +5, Plate Cuirass +6, Moonforged Plate +8.

**Consumables (7):** Healing Draught (heal 12), Greater Draught (heal 28), Whetstone (+3 Attack until your next fight ends), Iron Tonic (+3 Defense until next fight ends), Vigor Brew (+4 max Stamina until next fight ends), Swift Boots Charm (+3 to your next roll), Smoke Bomb (next flee is free). Buffs apply to the next fight and wear off when it ends.

Exact prices and stock are in `src/data/items.ts` and `src/data/board.ts`.

## End of the game

The summary screen shows each knight's Seals, gold, fights won, duels won, deaths, level-ups, boons and scars. It also gives awards: Most Feared, Most Scarred and Deepest Purse.

## Saving

The game is saved in the browser after every action. **Resume** on the title screen continues it. The in-game Menu has "Save and quit to title".

## Map

31 nodes: 4 Homes (corners), 4 Villages (next to the Homes), 4 Lairs (N, E, S, W), 6 Ruins, 12 Roads, and the Sanctum in the centre, reached by four spokes from the lairs plus inner diagonals. The Sanctum is about 4 steps from every Home, but you need Seals first and the Full moon.
