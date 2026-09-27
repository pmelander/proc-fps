/**
 * The game's pixel font, drawn here as 5×7 bitmaps and built at load time into a real TrueType
 * font (every lit pixel a square), so the whole UI can use it as ordinary text. Uppercase only:
 * lowercase letters map to the capitals. Glyphs are proportional (narrow punctuation), digits all
 * the same width so counters do not jitter. One glyph pixel is PX font units and the em is 8
 * pixels (7 above the baseline, 1 below), so at a font size of 8 × n CSS pixels every glyph pixel
 * lands on an n × n block of screen pixels. `heavy` thickens every stroke by a pixel to the right.
 * Pure: builds bytes, touches no DOM (ui/skin.ts registers them with the page).
 */

/** Font units per glyph pixel. */
export const PX = 128;
/** Glyph pixels per em. */
export const EM_PX = 8;
const UPM = PX * EM_PX;
/** Rows above the baseline (the cap height). */
const CAP = 7;

// Each glyph: rows top to bottom ('#' lit), all the same width; an eighth row hangs below the baseline.
const G: Record<string, string> = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '### .#. .#. .#. .#. .#. ###',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '####. ....# ....# .###. ....# ....# ####.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '.###. #.... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ....# .###.',
  '.': '. . . . . . #',
  ',': '.. .. .. .. .. .. .# #.',
  ':': '. . # . . # .',
  ';': '.. .. .# .. .. .# .# #.',
  '!': '# # # # # . #',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  "'": '# # . . . . .',
  '"': '#.# #.# ... ... ... ... ...',
  '-': '.... .... .... #### .... .... ....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '\\': '#.... #.... .#... ..#.. ...#. ....# ....#',
  '(': '..# .#. #.. #.. #.. .#. ..#',
  ')': '#.. .#. ..# ..# ..# .#. #..',
  '[': '### #.. #.. #.. #.. #.. ###',
  ']': '### ..# ..# ..# ..# ..# ###',
  '<': '...# ..#. .#.. #... .#.. ..#. ...#',
  '>': '#... .#.. ..#. ...# ..#. .#.. #...',
  '=': '.... .... #### .... #### .... ....',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....',
  _: '..... ..... ..... ..... ..... ..... #####',
  '|': '# # # # # # #',
  '·': '. . . # . . .',
  '×': '..... #...# .#.#. ..#.. .#.#. #...# .....',
  '—': '..... ..... ..... ##### ..... ..... .....',
  '∞': '....... ....... .##.##. #..#..# .##.##. ....... .......',
  '▲': '....... ...#... ..###.. .#####. #######  ....... .......',
  '▼': '....... ....... ####### .#####. ..###.. ...#... .......',
  '▶': '#... ##.. ###. #### ###. ##.. #...',
  '◀': '...# ..## .### #### .### ..## ...#',
  '→': '..... ..#.. ...#. ##### ...#. ..#.. .....',
  '←': '..... ..#.. .#... ##### .#... ..#.. .....',
  '♥': '.##.##. ####### ####### .#####. ..###.. ...#... .......',
  '☠': '.#####. ####### #..#..# ####### .##.##. ..###.. ..#.#..',
  '⛨': '##### ##### ##### ##### .###. ..#.. .....',
  '⚡': '...## ..##. .##.. ##### ..##. .##.. ##...',
};
/** Characters drawn with another's glyph. */
const ALIAS: Record<string, string> = { '–': '-', '►': '▶', '◄': '◀', '•': '·', '−': '-' };
for (let c = 97; c <= 122; c++) ALIAS[String.fromCharCode(c)] = String.fromCharCode(c - 32);
/** A space's advance, in pixels. */
const SPACE = 4;

interface Glyph {
  rows: string[];
  width: number;
}

function glyphs(heavy: boolean): Map<string, Glyph> {
  const out = new Map<string, Glyph>();
  for (const [ch, art] of Object.entries(G)) {
    let rows = art.split(/\s+/).filter(Boolean);
    if (heavy) rows = rows.map((r) => [...`${r}.`].map((c, i) => (c === '#' || r[i - 1] === '#' ? '#' : '.')).join(''));
    const width = Math.max(...rows.map((r) => r.length));
    out.set(ch, { rows: rows.map((r) => r.padEnd(width, '.')), width });
  }
  return out;
}

