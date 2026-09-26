import { describe, expect, it } from 'vitest';
import { BaseTex, DoorKind, doorKindOf, doorSectors, type MapData } from '@proc-fps/core';
import { generate } from '@proc-fps/gen';
import test01 from '@proc-fps/core/maps/test01.json';
import test02 from '@proc-fps/core/maps/test02.json';
import { LEVEL_FLOATS_PER_VERTEX, buildLevelMesh } from '../src/mesh.js';

function checkMesh(m: MapData) {
  const mesh = buildLevelMesh(m);
  const vcount = mesh.vertices.length / LEVEL_FLOATS_PER_VERTEX;
  expect(Number.isInteger(vcount)).toBe(true);
  expect(mesh.indices.length % 3).toBe(0);
  for (const i of mesh.indices) expect(i).toBeLessThan(vcount);
  expect(mesh.sectors).toHaveLength(m.sectors.length);
  // Ranges are contiguous and cover all indices.
  let next = 0;
  for (const r of mesh.sectors) {
    expect(r.first).toBe(next);
    next += r.count;
  }
  expect(next).toBe(mesh.indices.length);
  return mesh;
}

describe('buildLevelMesh', () => {
  it('builds test01', () => {
    const mesh = checkMesh(test01 as MapData);
    // Every sector has at least floor + ceiling triangles.
    for (const r of mesh.sectors) expect(r.count).toBeGreaterThanOrEqual(12);
  });
  it('builds generated maps', () => {
    for (let i = 0; i < 50; i++) checkMesh(generate(`mesh${i}`));
  });
});

describe('door panels', () => {
  const map = test02 as MapData;
  const mesh = buildLevelMesh(map);
  /** Textures of vertices whose texture slides with door `id` (its panels). */
  const panelTextures = (id: number) => {
    const out = new Set<number>();
    for (let v = 0; v < mesh.vertices.length; v += LEVEL_FLOATS_PER_VERTEX) {
      if (mesh.vertices[v + 7] === id + 1 && mesh.vertices[v + 9] === 1) out.add(mesh.vertices[v + 6]!);
    }
    return [...out];
  };
  const doorOf = (kind: DoorKind) => doorSectors(map).findIndex((s) => doorKindOf(map.sectors[s]!) === kind);

  it('gives a key door its key colour and a secret door the wall it hides in', () => {
    expect(panelTextures(doorOf(DoorKind.Auto))).toEqual([BaseTex.Door]);
    expect(panelTextures(doorOf(DoorKind.Key))).toEqual([BaseTex.DoorKey]);
    expect(panelTextures(doorOf(DoorKind.Secret))).toEqual([BaseTex.Stone]);
  });
});

describe('sprites', () => {
  it('build two camera-facing triangles per sprite', async () => {
    const { SPRITE_FLOATS_PER_VERTEX, buildSpriteVertices } = await import('../src/sprites.js');
    const v = buildSpriteVertices([{ x: 100, y: 200, z: 0, width: 40, height: 72, shape: 0, charge: 0, flash: 0, light: 1, tile: 0 }], 0);
    expect(v.length).toBe(6 * SPRITE_FLOATS_PER_VERTEX);
    // Facing east (yaw 0) the quad spans map y ± 20 (world z ∓ 20) and 0–72 in height.
    const zs = new Set<number>();
    const ys = new Set<number>();
    for (let i = 0; i < 6; i++) {
      zs.add(Math.round(v[i * SPRITE_FLOATS_PER_VERTEX + 2]!));
      ys.add(Math.round(v[i * SPRITE_FLOATS_PER_VERTEX + 1]!));
    }
    expect([...zs].sort((a, b) => a - b)).toEqual([-220, -180]);
    expect([...ys].sort((a, b) => a - b)).toEqual([0, 72]);
  });
});

describe('sprite atlas and themes', () => {
  it('maps shape, direction and frame to distinct tiles in a 32-column atlas', async () => {
    const { spriteTile } = await import('../src/sprites.js');
    const tiles = new Set<number>();
    for (let s = 0; s < 5; s++) for (let d = 0; d < 8; d++) for (let f = 0; f < 4; f++) tiles.add(spriteTile(s, d, f));
    expect(tiles.size).toBe(160);
    expect(Math.max(...tiles)).toBe(159);
    expect(spriteTile(1, 0, 0)).toBe(32); // row 1 starts after 8 directions × 4 frames
  });

  it('gives every theme all its colours, with seeded variation', async () => {
    const { THEME_NAMES } = await import('@proc-fps/core');
    const { themeUniforms } = await import('../src/themes.js');
    for (const name of THEME_NAMES) {
      const u = themeUniforms(name, 'seed');
      expect(Object.keys(u)).toContain('uStone');
      expect(Object.keys(u)).toContain('uSlime');
      expect((u.uStone as Float32Array).length).toBe(3);
    }
    expect(themeUniforms('base', 'a')).toEqual(themeUniforms('base', 'a'));
    expect(themeUniforms('base', 'a')).not.toEqual(themeUniforms('base', 'b'));
  });
});
