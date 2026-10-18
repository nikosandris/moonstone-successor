import Phaser from 'phaser';
import { botAction } from '../core/bot';
import { allowedChoices, choiceCost } from '../core/combat';
import {
  actorId, affinityText, applyAction, canFlee, combatFighters, combatHp, createGame, fleeCost,
} from '../core/game';
import { reachable, shortestPath } from '../core/graph';
import { isSanctumOpen, moonEffect, phaseForDay } from '../core/moon';
import type { Action, BoardNode, Choice, GameState, Knight, PlayerSetup } from '../core/types';
import { CONFIG, PHASE_NAMES } from '../data/balance';
import { BOARD } from '../data/board';
import { getItem } from '../data/items';
import { getMonster } from '../data/monsters';
import { getScar } from '../data/scars';
import {
  COL, H, NODE_LABEL, SEAL_COLORS, SERIF, W, hex,
} from './theme';
import { generateTextures } from './art/textures';
import { audio } from './audio';
import { Arena3D } from './arena3d/Arena3D';
import { is3dReady, preload3d, preloadAllSf, webgl2Available } from './arena3d/assets3d';
import { loadMapAssets } from './map3d/mapAssets';
import { MapWorld3D } from './map3d/MapWorld3D';
import { getLang, t, td, tlog, tn } from './i18n';
import { showSettings } from './overlays';
import { showCodex } from './codex';
import { MapHud, type TutorialStep } from './hud/MapHud';
import { saveGame } from './save';
import { getSettings, lowGraphics, onSettings, updateSettings } from './settings';
import { addBar, addButton, addPanel, addText } from './widgets';

interface SceneData {
  players: PlayerSetup[];
  seed: number;
  resume?: GameState;
  onExit: () => void;
}

// map placement: board space (1000 x 600) -> screen
const MAP_SCALE = 0.67;
const MAP_X = 14;
const MAP_Y = 22;
const mx = (x: number) => MAP_X + x * MAP_SCALE;
const my = (y: number) => MAP_Y + y * MAP_SCALE;


const CHOICE_INFO: Record<Choice, { label: string; beats: string }> = {
  strike: { label: 'Strike', beats: 'beats Feint' },
  guard: { label: 'Guard', beats: 'beats Strike' },
  feint: { label: 'Feint', beats: 'beats Guard' },
};

