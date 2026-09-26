import {
  AMMO_PICKUP,
  CellGrid,
  DoorKind,
  ENEMY_DEFS,
  PLAYER_DAMAGE,
  START_AMMO,
  ThingType,
  doorKindOf,
  isEnemyThing,
  keyOfThing,
  validateGridAlignment,
  validateMap,
  type MapData,
} from '@proc-fps/core';

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
  errors.push(...validateKeys(map, grid, sx, sy, ex, ey, reachable));
  errors.push(...validateThings(map, grid));
  errors.push(...validateSupplies(map));
  return errors;
}

/** Enough ammo to kill every enemy, and some health wherever there are enemies. */
function validateSupplies(map: MapData): string[] {
  const errors: string[] = [];
  let shots = 0;
  let ammo = START_AMMO;
  let health = 0;
  for (const t of map.things) {
    if (isEnemyThing(t.type)) shots += Math.ceil(ENEMY_DEFS[t.type].hp / PLAYER_DAMAGE);
    if (t.type === ThingType.Ammo) ammo += AMMO_PICKUP;
    if (t.type === ThingType.Health) health++;
  }
  if (ammo < shots) errors.push(`ammo for ${ammo} shots, enemies need ${shots}`);
  if (shots > 0 && health === 0) errors.push('enemies but no health');
  return errors;
}

/** Every thing on its own walkable cell; enemies never next to the start, so no fight begins before the first step. */
function validateThings(map: MapData, grid: CellGrid): string[] {
  const errors: string[] = [];
  const seen = new Map<number, number>();
  const start = map.things.find((t) => t.type === ThingType.PlayerStart)!;
  const [sx, sy] = grid.cellOf(start.x, start.y);
  map.things.forEach((t, i) => {
    const [cx, cy] = grid.cellOf(t.x, t.y);
    const c = cx + cy * grid.width;
    if (!grid.walkable(cx, cy)) errors.push(`thing ${i} (type ${t.type}) on a cell that is not walkable`);
    if (seen.has(c)) errors.push(`things ${seen.get(c)} and ${i} share cell (${cx}, ${cy})`);
    seen.set(c, i);
    if (isEnemyThing(t.type) && Math.abs(cx - sx) + Math.abs(cy - sy) <= 1) errors.push(`enemy ${i} next to the player start`);
  });
  return errors;
}

/**
 * Progression with key doors: explore from the start with key doors shut, pick up the
 * keys reached, reopen their doors, and repeat. The exit, and everything reachable with every
 * door open, must end up reachable, so no key sits behind its own lock.
 */
function validateKeys(map: MapData, grid: CellGrid, sx: number, sy: number, ex: number, ey: number, open: Uint8Array): string[] {
  const errors: string[] = [];
  const locks = new Map<number, number[]>(); // key → door cells
  grid.sector.forEach((s, i) => {
    const sec = map.sectors[s];
    if (sec && doorKindOf(sec) === DoorKind.Key) locks.set(sec.tag, [...(locks.get(sec.tag) ?? []), i]);
  });
  const keyCells = new Map<number, number>(); // key → cell
  for (const t of map.things) {
    const k = keyOfThing(t.type);
    if (k < 0) continue;
    const [cx, cy] = grid.cellOf(t.x, t.y);
    if (keyCells.has(k)) errors.push(`key ${k} placed twice`);
    keyCells.set(k, cx + cy * grid.width);
  }
  for (const k of locks.keys()) if (!keyCells.has(k)) errors.push(`key door needs key ${k}, which is not placed`);
  for (const k of keyCells.keys()) if (!locks.has(k)) errors.push(`key ${k} opens no door`);
  if (errors.length) return errors;

  let held = 0;
  let reach: Uint8Array;
  for (;;) {
    const blocked = new Uint8Array(grid.width * grid.height);
    for (const [k, cells] of locks) if (!(held & (1 << k))) for (const c of cells) blocked[c] = 1;
    reach = grid.reachableFrom(sx, sy, blocked);
    let got = held;
    for (const [k, c] of keyCells) if (reach[c]) got |= 1 << k;
    if (got === held) break;
    held = got;
  }
  if (!reach[ex + ey * grid.width]) errors.push('exit unreachable when collecting keys');
  let missing = 0;
  open.forEach((r, i) => r && !reach[i] && missing++);
  if (missing) errors.push(`${missing} cell(s) unreachable even after collecting every reachable key`);
  return errors;
}
