import Phaser from 'phaser';
import { botAction } from '../core/bot';
import { allowedChoices, choiceCost } from '../core/combat';
import {
  actorId, applyAction, buyCheck, canFlee, combatFighters, combatHp, createGame, fleeCost, healQuote,
  affinityText, eventOptionBlock, nextKnightId, stealableSeals,
} from '../core/game';
import { reachable, shortestPath } from '../core/graph';
import { daysUntilFull, isSanctumOpen, moonEffect, phaseForDay } from '../core/moon';
import { effectiveStats, shopPrice } from '../core/stats';
import type { Action, BoardNode, Choice, GameState, Knight, PlayerSetup } from '../core/types';
import { CONFIG, PHASE_NAMES } from '../data/balance';
import { BOARD } from '../data/board';
import { getItem } from '../data/items';
import { getMonster } from '../data/monsters';
import { getScar } from '../data/scars';
import { LEVEL_THRESHOLDS, getBoon } from '../data/boons';
import {
  COL, H, NODE_LABEL, SEAL_COLORS, SERIF, W, hex,
} from './theme';
import { generateTextures } from './art/textures';
import { audio } from './audio';
import { getSettings, updateSettings } from './settings';
import { addBar, addButton, addPanel, addText } from './widgets';

interface SceneData {
  players: PlayerSetup[];
  seed: number;
  onExit: () => void;
}

// map placement: board space (1000 x 600) -> screen
const MAP_SCALE = 0.67;
const MAP_X = 14;
const MAP_Y = 22;
const mx = (x: number) => MAP_X + x * MAP_SCALE;
const my = (y: number) => MAP_Y + y * MAP_SCALE;

const PANEL_X = 700;

const CHOICE_INFO: Record<Choice, { label: string; beats: string }> = {
  strike: { label: 'Strike', beats: 'beats Feint' },
  guard: { label: 'Guard', beats: 'beats Strike' },
  feint: { label: 'Feint', beats: 'beats Guard' },
};

