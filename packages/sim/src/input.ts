/**
 * One tick of player intent. The sim consumes only this — never raw DOM events —
 * which is what makes input logs replayable.
 */
export interface InputFrame {
  /** -1..1 forward/back */
  move: number;
  /** -1..1 right/left */
  strafe: number;
  /** Yaw delta in radians this tick (positive = turn left / CCW). */
  turn: number;
  /** Pitch delta in radians this tick (positive = look up). */
  look: number;
  run: boolean;
  fire: boolean;
  use: boolean;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({
  move: 0,
  strafe: 0,
  turn: 0,
  look: 0,
  run: false,
  fire: false,
  use: false,
});

/** Angles are quantized so replays are compact and independent of mouse float noise. */
export const ANGLE_QUANTUM = 1 / 4096;

export function quantizeInput(i: InputFrame): InputFrame {
  const q = (v: number, step: number) => Math.round(v / step) * step;
  const c = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
  return {
    move: q(c(i.move), 1 / 127),
    strafe: q(c(i.strafe), 1 / 127),
    turn: q(i.turn, ANGLE_QUANTUM),
    look: q(i.look, ANGLE_QUANTUM),
    run: i.run,
    fire: i.fire,
    use: i.use,
  };
}
