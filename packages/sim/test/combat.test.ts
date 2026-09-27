import { describe, expect, it } from 'vitest';
import { CELL_SIZE as C, CellPlan, DoorKind, EnemyType, MapBuilder, SPECIAL_LIFT, STEP_TICKS, ThingType, dropsKeyFlags, emitCellPlan, enemyDefsFor, BASELINE_DEFS, defOf, type MapData } from '@proc-fps/core';
import { generate } from '@proc-fps/gen';
import {
  DOOR_OPEN_TICKS,
  EMPTY_INPUT,
  ENEMY_DEFS,
  FIRE_COOLDOWN,
  HEALTH_PICKUP,
  MAG_SIZE,
  RELOAD_TICKS,
  WEAPONS,
  WEAPON_SWITCH_TICKS,
  WeaponId,
  GRENADE,
  falloffAt,
  flankSide,
  MELEE_DAMAGE,
  MELEE_FIRST_HIT,
  MELEE_HITS,
  MELEE_HIT_INTERVAL,
  MELEE_TICKS,
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
/** Ticks after a swing starts during which the chainsword's invulnerability holds (see MELEE_IFRAMES). */
const MELEE_IFRAMES_WINDOW = 28;

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

  it('swings the chainsword at an enemy right in front instead of shooting', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[EnemyType.Grunt, 1, 0]] }));
    step({ fire: true });
    expect(events(state, 'saw')).toEqual([{ type: 'saw' }]);
    expect(events(state, 'shot')).toEqual([]);
    // The blade comes up, then its first grinding hit lands; a grunt does not survive the grind.
    step({}, MELEE_FIRST_HIT);
    expect(events(state, 'melee')).toEqual([{ type: 'melee', enemy: 0 }]);
    expect(MELEE_DAMAGE * MELEE_HITS).toBeGreaterThan(ENEMY_DEFS[EnemyType.Grunt].hp);
    step({}, MELEE_HIT_INTERVAL * MELEE_HITS);
    expect(state.enemies[0]!.mode).toBe('dead');
  });

  it('grinds every enemy in the arc, several times, then recovers before anything else', () => {
    const { state, step } = sim(arena({ w: 6, h: 3, py: 1, things: [[EnemyType.Brute, 1, 1], [EnemyType.Brute, 1, 2]] }));
    const hits = new Map<number, number>();
    let shots = 0;
    for (let t = 0; t < MELEE_TICKS; t++) {
      step({ fire: true });
      for (const e of state.events) {
        if (e.type === 'melee') hits.set(e.enemy, (hits.get(e.enemy) ?? 0) + 1);
        if (e.type === 'shot') shots++;
      }
    }
    // Both brutes (straight ahead, and ahead-left inside the 45° arc) take a hit on every grind
    // until they fall; holding fire meanwhile shoots nothing.
    const needed = Math.ceil(ENEMY_DEFS[EnemyType.Brute].hp / MELEE_DAMAGE);
    expect([hits.get(0), hits.get(1)]).toEqual([needed, needed]);
    expect(state.enemies.map((e) => e.mode)).toEqual(['dead', 'dead']);
    expect(shots).toBe(0);
    expect(state.player.melee).toBe(0);
  });

  it('swings on the melee input even with nothing in reach', () => {
    const { state, step } = sim(arena({ w: 6, h: 1 }));
    step({ melee: true });
    expect(events(state, 'saw')).toEqual([{ type: 'saw' }]);
    expect(state.player.melee).toBeGreaterThan(0);
  });

  it('turns hits away during the attack (invulnerability), not after it', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[EnemyType.Brute, 1, 0]] }));
    // Face away (the grind would stun the brute out of its blow), wait for its wind-up, then
    // swing: its blow lands while the chainsword runs.
    step({ turn: Math.PI });
    for (let t = 0; t < 300 && !events(state, 'windup').length; t++) step({});
    step({ melee: true });
    let shielded = 0;
    let hurt = 0;
    for (let t = 0; t < MELEE_IFRAMES_WINDOW; t++) {
      step({});
      shielded += events(state, 'shielded').length;
      hurt += events(state, 'hurt').length;
    }
    expect(shielded).toBeGreaterThan(0);
    expect(hurt).toBe(0);
    expect(state.player.health).toBe(PLAYER_MAX_HEALTH);
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
    expect(state.player.mags[0]).toBe(MAG_SIZE - (shots.length - MAG_SIZE));
  });

  it('reloads early with R, and never with a full cell', () => {
    const { state, step } = sim(arena({ w: 8, h: 3, py: 1 }));
    step({ turn: -Math.PI / 2 });
    step({ reload: true });
    expect(events(state, 'reload')).toEqual([]);
    step({ fire: true });
    expect(state.player.mags[0]).toBe(MAG_SIZE - 1);
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
    expect([state.player.mags[0], state.player.reload]).toEqual([MAG_SIZE, 0]);
  });

  it('still swings the chainsword while reloading', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[EnemyType.Grunt, 1, 0]] }));
    state.player.mags[0] = 1;
    step({ reload: true });
    expect(state.player.reload).toBeGreaterThan(0);
    step({ fire: true });
    expect(events(state, 'saw')).toEqual([{ type: 'saw' }]);
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

