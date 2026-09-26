import { HEADING_HYSTERESIS, STEP_TICKS, clamp, wrapAngle, type Heading } from '@proc-fps/core';
import type { InputFrame } from './input.js';
import { NO_QUEUE, headingFromAngle, type PlayerState } from './state.js';
import type { World } from './world.js';

const MAX_PITCH = 1.3;
const GRAVITY = 0.34; // units/tick², Doom's 1/tic² rescaled to 60 Hz
const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;

/**
 * Grid movement with free look:
 * - Yaw/pitch are continuous and never affect position.
 * - WASD steps one cell relative to the yaw snapped to a cardinal (with hysteresis).
 * - A press during a step is buffered (one deep, resolved at press time).
 * - Holding a key repeats steps seamlessly.
 */
export function stepPlayer(world: World, p: PlayerState, input: InputFrame): void {
  p.angle = wrapAngle(p.angle + input.turn);
  p.pitch = clamp(p.pitch + input.look, -MAX_PITCH, MAX_PITCH);
  updateHeading(p);

  const m = Math.sign(input.move);
  const s = Math.sign(input.strafe);
  const movePressed = m !== 0 && m !== p.prevMove;
  const strafePressed = s !== 0 && s !== p.prevStrafe;
  if (movePressed) p.lastAxis = 0;
  if (strafePressed) p.lastAxis = 1;
  p.prevMove = m;
  p.prevStrafe = s;
  const intent = resolveIntent(p.heading, m, s, p.lastAxis);
  if (p.stepTick > 0 && (movePressed || strafePressed) && intent !== NO_QUEUE) p.queued = intent;

  if (p.stepTick >= STEP_TICKS) p.stepTick = 0; // arrived last tick
  if (p.stepTick > 0) p.stepTick++;
  else if (p.onGround) {
    const dir = p.queued !== NO_QUEUE ? p.queued : intent;
    p.queued = NO_QUEUE;
    if (dir !== NO_QUEUE && world.grid.canStep(p.cx, p.cy, dir as Heading)) {
      p.fromCx = p.cx;
      p.fromCy = p.cy;
      p.cx += [1, 0, -1, 0][dir]!;
      p.cy += [0, 1, 0, -1][dir]!;
      p.stepTick = 1;
    }
  }

  updatePose(world, p);
}

function updateHeading(p: PlayerState): void {
  const diff = wrapAngle(p.angle - p.heading * HALF_PI);
  if (Math.abs(diff) > QUARTER_PI + HEADING_HYSTERESIS) p.heading = headingFromAngle(p.angle);
}

/** Absolute heading for the held keys, or NO_QUEUE. */
export function resolveIntent(heading: Heading, move: number, strafe: number, lastAxis: 0 | 1): number {
  const axis = move !== 0 && strafe !== 0 ? lastAxis : move !== 0 ? 0 : strafe !== 0 ? 1 : -1;
  if (axis === 0) return move > 0 ? heading : (heading + 2) % 4;
  if (axis === 1) return strafe > 0 ? (heading + 3) % 4 : (heading + 1) % 4; // right = clockwise
  return NO_QUEUE;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function updatePose(world: World, p: PlayerState): void {
  const g = world.grid;
  const [tx, ty] = g.center(p.cx, p.cy);
  const toFloor = g.floorAt(p.cx, p.cy);

  if (p.stepTick === 0) {
    p.x = tx;
    p.y = ty;
    fall(p, toFloor);
  } else {
    const t = p.stepTick / STEP_TICKS;
    const e = smoothstep(t);
    const [fx, fy] = g.center(p.fromCx, p.fromCy);
    const fromFloor = g.floorAt(p.fromCx, p.fromCy);
    p.x = fx + (tx - fx) * e;
    p.y = fy + (ty - fy) * e;
    if (toFloor > fromFloor) {
      // Step up follows the same ease as the horizontal motion.
      p.z = fromFloor + (toFloor - fromFloor) * e;
      p.vz = 0;
      p.onGround = true;
    } else {
      // Stepping down: stay on the ledge until the edge is crossed, then fall.
      fall(p, t < 0.5 ? fromFloor : toFloor);
    }
  }
  const [ccx, ccy] = g.cellOf(p.x, p.y);
  const s = g.sectorAt(ccx, ccy);
  if (s >= 0) p.sector = s;
}

function fall(p: PlayerState, ground: number): void {
  if (p.z > ground) {
    p.vz -= GRAVITY;
    p.z += p.vz;
  }
  if (p.z <= ground) {
    p.z = ground;
    p.vz = 0;
  }
  p.onGround = p.z <= ground;
}
