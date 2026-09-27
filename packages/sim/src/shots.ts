import { dcos, dsin, type EnemyDef } from '@proc-fps/core';
import type { EnemyState, Projectile, SimState } from './state.js';
import type { World } from './world.js';

/**
 * Projectile patterns, beyond the aimed fan every shooter has (ai.ts):
 * - lob: an arc aimed at where the player stands, bursting where it lands (keep moving);
 * - homing: a slow orb that steers towards the player, a little each tick (outrun it, or put a
 *   wall between you);
 * - wall: a line of parallel shots across the aim with one gap beside the player's lane (step
 *   into it);
 * - split: a slow shot that bursts into a fan part of the way there;
 * - spiral: a stream of shots spun out over a second or so, from a short-lived emitter.
 * Grunt variants spit lobs or homing orbs (core's bestiary); bosses rotate all of them by phase
 * (boss.ts). Directions are vectors turned with dcos/dsin, never atan2, so replays hold.
 */
export type ShotKind = 'orb' | 'lob' | 'homing' | 'split';

/** An emitter spinning out a spiral: `arms` shots every `every` ticks, the aim turning each time. */
export interface Emitter {
  /** The enemy it comes from (it stops if that enemy dies). */
  enemy: number;
  shots: number;
  every: number;
  timer: number;
  /** The first arm's direction (unit vector), turned by `turn` radians each emission. */
  dx: number;
  dy: number;
  turn: number;
  arms: number;
  speed: number;
  damage: number;
  unblockable: boolean;
}

/** Lobs: speed across the ground, shortest flight, the arc's rise, the burst's radius, and the height over the floor it comes down at. */
export const LOB = { speed: 4.5, minTicks: 40, apex: 96, splash: 60, landAt: 8 } as const;
/** Homing orbs: speed (slower than the player walks), turn per tick, and ticks before they fizzle. */
export const HOMING = { speed: 3.2, turn: 0.025, life: 360 } as const;
export const SPLIT = { share: 0.55, into: 5, spread: 0.22, speed: 1.2, damage: 0.7 } as const;
export const WALL = { shots: 9, spacing: 44 } as const;
export const SPIRAL = { emissions: 16, every: 3, turn: 0.35, damage: 0.6 } as const;

/** Enemy eye and projectile launch height, as a fraction of its height (as in ai.ts). */
const EYE = 0.75;
/** Where shots aim on the player: roughly chest height. */
const AIM_HEIGHT = 44;

/** Launch point and the unit vector (and its horizontal part) from it to the player's chest. */
function aim(state: SimState, e: EnemyState, def: EnemyDef) {
  const p = state.player;
  const sx = e.x;
  const sy = e.y;
  const sz = e.z + def.height * EYE;
  const ax = p.x - sx;
  const ay = p.y - sy;
  const az = p.z + AIM_HEIGHT - sz;
  const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  const flat = Math.sqrt(ax * ax + ay * ay) || 1;
  return { sx, sy, sz, dx: ax / len, dy: ay / len, dz: az / len, hx: ax / flat, hy: ay / flat, dist: flat };
}

function push(state: SimState, q: Projectile): void {
  state.projectiles.push(q);
}

/** The height a lob may rise to over a cell on a level: its ceiling, or the catwalk overhead. */
function roofAt(world: World, cx: number, cy: number, level: number): number {
  const sec = world.map.sectors[world.grid.sectorAt(cx, cy)];
  if (!sec) return 0;
  return level === 0 && sec.slab ? sec.slab.bottom : sec.ceil;
}

/**
 * An arc aimed to come down where the player stands now, bursting there. It flies at LOB.speed
 * across the ground (never landing sooner than LOB.minTicks, so one step is always time enough to
 * leave the spot), and its gravity is chosen so the arc tops out LOB.apex above the higher end,
 * or just under the lower roof of the two ends.
 */
