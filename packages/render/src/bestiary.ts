import { Rng, type ThemeName } from '@proc-fps/core';
import type { UniformValue } from './backend.js';
import { SPRITE_PLAN_VEC4S, SPRITE_ROWS } from './shaders.js';
import { THEME_COLORS, type Theme } from './themes.js';

type Rgb = readonly [number, number, number];

/**
 * How a level's mutants look: one body plan per sprite row (grunt, grunt, brute, brute, sniper,
 * sniper, mini boss, boss, charger, bloater, warden: the first three ordinary roles come in two
 * variants, see core's enemyDefsFor),
 * bred from the level's seed and baked by SPRITE_BAKE_FS. Looks are render-only.
 *
 * Skins must stand out from the level: every role gets a hue kept away from the theme's saturated
 * colours (its lights, slime, hazard paint, tinted stone) and from the other roles, so a green
 * crypt never breeds green mutants and a brute never passes for a grunt. A role's second variant
 * shifts its hue and flips its lightness, stands on different legs and grows a different body, so
 * the two read apart at a glance. Accents come from several schemes (a darker shade, the
 * complement, a triad, a pale belly), and some mutants carry glowing markings.
 */
export interface EnemyLook {
  /** Forward lean of everything above the hips (0 = upright). */
  hunch: number;
  /** Limb length or heft, about 1. */
  heft: number;
  head: number;
  jaw: number;
  /** Horn pairs, 0–2. */
  horns: number;
  hornLength: number;
  /** Back spikes, 0–6. */
  spikes: number;
  /** 1–4. */
  eyes: number;
  /** A second, smaller pair of arms. */
  extraArms: boolean;
  /** Tail length in sprite heights; 0 = none. */
  tail: number;
  /** Width scale of the whole body, about 1. */
  bulk: number;
  /** 0 biped, 1 digitigrade, 2 crawler, 3 slug (the boss keeps its own stumps). */
  legs: number;
  /** 0 mottled, 1 banded, 2 spotted, 3 pale-bellied. */
  pattern: number;
  patternScale: number;
  skin: Rgb;
  accent: Rgb;
  /** Markings (the pattern's accent areas) that glow in this colour, or null. */
  glow: Rgb | null;
}

/** Hue in degrees [0, 360), saturation and value in [0, 1]. */
function hsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max === 0 ? 0 : d / max, max];
}

