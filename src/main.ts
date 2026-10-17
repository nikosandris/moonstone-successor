import Phaser from 'phaser';
import { ArenaScene } from './ui/arena/ArenaScene';
import { GameScene } from './ui/GameScene';
import { audio } from './ui/audio';
import { showSetup } from './ui/setup';
import { H, W } from './ui/theme';
import type { GameState, PlayerSetup } from './core/types';

let game: Phaser.Game | null = null;

function start(players: PlayerSetup[], seed: number, resume?: GameState): void {
  audio.unlock();
  audio.setAmbient(true);
  game?.destroy(true);
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W,
    height: H,
    backgroundColor: '#0b0d17',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
    render: { antialias: true },
  });
  game.scene.add('Arena', ArenaScene, false);
  game.scene.add('Game', GameScene, true, {
    players,
    seed,
    resume,
    onExit: () => {
      game?.destroy(true);
      game = null;
      openSetup();
    },
  });
}

function openSetup(): void {
  const root = document.getElementById('setup')!;
  showSetup(root, start, (s) => start([], 0, s));
}

// browsers only allow audio after a user gesture
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.unlock(), { capture: true });

openSetup();

// Test hook for automated browser checks (no gameplay effect).
(window as unknown as { __moonblood: () => Phaser.Game | null }).__moonblood = () => game;