export function fireLob(world: World, state: SimState, e: EnemyState, def: EnemyDef, unblockable: boolean): void {
  const a = aim(state, e, def);
  const p = state.player;
  const ticks = Math.max(LOB.minTicks, a.dist / LOB.speed);
  const land = p.z + LOB.landAt;
  const roof = Math.min(roofAt(world, e.cx, e.cy, e.level), roofAt(world, p.cx, p.cy, p.level)) - 12;
  const top = Math.max(Math.max(a.sz, land) + 8, Math.min(Math.max(a.sz, land) + LOB.apex, roof));
  // Rising h1 = top - sz and falling h2 = top - land, over `ticks` in all: sqrt(2 h / g) each way.
  const h1 = Math.max(1, top - a.sz);
  const h2 = Math.max(1, top - land);
  const root = (Math.sqrt(h1) + Math.sqrt(h2)) / ticks;
  const gravity = 2 * root * root;
  push(state, {
    x: a.sx, y: a.sy, z: a.sz,
    vx: (a.hx * a.dist) / ticks, vy: (a.hy * a.dist) / ticks, vz: Math.sqrt(2 * gravity * h1),
    damage: def.damage, ttl: 0, gravity, splash: LOB.splash, kind: 'lob',
    ...(unblockable ? { unblockable } : {}),
  });
}

/** `count` slow orbs fanned by `spread`, each steering towards the player. */
export function fireHoming(state: SimState, e: EnemyState, def: EnemyDef, count: number, spread: number, unblockable: boolean): void {
  const a = aim(state, e, def);
  for (let k = 0; k < count; k++) {
    const t = (k - (count - 1) / 2) * spread;
    const c = dcos(t);
    const s = dsin(t);
    push(state, {
      x: a.sx, y: a.sy, z: a.sz,
      vx: (a.hx * c - a.hy * s) * HOMING.speed, vy: (a.hx * s + a.hy * c) * HOMING.speed, vz: a.dz * HOMING.speed,
      damage: def.damage, ttl: 0, homing: HOMING.turn, kind: 'homing',
      ...(unblockable ? { unblockable } : {}),
    });
  }
}

/**
 * A line of parallel shots across the aim, one gap next to the player's lane (to alternating
 * sides, cast by cast): standing still is a hit, one step sideways is safe.
 */
export function fireWall(state: SimState, e: EnemyState, def: EnemyDef, casts: number, unblockable: boolean): void {
  const a = aim(state, e, def);
  const mid = (WALL.shots - 1) / 2;
  const gap = mid + (casts % 2 === 0 ? 2 : -2);
  const speed = def.projectileSpeed * 0.9;
  for (let k = 0; k < WALL.shots; k++) {
    if (k === gap || k === gap + (casts % 2 === 0 ? 1 : -1)) continue; // a gap a cell wide
    const off = (k - mid) * WALL.spacing;
    push(state, {
      x: a.sx - a.hy * off, y: a.sy + a.hx * off, z: a.sz,
      vx: a.hx * speed, vy: a.hy * speed, vz: a.dz * speed,
      damage: def.damage, ttl: 0,
      ...(unblockable ? { unblockable } : {}),
    });
  }
}

/** A slow shot at the player that bursts into a fan part of the way there. */
export function fireSplit(state: SimState, e: EnemyState, def: EnemyDef, unblockable: boolean): void {
  const a = aim(state, e, def);
  const speed = def.projectileSpeed * 0.8;
  push(state, {
    x: a.sx, y: a.sy, z: a.sz,
    vx: a.dx * speed, vy: a.dy * speed, vz: a.dz * speed,
    damage: def.damage, ttl: 0, splitAt: Math.max(20, Math.round((a.dist * SPLIT.share) / speed)), kind: 'split',
    ...(unblockable ? { unblockable } : {}),
  });
}

