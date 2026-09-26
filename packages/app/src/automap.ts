import { DoorKind, ThingType, doorKindOf, keyOfThing, secretOf, type MapData } from '@proc-fps/core';
import { paletteRGBA } from '@proc-fps/render';
import type { SimState, World } from '@proc-fps/sim';

/** Matches the 3D view's low-res height so the map has the same chunky pixels. */
const ROWS = 240;
/** Low-res pixels per map unit: a 128-unit cell is 16 px. */
const SCALE = 1 / 8;
const BACKDROP_ALPHA = 153;

/** Palette entry (ramp × 8 + step) → packed RGBA, so the map uses the game's 64 colours. */
const PAL = paletteRGBA();
const pal = (ramp: number, step: number): number => {
  const i = (ramp * 8 + step) * 4;
  return PAL[i]! | (PAL[i + 1]! << 8) | (PAL[i + 2]! << 16) | (0xff << 24);
};
const WALL = pal(3, 5); // blood
const FLOOR_STEP = pal(5, 6); // rust
const CEIL_STEP = pal(1, 4); // brown
const EXIT = pal(6, 6); // toxic
const THING = pal(4, 6); // steel
const PLAYER = pal(7, 7); // bone
const DOOR = pal(0, 6); // gray
/** Key ids 0–3: blue, red, yellow, green, as near as the palette gets. */
const KEY = [pal(4, 7), pal(3, 6), pal(5, 7), pal(6, 7)];

export interface AutomapView {
  x: number;
  y: number;
  /** Map angle in radians; drawn pointing up. */
  yaw: number;
}

let image: ImageData | undefined;

/** Look-direction-up automap, rasterised at low res with 1-px lines and scaled up pixelated. */
export function drawAutomap(canvas: HTMLCanvasElement, map: MapData, view: AutomapView, world: World, state: SimState): void {
  const h = ROWS;
  const w = Math.max(1, Math.round((ROWS * canvas.clientWidth) / Math.max(1, canvas.clientHeight)));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (image?.width !== w || image.height !== h) image = new ImageData(w, h);
  const px = new Uint32Array(image.data.buffer);
  px.fill(BACKDROP_ALPHA << 24);

  const cx = w >> 1;
  const cy = h >> 1;
  const f = [Math.cos(view.yaw), Math.sin(view.yaw)] as const;
  // Screen right is the look direction turned 90° clockwise.
  const sx = (x: number, y: number) => Math.round(cx + ((x - view.x) * f[1] - (y - view.y) * f[0]) * SCALE);
  const sy = (x: number, y: number) => Math.round(cy - ((x - view.x) * f[0] + (y - view.y) * f[1]) * SCALE);

  const plot = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) px[x + y * w] = c;
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: number) => {
    if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 >= w && x1 >= w) || (y0 >= h && y1 >= h)) return;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x0, y0, c);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += stepX;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += stepY;
      }
    }
  };

  const doorColor = (s: number): number | undefined => {
    const sec = map.sectors[s]!;
    const kind = doorKindOf(sec);
    const id = world.doors.findIndex((d) => d.sector === s);
    if (kind === DoorKind.None || (id >= 0 && state.doors[id]! > 0)) return undefined; // open doors vanish
    return kind === DoorKind.Secret ? WALL : kind === DoorKind.Key ? KEY[sec.tag] : DOOR;
  };
  // Unfound secret areas stay off the map; where one meets the open level it reads as wall.
  const hidden = (s: number) => {
    const id = secretOf(map.sectors[s]!);
    return id >= 0 && !(state.secrets & (1 << id));
  };
  for (const ld of map.linedefs) {
    const hf = hidden(ld.front.sector);
    const hb = ld.back ? hidden(ld.back.sector) : hf;
    if (hf && hb) continue;
    let c: number;
    if (!ld.back || hf || hb) c = WALL;
    else {
      const F = map.sectors[ld.front.sector]!;
      const B = map.sectors[ld.back.sector]!;
      const door = doorColor(ld.front.sector) ?? doorColor(ld.back.sector);
      if (door !== undefined) c = door;
      else if (F.floor !== B.floor) c = FLOOR_STEP;
      else if (F.ceil !== B.ceil) c = CEIL_STEP;
      else continue;
    }
    const a = map.vertices[ld.v1]!;
    const b = map.vertices[ld.v2]!;
    line(sx(a.x, a.y), sy(a.x, a.y), sx(b.x, b.y), sy(b.x, b.y), c);
  }

  let keyIndex = 0;
  for (const t of map.things) {
    const key = keyOfThing(t.type);
    if (key >= 0 && state.taken & (1 << keyIndex++)) continue;
    const x = sx(t.x, t.y);
    const y = sy(t.x, t.y);
    const c = key >= 0 ? KEY[key]! : t.type === ThingType.Exit ? EXIT : THING;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) plot(x + i, y + j, c);
  }

  // Player chevron, always pointing up.
  line(cx, cy - 4, cx - 3, cy + 3, PLAYER);
  line(cx, cy - 4, cx + 3, cy + 3, PLAYER);
  line(cx - 3, cy + 3, cx, cy + 1, PLAYER);
  line(cx + 3, cy + 3, cx, cy + 1, PLAYER);

  canvas.getContext('2d')!.putImageData(image, 0, 0);
}
