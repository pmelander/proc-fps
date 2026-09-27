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
  EnemyType,
  MapBuilder,
  SPECIAL_DAMAGE,
  SPECIAL_LIFT,
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
    plan.set(x, y, plan.spec({ floor: 0, ceil: 128, light: 160, floorTex: T.Trim, ceilTex: T.Ceiling, wallTex: (special & 3) === 1 || (special & 3) === 2 ? T.DoorFrame : T.Metal, special, tag }));
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

/**
 * test03: combat arena (cells; y grows north).
 *   Arena A (0–11, 0–6), start (0, 3) facing east: grunt (7, 3), brute (10, 5), sniper (11, 0),
 *   health at (1, 6) and (2, 6), a pillar pair for cover at (5, 2) and (5, 4).
 *   A → auto door (12, 3) → room B (13–17, 1–5) with the mini boss (16, 3) and the exit (17, 3).
 */
export function buildTest03(): MapData {
  const plan = new CellPlan();
  const arena = plan.spec({ floor: 0, ceil: 256, light: 176, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone });
  const lair = plan.spec({ floor: 0, ceil: 256, light: 128, floorTex: T.Slime, ceilTex: T.Ceiling, wallTex: T.Tech });
  for (let y = 0; y < 7; y++) for (let x = 0; x < 12; x++) if (!(x === 5 && (y === 2 || y === 4))) plan.set(x, y, arena);
  for (let y = 1; y < 6; y++) for (let x = 13; x < 18; x++) plan.set(x, y, lair);
  plan.set(12, 3, plan.spec({ floor: 0, ceil: 128, light: 160, floorTex: T.Trim, ceilTex: T.Ceiling, wallTex: T.DoorFrame, special: DoorKind.Auto }));
  const b = new MapBuilder();
  emitCellPlan(b, plan, CELL_SIZE);
  const at = (type: number, x: number, y: number, angle = 180) => b.thing(type, (x + 0.5) * CELL_SIZE, (y + 0.5) * CELL_SIZE, angle);
  at(ThingType.PlayerStart, 0, 3, 0);
  at(EnemyType.Grunt, 7, 3);
  at(EnemyType.Brute, 10, 5);
  at(EnemyType.Sniper, 11, 0);
  at(ThingType.Health, 1, 6);
  at(ThingType.Health, 2, 6);
  at(EnemyType.MiniBoss, 16, 3);
  at(ThingType.Exit, 17, 3);
  return b.build({ name: 'test03', theme: 'base' });
}

/**
 * test04: storeys, a lift and a hazard pit (cells; y grows north).
 *   Room A (0–3, 0–2) at floor 0, start (0, 1) facing east; a slime pit (1–2, 0) at -24 that hurts.
 *   Corridor (4, 1) at 0 → lift (5, 1) from 0 up to 192 → room B (6–9, 0–2) at 192, exit (9, 1).
 */
export function buildTest04(): MapData {
  const plan = new CellPlan();
  const low = plan.spec({ floor: 0, ceil: 192, light: 176, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone });
  const pit = plan.spec({ floor: -24, ceil: 192, light: 200, floorTex: T.Slime, ceilTex: T.Ceiling, wallTex: T.Stone, special: SPECIAL_DAMAGE });
  const high = plan.spec({ floor: 192, ceil: 384, light: 208, floorTex: T.Tech, ceilTex: T.Ceiling, wallTex: T.Metal });
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) plan.set(x, y, y === 0 && (x === 1 || x === 2) ? pit : low);
  plan.set(4, 1, plan.spec({ floor: 0, ceil: 128, light: 144, floorTex: T.Trim, ceilTex: T.Ceiling, wallTex: T.Metal }));
  plan.set(5, 1, plan.spec({ floor: 0, ceil: 320, light: 176, floorTex: T.Lift, ceilTex: T.Ceiling, wallTex: T.Metal, special: SPECIAL_LIFT, tag: 192 }));
  for (let y = 0; y < 3; y++) for (let x = 6; x < 10; x++) plan.set(x, y, high);
  const b = new MapBuilder();
  emitCellPlan(b, plan, CELL_SIZE);
  b.thing(ThingType.PlayerStart, 0.5 * CELL_SIZE, 1.5 * CELL_SIZE, 0);
  b.thing(ThingType.Exit, 9.5 * CELL_SIZE, 1.5 * CELL_SIZE, 0);
  return b.build({ name: 'test04', theme: 'base' });
}

/**
 * test05: a catwalk room (cells; y grows north). A 9 × 5 room with its outer ring at floor 0.
 * Inside (x 1–7, y 1–3): steps down at x 1, 2, 3 (-24, -48, -72), a pit at -96 at x 4, 6, 7, and a
 * grating catwalk at x 5 (top 0, underside -16) over the pit floor. Start (5, 0) facing north,
 * right at the catwalk's south end; exit (5, 4) at its north end.
 */
