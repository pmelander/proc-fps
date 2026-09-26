import { AMMO_PICKUP, DoorKind, HEADING_DX, HEADING_DY, HEALTH_PICKUP, MAX_AMMO, PLAYER_MAX_HEALTH, STEP_TICKS } from '@proc-fps/core';
import { stepEnemies } from './ai.js';
import { playerFire, stepProjectiles } from './combat.js';
import { quantizeInput, type InputFrame } from './input.js';
import { stepPlayer, type DoorGate } from './player.js';
import { DOOR_OPEN_TICKS, type SimState } from './state.js';
import { doorAtCell, type World } from './world.js';

/** Advances the simulation by exactly one fixed tick. Mutates `state`. */
export function stepSim(world: World, state: SimState, input: InputFrame): void {
  state.events = [];
  // Death and the exit end the level: the world holds still and input is ignored.
  if (state.dead || state.won) {
    state.tick++;
    return;
  }
  const q = quantizeInput(input);
  const p = state.player;

  const open = (door: number) => {
    if (state.doors[door] !== 0) return;
    state.doors[door] = 1;
    state.events.push({ type: 'door', door });
  };

  // Use (E/Space): opens the door ahead in the movement heading (where W would go); a key door
  // needs its key. Opening a secret door finds the secret.
  if (q.use && !p.prevUse) {
    const door = doorAtCell(world, p.cx + HEADING_DX[p.heading], p.cy + HEADING_DY[p.heading]);
    if (door >= 0) {
      const info = world.doors[door]!;
      if (info.kind === DoorKind.Secret && state.doors[door] === 0) {
        state.secrets |= 1 << info.key;
        state.events.push({ type: 'secret', secret: info.key });
      }
      if (info.kind !== DoorKind.Key || state.keys & (1 << info.key)) open(door);
      else if (state.doors[door] === 0) state.events.push({ type: 'locked', door, key: info.key });
    }
  }
  p.prevUse = q.use;

  const enemyIn = (cx: number, cy: number) =>
    state.enemies.some((e) => e.mode !== 'dead' && ((e.cx === cx && e.cy === cy) || (e.stepTick > 0 && e.fromCx === cx && e.fromCy === cy)));
  const gate: DoorGate = {
    blocked: (cx, cy) => {
      if (enemyIn(cx, cy)) return true;
      const door = doorAtCell(world, cx, cy);
      return door >= 0 && state.doors[door]! < DOOR_OPEN_TICKS;
    },
    bump: (cx, cy, fresh) => {
      const door = doorAtCell(world, cx, cy);
      if (door < 0) return false; // an enemy is in the way
      const info = world.doors[door]!;
      if (info.kind === DoorKind.Auto) {
        open(door);
        return true;
      }
      if (fresh && info.kind === DoorKind.Key && !(state.keys & (1 << info.key)) && state.doors[door] === 0) {
        state.events.push({ type: 'locked', door, key: info.key });
      }
      return state.doors[door]! > 0; // a key or secret door already opening: wait for it too; closed, it is a wall
    },
  };
  stepPlayer(world, p, q, gate);

  state.doors.forEach((d, i) => {
    if (d > 0 && d < DOOR_OPEN_TICKS) state.doors[i] = d + 1;
  });

  // Pickups in the cell the player is standing in (by position, so mid-step counts). Health and
  // ammo stay on the floor while the player is full.
  const [cx, cy] = world.grid.cellOf(p.x, p.y);
  world.pickups.forEach((k, i) => {
    if (state.taken[i] || k.cx !== cx || k.cy !== cy) return;
    if (k.kind === 'health') {
      if (p.health >= PLAYER_MAX_HEALTH) return;
      const amount = Math.min(HEALTH_PICKUP, PLAYER_MAX_HEALTH - p.health);
      p.health += amount;
      state.events.push({ type: 'health', amount });
    } else if (k.kind === 'ammo') {
      if (p.ammo >= MAX_AMMO) return;
      const amount = Math.min(AMMO_PICKUP, MAX_AMMO - p.ammo);
      p.ammo += amount;
      state.events.push({ type: 'ammo', amount });
    } else {
      state.keys |= 1 << k.key;
      state.events.push({ type: 'key', key: k.key });
    }
    state.taken[i] = true;
  });

  playerFire(world, state, q.fire);
  stepEnemies(world, state);
  stepProjectiles(world, state);

  const arrived = p.stepTick === 0 || p.stepTick >= STEP_TICKS;
  if (!state.dead && world.exit && arrived && p.cx === world.exit[0] && p.cy === world.exit[1]) {
    state.won = true;
    state.events.push({ type: 'exit' });
  }
  state.tick++;
}
