# Moonblood

A dark-fantasy hot-seat board adventure with real-time duels, for 2-4 knights on one device. It is a spiritual successor to the 1991 Amiga classic *Moonstone: A Hard Days Knight*, using original names, rules, art and sound. Everything you see and hear is generated in code: there are no image or audio files.

**Play:** <https://nikosandris.github.io/moonstone-successor/>

The site is deployed by GitHub Actions on every push to `main`. The repository's Pages source must be set to "GitHub Actions". The URL format is `https://<github-user>.github.io/moonstone-successor/`.

## How to play

1. **Setup:** choose 2-4 knights with names and colours. Tick **Bot** to let the computer play a seat, and pick the duel style (Arena or Classic). If a saved game exists, **Resume** continues it.
2. **Your turn:** roll the die (Space works too), then tap a glowing place up to that many steps away. Where you stop decides what happens:
   - **Village:** shop and heal.
   - **Lair:** fight for a Seal.
   - **Ruins:** loot or a trap.
   - **Road:** often a random event: merchant, ambush, shrine, bone dice, wounded traveler, will-o'-the-wisp or sword-hermit.
   - **Home:** a full heal.
3. **Goal:** take **3 of the 4 Seals**, then enter the **Sanctum** in the centre while the **Full moon** shines (days 9-12 and 25-28) and slay the Hollow Warden. If day 40 ends first, the knight with the most Seals wins.
4. **Combat:** each exchange is **Strike, Guard or Feint**. Strike beats Feint, Feint beats Guard, Guard beats Strike. The winner deals double damage. In **Arena** mode you read the monster's wind-up:
   - a blue ward means Guard;
   - a red glow means Strike;
   - a flickering gold glint means Feint.

   Answer in time with J/K/L, A/S/D, 1/2/3 or the big buttons.
5. **Duels:** stop on a rival's space to challenge them. In the arena both players press at the same time on one device (left A/S/D, right J/K/L, or each half of the screen). Presses stay hidden until the clash.
6. **Death is not the end:** you lose half your gold and a Seal and gain a permanent **Scar**, then rise again at Home.
7. **Renown:** victories level you up. Pick 1 of 3 permanent boons.
8. **The moon matters:** monsters are weaker at New moon and stronger at Full moon, and each monster has its own favourite phase.

Full rules: [docs/rules.md](docs/rules.md). The in-game **Menu** (top right) has the rules, the settings (duel mode, volume, animation speed, blood, tutorial) and save-and-quit. The game autosaves after every action.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173/moonstone-successor/
npm test           # Vitest unit tests for every rule
npm run build      # strict type-check + production build (dist/)
npm run preview    # serve the production build
npm run sim        # 1000 bot-vs-bot games -> docs/balance-report.md
```

- `npm run sim -- --games 200 --seed 5 --out /tmp/report.md` runs a custom simulation.
- Add `?speed=20` to the URL to fast-forward bot turns when testing.

## Architecture

| Folder | Role |
| --- | --- |
| `src/core` | All rules as pure TypeScript with no Phaser. It has a seeded RNG, a plain serialisable `GameState`, `applyAction(state, action) => newState`, the heuristic bot, and `previewMonsterChoice` for arena telegraphs. |
| `src/data` | Editable data: board, monsters (incl. telegraph speed and moon affinity), items, scars, boons, road events, and `balance.ts` with every tuning knob. |
| `src/ui` | Phaser 3 rendering and input only. `GameScene` is the map and panel, `arena/` is the real-time duel scene, and `art/` holds the procedural textures. Also `audio.ts` (WebAudio synthesis), DOM `setup`/`overlays`, and `save.ts` (localStorage). |
| `tests` | Vitest tests for every rule (movement, combat, stamina, death/scars, moon, seals, Sanctum, win conditions, events, level-ups, save). |
| `scripts/sim.ts` | Headless balance simulation. |
| `docs` | `rules.md`, `balance-report.md`, `decisions.md` (design log) and `progress.md` (milestone log). |
