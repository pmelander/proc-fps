import { CellGrid, DoorKind, SectorLocator, doorKindOf, doorSectors, keyOfThing, secretCount, type MapData } from '@proc-fps/core';

/**
 * Gap left between a closed door's ceiling and its floor, so the two never z-fight. Secret
 * doors close fully: a slit under a wall would give them away, and their ceiling is only ever
 * seen from the secret side.
 */
export const DOOR_CLOSED_GAP = 4;

export interface DoorInfo {
  sector: number;
  kind: DoorKind;
  /** Key id for a key door, secret id for a secret door (the sector tag). */
  key: number;
  /** Ceiling travel between open and closed, in map units. */
  travel: number;
}

export interface KeyInfo {
  key: number;
  cx: number;
  cy: number;
}

/** Immutable per-level data the sim needs, derived once from the map. */
export interface World {
  readonly map: MapData;
  readonly locator: SectorLocator;
  /** Movement and AI truth. Doors count as open here; the sim adds door state on top. */
  readonly grid: CellGrid;
  /** Indexed by door id (see `doorSectors`). */
  readonly doors: readonly DoorInfo[];
  /** Door id per grid cell, -1 = none. */
  readonly doorAt: Int32Array;
  /** Key pickups in thing order. */
  readonly keys: readonly KeyInfo[];
  /** Number of secrets (ids 0 … secrets - 1). */
  readonly secrets: number;
}

export function createWorld(map: MapData): World {
  const grid = new CellGrid(map);
  const doors = doorSectors(map).map((sector) => {
    const s = map.sectors[sector]!;
    const kind = doorKindOf(s);
    return { sector, kind, key: s.tag, travel: s.ceil - s.floor - (kind === DoorKind.Secret ? 0 : DOOR_CLOSED_GAP) };
  });
  const doorOfSector = new Map(doors.map((d, i) => [d.sector, i]));
  const doorAt = new Int32Array(grid.width * grid.height).fill(-1);
  grid.sector.forEach((s, i) => (doorAt[i] = doorOfSector.get(s) ?? -1));
  const keys = map.things.flatMap((t) => {
    const key = keyOfThing(t.type);
    if (key < 0) return [];
    const [cx, cy] = grid.cellOf(t.x, t.y);
    return [{ key, cx, cy }];
  });
  return { map, locator: new SectorLocator(map), grid, doors, doorAt, keys, secrets: secretCount(map) };
}

/** Door id at a cell, or -1. */
export function doorAtCell(world: World, cx: number, cy: number): number {
  return world.grid.inBounds(cx, cy) ? world.doorAt[cx + cy * world.grid.width]! : -1;
}
