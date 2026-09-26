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
  /**
   * Bitfield for sector specials. Bits 0–1: door kind (see DoorKind); a key door's key id
   * is the sector's `tag`. Bit 2: secret area (SPECIAL_SECRET_AREA), with the secret's id in
   * `tag`. Bit 3: lift (SPECIAL_LIFT). Bit 4: damaging floor (SPECIAL_DAMAGE). Other bits
   * reserved (flicker…).
   */
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
  /** Restores health when walked over. */
  Health: 3,
  /** Refills ammo when walked over. */
  Ammo: 4,
} as const;

/** Enemy thing types. Stats and behaviour live in the sim (`ENEMY_DEFS`). */
export const EnemyType = {
  /** Throws slow projectiles you can sidestep. */
  Grunt: 32,
  /** Charges and hits in melee. */
  Brute: 33,
  /** Rare: charges up a visible hitscan shot; break line of sight to dodge it. */
  Sniper: 34,
  MiniBoss: 40,
  Boss: 41,
} as const;
export type EnemyType = (typeof EnemyType)[keyof typeof EnemyType];
const ENEMY_TYPES = new Set<number>(Object.values(EnemyType));
export const isEnemyThing = (type: number): type is EnemyType => ENEMY_TYPES.has(type);

/** Key things are KEY_THING_BASE + key id, for key ids 0 … MAX_KEYS - 1. */
export const KEY_THING_BASE = 16;
export const MAX_KEYS = 4;
export const keyThing = (key: number): number => KEY_THING_BASE + key;
/** Key id carried by a thing type, or -1. */
export function keyOfThing(type: number): number {
  const k = type - KEY_THING_BASE;
  return k >= 0 && k < MAX_KEYS ? k : -1;
}

/**
 * Doors are one-cell sectors, stored open (ceiling at its full height); the sim starts them
 * closed and lowers the ceiling to the floor. See "Doors (decided)" in PROJECT_SUMMARY.md.
 */
export const DoorKind = {
  None: 0,
  /** Opens when walked into. */
  Auto: 1,
  /** Opens with the use key (E/Space) while holding key `tag`. */
  Key: 2,
  /** Looks like the wall around it; opens with the use key. Part of secret area `tag`. */
  Secret: 3,
} as const;
export type DoorKind = (typeof DoorKind)[keyof typeof DoorKind];
export const SPECIAL_DOOR_MASK = 3;
export const doorKindOf = (s: Sector): DoorKind => (s.special & SPECIAL_DOOR_MASK) as DoorKind;

/**
 * Secret areas: every sector of a secret (its door, corridor and room) carries this bit with
 * the secret's id in `tag`. The automap hides them until the secret is found.
 */
export const SPECIAL_SECRET_AREA = 1 << 2;
/** Secret id of a sector, or -1. */
export const secretOf = (s: Sector): number => (s.special & SPECIAL_SECRET_AREA ? s.tag : -1);
/**
 * Lifts: a one-cell sector whose floor travels between its stored floor (the bottom) and the
 * height in its `tag` (the top). Maps store it at the bottom; the sim moves it. A lift joins
 * storeys: the grid treats it as level with a neighbour at either end, because it can be called.
 */
export const SPECIAL_LIFT = 1 << 3;
export const isLift = (s: Sector): boolean => (s.special & SPECIAL_LIFT) !== 0;
/** The floor a lift at rest can stand at that is nearest to `height`. */
export const liftFloorNear = (s: Sector, height: number): number => Math.max(s.floor, Math.min(s.tag, height));

/** A floor that hurts whoever stands on it: slime or lava. */
export const SPECIAL_DAMAGE = 1 << 4;
export const isDamaging = (s: Sector): boolean => (s.special & SPECIAL_DAMAGE) !== 0;

/** Number of secrets in a map (ids are 0 … n - 1). */
export function secretCount(map: MapData): number {
  return map.sectors.reduce((n, s) => Math.max(n, secretOf(s) + 1), 0);
}

/** Door sectors in index order. A door's position in this list is its door id (sim state, renderer). */
export function doorSectors(map: MapData): number[] {
  const out: number[] = [];
  map.sectors.forEach((s, i) => doorKindOf(s) !== DoorKind.None && out.push(i));
  return out;
}

export interface MapMeta {
  name: string;
  /** Present on generated maps: seed + generator version reproduces the map. */
  seed?: string;
  generatorVersion?: string;
  /** Visual theme id; resolves textures and palette. */
  theme?: string;
  /** Position in a run (1 = first level); generated difficulty rises with it. */
  level?: number;
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
