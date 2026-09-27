import { GRENADE, PLAYER_HEIGHT,
  DoorKind,
  HAZARD_DAMAGE,
  HAZARD_TICKS,
  HEADING_DX,
  HEADING_DY,
  HEALTH_PICKUP,
  MAX_STEP,
  PLAYER_MAX_HEALTH,
  STEP_TICKS,
  isDamaging,
} from '@proc-fps/core';
import { stepEnemies } from './ai.js';
import { hurtPlayer, playerFire, playerGrenade, stepGrenades, stepProjectiles } from './combat.js';
import { quantizeInput, type InputFrame } from './input.js';
import { callLift, floorNow, liftAtCell, liftMoving, stepLifts } from './lifts.js';
import { stepPlayer, type MoveGate } from './player.js';
import { DOOR_OPEN_TICKS, type SimState } from './state.js';
import { doorAtCell, pickupCell, type World } from './world.js';

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
  const gate: MoveGate = {
    floorAt: (cx, cy, level) => floorNow(world, state, cx, cy, level),
    isLift: (cx, cy) => liftAtCell(world, cx, cy) >= 0,
    tryStep: (cx, cy, level, h, fresh) => {
      const lands = world.grid.stepTarget(cx, cy, level, h);
      if (lands < 0) return 'no';
      const nx = cx + HEADING_DX[h];
      const ny = cy + HEADING_DY[h];
      if (enemyIn(nx, ny)) return 'no';
      const door = doorAtCell(world, nx, ny);
      if (door >= 0 && state.doors[door]! < DOOR_OPEN_TICKS) {
        const info = world.doors[door]!;
        if (info.kind === DoorKind.Auto) {
          open(door);
          return 'wait';
        }
        if (fresh && info.kind === DoorKind.Key && !(state.keys & (1 << info.key)) && state.doors[door] === 0) {
          state.events.push({ type: 'locked', door, key: info.key });
        }
        return state.doors[door]! > 0 ? 'wait' : 'no'; // a key or secret door opening: wait; closed, it is a wall
      }
      // Lifts: never step on or off one that is moving; walking into one that is not level calls it.
      const from = liftAtCell(world, cx, cy);
      const to = liftAtCell(world, nx, ny);
      if (from >= 0 && liftMoving(world, state, from)) return 'no';
      if (to >= 0 && liftMoving(world, state, to)) return 'wait';
      const here = floorNow(world, state, cx, cy, level);
      const there = floorNow(world, state, nx, ny, lands);
      if (to >= 0 && Math.abs(there - here) > MAX_STEP) {
        callLift(world, state, to, here);
        return 'wait';
      }
      // Off a lift: the grid lets a lift stand at whichever end suits the step, but this one is where
      // it is. The way off must be open at its real height: from a raised lift, a lower corridor is
      // behind the wall above its opening, not a drop.
      if (from >= 0 && to < 0) {
        const fromCeil = world.grid.span(cx, cy, level)![1];
        const toCeil = world.grid.span(nx, ny, lands)![1];
        if (Math.min(fromCeil, toCeil) - Math.max(here, there) < PLAYER_HEIGHT) return 'no';
      }
      return there - here > MAX_STEP ? 'no' : lands;
    },
  };
  stepPlayer(world, p, q, gate);

  state.doors.forEach((d, i) => {
    if (d > 0 && d < DOOR_OPEN_TICKS) state.doors[i] = d + 1;
  });
  stepLifts(world, state);

  // Pickups in the cell the player is standing in (by position, so mid-step counts). Health
  // stays on the floor while the player is at full health.
  const [cx, cy] = world.grid.cellOf(p.x, p.y);
  world.pickups.forEach((k, i) => {
    const at = pickupCell(state, k);
    if (state.taken[i] || !at || at[0] !== cx || at[1] !== cy) return;
    if (k.kind === 'health') {
      if (p.health >= PLAYER_MAX_HEALTH) return;
      const amount = Math.min(HEALTH_PICKUP, PLAYER_MAX_HEALTH - p.health);
      p.health += amount;
      state.events.push({ type: 'health', amount });
    } else if (k.kind === 'grenade') {
      // Stays on the floor while the player carries all they can.
      if (p.grenades >= GRENADE.max) return;
      p.grenades++;
      state.events.push({ type: 'grenadePickup' });
    } else {
      state.keys |= 1 << k.key;
      state.events.push({ type: 'key', key: k.key });
    }
    state.taken[i] = true;
  });

  // Damaging floors: standing on one hurts every HAZARD_TICKS (the first tick on it counts).
  const sector = world.map.sectors[world.grid.sectorAt(cx, cy)];
  if (sector && isDamaging(sector) && p.level === 0 && p.onGround && p.z <= sector.floor) {
    if (p.hazardTicks++ % HAZARD_TICKS === 0) hurtPlayer(state, HAZARD_DAMAGE);
  } else {
    p.hazardTicks = 0;
  }

  playerFire(world, state, q.fire, q.reload, q.melee, q.weapon);
  playerGrenade(state, q.grenade);
  stepEnemies(world, state);
  stepProjectiles(world, state);
  stepGrenades(world, state);

  const arrived = p.stepTick === 0 || p.stepTick >= STEP_TICKS;
  if (!state.dead && world.exit && arrived && p.cx === world.exit[0] && p.cy === world.exit[1]) {
    state.won = true;
    state.events.push({ type: 'exit' });
  }
  state.tick++;
}
