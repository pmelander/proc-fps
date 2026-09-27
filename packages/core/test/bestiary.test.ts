import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  ENEMY_DEFS,
  EnemyType,
  MAX_FODDER_HP,
  MIN_HITSCAN_WINDUP,
  MIN_PROJECTILE_CELL_TICKS,
  PELLETS,
  PLAYER_DAMAGE,
  STEP_TICKS,
  enemyDefsFor,
  BASELINE_DEFS,
  defOf,
  type EnemyDef,
} from '../src/index.js';

const TYPES = [EnemyType.Grunt, EnemyType.Brute, EnemyType.Sniper, EnemyType.MiniBoss, EnemyType.Boss];
const FODDER = [EnemyType.Grunt, EnemyType.Brute, EnemyType.Sniper];

describe('enemyDefsFor', () => {
  it('uses the baseline without a seed', () => {
    expect(enemyDefsFor(undefined)).toBe(BASELINE_DEFS);
    for (const t of TYPES) expect(BASELINE_DEFS[t][0]).toBe(ENEMY_DEFS[t]);
  });

  it('is deterministic in the seed, and seeds differ', () => {
    expect(enemyDefsFor('run-3')).toEqual(enemyDefsFor('run-3'));
    const grunts = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(enemyDefsFor(`s${i}`)[EnemyType.Grunt][0])));
    expect(grunts.size).toBeGreaterThan(20);
  });

  it('keeps every role inside the tuning rules', () => {
    for (let i = 0; i < 500; i++) {
      const defs = enemyDefsFor(`seed-${i}`);
      for (const t of TYPES) for (const d of defs[t]) {
        const base = ENEMY_DEFS[t];
        // Same job and hit cylinder; slower than the player; alive.
        expect([d.attack, d.radius, d.height, d.range]).toEqual([base.attack, base.radius, base.height, base.range]);
        expect(d.stepTicks).toBeGreaterThan(STEP_TICKS);
        expect(d.hp).toBeGreaterThan(0);
        expect(d.damage).toBeGreaterThan(0);
        expect(d.volley).toBeGreaterThanOrEqual(1);
        if (d.attack === 'projectile') expect(CELL_SIZE / d.projectileSpeed).toBeGreaterThanOrEqual(MIN_PROJECTILE_CELL_TICKS - 1e-9);
        if (d.attack === 'hitscan') expect(d.windup).toBeGreaterThanOrEqual(MIN_HITSCAN_WINDUP);
      }
      // Hordes, not bullet sponges: one close blast still kills an ordinary enemy.
      for (const t of FODDER) for (const d of defs[t]) expect(d.hp).toBeLessThanOrEqual(Math.min(MAX_FODDER_HP, PELLETS * PLAYER_DAMAGE));
    }
  });

  it('trades speed for toughness', () => {
    // Across seeds, quicker grunts (fewer ticks per step) average fewer hit points.
    const all = Array.from({ length: 400 }, (_, i) => enemyDefsFor(`t${i}`)[EnemyType.Grunt][0]!);
    const quick = all.filter((d) => d.stepTicks < ENEMY_DEFS[EnemyType.Grunt].stepTicks);
    const slow = all.filter((d) => d.stepTicks > ENEMY_DEFS[EnemyType.Grunt].stepTicks);
    const mean = (xs: typeof all) => xs.reduce((a, d) => a + d.hp, 0) / xs.length;
    expect(mean(quick)).toBeLessThan(mean(slow));
  });

  it('breeds two variants of each ordinary role that pull opposite ways', () => {
    const base = ENEMY_DEFS[EnemyType.Grunt].stepTicks;
    let opposite = 0;
    for (let i = 0; i < 200; i++) {
      const defs = enemyDefsFor(`v${i}`);
      for (const t of FODDER) expect(defs[t]).toHaveLength(2);
      for (const t of [EnemyType.MiniBoss, EnemyType.Boss]) expect(defs[t]).toHaveLength(1);
      const [a, b] = defs[EnemyType.Grunt] as [EnemyDef, EnemyDef];
      if (Math.sign(a.stepTicks - base) !== Math.sign(b.stepTicks - base)) opposite++;
      // Grunts spit differently.
      expect([a.volley, a.projectileSpeed]).not.toEqual([b.volley, b.projectileSpeed]);
      expect(defOf(defs, { type: EnemyType.Boss, variant: 1 })).toBe(defs[EnemyType.Boss][0]);
    }
    expect(opposite).toBeGreaterThan(150); // one quick and frail, one slow and tough, nearly always
  });
});
