# Moonblood

A browser-game spiritual successor to the classic fantasy-duel board-adventure genre. Original rules, names and placeholder graphics only (shapes, colours, text).

**Phase 1 goal:** prove the core loop is fun. Hot-seat multiplayer for 2-4 knights on one device, desktop or phone browser (landscape).

**Live game:** `https://<github-user>.github.io/moonstone-successor/` - for this repo: <https://nikosandris.github.io/moonstone-successor/> (published by the GitHub Actions workflow on every push to `main`; Pages must be set to "GitHub Actions" source in the repository settings).

## How to play (short version)

1. Pick 2-4 knights on the setup screen (names, colours; tick **Bot** to let the computer play a seat).
2. On your turn: **roll the die**, tap a glowing node to move up to that many steps, then the node you stop on resolves (shop, lair fight, ruins, ...). Tap your own node to stay put.
3. Beat the four **Lairs** to collect **Seals** (you need 3 of the 4).
4. The **Sanctum** (map centre) opens only during the **Full moon** (days 9-12, 25-28). Enter it holding 3+ Seals and defeat the Hollow Warden to win.
5. If nobody manages it by day 40, the knight with the most Seals wins (ties: gold).
6. Combat: each round both sides secretly pick **Strike / Guard / Feint**. Strike beats Feint, Feint beats Guard, Guard beats Strike; the winner deals double damage. Same move = both hit normally. Strike and Feint cost Stamina, Guard restores it.
7. Stopping on a rival's node lets you challenge them to a **duel**. Choices are hidden behind pass-the-device screens and revealed together.
8. Dying costs half your gold, a random Seal, and gives a permanent Scar - but you respawn at Home next turn and stay in the game.

Full rules: [docs/rules.md](docs/rules.md). Balance simulation results: [docs/balance-report.md](docs/balance-report.md).

## Run locally

```bash
npm install
npm run dev        # dev server (http://localhost:5173/moonstone-successor/)
npm test           # unit tests (Vitest)
npm run build      # type-check (strict) + production build into dist/
npm run preview    # serve the production build
npm run sim        # 1000 bot-vs-bot games, rewrites docs/balance-report.md
```

`npm run sim -- --games 200 --seed 5 --out /tmp/report.md` runs a smaller/different simulation.

Append `?speed=20` to the URL to speed up bot turns (handy when testing with all-bot seats).

## Architecture

| Folder | Role |
| --- | --- |
| `src/core` | **All rules**, pure TypeScript, no Phaser. Seeded RNG, plain serialisable `GameState`, pure `applyAction(state, action) => newState`. Also the heuristic bot (`bot.ts`). |
| `src/data` | Editable data: `board.ts` (map graph, village stock), `monsters.ts`, `items.ts`, `scars.ts`, `balance.ts` (all tuning knobs and moon effects). |
| `src/ui` | Phaser 3 rendering and input only. It reads state and dispatches actions. Setup screen is plain DOM. |
| `tests` | Vitest unit tests for every rule. |
| `scripts/sim.ts` | Headless balance simulation. |

## Deployment

`.github/workflows/deploy.yml` runs tests, builds with Vite (base path `/moonstone-successor/`) and publishes `dist/` using `actions/upload-pages-artifact` + `actions/deploy-pages` on every push to `main`.
