import earcut from 'earcut';
import { BaseTex, DoorKind, SectorLocator, ThingType, doorKindOf, doorSectors, keyOfThing, sectorPolygons, type MapData, type Side } from '@proc-fps/core';
import type { VertexLayout } from './backend.js';

/** pos(3) uv(2) light(1) tex(1) mover(1) move(1) slide(1) */
export const LEVEL_FLOATS_PER_VERTEX = 10;
export const LEVEL_LAYOUT: VertexLayout = {
  stride: LEVEL_FLOATS_PER_VERTEX * 4,
  attributes: [
    { name: 'aPos', components: 3, offset: 0 },
    { name: 'aUV', components: 2, offset: 12 },
    { name: 'aLight', components: 1, offset: 20 },
    { name: 'aTex', components: 1, offset: 24 },
    { name: 'aMover', components: 1, offset: 28 },
    { name: 'aMove', components: 1, offset: 32 },
    { name: 'aSlide', components: 1, offset: 36 },
  ],
};

export const TEX_SCALE = 1 / 64;

/**
 * Movers: geometry the static mesh shifts down by a per-frame offset (a uniform array).
 * Mover ids are door ids first, then pickups (keys and health) in thing order. A door's offset is
 * how far its ceiling sits below the open height; a taken pickup's offset sinks its marker out of view.
 */
export const MAX_MOVERS = 64;
/** Offset that hides a taken pickup: far below the floor and past the far plane. */
export const HIDDEN_OFFSET = 1e5;

const KEY_MARKER_SIZE = 10;
const KEY_MARKER_HEIGHT = 32;

/** Vertex movement: which mover, whether position follows it, whether the texture slides with it. */
interface Motion {
  mover: number;
  move: number;
  slide: number;
}
const STILL: Motion = { mover: -1, move: 0, slide: 0 };

export interface SectorRange {
  first: number;
  count: number;
}

export interface LevelMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  /**
   * Index range per sector (floor, ceiling and the walls facing into it),
   * contiguous so portal culling can draw only visible sectors.
   */
  sectors: SectorRange[];
  /** Mover counts: doors, then pickups. */
  doors: number;
  pickups: number;
}