function rgb(h: number, s: number, v: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

export const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * The hues a theme claims, each with the half-width of the band around it enemies keep out of:
 * wider for more saturated colours. Near-grey colours claim nothing.
 */
export function themeHues(theme: Theme): { hue: number; radius: number }[] {
  return Object.values(theme).flatMap((c: Rgb) => {
    const [h, s] = hsv(c);
    return s < 0.12 ? [] : [{ hue: h, radius: 15 + 35 * s }];
  });
}

/** Keeps role hues at least this far apart. */
const ROLE_SEPARATION = 40;
const ROLES = 8;
/** The role behind each sprite row: grunt, brute, sniper (two rows each), mini boss, boss, charger, bloater, warden. */
export const ROW_ROLE: readonly number[] = [0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7];
const BOSS_ROLE = 4;

/** How far a hue is from the theme's claims (negative: inside one). */
const clearance = (claims: { hue: number; radius: number }[], h: number) => Math.min(180, ...claims.map((c) => hueDistance(h, c.hue) - c.radius));

function pickHues(claims: { hue: number; radius: number }[], rng: Rng): number[] {
  const chosen: number[] = [];
  for (let role = 0; role < ROLES; role++) {
    let best = 0;
    let bestScore = -Infinity;
    for (let h = 0; h < 360; h += 5) {
      const apart = Math.min(180, ...chosen.map((c) => hueDistance(h, c) - ROLE_SEPARATION));
      const score = Math.min(clearance(claims, h), apart) + rng.range(0, 12);
      if (score > bestScore) [best, bestScore] = [h, score];
    }
    chosen.push(best);
  }
  return chosen;
}

const weighted = (rng: Rng, weights: readonly number[]): number => {
  let x = rng.range(0, weights.reduce((a, b) => a + b, 0));
  for (let i = 0; i < weights.length; i++) if ((x -= weights[i]!) < 0) return i;
  return weights.length - 1;
};

interface RoleRanges {
  hunch: number;
  heft: [number, number];
  horns: number;
  hornLength: [number, number];
  spikes: [number, number];
  /** Weights for 1, 2, 3, 4 eyes. */
  eyes: [number, number, number, number];
  extraArms: number;
  tail: [number, number, number];
  bulk: [number, number];
  /** Weights for biped, digitigrade, crawler, slug legs. */
  legs: [number, number, number, number];
  /** Chance of glowing markings (GLOW_CHANCE unless given). */
  glow?: number;
}

// Per role: how far each trait may wander. Chances are 0–1; tail = [chance, min, max].
const RANGES: RoleRanges[] = [
  { hunch: 0.2, heft: [0.85, 1.2], horns: 0.35, hornLength: [0.05, 0.12], spikes: [0, 4], eyes: [1, 5, 2, 2], extraArms: 0.25, tail: [0.3, 0.1, 0.25], bulk: [0.9, 1.12], legs: [4, 3, 2, 1] },
  { hunch: 0.12, heft: [0.9, 1.25], horns: 0.45, hornLength: [0.06, 0.12], spikes: [2, 5], eyes: [0, 6, 2, 2], extraArms: 0.2, tail: [0.25, 0.1, 0.2], bulk: [0.95, 1.1], legs: [5, 3, 1, 1] },
  { hunch: 0.15, heft: [0.8, 1.2], horns: 0.3, hornLength: [0.04, 0.1], spikes: [0, 3], eyes: [6, 2, 2, 0], extraArms: 0.15, tail: [0.35, 0.1, 0.25], bulk: [0.9, 1.05], legs: [3, 3, 2, 2] },
  { hunch: 0.12, heft: [0.95, 1.25], horns: 0.7, hornLength: [0.07, 0.13], spikes: [3, 5], eyes: [0, 5, 3, 2], extraArms: 0.35, tail: [0.3, 0.1, 0.2], bulk: [1.0, 1.1], legs: [5, 3, 1, 0] },
  { hunch: 0, heft: [0.9, 1.2], horns: 0.8, hornLength: [0.08, 0.14], spikes: [2, 6], eyes: [0, 2, 3, 4], extraArms: 0.4, tail: [0.4, 0.15, 0.3], bulk: [0.95, 1.02], legs: [1, 0, 0, 0] },
  // Charger (on the brute): always horned, head down, on digitigrade legs or four.
  { hunch: 0.32, heft: [1.0, 1.25], horns: 1, hornLength: [0.1, 0.15], spikes: [3, 6], eyes: [0, 5, 3, 1], extraArms: 0.1, tail: [0.5, 0.12, 0.25], bulk: [1.0, 1.1], legs: [1, 5, 3, 0] },
  // Bloater (on the grunt): swollen, many-eyed, glowing, on stubby legs or a slug's foot.
  { hunch: 0.05, heft: [0.8, 0.95], horns: 0.1, hornLength: [0.04, 0.08], spikes: [0, 2], eyes: [0, 2, 3, 5], extraArms: 0.1, tail: [0.1, 0.08, 0.15], bulk: [1.28, 1.42], legs: [3, 0, 2, 4], glow: 1 },
  // Warden (on the sniper): upright and unhurried.
  { hunch: 0, heft: [0.95, 1.2], horns: 0.5, hornLength: [0.05, 0.1], spikes: [0, 2], eyes: [2, 5, 2, 0], extraArms: 0.3, tail: [0.2, 0.1, 0.2], bulk: [1.0, 1.15], legs: [6, 2, 1, 0] },
];
/** Chance a mutant has glowing markings. */
const GLOW_CHANCE = 0.3;

/** The level's mutants, one look per sprite row. Deterministic in seed and theme. */
export function enemyLooks(seed: string, theme: ThemeName): EnemyLook[] {
  const rng = new Rng(seed).fork('bestiary').fork('looks');
  const claims = themeHues(THEME_COLORS[theme] ?? THEME_COLORS.base);
  const roleHues = pickHues(claims, rng.fork('hues'));
  const looks: EnemyLook[] = [];
  ROW_ROLE.forEach((role, row) => {
    const R = RANGES[role]!;
    const r = rng.fork(`row${row}`);
    const first = row > 0 && ROW_ROLE[row - 1] === role ? looks[row - 1]! : undefined;
    // Colour: the role's hue for the first variant; the second shifts it towards clearer ground and
    // flips its lightness.
    let hue = roleHues[role]!;
    let v = r.range(0.45, 0.8);
    const s = r.range(0.3, 0.8);
    if (first) {
      const shift = r.range(30, 50);
      hue = clearance(claims, hue + shift) >= clearance(claims, hue - shift) ? hue + shift : hue - shift;
      const [, , v0] = hsv(first.skin);
      v = v0 > 0.62 ? r.range(0.4, v0 - 0.18) : r.range(Math.min(0.85, v0 + 0.15), 0.85);
    }
    const pattern = first ? (first.pattern + r.int(1, 3)) % 4 : r.int(0, 3);
    const scheme = r.int(0, 2); // 0 a darker shade, 1 the complement, 2 a triad
    const accent =
      pattern === 3
        ? rgb(hue, s * 0.5, Math.min(1, v * 1.08))
        : scheme === 0
          ? rgb(hue + r.range(-25, 25), Math.min(1, s * 1.1), v * 0.55)
          : rgb(hue + (scheme === 1 ? 180 : r.chance(0.5) ? 120 : -120), Math.min(1, s * 0.9 + 0.1), v * 0.7);
    // Glowing markings in the hue farthest from both the theme and the skin.
    let glow: Rgb | null = null;
    if (r.chance(R.glow ?? GLOW_CHANCE)) {
      let best = 0;
      let bestScore = -Infinity;
      for (let h = 0; h < 360; h += 10) {
        const score = Math.min(clearance(claims, h), hueDistance(h, hue)) + r.range(0, 20);
        if (score > bestScore) [best, bestScore] = [h, score];
      }
      glow = rgb(best, 0.85, 1);
    }
    let legs = role === BOSS_ROLE ? 0 : weighted(r, R.legs);
    if (first && legs === first.legs && role !== BOSS_ROLE) legs = (legs + 1 + r.int(0, 2)) % 4;
    const tail = r.chance(R.tail[0]) ? r.range(R.tail[1], R.tail[2]) : 0;
    const horns = r.chance(R.horns) ? (r.chance(0.35) ? 2 : 1) : 0;
    looks.push({
      hunch: r.range(0, R.hunch),
      heft: r.range(...R.heft),
      head: r.range(0.85, 1.28),
      jaw: r.range(0.7, 1.4),
      horns,
      hornLength: r.range(...R.hornLength),
      spikes: r.chance(0.3) ? 0 : r.int(...R.spikes),
      eyes: 1 + weighted(r, R.eyes),
      extraArms: r.chance(R.extraArms),
      tail,
      bulk: r.range(...R.bulk),
      legs,
      pattern,
      patternScale: pattern === 1 ? r.range(14, 26) : pattern === 2 ? r.range(10, 18) : r.range(6, 12),
      skin: rgb(hue, s, v),
      accent,
      glow,
    });
  });
  return looks;
}

/** Baseline looks (hand-built maps): the M7 mutants' plans and colours, both variants alike. */
export const BASELINE_LOOKS: EnemyLook[] = ROW_ROLE.map((role) => {
  const skin = ([[0.36, 0.4, 0.26], [0.5, 0.22, 0.17], [0.34, 0.38, 0.46], [0.55, 0.3, 0.12], [0.36, 0.2, 0.36], [0.46, 0.36, 0.2], [0.55, 0.52, 0.3], [0.3, 0.34, 0.4]] as Rgb[])[role]!;
  return {
    hunch: role === 5 ? 0.3 : 0, heft: 1, head: 1, jaw: 1, horns: role === 5 ? 1 : 0, hornLength: role === 5 ? 0.13 : 0.1, spikes: role === 1 || role === 3 || role === 5 ? 4 : 0,
    eyes: role === 2 ? 1 : role === 4 || role === 6 ? 4 : 2, extraArms: false, tail: 0, bulk: role === 6 ? 1.35 : 1, legs: role === 5 ? 1 : role === 6 ? 3 : 0, pattern: role === 6 ? 2 : 0, patternScale: 8,
    skin, accent: skin.map((c) => c * 0.6) as unknown as Rgb, glow: null,
  };
});

/** The bake's uniforms: `uPlan` from the looks, `uAspect` from each row's quad width / height. */
export function lookUniforms(looks: readonly EnemyLook[], aspects: readonly number[]): Record<string, UniformValue> {
  const plan = new Float32Array(SPRITE_ROWS * SPRITE_PLAN_VEC4S * 4);
  looks.forEach((l, i) => {
    plan.set(
      [
        l.hunch, l.heft, l.head, l.jaw,
        l.horns, l.hornLength, l.spikes, l.eyes,
        ...l.skin, l.pattern,
        ...l.accent, l.patternScale,
        l.extraArms ? 1 : 0, l.tail, l.bulk, l.legs,
        ...(l.glow ?? [0, 0, 0]), l.glow ? 1 : 0,
      ],
      i * SPRITE_PLAN_VEC4S * 4,
    );
  });
  return { uPlan: { vec4s: plan }, uAspect: { floats: new Float32Array(aspects) } };
}
