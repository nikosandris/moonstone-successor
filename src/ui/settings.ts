// Player preferences, kept in localStorage (UI only - never part of game state).
export interface Settings {
  duelMode: 'arena' | 'classic';
  volume: number; // 0..1
  muted: boolean;
  animSpeed: number; // 0.5 slow .. 2 fast
  blood: boolean;
}

const KEY = 'moonblood.settings';
const DEFAULTS: Settings = { duelMode: 'arena', volume: 0.7, muted: false, animSpeed: 1, blood: true };

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // storage blocked: fall back to defaults
  }
  return { ...DEFAULTS };
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
