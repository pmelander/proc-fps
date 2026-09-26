import earcut from 'earcut';
import { sectorPolygons, type MapData, type Side } from '@proc-fps/core';
import type { VertexLayout } from './backend.js';

/** pos(3) uv(2) light(1) tex(1) */
export const LEVEL_FLOATS_PER_VERTEX = 7;
export const LEVEL_LAYOUT: VertexLayout = {
  stride: LEVEL_FLOATS_PER_VERTEX * 4,
  attributes: [
    { name: 'aPos', components: 3, offset: 0 },
    { name: 'aUV', components: 2, offset: 12 },
    { name: 'aLight', components: 1, offset: 20 },
    { name: 'aTex', components: 1, offset: 24 },
  ],
};

const TEX_SCALE = 1 / 64;

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
}

/** Pure function: map → GPU-ready geometry. Runs in Node for tests. */
export function buildLevelMesh(map: MapData): LevelMesh {
  const perSector = map.sectors.map(() => ({ v: [] as number[], i: [] as number[] }));
  const light = (s: number) => map.sectors[s]!.light / 255;

  const pushVertex = (s: number, x: number, h: number, y: number, u: number, v: number, tex: number): number => {
    const bucket = perSector[s]!;
    const idx = bucket.v.length / LEVEL_FLOATS_PER_VERTEX;
    // World: X = map.x, Y = height, Z = -map.y
    bucket.v.push(x, h, -y, u, v, light(s), tex);
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
      for (const [h, tex] of [
        [sec.floor, sec.floorTex],
        [sec.ceil, sec.ceilTex],
      ] as const) {
        const base = ids.map((vi) => {
          const p = map.vertices[vi]!;
          return pushVertex(s, p.x, h, p.y, p.x * TEX_SCALE, p.y * TEX_SCALE, tex);
        });
        for (const t of tris) perSector[s]!.i.push(base[t]!);
      }
    }
  });

  // Walls. Face culling is off in M1, so each quad is emitted once, owned by the
  // sector it is visible from.
  const quad = (s: number, ax: number, ay: number, bx: number, by: number, lo: number, hi: number, tex: number) => {
    if (hi <= lo) return;
    const len = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2) * TEX_SCALE;
    const a0 = pushVertex(s, ax, lo, ay, 0, lo * TEX_SCALE, tex);
    const b0 = pushVertex(s, bx, lo, by, len, lo * TEX_SCALE, tex);
    const b1 = pushVertex(s, bx, hi, by, len, hi * TEX_SCALE, tex);
    const a1 = pushVertex(s, ax, hi, ay, 0, hi * TEX_SCALE, tex);
    perSector[s]!.i.push(a0, b0, b1, a0, b1, a1);
  };

  for (const ld of map.linedefs) {
    const a = map.vertices[ld.v1]!;
    const b = map.vertices[ld.v2]!;
    const F = map.sectors[ld.front.sector]!;
    if (!ld.back) {
      quad(ld.front.sector, a.x, a.y, b.x, b.y, F.floor, F.ceil, ld.front.middle || ld.front.lower);
      continue;
    }
    const B = map.sectors[ld.back.sector]!;
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
  return { vertices, indices, sectors };
}
