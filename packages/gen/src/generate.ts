import {
  BaseTex as T,
  CELL_SIZE,
  CellPlan,
  DIFFICULTY,
  DoorKind,
  type Difficulty,
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
import { LEVEL_PROFILES, levelTypeFor, type LevelProfile, type LevelType } from './levels.js';
import { generateMission, type DoorKind as MissionDoor, type Mission, type RoomKind } from './mission.js';
import { populate } from './population.js';
import { strandsPlayer } from './progress.js';
import { ATRIUM_LIFT, atriumDesign, designRoom, plainDesign, type RoomDesign } from './rooms.js';

/**
 * Bump on ANY change that alters output for an existing seed.
 * seed + GENERATOR_VERSION must always reproduce the same map.
 */
export const GENERATOR_VERSION = '0.20.0';

/** Layout attempts per mission, and missions tried, before giving up on a seed. */
const LAYOUT_TRIES = 8;
const MISSION_TRIES = 8;
/** Floor plans are flat per storey; storeys are STOREY_HEIGHT apart, joined by lifts, drops, bridges and atriums. */
const STOREY_FLOOR = 0;
const STOREY_HEIGHT = 192;
/** A connection climbs at most this many storeys (a tall lift); drops, bridges and atriums span one. */
const MAX_STOREY_JUMP = 2;
/** Atriums need an interior inside their catwalk ring: at least this many cells a side. */
const ATRIUM_MIN_SIZE = 5;
/** Headroom above an atrium's catwalk beyond a corridor's height: the room reads as tall. */
const ATRIUM_EXTRA_HEIGHT = 96;
/** Rooms a drop may land in: never a room behind a key or secret door (those never change storey anyway). */
const DROP_INTO: readonly RoomKind[] = ['room', 'miniboss'];
/** A bridge's catwalk runs at most this many cells into the room before its lift. */
const BRIDGE_MAX = 4;
const CATWALK_THICKNESS = 16;

/** A catwalk carrying an upper-storey corridor into a lower room, down to its floor by a lift. */
interface Bridge {
  room: number;
  catwalk: [number, number][];
  lift: [number, number];
  high: number;
}
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
  type: LevelType;
  /** Storey per mission node (0 = the lowest). */
  storeys: number[];
  /** One-way drops, atriums and bridges joining storeys. */
  drops: number;
  atriums: number;
  bridges: number;
}

/**
 * Pipeline: mission graph → grid embedding → room templates → cell plan → sectors, with doors
 * in corridor cells, keys in their rooms, secret areas marked, and enemies and health
 * balanced by level and depth. The level type (levels.ts) shapes the mission, the rooms and the
 * storeys; by default a run paces it by level. For a given seed and type the level only changes
 * the population: a higher level is the same layout, harder.
 */
export interface GenerateOptions {
  /** Position in a run, 1 = first (default). */
  level?: number;
  /** Level type; defaults to the run's pacing for `level` (levelTypeFor). */
  type?: LevelType;
  /** Run difficulty: more or fewer enemies and less or more health (normal by default). */
  difficulty?: Difficulty;
}

export function generate(seed: string, options: GenerateOptions = {}): MapData {
  return generateDetailed(seed, options).map;
}

export function generateDetailed(seed: string, options: GenerateOptions = {}): Generated {
  const level = Math.max(1, Math.floor(options.level ?? 1));
  const profile = LEVEL_PROFILES[options.type ?? levelTypeFor(level)];
  const rng = new Rng(seed);
  let attempts = 0;
  const failures: Record<LayoutFailure, number> = { placement: 0, route: 0 };
  for (let m = 0; m < MISSION_TRIES; m++) {
    const mission = generateMission(rng.fork(m === 0 ? 'mission' : `mission/${m}`), profile);
    for (let l = 0; l < LAYOUT_TRIES; l++) {
      attempts++;
      const layout = embedMission(mission, rng.fork(`layout/${m}/${l}`), profile.roomSize);
      if (typeof layout === 'string') {
        failures[layout]++;
        continue;
      }
      return { ...emit(seed, mission, layout, rng, level, profile, options.difficulty ?? 'normal'), mission, layout, attempts, failures, type: profile.type };
    }
  }
  throw new Error(`seed ${seed}: no layout after ${attempts} attempts`);
}

