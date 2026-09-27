import { DoorKind, doorKindOf, isDamaging, isLift, secretOf, type MapData } from '@proc-fps/core';
import { quantize } from '@proc-fps/render';
import { pickupCell, type SimState, type World } from '@proc-fps/sim';

/** Matches the 3D view's low-res height so the map has the same chunky pixels. */
const ROWS = 240;
/** Low-res pixels per map unit: a 128-unit cell is 8 px. */
const SCALE = 1 / 16;

const rgba = (r: number, g: number, b: number, a = 255): number => (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
/** Scales a packed colour's RGB, keeping its alpha. */
const shade = (c: number, f: number): number =>
  rgba(Math.min(255, (c & 0xff) * f), Math.min(255, ((c >>> 8) & 0xff) * f), Math.min(255, ((c >>> 16) & 0xff) * f), c >>> 24);
const hex = (s: string): number => rgba(parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16));

const BACKDROP = rgba(0, 0, 0, 215);
const WALL = rgba(240, 96, 64);
const OUTLINE = rgba(8, 8, 10);
/** Floors from the lowest to the highest in the level, in four steps. */
const FLOOR_LOW = [34, 44, 56] as const;
const FLOOR_HIGH = [104, 124, 146] as const;
const FLOOR_SHADES = 4;
const HAZARD = rgba(96, 196, 44);
const LIFT = rgba(48, 196, 216);
const CATWALK = rgba(150, 162, 178);
const DOOR = rgba(206, 210, 218);
const EXIT = rgba(64, 232, 96);
const PLAYER = rgba(244, 236, 214);
/** Key ids 0–3, as in the HUD and the level shader. */
const KEYS = ['#4073ff', '#ff3826', '#ffd933', '#40e64d'].map(hex);

/** How a cell is drawn: its pattern within the cell. */
const enum Kind {
  Void,
  Floor,
  Hazard,
  Lift,
  Catwalk,
  Door,
  Exit,
}

// Upright icons, `#` filled and outlined in black; anchored at their centre.
const KEY_GLYPH = ['.###......', '#...######', '#...#..#.#', '.###......'];
const PLAYER_GLYPH = ['...#...', '..###..', '..###..', '.#####.', '.#####.', '###.###', '##...##'];

export interface AutomapView {
  x: number;
  y: number;
  /** Map angle in radians; drawn pointing up. */
  yaw: number;
}

let image: ImageData | undefined;
let pixelCell = new Int32Array(0);
let pixelPattern = new Uint8Array(0);
const heightRange = new WeakMap<MapData, readonly [number, number]>();

/** The lowest and highest walkable surface in the map (floors and catwalk tops). */
function floorsOf(map: MapData): readonly [number, number] {
  let range = heightRange.get(map);
  if (!range) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of map.sectors) {
      const top = s.slab ? s.slab.top : s.floor;
      lo = Math.min(lo, s.floor, top);
      hi = Math.max(hi, s.floor, top);
    }
    range = [lo, hi];
    heightRange.set(map, range);
  }
  return range;
}

/**
 * Look-direction-up automap, rasterised at low res and scaled up pixelated: each pixel samples
 * the cell under it, so floors fill solid, shaded by height, with hazards, lifts, catwalks, doors
 * and the exit patterned in their own colours. Walls outline the open level; floor steps show as
 * darker seams. Keys and the player are upright icons. Unfound secrets stay off the map.
 */
