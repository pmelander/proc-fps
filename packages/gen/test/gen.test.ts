import { describe, expect, it } from 'vitest';
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