/** Pure function: map → GPU-ready geometry. Runs in Node for tests. */
export function buildLevelMesh(map: MapData): LevelMesh {
  const perSector = map.sectors.map(() => ({ v: [] as number[], i: [] as number[] }));
  const light = (s: number) => map.sectors[s]!.light / 255;
  const doors = doorSectors(map);
  if (doors.length > MAX_MOVERS) throw new Error(`${doors.length} doors exceed MAX_MOVERS`);
  const doorOf = new Map(doors.map((s, i) => [s, i]));
  /** Panel texture seen from `from`: a secret door wears that side's own wall texture. */
  const doorTex = (s: number, from: Side) => {
    const sec = map.sectors[s]!;
    const kind = doorKindOf(sec);
    if (kind === DoorKind.Secret) return from.upper || from.middle || from.lower;
    return kind === DoorKind.Key ? BaseTex.DoorKey + sec.tag : BaseTex.Door;
  };

  const pushVertex = (s: number, x: number, h: number, y: number, u: number, v: number, tex: number, m: Motion = STILL, lit = light(s)): number => {
    const bucket = perSector[s]!;
    const idx = bucket.v.length / LEVEL_FLOATS_PER_VERTEX;
    // World: X = map.x, Y = height, Z = -map.y
    bucket.v.push(x, h, -y, u, v, lit, tex, m.mover + 1, m.move, m.slide);
    return idx;
  };

  // Floors and ceilings.
  const polys = sectorPolygons(map);
  polys.forEach((list, s) => {
    const sec = map.sectors[s]!;
    for (const poly of list) {
      const loops = [poly.outer, ...poly.holes];
      const flat: number[] = [];
      const holeStarts: number[] = [];
      const ids: number[] = [];
      for (const [li, loop] of loops.entries()) {
        if (li > 0) holeStarts.push(ids.length);
        for (const vi of loop) {
          const p = map.vertices[vi]!;
          flat.push(p.x, p.y);
          ids.push(vi);
        }
      }
      const tris = earcut(flat, holeStarts.length ? holeStarts : undefined, 2);
      const door = doorOf.get(s);
      const planes: [number, number, Motion][] = [
        [sec.floor, sec.floorTex, STILL],
        // A door's ceiling is the moving slab.
        [sec.ceil, sec.ceilTex, door === undefined ? STILL : { mover: door, move: 1, slide: 0 }],
      ];
      for (const [h, tex, m] of planes) {
        const base = ids.map((vi) => {
          const p = map.vertices[vi]!;
          return pushVertex(s, p.x, h, p.y, p.x * TEX_SCALE, p.y * TEX_SCALE, tex, m);
        });
        for (const t of tris) perSector[s]!.i.push(base[t]!);
      }
    }
  });

  // Walls. Face culling is off in M1, so each quad is emitted once, owned by the
  // sector it is visible from.
  const quad = (
    s: number, ax: number, ay: number, bx: number, by: number, lo: number, hi: number, tex: number,
    bottom = STILL, top = STILL, always = false,
  ) => {
    if (hi <= lo && !always) return;
    const len = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2) * TEX_SCALE;
    const a0 = pushVertex(s, ax, lo, ay, 0, lo * TEX_SCALE, tex, bottom);
    const b0 = pushVertex(s, bx, lo, by, len, lo * TEX_SCALE, tex, bottom);
    const b1 = pushVertex(s, bx, hi, by, len, hi * TEX_SCALE, tex, top);
    const a1 = pushVertex(s, ax, hi, ay, 0, hi * TEX_SCALE, tex, top);
    perSector[s]!.i.push(a0, b0, b1, a0, b1, a1);
  };

  for (const ld of map.linedefs) {
    const a = map.vertices[ld.v1]!;
    const b = map.vertices[ld.v2]!;
    const F = map.sectors[ld.front.sector]!;
    if (!ld.back) {
      // Inside a door cell the walls' tops follow the lowering ceiling.
      const door = doorOf.get(ld.front.sector);
      const top = door === undefined ? STILL : { mover: door, move: 1, slide: 0 };
      quad(ld.front.sector, a.x, a.y, b.x, b.y, F.floor, F.ceil, ld.front.middle || ld.front.lower, STILL, top);
      continue;
    }
    const B = map.sectors[ld.back.sector]!;
    // Door panel, seen from the neighbour: hangs from the door's open ceiling and slides down to its floor.
    for (const [doorSide, other] of [
      [ld.front, ld.back],
      [ld.back, ld.front],
    ] as const) {
      const door = doorOf.get(doorSide.sector);
      if (door === undefined || doorOf.has(other.sector)) continue;
      const D = map.sectors[doorSide.sector]!;
      const bottom = { mover: door, move: 1, slide: 1 };
      const top = { mover: door, move: 0, slide: 1 };
      quad(other.sector, a.x, a.y, b.x, b.y, D.ceil, D.ceil, doorTex(doorSide.sector, other), bottom, top, true);
    }
    if (F.floor !== B.floor) {
      const side: Side = F.floor < B.floor ? ld.front : ld.back;
      quad(side.sector, a.x, a.y, b.x, b.y, Math.min(F.floor, B.floor), Math.max(F.floor, B.floor), side.lower);
    }
    if (F.ceil !== B.ceil) {
      const side: Side = F.ceil > B.ceil ? ld.front : ld.back;
      quad(side.sector, a.x, a.y, b.x, b.y, Math.min(F.ceil, B.ceil), Math.max(F.ceil, B.ceil), side.upper);
    }
    // Middle textures on two-sided lines (grates, windows) need alpha: later.
  }

  // Pickups: a small diamond (a key) or box (health) hovering over the floor, sunk out of view once taken.
  const locator = new SectorLocator(map);
  let pickups = 0;
  for (const t of map.things) {
    const key = keyOfThing(t.type);
    if (key < 0 && t.type !== ThingType.Health) continue;
    const s = locator.locate(t.x, t.y);
    const m = { mover: doors.length + pickups++, move: 1, slide: 0 };
    if (s < 0 || m.mover >= MAX_MOVERS) continue;
    const z = map.sectors[s]!.floor + KEY_MARKER_HEIGHT;
    const r = KEY_MARKER_SIZE;
    const tex = key >= 0 ? BaseTex.Key + key : BaseTex.Health;
    const at = (dx: number, dy: number, dz: number) =>
      pushVertex(s, t.x + dx, z + dz, t.y + dy, 0.5 + dx / (2 * r), 0.5 + dz / (2 * r), tex, m, 1);
    const top = at(0, 0, r * 1.4);
    const bot = at(0, 0, -r * 1.4);
    const ring = [at(r, 0, 0), at(0, r, 0), at(-r, 0, 0), at(0, -r, 0)];
    for (let k = 0; k < 4; k++) perSector[s]!.i.push(top, ring[k]!, ring[(k + 1) % 4]!, bot, ring[(k + 1) % 4]!, ring[k]!);
  }

  // Concatenate buckets, rebasing indices.
  const totalV = perSector.reduce((n, b) => n + b.v.length, 0);
  const totalI = perSector.reduce((n, b) => n + b.i.length, 0);
  const vertices = new Float32Array(totalV);
  const indices = new Uint32Array(totalI);
  const sectors: SectorRange[] = [];
  let vo = 0;
  let io = 0;
  for (const b of perSector) {
    vertices.set(b.v, vo);
    const baseVertex = vo / LEVEL_FLOATS_PER_VERTEX;
    for (let k = 0; k < b.i.length; k++) indices[io + k] = b.i[k]! + baseVertex;
    sectors.push({ first: io, count: b.i.length });
    vo += b.v.length;
    io += b.i.length;
  }
  return { vertices, indices, sectors, doors: doors.length, pickups };
}
