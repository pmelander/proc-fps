import { CELL_SIZE, DoorKind, MAG_SIZE, MELEE_FIRST_HIT, MELEE_IFRAMES, MELEE_TICKS, RELOAD_TICKS, HEADING_DX, HEADING_DY, PLAYER_EYE_HEIGHT, STEP_TICKS, TICK_DT, isEnemyThing, type MapData } from '@proc-fps/core';
import { GENERATOR_VERSION, generate, isLevelType, validateGenerated, type LevelType } from '@proc-fps/gen';
import { BASELINE_LOOKS, HIDDEN_OFFSET, LevelRenderer, SpriteShape, THEME_COLORS, WebGL2Backend, enemyLooks, spriteTile, type Sprite } from '@proc-fps/render';
import {
  PLAYER_MAX_HEALTH,
  ReplayRecorder,
  clonePlayer,
  createSimState,
  createWorld,
  doorAtCell,
  doorOffset,
  liftHeight,
  pickupCell,
  stepSim,
  type EnemyState,
  type PlayerState,
  type SimState,
  type World,
} from '@proc-fps/sim';
import test01 from '@proc-fps/core/maps/test01.json';
import test02 from '@proc-fps/core/maps/test02.json';
import test03 from '@proc-fps/core/maps/test03.json';
import test04 from '@proc-fps/core/maps/test04.json';
import test05 from '@proc-fps/core/maps/test05.json';
import test06 from '@proc-fps/core/maps/test06.json';
import { AudioEngine } from './audio/engine.js';
import type { SoundId } from './audio/sounds.js';
import { drawAutomap } from './automap.js';
import { Chainsword } from './chainsword.js';
import { Gore } from './gore.js';
import { Weapon } from './weapon.js';
import { InputSampler } from './input.js';
import { KEY_COLORS, KEY_NAMES } from './keys.js';

const TEST_MAPS: Record<string, MapData> = { test01: test01 as MapData, test02: test02 as MapData, test03: test03 as MapData, test04: test04 as MapData, test05: test05 as MapData, test06: test06 as MapData };
const NOTICE_SECONDS = 2.5;
/** The exit hums every so often while the player is within range (map units), under a beacon of light. */
const EXIT_HUM_TICKS = 96;
const EXIT_HUM_RANGE = 10 * CELL_SIZE;
const EXIT_BEACON_HEIGHT = 160;
/** Dev: run the sim without the pointer lock (the in-app preview cannot take it). */
const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');
/** Dev: hold the trigger (with autoplay, to see the gun and gore without input). */
const AUTOFIRE = new URLSearchParams(location.search).has('autofire');
const MAX_FRAME_TIME = 0.25; // avoid spiral of death after tab-out
const BOB_HEIGHT = 2.5;
const HEADING_LETTERS = ['E', 'N', 'W', 'S'] as const;

/** Render-only head bob from step progress. */
function bob(p: PlayerState): number {
  return p.stepTick === 0 ? 0 : Math.sin((Math.PI * p.stepTick) / STEP_TICKS) * BOB_HEIGHT;
}

/**
 * Which level to play, from the URL:
 * - ?run=<id>&level=<n>: level n of a run; its seed is "<id>-<n>", difficulty rises with n and the
 *   level type follows the run's pacing (compound, ascent, compound, descent, …).
 * - ?seed=<s>[&level=<n>][&type=compound|ascent|descent]: one seed (level 1 unless given).
 * - ?map=<name>: a hand-made test map.
 * - nothing: a fresh run at level 1.
 */
interface Where {
  run?: string;
  seed?: string;
  level: number;
  /** Overrides the pacing's level type. */
  type?: LevelType;
}

function where(): Where & { map?: string } {
  const params = new URLSearchParams(location.search);
  const level = Math.max(1, Number(params.get('level') ?? 1) || 1);
  const map = params.get('map');
  if (map) return { map, level };
  const run = params.get('run');
  if (run) return { run, level };
  const seed = params.get('seed');
  const type = params.get('type');
  if (seed) return isLevelType(type) ? { seed, level, type } : { seed, level };
  const fresh = newRunId();
  history.replaceState(null, '', `?${new URLSearchParams({ run: fresh, level: '1' }).toString()}`);
  return { run: fresh, level: 1 };
}

