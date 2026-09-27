import { describe, expect, it } from 'vitest';
import { Rng, SectorLocator, type MapData } from '@proc-fps/core';
import { generate } from '@proc-fps/gen';
import { PortalGraph } from '../src/visibility.js';

const HALF_FOV = 1.0;

/** Random camera poses on walkable floor: a sector centre-ish point, any yaw. */
function poses(map: MapData, rng: Rng, n: number): { x: number; y: number; yaw: number }[] {
  const locator = new SectorLocator(map);
  const xs = map.vertices.map((v) => v.x);
  const ys = map.vertices.map((v) => v.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: { x: number; y: number; yaw: number }[] = [];
  while (out.length < n) {
    const x = rng.range(x0, x1);
    const y = rng.range(y0, y1);
    if (locator.locate(x, y) >= 0) out.push({ x, y, yaw: rng.range(-Math.PI, Math.PI) });
  }
  return out;
}

/** Sectors a 2D ray passes through before it leaves the map (walks in small steps). */
function raySectors(locator: SectorLocator, x: number, y: number, a: number): Set<number> {
  const seen = new Set<number>();
  for (let t = 0; t < 6000; t += 6) {
    const s = locator.locate(x + Math.cos(a) * t, y + Math.sin(a) * t);
    if (s < 0) break;
    seen.add(s);
  }
  return seen;
}

describe('portal culling', () => {
  it('never drops a sector the camera can see (rays across the field of view)', () => {
    const rng = new Rng('vis');
    for (let m = 0; m < 6; m++) {
      const map = generate(`vis-${m}`, { type: (['compound', 'ascent', 'descent'] as const)[m % 3]! });
      const graph = new PortalGraph(map);
      const locator = new SectorLocator(map);
      for (const pose of poses(map, rng, 25)) {
        const visible = graph.visible(pose.x, pose.y, pose.yaw, HALF_FOV);
        for (let k = 0; k <= 40; k++) {
          // Slightly off the grid's round angles, so a ray never runs exactly through a vertex.
          const a = pose.yaw - HALF_FOV + (2 * HALF_FOV * (k + 0.37)) / 41.37;
          for (const s of raySectors(locator, pose.x, pose.y, a)) expect({ pose, s, visible: visible[s] }).toEqual({ pose, s, visible: 1 });
        }
      }
    }
  });

  it('culls most of a level on average, and fast', () => {
    const rng = new Rng('cull');
    let shown = 0;
    let total = 0;
    let ms = 0;
    let calls = 0;
    for (let m = 0; m < 6; m++) {
      const map = generate(`cull-${m}`, { type: (['compound', 'ascent', 'descent'] as const)[m % 3]! });
      const graph = new PortalGraph(map);
      for (const pose of poses(map, rng, 40)) {
        const t = performance.now();
        const visible = graph.visible(pose.x, pose.y, pose.yaw, HALF_FOV);
        ms += performance.now() - t;
        calls++;
        shown += visible.reduce((a, b) => a + b, 0);
        total += visible.length;
      }
    }
    expect(shown / total).toBeLessThan(0.5);
    expect(ms / calls).toBeLessThan(1);
  });

  it('draws everything from outside the level, and always the sector the camera is in', () => {
    const map = generate('vis-out');
    const graph = new PortalGraph(map);
    expect([...graph.visible(-1e5, -1e5, 0, HALF_FOV)].every((v) => v === 1)).toBe(true);
    const start = map.things.find((t) => t.type === 1)!;
    const s = new SectorLocator(map).locate(start.x, start.y);
    for (let yaw = -3; yaw <= 3; yaw += 0.5) expect(graph.visible(start.x, start.y, yaw, HALF_FOV)[s]).toBe(1);
  });
});
