import { FIRE_COOLDOWN, MAG_SIZE, PELLETS, PELLET_SPREAD, PLAYER_DAMAGE, RELOAD_TICKS } from './constants.js';

/**
 * The player's guns. Ammo is infinite for all of them; each has its own magazine, kept while
 * another gun is up. Switching takes WEAPON_SWITCH_TICKS (the old gun lowers, the new one rises)
 * and drops a reload in progress. The chainsword (MELEE_*) works with either gun.
 *
 * - The energy scattergun: PELLETS pellets in a fixed spread, devastating up close.
 * - The heavy bolter: fast, accurate, explosive bolts. One pellet per shot, walking a small fixed
 *   pattern shot by shot (fixed, so replays hold); each bolt bursts where it hits and hurts
 *   everything within its splash radius, so it thins packed hordes and reaches snipers the
 *   scattergun's spread cannot.
 */
export interface WeaponDef {
  name: string;
  /** What the HUD calls its ammunition. */
  ammo: string;
  /** Ticks between shots. */
  cooldown: number;
  magSize: number;
  reloadTicks: number;
  /** Damage per pellet that hits. */
  damage: number;
  /** Pellets per shot. With one, the shot walks through `spread` shot by shot. */
  pellets: number;
  /** Pellet offsets from the aim, radians: [yaw, pitch]. */
  spread: readonly (readonly [number, number])[];
  /** Each pellet bursts where it hits: this much damage to every enemy this close (0 = no burst). */
  splashRadius: number;
  splashDamage: number;
}

export const WeaponId = { Scattergun: 0, Bolter: 1 } as const;

/** The bolter's walk: a small, fixed wander around the aim. */
export const BOLT_SPREAD: readonly (readonly [number, number])[] = [
  [0, 0], [0.012, 0.004], [-0.01, -0.006], [0.006, -0.011], [-0.014, 0.008], [0.004, 0.012], [-0.006, -0.002], [0.014, -0.004],
];

export const WEAPONS: readonly WeaponDef[] = [
  {
    name: 'scattergun', ammo: 'Scatter cell', cooldown: FIRE_COOLDOWN, magSize: MAG_SIZE, reloadTicks: RELOAD_TICKS,
    damage: PLAYER_DAMAGE, pellets: PELLETS, spread: PELLET_SPREAD, splashRadius: 0, splashDamage: 0,
  },
  {
    name: 'heavy bolter', ammo: 'Bolt drum', cooldown: 9, magSize: 30, reloadTicks: 120,
    damage: 14, pellets: 1, spread: BOLT_SPREAD, splashRadius: 56, splashDamage: 8,
  },
];

/** Ticks a weapon switch takes: the old gun lowers for half, the new one rises for half. */
export const WEAPON_SWITCH_TICKS = 24;
