import { EnemyType, THING_HIGH, THING_VARIANT, ThingType, VARIANT_TYPES, dropsKeyFlags, type DifficultyDef, type Rng } from '@proc-fps/core';
import type { Layout } from './layout.js';
import type { Mission } from './mission.js';
import type { RoomDesign } from './rooms.js';

/**
 * Enemies and health, balanced:
 * - Difficulty rises with the run's level and with each room's depth along the mission graph,
 *   so rooms near the exit are fuller and nastier than rooms near the start. Snipers appear
 *   only deep in a level or from level 2.
 * - Health sits along the way (always one in the gate room before the boss) and in loot and
 *   secret rooms. Ammo is infinite.
 * Things go on free base floor, never on a cell in front of a doorway, never two on a cell.
 * Start and exit rooms stay empty. Snipers prefer high ground: a room's catwalk tops (an atrium's
 * ring, the catwalk across a pit) are perches, and an atrium usually gets a sniper up there.
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
  /** Run difficulty: scales the enemy budget and escorts, and the chance of health in a room. */
  difficulty?: DifficultyDef;
}

/** Chance an atrium gets a sniper on its ring, before the level adds to it. */
const ATRIUM_SNIPER_CHANCE = 0.35;

export type Placed = [type: number, x: number, y: number, angle: number, flags?: number];

/** Hordes: about one enemy per this many cells of an ordinary room (before level and depth). */
const CELLS_PER_ENEMY = 6;
const MAX_ROOM_ENEMIES = 10;
/** Budget points per enemy. */
const COST: Partial<Record<EnemyType, number>> = { [EnemyType.Grunt]: 1, [EnemyType.Brute]: 1.5, [EnemyType.Sniper]: 2 };
const ROOM_HEALTH_CHANCE = 0.25;

/** How much harder each level after the first is. */
export const levelDifficulty = (level: number) => 1 + 0.2 * (Math.max(1, level) - 1);

export function populate(input: PopulationInput): Placed[] {
  const { mission, layout, designs, occupied, nearDoor, rng, level } = input;
  const placed: Placed[] = [];
  const depth = graphDepth(mission);
  const exit = mission.nodes.find((n) => n.kind === 'exit')!.id;
  const maxDepth = Math.max(1, depth[exit]!);
  const scale = input.difficulty ?? { enemies: 1, health: 1 };
  const difficulty = levelDifficulty(level) * scale.enemies;

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
  const put = (id: number, type: number, index = rng.int(0, free[id]!.length - 1), flags = 0) => {
    const cells = free[id]!;
    if (!cells.length) return false;
    const [[x, y]] = cells.splice(index, 1) as [[number, number]];
    occupied.add(`${x},${y}`);
    placed.push([type, x, y, 0, flags]);
    return true;
  };
  /** Near the room centre; a room's key (mini boss, boss) is carried by the enemy placed here. */
  const putCentral = (id: number, type: number) => {
    const key = mission.nodes[id]!.key;
    const r = layout.rooms[id]!;
    const [cx, cy] = [(r.x0 + r.x1 - 1) / 2, (r.y0 + r.y1 - 1) / 2];
    const cells = free[id]!;
    if (!cells.length) return;
    const dist = ([x, y]: [number, number]) => Math.abs(x - cx) + Math.abs(y - cy);
    put(id, type, cells.reduce((best, c, i) => (dist(c) < dist(cells[best]!) ? i : best), 0), key === undefined ? 0 : dropsKeyFlags(key));
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

  // Variants: the level breeds two of each ordinary role. Most rooms hold one kind (a horde of the
  // same mutant reads as a group), some mix them. Drawn from their own stream.
  const variants = rng.fork('variants');
  const roomVariant = mission.nodes.map(() => {
    const roll = variants.float();
    return roll < 0.4 ? 0 : roll < 0.8 ? 1 : -1; // -1 = mixed
  });
  const variantFlags = (id: number, type: EnemyType) => {
    if (!VARIANT_TYPES.includes(type)) return 0;
    const v = roomVariant[id]! >= 0 ? roomVariant[id]! : variants.chance(0.5) ? 1 : 0;
    return v ? THING_VARIANT : 0;
  };
  const putEnemy = (id: number, type: EnemyType) => put(id, type, undefined, variantFlags(id, type));
  // Perches: cells of a room whose region carries a slab (a catwalk top), clear of its doorways.
  const perches = mission.nodes.map((_, id) => {
    const r = layout.rooms[id]!;
    const w = r.x1 - r.x0;
    const d = designs[id]!;
    const cells: [number, number][] = [];
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const region = d.cells[x - r.x0 + (y - r.y0) * w]!;
        if (region >= 0 && d.regions[region]!.slab && !nearDoor.has(`${x},${y}`) && !occupied.has(`${x},${y}`)) cells.push([x, y]);
      }
    }
    return cells;
  });
  /** A sniper up on one of the room's perches; false when it has none free. */
  const perch = (id: number): boolean => {
    const cells = perches[id]!;
    if (!cells.length) return false;
    const [[x, y]] = cells.splice(variants.int(0, cells.length - 1), 1) as [[number, number]];
    occupied.add(`${x},${y}`);
    placed.push([EnemyType.Sniper, x, y, 0, THING_HIGH | variantFlags(id, EnemyType.Sniper)]);
    return true;
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
        if (cost > budget + 0.5) break;
        if (!(type === EnemyType.Sniper && perch(id)) && !putEnemy(id, type)) break;
        budget -= cost;
      }
      if (designs[id]!.template === 'atrium' && variants.chance(ATRIUM_SNIPER_CHANCE + 0.1 * (level - 1))) perch(id);
    } else if (node.kind === 'miniboss') {
      putCentral(id, EnemyType.MiniBoss);
      const escort = Math.round(rng.int(2, 3 + Math.floor(level / 2)) * scale.enemies);
      for (let n = 0; n < escort; n++) putEnemy(id, rng.chance(0.3 * (level - 1)) ? EnemyType.Brute : EnemyType.Grunt);
    } else if (node.kind === 'boss') {
      putCentral(id, EnemyType.Boss);
      const escort = Math.round(Math.min(8, rng.int(1, 1 + level)) * scale.enemies);
      for (let n = 0; n < escort; n++) putEnemy(id, EnemyType.Grunt);
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
    } else if (node.kind === 'room' && rng.chance((ROOM_HEALTH_CHANCE + 0.15 * (depth[id]! / maxDepth)) * scale.health)) {
      put(id, ThingType.Health);
    }
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
