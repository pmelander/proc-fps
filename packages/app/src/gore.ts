import { SpriteShape, type Sprite } from '@proc-fps/render';

/**
 * Gibs and blood: render-only particles (the sim never sees them, so replays are unaffected).
 * A kill bursts the enemy into chunks and a spray of blood thrown along the killing blow; hits
 * spray blood away from the blow. Drops that land become pools on the floor, and drops that hit a
 * wall stick to it; both linger, so a fought-over room stays painted. Gibs settle and linger too.
 * Shots add their own debris: a tracer spark along each pellet, and where one strikes a wall or
 * floor a burst of sparks and chips of stone that bounce and settle.
 */
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  kind: 'gib' | 'drop' | 'pool' | 'stuck' | 'spark' | 'tracer' | 'chip' | 'fire' | 'beam';
  age: number;
}

const GRAVITY = 1100;
const BOUNCE = 0.3;
const MAX_PARTICLES = 1800;
/** Seconds a flying drop lasts before it lands; how long pools, stuck drops and gibs stay. */
const DROP_LIFE = 3;
const POOL_LIFE = 120;
const GIB_LIFE = 90;
/** Sparks burn out fast; chips settle and stay a while. */
const SPARK_LIFE = 0.45;
const CHIP_LIFE = 25;
const SPARK_GRAVITY = 450;
/** A bolt's fireball: swells and burns out fast. */
const FIRE_LIFE = 0.22;
/** A sniper's beam: sprites this far apart along it, gone after BEAM_LIFE seconds. */
const BEAM_SPACING = 12;
const BEAM_LIFE = 0.28;

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

  /** A kill: `count` gibs and four times as much blood from (x, y, z), thrown along (dx, dy). */
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

  /** A hit: blood sprayed away from the blow (along (dx, dy)), `count` drops. */
  splash(x: number, y: number, z: number, dx = 0, dy = 0, count = 14): void {
    const toward = Math.atan2(dy, dx);
    const aimed = dx !== 0 || dy !== 0;
    for (let i = 0; i < count; i++) {
      const a = aimed ? toward + (this.rand() - 0.5) * 2 : this.rand() * Math.PI * 2;
      const speed = 70 + this.rand() * 230;
      this.add({ x, y, z, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, vz: 60 + this.rand() * 260, size: 2.5 + this.rand() * 3, kind: 'drop', age: 0 });
    }
  }

  /** A pellet's tracer: a spark flying straight from the muzzle, gone after `life` seconds (at its impact). */
  tracer(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size = 4): void {
    this.add({ x, y, z, vx, vy, vz, size, kind: 'tracer', age: SPARK_LIFE - life });
  }

  /** A sniper's shot: a glowing line from (x0, y0, z0) to (x1, y1, z1) that fades out fast. */
  beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.max(2, Math.ceil(len / BEAM_SPACING));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.add({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: z0 + (z1 - z0) * t, vx: 0, vy: 0, vz: 0, size: 6, kind: 'beam', age: 0 });
    }
  }

  /** A grenade bursting: a big ball of fire, a ring of sparks and chips, and smoke-dark debris. */
  explosion(x: number, y: number, z: number): void {
    for (let i = 0; i < 7; i++) {
      this.add({ x: x + (this.rand() - 0.5) * 40, y: y + (this.rand() - 0.5) * 40, z: z + 6 + this.rand() * 30, vx: 0, vy: 0, vz: 40, size: 34 + this.rand() * 30, kind: 'fire', age: this.rand() * 0.05 });
    }
    for (let k = 0; k < 3; k++) this.impact(x, y, z + 4, (this.rand() - 0.5) * 0.6, (this.rand() - 0.5) * 0.6, 1);
  }

  /** A bolt bursting: a ball of fire that swells and fades, with sparks and chips. */
  blast(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i++) this.add({ x: x + (this.rand() - 0.5) * 10, y: y + (this.rand() - 0.5) * 10, z: z - 10 + this.rand() * 10, vx: 0, vy: 0, vz: 30, size: 18 + this.rand() * 14, kind: 'fire', age: 0 });
    this.impact(x, y, z, 0, 0, 1);
  }

  /** A pellet striking a wall or floor: sparks and chips thrown back along (dx, dy, dz), towards the shooter. */
  impact(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    for (let i = 0; i < 16; i++) {
      const spark = i < 10;
      const speed = spark ? 180 + this.rand() * 420 : 60 + this.rand() * 180;
      const jx = (this.rand() - 0.5) * 1.6;
      const jy = (this.rand() - 0.5) * 1.6;
      const jz = this.rand() * 1.2;
      this.add({
        x: x + dx * 4, y: y + dy * 4, z: z + dz * 4,
        vx: (dx + jx) * speed, vy: (dy + jy) * speed, vz: (dz + jz) * speed,
        size: spark ? 3 + this.rand() * 2.5 : 4 + this.rand() * 4,
        kind: spark ? 'spark' : 'chip',
        age: spark ? this.rand() * 0.2 : 0,
      });
    }
  }

  /** A pool of blood of about `size` on the floor at (x, y), height z. */
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
      const life = p.kind === 'gib' ? GIB_LIFE : p.kind === 'drop' ? DROP_LIFE : p.kind === 'spark' || p.kind === 'tracer' ? SPARK_LIFE : p.kind === 'chip' ? CHIP_LIFE : p.kind === 'fire' ? FIRE_LIFE : p.kind === 'beam' ? BEAM_LIFE : POOL_LIFE;
      if (p.age > life) return false;
      if (p.kind === 'beam') return true;
      if (p.kind === 'tracer' || p.kind === 'fire') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        return true;
      }
      const settled = p.vx === 0 && p.vy === 0 && p.vz === 0;
      if (p.kind === 'pool' || p.kind === 'stuck' || ((p.kind === 'gib' || p.kind === 'chip') && settled)) return true;
      p.vz -= (p.kind === 'spark' ? SPARK_GRAVITY : GRAVITY) * dt;
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
        if (Math.abs(p.vz) < 40) p.vx = p.vy = p.vz = 0; // a gib or chip settles
      }
      return true;
    });
  }

  sprites(world: GoreWorld): Sprite[] {
    return this.particles.map((p) => {
      const glowing = p.kind === 'spark' || p.kind === 'tracer' || p.kind === 'fire' || p.kind === 'beam';
      const shape = p.kind === 'gib' ? SpriteShape.Gib : glowing ? SpriteShape.Spark : p.kind === 'chip' ? SpriteShape.Chip : SpriteShape.Blood;
      const base = { shape, charge: 0, flash: 0, light: glowing ? 1 : world.light(p.x, p.y), tile: -1 };
      if (p.kind === 'beam') {
        // Thins as it fades.
        const s = p.size * (1 - p.age / BEAM_LIFE);
        return { ...base, x: p.x, y: p.y, z: p.z - s / 2, width: s, height: s };
      }
      if (p.kind === 'fire') {
        // Swells to full size in a third of its life, then shrinks as it burns out.
        const k = p.age / FIRE_LIFE;
        const s = p.size * (k < 0.33 ? 0.4 + (k / 0.33) * 0.6 : 1 - (k - 0.33) * 1.2);
        return { ...base, x: p.x, y: p.y, z: p.z - s / 2, width: s, height: s };
      }
      // Pools lie flat on the floor, just above it.
      if (p.kind === 'pool') return { ...base, x: p.x, y: p.y, z: p.z + 1, width: p.size * 2.4, height: p.size * 2.4, flat: true };
      return { ...base, x: p.x, y: p.y, z: p.z, width: p.size, height: p.kind === 'gib' ? p.size * 0.8 : p.size };
    });
  }
}