/** UI-level randomness only; the sim never sees it. */
const newRunId = () => Math.random().toString(36).slice(2, 8);

function loadMap(w: Where & { map?: string }): MapData {
  if (w.map) {
    const m = TEST_MAPS[w.map];
    if (!m) throw new Error(`unknown test map "${w.map}"`);
    return m;
  }
  const seed = w.run ? `${w.run}-${w.level}` : w.seed!;
  const map = generate(seed, w.type ? { level: w.level, type: w.type } : { level: w.level });
  const errors = validateGenerated(map);
  if (errors.length) console.warn(`seed ${seed} failed validation:`, errors);
  return map;
}

/** A fresh run at level 1. */
function newRun(): void {
  location.search = new URLSearchParams({ run: newRunId(), level: '1' }).toString();
}

/** The next level of this run (a single seed becomes a run named after it). */
function nextLevel(w: Where): void {
  location.search = new URLSearchParams({ run: w.run ?? w.seed ?? newRunId(), level: String(w.level + 1) }).toString();
}

function clock(ticks: number): string {
  const s = Math.floor(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function downloadJSON(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/** A closed key door ahead: E when the player holds its key, the missing key otherwise. Auto doors need no prompt. */
function doorPrompt(world: World, state: SimState): { kind: 'use' } | { kind: 'key'; key: number } | null {
  const p = state.player;
  if (p.stepTick !== 0) return null;
  const door = doorAtCell(world, p.cx + HEADING_DX[p.heading], p.cy + HEADING_DY[p.heading]);
  if (door < 0 || state.doors[door] !== 0) return null;
  const info = world.doors[door]!;
  if (info.kind === DoorKind.Key) return state.keys & (1 << info.key) ? { kind: 'use' } : { kind: 'key', key: info.key };
  return null;
}

function popcount(n: number): number {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
}

const KEY_ICON = (color: string) =>
  `<svg viewBox="0 0 16 16" width="36" height="36" shape-rendering="crispEdges"><path fill="${color}" d="M3 5h5v2h6v2h-2v2h-2V9H8v2H3zM5 7v2h1V7z"/></svg>`;

const SHAPE: Record<number, number> = {
  32: SpriteShape.Grunt,
  33: SpriteShape.Brute,
  34: SpriteShape.Sniper,
  40: SpriteShape.MiniBoss,
  41: SpriteShape.Boss,
};
const PROJECTILE_SIZE = 14;
/** Events that play a sound with no position (the player's own). */
const SOUND_OF: Partial<Record<string, SoundId>> = {
  shot: 'shot', hurt: 'hurt', death: 'death', locked: 'locked', key: 'key', health: 'health', secret: 'secret', exit: 'exit',
  reload: 'reload', reloaded: 'reloaded',
};
const FLASH_SECONDS = 0.12;
/** Kill sounds pitch down with size; gib counts grow with it. */
const DEATH_PITCH: Record<number, number> = { 32: 1, 33: 0.8, 34: 1.2, 40: 0.65, 41: 0.5 };
const GIBS: Record<number, number> = { 32: 14, 33: 20, 34: 12, 40: 40, 41: 70 };
/** A killing blow throws the corpse this far (map units) over CORPSE_THROW_SECONDS. */
const CORPSE_THROW = 40;
const CORPSE_THROW_SECONDS = 0.3;
const JOLT_SECONDS = 0.09;

const SPRITE_WIDTH = 2.6; // × enemy radius
const OCTANT = Math.PI / 4;

/**
 * Which way an enemy faces, for picking its sprite direction (render-side only): at the player
 * once it has noticed them, along its step while walking, its spawn facing otherwise.
 */
function facing(e: EnemyState, spawnAngle: number, player: { x: number; y: number }): number {
  if (e.mode === 'alert' || e.mode === 'chase' || e.mode === 'windup' || e.mode === 'pain') {
    if (e.stepTick === 0 || e.mode === 'windup') return Math.atan2(player.y - e.y, player.x - e.x);
  }
  if (e.stepTick > 0) return Math.atan2(e.cy - e.fromCy, e.cx - e.fromCx);
  return spawnAngle;
}

/** Enemies, corpses and projectiles as sprites, enemies interpolated between the last two ticks. */
/** When and which way each enemy was killed, for throwing its corpse (render-only). */
type Throws = Map<number, { at: number; dx: number; dy: number }>;

function buildSprites(
  world: World, state: SimState, prevEnemies: readonly EnemyState[], t: number, cam: { x: number; y: number },
  spawnAngles: readonly number[], throws: Throws, now: number,
): Sprite[] {
  const light = (x: number, y: number) => {
    const [cx, cy] = world.grid.cellOf(x, y);
    return (world.map.sectors[world.grid.sectorAt(cx, cy)]?.light ?? 160) / 255;
  };
  const sprites: Sprite[] = state.enemies.map((e, i) => {
    const def = world.enemyDefs[e.type];
    const was = prevEnemies[i] ?? e;
    let x = lerp(was.x, e.x, t);
    let y = lerp(was.y, e.y, t);
    const thrown = throws.get(i);
    if (thrown) {
      const k = Math.min(1, (now - thrown.at) / CORPSE_THROW_SECONDS);
      const d = CORPSE_THROW * (1 - (1 - k) * (1 - k));
      x += thrown.dx * d;
      y += thrown.dy * d;
    }
    const z = lerp(was.z, e.z, t);
    const shape = SHAPE[e.type] ?? SpriteShape.Grunt;
    // View direction: the camera's bearing from the enemy, relative to where it faces, in octants.
    const rel = Math.atan2(cam.y - y, cam.x - x) - facing(e, spawnAngles[i] ?? 0, state.player);
    const direction = (((Math.round(rel / OCTANT) % 8) + 8) % 8);
    const frame = e.mode === 'dead' ? 3 : e.mode === 'windup' ? 2 : e.stepTick > 0 ? Math.floor((2 * e.stepTick) / def.stepTicks) % 2 : 0;
    const charge = e.mode === 'windup' ? 1 - e.timer / def.windup : 0;
    return {
      x, y, z, width: def.radius * SPRITE_WIDTH, height: def.height, shape,
      charge, flash: e.mode === 'pain' ? 1 : 0, light: light(x, y), tile: spriteTile(shape, direction, frame),
    };
  });
  // Keys: bobbing and glowing where they lie (a carried key appears where its carrier died).
  world.pickups.forEach((k, i) => {
    const at = k.kind === 'key' && !state.taken[i] ? pickupCell(state, k) : null;
    if (!at) return;
    const [kx, ky] = world.grid.center(at[0], at[1]);
    const bob = 6 * Math.sin(performance.now() / 300 + i);
    sprites.push({ x: kx, y: ky, z: world.grid.floorAt(at[0], at[1]) + 18 + bob, width: 28, height: 28, shape: SpriteShape.Key + k.key, charge: 0, flash: 0, light: 1, tile: -1 });
  });
  // The exit's beacon, until the level is won.
  if (world.exit && !state.won) {
    const [ex, ey] = world.grid.center(world.exit[0], world.exit[1]);
    sprites.push({ x: ex, y: ey, z: world.grid.floorAt(world.exit[0], world.exit[1]), width: 80, height: EXIT_BEACON_HEIGHT, shape: SpriteShape.ExitBeacon, charge: 0, flash: 0, light: 1, tile: -1 });
  }
  for (const q of state.projectiles) {
    sprites.push({ x: q.x, y: q.y, z: q.z - PROJECTILE_SIZE / 2, width: PROJECTILE_SIZE, height: PROJECTILE_SIZE, shape: SpriteShape.Projectile, charge: 0, flash: 0, light: 1, tile: -1 });
  }
  return sprites;
}

/**
 * A red glow on the screen edge a hit came from: ahead is the top, behind the bottom, left and
 * right the sides, and anything between leans that way. Each fades out by itself.
 */
function showDamageFrom(from: { x: number; y: number }, p: PlayerState, layer: HTMLElement, turnedAway = false): void {
  const rel = Math.atan2(from.y - p.y, from.x - p.x) - p.angle; // map angles grow to the left
  const x = 50 - 56 * Math.sin(rel);
  const y = 50 - 56 * Math.cos(rel);
  const hit = document.createElement('div');
  hit.className = 'hit';
  // Red for a hit taken; pale blue for one the chainsword's invulnerability turned away.
  const [core, rim] = turnedAway ? ['rgb(150 210 255 / 0.55)', 'rgb(80 150 255 / 0.2)'] : ['rgb(255 20 10 / 0.6)', 'rgb(200 0 0 / 0.25)'];
  hit.style.background = `radial-gradient(ellipse 55% 60% at ${x.toFixed(1)}% ${y.toFixed(1)}%, ${core}, ${rim} 45%, transparent 70%)`;
  hit.addEventListener('animationend', () => hit.remove());
  layer.append(hit);
}

function main(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const automap = document.getElementById('automap') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLPreElement;
  const start = document.getElementById('start') as HTMLDivElement;
  const compassArrow = document.getElementById('compass-arrow') as HTMLSpanElement;
  const compassLetter = document.getElementById('compass-letter') as HTMLElement;
  const prompt = document.getElementById('prompt') as HTMLDivElement;
  const keysHud = document.getElementById('keys') as HTMLDivElement;
  let shownKeys = -1;
  const healthBar = document.getElementById('healthbar') as HTMLDivElement;
  const healthFill = healthBar.querySelector('.fill') as HTMLDivElement;
  const healthValue = healthBar.querySelector('.value') as HTMLSpanElement;
  let shownHealth = -1;
  const ammo = document.getElementById('ammo') as HTMLDivElement;
  const ammoPips = ammo.querySelector('.pips') as HTMLDivElement;
  const ammoCount = ammo.querySelector('.count b') as HTMLElement;
  let shownAmmo = '';
  const gore = new Gore();
  const throws: Throws = new Map();
  let joltUntil = 0;
  const hurtFlash = document.getElementById('hurt') as HTMLDivElement;
  const damageLayer = document.getElementById('damage') as HTMLDivElement;
  const end = document.getElementById('end') as HTMLDivElement;
  let hurtUntil = 0;
  let notice = '';
  let noticeUntil = 0;
  let shownPrompt = '';

  const here = where();
  const map = loadMap(here);
  // The weapon's coils glow in the theme's light colour.
  const theme = THEME_COLORS[(map.meta.theme ?? 'base') as keyof typeof THEME_COLORS] ?? THEME_COLORS.base;
  const weapon = new Weapon(document.getElementById('gun') as HTMLCanvasElement, theme.techLight);
  const chainsword = new Chainsword(document.getElementById('saw') as HTMLCanvasElement);
  // The ammo pips glow in the same colour as the gun's coils.
  document.documentElement.style.setProperty('--glow', `rgb(${theme.techLight.map((c) => Math.round(c * 255)).join(' ')})`);
  const world = createWorld(map);
  const state = createSimState(world);
  let prev: PlayerState = clonePlayer(state.player);
  let prevEnemies: EnemyState[] = state.enemies.map((e) => ({ ...e }));
  const recorder = new ReplayRecorder(map);
  const audio = new AudioEngine(map.meta.seed ?? map.meta.name);
  // The exit hums from its cell.
  const exitAt = world.exit ? (([x, y]) => ({ x, y }))(world.grid.center(world.exit[0], world.exit[1])) : null;
  // Door sounds come from the door's cell.
  const doorCells: { x: number; y: number }[] = [];
  world.doorAt.forEach((d, i) => {
    if (d < 0 || doorCells[d]) return;
    const [x, y] = world.grid.center(i % world.grid.width, Math.floor(i / world.grid.width));
    doorCells[d] = { x, y };
  });

  const backend = WebGL2Backend.create(canvas);
  const renderer = new LevelRenderer(backend);
  renderer.setMap(map);
  // Sprite quads are radius × SPRITE_WIDTH wide and height tall; the baked models match. Each
  // generated level breeds its own mutants, coloured to stand out from its theme.
  const themeName = (map.meta.theme && map.meta.theme in THEME_COLORS ? map.meta.theme : 'base') as keyof typeof THEME_COLORS;
  renderer.bakeSprites(
    Object.keys(SHAPE).map((type) => {
      const def = world.enemyDefs[Number(type) as keyof typeof world.enemyDefs];
      return (def.radius * SPRITE_WIDTH) / def.height;
    }),
    map.meta.seed ? enemyLooks(map.meta.seed, themeName) : BASELINE_LOOKS,
  );
  const spawnAngles = map.things.filter((t) => isEnemyThing(t.type)).map((t) => (t.angle * Math.PI) / 180);

  const input = new InputSampler(canvas);
  start.addEventListener('click', () => {
    audio.unlock(); // browsers allow audio only after a gesture
    void canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => (start.hidden = input.locked));

  addEventListener('keydown', (e) => {
    // After death or the exit, E (or Space) moves on: retry the level, or a new one.
    if ((state.dead || state.won) && (e.code === 'KeyE' || e.code === 'Space')) {
      if (state.won && !here.map) nextLevel(here);
      else location.reload();
    }
    if (e.code === 'Tab') automap.hidden = false;
    if (e.code === 'KeyM') audio.toggleMusic();
    if (e.code === 'KeyN') audio.toggleSound();
    if (e.code === 'F2') newRun();
    if (e.code === 'F8') downloadJSON(`replay-${map.meta.seed ?? map.meta.name}-${state.tick}.json`, recorder.finish());
  });
  // The automap shows only while Tab is held.
  addEventListener('keyup', (e) => {
    if (e.code === 'Tab') automap.hidden = true;
  });
  addEventListener('blur', () => (automap.hidden = true));

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    backend.resize(Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr));
    renderer.resize();
  };
  addEventListener('resize', resize);
  resize();

  let last = performance.now() / 1000;
  let acc = 0;
  let fps = 0;

  const frame = (nowMs: number) => {
    const now = nowMs / 1000;
    const dt = Math.min(now - last, MAX_FRAME_TIME);
    last = now;
    fps = fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;

    acc += dt;
    // The world runs only while the game has the mouse (Esc pauses), so nothing happens on the
    // start screen and every simulated tick is in the replay. `&autoplay` (dev) runs it anyway.
    if (!input.locked && !AUTOPLAY) acc = 0;
    while (acc >= TICK_DT) {
      prev = clonePlayer(state.player);
      prevEnemies = state.enemies.map((e) => ({ ...e }));
      const f = input.sample();
      if (AUTOFIRE) f.fire = true;
      recorder.record(f);
      const wasStepping = state.player.stepTick;
      stepSim(world, state, f);
      const listener = { x: state.player.x, y: state.player.y, yaw: state.player.angle };
      if (exitAt && !state.won && state.tick % EXIT_HUM_TICKS === 0 && Math.hypot(exitAt.x - listener.x, exitAt.y - listener.y) < EXIT_HUM_RANGE) {
        audio.play('exitHum', exitAt, listener);
      }
      const enemyAt = (i: number) => state.enemies[i]!;
      if (state.player.stepTick === 1 && wasStepping !== 1) audio.play('step');
      for (const e of state.events) {
        const sound = SOUND_OF[e.type];
        if (sound) audio.play(sound);
        if (e.type === 'door') audio.play('door', doorCells[e.door], listener);
        if (e.type === 'hit' || e.type === 'kill' || e.type === 'melee') {
          const enemy = enemyAt(e.enemy);
          const def = world.enemyDefs[enemy.type];
          const mid = enemy.z + def.height * 0.6;
          if (e.type === 'kill') {
            // Spectacular: burst into gibs thrown along the blow, and throw the corpse after them.
            const dx = enemy.x - state.player.x;
            const dy = enemy.y - state.player.y;
            const len = Math.hypot(dx, dy) || 1;
            gore.burst(enemy.x, enemy.y, mid, dx / len, dy / len, GIBS[enemy.type] ?? 14, def.radius);
            throws.set(e.enemy, { at: now, dx: dx / len, dy: dy / len });
            audio.play('kill', enemy, listener, DEATH_PITCH[enemy.type] ?? 1);
            audio.play('gib', enemy, listener);
          } else {
            gore.splash(enemy.x, enemy.y, mid);
            if (e.type === 'hit') audio.play('hit', enemy, listener);
          }
        }
        if (e.type === 'saw') {
          // In step with the sim: up by the first hit, grinding through the invulnerability.
          chainsword.attack(now, MELEE_TICKS * TICK_DT, MELEE_FIRST_HIT / MELEE_TICKS, MELEE_IFRAMES / MELEE_TICKS);
          weapon.makeRoom(now, MELEE_TICKS * TICK_DT);
          audio.play('saw');
        }
        if (e.type === 'melee') {
          audio.play('sawHit', enemyAt(e.enemy), listener);
          joltUntil = now + JOLT_SECONDS;
        }
        if (e.type === 'shielded') {
          audio.play('shielded');
          if (e.from) showDamageFrom(e.from, state.player, damageLayer, true);
        }
        if (e.type === 'windup' || e.type === 'attack') {
          const enemy = enemyAt(e.enemy);
          const kind = world.enemyDefs[enemy.type].attack;
          const id: SoundId = e.type === 'windup'
            ? kind === 'melee' ? 'windupMelee' : kind === 'hitscan' ? 'windupHitscan' : 'windup'
            : kind === 'melee' ? 'melee' : kind === 'hitscan' ? 'snipe' : 'launch';
          audio.play(id, enemy, listener);
        }
        if (e.type === 'key') [notice, noticeUntil] = [`Picked up the ${KEY_NAMES[e.key]} key`, now + NOTICE_SECONDS];
        if (e.type === 'locked') [notice, noticeUntil] = [`Needs the ${KEY_NAMES[e.key]} key`, now + NOTICE_SECONDS];
        if (e.type === 'secret') [notice, noticeUntil] = ['You found a secret!', now + NOTICE_SECONDS];
        if (e.type === 'health') [notice, noticeUntil] = [`+${e.amount} health`, now + NOTICE_SECONDS];
        if (e.type === 'shot') {
          weapon.fire(now);
          renderer.flash = 1;
          joltUntil = now + JOLT_SECONDS;
          // The coils recharge between shots; the last shot's reload has its own sound.
          if (state.player.reload === 0) window.setTimeout(() => audio.play('charge'), 90);
        }
        if (e.type === 'reload') weapon.reload(now, RELOAD_TICKS * TICK_DT);
        if (e.type === 'hurt') {
          if (e.from) showDamageFrom(e.from, state.player, damageLayer);
          hurtUntil = now + FLASH_SECONDS * 2;
          joltUntil = now + JOLT_SECONDS;
        }
      }
      acc -= TICK_DT;
    }
    // Music: the combat layer follows how many enemies are after the player.
    audio.setIntensity(state.enemies.filter((e) => e.mode === 'chase' || e.mode === 'windup').length / 2);
    world.doors.forEach((_, i) => (renderer.movers[i] = doorOffset(world, state, i)));
    world.lifts.forEach((lift, i) => (renderer.movers[world.doors.length + i] = -(liftHeight(world, state, i) - lift.bottom)));
    // Health packs are mesh markers, after doors and lifts, in thing order.
    let healthMover = world.doors.length + world.lifts.length;
    world.pickups.forEach((k, i) => {
      if (k.kind === 'health') renderer.movers[healthMover++] = state.taken[i] ? HIDDEN_OFFSET : 0;
    });

    const t = acc / TICK_DT;
    const p = state.player;
    const view = {
      x: lerp(prev.x, p.x, t),
      y: lerp(prev.y, p.y, t),
      eyeZ: lerp(prev.z + bob(prev), p.z + bob(p), t) + PLAYER_EYE_HEIGHT,
      yaw: lerpAngle(prev.angle, p.angle, t),
      pitch: lerp(prev.pitch, p.pitch, t),
    };
    // Gore (render-only particles), the muzzle flash's light, the screen jolt.
    const goreWorld = {
      floorAt: (x: number, y: number) => {
        const [cx, cy] = world.grid.cellOf(x, y);
        return world.grid.walkable(cx, cy) ? world.grid.floorAt(cx, cy) : undefined;
      },
      light: (x: number, y: number) => {
        const [cx, cy] = world.grid.cellOf(x, y);
        return (world.map.sectors[world.grid.sectorAt(cx, cy)]?.light ?? 160) / 255;
      },
    };
    gore.update(dt, goreWorld);
    renderer.flash = Math.max(0, renderer.flash - dt * 12);
    canvas.style.transform = now < joltUntil ? `translate(${(Math.random() - 0.5) * 10}px, ${(Math.random() - 0.5) * 8}px)` : '';
    renderer.render(view, now, [...buildSprites(world, state, prevEnemies, t, view, spawnAngles, throws, now), ...gore.sprites(goreWorld)]);
    weapon.update(now, dt, state.player.stepTick / STEP_TICKS, p.mag / MAG_SIZE);
    chainsword.update(now);

    if (p.health !== shownHealth) {
      shownHealth = p.health;
      const f = Math.max(0, p.health) / PLAYER_MAX_HEALTH;
      healthFill.style.width = `${Math.round(Math.min(1, f) * 100)}%`;
      healthValue.textContent = String(Math.max(0, p.health));
      healthBar.classList.toggle('mid', f <= 0.5 && f > 0.25);
      healthBar.classList.toggle('low', f <= 0.25);
    }
    // Ammo: a pip per round, or the reload's progress while the cell refills.
    const reloadDone = p.reload > 0 ? Math.round((1 - p.reload / RELOAD_TICKS) * 20) * 5 : -1;
    const ammoKey = `${p.mag}|${reloadDone}`;
    if (ammoKey !== shownAmmo) {
      shownAmmo = ammoKey;
      ammoPips.innerHTML = reloadDone >= 0
        ? `<div class="reloading" style="--p: ${reloadDone}%">RELOADING</div>`
        : Array.from({ length: MAG_SIZE }, (_, i) => `<div class="pip${i < p.mag ? ' full' : ''}"></div>`).join('');
      ammoCount.textContent = String(p.mag);
      ammo.classList.toggle('empty', p.mag === 0);
    }
    hurtFlash.hidden = now >= hurtUntil;
    const ending = state.dead ? 'dead' : state.won ? 'won' : '';
    if (end.dataset.state !== ending) {
      end.dataset.state = ending;
      end.hidden = !ending;
      const kills = state.enemies.filter((x) => x.mode === 'dead').length;
      const secrets = world.secrets ? ` · secrets ${popcount(state.secrets)}/${world.secrets}` : '';
      const stats = `<p class="stats">kills ${kills}/${state.enemies.length}${secrets} · time ${clock(state.tick)}</p>`;
      end.innerHTML = state.dead
        ? `<p class="title">You died</p>${stats}<p>Press E to try level ${here.level} again.</p>`
        : `<p class="title">Level ${here.level} complete</p>${stats}<p>Press E for ${here.map ? 'another go' : `level ${here.level + 1}`}.</p>`;
    }

    // Compass: where W will take you, relative to where you're looking.
    compassArrow.style.transform = `rotate(${((view.yaw - (p.heading * Math.PI) / 2) * 180) / Math.PI}deg)`;
    compassLetter.textContent = HEADING_LETTERS[p.heading];

    const want = doorPrompt(world, state);
    const promptHtml = !want ? '' : want.kind === 'use' ? '<span class="keycap">E</span>' : KEY_ICON(KEY_COLORS[want.key]!);
    if (promptHtml !== shownPrompt) {
      prompt.innerHTML = shownPrompt = promptHtml;
      prompt.hidden = !promptHtml;
    }

    if (!automap.hidden) drawAutomap(automap, map, view, world, state);
    // Keys held: an icon each, in the key's colour, above the health.
    if (state.keys !== shownKeys) {
      shownKeys = state.keys;
      keysHud.innerHTML = KEY_COLORS.filter((_, k) => state.keys & (1 << k)).map((c) => KEY_ICON(c)).join('');
    }
    hud.textContent =
      `${map.meta.seed ? `level ${here.level} ${map.meta.levelType ?? ''}  seed ${map.meta.seed}  gen ${GENERATOR_VERSION}` : `map ${map.meta.name}`}  ${map.meta.theme ?? ''}\n` +
      `${fps.toFixed(0)} fps  tick ${state.tick}  sector ${p.sector}\n` +
      `cell ${p.cx}, ${p.cy}  z ${p.z.toFixed(0)}` +
      (world.secrets ? `\nsecrets ${popcount(state.secrets)}/${world.secrets}` : '') +
      (now < noticeUntil ? `\n${notice}` : '');

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

try {
  main();
} catch (e) {
  document.body.textContent = `Could not start: ${(e as Error).message}`;
  console.error(e);
}
