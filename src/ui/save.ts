// Save / resume the current game in localStorage. The state is plain JSON, so this is lossless.
import type { GameState } from '../core/types';

const KEY = 'moonblood.save.v2';

export interface SaveInfo {
  day: number;
  names: string[];
  savedAt: number;
}

export function saveGame(s: GameState): void {
  try {
    if (s.stage === 'gameOver') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), state: s }));
  } catch {
    // storage full or blocked: the game continues unsaved
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { state: GameState };
    const s = data.state;
    // minimal shape check so a broken save never crashes the title screen
    if (!s || !Array.isArray(s.players) || typeof s.day !== 'number' || !Array.isArray(s.order)) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveInfo(): SaveInfo | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { savedAt: number; state: GameState };
    return { day: data.state.day, names: data.state.players.map((p) => p.name), savedAt: data.savedAt };
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
