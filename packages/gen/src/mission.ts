import type { Rng } from '@proc-fps/core';

/**
 * Mission graph: the abstract plan of a level, before any geometry. Nodes are rooms and
 * edges are connections between them. Grid embedding (M2 slice 2) turns it into cells.
 *
 * Built by cyclic generation in the style of Dormans. The main cycle has two arcs from the
 * start to the gate, the room in front of the boss key door:
 * - the short arc reaches the gate directly, so the player sees the boss door early;
 * - the long arc passes the mini boss, which carries the boss key, so it cannot be had
 *   without that fight. The boss carries the exit key; the exit sits behind its own key door.
 * Loot rooms hang off the cycle behind key doors whose keys are placed where they can
 * be reached first. Dead ends and small detour loops add variety. Secret rooms hang off
 * ordinary rooms behind secret doors; the level never needs them.
 *
 * Each room also gets its progress along the critical path (0 at the start, 1 at the gate, the
 * boss and the exit), which vertical levels turn into storeys.
 */
export type RoomKind = 'start' | 'room' | 'miniboss' | 'boss' | 'loot' | 'exit' | 'secret';

/** See "Doors (decided)" in PROJECT_SUMMARY.md. `open` is a doorway with no door. */
export type DoorKind = 'open' | 'auto' | 'key' | 'secret';

export interface MissionNode {
  id: number;
  kind: RoomKind;
  /** Key this room holds. */
  key?: number;
  /**
   * How far along the critical path the room is: 0 at the start, 1 at the gate, boss and exit;
   * branches take their host's. Vertical levels turn it into storeys.
   */
  progress?: number;
}

export interface MissionEdge {
  a: number;
  b: number;
  door: DoorKind;
  /** Key that opens a key door. */
  key?: number;
}

export interface Mission {
  nodes: MissionNode[];
  edges: MissionEdge[];
}

/** A room has four sides; capping connections at four keeps the embedding tractable. */
export const MAX_DEGREE = 4;
export const BOSS_KEY = 0;
/** The exit's key door; dropped by the boss. Loot keys use the ids between. */
export const EXIT_KEY = 3;

const AUTO_DOOR_CHANCE = 0.4;

type Range = readonly [number, number];
/** How big a mission is: rooms on each arc, detour loops and dead ends (see LevelProfile). */
export interface MissionShape {
  shortArc: Range;
  approach: Range;
  retreat: Range;
  detours: Range;
  deadEnds: Range;
}
/** The shape before level types (M2–M11). */
export const DEFAULT_MISSION_SHAPE: MissionShape = { shortArc: [0, 2], approach: [1, 2], retreat: [0, 2], detours: [0, 2], deadEnds: [0, 2] };

