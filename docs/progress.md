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

## M3 - Visual identity (done)

**Changed**
- Map: procedural moonlit moor (noise terrain, pine forests, ponds, rocks, worn dirt roads, vignette), two drifting fog layers, Light2D lights with flicker at villages/homes/lairs/Sanctum, ambient light by moon phase (dark New moon, silver Full moon), golden pulsing ring and light when the Sanctum opens.
- Node icons: keep with banner in the owner's colour, village with lit windows, cave lair with red eyes and fangs, broken-column ruins, standing-stone Sanctum, waystones on roads. Knight tokens are silhouettes in player colour and walk along the roads when they move.
- Panel moon: crater-textured disc per phase with a pulsing glow.
- Arena: three backdrops (lair cave with flickering torches and embers, Sanctum standing stones with rising motes, moonlit field for duels showing the current moon), drifting ground fog, knight cape, particles for blood (or sparks with blood off), clash sparks and lunge dust. Scars drawn on the knight (eye patch for Lost Eye, slash marks for the rest).
- Restyled panels, buttons and setup screen in a dark-fantasy palette.

**Verification**
- `npm test`: 102 pass. `npm run build`: 0 errors. Rules unchanged, so sim unchanged (Sanctum 76.9%, 24.5 days, max seat 27.1%).
- Playwright screenshots inspected: map at New and Full moon (desktop + 800x360), lair, Sanctum and duel arenas. Full 4-bot arena game ran to the end. 0 console errors.

**Known issues**
- Fighters are flat vector silhouettes (no per-pixel lighting on them).

## M4 - Game feel and audio (done)

**Changed**
- Arena: hit stop (50 ms normal, 110 ms on double-damage hits), screen shake scaled by damage, camera punch-zoom and red flash on heavy hits, bigger knockback, slow-motion finishing blow with fall animation, spreading blood pool (blood setting) and camera lean-in.
- Map: tumbling die animation on roll, phase-change banner, Full-moon cinematic with sting when the Sanctum opens, tokens walk the roads.
- Procedural WebAudio (`src/ui/audio.ts`): dice, steps, coins, purchase, heal, swing, whoosh, hit, heavy hit, metal clash, block, monster growl, window tick, death, victory/defeat fanfares, phase chime, Sanctum sting; ambient wind + drone loop.
- Master volume slider and Mute on the setup screen, Sound/Muted toggle in the side panel (saved in localStorage).

**Verification**
- `npm test`: 102 pass. `npm run build`: 0 errors. Rules unchanged (sim: Sanctum 76.9%, 24.5 days, max seat 27.1%).
- Playwright: Full-moon transition shows the cinematic; dice animation; heavy hit (blood, -44 x2 popup, knockback); finishing blow with pool and zoom staying inside the arena. AudioContext present and no audio errors. 0 console errors.

**Known issues**
- I cannot listen to the audio in a headless browser: sounds are verified to run without errors, not judged by ear.
