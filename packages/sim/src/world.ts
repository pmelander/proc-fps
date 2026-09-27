import {
  CellGrid,
  enemyDefsFor,
  scaleDamage,
  DIFFICULTY,
  difficultyOf,
  type EnemyDefs,
  DoorKind,
  LIFT_SPEED,
  SectorLocator,
  ThingType,
  doorKindOf,
  doorSectors,
  droppedKey,
  isEnemyThing,
  isLift,
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

export interface LiftInfo {
  sector: number;
  bottom: number;
  top: number;
  /** Ticks from one end to the other. */
  travel: number;
  /** Grid cell indices it covers. */
  cells: number[];
}

export type PickupKind = 'key' | 'health' | 'grenade' | 'armor' | 'berserk' | 'overcharge';
/** Floor pickups by thing type (keys aside). */
const PICKUP_OF: Partial<Record<number, PickupKind>> = {
  [ThingType.Health]: 'health', [ThingType.Grenade]: 'grenade', [ThingType.Armor]: 'armor', [ThingType.Berserk]: 'berserk', [ThingType.Overcharge]: 'overcharge',
};

/** Something picked up by walking over it. */
export interface PickupInfo {
  kind: PickupKind;
  /** Key id, for keys. */
  key: number;
  /** Where it lies; a dropped key lies where its carrier died instead. */
  cx: number;
  cy: number;
  /** Index into `state.enemies` of the enemy carrying it, or -1. */
  carrier: number;
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
  /** Lifts in sector order (lift id = index; the renderer's lift movers follow it). */
  readonly lifts: readonly LiftInfo[];
  /** Lift id per grid cell, -1 = none. */
  readonly liftAt: Int32Array;
  /** Keys and health, in thing order (the renderer's pickup movers follow the same order). */
  readonly pickups: readonly PickupInfo[];
  /** Exit cell, if the map has one. */
  readonly exit: readonly [number, number] | null;
  /** Number of secrets (ids 0 … secrets - 1). */
  readonly secrets: number;
  /** This level's enemy stats per role and variant (see `defOf`): seeded on generated maps, the baseline otherwise. */
  readonly enemyDefs: EnemyDefs;
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
  let enemy = 0;
  const pickups = map.things.flatMap((t): PickupInfo[] => {
    const [cx, cy] = grid.cellOf(t.x, t.y);
    if (isEnemyThing(t.type)) {
      const carrier = enemy++;
      const key = droppedKey(t);
      return key >= 0 ? [{ kind: 'key', key, cx, cy, carrier }] : [];
    }
    const key = keyOfThing(t.type);
    const kind = key >= 0 ? 'key' : PICKUP_OF[t.type];
    return kind ? [{ kind, key, cx, cy, carrier: -1 }] : [];
  });
  const lifts: LiftInfo[] = [];
  const liftAt = new Int32Array(grid.width * grid.height).fill(-1);
  map.sectors.forEach((s, sector) => {
    if (!isLift(s)) return;
    const cells: number[] = [];
    grid.sector.forEach((cs, i) => {
      if (cs !== sector) return;
      cells.push(i);
      liftAt[i] = lifts.length;
    });
    lifts.push({ sector, bottom: s.floor, top: s.tag, travel: Math.max(1, Math.ceil((s.tag - s.floor) / LIFT_SPEED)), cells });
  });
  const exitThing = map.things.find((t) => t.type === ThingType.Exit);
  const exit = exitThing ? grid.cellOf(exitThing.x, exitThing.y) : null;
  return { map, locator: new SectorLocator(map), grid, doors, doorAt, lifts, liftAt, pickups, exit, secrets: secretCount(map), enemyDefs: scaleDamage(enemyDefsFor(map.meta.seed), DIFFICULTY[difficultyOf(map)].damage) };
}

/** True for things that are floor pickups (carried keys come from enemies). */
export const isPickupThing = (type: number): boolean => keyOfThing(type) >= 0 || PICKUP_OF[type] !== undefined;

/** Where a pickup is now, or null while its carrier lives. */
export function pickupCell(state: { enemies: readonly { mode: string; cx: number; cy: number }[] }, k: PickupInfo): [number, number] | null {
  if (k.carrier < 0) return [k.cx, k.cy];
  const e = state.enemies[k.carrier]!;
  return e.mode === 'dead' ? [e.cx, e.cy] : null;
}

/** Door id at a cell, or -1. */
export function doorAtCell(world: World, cx: number, cy: number): number {
  return world.grid.inBounds(cx, cy) ? world.doorAt[cx + cy * world.grid.width]! : -1;
}
