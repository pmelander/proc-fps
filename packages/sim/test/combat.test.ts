import { describe, expect, it } from 'vitest';
import { CELL_SIZE as C, CellPlan, DoorKind, EnemyType, MapBuilder, STEP_TICKS, ThingType, dropsKeyFlags, emitCellPlan, enemyDefsFor, type MapData } from '@proc-fps/core';
import { generate } from '@proc-fps/gen';
import {
  DOOR_OPEN_TICKS,
  EMPTY_INPUT,
  ENEMY_DEFS,
  FIRE_COOLDOWN,
  HEALTH_PICKUP,
  MAG_SIZE,
  RELOAD_TICKS,
  MELEE_DAMAGE,
  PELLETS,
  PLAYER_DAMAGE,
  PLAYER_MAX_HEALTH,
  createSimState,
  createWorld,
  stepSim,
  type InputFrame,
  type SimState,
} from '../src/index.js';

/**
 * A room of w × h cells (optionally with a door cell and a second room beyond it on the east),
 * player start at (0, py) facing east, plus things by cell.
 */
function arena(opts: { w: number; h: number; py?: number; things?: [number, number, number, number?][]; doorAt?: number; beyond?: number }): MapData {
  const plan = new CellPlan();
  const room = plan.spec({ floor: 0, ceil: 192, light: 200 });
  for (let y = 0; y < opts.h; y++) for (let x = 0; x < opts.w; x++) plan.set(x, y, room);
  if (opts.doorAt !== undefined) {
    const y = opts.py ?? 0;
    plan.set(opts.w, y, plan.spec({ floor: 0, ceil: 128, special: DoorKind.Auto }));
    for (let yy = 0; yy < opts.h; yy++) for (let x = opts.w + 1; x < opts.w + 1 + (opts.beyond ?? 3); x++) plan.set(x, yy, room);
  }
  const b = new MapBuilder();
  emitCellPlan(b, plan, C);
  b.thing(ThingType.PlayerStart, 0.5 * C, ((opts.py ?? 0) + 0.5) * C, 0);
  for (const [type, x, y, flags] of opts.things ?? []) b.thing(type, (x + 0.5) * C, (y + 0.5) * C, 180, flags ?? 0);
  return b.build({ name: 'arena' });
}

function sim(map: MapData) {
  const world = createWorld(map);
  const state = createSimState(world);
  const step = (f: Partial<InputFrame> = {}, n = 1) => {
    for (let i = 0; i < n; i++) stepSim(world, state, { ...EMPTY_INPUT, ...f });
    return state;
  };
  return { world, state, step };
}
const events = (s: SimState, type: string) => s.events.filter((e) => e.type === type);

