import { ENEMY_DEFS, FIRE_COOLDOWN, PLAYER_DAMAGE, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, WEAPON_RANGE, dcos, dsin } from '@proc-fps/core';
import { alert, makeNoise } from './ai.js';
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

/** Fires when the trigger is held and the weapon is ready; the shot hits the nearest enemy before any wall. */
export function playerFire(world: World, state: SimState, trigger: boolean): void {
  const p = state.player;
  if (p.fireCooldown > 0) p.fireCooldown--;
  if (!trigger || p.fireCooldown > 0) return;
  p.fireCooldown = FIRE_COOLDOWN;
  if (p.ammo <= 0) {
    state.events.push({ type: 'empty' });
    return;
  }
  p.ammo--;
  state.events.push({ type: 'shot' });
  makeNoise(world, state);

  const ox = p.x;
  const oy = p.y;
  const oz = p.z + PLAYER_EYE_HEIGHT;
  const cp = dcos(p.pitch);
  const dx = cp * dcos(p.angle);
  const dy = cp * dsin(p.angle);
  const dz = dsin(p.pitch);
  let nearest = castRay(world, state, ox, oy, oz, dx, dy, dz, WEAPON_RANGE);
  let target = -1;
  // Ray against each enemy's upright cylinder (side only).
  const a = dx * dx + dy * dy;
  if (a > 1e-9) {
    state.enemies.forEach((e, i) => {
      if (e.mode === 'dead') return;
      const def = ENEMY_DEFS[e.type];
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
  }
  if (target < 0) return;
  const e = state.enemies[target]!;
  const def = ENEMY_DEFS[e.type];
  e.hp -= PLAYER_DAMAGE;
  state.events.push({ type: 'hit', enemy: target });
  if (e.hp <= 0) {
    e.mode = 'dead';
    e.stepTick = 0;
    state.events.push({ type: 'kill', enemy: target });
    return;
  }
  if (e.mode === 'idle') alert(e, 1);
  else if (def.pain > 0) {
    // Flinch: interrupts a wind-up.
    e.mode = 'pain';
    e.timer = def.pain;
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
    if (q.z < sec.floor || q.z > sec.ceil) return false;
    return ++q.ttl <= PROJECTILE_TTL;
  });
}
