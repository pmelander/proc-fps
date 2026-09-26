import { Rng, type ThemeName } from '@proc-fps/core';
import type { UniformValue } from './backend.js';

type Rgb = readonly [number, number, number];

/** The colours a theme gives the baked texture set (see ATLAS_FS). */
export interface Theme {
  stone: Rgb;
  mortar: Rgb;
  metal: Rgb;
  techBase: Rgb;
  techLight: Rgb;
  floor: Rgb;
  ceiling: Rgb;
  hazard: Rgb;
  slime: Rgb;
  doorPlate: Rgb;
  doorTrim: Rgb;
}

export const THEME_COLORS: Record<ThemeName, Theme> = {
  base: {
    stone: [0.42, 0.38, 0.33], mortar: [0.12, 0.12, 0.12], metal: [0.34, 0.38, 0.44], techBase: [0.16, 0.18, 0.2],
    techLight: [0.2, 0.7, 1.0], floor: [0.36, 0.3, 0.24], ceiling: [0.26, 0.26, 0.26], hazard: [0.85, 0.62, 0.1],
    slime: [0.1, 0.55, 0.12], doorPlate: [0.3, 0.29, 0.27], doorTrim: [0.45, 0.42, 0.38],
  },
  tech: {
    stone: [0.3, 0.33, 0.38], mortar: [0.06, 0.07, 0.09], metal: [0.4, 0.46, 0.54], techBase: [0.12, 0.16, 0.2],
    techLight: [0.3, 0.95, 1.0], floor: [0.24, 0.27, 0.3], ceiling: [0.2, 0.22, 0.25], hazard: [0.95, 0.8, 0.15],
    slime: [0.1, 0.45, 0.6], doorPlate: [0.32, 0.36, 0.42], doorTrim: [0.55, 0.6, 0.66],
  },
  hell: {
    stone: [0.46, 0.22, 0.16], mortar: [0.1, 0.03, 0.02], metal: [0.36, 0.28, 0.24], techBase: [0.2, 0.1, 0.08],
    techLight: [1.0, 0.45, 0.1], floor: [0.34, 0.2, 0.14], ceiling: [0.22, 0.12, 0.1], hazard: [0.9, 0.35, 0.08],
    slime: [0.85, 0.32, 0.04], doorPlate: [0.32, 0.18, 0.14], doorTrim: [0.55, 0.3, 0.2],
  },
  crypt: {
    stone: [0.32, 0.36, 0.3], mortar: [0.07, 0.09, 0.06], metal: [0.3, 0.33, 0.3], techBase: [0.14, 0.17, 0.13],
    techLight: [0.55, 1.0, 0.45], floor: [0.28, 0.3, 0.22], ceiling: [0.2, 0.22, 0.18], hazard: [0.75, 0.7, 0.3],
    slime: [0.3, 0.5, 0.1], doorPlate: [0.28, 0.27, 0.22], doorTrim: [0.42, 0.44, 0.34],
  },
};

/** Uniforms for the atlas bake: the theme's colours with a little seeded variation, plus the seed. */
export function themeUniforms(name: ThemeName, seed: string): Record<string, UniformValue> {
  const theme = THEME_COLORS[name] ?? THEME_COLORS.base;
  const rng = new Rng(seed).fork('textures');
  const out: Record<string, UniformValue> = { uSeed: rng.range(0, 100) };
  for (const [key, rgb] of Object.entries(theme) as [keyof Theme, Rgb][]) {
    const k = rng.range(0.9, 1.1);
    out[`u${key[0]!.toUpperCase()}${key.slice(1)}`] = new Float32Array(rgb.map((c) => Math.min(1, c * k)));
  }
  return out;
}
