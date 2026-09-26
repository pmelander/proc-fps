import type { MapBuilder, Point, SectorSpec } from './builder.js';

/**
 * Cell plan → sectors. A plan gives each occupied cell a sector spec; every 4-connected
 * group of cells with the same spec becomes one sector. Outlines keep a vertex only where
 * the boundary turns or where the owner across it changes, so neighbouring sectors always
 * share identical edges and callers never place T-junction splits by hand.
 *
 * Constraint: no pinch points. A group may not touch itself only diagonally at a vertex,
 * because loop chaining (`chainLoops`) cannot resolve such a vertex. `emitCellPlan` throws
 * naming the vertex, so generators design templates to avoid the pattern.
 */
export class CellPlan {
  readonly specs: SectorSpec[] = [];
  private readonly cells = new Map<number, number>();

  /** Registers a spec; returns its index for `set`. */
  spec(s: SectorSpec): number {
    return this.specs.push(s) - 1;
  }

  set(x: number, y: number, spec: number): void {
    this.cells.set(cellKey(x, y), spec);
  }

  get(x: number, y: number): number | undefined {
    return this.cells.get(cellKey(x, y));
  }

  /** Occupied cells in insertion order, as [x, y, spec]. */
  *entries(): IterableIterator<readonly [number, number, number]> {
    for (const [k, s] of this.cells) yield [...cellOfKey(k), s] as const;
  }
}

const KEY_OFFSET = 1 << 14;
const KEY_SPAN = 1 << 15;
const cellKey = (x: number, y: number) => (x + KEY_OFFSET) * KEY_SPAN + (y + KEY_OFFSET);
const cellOfKey = (k: number): [number, number] => [Math.floor(k / KEY_SPAN) - KEY_OFFSET, (k % KEY_SPAN) - KEY_OFFSET];

/** Unit boundary edge of a group, walked with the group on the left. */
interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Group across the edge, -1 for solid. */
  across: number;
}

// Per side of a cell (S, E, N, W): the edge's start corner, end corner and the neighbour offset.
const SIDES = [
  { from: [0, 0], to: [1, 0], n: [0, -1] },
  { from: [1, 0], to: [1, 1], n: [1, 0] },
  { from: [1, 1], to: [0, 1], n: [0, 1] },
  { from: [0, 1], to: [0, 0], n: [-1, 0] },
] as const;

/** Adds one sector per group of the plan to the builder. */
export function emitCellPlan(b: MapBuilder, plan: CellPlan, cellSize: number): void {
  // Groups: flood fill over same-spec 4-neighbours.
  const group = new Map<number, number>();
  const groups: { spec: number; cells: [number, number][] }[] = [];
  for (const [x, y, spec] of plan.entries()) {
    if (group.has(cellKey(x, y))) continue;
    const id = groups.length;
    const cells: [number, number][] = [[x, y]];
    group.set(cellKey(x, y), id);
    for (let i = 0; i < cells.length; i++) {
      const [cx, cy] = cells[i]!;
      for (const { n } of SIDES) {
        const nx = cx + n[0];
        const ny = cy + n[1];
        const k = cellKey(nx, ny);
        if (!group.has(k) && plan.get(nx, ny) === spec) {
          group.set(k, id);
          cells.push([nx, ny]);
        }
      }
    }
    groups.push({ spec, cells });
  }
  const groupAt = (x: number, y: number) => group.get(cellKey(x, y)) ?? -1;

  groups.forEach((g, id) => {
    const out = new Map<number, Edge>();
    for (const [x, y] of g.cells) {
      for (const { from, to, n } of SIDES) {
        const across = groupAt(x + n[0], y + n[1]);
        if (across === id) continue;
        const e = { x0: x + from[0], y0: y + from[1], x1: x + to[0], y1: y + to[1], across };
        const k = cellKey(e.x0, e.y0);
        if (out.has(k)) throw new Error(`cell plan: group ${id} pinches at vertex (${e.x0}, ${e.y0})`);
        out.set(k, e);
      }
    }
    const loops: Point[][] = [];
    const used = new Set<number>();
    for (const [startKey, first] of out) {
      if (used.has(startKey)) continue;
      const edges: Edge[] = [];
      for (let e = first; ; ) {
        used.add(cellKey(e.x0, e.y0));
        edges.push(e);
        const next = out.get(cellKey(e.x1, e.y1))!;
        if (next === first) break;
        e = next;
      }
      // Keep a vertex where direction or the owner across changes.
      const pts: Point[] = [];
      edges.forEach((e, i) => {
        const p = edges[(i + edges.length - 1) % edges.length]!;
        const turn = e.x1 - e.x0 !== p.x1 - p.x0 || e.y1 - e.y0 !== p.y1 - p.y0;
        if (turn || e.across !== p.across) pts.push([e.x0 * cellSize, e.y0 * cellSize]);
      });
      loops.push(pts);
    }
    const outer = loops.filter((l) => area(l) > 0);
    if (outer.length !== 1) throw new Error(`cell plan: group ${id} has ${outer.length} outer loops`);
    b.addSector(plan.specs[g.spec]!, outer[0]!, loops.filter((l) => area(l) < 0));
  });
}

function area(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
