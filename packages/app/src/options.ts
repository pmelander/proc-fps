/**
 * The player's options: look, view, audio and comfort settings, kept in the browser's storage
 * (guarded: no storage just means the defaults every time). Every option is render- or input-side:
 * none reaches the sim, so replays are unaffected (sensitivity only scales the turn the input
 * records). Pure apart from the storage calls, so it can be checked in Node.
 */
export interface Options {
  /** Mouse sensitivity, in tenths (10 = the tuned default). */
  sensitivity: number;
  /** Mouse up looks down. */
  invert: boolean;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Rows the scene is drawn at (240 is the look it was made for). */
  resolution: number;
  /** Music and sound volume, 0–10. */
  music: number;
  sound: number;
  /** Screen shake on hits and blasts. */
  shake: boolean;
  /** Full-strength flashes (muzzle, blasts, the red hurt flash); off keeps them faint. */
  flashes: boolean;
  /** The view bobs with each step. */
  bob: boolean;
}

export const DEFAULT_OPTIONS: Readonly<Options> = { sensitivity: 10, invert: false, fov: 74, resolution: 240, music: 10, sound: 10, shake: true, flashes: true, bob: true };

type RangeKey = { [K in keyof Options]: Options[K] extends number ? K : never }[keyof Options];
type ToggleKey = { [K in keyof Options]: Options[K] extends boolean ? K : never }[keyof Options];

export type OptionDef =
  | { key: RangeKey; label: string; hint: string; min: number; max: number; step: number; format: (v: number) => string; bar?: boolean }
  | { key: ToggleKey; label: string; hint: string };

/** The options in menu order. */
export const OPTION_DEFS: readonly OptionDef[] = [
  { key: 'sensitivity', label: 'Mouse speed', hint: 'How far the view turns for the mouse.', min: 1, max: 30, step: 1, format: (v) => `${(v / 10).toFixed(1)}×` },
  { key: 'invert', label: 'Invert look', hint: 'Mouse up looks down.' },
  { key: 'fov', label: 'Field of view', hint: 'Vertical, in degrees: wider sees more, narrower looks bigger.', min: 60, max: 90, step: 2, format: (v) => `${v}°` },
  { key: 'resolution', label: 'Resolution', hint: 'Rows the scene is drawn at: 240 is the chunky look it was made for; higher is sharper and costs more.', min: 240, max: 480, step: 60, format: (v) => `${v}p` },
  { key: 'music', label: 'Music', hint: 'Music volume (M mutes it in play).', min: 0, max: 10, step: 1, format: String, bar: true },
  { key: 'sound', label: 'Sound', hint: 'Sound volume (N mutes it in play).', min: 0, max: 10, step: 1, format: String, bar: true },
  { key: 'shake', label: 'Screen shake', hint: 'The view jolts on heavy hits and blasts.' },
  { key: 'flashes', label: 'Flashes', hint: 'Off keeps muzzle, blast and hurt flashes faint.' },
  { key: 'bob', label: 'Head bob', hint: 'The view bobs with each step.' },
];

const KEY = 'proc-fps.options';

/** Whole, in range, on a step: what storage or a stray value gives back, made valid. */
export function sanitize(raw: unknown): Options {
  const o: Options = { ...DEFAULT_OPTIONS };
  if (!raw || typeof raw !== 'object') return o;
  const r = raw as Record<string, unknown>;
  for (const def of OPTION_DEFS) {
    const v = r[def.key];
    if ('min' in def) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const stepped = def.min + Math.round((v - def.min) / def.step) * def.step;
      o[def.key] = Math.max(def.min, Math.min(def.max, stepped));
    } else if (typeof v === 'boolean') {
      o[def.key] = v;
    }
  }
  return o;
}

/** The options with one turned a step left (-1) or right (+1); toggles flip either way. */
export function adjustOption(o: Options, key: keyof Options, dir: -1 | 1): Options {
  const def = OPTION_DEFS.find((d) => d.key === key);
  if (!def) return o;
  if (!('min' in def)) return { ...o, [def.key]: !o[def.key] };
  return { ...o, [def.key]: Math.max(def.min, Math.min(def.max, o[def.key] + dir * def.step)) };
}

export function loadOptions(): Options {
  try {
    const s = localStorage.getItem(KEY);
    return sanitize(s ? JSON.parse(s) : null);
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(o: Options): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // Not remembered, that is all.
  }
}
