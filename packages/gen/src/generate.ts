import { BaseTex as T, CELL_SIZE, HEADING_DX, HEADING_DY, MapBuilder, Rng, ThingType, rect, type MapData, type TextureId } from '@proc-fps/core';
import { embedMission, type CellRect, type Layout, type LayoutFailure } from './layout.js';
import { generateMission, type Mission } from './mission.js';

/**
 * Bump on ANY change that alters output for an existing seed.
 * seed + GENERATOR_VERSION must always reproduce the same map.
 */
export const GENERATOR_VERSION = '0.3.0';

/** Layout attempts per mission, and missions tried, before giving up on a seed. */
const LAYOUT_TRIES = 8;
const MISSION_TRIES = 8;
/** One storey for now (flat floor plans); storeys joined by elevators come later. */
const STOREY_FLOOR = 0;
const CORRIDOR_HEIGHT = 128;

export interface Generated {
  map: MapData;
  mission: Mission;
  layout: Layout;
  /** Layout attempts used, 1 = first try. A health metric for gen:stats. */
  attempts: number;
  /** Why the failed attempts failed. */
  failures: Record<LayoutFailure, number>;
}

/**
 * M2 pipeline: mission graph → grid embedding → sectors. Room archetypes (slice 3) and
 * doors and keys (slice 4) are still to come, so every connection is an open doorway and
 * rooms get the v0.2 single-feature treatment.
 */
export function generate(seed: string): MapData {
  return generateDetailed(seed).map;
}

export function generateDetailed(seed: string): Generated {
  const rng = new Rng(seed);
  let attempts = 0;
  const failures: Record<LayoutFailure, number> = { placement: 0, route: 0 };
  for (let m = 0; m < MISSION_TRIES; m++) {
    const mission = generateMission(rng.fork(m === 0 ? 'mission' : `mission/${m}`));
    for (let l = 0; l < LAYOUT_TRIES; l++) {
      attempts++;
      const layout = embedMission(mission, rng.fork(`layout/${m}/${l}`));
      if (typeof layout === 'string') {
        failures[layout]++;
        continue;
      }
      return { map: emit(seed, mission, layout, rng), mission, layout, attempts, failures };
    }
  }
  throw new Error(`seed ${seed}: no layout after ${attempts} attempts`);
}

type Side = 'east' | 'north' | 'west' | 'south';
/** The room side a corridor cell touches when the room lies in heading h from that cell. */
const FACING: readonly Side[] = ['west', 'south', 'east', 'north'];

function emit(seed: string, mission: Mission, layout: Layout, rng: Rng): MapData {
  const C = CELL_SIZE;
  const deco = rng.fork('deco');
  const theme = rng.fork('theme');
  const b = new MapBuilder();
  const inRoom = (r: CellRect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  const roomAt = (x: number, y: number) => layout.rooms.findIndex((r) => inRoom(r, x, y));

  // Doorways: each corridor cell touching a room splits that room's side at both ends of the shared edge.
  const splits = layout.rooms.map(() => ({ east: [] as number[], north: [] as number[], west: [] as number[], south: [] as number[] }));
  /** Per room: doorway cell and the heading from the room out through it. */
  const doorways = layout.rooms.map(() => [] as [number, number, number][]);
  for (const c of layout.corridors) {
    for (const [x, y] of c.cells) {
      for (let h = 0; h < 4; h++) {
        const r = roomAt(x + HEADING_DX[h as 0]!, y + HEADING_DY[h as 0]!);
        if (r < 0) continue;
        const side = FACING[h]!;
        splits[r]![side].push(...(side === 'east' || side === 'west' ? [y * C, (y + 1) * C] : [x * C, (x + 1) * C]));
        doorways[r]!.push([x, y, (h + 2) % 4]);
      }
    }
  }

  const wallSet: TextureId[] = [T.Stone, T.Metal, T.Tech];
  mission.nodes.forEach((node, id) => {
    const r = layout.rooms[id]!;
    const minHeight = node.kind === 'boss' ? 224 : node.kind === 'miniboss' ? 192 : 128;
    const height = Math.round(deco.range(minHeight, 288) / 8) * 8;
    const spec = {
      floor: STOREY_FLOOR,
      ceil: STOREY_FLOOR + height,
      light: node.kind === 'loot' ? 232 : Math.round(deco.range(96, 232) / 8) * 8,
      floorTex: theme.pick([T.FloorTile, T.Slime, T.Tech]),
      ceilTex: T.Ceiling,
      wallTex: theme.pick(wallSet),
    };
    const outer = rect(r.x0 * C, r.y0 * C, r.x1 * C, r.y1 * C, splits[id]);
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    // One feature in an interior cell, which can never block a doorway. Not in the start or exit rooms, where things stand.
    const hasFeature = w >= 3 && h >= 3 && (node.kind === 'room' || node.kind === 'miniboss' || node.kind === 'boss');
    const feature = hasFeature ? deco.pick(['none', 'pillar', 'platform', 'pit'] as const) : 'none';
    const fx = deco.int(r.x0 + 1, r.x1 - 2);
    const fy = deco.int(r.y0 + 1, r.y1 - 2);
    const cell = rect(fx * C, fy * C, (fx + 1) * C, (fy + 1) * C);
    if (feature === 'pillar') {
      b.addSector(spec, outer, [cell]);
    } else if (feature === 'platform' || feature === 'pit') {
      b.addSector(spec, outer, [cell]);
      const rise = feature === 'pit' ? -24 : deco.pick([16, 24, 48]); // 48 = unclimbable block, still valid
      b.addSector(
        { ...spec, floor: STOREY_FLOOR + rise, ceil: Math.max(STOREY_FLOOR + rise + 64, spec.ceil), light: Math.min(255, spec.light + 32), floorTex: T.Tech, wallTex: T.Trim },
        cell,
      );
    } else {
      b.addSector(spec, outer);
    }

    const cx = r.x0 + Math.floor(w / 2);
    const cy = r.y0 + Math.floor(h / 2);
    if (node.kind === 'start') {
      // Stand against the far wall in line with the first doorway, facing it across the room.
      const [dx, dy, heading] = doorways[id]![0] ?? [cx, cy, 0];
      const sx = heading === 0 ? r.x0 : heading === 2 ? r.x1 - 1 : dx;
      const sy = heading === 1 ? r.y0 : heading === 3 ? r.y1 - 1 : dy;
      b.thing(ThingType.PlayerStart, (sx + 0.5) * C, (sy + 0.5) * C, heading * 90);
    }
    if (node.kind === 'exit') b.thing(ThingType.Exit, (cx + 0.5) * C, (cy + 0.5) * C, 0);
  });

  for (const c of layout.corridors) {
    c.cells.forEach(([x, y], k) => {
      // Hazard stripes mark only a corridor's two ends, so at most 2 striped tiles ever touch.
      const end = k === 0 || k === c.cells.length - 1;
      b.addSector(
        { floor: STOREY_FLOOR, ceil: STOREY_FLOOR + CORRIDOR_HEIGHT, light: 144, floorTex: end ? T.Trim : T.Tech, ceilTex: T.Ceiling, wallTex: T.Metal },
        rect(x * C, y * C, (x + 1) * C, (y + 1) * C),
      );
    });
  }

  return b.build({ name: `gen-${seed}`, seed, generatorVersion: GENERATOR_VERSION, theme: 'base' });
}
