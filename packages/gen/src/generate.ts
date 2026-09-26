import {
  BaseTex as T,
  CELL_SIZE,
  CellPlan,
  DoorKind,
  EnemyType,
  HEADING_DX,
  HEADING_DY,
  MapBuilder,
  Rng,
  SPECIAL_LIFT,
  SPECIAL_SECRET_AREA,
  THEME_NAMES,
  ThingType,
  emitCellPlan,
  keyThing,
  type MapData,
  type TextureId,
} from '@proc-fps/core';
import { embedMission, type CellRect, type Layout, type LayoutFailure } from './layout.js';
import { generateMission, type DoorKind as MissionDoor, type Mission, type RoomKind } from './mission.js';
import { graphDepth, populate } from './population.js';
import { designRoom, type RoomDesign } from './rooms.js';

/**
 * Bump on ANY change that alters output for an existing seed.
 * seed + GENERATOR_VERSION must always reproduce the same map.
 */
export const GENERATOR_VERSION = '0.12.0';

/** Layout attempts per mission, and missions tried, before giving up on a seed. */
const LAYOUT_TRIES = 8;
const MISSION_TRIES = 8;
/** Floor plans are flat per storey; storeys are STOREY_HEIGHT apart, joined by lifts. */
const STOREY_FLOOR = 0;
const STOREY_HEIGHT = 192;
/** Chance a level has two storeys: level 1, then later levels. */
const TWO_STOREY_CHANCE = [0.4, 0.6] as const;
const CORRIDOR_HEIGHT = 128;
/** Ceiling clearance above a room's highest walkable floor. */
const ROOM_HEADROOM = 96;

export interface Generated {
  map: MapData;
  mission: Mission;
  layout: Layout;
  /** Room template per mission node. */
  designs: RoomDesign[];
  /** Layout attempts used, 1 = first try. A health metric for gen:stats. */
  attempts: number;
  /** Why the failed attempts failed. */
  failures: Record<LayoutFailure, number>;
}

/**
 * Pipeline: mission graph → grid embedding → room templates → cell plan → sectors, with doors
 * in corridor cells, keys in their rooms, secret areas marked, and enemies and health
 * balanced by level and depth. The level only changes the population: the same seed at a
 * higher level is the same layout, harder.
 */
export interface GenerateOptions {
  /** Position in a run, 1 = first (default). */
  level?: number;
}

export function generate(seed: string, options: GenerateOptions = {}): MapData {
  return generateDetailed(seed, options).map;
}

export function generateDetailed(seed: string, options: GenerateOptions = {}): Generated {
  const level = Math.max(1, Math.floor(options.level ?? 1));
  const rng = new Rng(seed);
  let attempts = 0;
  const failures: Record<LayoutFailure, number> = { placement: 0, route: 0 };
  for (let m = 0; m < MISSION_TRIES; m++) {
    const mission = generateMission(rng.fork(m === 0 ? 'mission' : `mission/${m}`));
    for (let l = 0; l < LAYOUT_TRIES; l++) {
      attempts++;
      const layout = embedMission(mission, rng.fork(`layout/${m}/${l}`));
      if (typeof layout === 'string') {
        failures[layout]++;
        continue;
      }
      return { ...emit(seed, mission, layout, rng, level), mission, layout, attempts, failures };
    }
  }
  throw new Error(`seed ${seed}: no layout after ${attempts} attempts`);
}

/**
 * Storey per mission node: some levels split by depth along the graph, so the deeper part sits a
 * storey up. Key and secret connections never change storey (the boss room and exit share the
 * gate room's, loot and secret rooms their host's), so a lift only ever replaces an ordinary
 * connection.
 */
function assignStoreys(mission: Mission, rng: Rng, level: number): number[] {
  const storeys = mission.nodes.map(() => 0);
  if (!rng.chance(TWO_STOREY_CHANCE[level >= 2 ? 1 : 0])) return storeys;
  const depth = graphDepth(mission);
  const exit = mission.nodes.find((n) => n.kind === 'exit')!.id;
  const threshold = Math.max(1, Math.round(depth[exit]! * rng.range(0.4, 0.65)));
  mission.nodes.forEach((_, id) => (storeys[id] = depth[id]! >= threshold ? 1 : 0));
  // Key and secret doors guard their b side (gate → boss, host → loot, host → secret); the exit hangs off the boss.
  for (const e of mission.edges) if (e.door === 'key' || e.door === 'secret') storeys[e.b] = storeys[e.a]!;
  const boss = mission.nodes.find((n) => n.kind === 'boss')!.id;
  storeys[exit] = storeys[boss]!;
  return storeys;
}

