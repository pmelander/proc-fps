import { ALERT_TICKS, CELL_SIZE, EnemyType, MAX_STEP, dcos, dsin, type EnemyDef } from '@proc-fps/core';
import { hurtPlayer } from './combat.js';
import type { EnemyState, SimState } from './state.js';
import { doorAtCell, type World } from './world.js';

/**
 * Boss fights. The mini boss and the boss fight in phases: as their health drops past each
 * threshold they move on (a `phase` event), and each phase has its own rotation of attacks:
 * - volley: the aimed fan every enemy with projectiles fires;
 * - ring: a burst of projectiles in every direction (the gaps between them are the way through);
 * - summon: a pack of grunts erupts from the floor around it (capped, so it cannot flood the room);
 * - slam: a long wind-up, then a blow to everyone within SLAM_RADIUS on its floor (step out in time).
 * The boss's last phase is enraged: it winds up faster and waits less between attacks, and its
 * volleys widen. Bosses' blows cannot be turned away by the chainsword's invulnerability.
 */
export type BossPattern = 'volley' | 'ring' | 'summon' | 'slam';

export const isBoss = (type: EnemyType): boolean => type === EnemyType.MiniBoss || type === EnemyType.Boss;

/** Health fractions (of full) at which each boss moves to its next phase. */
const PHASES: Partial<Record<EnemyType, readonly number[]>> = {
  [EnemyType.MiniBoss]: [0.5],
  [EnemyType.Boss]: [0.66, 0.33],
};

/** Each phase's rotation of attacks. */
const PATTERNS: Partial<Record<EnemyType, readonly (readonly BossPattern[])[]>> = {
  [EnemyType.MiniBoss]: [['volley', 'volley', 'slam'], ['volley', 'ring', 'summon', 'slam']],
  [EnemyType.Boss]: [['volley', 'ring', 'slam'], ['volley', 'summon', 'ring', 'slam'], ['ring', 'volley', 'summon', 'slam', 'volley']],
};

/** A slam reaches everyone this close (map units) on the boss's floor. */
export const SLAM_RADIUS = 2.2 * CELL_SIZE;
/** Ticks a slam winds up: long, and loud, so the player can get out. */
export const SLAM_WINDUP = 48;
/** Projectiles in a ring burst. */
const RING: Partial<Record<EnemyType, number>> = { [EnemyType.MiniBoss]: 10, [EnemyType.Boss]: 16 };
/** Grunts per summon, and the most a boss's summons may have alive at once. */
const SUMMON: Partial<Record<EnemyType, number>> = { [EnemyType.MiniBoss]: 2, [EnemyType.Boss]: 3 };
export const MAX_ADDS = 6;
/** Enraged (the boss's last phase): wind-ups and cooldowns shrink to these shares. */
const ENRAGED_WINDUP = 0.8;
const ENRAGED_COOLDOWN = 0.6;

const phasesOf = (type: EnemyType) => PHASES[type] ?? [];
export const lastPhase = (type: EnemyType): number => phasesOf(type).length;
export const enraged = (e: EnemyState): boolean => e.type === EnemyType.Boss && e.phase === lastPhase(e.type);

/** Moves a boss on to the phase its health calls for (never back), with a `phase` event. */
export function updatePhase(state: SimState, e: EnemyState, def: EnemyDef, index: number): void {
  const share = e.hp / def.hp;
  const phase = phasesOf(e.type).filter((t) => share <= t).length;
  if (phase <= e.phase) return;
  e.phase = phase;
  state.events.push({ type: 'phase', enemy: index, phase });
}

const summonedAlive = (state: SimState, index: number) => state.enemies.filter((x) => x.summoner === index && x.mode !== 'dead').length;

function playerInSlam(state: SimState, e: EnemyState): boolean {
  const p = state.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  return dx * dx + dy * dy <= SLAM_RADIUS * SLAM_RADIUS && Math.abs(p.z - e.z) <= MAX_STEP * 2;
}

