import type { BoardData, BoardNode, NodeType } from '../core/types';

// Hand-authored map, 1000 x 600 coordinate space.
// Outer ring (homes, villages, lairs), four spokes to the Sanctum, and inner diagonals.
const n = (
  id: number,
  type: NodeType,
  name: string,
  x: number,
  y: number,
  extra: Partial<BoardNode> = {},
): BoardNode => ({ id, type, name, x, y, ...extra });

export const BOARD: BoardData = {
  nodes: [
    n(0, 'sanctum', 'The Sanctum', 500, 300),
    // Homes (seat 0 NW, 1 NE, 2 SE, 3 SW)
    n(1, 'home', 'Home NW', 90, 80, { seat: 0 }),
    n(2, 'home', 'Home NE', 910, 80, { seat: 1 }),
    n(3, 'home', 'Home SE', 910, 520, { seat: 2 }),
    n(4, 'home', 'Home SW', 90, 520, { seat: 3 }),
    // Lairs (N, E, S, W), each guards one Seal
    n(5, 'lair', 'Wolf Den', 500, 70, { seal: 0, monster: 'direWolf' }),
    n(6, 'lair', 'Troll Bog', 900, 300, { seal: 1, monster: 'bogTroll' }),
    n(7, 'lair', 'Rust Keep', 500, 530, { seal: 2, monster: 'rustKnight' }),
    n(8, 'lair', 'Drake Cave', 100, 300, { seal: 3, monster: 'caveDrake' }),
    // Villages near the homes
    n(9, 'village', 'Ashford', 230, 70, { stock: ['sword1', 'sword2', 'studded', 'scale', 'potionS', 'whetstone'] }),
    n(10, 'village', 'Brindle', 770, 70, { stock: ['axe1', 'warhammer', 'chain', 'plate', 'potionS', 'tonic'] }),
    n(11, 'village', 'Cinder Mill', 770, 530, { stock: ['spear1', 'halberd', 'studded', 'scale', 'potionL', 'brew'] }),
    n(12, 'village', 'Dunmere', 230, 530, { stock: ['mace', 'sword2', 'chain', 'plate', 'potionL', 'smoke'] }),
    // Roads and ruins
    n(13, 'road', 'North Road', 500, 170),
    n(14, 'ruins', 'Sunken Crypt', 620, 300),
    n(15, 'road', 'South Road', 500, 430),
    n(16, 'ruins', 'Fallen Chapel', 380, 300),
    n(17, 'road', 'East Pass N', 905, 190),
    n(18, 'road', 'East Pass S', 905, 410),
    n(19, 'road', 'West Pass S', 95, 410),
    n(20, 'road', 'West Pass N', 95, 190),
    n(21, 'road', 'NW Track', 330, 190),
    n(22, 'road', 'NE Track', 670, 190),
    n(23, 'road', 'SE Track', 670, 410),
    n(24, 'road', 'SW Track', 330, 410),
    n(25, 'ruins', 'Toppled Tower', 365, 70),
    n(26, 'ruins', 'Broken Altar', 635, 70),
    n(27, 'ruins', 'Old Barrow', 635, 530),
    n(28, 'ruins', 'Lost Shrine', 365, 530),
    n(29, 'road', 'East Spoke', 760, 300),
    n(30, 'road', 'West Spoke', 240, 300),
  ],
  edges: [
    // outer ring
    [1, 9], [9, 25], [25, 5], [5, 26], [26, 10], [10, 2], [2, 17], [17, 6], [6, 18], [18, 3],
    [3, 11], [11, 27], [27, 7], [7, 28], [28, 12], [12, 4], [4, 19], [19, 8], [8, 20], [20, 1],
    // spokes
    [5, 13], [13, 0], [6, 29], [29, 14], [14, 0], [7, 15], [15, 0], [8, 30], [30, 16], [16, 0],
    // diagonals
    [9, 21], [21, 13], [21, 16], [10, 22], [22, 13], [22, 14],
    [11, 23], [23, 14], [23, 15], [12, 24], [24, 15], [24, 16],
  ],
};

export const SEAL_COUNT = 4;
