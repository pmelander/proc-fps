/**
 * The chainsword view model: held in the left hand and drawn only while it attacks. Pixel art
 * drawn procedurally into a small canvas and shown large and pixelated, like the scattergun. An
 * attack is a low uppercut in step with the sim's MELEE_TICKS: the blade rises from below the
 * screen, keeps lifting and shaking while it grinds with the chain running, then drops away.
 * Sparks spray off the teeth while it grinds and blood with every bite (the canvas has room above
 * and to the right of the blade for them). Render-only: the sim never sees it.
 */
const W = 190;
const H = 150;

type Pt = readonly [number, number];

// The weapon's axis, from the housing in the fist (near, bottom left) to the blade's tip.
const A: Pt = [22, 154];
const B: Pt = [124, 54];
/** Where along the axis (0–1) the housing gives way to the blade. */
const HOUSING = 0.3;
/** Particles a second while grinding, and per bite. */
const SPARK_RATE = 90;
const BLOOD_PER_BITE = 26;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  blood: boolean;
}

export class Chainsword {
  private readonly ctx: CanvasRenderingContext2D;
  private startAt = -10;
  private seconds = 1;
  /** Fractions of the attack: the blade is up and grinding between them. */
  private grindFrom = 0.17;
  private grindTo = 0.6;
  private particles: Particle[] = [];
  private sparkDebt = 0;
  private last = 0;

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

  /** The teeth bit into something: a spray of blood off the blade. */
  bite(): void {
    for (let i = 0; i < BLOOD_PER_BITE; i++) this.emit(true);
  }

  /** 0–1 through the current attack, or -1 when there is none. */
  progress(now: number): number {
    const t = (now - this.startAt) / this.seconds;
    return t >= 0 && t < 1 ? t : -1;
  }

  update(now: number): void {
    const dt = Math.min(0.05, Math.max(0, now - this.last));
    this.last = now;
    const t = this.progress(now);
    const grinding = t >= this.grindFrom && t < this.grindTo;
    if (grinding) {
      this.sparkDebt += SPARK_RATE * dt;
      for (; this.sparkDebt >= 1; this.sparkDebt--) this.emit(false);
    }
    this.step(dt);
    const showing = t >= 0 || this.particles.length > 0;
    this.canvas.style.visibility = showing ? 'visible' : 'hidden';
    if (!showing) return;

    // A low uppercut: up from below the screen, still rising through the grind, then down.
    const rise = t < 0 ? 0 : t < this.grindFrom ? t / this.grindFrom : t < this.grindTo ? 1 : 1 - (t - this.grindTo) / (1 - this.grindTo);
    const ease = rise * rise * (3 - 2 * rise);
    const lift = grinding ? (t - this.grindFrom) / (this.grindTo - this.grindFrom) : t >= this.grindTo ? 1 : 0;
    const shake = grinding ? Math.sin(now * 90) * 1.2 : 0;
    const x = 4 + shake;
    const y = (1 - ease) * 95 - lift * ease * 6 + shake * 0.6;
    const tilt = (1 - ease) * 16 - ease * lift * 7 + shake * 0.8;
    this.canvas.style.transform = `translate(${x}%, ${y}%) rotate(${tilt}deg)`;
    this.draw(t < 0 ? 0 : (now - this.startAt) * (grinding ? 60 : 18), grinding, t >= 0);
  }

  /** A particle off the upper teeth near the tip: sparks fly up and out, blood sprays wider. */
  private emit(blood: boolean): void {
    const s = 0.72 + Math.random() * 0.24;
    const [x, y] = this.point(s, 12);
    const a = -Math.PI / 2 + (Math.random() - 0.3) * (blood ? 1.8 : 1.1);
    const speed = (blood ? 60 : 110) + Math.random() * (blood ? 110 : 140);
    this.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: blood ? 0.5 + Math.random() * 0.4 : 0.15 + Math.random() * 0.25, blood });
  }

  private step(dt: number): void {
    for (const p of this.particles) {
      p.vy += (p.blood ? 520 : 260) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.x > -4 && p.x < W + 4 && p.y < H + 4);
  }

  /** A point on the weapon: \`s\` along the axis (0–1), \`side\` across it towards the upper edge. */
  private point(s: number, side: number): Pt {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const ux = (B[0] - A[0]) / len;
    const uy = (B[1] - A[1]) / len;
    return [A[0] + ux * len * s + uy * side, A[1] + uy * len * s - ux * side];
  }

  private draw(chain: number, grinding: boolean, weapon: boolean): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const at = (s: number, side: number, drop = 0): Pt => {
      const [x, y] = this.point(s, side);
      return [x, y + drop];
    };
    const poly = (color: string, pts: readonly Pt[]) => {
      c.fillStyle = color;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    };
    const band = (s0: number, s1: number, w0: number, w1: number, color: string, drop = 0) =>
      poly(color, [at(s0, -w0, drop), at(s0, w0, drop), at(s1, w1, drop), at(s1, -w1, drop)]);

    if (weapon) {
      // Blade: a flat steel bar with a darker groove, rounded at the tip, its side face below.
      band(HOUSING - 0.02, 0.97, 10, 7, '#2a2c31', 5);
      band(HOUSING - 0.02, 0.97, 10, 7, '#7c8390');
      band(HOUSING, 0.95, 3, 2, '#50565f');
      const [tx, ty] = at(0.97, 0);
      c.fillStyle = '#7c8390';
      c.beginPath();
      c.arc(tx, ty, 7, 0, Math.PI * 2);
      c.fill();

      // The chain: teeth running along both edges of the blade.
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

    // Sparks: short white-hot streaks along their flight. Blood: dark red drops.
    for (const p of this.particles) {
      if (p.blood) {
        c.fillStyle = p.life > 0.3 ? '#9a0e08' : '#5e0604';
        c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
      } else {
        c.strokeStyle = p.life > 0.12 ? '#fff6c0' : '#ffb040';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
        c.stroke();
      }
    }
  }
}
