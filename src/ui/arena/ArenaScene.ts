import Phaser from 'phaser';
import { botAction } from '../../core/bot';
import { allowedChoices } from '../../core/combat';
import { canFlee, combatFighters, combatHp, fleeCost, previewMonsterChoice } from '../../core/game';
import { moonEffect, phaseForDay } from '../../core/moon';
import type { Action, Choice, GameState, Knight } from '../../core/types';
import { getItem } from '../../data/items';
import { getMonster } from '../../data/monsters';
import { audio } from '../audio';
import { getSettings } from '../settings';
import { COL, H, W, hex } from '../theme';
import { addBar, addButton, addText } from '../widgets';
import { Fighter } from './Fighter';

export interface ArenaHost {
  getState(): GameState;
  dispatch(action: Action): void;
}

type Side = 'a' | 'b';
type Phase = 'prep' | 'window' | 'impact' | 'over';

const GROUND = 420;
const PVP_WINDOW = 1800;
const IMPACT_MS = 700;

const KEYS: Record<string, Choice> = { J: 'strike', K: 'guard', L: 'feint', A: 'strike', S: 'guard', D: 'feint', ONE: 'strike', TWO: 'guard', THREE: 'feint', RIGHT: 'strike', UP: 'guard', DOWN: 'feint' };
const LEFT_KEYS = new Set(['A', 'S', 'D']);
const RIGHT_KEYS = new Set(['J', 'K', 'L']);
const LABEL: Record<Choice, string> = { strike: 'STRIKE', guard: 'GUARD', feint: 'FEINT' };
const BEATS: Record<Choice, string> = { strike: 'beats Feint', guard: 'beats Strike', feint: 'beats Guard' };
const FILL: Record<Choice, number> = { strike: 0x8a2b2b, guard: 0x2b5b8a, feint: 0x7a5a1c };

