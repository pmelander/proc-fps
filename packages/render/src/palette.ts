import type { ThemeName } from '@proc-fps/core';
import { THEME_COLORS, type Theme } from './themes.js';

/**
 * The palette every frame is quantized to: 8 ramps × 8 steps = 64 colours. A shared palette is
 * what makes procedural textures, sprites and lighting read as one art style; a palette per theme
 * gives each theme its own. Four ramps are the theme's: a gray tinted with its stone, its stone,
 * its tech light, and its hazard paint (rust in the base theme). Four hold what must read the same
 * everywhere: blood, bone, and the blue and green of keys (red and yellow are blood and hazard).
 * The UI takes its colours from the same ramps (the app's ui/skin.ts), so it follows the theme too.
 */
export type Rgb8 = readonly [number, number, number];

export interface Ramp {
  name: RampName;
  dark: Rgb8;
  light: Rgb8;
  /** A colour the ramp passes through at t = THROUGH (straight from dark to light without one). */
  mid?: Rgb8;
}

export type RampName = 'gray' | 'stone' | 'tech' | 'blood' | 'steel' | 'hazard' | 'toxic' | 'bone';

/** The theme-independent ramps. */
const FIXED: Record<'blood' | 'steel' | 'toxic' | 'bone', Ramp> = {
  blood: { name: 'blood', dark: [24, 4, 4], light: [236, 96, 80] },
  steel: { name: 'steel', dark: [8, 12, 22], light: [150, 180, 220] },
  toxic: { name: 'toxic', dark: [4, 20, 6], light: [150, 250, 90] },
  bone: { name: 'bone', dark: [30, 24, 18], light: [250, 238, 206] },
};

export const RAMP_STEPS = 8;
export const PALETTE_SIZE = 8 * RAMP_STEPS;

const to8 = (c: readonly number[]): Rgb8 => c.map((v) => Math.max(0, Math.min(255, Math.round(v * 255)))) as unknown as Rgb8;
const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);

/**
 * A ramp through a theme colour (0–1): near black in its hue at the bottom, the colour itself
 * (a little brighter, hue kept: theme colours are albedos, and lit rooms show them so) at
 * t = THROUGH, and a pale tint of it at the top.
 */
const THROUGH = 0.55;
function rampThrough(name: RampName, c: readonly number[]): Ramp {
  const lit = c.map((v) => v * 1.15);
  const over = Math.max(1, ...lit);
  const mid = lit.map((v) => v / over);
  return { name, dark: to8(c.map((v) => v * 0.1 + 0.012)), mid: to8(mid), light: to8(mix(mid, [1, 0.97, 0.9], 0.55)) };
}

/** The ramps of a theme's palette, in order. */
export function themeRamps(theme: Theme): Ramp[] {
  // Gray leans a little towards the theme's stone, so shadows and metal share its cast.
  const stone = theme.stone;
  const avg = (stone[0] + stone[1] + stone[2]) / 3;
  const cast = stone.map((v) => (v - avg) * 0.5);
  const gray: Ramp = {
    name: 'gray',
    dark: to8([0.04 + cast[0]! * 0.15, 0.04 + cast[1]! * 0.15, 0.047 + cast[2]! * 0.15]),
    light: to8([0.89 + cast[0]! * 0.35, 0.89 + cast[1]! * 0.35, 0.87 + cast[2]! * 0.35]),
  };
  // The hazard ramp also carries yellow keys and fire: where the theme paints hazards in its
  // light's hue (hell's orange on orange), it turns to amber so the two ramps do not duplicate.
  const hazard = hueGap(hueOf(theme.hazard), hueOf(theme.techLight)) < 30 ? withHue(theme.hazard, AMBER) : theme.hazard;
  return [gray, rampThrough('stone', stone), rampThrough('tech', theme.techLight), FIXED.blood, FIXED.steel, rampThrough('hazard', hazard), FIXED.toxic, FIXED.bone];
}

const AMBER = 46;
function hueOf(c: readonly number[]): number {
  const [r, g, b] = c as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  return d === 0 ? 0 : (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
/** The colour with its hue set to h (saturation and value kept). */
function withHue(c: readonly number[], h: number): number[] {
  const max = Math.max(...c);
  const min = Math.min(...c);
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return max - (max - min) * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** The ramps for a theme by name (base when unknown). */
export function paletteRamps(name: ThemeName | string | undefined): Ramp[] {
  return themeRamps(THEME_COLORS[(name ?? 'base') as ThemeName] ?? THEME_COLORS.base);
}

/** Step s (0 dark … RAMP_STEPS - 1 light) of a ramp. */
export function rampStep(r: Ramp, s: number): Rgb8 {
  // Slight gamma so dark steps are closer together (more shadow detail).
  const t = Math.pow(s / (RAMP_STEPS - 1), 1.4);
  const m = r.mid;
  if (!m) return r.dark.map((d, c) => Math.round(d + (r.light[c]! - d) * t)) as unknown as Rgb8;
  return (t < THROUGH
    ? r.dark.map((d, c) => Math.round(d + (m[c]! - d) * (t / THROUGH)))
    : m.map((d, c) => Math.round(d + (r.light[c]! - d) * ((t - THROUGH) / (1 - THROUGH))))) as unknown as Rgb8;
}

/** RGBA8 data for a PALETTE_SIZE × 1 texture: the theme's palette (base when none is given). */
export function paletteRGBA(name?: ThemeName | string): Uint8Array {
  const out = new Uint8Array(PALETTE_SIZE * 4);
  paletteRamps(name).forEach((r, ri) => {
    for (let s = 0; s < RAMP_STEPS; s++) {
      const i = (ri * RAMP_STEPS + s) * 4;
      out.set(rampStep(r, s), i);
      out[i + 3] = 255;
    }
  });
  return out;
}

/** The palette colour a colour quantizes to (as the post pass picks it), and its ramp. */
export function quantize(rgb: Rgb8, name?: ThemeName | string): { color: Rgb8; ramp: RampName; step: number } {
  let best = { color: [0, 0, 0] as Rgb8, ramp: 'gray' as RampName, step: 0 };
  let bestD = Infinity;
  for (const r of paletteRamps(name)) {
    for (let s = 0; s < RAMP_STEPS; s++) {
      const p = rampStep(r, s);
      const d = ((rgb[0] - p[0]) * 0.55) ** 2 + ((rgb[1] - p[1]) * 0.77) ** 2 + ((rgb[2] - p[2]) * 0.33) ** 2;
      if (d < bestD) [bestD, best] = [d, { color: p, ramp: r.name, step: s }];
    }
  }
  return best;
}
