import { CELL_SIZE, STEP_TICKS } from './constants.js';
import { ENEMY_DEFS, type EnemyDef } from './enemies.js';
import { EnemyType } from './map.js';
import { Rng } from './rng.js';

/**
 * Each generated level breeds its own mutants: the five roles (fodder, bruiser, sniper, mini boss,
 * boss) keep their jobs and hit cylinders, but their stats vary with the level's seed. The three
 * ordinary roles come in two variants per level that pull opposite ways (one quick and frail, one
 * slow and tough; grunts spit differently), so a level holds six kinds of ordinary enemy; the
 * generator decides which variant each enemy is (THING_VARIANT). How they look comes from the same
 * seed (render's `enemyLooks`), on a separate fork.
 *
 * Every variant trades one thing for another, so a level's threat stays near the tuned baseline:
 * quicker mutants are frailer, bigger volleys hit softer. The tuning rules in `enemies.ts` hold for
 * every variant: projectiles stay slower than a cell per player step (a sidestep dodges them),
 * hitscan wind-ups stay long, and ordinary enemies still die to one close blast. Hand-built maps
 * (no seed) use the baseline `ENEMY_DEFS` for both variants.
 */

/** Stats per role, one per variant (index = the enemy's variant; the bosses have one). */
export type EnemyDefs = Readonly<Record<EnemyType, readonly EnemyDef[]>>;

/** Projectiles never cross a cell in less than this many ticks: a sidestep always beats them. */
export const MIN_PROJECTILE_CELL_TICKS = STEP_TICKS + 6;
/** A hitscan wind-up is never shorter than this: the telegraph must stay readable. */
export const MIN_HITSCAN_WINDUP = 58;
/** An ordinary enemy never has more hit points than this: one close blast (8 × 12) still kills. */
export const MAX_FODDER_HP = 60;
/** Roles that come in two variants per level. */
export const VARIANT_TYPES: readonly EnemyType[] = [EnemyType.Grunt, EnemyType.Brute, EnemyType.Sniper];

const TYPES = [EnemyType.Grunt, EnemyType.Brute, EnemyType.Sniper, EnemyType.MiniBoss, EnemyType.Boss] as const;
const round = Math.round;

/** The baseline: every role's tuned stats, the same for both variants. */
export const BASELINE_DEFS: EnemyDefs = Object.fromEntries(TYPES.map((t) => [t, [ENEMY_DEFS[t], ENEMY_DEFS[t]]])) as unknown as EnemyDefs;

/**
 * One role's stats for a speed trait (-1 lumbering and tough … +1 quick and frail) and, for grunts,
 * a spit pattern (0 one bolt, 1 a twin spread of softer bolts, 2 one quick bolt after a longer wind-up).
 */
function variant(type: EnemyType, r: Rng, speed: number, pattern: number): EnemyDef {
  const base = ENEMY_DEFS[type];
  const def: EnemyDef = {
    ...base,
    stepTicks: round(base.stepTicks * (1 - 0.15 * speed)),
    hp: round(base.hp * (1 - 0.2 * speed)),
    windup: round(base.windup * r.range(0.9, 1.15)),
  };
  switch (type) {
    case EnemyType.Grunt:
      if (pattern === 1) Object.assign(def, { volley: 2, spread: 0.14, damage: round(base.damage * 0.7) });
      if (pattern === 2) Object.assign(def, { projectileSpeed: base.projectileSpeed * 1.2, windup: def.windup + 8 });
      break;
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
  if (VARIANT_TYPES.includes(type)) def.hp = Math.min(def.hp, MAX_FODDER_HP);
  return def;
}

/** Each role's stats for a level, per variant. Deterministic in the seed; baseline without one. */
export function enemyDefsFor(seed: string | undefined): EnemyDefs {
  if (seed === undefined) return BASELINE_DEFS;
  const rng = new Rng(seed).fork('bestiary').fork('stats');
  const out = {} as Record<EnemyType, EnemyDef[]>;
  for (const type of TYPES) {
    const r = rng.fork(String(type));
    const speed = r.range(-1, 1);
    const pattern = r.int(0, 2);
    const first = variant(type, r, speed, pattern);
    if (!VARIANT_TYPES.includes(type)) {
      out[type] = [first];
      continue;
    }
    // The second variant pulls the other way: the opposite speed trait, another spit pattern.
    const second = variant(type, r.fork('variant'), -Math.sign(speed || 1) * r.range(0.5, 1), (pattern + r.int(1, 2)) % 3);
    out[type] = [first, second];
  }
  return out;
}

/** An enemy's stats: its role's, for its variant (the bosses have only one). */
export function defOf(defs: EnemyDefs, e: { readonly type: EnemyType; readonly variant: number }): EnemyDef {
  const list = defs[e.type];
  return list[e.variant] ?? list[0]!;
}