/** A glyph's lit pixels as rectangles (x0, y0, x1, y1 in pixels, y up from the baseline): runs per row, merged down. */
function rects(g: Glyph): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const used = g.rows.map((r) => [...r].map(() => false));
  g.rows.forEach((row, r) => {
    for (let x = 0; x < g.width; x++) {
      if (row[x] !== '#' || used[r]![x]) continue;
      let x1 = x;
      while (row[x1] === '#' && !used[r]![x1]) x1++;
      // Extend down while the rows below carry exactly the same run.
      let r1 = r + 1;
      const same = (rr: number) => g.rows[rr] !== undefined && [...Array(x1 - x).keys()].every((k) => g.rows[rr]![x + k] === '#' && !used[rr]![x + k]) && g.rows[rr]![x - 1] !== '#' && g.rows[rr]![x1] !== '#';
      while (same(r1)) r1++;
      for (let rr = r; rr < r1; rr++) for (let k = x; k < x1; k++) used[rr]![k] = true;
      out.push([x, CAP - r1, x1, CAP - r]);
      x = x1 - 1;
    }
  });
  return out;
}

/** Big-endian byte writer. */
class Bytes {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number) {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.room(1); this.view.setUint8(this.length, v); this.length += 1; return this; }
  u16(v: number) { this.room(2); this.view.setUint16(this.length, v & 0xffff); this.length += 2; return this; }
  i16(v: number) { this.room(2); this.view.setInt16(this.length, v); this.length += 2; return this; }
  u32(v: number) { this.room(4); this.view.setUint32(this.length, v >>> 0); this.length += 4; return this; }
  tag(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  bytes(b: Uint8Array) { this.room(b.length); this.buf.set(b, this.length); this.length += b.length; return this; }
  pad4() { while (this.length % 4) this.u8(0); return this; }
  done(): Uint8Array { return this.buf.slice(0, this.length); }
}

function checksum(b: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(b.length / 4) * 4);
  padded.set(b);
  const v = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

const log2 = (n: number) => Math.floor(Math.log2(n));

