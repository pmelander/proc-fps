import { HEADING_DX, HEADING_DY, type Rng } from '@proc-fps/core';
import type { Mission, RoomKind } from './mission.js';

/**
 * Grid embedding: places a mission graph's rooms as cell rectangles joined by corridors.
 *
 * Rooms are placed breadth-first from the start along a spanning tree, each joined to its
 * parent by a straight corridor. The remaining edges close the cycles and are routed
 * afterwards by a turn-penalised shortest path. Separation rule: a room or corridor never
 * comes within one cell (8-neighbourhood) of any structure it is not connected to, so
 * structures touch only at their doorways. That rules out accidental openings and
 * T-junctions the builder could not merge.
 *
 * Every connection has at least one corridor cell; its first cell is where a door will go.
 * The layout is flat: corridors never ramp and a loop can be any length. Storeys are heights the
 * generator gives rooms afterwards (lifts, drops, bridges and atriums join them); in plan they
 * never overlap, except where a catwalk carries a corridor over a room. Everything here is in
 * cell units.
 */

/** Half-open cell rectangle [x0, x1) × [y0, y1). */
export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type LayoutRoom = CellRect;

export interface LayoutCorridor {
  /** Index into `mission.edges`. */
  edge: number;
  /** Ordered from the edge's `a` room to its `b` room. */
  cells: (readonly [number, number])[];
}

export interface Layout {
  /** Indexed by mission node id. */
  rooms: LayoutRoom[];
  corridors: LayoutCorridor[];
}

const ROOM_SIZE: Record<RoomKind, readonly [number, number]> = {
  start: [3, 4],
  room: [3, 7],
  miniboss: [5, 7],
  boss: [6, 8],
  loot: [2, 3],
  secret: [2, 3],
  exit: [2, 3],
};
const TREE_CORRIDOR = [1, 4] as const;
const PLACEMENT_TRIES = 80;
/** Valid placements sampled before picking the one closest to its placed cycle neighbours (more when it has some). */
const PLACEMENT_CANDIDATES = 6;
const PLACEMENT_CANDIDATES_NEAR = 16;
const MAX_ROUTE_CELLS = 40;
const STEP_COST = 10;
const TURN_COST = 6;

type Cell = readonly [number, number];
/** Numeric cell key; generated maps stay far inside ±KEY_OFFSET cells. */
const KEY_OFFSET = 1 << 14;
const KEY_SPAN = 1 << 15;
const key = (x: number, y: number) => (x + KEY_OFFSET) * KEY_SPAN + (y + KEY_OFFSET);
const unkey = (k: number): Cell => [Math.floor(k / KEY_SPAN) - KEY_OFFSET, (k % KEY_SPAN) - KEY_OFFSET];

/** Cells along side `s` (0 E, 1 N, 2 W, 3 S) of a rect. */
function sideCells(r: CellRect, s: number): Cell[] {
  const out: Cell[] = [];
  if (s === 0 || s === 2) {
    const x = s === 0 ? r.x1 - 1 : r.x0;
    for (let y = r.y0; y < r.y1; y++) out.push([x, y]);
  } else {
    const y = s === 1 ? r.y1 - 1 : r.y0;
    for (let x = r.x0; x < r.x1; x++) out.push([x, y]);
  }
  return out;
}

const rectCells = (r: CellRect): Cell[] => {
  const out: Cell[] = [];
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) out.push([x, y]);
  return out;
};

const centre = (r: CellRect): Cell => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];

/** Why an attempt failed: no room placement was found, or a cycle corridor could not be routed. */
export type LayoutFailure = 'placement' | 'route';

