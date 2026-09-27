/**
 * The view model: a futuristic energy scattergun, pixel art drawn procedurally into a small
 * canvas and shown large and pixelated. It is held to the right and seen from above and behind,
 * so the top and side of the shroud recede towards the crosshair (never a view into the muzzle).
 * Coils and an energy cell glow in the level theme's light colour; each shot flares them white-hot,
 * then a charge sweeps back up the coils through the cooldown. The energy cell on its side shows
 * the rounds left in the magazine; a reload dips the gun, tilts it and refills the cell. It kicks,
 * steps aside to the right while the chainsword (chainsword.ts) works, and bobs with the player's
 * steps. Render-only: the sim never sees it.
 */
const W = 160;
const H = 110;
/** Seconds for the coils to recharge after a shot (the sim's 36-tick cooldown). */
const RECHARGE = 0.6;

type Pt = readonly [number, number];
type Rgb = readonly [number, number, number];

// The shroud as a tapered box: centre line from near (bottom right, off-canvas) to the tip.
const NEAR: Pt = [122, 124];
const TIP: Pt = [46, 22];
const NEAR_W = 74;
const TIP_W = 16;
const NEAR_H = 30;
const TIP_H = 7;

export class Weapon {
  private readonly ctx: CanvasRenderingContext2D;
  private kick = 0;
  /** 0–1: how far the gun has moved aside for the chainsword. */
  private aside = 0;
  private asideUntil = -10;
  private shotAt = -10;
  private reloadAt = -10;
  private reloadSeconds = 1;
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

  /** The chainsword attacks until `now + seconds`: the gun moves aside meanwhile. */
  makeRoom(now: number, seconds: number): void {
    this.asideUntil = now + seconds;
  }

  /** A reload lasting `seconds` starts now. */
  reload(now: number, seconds: number): void {
    this.reloadAt = now;
    this.reloadSeconds = seconds;
  }

  /**
   * Per frame: `bob` is the step's progress (0–1, 0 when standing); `mag` the magazine's fill
   * (rounds left / size).
   */
  update(now: number, dt: number, bob: number, mag = 1): void {
    this.kick *= Math.exp(-dt * 11);
    this.aside += ((now < this.asideUntil ? 1 : 0) - this.aside) * Math.min(1, dt * 12);
    const since = now - this.shotAt;
    const flash = since < 0.06;
    // 0 just after a shot, 1 when fully charged; quantised so the canvas redraws only on change.
    const charge = Math.round(Math.min(1, Math.max(0, since / RECHARGE)) * 12) / 12;
    const heat = Math.round(Math.max(0, 1 - since / 0.25) * 8) / 8;
    const pulse = Math.round((0.5 + 0.5 * Math.sin(now * 5)) * 4) / 4;
    // Reloading: 0 → 1 through the reload; the cell refills with it and the coils stay dark.
    const r = (now - this.reloadAt) / this.reloadSeconds;
    const reloading = r >= 0 && r < 1;
    const cell = reloading ? Math.round(Math.max(0, (r - 0.35) / 0.55) * 16) / 16 : Math.round(mag * 16) / 16;
    const coils = reloading ? 0 : charge;
    const key = `${coils}|${heat}|${flash}|${pulse}|${cell}`;
    if (key !== this.drawnKey) {
      this.draw(coils, heat, flash, pulse, Math.min(1, cell));
      this.drawnKey = key;
    }
    const sway = Math.sin(bob * Math.PI);
    // The reload dips the gun down and rolls it inward, then brings it back up.
    const dip = reloading ? Math.sin(Math.PI * Math.min(1, r * 1.15)) : 0;
    const x = -25 + this.aside * 12 + sway * 2 - dip * 6;
    const y = this.kick * 14 + this.aside * 18 + sway * 3 + dip * 22;
    this.canvas.style.transform = `translate(${x}%, ${y}%) rotate(${-this.kick * 5 + this.aside * 8 - dip * 16}deg)`;
  }

