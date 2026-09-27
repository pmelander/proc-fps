import { FIRE_COOLDOWN, MAG_SIZE, PELLETS, PELLET_SPREAD, PLAYER_DAMAGE, RELOAD_TICKS } from './constants.js';

/**
 * The player's guns. Ammo is infinite for all of them; each has its own magazine, kept while
 * another gun is up. Switching takes WEAPON_SWITCH_TICKS (the old gun lowers, the new one rises)
 * and drops a reload in progress. The chainsword (MELEE_*) works with either gun.
 *
 * - The energy scattergun: PELLETS pellets in a fixed spread, devastating up close; its pellets
 *   lose damage with range (full out to two cells, a quarter from eight), so at range it only sprays.
 * - The heavy bolter: fast, accurate, explosive bolts. One pellet per shot, walking a small fixed
 *   pattern shot by shot (fixed, so replays hold); each bolt bursts where it hits and hurts
 *   everything within its splash radius, so it thins packed hordes and reaches snipers the
 *   scattergun's spread cannot.
 * - The railgun: slow and heavy. One slug at the aim that goes through everything in its way to
 *   the first wall, full damage to each enemy it passes (a corridor of them at once), and no
 *   shield stops it. Four slugs to a magazine, a long reload.
 */
export interface WeaponDef {
  name: string;
  /** Its name in the HUD's slot list. */
  short: string;
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
  /** Pellet damage falls off with range: full out to `from`, down to `min` of it at `to` and beyond (map units). */
  falloff?: { from: number; to: number; min: number };
  /** Each pellet passes through every enemy on its way to the first wall, and shields do not stop it. */
  pierce?: boolean;
}

/** The share of a pellet's damage it still does at distance `t`. */
export function falloffAt(w: WeaponDef, t: number): number {
  const f = w.falloff;
  if (!f || t <= f.from) return 1;
  if (t >= f.to) return f.min;
  return 1 - ((1 - f.min) * (t - f.from)) / (f.to - f.from);
}

export const WeaponId = { Scattergun: 0, Bolter: 1, Railgun: 2 } as const;

/** The bolter's walk: a small, fixed wander around the aim. */
export const BOLT_SPREAD: readonly (readonly [number, number])[] = [
  [0, 0], [0.012, 0.004], [-0.01, -0.006], [0.006, -0.011], [-0.014, 0.008], [0.004, 0.012], [-0.006, -0.002], [0.014, -0.004],
];

export const WEAPONS: readonly WeaponDef[] = [
  {
    name: 'scattergun', short: 'scatter', ammo: 'Scatter cell', cooldown: FIRE_COOLDOWN, magSize: MAG_SIZE, reloadTicks: RELOAD_TICKS,
    damage: PLAYER_DAMAGE, pellets: PELLETS, spread: PELLET_SPREAD, splashRadius: 0, splashDamage: 0,
    falloff: { from: 256, to: 1024, min: 0.25 },
  },
  {
    name: 'heavy bolter', short: 'bolter', ammo: 'Bolt drum', cooldown: 9, magSize: 30, reloadTicks: 120,
    damage: 12, pellets: 1, spread: BOLT_SPREAD, splashRadius: 56, splashDamage: 7,
  },
  {
    name: 'railgun', short: 'rail', ammo: 'Rail slug', cooldown: 54, magSize: 4, reloadTicks: 150,
    damage: 70, pellets: 1, spread: [[0, 0]], splashRadius: 0, splashDamage: 0, pierce: true,
  },
];

/** Ticks a weapon switch takes: the old gun lowers for half, the new one rises for half. */
export const WEAPON_SWITCH_TICKS = 24;

/**
 * The grenade launcher, in the left hand like the chainsword (E): it lobs a grenade in an arc that
 * bursts on touching an enemy, a wall, a floor or a ceiling (or at the end of its fuse), hurting
 * every enemy within `radius`, most at the centre. Grenades are scarce: the player starts with
 * `start`, carries at most `max`, and finds more now and then in loot and secret rooms. It does
 * not hurt the player. Speeds in map units per tick, gravity per tick squared.
 */
export const GRENADE = {
  start: 1,
  max: 3,
  cooldown: 40,
  speed: 12,
  /** Upward share of the throw on top of the aim, so a level throw still arcs. */
  lift: 0.33,
  gravity: 0.12,
  radius: 192,
  /** Damage at the centre of the burst, and at its edge. */
  damage: 90,
  edgeDamage: 25,
  fuse: 180,
} as const;
