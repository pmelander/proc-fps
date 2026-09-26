import { BaseTex as T, CELL_SIZE, MapBuilder, Rng, ThingType, rect, type MapData, type TextureId } from '@proc-fps/core';

/**
 * Bump on ANY change that alters output for an existing seed.
 * seed + GENERATOR_VERSION must always reproduce the same map.
 */
export const GENERATOR_VERSION = '0.2.0-stub';

/**
 * v0.2 stub on the cell grid: a west→east chain of rooms joined by one-cell-wide
 * stepped corridors, with optional pits, platforms and pillars. It exists to drive
 * the renderer, sim and validation pipeline; M2 replaces it with
 * mission graph → grid embedding → room grammar → sectorization.
 * All generation happens in cell units; `* C` converts to map units at emit time.
 */
export function generate(seed: string): MapData {
  const C = CELL_SIZE;
  const rng = new Rng(seed);
  const layout = rng.fork('layout');
  const deco = rng.fork('deco');
  const theme = rng.fork('theme');

  const b = new MapBuilder();
  const roomCount = layout.int(4, 8);

  interface Room { x0: number; x1: number; y0: number; y1: number; floor: number; west: number[]; east: number[] }
  interface Corridor { x0: number; len: number; y: number; from: number; to: number }
  const rooms: Room[] = [];
  const corridors: Corridor[] = [];

  // Pass 1: layout in cells.
  let cursor = 0;
  let floor = 0;
  let prev: Corridor | undefined;
  for (let i = 0; i < roomCount; i++) {
    const w = layout.int(3, 7);
    const h = layout.int(3, 7);
    // Contain the incoming corridor row.
    const y0 = prev ? layout.int(prev.y - h + 1, prev.y) : -Math.floor(h / 2);
    const room: Room = { x0: cursor, x1: cursor + w, y0, y1: y0 + h, floor, west: [], east: [] };
    if (prev) room.west.push(prev.y, prev.y + 1);
    rooms.push(room);
    cursor += w;

    if (i < roomCount - 1) {
      const len = layout.int(1, 5);
      const y = layout.int(room.y0, room.y1 - 1);
      const maxDelta = 24 * (len + 1);
      const delta = Math.round(layout.range(-maxDelta, maxDelta) / 8) * 8;
      const corr: Corridor = { x0: cursor, len, y, from: floor, to: floor + delta };
      room.east.push(y, y + 1);
      corridors.push(corr);
      prev = corr;
      floor = corr.to;
      cursor += len;
    }
  }

  // Pass 2: emit sectors in map units.
  const wallSet: TextureId[] = [T.Stone, T.Metal, T.Tech];
  rooms.forEach((r, i) => {
    const height = Math.round(deco.range(128, 288) / 8) * 8;
    const spec = {
      floor: r.floor,
      ceil: r.floor + height,
      light: Math.round(deco.range(96, 232) / 8) * 8,
      floorTex: theme.pick([T.FloorTile, T.Slime, T.Tech]),
      ceilTex: T.Ceiling,
      wallTex: theme.pick(wallSet),
    };
    const outer = rect(r.x0 * C, r.y0 * C, r.x1 * C, r.y1 * C, {
      west: r.west.map((y) => y * C),
      east: r.east.map((y) => y * C),
    });
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    // Features go in an interior cell so they never block a doorway.
    const feature = w >= 3 && h >= 3 ? deco.pick(['none', 'pillar', 'platform', 'pit'] as const) : 'none';
    const fx = deco.int(r.x0 + 1, r.x1 - 2);
    const fy = deco.int(r.y0 + 1, r.y1 - 2);
    const cell = rect(fx * C, fy * C, (fx + 1) * C, (fy + 1) * C);
    if (feature === 'pillar') {
      b.addSector(spec, outer, [cell]);
    } else if (feature === 'platform' || feature === 'pit') {
      b.addSector(spec, outer, [cell]);
      const rise = feature === 'pit' ? -24 : deco.pick([16, 24, 48]); // 48 = unclimbable block, still valid
      b.addSector(
        { ...spec, floor: r.floor + rise, ceil: Math.max(r.floor + rise + 64, spec.ceil), light: Math.min(255, spec.light + 32), floorTex: T.Tech, wallTex: T.Trim },
        cell,
      );
    } else {
      b.addSector(spec, outer);
    }
    const midY = Math.floor((r.y0 + r.y1) / 2);
    if (i === 0) b.thing(ThingType.PlayerStart, (r.x0 + 0.5) * C, (midY + 0.5) * C, 0);
    if (i === rooms.length - 1) b.thing(ThingType.Exit, (r.x1 - 0.5) * C, (midY + 0.5) * C, 0);
  });

  for (const c of corridors) {
    for (let k = 0; k < c.len; k++) {
      const f = Math.round(c.from + ((c.to - c.from) * (k + 1)) / (c.len + 1));
      b.addSector(
        { floor: f, ceil: f + 128, light: 144, floorTex: T.Trim, ceilTex: T.Ceiling, wallTex: T.Metal },
        rect((c.x0 + k) * C, c.y * C, (c.x0 + k + 1) * C, (c.y + 1) * C),
      );
    }
  }

  return b.build({ name: `gen-${seed}`, seed, generatorVersion: GENERATOR_VERSION, theme: 'base' });
}
