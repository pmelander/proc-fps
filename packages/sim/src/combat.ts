import {
  ARMOR,
  BERSERK,
  OVERCHARGE,
  UNDYING_HEALTH,
  BLAST_EDGE,
  BLAST_RADIUS,
  type EnemyDef,
  SHIELD_ARC_COS,
  GRENADE,
  defOf,
  falloffAt,
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
import { magSizeOf, reloadTicksOf } from './world.js';
import { floorNow } from './lifts.js';
import { castRay, cellOpen } from './raycast.js';
import { HOMING, steer } from './shots.js';
import type { EnemyState, Projectile, SimState } from './state.js';
import type { World } from './world.js';

const PROJECTILE_RADIUS = 6;
/** The chainsword's arc: just over 45° either side of the aim, so the diagonals ahead count exactly. */
const MELEE_ARC_COS = 0.7;
/** Projectiles expire after this many ticks, hit or not. */
const PROJECTILE_TTL = 600;

/**
 * Damages the player; `from` (map units) is where the hit came from, for the HUD's direction glow.
 * The chainsword's invulnerability turns it away, unless it is `unblockable` (a boss's).
 */
export function hurtPlayer(state: SimState, amount: number, from?: { x: number; y: number }, unblockable = false): void {
  if (state.dead) return;
  const p = state.player;
  if (!unblockable && p.melee > 0 && p.melee <= MELEE_IFRAMES + 1) {
    state.events.push(from ? { type: 'shielded', amount, from } : { type: 'shielded', amount });
    return;
  }
  // Armour soaks up its share, as long as it lasts.
  const soak = Math.min(p.armor, Math.round(amount * ARMOR.absorb));
  p.armor -= soak;
  amount -= soak;
  if (amount >= p.health && p.undying) {
    // Undying: the killing blow leaves the player standing, once a level.
    p.undying = false;
    amount = Math.max(0, p.health - UNDYING_HEALTH);
    state.events.push({ type: 'undying' });
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
    p.mags[p.weapon] = magSizeOf(world, p.weapon);
    state.events.push({ type: 'reloaded' });
  }
  const startReload = () => {
    p.reload = reloadTicksOf(world, p.weapon);
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
  if (reload && p.reload === 0 && p.switching === 0 && p.mags[p.weapon]! < magSizeOf(world, p.weapon)) startReload();

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
      if (struck.length) {
        // Berserk: savage hits, and each one that lands heals.
        const berserk = p.berserk > 0;
        damage(world, state, new Map(struck.map((i) => [i, MELEE_DAMAGE * (berserk ? BERSERK.melee : 1)])), 'melee');
        // Berserk and the Bloodlust perk heal for every enemy struck.
        const leech = (berserk ? BERSERK.leech : 0) + world.mods.meleeLeech;
        if (leech) p.health = Math.min(world.mods.maxHealth, p.health + leech * struck.length);
      }
    }
    if (++p.melee > MELEE_TICKS) p.melee = 0;
    return;
  }
  if (!trigger || p.fireCooldown > 0 || p.switching > 0) return;

  // A shot needs a loaded magazine.
  if (p.reload > 0) return;
  // Overcharge: harder hits, faster shots.
  const boost = (p.overcharge > 0 ? OVERCHARGE.damage : 1) * world.mods.damageScale;
  p.fireCooldown = p.overcharge > 0 ? Math.round(gun.cooldown / OVERCHARGE.rate) : gun.cooldown;
  state.events.push({ type: 'shot', weapon: p.weapon });
  p.mags[p.weapon]!--;
  if (p.mags[p.weapon] === 0) startReload();
  makeNoise(world, state);
  const ox = p.x;
  const oy = p.y;
  const oz = p.z + PLAYER_EYE_HEIGHT;
  // Direct hits and bursts are kept apart: a warden's shield stops the first, not the second.
  const hits = new Map<number, number>();
  const splashed = new Map<number, number>();
  const add = (i: number, amount: number, into = hits) => into.set(i, (into.get(i) ?? 0) + amount);
  const pellets = gun.pellets === 1 ? [gun.spread[p.shots % gun.spread.length]!] : gun.spread.slice(0, gun.pellets);
  p.shots++;
  for (const [yaw, pitch] of pellets) {
    const cp = dcos(p.pitch + pitch);
    const dx = cp * dcos(p.angle + yaw);
    const dy = cp * dsin(p.angle + yaw);
    const dz = dsin(p.pitch + pitch);
    const { target, t } = pelletTarget(world, state, ox, oy, oz, dx, dy, dz);
    if (target >= 0) add(target, Math.max(1, Math.round(gun.damage * boost * falloffAt(gun, t))));
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
        if (ex * ex + ey * ey <= reach * reach && bz >= e.z - gun.splashRadius && bz <= e.z + def.height + gun.splashRadius) add(i, gun.splashDamage * boost, splashed);
      });
    }
  }
  damage(world, state, hits, 'shot');
  damage(world, state, splashed, 'splash');
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

