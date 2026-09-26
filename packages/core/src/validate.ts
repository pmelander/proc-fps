import { PLAYER_HEIGHT } from './constants.js';
import { SectorLocator, sectorPolygons } from './geometry.js';
import { DoorKind, MAP_FORMAT_VERSION, MAX_KEYS, ThingType, doorKindOf, type MapData } from './map.js';

/**
 * Structural validation shared by every map source. Returns a list of problems;
 * empty means valid. Generators add their own gameplay checks on top.
 */
export function validateMap(map: MapData): string[] {
  const errors: string[] = [];
  const nv = map.vertices.length;
  const ns = map.sectors.length;

  if (map.version !== MAP_FORMAT_VERSION) errors.push(`unsupported map version ${String(map.version)}`);
  if (ns === 0) errors.push('map has no sectors');

  map.sectors.forEach((s, i) => {
    if (!(s.ceil > s.floor)) errors.push(`sector ${i}: ceiling ${s.ceil} not above floor ${s.floor}`);
    if (s.light < 0 || s.light > 255) errors.push(`sector ${i}: light ${s.light} out of range`);
    const door = doorKindOf(s);
    if (door !== DoorKind.None && s.ceil - s.floor < PLAYER_HEIGHT) errors.push(`sector ${i}: door opening lower than the player`);
    if (door === DoorKind.Key && (s.tag < 0 || s.tag >= MAX_KEYS)) errors.push(`sector ${i}: key door key ${s.tag} out of range`);
  });

  const seen = new Set<string>();
  map.linedefs.forEach((l, i) => {
    if (l.v1 < 0 || l.v1 >= nv || l.v2 < 0 || l.v2 >= nv) errors.push(`line ${i}: bad vertex index`);
    if (l.v1 === l.v2) errors.push(`line ${i}: zero length`);
    const key = l.v1 < l.v2 ? `${l.v1}:${l.v2}` : `${l.v2}:${l.v1}`;
    if (seen.has(key)) errors.push(`line ${i}: duplicate of another line`);
    seen.add(key);
    for (const side of [l.front, l.back]) {
      if (side && (side.sector < 0 || side.sector >= ns)) errors.push(`line ${i}: bad sector index ${side.sector}`);
    }
  });
  if (errors.length) return errors; // later checks assume indices are sane

  errors.push(...findCrossings(map));

  try {
    sectorPolygons(map);
  } catch (e) {
    errors.push((e as Error).message);
  }

  const starts = map.things.filter((t) => t.type === ThingType.PlayerStart);
  if (starts.length !== 1) errors.push(`expected exactly 1 player start, found ${starts.length}`);
  const locator = new SectorLocator(map);
  for (const t of starts) {
    const s = locator.locate(t.x, t.y);
    const sec = map.sectors[s];
    if (!sec) errors.push(`player start at (${t.x}, ${t.y}) is outside every sector`);
    else if (sec.ceil - sec.floor < PLAYER_HEIGHT) errors.push(`player start sector ${s} too low`);
  }
  return errors;
}

/** O(n²) segment crossing check. Fine for v0 map sizes; move to a sweep when needed. */
function findCrossings(map: MapData): string[] {
  const out: string[] = [];
  const v = map.vertices;
  const L = map.linedefs;
  for (let i = 0; i < L.length; i++) {
    const a = L[i]!;
    for (let j = i + 1; j < L.length; j++) {
      const b = L[j]!;
      if (a.v1 === b.v1 || a.v1 === b.v2 || a.v2 === b.v1 || a.v2 === b.v2) continue;
      if (segmentsIntersect(v[a.v1]!, v[a.v2]!, v[b.v1]!, v[b.v2]!)) out.push(`lines ${i} and ${j} cross`);
    }
  }
  return out;
}

type P = { x: number; y: number };
function orient(a: P, b: P, c: P): number {
  const d = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}
function onSeg(a: P, b: P, p: P): boolean {
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
}
function segmentsIntersect(p1: P, p2: P, q1: P, q2: P): boolean {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(p1, p2, q1)) return true;
  if (o2 === 0 && onSeg(p1, p2, q2)) return true;
  if (o3 === 0 && onSeg(q1, q2, p1)) return true;
  if (o4 === 0 && onSeg(q1, q2, p2)) return true;
  return false;
}