export function generateMission(rng: Rng, shape: MissionShape = DEFAULT_MISSION_SHAPE): Mission {
  const nodes: MissionNode[] = [];
  const edges: MissionEdge[] = [];
  const add = (kind: RoomKind, progress = 0): number => nodes.push({ id: nodes.length, kind, progress }) - 1;
  const connect = (a: number, b: number, door: DoorKind, key?: number) => {
    edges.push(key === undefined ? { a, b, door } : { a, b, door, key });
  };
  const plain = (): DoorKind => (rng.chance(AUTO_DOOR_CHANCE) ? 'auto' : 'open');
  const chain = (ids: number[]) => {
    for (let i = 1; i < ids.length; i++) connect(ids[i - 1]!, ids[i]!, plain());
  };
  const rooms = (n: number) => Array.from({ length: n }, () => add('room'));
  const between = (r: Range) => rng.int(r[0], r[1]);
  /** Spreads progress evenly along an arc from `from` to `to` (both excluded). */
  const spread = (ids: number[], from: number, to: number) => ids.forEach((id, i) => (nodes[id]!.progress = from + ((to - from) * (i + 1)) / (ids.length + 1)));
  const degree = (id: number) => edges.reduce((d, e) => d + (e.a === id ? 1 : 0) + (e.b === id ? 1 : 0), 0);

  // Main cycle.
  const start = add('start', 0);
  const gate = add('room', 1);
  const shortArc = rooms(between(shape.shortArc));
  spread(shortArc, 0, 1);
  chain([start, ...shortArc, gate]);
  const approach = [start, ...rooms(between(shape.approach))];
  const miniboss = add('miniboss');
  const retreat = [...rooms(between(shape.retreat)), gate];
  spread([...approach.slice(1), miniboss, ...retreat.slice(0, -1)], 0, 1);
  chain(approach);
  chain(retreat);
  // Real doors on both sides of the mini boss, so the fight is announced.
  connect(approach[approach.length - 1]!, miniboss, 'auto');
  connect(miniboss, retreat[0]!, 'auto');
  nodes[miniboss]!.key = BOSS_KEY; // dropped when it dies

  const boss = add('boss', 1);
  connect(gate, boss, 'key', BOSS_KEY);
  nodes[boss]!.key = EXIT_KEY; // dropped when it dies
  connect(boss, add('exit', 1), 'key', EXIT_KEY);

  // Detour loops: add u–w–v beside a plain edge u–v between ordinary rooms, so neither the
  // mini boss nor a key door can be bypassed.
  const detours = between(shape.detours);
  for (let i = 0; i < detours; i++) {
    const candidates = edges.filter(
      (e) => (e.door === 'open' || e.door === 'auto') && [e.a, e.b].every((n) => nodes[n]!.kind === 'room' || nodes[n]!.kind === 'start') && degree(e.a) < MAX_DEGREE && degree(e.b) < MAX_DEGREE,
    );
    if (!candidates.length) break;
    const e = rng.pick(candidates);
    const w = add('room', (nodes[e.a]!.progress! + nodes[e.b]!.progress!) / 2);
    connect(e.a, w, plain());
    connect(w, e.b, plain());
  }

  // Hosts for branches: ordinary rooms with a free side.
  const hosts = () => nodes.filter((n) => (n.kind === 'room' || n.kind === 'start') && degree(n.id) < MAX_DEGREE).map((n) => n.id);

  // Loot rooms behind key doors. Each key goes in an ordinary room reachable without that door.
  const lootCount = rng.int(0, 2);
  for (let i = 0; i < lootCount; i++) {
    const h = hosts();
    if (!h.length) break;
    const key = BOSS_KEY + 1 + i;
    const host = rng.pick(h);
    const loot = add('loot', nodes[host]!.progress);
    connect(host, loot, 'key', key);
    const holders = nodes.filter((n) => n.kind === 'room' && n.key === undefined);
    if (!holders.length) throw new Error('mission: no room left to hold a loot key');
    rng.pick(holders).key = key;
  }

  // Dead ends.
  const deadEnds = between(shape.deadEnds);
  for (let i = 0; i < deadEnds; i++) {
    const h = hosts();
    if (!h.length) break;
    const host = rng.pick(h);
    connect(host, add('room', nodes[host]!.progress), plain());
  }

  // Secrets: dead ends behind a secret door, off an ordinary room.
  const secrets = rng.int(0, 2);
  for (let i = 0; i < secrets; i++) {
    const h = hosts();
    if (!h.length) break;
    const host = rng.pick(h);
    connect(host, add('secret', nodes[host]!.progress), 'secret');
  }

  // A calm start: at most one open doorway out of the start room; the rest get auto doors.
  let open = 0;
  for (const e of edges) if ((e.a === start || e.b === start) && e.door === 'open' && open++ > 0) e.door = 'auto';

  return { nodes, edges };
}

