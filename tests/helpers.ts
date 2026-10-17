import { applyAction, createGame } from '../src/core/game';
import type { Action, GameState, PlayerSetup } from '../src/core/types';

export function setups(n: number): PlayerSetup[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, color: 0x111111 * (i + 1) }));
}

/** New game with knight 0 to act and initiative 0,1,2... so scenarios can address players[0]. */
export function newGame(n = 2, seed = 1): GameState {
  const s = createGame(setups(n), seed);
  s.order = s.players.map((p) => p.id);
  s.current = 0;
  return s;
}

export function rawGame(n = 2, seed = 1): GameState {
  return createGame(setups(n), seed);
}

/** Deep copy + mutate: states are plain data, so tests can set up scenarios directly. */
export function edit(s: GameState, fn: (draft: GameState) => void): GameState {
  const d = structuredClone(s);
  fn(d);
  return d;
}

export function act(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce((st, a) => applyAction(st, a), s);
}

/** Put the current knight on `pos`, ready to resolve it by moving there (distance 0). */
export function atNode(s: GameState, pos: number, day?: number): GameState {
  return edit(s, (d) => {
    d.players[d.current].pos = pos;
    d.stage = 'move';
    d.moveRoll = 1;
    if (day !== undefined) d.day = day;
  });
}

/** Play combat rounds with a fixed choice for side a (and b in duels) until it is over. */
export function fightToEnd(s: GameState, a: 'strike' | 'guard' | 'feint' = 'strike', b: 'strike' | 'guard' | 'feint' = 'guard'): GameState {
  let st = s;
  let guard = 0;
  while (st.combat && !st.combat.over) {
    const c = st.combat;
    // fall back to guard when stamina is short
    const pick = (want: typeof a, stamina: number) => (want !== 'guard' && stamina < 2 ? 'guard' : want);
    st = applyAction(st, { type: 'choose', side: 'a', choice: pick(a, c.staminaA) });
    if (c.kind === 'pvp') st = applyAction(st, { type: 'choose', side: 'b', choice: pick(b, c.staminaB) });
    if (++guard > 500) throw new Error('fight did not end');
  }
  return st;
}
