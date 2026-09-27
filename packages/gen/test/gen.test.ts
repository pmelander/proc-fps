import { describe, expect, it } from 'vitest';
import { CELL_SIZE as C, CellGrid, CellPlan, DoorKind, EnemyType, MAX_STEP, MapBuilder, ThingType, emitCellPlan, isEnemyThing, isHigh, keyThing, rect } from '@proc-fps/core';
import { BOSS_KEY, EXIT_KEY, LEVEL_TYPES, generate, generateDetailed, levelTypeFor, strandsPlayer, validateGenerated, type Mission } from '../src/index.js';

describe('generator', () => {
  it('same seed → identical map', () => {
    expect(JSON.stringify(generate('repro'))).toBe(JSON.stringify(generate('repro')));
  });
  it('different seeds → different maps', () => {
    expect(JSON.stringify(generate('a'))).not.toBe(JSON.stringify(generate('b')));
  });
  it('produces valid, completable maps of every type', { timeout: 60_000 }, () => {
    for (let i = 0; i < 300; i++) {
      const seed = `t${i}`;
      const type = LEVEL_TYPES[i % LEVEL_TYPES.length]!;
      expect({ seed, type, errors: validateGenerated(generate(seed, { type })) }).toEqual({ seed, type, errors: [] });
    }
  });
});

describe('level types', () => {
  it('a run paces them, leaning vertical: compound, ascent, descent, ascent, compound, descent, …', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(levelTypeFor)).toEqual(['compound', 'ascent', 'descent', 'ascent', 'compound', 'descent', 'compound']);
    expect(generate('pace', { level: 2 }).meta.levelType).toBe('ascent');
  });

  it('a compound is flat; an ascent climbs to the exit; a descent falls to it', () => {
    let drops = 0;
    let atriums = 0;
    for (let i = 0; i < 30; i++) {
      const flat = generateDetailed(`s${i}`, { type: 'compound' });
      expect(new Set(flat.storeys)).toEqual(new Set([0]));
      for (const type of ['ascent', 'descent'] as const) {
        const g = generateDetailed(`s${i}`, { type });
        const start = g.mission.nodes.find((n) => n.kind === 'start')!.id;
        const exit = g.mission.nodes.find((n) => n.kind === 'exit')!.id;
        const top = Math.max(...g.storeys);
        expect(top).toBeGreaterThanOrEqual(1);
        expect([g.storeys[start], g.storeys[exit]]).toEqual(type === 'ascent' ? [0, top] : [top, 0]);
        if (type === 'descent') drops += g.drops;
        atriums += g.atriums;
      }
    }
    expect(drops).toBeGreaterThan(30); // descents are mostly taken by drops
    expect(atriums).toBeGreaterThan(5);
  });
});

describe('the start room', () => {
  it('has at most one open doorway, and its neighbours share its storey (no lift in)', () => {
    for (let i = 0; i < 60; i++) {
      const type = LEVEL_TYPES[i % LEVEL_TYPES.length]!;
      const g = generateDetailed(`calm-${i}`, { type });
      const start = g.mission.nodes.find((n) => n.kind === 'start')!.id;
      const links = g.mission.edges.filter((e) => e.a === start || e.b === start);
      expect(links.filter((e) => e.door === 'open').length).toBeLessThanOrEqual(1);
      for (const e of links) expect(g.storeys[e.a === start ? e.b : e.a]).toBe(g.storeys[start]);
    }
  });
});

describe('difficulty', () => {
  it('leaves normal maps exactly as they were, and scales enemies, health and damage', async () => {
    const { createWorld, defOf } = await import('@proc-fps/sim').then(async (m) => ({ ...m, defOf: (await import('@proc-fps/core')).defOf }));
    expect(JSON.stringify(generate('diff-a', { difficulty: 'normal' }))).toBe(JSON.stringify(generate('diff-a')));
    let easy = [0, 0];
    let brutal = [0, 0];
    for (let i = 0; i < 30; i++) {
      const count = (m: ReturnType<typeof generate>) => [m.things.filter((t) => isEnemyThing(t.type)).length, m.things.filter((t) => t.type === ThingType.Health).length];
      const e = count(generate(`diff-${i}`, { difficulty: 'easy', type: 'compound' }));
      const b = generate(`diff-${i}`, { difficulty: 'brutal', type: 'compound' });
      const c = count(b);
      easy = [easy[0]! + e[0]!, easy[1]! + e[1]!];
      brutal = [brutal[0]! + c[0]!, brutal[1]! + c[1]!];
      expect(b.meta.difficulty).toBe('brutal');
      expect(validateGenerated(b)).toEqual([]);
    }
    expect(brutal[0]).toBeGreaterThan(easy[0]! * 1.5);
    expect(brutal[1]).toBeLessThan(easy[1]!);
    const hard = createWorld(generate('diff-dmg', { difficulty: 'brutal' }));
    const soft = createWorld(generate('diff-dmg'));
    const grunt = { type: EnemyType.Grunt, variant: 0 };
    expect(defOf(hard.enemyDefs, grunt).damage).toBe(Math.round(defOf(soft.enemyDefs, grunt).damage * 1.4));
  });
});

