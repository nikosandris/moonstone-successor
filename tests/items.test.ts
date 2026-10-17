import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { SCARS } from '../src/data/scars';

describe('item and scar data', () => {
  const of = (k: string) => ITEMS.filter((i) => i.kind === k);
  it('has at least 10 weapons, 8 armors and 6 consumables', () => {
    expect(of('weapon').length).toBeGreaterThanOrEqual(10);
    expect(of('armor').length).toBeGreaterThanOrEqual(8);
    expect(of('consumable').length).toBeGreaterThanOrEqual(6);
  });
  it('ids are unique', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
  it('higher tiers are better and cost more', () => {
    for (const kind of ['weapon', 'armor'] as const) {
      const list = of(kind);
      for (const a of list) {
        for (const b of list) {
          if (a.tier < b.tier) {
            expect(a.bonus!).toBeLessThanOrEqual(b.bonus!);
            expect(a.price).toBeLessThan(b.price);
          }
        }
      }
    }
  });
  it('every item has a clear stat description', () => {
    for (const i of ITEMS) expect(i.desc.length).toBeGreaterThan(3);
  });
  it('has at least 8 scar types with unique ids', () => {
    expect(SCARS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SCARS.map((s) => s.id)).size).toBe(SCARS.length);
    for (const s of SCARS) expect(Object.keys(s.effect).length).toBeGreaterThan(0);
  });
});
