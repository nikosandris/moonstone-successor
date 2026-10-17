import Phaser from 'phaser';
import { botAction } from '../../core/bot';
import { allowedChoices } from '../../core/combat';
import { canFlee, combatFighters, combatHp, fleeCost, previewMonsterChoice } from '../../core/game';
import { moonEffect } from '../../core/moon';
import type { Action, Choice, GameState, Knight } from '../../core/types';
import { getItem } from '../../data/items';
import { getMonster } from '../../data/monsters';
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
    this.hud = this.add.container(0, 0);
    this.fx = this.add.container(0, 0).setDepth(50);
    this.controls = this.add.container(0, 0).setDepth(60);
    this.banner = this.add.text(W / 2, 150, '', { fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 6, resolution: 2 }).setOrigin(0.5).setDepth(70);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.drawHud();
    this.prep();
  }

  // ---------------------------------------------------------------- scenery

  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.fillGradientStyle(0x0d1030, 0x0d1030, 0x2a1f3a, 0x2a1f3a, 1);
    g.fillRect(0, 0, W, GROUND);
    // moon
    g.fillStyle(0xf4f1d0, 0.08);
    g.fillCircle(W / 2, 230, 80);
    g.fillStyle(0xf4f1d0, 0.55);
    g.fillCircle(W / 2, 230, 40);
    // distant hills
    g.fillStyle(0x161a33, 1);
    g.beginPath();
    g.moveTo(0, GROUND - 60);
    for (let x = 0; x <= W; x += 64) g.lineTo(x, GROUND - 60 - Math.sin(x * 0.011) * 30 - Math.cos(x * 0.023) * 16);
    g.lineTo(W, GROUND);
    g.lineTo(0, GROUND);
    g.closePath();
    g.fillPath();
    // ground
    g.fillGradientStyle(0x221c26, 0x221c26, 0x0b0d17, 0x0b0d17, 1);
    g.fillRect(0, GROUND, W, H - GROUND);
    g.lineStyle(2, 0x3a3048, 1);
    g.lineBetween(0, GROUND, W, GROUND);
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
      addButton(this, this.controls, W / 2 - 130, 470, 260, 80, 'FIGHT!', () => this.startWindow(), { size: 30, fill: 0x5b3fd0, sub: 'Space / Enter' });
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
    this.time.delayedCall(IMPACT_MS * 0.35, () => {
      if (dmgA > 0) { this.a.hitReact(winner === 'b', IMPACT_MS); this.popText(this.a, `-${dmgA}${winner === 'b' ? '  x2' : ''}`, '#ff6b6b'); }
      if (dmgB > 0) { this.b.hitReact(winner === 'a', IMPACT_MS); this.popText(this.b, `-${dmgB}${winner === 'a' ? '  x2' : ''}`, '#ff6b6b'); }
      if (winner !== 'tie') this.cameras.main.shake(120, winner === 'a' ? 0.006 : 0.009);
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
    loser.die(800);
    const winnerName = c.outcome === 'a' ? this.knight('a')!.name : this.knight('b')?.name ?? c.monster!.name;
    this.banner.setText(`${winnerName} is victorious!`).setFontSize(36).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    if (this.human('a') || this.human('b')) {
      addButton(this, this.controls, W / 2 - 140, 480, 280, 70, 'Continue', () => this.finish(), { size: 24, fill: 0x5b3fd0, sub: 'Space / Enter' });
    } else this.time.delayedCall(1500, () => this.finish());
  }

  private finish(): void {
    if (this.phase !== 'over') return;
    this.phase = 'prep';
    this.host.dispatch({ type: 'continue' });
  }

  private popText(f: Fighter, text: string, color: string): void {
    const t = this.add.text(f.x, f.centerY - 60, text, { fontFamily: 'system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 5, resolution: 2 }).setOrigin(0.5);
    this.fx.add(t);
    this.tweens.add({ targets: t, y: t.y - 50, alpha: 0, duration: 1100, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }
}
