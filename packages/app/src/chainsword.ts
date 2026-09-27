/**
 * The chainsword view model: held in the left hand and drawn only while it attacks. Pixel art
 * drawn procedurally into a small canvas and shown large and pixelated, like the scattergun. An
 * attack swings it up from below, grinds it forward with the chain running and the blade shaking,
 * then lowers it again, in step with the sim's MELEE_TICKS. Render-only: the sim never sees it.
 */
const W = 150;
const H = 120;

type Pt = readonly [number, number];

// The weapon's axis, from the housing in the fist (near, bottom left) to the blade's tip.
const A: Pt = [22, 124];
const B: Pt = [124, 24];
/** Where along the axis (0–1) the housing gives way to the blade. */
const HOUSING = 0.3;

export class Chainsword {
  private readonly ctx: CanvasRenderingContext2D;
  private startAt = -10;
  private seconds = 1;
  /** Fractions of the attack: the blade is up and grinding between them. */
  private grindFrom = 0.17;
  private grindTo = 0.6;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    canvas.style.visibility = 'hidden';
  }

  /** An attack of `seconds` starts now; the blade grinds from `grindFrom` to `grindTo` of it. */
  attack(now: number, seconds: number, grindFrom: number, grindTo: number): void {
    this.startAt = now;
    this.seconds = seconds;
    this.grindFrom = grindFrom;
    this.grindTo = grindTo;
  }

  /** 0–1 through the current attack, or -1 when there is none. */
  progress(now: number): number {
    const t = (now - this.startAt) / this.seconds;
    return t >= 0 && t < 1 ? t : -1;
  }

  update(now: number): void {
    const t = this.progress(now);
    this.canvas.style.visibility = t < 0 ? 'hidden' : 'visible';
    if (t < 0) return;
    const grinding = t >= this.grindFrom && t < this.grindTo;
    // Up from below while drawing, forward and shaking while grinding, down again after.
    const up = t < this.grindFrom ? t / this.grindFrom : t < this.grindTo ? 1 : 1 - (t - this.grindTo) / (1 - this.grindTo);
    const ease = up * up * (3 - 2 * up);
    const shake = grinding ? Math.sin(now * 90) * 1.2 : 0;
    const x = (1 - ease) * -18 + (grinding ? 6 : 0) + shake;
    const y = (1 - ease) * 70 + shake * 0.6;
    this.canvas.style.transform = `translate(${x}%, ${y}%) rotate(${(1 - ease) * -28 + shake * 0.8}deg)`;
    this.draw((now - this.startAt) * (grinding ? 60 : 18), grinding);
  }

  private draw(chain: number, grinding: boolean): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const ux = (B[0] - A[0]) / len;
    const uy = (B[1] - A[1]) / len;
    // Across the axis, towards the upper edge on screen.
    const nx = uy;
    const ny = -ux;
    const at = (s: number, side: number, drop = 0): Pt => [A[0] + ux * len * s + nx * side, A[1] + uy * len * s + ny * side + drop];
    const poly = (color: string, pts: readonly Pt[]) => {
      c.fillStyle = color;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    };
    const band = (s0: number, s1: number, w0: number, w1: number, color: string, drop = 0) =>
      poly(color, [at(s0, -w0, drop), at(s0, w0, drop), at(s1, w1, drop), at(s1, -w1, drop)]);

    // Blade: a flat steel bar with a darker groove, rounded at the tip, its side face below.
    band(HOUSING - 0.02, 0.97, 10, 7, '#2a2c31', 5);
    band(HOUSING - 0.02, 0.97, 10, 7, '#7c8390');
    band(HOUSING, 0.95, 3, 2, '#50565f');
    const [tx, ty] = at(0.97, 0);
    c.fillStyle = '#7c8390';
    c.beginPath();
    c.arc(tx, ty, 7, 0, Math.PI * 2);
    c.fill();

    // The chain: teeth running along both edges of the blade and round the tip.
    const pitch = 7;
    const bladeLen = len * (0.97 - HOUSING);
    for (let d = -(chain % pitch); d < bladeLen; d += pitch) {
      const s = HOUSING + d / len;
      if (s < HOUSING) continue;
      for (const side of [-1, 1]) {
        const w = 10 + (7 - 10) * ((s - HOUSING) / (0.97 - HOUSING));
        const base0 = at(s, side * w);
        const base1 = at(s + 3 / len, side * w);
        const tip = at(s + (grinding ? 1 : 2.5) / len, side * (w + 4.5));
        poly(grinding ? '#d8d2c4' : '#9aa0aa', [base0, base1, tip]);
        poly('#3a3d44', [base0, at(s + 1 / len, side * w), at(s + 1 / len, side * (w + 2))]);
      }
    }

    // Housing: an armoured engine block with red and gold trim and exhaust vents.
    band(0, HOUSING, 24, 19, '#141519', 9);
    band(0, HOUSING, 24, 19, '#3b3438');
    band(0.02, HOUSING - 0.02, 20, 16, '#6e1812');
    band(0.04, HOUSING - 0.04, 20, 16, '#8a2217');
    band(0.12, 0.14, 21, 20, '#c9a24a');
    band(0.22, 0.235, 19, 18, '#c9a24a');
    for (let i = 0; i < 4; i++) band(0.05 + i * 0.035, 0.065 + i * 0.035, -6, -14, '#0c0c0e');
    // The gauntlet gripping it.
    c.fillStyle = '#2b2e36';
    c.beginPath();
    c.ellipse(A[0] + 14, A[1] - 12, 22, 14, -0.8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#c9a24a';
    c.fillRect(A[0] + 2, A[1] - 22, 16, 3);
  }
}
