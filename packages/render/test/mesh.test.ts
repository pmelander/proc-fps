import { describe, expect, it } from 'vitest';
import type { MapData } from '@proc-fps/core';
import { generate } from '@proc-fps/gen';
import test01 from '@proc-fps/core/maps/test01.json';
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