describe('weapons', () => {
  const bolter = WEAPONS[WeaponId.Bolter]!;

  it('switches guns in WEAPON_SWITCH_TICKS, firing nothing meanwhile, and each keeps its magazine', () => {
    const { state, step } = sim(arena({ w: 8, h: 3, py: 1 }));
    step({ turn: -Math.PI / 2 }); // face the wall
    step({ fire: true });
    expect(state.player.mags).toEqual([MAG_SIZE - 1, bolter.magSize, WEAPONS[WeaponId.Railgun]!.magSize]);
    step({ weapon: WeaponId.Bolter });
    expect(events(state, 'switch')).toEqual([{ type: 'switch', weapon: WeaponId.Bolter }]);
    let shots = 0;
    for (let t = 0; t < WEAPON_SWITCH_TICKS - 1; t++) {
      step({ fire: true });
      shots += events(state, 'shot').length;
    }
    expect(shots).toBe(0);
    step({ fire: true }, 2);
    expect(state.player.weapon).toBe(WeaponId.Bolter);
    expect(state.player.mags).toEqual([MAG_SIZE - 1, bolter.magSize - 1, WEAPONS[WeaponId.Railgun]!.magSize]);
  });

  it('fires the bolter at its own rate, and drops a reload in progress on a switch', () => {
    const { state, step } = sim(arena({ w: 8, h: 3, py: 1 }));
    step({ turn: -Math.PI / 2 });
    step({ weapon: WeaponId.Bolter }, WEAPON_SWITCH_TICKS + 1);
    const at: number[] = [];
    for (let t = 0; t < bolter.cooldown * 5; t++) {
      step({ fire: true });
      if (events(state, 'shot').length) at.push(state.tick);
    }
    expect(at.slice(1).map((t, i) => t - at[i]!)).toEqual([bolter.cooldown, bolter.cooldown, bolter.cooldown, bolter.cooldown]);
    step({ reload: true }, 2);
    expect(state.player.reload).toBeGreaterThan(0);
    step({ weapon: WeaponId.Scattergun });
    expect(state.player.reload).toBe(0);
  });

  it('bursts bolts where they hit, catching enemies packed beside the target', () => {
    // Three grunts abreast two cells ahead; a bolt at the middle one hurts its neighbours too.
    const { state, step } = sim(arena({ w: 8, h: 3, py: 1, things: [[EnemyType.Grunt, 3, 0], [EnemyType.Grunt, 3, 1], [EnemyType.Grunt, 3, 2]] }));
    step({ weapon: WeaponId.Bolter }, WEAPON_SWITCH_TICKS + 1);
    const hp = state.enemies.map((e) => e.hp);
    step({ fire: true });
    expect(events(state, 'blast')).toHaveLength(1);
    const lost = state.enemies.map((e, i) => hp[i]! - e.hp);
    expect(lost[1]).toBe(bolter.damage + bolter.splashDamage);
    // The neighbours stand a cell away (128): outside the splash, unlike a packed horde.
    expect(bolter.splashRadius + 20).toBeLessThan(128);
  });

  it('hurts an enemy beside the burst without a direct hit', () => {
    // A bolt into the floor just in front of a grunt (it passes under its body) still catches it.
    const { state, step } = sim(arena({ w: 4, h: 1, things: [[EnemyType.Grunt, 3, 0]] }));
    step({ weapon: WeaponId.Bolter }, WEAPON_SWITCH_TICKS + 1);
    const hp = state.enemies[0]!.hp;
    step({ fire: true, look: -0.185 }); // the floor about 40 units short of the grunt
    expect(events(state, 'blast')).toHaveLength(1);
    expect(state.enemies[0]!.hp).toBeLessThan(hp);
  });

  it('loses scattergun damage with range', () => {
    // The same brute takes a full blast point-blank, a fraction of it from nine cells away.
    const scatter = WEAPONS[WeaponId.Scattergun]!;
    const near = sim(arena({ w: 12, h: 3, py: 1, things: [[EnemyType.Brute, 2, 1]] }));
    const far = sim(arena({ w: 12, h: 3, py: 1, things: [[EnemyType.Brute, 9, 1]] }));
    const hp = far.state.enemies[0]!.hp;
    near.step({ fire: true });
    far.step({ fire: true });
    expect(near.state.enemies[0]!.mode).toBe('dead');
    const lost = hp - far.state.enemies[0]!.hp;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(scatter.pellets * Math.round(scatter.damage * falloffAt(scatter, 9 * 128 - 30)));
    expect(falloffAt(scatter, 100)).toBe(1);
    expect(falloffAt(scatter, 5000)).toBe(0.25);
  });

  it('keeps the scattergun burst-free', () => {
    const { state, step } = sim(arena({ w: 8, h: 3, py: 1 }));
    step({ fire: true });
    expect(events(state, 'blast')).toEqual([]);
    expect(events(state, 'shot')).toEqual([{ type: 'shot', weapon: WeaponId.Scattergun }]);
  });
});

