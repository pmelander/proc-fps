import type { VertexLayout } from './backend.js';

/**
 * Camera-facing sprites for things that move: enemies, corpses and projectiles. Rebuilt on the
 * CPU every frame into a dynamic buffer (a handful of quads). Enemies sample the baked sprite
 * atlas (SPRITE_BAKE_FS: 8 directions × 4 frames); projectiles are drawn procedurally.
 */

/** Atlas tile for a sprite row (see spriteRow), view direction 0–7 and frame (0/1 walk, 2 attack, 3 dead). */
export function spriteTile(row: number, direction: number, frame: number): number {
  return row * 32 + direction * 4 + frame;
}

/**
 * The atlas row for an enemy shape (SpriteShape.Grunt … Boss) and its variant: the three ordinary
 * roles have two rows each (the level's two variants), then the mini boss and the boss.
 */
export function spriteRow(shape: number, variant: number): number {
  return shape <= SpriteShape.Sniper ? shape * 2 + (variant ? 1 : 0) : shape + 3;
}

/** pos(3) uv(2) shape(1) charge(1) flash(1) light(1) tile(1) */
export const SPRITE_FLOATS_PER_VERTEX = 10;
export const SPRITE_LAYOUT: VertexLayout = {
  stride: SPRITE_FLOATS_PER_VERTEX * 4,
  attributes: [
    { name: 'aPos', components: 3, offset: 0 },
    { name: 'aUV', components: 2, offset: 12 },
    { name: 'aShape', components: 1, offset: 20 },
    { name: 'aCharge', components: 1, offset: 24 },
    { name: 'aFlash', components: 1, offset: 28 },
    { name: 'aLight', components: 1, offset: 32 },
    { name: 'aTile', components: 1, offset: 36 },
  ],
};

/** Shape ids the sprite shader knows. */
export const SpriteShape = {
  Grunt: 0,
  Brute: 1,
  Sniper: 2,
  MiniBoss: 3,
  Boss: 4,
  Projectile: 8,
  Corpse: 9,
  /** Keys: Key + key id (0–3), in the key's colour. */
  Key: 10,
  Gib: 14,
  Blood: 15,
  /** A shimmering column of light over the exit, screen-door transparent. */
  ExitBeacon: 16,
  /** A white-hot spark (pellet tracers and impacts); self-lit. */
  Spark: 17,
  /** A chip of stone or metal knocked off a wall by a pellet. */
  Chip: 18,
  /** A glowing ring on the floor: a boss's slam about to land within it (flat, self-lit, pulsing). */
  Warning: 19,
  /** A grenade: lying as a pickup, or in flight. A dark casing, a brass band, a blinking light. */
  Grenade: 20,
} as const;

export interface Sprite {
  /** Map-space position of the sprite's bottom centre. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  shape: number;
  /** 0–1: attack wind-up, drawn as glowing eyes (the telegraph). */
  charge: number;
  /** 0–1: pain flash. */
  flash: number;
  /** 0–1 sector light; 1 for things that glow. */
  light: number;
  /** Baked sprite atlas tile (see SPRITE_BAKE_FS), or -1 to draw `shape` procedurally. */
  tile: number;
  /** Lies flat on the floor (a pool of blood): a width × height quad in the map plane at z. */
  flat?: boolean;
}

const CORNERS = [
  [-0.5, 0], [0.5, 0], [0.5, 1],
  [-0.5, 0], [0.5, 1], [-0.5, 1],
] as const;

/**
 * Two triangles per sprite, facing a camera with this yaw (map radians). Writes into `scratch` when
 * it is big enough (no allocation per frame) and returns the part used. Pure: runs in Node for tests.
 */
export function buildSpriteVertices(sprites: readonly Sprite[], yaw: number, scratch?: Float32Array): Float32Array {
  const need = sprites.length * CORNERS.length * SPRITE_FLOATS_PER_VERTEX;
  const out = scratch && scratch.length >= need ? scratch.subarray(0, need) : new Float32Array(need);
  // Camera right in map space is the view direction turned 90° clockwise.
  const rx = Math.sin(yaw);
  const ry = -Math.cos(yaw);
  let o = 0;
  for (const s of sprites) {
    for (const [u, v] of CORNERS) {
      // Flat sprites lie in the map plane (x across, y along); the rest stand facing the camera.
      const mx = s.flat ? s.x + u * s.width : s.x + rx * u * s.width;
      const my = s.flat ? s.y + (v - 0.5) * s.height : s.y + ry * u * s.width;
      // World: X = map.x, Y = height, Z = -map.y
      // Written field by field: hundreds of gore particles per frame, so no per-vertex arrays.
      out[o] = mx;
      out[o + 1] = s.flat ? s.z : s.z + v * s.height;
      out[o + 2] = -my;
      out[o + 3] = u + 0.5;
      out[o + 4] = v;
      out[o + 5] = s.shape;
      out[o + 6] = s.charge;
      out[o + 7] = s.flash;
      out[o + 8] = s.light;
      out[o + 9] = s.tile;
      o += SPRITE_FLOATS_PER_VERTEX;
    }
  }
  return out;
}
