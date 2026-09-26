import { describe, expect, it } from 'vitest';
import { STEP_TICKS, type MapData } from '@proc-fps/core';
import { generate } from '@proc-fps/gen';
import test01 from '@proc-fps/core/maps/test01.json';
import test02 from '@proc-fps/core/maps/test02.json';
import {
  DOOR_OPEN_TICKS,
  EMPTY_INPUT,
  NO_QUEUE,
  ReplayRecorder,
  createSimState,
  createWorld,
  doorAtCell,
  hashState,
  runReplay,
  stepSim,
  type InputFrame,
  type SimState,
} from '../src/index.js';

const map = test01 as MapData;
const hold = (f: Partial<InputFrame>, ticks: number): InputFrame[] => Array.from({ length: ticks }, () => ({ ...EMPTY_INPUT, ...f }));
const idle = (ticks: number) => hold({}, ticks);

function run(m: MapData, frames: InputFrame[]): SimState {
  const world = createWorld(m);
  const state = createSimState(world);
  for (const f of frames) stepSim(world, state, f);
  return state;
}
const cell = (s: SimState) => [s.player.cx, s.player.cy];

describe('grid movement', () => {
  it('spawns idle at the start cell centre', () => {
    const s = createSimState(createWorld(map));
    expect(cell(s)).toEqual([0, 2]);
    expect([s.player.x, s.player.y]).toEqual([64, 320]);
    expect(s.player.heading).toBe(0);
  });

  it('one tap = exactly one cell, taking STEP_TICKS', () => {
    const s = run(map, [...hold({ move: 1 }, 1), ...idle(STEP_TICKS + 5)]);
    expect(cell(s)).toEqual([1, 2]);
    expect(s.player.x).toBe(192);
    expect(s.player.stepTick).toBe(0);
  });

  it('holding forward walks one cell per STEP_TICKS', () => {
    const s = run(map, hold({ move: 1 }, STEP_TICKS * 3));
    expect(cell(s)).toEqual([3, 2]);
  });

  it('walls block without moving', () => {
    // Face west at x = 0.
    const s = run(map, [{ ...EMPTY_INPUT, turn: Math.PI }, ...hold({ move: 1 }, 60)]);
    expect(cell(s)).toEqual([0, 2]);
  });

  it('steps up the platform, drops off it, climbs the stairs into room C', () => {
    const world = createWorld(map);
    const s = createSimState(world);
    let ticks = 0;
    while (s.player.cx < 9 && ticks < 400) {
      stepSim(world, s, { ...EMPTY_INPUT, move: 1 });
      ticks++;
    }
    for (let i = 0; i < 30; i++) stepSim(world, s, EMPTY_INPUT);
    expect(cell(s)).toEqual([9, 2]);
    expect(s.player.z).toBe(32);
    expect(s.player.sector).toBe(6);
    // 9 steps, plus a short wait to land after dropping off the platform.
    expect(ticks).toBeLessThan(STEP_TICKS * 9 + 20);
  });

  it('is on the platform at +24 after two steps', () => {
    const s = run(map, [...hold({ move: 1 }, STEP_TICKS * 2), ...idle(1)]);
    expect(cell(s)).toEqual([2, 2]);
    expect(s.player.z).toBe(24);
  });

  it('strafe is relative to heading', () => {
    // Heading east: strafe left = north.
    const s = run(map, [...hold({ strafe: -1 }, 1), ...idle(STEP_TICKS + 1)]);
    expect(cell(s)).toEqual([0, 3]);
  });

  it('heading snaps with hysteresis', () => {
    const world = createWorld(map);
    const s = createSimState(world);
    stepSim(world, s, { ...EMPTY_INPUT, turn: Math.PI / 4 + 0.05 }); // just past 45°: inside hysteresis
    expect(s.player.heading).toBe(0);
    stepSim(world, s, { ...EMPTY_INPUT, turn: 0.15 }); // past 45° + 8°
    expect(s.player.heading).toBe(1);
    stepSim(world, s, { ...EMPTY_INPUT, turn: -0.15 }); // back just under 45°+: stays north
    expect(s.player.heading).toBe(1);
  });

  it('buffers a press made mid-step', () => {
    const frames = [...hold({ move: 1 }, 1), ...idle(4), ...hold({ strafe: -1 }, 1), ...idle(STEP_TICKS * 2 + 2)];
    const s = run(map, frames);
    expect(cell(s)).toEqual([1, 3]);
    expect(s.player.queued).toBe(NO_QUEUE);
  });

  it('most recently pressed axis wins when both are held', () => {
    const frames = [...hold({ move: 1 }, 2), ...hold({ move: 1, strafe: -1 }, 1), ...idle(STEP_TICKS * 2 + 2)];
    const s = run(map, frames);
    // First step east (forward), buffered strafe-left press → north.
    expect(cell(s)).toEqual([1, 3]);
  });

  it('never enters a non-walkable cell under random input', () => {
    const m = generate('fuzz');
    const world = createWorld(m);
    const state = createSimState(world);
    let x = 12345;
    const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296) * 2 - 1;
    for (let i = 0; i < 5000; i++) {
      stepSim(world, state, { ...EMPTY_INPUT, move: Math.round(rnd()), strafe: Math.round(rnd()), turn: rnd() * 0.3 });
      expect(world.grid.walkable(state.player.cx, state.player.cy)).toBe(true);
    }
  });
});

