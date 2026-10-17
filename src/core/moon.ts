import { CONFIG, MOON_EFFECTS, PHASES } from '../data/balance';
import type { MoonPhase } from './types';

export function phaseForDay(day: number): MoonPhase {
  const idx = Math.floor((day - 1) / CONFIG.daysPerPhase) % PHASES.length;
  return PHASES[idx];
}

export function isSanctumOpen(day: number): boolean {
  return phaseForDay(day) === 'full';
}

/** Days until the next Full moon begins (0 if it is Full today). */
export function daysUntilFull(day: number): number {
  for (let d = day; d <= day + CONFIG.daysPerPhase * PHASES.length; d++) {
    if (phaseForDay(d) === 'full') return d - day;
  }
  return 0;
}

export function moonEffect(day: number) {
  return MOON_EFFECTS[phaseForDay(day)];
}

/** Days left in the current phase, counting today (1 on the phase's last day). */
export function daysLeftInPhase(day: number): number {
  return CONFIG.daysPerPhase - ((day - 1) % CONFIG.daysPerPhase);
}
