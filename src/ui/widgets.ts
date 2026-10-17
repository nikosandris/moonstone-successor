import Phaser from 'phaser';
import { COL, FONT, SERIF } from './theme';

export interface TextOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  wrap?: number;
  origin?: [number, number];
  serif?: boolean;
}

export function addText(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  str: string,
  o: TextOpts = {},
): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, str, {
    fontFamily: o.serif ? SERIF : FONT,
    fontSize: `${o.size ?? 16}px`,
    fontStyle: o.bold ? 'bold' : 'normal',
    color: o.color ?? COL.text,
    align: o.align ?? 'left',
    wordWrap: o.wrap ? { width: o.wrap } : undefined,
    resolution: 2,
  });
  const org = o.origin ?? (o.align === 'center' ? [0.5, 0] : o.align === 'right' ? [1, 0] : [0, 0]);
  t.setOrigin(org[0], org[1]);
  parent.add(t);
  return t;
}

export interface ButtonOpts {
  size?: number;
  fill?: number;
  enabled?: boolean;
  sub?: string;
  textColor?: string;
}

export function addButton(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  o: ButtonOpts = {},
): Phaser.GameObjects.Rectangle {
  const enabled = o.enabled !== false;
  const fill = enabled ? o.fill ?? COL.btn : COL.btnOff;
  const r = scene.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setStrokeStyle(2, enabled ? 0xc9a96a : 0x3a3446);
  parent.add(r);
  const size = o.size ?? 18;
  const subSize = Math.max(12, size - 6);
  const subLines = o.sub ? o.sub.split('\n').length : 0;
  const total = size * 1.2 + (subLines ? 4 + subLines * subSize * 1.25 : 0);
  const top = y + Math.max(2, (h - total) / 2);
  addText(scene, parent, x + w / 2, top, label, {
    size, bold: true, align: 'center', color: enabled ? o.textColor ?? '#ffffff' : '#7a7f99', wrap: w - 8,
  });
  if (o.sub) {
    addText(scene, parent, x + w / 2, top + size * 1.2 + 4, o.sub, {
      size: subSize, align: 'center', color: enabled ? '#cfd3ff' : '#666b8c', wrap: w - 8,
    });
  }
  if (enabled) {
    r.setInteractive({ useHandCursor: true });
    r.on('pointerover', () => r.setFillStyle(COL.btnHot));
    r.on('pointerout', () => r.setFillStyle(fill));
    r.on('pointerup', onClick);
  }
  return r;
}

export function addPanel(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number = COL.panel,
  alpha = 1,
): Phaser.GameObjects.Rectangle {
  const r = scene.add.rectangle(x, y, w, h, fill, alpha).setOrigin(0, 0).setStrokeStyle(2, COL.panelEdge);
  parent.add(r);
  if (w > 60 && h > 40) {
    const inner = scene.add.rectangle(x + 4, y + 4, w - 8, h - 8).setOrigin(0, 0).setStrokeStyle(1, 0x2e2638, alpha);
    parent.add(inner);
  }
  return r;
}

export function addBar(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: number,
  label?: string,
): void {
  const back = scene.add.rectangle(x, y, w, h, 0x0b0d17).setOrigin(0, 0).setStrokeStyle(1, 0x4a5290);
  const fill = scene.add.rectangle(x, y, Math.max(0, Math.min(1, frac)) * w, h, color).setOrigin(0, 0);
  parent.add([back, fill]);
  if (label) addText(scene, parent, x + w / 2, y + h / 2 - 8, label, { size: 13, bold: true, align: 'center' });
}
