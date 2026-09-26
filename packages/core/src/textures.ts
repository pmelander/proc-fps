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
} as const;
