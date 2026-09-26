/**
 * The shotgun view model: pixel art drawn procedurally into a small canvas and shown large and
 * pixelated at the bottom of the screen. It kicks on every shot, pumps between shots, swings for
 * melee strikes and bobs with the player's steps. Render-only: the sim never sees it.
 */
const W = 160;
const H = 110;
const PUMP_START = 0.2;
const PUMP_END = 0.5;

const STEEL = '#2c2f36';
const STEEL_LIGHT = '#59606c';
const STEEL_DARK = '#15171b';
const WOOD = '#5a3418';
const WOOD_LIGHT = '#8a5530';
const GLOVE = '#3a2a1e';

type Pt = readonly [number, number];

export class Weapon {
  private readonly ctx: CanvasRenderingContext2D;
  private kick = 0;
  private swing = 0;
  private shotAt = -10;
  private drawnPump = -1;
  private drawnFlash = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
  }

  fire(now: number): void {
    this.kick = 1;
    this.shotAt = now;
  }

  melee(): void {
    this.swing = 1;
  }

  /** Per frame: `bob` is the step's progress (0–1, 0 when standing). */
  update(now: number, dt: number, bob: number): void {
    this.kick *= Math.exp(-dt * 11);
    this.swing *= Math.exp(-dt * 8);
    const since = now - this.shotAt;
    const pump = since > PUMP_START && since < PUMP_END ? Math.sin((Math.PI * (since - PUMP_START)) / (PUMP_END - PUMP_START)) : 0;
    const flash = since < 0.06;
    const pumpPx = Math.round(pump * 12);
    if (pumpPx !== this.drawnPump || flash !== this.drawnFlash) {
      this.draw(pumpPx, flash);
      this.drawnPump = pumpPx;
      this.drawnFlash = flash;
    }
    const sway = Math.sin(bob * Math.PI);
    const x = -30 - this.swing * 22 + sway * 2;
    const y = this.kick * 16 + this.swing * 8 + sway * 3;
    this.canvas.style.transform = `translate(${x}%, ${y}%) rotate(${-this.kick * 7 - this.swing * 38}deg)`;
  }

  private draw(pump: number, flash: boolean): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const poly = (color: string, pts: readonly Pt[]) => {
      c.fillStyle = color;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    };
    if (flash) {
      // Muzzle flash: a ragged star at the barrel tip.
      const pts: Pt[] = [];
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 9 : 22 + (i % 4) * 3;
        const a = (i / 16) * Math.PI * 2;
        pts.push([98 + Math.cos(a) * r, 24 + Math.sin(a) * r * 0.7]);
      }
      poly('#ff9a30', pts);
      poly('#fff4b0', pts.map(([x, y]) => [98 + (x - 98) * 0.55, 24 + (y - 24) * 0.55]));
    }
    // A fat magazine tube under a fat barrel, narrowing into the distance.
    poly(STEEL_DARK, [[102, 110], [132, 110], [114, 40], [104, 40]]);
    poly(STEEL, [[68, 110], [116, 110], [106, 26], [90, 26]]);
    poly(STEEL_LIGHT, [[71, 110], [79, 110], [93, 26], [90, 26]]);
    poly(STEEL_DARK, [[108, 110], [116, 110], [106, 26], [104, 26]]);
    c.fillStyle = STEEL_DARK;
    c.beginPath();
    c.ellipse(98, 26, 8, 3.2, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(98, 26, 4.5, 1.8, 0, 0, Math.PI * 2);
    c.fill();
    // Pump (wooden forend), sliding back when racked.
    const py = 58 + pump;
    poly(WOOD, [[62, py + 30], [136, py + 30], [124, py], [74, py]]);
    poly(WOOD_LIGHT, [[64, py + 30], [74, py + 30], [80, py], [75, py]]);
    for (let g = 0; g < 5; g++) {
      const y = py + 6 + g * 5;
      poly('#3e220e', [[70 + g * 1.2, y], [128 - g * 1.2, y], [128 - g * 1.2, y + 2], [70 + g * 1.2, y + 2]]);
    }
    // Receiver and the gloved hand on it.
    poly(STEEL_DARK, [[54, 110], [146, 110], [134, 84], [66, 84]]);
    poly(STEEL, [[58, 108], [142, 108], [131, 88], [69, 88]]);
    poly(STEEL_LIGHT, [[60, 108], [66, 108], [72, 88], [70, 88]]);
    c.fillStyle = GLOVE;
    c.beginPath();
    c.ellipse(66, 102, 22, 13, -0.35, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#4c3828';
    c.beginPath();
    c.ellipse(60, 98, 10, 5, -0.35, 0, Math.PI * 2);
    c.fill();
  }
}
