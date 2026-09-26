import { DEG_TO_RAD, ThingType, type Heading } from '@proc-fps/core';
import type { World } from './world.js';

/** No buffered step. */
export const NO_QUEUE = -1;

export interface PlayerState {
  // --- grid movement (authoritative) ---
  /** Destination cell while stepping; current cell when idle. */
  cx: number;
  cy: number;
  fromCx: number;
  fromCy: number;
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
}

export interface SimState {
  tick: number;
  player: PlayerState;
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
  return {
    tick: 0,
    player: {
      cx,
      cy,
      fromCx: cx,
      fromCy: cy,
      stepTick: 0,
      queued: NO_QUEUE,
      heading: headingFromAngle(angle),
      lastAxis: 0,
      prevMove: 0,
      prevStrafe: 0,
      x,
      y,
      z: world.grid.floorAt(cx, cy),
      vz: 0,
      onGround: true,
      sector: world.grid.sectorAt(cx, cy),
      angle,
      pitch: 0,
    },
  };
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
