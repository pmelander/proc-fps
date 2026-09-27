import { describe, expect, it } from 'vitest';
import { PX, buildFont, fontCharacters } from '../src/ui/font.js';

/** A minimal TrueType reader: the table directory, and cmap format 4 lookups. */
function read(file: Uint8Array) {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const n = v.getUint16(4);
  const tables = new Map<string, { offset: number; length: number; sum: number }>();
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...file.slice(at, at + 4));
    tables.set(tag, { sum: v.getUint32(at + 4), offset: v.getUint32(at + 8), length: v.getUint32(at + 12) });
  }
  const cmap = tables.get('cmap')!.offset;
  const sub = cmap + v.getUint32(cmap + 8);
  const segs = v.getUint16(sub + 6) / 2;
  const glyphOf = (ch: string) => {
    const c = ch.codePointAt(0)!;
    for (let s = 0; s < segs; s++) {
      const end = v.getUint16(sub + 14 + s * 2);
      const start = v.getUint16(sub + 16 + segs * 2 + s * 2);
      if (c < start || c > end) continue;
      return (c + v.getUint16(sub + 16 + segs * 4 + s * 2)) & 0xffff;
    }
    return 0;
  };
  return { v, tables, glyphOf };
}

const sum = (b: Uint8Array) => {
  const p = new Uint8Array(Math.ceil(b.length / 4) * 4);
  p.set(b);
  const dv = new DataView(p.buffer);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + dv.getUint32(i)) >>> 0;
  return s;
};

describe('the pixel font', () => {
  for (const heavy of [false, true]) {
    it(`builds a well-formed TrueType file${heavy ? ' (heavy)' : ''}`, () => {
      const file = buildFont('Proc', heavy);
      const { v, tables, glyphOf } = read(file);
      expect(v.getUint32(0)).toBe(0x00010000);
      const tags = [...tables.keys()];
      expect(tags).toEqual([...tags].sort());
      expect(tags.sort()).toEqual(['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
      for (const [tag, t] of tables) {
        expect(t.offset % 4, tag).toBe(0);
        if (tag !== 'head') expect(sum(file.slice(t.offset, t.offset + t.length)), tag).toBe(t.sum);
      }
      expect(sum(file)).toBe(0xb1b0afba);
      const head = tables.get('head')!.offset;
      expect(v.getUint32(head + 12)).toBe(0x5f0f3cf5);
      expect(v.getUint16(head + 18)).toBe(PX * 8);
      // Every character maps to a glyph; lowercase to the capitals.
      const numGlyphs = v.getUint16(tables.get('maxp')!.offset + 4);
      for (const ch of fontCharacters()) {
        const g = glyphOf(ch);
        expect(g, ch).toBeGreaterThan(0);
        expect(g, ch).toBeLessThan(numGlyphs);
      }
      expect(glyphOf('a')).toBe(glyphOf('A'));
      expect(glyphOf('\u{4e00}')).toBe(0);
    });
  }

  it('makes digits the same width, so counters hold still', () => {
    const file = buildFont('Proc');
    const { v, tables, glyphOf } = read(file);
    const hmtx = tables.get('hmtx')!.offset;
    const advance = (ch: string) => v.getUint16(hmtx + glyphOf(ch) * 4);
    const widths = new Set([...'0123456789'].map(advance));
    expect(widths.size).toBe(1);
    expect(advance('.')).toBeLessThan(advance('0'));
  });
});
