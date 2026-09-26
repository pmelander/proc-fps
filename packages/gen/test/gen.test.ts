import { describe, expect, it } from 'vitest';
import { CELL_SIZE as C, MAX_STEP, MapBuilder, ThingType, rect } from '@proc-fps/core';
import { generate, validateGenerated } from '../src/index.js';

describe('generator', () => {
  it('same seed → identical map', () => {
    expect(JSON.stringify(generate('repro'))).toBe(JSON.stringify(generate('repro')));
  });
  it('different seeds → different maps', () => {
    expect(JSON.stringify(generate('a'))).not.toBe(JSON.stringify(generate('b')));
  });
  it('produces valid, completable maps', () => {
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
