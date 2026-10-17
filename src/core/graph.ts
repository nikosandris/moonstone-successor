import { BOARD } from '../data/board';
import type { BoardNode } from './types';

const adj: number[][] = BOARD.nodes.map(() => []);
for (const [a, b] of BOARD.edges) {
  adj[a].push(b);
  adj[b].push(a);
}

export function neighbors(id: number): readonly number[] {
  return adj[id];
}

export function node(id: number): BoardNode {
  return BOARD.nodes[id];
}

const distCache = new Map<number, number[]>();

/** Shortest path length (in steps) from `from` to every node. */
export function distancesFrom(from: number): number[] {
  const cached = distCache.get(from);
  if (cached) return cached;
  const dist = BOARD.nodes.map(() => Infinity);
  dist[from] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const nb of adj[cur]) {
      if (dist[nb] === Infinity) {
        dist[nb] = dist[cur] + 1;
        queue.push(nb);
      }
    }
  }
  distCache.set(from, dist);
  return dist;
}

/** All nodes reachable in at most `steps` steps (includes the start node: you may stay). */
export function reachable(from: number, steps: number): number[] {
  const d = distancesFrom(from);
  return BOARD.nodes.filter((n) => d[n.id] <= steps).map((n) => n.id);
}

export function homeNode(seat: number): number {
  const n = BOARD.nodes.find((x) => x.type === 'home' && x.seat === seat);
  if (!n) throw new Error(`no home for seat ${seat}`);
  return n.id;
}

export const SANCTUM_ID = BOARD.nodes.find((n) => n.type === 'sanctum')!.id;