/** Whether a warden's shield is up and faces the player: up unless it is winding up a shot, flinching or dead. */
export function shieldStops(state: SimState, e: EnemyState, def: EnemyDef): boolean {
  if (!def.shield || e.mode === 'windup' || e.mode === 'pain' || e.mode === 'dead') return false;
  const p = state.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return len > 0 && ((e.fx ?? 1) * dx + (e.fy ?? 0) * dy) / len >= SHIELD_ARC_COS;
}

/**
 * Applies damage per enemy: one hit event each, kills, flinches, wake-ups. `kind` says what dealt
 * it: a warden's shield stops the player's direct shots (not bursts, blasts or the chainsword), and
 * a bloater killed by anything bursts.
 */
function damage(world: World, state: SimState, hits: ReadonlyMap<number, number>, kind: 'shot' | 'splash' | 'melee' | 'blast'): void {
  const burst: number[] = [];
  for (const [i, amount] of hits) {
    const e = state.enemies[i]!;
    if (e.mode === 'dead') continue;
    const def = defOf(world.enemyDefs, e);
    if (kind === 'shot' && shieldStops(state, e, def)) {
      state.events.push({ type: 'blocked', enemy: i });
      continue;
    }
    e.hp -= amount;
    state.events.push({ type: 'hit', enemy: i });
    if (e.hp <= 0) {
      e.mode = 'dead';
      e.stepTick = 0;
      state.events.push({ type: 'kill', enemy: i });
      if (def.attack === 'blast') burst.push(i);
    } else if (e.mode === 'idle') {
      alert(e, 1);
    } else if (def.pain > 0) {
      // Flinch: interrupts a wind-up.
      e.mode = 'pain';
      e.timer = def.pain;
    }
  }
  for (const i of burst) blast(world, state, i);
}

/** A bloater bursts where it stands (next to the player, its fuse run out): it dies in its own blast. */
export function detonate(world: World, state: SimState, index: number): void {
  const e = state.enemies[index]!;
  if (e.mode === 'dead') return;
  e.hp = 0;
  e.mode = 'dead';
  e.stepTick = 0;
  state.events.push({ type: 'kill', enemy: index });
  blast(world, state, index);
}

/**
 * A dead bloater's burst: everyone within BLAST_RADIUS of it (to their body) takes its damage,
 * falling to BLAST_EDGE at the edge, the player included (the chainsword's invulnerability turns
 * it away); other bloaters caught go up in turn.
 */
function blast(world: World, state: SimState, index: number): void {
  const e = state.enemies[index]!;
  const def = defOf(world.enemyDefs, e);
  const z = e.z + def.height * 0.5;
  state.events.push({ type: 'explode', x: e.x, y: e.y, z });
  makeNoise(world, state);
  const falloff = (d: number) => Math.round(def.damage * (BLAST_EDGE + (1 - BLAST_EDGE) * (1 - d / BLAST_RADIUS)));
  const p = state.player;
  const pd = Math.max(0, Math.sqrt((p.x - e.x) ** 2 + (p.y - e.y) ** 2) - PLAYER_RADIUS);
  if (pd <= BLAST_RADIUS && Math.abs(p.z - e.z) <= PLAYER_HEIGHT) hurtPlayer(state, falloff(pd), { x: e.x, y: e.y });
  const hits = new Map<number, number>();
  state.enemies.forEach((o, i) => {
    if (i === index || o.mode === 'dead') return;
    const od = defOf(world.enemyDefs, o);
    const d = Math.max(0, Math.sqrt((o.x - e.x) ** 2 + (o.y - e.y) ** 2) - od.radius);
    if (d <= BLAST_RADIUS && Math.abs(o.z - e.z) <= PLAYER_HEIGHT) hits.set(i, falloff(d));
  });
  damage(world, state, hits, 'blast');
}

/** Moves projectiles; they stop at walls, floors, ceilings and closed doors, or hit the player. */
/** Lobs a grenade on `throwIt`, if one is carried and the launcher is ready (never mid-swing). */
export function playerGrenade(state: SimState, throwIt: boolean): void {
  const p = state.player;
  if (p.grenadeCooldown > 0) p.grenadeCooldown--;
  if (!throwIt || p.grenades <= 0 || p.grenadeCooldown > 0 || p.melee > 0) return;
  p.grenades--;
  p.grenadeCooldown = GRENADE.cooldown;
  const cp = dcos(p.pitch);
  const dx = cp * dcos(p.angle);
  const dy = cp * dsin(p.angle);
  const dz = dsin(p.pitch) + GRENADE.lift;
  state.grenades.push({
    x: p.x + dx * 20, y: p.y + dy * 20, z: p.z + PLAYER_EYE_HEIGHT - 10,
    vx: dx * GRENADE.speed, vy: dy * GRENADE.speed, vz: dz * GRENADE.speed, age: 0,
  });
  state.events.push({ type: 'grenade' });
}

