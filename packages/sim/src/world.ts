import {
  CellGrid,
  DoorKind,
  SectorLocator,
  ThingType,
  doorKindOf,
  doorSectors,
  keyOfThing,
  secretCount,
  type MapData,
} from '@proc-fps/core';

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

/** Something picked up by walking over it. */
export interface PickupInfo {
  kind: 'key' | 'health';
  /** Key id, for keys. */
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
  /** Keys and health, in thing order (the renderer's pickup movers follow the same order). */
  readonly pickups: readonly PickupInfo[];
  /** Exit cell, if the map has one. */
  readonly exit: readonly [number, number] | null;
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
  const pickups = map.things.flatMap((t): PickupInfo[] => {
    const key = keyOfThing(t.type);
    if (key < 0 && t.type !== ThingType.Health) return [];
    const [cx, cy] = grid.cellOf(t.x, t.y);
    return [{ kind: key >= 0 ? 'key' : 'health', key, cx, cy }];
  });
  const exitThing = map.things.find((t) => t.type === ThingType.Exit);
  const exit = exitThing ? grid.cellOf(exitThing.x, exitThing.y) : null;
  return { map, locator: new SectorLocator(map), grid, doors, doorAt, pickups, exit, secrets: secretCount(map) };
}

/** True for pickups that render as markers: the mover order of the level mesh. */
export const isPickupThing = (type: number): boolean => keyOfThing(type) >= 0 || type === ThingType.Health;

/** Door id at a cell, or -1. */
export function doorAtCell(world: World, cx: number, cy: number): number {
  return world.grid.inBounds(cx, cy) ? world.doorAt[cx + cy * world.grid.width]! : -1;
}