const DOOR_KIND: Record<MissionDoor, DoorKind> = { open: DoorKind.None, auto: DoorKind.Auto, key: DoorKind.Key, secret: DoorKind.Secret };
/** Rooms a door belongs next to: it guards them. */
const GUARDED: readonly RoomKind[] = ['miniboss', 'boss', 'loot', 'exit'];

function emit(seed: string, mission: Mission, layout: Layout, rng: Rng, level: number): { map: MapData; designs: RoomDesign[] } {
  const C = CELL_SIZE;
  const deco = rng.fork('deco');
  const theme = rng.fork('theme');
  const rooms = rng.fork('rooms');
  const storeys = assignStoreys(mission, rng.fork('storeys'), level);
  const floorOf = (id: number) => STOREY_FLOOR + storeys[id]! * STOREY_HEIGHT;
  const plan = new CellPlan();
  const inRoom = (r: CellRect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  const roomAt = (x: number, y: number) => layout.rooms.findIndex((r) => inRoom(r, x, y));

  /** Per room: doorway cell and the heading from the room out through it. */
  const doorways = layout.rooms.map(() => [] as [number, number, number][]);
  for (const c of layout.corridors) {
    for (const [x, y] of c.cells) {
      for (let h = 0; h < 4; h++) {
        const r = roomAt(x + HEADING_DX[h as 0]!, y + HEADING_DY[h as 0]!);
        if (r >= 0) doorways[r]!.push([x, y, (h + 2) % 4]);
      }
    }
  }

  const wallSet: TextureId[] = [T.Stone, T.Metal, T.Tech];
  /** [type, x, y, angle, flags] in cells. */
  const things: [number, number, number, number, number?][] = [];
  // Secret ids in node order; every sector of a secret carries its id (see SPECIAL_SECRET_AREA).
  const secretId = new Map(mission.nodes.filter((n) => n.kind === 'secret').map((n, i) => [n.id, i]));
  const secretArea = (id: number | undefined) => (id === undefined ? {} : { special: SPECIAL_SECRET_AREA, tag: id });

  const designs = mission.nodes.map((node, id) => {
    const r = layout.rooms[id]!;
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    const design = designRoom(node.kind, w, h, rooms);
    const minHeight = Math.max(node.kind === 'boss' ? 224 : node.kind === 'miniboss' ? 192 : 128, design.maxRise + ROOM_HEADROOM);
    const ceil = floorOf(id) + Math.round(deco.range(minHeight, Math.max(minHeight, 288)) / 8) * 8;
    const light = node.kind === 'loot' ? 232 : Math.round(deco.range(96, 232) / 8) * 8;
    const floorTex = theme.pick([T.FloorTile, T.Slime, T.Tech]);
    const wallTex = theme.pick(wallSet);
    const specs = design.regions.map((reg) =>
      plan.spec({
        floor: floorOf(id) + reg.rise,
        ceil,
        light: Math.max(0, Math.min(255, light + reg.lightDelta)),
        floorTex: reg.floorTex ?? floorTex,
        ceilTex: T.Ceiling,
        wallTex: reg.wallTex ?? wallTex,
        ...secretArea(secretId.get(id)),
        special: (reg.special ?? 0) | (secretId.has(id) ? SPECIAL_SECRET_AREA : 0),
        ...(reg.slab
          ? { slab: { bottom: floorOf(id) + reg.slab.bottom, top: floorOf(id) + reg.slab.top, topTex: T.Grate, bottomTex: T.Metal, sideTex: T.Metal } }
          : {}),
      }),
    );
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const region = design.cells[x + y * w]!;
        if (region >= 0) plan.set(r.x0 + x, r.y0 + y, specs[region]!);
      }
    }

    const cx = r.x0 + Math.floor(w / 2);
    const cy = r.y0 + Math.floor(h / 2);
    if (node.kind === 'start') {
      // Stand against the far wall in line with the first doorway, facing it across the room.
      const [dx, dy, heading] = doorways[id]![0] ?? [cx, cy, 0];
      const sx = heading === 0 ? r.x0 : heading === 2 ? r.x1 - 1 : dx;
      const sy = heading === 1 ? r.y0 : heading === 3 ? r.y1 - 1 : dy;
      things.push([ThingType.PlayerStart, sx, sy, heading * 90]);
    }
    if (node.kind === 'exit') things.push([ThingType.Exit, cx, cy, 0]);
    if (node.key !== undefined && node.kind !== 'miniboss' && node.kind !== 'boss') {
      // Keys lie on base floor (the mini boss and boss carry theirs), as near the centre as the template allows (the outer ring always is).
      let best: [number, number] = [cx, cy];
      let bestD = Infinity;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = Math.abs(r.x0 + x - cx) + Math.abs(r.y0 + y - cy);
          if (design.cells[x + y * w] === 0 && d < bestD) [best, bestD] = [[r.x0 + x, r.y0 + y], d];
        }
      }
      things.push([keyThing(node.key), best[0], best[1], 0]);
    }
    return design;
  });

  // Population: enemies and health, balanced by level and depth (population.ts).
  const occupied = new Set(things.map(([, x, y]) => `${x},${y}`));
  const nearDoor = new Set<string>();
  doorways.forEach((list) => list.forEach(([x, y, h]) => nearDoor.add(`${x - HEADING_DX[h as 0]},${y - HEADING_DY[h as 0]}`)));
  things.push(...populate({ mission, layout, designs, occupied, nearDoor, rng: rng.fork('population'), level }));

  for (const c of layout.corridors) {
    const edge = mission.edges[c.edge]!;
    const secret = secretId.get(edge.a) ?? secretId.get(edge.b);
    // A corridor between storeys runs at the lower floor and ends in a lift up to the upper room.
    const low = Math.min(floorOf(edge.a), floorOf(edge.b));
    const high = Math.max(floorOf(edge.a), floorOf(edge.b));
    const spec = (floorTex: TextureId) =>
      plan.spec({ floor: low, ceil: low + CORRIDOR_HEIGHT, light: 144, floorTex, ceilTex: T.Ceiling, wallTex: T.Metal, ...secretArea(secret) });
    // Hazard stripes mark only a corridor's two ends, so at most 2 striped tiles ever touch.
    const ends = spec(T.Trim);
    const middle = spec(T.Tech);
    c.cells.forEach(([x, y], k) => plan.set(x, y, k === 0 || k === c.cells.length - 1 ? ends : middle));

    const upperIsA = floorOf(edge.a) > floorOf(edge.b);
    if (high > low) {
      const [lx, ly] = c.cells[upperIsA ? 0 : c.cells.length - 1]!;
      plan.set(lx, ly, plan.spec({ floor: low, ceil: high + CORRIDOR_HEIGHT, light: 176, floorTex: T.Lift, ceilTex: T.Ceiling, wallTex: T.Metal, special: SPECIAL_LIFT, tag: high }));
    }

    // The door goes in the corridor cell next to the room it guards (the b end otherwise). A
    // secret door goes at the other end, flush with the room it hides from. On a corridor between
    // storeys (only ever an ordinary one) it goes at the lower end, if the lift leaves room.
    const kind = DOOR_KIND[edge.door];
    if (kind === DoorKind.None || (high > low && c.cells.length < 2)) continue;
    const atA =
      high > low
        ? !upperIsA
        : kind === DoorKind.Secret
          ? secretId.has(edge.b)
          : GUARDED.includes(mission.nodes[edge.a]!.kind) && !GUARDED.includes(mission.nodes[edge.b]!.kind);
    const [dx, dy] = c.cells[atA ? 0 : c.cells.length - 1]!;
    plan.set(dx, dy, plan.spec({
      floor: low,
      ceil: low + CORRIDOR_HEIGHT,
      light: 144,
      floorTex: T.Trim,
      ceilTex: T.Ceiling,
      wallTex: T.Metal,
      special: kind | (secret === undefined ? 0 : SPECIAL_SECRET_AREA),
      tag: secret ?? edge.key ?? 0,
    }));
  }

  const b = new MapBuilder();
  emitCellPlan(b, plan, C);
  for (const [type, x, y, angle, flags] of things) b.thing(type, (x + 0.5) * C, (y + 0.5) * C, angle, flags ?? 0);
  // The theme picks the texture set's colours; its own stream, so it never shifts other choices.
  const style = rng.fork('style').pick(THEME_NAMES);
  return { map: b.build({ name: `gen-${seed}`, seed, generatorVersion: GENERATOR_VERSION, theme: style, level }), designs };
}
