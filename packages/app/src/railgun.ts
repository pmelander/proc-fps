/**
 * The railgun view model: two long parallel rails over a heavy breech block, held to the right and
 * seen from above and behind like the other guns, drawn procedurally into a small canvas and shown
 * large and pixelated. Coil rings along the rails glow in the theme's light: dark right after a
 * shot, brightening as it recharges, so the gun shows when it is ready. A light per slug on the
 * block counts the magazine. A shot is a hard kick and a white-blue flash between the rails; a
 * reload dips it. Render-only: the sim never sees it.
 */
const W = 160;
const H = 110;
/** Seconds a muzzle flash shows. */
const FLASH = 0.07;

type Pt = readonly [number, number];
type Rgb = readonly [number, number, number];

// The gun's centre line, from near (bottom right, off-canvas) to the muzzle.
const NEAR: Pt = [124, 114];
const TIP: Pt = [60, 14];
const NEAR_W = 70;
const TIP_W = 22;
const NEAR_H = 30;
const TIP_H = 7;
/** Where along the gun (0–1) the breech block gives way to the rails. */
const BLOCK = 0.36;
/** Coil rings along the rails, as positions 0–1. */
const COILS = [0.44, 0.53, 0.62, 0.71, 0.8];

export class Railgun {
  private readonly ctx: CanvasRenderingContext2D;
  private kick = 0;
  private shotAt = -10;
  private reloadAt = -10;
  private reloadSeconds = 1;
  private aside = 0;
  private asideUntil = -10;
  private drawnKey = '';