describe('enemy behaviour', () => {
  it('rides a lift to follow the player up a storey', () => {
    // A low room (x 0–3), a corridor (4), a lift (5) up to a high room (6–9). The player waits
    // upstairs; a brute below has to call the lift, ride it up and step off to reach them.
    const plan = new CellPlan();
    const low = plan.spec({ floor: 0, ceil: 192 });
    const high = plan.spec({ floor: 192, ceil: 384 });
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) plan.set(x, y, low);
    plan.set(4, 1, plan.spec({ floor: 0, ceil: 128 }));
    plan.set(5, 1, plan.spec({ floor: 0, ceil: 320, special: SPECIAL_LIFT, tag: 192 }));
    for (let y = 0; y < 3; y++) for (let x = 6; x < 10; x++) plan.set(x, y, high);
    const b = new MapBuilder();
    emitCellPlan(b, plan, C);
    b.thing(ThingType.PlayerStart, 8.5 * C, 1.5 * C, 180);
    b.thing(EnemyType.Brute, 1.5 * C, 1.5 * C, 0);
    const { state, step } = sim(b.build({ name: 'lift-chase' }));
    step({ fire: true }); // the noise wakes it
    let rode = false;
    for (let t = 0; t < 1500 && state.player.health === PLAYER_MAX_HEALTH; t++) {
      step({});
      rode ||= state.enemies[0]!.cx === 5 && state.enemies[0]!.z > 180;
    }
    expect(rode).toBe(true);
    expect(state.enemies[0]!.cx).toBeGreaterThanOrEqual(6);
    expect(state.player.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });

  it('aims one projectile of an even volley straight at the player', () => {
    // A level whose grunts spit twin bolts: one of the pair must fly at the player, not both beside.
    let seed = '';
    for (let i = 0; i < 200 && !seed; i++) if (enemyDefsFor(`twin-${i}`)[EnemyType.Grunt][0]!.volley === 2) seed = `twin-${i}`;
    expect(seed).not.toBe('');
    const map = arena({ w: 8, h: 1, things: [[EnemyType.Grunt, 5, 0]] });
    map.meta.seed = seed;
    const { state, step } = sim(map);
    for (let t = 0; t < 400 && !state.projectiles.length; t++) step({});
    expect(state.projectiles).toHaveLength(2);
    // The player is straight west along the row: a bolt at the aim has no sideways speed.
    expect(Math.min(...state.projectiles.map((q) => Math.abs(q.vy)))).toBeLessThan(1e-9);
  });

  it('flankers go round the other way', () => {
    // A ring corridor (x 0–6, y 0–4) round a solid middle. The player stands at the top middle
    // facing south; a brute at (4, 0) has a shorter way round to the right. Things before it in a
    // sealed pocket set its index, which decides whether it flanks.
    const ring = (fillers: number) => {
      const plan = new CellPlan();
      const floor = plan.spec({ floor: 0, ceil: 192 });
      for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) if (y === 0 || y === 4 || x === 0 || x === 6) plan.set(x, y, floor);
      for (let x = 10; x < 10 + Math.max(1, fillers); x++) plan.set(x, 0, floor);
      const b = new MapBuilder();
      emitCellPlan(b, plan, C);
      b.thing(ThingType.PlayerStart, 3.5 * C, 4.5 * C, 270);
      for (let k = 0; k < fillers; k++) b.thing(EnemyType.Grunt, (10.5 + k) * C, 0.5 * C, 0);
      b.thing(EnemyType.Brute, 4.5 * C, 0.5 * C, 0);
      return b.build({ name: 'ring' });
    };
    const firstMoves = (fillers: number) => {
      const { state, step } = sim(ring(fillers));
      const brute = state.enemies[fillers]!;
      step({ fire: true });
      for (let t = 0; t < 200 && brute.cx === 4; t++) step({});
      return brute.cx;
    };
    expect(flankSide(0, 0)).toBe(-1); // index 0 goes direct …
    expect(flankSide(4, 0)).toBe(1); // … index 4 flanks to the player's right
    expect(firstMoves(0)).toBe(5); // direct: the short way, right
    expect(firstMoves(4)).toBe(3); // flanking to the player's right (their west): the long way, left
  });
});

describe('damage direction', () => {
  it('hurt events say where the hit came from: a brute in melee, a grunt bolt', () => {
    for (const [type, x] of [[EnemyType.Brute, 1], [EnemyType.Grunt, 6]] as const) {
      const { state, step } = sim(arena({ w: 8, h: 1, things: [[type, x, 0]] }));
      let from: { x: number; y: number } | undefined;
      for (let t = 0; t < 600 && !from; t++) {
        step({});
        const hurt = state.events.find((e) => e.type === 'hurt');
        if (hurt?.type === 'hurt') from = hurt.from;
      }
      // The enemy stands east of the player (who faces east): the hit comes from ahead.
      expect(from).toBeDefined();
      expect(from!.x).toBeGreaterThan(state.player.x);
      expect(Math.abs(from!.y - state.player.y)).toBeLessThan(C);
    }
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
    expect(world.enemyDefs).not.toEqual(BASELINE_DEFS);
    const state = createSimState(world);
    for (const e of state.enemies) expect(e.hp).toBe(defOf(world.enemyDefs, e).hp);
    expect(state.enemies.some((e) => e.variant === 1)).toBe(true); // the generator uses both variants
    expect(createWorld(arena({ w: 3, h: 3 })).enemyDefs).toBe(BASELINE_DEFS);
  });
});