/**
 * Grenades in flight: they arc under gravity and burst on touching an enemy, a wall, a floor, a
 * ceiling or a catwalk (or at the end of the fuse), hurting every enemy within GRENADE.radius:
 * GRENADE.damage at the centre, falling to GRENADE.edgeDamage at the edge.
 */
export function stepGrenades(world: World, state: SimState): void {
  const g = world.grid;
  state.grenades = state.grenades.filter((n) => {
    const [px, py, pz] = [n.x, n.y, n.z];
    n.vz -= GRENADE.gravity;
    n.x += n.vx;
    n.y += n.vy;
    n.z += n.vz;
    n.age++;
    let burst = n.age >= GRENADE.fuse;
    const struck = state.enemies.some((e) => {
      if (e.mode === 'dead') return false;
      const def = defOf(world.enemyDefs, e);
      const ex = n.x - e.x;
      const ey = n.y - e.y;
      return ex * ex + ey * ey <= (def.radius + 6) ** 2 && n.z >= e.z && n.z <= e.z + def.height;
    });
    const [cx, cy] = g.cellOf(n.x, n.y);
    if (struck) burst = true;
    else if (!cellOpen(world, state, cx, cy)) {
      // Into a wall: burst where it was, on this side of it.
      [n.x, n.y, n.z] = [px, py, pz];
      burst = true;
    } else {
      const sec = world.map.sectors[g.sectorAt(cx, cy)]!;
      const floor = floorNow(world, state, cx, cy);
      if (n.z <= floor || n.z >= sec.ceil || (sec.slab && n.z >= sec.slab.bottom && n.z <= sec.slab.top)) {
        n.z = Math.max(floor, Math.min(n.z, sec.ceil));
        burst = true;
      }
    }
    if (!burst) return true;
    explode(world, state, n.x, n.y, n.z);
    return false;
  });
}

function explode(world: World, state: SimState, x: number, y: number, z: number): void {
  state.events.push({ type: 'explode', x, y, z });
  makeNoise(world, state);
  const hits = new Map<number, number>();
  state.enemies.forEach((e, i) => {
    if (e.mode === 'dead') return;
    const def = defOf(world.enemyDefs, e);
    // Distance from the burst to the nearest point of the enemy's body.
    const horizontal = Math.max(0, Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2) - def.radius);
    const vertical = z < e.z ? e.z - z : z > e.z + def.height ? z - e.z - def.height : 0;
    const d = Math.sqrt(horizontal * horizontal + vertical * vertical);
    if (d > GRENADE.radius) return;
    hits.set(i, Math.round(GRENADE.edgeDamage + (GRENADE.damage - GRENADE.edgeDamage) * (1 - d / GRENADE.radius)));
  });
  damage(world, state, hits, 'blast');
}

export function stepProjectiles(world: World, state: SimState): void {
  const p = state.player;
  const g = world.grid;
  const born: Projectile[] = [];
  const burst = (q: Projectile) => {
    if (!q.splash) return;
    state.events.push({ type: 'splash', x: q.x, y: q.y, z: q.z });
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const reach = q.splash + PLAYER_RADIUS;
    if (dx * dx + dy * dy <= reach * reach && q.z >= p.z - q.splash && q.z <= p.z + PLAYER_HEIGHT + q.splash) {
      hurtPlayer(state, q.damage, { x: q.x - q.vx * 16, y: q.y - q.vy * 16 }, q.unblockable === true);
    }
  };
  state.projectiles = state.projectiles.filter((q) => {
    const children = steer(state, q);
    if (children) {
      state.events.push({ type: 'split', x: q.x, y: q.y, z: q.z });
      born.push(...children);
      return false;
    }
    q.x += q.vx;
    q.y += q.vy;
    q.z += q.vz;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const reach = PLAYER_RADIUS + PROJECTILE_RADIUS;
    if (dx * dx + dy * dy < reach * reach && q.z >= p.z && q.z <= p.z + PLAYER_HEIGHT) {
      // It came from back along its flight.
      if (q.splash) burst(q);
      else hurtPlayer(state, q.damage, { x: q.x - q.vx * 16, y: q.y - q.vy * 16 }, q.unblockable === true);
      return false;
    }
    const [cx, cy] = g.cellOf(q.x, q.y);
    let hit = !cellOpen(world, state, cx, cy);
    if (!hit) {
      const sec = world.map.sectors[g.sectorAt(cx, cy)]!;
      if (q.z < floorNow(world, state, cx, cy) || q.z > sec.ceil) hit = true;
      else if (sec.slab && q.z >= sec.slab.bottom && q.z <= sec.slab.top) hit = true;
    }
    if (hit) {
      // Burst a step back along the flight, clear of the surface it struck.
      if (q.splash) burst({ ...q, x: q.x - q.vx, y: q.y - q.vy, z: q.z - q.vz });
      return false;
    }
    return ++q.ttl <= (q.homing ? HOMING.life : PROJECTILE_TTL);
  });
  state.projectiles.push(...born);
}