type DuelPhase = 'coverA' | 'pickA' | 'coverB' | 'pickB' | 'reveal';

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private onExit!: () => void;

  private nodesLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;
  private modalLayer!: Phaser.GameObjects.Container;
  private toastText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private pulse: (Phaser.GameObjects.Shape | Phaser.GameObjects.Image)[] = [];
  private botTimer: Phaser.Time.TimerEvent | null = null;
  private infoNode: number | null = null;
  private fog: Phaser.GameObjects.TileSprite[] = [];
  private flicker: { light: Phaser.GameObjects.Light | null; glow: Phaser.GameObjects.Image | null; base: number; glowBase: number; seed: number }[] = [];
  private sanctumLight: Phaser.GameObjects.Light | null = null;
  private sanctumGlow: Phaser.GameObjects.Image | null = null;
  private lastPos: number[] = [];
  private justRolled = false;

  // hot-seat duel flow (choices stay in memory until the reveal)
  private duelKey = '';
  private duelPhase: DuelPhase = 'pickA';
  private pendingA: Choice | null = null;
  private pendingB: Choice | null = null;

  constructor() {
    super('Game');
  }

  init(data: SceneData): void {
    this.state = createGame(data.players, data.seed);
    this.onExit = data.onExit;
    this.duelKey = '';
  }

  create(): void {
    generateTextures(this);
    this.add.rectangle(0, 0, W, H, COL.bg).setOrigin(0, 0);
    this.drawMapBackdrop();
    this.nodesLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);
    this.modalLayer = this.add.container(0, 0).setDepth(100);
    this.infoText = this.add.text(10, 2, '', { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: COL.dim, resolution: 2 });
    this.toastText = this.add
      .text(W / 2, H - 18, '', {
        fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: '#ffffff', backgroundColor: '#8a2b2b', padding: { x: 10, y: 4 }, resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(200)
      .setVisible(false);
    // ?speed=N shortens bot delays (used for automated checks)
    const speed = Number(new URLSearchParams(window.location.search).get('speed'));
    if (speed > 0) this.time.timeScale = speed;
    this.lastPos = this.state.players.map((p) => p.pos);
    this.render();
  }

  update(time: number, delta: number): void {
    const a = 0.55 + 0.45 * Math.sin(time / 220);
    for (const p of this.pulse) if (p.active) p.setAlpha(a);
    for (const [i, f] of this.fog.entries()) {
      f.tilePositionX += delta * (0.008 + i * 0.006);
      f.tilePositionY += delta * 0.002 * (i ? -1 : 1);
    }
    for (const fl of this.flicker) {
      const v = 0.82 + 0.18 * Math.sin(time / (90 + fl.seed * 40) + fl.seed * 7) * Math.sin(time / 233 + fl.seed);
      if (fl.light) fl.light.intensity = fl.base * v;
      if (fl.glow) fl.glow.setAlpha(fl.glowBase * v);
    }
  }

  // ------------------------------------------------------------ plumbing

  private dispatch(action: Action): void {
    const before = this.state;
    try {
      this.state = applyAction(this.state, action);
    } catch (e) {
      this.flash((e as Error).message);
      audio.play('block', 0.5);
      return;
    }
    this.infoNode = null;
    this.feedback(before, action);
    this.render();
  }

  /** Sounds and cinematic moments derived from what an action changed (presentation only). */
  private feedback(before: GameState, action: Action): void {
    const s = this.state;
    const k0 = before.players[before.current];
    const k1 = s.players[before.current];
    switch (action.type) {
      case 'roll': audio.play('dice'); this.justRolled = true; break;
      case 'move': audio.play('step'); break;
      case 'buy': audio.play('buy'); break;
      case 'heal': audio.play('heal'); break;
      case 'useItem': audio.play('heal'); break;
      case 'endTurn': audio.play('click'); break;
      default: break;
    }
    if (action.type !== 'buy' && k1.gold > k0.gold) audio.play('coin');
    if (s.stage === 'gameOver' && before.stage !== 'gameOver') audio.play(s.endReason === 'sanctum' ? 'victory' : 'chime');
    const p0 = phaseForDay(before.day);
    const p1 = phaseForDay(s.day);
    if (p0 !== p1 && s.stage !== 'gameOver') {
      if (p1 === 'full') this.sanctumCinematic();
      else this.phaseBanner(PHASE_NAMES[p1]);
    }
  }

  private phaseBanner(text: string): void {
    audio.play('chime');
    const t = this.add.text(347, 60, text.toUpperCase(), { fontFamily: SERIF, fontSize: '34px', fontStyle: 'bold', color: '#e8d6a8', stroke: '#000000', strokeThickness: 6, resolution: 2 }).setOrigin(0.5).setDepth(150).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 80, duration: 500, yoyo: true, hold: 1400, onComplete: () => t.destroy() });
  }

  /** Full moon rises: darken, a huge moon swells, a sting, then the Sanctum glows. */
  private sanctumCinematic(): void {
    audio.play('sting');
    const c = this.add.container(0, 0).setDepth(160);
    const dark = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0, 0).setAlpha(0);
    const glow = this.add.image(W / 2, 250, 'glow').setTint(0xfff0c0).setBlendMode(Phaser.BlendModes.ADD).setScale(1).setAlpha(0);
    const moon = this.add.image(W / 2, 330, 'moon-full').setScale(0.4).setAlpha(0);
    const t1 = this.add.text(W / 2, 430, 'THE FULL MOON RISES', { fontFamily: SERIF, fontSize: '40px', fontStyle: 'bold', color: '#ffe3a0', stroke: '#000', strokeThickness: 6, resolution: 2 }).setOrigin(0.5).setAlpha(0);
    const t2 = this.add.text(W / 2, 480, 'The Sanctum stands open. Bring three Seals.', { fontFamily: SERIF, fontSize: '22px', color: '#e8d6a8', resolution: 2 }).setOrigin(0.5).setAlpha(0);
    c.add([dark, glow, moon, t1, t2]);
    this.tweens.add({ targets: dark, alpha: 0.88, duration: 500 });
    this.tweens.add({ targets: moon, alpha: 1, y: 250, scale: 1.5, duration: 1800, ease: 'Sine.easeOut', delay: 300 });
    this.tweens.add({ targets: glow, alpha: 0.7, scale: 5, duration: 2000, delay: 500 });
    this.tweens.add({ targets: [t1, t2], alpha: 1, duration: 600, delay: 1300 });
    this.cameras.main.shake(900, 0.003);
    this.time.delayedCall(2900, () => this.tweens.add({ targets: c.list, alpha: 0, duration: 600, onComplete: () => c.destroy() }));
  }

  private flash(msg: string): void {
    this.toastText.setText(msg).setVisible(true);
    this.time.delayedCall(1800, () => this.toastText.setVisible(false));
  }

  private get actor(): Knight {
    return this.state.players[actorId(this.state)];
  }

  private render(): void {
    this.botTimer?.remove(false);
    this.botTimer = null;
    this.pulse = [];
    this.nodesLayer.removeAll(true);
    this.uiLayer.removeAll(true);
    this.modalLayer.removeAll(true);
    this.infoText.setText(this.infoNode !== null ? this.nodeInfo(BOARD.nodes[this.infoNode]) : 'Tap any node for details.');

    this.drawNodes();
    this.drawPanel();
    this.drawBottom();
    const s = this.state;
    const arena = s.stage === 'combat' && getSettings().duelMode === 'arena';
    this.syncArena(arena);
    if (s.stage === 'shop') this.drawShop();
    else if (s.stage === 'combat' && !arena) this.drawCombat();
    else if (s.stage === 'pvpLoot') this.drawPvpLoot();
    else if (s.stage === 'event') this.drawEvent();
    else if (s.stage === 'levelUp') this.drawLevelUp();
    else if (s.stage === 'gameOver') this.drawGameOver();
    this.scheduleBot();
  }

  // ------------------------------------------------------------ bots

  /** The arena is a separate scene layered on top; it drives fights (including bot moves) itself. */
  private syncArena(on: boolean): void {
    const active = this.scene.isActive('Arena') || this.scene.isPaused('Arena');
    if (on && !active) {
      this.scene.launch('Arena', { host: { getState: () => this.state, dispatch: (a: Action) => this.dispatch(a) } });
      this.scene.bringToTop('Arena');
    }
    if (!on && active) this.scene.stop('Arena');
    this.input.enabled = !on;
  }

  private scheduleBot(): void {
    const s = this.state;
    if (s.stage === 'gameOver') return;
    if (s.stage === 'combat' && getSettings().duelMode === 'arena') return;
    let action: Action | null = null;
    let delay = 650;
    const c = s.combat;
    if (s.stage === 'combat' && c) {
      if (c.over) {
        if (s.players[c.a].bot) { action = { type: 'continue' }; delay = 1500; }
      } else if (c.kind === 'pvp') {
        const a = s.players[c.a];
        const b = s.players[c.b!];
        if (a.bot && c.choiceA === null) action = botAction(s, 'a');
        else if (b.bot && c.choiceB === null) action = botAction(s, 'b');
        delay = 900;
      } else if (this.actor.bot) {
        action = botAction(s);
        delay = 1000;
      }
    } else if (this.actor.bot) {
      action = botAction(s);
      if (s.stage === 'turnEnd') delay = 900;
    }
    if (!action) return;
    const act = action;
    this.botTimer = this.time.delayedCall(delay, () => this.dispatch(act));
  }

  // ------------------------------------------------------------ map

  private drawMapBackdrop(): void {
    const mapW = 1000 * MAP_SCALE;
    const mapH = 600 * MAP_SCALE;
    const frame = this.add.graphics();
    frame.fillStyle(0x07080f, 1);
    frame.fillRoundedRect(4, 18, 686, 412, 10);
    const terrain = this.add.image(MAP_X, MAP_Y, 'terrain').setOrigin(0, 0).setScale(MAP_SCALE / 1.34);
    const webgl = this.game.renderer.type === Phaser.WEBGL;
    if (webgl) {
      terrain.setPipeline('Light2D');
      this.lights.enable();
    }
    // fog banks drifting over the moor
    for (let i = 0; i < 2; i++) {
      const f = this.add.tileSprite(MAP_X, MAP_Y, mapW, mapH, 'fog').setOrigin(0, 0).setAlpha(i ? 0.1 : 0.16).setTileScale(i ? 1.6 : 1.1);
      this.fog.push(f);
    }
    // warm windows, torches at homes, a red glow from lairs, the Sanctum's light
    for (const n of BOARD.nodes) {
      const x = mx(n.x);
      const y = my(n.y);
      let color = 0;
      let radius = 0;
      let intensity = 0;
      if (n.type === 'village') { color = 0xffa040; radius = 80; intensity = 1.6; }
      else if (n.type === 'home') { color = this.state.players.find((p) => p.seat === n.seat)?.color ?? 0xffc070; radius = 64; intensity = 1.2; }
      else if (n.type === 'lair') { color = 0xff4030; radius = 46; intensity = 1.0; }
      else if (n.type === 'sanctum') { color = 0x9fb4ff; radius = 110; intensity = 0.9; }
      if (!radius) continue;
      const seed = n.id * 0.37;
      const glow = this.add.image(x, y, 'glow').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(radius / 80).setAlpha(0.28);
      const light = webgl ? this.lights.addLight(x, y, radius * 1.6, color, intensity) : null;
      this.flicker.push({ light, glow, base: intensity, glowBase: 0.28, seed });
      if (n.type === 'sanctum') { this.sanctumLight = light; this.sanctumGlow = glow; }
    }
    frame.lineStyle(3, 0x2a2f55, 1);
    const border = this.add.graphics();
    border.lineStyle(3, 0x3a3060, 1);
    border.strokeRoundedRect(4, 18, 686, 412, 10);
  }

  /** Moonlight follows the phase: darkest at New, silver-bright at Full. */
  private applyMoonlight(): void {
    const phase = phaseForDay(this.state.day);
    const amb = { new: 0x3c4466, waxing: 0x5a6390, full: 0x8c97c4, waning: 0x4e5680 }[phase];
    if (this.game.renderer.type === Phaser.WEBGL) this.lights.setAmbientColor(amb);
    const open = isSanctumOpen(this.state.day);
    if (this.sanctumLight) {
      this.sanctumLight.color.set(...(open ? [1, 0.85, 0.4] as const : [0.55, 0.65, 1] as const));
      this.sanctumLight.radius = open ? 220 : 120;
    }
    this.sanctumGlow?.setTint(open ? 0xffd060 : 0x9fb4ff).setScale(open ? 2.4 : 1.3);
  }

  private nodeRadius(n: BoardNode): number {
    return n.type === 'sanctum' ? 24 : n.type === 'road' ? 9 : 16;
  }

  private drawNodes(): void {
    const s = this.state;
    const k = s.players[s.current];
    const reach = s.stage === 'move' && !this.actor.bot ? new Set(reachable(s.players[s.current].pos, s.moveRoll)) : new Set<number>();
    const open = isSanctumOpen(s.day);
    this.applyMoonlight();

    for (const n of BOARD.nodes) {
      const x = mx(n.x);
      const y = my(n.y);
      const r = this.nodeRadius(n);
      if (reach.has(n.id)) {
        const hl = this.add.ellipse(x, y + 4, r * 2.6 + 12, r * 1.2 + 10, 0xfff1c0, 0.3).setStrokeStyle(4, 0xffd36a);
        this.nodesLayer.add(hl);
        this.pulse.push(hl);
      }
      const icon = this.add.image(x, y + (n.type === 'road' ? 0 : 6), `icon-${n.type}`).setOrigin(0.5, n.type === 'road' ? 0.5 : 0.75).setScale(n.type === 'road' ? 0.55 : 0.5);
      if (n.type === 'sanctum' && !open) icon.setTint(0x9aa0b8);
      this.nodesLayer.add(icon);
      if (n.type === 'home') {
        const owner = s.players.find((p) => p.seat === n.seat);
        if (owner) {
          const g = this.add.graphics();
          g.fillStyle(0x2a2a2a, 1);
          g.fillRect(x + 8, y - 30, 2, 18);
          g.fillStyle(owner.color, 1);
          g.fillTriangle(x + 10, y - 30, x + 24, y - 26, x + 10, y - 21);
          this.nodesLayer.add(g);
        }
      }
      if (n.type === 'sanctum' && open) {
        const ring = this.add.ellipse(x, y + 6, 76, 28).setStrokeStyle(3, 0xffd060, 0.9);
        this.nodesLayer.add(ring);
        this.pulse.push(ring);
      }
      if (n.type !== 'road') {
        const label = n.type === 'sanctum' ? (open ? 'SANCTUM - OPEN' : 'SANCTUM') : NODE_LABEL[n.type];
        const tl = addText(this, this.nodesLayer, x, y + (n.type === 'sanctum' ? 14 : 10), label, { size: 11, bold: n.type === 'sanctum', align: 'center', color: n.type === 'sanctum' && open ? '#ffd060' : '#d8d2c0' });
        tl.setStroke('#05060a', 4);
      }
      if (n.type === 'lair') {
        const holds = k.seals.includes(n.seal!);
        const d = this.add.polygon(x + r + 8, y - 14, [0, -8, 7, 0, 0, 8, -7, 0], holds ? SEAL_COLORS[n.seal!] : 0x0b0d17).setStrokeStyle(2, SEAL_COLORS[n.seal!]);
        this.nodesLayer.add(d);
      }
      const hit = this.add.circle(x, y - 4, Math.max(r + 8, 20), 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => {
        if (reach.has(n.id)) this.dispatch({ type: 'move', to: n.id });
        else {
          this.infoNode = n.id;
          this.infoText.setText(this.nodeInfo(n));
        }
      });
      this.nodesLayer.add(hit);
    }
    this.drawTokens();
  }

  /** Knight tokens; a knight whose position changed walks there along the road. */
  private drawTokens(): void {
    const s = this.state;
    const slot = (nodeId: number, p: Knight): [number, number] => {
      const n = BOARD.nodes[nodeId];
      const here = s.players.filter((q) => q.pos === nodeId);
      const i = here.indexOf(p);
      const ox = here.length > 1 ? (i - (here.length - 1) / 2) * 16 : 0;
      return [mx(n.x) + ox, my(n.y) - this.nodeRadius(n) - 4];
    };
    for (const p of s.players) {
      const isCur = p.id === s.current && s.stage !== 'gameOver';
      const [tx, ty] = slot(p.pos, p);
      const c = this.add.container(tx, ty);
      if (isCur) {
        const ring = this.add.ellipse(0, 2, 30, 10).setStrokeStyle(2, 0xffffff, 0.9);
        c.add(ring);
        this.pulse.push(ring);
      }
      const back = this.add.image(0, 0, 'token').setOrigin(0.5, 0.9).setScale(0.62).setTint(0x000000);
      const tok = this.add.image(0, -1, 'token').setOrigin(0.5, 0.9).setScale(0.52).setTint(p.color);
      c.add([back, tok]);
      if (p.downed) c.setAlpha(0.45);
      const num = addText(this, this.nodesLayer, 0, -40, String(p.id + 1), { size: 11, bold: true, align: 'center', color: '#ffffff' });
      num.setStroke('#000000', 3);
      this.nodesLayer.remove(num);
      c.add(num);
      this.nodesLayer.add(c);
      const from = this.lastPos[p.id];
      if (from !== undefined && from !== p.pos && !p.downed) {
        const path = shortestPath(from, p.pos);
        const pts = path.map((id) => (id === p.pos ? [tx, ty] : [mx(BOARD.nodes[id].x), my(BOARD.nodes[id].y) - 12]));
        c.setPosition(pts[0][0], pts[0][1]);
        this.tweens.chain({
          targets: c,
          tweens: pts.slice(1).map(([x, y]) => ({ x, y, duration: 140, ease: 'Sine.easeInOut' })),
        });
      }
    }
    this.lastPos = s.players.map((p) => p.pos);
  }

  private nodeInfo(n: BoardNode): string {
    const s = this.state;
    switch (n.type) {
      case 'home': return `${n.name}: free full heal for its knight.`;
      case 'road': return `${n.name}: nothing here but dust.`;
      case 'village': return `${n.name} (Village): shop and healing for gold.`;
      case 'lair': {
        const m = getMonster(n.monster!);
        const aff = affinityText(m.id, s.day);
        return `${n.name} (Lair): ${m.name} guards Seal ${n.seal! + 1}. ${m.hint}${aff ? ` ${aff}.` : ''}`;
      }
      case 'ruins': {
        const ready = s.day >= (s.ruinsReady[n.id] ?? 0);
        return `${n.name} (Ruins): loot, gold or a trap. ${ready ? 'Unexplored.' : `Picked clean until day ${s.ruinsReady[n.id]}.`}`;
      }
      case 'sanctum':
        return `The Sanctum: opens under the Full moon. Enter with ${CONFIG.sealsToEnter}+ Seals and beat the Warden to win.`;
    }
  }

  // ------------------------------------------------------------ side panel

  private drawMoonIcon(x: number, y: number, r: number, phase: ReturnType<typeof phaseForDay>): void {
    const glow = this.add.image(x, y, 'glow').setTint(phase === 'full' ? 0xfff2c0 : 0x9fb4ff).setBlendMode(Phaser.BlendModes.ADD).setScale((r * 3.2) / 128);
    this.pulse.push(glow);
    const moon = this.add.image(x, y, `moon-${phase}`).setScale((r * 2) / 128);
    this.uiLayer.add([glow, moon]);
  }

  private drawPanel(): void {
    const s = this.state;
    const L = this.uiLayer;
    const k = s.players[s.current];
    const e = effectiveStats(k);
    const phase = phaseForDay(s.day);
    const open = isSanctumOpen(s.day);
    const x0 = PANEL_X;

    addPanel(this, L, x0 - 6, 4, W - x0 + 2, H - 8);
    // day and moon
    this.drawMoonIcon(x0 + 34, 48, 26, phase);
    addText(this, L, x0 + 76, 8, `DAY ${s.day} / ${CONFIG.dayCap}`, { size: 20, bold: true, serif: true });
    addText(this, L, x0 + 76, 32, PHASE_NAMES[phase].toUpperCase(), { size: 20, bold: true, serif: true, color: phase === 'full' ? COL.gold : '#cfd3ff' });
    addText(this, L, x0 + 76, 56, open ? 'Sanctum is OPEN' : `Sanctum opens in ${daysUntilFull(s.day)} day(s)`, { size: 15, color: open ? COL.gold : COL.dim, bold: open });
    addText(this, L, x0 + 4, 82, moonEffect(s.day).text, { size: 12, color: COL.dim, wrap: 306 });
    const muted = getSettings().muted;
    addButton(this, L, W - 62, 8, 52, 30, muted ? 'Muted' : 'Sound', () => {
      updateSettings({ muted: !getSettings().muted });
      this.render();
    }, { size: 11, fill: muted ? 0x3a2a2a : 0x2a3a2a });

    // active knight
    const y0 = 112;
    this.uiLayer.add(this.add.circle(x0 + 12, y0 + 12, 10, k.color).setStrokeStyle(2, 0xffffff));
    addText(this, L, x0 + 30, y0, `${k.name}${k.bot ? ' (bot)' : ''}${k.downed ? ' - fallen' : ''}`, { size: 20, bold: true, serif: true, color: hex(k.color) });
    addBar(this, L, x0 + 4, y0 + 30, 306, 18, k.hp / e.maxHp, COL.hp, `HP ${k.hp} / ${e.maxHp}`);
    addText(this, L, x0 + 4, y0 + 54, `ATK ${e.attack}+${e.weaponBonus}   DEF ${e.defense}+${e.armorBonus}   STA ${e.maxStamina}`, { size: 15 });
    addText(this, L, x0 + 4, y0 + 74, `Gold ${k.gold}`, { size: 16, bold: true, color: COL.gold });
    const wep = k.weapon ? getItem(k.weapon) : null;
    const arm = k.armor ? getItem(k.armor) : null;
    addText(this, L, x0 + 90, y0 + 74, `Seals ${k.seals.length}/4  Deaths ${k.deaths}`, { size: 14, color: COL.dim });
    addText(this, L, x0 + 4, y0 + 96, `Weapon: ${wep ? `${wep.name} (${wep.desc})` : 'none'}`, { size: 14 });
    addText(this, L, x0 + 4, y0 + 114, `Armor:  ${arm ? `${arm.name} (${arm.desc})` : 'none'}`, { size: 14 });

    // consumables
    const cy = y0 + 138;
    const canUse = s.stage === 'roll' && !k.bot;
    for (let i = 0; i < 3; i++) {
      const id = k.consumables[i];
      if (id) {
        const it = getItem(id);
        addButton(this, L, x0 + 4 + i * 104, cy, 100, 38, it.name, () => this.dispatch({ type: 'useItem', slot: i }), { size: 12, enabled: canUse, fill: 0x2e4a7a });
      } else {
        addPanel(this, L, x0 + 4 + i * 104, cy, 100, 38, 0x0f1226);
        addText(this, L, x0 + 54 + i * 104, cy + 10, 'empty', { size: 12, color: '#555a80', align: 'center' });
      }
    }
    if (k.consumables.length && !canUse) addText(this, L, x0 + 4, cy + 40, 'Items: use before rolling, or in a fight.', { size: 11, color: COL.dim });
    else if (k.consumables.length) addText(this, L, x0 + 4, cy + 40, 'Tap an item to use it.', { size: 11, color: COL.dim });

    // seals
    const sy = cy + 58;
    addText(this, L, x0 + 4, sy, 'Seals:', { size: 14, bold: true });
    for (let i = 0; i < 4; i++) {
      const held = k.seals.includes(i);
      const d = this.add.polygon(x0 + 86 + i * 44, sy + 10, [0, -12, 11, 0, 0, 12, -11, 0], held ? SEAL_COLORS[i] : 0x0b0d17).setStrokeStyle(2, SEAL_COLORS[i]);
      this.uiLayer.add(d);
    }
    addText(this, L, x0 + 4, sy + 24, `Need ${CONFIG.sealsToEnter}+ to face the Warden`, { size: 11, color: COL.dim });

    // scars
    const scy = sy + 42;
    addText(this, L, x0 + 4, scy, 'Scars:', { size: 14, bold: true });
    if (k.scars.length === 0) addText(this, L, x0 + 64, scy + 1, 'none', { size: 13, color: COL.dim });
    k.scars.slice(0, 3).forEach((id, i) => {
      const sc = getScar(id);
      addText(this, L, x0 + 4, scy + 18 + i * 16, `${sc.name}: ${sc.desc}`, { size: 12, color: COL.bad });
    });
    if (k.scars.length > 3) addText(this, L, x0 + 4, scy + 18 + 48, `+${k.scars.length - 3} more`, { size: 12, color: COL.bad });
    // renown and boons
    const by = scy + 88;
    const nextAt = LEVEL_THRESHOLDS[k.boons.length + k.pendingBoons];
    addText(this, L, x0 + 4, by, `Renown ${k.renown}${nextAt ? ` (level-up at ${nextAt})` : ''}`, { size: 13, bold: true, color: '#ffd36a' });
    if (k.boons.length) addText(this, L, x0 + 4, by + 18, k.boons.map((id) => getBoon(id).name).join(', '), { size: 12, color: '#e8d6a8', wrap: 306 });

    // all knights
    const ky = H - 4 - 8 - s.players.length * 20 - 20;
    addText(this, L, x0 + 4, ky, "Today's initiative", { size: 13, bold: true, color: COL.dim });
    s.order.map((id) => s.players[id]).forEach((p, i) => {
      const yy = ky + 18 + i * 20;
      const done = i < s.step;
      this.uiLayer.add(this.add.circle(x0 + 12, yy + 8, 6, p.color, done ? 0.4 : 1).setStrokeStyle(p.id === s.current ? 2 : 0, 0xffffff));
      addText(this, L, x0 + 24, yy, `${i + 1}. ${p.name}`, { size: 13, bold: p.id === s.current, color: done ? COL.dim : COL.text });
      addText(this, L, x0 + 150, yy, `HP ${p.hp}`, { size: 13, color: p.hp < 10 ? COL.bad : COL.text });
      addText(this, L, x0 + 214, yy, `${p.seals.length}◆`, { size: 13 });
      addText(this, L, x0 + 250, yy, `${p.gold}g`, { size: 13, color: COL.gold });
      if (p.scars.length) addText(this, L, x0 + 296, yy, `⚔${p.scars.length}`, { size: 12, color: COL.bad });
    });
  }

  // ------------------------------------------------------------ bottom bar (log + actions)

  private drawBottom(): void {
    const s = this.state;
    const L = this.uiLayer;
    addPanel(this, L, 4, 436, 424, 136);
    // newest message at the bottom; older ones stack upward until the panel is full
    let yb = 568;
    for (let i = s.log.length - 1; i >= 0; i--) {
      const e = s.log[i];
      const txt = addText(this, L, 10, 0, `D${e.day} ${e.text}`, { size: 13, color: i === s.log.length - 1 ? '#ffffff' : '#a9aed8', wrap: 410 });
      yb -= txt.height + 2;
      if (yb < 440) { txt.destroy(); break; }
      txt.setY(yb);
    }

    addPanel(this, L, 432, 436, 258, 136);
    const k = s.players[s.current];
    const bx = 442;
    const bw = 238;
    if (s.stage === 'gameOver') return;
    const me = this.actor;
    if (me.bot) {
      addText(this, L, 561, 480, `${me.name} (bot) is thinking...`, { size: 17, align: 'center', color: COL.dim });
      return;
    }
    switch (s.stage) {
      case 'roll':
        addText(this, L, bx, 442, `${k.name}'s move`, { size: 17, bold: true, color: hex(k.color) });
        addButton(this, L, bx, 470, bw, 90, 'ROLL THE DIE', () => this.dispatch({ type: 'roll' }), { size: 26, fill: COL.primary });
        break;
      case 'move': {
        const rolled = addText(this, L, 600, 438, `Rolled ${s.moveRoll}`, { size: 34, bold: true, align: 'center', color: COL.gold });
        const die = this.drawDie(505, 462, s.moveRoll);
        if (this.justRolled) {
          this.justRolled = false;
          rolled.setAlpha(0);
          let n = 0;
          this.time.addEvent({
            delay: 55, repeat: 8, callback: () => {
              n++;
              die.setData('face', n < 9 ? 1 + Math.floor(Math.random() * 6) : s.moveRoll);
              this.paintDie(die, n < 9 ? (die.getData('face') as number) : s.moveRoll);
              die.setAngle(n < 9 ? (Math.random() - 0.5) * 50 : 0);
              if (n >= 9) rolled.setAlpha(1);
            },
          });
        }
        addText(this, L, 561, 494, `Tap a glowing node (up to ${s.moveRoll} steps). Tap your own node to stay.`, { size: 14, align: 'center', wrap: bw });
        break;
      }
      case 'pvpOffer': {
        addText(this, L, bx, 440, 'A rival stands here!', { size: 16, bold: true });
        let yy = 464;
        for (const id of s.challengeable) {
          const o = s.players[id];
          addButton(this, L, bx, yy, bw, 42, `Challenge ${o.name}`, () => this.dispatch({ type: 'challenge', target: id }), { size: 16, fill: 0x8a2b2b });
          yy += 46;
        }
        addButton(this, L, bx, yy, bw, 36, 'Leave in peace', () => this.dispatch({ type: 'leave' }), { size: 15 });
        break;
      }
      case 'turnEnd': {
        const nextId = nextKnightId(s);
        const next = nextId !== null ? s.players[nextId] : null;
        const lastOfDay = next === null;
        addText(this, L, 561, 446, 'Turn complete.', { size: 16, align: 'center', color: COL.dim });
        addButton(this, L, bx, 472, bw, 80, 'END TURN', () => this.dispatch({ type: 'endTurn' }), {
          size: 24, fill: 0x2f7a4a, sub: lastOfDay ? 'Next: a new day dawns' : `Pass to ${next!.name}`,
        });
        break;
      }
      default:
        addText(this, L, 561, 490, 'Resolve the encounter...', { size: 16, align: 'center', color: COL.dim });
    }
  }

  private drawDie(x: number, y: number, face: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x, y });
    this.uiLayer.add(g);
    this.paintDie(g, face);
    return g;
  }

  private paintDie(g: Phaser.GameObjects.Graphics, face: number): void {
    g.clear();
    g.fillStyle(0xe8e0cc, 1);
    g.fillRoundedRect(-22, -22, 44, 44, 8);
    g.lineStyle(2, 0x6a5634, 1);
    g.strokeRoundedRect(-22, -22, 44, 44, 8);
    g.fillStyle(0x8c2f39, 1);
    const P: Record<number, [number, number][]> = {
      1: [[0, 0]], 2: [[-10, -10], [10, 10]], 3: [[-10, -10], [0, 0], [10, 10]],
      4: [[-10, -10], [10, -10], [-10, 10], [10, 10]], 5: [[-10, -10], [10, -10], [0, 0], [-10, 10], [10, 10]],
      6: [[-10, -11], [10, -11], [-10, 0], [10, 0], [-10, 11], [10, 11]],
    };
    for (const [px, py] of P[Math.max(1, Math.min(6, face))] ?? []) g.fillCircle(px, py, 4.5);
  }

  // ------------------------------------------------------------ modals

  private overlay(alpha = 0.88): void {
    const r = this.add.rectangle(0, 0, W, H, 0x05060d, alpha).setOrigin(0, 0).setInteractive();
    this.modalLayer.add(r);
  }

  private drawShop(): void {
    const s = this.state;
    const k = s.players[s.current];
    if (k.bot) return;
    const M = this.modalLayer;
    const nd = BOARD.nodes[k.pos];
    this.overlay(0.8);
    addPanel(this, M, 150, 18, 724, 540);
    addText(this, M, 170, 28, `${nd.name} - Village shop`, { size: 24, bold: true });
    addText(this, M, 854, 32, `Gold: ${k.gold}`, { size: 20, bold: true, color: COL.gold, align: 'right' });
    const e = effectiveStats(k);
    addText(this, M, 170, 62, `HP ${k.hp}/${e.maxHp}   Weapon: ${k.weapon ? getItem(k.weapon).name : '-'}   Armor: ${k.armor ? getItem(k.armor).name : '-'}   Pack ${k.consumables.length}/3`, { size: 14, color: COL.dim });
    (nd.stock ?? []).forEach((id, i) => {
      const it = getItem(id);
      const y = 90 + i * 50;
      const why = buyCheck(k, id);
      addPanel(this, M, 166, y, 692, 44, 0x1c2042);
      addText(this, M, 176, y + 4, `${it.name}  (T${it.tier})`, { size: 17, bold: true });
      addText(this, M, 176, y + 25, it.desc, { size: 13, color: '#bfc4ee' });
      addText(this, M, 620, y + 12, `${shopPrice(k, it.price)}g`, { size: 18, bold: true, color: COL.gold, align: 'right' });
      if (why) addText(this, M, 640, y + 14, why, { size: 12, color: '#7a7f99' });
      addButton(this, M, 760, y + 4, 92, 36, 'Buy', () => this.dispatch({ type: 'buy', itemId: id }), { size: 16, enabled: why === null, fill: 0x2f7a4a });
    });
    const q = healQuote(k);
    const hy = 90 + (nd.stock?.length ?? 0) * 50 + 8;
    addPanel(this, M, 166, hy, 692, 44, 0x1c2042);
    addText(this, M, 176, hy + 12, q.hp > 0 ? `Healer: restore ${q.hp} HP for ${q.cost}g` : k.hp >= e.maxHp ? 'Healer: you are in full health' : 'Healer: you cannot afford any healing', { size: 16, bold: true });
    addButton(this, M, 760, hy + 4, 92, 36, 'Heal', () => this.dispatch({ type: 'heal' }), { size: 16, enabled: q.hp > 0, fill: 0x2f7a4a });
    addButton(this, M, 166, hy + 56, 692, 50, 'Leave the village', () => this.dispatch({ type: 'leave' }), { size: 20, fill: COL.primary });
  }

  private drawPvpLoot(): void {
    const s = this.state;
    const pl = s.pendingLoot!;
    const w = s.players[pl.winner];
    const l = s.players[pl.loser];
    if (w.bot) return;
    const M = this.modalLayer;
    this.overlay(0.85);
    addPanel(this, M, 232, 130, 560, 300);
    addText(this, M, 512, 148, `${w.name} wins the duel!`, { size: 28, bold: true, align: 'center', color: hex(w.color) });
    addText(this, M, 512, 190, `${l.name} falls. Choose your spoils:`, { size: 18, align: 'center' });
    const can = stealableSeals(s, w.id, l.id).length > 0;
    const half = Math.floor(l.gold * CONFIG.deathGoldLoss);
    addButton(this, M, 262, 236, 500, 70, 'Take a Seal', () => this.dispatch({ type: 'pvpLoot', take: 'seal' }), {
      size: 22, enabled: can, fill: 0x8a2b2b, sub: can ? `${l.name} holds ${l.seals.length} Seal(s); one you lack is taken` : `${l.name} holds no Seal you lack`,
    });
    addButton(this, M, 262, 322, 500, 70, `Take ${half} gold`, () => this.dispatch({ type: 'pvpLoot', take: 'gold' }), {
      size: 22, fill: 0x9a7b14, sub: `Half of ${l.name}'s ${l.gold} gold`,
    });
  }

  private drawEvent(): void {
    const s = this.state;
    const e = s.event!;
    const k = s.players[s.current];
    if (k.bot) return;
    const M = this.modalLayer;
    this.overlay(0.8);
    const h = 190 + e.options.length * 70;
    const y0 = (H - h) / 2;
    addPanel(this, M, 212, y0, 600, h);
    addText(this, M, 512, y0 + 16, e.title, { size: 28, bold: true, serif: true, align: 'center', color: '#e8d6a8' });
    addText(this, M, 512, y0 + 60, e.text, { size: 17, align: 'center', wrap: 540 });
    addText(this, M, 790, y0 + 20, `Gold ${k.gold}`, { size: 15, bold: true, align: 'right', color: COL.gold });
    e.options.forEach((o, i) => {
      const why = eventOptionBlock(s, i);
      addButton(this, M, 252, y0 + 150 + i * 70, 520, 60, o.label, () => this.dispatch({ type: 'eventChoice', index: i }), {
        size: 19, enabled: why === null, fill: i === e.options.length - 1 ? 0x3a3446 : COL.primary, sub: why ?? o.hint,
      });
    });
  }

  private drawLevelUp(): void {
    const s = this.state;
    const k = s.players[s.current];
    if (k.bot) return;
    const M = this.modalLayer;
    this.overlay(0.85);
    addPanel(this, M, 132, 90, 760, 380);
    addText(this, M, 512, 108, 'LEVEL UP', { size: 34, bold: true, serif: true, align: 'center', color: '#ffd36a' });
    addText(this, M, 512, 152, `${k.name}'s renown grows (${k.renown} victories). Choose a boon - it lasts all game.`, { size: 16, align: 'center', color: COL.dim, wrap: 700 });
    (s.boonChoices ?? []).forEach((id, i) => {
      const b = getBoon(id);
      const x = 162 + i * 240;
      addButton(this, M, x, 200, 220, 220, b.name, () => { audio.play('chime'); this.dispatch({ type: 'chooseBoon', id }); }, { size: 26, fill: 0x3a2f5e, sub: b.desc });
    });
    if (k.boons.length) addText(this, M, 512, 436, `Boons so far: ${k.boons.map((id) => getBoon(id).name).join(', ')}`, { size: 13, align: 'center', color: COL.dim });
  }

  /** End-of-game summary: standings and per-knight story of the hunt. */
  private drawGameOver(): void {
    const s = this.state;
    const M = this.modalLayer;
    const w = s.players[s.winner!];
    this.overlay(0.92);
    addPanel(this, M, 32, 20, 960, 536);
    addText(this, M, 512, 30, 'THE HUNT IS OVER', { size: 16, align: 'center', color: COL.dim });
    addText(this, M, 512, 50, `${w.name} wins!`, { size: 38, bold: true, serif: true, align: 'center', color: hex(w.color) });
    addText(this, M, 512, 98, s.endReason === 'sanctum' ? `Slew the Hollow Warden on day ${s.day} and claimed the Sanctum.` : `Day ${CONFIG.dayCap} ended: most Seals (then gold) wins.`, { size: 16, align: 'center', wrap: 900 });
    const cols: [string, number][] = [['Knight', 60], ['Seals', 300], ['Gold', 370], ['Fights won', 440], ['Duels', 550], ['Deaths', 620], ['Levels', 700], ['Scars', 780]];
    for (const [label, x] of cols) addText(this, M, x, 134, label, { size: 13, bold: true, color: COL.dim });
    const ranked = [...s.players].sort((a, b) => (b.id === w.id ? 1 : 0) - (a.id === w.id ? 1 : 0) || b.seals.length - a.seals.length || b.gold - a.gold);
    ranked.forEach((p, i) => {
      const y = 160 + i * 62;
      addPanel(this, M, 50, y - 6, 924, 56, p.id === w.id ? 0x2a2236 : 0x1a1626);
      this.modalLayer.add(this.add.circle(68, y + 12, 9, p.color));
      addText(this, M, 84, y, p.name, { size: 19, bold: true, serif: true, color: hex(p.color) });
      addText(this, M, 84, y + 24, p.boons.length ? p.boons.map((id) => getBoon(id).name).join(', ') : 'no boons', { size: 11, color: COL.dim, wrap: 200 });
      addText(this, M, 300, y + 4, `${p.seals.length}/4`, { size: 18 });
      addText(this, M, 370, y + 4, `${p.gold}`, { size: 18, color: COL.gold });
      addText(this, M, 440, y + 4, `${p.kills}`, { size: 18 });
      addText(this, M, 550, y + 4, `${p.duelsWon}`, { size: 18 });
      addText(this, M, 620, y + 4, `${p.deaths}`, { size: 18, color: p.deaths ? COL.bad : COL.text });
      addText(this, M, 700, y + 4, `${p.boons.length}`, { size: 18 });
      addText(this, M, 780, y, p.scars.length ? p.scars.map((id) => getScar(id).name).join(', ') : 'unscarred', { size: 12, color: p.scars.length ? COL.bad : COL.dim, wrap: 180 });
    });
    // awards
    const most = (f: (k: Knight) => number) => [...s.players].sort((a, b) => f(b) - f(a))[0];
    const feared = most((k) => k.kills);
    const scarred = most((k) => k.scars.length);
    const rich = most((k) => k.goldEarned);
    const awards = [
      `Most Feared: ${feared.name} (${feared.kills} wins)`,
      scarred.scars.length ? `Most Scarred: ${scarred.name} (${scarred.scars.length})` : 'Nobody was scarred',
      `Deepest Purse: ${rich.name} (${rich.goldEarned} gold earned)`,
    ];
    addText(this, M, 512, 160 + s.players.length * 62 + 4, awards.join('     '), { size: 14, align: 'center', color: '#e8d6a8', wrap: 900 });
    addButton(this, M, 312, 488, 400, 54, 'Back to setup', () => this.onExit(), { size: 22, fill: COL.primary });
  }

  // ------------------------------------------------------------ combat

  private drawCover(title: string, sub: string, label: string, onTap: () => void, color = 0xffffff): void {
    const M = this.modalLayer;
    M.removeAll(true);
    const r = this.add.rectangle(0, 0, W, H, 0x05060d, 1).setOrigin(0, 0).setInteractive();
    M.add(r);
    addText(this, M, W / 2, 150, title, { size: 38, bold: true, align: 'center', color: hex(color) });
    addText(this, M, W / 2, 215, sub, { size: 20, align: 'center', wrap: 760, color: COL.dim });
    addButton(this, M, W / 2 - 200, 330, 400, 90, label, onTap, { size: 26, fill: COL.primary });
  }

  private fighterCard(x: number, side: 'a' | 'b', highlight: boolean): void {
    const s = this.state;
    const c = s.combat!;
    const M = this.modalLayer;
    const fighters = combatFighters(s);
    const f = side === 'a' ? fighters.a : fighters.b;
    const hp = combatHp(s, side);
    const knight = side === 'a' ? s.players[c.a] : c.b !== null ? s.players[c.b] : null;
    const stamina = side === 'a' ? c.staminaA : c.staminaB;
    const maxSta = side === 'a' ? c.maxStaminaA : c.maxStaminaB;
    addPanel(this, M, x, 64, 300, 330, 0x151833).setStrokeStyle(highlight ? 4 : 2, highlight ? 0xffffff : COL.panelEdge);
    const name = knight ? knight.name : c.monster!.name;
    addText(this, M, x + 150, 74, name, { size: 24, bold: true, align: 'center', color: knight ? hex(knight.color) : '#ff9d8a', wrap: 280 });
    addBar(this, M, x + 15, 112, 270, 22, hp.hp / hp.maxHp, COL.hp, `HP ${hp.hp} / ${hp.maxHp}`);
    addBar(this, M, x + 15, 142, 270, 18, stamina / maxSta, COL.sta, `Stamina ${stamina} / ${maxSta}`);
    addText(this, M, x + 15, 170, `Attack ${f.offense}    Defense ${f.defense}`, { size: 18, bold: true });
    addText(this, M, x + 15, 196, `Strike -${f.strikeCost}  Feint -${f.feintCost}  Guard +${f.guardRegen}`, { size: 13, color: COL.dim });
    if (knight) {
      const wep = knight.weapon ? getItem(knight.weapon) : null;
      const arm = knight.armor ? getItem(knight.armor) : null;
      addText(this, M, x + 15, 222, `Weapon: ${wep ? wep.name : '-'}`, { size: 14 });
      addText(this, M, x + 15, 242, `Armor: ${arm ? arm.name : '-'}`, { size: 14 });
      if (knight.scars.length) addText(this, M, x + 15, 266, knight.scars.map((id) => getScar(id).name).join(', '), { size: 12, color: COL.bad, wrap: 270 });
    } else {
      const def = getMonster(c.monsterId!);
      addText(this, M, x + 15, 224, def.hint, { size: 14, color: '#ffd7a8', wrap: 270 });
      addText(this, M, x + 15, 300, `Moon: ${moonEffect(s.day).text}`, { size: 12, color: COL.dim, wrap: 270 });
    }
  }

  private choiceButtons(side: 'a' | 'b', onPick: (c: Choice) => void): void {
    const s = this.state;
    const M = this.modalLayer;
    const fighters = combatFighters(s);
    const f = side === 'a' ? fighters.a : fighters.b;
    const allowed = allowedChoices(f);
    const order: Choice[] = ['strike', 'guard', 'feint'];
    order.forEach((ch, i) => {
      const cost = choiceCost(ch, f);
      addButton(this, M, 334 + i * 123, 250, 116, 100, CHOICE_INFO[ch].label, () => onPick(ch), {
        size: 22, enabled: allowed.includes(ch), fill: ch === 'strike' ? 0x8a2b2b : ch === 'guard' ? 0x2b5b8a : 0x7a5a1c,
        sub: `${ch === 'guard' ? `+${f.guardRegen}` : `-${cost}`} STA\n${CHOICE_INFO[ch].beats}`,
      });
    });
    addText(this, M, 512, 356, 'Strike > Feint > Guard > Strike.  Same move: both hit.', { size: 13, align: 'center', color: COL.dim });
  }

  private itemButtons(knight: Knight): void {
    const M = this.modalLayer;
    knight.consumables.forEach((id, i) => {
      const it = getItem(id);
      addButton(this, M, 334 + i * 123, 372, 116, 34, it.name, () => this.dispatch({ type: 'useItem', slot: i, who: knight.id }), { size: 11, fill: 0x2e4a7a });
    });
    if (knight.consumables.length) addText(this, M, 512, 408, 'Use an item before you choose your move.', { size: 12, align: 'center', color: COL.dim });
  }

  private drawCombat(): void {
    const s = this.state;
    const c = s.combat!;
    const M = this.modalLayer;
    const a = s.players[c.a];
    const b = c.b !== null ? s.players[c.b] : null;

    // reset duel flow whenever a new round (or fight) starts
    const key = `${c.a}-${c.b}-${c.round}-${c.over}`;
    const humanA = !a.bot;
    const humanB = !!b && !b.bot;
    if (key !== this.duelKey) {
      this.duelKey = key;
      this.pendingA = null;
      this.pendingB = null;
      this.duelPhase = humanA && humanB ? 'coverA' : humanA ? 'pickA' : 'pickB';
    }

    // hot-seat cover screens (only when two humans share the device)
    if (c.kind === 'pvp' && !c.over && humanA && humanB) {
      if (this.duelPhase === 'coverA') return this.drawCover(`Pass the device to ${a.name}`, `Round ${c.round + 1} - ${a.name} chooses first. ${b!.name}, look away!`, `I am ${a.name} - show my choices`, () => { this.duelPhase = 'pickA'; this.render(); }, a.color);
      if (this.duelPhase === 'coverB') return this.drawCover(`Pass the device to ${b!.name}`, `${a.name} has chosen in secret. Now ${b!.name} picks.`, `I am ${b!.name} - show my choices`, () => { this.duelPhase = 'pickB'; this.render(); }, b!.color);
      if (this.duelPhase === 'reveal') return this.drawCover('Both fighters have chosen', 'Gather round the screen and reveal the exchange.', 'TAP TO REVEAL', () => {
        const pa = this.pendingA!;
        const pb = this.pendingB!;
        this.state = applyAction(this.state, { type: 'choose', side: 'a', choice: pa });
        this.state = applyAction(this.state, { type: 'choose', side: 'b', choice: pb });
        this.render();
      });
    }

    this.overlay(0.97);
    const title = c.kind === 'pvp' ? `DUEL: ${a.name} vs ${b!.name}` : c.kind === 'guardian' ? 'THE SANCTUM GUARDIAN' : `${c.kind === 'wild' ? 'AMBUSH' : 'LAIR FIGHT'}: ${c.monster!.name}`;
    addText(this, M, 512, 14, title, { size: 24, bold: true, align: 'center' });
    addText(this, M, 512, 42, c.over ? 'Fight over' : `Round ${c.round + 1}`, { size: 16, align: 'center', color: COL.dim });

    const pickingSide: 'a' | 'b' = c.kind === 'pvp' && this.duelPhase === 'pickB' ? 'b' : 'a';
    this.fighterCard(20, 'a', !c.over && pickingSide === 'a');
    this.fighterCard(704, 'b', !c.over && pickingSide === 'b');

    // last round log
    const log = c.roundLog.length ? c.roundLog : ['Choose your move. Both sides choose in secret.'];
    addText(this, M, 512, 70, log.join('\n'), { size: 15, align: 'center', wrap: 352, color: c.roundLog.length ? '#ffffff' : COL.dim });

    if (c.over) {
      const winner = c.outcome === 'a' ? a.name : c.monster ? c.monster.name : b!.name;
      addText(this, M, 512, 250, `${winner} wins!`, { size: 32, bold: true, align: 'center', color: c.outcome === 'a' ? COL.good : COL.bad });
      const human = humanA || humanB;
      if (human) addButton(this, M, 372, 320, 280, 70, 'Continue', () => this.dispatch({ type: 'continue' }), { size: 24, fill: COL.primary });
      else addText(this, M, 512, 330, 'Resolving...', { size: 18, align: 'center', color: COL.dim });
      return;
    }

    if (c.kind !== 'pvp') {
      if (a.bot) {
        addText(this, M, 512, 290, `${a.name} (bot) is fighting...`, { size: 18, align: 'center', color: COL.dim });
        return;
      }
      this.choiceButtons('a', (ch) => this.dispatch({ type: 'choose', side: 'a', choice: ch }));
      this.itemButtons(a);
      if (canFlee(s)) {
        const cost = fleeCost(a);
        addButton(this, M, 372, 438, 280, 46, 'Flee', () => this.dispatch({ type: 'flee' }), { size: 18, fill: 0x555a80, sub: cost ? `costs ${cost} gold` : 'free' });
      }
      return;
    }

    // duel
    const side = pickingSide;
    const who = side === 'a' ? a : b!;
    if ((side === 'a' && a.bot) || (side === 'b' && b!.bot)) {
      addText(this, M, 512, 290, 'The bot is choosing...', { size: 18, align: 'center', color: COL.dim });
      return;
    }
    addText(this, M, 512, 224, `${who.name}: choose your move`, { size: 18, bold: true, align: 'center', color: hex(who.color) });
    this.choiceButtons(side, (ch) => this.onDuelPick(side, ch));
    this.itemButtons(who);
  }

  private onDuelPick(side: 'a' | 'b', ch: Choice): void {
    const c = this.state.combat!;
    const a = this.state.players[c.a];
    const b = this.state.players[c.b!];
    const bothHuman = !a.bot && !b.bot;
    if (!bothHuman) {
      this.dispatch({ type: 'choose', side, choice: ch });
      return;
    }
    if (side === 'a') {
      this.pendingA = ch;
      this.duelPhase = 'coverB';
    } else {
      this.pendingB = ch;
      this.duelPhase = 'reveal';
    }
    this.render();
  }
}
