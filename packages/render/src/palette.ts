/**
 * The fixed palette every frame is quantized to. A shared palette is what makes
 * procedural textures, sprites and lighting read as one coherent art style.
 * 8 ramps × 8 steps = 64 colours. Themes will supply their own palettes later.
 */
const RAMPS: readonly { name: string; dark: [number, number, number]; light: [number, number, number] }[] = [
  { name: 'gray', dark: [10, 10, 12], light: [228, 228, 222] },
  { name: 'brown', dark: [22, 14, 8], light: [206, 168, 120] },
  { name: 'olive', dark: [14, 18, 8], light: [170, 180, 110] },
  { name: 'blood', dark: [24, 4, 4], light: [236, 96, 80] },
  { name: 'steel', dark: [8, 12, 22], light: [150, 180, 220] },
  { name: 'rust', dark: [26, 10, 2], light: [252, 176, 72] },
  { name: 'toxic', dark: [4, 20, 6], light: [150, 250, 90] },
  { name: 'bone', dark: [30, 24, 18], light: [250, 238, 206] },
];

export const PALETTE_SIZE = RAMPS.length * 8;

/** RGBA8 data for a PALETTE_SIZE × 1 texture. */
export function paletteRGBA(): Uint8Array {
  const out = new Uint8Array(PALETTE_SIZE * 4);
  RAMPS.forEach((r, ri) => {
    for (let s = 0; s < 8; s++) {
      // Slight gamma so dark steps are closer together (more shadow detail).
      const t = Math.pow(s / 7, 1.4);
      const i = (ri * 8 + s) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(r.dark[c]! + (r.light[c]! - r.dark[c]!) * t);
      out[i + 3] = 255;
    }
  });
  return out;
}
