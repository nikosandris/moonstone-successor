import Phaser from 'phaser';
import type { Choice, MonsterShape } from '../../core/types';

export type Look =
  | { kind: 'knight'; color: number; scars: string[] }
  | { kind: 'monster'; shape: MonsterShape; color: number };

const STEEL = 0xb8bcc8;
const DARK = 0x1a1c26;
const deg = Phaser.Math.DegToRad;

interface Rig {
  shoulder: [number, number];
  armLen: number;
  height: number;
  /** arm angle at rest / raised / swung (degrees, 0 = pointing forward) */
  rest: number;
  raised: number;
  swung: number;
}

const RIGS: Record<string, Rig> = {
  knight: { shoulder: [6, -96], armLen: 70, height: 150, rest: 60, raised: -110, swung: 20 },
  beast: { shoulder: [40, -52], armLen: 34, height: 80, rest: 10, raised: -40, swung: 25 },
  brute: { shoulder: [8, -120], armLen: 90, height: 175, rest: 70, raised: -120, swung: 25 },
  armored: { shoulder: [6, -100], armLen: 78, height: 155, rest: 60, raised: -115, swung: 20 },
  drake: { shoulder: [46, -110], armLen: 46, height: 150, rest: 30, raised: -55, swung: 35 },
  wraith: { shoulder: [10, -120], armLen: 96, height: 180, rest: 50, raised: -125, swung: 15 },
  spider: { shoulder: [36, -48], armLen: 44, height: 80, rest: 20, raised: -70, swung: 30 },
  serpent: { shoulder: [30, -100], armLen: 40, height: 140, rest: 20, raised: -50, swung: 30 },
  golem: { shoulder: [10, -130], armLen: 84, height: 185, rest: 75, raised: -110, swung: 30 },
};

