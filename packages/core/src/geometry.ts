import type { MapData } from './map.js';

/** A directed edge with its sector on the left. */
export interface DirectedEdge {
  from: number;
  to: number;
  line: number;
}

/** Outer loop (CCW) with the holes (CW) it contains. Vertex indices. */
export interface SectorPolygon {
  outer: number[];
  holes: number[][];
}

/** Directed boundary edges of every sector, sector on the left of each edge. */
export function sectorEdges(map: MapData): DirectedEdge[][] {
  const out: DirectedEdge[][] = map.sectors.map(() => []);
  map.linedefs.forEach((ld, i) => {
    const f = ld.front.sector;
    const b = ld.back?.sector;
    if (b === f) return; // self-referencing line: not a boundary
    out[f]?.push({ from: ld.v1, to: ld.v2, line: i });
    if (b !== undefined) out[b]?.push({ from: ld.v2, to: ld.v1, line: i });
  });
  return out;
}

export function signedArea(map: MapData, loop: readonly number[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = map.vertices[loop[i] as number]!;
    const q = map.vertices[loop[(i + 1) % loop.length] as number]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInLoop(map: MapData, loop: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = map.vertices[loop[i] as number]!;
    const b = map.vertices[loop[j] as number]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Chains a sector's directed edges into closed loops.
 * v0 limitation: when a vertex has several outgoing edges (loops touching at
 * a point) the first unused edge is taken. Generators must avoid pinch points.
 */
export function chainLoops(edges: readonly DirectedEdge[]): number[][] | Error {
  const byFrom = new Map<number, number[]>();
  edges.forEach((e, i) => {
    const list = byFrom.get(e.from);
    if (list) list.push(i);
    else byFrom.set(e.from, [i]);
  });
  const used = new Uint8Array(edges.length);
  const loops: number[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    const loop: number[] = [];
    let cur = start;
    for (;;) {
      used[cur] = 1;
      const e = edges[cur]!;
      loop.push(e.from);
      if (e.to === edges[start]!.from) break;
      const next = byFrom.get(e.to)?.find((i) => !used[i]);
      if (next === undefined) return new Error(`open loop at vertex ${e.to}`);
      cur = next;
    }
    loops.push(loop);
  }
  return loops;
}

/** Groups each sector's loops into outer boundaries with their holes. */
export function sectorPolygons(map: MapData): SectorPolygon[][] {
  return sectorEdges(map).map((edges, s) => {
    const loops = chainLoops(edges);
    if (loops instanceof Error) throw new Error(`sector ${s}: ${loops.message}`);
    const outers: SectorPolygon[] = [];
    const holes: number[][] = [];
    for (const l of loops) {
      if (signedArea(map, l) > 0) outers.push({ outer: l, holes: [] });
      else holes.push(l);
    }
    for (const h of holes) {
      const p = map.vertices[h[0] as number]!;
      // Smallest containing outer wins (handles nested islands).
      let best: SectorPolygon | undefined;
      let bestArea = Infinity;
      for (const o of outers) {
        const a = signedArea(map, o.outer);
        if (a < bestArea && pointInLoop(map, o.outer, p.x, p.y)) {
          best = o;
          bestArea = a;
        }
      }
      if (!best) throw new Error(`sector ${s}: hole not inside any outer loop`);
      best.holes.push(h);
    }
    return outers;
  });
}

/**
 * Point → sector lookup. Even-odd over the sector's boundary edges handles
 * holes for free. O(lines) per query — fine for M1; replace with a BSP or
 * uniform grid once maps grow (keep this as the reference for tests).
 */
export class SectorLocator {
  private readonly edges: DirectedEdge[][];

  constructor(private readonly map: MapData) {
    this.edges = sectorEdges(map);
  }

  locate(x: number, y: number): number {
    const v = this.map.vertices;
    for (let s = 0; s < this.edges.length; s++) {
      let inside = false;
      for (const e of this.edges[s]!) {
        const a = v[e.from]!;
        const b = v[e.to]!;
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) return s;
    }
    return -1;
  }
}
