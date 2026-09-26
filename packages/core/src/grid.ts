import { CELL_SIZE, MAX_STEP, PLAYER_HEIGHT } from './constants.js';
import { SectorLocator } from './geometry.js';
import { LineFlags, isLift, liftFloorNear, type MapData } from './map.js';

/**
 * Cardinal headings: 0 = east (+x), 1 = north (+y), 2 = west, 3 = south.
 * Matches map angles: heading h ↔ h · 90°.
 */
export type Heading = 0 | 1 | 2 | 3;
export const HEADING_DX = [1, 0, -1, 0] as const;
export const HEADING_DY = [0, 1, 0, -1] as const;

/**
 * Gameplay grid derived from the sector map. Sectors stay the render/lighting
 * representation; the grid is the movement and AI truth. Derivation is only
 * valid for maps that pass `validateGridAlignment`.
 */
export class CellGrid {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  /** Sector per cell, -1 = solid. */
  readonly sector: Int32Array;
  /** Edge between (cx, cy) and (cx+1, cy) is blocked by an impassable line. */
  private readonly eastBlocked: Uint8Array;
  /** Edge between (cx, cy) and (cx, cy+1) is blocked by an impassable line. */
  private readonly northBlocked: Uint8Array;

  constructor(private readonly map: MapData, readonly cellSize = CELL_SIZE) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of map.vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    const cs = cellSize;
    this.originX = Math.floor(minX / cs) * cs;
    this.originY = Math.floor(minY / cs) * cs;
    this.width = Math.max(0, Math.ceil((maxX - this.originX) / cs));
    this.height = Math.max(0, Math.ceil((maxY - this.originY) / cs));
    const n = this.width * this.height;
    this.sector = new Int32Array(n).fill(-1);
    this.eastBlocked = new Uint8Array(n);
    this.northBlocked = new Uint8Array(n);

    const locator = new SectorLocator(map);
    for (let cy = 0; cy < this.height; cy++) {
      for (let cx = 0; cx < this.width; cx++) {
        const [x, y] = this.center(cx, cy);
        this.sector[cx + cy * this.width] = locator.locate(x, y);
      }
    }

    for (const ld of map.linedefs) {
      if (!(ld.flags & LineFlags.Impassable)) continue;
      const a = map.vertices[ld.v1]!;
      const b = map.vertices[ld.v2]!;
      if (a.x === b.x) {
        const cx = (a.x - this.originX) / cs - 1;
        for (let y = Math.min(a.y, b.y); y < Math.max(a.y, b.y); y += cs) {
          const cy = (y - this.originY) / cs;
          if (this.inBounds(cx, cy)) this.eastBlocked[cx + cy * this.width] = 1;
        }
      } else {
        const cy = (a.y - this.originY) / cs - 1;
        for (let x = Math.min(a.x, b.x); x < Math.max(a.x, b.x); x += cs) {
          const cx = (x - this.originX) / cs;
          if (this.inBounds(cx, cy)) this.northBlocked[cx + cy * this.width] = 1;
        }
      }
    }
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  sectorAt(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? this.sector[cx + cy * this.width]! : -1;
  }

  /** Walkable levels a cell can have: 0 = its floor, 1 = the top of its slab (a catwalk). */
  static readonly LEVELS = 2;

  /** How many levels the cell has: 0 (solid), 1, or 2 with a slab. */
  levels(cx: number, cy: number): number {
    const s = this.sectorAt(cx, cy);
    return s < 0 ? 0 : this.map.sectors[s]!.slab ? 2 : 1;
  }

  /** The floor and ceiling a mover on `level` stands between: under a slab, its underside is the ceiling. */
  span(cx: number, cy: number, level = 0): readonly [number, number] | undefined {
    const sec = this.map.sectors[this.sectorAt(cx, cy)];
    if (!sec) return undefined;
    if (!sec.slab) return level === 0 ? [sec.floor, sec.ceil] : undefined;
    return level === 0 ? [sec.floor, sec.slab.bottom] : level === 1 ? [sec.slab.top, sec.ceil] : undefined;
  }

  walkable(cx: number, cy: number, level = 0): boolean {
    const sp = this.span(cx, cy, level);
    return !!sp && sp[1] - sp[0] >= PLAYER_HEIGHT;
  }

  floorAt(cx: number, cy: number, level = 0): number {
    return this.span(cx, cy, level)?.[0] ?? 0;
  }

  cellOf(x: number, y: number): [number, number] {
    return [Math.floor((x - this.originX) / this.cellSize), Math.floor((y - this.originY) / this.cellSize)];
  }

  center(cx: number, cy: number): [number, number] {
    return [this.originX + (cx + 0.5) * this.cellSize, this.originY + (cy + 0.5) * this.cellSize];
  }