/** Returns a failure reason when this attempt cannot embed the mission; the caller retries with another stream. */
export function embedMission(mission: Mission, rng: Rng, roomSize: readonly [number, number] = ROOM_SIZE.room): Layout | LayoutFailure {
  const n = mission.nodes.length;
  const owner = new Map<number, number>();
  const corridorOwner = (edge: number) => n + edge;
  const occupy = (cells: readonly Cell[], id: number) => cells.forEach(([x, y]) => owner.set(key(x, y), id));
  /** The cell and its 8 neighbours hold nothing but `allowed` owners. */
  const clear = (x: number, y: number, allowed: readonly number[]) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const o = owner.get(key(x + dx, y + dy));
        if (o !== undefined && !allowed.includes(o)) return false;
      }
    }
    return true;
  };

  const neighbours = (id: number) =>
    mission.edges.flatMap((e, i) => (e.a === id ? [{ other: e.b, edge: i }] : e.b === id ? [{ other: e.a, edge: i }] : []));

  // Spanning tree, breadth-first from the start.
  const start = mission.nodes.find((x) => x.kind === 'start')!.id;
  const parentEdge = new Array<number>(n).fill(-1);
  const order = [start];
  const seen = new Set([start]);
  for (let i = 0; i < order.length; i++) {
    for (const { other, edge } of neighbours(order[i]!)) {
      if (seen.has(other)) continue;
      seen.add(other);
      parentEdge[other] = edge;
      order.push(other);
    }
  }
  const treeEdges = new Set(parentEdge.filter((e) => e >= 0));

  const rooms: LayoutRoom[] = new Array(n);
  const corridors: LayoutCorridor[] = [];
  const size = (id: number) => {
    const kind = mission.nodes[id]!.kind;
    const [lo, hi] = kind === 'room' ? roomSize : ROOM_SIZE[kind];
    return [rng.int(lo, hi), rng.int(lo, hi)] as const;
  };

  const [sw, sh] = size(start);
  rooms[start] = { x0: 0, y0: 0, x1: sw, y1: sh };
  occupy(rectCells(rooms[start]), start);

  for (const id of order.slice(1)) {
    const edgeIndex = parentEdge[id]!;
    const edge = mission.edges[edgeIndex]!;
    const parentId = edge.a === id ? edge.b : edge.a;
    const parent = rooms[parentId]!;
    const cid = corridorOwner(edgeIndex);
    // Placed rooms this one must later reach through a cycle edge.
    const targets = neighbours(id)
      .filter(({ other, edge: e }) => !treeEdges.has(e) && rooms[other])
      .map(({ other }) => centre(rooms[other]!));

    type Candidate = { rect: CellRect; cells: Cell[]; score: number };
    const candidates: Candidate[] = [];
    for (let t = 0; t < PLACEMENT_TRIES && candidates.length < (targets.length ? PLACEMENT_CANDIDATES_NEAR : PLACEMENT_CANDIDATES); t++) {
      const s = rng.int(0, 3);
      const dx: number = HEADING_DX[s as 0];
      const dy: number = HEADING_DY[s as 0];
      const [px, py] = rng.pick(sideCells(parent, s));
      const len = rng.int(TREE_CORRIDOR[0], TREE_CORRIDOR[1]);
      const cells: Cell[] = [];
      for (let k = 0; k < len; k++) cells.push([px + dx * (k + 1), py + dy * (k + 1)]);
      const [ax, ay] = [px + dx * (len + 1), py + dy * (len + 1)];
      const [w, h] = size(id);
      let rect: CellRect;
      if (dx !== 0) {
        const y0 = ay - rng.int(0, h - 1);
        const x0 = dx > 0 ? ax : ax - w + 1;
        rect = { x0, y0, x1: x0 + w, y1: y0 + h };
      } else {
        const x0 = ax - rng.int(0, w - 1);
        const y0 = dy > 0 ? ay : ay - h + 1;
        rect = { x0, y0, x1: x0 + w, y1: y0 + h };
      }
      if (!cells.every(([x, y]) => clear(x, y, [parentId, id, cid]))) continue;
      // The new room may touch only its own corridor (the parent is at least one cell further away).
      if (!rectCells(rect).every(([x, y]) => clear(x, y, [cid]))) continue;
      const [cx, cy] = centre(rect);
      const score = targets.reduce((d, [tx, ty]) => d + Math.abs(tx - cx) + Math.abs(ty - cy), 0);
      candidates.push({ rect, cells, score });
    }
    if (!candidates.length) return 'placement';
    const best = candidates.reduce((a, b) => (b.score < a.score ? b : a));

    rooms[id] = best.rect;
    occupy(rectCells(best.rect), id);
    occupy(best.cells, cid);
    // Cells run parent → child; store them a → b.
    const cells = edge.a === parentId ? best.cells : [...best.cells].reverse();
    corridors.push({ edge: edgeIndex, cells });
  }

  // Close the cycles.
  for (let i = 0; i < mission.edges.length; i++) {
    if (treeEdges.has(i)) continue;
    const e = mission.edges[i]!;
    const cells = route(rooms[e.a]!, rooms[e.b]!, e.a, e.b, clear);
    if (!cells) return 'route';
    occupy(cells, corridorOwner(i));
    corridors.push({ edge: i, cells });
  }

  corridors.sort((p, q) => p.edge - q.edge);
  return { rooms, corridors };
}