/** A side-view fighter built from procedural shapes, animated by tweening a few parts. */
export class Fighter extends Phaser.GameObjects.Container {
  readonly rig: Rig;
  private bodyG: Phaser.GameObjects.Graphics;
  private arm: Phaser.GameObjects.Container;
  private armG: Phaser.GameObjects.Graphics;
  private tipGlow: Phaser.GameObjects.Arc;
  private ward: Phaser.GameObjects.Graphics;
  private shadow: Phaser.GameObjects.Ellipse;
  private baseX: number;
  private baseY: number;
  private idleTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, facing: 1 | -1, readonly look: Look) {
    super(scene, x, y);
    this.baseX = x;
    this.baseY = y;
    this.rig = RIGS[look.kind === 'knight' ? 'knight' : look.shape];
    this.shadow = scene.add.ellipse(0, 2, this.rig.height * 0.7, 16, 0x000000, 0.45);
    this.bodyG = scene.add.graphics();
    this.arm = scene.add.container(this.rig.shoulder[0], this.rig.shoulder[1]);
    this.armG = scene.add.graphics();
    this.tipGlow = scene.add.circle(this.rig.armLen, 0, 14, 0xffffff, 0).setBlendMode(Phaser.BlendModes.ADD);
    this.arm.add([this.armG, this.tipGlow]);
    this.ward = scene.add.graphics();
    this.add([this.shadow, this.bodyG, this.arm, this.ward]);
    this.setScale(facing, 1);
    this.drawBody();
    this.drawArm();
    this.drawWard();
    this.ward.setAlpha(0);
    this.arm.setRotation(deg(this.rig.rest));
    scene.add.existing(this);
  }

  // ---------------------------------------------------------------- drawing

  private drawBody(): void {
    const g = this.bodyG;
    g.clear();
    const L = this.look;
    if (L.kind === 'knight') {
      // legs
      g.fillStyle(0x2a2d3a, 1);
      g.fillRect(-16, -44, 12, 44);
      g.fillRect(4, -44, 12, 44);
      g.fillStyle(DARK, 1);
      g.fillRect(-18, -6, 16, 6);
      g.fillRect(2, -6, 16, 6);
      // torso armour + tabard in player colour
      g.fillStyle(0x50566a, 1);
      g.fillRoundedRect(-22, -108, 44, 66, 8);
      g.fillStyle(L.color, 1);
      g.fillRoundedRect(-16, -100, 32, 62, 4);
      g.fillStyle(0x000000, 0.25);
      g.fillRect(-2, -100, 4, 62);
      // belt
      g.fillStyle(0x3b2a1a, 1);
      g.fillRect(-20, -50, 40, 6);
      // head + helmet
      g.fillStyle(STEEL, 1);
      g.fillRoundedRect(-14, -140, 28, 32, 9);
      g.fillStyle(DARK, 1);
      g.fillRect(-2, -128, 16, 4);
      // plume
      g.fillStyle(L.color, 1);
      g.fillTriangle(-12, -138, -30, -150, -6, -150);
      // shield on the near arm
      g.fillStyle(0x3a3f55, 1);
      g.fillRoundedRect(-30, -98, 18, 46, 6);
      g.fillStyle(L.color, 1);
      g.fillCircle(-21, -76, 5);
      // scars drawn on the knight
      this.drawScars(g, L.scars);
      return;
    }
    const c = L.color;
    const lighter = Phaser.Display.Color.ValueToColor(c).lighten(18).color;
    switch (L.shape) {
      case 'beast':
        g.fillStyle(c, 1);
        g.fillEllipse(-4, -40, 92, 40);
        g.fillStyle(lighter, 1);
        g.fillEllipse(-10, -48, 60, 16);
        g.fillStyle(c, 1);
        for (const lx of [-34, -18, 14, 28]) g.fillRect(lx, -26, 9, 26);
        g.fillTriangle(-46, -48, -76, -66, -52, -36); // tail
        break;
      case 'brute':
        g.fillStyle(c, 1);
        g.fillRect(-26, -60, 18, 60);
        g.fillRect(8, -60, 18, 60);
        g.fillEllipse(0, -100, 92, 100);
        g.fillStyle(lighter, 1);
        g.fillEllipse(6, -96, 50, 56);
        g.fillStyle(c, 1);
        g.fillCircle(20, -152, 22);
        g.fillStyle(0xffe08a, 1);
        g.fillCircle(30, -156, 4);
        g.fillStyle(0xf0f0e0, 1);
        g.fillTriangle(30, -140, 34, -150, 38, -140);
        break;
      case 'armored':
        g.fillStyle(0x3a2a22, 1);
        g.fillRect(-16, -46, 12, 46);
        g.fillRect(4, -46, 12, 46);
        g.fillStyle(c, 1);
        g.fillRoundedRect(-26, -112, 52, 70, 6);
        g.fillStyle(0x5a3a26, 1);
        for (let i = 0; i < 4; i++) g.fillRect(-26, -104 + i * 16, 52, 3);
        g.fillStyle(c, 1);
        g.fillRoundedRect(-16, -148, 32, 38, 4);
        g.fillStyle(0xff5a2a, 1);
        g.fillRect(0, -134, 14, 3);
        g.fillStyle(lighter, 1);
        g.fillTriangle(-16, -148, 0, -164, 16, -148);
        break;
      case 'drake':
        g.fillStyle(c, 1);
        g.fillEllipse(-10, -60, 110, 60);
        g.fillRect(-40, -40, 14, 40);
        g.fillRect(16, -40, 14, 40);
        g.fillTriangle(-60, -66, -110, -40, -58, -50); // tail
        g.fillStyle(lighter, 1);
        g.fillTriangle(-20, -86, -60, -150, 10, -96); // wing
        g.fillTriangle(-10, -86, 10, -160, 30, -92);
        g.fillStyle(c, 1);
        g.fillRect(28, -116, 22, 50); // neck
        break;
      case 'wraith':
        g.fillStyle(c, 0.95);
        g.fillTriangle(-40, 0, 40, 0, 0, -150);
        g.fillEllipse(0, -120, 60, 80);
        g.fillStyle(0x0b0d17, 1);
        g.fillEllipse(6, -150, 34, 40);
        g.fillStyle(0x9fe8ff, 1);
        g.fillCircle(2, -152, 4);
        g.fillCircle(14, -152, 4);
        break;
      case 'spider':
        g.fillStyle(c, 1);
        g.fillEllipse(-20, -40, 60, 44);
        g.fillCircle(18, -38, 18);
        g.lineStyle(5, c, 1);
        for (let i = 0; i < 4; i++) {
          g.lineBetween(-10 + i * 10, -36, -44 + i * 22, -64);
          g.lineBetween(-44 + i * 22, -64, -56 + i * 26, 0);
        }
        g.fillStyle(0xff3030, 1);
        g.fillCircle(26, -42, 3);
        g.fillCircle(22, -32, 3);
        break;
      case 'serpent':
        g.lineStyle(26, c, 1);
        g.beginPath();
        g.arc(-20, -30, 36, deg(200), deg(20), false);
        g.strokePath();
        g.fillStyle(c, 1);
        g.fillRect(16, -110, 26, 84);
        g.fillStyle(lighter, 1);
        g.fillRect(22, -104, 10, 76);
        break;
      case 'golem':
        g.fillStyle(c, 1);
        g.fillRect(-30, -60, 24, 60);
        g.fillRect(6, -60, 24, 60);
        g.fillRect(-40, -140, 80, 84);
        g.fillStyle(lighter, 1);
        g.fillRect(-30, -130, 26, 30);
        g.fillRect(4, -100, 28, 34);
        g.fillStyle(c, 1);
        g.fillRect(-16, -176, 34, 36);
        g.fillStyle(0x7dffb0, 1);
        g.fillRect(-2, -164, 14, 5);
        break;
    }
  }

  private drawScars(g: Phaser.GameObjects.Graphics, scars: string[]): void {
    g.lineStyle(2, 0xff4a4a, 1);
    if (scars.includes('lostEye')) {
      g.fillStyle(0x000000, 1);
      g.fillCircle(8, -126, 4);
      g.lineBetween(-14, -134, 14, -120);
    }
    const others = scars.filter((s) => s !== 'lostEye');
    others.forEach((_, i) => {
      const y = -96 + i * 9;
      g.lineBetween(-12 + (i % 2) * 6, y, 6 + (i % 2) * 6, y + 6);
    });
  }

  private drawArm(): void {
    const g = this.armG;
    g.clear();
    const L = this.look;
    const len = this.rig.armLen;
    if (L.kind === 'knight' || (L.kind === 'monster' && L.shape === 'armored')) {
      g.fillStyle(L.kind === 'knight' ? 0x50566a : L.color, 1);
      g.fillRoundedRect(-6, -6, 34, 12, 5);
      g.fillStyle(0x6b4a2a, 1);
      g.fillRect(28, -4, 10, 8); // grip
      g.fillStyle(0xd4b06a, 1);
      g.fillRect(36, -12, 5, 24); // crossguard
      g.fillStyle(L.kind === 'knight' ? STEEL : 0x9a6a4a, 1);
      if (L.kind === 'monster') {
        g.fillRect(40, -3, len - 30, 6);
        g.fillTriangle(len, -18, len + 14, 0, len, 18); // axe head
      } else {
        g.fillTriangle(40, -5, len + 18, 0, 40, 5);
        g.fillRect(40, -5, len - 30, 10);
      }
      return;
    }
    const c = L.color;
    switch (L.shape) {
      case 'beast':
      case 'drake':
      case 'serpent':
        // the head is the weapon
        g.fillStyle(c, 1);
        g.fillEllipse(len * 0.5, 0, len + 12, 26);
        g.fillTriangle(len - 4, -10, len + 22, 2, len - 4, 12);
        g.fillStyle(0xf4f1d0, 1);
        g.fillTriangle(len, 6, len + 4, 14, len + 8, 6);
        g.fillTriangle(len + 8, 6, len + 12, 13, len + 16, 5);
        g.fillStyle(0xffd060, 1);
        g.fillCircle(len * 0.55, -6, 3);
        if (L.shape === 'beast') {
          g.fillStyle(c, 1);
          g.fillTriangle(len * 0.2, -12, len * 0.3, -28, len * 0.42, -12);
        }
        break;
      case 'brute':
      case 'golem':
        g.fillStyle(c, 1);
        g.fillRoundedRect(-8, -10, len * 0.6, 20, 8);
        g.fillStyle(L.shape === 'brute' ? 0x5a3a22 : 0x6a6f78, 1);
        g.fillRoundedRect(len * 0.5, -9, len * 0.6, 18, 6);
        g.fillCircle(len + 4, 0, 16);
        break;
      case 'wraith':
        g.fillStyle(c, 1);
        g.fillRect(-4, -4, 30, 8);
        g.fillStyle(0x4a3a2a, 1);
        g.fillRect(20, -3, len, 6);
        g.fillStyle(0xd8e4ff, 1);
        g.fillTriangle(len + 10, -4, len + 20, -40, len - 30, -36);
        break;
      case 'spider':
        g.lineStyle(6, c, 1);
        g.lineBetween(0, 0, len, 0);
        g.fillStyle(0xe8e0c0, 1);
        g.fillTriangle(len, -6, len + 18, 0, len, 6);
        break;
    }
  }

  private drawWard(): void {
    const g = this.ward;
    g.clear();
    const h = this.rig.height;
    g.lineStyle(6, 0x6ec8ff, 0.9);
    g.beginPath();
    g.arc(10, -h * 0.5, h * 0.55, deg(-55), deg(55), false);
    g.strokePath();
    g.lineStyle(14, 0x6ec8ff, 0.25);
    g.beginPath();
    g.arc(10, -h * 0.5, h * 0.55, deg(-55), deg(55), false);
    g.strokePath();
  }

  // ---------------------------------------------------------------- poses

  idle(): void {
    this.idleTween?.stop();
    this.idleTween = this.scene.tweens.add({
      targets: this.bodyG, y: { from: 0, to: -3 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  resetPose(): void {
    this.scene.tweens.killTweensOf([this, this.arm, this.ward, this.tipGlow]);
    this.x = this.baseX;
    this.y = this.baseY;
    this.angle = 0;
    this.arm.setRotation(deg(this.rig.rest));
    this.ward.setAlpha(0);
    this.tipGlow.setAlpha(0);
    this.clearTint();
  }

  /** Telegraph pose for a move, p = 0..1 through the reaction window. Strike and Feint share the
   *  first half; they only diverge late, so reading the difference takes attention. */
  telegraph(choice: Choice, p: number): void {
    const r = this.rig;
    if (choice === 'guard') {
      const q = Phaser.Math.Clamp((p - 0.15) / 0.5, 0, 1);
      this.y = this.baseY + 8 * q;
      this.ward.setAlpha(q * 0.9);
      this.arm.setRotation(deg(Phaser.Math.Linear(r.rest, r.rest - 30, q)));
      this.tipGlow.setAlpha(0);
      return;
    }
    const a = Phaser.Math.Clamp(p / 0.55, 0, 1);
    let angle = Phaser.Math.Linear(r.rest, r.raised, a);
    this.tipGlow.setAlpha(0);
    if (p > 0.55) {
      const b = (p - 0.55) / 0.45;
      if (choice === 'strike') {
        angle = r.raised - 25 * b;
        this.x = this.baseX - 10 * b * this.scaleX;
        this.tipGlow.setFillStyle(0xff3b2e, 1).setAlpha(0.35 + 0.55 * b);
      } else {
        angle = r.raised + 35 * b + Math.sin(p * 60) * 8;
        this.x = this.baseX + 8 * b * this.scaleX;
        this.tipGlow.setFillStyle(0xffd23a, 1).setAlpha(0.3 + 0.5 * b * (0.5 + 0.5 * Math.sin(p * 80)));
      }
    }
    this.arm.setRotation(deg(angle));
  }

  /** Play the committed move at impact. `result` decides whether it lands. */
  perform(choice: Choice, result: 'win' | 'lose' | 'tie', ms: number): void {
    const r = this.rig;
    const dir = this.scaleX;
    this.scene.tweens.killTweensOf([this, this.arm]);
    if (choice === 'guard') {
      this.ward.setAlpha(1);
      this.scene.tweens.add({ targets: this, y: this.baseY + 8, duration: ms * 0.3 });
      this.scene.tweens.add({ targets: this.arm, rotation: deg(r.rest - 30), duration: ms * 0.3 });
      if (result === 'win') this.scene.tweens.add({ targets: this, x: this.baseX + 60 * dir, duration: ms * 0.35, delay: ms * 0.3, yoyo: true });
      return;
    }
    this.ward.setAlpha(0);
    const lunge = choice === 'strike' ? 110 : 70;
    this.scene.tweens.add({ targets: this.arm, rotation: deg(r.raised), duration: ms * 0.15 });
    this.scene.tweens.add({ targets: this.arm, rotation: deg(r.swung), duration: ms * 0.2, delay: ms * 0.15, ease: 'Cubic.easeIn' });
    this.scene.tweens.add({
      targets: this, x: this.baseX + lunge * dir, duration: ms * 0.3, ease: 'Cubic.easeOut', yoyo: true, hold: ms * 0.15,
    });
    if (choice === 'feint') this.scene.tweens.add({ targets: this, angle: 8 * dir, duration: ms * 0.15, yoyo: true });
  }

  hitReact(heavy: boolean, ms: number): void {
    const dir = this.scaleX;
    this.setTint();
    this.flash();
    this.scene.tweens.add({
      targets: this, x: this.baseX - (heavy ? 50 : 24) * dir, duration: ms * 0.25, delay: ms * 0.3, yoyo: true, ease: 'Quad.easeOut',
    });
  }

  private flash(): void {
    const parts = [this.bodyG, this.armG];
    this.scene.tweens.add({ targets: parts, alpha: 0.25, duration: 60, yoyo: true, repeat: 2, delay: 160 });
  }

  // Graphics have no tint; keep the API so callers stay simple
  setTint(): this {
    return this;
  }
  clearTint(): this {
    this.bodyG.setAlpha(1);
    this.armG.setAlpha(1);
    return this;
  }

  die(ms: number): void {
    this.idleTween?.stop();
    this.scene.tweens.add({ targets: this, angle: -80 * this.scaleX, y: this.baseY + 10, alpha: 0.5, duration: ms, ease: 'Quad.easeIn' });
  }

  get centerY(): number {
    return this.y - this.rig.height * 0.55;
  }
}
