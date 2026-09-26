import { DoorKind, ThingType, doorKindOf, doorSectors, isEnemyThing } from '@proc-fps/core';
import type { Generated } from './generate.js';
import type { RoomTemplate } from './rooms.js';

/** One level's shape and content, for gen:stats distributions and the seed browser. */
export interface LevelStats {
  rooms: number;
  /** Bounding box in cells. */
  width: number;
  height: number;
  corridorCells: number;
  doors: { auto: number; key: number; secret: number };
  keys: number;
  loot: number;
  secrets: number;
  /** Mission cycles (edges − nodes + 1). */
  loops: number;
  templates: Record<RoomTemplate, number>;
  enemies: number;
  health: number;
  ammo: number;
  /** Layout attempts used, 1 = first try. */
  attempts: number;
}

export function levelStats(g: Generated): LevelStats {
  const { mission, layout, designs, map } = g;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  };
  for (const r of layout.rooms) {
    grow(r.x0, r.y0);
    grow(r.x1 - 1, r.y1 - 1);
  }
  let corridorCells = 0;
  for (const c of layout.corridors) {
    corridorCells += c.cells.length;
    for (const [x, y] of c.cells) grow(x, y);
  }
  const doors = { auto: 0, key: 0, secret: 0 };
  for (const s of doorSectors(map)) {
    const kind = doorKindOf(map.sectors[s]!);
    if (kind === DoorKind.Auto) doors.auto++;
    else if (kind === DoorKind.Key) doors.key++;
    else if (kind === DoorKind.Secret) doors.secret++;
  }
  const templates: Record<RoomTemplate, number> = { plain: 0, hall: 0, platform: 0, pit: 0, stairs: 0, arena: 0 };
  for (const d of designs) templates[d.template]++;
  const count = (kind: string) => mission.nodes.filter((n) => n.kind === kind).length;
  return {
    rooms: mission.nodes.length,
    width: x1 - x0,
    height: y1 - y0,
    corridorCells,
    doors,
    keys: mission.nodes.filter((n) => n.key !== undefined).length,
    loot: count('loot'),
    secrets: count('secret'),
    loops: mission.edges.length - mission.nodes.length + 1,
    templates,
    enemies: map.things.filter((t) => isEnemyThing(t.type)).length,
    health: map.things.filter((t) => t.type === ThingType.Health).length,
    ammo: map.things.filter((t) => t.type === ThingType.Ammo).length,
    attempts: g.attempts,
  };
}
