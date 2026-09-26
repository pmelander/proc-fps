/**
 * Hand-authored test maps, written as code so the JSON never drifts from the builder.
 * Run: npm run maps:build
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BaseTex as T,
  CELL_SIZE,
  CellPlan,
  DoorKind,
  MapBuilder,
  SPECIAL_SECRET_AREA,
  ThingType,
  emitCellPlan,
  keyThing,
  rect,
  validateGridAlignment,
  validateMap,
  type MapData,
} from '../src/index.js';

/**
 * test01 (128-unit cells). Walking east from the start along row 2:
 *   cells 0–1 room A · 2 platform (+24) · 3–4 room A · 5–8 stairs (+8 each) · 9+ room C (+32)
 * Room C has a void pillar at cell (11, 3). Exit at cell (12, 2).
 */
export function buildTest01(): MapData {
  const b = new MapBuilder();
  const C = CELL_SIZE;
  b.addSector(
    { floor: 0, ceil: 256, light: 192, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone },
    rect(0, 0, 5 * C, 5 * C, { east: [2 * C, 3 * C] }),
    [rect(2 * C, 2 * C, 3 * C, 3 * C)],
  );
  const platform = rect(2 * C, 2 * C, 3 * C, 3 * C);
  b.addSector({ floor: 24, ceil: 256, light: 224, floorTex: T.Tech, ceilTex: T.Ceiling, wallTex: T.Trim }, platform);
  // The riser is seen from room A, so it takes room A's side's lower texture.
  platform.forEach((a, i) => b.setSideTextures(a, platform[(i + 1) % platform.length]!, 0, { lower: T.Trim }));
  for (let i = 0; i < 4; i++) {
    const x0 = (5 + i) * C;
    const floor = 8 * (i + 1);
    b.addSector(
      { floor, ceil: floor + 192, light: 160, floorTex: T.Trim, ceilTex: T.Ceiling, wallTex: T.Metal },
      rect(x0, 2 * C, x0 + C, 3 * C),
    );
  }
  b.addSector(
    { floor: 32, ceil: 320, light: 112, floorTex: T.Slime, ceilTex: T.Ceiling, wallTex: T.Tech },
    rect(9 * C, C, 13 * C, 5 * C, { west: [2 * C, 3 * C] }),
    [rect(11 * C, 3 * C, 12 * C, 4 * C)],
  );
  b.thing(ThingType.PlayerStart, C / 2, 2.5 * C, 0);
  b.thing(ThingType.Exit, 12.5 * C, 2.5 * C, 0);
  return b.build({ name: 'test01', theme: 'base' });
}

/**
 * test02: both door types (cells; y grows north).
 *   Start room A (0–3, 0–2) → auto door (4, 1) → hall B (5–7, 0–2)
 *   B → auto door (8, 1) → side room C (9–11, 0–2), blue key at (10, 1)
 *   B → blue key door (6, 3) → exit room D (5–7, 4–6), exit at (6, 5)
 *   C → secret door in C's north wall (10, 3) → secret room E (9–11, 4–5)
 */
export function buildTest02(): MapData {
  const plan = new CellPlan();
  const room = (x0: number, y0: number, x1: number, y1: number, light: number, floorTex: number, special = 0) => {
    const spec = plan.spec({ floor: 0, ceil: 192, light, floorTex, ceilTex: T.Ceiling, wallTex: T.Stone, special });
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) plan.set(x, y, spec);
  };
  const door = (x: number, y: number, special: number, tag = 0) =>
    plan.set(x, y, plan.spec({ floor: 0, ceil: 128, light: 160, floorTex: T.Trim, ceilTex: T.Ceiling, wallTex: T.Metal, special, tag }));
  room(0, 0, 4, 3, 176, T.FloorTile);
  room(5, 0, 8, 3, 144, T.Tech);
  room(9, 0, 12, 3, 208, T.FloorTile);
  room(5, 4, 8, 7, 224, T.Slime);
  room(9, 4, 12, 6, 240, T.Tech, SPECIAL_SECRET_AREA);
  door(4, 1, DoorKind.Auto);
  door(8, 1, DoorKind.Auto);
  door(6, 3, DoorKind.Key, 0);
  door(10, 3, DoorKind.Secret | SPECIAL_SECRET_AREA, 0);
  const b = new MapBuilder();
  emitCellPlan(b, plan, CELL_SIZE);
  const C = CELL_SIZE;
  b.thing(ThingType.PlayerStart, 0.5 * C, 1.5 * C, 0);
  b.thing(keyThing(0), 10.5 * C, 1.5 * C, 0);
  b.thing(ThingType.Exit, 6.5 * C, 5.5 * C, 0);
  return b.build({ name: 'test02', theme: 'base' });
}

const maps: Record<string, () => MapData> = { test01: buildTest01, test02: buildTest02 };

for (const [name, fn] of Object.entries(maps)) {
  const map = fn();
  const errors = [...validateMap(map), ...validateGridAlignment(map)];
  if (errors.length) {
    console.error(`${name} invalid:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  const path = fileURLToPath(new URL(`../maps/${name}.json`, import.meta.url));
  writeFileSync(path, formatMap(map));
  console.log(`wrote ${path} (${map.sectors.length} sectors, ${map.linedefs.length} lines)`);
}

/** One entity per line: diff-friendly and still valid JSON. */
function formatMap(map: MapData): string {
  const lines = ['{', `  "version": ${map.version},`, `  "meta": ${JSON.stringify(map.meta)},`];
  const keys = ['vertices', 'linedefs', 'sectors', 'things'] as const;
  keys.forEach((k, ki) => {
    const items = map[k].map((e) => '    ' + JSON.stringify(e));
    lines.push(`  "${k}": [`, items.join(',\n'), `  ]${ki < keys.length - 1 ? ',' : ''}`);
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}