/** Doorway cells just outside a room's sides that respect the separation rule. */
function ports(r: CellRect, allowed: readonly number[], clear: (x: number, y: number, allowed: readonly number[]) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (let s = 0; s < 4; s++) {
    for (const [x, y] of sideCells(r, s)) {
      const px = x + HEADING_DX[s as 0]!;
      const py = y + HEADING_DY[s as 0]!;
      if (clear(px, py, allowed)) out.set(key(px, py), s);
    }
  }
  return out;
}

/**
 * Cheapest corridor from a doorway of room a to a doorway of room b, penalising turns.
 * Interior cells must be clear of every structure; only the end cells may touch their rooms.
 */
function route(
  ra: CellRect,
  rb: CellRect,
  a: number,
  b: number,
  clear: (x: number, y: number, allowed: readonly number[]) => boolean,
): Cell[] | undefined {
  const starts = ports(ra, [a], clear);
  const goals = ports(rb, [b], clear);
  // Rooms two cells apart can share a single doorway cell.
  const sharedB = ports(rb, [a, b], clear);
  for (const [k, s] of ports(ra, [a, b], clear)) {
    if (!sharedB.has(k)) continue;
    starts.set(k, s);
    goals.set(k, sharedB.get(k)!);
  }

  const x0 = Math.min(ra.x0, rb.x0) - MAX_ROUTE_CELLS / 2;
  const y0 = Math.min(ra.y0, rb.y0) - MAX_ROUTE_CELLS / 2;
  const w = Math.max(ra.x1, rb.x1) + MAX_ROUTE_CELLS / 2 - x0;
  const h = Math.max(ra.y1, rb.y1) + MAX_ROUTE_CELLS / 2 - y0;
  const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
  const state = (x: number, y: number, d: number) => ((y - y0) * w + (x - x0)) * 4 + d;
  // Per cell, once: 1 = the separation rule forbids a corridor here (goal doorways excepted).
  const blocked = new Uint8Array(w * h);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) blocked[(y - y0) * w + (x - x0)] = goals.has(key(x, y)) || clear(x, y, []) ? 0 : 1;
  }
  const isGoal = new Uint8Array(w * h);
  for (const k of goals.keys()) {
    const [x, y] = unkey(k);
    if (inside(x, y)) isGoal[(y - y0) * w + (x - x0)] = 1;
  }

  const cost = new Float64Array(w * h * 4).fill(Infinity);
  const prev = new Int32Array(w * h * 4).fill(-1);
  const heap = new MinHeap();
  for (const [k, s] of starts) {
    const [x, y] = unkey(k);
    if (!inside(x, y)) continue;
    const st = state(x, y, s);
    cost[st] = STEP_COST;
    heap.push(STEP_COST, st);
  }

  while (heap.size) {
    const [c, st] = heap.pop();
    if (c !== cost[st]) continue;
    const d = st % 4;
    const ci = (st - d) / 4;
    const x = x0 + (ci % w);
    const y = y0 + Math.floor(ci / w);
    if (isGoal[ci]) return unwind(st, prev, x0, y0, w);
    if (c >= MAX_ROUTE_CELLS * STEP_COST) continue;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      const nx = x + HEADING_DX[nd as 0]!;
      const ny = y + HEADING_DY[nd as 0]!;
      if (!inside(nx, ny)) continue;
      if (blocked[(ny - y0) * w + (nx - x0)]) continue;
      const ns = state(nx, ny, nd);
      const nc = c + STEP_COST + (nd === d ? 0 : TURN_COST);
      if (nc < cost[ns]!) {
        cost[ns] = nc;
        prev[ns] = st;
        heap.push(nc, ns);
      }
    }
  }
  return undefined;
}

function unwind(st: number, prev: Int32Array, x0: number, y0: number, w: number): Cell[] {
  const cells: Cell[] = [];
  for (let s = st; s >= 0; s = prev[s]!) {
    const ci = (s - (s % 4)) / 4;
    cells.push([x0 + (ci % w), y0 + Math.floor(ci / w)]);
  }
  return cells.reverse();
}

/** Binary min-heap of (priority, value) pairs. */
class MinHeap {
  private readonly items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(priority: number, value: number): void {
    const a = this.items;
    a.push([priority, value]);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