/**
 * Storey per mission node, from its progress along the critical path: an ascent climbs from the
 * start (storey 0) to the gate, boss and exit at the top; a descent is the same, upside down; a
 * compound stays on one storey. The start and its neighbours share a storey. Fewer storeys when a connection would otherwise climb more than
 * MAX_STOREY_JUMP. Branches share their host's progress, so key and secret connections never
 * change storey.
 */
function assignStoreys(mission: Mission, rng: Rng, profile: LevelProfile): number[] {
  // The start and every room next to it share the start's storey (nothing arrives at the start by
  // lift, drop or bridge): progress up to the farthest of its neighbours flattens to 0, and the
  // climb (or fall) spreads over the rest.
  const start = mission.nodes.find((n) => n.kind === 'start')!.id;
  const near = Math.max(0, ...mission.edges.flatMap((e) => (e.a === start ? [e.b] : e.b === start ? [e.a] : [])).map((id) => mission.nodes[id]!.progress ?? 0));
  const progress = (p: number) => (near >= 1 ? 0 : Math.max(0, (p - near) / (1 - near)));
  const at = (count: number) => mission.nodes.map((n) => Math.round(progress(n.progress ?? 0) * (count - 1)));
  const steep = (st: number[]) => mission.edges.some((e) => Math.abs(st[e.a]! - st[e.b]!) > MAX_STOREY_JUMP);
  let count = rng.int(profile.storeys[0], profile.storeys[1]);
  let storeys = at(count);
  while (count > 1 && steep(storeys)) storeys = at(--count);
  return profile.type === 'descent' ? storeys.map((st) => count - 1 - st) : storeys;
}

const DOOR_KIND: Record<MissionDoor, DoorKind> = { open: DoorKind.None, auto: DoorKind.Auto, key: DoorKind.Key, secret: DoorKind.Secret };
/** Rooms a door belongs next to: it guards them. */
const GUARDED: readonly RoomKind[] = ['miniboss', 'boss', 'loot', 'exit'];

type Emitted = Pick<Generated, 'map' | 'designs' | 'storeys' | 'drops' | 'atriums' | 'bridges'>;

