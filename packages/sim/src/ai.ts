import { ALERT_TICKS, CELL_SIZE, PLAYER_EYE_HEIGHT, CHARGE_STEP_TICKS, CHARGE_STUN, CellGrid, DoorKind, defOf, HEADING_DX, HEADING_DY, MAX_STEP, NOISE_CELLS, PLAYER_HEIGHT, SHIELD_TURN, SIGHT_CELLS, dcos, dsin, type EnemyDef, type Heading } from '@proc-fps/core';
import { detonate, hurtPlayer } from './combat.js';
import { callLift, floorNow, liftAtCell, liftMoving } from './lifts.js';
import { bossAttack, isBoss, nextPattern, patternCooldown, patternWindup, updatePhase, volleyBonus } from './boss.js';
import { clearLine } from './raycast.js';
import { fireHoming, fireLob } from './shots.js';
import { DOOR_OPEN_TICKS, type EnemyState, type SimState } from './state.js';
import { doorAtCell, type World } from './world.js';

/** Enemy eye and projectile launch height, as a fraction of its height. */
const EYE = 0.75;
/** Where enemies aim on the player: roughly chest height. */
const AIM_HEIGHT = 44;

/**
 * Grid-bound enemies: one per cell, stepping on their own timers like the player, and
 * pathing along a distance field towards the player's cell. Modes:
 * idle → (sees the player, hears gunfire, or is hurt) → alert → chase ⇄ windup → attack,
 * with pain interrupting and dead final. Auto doors are bumped open; key and secret doors
 * are walls to them. They ride lifts like the player (calling one that is not level, never one
 * the player is on), so they follow between storeys. Some flank (see FLANK_*): while still far,
 * they make for a point beside the player, so a horde comes round a loop from both sides.
 * Chargers wind up when the player stands in a straight, clear lane from them, then rush down it
 * (`charge`): the player in the way is struck, anything else stuns them. Bloaters burst next to
 * the player (combat.ts `detonate`). Wardens turn their shield towards the player, slowly.
 */
export function stepEnemies(world: World, state: SimState): void {
  const occupied = occupancy(state);
  let field: Int32Array | undefined;
  const distance = () => (field ??= distanceField(world, state));
  const flankFields: (Int32Array | null | undefined)[] = [];
  const flank = (side: number) => (flankFields[side] === undefined ? (flankFields[side] = flankField(world, state, distance(), side)) : flankFields[side]);

  state.enemies.forEach((e, i) => {
    if (e.mode === 'dead') return;
    const def = defOf(world.enemyDefs, e);
    if (e.cooldown > 0) e.cooldown--;
    if (e.stepTick > 0 && ++e.stepTick > stepTicksOf(e, def)) e.stepTick = 0;
    updatePose(world, state, e, def);
    if (def.shield && e.mode !== 'idle') turnShield(state, e);
    const boss = isBoss(e.type);
    if (boss) updatePhase(state, e, def, i);

    switch (e.mode) {
      case 'idle':
        if (sees(world, state, e, def, SIGHT_CELLS)) alert(e);
        break;
      case 'alert':
      case 'pain':
        if (--e.timer <= 0) e.mode = 'chase';
        break;
      case 'windup':
        if (--e.timer > 0) break;
        if (def.attack === 'charge') {
          e.mode = 'charge';
          e.timer = def.range + 4; // the most cells it rushes
          state.events.push({ type: 'charge', enemy: i });
          break;
        }
        if (def.attack === 'blast') {
          detonate(world, state, i);
          break;
        }
        if (boss && e.pattern !== 'volley') bossAttack(world, state, e, def, i, e.pattern);
        else attack(world, state, e, def, i);
        e.cooldown = boss ? patternCooldown(e, def) : def.cooldown;
        e.mode = 'chase';
        break;
      case 'charge':
        if (e.stepTick === 0) rush(world, state, e, def, i, occupied);
        break;
      case 'chase': {
        if (e.stepTick !== 0) break;
        if (e.cooldown === 0 && canAttack(world, state, e, def, occupied)) {
          const lane = def.attack === 'charge' ? chargeLane(world, state, e, def, occupied) : undefined;
          if (lane !== undefined) e.heading = lane;
          e.mode = 'windup';
          if (boss) {
            e.pattern = nextPattern(state, e, i);
            e.timer = patternWindup(e, def, e.pattern);
            state.events.push({ type: 'windup', enemy: i, pattern: e.pattern });
          } else {
            e.timer = def.windup;
            state.events.push({ type: 'windup', enemy: i });
          }
          break;
        }
        // Flankers head for a point beside the player while still far from it; then straight in.
        const side = flankSide(i, e.variant);
        const main = distance();
        const far = main[(e.cx + e.cy * world.grid.width) * CellGrid.LEVELS + e.level]! > FLANK_CLOSE;
        const toward = side >= 0 && far ? (flank(side) ?? main) : main;
        const next = nextStep(world, state, e, toward, occupied) ?? (toward !== main ? nextStep(world, state, e, main, occupied) : undefined);
        if (next === undefined) break;
        const [heading, lands] = next;
        const nx = e.cx + HEADING_DX[heading];
        const ny = e.cy + HEADING_DY[heading];
        if (!liftAllows(world, state, e, nx, ny, lands)) break;
        const door = doorAtCell(world, nx, ny);
        if (door >= 0 && state.doors[door]! < DOOR_OPEN_TICKS) {
          // Only auto doors can be in the path; bump it and wait.
          if (state.doors[door] === 0) {
            state.doors[door] = 1;
            state.events.push({ type: 'door', door });
          }
          break;
        }
        occupied.add(cellKey(nx, ny));
        e.fromCx = e.cx;
        e.fromCy = e.cy;
        e.fromLevel = e.level;
        e.cx = nx;
        e.cy = ny;
        e.level = lands;
        e.stepTick = 1;
        break;
      }
    }
  });
}

