# Design decisions log

One line each: decision - reasoning.

## Phase 1
- Seals are held per knight (each lair can grant its Seal to every knight) - unique Seals stalemated: each bot took one and nobody reached 3.
- Duel loser suffers normal death; winner intercepts the Seal or the gold loss - keeps PvP loss equal to any death and avoids double penalties.
- Monster stamina 14 (knights 8) - monsters starving on stamina were trivially exploitable.

## Research notes (original 1991 game, used for inspiration only - no names/art/text copied)
- Original: 4 knights in the corners, turn-based map + real-time side-view fights, 4 keys from lairs (stealable from rivals) open the central valley guardian, moon phase changes which monsters are strong (wolves at full moon), XP into attributes, towns with shop/heal/tavern gambling, famous optional gore.
- Modern (2025-26) hooks to borrow: readable telegraphs and hit-stop feel (Hades II), build choices from small boon picks (Slay the Spire 2 / roguelites), short punchy party events (Mario Party-style road events), juicy feedback and quick sessions.

## Phase 2
- M1: Turn order is a seeded shuffle re-rolled every dawn ("initiative") instead of a fixed rotation - with 16-day moon cycles a rotation always gave the same seat first move on the decisive last Full-moon day; a shuffle makes every seat equally likely to act first on every day.
- M2: Arena is a separate Phaser scene layered over the map; it only dispatches the same `choose`/`useItem`/`flee`/`continue` actions - keeps all rules in src/core and the sim unchanged.
- M2: Monsters telegraph their real move (exact via `previewMonsterChoice`); difficulty comes from the reaction window (`tellMs`, 850-1200 ms) and from Strike/Feint sharing the first half of the wind-up - reading is the skill, so no hidden damage bonus was added.
- M2: No input before impact = Guard ("hesitated") - Guard is always legal, so the round always resolves.
- M2: Arena duels between two humans are simultaneous on one device (left A/S/D or left buttons, right J/K/L or right buttons); presses show only "READY" - hides choices without passing the device. Classic mode keeps the pass-and-reveal screens.
- M2: Duel mode is a localStorage setting chosen on the setup screen (default Arena).