  /**
   * The level a mover on (ax, ay, level) lands on when it steps in direction `h`, or -1 if it
   * cannot. Same rules for player and AI: rise at most MAX_STEP, room for PLAYER_HEIGHT through
   * the opening. With a choice it takes the highest floor, so a mover walks onto a catwalk rather
   * than dropping through it.
   */
  stepTarget(ax: number, ay: number, level: number, h: Heading): number {
    const bx = ax + HEADING_DX[h];
    const by = ay + HEADING_DY[h];
    if (!this.walkable(ax, ay, level) || this.edgeBlocked(ax, ay, h)) return -1;
    const fromSec = this.map.sectors[this.sectorAt(ax, ay)]!;
    const toSec = this.map.sectors[this.sectorAt(bx, by)];
    if (!toSec) return -1;
    const [fromFloor0, fromCeil] = this.span(ax, ay, level)!;
    let best = -1;
    let bestFloor = -Infinity;
    for (let lb = 0; lb < this.levels(bx, by); lb++) {
      if (!this.walkable(bx, by, lb)) continue;
      const [toFloor0, toCeil] = this.span(bx, by, lb)!;
      // A lift stands wherever it can be called: the end nearest the other cell's floor.
      const fromFloor = isLift(fromSec) && !isLift(toSec) && level === 0 ? liftFloorNear(fromSec, toFloor0) : fromFloor0;
      const toFloor = isLift(toSec) && !isLift(fromSec) && lb === 0 ? liftFloorNear(toSec, fromFloor) : toFloor0;
      if (toFloor - fromFloor > MAX_STEP) continue;
      // Must fit through the opening while crossing the shared edge.
      if (Math.min(fromCeil, toCeil) - Math.max(fromFloor, toFloor) < PLAYER_HEIGHT) continue;
      if (toFloor > bestFloor) {
        best = lb;
        bestFloor = toFloor;
      }
    }
    return best;
  }

  /** Can a mover on `level` step from (ax, ay) to the adjacent cell in direction `h`? */
  canStep(ax: number, ay: number, h: Heading, level = 0): boolean {
    return this.stepTarget(ax, ay, level, h) >= 0;
  }

  private edgeBlocked(cx: number, cy: number, h: Heading): boolean {
    const w = this.width;
    switch (h) {
      case 0: return this.eastBlocked[cx + cy * w] === 1;
      case 2: return this.inBounds(cx - 1, cy) && this.eastBlocked[cx - 1 + cy * w] === 1;
      case 1: return this.northBlocked[cx + cy * w] === 1;
      case 3: return this.inBounds(cx, cy - 1) && this.northBlocked[cx + (cy - 1) * w] === 1;
    }
  }

  /** Cells reachable (on any level) from a cell's level. Cells marked in `blocked` are never entered. */
  reachableFrom(cx: number, cy: number, blocked?: Uint8Array, level = 0): Uint8Array {
    return this.cellsOf(this.reachStates(cx, cy, level, false, blocked));
  }

  /** Cells from which (cx, cy, level) can be reached: the same search over reversed steps. */
  reachingTo(cx: number, cy: number, level = 0): Uint8Array {
    return this.cellsOf(this.reachStates(cx, cy, level, true));
  }

  /**
   * Breadth-first search over (cell, level) states, indexed cell × LEVELS + level. Forward: where
   * a mover can go from here; reverse: from where it can come here.
   */
  reachStates(cx: number, cy: number, level: number, reverse: boolean, blocked?: Uint8Array): Uint8Array {
    const L = CellGrid.LEVELS;
    const seen = new Uint8Array(this.width * this.height * L);
    if (!this.walkable(cx, cy, level)) return seen;
    const queue: number[] = [(cx + cy * this.width) * L + level];
    seen[queue[0]!] = 1;
    const visit = (state: number) => {
      if (!seen[state] && !blocked?.[Math.floor(state / L)]) {
        seen[state] = 1;
        queue.push(state);
      }
    };
    for (let qi = 0; qi < queue.length; qi++) {
      const st = queue[qi]!;
      const l = st % L;
      const i = (st - l) / L;
      const x = i % this.width;
      const y = (i - x) / this.width;
      for (let h = 0 as Heading; h < 4; h = (h + 1) as Heading) {
        const nx = x + HEADING_DX[h];
        const ny = y + HEADING_DY[h];
        if (!this.inBounds(nx, ny)) continue;
        const n = nx + ny * this.width;
        if (!reverse) {
          const lb = this.stepTarget(x, y, l, h);
          if (lb >= 0) visit(n * L + lb);
        } else {
          // Every level of the neighbour whose step towards us lands on our level.
          const back = ((h + 2) % 4) as Heading;
          for (let ln = 0; ln < this.levels(nx, ny); ln++) if (this.stepTarget(nx, ny, ln, back) === l) visit(n * L + ln);
        }
      }
    }
    return seen;
  }

  private cellsOf(states: Uint8Array): Uint8Array {
    const L = CellGrid.LEVELS;
    const cells = new Uint8Array(states.length / L);
    for (let i = 0; i < states.length; i++) if (states[i]) cells[Math.floor(i / L)] = 1;
    return cells;
  }
}

/**
 * Grid rule: every vertex on the cell lattice, every line axis-aligned, every
 * thing at a cell centre. Sub-cell decorative geometry needs a Decorative line
 * flag and renderer-only handling — not supported yet.
 */
export function validateGridAlignment(map: MapData, cellSize = CELL_SIZE): string[] {
  const errors: string[] = [];
  const mod = (v: number) => ((v % cellSize) + cellSize) % cellSize;
  map.vertices.forEach((v, i) => {
    if (mod(v.x) !== 0 || mod(v.y) !== 0) errors.push(`vertex ${i} (${v.x}, ${v.y}) is off the ${cellSize} grid`);
  });
  map.linedefs.forEach((l, i) => {
    const a = map.vertices[l.v1]!;
    const b = map.vertices[l.v2]!;
    if (a.x !== b.x && a.y !== b.y) errors.push(`line ${i} is not axis-aligned`);
  });
  map.things.forEach((t, i) => {
    if (mod(t.x - cellSize / 2) !== 0 || mod(t.y - cellSize / 2) !== 0) errors.push(`thing ${i} (${t.x}, ${t.y}) is not at a cell centre`);
  });
  return errors;
}
