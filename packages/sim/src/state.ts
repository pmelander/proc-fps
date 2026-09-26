import { DEG_TO_RAD, ENEMY_DEFS, PLAYER_MAX_HEALTH, ThingType, isEnemyThing, type EnemyType, type Heading } from '@proc-fps/core';
import type { World } from './world.js';

/** No buffered step. */
export const NO_QUEUE = -1;
/** Ticks for a door to open fully (≈ 0.33 s). */
export const DOOR_OPEN_TICKS = 20;

export interface PlayerState {
  // --- grid movement (authoritative) ---
  /** Destination cell while stepping; current cell when idle. */
  cx: number;
  cy: number;
  fromCx: number;
  fromCy: number;
  /** Level of the destination cell (0 = floor, 1 = on a catwalk) and of the cell left. */
  level: number;
  fromLevel: number;
  /** 0 = idle, 1..STEP_TICKS = progress through the current step. */
  stepTick: number;
  /** Absolute heading buffered by a key press mid-step, or NO_QUEUE. */
  queued: number;
  /** Movement heading snapped from yaw with hysteresis. */
  heading: Heading;
  /** Most recently pressed axis (0 = move, 1 = strafe) — wins when both are held. */
  lastAxis: 0 | 1;
  /** Previous tick's input signs, for press-edge detection. */
  prevMove: number;
  prevStrafe: number;
  /** Previous tick's use button, for press-edge detection. */
  prevUse: boolean;

  // --- derived pose (for rendering, projectiles, AI line of sight) ---
  x: number;
  y: number;
  z: number;
  vz: number;
  onGround: boolean;
  sector: number;

  // --- free look ---
  angle: number;
  pitch: number;

  // --- combat ---
  health: number;
  /** Ticks until the weapon can fire again. */
  fireCooldown: number;
  /** Ticks spent on a damaging floor since it last hurt. */
  hazardTicks: number;
}

export type EnemyMode = 'idle' | 'alert' | 'chase' | 'windup' | 'pain' | 'dead';

export interface EnemyState {
  type: EnemyType;
  /** Destination cell while stepping; current cell when idle. */
  cx: number;
  cy: number;
  fromCx: number;
  fromCy: number;
  level: number;
  fromLevel: number;
  /** 0 = idle, 1..stepTicks = progress through the current step. */
  stepTick: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  mode: EnemyMode;
  /** Ticks left in the current mode (alert, windup, pain). */
  timer: number;
  /** Ticks until the next attack may start. */
  cooldown: number;
}

export interface LiftState {
  /** 0 = bottom … travel = top. */
  pos: number;
  /** End it is heading for or resting at: 0 bottom, 1 top. */
  target: 0 | 1;
  /** Ticks the player has stood still aboard. */
  wait: number;
  /**
   * Whether standing aboard sends it: set when the player is off it, cleared by a trip. A lift
   * stops after each trip; to ride again, step off and back on (or call it by walking into it).
   */
  armed: boolean;
}

export interface Projectile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  /** Ticks alive. */
  ttl: number;
}

/** Things that happened this tick, for the HUD and (later) sound. Cleared every tick. */
export type SimEvent =
  | { type: 'door'; door: number }
  /** Tried a key door without its key. */
  | { type: 'locked'; door: number; key: number }
  | { type: 'key'; key: number }
  | { type: 'health'; amount: number }
  | { type: 'secret'; secret: number }
  | { type: 'shot' }
  | { type: 'hurt'; amount: number }
  | { type: 'hit'; enemy: number }
  /** An automatic melee strike landed. */
  | { type: 'melee'; enemy: number }
  | { type: 'kill'; enemy: number }
  /** An enemy started its wind-up (the telegraph) or attacked. */
  | { type: 'windup'; enemy: number }
  | { type: 'attack'; enemy: number }
  | { type: 'lift'; lift: number }
  | { type: 'death' }
  | { type: 'exit' };

export interface SimState {
  tick: number;
  player: PlayerState;
  /**
   * Per door id: 0 = closed, 1 … DOOR_OPEN_TICKS - 1 = opening, DOOR_OPEN_TICKS = open.
   * Doors stay open once opened.
   */
  doors: number[];
  lifts: LiftState[];
  /** Bitmask of key ids held. */
  keys: number;
  /** Per `world.pickups`: already taken. */
  taken: boolean[];
  /** Bitmask of secret ids found. */
  secrets: number;
  enemies: EnemyState[];
  projectiles: Projectile[];
  /** The player died; the sim ignores input from here. */
  dead: boolean;
  /** The player reached the exit; the sim ignores input from here. */
  won: boolean;
  events: SimEvent[];
}

export function headingFromAngle(angle: number): Heading {
  return ((((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4) as Heading);
}

export function createSimState(world: World): SimState {
  const start = world.map.things.find((t) => t.type === ThingType.PlayerStart);
  if (!start) throw new Error('map has no player start');
  const [cx, cy] = world.grid.cellOf(start.x, start.y);
  if (!world.grid.walkable(cx, cy)) throw new Error('player start is not on a walkable cell');
  const [x, y] = world.grid.center(cx, cy);
  const angle = start.angle * DEG_TO_RAD;
  const enemies = world.map.things.flatMap((t): EnemyState[] => {
    if (!isEnemyThing(t.type)) return [];
    const [ex, ey] = world.grid.cellOf(t.x, t.y);
    const [px, py] = world.grid.center(ex, ey);
    return [{
      type: t.type, cx: ex, cy: ey, fromCx: ex, fromCy: ey, level: 0, fromLevel: 0, stepTick: 0,
      x: px, y: py, z: world.grid.floorAt(ex, ey),
      hp: ENEMY_DEFS[t.type].hp, mode: 'idle', timer: 0, cooldown: 0,
    }];
  });
  return {
    tick: 0,
    player: {
      cx,
      cy,
      fromCx: cx,
      fromCy: cy,
      level: 0,
      fromLevel: 0,
      stepTick: 0,
      queued: NO_QUEUE,
      heading: headingFromAngle(angle),
      lastAxis: 0,
      prevMove: 0,
      prevStrafe: 0,
      prevUse: false,
      x,
      y,
      z: world.grid.floorAt(cx, cy),
      vz: 0,
      onGround: true,
      sector: world.grid.sectorAt(cx, cy),
      angle,
      pitch: 0,
      health: PLAYER_MAX_HEALTH,
      fireCooldown: 0,
      hazardTicks: 0,
    },
    doors: world.doors.map(() => 0),
    lifts: world.lifts.map((): LiftState => ({ pos: 0, target: 0, wait: 0, armed: true })),
    keys: 0,
    taken: world.pickups.map(() => false),
    secrets: 0,
    enemies,
    projectiles: [],
    dead: false,
    won: false,
    events: [],
  };
}

/** How far a door's ceiling sits below its open height, in map units: travel when closed, 0 when open. */
export function doorOffset(world: World, state: SimState, door: number): number {
  return world.doors[door]!.travel * (1 - state.doors[door]! / DOOR_OPEN_TICKS);
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p };
}

/** Exact-state fingerprint for replay regression tests. */
export function hashState(s: SimState): string {
  const json = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
