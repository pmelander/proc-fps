import { HEADING_DX, HEADING_DY, DoorKind } from '@proc-fps/core';
import { quantizeInput, type InputFrame } from './input.js';
import { stepPlayer, type DoorGate } from './player.js';
import { DOOR_OPEN_TICKS, type SimState } from './state.js';
import { doorAtCell, type World } from './world.js';

/** Advances the simulation by exactly one fixed tick. Mutates `state`. */
export function stepSim(world: World, state: SimState, input: InputFrame): void {
  const q = quantizeInput(input);
  const p = state.player;
  state.events = [];

  const open = (door: number) => {
    if (state.doors[door] !== 0) return;
    state.doors[door] = 1;
    state.events.push({ type: 'door', door });
  };

  // Use (E/Space): opens the door ahead in the movement heading (where W would go); a key door needs its key.
  if (q.use && !p.prevUse) {
    const door = doorAtCell(world, p.cx + HEADING_DX[p.heading], p.cy + HEADING_DY[p.heading]);
    if (door >= 0) {
      const info = world.doors[door]!;
      if (info.kind !== DoorKind.Key || state.keys & (1 << info.key)) open(door);
      else if (state.doors[door] === 0) state.events.push({ type: 'locked', door, key: info.key });
    }
  }
  p.prevUse = q.use;

  const gate: DoorGate = {
    blocked: (cx, cy) => {
      const door = doorAtCell(world, cx, cy);
      return door >= 0 && state.doors[door]! < DOOR_OPEN_TICKS;
    },
    bump: (cx, cy, fresh) => {
      const door = doorAtCell(world, cx, cy);
      const info = world.doors[door]!;
      if (info.kind === DoorKind.Auto) {
        open(door);
        return true;
      }
      if (fresh && info.kind === DoorKind.Key && !(state.keys & (1 << info.key)) && state.doors[door] === 0) {
        state.events.push({ type: 'locked', door, key: info.key });
      }
      return state.doors[door]! > 0; // a key door already opening: wait for it too
    },
  };
  stepPlayer(world, p, q, gate);

  state.doors.forEach((d, i) => {
    if (d > 0 && d < DOOR_OPEN_TICKS) state.doors[i] = d + 1;
  });

  // Pick up keys in the cell the player is standing in (by position, so mid-step counts).
  const [cx, cy] = world.grid.cellOf(p.x, p.y);
  world.keys.forEach((k, i) => {
    if (state.taken & (1 << i) || k.cx !== cx || k.cy !== cy) return;
    state.taken |= 1 << i;
    state.keys |= 1 << k.key;
    state.events.push({ type: 'key', key: k.key });
  });

  state.tick++;
}