/** Real-time side-view duel. It only produces the same `choose` actions as the classic screen. */
export class ArenaScene extends Phaser.Scene {
  private host!: ArenaHost;
  private a!: Fighter;
  private b!: Fighter;
  private hud!: Phaser.GameObjects.Container;
  private controls!: Phaser.GameObjects.Container;
  private fx!: Phaser.GameObjects.Container;
  private phase: Phase = 'prep';
  private timer: Phaser.Time.TimerEvent | null = null;
  private windowMs = 1000;
  private intent: Partial<Record<Side, Choice>> = {};
  private locked: Partial<Record<Side, Choice>> = {};
  private botTime: Partial<Record<Side, number>> = {};
  private banner!: Phaser.GameObjects.Text;
  private bloodFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustFx!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('Arena');
  }

  init(data: { host: ArenaHost }): void {
    this.host = data.host;
    this.phase = 'prep';
    this.intent = {};
    this.locked = {};
  }

  private get s(): GameState {
    return this.host.getState();
  }

  private knight(side: Side): Knight | null {
    const c = this.s.combat!;
    return side === 'a' ? this.s.players[c.a] : c.b !== null ? this.s.players[c.b] : null;
  }

  private human(side: Side): boolean {
    const k = this.knight(side);
    return !!k && !k.bot;
  }

  create(): void {
    const urlSpeed = Number(new URLSearchParams(window.location.search).get('speed')) || 1;
    const speed = getSettings().animSpeed * urlSpeed;
    this.time.timeScale = speed;
    this.tweens.timeScale = speed;
    this.add.rectangle(-200, -200, W + 400, H + 400, 0x000000).setOrigin(0, 0);
    this.cameras.main.setBounds(0, 0, W, H);
    this.drawBackdrop();
    const c = this.s.combat!;
    const ka = this.s.players[c.a];
    this.a = new Fighter(this, 380, GROUND, 1, { kind: 'knight', color: ka.color, scars: ka.scars });
    if (c.monsterId) {
      const def = getMonster(c.monsterId);
      this.b = new Fighter(this, 660, GROUND, -1, { kind: 'monster', shape: def.shape, color: def.color });
    } else {
      const kb = this.s.players[c.b!];
      this.b = new Fighter(this, 644, GROUND, -1, { kind: 'knight', color: kb.color, scars: kb.scars });
    }
    this.a.idle();
    this.b.idle();
    this.createEmitters();
    this.hud = this.add.container(0, 0);
    this.fx = this.add.container(0, 0).setDepth(50);
    this.controls = this.add.container(0, 0).setDepth(60);
    this.banner = this.add.text(W / 2, 215, '', { fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 6, resolution: 2 }).setOrigin(0.5).setDepth(70);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.drawHud();
    this.prep();
  }

  // ---------------------------------------------------------------- scenery

  private drawBackdrop(): void {
    const s = this.s;
    const c = s.combat!;
    const where = c.kind === 'guardian' ? 'sanctum' : c.kind === 'monster' ? 'lair' : 'field';
    const g = this.add.graphics();
    const sky = where === 'lair' ? [0x120a0e, 0x2a1418] : where === 'sanctum' ? [0x0a0c22, 0x2a2450] : [0x0d1030, 0x2a1f3a];
    g.fillGradientStyle(sky[0], sky[0], sky[1], sky[1], 1);
    g.fillRect(0, 0, W, GROUND);
    if (where !== 'lair') {
      const phase = phaseForDay(s.day);
      this.add.image(W / 2, 200, 'glow').setTint(0xf4f1d0).setAlpha(0.25).setScale(2.2).setBlendMode(Phaser.BlendModes.ADD);
      this.add.image(W / 2, 200, `moon-${phase}`).setScale(0.62).setAlpha(0.9);
    }
    const ridge = (base: number, amp: number, color: number, f: number) => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(0, GROUND);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, base - Math.sin(x * f + base) * amp - Math.cos(x * f * 2.3) * amp * 0.4);
      g.lineTo(W, GROUND);
      g.closePath();
      g.fillPath();
    };
    if (where === 'lair') {
      // cave: rock walls, an arch and hanging stalactites
      ridge(GROUND - 120, 30, 0x1e1418, 0.02);
      g.fillStyle(0x140c10, 1);
      g.fillRect(0, 0, 120, GROUND);
      g.fillRect(W - 120, 0, 120, GROUND);
      g.fillEllipse(W / 2, -40, W * 1.1, 220);
      for (let i = 0; i < 26; i++) {
        const x = 40 + i * 38 + Math.sin(i * 7) * 10;
        const h = 30 + ((i * 37) % 60);
        g.fillTriangle(x - 10, 50, x + 10, 50, x, 50 + h);
      }
      this.torch(150, GROUND - 170);
      this.torch(W - 150, GROUND - 170);
    } else if (where === 'sanctum') {
      ridge(GROUND - 70, 20, 0x14142a, 0.012);
      for (const [x, h] of [[90, 210], [230, 250], [W - 230, 250], [W - 90, 210]] as const) {
        g.fillStyle(0x2a2a3e, 1);
        g.fillRect(x - 26, GROUND - h, 52, h);
        g.fillStyle(0x3a3a52, 1);
        g.fillRect(x - 26, GROUND - h, 12, h);
      }
      g.fillStyle(0x2a2a3e, 1);
      g.fillRect(190, GROUND - 270, 90, 24);
      g.fillRect(W - 280, GROUND - 270, 90, 24);
      this.add.particles(0, 0, 'dot', {
        x: { min: 0, max: W }, y: { min: 120, max: GROUND }, lifespan: 4000, speedY: { min: -14, max: -4 },
        scale: { start: 0.5, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: 0xffd88a, frequency: 140, blendMode: 'ADD',
      });
    } else {
      ridge(GROUND - 80, 26, 0x161a33, 0.011);
      ridge(GROUND - 40, 14, 0x10132a, 0.02);
      for (let i = 0; i < 18; i++) {
        const x = (i * 61 + 17) % W;
        const h = 50 + ((i * 29) % 50);
        g.fillStyle(0x0a0c1c, 1);
        g.fillTriangle(x - h * 0.3, GROUND - 20, x + h * 0.3, GROUND - 20, x, GROUND - 20 - h);
      }
    }
    // ground with pebbles
    g.fillGradientStyle(0x2a2026, 0x2a2026, 0x0b0a10, 0x0b0a10, 1);
    g.fillRect(0, GROUND, W, H - GROUND);
    for (let i = 0; i < 70; i++) {
      g.fillStyle(0x3a3036, 0.6);
      g.fillEllipse((i * 97) % W, GROUND + 6 + ((i * 53) % (H - GROUND - 10)), 6 + (i % 5) * 2, 3 + (i % 3));
    }
    g.lineStyle(2, 0x4a3a40, 1);
    g.lineBetween(0, GROUND, W, GROUND);
    const fog = this.add.tileSprite(0, GROUND - 90, W, 140, 'fog').setOrigin(0, 0).setAlpha(where === 'lair' ? 0.12 : 0.2);
    this.tweens.add({ targets: fog, tilePositionX: 512, duration: 40000, repeat: -1 });
  }

  private torch(x: number, y: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x3a2a1a, 1);
    g.fillRect(x - 4, y, 8, 40);
    const glow = this.add.image(x, y - 6, 'glow').setTint(0xff8a30).setBlendMode(Phaser.BlendModes.ADD).setScale(2.2).setAlpha(0.5);
    this.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.6 }, scale: { from: 2, to: 2.4 }, duration: 160, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.particles(x, y - 4, 'dot', {
      speedY: { min: -60, max: -20 }, speedX: { min: -10, max: 10 }, lifespan: 700, scale: { start: 0.9, end: 0 },
      tint: [0xffd060, 0xff7020, 0xff3010], blendMode: 'ADD', frequency: 40,
    });
  }

  private createEmitters(): void {
    this.bloodFx = this.add.particles(0, 0, 'dot', {
      emitting: false, speed: { min: 120, max: 340 }, angle: { min: 200, max: 340 }, gravityY: 700, lifespan: 800,
      scale: { start: 0.9, end: 0.2 }, tint: [0x8a0a0a, 0xb01818, 0xd02020],
    }).setDepth(40);
    this.sparkFx = this.add.particles(0, 0, 'spark', {
      emitting: false, speed: { min: 220, max: 480 }, lifespan: 320, rotate: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 }, tint: [0xffffff, 0xffe08a, 0x9fd8ff], blendMode: 'ADD',
    }).setDepth(40);
    this.dustFx = this.add.particles(0, 0, 'dot', {
      emitting: false, speed: { min: 20, max: 70 }, angle: { min: 180, max: 360 }, lifespan: 600,
      scale: { start: 0.8, end: 2 }, alpha: { start: 0.45, end: 0 }, tint: 0x8a7a6a,
    }).setDepth(30);
  }

  private blood(x: number, y: number, n: number): void {
    if (getSettings().blood) this.bloodFx.explode(n, x, y);
    else this.sparkFx.explode(Math.ceil(n / 2), x, y);
  }

  // ---------------------------------------------------------------- HUD

  private drawHud(): void {
    this.hud.removeAll(true);
    const s = this.s;
    const c = s.combat;
    if (!c) return;
    const fighters = combatFighters(s);
    for (const side of ['a', 'b'] as Side[]) {
      const k = this.knight(side);
      const hp = combatHp(s, side);
      const x = side === 'a' ? 20 : W - 340;
      const name = k ? k.name : c.monster!.name;
      const color = k ? hex(k.color) : '#ff9d8a';
      addText(this, this.hud, x, 10, name, { size: 22, bold: true, color });
      addBar(this, this.hud, x, 40, 320, 20, hp.hp / hp.maxHp, COL.hp, `${hp.hp} / ${hp.maxHp}`);
      const sta = side === 'a' ? c.staminaA : c.staminaB;
      const max = side === 'a' ? c.maxStaminaA : c.maxStaminaB;
      for (let i = 0; i < max; i++) {
        const pip = this.add.rectangle(x + i * (320 / max), 66, 320 / max - 3, 9, i < sta ? COL.sta : 0x1d2140).setOrigin(0, 0);
        this.hud.add(pip);
      }
      const f = side === 'a' ? fighters.a : fighters.b;
      addText(this, this.hud, x, 80, `ATK ${f.offense}  DEF ${f.defense}`, { size: 14, color: COL.dim });
      if (this.locked[side] && c.kind === 'pvp' && this.phase === 'window') {
        addText(this, this.hud, x + 160, 80, 'READY', { size: 16, bold: true, color: COL.good });
      }
    }
    const title = c.kind === 'pvp' ? 'DUEL' : c.kind === 'guardian' ? 'THE WARDEN' : 'LAIR';
    addText(this, this.hud, W / 2, 10, `${title} - Round ${c.round + 1}`, { size: 18, bold: true, align: 'center' });
    if (c.monsterId) {
      addText(this, this.hud, W / 2, 34, getMonster(c.monsterId).hint, { size: 13, align: 'center', color: '#ffd7a8', wrap: 330 });
      addText(this, this.hud, W / 2, 86, moonEffect(s.day).text, { size: 11, align: 'center', color: COL.dim, wrap: 330 });
    }
    if (c.roundLog.length && this.phase !== 'window') {
      addText(this, this.hud, W / 2, 112, c.roundLog.slice(1).join('\n'), { size: 14, align: 'center', color: '#e8e6f0', wrap: 420 });
    }
  }

  private clearControls(): void {
    this.controls.removeAll(true);
  }

  /** Move buttons for a side. In a duel each human gets one half of the screen. */
  private drawMoveButtons(side: Side, x: number, w: number, keys: string): void {
    const s = this.s;
    const f = side === 'a' ? combatFighters(s).a : combatFighters(s).b;
    const allowed = allowedChoices(f);
    const order: Choice[] = ['strike', 'guard', 'feint'];
    const bw = (w - 16) / 3;
    order.forEach((ch, i) => {
      const done = !!this.locked[side];
      const hidden = s.combat!.kind === 'pvp';
      const sel = !hidden && this.locked[side] === ch;
      addButton(this, this.controls, x + i * (bw + 8), 470, bw, 92, LABEL[ch], () => this.commit(side, ch), {
        size: w > 400 ? 22 : 17,
        enabled: allowed.includes(ch) && !done,
        fill: sel ? 0xffffff : FILL[ch],
        textColor: sel ? '#000000' : undefined,
        sub: `${keys[i]}  ${BEATS[ch]}`,
      });
    });
  }

  private drawItemButtons(side: Side, x: number): void {
    const k = this.knight(side);
    if (!k || k.bot) return;
    k.consumables.forEach((id, i) => {
      addButton(this, this.controls, x, 300 + i * 40, 150, 34, getItem(id).name, () => {
        this.host.dispatch({ type: 'useItem', slot: i, who: k.id });
        this.drawHud();
        this.prepControls();
      }, { size: 12, fill: 0x2e4a7a });
    });
  }

  // ---------------------------------------------------------------- flow

  private prep(): void {
    this.phase = 'prep';
    this.intent = {};
    this.locked = {};
    this.botTime = {};
    this.a.resetPose();
    this.b.resetPose();
    this.drawHud();
    const s = this.s;
    const c = s.combat;
    if (!c) return;
    if (c.over) return this.over();

    // bots settle items/flee now, and pick their move for the coming window
    for (const side of ['a', 'b'] as Side[]) {
      const k = this.knight(side);
      if (!k || !k.bot) continue;
      for (let guard = 0; guard < 6; guard++) {
        const act = botAction(this.s, side);
        if (act.type === 'choose') { this.intent[side] = act.choice; break; }
        this.host.dispatch(act);
        if (act.type === 'flee' || this.s.stage !== 'combat') return;
      }
      this.botTime[side] = 0.45 + Math.random() * 0.4;
    }
    this.drawHud();
    this.prepControls();
    const anyHuman = this.human('a') || this.human('b');
    if (c.round === 0 && anyHuman) return; // wait for FIGHT (lets the player use items or flee)
    this.timer = this.time.delayedCall(c.round === 0 ? 700 : 1100, () => this.startWindow());
  }

  private prepControls(): void {
    this.clearControls();
    const s = this.s;
    const c = s.combat;
    if (!c || this.phase !== 'prep') return;
    this.drawItemButtons('a', 20);
    if (c.kind === 'pvp') this.drawItemButtons('b', W - 170);
    if (c.round === 0 && (this.human('a') || this.human('b'))) {
      addButton(this, this.controls, W / 2 - 130, 470, 260, 80, 'FIGHT!', () => this.startWindow(), { size: 30, fill: COL.primary, sub: 'Space / Enter' });
      if (canFlee(s) && this.human('a')) {
        const cost = fleeCost(this.s.players[c.a]);
        addButton(this, this.controls, W / 2 + 150, 486, 160, 50, 'Flee', () => this.host.dispatch({ type: 'flee' }), { size: 18, fill: 0x555a80, sub: cost ? `-${cost} gold` : 'free' });
      }
      const help = c.kind === 'pvp'
        ? 'Both press at the same time. Left: A S D   Right: J K L. Choices stay hidden.'
        : 'Watch the wind-up: blue ward = Guard, red glow = Strike, flickering gold = Feint.';
      addText(this, this.controls, W / 2, 440, help, { size: 14, align: 'center', color: COL.dim, wrap: 700 });
    } else {
      addText(this, this.controls, W / 2, 500, 'Get ready...', { size: 22, bold: true, align: 'center', color: COL.dim });
    }
  }

  private startWindow(): void {
    if (this.phase !== 'prep' || !this.s.combat || this.s.stage !== 'combat') return;
    this.timer?.remove(false);
    const c = this.s.combat;
    this.phase = 'window';
    if (c.kind !== 'pvp') {
      this.intent.b = previewMonsterChoice(this.s) ?? 'guard';
      this.windowMs = getMonster(c.monsterId!).tellMs;
    } else this.windowMs = PVP_WINDOW;
    this.clearControls();
    if (c.kind === 'pvp') {
      if (this.human('a')) this.drawMoveButtons('a', 20, 470, 'ASD');
      if (this.human('b')) this.drawMoveButtons('b', W - 490, 470, 'JKL');
    } else if (this.human('a')) this.drawMoveButtons('a', W / 2 - 300, 600, 'JKL');
    this.drawHud();
    this.timer = this.time.delayedCall(this.windowMs, () => this.impact());
    audio.play('tick');
    if (c.kind !== 'pvp' && Math.random() < 0.35) audio.play('growl');
  }

  update(): void {
    if (this.phase !== 'window' || !this.timer) return;
    const p = this.timer.getProgress();
    if (this.intent.b && this.s.combat?.kind !== 'pvp') this.b.telegraph(this.intent.b, p);
    for (const side of ['a', 'b'] as Side[]) {
      const t = this.botTime[side];
      if (t !== undefined && p >= t && !this.locked[side] && this.intent[side]) this.commit(side, this.intent[side]!, true);
    }
  }

  private onKey(e: KeyboardEvent): void {
    const code = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const named: Record<string, string> = { '1': 'ONE', '2': 'TWO', '3': 'THREE', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN' };
    const key = named[code] ?? code;
    if (this.phase === 'prep' && (e.key === ' ' || e.key === 'Enter')) return this.startWindow();
    if (this.phase === 'over' && (e.key === ' ' || e.key === 'Enter')) return this.finish();
    const choice = KEYS[key];
    if (!choice || this.phase !== 'window') return;
    const c = this.s.combat!;
    let side: Side = 'a';
    if (c.kind === 'pvp') {
      const ha = this.human('a');
      const hb = this.human('b');
      if (ha && hb) {
        if (LEFT_KEYS.has(key)) side = 'a';
        else if (RIGHT_KEYS.has(key)) side = 'b';
        else return;
      } else side = ha ? 'a' : 'b';
    }
    if (!this.human(side)) return;
    this.commit(side, choice);
  }

  private commit(side: Side, choice: Choice, fromBot = false): void {
    if (this.phase !== 'window' || this.locked[side]) return;
    const f = side === 'a' ? combatFighters(this.s).a : combatFighters(this.s).b;
    if (!allowedChoices(f).includes(choice)) {
      if (!fromBot) this.popText(side === 'a' ? this.a : this.b, 'No stamina!', '#7fb8ff');
      return;
    }
    this.locked[side] = choice;
    const c = this.s.combat!;
    // in a duel nothing is shown until the clash; against a monster your stance shows at once
    if (c.kind !== 'pvp' && side === 'a') this.a.telegraph(choice, choice === 'guard' ? 0.8 : 0.5);
    this.drawHud();
    if (c.kind === 'pvp') {
      this.clearControls();
      if (this.human('a')) this.drawMoveButtons('a', 20, 470, 'ASD');
      if (this.human('b')) this.drawMoveButtons('b', W - 490, 470, 'JKL');
      // both locked early: clash right away
      if (this.locked.a && this.locked.b) {
        this.timer?.remove(false);
        this.time.delayedCall(150, () => this.impact());
      }
    } else {
      this.clearControls();
      this.drawMoveButtons('a', W / 2 - 300, 600, 'JKL');
    }
  }

  private impact(): void {
    if (this.phase !== 'window') return;
    this.phase = 'impact';
    this.clearControls();
    const before = this.s;
    const c0 = before.combat!;
    const hesitated: Side[] = [];
    const pick = (side: Side): Choice => {
      const ch = this.locked[side];
      if (ch) return ch;
      hesitated.push(side);
      return 'guard';
    };
    const ca = pick('a');
    const cb = c0.kind === 'pvp' ? pick('b') : this.intent.b!;
    const hpA0 = combatHp(before, 'a').hp;
    const hpB0 = combatHp(before, 'b').hp;
    this.host.dispatch({ type: 'choose', side: 'a', choice: ca });
    if (c0.kind === 'pvp') this.host.dispatch({ type: 'choose', side: 'b', choice: cb });
    const after = this.s;
    const c = after.combat;
    if (!c) return;
    const winner = c.lastWinner ?? 'tie';
    const res = (side: Side): 'win' | 'lose' | 'tie' => (winner === 'tie' ? 'tie' : winner === side ? 'win' : 'lose');
    this.a.resetPose();
    this.b.resetPose();
    this.a.perform(c.lastA ?? ca, res('a'), IMPACT_MS);
    this.b.perform(c.lastB ?? cb, res('b'), IMPACT_MS);
    const dmgA = hpA0 - combatHp(after, 'a').hp;
    const dmgB = hpB0 - combatHp(after, 'b').hp;
    for (const [f, ch] of [[this.a, c.lastA ?? ca], [this.b, c.lastB ?? cb]] as const) {
      if (ch !== 'guard') this.dustFx.explode(8, f.x, GROUND);
    }
    audio.play((c.lastA ?? ca) === 'feint' || (c.lastB ?? cb) === 'feint' ? 'whoosh' : 'swing');
    this.time.delayedCall(IMPACT_MS * 0.35, () => {
      const midX = (this.a.x + this.b.x) / 2;
      if (winner === 'tie' || (c.lastA === 'guard' && winner === 'a') || (c.lastB === 'guard' && winner === 'b')) this.sparkFx.explode(18, midX, GROUND - 90);
      if (dmgA > 0) this.blood(this.a.x, this.a.centerY, winner === 'b' ? 26 : 12);
      if (dmgB > 0) this.blood(this.b.x, this.b.centerY, winner === 'a' ? 26 : 12);
      if (dmgA > 0) { this.a.hitReact(winner === 'b', IMPACT_MS); this.popText(this.a, `-${dmgA}${winner === 'b' ? '  x2' : ''}`, '#ff6b6b'); }
      if (dmgB > 0) { this.b.hitReact(winner === 'a', IMPACT_MS); this.popText(this.b, `-${dmgB}${winner === 'a' ? '  x2' : ''}`, '#ff6b6b'); }
      const heavy = winner !== 'tie' && Math.max(dmgA, dmgB) > 0;
      if (winner === 'tie') audio.play('clash');
      else if ((c.lastA === 'guard' && winner === 'a') || (c.lastB === 'guard' && winner === 'b')) audio.play('block');
      if (dmgA > 0 || dmgB > 0) audio.play(heavy ? 'heavy' : 'hit', Math.min(1.4, Math.max(dmgA, dmgB) / 12));
      const big = Math.max(dmgA, dmgB);
      this.cameras.main.shake(heavy ? 220 : 120, Math.min(0.02, 0.004 + big * 0.0006));
      if (heavy) {
        this.hitStop(110);
        this.cameras.main.zoomTo(1.07, 70, 'Quad.easeOut', true);
        this.time.delayedCall(140, () => this.cameras.main.zoomTo(1, 260, 'Quad.easeOut', true));
        this.cameras.main.flash(90, 90, 10, 10, true);
      } else if (big > 0) this.hitStop(50);
    });
    for (const side of hesitated) this.popText(side === 'a' ? this.a : this.b, 'Hesitated! (Guard)', '#bfc4ee');
    const nameOf = (side: Side) => this.knight(side)?.name ?? c.monster!.name;
    this.banner.setText(winner === 'tie' ? 'CLASH!' : `${nameOf(winner)} wins the exchange`).setFontSize(winner === 'tie' ? 40 : 30).setAlpha(1);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: IMPACT_MS * 1.2, duration: 400 });
    this.time.delayedCall(IMPACT_MS * 1.6, () => {
      this.drawHud();
      if (this.s.combat?.over) this.over();
      else this.prep();
    });
  }

  private over(): void {
    this.phase = 'over';
    const c = this.s.combat!;
    this.drawHud();
    this.clearControls();
    const loser = c.outcome === 'a' ? this.b : this.a;
    // slow-motion finish: the loser falls, a pool spreads, the camera leans in
    this.time.timeScale *= 0.4;
    this.tweens.timeScale *= 0.4;
    window.setTimeout(() => {
      this.time.timeScale /= 0.4;
      this.tweens.timeScale /= 0.4;
    }, 900);
    audio.play('death');
    loser.die(800);
    if (getSettings().blood) {
      const pool = this.add.ellipse(loser.x, GROUND + 4, 10, 4, 0x5a0808, 0.85).setDepth(5);
      this.tweens.add({ targets: pool, scaleX: 12, scaleY: 3, duration: 1600, ease: 'Quad.easeOut' });
    }
    this.cameras.main.pan(W / 2 + (loser.x - W / 2) * 0.5, H / 2 + 20, 600, 'Sine.easeInOut');
    this.cameras.main.zoomTo(1.12, 600, 'Sine.easeInOut');
    const humanWon = (c.outcome === 'a' && this.human('a')) || (c.outcome === 'b' && this.human('b'));
    const humanLost = (c.outcome === 'b' && this.human('a')) || (c.outcome === 'a' && this.human('b'));
    this.time.delayedCall(500, () => audio.play(humanWon || !humanLost ? 'victory' : 'defeat'));
    const winnerName = c.outcome === 'a' ? this.knight('a')!.name : this.knight('b')?.name ?? c.monster!.name;
    this.banner.setText(`${winnerName} is victorious!`).setFontSize(36).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    if (this.human('a') || this.human('b')) {
      addButton(this, this.controls, W / 2 - 140, 480, 280, 70, 'Continue', () => this.finish(), { size: 24, fill: COL.primary, sub: 'Space / Enter' });
    } else this.time.delayedCall(1500, () => this.finish());
  }

  private finish(): void {
    if (this.phase !== 'over') return;
    this.phase = 'prep';
    this.host.dispatch({ type: 'continue' });
  }

  /** Freeze the action for a beat so hits land with weight. Uses real time, not scene time. */
  private hitStop(ms: number): void {
    const t0 = this.time.timeScale;
    const w0 = this.tweens.timeScale;
    this.time.timeScale = t0 * 0.03;
    this.tweens.timeScale = w0 * 0.03;
    window.setTimeout(() => {
      this.time.timeScale = t0;
      this.tweens.timeScale = w0;
    }, ms);
  }

  private popText(f: Fighter, text: string, color: string): void {
    const t = this.add.text(f.x, f.centerY - 60, text, { fontFamily: 'system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 5, resolution: 2 }).setOrigin(0.5);
    this.fx.add(t);
    this.tweens.add({ targets: t, y: t.y - 50, alpha: 0, duration: 1100, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }
}