describe('boss fights', async () => {
  const { bossAttack, nextPattern, MAX_ADDS, SLAM_RADIUS } = await import('../src/boss.js');
  /** A 10 × 5 room with the boss at (6, 2) and the player at (0, 2). */
  const fight = () => {
    const s = sim(arena({ w: 10, h: 5, py: 2, things: [[EnemyType.Boss, 6, 2]] }));
    const world = createWorld(arena({ w: 10, h: 5, py: 2, things: [[EnemyType.Boss, 6, 2]] }));
    return { ...s, world, boss: s.state.enemies[0]!, def: world.enemyDefs[EnemyType.Boss][0]! };
  };

  it('moves through its phases as its health drops', () => {
    const { state, step, boss, def } = fight();
    boss.hp = Math.floor(def.hp * 0.6);
    step({});
    expect(events(state, 'phase')).toEqual([{ type: 'phase', enemy: 0, phase: 1 }]);
    boss.hp = Math.floor(def.hp * 0.3);
    step({});
    expect(boss.phase).toBe(2);
  });

  it('bursts a ring of projectiles in every direction, which the chainsword cannot turn away', () => {
    const { state, world, boss, def } = fight();
    bossAttack(world, state, boss, def, 0, 'ring');
    expect(state.projectiles.length).toBeGreaterThanOrEqual(10);
    const angles = state.projectiles.map((q) => Math.atan2(q.vy, q.vx));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI * 1.5);
    expect(state.projectiles.every((q) => q.unblockable)).toBe(true);
  });

  it('summons grunts around itself, up to a cap', () => {
    const { state, world, boss, def } = fight();
    bossAttack(world, state, boss, def, 0, 'summon');
    const adds = state.enemies.filter((e) => e.summoner === 0);
    expect(adds.length).toBeGreaterThan(0);
    for (const a of adds) expect(Math.abs(a.cx - boss.cx) + Math.abs(a.cy - boss.cy)).toBeGreaterThanOrEqual(2);
    for (let k = 0; k < 5; k++) bossAttack(world, state, boss, def, 0, 'summon');
    expect(state.enemies.filter((e) => e.summoner === 0 && e.mode !== 'dead').length).toBeLessThanOrEqual(MAX_ADDS);
  });

  it('slams everyone close on its floor, chainsword or not, and nobody farther', () => {
    const near = fight();
    near.state.player.x = near.boss.x - SLAM_RADIUS + 20;
    near.state.player.melee = 5; // mid-swing: invulnerable to anything else
    bossAttack(near.world, near.state, near.boss, near.def, 0, 'slam');
    expect(near.state.player.health).toBe(PLAYER_MAX_HEALTH - Math.round(near.def.damage * 2.5));
    const far = fight();
    bossAttack(far.world, far.state, far.boss, far.def, 0, 'slam');
    expect(far.state.player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it('skips a slam from afar, and widens its volleys when enraged', () => {
    const { state, step, boss, def } = fight();
    boss.attacks = 3; // the slam's turn in phase 0 (volley, ring, wall, slam)
    expect(nextPattern(state, boss, 0)).not.toBe('slam');
    boss.hp = Math.floor(def.hp * 0.2);
    boss.mode = 'windup';
    boss.pattern = 'volley';
    boss.timer = 1;
    step({});
    expect(boss.phase).toBe(2);
    expect(state.projectiles.length).toBe(def.volley + 2);
    expect(state.projectiles.every((q) => q.unblockable)).toBe(true);
  });
});

describe('grenades', () => {
  it('lobs one of the grenades carried, arcing down to burst ahead, and none when out', () => {
    const { state, step } = sim(arena({ w: 12, h: 3, py: 1 }));
    expect(state.player.grenades).toBe(GRENADE.start);
    step({ grenade: true });
    expect(events(state, 'grenade')).toHaveLength(1);
    expect(state.player.grenades).toBe(GRENADE.start - 1);
    const n = state.grenades[0]!;
    const vz = n.vz;
    step({});
    expect(n.vz).toBeLessThan(vz); // gravity
    let burst: { x: number; z: number } | undefined;
    for (let t = 0; t < GRENADE.fuse && !burst; t++) {
      step({});
      const e = state.events.find((x) => x.type === 'explode');
      if (e?.type === 'explode') burst = e;
    }
    expect(burst).toBeDefined();
    expect(burst!.x).toBeGreaterThan(state.player.x + 3 * C); // a level throw carries several cells
    expect(burst!.z).toBeLessThanOrEqual(1); // it came down on the floor
    step({ grenade: true }, GRENADE.cooldown);
    expect(state.grenades).toHaveLength(0); // none left to throw
  });

  it('hurts enemies near the burst, most at its centre, and spares those beyond its reach', () => {
    // Brutes 3 and 4 cells ahead, and one far down the room; the grenade bursts among the first two.
    const { state, step } = sim(arena({ w: 16, h: 1, things: [[EnemyType.Brute, 3, 0], [EnemyType.Brute, 4, 0], [EnemyType.Brute, 12, 0]] }));
    const hp = state.enemies.map((e) => e.hp);
    step({ grenade: true, look: -0.1 });
    let at = 0;
    for (let t = 0; t < GRENADE.fuse && !at; t++) {
      step({});
      const e = state.events.find((x) => x.type === 'explode');
      if (e?.type === 'explode') at = e.x;
    }
    const lost = state.enemies.map((e, i) => hp[i]! - e.hp);
    const [near, next] = Math.abs(state.enemies[0]!.x - at) <= Math.abs(state.enemies[1]!.x - at) ? [0, 1] : [1, 0];
    expect(lost[near]).toBeGreaterThan(0);
    expect(lost[near]).toBeGreaterThanOrEqual(lost[next]!);
    expect(Math.max(...lost)).toBeLessThanOrEqual(GRENADE.damage);
    expect(lost[2]).toBe(0);
  });

  it('picks grenades up, up to the most that can be carried', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[ThingType.Grenade, 1, 0], [ThingType.Grenade, 2, 0], [ThingType.Grenade, 3, 0]] }));
    for (let k = 0; k < 3; k++) step({ move: 1 }, STEP_TICKS + 1);
    expect(state.player.grenades).toBe(GRENADE.max);
    expect(state.taken.filter(Boolean).length).toBe(GRENADE.max - GRENADE.start);
  });
});

