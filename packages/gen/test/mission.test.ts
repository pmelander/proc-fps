import { describe, expect, it } from 'vitest';
import { Rng } from '@proc-fps/core';
import { BOSS_KEY, generateMission, validateMission, type Mission } from '../src/index.js';

const mission = (seed: string) => generateMission(new Rng(seed).fork('mission'));

describe('mission graph', () => {
  it('same seed → identical mission', () => {
    expect(mission('repro')).toEqual(mission('repro'));
  });

  it('is valid for many seeds', () => {
    for (let i = 0; i < 2000; i++) {
      const seed = `m${i}`;
      expect({ seed, errors: validateMission(mission(seed)) }).toEqual({ seed, errors: [] });
    }
  });

  it('varies in size and content', () => {
    const sizes = new Set<number>();
    let loot = 0;
    for (let i = 0; i < 200; i++) {
      const m = mission(`v${i}`);
      sizes.add(m.nodes.length);
      loot += m.nodes.filter((n) => n.kind === 'loot').length;
    }
    expect(sizes.size).toBeGreaterThan(4);
    expect(loot).toBeGreaterThan(0);
  });
});

describe('validateMission', () => {
  // start – gate =key=> boss – exit, with the boss key in a dead end behind the mini boss.
  const base = (): Mission => ({
    nodes: [
      { id: 0, kind: 'start' },
      { id: 1, kind: 'room' },
      { id: 2, kind: 'miniboss' },
      { id: 3, kind: 'room', key: BOSS_KEY },
      { id: 4, kind: 'boss' },
      { id: 5, kind: 'exit' },
    ],
    edges: [
      { a: 0, b: 1, door: 'open' },
      { a: 0, b: 2, door: 'auto' },
      { a: 2, b: 3, door: 'open' },
      { a: 1, b: 4, door: 'key', key: BOSS_KEY },
      { a: 4, b: 5, door: 'auto' },
    ],
  });

  it('accepts a minimal valid mission', () => {
    expect(validateMission(base())).toEqual([]);
  });

  it('rejects a key locked behind its own door', () => {
    const m = base();
    delete m.nodes[3]!.key;
    m.nodes[4]!.key = BOSS_KEY;
    expect(validateMission(m)).toContain('unreachable with keys in play: 4, 5');
  });

  it('rejects a boss key reachable without the mini boss', () => {
    const m = base();
    m.edges.push({ a: 1, b: 3, door: 'open' });
    expect(validateMission(m)).toContain('boss key reachable without passing the mini boss');
  });
});
