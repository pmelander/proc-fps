import { hashMap, isPerk, type MapData, type PerkId } from '@proc-fps/core';
import { quantizeInput, type InputFrame } from './input.js';
import { stepSim } from './sim.js';
import { createSimState, type SimState } from './state.js';
import { createWorld } from './world.js';

export const REPLAY_FORMAT_VERSION = 1;

/**
 * A replay is map identity + an input log. Because the sim is deterministic,
 * that is enough to reproduce every tick exactly — bug reports, regression
 * tests and demos all use this.
 */
export interface Replay {
  format: typeof REPLAY_FORMAT_VERSION;
  mapHash: string;
  seed?: string;
  generatorVersion?: string;
  /** The run's perks when it was recorded (they change the player); none when absent. */
  perks?: PerkId[];
  frames: InputFrame[];
}

export class ReplayRecorder {
  private readonly frames: InputFrame[] = [];
  constructor(private readonly map: MapData, private readonly perks: readonly PerkId[] = []) {}

  record(input: InputFrame): void {
    this.frames.push(quantizeInput(input));
  }

  get length(): number {
    return this.frames.length;
  }

  finish(): Replay {
    const r: Replay = { format: REPLAY_FORMAT_VERSION, mapHash: hashMap(this.map), frames: [...this.frames] };
    if (this.map.meta.seed !== undefined) r.seed = this.map.meta.seed;
    if (this.map.meta.generatorVersion !== undefined) r.generatorVersion = this.map.meta.generatorVersion;
    if (this.perks.length) r.perks = [...this.perks];
    return r;
  }
}

export function runReplay(map: MapData, replay: Replay): SimState {
  if (replay.format !== REPLAY_FORMAT_VERSION) throw new Error(`unsupported replay format ${replay.format}`);
  const h = hashMap(map);
  if (h !== replay.mapHash) throw new Error(`replay recorded on map ${replay.mapHash}, got ${h}`);
  const world = createWorld(map, (replay.perks ?? []).filter(isPerk));
  const state = createSimState(world);
  for (const f of replay.frames) stepSim(world, state, f);
  return state;
}
