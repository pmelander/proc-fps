/**
 * Blood on the screen: a kill up close (a point-blank blast, a chainsword bite) splatters the
 * view. Drops land as blobs with a few flecks, run slowly down, and fade out. Drawn at low
 * resolution into a full-screen canvas and scaled up pixelated like everything else.
 * Render-only: the sim never sees it.
 */
const ROWS = 180;
const LIFE = 2.8;

interface Drop {
  x: number;
  y: number;
  /** Where it landed, so its run leaves a streak. */
  y0: number;
  r: number;
  speed: number;
  age: number;
}

export class ScreenBlood {
  private readonly ctx: CanvasRenderingContext2D;
  private drops: Drop[] = [];
  private seed = 7;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** Splatters `amount` (0–1) of blood, heavier towards the side the kill was on (-1 left … 1 right). */
  splatter(amount: number, side = 0): void {
    const w = this.canvas.width || 320;
    const count = Math.round(4 + amount * 22);
    for (let i = 0; i < count; i++) {
      const cx = w * (0.5 + side * 0.25) + (this.rand() - 0.5) * w * 0.9;
      const y = ROWS * (0.1 + this.rand() * 0.7);
      const r = 1 + this.rand() * (2 + amount * 7);
      this.drops.push({ x: cx, y, y0: y, r, speed: 3 + this.rand() * 14 * (r / 6), age: 0 });
    }
    if (this.drops.length > 160) this.drops.splice(0, this.drops.length - 160);
  }

  update(dt: number): void {
    const h = ROWS;
    // Until it is laid out (clientWidth 0), assume a 16:9 view.
    const w = this.canvas.clientWidth > 0 ? Math.round((ROWS * this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight)) : 320;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const c = this.ctx;
    c.clearRect(0, 0, w, h);
    this.drops = this.drops.filter((d) => (d.age += dt) < LIFE);
    for (const d of this.drops) {
      d.y += d.speed * dt;
      const fade = 1 - d.age / LIFE;
      // The streak it has run, then the drop itself with a darker rim.
      c.fillStyle = `rgb(110 0 0 / ${0.55 * fade})`;
      c.fillRect(Math.round(d.x - d.r * 0.3), Math.round(d.y0), Math.max(1, Math.round(d.r * 0.6)), Math.round(d.y - d.y0));
      c.fillStyle = `rgb(90 0 0 / ${0.8 * fade})`;
      c.beginPath();
      c.arc(d.x, d.y, d.r + 1, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = `rgb(160 8 4 / ${0.85 * fade})`;
      c.beginPath();
      c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      c.fill();
    }
  }
}