/** Structural and progression checks. Empty means the mission is completable as designed. */
export function validateMission(m: Mission): string[] {
  const errors: string[] = [];
  const n = m.nodes.length;
  const count = (k: RoomKind) => m.nodes.filter((x) => x.kind === k).length;
  for (const k of ['start', 'boss', 'exit'] as const) if (count(k) !== 1) errors.push(`expected 1 ${k}, found ${count(k)}`);
  if (count('miniboss') > 1) errors.push(`expected at most 1 miniboss, found ${count('miniboss')}`);

  const seenEdges = new Set<string>();
  const degree = new Array<number>(n).fill(0);
  for (const e of m.edges) {
    if (e.a === e.b || !m.nodes[e.a] || !m.nodes[e.b]) {
      errors.push(`bad edge ${e.a}–${e.b}`);
      continue;
    }
    const k = e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`;
    if (seenEdges.has(k)) errors.push(`duplicate edge ${e.a}–${e.b}`);
    seenEdges.add(k);
    degree[e.a]!++;
    degree[e.b]!++;
    if ((e.door === 'key') !== (e.key !== undefined)) errors.push(`edge ${e.a}–${e.b}: key must be set exactly on key doors`);
  }
  degree.forEach((d, i) => d > MAX_DEGREE && errors.push(`node ${i} has ${d} connections (max ${MAX_DEGREE})`));

  const locks = m.edges.filter((e) => e.door === 'key').map((e) => e.key!);
  const held = m.nodes.filter((x) => x.key !== undefined).map((x) => x.key!);
  for (const k of new Set([...locks, ...held])) {
    const l = locks.filter((x) => x === k).length;
    const h = held.filter((x) => x === k).length;
    if (l !== 1 || h !== 1) errors.push(`key ${k}: ${l} lock(s), ${h} holder(s); expected 1 of each`);
  }
  if (errors.length) return errors;

  const start = m.nodes.find((x) => x.kind === 'start')!.id;
  const boss = m.nodes.find((x) => x.kind === 'boss')!.id;
  const exit = m.nodes.find((x) => x.kind === 'exit')!.id;

  // Progression: explore, pick up keys, reopen locks, until nothing changes.
  const reached = explore(m, start, (e, keys) => e.door !== 'key' || keys.has(e.key!));
  const missing = m.nodes.filter((x) => !reached.has(x.id)).map((x) => x.id);
  if (missing.length) errors.push(`unreachable with keys in play: ${missing.join(', ')}`);

  // Secrets are optional: a dead end behind a secret door, holding no key, and never needed.
  for (const s of m.nodes.filter((x) => x.kind === 'secret')) {
    const links = m.edges.filter((e) => e.a === s.id || e.b === s.id);
    if (links.length !== 1 || links[0]!.door !== 'secret') errors.push(`secret ${s.id} must be a dead end behind a secret door`);
    if (s.key !== undefined) errors.push(`secret ${s.id} holds a key`);
  }
  for (const e of m.edges) {
    if (e.door === 'secret' && m.nodes[e.a]!.kind !== 'secret' && m.nodes[e.b]!.kind !== 'secret') errors.push(`secret door ${e.a}–${e.b} leads to no secret`);
  }
  const withoutSecrets = explore(m, start, (e, keys) => e.door !== 'secret' && (e.door !== 'key' || keys.has(e.key!)));
  const needed = m.nodes.filter((x) => x.kind !== 'secret' && !withoutSecrets.has(x.id)).map((x) => x.id);
  if (needed.length) errors.push(`rooms only reachable through a secret: ${needed.join(', ')}`);

  const exitLinks = m.edges.filter((e) => e.a === exit || e.b === exit);
  if (m.nodes.find((x) => x.kind === 'boss')!.key !== EXIT_KEY || exitLinks[0]?.key !== EXIT_KEY) errors.push('the boss must carry the exit key and the exit be behind its door');
  if (exitLinks.length !== 1 || ![exitLinks[0]!.a, exitLinks[0]!.b].includes(boss)) errors.push('exit must connect only to the boss room');
  const bossEntries = m.edges.filter((e) => (e.a === boss || e.b === boss) && e.a !== exit && e.b !== exit);
  if (bossEntries.length !== 1 || bossEntries[0]!.key !== BOSS_KEY) errors.push('boss room must have exactly one entry, a door needing the boss key');

  const miniboss = m.nodes.find((x) => x.kind === 'miniboss');
  if (miniboss) {
    // Without entering the mini boss room, the boss key must be out of reach.
    const bossKeyRoom = m.nodes.find((x) => x.key === BOSS_KEY)!.id;
    const avoiding = explore(m, start, (e, keys) => e.a !== miniboss.id && e.b !== miniboss.id && (e.door !== 'key' || keys.has(e.key!)));
    if (avoiding.has(bossKeyRoom)) errors.push('boss key reachable without passing the mini boss');
  }
  return errors;
}

/** Flood fill from `from`, collecting keys as rooms are reached and retrying edges until stable. */
function explore(m: Mission, from: number, passable: (e: MissionEdge, keys: ReadonlySet<number>) => boolean): Set<number> {
  const reached = new Set([from]);
  const keys = new Set<number>();
  const collect = (id: number) => {
    const k = m.nodes[id]!.key;
    if (k !== undefined) keys.add(k);
  };
  collect(from);
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of m.edges) {
      if (reached.has(e.a) === reached.has(e.b) || !passable(e, keys)) continue;
      const next = reached.has(e.a) ? e.b : e.a;
      reached.add(next);
      collect(next);
      changed = true;
    }
  }
  return reached;
}
