import { describe, expect, it } from 'vitest';
import { Rng } from '@proc-fps/core';
import { designRoom, type RoomKind, type RoomTemplate } from '../src/index.js';

describe('room templates', () => {
  it('keep the outer ring as base floor, so every doorway stays connected', () => {
    const seen = new Set<RoomTemplate>();
    const rng = new Rng('rooms');
    for (const kind of ['start', 'room', 'miniboss', 'boss', 'loot', 'exit'] as RoomKind[]) {
      for (let w = 2; w <= 8; w++) {
        for (let h = 2; h <= 8; h++) {
          for (let i = 0; i < 20; i++) {
            const d = designRoom(kind, w, h, rng);
            seen.add(d.template);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                if (x === 0 || y === 0 || x === w - 1 || y === h - 1) expect(d.cells[x + y * w]).toBe(0);
              }
            }
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['arena', 'catwalk', 'hall', 'pit', 'plain', 'platform', 'stairs']);
  });
});
