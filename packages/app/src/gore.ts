import { SpriteShape, type Sprite } from '@proc-fps/render';

/**
 * Gibs and blood: render-only particles (the sim never sees them, so replays are unaffected).
 * A kill bursts the enemy into chunks and blood thrown along the killing blow; hits spray a
 * little blood. Particles fall, bounce off floors and walls, and gibs settle and linger.
 */
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  gib: boolean;
  resting: boolean;
  age: number;
}

const GRAVITY = 1100;
const BOUNCE = 0.3;
const MAX_PARTICLES = 700;
const BLOOD_LIFE = 4;
const GIB_LIFE = 45;

export interface GoreWorld {
  /** Floor height at a map point, or undefined for solid (walls). */
  floorAt(x: number, y: number): number | undefined;
  light(x: number, y: number): number;
}

export class Gore {
  private particles: Particle[] = [];
  private seed = 1;

  /** Deterministic enough for visuals, and never Math.random in a replay-relevant path. */
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** A kill: `count` gibs and twice as much blood from (x, y, z), thrown along (dx, dy). */
  burst(x: number, y: number, z: number, dx: number, dy: number, count: number, spread: number): void {
    for (let i = 0; i < count * 3; i++) {
      const gib = i < count;
      const a = Math.atan2(dy, dx) + (this.rand() - 0.5) * 2.4;
      const speed = (gib ? 180 : 120) + this.rand() * 380;
      this.add({
        x: x + (this.rand() - 0.5) * spread,
        y: y + (this.rand() - 0.5) * spread,
        z: z + this.rand() * spread,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: 150 + this.rand() * 420,
        size: gib ? 7 + this.rand() * 9 : 3 + this.rand() * 4,
        gib,
        resting: false,
        age: 0,
      });
    }
  }

  /** A hit: a small spray of blood. */
  splash(x: number, y: number, z: number): void {
    for (let i = 0; i < 6; i++) {
      const a = this.rand() * Math.PI * 2;
      this.add({ x, y, z, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, vz: 80 + this.rand() * 160, size: 3, gib: false, resting: false, age: 0 });
    }
  }

  private add(p: Particle): void {
    this.particles.push(p);
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  update(dt: number, world: GoreWorld): void {
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.age > (p.gib ? GIB_LIFE : BLOOD_LIFE)) return false;
      if (p.resting) return true;
      p.vz -= GRAVITY * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (world.floorAt(nx, ny) === undefined) {
        // A wall: bounce back off it.
        p.vx *= -BOUNCE;
        p.vy *= -BOUNCE;
      } else {
        p.x = nx;
        p.y = ny;
      }
      p.z += p.vz * dt;
      const floor = world.floorAt(p.x, p.y) ?? p.z;
      if (p.z <= floor) {
        p.z = floor;
        p.vz = -p.vz * BOUNCE;
        p.vx *= 0.55;
        p.vy *= 0.55;
        if (Math.abs(p.vz) < 40) p.resting = true;
      }
      return true;
    });
  }

  sprites(world: GoreWorld): Sprite[] {
    return this.particles.map((p) => ({
      x: p.x, y: p.y, z: p.z, width: p.size, height: p.gib ? p.size * 0.8 : p.size,
      shape: p.gib ? SpriteShape.Gib : SpriteShape.Blood, charge: 0, flash: 0, light: world.light(p.x, p.y), tile: -1,
    }));
  }
}