export function drawAutomap(canvas: HTMLCanvasElement, map: MapData, view: AutomapView, world: World, state: SimState): void {
  const h = ROWS;
  const w = Math.max(1, Math.round((ROWS * canvas.clientWidth) / Math.max(1, canvas.clientHeight)));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (image?.width !== w || image.height !== h) {
    image = new ImageData(w, h);
    pixelCell = new Int32Array(w * h);
    pixelPattern = new Uint8Array(w * h);
  }
  const px = new Uint32Array(image.data.buffer);
  const grid = world.grid;
  const gw = grid.width;

  // Per cell: how it is drawn, its colour, and its surface height (for step seams).
  const n = gw * grid.height;
  const kind = new Uint8Array(n);
  const color = new Uint32Array(n);
  const height = new Float32Array(n);
  const [lo, hi] = floorsOf(map);
  const found = (s: number) => {
    const id = secretOf(map.sectors[s]!);
    return id < 0 || !!(state.secrets & (1 << id));
  };
  for (let i = 0; i < n; i++) {
    const s = grid.sector[i]!;
    if (s < 0 || !found(s)) continue;
    const sec = map.sectors[s]!;
    const top = sec.slab ? sec.slab.top : sec.floor;
    const t = hi > lo ? Math.round(((top - lo) / (hi - lo)) * (FLOOR_SHADES - 1)) / (FLOOR_SHADES - 1) : 1;
    let k = Kind.Floor;
    let c = rgba(...(FLOOR_LOW.map((v, j) => v + (FLOOR_HIGH[j]! - v) * t) as [number, number, number]));
    const door = world.doorAt[i]!;
    if (door >= 0 && state.doors[door]! === 0) {
      const dk = doorKindOf(sec);
      if (dk === DoorKind.Secret) continue; // a closed secret door is just wall
      k = Kind.Door;
      c = dk === DoorKind.Key ? KEYS[sec.tag]! : DOOR;
    } else if (world.exit && world.exit[0] + world.exit[1] * gw === i) [k, c] = [Kind.Exit, EXIT];
    else if (isLift(sec)) [k, c] = [Kind.Lift, LIFT];
    else if (sec.slab) [k, c] = [Kind.Catwalk, CATWALK];
    else if (isDamaging(sec)) [k, c] = [Kind.Hazard, HAZARD];
    kind[i] = k;
    color[i] = c;
    height[i] = top;
  }

  // Pass 1: the cell under each pixel, and where in the cell (for patterns).
  const cx = w >> 1;
  const cy = h >> 1;
  const fx = Math.cos(view.yaw);
  const fy = Math.sin(view.yaw);
  const inv = 1 / (SCALE * grid.cellSize);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Screen right is the look direction turned 90° clockwise; screen up is the look direction.
      const r = x + 0.5 - cx;
      const u = cy - (y + 0.5);
      const gx = (view.x - grid.originX) / grid.cellSize + (r * fy + u * fx) * inv;
      const gy = (view.y - grid.originY) / grid.cellSize + (-r * fx + u * fy) * inv;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const p = x + y * w;
      if (ix < 0 || iy < 0 || ix >= gw || iy >= grid.height) {
        pixelCell[p] = -1;
        continue;
      }
      const i = ix + iy * gw;
      pixelCell[p] = kind[i] ? i : -1;
      const ux = gx - ix;
      const uy = gy - iy;
      // Bits: 1 grid seam, 2 bars across x, 4 diagonal stripe, 8 checker.
      const q4x = Math.floor(ux * 4);
      const q4y = Math.floor(uy * 4);
      pixelPattern[p] =
        (ux < 0.125 || uy < 0.125 ? 1 : 0) | (q4x & 1 ? 2 : 0) | (Math.floor((ux + uy) * 3) & 1 ? 4 : 0) | ((q4x + q4y) & 1 ? 8 : 0);
    }
  }

  // Pass 2: colour. Walls sit on the void side of the edge, so floors keep their full size.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = x + y * w;
      const i = pixelCell[p]!;
      if (i < 0) {
        const edge =
          (x > 0 && pixelCell[p - 1]! >= 0) || (x < w - 1 && pixelCell[p + 1]! >= 0) || (y > 0 && pixelCell[p - w]! >= 0) || (y < h - 1 && pixelCell[p + w]! >= 0);
        px[p] = edge ? WALL : BACKDROP;
        continue;
      }
      const bits = pixelPattern[p]!;
      let c = color[i]!;
      switch (kind[i] as Kind) {
        case Kind.Floor:
          if (bits & 1) c = shade(c, 0.8);
          break;
        case Kind.Hazard:
          if (bits & 8) c = shade(c, 0.72);
          break;
        case Kind.Lift:
          if (bits & 4) c = shade(c, 0.55);
          break;
        case Kind.Catwalk:
          if (bits & 2) c = shade(c, 0.5);
          break;
        case Kind.Door:
          if (bits & 1) c = shade(c, 0.6);
          break;
        case Kind.Exit:
          if (bits & 8) c = shade(c, 0.35);
          break;
      }
      // A seam where the surface height changes to the right or below.
      const right = x < w - 1 ? pixelCell[p + 1]! : -1;
      const below = y < h - 1 ? pixelCell[p + w]! : -1;
      if ((right >= 0 && height[right] !== height[i]) || (below >= 0 && height[below] !== height[i])) c = shade(color[i]!, 0.5);
      px[p] = c;
    }
  }

  // Icons: keys lying anywhere, then the player, always pointing up.
  const glyph = (rows: readonly string[], x0: number, y0: number, c: number) => {
    const gh = rows.length;
    const gw2 = rows[0]!.length;
    const left = Math.round(x0 - gw2 / 2);
    const top = Math.round(y0 - gh / 2);
    const on = (i: number, j: number) => rows[j]?.[i] === '#';
    for (let j = -1; j <= gh; j++) {
      for (let i = -1; i <= gw2; i++) {
        const x = left + i;
        const y = top + j;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (on(i, j)) px[x + y * w] = c;
        else if (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1)) px[x + y * w] = OUTLINE;
      }
    }
  };
  world.pickups.forEach((k, i) => {
    const at = k.kind === 'key' && !state.taken[i] ? pickupCell(state, k) : null;
    if (!at) return;
    const [mx, my] = grid.center(at[0], at[1]);
    const dx = (mx - view.x) * SCALE;
    const dy = (my - view.y) * SCALE;
    glyph(KEY_GLYPH, cx + dx * fy - dy * fx, cy - (dx * fx + dy * fy), KEYS[k.key]!);
  });
  glyph(PLAYER_GLYPH, cx, cy, PLAYER);

  // Snapped to the level theme's palette, like the view under it (the map uses few colours, cached).
  const theme = map.meta.theme ?? 'base';
  for (let i = 0; i < px.length; i++) px[i] = inPalette(px[i]!, theme);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
}

const snapped = new Map<string, Map<number, number>>();
function inPalette(c: number, theme: string): number {
  const a = c >>> 24;
  if (a === 0) return c;
  let cache = snapped.get(theme);
  if (!cache) snapped.set(theme, (cache = new Map()));
  const rgb = c & 0xffffff;
  let q = cache.get(rgb);
  if (q === undefined) {
    const p = quantize([rgb & 0xff, (rgb >>> 8) & 0xff, (rgb >>> 16) & 0xff], theme).color;
    q = rgba(p[0], p[1], p[2], 0) & 0xffffff;
    cache.set(rgb, q);
  }
  return (q | (a << 24)) >>> 0;
}
