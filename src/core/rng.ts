// Deterministic seeded RNG (mulberry32). State is a single uint32 stored in GameState.rng.

export function seedToState(seed: number): number {
  return (seed >>> 0) || 0x9e3779b9;
}

/** Returns [float in [0,1), nextState] */
export function nextFloat(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Small mutable wrapper that reads/writes the rng field of an (already cloned) holder. */
export class Rng {
  constructor(private holder: { rng: number }) {}
  float(): number {
    const [v, n] = nextFloat(this.holder.rng);
    this.holder.rng = n;
    return v;
  }
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }
  d6(): number {
    return this.int(1, 6);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.float() * arr.length)];
  }
  /** weighted pick; weights >= 0, at least one > 0 */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }
}