  constructor(private readonly canvas: HTMLCanvasElement, private readonly glow: Rgb) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
  }

  fire(now: number): void {
    this.kick = 1;
    this.shotAt = now;
  }

  reload(now: number, seconds: number): void {
    this.reloadAt = now;
    this.reloadSeconds = seconds;
  }

  /** The chainsword attacks until `now + seconds`: the gun moves aside meanwhile. */
  makeRoom(now: number, seconds: number): void {
    this.asideUntil = now + seconds;
  }

  /**
   * Per frame: `bob` the step's progress (0–1), `slugs` and `size` the magazine, `charge` how far
   * it has recharged since the last shot (0–1), `lower` how far it has dropped for a switch.
   */
  update(now: number, dt: number, bob: number, slugs: number, size: number, charge: number, lower: number): void {
    this.canvas.style.visibility = lower >= 0.999 ? 'hidden' : 'visible';
    this.kick *= Math.exp(-dt * 14);
    this.aside += ((now < this.asideUntil ? 1 : 0) - this.aside) * Math.min(1, dt * 12);
    const r = (now - this.reloadAt) / this.reloadSeconds;
    const reloading = r >= 0 && r < 1;
    const lit = reloading ? 0 : Math.round(Math.max(0, Math.min(1, charge)) * 8) / 8;
    const flash = now - this.shotAt < FLASH;
    const key = `${slugs}|${size}|${lit}|${flash}`;
    if (key !== this.drawnKey) {
      this.draw(slugs, size, lit, flash);
      this.drawnKey = key;
    }
    const sway = Math.sin(bob * Math.PI);
    const dip = reloading ? Math.sin(Math.PI * Math.min(1, r * 1.1)) : 0;
    const x = -22 + this.aside * 12 + sway * 2 - dip * 4 + this.kick * 3;
    const y = this.kick * 16 + this.aside * 18 + sway * 3 + dip * 28 + lower * 90;
    this.canvas.style.transform = `translate(${x}%, ${y}%) rotate(${-this.kick * 5 + this.aside * 8 - dip * 12}deg)`;
  }

  private draw(slugs: number, size: number, lit: number, flash: boolean): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const rgb = (k: Rgb, a = 1) => `rgb(${k.map((v) => Math.round(Math.min(1, v) * 255)).join(' ')} / ${a})`;
    const poly = (color: string, pts: readonly Pt[]) => {
      c.fillStyle = color;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    };
    const len = Math.hypot(TIP[0] - NEAR[0], TIP[1] - NEAR[1]);
    const px = -(TIP[1] - NEAR[1]) / len;
    const py = (TIP[0] - NEAR[0]) / len;
    const at = (t: number, across: number, drop = 0): Pt => {
      const cx = NEAR[0] + (TIP[0] - NEAR[0]) * t;
      const cy = NEAR[1] + (TIP[1] - NEAR[1]) * t;
      const w = (NEAR_W + (TIP_W - NEAR_W) * t) / 2;
      const h = NEAR_H + (TIP_H - NEAR_H) * t;
      return [cx + across * w * px, cy + across * w * py + drop * h];
    };
    const band = (t0: number, t1: number, a0: number, a1: number, color: string, side = false) => {
      poly(color, [at(t0, a0), at(t0, a1), at(t1, a1), at(t1, a0)]);
      if (side) poly('#0e0f12', [at(t0, a0), at(t0, a0, 1), at(t1, a0, 1), at(t1, a0)]);
    };

    // Between the rails: a dark channel, alight when it fires.
    band(BLOCK, 1.0, -0.3, 0.3, flash ? 'rgb(220 245 255)' : '#07080a');
    // The two rails: steel bars, lit along their top edge, ending in a blunt tip.
    for (const [a0, a1] of [[-1, -0.3], [0.3, 1]] as const) {
      band(BLOCK - 0.02, 1.0, a0, a1, '#4d535d', true);
      band(BLOCK - 0.02, 1.0, a0 + (a1 - a0) * 0.3, a0 + (a1 - a0) * 0.55, '#8a929e');
      band(0.97, 1.0, a0 - 0.05, a1 + 0.05, '#23252a', true);
    }
    // Coil rings round the rails, glowing as it recharges.
    const coil = lit > 0 ? rgb(this.glow.map((v) => v * (0.35 + 0.65 * lit)) as unknown as Rgb) : '#2a2d33';
    for (const t of COILS) {
      band(t, t + 0.035, -1.12, -0.18, coil, true);
      band(t, t + 0.035, 0.18, 1.12, coil, true);
    }
    // The breech block: heavy, dark, with a brass band and the capacitor housing on top.
    poly('#121317', [at(0, -1), at(0, -1, 1), at(BLOCK, -1, 1), at(BLOCK, -1)]);
    band(0, BLOCK, -1, 1, '#2c2f36');
    band(0.03, BLOCK - 0.03, -0.84, 0.84, '#363a42');
    band(BLOCK - 0.05, BLOCK - 0.03, -1, 1, '#c9a24a');
    band(0.08, 0.26, -0.4, 0.4, '#1d1f24');
    band(0.1, 0.24, -0.3, 0.3, lit >= 1 ? rgb(this.glow, 0.9) : '#26292f');
    // A light per slug in the magazine, down the block's side.
    const n = Math.max(1, size);
    for (let i = 0; i < n; i++) {
      const t0 = 0.05 + (0.26 * i) / n;
      const t1 = t0 + (0.26 / n) * 0.6;
      poly(i < slugs ? rgb(this.glow) : '#0a0a0c', [at(t0, -1, 0.35), at(t0, -1, 0.65), at(t1, -1, 0.65), at(t1, -1, 0.35)]);
    }
    // The flash: a white-blue burst at the muzzle, a streak on out.
    if (flash) {
      const [tx, ty] = at(1.05, 0);
      const pts: Pt[] = [];
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 4 : 10 + (i % 4) * 3;
        const a = (i / 16) * Math.PI * 2;
        pts.push([tx + Math.cos(a) * r, ty + Math.sin(a) * r * 0.7]);
      }
      poly('rgb(120 200 255)', pts);
      poly('rgb(240 250 255)', pts.map(([x, y]) => [tx + (x - tx) * 0.45, ty + (y - ty) * 0.45]));
    }
    // The gloved hand on the grip.
    c.fillStyle = '#2e2620';
    c.beginPath();
    c.ellipse(118, 106, 26, 12, -0.6, 0, Math.PI * 2);
    c.fill();
  }
}
