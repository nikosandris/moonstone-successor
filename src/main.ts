import Phaser from 'phaser';
import { GameScene } from './ui/GameScene';
import { showSetup } from './ui/setup';
import { H, W } from './ui/theme';
import type { PlayerSetup } from './core/types';

let game: Phaser.Game | null = null;

function start(players: PlayerSetup[], seed: number): void {
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
  game.scene.add('Game', GameScene, true, {
    players,
    seed,
    onExit: () => {
      game?.destroy(true);
      game = null;
      openSetup();
    },
  });
}

function openSetup(): void {
  const root = document.getElementById('setup')!;
  showSetup(root, start);
}

openSetup();

// Test hook for automated browser checks (no gameplay effect).
(window as unknown as { __moonblood: () => Phaser.Game | null }).__moonblood = () => game;