describe('projectile patterns', async () => {
  const { bossAttack } = await import('../src/boss.js');
  const { stepEmitters, SPIRAL, SPLIT, WALL } = await import('../src/shots.js');
  /** A generated level's seed whose first grunt variant spits `shot`. */
  const seedFor = (shot: 'lob' | 'homing') => {
    for (let i = 0; i < 400; i++) if (enemyDefsFor(`${shot}-${i}`)[EnemyType.Grunt][0]!.shot === shot) return `${shot}-${i}`;
    throw new Error(`no seed with ${shot} grunts`);
  };
  const shooter = (shot: 'lob' | 'homing') => {
    const map = arena({ w: 9, h: 3, py: 1, things: [[EnemyType.Grunt, 6, 1]] });
    map.meta.seed = seedFor(shot);
    return sim(map);
  };
  /** Steps until the enemy's first shot, then with `after` until that shot is gone; whether it hurt. */
  const follow = (s: ReturnType<typeof sim>, after: (t: number) => Partial<InputFrame>) => {
    while (!events(s.state, 'attack').length) s.step();
    const shot = s.state.projectiles[0]!;
    let hurt = false;
    let splashed = false;
    for (let t = 0; s.state.projectiles.includes(shot); t++) {
      s.step(after(t));
      if (s.state.projectiles.includes(shot)) continue;
      hurt = events(s.state, 'hurt').length > 0;
      splashed = events(s.state, 'splash').length > 0;
    }
    return { shot, hurt, splashed };
  };

  it('lobs arc up and burst where the player stood: a hit standing still, a miss one step away', () => {
    const still = follow(shooter('lob'), () => ({}));
    expect(still.shot.kind).toBe('lob');
    expect(still.hurt).toBe(true);
    const moved = shooter('lob');
    const { hurt, splashed } = follow(moved, (t) => (t === 0 ? { strafe: 1 } : {}));
    expect(splashed).toBe(true); // it burst on the floor beside the player
    expect(hurt).toBe(false);
  });

  it('homing orbs turn after a player who sidesteps, and still find one who then stands', () => {
    const s = shooter('homing');
    const { shot, hurt } = follow(s, (t) => (t === 0 ? { strafe: 1 } : {}));
    expect(shot.kind).toBe('homing');
    expect(Math.abs(shot.vy)).toBeGreaterThan(0.1); // it bent off the row towards the new lane
    expect(hurt).toBe(true);
  });

  it('walls leave a gap a step to one side of the player, and one shot in their lane', () => {
    const { state, world, boss, def } = (() => {
      const s = sim(arena({ w: 10, h: 7, py: 3, things: [[EnemyType.Boss, 7, 3]] }));
      return { ...s, boss: s.state.enemies[0]!, def: s.world.enemyDefs[EnemyType.Boss][0]! };
    })();
    bossAttack(world, state, boss, def, 0, 'wall');
    expect(state.projectiles).toHaveLength(WALL.shots - 2);
    // The player is due west: lanes are the shots' y offsets from the player's row.
    const lanes = state.projectiles.map((q) => q.y - state.player.y);
    expect(Math.min(...lanes.map(Math.abs))).toBeLessThan(1);
    const clear = (side: number) => lanes.every((l) => Math.abs(l - side * C) > 16 + 6);
    expect(clear(1) || clear(-1)).toBe(true);
    expect(state.projectiles.every((q) => q.unblockable)).toBe(true);
  });

  it('split shots burst into a fan part of the way there', () => {
    const s = sim(arena({ w: 10, h: 5, py: 2, things: [[EnemyType.Boss, 8, 2]] }));
    const boss = s.state.enemies[0]!;
    boss.cooldown = 10_000; // keep it from attacking on its own
    bossAttack(s.world, s.state, boss, s.world.enemyDefs[EnemyType.Boss][0]!, 0, 'split');
    expect(s.state.projectiles.map((q) => q.kind)).toEqual(['split']);
    const x0 = s.state.projectiles[0]!.x;
    for (let t = 0; t < 400 && !events(s.state, 'split').length; t++) s.step({});
    const burst = events(s.state, 'split')[0] as { x: number } | undefined;
    expect(burst).toBeDefined();
    expect(burst!.x).toBeLessThan(x0 - C); // well on its way before it burst
    expect(s.state.projectiles).toHaveLength(SPLIT.into);
    const dirs = s.state.projectiles.map((q) => q.vy / Math.hypot(q.vx, q.vy));
    expect(Math.max(...dirs) - Math.min(...dirs)).toBeGreaterThan(0.5);
  });

  it('spirals spin shots out all round over time, and stop when the boss dies', () => {
    const s = sim(arena({ w: 10, h: 5, py: 2, things: [[EnemyType.Boss, 6, 2]] }));
    const boss = s.state.enemies[0]!;
    const def = s.world.enemyDefs[EnemyType.Boss][0]!;
    bossAttack(s.world, s.state, boss, def, 0, 'spiral');
    expect(s.state.emitters).toHaveLength(1);
    const arms = s.state.emitters[0]!.arms;
    const eye = () => boss.z + def.height * 0.5;
    for (let t = 0; t < 4; t++) stepEmitters(s.state, eye);
    expect(s.state.projectiles.length).toBe(arms * 2); // emissions on ticks 0 and SPIRAL.every
    for (let t = 0; t < SPIRAL.emissions * SPIRAL.every; t++) stepEmitters(s.state, eye);
    expect(s.state.projectiles.length).toBe(arms * SPIRAL.emissions);
    expect(s.state.emitters).toHaveLength(0);
    const angles = s.state.projectiles.map((q) => Math.atan2(q.vy, q.vx));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI * 1.5);

    bossAttack(s.world, s.state, boss, def, 0, 'spiral');
    boss.mode = 'dead';
    stepEmitters(s.state, eye);
    expect(s.state.emitters).toHaveLength(0);
  });
});