export function alert(e: EnemyState, ticks = ALERT_TICKS): void {
  if (e.mode !== 'idle') return;
  e.mode = 'alert';
  e.timer = ticks;
}

/** Gunfire: wakes idle enemies within NOISE_CELLS of path distance; doors that are not open stop it. */
export function makeNoise(world: World, state: SimState): void {
  const g = world.grid;
  const dist = new Int32Array(g.width * g.height).fill(-1);
  const start = state.player.cx + state.player.cy * g.width;
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi]!;
    if (dist[c]! >= NOISE_CELLS) continue;
    const x = c % g.width;
    const y = (c - x) / g.width;
    for (let h = 0; h < 4; h++) {
      const nx = x + HEADING_DX[h as Heading];
      const ny = y + HEADING_DY[h as Heading];
      const n = nx + ny * g.width;
      if (!g.walkable(nx, ny) || dist[n] !== -1) continue;
      const door = doorAtCell(world, nx, ny);
      if (door >= 0 && state.doors[door]! < DOOR_OPEN_TICKS) continue;
      dist[n] = dist[c]! + 1;
      queue.push(n);
    }
  }
  for (const e of state.enemies) if (e.mode === 'idle' && dist[e.cx + e.cy * g.width]! >= 0) alert(e, ALERT_TICKS / 2);
}

const cellKey = (x: number, y: number) => `${x},${y}`;

/** Cells held by living enemies and the player, including the cell a stepper is leaving. */
function occupancy(state: SimState): Set<string> {
  const out = new Set<string>();
  const p = state.player;
  out.add(cellKey(p.cx, p.cy));
  if (p.stepTick > 0) out.add(cellKey(p.fromCx, p.fromCy));
  for (const e of state.enemies) {
    if (e.mode === 'dead') continue;
    out.add(cellKey(e.cx, e.cy));
    if (e.stepTick > 0) out.add(cellKey(e.fromCx, e.fromCy));
  }
  return out;
}

/**
 * Path distance in steps from every (cell, level) state (index cell × LEVELS + level) to the
 * player's, following steps in reverse. Key and secret doors that are not open are walls; auto
 * doors are passable (bumped open).
 */
