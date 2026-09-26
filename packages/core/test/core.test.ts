import { describe, expect, it } from 'vitest';
import { CELL_SIZE, CellPlan, MapBuilder, Rng, SectorLocator, ThingType, dcos, dsin, emitCellPlan, rect, sectorPolygons, validateMap, type MapData } from '../src/index.js';
import test01 from '../maps/test01.json';

const map = test01 as MapData;

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng('abc');
    const b = new Rng('abc');
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });
  it('forks are independent of parent consumption', () => {
    const a = new Rng('abc');
    const b = new Rng('abc');
    b.nextU32();
    b.nextU32();
    expect(a.fork('items').nextU32()).toBe(b.fork('items').nextU32());
  });
  it('int() stays in range', () => {
    const r = new Rng('range');
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe('deterministic trig', () => {
  it('matches Math.sin/cos closely', () => {
    for (let x = -20; x <= 20; x += 0.013) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-8);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-8);
    }
  });
});

describe('test01', () => {
  it('is valid', () => {
    expect(validateMap(map)).toEqual([]);
  });
  it('room A has one outer loop and one hole', () => {
    const polys = sectorPolygons(map);
    expect(polys[0]).toHaveLength(1);
    expect(polys[0]![0]!.holes).toHaveLength(1);
  });
  it('locates points, respecting holes', () => {
    const loc = new SectorLocator(map);
    expect(loc.locate(50, 50)).toBe(0);
    expect(loc.locate(320, 320)).toBe(1); // platform, inside room A's hole
    expect(loc.locate(1472, 448)).toBe(-1); // void pillar in room C
    expect(loc.locate(-10, 0)).toBe(-1);
  });
});

describe('MapBuilder', () => {
  it('merges shared edges into two-sided lines', () => {
    const b = new MapBuilder();
    b.addSector({ floor: 0, ceil: 128 }, rect(0, 0, 64, 64));
    b.addSector({ floor: 8, ceil: 128 }, rect(64, 0, 128, 64));
    b.thing(1, 32, 32);
    const m = b.build({ name: 't' });
    expect(m.linedefs).toHaveLength(7);
    expect(m.linedefs.filter((l) => l.back)).toHaveLength(1);
    expect(validateMap(m)).toEqual([]);
  });
  it('rejects overlapping sectors', () => {
    const b = new MapBuilder();
    b.addSector({ floor: 0, ceil: 128 }, rect(0, 0, 64, 64));
    expect(() => b.addSector({ floor: 0, ceil: 128 }, rect(0, 0, 64, 64))).toThrow(/overlapping/);
  });
  it('validation catches T-junctions as open loops or crossings', () => {
    const b = new MapBuilder();
    b.addSector({ floor: 0, ceil: 128 }, rect(0, 0, 128, 128)); // east edge not split
    b.addSector({ floor: 0, ceil: 128 }, rect(128, 32, 192, 96));
    b.thing(1, 32, 32);
    expect(validateMap(b.build({ name: 't' })).length).toBeGreaterThan(0);
  });
});

describe('CellGrid', () => {
  it('derives test01', async () => {
    const { CellGrid, validateGridAlignment } = await import('../src/index.js');
    expect(validateGridAlignment(map)).toEqual([]);
    const g = new CellGrid(map);
    expect([g.width, g.height]).toEqual([13, 5]);
    expect(g.sectorAt(2, 2)).toBe(1); // platform
    expect(g.walkable(11, 3)).toBe(false); // void pillar
    expect(g.walkable(6, 0)).toBe(false); // outside, between rooms
    expect(g.canStep(1, 2, 0)).toBe(true); // up +24
    expect(g.canStep(0, 2, 2)).toBe(false); // wall
    const reach = g.reachableFrom(0, 2);
    expect(reach[12 + 2 * g.width]).toBe(1);
  });
  it('blocks steps above MAX_STEP', async () => {
    const { CellGrid } = await import('../src/index.js');
    const b = new MapBuilder();
    b.addSector({ floor: 0, ceil: 256 }, rect(0, 0, 128, 128));
    b.addSector({ floor: 32, ceil: 256 }, rect(128, 0, 256, 128));
    b.thing(1, 64, 64);
    const g = new CellGrid(b.build({ name: 't' }));
    expect(g.canStep(0, 0, 0)).toBe(false);
    expect(g.canStep(1, 0, 2)).toBe(true); // dropping down is fine
  });
  it('flags off-grid geometry', async () => {
    const { validateGridAlignment } = await import('../src/index.js');
    const b = new MapBuilder();
    b.addSector({ floor: 0, ceil: 128 }, rect(0, 0, 100, 128));
    b.thing(1, 50, 64);
    expect(validateGridAlignment(b.build({ name: 't' })).length).toBeGreaterThan(0);
  });
});

describe('CellPlan', () => {
  const C = CELL_SIZE;
  const withStart = (b: MapBuilder) => {
    b.thing(ThingType.PlayerStart, C / 2, C / 2);
    return b.build({ name: 'plan' });
  };

  it('turns an L next to a rectangle into two sectors with no T-junctions', () => {
    // A: L-shape over cells (0,0) (1,0) (0,1). B: cell (1,1), meeting A's edges part-way.
    const plan = new CellPlan();
    const a = plan.spec({ floor: 0, ceil: 128 });
    const b = plan.spec({ floor: 8, ceil: 128 });
    plan.set(0, 0, a);
    plan.set(1, 0, a);
    plan.set(0, 1, a);
    plan.set(1, 1, b);
    const builder = new MapBuilder();
    emitCellPlan(builder, plan, C);
    const map = withStart(builder);
    expect(map.sectors).toHaveLength(2);
    expect(validateMap(map)).toEqual([]);
    expect(map.linedefs.filter((l) => l.back)).toHaveLength(2);
  });

  it('makes a ring into one sector with a hole, merging collinear edges', () => {
    const plan = new CellPlan();
    const s = plan.spec({ floor: 0, ceil: 128 });
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x !== 1 || y !== 1) plan.set(x, y, s);
    const builder = new MapBuilder();
    emitCellPlan(builder, plan, C);
    const map = withStart(builder);
    expect(validateMap(map)).toEqual([]);
    expect(map.sectors).toHaveLength(1);
    expect(map.linedefs).toHaveLength(8); // 4 outer + 4 hole
  });

  it('rejects a group that touches itself only at a corner', () => {
    // Same spec on (0,0) and (1,1), joined around through (2,1) (2,0)… leaving (1,0) and (0,1) out.
    const plan = new CellPlan();
    const s = plan.spec({ floor: 0, ceil: 128 });
    for (const [x, y] of [[0, 0], [1, 1], [2, 1], [2, 0], [2, -1], [1, -1], [0, -1]] as const) plan.set(x, y, s);
    plan.set(1, 0, plan.spec({ floor: 0, ceil: 128, light: 1 }));
    expect(() => emitCellPlan(new MapBuilder(), plan, C)).toThrow(/pinches/);
  });
});
