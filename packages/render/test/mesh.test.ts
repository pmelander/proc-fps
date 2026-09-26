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