describe('player weapon', () => {
  it('kills a brute outright with a close blast; at range only the central pellets connect', () => {
    const close = sim(arena({ w: 12, h: 3, py: 1, things: [[EnemyType.Brute, 2, 1]] }));
    close.step({ fire: true });
    expect(close.state.enemies[0]!.mode).toBe('dead');
    const far = sim(arena({ w: 12, h: 3, py: 1, things: [[EnemyType.Brute, 10, 1]] }));
    far.step({ fire: true });
    const e = far.state.enemies[0]!;
    expect(e.mode).not.toBe('dead');
    expect(e.hp).toBeLessThan(ENEMY_DEFS[EnemyType.Brute].hp);
    expect(ENEMY_DEFS[EnemyType.Brute].hp - e.hp).toBeLessThan(PELLETS * PLAYER_DAMAGE);
  });

  it('strikes an enemy right in front instead of shooting', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[EnemyType.Grunt, 1, 0]] }));
    step({ fire: true });
    expect(events(state, 'melee')).toEqual([{ type: 'melee', enemy: 0 }]);
    expect(events(state, 'shot')).toEqual([]);
    expect(state.enemies[0]!.mode).toBe('dead');
    expect(MELEE_DAMAGE).toBeGreaterThan(ENEMY_DEFS[EnemyType.Grunt].hp);
  });

  it('misses when aiming away, and walls stop the shot', () => {
    const away = sim(arena({ w: 8, h: 3, py: 1, things: [[EnemyType.Grunt, 5, 1]] }));
    away.step({ turn: Math.PI / 2 });
    away.step({ fire: true });
    expect(away.state.enemies[0]!.hp).toBe(ENEMY_DEFS[EnemyType.Grunt].hp);

    // Enemy beyond a closed door: the door is a wall until it opens.
    const walled = sim(arena({ w: 3, h: 1, doorAt: 3, things: [[EnemyType.Grunt, 5, 0]] }));
    walled.step({ fire: true });
    expect(walled.state.enemies[0]!.hp).toBe(ENEMY_DEFS[EnemyType.Grunt].hp);
  });

  it('fires a cell of MAG_SIZE shots, then reloads by itself before firing again', () => {
    const { state, step } = sim(arena({ w: 8, h: 3, py: 1 }));
    step({ turn: -Math.PI / 2 }); // face the wall
    const shots: number[] = [];
    let reloadAt = -1;
    let reloadedAt = -1;
    for (let t = 0; t < MAG_SIZE * FIRE_COOLDOWN + RELOAD_TICKS + 5; t++) {
      step({ fire: true });
      if (events(state, 'shot').length) shots.push(state.tick);
      if (events(state, 'reload').length) reloadAt = state.tick;
      if (events(state, 'reloaded').length) reloadedAt = state.tick;
    }
    // Eight shots a cooldown apart; the eighth empties the cell and starts the reload.
    expect(shots.slice(0, MAG_SIZE + 1).map((t) => t - shots[0]!)).toEqual([...Array.from({ length: MAG_SIZE }, (_, i) => i * FIRE_COOLDOWN), (MAG_SIZE - 1) * FIRE_COOLDOWN + RELOAD_TICKS]);
    expect(reloadAt).toBe(shots[MAG_SIZE - 1]);
    expect(reloadedAt - reloadAt).toBe(RELOAD_TICKS);
    expect(state.player.mag).toBe(MAG_SIZE - (shots.length - MAG_SIZE));
  });

  it('reloads early with R, and never with a full cell', () => {
    const { state, step } = sim(arena({ w: 8, h: 3, py: 1 }));
    step({ turn: -Math.PI / 2 });
    step({ reload: true });
    expect(events(state, 'reload')).toEqual([]);
    step({ fire: true });
    expect(state.player.mag).toBe(MAG_SIZE - 1);
    step({ reload: true });
    expect(events(state, 'reload')).toHaveLength(1);
    // No shots through the reload, then a full cell.
    let shot = false;
    for (let t = 0; t < RELOAD_TICKS - 2; t++) {
      step({ fire: true });
      shot ||= events(state, 'shot').length > 0;
    }
    expect(shot).toBe(false);
    step({}, 2);
    expect([state.player.mag, state.player.reload]).toEqual([MAG_SIZE, 0]);
  });

  it('still strikes in melee while reloading', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[EnemyType.Grunt, 1, 0]] }));
    state.player.mag = 1;
    step({ reload: true });
    expect(state.player.reload).toBeGreaterThan(0);
    step({ fire: true });
    expect(events(state, 'melee')).toEqual([{ type: 'melee', enemy: 0 }]);
  });

  it('wakes enemies with gunfire, but not through a closed door', () => {
    const open = sim(arena({ w: 12, h: 3, py: 1, things: [[EnemyType.Brute, 9, 2]] }));
    open.step({ turn: -Math.PI / 2 }); // face the wall so nothing is hit
    open.step({ fire: true });
    expect(open.state.enemies[0]!.mode).toBe('alert');
    const shut = sim(arena({ w: 3, h: 3, py: 1, doorAt: 3, beyond: 6, things: [[EnemyType.Brute, 9, 2]] }));
    shut.step({ fire: true });
    expect(shut.state.enemies[0]!.mode).toBe('idle');
  });
});

describe('enemies', () => {
  it('see the player, then chase along the grid', () => {
    const { state, step } = sim(arena({ w: 10, h: 3, py: 1, things: [[EnemyType.Brute, 8, 1]] }));
    step();
    expect(state.enemies[0]!.mode).toBe('alert');
    step({}, 60);
    expect(state.enemies[0]!.cx).toBeLessThan(8);
  });

  it('brutes hit an adjacent player, and stepping away during the wind-up dodges', () => {
    const def = ENEMY_DEFS[EnemyType.Brute];
    const hit = sim(arena({ w: 4, h: 3, py: 1, things: [[EnemyType.Brute, 1, 1]] }));
    hit.step({}, 200);
    expect(hit.state.player.health).toBeLessThanOrEqual(PLAYER_MAX_HEALTH - def.damage);

    // Walk away the moment the wind-up starts.
    const dodge = sim(arena({ w: 12, h: 3, py: 1, things: [[EnemyType.Brute, 1, 1]] }));
    let dodged = false;
    for (let t = 0; t < 400 && !dodged; t++) {
      const winding = dodge.state.enemies[0]!.mode === 'windup';
      dodge.step(winding ? { strafe: 1 } : {});
      if (winding && events(dodge.state, 'attack').length) dodged = dodge.state.player.health === PLAYER_MAX_HEALTH;
    }
    expect(dodged).toBe(true);
  });

  it('grunt projectiles hit a player who stands still and miss one who sidesteps', () => {
    const still = sim(arena({ w: 10, h: 3, py: 1, things: [[EnemyType.Grunt, 8, 1]] }));
    still.step({}, 400);
    expect(still.state.player.health).toBeLessThan(PLAYER_MAX_HEALTH);

    // One sidestep when the shot is fired takes the player out of its path: follow that
    // projectile until it is gone and check it never hurt anyone.
    const moving = sim(arena({ w: 10, h: 3, py: 1, things: [[EnemyType.Grunt, 8, 1]] }));
    while (!events(moving.state, 'attack').length) moving.step();
    const shot = moving.state.projectiles[0]!;
    moving.step({ strafe: 1 });
    let hurtByShot = false;
    while (moving.state.projectiles.includes(shot)) {
      moving.step();
      if (!moving.state.projectiles.includes(shot)) hurtByShot = events(moving.state, 'hurt').length > 0;
    }
    expect(hurtByShot).toBe(false);
  });

  it('open auto doors on the way to the player', () => {
    const { state, step } = sim(arena({ w: 3, h: 1, doorAt: 3, things: [[EnemyType.Brute, 5, 0]] }));
    step({ fire: true }); // noise does not pass the closed door…
    step({ move: 1 }, STEP_TICKS * 2 + DOOR_OPEN_TICKS + 4); // …so walk up and open it
    step({}, 120);
    expect(state.enemies[0]!.mode).not.toBe('idle');
  });
});

