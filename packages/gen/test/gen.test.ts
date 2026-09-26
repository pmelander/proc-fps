import { describe, expect, it } from 'vitest';
import { CELL_SIZE as C, CellPlan, DoorKind, MAX_STEP, MapBuilder, ThingType, emitCellPlan, keyThing, rect } from '@proc-fps/core';
import { generate, validateGenerated } from '../src/index.js';

describe('generator', () => {
  it('same seed → identical map', () => {
    expect(JSON.stringify(generate('repro'))).toBe(JSON.stringify(generate('repro')));
  });
  it('different seeds → different maps', () => {
    expect(JSON.stringify(generate('a'))).not.toBe(JSON.stringify(generate('b')));
  });
  it('produces valid, completable maps', { timeout: 30_000 }, () => {
    for (let i = 0; i < 300; i++) {
      const seed = `t${i}`;
      expect({ seed, errors: validateGenerated(generate(seed)) }).toEqual({ seed, errors: [] });
    }
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
  it('keeps the layout for a seed and adds enemies at higher levels', async () => {
    const { generateDetailed, levelStats } = await import('../src/index.js');
    let easier = 0;
    let harder = 0;
    for (let i = 0; i < 40; i++) {
      const a = generateDetailed(`b${i}`, { level: 1 });
      const b = generateDetailed(`b${i}`, { level: 6 });
      expect(b.layout).toEqual(a.layout);
      easier += levelStats(a).enemies;
      harder += levelStats(b).enemies;
      expect(validateGenerated(b.map)).toEqual([]);
    }
    expect(harder).toBeGreaterThan(easier * 1.3);
  });
});
