import { CELL_SIZE, STEP_TICKS } from './constants.js';
import { ENEMY_DEFS, type EnemyDef } from './enemies.js';
import { EnemyType } from './map.js';
import { Rng } from './rng.js';

/**
 * Each generated level breeds its own mutants: the five roles (fodder, bruiser, sniper, mini boss,
 * boss) keep their jobs and hit cylinders, but their stats vary with the level's seed. How they
 * look comes from the same seed (render's `enemyLooks`), on a separate fork.
 *
 * Every variant trades one thing for another, so a level's threat stays near the tuned baseline:
 * quicker mutants are frailer, bigger volleys hit softer. The tuning rules in `enemies.ts` hold for
 * every variant: projectiles stay slower than a cell per player step (a sidestep dodges them),
 * hitscan wind-ups stay long, and ordinary enemies still die to one close blast. Hand-built maps
 * (no seed) use the baseline `ENEMY_DEFS`.
 */

/** Projectiles never cross a cell in less than this many ticks: a sidestep always beats them. */
export const MIN_PROJECTILE_CELL_TICKS = STEP_TICKS + 6;
/** A hitscan wind-up is never shorter than this: the telegraph must stay readable. */
export const MIN_HITSCAN_WINDUP = 58;
/** An ordinary enemy never has more hit points than this: one close blast (8 × 12) still kills. */
export const MAX_FODDER_HP = 60;

const round = Math.round;

/** The stats of each role for a level. Deterministic in the seed; baseline without one. */
export function enemyDefsFor(seed: string | undefined): Record<EnemyType, EnemyDef> {
  if (seed === undefined) return ENEMY_DEFS;
  const rng = new Rng(seed).fork('bestiary').fork('stats');
  const out = {} as Record<EnemyType, EnemyDef>;
  for (const type of [EnemyType.Grunt, EnemyType.Brute, EnemyType.Sniper, EnemyType.MiniBoss, EnemyType.Boss]) {
    const base = ENEMY_DEFS[type];
    const r = rng.fork(String(type));
    // Speed trait: -1 lumbering and tough … +1 quick and frail.
    const speed = r.range(-1, 1);
    const def: EnemyDef = {
      ...base,
      stepTicks: round(base.stepTicks * (1 - 0.15 * speed)),
      hp: round(base.hp * (1 - 0.2 * speed)),
      windup: round(base.windup * r.range(0.9, 1.15)),
    };
    switch (type) {
      case EnemyType.Grunt: {
        // Spitters: one bolt, a twin spread of softer bolts, or one quick bolt with a longer wind-up.
        const pattern = r.int(0, 2);
        if (pattern === 1) Object.assign(def, { volley: 2, spread: 0.14, damage: round(base.damage * 0.7) });
        if (pattern === 2) Object.assign(def, { projectileSpeed: base.projectileSpeed * 1.2, windup: def.windup + 8 });
        break;
      }
      case EnemyType.Brute:
        def.damage = round(base.damage * r.range(0.85, 1.2));
        break;
      case EnemyType.Sniper:
        def.windup = Math.max(MIN_HITSCAN_WINDUP, def.windup);
        def.damage = round(base.damage * r.range(0.85, 1.15));
        break;
      case EnemyType.MiniBoss:
      case EnemyType.Boss: {
        // Wider volleys of softer shots, or tighter volleys of harder ones.
        const extra = r.int(-1, 2);
        def.volley = Math.max(1, base.volley + extra);
        def.damage = Math.max(4, round(base.damage * (1 - 0.1 * extra)));
        def.spread = base.spread * r.range(0.85, 1.2);
        def.projectileSpeed = base.projectileSpeed * r.range(0.9, 1.1);
        break;
      }
    }
    // The rules, whatever the dice said.
    if (def.projectileSpeed > 0) def.projectileSpeed = Math.min(def.projectileSpeed, CELL_SIZE / MIN_PROJECTILE_CELL_TICKS);
    if (type === EnemyType.Grunt || type === EnemyType.Brute || type === EnemyType.Sniper) def.hp = Math.min(def.hp, MAX_FODDER_HP);
    out[type] = def;
  }
  return out;
}