describe('health, death and the exit', () => {
  it('picks up health only when hurt, capped at the maximum', () => {
    const { state, step } = sim(arena({ w: 4, h: 1, things: [[ThingType.Health, 1, 0]] }));
    step({ move: 1 }, STEP_TICKS + 1);
    expect(state.taken[0]).toBe(false);
    state.player.health = PLAYER_MAX_HEALTH - 10;
    step({ move: -1 }, STEP_TICKS + 1);
    step({ move: 1 }, STEP_TICKS + 1);
    expect(state.player.health).toBe(PLAYER_MAX_HEALTH);
    expect(state.taken[0]).toBe(true);
    expect(HEALTH_PICKUP).toBeGreaterThan(10);
  });

  it('freezes the level on death and on reaching the exit', () => {
    const dead = sim(arena({ w: 4, h: 3, py: 1, things: [[EnemyType.Brute, 1, 1]] }));
    dead.step({}, 2000);
    expect(dead.state.dead).toBe(true);
    const tick = dead.state.player.cx;
    dead.step({ move: 1 }, 60);
    expect(dead.state.player.cx).toBe(tick);

    const won = sim(arena({ w: 4, h: 1, things: [[ThingType.Exit, 2, 0]] }));
    won.step({ move: 1 }, STEP_TICKS * 2 + 2);
    expect(won.state.won).toBe(true);
    won.step({ move: 1 }, 60);
    expect(won.state.player.cx).toBe(2);
  });
});

describe('replays with combat', () => {
  it('reproduce the exact state, enemies and projectiles included', async () => {
    const { ReplayRecorder, runReplay, hashState } = await import('../src/index.js');
    const test03 = (await import('@proc-fps/core/maps/test03.json')).default as MapData;
    const world = createWorld(test03);
    const state = createSimState(world);
    const rec = new ReplayRecorder(test03);
    // Deterministic pseudo-random play: strafe, turn, shoot.
    let r = 12345;
    const rand = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let t = 0; t < 900; t++) {
      const f = { ...EMPTY_INPUT, strafe: rand() < 0.1 ? (rand() < 0.5 ? 1 : -1) : 0, turn: (rand() - 0.5) * 0.05, fire: rand() < 0.3 };
      rec.record(f);
      stepSim(world, state, f);
    }
    expect(state.enemies.some((e) => e.mode !== 'idle')).toBe(true);
    expect(hashState(runReplay(test03, rec.finish()))).toBe(hashState(state));
  });
});


describe('bosses drop keys', () => {
  it('leaves the carried key where the carrier dies, for the player to pick up', () => {
    const { state, step } = sim(arena({ w: 8, h: 1, things: [[EnemyType.MiniBoss, 3, 0, dropsKeyFlags(0)]] }));
    for (let t = 0; t < 900 && state.enemies[0]!.mode !== 'dead'; t++) step({ fire: true });
    expect(state.enemies[0]!.mode).toBe('dead');
    expect(state.keys).toBe(0);
    step({ move: 1 }, STEP_TICKS * 4);
    expect(state.keys).toBe(1);
  });
});

describe('per-level enemies', () => {
  it('a generated level uses its seeded stats; a hand-built map the baseline', () => {
    const map = generate('bestiary-7', { level: 3 });
    const world = createWorld(map);
    expect(world.enemyDefs).toEqual(enemyDefsFor('bestiary-7'));
    expect(world.enemyDefs).not.toEqual(ENEMY_DEFS);
    const state = createSimState(world);
    for (const e of state.enemies) expect(e.hp).toBe(world.enemyDefs[e.type].hp);
    expect(createWorld(arena({ w: 3, h: 3 })).enemyDefs).toBe(ENEMY_DEFS);
  });
});
