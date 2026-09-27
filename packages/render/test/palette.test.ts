import { describe, expect, it } from 'vitest';
import { THEME_NAMES } from '@proc-fps/core';
import { PALETTE_SIZE, RAMP_STEPS, THEME_COLORS, enemyLooks, hueDistance, paletteRGBA, paletteRamps, quantize, rampStep, type Rgb8 } from '../src/index.js';

const hue = (c: readonly number[]) => {
  const [r, g, b] = c as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  return d === 0 ? 0 : (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
};
const luma = (c: Rgb8) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const to8 = (c: readonly number[]) => c.map((v) => Math.round(v * 255)) as unknown as Rgb8;
/** Key colours, as the HUD, the automap and the level shader draw them. */
const KEYS: Rgb8[] = [[64, 115, 255], [255, 56, 38], [255, 217, 51], [64, 230, 77]];

describe('theme palettes', () => {
  it('are 64 colours of eight ramps, each ramp dark to light', () => {
    for (const theme of THEME_NAMES) {
      expect(paletteRGBA(theme)).toHaveLength(PALETTE_SIZE * 4);
      for (const r of paletteRamps(theme)) {
        for (let s = 1; s < RAMP_STEPS; s++) expect(luma(rampStep(r, s)), `${theme} ${r.name} ${s}`).toBeGreaterThan(luma(rampStep(r, s - 1)));
      }
    }
  });

  it('differ from theme to theme, and give each its own light', () => {
    const all = THEME_NAMES.map((t) => paletteRGBA(t).join());
    expect(new Set(all).size).toBe(THEME_NAMES.length);
    for (const theme of THEME_NAMES) {
      const tech = paletteRamps(theme).find((r) => r.name === 'tech')!;
      expect(hueDistance(hue(rampStep(tech, 5)), hue(THEME_COLORS[theme].techLight))).toBeLessThan(12);
    }
  });

  it('keep the four key colours apart, each still its own hue', () => {
    for (const theme of THEME_NAMES) {
      const q = KEYS.map((k) => quantize(k, theme));
      expect(new Set(q.map((x) => x.ramp)).size, theme).toBe(4);
      q.forEach((x, i) => expect(hueDistance(hue(x.color), hue(KEYS[i]!)), `${theme} key ${i}`).toBeLessThan(40));
    }
  });

  it('keep enemies off the walls: few skins land on the ramp the theme stone does', () => {
    for (const theme of THEME_NAMES) {
      const wall = quantize(to8(THEME_COLORS[theme].stone.map((v) => v * 0.8)), theme).ramp;
      let on = 0;
      let n = 0;
      for (let i = 0; i < 100; i++) {
        for (const l of enemyLooks(`p${i}`, theme)) {
          n++;
          if (quantize(to8(l.skin.map((v) => v * 0.8)), theme).ramp === wall) on++;
        }
      }
      expect(on / n, theme).toBeLessThan(0.15);
    }
  });
});
