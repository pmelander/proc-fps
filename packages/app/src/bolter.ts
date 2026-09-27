/**
 * The heavy bolter view model: a boxy, brass-trimmed gun with twin barrels, held to the right and
 * seen from above and behind like the scattergun (weapon.ts), drawn procedurally into a small
 * canvas and shown large and pixelated. A glowing strip down its side drains with the rounds in
 * the drum; the barrels fire in turn, each shot a hard jolt and a flash at that muzzle. A reload
 * dips it while the strip refills. Render-only: the sim never sees it.
 */
const W = 160;
const H = 110;
/** Seconds a muzzle flash shows. */
const FLASH = 0.05;

type Pt = readonly [number, number];
type Rgb = readonly [number, number, number];

// The gun as a tapered box: centre line from near (bottom right, off-canvas) to the muzzles.
const NEAR: Pt = [120, 112];
const TIP: Pt = [54, 22];
const NEAR_W = 84;
const TIP_W = 26;
const NEAR_H = 34;
const TIP_H = 9;
/** Where along the gun (0–1) the body gives way to the barrels. */
const BODY = 0.5;

export class Bolter {
  private readonly ctx: CanvasRenderingContext2D;
  private kick = 0;
  private shotAt = -10;
  private barrel = 0;
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

  /** A shot now, from barrel 0 (left) or 1 (right). */
  fire(now: number, barrel: number): void {
    this.kick = 1;
    this.shotAt = now;
    this.barrel = barrel;
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
   * Per frame: `bob` is the step's progress (0–1), `mag` the drum's fill (rounds / size), `lower`
   * how far it has dropped out of view for a weapon switch (0 up … 1 gone).
   */
  update(now: number, dt: number, bob: number, mag: number, lower: number): void {
    this.canvas.style.visibility = lower >= 0.999 ? 'hidden' : 'visible';
    this.kick *= Math.exp(-dt * 26);
    this.aside += ((now < this.asideUntil ? 1 : 0) - this.aside) * Math.min(1, dt * 12);
    const r = (now - this.reloadAt) / this.reloadSeconds;
    const reloading = r >= 0 && r < 1;
    const fill = reloading ? Math.round(Math.max(0, (r - 0.4) / 0.5) * 30) / 30 : Math.round(mag * 30) / 30;
    const flash = now - this.shotAt < FLASH;
    const key = `${Math.min(1, fill)}|${flash}|${this.barrel}`;
    if (key !== this.drawnKey) {
      this.draw(Math.min(1, fill), flash);
      this.drawnKey = key;
    }
    const sway = Math.sin(bob * Math.PI);
    const dip = reloading ? Math.sin(Math.PI * Math.min(1, r * 1.1)) : 0;
    const jitter = this.kick * (this.barrel ? 1 : -1);
    const x = -25 + this.aside * 12 + sway * 2 - dip * 5 + jitter * 1.2;
    const y = this.kick * 7 + this.aside * 18 + sway * 3 + dip * 26 + lower * 90;
    this.canvas.style.transform = `translate(${x}%, ${y}%) rotate(${-this.kick * 2.5 + this.aside * 8 - dip * 12}deg)`;
  }

  private draw(fill: number, flash: boolean): void {
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
    // Points on the gun at t (0 near … 1 muzzle): `across` from -1 to 1 over its width, `drop` of its
    // thickness straight down the screen for the visible side face.
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
      if (side) poly('#101115', [at(t0, a0), at(t0, a0, 1), at(t1, a0, 1), at(t1, a0)]);
    };

    // Twin barrels, each a steel tube with a darker underside, ending in a boxy muzzle brake.
    for (const [a0, a1] of [[-0.95, -0.15], [0.15, 0.95]] as const) {
      band(BODY - 0.02, 0.93, a0, a1, '#565c66', true);
      band(BODY - 0.02, 0.93, a0 + (a1 - a0) * 0.35, a0 + (a1 - a0) * 0.6, '#7a818c');
      band(0.9, 1.0, a0 - 0.08, a1 + 0.08, '#2a2c31', true);
      band(0.93, 0.97, a0, a1, '#0b0b0d');
    }
    // The body: a heavy block, dark gunmetal with red and brass trim.
    poly('#15161a', [at(0, -1), at(0, -1, 1), at(BODY, -1, 1), at(BODY, -1)]);
    band(0, BODY, -1, 1, '#2f3239');
    band(0.03, BODY - 0.03, -0.86, 0.86, '#383c44');
    band(0.1, 0.12, -1, 1, '#c9a24a');
    band(BODY - 0.05, BODY - 0.03, -1, 1, '#c9a24a');
    band(0.14, BODY - 0.07, -0.86, -0.62, '#7a1d14');
    band(0.14, BODY - 0.07, 0.62, 0.86, '#7a1d14');
    // The drum on top: a brass-banded box feeding the gun.
    band(0.2, 0.4, -0.45, 0.45, '#4a4436');
    band(0.22, 0.38, -0.38, 0.38, '#6b6048');
    for (const t of [0.25, 0.3, 0.35]) band(t, t + 0.012, -0.45, 0.45, '#c9a24a');
    // The side strip: the rounds left, glowing in the theme's light.
    const s0 = 0.08;
    const s1 = 0.48;
    poly('#08080a', [at(s0, -1, 0.3), at(s0, -1, 0.7), at(s1, -1, 0.7), at(s1, -1, 0.3)]);
    if (fill > 0) {
      const e = s0 + (s1 - s0) * fill;
      poly(rgb(this.glow), [at(s0, -1, 0.38), at(s0, -1, 0.62), at(e, -1, 0.62), at(e, -1, 0.38)]);
    }
    // Muzzle flash at the barrel that fired: a ragged white-hot burst.
    if (flash) {
      const [tx, ty] = at(1.04, this.barrel ? 0.55 : -0.55);
      const pts: Pt[] = [];
      for (let i = 0; i < 14; i++) {
        const r = i % 2 ? 5 : 12 + (i % 3) * 4;
        const a = (i / 14) * Math.PI * 2;
        pts.push([tx + Math.cos(a) * r, ty - 3 + Math.sin(a) * r * 0.75]);
      }
      poly('rgb(255 170 60)', pts);
      poly('rgb(255 245 210)', pts.map(([x, y]) => [tx + (x - tx) * 0.45, ty - 3 + (y - ty + 3) * 0.45]));
    }
    // The gloved hand on the grip.
    c.fillStyle = '#2e2620';
    c.beginPath();
    c.ellipse(116, 106, 26, 12, -0.55, 0, Math.PI * 2);
    c.fill();
  }
}
