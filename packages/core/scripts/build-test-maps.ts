/**
 * Hand-authored test maps, written as code so the JSON never drifts from the builder.
 * Run: npm run maps:build
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BaseTex as T, CELL_SIZE, MapBuilder, ThingType, rect, validateGridAlignment, validateMap, type MapData } from '../src/index.js';

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

const maps: Record<string, () => MapData> = { test01: buildTest01 };

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
