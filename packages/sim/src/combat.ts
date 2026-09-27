import {
  defOf,
  WEAPONS,
  WEAPON_SWITCH_TICKS,
  MELEE_DAMAGE,
  MELEE_FIRST_HIT,
  MELEE_HITS,
  MELEE_HIT_INTERVAL,
  MELEE_IFRAMES,
  MELEE_TICKS,
  MELEE_REACH,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
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
/** The chainsword's arc: just over 45° either side of the aim, so the diagonals ahead count exactly. */
const MELEE_ARC_COS = 0.7;
/** Projectiles expire after this many ticks, hit or not. */
const PROJECTILE_TTL = 600;

/** Damages the player; `from` (map units) is where the hit came from, for the HUD's direction glow. */
export function hurtPlayer(state: SimState, amount: number, from?: { x: number; y: number }): void {
  if (state.dead) return;
  const p = state.player;
  if (p.melee > 0 && p.melee <= MELEE_IFRAMES + 1) {
    state.events.push(from ? { type: 'shielded', amount, from } : { type: 'shielded', amount });
    return;
  }
  p.health = Math.max(0, p.health - amount);
  state.events.push(from ? { type: 'hurt', amount, from } : { type: 'hurt', amount });
  if (p.health === 0) {
    state.dead = true;
    state.events.push({ type: 'death' });
  }
}

/**
 * The player's weapons (see WEAPONS). With an enemy right in front (within MELEE_REACH and 45° of
 * the aim), firing swings the chainsword instead (so does `melee`, anywhere): see MELEE_TICKS.
 * Otherwise the gun in hand fires its pellets, each hitting the nearest enemy before any wall, and
 * a bolt bursts where it hits. Each shot spends one round of that gun's magazine; the last starts
 * its reload (so does `reload`, early), and nothing fires until it ends. `select` switches guns
 * (WEAPON_SWITCH_TICKS, dropping a reload in progress). The chainsword needs no rounds.
 */
export function playerFire(world: World, state: SimState, trigger: boolean, reload = false, melee = false, select = -1): void {
  const p = state.player;
  if (p.fireCooldown > 0) p.fireCooldown--;
  if (p.reload > 0 && --p.reload === 0) {
    p.mags[p.weapon] = WEAPONS[p.weapon]!.magSize;
    state.events.push({ type: 'reloaded' });
  }
  const startReload = () => {
    p.reload = WEAPONS[p.weapon]!.reloadTicks;
    state.events.push({ type: 'reload' });
  };
  if (p.switching > 0 && --p.switching === 0 && p.mags[p.weapon] === 0) startReload();
  if (select >= 0 && select < WEAPONS.length && select !== p.weapon && p.melee === 0) {
    p.weapon = select;
    p.switching = WEAPON_SWITCH_TICKS;
    p.reload = 0;
    p.fireCooldown = 0; // the new gun is ready once it is up
    state.events.push({ type: 'switch', weapon: select });
  }
  const gun = WEAPONS[p.weapon]!;
  if (reload && p.reload === 0 && p.switching === 0 && p.mags[p.weapon]! < gun.magSize) startReload();

  // Everyone alive within the chainsword's reach and arc.
  const fx = dcos(p.angle);
  const fy = dsin(p.angle);
  const inReach = () =>
    state.enemies.flatMap((e, i) => {
      if (e.mode === 'dead') return [];
      const vx = e.x - p.x;
      const vy = e.y - p.y;
      const d = Math.sqrt(vx * vx + vy * vy);
      return d <= MELEE_REACH && (d === 0 || (vx * fx + vy * fy) / d >= MELEE_ARC_COS) ? [i] : [];
    });
  if (p.melee === 0 && p.fireCooldown === 0 && (melee || (trigger && inReach().length))) {
    p.melee = 1;
    state.events.push({ type: 'saw' });
    makeNoise(world, state);
  }
  if (p.melee > 0) {
    // Grinding: every hit lands on everyone in reach; nothing else until the attack ends.
    const t = p.melee - 1 - MELEE_FIRST_HIT;
    if (t >= 0 && t % MELEE_HIT_INTERVAL === 0 && t / MELEE_HIT_INTERVAL < MELEE_HITS) {
      const struck = inReach();
      for (const i of struck) state.events.push({ type: 'melee', enemy: i });
      if (struck.length) damage(world, state, new Map(struck.map((i) => [i, MELEE_DAMAGE])));
    }
    if (++p.melee > MELEE_TICKS) p.melee = 0;
    return;
  }
  if (!trigger || p.fireCooldown > 0 || p.switching > 0) return;

  // A shot needs a loaded magazine.
  if (p.reload > 0) return;
  p.fireCooldown = gun.cooldown;
  state.events.push({ type: 'shot', weapon: p.weapon });
  p.mags[p.weapon]!--;
  if (p.mags[p.weapon] === 0) startReload();
  makeNoise(world, state);
  const ox = p.x;
  const oy = p.y;
  const oz = p.z + PLAYER_EYE_HEIGHT;
  const hits = new Map<number, number>();
  const add = (i: number, amount: number) => hits.set(i, (hits.get(i) ?? 0) + amount);
  const pellets = gun.pellets === 1 ? [gun.spread[p.shots % gun.spread.length]!] : gun.spread.slice(0, gun.pellets);
  p.shots++;
  for (const [yaw, pitch] of pellets) {
    const cp = dcos(p.pitch + pitch);
    const dx = cp * dcos(p.angle + yaw);
    const dy = cp * dsin(p.angle + yaw);
    const dz = dsin(p.pitch + pitch);
    const { target, t } = pelletTarget(world, state, ox, oy, oz, dx, dy, dz);
    if (target >= 0) add(target, gun.damage);
    if (gun.splashRadius > 0 && t < WEAPON_RANGE) {
      // The bolt bursts where it hit: everyone within the splash radius (of their body) is caught.
      const bx = ox + dx * t;
      const by = oy + dy * t;
      const bz = oz + dz * t;
      state.events.push({ type: 'blast', x: bx, y: by, z: bz });
      state.enemies.forEach((e, i) => {
        if (e.mode === 'dead') return;
        const def = defOf(world.enemyDefs, e);
        const ex = e.x - bx;
        const ey = e.y - by;
        const reach = gun.splashRadius + def.radius;
        if (ex * ex + ey * ey <= reach * reach && bz >= e.z - gun.splashRadius && bz <= e.z + def.height + gun.splashRadius) add(i, gun.splashDamage);
      });
    }
  }
  damage(world, state, hits);
}

/**
 * The enemy a ray hits before any wall (-1 if none), and how far along the ray it (or the wall)
 * is. Rays test each enemy's upright cylinder (side only).
 */
function pelletTarget(world: World, state: SimState, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { target: number; t: number } {
  let nearest = castRay(world, state, ox, oy, oz, dx, dy, dz, WEAPON_RANGE);
  let target = -1;
  const a = dx * dx + dy * dy;
  if (a <= 1e-9) return { target: -1, t: nearest };
  state.enemies.forEach((e, i) => {
    if (e.mode === 'dead') return;
    const def = defOf(world.enemyDefs, e);
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
  return { target, t: nearest };
}

/** Applies a shot's (or strike's) damage per enemy: one hit event each, kills, flinches, wake-ups. */
function damage(world: World, state: SimState, hits: ReadonlyMap<number, number>): void {
  for (const [i, amount] of hits) {
    const e = state.enemies[i]!;
    const def = defOf(world.enemyDefs, e);
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
      // It came from back along its flight.
      hurtPlayer(state, q.damage, { x: q.x - q.vx * 16, y: q.y - q.vy * 16 });
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
