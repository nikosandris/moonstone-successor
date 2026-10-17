// Procedural textures generated once at boot. No image files: canvas drawing + seeded noise only.
import Phaser from 'phaser';
import type { MoonPhase } from '../../core/types';
import { BOARD } from '../../data/board';

// ------------------------------------------------------------------ noise

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise; with `wrap` set the result tiles seamlessly every `wrap` cells. */
function noise(x: number, y: number, seed: number, wrap = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const w = (v: number) => (wrap ? ((v % wrap) + wrap) % wrap : v);
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function fbm(x: number, y: number, seed: number, octaves = 4, wrap = 0): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise(x * f, y * f, seed + i * 17, wrap ? wrap * f : 0);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

// ------------------------------------------------------------------ map terrain

/** Terrain for the board, drawn in board space (1000 x 600) at `scale` px per unit. */
function drawTerrain(scale: number): HTMLCanvasElement {
  const W = Math.round(1000 * scale);
  const H = Math.round(600 * scale);
  const [canvas, ctx] = makeCanvas(W, H);
  // low-res noise field, upscaled smoothly
  const gw = 250;
  const gh = 150;
  const [small, sctx] = makeCanvas(gw, gh);
  const img = sctx.createImageData(gw, gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const n = fbm(x / 28, y / 28, 7);
      const m = fbm(x / 9, y / 9, 31, 2);
      const i = (y * gw + x) * 4;
      // moor palette: marsh teal (low) -> heath -> grey-green hills (high)
      const t = Math.min(1, Math.max(0, (n - 0.25) * 1.8));
      img.data[i] = 18 + t * 26 + m * 10;
      img.data[i + 1] = 30 + t * 30 + m * 12;
      img.data[i + 2] = 40 + t * 14 + m * 8;
      img.data[i + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, W, H);

  const nodes = BOARD.nodes;
  const nearPath = (x: number, y: number, pad: number) => {
    for (const n of nodes) if ((n.x - x) ** 2 + (n.y - y) ** 2 < (pad + 22) ** 2) return true;
    for (const [a, b] of BOARD.edges) {
      const A = nodes[a];
      const B = nodes[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / (dx * dx + dy * dy)));
      if ((A.x + t * dx - x) ** 2 + (A.y + t * dy - y) ** 2 < pad * pad) return true;
    }
    return false;
  };

  // ponds
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 1, 99) * 1000;
    const y = hash(i, 2, 99) * 600;
    if (fbm(x / 112, y / 112, 7) > 0.36 || nearPath(x, y, 24)) continue;
    const r = 10 + hash(i, 3, 99) * 18;
    ctx.fillStyle = 'rgba(20,40,70,0.75)';
    ctx.beginPath();
    ctx.ellipse(x * scale, y * scale, r * scale * 1.6, r * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,180,220,0.18)';
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
  }

  // forests: pine clusters where noise is high, keeping roads and clearings free
  for (let i = 0; i < 2600; i++) {
    const x = hash(i, 11, 5) * 1000;
    const y = hash(i, 12, 5) * 600;
    if (fbm(x / 90, y / 90, 13) < 0.5 || nearPath(x, y, 16)) continue;
    const h = (9 + hash(i, 13, 5) * 9) * scale;
    const px = x * scale;
    const py = y * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(px + 2 * scale, py + 1, h * 0.35, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgb(${10 + hash(i, 14, 5) * 10},${28 + hash(i, 15, 5) * 18},${26 + hash(i, 16, 5) * 10})`;
    ctx.beginPath();
    ctx.moveTo(px, py - h);
    ctx.lineTo(px + h * 0.38, py);
    ctx.lineTo(px - h * 0.38, py);
    ctx.closePath();
    ctx.fill();
    // moonlit edge
    ctx.strokeStyle = 'rgba(150,175,210,0.22)';
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(px, py - h);
    ctx.lineTo(px + h * 0.38, py);
    ctx.stroke();
  }

  // rocks
  for (let i = 0; i < 160; i++) {
    const x = hash(i, 21, 8) * 1000;
    const y = hash(i, 22, 8) * 600;
    if (nearPath(x, y, 12)) continue;
    const r = (2 + hash(i, 23, 8) * 4) * scale;
    ctx.fillStyle = 'rgba(90,96,110,0.7)';
    ctx.beginPath();
    ctx.ellipse(x * scale, y * scale, r * 1.3, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // worn dirt roads along the edges
  ctx.lineCap = 'round';
  for (const [a, b] of BOARD.edges) {
    const A = nodes[a];
    const B = nodes[b];
    ctx.strokeStyle = 'rgba(30,22,16,0.9)';
    ctx.lineWidth = 11 * scale;
    ctx.beginPath();
    ctx.moveTo(A.x * scale, A.y * scale);
    ctx.lineTo(B.x * scale, B.y * scale);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(122,98,70,0.85)';
    ctx.lineWidth = 6 * scale;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170,145,110,0.35)';
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([5 * scale, 7 * scale]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // vignette
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,10,0.65)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return canvas;
}

function drawFog(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm((x / S) * 4, (y / S) * 4, 77, 4, 4);
      const a = Math.max(0, n - 0.42) * 2.4;
      const i = (y * S + x) * 4;
      img.data[i] = 190;
      img.data[i + 1] = 200;
      img.data[i + 2] = 230;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function drawGlow(size: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// ------------------------------------------------------------------ moon

/** Moon disc with craters and a soft terminator for the phase. */
function drawMoon(phase: MoonPhase, size: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const r = size / 2 - 2;
  const cx = size / 2;
  const img = ctx.createImageData(size, size);
  // lit fraction direction: waxing lit on the right, waning on the left
  const k = phase === 'full' ? -1.2 : phase === 'new' ? 1.15 : 0; // terminator ellipse factor
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / r;
      const dy = (y - cx) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const i = (y * size + x) * 4;
      const crater = fbm(dx * 3 + 5, dy * 3 + 5, 3, 4);
      const base = 200 + (crater - 0.5) * 90 - Math.max(0, crater - 0.62) * 260;
      // terminator: x position of the shadow edge on this row
      const rowHalf = Math.sqrt(1 - dy * dy);
      let lit: number;
      if (phase === 'waxing') lit = smoothEdge(dx, 0, rowHalf);
      else if (phase === 'waning') lit = smoothEdge(-dx, 0, rowHalf);
      else lit = phase === 'full' ? 1 : smoothEdge(dx, rowHalf * k, rowHalf) * 0.12;
      const shade = 0.12 + 0.88 * lit;
      const limb = 1 - Math.pow(d2, 3) * 0.35;
      img.data[i] = base * shade * limb;
      img.data[i + 1] = base * shade * limb * 0.98;
      img.data[i + 2] = base * shade * limb * 0.86 + 12 * (1 - lit);
      img.data[i + 3] = 255 * Math.min(1, (1 - d2) * 40);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function smoothEdge(v: number, edge: number, half: number): number {
  const w = 0.08 * half + 0.02;
  return Math.max(0, Math.min(1, (v - edge) / w + 0.5));
}

// ------------------------------------------------------------------ node icons

type IconDraw = (g: Phaser.GameObjects.Graphics) => void;

const ICONS: Record<string, [number, number, IconDraw]> = {
  // [width, height, draw] in texture pixels (drawn at 2x, displayed at 0.5)
  home: [72, 80, (g) => {
    g.fillStyle(0x3a3f52, 1);
    g.fillRect(14, 30, 44, 46);
    g.fillStyle(0x4c5268, 1);
    for (let i = 0; i < 4; i++) g.fillRect(14 + i * 12, 22, 8, 10);
    g.fillStyle(0x23263a, 1);
    g.fillRoundedRect(29, 52, 14, 24, { tl: 7, tr: 7, bl: 0, br: 0 });
    g.fillStyle(0xffc46b, 1);
    g.fillRect(22, 38, 6, 8);
    g.fillRect(44, 38, 6, 8);
    g.lineStyle(3, 0x15172a, 1);
    g.strokeRect(14, 30, 44, 46);
  }],
  village: [84, 70, (g) => {
    const house = (x: number, y: number, w: number, h: number, roof: number) => {
      g.fillStyle(0x6b5a48, 1);
      g.fillRect(x, y, w, h);
      g.fillStyle(roof, 1);
      g.fillTriangle(x - 4, y, x + w / 2, y - h * 0.7, x + w + 4, y);
      g.fillStyle(0xffb84a, 1);
      g.fillRect(x + w * 0.35, y + h * 0.3, w * 0.3, h * 0.3);
    };
    house(8, 36, 26, 26, 0x7a3a2a);
    house(46, 40, 28, 24, 0x5a3a2a);
    house(28, 22, 24, 22, 0x8a4a2a);
  }],
  lair: [80, 68, (g) => {
    g.fillStyle(0x3a3036, 1);
    g.fillEllipse(40, 44, 76, 48);
    g.fillStyle(0x4a3e44, 1);
    g.fillEllipse(30, 34, 40, 26);
    g.fillStyle(0x08060a, 1);
    g.fillEllipse(40, 52, 40, 30);
    g.fillStyle(0xff3030, 1);
    g.fillCircle(33, 50, 3);
    g.fillCircle(47, 50, 3);
    g.fillStyle(0xd8d0c0, 1);
    for (let i = 0; i < 5; i++) g.fillTriangle(24 + i * 8, 38, 28 + i * 8, 46, 32 + i * 8, 38);
  }],
  ruins: [76, 66, (g) => {
    g.fillStyle(0x6a6878, 1);
    g.fillRect(10, 20, 12, 42);
    g.fillRect(32, 34, 12, 28);
    g.fillRect(54, 12, 12, 50);
    g.fillStyle(0x8a8898, 1);
    g.fillRect(6, 16, 20, 6);
    g.fillRect(50, 8, 20, 6);
    g.fillStyle(0x54525e, 1);
    g.fillRect(4, 58, 68, 6);
    g.fillStyle(0x3a6a3a, 0.8);
    g.fillCircle(38, 30, 6);
  }],
  sanctum: [120, 96, (g) => {
    g.fillStyle(0x1a1c2a, 0.8);
    g.fillEllipse(60, 66, 112, 44);
    const stones: [number, number, number][] = [[14, 52, 30], [32, 40, 36], [60, 34, 40], [88, 40, 36], [106, 52, 30], [30, 70, 26], [90, 70, 26]];
    for (const [x, y, h] of stones) {
      g.fillStyle(0x7a7a88, 1);
      g.fillRect(x - 6, y - h, 12, h);
      g.fillStyle(0x9a9aa8, 1);
      g.fillRect(x - 6, y - h, 4, h);
    }
    g.fillStyle(0x7a7a88, 1);
    g.fillRect(44, 0, 32, 8); // lintel
    g.fillStyle(0x50506a, 1);
    g.fillRect(52, 50, 16, 12); // altar
  }],
  road: [28, 28, (g) => {
    g.fillStyle(0x5a5a66, 1);
    g.fillRoundedRect(8, 4, 12, 20, 5);
    g.fillStyle(0x7a7a86, 1);
    g.fillRoundedRect(8, 4, 5, 20, 3);
  }],
};

/** Silhouette for a knight token on the map (white, tinted per player). */
function drawToken(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x000000, 0.4);
  g.fillEllipse(20, 50, 28, 8);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(10, 18, 20, 28, 5); // body
  g.fillCircle(20, 13, 8); // helm
  g.fillTriangle(30, 20, 36, 4, 33, 22); // lance
  g.fillRect(31, 2, 3, 40);
}

export function generateTextures(scene: Phaser.Scene): void {
  const tex = scene.textures;
  if (tex.exists('terrain')) return;
  tex.addCanvas('terrain', drawTerrain(1.34));
  tex.addCanvas('fog', drawFog());
  tex.addCanvas('glow', drawGlow(128));
  for (const p of ['new', 'waxing', 'full', 'waning'] as MoonPhase[]) tex.addCanvas(`moon-${p}`, drawMoon(p, 128));
  for (const [key, [w, h, draw]] of Object.entries(ICONS)) {
    const g = scene.make.graphics({}, false);
    draw(g);
    g.generateTexture(`icon-${key}`, w, h);
    g.destroy();
  }
  const t = scene.make.graphics({}, false);
  drawToken(t);
  t.generateTexture('token', 40, 56);
  t.destroy();
  const dot = scene.make.graphics({}, false);
  dot.fillStyle(0xffffff, 1);
  dot.fillCircle(4, 4, 4);
  dot.generateTexture('dot', 8, 8);
  dot.clear();
  dot.fillStyle(0xffffff, 1);
  dot.fillRect(0, 1, 10, 2);
  dot.generateTexture('spark', 10, 4);
  dot.destroy();
}
