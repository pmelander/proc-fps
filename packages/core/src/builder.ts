import { MAP_FORMAT_VERSION, type Linedef, type MapData, type MapMeta, type Sector, type TextureId, type Thing } from './map.js';

export type Point = readonly [number, number];

export interface SectorSpec extends Partial<Omit<Sector, 'floor' | 'ceil'>> {
  floor: number;
  ceil: number;
  /** Texture for this sector's side of every boundary line. */
  wallTex?: TextureId;
}

/**
 * Builds maps from sector polygons. Shared edges between polygons are merged
 * into two-sided linedefs automatically, so generators think in rooms, not lines.
 *
 * Constraint: adjacent polygons must share *identical* edges — split edges at
 * T-junctions by inserting the vertex into both polygons.
 */
export class MapBuilder {
  private readonly vertices: { x: number; y: number }[] = [];
  private readonly vertexIndex = new Map<string, number>();
  private readonly linedefs: Linedef[] = [];
  private readonly lineIndex = new Map<string, number>();
  private readonly sectors: Sector[] = [];
  private readonly things: Thing[] = [];

  vertex(x: number, y: number): number {
    const key = `${x},${y}`;
    let i = this.vertexIndex.get(key);
    if (i === undefined) {
      i = this.vertices.length;
      this.vertices.push({ x, y });
      this.vertexIndex.set(key, i);
    }
    return i;
  }

  /** Adds a sector. Winding is normalized: outer → CCW, holes → CW. Returns sector index. */
  addSector(spec: SectorSpec, outer: readonly Point[], holes: readonly (readonly Point[])[] = []): number {
    const s = this.sectors.length;
    this.sectors.push({
      floor: spec.floor,
      ceil: spec.ceil,
      light: spec.light ?? 160,
      floorTex: spec.floorTex ?? 0,
      ceilTex: spec.ceilTex ?? 0,
      tag: spec.tag ?? 0,
      special: spec.special ?? 0,
    });
    const tex = spec.wallTex ?? 0;
    this.addLoop(s, orient(outer, true), tex);
    for (const h of holes) this.addLoop(s, orient(h, false), tex);
    return s;
  }

  thing(type: number, x: number, y: number, angle = 0, flags = 0): void {
    this.things.push({ type, x, y, angle, flags });
  }

  /** Overrides textures on the side of the line from a → b that faces `sector`. */
  setSideTextures(a: Point, b: Point, sector: number, tex: { upper?: TextureId; middle?: TextureId; lower?: TextureId }): void {
    const va = this.vertex(a[0], a[1]);
    const vb = this.vertex(b[0], b[1]);
    const li = this.lineIndex.get(edgeKey(va, vb));
    const ld = li === undefined ? undefined : this.linedefs[li];
    if (!ld) throw new Error(`no line between (${a}) and (${b})`);
    const side = ld.front.sector === sector ? ld.front : ld.back?.sector === sector ? ld.back : undefined;
    if (!side) throw new Error(`line (${a})-(${b}) does not border sector ${sector}`);
    Object.assign(side, tex);
  }

  build(meta: MapMeta): MapData {
    return {
      version: MAP_FORMAT_VERSION,
      meta,
      vertices: this.vertices.map((v) => ({ ...v })),
      linedefs: this.linedefs.map((l) => structuredClone(l)),
      sectors: this.sectors.map((s) => ({ ...s })),
      things: this.things.map((t) => ({ ...t })),
    };
  }

  private addLoop(sector: number, pts: readonly Point[], tex: TextureId): void {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const va = this.vertex(a[0], a[1]);
      const vb = this.vertex(b[0], b[1]);
      if (va === vb) continue;
      const key = edgeKey(va, vb);
      const existing = this.lineIndex.get(key);
      const side = { sector, upper: tex, middle: 0, lower: tex };
      if (existing === undefined) {
        this.lineIndex.set(key, this.linedefs.length);
        this.linedefs.push({ v1: va, v2: vb, front: { ...side, middle: tex }, flags: 0, tag: 0 });
        continue;
      }
      const ld = this.linedefs[existing]!;
      if (ld.v1 === va || ld.back) {
        throw new Error(`overlapping sectors ${ld.front.sector} and ${sector} at edge (${a})-(${b})`);
      }
      // Becomes two-sided: no middle texture on either side by default.
      ld.front.middle = 0;
      ld.back = side;
    }
  }
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function area(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function orient(pts: readonly Point[], ccw: boolean): readonly Point[] {
  return area(pts) > 0 === ccw ? pts : [...pts].reverse();
}

/**
 * Axis-aligned rectangle as a CCW polygon, with optional extra vertices on edges
 * (for T-junctions). Splits outside the open edge interval (including corners) are ignored.
 */
export function rect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  splits: { south?: number[]; east?: number[]; north?: number[]; west?: number[] } = {},
): Point[] {
  const inner = (vs: number[] | undefined, lo: number, hi: number, desc: boolean) =>
    [...new Set(vs ?? [])].filter((v) => v > lo && v < hi).sort((a, b) => (desc ? b - a : a - b));
  const pts: Point[] = [[x0, y0]];
  for (const x of inner(splits.south, x0, x1, false)) pts.push([x, y0]);
  pts.push([x1, y0]);
  for (const y of inner(splits.east, y0, y1, false)) pts.push([x1, y]);
  pts.push([x1, y1]);
  for (const x of inner(splits.north, x0, x1, true)) pts.push([x, y1]);
  pts.push([x0, y1]);
  for (const y of inner(splits.west, y0, y1, true)) pts.push([x0, y]);
  return pts;
}
