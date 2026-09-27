import { STEP_TICKS } from './constants.js';
import { EnemyType } from './map.js';

/**
 * Enemy stats and behaviour, shared by the sim (behaviour) and the generator (balance). All in
 * sim units: ticks (60/s), map units, hit points.
 *
 * Tuning rules (see PROJECT_SUMMARY.md): enemies step slower than the player (STEP_TICKS = 18),
 * a projectile needs longer than one player step to cross a cell so a sidestep dodges it, and
 * hitscan is rare and telegraphed by a long wind-up that breaking line of sight cancels. Every
 * enemy is at least as tall as the player (72), so a level shot from eye height (64) connects.
 * Hordes, not bullet sponges: ordinary enemies die to a close shotgun blast (8 × 12); the
 * difficulty is their number (see gen/src/population.ts). They are deliberately slow.
 */
/**
 * melee: a blow to an adjacent player. projectile / hitscan: shots. charge: a rush down a straight
 * lane (CHARGE_*). blast: a burst when next to the player, killing itself (BLAST_*).
 */
export type AttackKind = 'melee' | 'projectile' | 'hitscan' | 'charge' | 'blast';

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
  /** How its projectiles fly: aimed straight (the default), lobbed in an arc that bursts where it lands, or homing. */
  shot?: 'lob' | 'homing';
  /** Ticks stunned when hit (0 = never flinches). */
  pain: number;
  /** Carries a shield that stops shots from the front while it is up (SHIELD_*). */
  shield?: boolean;
}

const base = { projectileSpeed: 0, volley: 1, spread: 0 };

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  [EnemyType.Grunt]: {
    ...base, name: 'grunt', hp: 20, radius: 20, height: 72, stepTicks: 32,
    attack: 'projectile', windup: 28, cooldown: 70, damage: 10, range: 10, projectileSpeed: 4, pain: 10,
  },
  [EnemyType.Brute]: {
    ...base, name: 'brute', hp: 55, radius: 26, height: 80, stepTicks: STEP_TICKS + 10,
    attack: 'melee', windup: 24, cooldown: 40, damage: 20, range: 1, pain: 6,
  },
  [EnemyType.Sniper]: {
    ...base, name: 'sniper', hp: 20, radius: 22, height: 78, stepTicks: 40,
    attack: 'hitscan', windup: 70, cooldown: 120, damage: 25, range: 14, pain: 12,
  },
  [EnemyType.Charger]: {
    ...base, name: 'charger', hp: 50, radius: 26, height: 80, stepTicks: 32,
    attack: 'charge', windup: 36, cooldown: 100, damage: 30, range: 6, pain: 0,
  },
  [EnemyType.Bloater]: {
    ...base, name: 'bloater', hp: 16, radius: 24, height: 72, stepTicks: 22,
    attack: 'blast', windup: 34, cooldown: 0, damage: 35, range: 1, pain: 0,
  },
  [EnemyType.Warden]: {
    ...base, name: 'warden', hp: 50, radius: 22, height: 78, stepTicks: 38,
    attack: 'projectile', windup: 32, cooldown: 100, damage: 10, range: 10, projectileSpeed: 3.4, volley: 3, spread: 0.16, pain: 8, shield: true,
  },
  [EnemyType.MiniBoss]: {
    ...base, name: 'mini boss', hp: 260, radius: 32, height: 96, stepTicks: 35,
    attack: 'projectile', windup: 34, cooldown: 80, damage: 12, range: 12, projectileSpeed: 4.4, volley: 3, spread: 0.22, pain: 0,
  },
  [EnemyType.Boss]: {
    ...base, name: 'boss', hp: 700, radius: 44, height: 120, stepTicks: 42,
    attack: 'projectile', windup: 46, cooldown: 90, damage: 14, range: 14, projectileSpeed: 4, volley: 5, spread: 0.18, pain: 0,
  },
};

/** A charger's rush: ticks per cell (far faster than walking; the wind-up and the lane are the warning). */
export const CHARGE_STEP_TICKS = 7;
/** Ticks a charger lies stunned after crashing into something that is not the player. */
export const CHARGE_STUN = 70;
/** A bloater's burst: everyone within this many map units (of their body) is caught, the most at the centre. */
export const BLAST_RADIUS = 176;
/** At the burst's edge, this share of its damage. */
export const BLAST_EDGE = 0.3;
/** A warden's shield stops shots from within this cosine of its facing (about 60° either side). */
export const SHIELD_ARC_COS = 0.5;
/** Radians a tick a warden turns towards the player: slow enough to get round up close. */
export const SHIELD_TURN = 0.025;

/** How far an idle enemy sees the player, in cells. */
export const SIGHT_CELLS = 10;
/** Ticks between noticing the player and moving. */
export const ALERT_TICKS = 18;
/** Gunfire wakes enemies within this path distance, in cells; closed doors muffle it. */
export const NOISE_CELLS = 14;
