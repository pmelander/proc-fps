import {
  FIRE_COOLDOWN,
  MAG_SIZE,
  MELEE_COOLDOWN,
  MELEE_DAMAGE,
  MELEE_REACH,
  PELLETS,
  PELLET_SPREAD,
  PLAYER_DAMAGE,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RELOAD_TICKS,
  WEAPON_RANGE,
  dcos,
  dsin,
} from '@proc-fps/core';
import { alert, makeNoise } from './ai.js';
import { floorNow } from './lifts.js';
import { castRay, cellOpen } from './raycast.js';
import type { SimState } from './state.js';
import type { World } from './world.js';

const PROJECTILE_RADIUS = 6;
/** Projectiles expire after this many ticks, hit or not. */
const PROJECTILE_TTL = 600;

export function hurtPlayer(state: SimState, amount: number): void {
  if (state.dead) return;
  const p = state.player;
  p.health = Math.max(0, p.health - amount);
  state.events.push({ type: 'hurt', amount });
  if (p.health === 0) {
    state.dead = true;
    state.events.push({ type: 'death' });
  }
}

/**
 * Fires when the trigger is held and the weapon is ready. An enemy right in front (within
 * MELEE_REACH and 45° of the aim) takes an automatic melee strike; otherwise the shotgun fires
 * PELLETS pellets in a fixed spread, each hitting the nearest enemy before any wall. Each shot
 * spends one of the cell's MAG_SIZE rounds; the last starts a RELOAD_TICKS reload (so does
 * `reload`, early), and nothing fires until it ends. Melee needs no rounds.
 */
export function playerFire(world: World, state: SimState, trigger: boolean, reload = false): void {
  const p = state.player;
  if (p.fireCooldown > 0) p.fireCooldown--;
  if (p.reload > 0 && --p.reload === 0) {
    p.mag = MAG_SIZE;
    state.events.push({ type: 'reloaded' });
  }
  const startReload = () => {
    p.reload = RELOAD_TICKS;
    state.events.push({ type: 'reload' });
  };
  if (reload && p.reload === 0 && p.mag < MAG_SIZE) startReload();
  if (!trigger || p.fireCooldown > 0) return;

  const fx = dcos(p.angle);
  const fy = dsin(p.angle);
  const close = state.enemies.findIndex((e) => {
    if (e.mode === 'dead') return false;
    const vx = e.x - p.x;
    const vy = e.y - p.y;
    const d = Math.sqrt(vx * vx + vy * vy);
    return d <= MELEE_REACH && (d === 0 || (vx * fx + vy * fy) / d >= Math.SQRT1_2);
  });
  if (close >= 0) {
    p.fireCooldown = MELEE_COOLDOWN;
    state.events.push({ type: 'melee', enemy: close });
    damage(world, state, new Map([[close, MELEE_DAMAGE]]));
    return;
  }

  // Melee needs no ammo; a shot needs a loaded cell.
  if (p.reload > 0) return;
  p.fireCooldown = FIRE_COOLDOWN;
  state.events.push({ type: 'shot' });
  if (--p.mag === 0) startReload();
  makeNoise(world, state);
  const ox = p.x;
  const oy = p.y;
  const oz = p.z + PLAYER_EYE_HEIGHT;
  const hits = new Map<number, number>();
  for (const [yaw, pitch] of PELLET_SPREAD.slice(0, PELLETS)) {
    const cp = dcos(p.pitch + pitch);
    const dx = cp * dcos(p.angle + yaw);
    const dy = cp * dsin(p.angle + yaw);
    const dz = dsin(p.pitch + pitch);
    const target = pelletTarget(world, state, ox, oy, oz, dx, dy, dz);
    if (target >= 0) hits.set(target, (hits.get(target) ?? 0) + PLAYER_DAMAGE);
  }
  damage(world, state, hits);
}

/** The enemy a ray hits before any wall, or -1. Rays test each enemy's upright cylinder (side only). */
function pelletTarget(world: World, state: SimState, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  let nearest = castRay(world, state, ox, oy, oz, dx, dy, dz, WEAPON_RANGE);
  let target = -1;
  const a = dx * dx + dy * dy;
  if (a <= 1e-9) return -1;
  state.enemies.forEach((e, i) => {
    if (e.mode === 'dead') return;
    const def = world.enemyDefs[e.type];
    const fx = ox - e.x;
    const fy = oy - e.y;
    const b = 2 * (dx * fx + dy * fy);
    const c = fx * fx + fy * fy - def.radius * def.radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return;
    let t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) t = c < 0 ? 0 : -1;
    if (t < 0 || t >= nearest) return;
    const z = oz + dz * t;
    if (z < e.z || z > e.z + def.height) return;
    nearest = t;
    target = i;
  });
  return target;
}

/** Applies a shot's (or strike's) damage per enemy: one hit event each, kills, flinches, wake-ups. */
function damage(world: World, state: SimState, hits: ReadonlyMap<number, number>): void {
  for (const [i, amount] of hits) {
    const e = state.enemies[i]!;
    const def = world.enemyDefs[e.type];
    e.hp -= amount;
    state.events.push({ type: 'hit', enemy: i });
    if (e.hp <= 0) {
      e.mode = 'dead';
      e.stepTick = 0;
      state.events.push({ type: 'kill', enemy: i });
    } else if (e.mode === 'idle') {
      alert(e, 1);
    } else if (def.pain > 0) {
      // Flinch: interrupts a wind-up.
      e.mode = 'pain';
      e.timer = def.pain;
    }
  }
}

/** Moves projectiles; they stop at walls, floors, ceilings and closed doors, or hit the player. */
export function stepProjectiles(world: World, state: SimState): void {
  const p = state.player;
  const g = world.grid;
  state.projectiles = state.projectiles.filter((q) => {
    q.x += q.vx;
    q.y += q.vy;
    q.z += q.vz;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const reach = PLAYER_RADIUS + PROJECTILE_RADIUS;
    if (dx * dx + dy * dy < reach * reach && q.z >= p.z && q.z <= p.z + PLAYER_HEIGHT) {
      hurtPlayer(state, q.damage);
      return false;
    }
    const [cx, cy] = g.cellOf(q.x, q.y);
    if (!cellOpen(world, state, cx, cy)) return false;
    const sec = world.map.sectors[g.sectorAt(cx, cy)]!;
    if (q.z < floorNow(world, state, cx, cy) || q.z > sec.ceil) return false;
    if (sec.slab && q.z >= sec.slab.bottom && q.z <= sec.slab.top) return false;
    return ++q.ttl <= PROJECTILE_TTL;
  });
}