describe('new roles', () => {
  it('chargers wind up in a lane and rush down it: a hit on a player who stays', () => {
    const s = sim(arena({ w: 10, h: 3, py: 1, things: [[EnemyType.Charger, 6, 1]] }));
    const charger = s.state.enemies[0]!;
    for (let t = 0; t < 300 && !events(s.state, 'charge').length; t++) s.step({});
    expect(events(s.state, 'charge')).toHaveLength(1);
    let hurt = 0;
    for (let t = 0; t < 120 && charger.mode === 'charge'; t++) hurt += events(s.step({}), 'hurt').length;
    expect(hurt).toBe(1);
    expect(s.state.player.health).toBe(PLAYER_MAX_HEALTH - ENEMY_DEFS[EnemyType.Charger].damage);
    expect(Math.abs(charger.cx - s.state.player.cx) + Math.abs(charger.cy - s.state.player.cy)).toBe(1);
  });

  it('chargers miss a player who steps out of the lane, crash into the wall and lie stunned', () => {
    const s = sim(arena({ w: 10, h: 3, py: 1, things: [[EnemyType.Charger, 6, 1]] }));
    const charger = s.state.enemies[0]!;
    for (let t = 0; t < 300 && !events(s.state, 'windup').length; t++) s.step({});
    s.step({ strafe: 1 }, STEP_TICKS + 2);
    let crashed = false;
    for (let t = 0; t < 200 && !crashed; t++) crashed = events(s.step({}), 'crash').length > 0;
    expect(crashed).toBe(true);
    expect(charger.cx).toBe(0);
    expect(charger.mode).toBe('pain');
    expect(s.state.player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it('bloaters burst next to the player; getting away in time escapes it', () => {
    const stay = sim(arena({ w: 10, h: 1, things: [[EnemyType.Bloater, 4, 0]] }));
    for (let t = 0; t < 400 && !events(stay.state, 'explode').length; t++) stay.step({});
    expect(events(stay.state, 'explode')).toHaveLength(1);
    expect(stay.state.enemies[0]!.mode).toBe('dead');
    expect(stay.state.player.health).toBeLessThan(PLAYER_MAX_HEALTH);

    const run = sim(arena({ w: 12, h: 1, things: [[EnemyType.Bloater, 8, 0]] }));
    run.state.player.cx = run.state.player.fromCx = 5;
    for (let t = 0; t < 400 && !events(run.state, 'windup').length; t++) run.step({});
    let exploded = false;
    for (let t = 0; t < 120 && !exploded; t++) exploded = events(run.step({ move: -1 }), 'explode').length > 0;
    expect(exploded).toBe(true);
    expect(run.state.player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it('a bloater shot among others takes them with it', () => {
    const s = sim(arena({ w: 8, h: 3, py: 1, things: [[EnemyType.Bloater, 3, 1], [EnemyType.Grunt, 3, 2], [EnemyType.Grunt, 4, 1]] }));
    s.step({ fire: true });
    expect(s.state.enemies[0]!.mode).toBe('dead');
    expect(events(s.state, 'explode')).toHaveLength(1);
    const hurt = s.state.enemies.slice(1).filter((e) => e.mode === 'dead' || e.hp < ENEMY_DEFS[EnemyType.Grunt].hp);
    expect(hurt).toHaveLength(2);
    expect(s.state.player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it('wardens stop shots from the front, not from behind, and not while they wind up', () => {
    const map = arena({ w: 8, h: 3, py: 1, things: [[EnemyType.Warden, 3, 1]] });
    const front = sim(map);
    const warden = front.state.enemies[0]!;
    expect(warden.fx).toBeCloseTo(-1); // placed facing west, at the player
    front.step({ fire: true });
    expect(events(front.state, 'blocked')).toHaveLength(1);
    expect(warden.hp).toBe(ENEMY_DEFS[EnemyType.Warden].hp);

    const behind = sim(map);
    [behind.state.enemies[0]!.fx, behind.state.enemies[0]!.fy] = [1, 0];
    behind.step({ fire: true });
    expect(events(behind.state, 'blocked')).toHaveLength(0);
    expect(behind.state.enemies[0]!.hp).toBeLessThan(ENEMY_DEFS[EnemyType.Warden].hp);

    const winding = sim(map);
    Object.assign(winding.state.enemies[0]!, { mode: 'windup', timer: 20 });
    winding.step({ fire: true });
    expect(events(winding.state, 'blocked')).toHaveLength(0);
    expect(winding.state.enemies[0]!.hp).toBeLessThan(ENEMY_DEFS[EnemyType.Warden].hp);
  });

  it('wardens turn their shield towards the player, slowly', () => {
    const s = sim(arena({ w: 8, h: 5, py: 2, things: [[EnemyType.Warden, 4, 2]] }));
    const w = s.state.enemies[0]!;
    [w.fx, w.fy] = [0, 1]; // facing north, the player due west
    w.mode = 'chase';
    w.cooldown = 1000;
    s.step({});
    expect(w.fx!).toBeLessThan(0);
    expect(w.fx!).toBeGreaterThan(-0.1); // one tick turns it only a little
    s.step({}, 120);
    expect(w.fx!).toBeLessThan(-0.99);
  });
});

describe('armour and power-ups', async () => {
  const { ARMOR, BERSERK, OVERCHARGE } = await import('@proc-fps/core');
  const { hurtPlayer } = await import('../src/index.js');

  it('armour soaks up half of each hurt until it runs out; a full vest stays on the floor', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[ThingType.Armor, 1, 0], [ThingType.Armor, 2, 0], [ThingType.Armor, 3, 0]] }));
    for (let k = 0; k < 3; k++) step({ move: 1 }, STEP_TICKS + 1);
    expect(state.player.armor).toBe(ARMOR.max);
    expect(state.taken.filter(Boolean)).toHaveLength(2);
    hurtPlayer(state, 20);
    expect([state.player.health, state.player.armor]).toEqual([PLAYER_MAX_HEALTH - 10, ARMOR.max - 10]);
    state.player.armor = 3;
    hurtPlayer(state, 20);
    expect([state.player.health, state.player.armor]).toEqual([PLAYER_MAX_HEALTH - 10 - 17, 0]);
  });

  it('berserk: picked up it heals; the chainsword hits three times as hard and heals as it lands; then it wears off', () => {
    const { state, step } = sim(arena({ w: 6, h: 1, things: [[ThingType.Berserk, 1, 0], [EnemyType.Brute, 2, 0]] }));
    state.player.health = 30;
    step({ move: 1 }, STEP_TICKS + 1);
    expect(state.player.berserk).toBeGreaterThan(0);
    expect(state.player.health).toBe(30 + BERSERK.heal);
    const brute = state.enemies[0]!;
    brute.mode = 'chase';
    brute.cooldown = 1000;
    let health = state.player.health;
    step({ fire: true });
    for (let t = 0; t < MELEE_FIRST_HIT + 2 && state.enemies[0]!.mode !== 'dead'; t++) step({});
    expect(state.enemies[0]!.mode).toBe('dead'); // one savage hit (3 × 20) fells a brute (55)
    expect(state.player.health).toBe(health + BERSERK.leech);
    health = state.player.health;
    let worn = false;
    for (let t = 0; t < BERSERK.ticks + 5 && !worn; t++) worn = events(step({}), 'powerdown').length > 0;
    expect(worn).toBe(true);
    expect(state.player.berserk).toBe(0);
  });

  it('overcharge doubles the guns\' damage and fires faster', () => {
    const shoot = (overcharge: number) => {
      const s = sim(arena({ w: 8, h: 1, things: [[EnemyType.Brute, 4, 0]] }));
      s.state.player.overcharge = overcharge;
      s.step({ fire: true });
      return { loss: ENEMY_DEFS[EnemyType.Brute].hp - s.state.enemies[0]!.hp, cooldown: s.state.player.fireCooldown };
    };
    const plain = shoot(0);
    const boosted = shoot(OVERCHARGE.ticks);
    expect(plain.loss).toBeGreaterThan(0);
    expect(boosted.loss).toBeGreaterThanOrEqual(plain.loss * 1.8);
    expect(boosted.cooldown).toBeLessThan(plain.cooldown);
  });
});

describe('line of sight', async () => {
  const { sightLine } = await import('../src/index.js');
  it('a raised lift between a sniper and the player blocks its sight and its shot; lowered, it does not', () => {
    const plan = new CellPlan();
    const hall = plan.spec({ floor: 0, ceil: 320, light: 200 });
    for (let x = 0; x < 7; x++) plan.set(x, 0, x === 3 ? plan.spec({ floor: 0, ceil: 320, light: 200, special: SPECIAL_LIFT, tag: 192 }) : hall);
    const b = new MapBuilder();
    emitCellPlan(b, plan, C);
    b.thing(ThingType.PlayerStart, 0.5 * C, 0.5 * C, 0);
    b.thing(EnemyType.Sniper, 6.5 * C, 0.5 * C, 180);
    const s = sim(b.build({ name: 'lift-cover' }));
    const sniper = s.state.enemies[0]!;
    const def = s.world.enemyDefs[EnemyType.Sniper][0]!;
    expect(sightLine(s.world, s.state, sniper, def)).not.toBeNull();
    s.state.lifts[0]!.pos = s.world.lifts[0]!.travel; // up at the top: a block of floor 192 high
    expect(sightLine(s.world, s.state, sniper, def)).toBeNull();
    // Mid wind-up when the lift rises: the shot does not land.
    Object.assign(sniper, { mode: 'windup', timer: 1 });
    s.step({});
    expect(events(s.state, 'attack')).toHaveLength(1);
    expect(s.state.player.health).toBe(PLAYER_MAX_HEALTH);
  });
});

describe('run perks', async () => {
  const { PERKS, PERK_IDS, perkMods, perkOffer, UNDYING_HEALTH, ARMOR } = await import('@proc-fps/core');
  const { hurtPlayer, ReplayRecorder, runReplay, hashState, magSizeOf } = await import('../src/index.js');
  const withPerks = (perks: Parameters<typeof perkMods>[0]) => {
    const map = arena({ w: 6, h: 1 });
    const world = createWorld(map, perks);
    return { world, state: createSimState(world) };
  };

  it('stack up to their max, and fold into mods', () => {
    const m = perkMods(['hide', 'hide', 'hide', 'hide', 'slugs', 'drums', 'plating', 'plating']);
    expect(m.maxHealth).toBe(PLAYER_MAX_HEALTH + 60); // hide is capped at 3
    expect(m.damageScale).toBeCloseTo(1.15);
    expect(m.magScale).toBe(1.5);
    expect(m.startArmor).toBe(50);
    expect(perkMods([]).maxHealth).toBe(PLAYER_MAX_HEALTH);
  });

  it('are offered three at a time, the same for a run and level, never one already maxed', () => {
    const offer = perkOffer('run-a', 2, []);
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
    expect(perkOffer('run-a', 2, [])).toEqual(offer);
    const maxed = PERK_IDS.filter((id) => PERKS[id].max === 1);
    for (let l = 1; l < 30; l++) for (const id of perkOffer('run-b', l, maxed)) expect(maxed).not.toContain(id);
  });

  it('change the player from the start of each level', () => {
    const { world, state } = withPerks(['hide', 'plating', 'drums', 'pockets']);
    expect(state.player.health).toBe(PLAYER_MAX_HEALTH + 20);
    expect(state.player.armor).toBe(25);
    expect(state.player.mags[0]).toBe(Math.round(WEAPONS[0]!.magSize * 1.5));
    expect(magSizeOf(world, 0)).toBe(state.player.mags[0]);
    expect(state.player.grenades).toBe(GRENADE.start + 1);
  });

  it('undying turns one killing blow a level, not two', () => {
    const { state } = withPerks(['undying']);
    hurtPlayer(state, 500);
    expect(state.player.health).toBe(UNDYING_HEALTH);
    expect(state.dead).toBe(false);
    expect(events(state, 'undying')).toHaveLength(1);
    hurtPlayer(state, 500);
    expect(state.dead).toBe(true);
  });

  it('are recorded in replays, which reproduce the run exactly', () => {
    const map = arena({ w: 8, h: 1, things: [[EnemyType.Grunt, 5, 0]] });
    const perks = ['slugs', 'hands'] as const;
    const world = createWorld(map, perks);
    const state = createSimState(world);
    const rec = new ReplayRecorder(map, perks);
    for (let t = 0; t < 200; t++) {
      const f = { ...EMPTY_INPUT, fire: t % 20 === 0 };
      rec.record(f);
      stepSim(world, state, f);
    }
    const replay = rec.finish();
    expect(replay.perks).toEqual(perks);
    expect(hashState(runReplay(map, replay))).toBe(hashState(state));
    expect(ARMOR.max).toBeGreaterThan(0);
  });
});

describe('railgun', () => {
  const rail = WEAPONS[WeaponId.Railgun]!;
  it('goes through every enemy in a line to the wall, each at full damage', () => {
    const s = sim(arena({ w: 10, h: 1, things: [[EnemyType.Brute, 2, 0], [EnemyType.Brute, 4, 0], [EnemyType.Brute, 6, 0]] }));
    s.step({ weapon: WeaponId.Railgun }, WEAPON_SWITCH_TICKS + 1);
    s.step({ fire: true });
    expect(events(s.state, 'shot')).toEqual([{ type: 'shot', weapon: WeaponId.Railgun }]);
    for (const e of s.state.enemies) expect(e.mode).toBe('dead'); // 70 each fells a brute (55)
    expect(s.state.player.mags[WeaponId.Railgun]).toBe(rail.magSize - 1);
  });

  it('is not stopped by a warden\'s shield, and walls stop it', () => {
    const s = sim(arena({ w: 8, h: 3, py: 1, things: [[EnemyType.Warden, 3, 1]] }));
    s.step({ weapon: WeaponId.Railgun }, WEAPON_SWITCH_TICKS + 1);
    s.step({ fire: true });
    expect(events(s.state, 'blocked')).toHaveLength(0);
    expect(s.state.enemies[0]!.mode).toBe('dead');
    // Behind a pillar-free wall: a door that is shut.
    const d = sim(arena({ w: 3, h: 1, doorAt: 3, things: [[EnemyType.Grunt, 5, 0]] }));
    d.step({ weapon: WeaponId.Railgun }, WEAPON_SWITCH_TICKS + 1);
    d.step({ fire: true });
    expect(d.state.enemies[0]!.hp).toBe(ENEMY_DEFS[EnemyType.Grunt].hp);
  });

  it('fires slowly: nothing more until its cooldown has passed', () => {
    const s = sim(arena({ w: 8, h: 3, py: 1 }));
    s.step({ weapon: WeaponId.Railgun }, WEAPON_SWITCH_TICKS + 1);
    let shots = 0;
    for (let t = 0; t < rail.cooldown; t++) shots += events(s.step({ fire: true }), 'shot').length;
    expect(shots).toBe(1);
  });
});

describe('water', async () => {
  const { SPECIAL_WATER, WATER_STEP_SCALE } = await import('@proc-fps/core');
  /** A row of cells, water from x = 2 on. */
  const wetRow = (things: [number, number, number][] = []) => {
    const plan = new CellPlan();
    const dry = plan.spec({ floor: 0, ceil: 192, light: 200 });
    const wet = plan.spec({ floor: 0, ceil: 192, light: 200, special: SPECIAL_WATER });
    for (let x = 0; x < 8; x++) plan.set(x, 0, x >= 2 ? wet : dry);
    const b = new MapBuilder();
    emitCellPlan(b, plan, C);
    b.thing(ThingType.PlayerStart, 0.5 * C, 0.5 * C, 0);
    for (const [type, x, y] of things) b.thing(type, (x + 0.5) * C, (y + 0.5) * C, 180);
    return b.build({ name: 'wet' });
  };

  it('slows the player\'s steps into and through it', () => {
    const s = sim(wetRow());
    /** Ticks one step takes: a single press, then waiting until the player stands still. */
    const oneStep = () => {
      s.step({ move: 1 });
      let t = 1;
      while (s.state.player.stepTick !== 0 && t < 200) {
        s.step({});
        t++;
      }
      return t;
    };
    const dry = oneStep();
    const wet = oneStep();
    expect(s.state.player.cx).toBe(2);
    expect(wet).toBeGreaterThan(dry * (WATER_STEP_SCALE - 0.1));
  });

  it('slows enemies wading through it too', () => {
    const s = sim(wetRow([[EnemyType.Grunt, 6, 0]]));
    const grunt = s.state.enemies[0]!;
    grunt.mode = 'chase';
    grunt.cooldown = 10_000;
    let steps = 0;
    for (let t = 0; t < 200; t++) {
      s.step({});
      if (grunt.stepTick === 1) steps++;
    }
    const dryPace = Math.ceil(200 / (ENEMY_DEFS[EnemyType.Grunt].stepTicks + 1));
    expect(steps).toBeLessThan(dryPace);
    expect(steps).toBeGreaterThan(0);
  });
});
