import { ALERT_TICKS, CELL_SIZE, CellGrid, DoorKind, defOf, HEADING_DX, HEADING_DY, MAX_STEP, NOISE_CELLS, SIGHT_CELLS, dcos, dsin, type EnemyDef, type Heading } from '@proc-fps/core';
import { hurtPlayer } from './combat.js';
import { lineOfSight } from './raycast.js';
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
 * are walls to them.
 */
export function stepEnemies(world: World, state: SimState): void {
  const occupied = occupancy(state);
  let field: Int32Array | undefined;
  const distance = () => (field ??= distanceField(world, state));

  state.enemies.forEach((e, i) => {
    if (e.mode === 'dead') return;
    const def = defOf(world.enemyDefs, e);
    if (e.cooldown > 0) e.cooldown--;
    if (e.stepTick > 0 && ++e.stepTick > def.stepTicks) e.stepTick = 0;
    updatePose(world, e, def);

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
        attack(world, state, e, def, i);
        e.cooldown = def.cooldown;
        e.mode = 'chase';
        break;
      case 'chase': {
        if (e.stepTick !== 0) break;
        if (e.cooldown === 0 && canAttack(world, state, e, def)) {
          e.mode = 'windup';
          e.timer = def.windup;
          state.events.push({ type: 'windup', enemy: i });
          break;
        }
        const next = nextStep(world, state, e, distance(), occupied);
        if (next === undefined) break;
        const [heading, lands] = next;
        const nx = e.cx + HEADING_DX[heading];
        const ny = e.cy + HEADING_DY[heading];
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
  out.add(cellKey(p.cx, p.cy)).add(cellKey(p.fromCx, p.fromCy));
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
    if (world.liftAt[x + y * g.width]! >= 0) return true; // enemies do not ride lifts
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

function updatePose(world: World, e: EnemyState, def: EnemyDef): void {
  const g = world.grid;
  const [tx, ty] = g.center(e.cx, e.cy);
  if (e.stepTick === 0) {
    [e.x, e.y, e.z] = [tx, ty, g.floorAt(e.cx, e.cy, e.level)];
    return;
  }
  const t = e.stepTick / def.stepTicks;
  const [fx, fy] = g.center(e.fromCx, e.fromCy);
  const fz = g.floorAt(e.fromCx, e.fromCy, e.fromLevel);
  e.x = fx + (tx - fx) * t;
  e.y = fy + (ty - fy) * t;
  e.z = fz + (g.floorAt(e.cx, e.cy, e.level) - fz) * t;
}

function sees(world: World, state: SimState, e: EnemyState, def: EnemyDef, cells: number): boolean {
  const p = state.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const reach = cells * CELL_SIZE;
  return dx * dx + dy * dy <= reach * reach && lineOfSight(world, state, e.x, e.y, p.x, p.y);
}

function adjacent(e: EnemyState, x: number, y: number): boolean {
  return Math.abs(e.cx - x) + Math.abs(e.cy - y) === 1;
}

function canAttack(world: World, state: SimState, e: EnemyState, def: EnemyDef): boolean {
  // Melee needs the player next to it at about the same height (not on the catwalk above).
  if (def.attack === 'melee') return adjacent(e, state.player.cx, state.player.cy) && Math.abs(state.player.z - e.z) <= MAX_STEP * 2;
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
    if (lineOfSight(world, state, e.x, e.y, p.x, p.y)) hurtPlayer(state, def.damage, { x: e.x, y: e.y });
    return;
  }
  // Projectiles, aimed where the player is now, fanned for volleys.
  const sx = e.x;
  const sy = e.y;
  const sz = e.z + def.height * EYE;
  const ax = p.x - sx;
  const ay = p.y - sy;
  const az = p.z + AIM_HEIGHT - sz;
  const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  for (let k = 0; k < def.volley; k++) {
    const a = (k - (def.volley - 1) / 2) * def.spread;
    const c = dcos(a);
    const s = dsin(a);
    const dx = (ax * c - ay * s) / len;
    const dy = (ax * s + ay * c) / len;
    state.projectiles.push({
      x: sx, y: sy, z: sz,
      vx: dx * def.projectileSpeed, vy: dy * def.projectileSpeed, vz: (az / len) * def.projectileSpeed,
      damage: def.damage,
      ttl: 0,
    });
  }
}
