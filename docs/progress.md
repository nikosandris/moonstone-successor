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
