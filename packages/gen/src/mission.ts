import type { Rng } from '@proc-fps/core';

/**
 * Mission graph: the abstract plan of a level, before any geometry. Nodes are rooms and
 * edges are connections between them. Grid embedding (M2 slice 2) turns it into cells.
 *
 * Built by cyclic generation in the style of Dormans. The main cycle has two arcs from the
 * start to the gate, the room in front of the locked boss door:
 * - the short arc reaches the gate directly, so the player sees the boss door early;
 * - the long arc passes the mini boss, entered only through use doors, and the boss key
 *   lies in a dead end behind the mini boss, so it cannot be had without that fight.
 * Loot rooms hang off the cycle behind locked doors whose keys are placed where they can
 * be reached first. Dead ends and small detour loops add variety.
 */
export type RoomKind = 'start' | 'room' | 'miniboss' | 'boss' | 'loot' | 'exit';

/** See "Doors (decided)" in PROJECT_SUMMARY.md. `open` is a doorway with no door. */
export type DoorKind = 'open' | 'standard' | 'use' | 'locked';

export interface MissionNode {
  id: number;
  kind: RoomKind;
  /** Key this room holds. */
  key?: number;
}

export interface MissionEdge {
  a: number;
  b: number;
  door: DoorKind;
  /** Key that opens a locked door. */
  key?: number;
}

export interface Mission {
  nodes: MissionNode[];
  edges: MissionEdge[];
}

/** A room has four sides; capping connections at four keeps the embedding tractable. */
export const MAX_DEGREE = 4;
export const BOSS_KEY = 0;

const STANDARD_DOOR_CHANCE = 0.4;

export function generateMission(rng: Rng): Mission {
  const nodes: MissionNode[] = [];
  const edges: MissionEdge[] = [];
  const add = (kind: RoomKind): number => nodes.push({ id: nodes.length, kind }) - 1;
  const connect = (a: number, b: number, door: DoorKind, key?: number) => {
    edges.push(key === undefined ? { a, b, door } : { a, b, door, key });
  };
  const plain = (): DoorKind => (rng.chance(STANDARD_DOOR_CHANCE) ? 'standard' : 'open');
  const chain = (ids: number[]) => {
    for (let i = 1; i < ids.length; i++) connect(ids[i - 1]!, ids[i]!, plain());
  };
  const rooms = (n: number) => Array.from({ length: n }, () => add('room'));
  const degree = (id: number) => edges.reduce((d, e) => d + (e.a === id ? 1 : 0) + (e.b === id ? 1 : 0), 0);

  // Main cycle.
  const start = add('start');
  const gate = add('room');
  chain([start, ...rooms(rng.int(0, 2)), gate]);
  const approach = [start, ...rooms(rng.int(1, 2))];
  const miniboss = add('miniboss');
  const retreat = [...rooms(rng.int(0, 2)), gate];
  chain(approach);
  chain(retreat);
  connect(approach[approach.length - 1]!, miniboss, 'use');
  connect(miniboss, retreat[0]!, 'use');
  const keyRoom = add('room');
  nodes[keyRoom]!.key = BOSS_KEY;
  connect(miniboss, keyRoom, plain());

  const boss = add('boss');
  connect(gate, boss, 'locked', BOSS_KEY);
  connect(boss, add('exit'), 'standard');

  // Detour loops: replace a plain edge u–v with u–v plus u–w–v. Never around a use or locked
  // door, so the mini boss and the locks cannot be bypassed.
  const detours = rng.int(0, 2);
  for (let i = 0; i < detours; i++) {
    const candidates = edges.filter(
      (e) => (e.door === 'open' || e.door === 'standard') && [e.a, e.b].every((n) => nodes[n]!.kind === 'room' || nodes[n]!.kind === 'start') && degree(e.a) < MAX_DEGREE && degree(e.b) < MAX_DEGREE,
    );
    if (!candidates.length) break;
    const e = rng.pick(candidates);
    const w = add('room');
    connect(e.a, w, plain());
    connect(w, e.b, plain());
  }

  // Hosts for branches: ordinary rooms with a free side.
  const hosts = () => nodes.filter((n) => (n.kind === 'room' || n.kind === 'start') && degree(n.id) < MAX_DEGREE).map((n) => n.id);

  // Loot rooms behind locked doors. Each key goes in an ordinary room reachable without that lock.
  const lootCount = rng.int(0, 2);
  for (let i = 0; i < lootCount; i++) {
    const h = hosts();
    if (!h.length) break;
    const key = BOSS_KEY + 1 + i;
    const loot = add('loot');
    connect(rng.pick(h), loot, 'locked', key);
    const holders = nodes.filter((n) => n.kind === 'room' && n.key === undefined);
    if (!holders.length) throw new Error('mission: no room left to hold a loot key');
    rng.pick(holders).key = key;
  }

  // Dead ends.
  const deadEnds = rng.int(0, 2);
  for (let i = 0; i < deadEnds; i++) {
    const h = hosts();
    if (!h.length) break;
    connect(rng.pick(h), add('room'), plain());
  }

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
    if ((e.door === 'locked') !== (e.key !== undefined)) errors.push(`edge ${e.a}–${e.b}: key must be set exactly on locked doors`);
  }
  degree.forEach((d, i) => d > MAX_DEGREE && errors.push(`node ${i} has ${d} connections (max ${MAX_DEGREE})`));

  const locks = m.edges.filter((e) => e.door === 'locked').map((e) => e.key!);
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
  const reached = explore(m, start, (e, keys) => e.door !== 'locked' || keys.has(e.key!));
  const missing = m.nodes.filter((x) => !reached.has(x.id)).map((x) => x.id);
  if (missing.length) errors.push(`unreachable with keys in play: ${missing.join(', ')}`);

  const exitLinks = m.edges.filter((e) => e.a === exit || e.b === exit);
  if (exitLinks.length !== 1 || ![exitLinks[0]!.a, exitLinks[0]!.b].includes(boss)) errors.push('exit must connect only to the boss room');
  const bossEntries = m.edges.filter((e) => (e.a === boss || e.b === boss) && e.a !== exit && e.b !== exit);
  if (bossEntries.length !== 1 || bossEntries[0]!.key !== BOSS_KEY) errors.push('boss room must have exactly one entry, locked by the boss key');

  const miniboss = m.nodes.find((x) => x.kind === 'miniboss');
  if (miniboss) {
    // Without using a use door, the mini boss must be out of reach.
    if (explore(m, start, (e, keys) => e.door !== 'use' && (e.door !== 'locked' || keys.has(e.key!))).has(miniboss.id)) {
      errors.push('mini boss reachable without passing a use door');
    }
    // Without entering the mini boss room, the boss key must be out of reach.
    const bossKeyRoom = m.nodes.find((x) => x.key === BOSS_KEY)!.id;
    const avoiding = explore(m, start, (e, keys) => e.a !== miniboss.id && e.b !== miniboss.id && (e.door !== 'locked' || keys.has(e.key!)));
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
