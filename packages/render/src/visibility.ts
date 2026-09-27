import { SectorLocator, type MapData } from '@proc-fps/core';

/**
 * Portal culling: which sectors the camera can see. Sectors are joined by portals, the two-sided
 * lines between them (open doorways, steps, door cells, catwalk edges); everything else is wall.
 * From the camera's sector, the view is flooded outward: the horizontal field of view is an angle
 * window, each portal inside the window narrows it to the portal's own angular extent, and the
 * flood goes on into the sector beyond while any window is left.
 *
 * Conservative by construction: heights are ignored (a portal counts as open whatever its floor
 * and ceiling), and door portals count as open whatever the door's state, so it may keep a sector
 * the camera cannot quite see, never drop one it can. Pure: tested in Node.
 */

interface Portal {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** The sector on the far side. */
  to: number;
}

/** Portal ends nearer the camera's plane than this (map units, forward) are clipped to it. */
const NEAR = 1;
/** Windows narrower than this (radians) see nothing. */
const MIN_WINDOW = 1e-5;
/** Angles are widened by this much (radians) so rounding never loses a sliver of a sector. */
const SLACK = 0.002;
/** A flood deeper than this is cut short (every sector is still reached along some shallower path). */
const MAX_DEPTH = 256;
/** A camera this close to a portal (map units) counts as standing in both sectors. */
const ON_PORTAL = 24;

function distanceToSegment(x: number, y: number, p: Portal): number {
  const dx = p.bx - p.ax;
  const dy = p.by - p.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / len2)) : 0;
  return Math.hypot(x - (p.ax + dx * t), y - (p.ay + dy * t));
}

export class PortalGraph {
  private readonly portals: Portal[][];
  private readonly locator: SectorLocator;
  readonly sectorCount: number;

  constructor(map: MapData) {
    this.sectorCount = map.sectors.length;
    this.locator = new SectorLocator(map);
    this.portals = map.sectors.map(() => []);
    for (const ld of map.linedefs) {
      if (!ld.back || ld.back.sector === ld.front.sector) continue;
      const a = map.vertices[ld.v1]!;
      const b = map.vertices[ld.v2]!;
      this.portals[ld.front.sector]!.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, to: ld.back.sector });
      this.portals[ld.back.sector]!.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, to: ld.front.sector });
    }
  }

  /**
   * Sectors visible from (x, y) looking along `yaw` (map radians) with `halfFov` radians either
   * side: 1 = visible. Outside every sector (a camera in a wall) everything is.
   */
  visible(x: number, y: number, yaw: number, halfFov: number): Uint8Array {
    const out = new Uint8Array(this.sectorCount);
    const start = this.locator.locate(x, y);
    if (start < 0) return out.fill(1);
    const fx = Math.cos(yaw);
    const fy = Math.sin(yaw);
    // Angle of a point relative to the view direction, positive to the left; points behind the
    // near plane come clipped. Returns [forward, left] of each end, or null when both are behind.
    const project = (p: Portal): [number, number, number, number] | null => {
      let af = (p.ax - x) * fx + (p.ay - y) * fy;
      let al = -(p.ax - x) * fy + (p.ay - y) * fx;
      let bf = (p.bx - x) * fx + (p.by - y) * fy;
      let bl = -(p.bx - x) * fy + (p.by - y) * fx;
      if (af < NEAR && bf < NEAR) return null;
      if (af < NEAR) {
        const t = (NEAR - af) / (bf - af);
        al += (bl - al) * t;
        af = NEAR;
      } else if (bf < NEAR) {
        const t = (NEAR - bf) / (af - bf);
        bl += (al - bl) * t;
        bf = NEAR;
      }
      return [af, al, bf, bl];
    };
    // Windows already flooded into each sector: a narrower one inside them adds nothing.
    const seen: [number, number][][] = Array.from({ length: this.sectorCount }, () => []);
    const stack: [sector: number, lo: number, hi: number, depth: number][] = [];
    const root = (s: number) => {
      if (seen[s]!.some(([l, h]) => l <= -halfFov && h >= halfFov)) return;
      out[s] = 1;
      seen[s]!.push([-halfFov, halfFov]);
      stack.push([s, -halfFov, halfFov, 0]);
    };
    root(start);
    // Standing on (or right by) a portal, mid-step: the sector beyond it is as much "here" as this
    // one, and a portal through the camera projects to nothing, so it roots the flood too.
    for (const p of this.portals[start]!) if (distanceToSegment(x, y, p) < ON_PORTAL) root(p.to);
    while (stack.length) {
      const [s, lo, hi, depth] = stack.pop()!;
      if (depth >= MAX_DEPTH) continue;
      for (const p of this.portals[s]!) {
        const ends = project(p);
        if (!ends) continue;
        const a = Math.atan2(ends[1], ends[0]);
        const b = Math.atan2(ends[3], ends[2]);
        const nlo = Math.max(lo, Math.min(a, b) - SLACK);
        const nhi = Math.min(hi, Math.max(a, b) + SLACK);
        if (nhi - nlo < MIN_WINDOW) continue;
        if (seen[p.to]!.some(([l, h]) => l <= nlo && h >= nhi)) continue;
        seen[p.to]!.push([nlo, nhi]);
        out[p.to] = 1;
        stack.push([p.to, nlo, nhi, depth + 1]);
      }
    }
    return out;
  }
}
