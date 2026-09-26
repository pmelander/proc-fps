import { AMMO_PICKUP, ENEMY_DEFS, EnemyType, PLAYER_DAMAGE, START_AMMO, ThingType, type Rng } from '@proc-fps/core';
import type { Layout } from './layout.js';
import type { Mission } from './mission.js';
import type { RoomDesign } from './rooms.js';

/**
 * Enemies, health and ammo, balanced (M5):
 * - Difficulty rises with the run's level and with each room's depth along the mission graph,
 *   so rooms near the exit are fuller and nastier than rooms near the start. Snipers appear
 *   only deep in a level or from level 2.
 * - Health sits along the way (always one in the gate room before the boss) and in loot and
 *   secret rooms; ammo is placed to cover every enemy with a margin, nearer rooms first.
 * Things go on free base floor, never on a cell in front of a doorway, never two on a cell.
 * Start and exit rooms stay empty.
 */
export interface PopulationInput {
  mission: Mission;
  layout: Layout;
  designs: readonly RoomDesign[];
  /** Cells already holding a thing ("x,y"). Updated as things are placed. */
  occupied: Set<string>;
  /** Room cells right inside a doorway ("x,y"). */
  nearDoor: ReadonlySet<string>;
  rng: Rng;
  level: number;
}

export type Placed = [type: number, x: number, y: number, angle: number];

const CELLS_PER_ENEMY = 14;
const MAX_ROOM_ENEMIES = 5;
/** Budget points per enemy. */
const COST: Partial<Record<EnemyType, number>> = { [EnemyType.Grunt]: 1, [EnemyType.Brute]: 1.5, [EnemyType.Sniper]: 2 };
/** Ammo for every enemy's hit points, times this. */
const AMMO_MARGIN = 1.5;
const ROOM_HEALTH_CHANCE = 0.25;

/** How much harder each level after the first is. */
export const levelDifficulty = (level: number) => 1 + 0.2 * (Math.max(1, level) - 1);

