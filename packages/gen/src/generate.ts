import {
  BaseTex as T,
  CELL_SIZE,
  CellPlan,
  DoorKind,
  HEADING_DX,
  HEADING_DY,
  MapBuilder,
  Rng,
  SPECIAL_SECRET_AREA,
  ThingType,
  emitCellPlan,
  keyThing,
  type MapData,
  type TextureId,
} from '@proc-fps/core';
import { embedMission, type CellRect, type Layout, type LayoutFailure } from './layout.js';
import { generateMission, type DoorKind as MissionDoor, type Mission, type RoomKind } from './mission.js';
import { designRoom, type RoomDesign } from './rooms.js';

/**
 * Bump on ANY change that alters output for an existing seed.
 * seed + GENERATOR_VERSION must always reproduce the same map.
 */
export const GENERATOR_VERSION = '0.6.0';

/** Layout attempts per mission, and missions tried, before giving up on a seed. */
const LAYOUT_TRIES = 8;
const MISSION_TRIES = 8;
/** One storey for now (flat floor plans); storeys joined by elevators come later. */
const STOREY_FLOOR = 0;
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
 * M2 pipeline: mission graph → grid embedding → room templates → cell plan → sectors,
 * with doors in corridor cells, keys in their rooms, and secret areas marked.
 */
export function generate(seed: string): MapData {
  return generateDetailed(seed).map;
}

export function generateDetailed(seed: string): Generated {
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
      return { ...emit(seed, mission, layout, rng), mission, layout, attempts, failures };
    }
  }
  throw new Error(`seed ${seed}: no layout after ${attempts} attempts`);
}

const DOOR_KIND: Record<MissionDoor, DoorKind> = { open: DoorKind.None, auto: DoorKind.Auto, key: DoorKind.Key, secret: DoorKind.Secret };
/** Rooms a door belongs next to: it guards them. */
const GUARDED: readonly RoomKind[] = ['miniboss', 'boss', 'loot'];

function emit(seed: string, mission: Mission, layout: Layout, rng: Rng): { map: MapData; designs: RoomDesign[] } {
  const C = CELL_SIZE;
  const deco = rng.fork('deco');
  const theme = rng.fork('theme');
  const rooms = rng.fork('rooms');
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
  const things: [number, number, number, number][] = [];
  // Secret ids in node order; every sector of a secret carries its id (see SPECIAL_SECRET_AREA).
  const secretId = new Map(mission.nodes.filter((n) => n.kind === 'secret').map((n, i) => [n.id, i]));
  const secretArea = (id: number | undefined) => (id === undefined ? {} : { special: SPECIAL_SECRET_AREA, tag: id });

  const designs = mission.nodes.map((node, id) => {
    const r = layout.rooms[id]!;
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    const design = designRoom(node.kind, w, h, rooms);
    const minHeight = Math.max(node.kind === 'boss' ? 224 : node.kind === 'miniboss' ? 192 : 128, design.maxRise + ROOM_HEADROOM);
    const ceil = STOREY_FLOOR + Math.round(deco.range(minHeight, Math.max(minHeight, 288)) / 8) * 8;
    const light = node.kind === 'loot' ? 232 : Math.round(deco.range(96, 232) / 8) * 8;
    const floorTex = theme.pick([T.FloorTile, T.Slime, T.Tech]);
    const wallTex = theme.pick(wallSet);
    const specs = design.regions.map((reg) =>
      plan.spec({
        floor: STOREY_FLOOR + reg.rise,
        ceil,
        light: Math.max(0, Math.min(255, light + reg.lightDelta)),
        floorTex: reg.floorTex ?? floorTex,
        ceilTex: T.Ceiling,
        wallTex: reg.wallTex ?? wallTex,
        ...secretArea(secretId.get(id)),
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
    if (node.key !== undefined) {
      // On base floor, as near the centre as the template allows (the outer ring always is).
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

  for (const c of layout.corridors) {
    const edge = mission.edges[c.edge]!;
    const secret = secretId.get(edge.a) ?? secretId.get(edge.b);
    const spec = (floorTex: TextureId) =>
      plan.spec({ floor: STOREY_FLOOR, ceil: STOREY_FLOOR + CORRIDOR_HEIGHT, light: 144, floorTex, ceilTex: T.Ceiling, wallTex: T.Metal, ...secretArea(secret) });
    // Hazard stripes mark only a corridor's two ends, so at most 2 striped tiles ever touch.
    const ends = spec(T.Trim);
    const middle = spec(T.Tech);
    c.cells.forEach(([x, y], k) => plan.set(x, y, k === 0 || k === c.cells.length - 1 ? ends : middle));

    // The door goes in the corridor cell next to the room it guards (the b end otherwise). A
    // secret door goes at the other end, flush with the room it hides from.
    const kind = DOOR_KIND[edge.door];
    if (kind === DoorKind.None) continue;
    const atA =
      kind === DoorKind.Secret
        ? secretId.has(edge.b)
        : GUARDED.includes(mission.nodes[edge.a]!.kind) && !GUARDED.includes(mission.nodes[edge.b]!.kind);
    const [dx, dy] = c.cells[atA ? 0 : c.cells.length - 1]!;
    plan.set(dx, dy, plan.spec({
      floor: STOREY_FLOOR,
      ceil: STOREY_FLOOR + CORRIDOR_HEIGHT,
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
  for (const [type, x, y, angle] of things) b.thing(type, (x + 0.5) * C, (y + 0.5) * C, angle);
  return { map: b.build({ name: `gen-${seed}`, seed, generatorVersion: GENERATOR_VERSION, theme: 'base' }), designs };
}