/** All caps for banners; Greek capitals carry no accents. */
function upper(text: string): string {
  const u = text.toUpperCase();
  return getLang() === 'el' ? u.normalize('NFD').replace(/\u0301/g, '').normalize('NFC') : u;
}

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
  private tutStep = -1;
  private hud!: MapHud;
  /** the 3D diorama board; null until its models load, or when WebGL2 is unavailable (2D map then) */
  private map3d: MapWorld3D | null = null;
  private mapLow = false;
  private tutSteps: TutorialStep[] | null = null;

  // hot-seat duel flow (choices stay in memory until the reveal)
  private duelKey = '';
  private duelPhase: DuelPhase = 'pickA';
  private pendingA: Choice | null = null;
  private pendingB: Choice | null = null;

  constructor() {
    super('Game');
  }

  init(data: SceneData): void {
    this.state = data.resume ?? createGame(data.players, data.seed);
    this.onExit = data.onExit;
    this.tutStep = !data.resume && getSettings().tutorial && this.state.players.some((p) => !p.bot) ? 0 : -1;
    saveGame(this.state);
    this.duelKey = '';
  }

  create(): void {
    generateTextures(this);
    this.add.rectangle(0, 0, W, H, COL.bg).setOrigin(0, 0);
    this.drawMapBackdrop();
    this.nodesLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);
    this.modalLayer = this.add.container(0, 0).setDepth(100);
    this.infoText = this.add.text(10, 2, '', { fontFamily: 'Spectral, Georgia, serif', fontStyle: 'italic', fontSize: '14px', color: '#c9bfae', resolution: 2 });
    this.toastText = this.add
      .text(W / 2, H - 18, '', {
        fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: '#ffffff', backgroundColor: '#8a2b2b', padding: { x: 10, y: 4 }, resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(200)
      .setVisible(false);
    // ?speed=N shortens bot delays (used for automated checks)
    this.applySpeed();
    onSettings(() => this.applySpeed());
    // load the 3D arena models in the background; fights use the 2D arena until they are ready
    if (webgl2Available()) {
      const core = preload3d();
      core.then(() => preloadAllSf(), (e) => console.warn('3D assets failed to load, using the 2D arena', e));
      const veil = document.createElement('div');
      veil.className = 'm3d-loading';
      veil.innerHTML = '<div class="m3d-ltitle">Moonblood</div><div class="m3d-lsub">The realm takes shape&hellip;</div><div class="m3d-lbar"><i></i></div>';
      document.body.appendChild(veil);
      const bar = veil.querySelector('i') as HTMLElement;
      const done = () => { veil.classList.add('out'); window.setTimeout(() => veil.remove(), 700); };
      this.events.once('shutdown', () => veil.remove());
      Promise.all([core, loadMapAssets((f) => { bar.style.width = `${Math.round(f * 100)}%`; })])
        .then(() => { this.openMap3d(); done(); }, (e) => { console.warn('3D map failed to load, using the 2D map', e); done(); });
    }
    const cleanup = () => { Arena3D.closeCurrent(); this.map3d?.dispose(); this.map3d = null; };
    this.events.once('shutdown', cleanup);
    this.events.once('destroy', cleanup);
    // keyboard: Space/Enter rolls the die or ends the turn
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const s = this.state;
      if (this.actor.bot || (this.tutorialStep() && !this.tutorialStep()!.step.wait)) return;
      if (s.stage === 'roll') this.dispatch({ type: 'roll' });
      else if (s.stage === 'turnEnd') this.dispatch({ type: 'endTurn' });
    });
    this.lastPos = this.state.players.map((p) => p.pos);
    this.hud = new MapHud({
      dispatch: (a) => this.dispatch(a),
      onMenu: () => showSettings({ inGame: true, onQuit: () => this.onExit(), onChange: () => this.render() }),
      onHelp: () => showCodex(),
      nodeScreen: (id) => this.map3d?.screenOf(id, 1) ?? null,
      onToggleSound: () => { updateSettings({ muted: !getSettings().muted }); this.render(); },
      onExit: () => this.onExit(),
      onTutorial: (step) => { this.tutStep = step; this.render(); },
    });
    this.events.once('shutdown', () => this.hud.destroy());
    this.events.once('destroy', () => this.hud.destroy());
    this.scale.on('resize', () => this.hud.layout());
    this.render();
  }

  /** Animation speed setting (and ?speed=N for automated checks) scales timers and tweens. */
  private applySpeed(): void {
    if (!this.sys || !this.sys.isActive()) return;
    const url = Number(new URLSearchParams(window.location.search).get('speed')) || 1;
    this.time.timeScale = getSettings().animSpeed * url;
    this.tweens.timeScale = getSettings().animSpeed * url;
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
    saveGame(this.state);
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
      else this.phaseBanner(tn(PHASE_NAMES[p1]));
    }
  }

  private phaseBanner(text: string): void {
    audio.play('chime');
    const t = this.add.text(347, 60, upper(text), { fontFamily: SERIF, fontSize: '34px', fontStyle: 'bold', color: '#e8d6a8', stroke: '#000000', strokeThickness: 6, resolution: 2 }).setOrigin(0.5).setDepth(150).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 80, duration: 500, yoyo: true, hold: 1400, onComplete: () => t.destroy() });
  }

  /** Full moon rises: darken, a huge moon swells, a sting, then the Sanctum glows. */
  private sanctumCinematic(): void {
    audio.play('sting');
    const c = this.add.container(0, 0).setDepth(160);
    const dark = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0, 0).setAlpha(0);
    const glow = this.add.image(W / 2, 250, 'glow').setTint(0xfff0c0).setBlendMode(Phaser.BlendModes.ADD).setScale(1).setAlpha(0);
    const moon = this.add.image(W / 2, 330, 'moon-full').setScale(0.4).setAlpha(0);
    const t1 = this.add.text(W / 2, 430, upper(t('THE FULL MOON RISES')), { fontFamily: SERIF, fontSize: '40px', fontStyle: 'bold', color: '#ffe3a0', stroke: '#000', strokeThickness: 6, resolution: 2 }).setOrigin(0.5).setAlpha(0);
    const t2 = this.add.text(W / 2, 480, t('The Sanctum stands open. Bring three Seals.'), { fontFamily: SERIF, fontSize: '22px', color: '#e8d6a8', resolution: 2 }).setOrigin(0.5).setAlpha(0);
    c.add([dark, glow, moon, t1, t2]);
    this.tweens.add({ targets: dark, alpha: 0.88, duration: 500 });
    this.tweens.add({ targets: moon, alpha: 1, y: 250, scale: 1.5, duration: 1800, ease: 'Sine.easeOut', delay: 300 });
    this.tweens.add({ targets: glow, alpha: 0.7, scale: 5, duration: 2000, delay: 500 });
    this.tweens.add({ targets: [t1, t2], alpha: 1, duration: 600, delay: 1300 });
    this.cameras.main.shake(900, 0.003);
    this.time.delayedCall(2900, () => this.tweens.add({ targets: c.list, alpha: 0, duration: 600, onComplete: () => c.destroy() }));
  }

  private flash(msg: string): void {
    this.toastText.setText(t(msg)).setVisible(true);
    this.time.delayedCall(1800, () => this.toastText.setVisible(false));
  }

  private get actor(): Knight {
    return this.state.players[actorId(this.state)];
  }

  private openMap3d(): void {
    if (!this.sys || !this.sys.isActive() || this.map3d) return;
    this.mapLow = lowGraphics();
    document.documentElement.classList.toggle('lowgfx', this.mapLow);
    try {
      this.map3d = new MapWorld3D({
        onNodeClick: (id) => this.onNodeTap(id),
        onNodeHover: (id) => { this.hud.setTooltip(id === null ? null : this.nodeTip(id)); },
      });
    } catch (e) {
      console.warn('3D map unavailable, using the 2D map', e);
      return;
    }
    this.render();
  }

  /** The places the human may move to right now. */
  private reachNow(): Set<number> {
    const s = this.state;
    return s.stage === 'move' && !this.actor.bot ? new Set(reachable(s.players[s.current].pos, s.moveRoll)) : new Set<number>();
  }

  private onNodeTap(id: number): void {
    if (this.reachNow().has(id)) {
      this.hud.setTooltip(null);
      this.dispatch({ type: 'move', to: id });
      return;
    }
    this.infoNode = id;
    this.hud.setTooltip(this.nodeTip(id));
  }

  /** Tooltip content for a place: what it is and what stopping there does. */
  private nodeTip(id: number): { node: number; title: string; kind: string; text: string; reach: boolean; screen: { x: number; y: number } | null } {
    const n = BOARD.nodes[id];
    const kind = n.type === 'home' ? tn('Keep') : n.type === 'sanctum' ? t(isSanctumOpen(this.state.day) ? 'Open' : 'Sealed') : tn(NODE_LABEL[n.type]);
    const owner = this.state.players.find((p) => p.seat === n.seat)?.name;
    const title = n.type === 'home' ? (owner ? t("{name}'s Keep", { name: owner }) : t('Empty Keep')) : tn(n.name);
    return { node: id, title, kind, text: this.nodeInfo(n), reach: this.reachNow().has(id), screen: this.map3d?.screenOf(id, n.type === 'road' ? 1 : 2) ?? null };
  }

  private render(): void {
    this.botTimer?.remove(false);
    this.botTimer = null;
    this.pulse = [];
    this.nodesLayer.removeAll(true);
    this.uiLayer.removeAll(true);
    this.modalLayer.removeAll(true);
    this.infoText.setText(this.infoNode !== null ? this.nodeInfo(BOARD.nodes[this.infoNode]) : t('Tap any node for details.'));

    const s = this.state;
    // the Graphics setting rebuilds the board with the other renderer profile
    if (this.map3d && this.mapLow !== lowGraphics()) {
      this.map3d.dispose();
      this.map3d = null;
      this.openMap3d();
      return;
    }
    if (this.map3d) {
      this.map3d.update({ state: s, reach: this.reachNow() });
      // every fight covers the board; the Phaser canvas is only needed for the 2D and classic fights
      this.map3d.setPaused(s.stage === 'combat');
      this.game.canvas.style.visibility = s.stage === 'combat' && this.realtimeMode() !== 'arena3d' ? 'visible' : 'hidden';
    } else {
      this.drawNodes();
    }
    const arena = s.stage === 'combat' && this.realtimeMode() !== 'classic';
    this.syncArena(arena);
    if (s.stage === 'combat' && !arena) this.drawCombat();
    const tut = this.tutorialStep();
    this.hud.render(s, { justRolled: this.justRolled, tutorial: tut ? tut.step : null, tutIndex: this.tutStep, tutTotal: tut ? tut.total : 0, actorBot: this.actor.bot });
    this.justRolled = false;
    this.scheduleBot();
  }

  // ------------------------------------------------------------ bots

  /** The arena is a separate scene layered on top; it drives fights (including bot moves) itself. */
  /** Which duel presentation applies right now; the 3D arena falls back to 2D until its models are loaded. */
  private realtimeMode(): 'arena3d' | 'arena' | 'classic' {
    const m = getSettings().duelMode;
    if (m === 'arena3d' && (!webgl2Available() || !is3dReady())) return 'arena';
    return m;
  }

  private syncArena(on: boolean): void {
    const mode = this.realtimeMode();
    const host = { getState: () => this.state, dispatch: (a: Action) => this.dispatch(a), canvas: () => this.game.canvas };
    const active2d = this.scene.isActive('Arena') || this.scene.isPaused('Arena');
    if (on && mode === 'arena3d') {
      if (!Arena3D.isOpen()) Arena3D.open(host);
    } else if (Arena3D.isOpen()) Arena3D.closeCurrent();
    if (on && mode === 'arena' && !active2d) {
      this.scene.launch('Arena', { host });
      this.scene.bringToTop('Arena');
    }
    if ((!on || mode !== 'arena') && active2d) this.scene.stop('Arena');
    this.input.enabled = !on;
  }

  private scheduleBot(): void {
    const s = this.state;
    if (s.stage === 'gameOver') return;
    if (s.stage === 'combat' && this.realtimeMode() !== 'classic') return;
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
    border.lineStyle(3, 0x6b5126, 1);
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
      case 'home': return t('{name}: free full heal for its knight.', { name: tn(n.name) });
      case 'road': return t('{name}: nothing here but dust.', { name: tn(n.name) });
      case 'village': return t('{name} (Village): shop and healing for gold.', { name: tn(n.name) });
      case 'lair': {
        const m = getMonster(n.monster!);
        const aff = affinityText(m.id, s.day);
        return t('{name} (Lair): {monster} guards Seal {n}.', { name: tn(n.name), monster: tn(m.name), n: n.seal! + 1 }) + ` ${td(m.hint)}${aff ? ` ${tlog(aff)}.` : ''}`;
      }
      case 'ruins': {
        const ready = s.day >= (s.ruinsReady[n.id] ?? 0);
        return t('{name} (Ruins): loot, gold or a trap.', { name: tn(n.name) }) + ' ' + (ready ? t('Unexplored.') : t('Picked clean until day {n}.', { n: s.ruinsReady[n.id] }));
      }
      case 'sanctum':
        return t('The Sanctum: opens under the Full moon. Enter with {n}+ Seals and beat the Warden to win.', { n: CONFIG.sealsToEnter });
    }
  }

  // ------------------------------------------------------------ side panel

  // ------------------------------------------------------------ bottom bar (log + actions)

  // ------------------------------------------------------------ tutorial

  /** First-turn coach marks. Some steps wait for the player to act (roll, move). */
  /** First-turn coach marks. Some steps wait for the player to act (roll, move). */
  private tutorialStep(): { step: TutorialStep; total: number } | null {
    const s = this.state;
    if (this.tutStep < 0 || s.stage === 'gameOver') return null;
    const me = s.players[s.current];
    if (me.bot) return null;
    if (!this.tutSteps) this.tutSteps = this.buildTutorial();
    const steps = this.tutSteps;
    // steps that wait for an action advance by themselves
    if (steps[this.tutStep]?.target === 'dock' && s.stage !== 'roll') this.tutStep++;
    if (steps[this.tutStep]?.target === 'map' && s.stage !== 'move' && s.stage !== 'roll') this.tutStep++;
    if (s.stage === 'combat' && this.realtimeMode() !== 'classic') return null;
    if (this.tutStep >= steps.length) {
      this.tutStep = -1;
      updateSettings({ tutorial: false });
      return null;
    }
    return { step: steps[this.tutStep], total: steps.length };
  }

  /** The first-turn walkthrough, built once from where the first human knight starts. */
  private buildTutorial(): TutorialStep[] {
    const s = this.state;
    const me = s.players[s.current];
    const village = BOARD.nodes.find((n) => n.type === 'village' && reachable(me.pos, 2).includes(n.id));
    const lair = BOARD.nodes.find((n) => n.type === 'lair' && reachable(me.pos, 3).includes(n.id));
    const steps: TutorialStep[] = [
      { target: `node:${me.pos}`, title: t('Welcome'), text: t('<b>{name}</b>, this is your knight at your Keep. Stopping at your own Keep heals you fully.', { name: me.name }) },
      { target: 'hero', title: t('Your knight'), text: t('<b>Health</b>, <b>Attack</b> (added to your blows), <b>Defense</b> (taken off blows you suffer), <b>Stamina</b> and <b>gold</b>. Below: your gear, potions and the four <b>Seals</b>.') },
      { target: 'moon', title: t('How to win'), text: t('Take <b>{n} Seals</b> from the monster lairs, then reach the <b>Sanctum</b> in the middle while the <b>Full moon</b> is up and defeat its guardian. The moon also makes monsters weaker (New) or stronger (Full).', { n: CONFIG.sealsToEnter }) },
      ...(lair ? [{ target: `node:${lair.id}`, title: t('Lairs'), text: t('Each lair holds a monster and the Seal floating above it. Win the fight to take the Seal. The colour of the gem shows which Seal it is.') }] : []),
      ...(village ? [{ target: `node:${village.id}`, title: t('Villages'), text: t('Villages sell better weapons, armour and potions, and heal you for gold. Ruins hide loot (or traps); roads bring random events.') }] : []),
      { target: 'roster', title: t('Rivals'), text: t('Everyone moves in this order; it is re-rolled each dawn. Stop on a rival to duel them for a Seal or half their gold.') },
      { target: 'dock', title: t('Your move'), text: t('Roll the die to begin.'), wait: true },
      { target: 'map', title: t('Choose a place'), text: t('Glowing places are within reach. Hover or tap any place to see what it does; tap a glowing one to travel there.'), wait: true },
      { target: 'help', title: t('Fights'), text: t('In a fight you and the monster each pick <b>Strike</b>, <b>Guard</b> or <b>Feint</b>: Strike beats Feint, Feint beats Guard, Guard beats Strike. The monster shows its move a moment early; the fight screen explains it. The <b>?</b> button explains everything again.') },
    ];
    return steps;
  }

  // ------------------------------------------------------------ modals

  private overlay(alpha = 0.88): void {
    const r = this.add.rectangle(0, 0, W, H, 0x05060d, alpha).setOrigin(0, 0).setInteractive();
    this.modalLayer.add(r);
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
