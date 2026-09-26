import { DoorKind } from '@proc-fps/core';
import { floorNow } from './lifts.js';
import { DOOR_OPEN_TICKS, doorOffset, type SimState } from './state.js';
import { doorAtCell, type World } from './world.js';

/** A cell a ray or line of sight can pass: walkable, and not filled by a door that is not fully open. */
export function cellOpen(world: World, state: SimState, cx: number, cy: number): boolean {
  if (!world.grid.walkable(cx, cy)) return false;
  const door = doorAtCell(world, cx, cy);
  return door < 0 || state.doors[door]! >= DOOR_OPEN_TICKS;
}

/**
 * Walks the grid cells a 2D segment crosses, in order (Amanatides–Woo). `visit` gets each cell
 * with the segment parameters t ∈ [0, 1] where the segment enters and leaves it, and returns
 * false to stop. Returns true when the whole segment was visited.
 */
export function traceCells(
  world: World,
  x0: number, y0: number, x1: number, y1: number,
  visit: (cx: number, cy: number, tIn: number, tOut: number) => boolean,
): boolean {
  const g = world.grid;
  const cs = g.cellSize;
  let [cx, cy] = g.cellOf(x0, y0);
  const [ex, ey] = g.cellOf(x1, y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? cs / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? cs / Math.abs(dy) : Infinity;
  let tMaxX = dx !== 0 ? (g.originX + (cx + (dx > 0 ? 1 : 0)) * cs - x0) / dx : Infinity;
  let tMaxY = dy !== 0 ? (g.originY + (cy + (dy > 0 ? 1 : 0)) * cs - y0) / dy : Infinity;
  let t = 0;
  for (let n = Math.abs(ex - cx) + Math.abs(ey - cy) + 1; n > 0; n--) {
    const tOut = Math.min(tMaxX, tMaxY, 1);
    if (!visit(cx, cy, t, tOut)) return false;
    if (tOut >= 1) return true;
    if (tMaxX < tMaxY) {
      cx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    }
  }
  return true;
}

/** 2D line of sight between two map points: every cell on the way is open. */
export function lineOfSight(world: World, state: SimState, x0: number, y0: number, x1: number, y1: number): boolean {
  return traceCells(world, x0, y0, x1, y1, (cx, cy) => cellOpen(world, state, cx, cy));
}

/** Floor and ceiling of a cell right now (a door's ceiling follows its state). */
function cellSpan(world: World, state: SimState, cx: number, cy: number): [number, number] {
  const sec = world.map.sectors[world.grid.sectorAt(cx, cy)]!;
  const door = doorAtCell(world, cx, cy);
  const ceil = door >= 0 && world.doors[door]!.kind !== DoorKind.None ? sec.ceil - doorOffset(world, state, door) : sec.ceil;
  return [floorNow(world, state, cx, cy), ceil];
}

/**
 * Distance along a 3D ray (unit direction) to the first wall, floor, ceiling or closed door,
 * capped at `range`. Heights come from the cells the ray crosses, so it hits exactly the
 * geometry the player sees.
 */
export function castRay(
  world: World, state: SimState,
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  range: number,
): number {
  let hit = range;
  traceCells(world, x, y, x + dx * range, y + dy * range, (cx, cy, tIn, tOut) => {
    if (!cellOpen(world, state, cx, cy)) {
      hit = tIn * range;
      return false;
    }
    const [floor, ceil] = cellSpan(world, state, cx, cy);
    const zIn = z + dz * range * tIn;
    const zOut = z + dz * range * tOut;
    if (zIn < floor || zIn > ceil) {
      hit = tIn * range; // a step, ledge or lintel at the cell edge
      return false;
    }
    if (zOut < floor || zOut > ceil) {
      hit = ((zOut < floor ? floor : ceil) - z) / dz; // floor or ceiling inside the cell
      return false;
    }
    return true;
  });
  return hit;
}