/** Starts a spiral: `arms` streams turning from the player's direction over SPIRAL.emissions emissions. */
export function startSpiral(state: SimState, e: EnemyState, def: EnemyDef, index: number, arms: number, unblockable: boolean): void {
  const a = aim(state, e, def);
  state.emitters.push({
    enemy: index, shots: SPIRAL.emissions, every: SPIRAL.every, timer: 0, dx: a.hx, dy: a.hy, turn: SPIRAL.turn,
    arms, speed: def.projectileSpeed * 0.8, damage: Math.max(1, Math.round(def.damage * SPIRAL.damage)), unblockable,
  });
}

/** Emitters spin on: each emission sends one shot per arm, then the aim turns. */
export function stepEmitters(state: SimState, eyeOf: (e: EnemyState) => number): void {
  state.emitters = state.emitters.filter((m) => {
    const e = state.enemies[m.enemy];
    if (!e || e.mode === 'dead') return false;
    if (m.timer-- > 0) return true;
    m.timer = m.every - 1;
    for (let k = 0; k < m.arms; k++) {
      const t = (k / m.arms) * Math.PI * 2;
      const c = dcos(t);
      const s = dsin(t);
      const dx = m.dx * c - m.dy * s;
      const dy = m.dx * s + m.dy * c;
      push(state, {
        x: e.x, y: e.y, z: eyeOf(e), vx: dx * m.speed, vy: dy * m.speed, vz: 0,
        damage: m.damage, ttl: 0, ...(m.unblockable ? { unblockable: true } : {}),
      });
    }
    const c = dcos(m.turn);
    const s = dsin(m.turn);
    [m.dx, m.dy] = [m.dx * c - m.dy * s, m.dx * s + m.dy * c];
    return --m.shots > 0;
  });
}

/**
 * A projectile's own behaviour each tick, before it moves: gravity, steering towards the player,
 * and splitting into a fan. Returns the children a split made (the parent is then gone).
 */
export function steer(state: SimState, q: Projectile): Projectile[] | null {
  if (q.gravity) q.vz -= q.gravity;
  if (q.homing) {
    const p = state.player;
    const tx = p.x - q.x;
    const ty = p.y - q.y;
    const flat = Math.sqrt(tx * tx + ty * ty) || 1;
    const speed = Math.sqrt(q.vx * q.vx + q.vy * q.vy) || 1;
    const ux = q.vx / speed;
    const uy = q.vy / speed;
    const cross = ux * (ty / flat) - uy * (tx / flat);
    const dot = ux * (tx / flat) + uy * (ty / flat);
    if (dot >= dcos(q.homing)) {
      [q.vx, q.vy] = [(tx / flat) * speed, (ty / flat) * speed];
    } else {
      const t = cross >= 0 ? q.homing : -q.homing;
      const c = dcos(t);
      const s = dsin(t);
      [q.vx, q.vy] = [(ux * c - uy * s) * speed, (ux * s + uy * c) * speed];
    }
    // Up or down towards the player's chest, gently.
    const want = ((p.z + AIM_HEIGHT - q.z) / flat) * speed;
    q.vz += Math.max(-0.05, Math.min(0.05, want - q.vz));
  }
  if (q.splitAt !== undefined && q.ttl >= q.splitAt) {
    const speed = Math.sqrt(q.vx * q.vx + q.vy * q.vy + q.vz * q.vz) * SPLIT.speed;
    const len = Math.sqrt(q.vx * q.vx + q.vy * q.vy) || 1;
    const hx = q.vx / len;
    const hy = q.vy / len;
    const children: Projectile[] = [];
    for (let k = 0; k < SPLIT.into; k++) {
      const t = (k - (SPLIT.into - 1) / 2) * SPLIT.spread;
      const c = dcos(t);
      const s = dsin(t);
      children.push({
        x: q.x, y: q.y, z: q.z, vx: (hx * c - hy * s) * speed, vy: (hx * s + hy * c) * speed, vz: 0,
        damage: Math.max(1, Math.round(q.damage * SPLIT.damage)), ttl: 0,
        ...(q.unblockable ? { unblockable: true } : {}),
      });
    }
    return children;
  }
  return null;
}
