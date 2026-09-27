import {
  CellGrid,
  DoorKind,
  HEADING_DX,
  HEADING_DY,
  ThingType,
  doorKindOf,
  droppedKey,
  isEnemyThing,
  isHigh,
  keyOfThing,
  validateGridAlignment,
  validateMap,
  type Heading,
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
  // Traps: a cell (on any level) the player can get into but never get out of towards the exit,
  // e.g. a pit too deep to climb. Checked per (cell, level): a catwalk above a pit is its own place.
  const L = CellGrid.LEVELS;
  const into = grid.reachStates(sx, sy, 0, false);
  const toExit = grid.reachStates(ex, ey, 0, true);
  const traps = new Set<string>();
  into.forEach((r, st) => {
    const i = Math.floor(st / L);
    if (r && !toExit[st]) traps.add(`(${i % grid.width}, ${Math.floor(i / grid.width)})`);
  });
  if (traps.size) errors.push(`${traps.size} trap cell(s) cannot reach the exit: ${[...traps].slice(0, 5).join(' ')}`);
  errors.push(...validateKeys(map, grid, sx, sy, ex, ey, reachable));
  if (!errors.length) errors.push(...validateProgress(map, grid, sx, sy, ex, ey));
  errors.push(...validateThings(map, grid));
  errors.push(...validateSupplies(map));
  return errors;
}

/**
 * Nobody gets stranded. One-way drops (ledges too high to climb back) make "reachable" depend on
 * the order the player goes: a key left above a drop is gone once they jump. So the whole state
 * space is searched: (cell, level, keys held), moving by the sim's own step rules, key doors
 * shut until their key is held, keys picked up where they lie (or where the enemy carrying one
 * starts). Every state the player can get into must still have a way on to the exit.
 */
function validateProgress(map: MapData, grid: CellGrid, sx: number, sy: number, ex: number, ey: number): string[] {
  const W = grid.width;
  const L = CellGrid.LEVELS;
  const KEYSETS = 16;
  const lockOf = new Int8Array(W * grid.height).fill(-1); // cell → key its door needs
  grid.sector.forEach((sec, i) => {
    const sector = map.sectors[sec];
    if (sector && doorKindOf(sector) === DoorKind.Key) lockOf[i] = sector.tag;
  });
  const keyAt = new Int8Array(W * grid.height).fill(0); // cell → key bits picked up there
  for (const t of map.things) {
    const k = keyOfThing(t.type) >= 0 ? keyOfThing(t.type) : isEnemyThing(t.type) ? droppedKey(t) : -1;
    if (k < 0) continue;
    const [cx, cy] = grid.cellOf(t.x, t.y);
    keyAt[cx + cy * W]! |= 1 << k;
  }
  const state = (cell: number, level: number, keys: number) => (cell * L + level) * KEYSETS + keys;

  // Forward search, recording each move so the backward pass can follow them in reverse.
  const n = W * grid.height * L * KEYSETS;
  const reached = new Uint8Array(n);
  const from: number[] = [];
  const to: number[] = [];
  const first = state(sx + sy * W, 0, keyAt[sx + sy * W]!);
  reached[first] = 1;
  const queue = [first];
  for (let q = 0; q < queue.length; q++) {
    const st = queue[q]!;
    const keys = st % KEYSETS;
    const level = Math.floor(st / KEYSETS) % L;
    const cell = Math.floor(st / KEYSETS / L);
    const cx = cell % W;
    const cy = Math.floor(cell / W);
    for (let h = 0; h < 4; h++) {
      const lb = grid.stepTarget(cx, cy, level, h as Heading);
      if (lb < 0) continue;
      const next = cx + HEADING_DX[h as Heading] + (cy + HEADING_DY[h as Heading]) * W;
      if (lockOf[next]! >= 0 && !(keys & (1 << lockOf[next]!))) continue;
      const ns = state(next, lb, keys | keyAt[next]!);
      from.push(st);
      to.push(ns);
      if (!reached[ns]) {
        reached[ns] = 1;
        queue.push(ns);
      }
    }
  }
  // Backward from every state at the exit.
  const into = new Map<number, number[]>();
  to.forEach((t, i) => {
    const list = into.get(t);
    if (list) list.push(from[i]!);
    else into.set(t, [from[i]!]);
  });
  const done = new Uint8Array(n);
  const back: number[] = [];
  const exitCell = ex + ey * W;
  for (const st of queue) {
    if (Math.floor(st / KEYSETS / L) === exitCell) {
      done[st] = 1;
      back.push(st);
    }
  }
  for (let q = 0; q < back.length; q++) {
    for (const p of into.get(back[q]!) ?? []) {
      if (!done[p]) {
        done[p] = 1;
        back.push(p);
      }
    }
  }
  const stuck = new Set<string>();
  for (const st of queue) {
    if (done[st]) continue;
    const cell = Math.floor(st / KEYSETS / L);
    stuck.add(`(${cell % W}, ${Math.floor(cell / W)})`);
  }
  return stuck.size ? [`the player can be stranded: ${stuck.size} cell(s) with no way on to the exit, e.g. ${[...stuck].slice(0, 5).join(' ')}`] : [];
}

/** Some health wherever there are enemies. (Ammo is infinite.) */
function validateSupplies(map: MapData): string[] {
  const enemies = map.things.some((t) => isEnemyThing(t.type));
  const health = map.things.some((t) => t.type === ThingType.Health);
  return enemies && !health ? ['enemies but no health'] : [];
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
    const level = isHigh(t) ? 1 : 0;
    if (!grid.walkable(cx, cy, level)) errors.push(`thing ${i} (type ${t.type}) on a cell that is not walkable${level ? ' up on its catwalk' : ''}`);
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
  // Keys lying on the floor, and keys enemies carry (counted where the enemy starts: it cannot
  // leave the part of the level reachable from there without keys).
  for (const t of map.things) {
    const k = keyOfThing(t.type) >= 0 ? keyOfThing(t.type) : isEnemyThing(t.type) ? droppedKey(t) : -1;
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
