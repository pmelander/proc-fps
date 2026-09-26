import { CellGrid, SectorLocator, type MapData } from '@proc-fps/core';

/** Immutable per-level data the sim needs, derived once from the map. */
export interface World {
  readonly map: MapData;
  readonly locator: SectorLocator;
  /** Movement and AI truth. */
  readonly grid: CellGrid;
}

export function createWorld(map: MapData): World {
  return { map, locator: new SectorLocator(map), grid: new CellGrid(map) };
}