/** The boss's next attack in its phase's rotation, skipping any it cannot use now (a slam from afar, a summon at the cap). */
export function nextPattern(state: SimState, e: EnemyState, index: number): BossPattern {
  const rotation = PATTERNS[e.type]?.[e.phase] ?? ['volley'];
  for (let k = 0; k < rotation.length; k++) {
    const pattern = rotation[(e.attacks + k) % rotation.length]!;
    if (pattern === 'slam' && !playerInSlam(state, e)) continue;
    if (pattern === 'summon' && summonedAlive(state, index) >= MAX_ADDS) continue;
    e.attacks += k + 1;
    return pattern;
  }
  e.attacks++;
  return 'volley';
}

export function patternWindup(e: EnemyState, def: EnemyDef, pattern: BossPattern): number {
  if (pattern === 'slam') return SLAM_WINDUP;
  return Math.round(def.windup * (enraged(e) ? ENRAGED_WINDUP : 1));
}

export function patternCooldown(e: EnemyState, def: EnemyDef): number {
  return Math.round(def.cooldown * (enraged(e) ? ENRAGED_COOLDOWN : 1));
}

/** Extra projectiles an enraged boss adds to its volleys. */
export const volleyBonus = (e: EnemyState): number => (enraged(e) ? 2 : 0);

/** Carries out a ring, summon or slam (volleys go through the ordinary attack). */
export function bossAttack(world: World, state: SimState, e: EnemyState, def: EnemyDef, index: number, pattern: BossPattern): void {
  if (pattern === 'ring') {
    const n = RING[e.type] ?? 10;
    const offset = (e.attacks % 2) * 0.5; // alternate ring rotations, so the gaps move
    const speed = def.projectileSpeed * 0.75;
    for (let k = 0; k < n; k++) {
      const a = ((k + offset) / n) * Math.PI * 2;
      state.projectiles.push({
        x: e.x, y: e.y, z: e.z + def.height * 0.5,
        vx: dcos(a) * speed, vy: dsin(a) * speed, vz: 0,
        damage: def.damage, ttl: 0, unblockable: true,
      });
    }
    state.events.push({ type: 'attack', enemy: index });
    return;
  }
  if (pattern === 'summon') {
    const spawned = summon(world, state, e, index, Math.min((SUMMON[e.type] ?? 2) + (enraged(e) ? 1 : 0), MAX_ADDS - summonedAlive(state, index)));
    state.events.push({ type: 'summon', enemy: index, count: spawned });
    return;
  }
  if (pattern === 'slam') {
    state.events.push({ type: 'slam', enemy: index });
    if (playerInSlam(state, e)) hurtPlayer(state, Math.round(def.damage * 2.5), { x: e.x, y: e.y }, true);
  }
}

/**
 * Grunts erupting from the floor around a boss: on free, walkable cells two to four steps from it
 * (nearest first, never next to the player or in a doorway). Returns how many came.
 */
function summon(world: World, state: SimState, e: EnemyState, index: number, count: number): number {
  const g = world.grid;
  const p = state.player;
  const taken = new Set(state.enemies.filter((x) => x.mode !== 'dead').flatMap((x) => [`${x.cx},${x.cy}`, `${x.fromCx},${x.fromCy}`]));
  taken.add(`${p.cx},${p.cy}`);
  const cells: [number, number, number][] = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      const x = e.cx + dx;
      const y = e.cy + dy;
      if (d < 2 || d > 4 || !g.walkable(x, y) || taken.has(`${x},${y}`) || doorAtCell(world, x, y) >= 0) continue;
      if (Math.abs(x - p.cx) + Math.abs(y - p.cy) <= 1) continue;
      if (Math.abs(g.floorAt(x, y) - e.z) > MAX_STEP) continue; // on the boss's own floor
      cells.push([d, x, y]);
    }
  }
  cells.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  let spawned = 0;
  for (const [, x, y] of cells.slice(0, Math.max(0, count))) {
    const [cx, cy] = g.center(x, y);
    state.enemies.push({
      type: EnemyType.Grunt, variant: 0, cx: x, cy: y, fromCx: x, fromCy: y, level: 0, fromLevel: 0, stepTick: 0,
      x: cx, y: cy, z: g.floorAt(x, y), hp: world.enemyDefs[EnemyType.Grunt][0]!.hp,
      mode: 'alert', timer: ALERT_TICKS / 2, cooldown: 0, phase: 0, attacks: 0, pattern: 'volley', summoner: index,
    });
    spawned++;
  }
  return spawned;
}
