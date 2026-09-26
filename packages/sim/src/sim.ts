import { quantizeInput, type InputFrame } from './input.js';
import { stepPlayer } from './player.js';
import type { SimState } from './state.js';
import type { World } from './world.js';

/** Advances the simulation by exactly one fixed tick. Mutates `state`. */
export function stepSim(world: World, state: SimState, input: InputFrame): void {
  const q = quantizeInput(input);
  stepPlayer(world, state.player, q);
  state.tick++;
}