describe('replays', () => {
  it('reproduce the exact final state', () => {
    const rec = new ReplayRecorder(map);
    const world = createWorld(map);
    const state = createSimState(world);
    const frames = [...hold({ move: 1, turn: 0.01 }, 120), ...hold({ strafe: -1 }, 90), ...hold({ move: -1, look: 0.02, turn: 0.03 }, 60)];
    for (const f of frames) {
      rec.record(f);
      stepSim(world, state, f);
    }
    const replay = JSON.parse(JSON.stringify(rec.finish()));
    expect(hashState(runReplay(map, replay))).toBe(hashState(state));
  });

  it('refuse to run on a different map', () => {
    const rec = new ReplayRecorder(map);
    expect(() => runReplay(generate('other'), rec.finish())).toThrow(/recorded on map/);
  });
});

describe('doors and keys (test02)', () => {
  const m = test02 as MapData;
  const world = createWorld(m);
  const tap = (f: Partial<InputFrame>, wait = STEP_TICKS) => [...hold(f, 1), ...idle(wait)];
  const forward = tap({ move: 1 });
  const turn = (a: number) => hold({ turn: a }, 1);
  const through = tap({ move: 1 }, DOOR_OPEN_TICKS + STEP_TICKS + 2); // a tap into an auto door waits for it
  const auto = doorAtCell(world, 4, 1);
  const keyDoor = doorAtCell(world, 6, 3);
  // Start (0,1) facing east; three taps reach (3,1), next to the first auto door.
  const toAutoDoor = [...forward, ...forward, ...forward];
  // Through it, then to (6,1) below the key door.
  const toHall = [...toAutoDoor, ...through, ...forward, ...forward];

  it('opens an auto door when walked into, then finishes the step', () => {
    const waiting = run(m, [...toAutoDoor, ...tap({ move: 1 }, 5)]);
    expect(cell(waiting)).toEqual([3, 1]);
    expect(waiting.doors[auto]).toBeGreaterThan(0);
    expect(waiting.doors[auto]).toBeLessThan(DOOR_OPEN_TICKS);
    const passed = run(m, [...toAutoDoor, ...through]);
    expect(cell(passed)).toEqual([4, 1]);
    expect(passed.doors[auto]).toBe(DOOR_OPEN_TICKS);
  });

  it('refuses a key door without its key and opens it with E once the key is held', () => {
    const facingLock = [...toHall, ...turn(Math.PI / 2), ...forward]; // (6,2) facing north
    const refused = run(m, [...facingLock, ...hold({ use: true }, 1)]);
    expect(refused.events).toEqual([{ type: 'locked', door: keyDoor, key: 0 }]);
    expect(run(m, [...facingLock, ...tap({ use: true }, DOOR_OPEN_TICKS)]).doors[keyDoor]).toBe(0);
    const bumped = run(m, [...facingLock, ...hold({ move: 1 }, 40)]);
    expect(cell(bumped)).toEqual([6, 2]);
    expect(bumped.doors[keyDoor]).toBe(0);

    const withKey = run(m, [
      ...toHall, ...forward, // (7,1)
      ...through, ...forward, ...forward, // through the second auto door to the key at (10,1)
      ...turn(Math.PI), ...forward, ...forward, ...forward, ...forward, // back west to (6,1)
      ...turn(-Math.PI / 2), ...forward, // north to (6,2)
      ...tap({ use: true }, DOOR_OPEN_TICKS), ...forward, ...forward, // through the lock into the exit room
    ]);
    expect(withKey.keys).toBe(1);
    expect(withKey.taken).toBe(1);
    expect(cell(withKey)).toEqual([6, 4]);
  });
});
