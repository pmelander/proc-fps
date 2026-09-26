import { CellGrid, ThingType, validateGridAlignment, validateMap, type MapData } from '@proc-fps/core';

/**
 * Gameplay validation on top of structural checks. Reachability runs on the
 * same CellGrid.canStep the sim uses, so "valid" means "completable".
 */
export function validateGenerated(map: MapData): string[] {
  const errors = [...validateMap(map), ...validateGridAlignment(map)];
  if (errors.length) return errors;
  const grid = new CellGrid(map);
  const start = map.things.find((t) => t.type === ThingType.PlayerStart)!;
  const exit = map.things.find((t) => t.type === ThingType.Exit);
  if (!exit) return ['no exit'];
  const [sx, sy] = grid.cellOf(start.x, start.y);
  const [ex, ey] = grid.cellOf(exit.x, exit.y);
  if (!grid.walkable(sx, sy)) errors.push('player start cell is not walkable');
  if (!grid.walkable(ex, ey)) errors.push('exit cell is not walkable');
  if (errors.length) return errors;
  if (!grid.reachableFrom(sx, sy)[ex + ey * grid.width]) errors.push('exit unreachable from start');
  // TODO(M2): trap detection — every cell reachable from start must be able to reach the exit.
  return errors;
}
