/**
 * The grenade launcher view model: a stubby, brass-banded tube in the left hand, drawn only while
 * it fires. It swings up from below, kicks as the grenade leaves with a puff of smoke at the
 * muzzle, and drops away again (like the chainsword, whose place it shares). Render-only.
 */
const W = 150;
const H = 120;
/** Seconds it shows for a throw. */
export const LAUNCH_SECONDS = 0.6;

type Pt = readonly [number, number];

// The tube's axis, from the grip in the fist (bottom left) to the muzzle.
const A: Pt = [26, 126];
const B: Pt = [112, 50];

export class Launcher {
  private readonly ctx: CanvasRenderingContext2D;
  private firedAt = -10;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    canvas.style.visibility = 'hidden';
    this.draw(false);
  }

  fire(now: number): void {
    this.firedAt = now;
  }

  update(now: number): void {
    const t = (now - this.firedAt) / LAUNCH_SECONDS;
    const showing = t >= 0 && t < 1;
    this.canvas.style.visibility = showing ? 'visible' : 'hidden';
    if (!showing) return;
    // Up for the first fifth, the kick right after, then down.
    const up = t < 0.2 ? t / 0.2 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    const ease = up * up * (3 - 2 * up);
    const kick = t >= 0.2 && t < 0.45 ? Math.sin(((t - 0.2) / 0.25) * Math.PI) : 0;
    const x = 4 - kick * 4;
    const y = (1 - ease) * 90 + kick * 6;
    this.canvas.style.transform = `translate(${x}%, ${y}%) rotate(${(1 - ease) * 14 - kick * 9}deg)`;
    const smoke = t >= 0.2 && t < 0.5;
    this.draw(smoke);
  }

  private draw(smoke: boolean): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const ux = (B[0] - A[0]) / len;
    const uy = (B[1] - A[1]) / len;
    const at = (s: number, side: number, drop = 0): Pt => [A[0] + ux * len * s + uy * side, A[1] + uy * len * s - ux * side + drop];
    const band = (s0: number, s1: number, w0: number, w1: number, color: string, drop = 0) => {
      c.fillStyle = color;
      c.beginPath();
      for (const [i, p] of [at(s0, -w0, drop), at(s0, w0, drop), at(s1, w1, drop), at(s1, -w1, drop)].entries()) (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
      c.closePath();
      c.fill();
    };
    // The tube: a fat barrel with a darker underside, brass bands, a flared muzzle.
    band(0.1, 0.95, 17, 15, '#1b1c20', 6);
    band(0.1, 0.95, 17, 15, '#3a3d44');
    band(0.1, 0.95, 6, 5, '#555a63');
    for (const s of [0.3, 0.55, 0.8]) band(s, s + 0.04, 18, 18, '#c9a24a');
    band(0.92, 1.0, 20, 21, '#2a2c31');
    const [mx, my] = at(1.0, 0);
    c.fillStyle = '#0b0b0d';
    c.beginPath();
    c.ellipse(mx, my, 9, 6, Math.atan2(uy, ux), 0, Math.PI * 2);
    c.fill();
    // A red status light on top.
    const [lx, ly] = at(0.45, 12);
    c.fillStyle = '#ff3a20';
    c.fillRect(Math.round(lx) - 2, Math.round(ly) - 2, 4, 4);
    // Smoke at the muzzle as it fires.
    if (smoke) {
      for (let i = 0; i < 6; i++) {
        c.fillStyle = `rgb(200 195 185 / ${0.5 - i * 0.06})`;
        c.beginPath();
        c.arc(mx + ux * (8 + i * 7) + (i % 2 ? 4 : -4), my + uy * (8 + i * 7) - i * 2, 6 + i * 2, 0, Math.PI * 2);
        c.fill();
      }
    }
    // The gauntlet on the grip.
    c.fillStyle = '#2b2e36';
    c.beginPath();
    c.ellipse(A[0] + 16, A[1] - 14, 22, 14, -0.7, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#c9a24a';
    c.fillRect(A[0] + 4, A[1] - 24, 16, 3);
  }
}
