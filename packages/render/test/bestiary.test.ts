import { describe, expect, it } from 'vitest';
import { THEME_NAMES } from '@proc-fps/core';
import { BASELINE_LOOKS, ROW_ROLE, THEME_COLORS, enemyLooks, hueDistance, lookUniforms } from '../src/index.js';
import { SPRITE_PLAN_VEC4S, SPRITE_ROWS } from '../src/shaders.js';

const hue = (c: readonly number[]) => {
  const [r, g, b] = c as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  return d === 0 ? 0 : (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
};

describe('enemyLooks', () => {
  it('is deterministic, one look per sprite shape, and seeds differ', () => {
    expect(enemyLooks('run-2', 'crypt')).toEqual(enemyLooks('run-2', 'crypt'));
    expect(enemyLooks('run-2', 'crypt')).toHaveLength(SPRITE_ROWS);
    expect(SPRITE_ROWS).toBe(11);
    expect(enemyLooks('run-2', 'crypt')).not.toEqual(enemyLooks('run-3', 'crypt'));
  });

  it('keeps skins away from the theme lights, slime and hazard paint, and roles apart', () => {
    for (const theme of THEME_NAMES) {
      const lights = (['techLight', 'slime', 'hazard'] as const).map((k) => hue(THEME_COLORS[theme][k]));
      for (let i = 0; i < 150; i++) {
        const looks = enemyLooks(`s${i}`, theme);
        const hues = looks.map((l) => hue(l.skin));
        for (const h of hues) for (const l of lights) expect(hueDistance(h, l)).toBeGreaterThanOrEqual(12);
        // Each role's first variant carries the role's hue: those stay apart. The five first roles
        // pick first and keep well apart; the charger, bloater and warden squeeze in after them (their
        // silhouettes and behaviour set them apart too).
        const roleHues = ROW_ROLE.flatMap((role, row) => (ROW_ROLE.indexOf(role) === row ? [hues[row]!] : []));
        for (let a = 0; a < roleHues.length; a++) for (let b = a + 1; b < roleHues.length; b++) expect(hueDistance(roleHues[a]!, roleHues[b]!)).toBeGreaterThanOrEqual(b < 5 ? 19.9 : 9.9);
      }
    }
  });

  it('sets a role\'s two variants apart: hue, lightness, legs, pattern', () => {
    for (let i = 0; i < 100; i++) {
      const looks = enemyLooks(`p${i}`, 'base');
      for (const row of [0, 2, 4]) {
        const [a, b] = [looks[row]!, looks[row + 1]!];
        expect(hueDistance(hue(a.skin), hue(b.skin))).toBeGreaterThanOrEqual(25);
        expect(Math.abs(Math.max(...a.skin) - Math.max(...b.skin))).toBeGreaterThanOrEqual(0.1);
        expect(b.legs).not.toBe(a.legs);
        expect(b.pattern).not.toBe(a.pattern);
      }
    }
  });

  it('stays inside the ranges the bake shader expects', () => {
    for (let i = 0; i < 200; i++) {
      for (const [row, l] of enemyLooks(`r${i}`, 'base').entries()) {
        expect(l.eyes).toBeGreaterThanOrEqual(1);
        expect(l.eyes).toBeLessThanOrEqual(4);
        expect(l.horns).toBeLessThanOrEqual(2);
        expect(l.spikes).toBeLessThanOrEqual(6);
        expect(l.bulk).toBeGreaterThan(0.85);
        // Bloaters swell (their quad is wider to match); the rest stay near their silhouettes.
        expect(l.bulk).toBeLessThan(ROW_ROLE[row] === 6 ? 1.45 : 1.15);
        for (const c of [...l.skin, ...l.accent]) expect(c).toBeGreaterThanOrEqual(0), expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('packs the bake uniforms', () => {
    const u = lookUniforms(BASELINE_LOOKS, Array.from({ length: SPRITE_ROWS }, () => 1));
    expect((u.uPlan as { vec4s: Float32Array }).vec4s).toHaveLength(SPRITE_ROWS * SPRITE_PLAN_VEC4S * 4);
    expect((u.uAspect as { floats: Float32Array }).floats).toHaveLength(SPRITE_ROWS);
  });
});