  private draw(charge: number, heat: number, flash: boolean, pulse: number, cellFill: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const rgb = (k: Rgb, a = 1) => `rgb(${k.map((v) => Math.round(Math.min(1, v) * 255)).join(' ')} / ${a})`;
    const mixc = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const poly = (color: string, pts: readonly Pt[]) => {
      c.fillStyle = color;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    };
    // Points on the shroud at t (0 = near, 1 = tip): its two top edges (side ±1, across the axis),
    // and `drop` of its thickness straight down the screen for the visible side face.
    const len = Math.hypot(TIP[0] - NEAR[0], TIP[1] - NEAR[1]);
    const px = -(TIP[1] - NEAR[1]) / len;
    const py = (TIP[0] - NEAR[0]) / len;
    const at = (t: number, side: -1 | 1, drop = 0): Pt => {
      const cx = NEAR[0] + (TIP[0] - NEAR[0]) * t;
      const cy = NEAR[1] + (TIP[1] - NEAR[1]) * t;
      const w = (NEAR_W + (TIP_W - NEAR_W) * t) / 2;
      const h = NEAR_H + (TIP_H - NEAR_H) * t;
      return [cx + side * w * px, cy + side * w * py + drop * h];
    };
    const LOW = -1 as const; // the lower top edge on screen: the side face hangs from it
    const band = (t0: number, t1: number, color: string, faces: 'top' | 'side' | 'both' = 'both') => {
      if (faces !== 'side') poly(color, [at(t0, -1), at(t0, 1), at(t1, 1), at(t1, -1)]);
      if (faces !== 'top') poly(color, [at(t0, LOW), at(t0, LOW, 1), at(t1, LOW, 1), at(t1, LOW)]);
    };

    const glowNow = mixc(this.glow, [1, 1, 1], heat * 0.85);
    if (flash) {
      // Muzzle flare beyond the tip: a ragged burst in the glow colour, white at the core.
      const [tx, ty] = at(1.06, -1);
      const pts: Pt[] = [];
      for (let i = 0; i < 18; i++) {
        const r = i % 2 ? 8 : 20 + (i % 3) * 5;
        const a = (i / 18) * Math.PI * 2;
        pts.push([tx + 4 + Math.cos(a) * r, ty - 2 + Math.sin(a) * r * 0.75]);
      }
      poly(rgb(mixc(this.glow, [1, 0.9, 0.6], 0.4)), pts);
      poly(rgb([1, 1, 0.9]), pts.map(([x, y]) => [tx + 4 + (x - tx - 4) * 0.5, ty - 2 + (y - ty + 2) * 0.5]));
    }

    // Side face (darker), then the top face (lit plating).
    poly('#16181d', [at(0, LOW), at(0, LOW, 1), at(1, LOW, 1), at(1, LOW)]);
    poly('#3a3f4a', [at(0, -1), at(0, 1), at(1, 1), at(1, -1)]);
    // A raised spine along the top and panel seams across it.
    const spine = (t: number, s: number): Pt => {
      const [lx, ly] = at(t, -1);
      const [rx, ry] = at(t, 1);
      return [lx + (rx - lx) * s, ly + (ry - ly) * s];
    };
    poly('#525a68', [spine(0, 0.38), spine(0, 0.62), spine(1, 0.6), spine(1, 0.4)]);
    poly('#6b7585', [spine(0, 0.38), spine(0, 0.44), spine(1, 0.43), spine(1, 0.4)]);
    for (const t of [0.12, 0.3, 0.5, 0.68, 0.86]) band(t, t + 0.012, '#23262d', 'top');
    // Vent slats near the grip.
    for (let i = 0; i < 5; i++) {
      const t = 0.14 + i * 0.03;
      poly('#101216', [spine(t, 0.1), spine(t, 0.3), spine(t + 0.015, 0.3), spine(t + 0.015, 0.1)]);
      poly('#101216', [spine(t, 0.7), spine(t, 0.9), spine(t + 0.015, 0.9), spine(t + 0.015, 0.7)]);
    }
    // Coils: three glowing rings. After a shot they flare, then the charge sweeps from the grip
    // up to the tip as they refill.
    [0.46, 0.6, 0.74].forEach((t, i) => {
      const lit = charge >= (i + 1) / 3 ? 1 : 0.18;
      const bright = Math.max(heat, lit * (0.75 + 0.25 * pulse));
      band(t, t + 0.035, rgb(mixc([0.06, 0.07, 0.08], glowNow, bright)));
    });
    // Energy cell on the side: the magazine, full to empty.
    const cell0 = 0.18;
    const cell1 = 0.36;
    poly('#0b0c0f', [at(cell0, LOW, 0.25), at(cell0, LOW, 0.8), at(cell1, LOW, 0.8), at(cell1, LOW, 0.25)]);
    const fill = cell0 + (cell1 - cell0) * cellFill;
    poly(rgb(mixc([0.1, 0.1, 0.1], glowNow, 0.6 + 0.4 * pulse)), [at(cell0, LOW, 0.35), at(cell0, LOW, 0.7), at(fill, LOW, 0.7), at(fill, LOW, 0.35)]);
    // The emitter at the tip, seen from above: a glowing slot, not a bore.
    poly(rgb(mixc(this.glow, [1, 1, 1], heat)), [spine(0.97, 0.25), spine(0.97, 0.75), spine(1, 0.72), spine(1, 0.28)]);
    // The gloved hand on the grip.
    c.fillStyle = '#2e2620';
    c.beginPath();
    c.ellipse(112, 104, 24, 12, -0.55, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#3f342b';
    c.beginPath();
    c.ellipse(104, 100, 11, 5, -0.55, 0, Math.PI * 2);
    c.fill();
  }
}
