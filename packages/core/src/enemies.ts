import { STEP_TICKS } from './constants.js';
import { EnemyType } from './map.js';

/**
 * Enemy stats and behaviour, shared by the sim (behaviour) and the generator (balance). All in
 * sim units: ticks (60/s), map units, hit points.
 *
 * Tuning rules (see PROJECT_SUMMARY.md): enemies step slower than the player (STEP_TICKS = 14),
 * a projectile needs longer than one player step to cross a cell so a sidestep dodges it, and
 * hitscan is rare and telegraphed by a long wind-up that breaking line of sight cancels. Every
 * enemy is at least as tall as the player (72), so a level shot from eye height (64) connects.
 * Hordes, not bullet sponges: ordinary enemies die to a close shotgun blast (8 × 12); the
 * difficulty is their number (see gen/src/population.ts). They are deliberately slow.
 */
export type AttackKind = 'melee' | 'projectile' | 'hitscan';

export interface EnemyDef {
  name: string;
  hp: number;
  /** Hit cylinder. */
  radius: number;
  height: number;
  /** Ticks per cell step. */
  stepTicks: number;
  attack: AttackKind;
  /** Wind-up before the attack lands: the telegraph. */
  windup: number;
  /** Ticks after an attack before the next wind-up may start. */
  cooldown: number;
  damage: number;
  /** Attack range in cells (melee: 1 = adjacent). */
  range: number;
  /** Units per tick. */
  projectileSpeed: number;
  /** Projectiles per attack, fanned by `spread` radians. */
  volley: number;
  spread: number;
  /** Ticks stunned when hit (0 = never flinches). */
  pain: number;
}

const base = { projectileSpeed: 0, volley: 1, spread: 0 };

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  [EnemyType.Grunt]: {
    ...base, name: 'grunt', hp: 20, radius: 20, height: 72, stepTicks: 26,
    attack: 'projectile', windup: 24, cooldown: 70, damage: 10, range: 10, projectileSpeed: 5, pain: 10,
  },
  [EnemyType.Brute]: {
    ...base, name: 'brute', hp: 55, radius: 26, height: 80, stepTicks: STEP_TICKS + 8,
    attack: 'melee', windup: 20, cooldown: 40, damage: 20, range: 1, pain: 6,
  },
  [EnemyType.Sniper]: {
    ...base, name: 'sniper', hp: 20, radius: 22, height: 78, stepTicks: 32,
    attack: 'hitscan', windup: 60, cooldown: 120, damage: 25, range: 14, pain: 12,
  },
  [EnemyType.MiniBoss]: {
    ...base, name: 'mini boss', hp: 260, radius: 32, height: 96, stepTicks: 28,
    attack: 'projectile', windup: 30, cooldown: 80, damage: 12, range: 12, projectileSpeed: 5.5, volley: 3, spread: 0.22, pain: 0,
  },
  [EnemyType.Boss]: {
    ...base, name: 'boss', hp: 700, radius: 44, height: 120, stepTicks: 34,
    attack: 'projectile', windup: 40, cooldown: 90, damage: 14, range: 14, projectileSpeed: 5, volley: 5, spread: 0.18, pain: 0,
  },
};

/** How far an idle enemy sees the player, in cells. */
export const SIGHT_CELLS = 10;
/** Ticks between noticing the player and moving. */
export const ALERT_TICKS = 18;
/** Gunfire wakes enemies within this path distance, in cells; closed doors muffle it. */
export const NOISE_CELLS = 14;