/** The font as TrueType bytes: family `name`, regular or heavy. */
export function buildFont(name: string, heavy = false): Uint8Array {
  const set = glyphs(heavy);
  // Glyph 0 is .notdef (a hollow box), 1 the space; then the drawn glyphs.
  const notdef: Glyph = { rows: ['####', '#..#', '#..#', '#..#', '#..#', '#..#', '####'], width: 4 };
  const order: { ch: string | null; g: Glyph | null; advance: number }[] = [
    { ch: null, g: notdef, advance: 5 },
    { ch: ' ', g: null, advance: SPACE },
    ...[...set.entries()].map(([ch, g]) => ({ ch, g, advance: g.width + 1 })),
  ];
  const index = new Map<string, number>();
  order.forEach((o, i) => o.ch !== null && index.set(o.ch, i));
  for (const [from, to] of Object.entries(ALIAS)) if (index.has(to)) index.set(from, index.get(to)!);

  // glyf and loca.
  const glyf = new Bytes();
  const loca: number[] = [];
  const bounds: [number, number, number, number][] = [];
  let maxPoints = 0;
  let maxContours = 0;
  for (const o of order) {
    loca.push(glyf.length);
    const rs = o.g ? rects(o.g) : [];
    if (!rs.length) {
      bounds.push([0, 0, 0, 0]);
      continue;
    }
    const xMin = Math.min(...rs.map((r) => r[0])) * PX;
    const yMin = Math.min(...rs.map((r) => r[1])) * PX;
    const xMax = Math.max(...rs.map((r) => r[2])) * PX;
    const yMax = Math.max(...rs.map((r) => r[3])) * PX;
    bounds.push([xMin, yMin, xMax, yMax]);
    maxPoints = Math.max(maxPoints, rs.length * 4);
    maxContours = Math.max(maxContours, rs.length);
    glyf.i16(rs.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
    rs.forEach((_, i) => glyf.u16(i * 4 + 3));
    glyf.u16(0); // no instructions
    // Clockwise squares (up the left side, across the top, down the right).
    const pts = rs.flatMap(([x0, y0, x1, y1]) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]] as const);
    for (let i = 0; i < pts.length; i++) glyf.u8(0x01); // on curve, long coordinates
    let px = 0;
    for (const [x] of pts) { glyf.i16(x * PX - px); px = x * PX; }
    let py = 0;
    for (const [, y] of pts) { glyf.i16(y * PX - py); py = y * PX; }
    glyf.pad4();
  }
  loca.push(glyf.length);
  const numGlyphs = order.length;
  const advances = order.map((o) => o.advance * PX);
  const all = bounds.filter((b) => b[2] > b[0]);
  const fxMin = Math.min(...all.map((b) => b[0]));
  const fyMin = Math.min(...all.map((b) => b[1]));
  const fxMax = Math.max(...all.map((b) => b[2]));
  const fyMax = Math.max(...all.map((b) => b[3]));
  const ascent = CAP * PX;
  const descent = (EM_PX - CAP) * PX;

  const tables: Record<string, Uint8Array> = {};
  tables['head'] = new Bytes()
    .u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5)
    .u16(0x000b).u16(UPM)
    .u32(0).u32(0).u32(0).u32(0) // created, modified
    .i16(fxMin).i16(fyMin).i16(fxMax).i16(fyMax)
    .u16(heavy ? 1 : 0).u16(6).i16(2).i16(1).i16(0)
    .done();
  tables['hhea'] = new Bytes()
    .u32(0x00010000).i16(ascent).i16(-descent).i16(0)
    .u16(Math.max(...advances)).i16(0).i16(0).i16(fxMax)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0)
    .u16(numGlyphs)
    .done();
  const hmtx = new Bytes();
  order.forEach((_, i) => hmtx.u16(advances[i]!).i16(bounds[i]![0]));
  tables['hmtx'] = hmtx.done();
  tables['maxp'] = new Bytes()
    .u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours).u16(0).u16(0)
    .u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0)
    .done();
  const codes = [...index.keys()].map((c) => c.codePointAt(0)!).filter((c) => c <= 0xffff).sort((a, b) => a - b);
  const os2 = new Bytes()
    .u16(4).i16(Math.round(advances.reduce((a, b) => a + b, 0) / numGlyphs)).u16(heavy ? 700 : 400).u16(5).u16(0)
    .i16(UPM / 2).i16(UPM / 2).i16(0).i16(PX).i16(UPM / 2).i16(UPM / 2).i16(0).i16(4 * PX).i16(PX).i16(3 * PX)
    .i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0); // panose
  os2.u32(1).u32(0).u32(0).u32(0).tag('PROC')
    .u16((heavy ? 0x20 : 0x40) | 0x80).u16(codes[0]!).u16(codes[codes.length - 1]!)
    .i16(ascent).i16(-descent).i16(0).u16(ascent).u16(descent)
    .u32(1).u32(0)
    .i16(CAP * PX).i16(CAP * PX).u16(0).u16(32).u16(1);
  tables['OS/2'] = os2.done();
  tables['post'] = new Bytes().u32(0x00030000).u32(0).i16(-PX).i16(PX).u32(0).u32(0).u32(0).u32(0).u32(0).done();
  // cmap: one format 4 segment per character (ids need not be contiguous that way).
  const segs = [...codes.map((c) => ({ start: c, end: c, delta: (index.get(String.fromCodePoint(c))! - c) & 0xffff })), { start: 0xffff, end: 0xffff, delta: 1 }];
  const segX2 = segs.length * 2;
  const search = 2 * 2 ** log2(segs.length);
  const sub = new Bytes().u16(4).u16(16 + segs.length * 8).u16(0).u16(segX2).u16(search).u16(log2(segs.length)).u16(segX2 - search);
  segs.forEach((s) => sub.u16(s.end));
  sub.u16(0);
  segs.forEach((s) => sub.u16(s.start));
  segs.forEach((s) => sub.u16(s.delta));
  segs.forEach(() => sub.u16(0));
  tables['cmap'] = new Bytes().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.done()).done();
  // name: family, style, unique id, full name, PostScript name.
  const style = heavy ? 'Bold' : 'Regular';
  const names: [number, string][] = [[1, name], [2, style], [3, `${name} ${style}`], [4, `${name} ${style}`], [6, `${name.replace(/\s/g, '')}-${style}`]];
  const strings = new Bytes();
  const records = new Bytes();
  for (const [id, text] of names) {
    records.u16(3).u16(1).u16(0x409).u16(id).u16(text.length * 2).u16(strings.length);
    for (const c of text) strings.u16(c.charCodeAt(0));
  }
  tables['name'] = new Bytes().u16(0).u16(names.length).u16(6 + names.length * 12).bytes(records.done()).bytes(strings.done()).done();
  tables['glyf'] = glyf.done();
  const locaBytes = new Bytes();
  loca.forEach((o) => locaBytes.u32(o));
  tables['loca'] = locaBytes.done();

  // The file: offset table, directory (sorted by tag), then the tables, each 4-byte aligned.
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const searchRange = 16 * 2 ** log2(n);
  const out = new Bytes().u32(0x00010000).u16(n).u16(searchRange).u16(log2(n)).u16(n * 16 - searchRange);
  let offset = 12 + n * 16;
  for (const t of tags) {
    const b = tables[t]!;
    out.tag(t).u32(checksum(b)).u32(offset).u32(b.length);
    offset += Math.ceil(b.length / 4) * 4;
  }
  for (const t of tags) out.bytes(tables[t]!).pad4();
  const file = out.done();
  // head.checkSumAdjustment makes the whole file sum to 0xB1B0AFBA.
  const headAt = new DataView(file.buffer).getUint32(12 + tags.indexOf('head') * 16 + 8);
  new DataView(file.buffer).setUint32(headAt + 8, (0xb1b0afba - checksum(file)) >>> 0);
  return file;
}

/** The characters the font draws (lowercase included, as capitals). */
export function fontCharacters(): string[] {
  return [' ', ...Object.keys(G), ...Object.keys(ALIAS)];
}
