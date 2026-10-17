import { describe, expect, it } from 'vitest';
import { BOARD } from '../src/data/board';
import { distancesFrom, neighbors, reachable, SANCTUM_ID } from '../src/core/graph';
import { getItem } from '../src/data/items';

describe('board', () => {
  it('has about 30 nodes, all connected', () => {
    expect(BOARD.nodes.length).toBeGreaterThanOrEqual(28);
    expect(BOARD.nodes.length).toBeLessThanOrEqual(34);
    const d = distancesFrom(0);
    expect(d.every((x) => Number.isFinite(x))).toBe(true);
  });
  it('node ids are indexes and edges are valid and unique', () => {
    BOARD.nodes.forEach((n, i) => expect(n.id).toBe(i));
    const seen = new Set<string>();
    for (const [a, b] of BOARD.edges) {
      expect(a).not.toBe(b);
      expect(BOARD.nodes[a]).toBeDefined();
      expect(BOARD.nodes[b]).toBeDefined();
      const k = [Math.min(a, b), Math.max(a, b)].join('-');
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
  it('has 4 homes, 4 lairs with distinct seals, 1 sanctum and every node type', () => {
    const by = (t: string) => BOARD.nodes.filter((n) => n.type === t);
    expect(by('home')).toHaveLength(4);
    expect(new Set(by('home').map((n) => n.seat)).size).toBe(4);
    expect(by('lair')).toHaveLength(4);
    expect(new Set(by('lair').map((n) => n.seal))).toEqual(new Set([0, 1, 2, 3]));
    expect(by('sanctum')).toHaveLength(1);
    expect(by('village').length).toBeGreaterThan(0);
    expect(by('ruins').length).toBeGreaterThan(0);
    expect(by('road').length).toBeGreaterThan(0);
  });
  it('village stock references real items', () => {
    for (const v of BOARD.nodes.filter((n) => n.type === 'village')) {
      expect(v.stock!.length).toBeGreaterThan(0);
      for (const id of v.stock!) expect(() => getItem(id)).not.toThrow();
    }
  });
  it('reachable respects step counts and includes staying put', () => {
    expect(reachable(0, 0)).toEqual([0]);
    const r1 = reachable(0, 1);
    expect(r1).toContain(0);
    for (const nb of neighbors(0)) expect(r1).toContain(nb);
    expect(r1.length).toBe(1 + neighbors(0).length);
    expect(reachable(0, 99)).toHaveLength(BOARD.nodes.length);
    expect(distancesFrom(SANCTUM_ID)[SANCTUM_ID]).toBe(0);
  });
});
