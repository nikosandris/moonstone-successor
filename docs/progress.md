# Progress log

## M1 - Seat fairness (done)

**Changed**
- Turn order is now a seeded shuffle ("initiative") re-rolled every dawn (`src/core/game.ts: rollInitiative`), replacing the fixed daily rotation that always gave the same seat the first move on the last Full-moon day.
- Side panel lists today's initiative order; played knights are dimmed. End-turn button names the next knight from the order.

**Verification**
- `npm test`: 100 tests pass (new: initiative order per day, fairness of who opens the day over 400 seeds).
- `npm run build`: 0 errors.
- `npm run sim` (seeds 1-1000): Sanctum 76.9%, avg 24.5 days, seats 27.1 / 21.1 / 24.9 / 26.9% (max 27.1% <= 28%).
- Extra 4000-game sim (seeds 10001-14000): seats 25.2 / 23.1 / 25.7 / 26.1%, confirming no structural seat bias.
- Playwright smoke: desktop 1280x720 and 800x360 touch, 3-4 players, roll + end turn; initiative shown; 0 console errors.

**Known issues**
- With 1000 games the per-seat share still varies by about +-1.5 points from noise.

## M2 - Real-time arena duel (done)

**Changed**
- New `ArenaScene` (src/ui/arena): side-view duel with procedural fighters (`Fighter.ts`: knight in player colour plus 8 monster silhouette families).
- Each exchange: prep (items, Flee and FIGHT on round 1) -> reaction window -> impact animation -> result. Monsters telegraph the move the engine will play: blue ward = Guard, red glow = Strike, flickering gold = Feint (Strike and Feint look the same for the first 55% of the wind-up).
- Controls: keyboard J/K/L (also A/S/D, 1/2/3, arrows), Space/Enter for FIGHT/Continue; large touch buttons. Duels: simultaneous hidden input, left A/S/D vs right J/K/L, or each half of the screen on touch.
- Core: `previewMonsterChoice(state)` (pure, exact). Setting "Duels: Arena / Classic duel" on the setup screen (saved in localStorage).

**Verification**
- `npm test`: 101 pass (new test: preview always equals the move the engine plays, 20 seeds x 6 rounds).
- `npm run build`: 0 errors. `npm run sim`: unchanged rules - Sanctum 76.9%, avg 24.5 days, max seat 27.1%.
- Playwright: desktop lair fight played with keys to victory; two-human keyboard duel (state stays empty until the clash, reaches loot screen); 800x360 touch lair fight to the end; full 4-bot game in arena mode ran to day 40 with no stalls. 0 console errors. Screenshots inspected.

**Known issues**
- Bot knights in duels do not telegraph (knight moves are secret by design).
- Art is still flat placeholder shapes (M3).
