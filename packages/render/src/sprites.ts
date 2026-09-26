import type { VertexLayout } from './backend.js';

/**
 * Camera-facing sprites for things that move: enemies, corpses and projectiles. Rebuilt on the
 * CPU every frame into a dynamic buffer (a handful of quads). Shapes are drawn procedurally in
 * the fragment shader until M4 bakes real sprites.
 */

/** pos(3) uv(2) shape(1) charge(1) flash(1) light(1) */
export const SPRITE_FLOATS_PER_VERTEX = 9;
export const SPRITE_LAYOUT: VertexLayout = {
  stride: SPRITE_FLOATS_PER_VERTEX * 4,
  attributes: [
    { name: 'aPos', components: 3, offset: 0 },
    { name: 'aUV', components: 2, offset: 12 },
    { name: 'aShape', components: 1, offset: 20 },
    { name: 'aCharge', components: 1, offset: 24 },
    { name: 'aFlash', components: 1, offset: 28 },
    { name: 'aLight', components: 1, offset: 32 },
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
}

const CORNERS = [
  [-0.5, 0], [0.5, 0], [0.5, 1],
  [-0.5, 0], [0.5, 1], [-0.5, 1],
] as const;

/** Two triangles per sprite, facing a camera with this yaw (map radians). Pure: runs in Node for tests. */
export function buildSpriteVertices(sprites: readonly Sprite[], yaw: number): Float32Array {
  const out = new Float32Array(sprites.length * CORNERS.length * SPRITE_FLOATS_PER_VERTEX);
  // Camera right in map space is the view direction turned 90° clockwise.
  const rx = Math.sin(yaw);
  const ry = -Math.cos(yaw);
  let o = 0;
  for (const s of sprites) {
    for (const [u, v] of CORNERS) {
      const mx = s.x + rx * u * s.width;
      const my = s.y + ry * u * s.width;
      // World: X = map.x, Y = height, Z = -map.y
      out.set([mx, s.z + v * s.height, -my, u + 0.5, v, s.shape, s.charge, s.flash, s.light], o);
      o += SPRITE_FLOATS_PER_VERTEX;
    }
  }
  return out;
}