export function distanceField(world: World, state: SimState): Int32Array {
  const g = world.grid;
  const L = CellGrid.LEVELS;
  const dist = new Int32Array(g.width * g.height * L).fill(-1);
  const p = state.player;
  if (!g.inBounds(p.cx, p.cy)) return dist;
  const start = (p.cx + p.cy * g.width) * L + p.level;
  dist[start] = 0;
  const queue = [start];
  const shut = (x: number, y: number) => {
    const door = doorAtCell(world, x, y);
    return door >= 0 && world.doors[door]!.kind !== DoorKind.Auto && state.doors[door]! < DOOR_OPEN_TICKS;
  };
  for (let qi = 0; qi < queue.length; qi++) {
    const st = queue[qi]!;
    const l = st % L;
    const c = (st - l) / L;
    const x = c % g.width;
    const y = (c - x) / g.width;
    for (let h = 0; h < 4; h++) {
      const nx = x + HEADING_DX[h as Heading];
      const ny = y + HEADING_DY[h as Heading];
      if (!g.inBounds(nx, ny) || shut(nx, ny)) continue;
      // Every level of the neighbour whose step towards us lands on our level.
      for (let ln = 0; ln < g.levels(nx, ny); ln++) {
        const n = (nx + ny * g.width) * L + ln;
        if (dist[n] !== -1 || g.stepTarget(nx, ny, ln, ((h + 2) % 4) as Heading) !== l) continue;
        dist[n] = dist[st]! + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/** The free neighbour step (heading and landing level) that gets closest to the player, or undefined to wait. */
function nextStep(world: World, state: SimState, e: EnemyState, dist: Int32Array, occupied: Set<string>): [Heading, number] | undefined {
  const g = world.grid;
  const L = CellGrid.LEVELS;
  const here = dist[(e.cx + e.cy * g.width) * L + e.level]!;
  let best: [Heading, number] | undefined;
  let bestD = here < 0 ? Infinity : here;
  for (let h = 0 as Heading; h < 4; h = (h + 1) as Heading) {
    const nx = e.cx + HEADING_DX[h];
    const ny = e.cy + HEADING_DY[h];
    const lands = g.stepTarget(e.cx, e.cy, e.level, h);
    if (lands < 0 || occupied.has(cellKey(nx, ny))) continue;
    const d = dist[(nx + ny * g.width) * L + lands]!;
    if (d < 0 || d >= bestD) continue;
    best = [h, lands];
    bestD = d;
  }
  return best;
}

function updatePose(world: World, state: SimState, e: EnemyState, def: EnemyDef): void {
  const g = world.grid;
  const [tx, ty] = g.center(e.cx, e.cy);
  // Floors as they are now: a lift carries whoever stands on it.
  const toZ = floorNow(world, state, e.cx, e.cy, e.level);
  if (e.stepTick === 0) {
    [e.x, e.y, e.z] = [tx, ty, toZ];
    return;
  }
  const t = e.stepTick / stepTicksOf(e, def);
  const [fx, fy] = g.center(e.fromCx, e.fromCy);
  const fz = floorNow(world, state, e.fromCx, e.fromCy, e.fromLevel);
  e.x = fx + (tx - fx) * t;
  e.y = fy + (ty - fy) * t;
  e.z = fz + (toZ - fz) * t;
}

/**
 * Lifts, for an enemy about to step from its cell to (nx, ny): the same rules as the player's.
 * Never on or off a moving lift. Onto one that is not level: call it (unless the player is
 * aboard) and wait. Off one towards a floor it is not level with: send it there (ride) and wait;
 * and the way off must be open at the lift's real height.
 */
function liftAllows(world: World, state: SimState, e: EnemyState, nx: number, ny: number, lands: number): boolean {
  const from = liftAtCell(world, e.cx, e.cy);
  const to = liftAtCell(world, nx, ny);
  if (from < 0 && to < 0) return true;
  if ((from >= 0 && liftMoving(world, state, from)) || (to >= 0 && liftMoving(world, state, to))) return false;
  const here = floorNow(world, state, e.cx, e.cy, e.level);
  const there = floorNow(world, state, nx, ny, lands);
  if (to >= 0 && Math.abs(there - here) > MAX_STEP) {
    if (!playerAboard(world, state, to)) callLift(world, state, to, here);
    return false;
  }
  if (from >= 0 && to < 0) {
    if (Math.abs(there - here) > MAX_STEP && there > here) {
      callLift(world, state, from, there);
      return false;
    }
    const g = world.grid;
    const fromCeil = g.span(e.cx, e.cy, e.level)![1];
    const toCeil = g.span(nx, ny, lands)![1];
    if (Math.min(fromCeil, toCeil) - Math.max(here, there) < PLAYER_HEIGHT) {
      // A lower floor behind the wall of a raised lift: ride down to it.
      if (there < here) callLift(world, state, from, there);
      return false;
    }
  }
  return true;
}

function playerAboard(world: World, state: SimState, lift: number): boolean {
  const p = state.player;
  return p.level === 0 && world.lifts[lift]!.cells.includes(p.cx + p.cy * world.grid.width);
}

/** Enemies go direct unless their index and variant make them flank: -1 direct, 0 left, 1 right. */
export function flankSide(index: number, variant: number): number {
  const k = (index * 7 + variant * 3) % 5;
  return k === 1 ? 0 : k === 3 ? 1 : -1;
}
/** Flankers make for a point this many cells to the player's side … */
const FLANK_OFFSET = 3;
/** … until their path to the player is this short. */
const FLANK_CLOSE = 4;

/**
 * A distance field towards a point FLANK_OFFSET cells to the player's left (side 0) or right (1),
 * across the player's facing: the reachable cell there closest to that far from the player (by
 * path), or null when there is none.
 */
function flankField(world: World, state: SimState, main: Int32Array, side: number): Int32Array | null {
  const g = world.grid;
  const L = CellGrid.LEVELS;
  const p = state.player;
  const sign = side === 0 ? 1 : -1;
  const tx = Math.round(p.cx - dsin(p.angle) * FLANK_OFFSET * sign);
  const ty = Math.round(p.cy + dcos(p.angle) * FLANK_OFFSET * sign);
  let target = -1;
  let score = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (!g.inBounds(x, y)) continue;
      for (let l = 0; l < g.levels(x, y); l++) {
        const d = main[(x + y * g.width) * L + l]!;
        if (d < 2) continue;
        const s = Math.abs(dx) + Math.abs(dy) + Math.abs(d - FLANK_OFFSET) * 2;
        if (s < score) [target, score] = [(x + y * g.width) * L + l, s];
      }
    }
  }
  if (target < 0) return null;
  // Path distance to the target, following steps in reverse (as distanceField does to the player).
  const dist = new Int32Array(g.width * g.height * L).fill(-1);
  dist[target] = 0;
  const queue = [target];
  for (let qi = 0; qi < queue.length; qi++) {
    const st = queue[qi]!;
    const l = st % L;
    const c = (st - l) / L;
    const x = c % g.width;
    const y = (c - x) / g.width;
    for (let h = 0; h < 4; h++) {
      const nx = x + HEADING_DX[h as Heading];
      const ny = y + HEADING_DY[h as Heading];
      if (!g.inBounds(nx, ny)) continue;
      const door = doorAtCell(world, nx, ny);
      if (door >= 0 && world.doors[door]!.kind !== DoorKind.Auto && state.doors[door]! < DOOR_OPEN_TICKS) continue;
      for (let ln = 0; ln < g.levels(nx, ny); ln++) {
        const n = (nx + ny * g.width) * L + ln;
        if (dist[n] !== -1 || g.stepTarget(nx, ny, ln, ((h + 2) % 4) as Heading) !== l) continue;
        dist[n] = dist[st]! + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/**
 * The point of the player an enemy can see from its eye (their chest, else their head), or null:
 * a 3D line, so floors between storeys, ledges, catwalks and raised lifts all block it.
 */
export function sightLine(world: World, state: SimState, e: EnemyState, def: EnemyDef): { x: number; y: number; z: number } | null {
  const p = state.player;
  const eye = e.z + def.height * EYE;
  for (const z of [p.z + AIM_HEIGHT, p.z + PLAYER_EYE_HEIGHT]) {
    if (clearLine(world, state, e.x, e.y, eye, p.x, p.y, z)) return { x: p.x, y: p.y, z };
  }
  return null;
}

function sees(world: World, state: SimState, e: EnemyState, def: EnemyDef, cells: number): boolean {
  const p = state.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const reach = cells * CELL_SIZE;
  return dx * dx + dy * dy <= reach * reach && sightLine(world, state, e, def) !== null;
}

function adjacent(e: EnemyState, x: number, y: number): boolean {
  return Math.abs(e.cx - x) + Math.abs(e.cy - y) === 1;
}

/** A charger rushes far faster than it walks. */
const stepTicksOf = (e: EnemyState, def: EnemyDef) => (e.mode === 'charge' ? CHARGE_STEP_TICKS : def.stepTicks);

/** A warden's shield turns towards the player, at most SHIELD_TURN a tick. */
function turnShield(state: SimState, e: EnemyState): void {
  const p = state.player;
  const tx = p.x - e.x;
  const ty = p.y - e.y;
  const len = Math.sqrt(tx * tx + ty * ty);
  if (len < 1) return;
  const fx = e.fx ?? 1;
  const fy = e.fy ?? 0;
  const ux = tx / len;
  const uy = ty / len;
  if (fx * ux + fy * uy >= dcos(SHIELD_TURN)) {
    [e.fx, e.fy] = [ux, uy];
    return;
  }
  const a = fx * uy - fy * ux >= 0 ? SHIELD_TURN : -SHIELD_TURN;
  const c = dcos(a);
  const s = dsin(a);
  [e.fx, e.fy] = [fx * c - fy * s, fx * s + fy * c];
}

/**
 * The heading of a straight lane from a charger to the player (same row or column, 2 to its range
 * cells away, on its level, every cell between open and free), or undefined.
 */
function chargeLane(world: World, state: SimState, e: EnemyState, def: EnemyDef, occupied: Set<string>): number | undefined {
  const p = state.player;
  if (p.cx !== e.cx && p.cy !== e.cy) return undefined;
  if (Math.abs(p.z - e.z) > MAX_STEP * 2) return undefined;
  const dist = Math.abs(p.cx - e.cx) + Math.abs(p.cy - e.cy);
  if (dist < 2 || dist > def.range) return undefined;
  const h = (p.cx > e.cx ? 0 : p.cy > e.cy ? 1 : p.cx < e.cx ? 2 : 3) as Heading;
  let [x, y, level] = [e.cx, e.cy, e.level];
  for (let k = 1; k < dist; k++) {
    if (!laneOpen(world, state, x, y, level, h, occupied)) return undefined;
    x += HEADING_DX[h];
    y += HEADING_DY[h];
  }
  return h;
}

/** Whether a rush can step from (x, y) along h: on the same level, no closed door, nobody there. */
function laneOpen(world: World, state: SimState, x: number, y: number, level: number, h: Heading, occupied: Set<string>): boolean {
  const nx = x + HEADING_DX[h];
  const ny = y + HEADING_DY[h];
  if (world.grid.stepTarget(x, y, level, h) !== level || occupied.has(cellKey(nx, ny))) return false;
  if (liftAtCell(world, nx, ny) >= 0 || liftAtCell(world, x, y) >= 0) return false;
  const door = doorAtCell(world, nx, ny);
  return door < 0 || state.doors[door]! >= DOOR_OPEN_TICKS;
}

/**
 * One cell of a charger's rush: the player in the next cell is struck (the rush ends), anything
 * else in the way stuns it (a crash); otherwise on it goes, until the rush runs out.
 */
function rush(world: World, state: SimState, e: EnemyState, def: EnemyDef, index: number, occupied: Set<string>): void {
  const p = state.player;
  const h = (e.heading ?? 0) as Heading;
  const nx = e.cx + HEADING_DX[h];
  const ny = e.cy + HEADING_DY[h];
  const end = () => {
    e.mode = 'chase';
    e.cooldown = def.cooldown;
  };
  if ((nx === p.cx && ny === p.cy) || (p.stepTick > 0 && nx === p.fromCx && ny === p.fromCy)) {
    state.events.push({ type: 'attack', enemy: index });
    if (Math.abs(p.z - e.z) <= MAX_STEP * 2) hurtPlayer(state, def.damage, { x: e.x, y: e.y });
    return end();
  }
  if (e.timer-- <= 0) return end();
  if (!laneOpen(world, state, e.cx, e.cy, e.level, h, occupied)) {
    state.events.push({ type: 'crash', enemy: index });
    e.mode = 'pain';
    e.timer = CHARGE_STUN;
    e.cooldown = def.cooldown;
    return;
  }
  occupied.add(cellKey(nx, ny));
  e.fromCx = e.cx;
  e.fromCy = e.cy;
  e.fromLevel = e.level;
  e.cx = nx;
  e.cy = ny;
  e.stepTick = 1;
}

function canAttack(world: World, state: SimState, e: EnemyState, def: EnemyDef, occupied: Set<string>): boolean {
  // Melee (and a bloater's burst) needs the player next to it at about the same height (not on the catwalk above).
  if (def.attack === 'melee' || def.attack === 'blast') return adjacent(e, state.player.cx, state.player.cy) && Math.abs(state.player.z - e.z) <= MAX_STEP * 2;
  if (def.attack === 'charge') return chargeLane(world, state, e, def, occupied) !== undefined;
  return sees(world, state, e, def, def.range);
}

function attack(world: World, state: SimState, e: EnemyState, def: EnemyDef, index: number): void {
  const p = state.player;
  state.events.push({ type: 'attack', enemy: index });
  if (def.attack === 'melee') {
    // Lands only if the player is still next to it: stepping away during the wind-up dodges.
    if (adjacent(e, p.cx, p.cy) && Math.abs(p.z - e.z) <= MAX_STEP * 2) hurtPlayer(state, def.damage, { x: e.x, y: e.y });
    return;
  }
  if (def.attack === 'hitscan') {
    // Breaking line of sight during the wind-up dodges.
    if (sightLine(world, state, e, def)) hurtPlayer(state, def.damage, { x: e.x, y: e.y });
    return;
  }
  const boss = isBoss(e.type);
  if (def.shot === 'lob') return fireLob(world, state, e, def, boss);
  if (def.shot === 'homing') return fireHoming(state, e, def, def.volley, def.spread, boss);
  // Projectiles, aimed where the player is now, fanned for volleys. An even fan is shifted half a
  // step (to alternating sides, volley by volley) so one projectile always flies at the aim:
  // a symmetric even fan leaves a gap exactly where the player stands.
  const sx = e.x;
  const sy = e.y;
  const sz = e.z + def.height * EYE;
  const ax = p.x - sx;
  const ay = p.y - sy;
  const az = p.z + AIM_HEIGHT - sz;
  const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  const volley = def.volley + (boss ? volleyBonus(e) : 0);
  for (let k = 0; k < volley; k++) {
    const shift = volley % 2 === 0 ? (state.tick % 2 === 0 ? 0.5 : -0.5) : 0;
    const a = (k - (volley - 1) / 2 + shift) * def.spread;
    const c = dcos(a);
    const s = dsin(a);
    const dx = (ax * c - ay * s) / len;
    const dy = (ax * s + ay * c) / len;
    state.projectiles.push({
      x: sx, y: sy, z: sz,
      vx: dx * def.projectileSpeed, vy: dy * def.projectileSpeed, vz: (az / len) * def.projectileSpeed,
      damage: def.damage,
      ttl: 0,
      ...(boss ? { unblockable: true } : {}),
    });
  }
}
