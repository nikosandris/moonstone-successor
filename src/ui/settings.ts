// Player preferences, kept in localStorage (UI only - never part of game state).
export interface Settings {
  /** arena3d = Three.js real-time duel, arena = 2D Phaser duel, classic = buttons */
  duelMode: 'arena3d' | 'arena' | 'classic';
  v?: number;
  volume: number; // 0..1
  muted: boolean;
  animSpeed: number; // 0.5 slow .. 2 fast
  blood: boolean;
  tutorial: boolean;
  /** how long the reaction window lasts in real-time duels */
  reaction: 'relaxed' | 'normal' | 'expert';
}

const KEY = 'moonblood.settings';
const DEFAULTS: Settings = { v: 2, duelMode: 'arena3d', volume: 0.7, muted: false, animSpeed: 1, blood: true, tutorial: true, reaction: 'normal' };

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // v1 saves predate the 3D arena: move them to the new default once
      if (!saved.v) { saved.duelMode = 'arena3d'; saved.v = 2; }
      return { ...DEFAULTS, ...saved };
    }
  } catch {
    // storage blocked: fall back to defaults
  }
  return { ...DEFAULTS };
}

/** Multiplier on every monster's telegraph time (and the duel window). */
export function reactionScale(): number {
  return { relaxed: 2.4, normal: 1.8, expert: 1.15 }[current.reaction] ?? 1.8;
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l(current));
  return current;
}

const listeners: ((s: Settings) => void)[] = [];
export function onSettings(l: (s: Settings) => void): void {
  listeners.push(l);
}