describe('snipers on high ground', () => {
  it('perches some snipers on catwalk tops, where the sim starts them up on the slab', async () => {
    const { createWorld, createSimState } = await import('@proc-fps/sim');
    let perched = 0;
    for (let i = 0; i < 60; i++) {
      const map = generate(`perch-${i}`, { level: 4, type: 'ascent' });
      const grid = new CellGrid(map);
      const state = createSimState(createWorld(map));
      map.things.filter((t) => isEnemyThing(t.type)).forEach((t, k) => {
        if (!isHigh(t)) return;
        perched++;
        expect(t.type).toBe(EnemyType.Sniper);
        const [cx, cy] = grid.cellOf(t.x, t.y);
        expect(grid.levels(cx, cy)).toBe(2);
        expect(state.enemies[k]!.level).toBe(1);
        expect(state.enemies[k]!.z).toBe(grid.floorAt(cx, cy, 1));
      });
    }
    expect(perched).toBeGreaterThan(10);
  });
});

describe('one-way drops', () => {
  // start (0), gate (1), mini boss (2, boss key), boss (3, exit key), exit (4).
  const mission: Mission = {
    nodes: [{ id: 0, kind: 'start' }, { id: 1, kind: 'room' }, { id: 2, kind: 'miniboss', key: BOSS_KEY }, { id: 3, kind: 'boss', key: EXIT_KEY }, { id: 4, kind: 'exit' }],
    edges: [
      { a: 0, b: 1, door: 'open' },
      { a: 0, b: 2, door: 'auto' },
      { a: 2, b: 1, door: 'auto' },
      { a: 1, b: 3, door: 'key', key: BOSS_KEY },
      { a: 3, b: 4, door: 'key', key: EXIT_KEY },
    ],
  };
  it('allows a drop the player can always recover from', () => {
    expect(strandsPlayer(mission, new Map([[0, 0]]))).toBe(false); // start → gate: the mini boss is still reachable from the gate
  });
  it('rejects drops that leave the boss key behind', () => {
    // start → gate and mini boss → gate both one way: drop to the gate first and the key is gone.
    expect(strandsPlayer(mission, new Map([[0, 0], [2, 2]]))).toBe(true);
  });

  /**
   * An upper room (x 0–2, floor 192, with a pocket at (1, 1)) and a ledge down into a lower room
   * (3–5), then a key door (6) and the exit room (7–8). The key goes at `keyAt`.
   */
  const ledge = (keyAt: readonly [number, number]) => {
    const plan = new CellPlan();
    const upper = plan.spec({ floor: 192, ceil: 384 });
    const lower = plan.spec({ floor: 0, ceil: 384 });
    const door = plan.spec({ floor: 0, ceil: 128, special: DoorKind.Key, tag: 0 });
    const end = plan.spec({ floor: 0, ceil: 192 });
    for (const x of [0, 1, 2]) plan.set(x, 0, upper);
    plan.set(1, 1, upper);
    for (const x of [3, 4, 5]) plan.set(x, 0, lower);
    plan.set(6, 0, door);
    for (const x of [7, 8]) plan.set(x, 0, end);
    const b = new MapBuilder();
    emitCellPlan(b, plan, C);
    b.thing(ThingType.PlayerStart, C / 2, C / 2);
    b.thing(ThingType.Exit, 8.5 * C, C / 2);
    b.thing(keyThing(0), (keyAt[0] + 0.5) * C, (keyAt[1] + 0.5) * C);
    return b.build({ name: 'ledge' });
  };
  it('the map check accepts a key the player cannot miss on the way to the drop', () => {
    expect(validateGenerated(ledge([1, 0]))).toEqual([]);
  });
  it('the map check rejects a key the player can leave above the drop', () => {
    const errors = validateGenerated(ledge([1, 1]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^the player can be stranded: 3 cell\(s\)/);
  });
});

describe('trap detection', () => {
  /** 5×3 room, start west, exit east, one pit in the middle that the path can walk around. */
  const roomWithPit = (depth: number) => {
    const b = new MapBuilder();
    const pit = rect(2 * C, C, 3 * C, 2 * C);
    b.addSector({ floor: 0, ceil: 256 }, rect(0, 0, 5 * C, 3 * C), [pit]);
    b.addSector({ floor: -depth, ceil: 256 }, pit);
    b.thing(ThingType.PlayerStart, C / 2, 1.5 * C);
    b.thing(ThingType.Exit, 4.5 * C, 1.5 * C);
    return b.build({ name: 'pit' });
  };

  it('flags a pit too deep to climb out of', () => {
    expect(validateGenerated(roomWithPit(MAX_STEP + 8))).toEqual(['1 trap cell(s) cannot reach the exit: (2, 1)']);
  });
  it('accepts a pit you can climb out of', () => {
    expect(validateGenerated(roomWithPit(MAX_STEP))).toEqual([]);
  });
});

describe('key progression', () => {
  /** Room A (0–2) | key door (3) | room B (4–6), one row; the key goes in `keyAt`. */
  const lockedPair = (keyAt: number) => {
    const plan = new CellPlan();
    const room = plan.spec({ floor: 0, ceil: 192 });
    const door = plan.spec({ floor: 0, ceil: 128, special: DoorKind.Key, tag: 0 });
    for (const x of [0, 1, 2, 4, 5, 6]) plan.set(x, 0, room);
    plan.set(3, 0, door);
    const b = new MapBuilder();
    emitCellPlan(b, plan, C);
    b.thing(ThingType.PlayerStart, C / 2, C / 2);
    b.thing(ThingType.Exit, 1.5 * C, C / 2);
    b.thing(keyThing(0), (keyAt + 0.5) * C, C / 2);
    return b.build({ name: 'keys' });
  };

  it('accepts a key reachable before its door', () => {
    expect(validateGenerated(lockedPair(2))).toEqual([]);
  });
  it('rejects a key behind its own door', () => {
    expect(validateGenerated(lockedPair(5))).toEqual(['4 cell(s) unreachable even after collecting every reachable key']);
  });
});

describe('balance', () => {
  it('keeps the layout for a seed and type, and adds enemies at higher levels', async () => {
    const { levelStats } = await import('../src/index.js');
    let easier = 0;
    let harder = 0;
    for (let i = 0; i < 40; i++) {
      const type = LEVEL_TYPES[i % LEVEL_TYPES.length]!;
      const a = generateDetailed(`b${i}`, { level: 1, type });
      const b = generateDetailed(`b${i}`, { level: 6, type });
      expect(b.layout).toEqual(a.layout);
      easier += levelStats(a).enemies;
      harder += levelStats(b).enemies;
      expect(validateGenerated(b.map)).toEqual([]);
    }
    expect(harder).toBeGreaterThan(easier * 1.3);
  });
});

describe('armour and power-ups', () => {
  it('lie about the levels, mostly in secret and loot rooms, and new roles join as a run goes on', { timeout: 120_000 }, () => {
    const maps = new Map<number, ReturnType<typeof generate>[]>();
    const count = (level: number, types: number[]) => {
      if (!maps.has(level)) maps.set(level, Array.from({ length: 30 }, (_, i) => generate(`pu-${i}`, { level })));
      return maps.get(level)!.reduce((n, m) => n + m.things.filter((t) => types.includes(t.type)).length, 0);
    };
    expect(count(3, [ThingType.Armor])).toBeGreaterThan(10);
    expect(count(3, [ThingType.Berserk])).toBeGreaterThan(2);
    expect(count(3, [ThingType.Overcharge])).toBeGreaterThan(2);
    // Chargers and bloaters from level 2, wardens from level 3.
    expect(count(1, [EnemyType.Charger, EnemyType.Bloater, EnemyType.Warden])).toBe(0);
    expect(count(2, [EnemyType.Warden])).toBe(0);
    expect(count(4, [EnemyType.Charger])).toBeGreaterThan(0);
    expect(count(4, [EnemyType.Bloater])).toBeGreaterThan(0);
    expect(count(4, [EnemyType.Warden])).toBeGreaterThan(0);
  });
});