export function buildTest05(): MapData {
  const plan = new CellPlan();
  const ring = plan.spec({ floor: 0, ceil: 256, light: 192, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone });
  const steps = [-24, -48, -72].map((f) => plan.spec({ floor: f, ceil: 256, light: 176, floorTex: T.Tech, ceilTex: T.Ceiling, wallTex: T.Trim }));
  const pit = plan.spec({ floor: -96, ceil: 256, light: 160, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone });
  const catwalk = plan.spec({
    floor: -96, ceil: 256, light: 160, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone,
    slab: { bottom: -16, top: 0, topTex: T.Grate, bottomTex: T.Metal, sideTex: T.Metal },
  });
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 9; x++) {
      const inside = x >= 1 && x <= 7 && y >= 1 && y <= 3;
      plan.set(x, y, !inside ? ring : x <= 3 ? steps[x - 1]! : x === 5 ? catwalk : pit);
    }
  }
  const b = new MapBuilder();
  emitCellPlan(b, plan, CELL_SIZE);
  b.thing(ThingType.PlayerStart, 5.5 * CELL_SIZE, 0.5 * CELL_SIZE, 90);
  b.thing(ThingType.Exit, 5.5 * CELL_SIZE, 4.5 * CELL_SIZE, 0);
  return b.build({ name: 'test05', theme: 'base' });
}

/**
 * test06: a bridge between storeys (cells; y grows north). Lower room L (0–5, 0–4) at floor 0,
 * ceiling 320; upper room U (8–10, 1–3) at 192. The corridor (6–7, 2) runs at 192 into L as a
 * catwalk over (5, 2) and (4, 2), ending in a lift at (3, 2) from 0 up to 192. Start (0, 2)
 * facing east; exit (10, 2).
 */
export function buildTest06(): MapData {
  const plan = new CellPlan();
  const lower = plan.spec({ floor: 0, ceil: 320, light: 176, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone });
  const catwalk = plan.spec({
    floor: 0, ceil: 320, light: 176, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone,
    slab: { bottom: 176, top: 192, topTex: T.Grate, bottomTex: T.Metal, sideTex: T.Metal },
  });
  const upper = plan.spec({ floor: 192, ceil: 384, light: 208, floorTex: T.Tech, ceilTex: T.Ceiling, wallTex: T.Metal });
  const corridor = plan.spec({ floor: 192, ceil: 320, light: 160, floorTex: T.Trim, ceilTex: T.Ceiling, wallTex: T.Metal });
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) plan.set(x, y, y === 2 && (x === 4 || x === 5) ? catwalk : lower);
  plan.set(3, 2, plan.spec({ floor: 0, ceil: 320, light: 176, floorTex: T.Lift, ceilTex: T.Ceiling, wallTex: T.Metal, special: SPECIAL_LIFT, tag: 192 }));
  plan.set(6, 2, corridor);
  plan.set(7, 2, corridor);
  for (let y = 1; y < 4; y++) for (let x = 8; x < 11; x++) plan.set(x, y, upper);
  const b = new MapBuilder();
  emitCellPlan(b, plan, CELL_SIZE);
  b.thing(ThingType.PlayerStart, 0.5 * CELL_SIZE, 2.5 * CELL_SIZE, 0);
  b.thing(ThingType.Exit, 10.5 * CELL_SIZE, 2.5 * CELL_SIZE, 0);
  return b.build({ name: 'test06', theme: 'base' });
}

/**
 * test07: the M24 roles (cells; y grows north). Arena (0–13, 0–8), start (0, 4) facing east, a
 * pillar pair for cover at (4, 2) and (4, 6). A charger in the start's row at (9, 4); bloaters at
 * (6, 1) and (6, 7), each beside a grunt at (7, 1) and (7, 7) (shoot one, catch both); wardens at
 * (8, 2) and (8, 6); health at (1, 0) and (1, 8); the exit (13, 4).
 */
export function buildTest07(): MapData {
  const plan = new CellPlan();
  const arena = plan.spec({ floor: 0, ceil: 256, light: 176, floorTex: T.FloorTile, ceilTex: T.Ceiling, wallTex: T.Stone });
  for (let y = 0; y < 9; y++) for (let x = 0; x < 14; x++) if (!(x === 4 && (y === 2 || y === 6))) plan.set(x, y, arena);
  const b = new MapBuilder();
  emitCellPlan(b, plan, CELL_SIZE);
  const at = (type: number, x: number, y: number, angle = 180) => b.thing(type, (x + 0.5) * CELL_SIZE, (y + 0.5) * CELL_SIZE, angle);
  at(ThingType.PlayerStart, 0, 4, 0);
  at(EnemyType.Charger, 9, 4);
  at(EnemyType.Bloater, 6, 1);
  at(EnemyType.Grunt, 7, 1);
  at(EnemyType.Bloater, 6, 7);
  at(EnemyType.Grunt, 7, 7);
  at(EnemyType.Warden, 8, 2);
  at(EnemyType.Warden, 8, 6);
  at(ThingType.Health, 1, 0);
  at(ThingType.Health, 1, 8);
  at(ThingType.Exit, 13, 4);
  return b.build({ name: 'test07', theme: 'hell' });
}

const maps: Record<string, () => MapData> = { test01: buildTest01, test02: buildTest02, test03: buildTest03, test04: buildTest04, test05: buildTest05, test06: buildTest06, test07: buildTest07 };

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
