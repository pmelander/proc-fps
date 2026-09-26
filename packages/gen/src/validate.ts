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
  const reachable = grid.reachableFrom(sx, sy);
  if (!reachable[ex + ey * grid.width]) return ['exit unreachable from start'];
  // Traps: a cell the player can get into but never get out of towards the exit (e.g. a pit too deep to climb).
  const toExit = grid.reachingTo(ex, ey);
  const traps: string[] = [];
  reachable.forEach((r, i) => {
    if (r && !toExit[i]) traps.push(`(${i % grid.width}, ${Math.floor(i / grid.width)})`);
  });
  if (traps.length) errors.push(`${traps.length} trap cell(s) cannot reach the exit: ${traps.slice(0, 5).join(' ')}`);
  return errors;
}
