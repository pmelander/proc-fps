/**
 * Texture ids for the built-in "base" theme. Themes map these ids to procedural
 * texture recipes (M4). Until then the renderer draws a placeholder pattern per id.
 */
export const BaseTex = {
  None: 0,
  Stone: 1,
  Metal: 2,
  Tech: 3,
  FloorTile: 4,
  Ceiling: 5,
  Trim: 6,
  Slime: 7,
  /** Door panels: auto doors use Door, key doors DoorKey + their key id. */
  Door: 8,
  DoorKey: 10,
  /** Key pickup markers: Key + key id. */
  Key: 14,
  /** Health pickup marker. */
  Health: 18,
  /** Lift platforms and their sides: a steel deck with a warning border. */
  Lift: 20,
  /** Catwalk tops: steel grating. */
  Grate: 21,
  /** The walls of a door cell: a steel jamb with a light strip. */
  DoorFrame: 22,
  /** The exit pad the renderer lays over the exit's cell: a glowing ring in the theme's light. */
  Exit: 23,
} as const;

/** Visual themes: each picks the colours of the baked texture set (render/src/themes.ts). */
export const THEME_NAMES = ['base', 'tech', 'hell', 'crypt'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
