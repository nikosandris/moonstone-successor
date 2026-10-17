import { describe, expect, it } from 'vitest';
import { Rng, nextFloat, seedToState } from '../src/core/rng';

describe('seeded RNG', () => {
  it('is deterministic for the same seed', () => {
    const a = { rng: seedToState(42) };
    const b = { rng: seedToState(42) };
    const ra = new Rng(a);
    const rb = new Rng(b);
    for (let i = 0; i < 50; i++) expect(ra.d6()).toBe(rb.d6());
  });

  it('differs between seeds', () => {
    const a = new Rng({ rng: seedToState(1) });
    const b = new Rng({ rng: seedToState(2) });
    const sa = Array.from({ length: 20 }, () => a.d6()).join('');
    const sb = Array.from({ length: 20 }, () => b.d6()).join('');
    expect(sa).not.toBe(sb);
  });

  it('d6 only yields 1..6 and covers the range', () => {
    const r = new Rng({ rng: seedToState(7) });
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.d6());
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('nextFloat is pure and in [0,1)', () => {
    const [v1, s1] = nextFloat(123);
    const [v2, s2] = nextFloat(123);
    expect(v1).toBe(v2);
    expect(s1).toBe(s2);
    expect(v1).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThan(1);
  });

  it('weighted never picks zero-weight items', () => {
    const r = new Rng({ rng: seedToState(9) });
    for (let i = 0; i < 200; i++) expect(r.weighted(['a', 'b', 'c'], [0, 5, 0])).toBe('b');
  });
});
