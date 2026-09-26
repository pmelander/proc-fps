import { LIFT_WAIT } from '@proc-fps/core';
import type { SimState } from './state.js';
import type { World } from './world.js';

/**
 * Lifts: a one-cell platform travelling between a bottom and a top floor. With the player
 * standing still on it for LIFT_WAIT ticks it travels to its other end, once: it then stops, and
 * the player steps off and back on to ride again. Walking into it from a floor it is not level
 * with calls it there (nobody climbs or drops onto a lift). Enemies do not use lifts.
 */
export function liftAtCell(world: World, cx: number, cy: number): number {
  return world.grid.inBounds(cx, cy) ? world.liftAt[cx + cy * world.grid.width]! : -1;
}

/** Current floor height of a lift. */
export function liftHeight(world: World, state: SimState, lift: number): number {
  const info = world.lifts[lift]!;
  return info.bottom + ((info.top - info.bottom) * state.lifts[lift]!.pos) / info.travel;
}

/** A cell level's floor height right now (lifts move; they have one level). */
export function floorNow(world: World, state: SimState, cx: number, cy: number, level = 0): number {
  const lift = level === 0 ? liftAtCell(world, cx, cy) : -1;
  return lift >= 0 ? liftHeight(world, state, lift) : world.grid.floorAt(cx, cy, level);
}

export function liftMoving(world: World, state: SimState, lift: number): boolean {
  const s = state.lifts[lift]!;
  return s.pos !== (s.target === 1 ? world.lifts[lift]!.travel : 0);
}

/** Sends a lift to the end nearest `height` (no-op if it is already there). */
export function callLift(world: World, state: SimState, lift: number, height: number): void {
  const info = world.lifts[lift]!;
  const target = Math.abs(height - info.top) < Math.abs(height - info.bottom) ? 1 : 0;
  const s = state.lifts[lift]!;
  if (s.target !== target) {
    s.target = target;
    state.events.push({ type: 'lift', lift });
  }
}

export function stepLifts(world: World, state: SimState): void {
  const p = state.player;
  world.lifts.forEach((info, i) => {
    const s = state.lifts[i]!;
    const end = s.target === 1 ? info.travel : 0;
    if (s.pos !== end) {
      s.pos += s.pos < end ? 1 : -1;
      s.wait = 0;
      return;
    }
    const aboard = p.stepTick === 0 && p.level === 0 && info.cells.includes(p.cx + p.cy * world.grid.width);
    if (!aboard) {
      s.wait = 0;
      s.armed = true;
    } else if (s.armed && ++s.wait >= LIFT_WAIT) {
      s.wait = 0;
      s.armed = false;
      s.target = s.target === 1 ? 0 : 1;
      state.events.push({ type: 'lift', lift: i });
    }
  });
}
