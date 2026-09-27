import { SpriteShape, type Sprite } from '@proc-fps/render';

/**
 * Gibs and blood: render-only particles (the sim never sees them, so replays are unaffected).
 * A kill bursts the enemy into chunks and a spray of blood thrown along the killing blow; hits
 * spray blood away from the blow. Drops that land become pools on the floor, and drops that hit a
 * wall stick to it; both linger, so a fought-over room stays painted. Gibs settle and linger too.
 */
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  kind: 'gib' | 'drop' | 'pool' | 'stuck';
  age: number;
}

const GRAVITY = 1100;
const BOUNCE = 0.3;
const MAX_PARTICLES = 1800;
/** Seconds a flying drop lasts before it lands; how long pools, stuck drops and gibs stay. */
const DROP_LIFE = 3;
const POOL_LIFE = 120;
const GIB_LIFE = 90;

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

  /** A kill: \`count\` gibs and four times as much blood from (x, y, z), thrown along (dx, dy). */
  burst(x: number, y: number, z: number, dx: number, dy: number, count: number, spread: number): void {
    for (let i = 0; i < count * 5; i++) {
      const gib = i < count;
      const a = Math.atan2(dy, dx) + (this.rand() - 0.5) * (gib ? 2.4 : 3.2);
      const speed = (gib ? 180 : 100) + this.rand() * (gib ? 380 : 520);
      this.add({
        x: x + (this.rand() - 0.5) * spread,
        y: y + (this.rand() - 0.5) * spread,
        z: z + (this.rand() - 0.3) * spread,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: 120 + this.rand() * 480,
        size: gib ? 7 + this.rand() * 11 : 2.5 + this.rand() * 5,
        kind: gib ? 'gib' : 'drop',
        age: 0,
      });
    }
  }

  /** A hit: blood sprayed away from the blow (along (dx, dy)), \`count\` drops. */
  splash(x: number, y: number, z: number, dx = 0, dy = 0, count = 14): void {
    const toward = Math.atan2(dy, dx);
    const aimed = dx !== 0 || dy !== 0;
    for (let i = 0; i < count; i++) {
      const a = aimed ? toward + (this.rand() - 0.5) * 2 : this.rand() * Math.PI * 2;
      const speed = 70 + this.rand() * 230;
      this.add({ x, y, z, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, vz: 60 + this.rand() * 260, size: 2.5 + this.rand() * 3, kind: 'drop', age: 0 });
    }
  }

  /** A pool of blood of about \`size\` on the floor at (x, y), height z. */
  pool(x: number, y: number, z: number, size: number): void {
    this.add({ x, y, z, vx: 0, vy: 0, vz: 0, size, kind: 'pool', age: 0 });
  }

  private add(p: Particle): void {
    this.particles.push(p);
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  update(dt: number, world: GoreWorld): void {
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.age > (p.kind === 'gib' ? GIB_LIFE : p.kind === 'drop' ? DROP_LIFE : POOL_LIFE)) return false;
      if (p.kind === 'pool' || p.kind === 'stuck' || (p.kind === 'gib' && p.vx === 0 && p.vy === 0 && p.vz === 0)) return true;
      p.vz -= GRAVITY * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (world.floorAt(nx, ny) === undefined) {
        if (p.kind === 'drop') {
          // Blood sticks where it hits a wall.
          p.kind = 'stuck';
          p.age = 0;
          return true;
        }
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
        if (p.kind === 'drop') {
          // A drop that lands spreads into a small pool.
          p.kind = 'pool';
          p.size *= 1.8;
          p.age = 0;
          return true;
        }
        p.vz = -p.vz * BOUNCE;
        p.vx *= 0.55;
        p.vy *= 0.55;
        if (Math.abs(p.vz) < 40) p.vx = p.vy = p.vz = 0; // the gib settles
      }
      return true;
    });
  }

  sprites(world: GoreWorld): Sprite[] {
    return this.particles.map((p) => {
      const base = { shape: p.kind === 'gib' ? SpriteShape.Gib : SpriteShape.Blood, charge: 0, flash: 0, light: world.light(p.x, p.y), tile: -1 };
      // Pools lie flat on the floor, just above it.
      if (p.kind === 'pool') return { ...base, x: p.x, y: p.y, z: p.z + 1, width: p.size * 2.4, height: p.size * 2.4, flat: true };
      return { ...base, x: p.x, y: p.y, z: p.z, width: p.size, height: p.kind === 'gib' ? p.size * 0.8 : p.size };
    });
  }
}