export function populate(input: PopulationInput): Placed[] {
  const { mission, layout, designs, occupied, nearDoor, rng, level } = input;
  const placed: Placed[] = [];
  const depth = graphDepth(mission);
  const exit = mission.nodes.find((n) => n.kind === 'exit')!.id;
  const maxDepth = Math.max(1, depth[exit]!);
  const difficulty = levelDifficulty(level);

  // Free cells per room, drawn from as things are placed.
  const free = mission.nodes.map((_, id) => {
    const r = layout.rooms[id]!;
    const w = r.x1 - r.x0;
    const cells: [number, number][] = [];
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const k = `${x},${y}`;
        if (designs[id]!.cells[x - r.x0 + (y - r.y0) * w] === 0 && !occupied.has(k) && !nearDoor.has(k)) cells.push([x, y]);
      }
    }
    return cells;
  });
  const put = (id: number, type: number, index = rng.int(0, free[id]!.length - 1)) => {
    const cells = free[id]!;
    if (!cells.length) return false;
    const [[x, y]] = cells.splice(index, 1) as [[number, number]];
    occupied.add(`${x},${y}`);
    placed.push([type, x, y, 0]);
    return true;
  };
  const putCentral = (id: number, type: number) => {
    const r = layout.rooms[id]!;
    const [cx, cy] = [(r.x0 + r.x1 - 1) / 2, (r.y0 + r.y1 - 1) / 2];
    const cells = free[id]!;
    if (!cells.length) return;
    const dist = ([x, y]: [number, number]) => Math.abs(x - cx) + Math.abs(y - cy);
    put(id, type, cells.reduce((best, c, i) => (dist(c) < dist(cells[best]!) ? i : best), 0));
  };
  const pickEnemy = (deep: number): EnemyType => {
    const weights: [EnemyType, number][] = [
      [EnemyType.Grunt, 1],
      [EnemyType.Brute, 0.5 + 0.5 * deep],
      [EnemyType.Sniper, level >= 2 || deep > 0.5 ? 0.12 + 0.08 * (level - 1) : 0],
    ];
    let roll = rng.range(0, weights.reduce((s, [, w]) => s + w, 0));
    return weights.find(([, w]) => (roll -= w) < 0)?.[0] ?? EnemyType.Grunt;
  };

  // Enemies.
  mission.nodes.forEach((node, id) => {
    const r = layout.rooms[id]!;
    const deep = depth[id]! / maxDepth;
    if (node.kind === 'room') {
      let budget = ((r.x1 - r.x0) * (r.y1 - r.y0) / CELLS_PER_ENEMY) * difficulty * (0.6 + 0.8 * deep) + rng.range(-0.4, 0.6);
      for (let n = 0; n < MAX_ROOM_ENEMIES; n++) {
        const type = pickEnemy(deep);
        const cost = COST[type] ?? 1;
        if (cost > budget + 0.5 || !put(id, type)) break;
        budget -= cost;
      }
    } else if (node.kind === 'miniboss') {
      putCentral(id, EnemyType.MiniBoss);
      const escort = rng.int(1, 1 + Math.floor(level / 2));
      for (let n = 0; n < escort; n++) put(id, rng.chance(0.3 * (level - 1)) ? EnemyType.Brute : EnemyType.Grunt);
    } else if (node.kind === 'boss') {
      putCentral(id, EnemyType.Boss);
      const escort = level >= 3 ? Math.min(4, rng.int(1, level - 1)) : 0;
      for (let n = 0; n < escort; n++) put(id, EnemyType.Grunt);
    }
  });

  // Health: the gate room before the boss always, loot and secret rooms as a reward, other rooms sometimes.
  const boss = mission.nodes.find((n) => n.kind === 'boss')!.id;
  const gate = mission.edges.find((e) => e.door === 'key' && (e.a === boss || e.b === boss));
  const gateRoom = gate ? (gate.a === boss ? gate.b : gate.a) : -1;
  mission.nodes.forEach((node, id) => {
    if (node.kind === 'loot' || node.kind === 'secret') {
      const n = rng.int(1, 2);
      for (let k = 0; k < n; k++) put(id, ThingType.Health);
    } else if (id === gateRoom) {
      put(id, ThingType.Health);
    } else if (node.kind === 'room' && rng.chance(ROOM_HEALTH_CHANCE + 0.15 * (depth[id]! / maxDepth))) {
      put(id, ThingType.Health);
    }
  });

  // Ammo: enough to kill everything with a margin, spread from the start outwards; loot and
  // secret rooms add one box each on top.
  const shots = placed.reduce((sum, [type]) => {
    const def = ENEMY_DEFS[type as EnemyType];
    return def ? sum + Math.ceil(def.hp / PLAYER_DAMAGE) : sum;
  }, 0);
  let boxes = Math.max(0, Math.ceil((shots * AMMO_MARGIN - START_AMMO) / AMMO_PICKUP));
  const holders = mission.nodes
    .filter((n) => n.kind === 'room' || n.kind === 'miniboss' || n.kind === 'boss')
    .sort((a, b) => depth[a.id]! - depth[b.id]!)
    .map((n) => n.id);
  for (let pass = 0; boxes > 0 && pass < 8; pass++) {
    for (const id of holders) {
      if (boxes > 0 && put(id, ThingType.Ammo)) boxes--;
    }
  }
  mission.nodes.forEach((node, id) => {
    if (node.kind === 'loot' || node.kind === 'secret') put(id, ThingType.Ammo);
  });
  return placed;
}

/** Breadth-first distance of every mission node from the start, ignoring locks. */
export function graphDepth(m: Mission): number[] {
  const depth = new Array<number>(m.nodes.length).fill(-1);
  const start = m.nodes.find((n) => n.kind === 'start')!.id;
  depth[start] = 0;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i]!;
    for (const e of m.edges) {
      const b = e.a === a ? e.b : e.b === a ? e.a : -1;
      if (b >= 0 && depth[b] === -1) {
        depth[b] = depth[a]! + 1;
        queue.push(b);
      }
    }
  }
  return depth;
}
