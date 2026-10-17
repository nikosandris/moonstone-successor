import type { NodeType } from '../core/types';

export const W = 1024;
export const H = 576;

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif';

export const COL = {
  bg: 0x07070d,
  panel: 0x15121f,
  panelEdge: 0x6a5634,
  edge: 0x4a5290,
  text: '#ece4d4',
  dim: '#a8a0bc',
  good: '#7ee08a',
  bad: '#ff7b7b',
  gold: '#ffd166',
  btn: 0x40305e,
  btnHot: 0x6a4fc0,
  primary: 0x8c2f39,
  btnOff: 0x2a2d4a,
  hp: 0xd9534f,
  sta: 0x4dabf7,
};

export const NODE_COLOR: Record<NodeType, number> = {
  home: 0x2b3055,
  road: 0x7a7f99,
  village: 0x4caf50,
  lair: 0xd9534f,
  ruins: 0x9b6bd6,
  sanctum: 0xf2c94c,
};

export const NODE_LABEL: Record<NodeType, string> = {
  home: 'Home',
  road: 'Road',
  village: 'Village',
  lair: 'Lair',
  ruins: 'Ruins',
  sanctum: 'SANCTUM',
};

export const NODE_GLYPH: Record<NodeType, string> = {
  home: 'H', road: '', village: 'V', lair: 'L', ruins: 'R', sanctum: 'S',
};

export const SEAL_COLORS = [0xff6b6b, 0x4dabf7, 0x69db7c, 0xffd43b];

export const PLAYER_COLORS = [0xe05555, 0x4d9de0, 0x59c26b, 0xe6b422, 0xb26be0, 0xe08a3c];

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