function emit(seed: string, mission: Mission, layout: Layout, rng: Rng, level: number, profile: LevelProfile, difficulty: Difficulty): Emitted {
  const C = CELL_SIZE;
  const deco = rng.fork('deco');
  const theme = rng.fork('theme');
  const rooms = rng.fork('rooms');
  const storeys = assignStoreys(mission, rng.fork('storeys'), profile);
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

  /** For a corridor one storey between its rooms: its lower and upper room. */
  const oneStorey = (ci: number): { lower: number; upper: number } | undefined => {
    const e = mission.edges[layout.corridors[ci]!.edge]!;
    if (Math.abs(floorOf(e.a) - floorOf(e.b)) !== STOREY_HEIGHT) return undefined;
    return floorOf(e.a) < floorOf(e.b) ? { lower: e.a, upper: e.b } : { lower: e.b, upper: e.a };
  };

  // Atriums: ordinary rooms with a neighbour a storey up become tall rooms ringed by a catwalk at
  // that storey. Corridors from above arrive on the catwalk, corridors level with the room pass
  // under it, and a lift in an inner corner joins them.
  const atriumRng = rng.fork('atriums');
  const atriums = new Set<number>();
  mission.nodes.forEach((node, id) => {
    const r = layout.rooms[id]!;
    if (node.kind !== 'room' || r.x1 - r.x0 < ATRIUM_MIN_SIZE || r.y1 - r.y0 < ATRIUM_MIN_SIZE) return;
    if (!layout.corridors.some((_, ci) => oneStorey(ci)?.lower === id)) return;
    if (atriumRng.chance(profile.atriumChance)) atriums.add(id);
  });

  // Drops: a corridor down one storey may run at the upper floor and end high in the lower room's
  // wall: a ledge the player jumps from and cannot climb back to. Each is kept only if the level
  // still cannot strand the player (progress.ts); otherwise that connection keeps its lift.
  const dropRng = rng.fork('drops');
  const oneWay = new Map<number, number>(); // mission edge → the room it can only be left from
  const drops = new Set<number>(); // by corridor index
  const landings = new Set<number>(); // rooms a drop lands in
  layout.corridors.forEach((c, ci) => {
    const pair = oneStorey(ci);
    if (!pair || !DROP_INTO.includes(mission.nodes[pair.lower]!.kind) || atriums.has(pair.lower)) return;
    if (!dropRng.chance(profile.dropChance)) return;
    oneWay.set(c.edge, pair.upper);
    if (strandsPlayer(mission, oneWay)) {
      oneWay.delete(c.edge);
      return;
    }
    drops.add(ci);
    landings.add(pair.lower);
  });

  // Bridges: some corridors between storeys arrive at the upper floor and run on into the lower
  // room as a catwalk, ending in a lift down to its floor. Storeys then truly overlap: the room
  // below stays usable under the catwalk. One per room, in ordinary rooms deep enough for it.
  const bridgeRng = rng.fork('bridges');
  const bridges = new Map<number, Bridge>(); // by corridor index
  const bridgeRoom = new Map<number, Bridge>(); // by room
  layout.corridors.forEach((c, ci) => {
    const e = mission.edges[c.edge]!;
    const pair = oneStorey(ci);
    if (!pair || drops.has(ci) || !bridgeRng.chance(profile.bridgeChance)) return;
    const lower = pair.lower;
    if (mission.nodes[lower]!.kind !== 'room' || bridgeRoom.has(lower) || atriums.has(lower) || landings.has(lower)) return;
    const r = layout.rooms[lower]!;
    const [dx, dy] = c.cells[lower === e.a ? 0 : c.cells.length - 1]!;
    const h = [0, 1, 2, 3].find((k) => inRoom(r, dx + HEADING_DX[k as 0]!, dy + HEADING_DY[k as 0]!));
    if (h === undefined) return;
    const run: [number, number][] = [];
    for (let k = 1; inRoom(r, dx + HEADING_DX[h as 0]! * k, dy + HEADING_DY[h as 0]! * k); k++) run.push([dx + HEADING_DX[h as 0]! * k, dy + HEADING_DY[h as 0]! * k]);
    const n = Math.min(run.length - 1, BRIDGE_MAX + 1);
    if (n < 3) return;
    const lift = run[n - 1]!;
    // The lift must not sit next to another doorway.
    const nearDoorway = doorways[lower]!.some(([x, y]) => Math.abs(x - lift[0]) + Math.abs(y - lift[1]) <= 1);
    if (nearDoorway) return;
    const bridge = { room: lower, catwalk: run.slice(0, n - 1), lift, high: Math.max(floorOf(e.a), floorOf(e.b)) };
    bridges.set(ci, bridge);
    bridgeRoom.set(lower, bridge);
  });

  // Corridors that run at their upper room's floor all the way: bridges, drops, and those arriving
  // on an atrium's catwalk. Their lower room must be tall enough to take them.
  const raised = (ci: number) => {
    const pair = oneStorey(ci);
    return bridges.has(ci) || drops.has(ci) || (pair !== undefined && atriums.has(pair.lower));
  };
  const entryHeight = mission.nodes.map(() => 0);
  layout.corridors.forEach((_, ci) => {
    const pair = oneStorey(ci);
    if (pair && raised(ci)) entryHeight[pair.lower] = Math.max(entryHeight[pair.lower]!, floorOf(pair.upper) - floorOf(pair.lower) + CORRIDOR_HEIGHT);
  });

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
    const bridge = bridgeRoom.get(id);
    const atrium = atriums.has(id);
    const design = bridge ? plainDesign(w, h) : atrium ? atriumDesign(w, h, STOREY_HEIGHT) : designRoom(node.kind, w, h, rooms);
    // A room entered from a storey up (a bridge, a drop, an atrium's catwalk) is tall enough for
    // that corridor's opening; an atrium towers a little higher still.
    const minHeight = Math.max(
      node.kind === 'boss' ? 224 : node.kind === 'miniboss' ? 192 : 128,
      design.maxRise + ROOM_HEADROOM,
      entryHeight[id]! + (atrium ? ATRIUM_EXTRA_HEIGHT : 0),
    );
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

  // Bridge catwalks and lifts over the room cells (the room kept its spec for the ceiling height).
  for (const bridge of bridges.values()) {
    const room = layout.rooms[bridge.room]!;
    const floor = floorOf(bridge.room);
    const roomSpec = plan.specs[plan.get(room.x0, room.y0)!]!;
    const catwalk = plan.spec({
      ...roomSpec,
      slab: { bottom: bridge.high - CATWALK_THICKNESS, top: bridge.high, topTex: T.Grate, bottomTex: T.Metal, sideTex: T.Metal },
    });
    for (const [x, y] of bridge.catwalk) plan.set(x, y, catwalk);
    plan.set(bridge.lift[0], bridge.lift[1], plan.spec({
      floor, ceil: roomSpec.ceil, light: 176, floorTex: T.Lift, ceilTex: T.Ceiling, wallTex: T.Metal, special: SPECIAL_LIFT, tag: bridge.high,
    }));
  }

  // Atrium lifts, over the placeholder cell in the inner corner, up to the catwalk.
  for (const id of atriums) {
    const room = layout.rooms[id]!;
    const w = room.x1 - room.x0;
    const cell = designs[id]!.cells.indexOf(ATRIUM_LIFT);
    const [lx, ly] = [room.x0 + (cell % w), room.y0 + Math.floor(cell / w)];
    const roomSpec = plan.specs[plan.get(room.x0, room.y0)!]!;
    plan.set(lx, ly, plan.spec({
      floor: floorOf(id), ceil: roomSpec.ceil, light: 176, floorTex: T.Lift, ceilTex: T.Ceiling, wallTex: T.Metal, special: SPECIAL_LIFT, tag: floorOf(id) + STOREY_HEIGHT,
    }));
  }

  // Population: enemies and health, balanced by level and depth (population.ts). Nothing on a
  // bridge's catwalk or lift (atrium lifts and catwalks are outside the base floor it uses).
  const occupied = new Set(things.map(([, x, y]) => `${x},${y}`));
  for (const bridge of bridges.values()) for (const [x, y] of [...bridge.catwalk, bridge.lift]) occupied.add(`${x},${y}`);
  const nearDoor = new Set<string>();
  doorways.forEach((list) => list.forEach(([x, y, h]) => nearDoor.add(`${x - HEADING_DX[h as 0]},${y - HEADING_DY[h as 0]}`)));
  things.push(...populate({ mission, layout, designs, occupied, nearDoor, rng: rng.fork('population'), level, difficulty: DIFFICULTY[difficulty] }));

  layout.corridors.forEach((c, ci) => {
    const edge = mission.edges[c.edge]!;
    const secret = secretId.get(edge.a) ?? secretId.get(edge.b);
    // A corridor between storeys runs at the lower floor and ends in a lift up to the upper room;
    // a raised one (bridge, drop, atrium entry) runs at the upper floor instead.
    const up = raised(ci);
    const high = Math.max(floorOf(edge.a), floorOf(edge.b));
    const low = up ? high : Math.min(floorOf(edge.a), floorOf(edge.b));
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
    // storeys (only ever an ordinary one) it goes at the lower end, if the lift leaves room; on a
    // raised one there too, so it opens onto the ledge, the catwalk or the atrium ring.
    const kind = DOOR_KIND[edge.door];
    if (kind === DoorKind.None || (high > low && c.cells.length < 2)) return;
    const atA =
      high > low || up
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
      wallTex: kind === DoorKind.Secret ? T.Metal : T.DoorFrame,
      special: kind | (secret === undefined ? 0 : SPECIAL_SECRET_AREA),
      tag: secret ?? edge.key ?? 0,
    }));
  });

  const b = new MapBuilder();
  emitCellPlan(b, plan, C);
  for (const [type, x, y, angle, flags] of things) b.thing(type, (x + 0.5) * C, (y + 0.5) * C, angle, flags ?? 0);
  // The theme picks the texture set's colours; its own stream, so it never shifts other choices.
  const style = rng.fork('style').pick(THEME_NAMES);
  return {
    // Normal maps record no difficulty, so they stay exactly what they were before difficulties.
    map: b.build({ name: `gen-${seed}`, seed, generatorVersion: GENERATOR_VERSION, theme: style, level, levelType: profile.type, ...(difficulty === 'normal' ? {} : { difficulty }) }),
    designs,
    storeys,
    drops: drops.size,
    atriums: atriums.size,
    bridges: bridges.size,
  };
}
