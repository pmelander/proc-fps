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

  walkable(cx: number, cy: number): boolean {
    const s = this.sectorAt(cx, cy);
    if (s < 0) return false;
    const sec = this.map.sectors[s]!;
    return sec.ceil - sec.floor >= PLAYER_HEIGHT;
  }

  floorAt(cx: number, cy: number): number {
    return this.map.sectors[this.sectorAt(cx, cy)]?.floor ?? 0;
  }

  cellOf(x: number, y: number): [number, number] {
    return [Math.floor((x - this.originX) / this.cellSize), Math.floor((y - this.originY) / this.cellSize)];
  }

  center(cx: number, cy: number): [number, number] {
    return [this.originX + (cx + 0.5) * this.cellSize, this.originY + (cy + 0.5) * this.cellSize];
  }

  /** Can a mover step from (ax, ay) to the adjacent cell in direction `h`? Same rules for player and AI. */
  canStep(ax: number, ay: number, h: Heading): boolean {
    const bx = ax + HEADING_DX[h];
    const by = ay + HEADING_DY[h];
    if (!this.walkable(ax, ay) || !this.walkable(bx, by)) return false;
    if (this.edgeBlocked(ax, ay, h)) return false;
    const from = this.map.sectors[this.sectorAt(ax, ay)]!;
    const to = this.map.sectors[this.sectorAt(bx, by)]!;
    // A lift stands wherever it can be called: the end nearest the other cell's floor.
    const fromFloor = isLift(from) && !isLift(to) ? liftFloorNear(from, to.floor) : from.floor;
    const toFloor = isLift(to) && !isLift(from) ? liftFloorNear(to, fromFloor) : to.floor;
    if (toFloor - fromFloor > MAX_STEP) return false;
    // Must fit through the opening while crossing the shared edge.
    if (Math.min(from.ceil, to.ceil) - Math.max(fromFloor, toFloor) < PLAYER_HEIGHT) return false;
    return true;
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

  /** Breadth-first reachability from a cell using `canStep`. Cells marked in `blocked` are never entered. */
  reachableFrom(cx: number, cy: number, blocked?: Uint8Array): Uint8Array {
    return this.search(cx, cy, false, blocked);
  }

  /** Cells that can reach (cx, cy): the same search over reversed `canStep` edges. */
  reachingTo(cx: number, cy: number): Uint8Array {
    return this.search(cx, cy, true);
  }

  private search(cx: number, cy: number, reverse: boolean, blocked?: Uint8Array): Uint8Array {
    const seen = new Uint8Array(this.width * this.height);
    if (!this.walkable(cx, cy)) return seen;
    const queue: number[] = [cx + cy * this.width];
    seen[queue[0]!] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi]!;
      const x = i % this.width;
      const y = (i - x) / this.width;
      for (let h = 0 as Heading; h < 4; h = (h + 1) as Heading) {
        const nx = x + HEADING_DX[h];
        const ny = y + HEADING_DY[h];
        // Forward: can we step out to the neighbour? Reverse: can the neighbour step in to us?
        const ok = reverse ? this.canStep(nx, ny, ((h + 2) % 4) as Heading) : this.canStep(x, y, h);
        if (!ok) continue;
        const j = nx + ny * this.width;
        if (!seen[j] && !blocked?.[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    return seen;
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
