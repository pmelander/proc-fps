/**
 * Map format v0 — the backbone intermediate representation.
 *
 * The generator emits it, the sim and renderer consume it, hand-authored test
 * maps use it, and a future editor will read/write it. Bump MAP_FORMAT_VERSION
 * on any breaking change and add a migration in `migrate.ts` (not yet needed).
 *
 * Conventions (all consumers rely on these):
 * - Map space is 2D (x, y), y pointing "north". Units ≈ Doom units (player radius 16).
 * - World space: X = map.x, Y = height (up), Z = -map.y. Right-handed.
 * - A linedef's FRONT side is on the LEFT of v1 → v2. (Doom uses the right;
 *   we use left so sector outer loops are CCW / positive area.)
 * - One-sided lines have no `back`. Two-sided lines connect front.sector ↔ back.sector.
 * - Sector boundaries: every edge of a sector has that sector on its left when
 *   walked in the direction implied by the side. Outer loops are CCW, holes CW.
 */

export const MAP_FORMAT_VERSION = 0 as const;

/** Texture ids are small integers resolved by a theme/texture set. 0 = none. */
export type TextureId = number;

export interface Vertex {
  x: number;
  y: number;
}

export interface Side {
  sector: number;
  upper: TextureId;
  middle: TextureId;
  lower: TextureId;
}

export interface Linedef {
  v1: number;
  v2: number;
  front: Side;
  back?: Side;
  /** Bitfield, see LineFlags. */
  flags: number;
  /** Links the line to sectors/actions with the same tag (doors, lifts, triggers). */
  tag: number;
}

export const LineFlags = {
  /** Blocks movement even if two-sided (e.g. windows, railings). */
  Impassable: 1 << 0,
  /** Hidden on the automap (secrets). */
  Secret: 1 << 1,
} as const;

export interface Sector {
  floor: number;
  ceil: number;
  /** 0–255, Doom-style. */
  light: number;
  floorTex: TextureId;
  ceilTex: TextureId;
  tag: number;
  /** Bitfield for sector specials (damage floors, secrets, flicker…). Reserved. */
  special: number;
}

export interface Thing {
  /** See ThingType. */
  type: number;
  x: number;
  y: number;
  /** Degrees, 0 = +x (east), counter-clockwise. */
  angle: number;
  flags: number;
}

export const ThingType = {
  PlayerStart: 1,
  Exit: 2,
} as const;

export interface MapMeta {
  name: string;
  /** Present on generated maps: seed + generator version reproduces the map. */
  seed?: string;
  generatorVersion?: string;
  /** Visual theme id; resolves textures and palette. */
  theme?: string;
}

export interface MapData {
  version: typeof MAP_FORMAT_VERSION;
  meta: MapMeta;
  vertices: Vertex[];
  linedefs: Linedef[];
  sectors: Sector[];
  things: Thing[];
}

/** Stable, order-sensitive hash of a map; used to bind replays to maps. */
export function hashMap(map: MapData): string {
  const s = JSON.stringify(map);
  // FNV-1a 32-bit, twice with different offsets for 64 bits of spread.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193 + 2);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
