import { buildFont } from './font.js';

/**
 * The UI's look, shared by every screen and the HUD: the procedural pixel font (ui/font.ts), a
 * UI pixel `--u` sized to the window (every border, gap and glyph pixel is a whole number of
 * them, so nothing blurs), the game's palette as CSS colours (style.css), and textures drawn here
 * in that palette: a riveted iron plate (a nine-slice border image), a dithered backdrop like the
 * scene's own Bayer dithering, a dithered fire ramp for the logo, and hazard stripes. The level's
 * theme light is the accent, so the UI takes on each level's colour.
 */
export type Rgb = readonly [number, number, number];

/** Palette steps (render/palette.ts) the textures use. */
const INK: Rgb = [10, 10, 12];
const IRON: readonly Rgb[] = [[16, 16, 19], [24, 24, 26], [34, 33, 34], [48, 48, 49], [76, 76, 76], [110, 110, 108]];
const FIRE: readonly Rgb[] = [[250, 238, 206], [252, 176, 72], [208, 144, 58], [236, 96, 80], [195, 78, 65], [121, 46, 39]];
const RUST: Rgb = [252, 176, 72];

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const css = (c: Rgb, a = 1) => (a === 1 ? `rgb(${c.join(' ')})` : `rgb(${c.join(' ')} / ${a})`);

function texture(w: number, h: number, paint: (px: (x: number, y: number, c: Rgb | null, a?: number) => void) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  paint((x, y, c, a = 1) => {
    if (!c) return;
    ctx.fillStyle = css(c, a);
    ctx.fillRect(x, y, 1, 1);
  });
  return `url(${canvas.toDataURL()})`;
}

/** A small deterministic hash for texture grain. */
const grain = (x: number, y: number) => {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((Math.imul(h, 1103515245) >>> 16) & 0xffff) / 0xffff;
};

/**
 * A riveted iron plate, 16 × 16, sliced 5 from each edge: a black rim, a bevel (lit top left,
 * shadowed bottom right), a rivet in each corner, and a grainy dithered face.
 */
function plate(face: readonly Rgb[], rim: Rgb): string {
  const N = 16;
  return texture(N, N, (px) => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
        if (edge === 0) {
          px(x, y, rim);
          continue;
        }
        if (edge === 1) {
          px(x, y, x === 1 || y === 1 ? (x + y > N - 2 && (x === N - 2 || y === N - 2) ? face[2]! : face[4]!) : face[0]!);
          continue;
        }
        const g = grain(x, y) * 16;
        px(x, y, g > BAYER4[(y % 4) * 4 + (x % 4)]! + 4 ? face[2]! : face[1]!);
      }
    }
    for (const [rx, ry] of [[3, 3], [N - 5, 3], [3, N - 5], [N - 5, N - 5]] as const) {
      px(rx, ry, face[5]!);
      px(rx + 1, ry, face[4]!);
      px(rx, ry + 1, face[4]!);
      px(rx + 1, ry + 1, face[0]!);
    }
  });
}

/** A 4 × 4 Bayer screen of black: dims what is behind it the way the scene's shadows dither. */
function screen(level: number, alpha: number): string {
  return texture(4, 4, (px) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y * 4 + x]! < level) px(x, y, INK, alpha);
  });
}

/** The logo's fire: bone-white at the top through rust to blood at the bottom, dithered between steps. */
function fireRamp(rows: number): string {
  return texture(4, rows, (px) => {
    for (let y = 0; y < rows; y++) {
      const t = (y / Math.max(1, rows - 1)) * (FIRE.length - 1);
      const i = Math.floor(t);
      const f = t - i;
      for (let x = 0; x < 4; x++) px(x, y, f * 16 > BAYER4[(y % 4) * 4 + x]! ? FIRE[Math.min(i + 1, FIRE.length - 1)]! : FIRE[i]!);
    }
  });
}

/** Hazard stripes: 8 × 8, diagonal bands of rust and ink. */
function stripes(): string {
  return texture(8, 8, (px) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, (x + y) % 8 < 4 ? RUST : INK);
  });
}

let fontsReady: Promise<void> | undefined;

/** Registers the pixel font (regular and heavy) with the page. */
export function installFonts(): Promise<void> {
  fontsReady ??= (async () => {
    for (const [family, heavy] of [['Proc', false], ['Proc Heavy', true]] as const) {
      const face = new FontFace(family, buildFont(family, heavy) as Uint8Array<ArrayBuffer>);
      try {
        await face.load();
        document.fonts.add(face);
      } catch (e) {
        console.warn(`pixel font ${family} rejected; falling back`, e);
      }
    }
  })();
  return fontsReady;
}

/**
 * Installs the skin: fonts, the UI pixel and the textures, re-sized with the window. `accent` is
 * the level's theme light (0–1 channels).
 */
export function installSkin(accent: Rgb = [0.2, 0.7, 1.0]): void {
  void installFonts();
  const root = document.documentElement.style;
  const a = accent.map((c) => Math.round(c * 255)) as unknown as Rgb;
  root.setProperty('--accent', css(a));
  root.setProperty('--glow', css(a));
  root.setProperty('--accent-dim', css(a.map((c) => Math.round(c * 0.45)) as unknown as Rgb));
  root.setProperty('--plate', plate(IRON, INK));
  root.setProperty('--plate-lit', plate([IRON[1]!, IRON[2]!, IRON[3]!, IRON[4]!, a, [255, 255, 255]], INK));
  root.setProperty('--screen-light', screen(6, 0.55));
  root.setProperty('--screen-dark', screen(11, 0.8));
  root.setProperty('--stripes', stripes());
  const size = () => {
    const w = innerWidth;
    const h = innerHeight;
    // One UI pixel: whole screen pixels, a little finer than the scene's (240 rows).
    const u = Math.max(1, Math.min(Math.round(h / 360), Math.floor(w / 480)) || 1);
    // The logo's pixel scale: "PROC·FPS" in the heavy face is about 52 glyph pixels wide.
    const lk = Math.max(2, Math.min(6, Math.floor((0.8 * w) / (52 * u)), Math.floor((0.18 * h) / (7 * u))));
    root.setProperty('--u', `${u}px`);
    root.setProperty('--lk', String(lk));
    root.setProperty('--fire', fireRamp(8 * lk));
  };
  addEventListener('resize', size);
  size();
}
