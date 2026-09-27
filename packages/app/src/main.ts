import { CELL_SIZE, DIFFICULTY, DoorKind, isDifficulty, type Difficulty, EnemyType, PELLETS, PELLET_SPREAD, WEAPONS, WEAPON_RANGE, WEAPON_SWITCH_TICKS, WeaponId, dcos, defOf, dsin, MAG_SIZE, MELEE_FIRST_HIT, MELEE_IFRAMES, MELEE_TICKS, RELOAD_TICKS, HEADING_DX, HEADING_DY, PLAYER_EYE_HEIGHT, STEP_TICKS, TICK_DT, isEnemyThing, type MapData } from '@proc-fps/core';
import { GENERATOR_VERSION, generate, isLevelType, validateGenerated, type LevelType } from '@proc-fps/gen';
import { BASELINE_LOOKS, HIDDEN_OFFSET, LevelRenderer, SpriteShape, THEME_COLORS, WebGL2Backend, enemyLooks, spriteRow, spriteTile, type Sprite } from '@proc-fps/render';
import {
  PLAYER_MAX_HEALTH,
  castRay,
  GRENADE,
  isBoss,
  SLAM_RADIUS,
  lineOfSight,
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
import { ScreenBlood } from './screenblood.js';
import { Weapon } from './weapon.js';
import { newRunId, runUrl, titleScreen } from './title.js';
import { endRun, levelScore, loadBest, recordDeath, recordLevel, runFor, runScore, type RunRecord } from './run.js';
import { endScreen, pauseScreen, summaryScreen, type PauseInfo } from './screens.js';
import { Menu } from './ui/menu.js';
import { OptionsPanel } from './ui/optionspanel.js';
import { loadOptions, type Options } from './options.js';
import { installSkin } from './ui/skin.js';
import { tally } from './ui/tally.js';
import { Bolter } from './bolter.js';
import { Launcher } from './launcher.js';
import { bossName } from './bossname.js';
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
 * - nothing: the title screen (title.ts), which starts runs.
 * Runs carry their difficulty as &diff=easy|hard|brutal (normal when absent).
 */
interface Where {
  run?: string;
  seed?: string;
  level: number;
  /** Overrides the pacing's level type. */
  type?: LevelType;
  difficulty: Difficulty;
  /** No level asked for: show the title screen. */
  title?: boolean;
}

function where(): Where & { map?: string } {
  const params = new URLSearchParams(location.search);
  const level = Math.max(1, Number(params.get('level') ?? 1) || 1);
  const diff = params.get('diff');
  const difficulty: Difficulty = isDifficulty(diff) ? diff : 'normal';
  const map = params.get('map');
  if (map) return { map, level, difficulty };
  const run = params.get('run');
  if (run) return { run, level, difficulty };
  const seed = params.get('seed');
  const type = params.get('type');
  if (seed) return isLevelType(type) ? { seed, level, type, difficulty } : { seed, level, difficulty };
  return { level: 1, difficulty, title: true };
}

function loadMap(w: Where & { map?: string }): MapData {
  if (w.map) {
    const m = TEST_MAPS[w.map];
    if (!m) throw new Error(`unknown test map "${w.map}"`);
    return m;
  }
  const seed = w.run ? `${w.run}-${w.level}` : w.seed!;
  const map = generate(seed, { level: w.level, difficulty: w.difficulty, ...(w.type ? { type: w.type } : {}) });
  const errors = validateGenerated(map);
  if (errors.length) console.warn(`seed ${seed} failed validation:`, errors);
  return map;
}

/** A fresh run at level 1, at the same difficulty. */
function newRun(w: Where): void {
  location.href = runUrl(newRunId(), 1, w.difficulty);
}

/** The next level of this run (a single seed becomes a run named after it). */
function nextLevel(w: Where): void {
  location.href = runUrl(w.run ?? w.seed ?? newRunId(), w.level + 1, w.difficulty);
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
/** The enemy (type, variant) behind each baked sprite row (see spriteRow). */
const SPRITE_ROWS_OF: readonly (readonly [EnemyType, number])[] = [
  [EnemyType.Grunt, 0], [EnemyType.Grunt, 1], [EnemyType.Brute, 0], [EnemyType.Brute, 1],
  [EnemyType.Sniper, 0], [EnemyType.Sniper, 1], [EnemyType.MiniBoss, 0], [EnemyType.Boss, 0],
];
/** Events that play a sound with no position (the player's own). */
const SOUND_OF: Partial<Record<string, SoundId>> = {
  hurt: 'hurt', death: 'death', locked: 'locked', key: 'key', health: 'health', secret: 'secret', exit: 'exit',
  reload: 'reload', reloaded: 'reloaded',
};
const FLASH_SECONDS = 0.12;
/** Kill sounds pitch down with size; gib counts grow with it. */
const DEATH_PITCH: Record<number, number> = { 32: 1, 33: 0.8, 34: 1.2, 40: 0.65, 41: 0.5 };
const GIBS: Record<number, number> = { 32: 22, 33: 30, 34: 18, 40: 60, 41: 100 };
/** Kills this close (map units) splatter the screen, more the closer they are. */
const SPLATTER_RANGE = 2.5 * 128;
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
    const def = defOf(world.enemyDefs, e);
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
      charge, flash: e.mode === 'pain' ? 1 : 0, light: light(x, y), tile: spriteTile(spriteRow(shape, e.variant), direction, frame),
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
  // Grenades in flight, and grenade pickups bobbing where they lie.
  for (const n of state.grenades) {
    sprites.push({ x: n.x, y: n.y, z: n.z - 7, width: 14, height: 14, shape: SpriteShape.Grenade, charge: 0, flash: 0, light: light(n.x, n.y), tile: -1 });
  }
  world.pickups.forEach((k, i) => {
    if (k.kind !== 'grenade' || state.taken[i]) return;
    const [gx, gy] = world.grid.center(k.cx, k.cy);
    const bob = 4 * Math.sin(performance.now() / 350 + i);
    sprites.push({ x: gx, y: gy, z: world.grid.floorAt(k.cx, k.cy) + 12 + bob, width: 22, height: 22, shape: SpriteShape.Grenade, charge: 0, flash: 0, light: light(gx, gy), tile: -1 });
  });
  // A boss winding up a slam: a pulsing ring on the floor marks how far it will reach.
  for (const e of state.enemies) {
    if (e.mode !== 'windup' || !isBoss(e.type) || e.pattern !== 'slam') continue;
    sprites.push({ x: e.x, y: e.y, z: e.z + 1.5, width: SLAM_RADIUS * 2, height: SLAM_RADIUS * 2, shape: SpriteShape.Warning, charge: 0, flash: 0, light: 1, tile: -1, flat: true });
  }
  // The exit's beacon, until the level is won.
  if (world.exit && !state.won) {
    const [ex, ey] = world.grid.center(world.exit[0], world.exit[1]);
    sprites.push({ x: ex, y: ey, z: world.grid.floorAt(world.exit[0], world.exit[1]), width: 80, height: EXIT_BEACON_HEIGHT, shape: SpriteShape.ExitBeacon, charge: 0, flash: 0, light: 1, tile: -1 });
  }
  for (const q of state.projectiles) {
    const [shape, size] = q.kind === 'lob' ? [SpriteShape.Lob, 18] : q.kind === 'homing' ? [SpriteShape.Homing, 16] : q.kind === 'split' ? [SpriteShape.Split, 26] : [SpriteShape.Projectile, PROJECTILE_SIZE];
    sprites.push({ x: q.x, y: q.y, z: q.z - size / 2, width: size, height: size, shape, charge: 0, flash: 0, light: 1, tile: -1 });
  }
  return sprites;
}

/** A sniper's beam, render-only: from its eye to the player's chest, or to the first wall. */
function sniperBeam(world: World, state: SimState, e: EnemyState, gore: Gore): void {
  const def = defOf(world.enemyDefs, e);
  const p = state.player;
  const [sx, sy, sz] = [e.x, e.y, e.z + def.height * 0.75];
  let [tx, ty, tz] = [p.x, p.y, p.z + 44];
  if (!lineOfSight(world, state, sx, sy, tx, ty)) {
    const len = Math.hypot(tx - sx, ty - sy, tz - sz) || 1;
    const [dx, dy, dz] = [(tx - sx) / len, (ty - sy) / len, (tz - sz) / len];
    const d = castRay(world, state, sx, sy, sz, dx, dy, dz, WEAPON_RANGE);
    [tx, ty, tz] = [sx + dx * d, sy + dy * d, sz + dz * d];
  }
  gore.beam(sx, sy, sz, tx, ty, tz);
}

/**
 * A bolt's tracer, render-only: a bright streak from the muzzle along the bolt (the sim's walk of
 * the aim; it bursts where it lands, which the sim reports as a `blast` event).
 */
function boltTracer(world: World, state: SimState, gore: Gore): void {
  const p = state.player;
  const gun = WEAPONS[WeaponId.Bolter]!;
  const [yaw, pitch] = gun.spread[(p.shots - 1 + gun.spread.length) % gun.spread.length]!;
  const cp = dcos(p.pitch + pitch);
  const dx = cp * dcos(p.angle + yaw);
  const dy = cp * dsin(p.angle + yaw);
  const dz = dsin(p.pitch + pitch);
  const oz = p.z + PLAYER_EYE_HEIGHT - 6;
  const wall = castRay(world, state, p.x, p.y, oz, dx, dy, dz, WEAPON_RANGE);
  const start = 40;
  const speed = 3200;
  if (wall > start) gore.tracer(p.x + dx * start, p.y + dy * start, oz + dz * start, dx * speed, dy * speed, dz * speed, (wall - start) / speed, 5);
}

/**
 * The shot's debris, render-only: a tracer spark along each pellet (the sim's fixed spread), and
 * where one strikes a wall or floor a burst of sparks and chips. Pellets that hit an enemy make
 * blood instead (the hit events), so they get no impact here.
 */
function shatter(world: World, state: SimState, gore: Gore): void {
  const p = state.player;
  const ox = p.x;
  const oy = p.y;
  const oz = p.z + PLAYER_EYE_HEIGHT - 6;
  for (const [yaw, pitch] of PELLET_SPREAD.slice(0, PELLETS)) {
    const cp = dcos(p.pitch + pitch);
    const dx = cp * dcos(p.angle + yaw);
    const dy = cp * dsin(p.angle + yaw);
    const dz = dsin(p.pitch + pitch);
    const wall = castRay(world, state, ox, oy, oz, dx, dy, dz, WEAPON_RANGE);
    // The nearest living enemy the pellet passes through before the wall, if any.
    const struck = state.enemies.some((e) => {
      if (e.mode === 'dead') return false;
      const def = defOf(world.enemyDefs, e);
      const t = (e.x - ox) * dx + (e.y - oy) * dy;
      if (t <= 0 || t >= wall) return false;
      const cx = ox + dx * t - e.x;
      const cy = oy + dy * t - e.y;
      const z = oz + dz * t;
      return cx * cx + cy * cy <= def.radius * def.radius && z >= e.z && z <= e.z + def.height;
    });
    const speed = 2600;
    // Start a little ahead of the eye (at the muzzle) so the tracer is not a blob in the face.
    const start = 40;
    if (wall > start) gore.tracer(ox + dx * start, oy + dy * start, oz + dz * start, dx * speed, dy * speed, dz * speed, (wall - start) / speed);
    if (!struck && wall < WEAPON_RANGE) gore.impact(ox + dx * wall, oy + dy * wall, oz + dz * wall, -dx, -dy, -dz);
  }
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
  const ammoSize = ammo.querySelector('.count .size') as HTMLElement;
  const ammoType = ammo.querySelector('.type .name') as HTMLElement;
  const ammoSlots = ammo.querySelector('.slots') as HTMLDivElement;
  /** When the last weapon switch started (seconds), for the lower-and-raise animation. */
  let switchAt = -10;
  let switchFrom = 0;
  let shownAmmo = '';
  const gore = new Gore();
  const screenBlood = new ScreenBlood(document.getElementById('bloodscreen') as HTMLCanvasElement);
  const throws: Throws = new Map();
  let joltUntil = 0;
  const hurtFlash = document.getElementById('hurt') as HTMLDivElement;
  const damageLayer = document.getElementById('damage') as HTMLDivElement;
  // The boss bar, and a banner for boss moments.
  const bossBar = document.getElementById('bossbar') as HTMLDivElement;
  const bossFill = bossBar.querySelector('.fill') as HTMLDivElement;
  const bossLabel = bossBar.querySelector('.name') as HTMLSpanElement;
  let shownBoss = '';
  const banner = document.getElementById('banner') as HTMLDivElement;
  let bannerUntil = 0;
  const say = (text: string, now: number, seconds = 2.5) => {
    banner.textContent = text;
    banner.hidden = false;
    bannerUntil = now + seconds;
  };
  // F3: frame timings and what the renderer drew, averaged over the last second or so.
  const perf = document.getElementById('perf') as HTMLPreElement;
  const timing = { frame: 0, sim: 0, render: 0 };
  const smooth = (prev: number, x: number) => prev * 0.95 + x * 0.05;
  const end = document.getElementById('end') as HTMLDivElement;
  let hurtUntil = 0;
  let notice = '';
  let noticeUntil = 0;
  let shownPrompt = '';
  const noticeEl = document.getElementById('notice') as HTMLParagraphElement;
  let shownNotice = '';

  const here = where();
  if (here.title) {
    titleScreen();
    return;
  }
  const map = loadMap(here);
  // The run this level belongs to (none for a single seed or a test map).
  let run: RunRecord | null = here.run ? runFor(here.run, here.difficulty) : null;
  // The weapon's coils glow in the theme's light colour, and so does the UI's accent.
  const theme = THEME_COLORS[(map.meta.theme ?? 'base') as keyof typeof THEME_COLORS] ?? THEME_COLORS.base;
  installSkin(theme.techLight);
  const weapon = new Weapon(document.getElementById('gun') as HTMLCanvasElement, theme.techLight);
  const bolter = new Bolter(document.getElementById('bolter') as HTMLCanvasElement, theme.techLight);
  const chainsword = new Chainsword(document.getElementById('saw') as HTMLCanvasElement);
  const launcher = new Launcher(document.getElementById('launcher') as HTMLCanvasElement);
  const ammoGrenades = document.querySelector('#ammo .grenades') as HTMLDivElement;
  let shownGrenades = -1;
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
    SPRITE_ROWS_OF.map(([type, variant]) => {
      const def = defOf(world.enemyDefs, { type, variant });
      return (def.radius * SPRITE_WIDTH) / def.height;
    }),
    map.meta.seed ? enemyLooks(map.meta.seed, themeName) : BASELINE_LOOKS,
  );
  const spawnAngles = map.things.filter((t) => isEnemyThing(t.type)).map((t) => (t.angle * Math.PI) / 180);

  const input = new InputSampler(canvas);
  // The player's options (options.ts), applied now and whenever the options panel changes one.
  let options = loadOptions();
  const applyOptions = (o: Options) => {
    options = o;
    input.sensitivity = o.sensitivity / 10;
    input.invertLook = o.invert;
    renderer.fovY = (o.fov * Math.PI) / 180;
    audio.setVolumes(o.music / 10, o.sound / 10);
  };
  applyOptions(options);
  const menuSound = (kind: 'move' | 'choose' | 'adjust' | 'back') => audio.play(kind === 'move' || kind === 'adjust' ? 'menuMove' : kind === 'back' ? 'menuBack' : 'menuChoose');
  const fight = () => {
    audio.unlock(); // browsers allow audio only after a gesture
    void canvas.requestPointerLock();
  };
  // The pause screen: the level's title card until the first click, then "Paused".
  const pauseInfo: PauseInfo = { level: here.level, run: run ? { difficulty: run.difficulty, score: runScore(run) } : null };
  if (map.meta.levelType) pauseInfo.levelType = map.meta.levelType;
  if (map.meta.theme) pauseInfo.theme = map.meta.theme;
  if (map.meta.seed) pauseInfo.seed = map.meta.seed;
  if (here.map) pauseInfo.map = here.map;
  let started = false;
  start.innerHTML = pauseScreen(pauseInfo, started);
  const pauseMenu = new Menu(start, {
    choose: (item) => {
      if (item.dataset.action === 'resume') fight();
      if (item.dataset.action === 'title') location.href = './index.html';
      if (item.dataset.action === 'browse') location.href = './browse.html';
      if (item.dataset.action === 'controls' || item.dataset.action === 'options') openPanel(item.dataset.action);
    },
    sound: menuSound,
    chooseKeys: [],
  });
  // Options and controls open over the pause screen, which hides the rest until they close.
  const openPanel = (name: string) => {
    const el = start.querySelector<HTMLElement>(`[data-panel="${name}"]`);
    if (!el) return;
    start.classList.add('sub');
    const closed = () => {
      start.classList.remove('sub');
      pauseMenu.refresh();
    };
    if (name === 'options') {
      new OptionsPanel(el, options, applyOptions, menuSound, closed);
      return;
    }
    el.hidden = false;
    const close = () => {
      menu.close();
      el.hidden = true;
      closed();
    };
    const menu = new Menu(el, { choose: close, back: close, sound: menuSound });
  };
  start.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-item], .panel')) fight();
  });
  // The pause screen shows whenever the mouse is free, except over the end-of-level screen.
  document.addEventListener('pointerlockchange', () => {
    start.hidden = input.locked || state.dead || state.won;
    if (input.locked && !started) {
      started = true;
      start.innerHTML = pauseScreen(pauseInfo, started);
      pauseMenu.refresh();
    }
  });
  // The end-of-level screen and the run summary: a tally, then a menu (E or Space picks the first item).
  let endMenu: Menu | null = null;
  let skipTally: (() => void) | null = null;
  const showEnd = (html: string) => {
    endMenu?.close();
    skipTally?.();
    end.innerHTML = html;
    endMenu = new Menu(end, { choose: (item) => endAction(item.dataset.action), sound: menuSound, delay: 500 });
    skipTally = tally(end, (k) => audio.play(k === 'tick' ? 'tally' : 'tallyDone'));
  };
  const endAction = (action: string | undefined) => {
    if (action === 'next') {
      if (here.map) location.reload();
      else nextLevel(here);
    }
    if (action === 'retry') location.reload();
    if (action === 'new') newRun(here);
    if (action === 'title') location.href = './index.html';
    if (action === 'end' && run) {
      const rank = endRun(run);
      showEnd(summaryScreen(run, rank, loadBest()));
      run = null;
    }
  };

  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') automap.hidden = false;
    if (e.code === 'KeyM') audio.toggleMusic();
    if (e.code === 'KeyN') audio.toggleSound();
    if (e.code === 'F2') newRun(here);
    if (e.code === 'F4') {
      e.preventDefault();
      renderer.culling = !renderer.culling;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      perf.hidden = !perf.hidden;
      hud.hidden = perf.hidden;
    }
    if (e.code === 'F8') downloadJSON(`replay-${map.meta.seed ?? map.meta.name}-${state.tick}.json`, recorder.finish());
  });
  // The automap shows only while Tab is held.
  addEventListener('keyup', (e) => {
    if (e.code === 'Tab') automap.hidden = true;
  });
  addEventListener('blur', () => (automap.hidden = true));

  // The scene is drawn and palette-quantized at low resolution (the dither is per scene pixel), so
  // the canvas holds exactly that and CSS scales it up pixelated: the same image as quantizing at
  // screen resolution, for a fraction of the work (the post pass matches 64 colours per pixel).
  const resize = () => {
    const h = renderer.lowResHeight;
    backend.resize(Math.max(1, Math.round((h * canvas.clientWidth) / Math.max(1, canvas.clientHeight))), h);
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
    const simStart = performance.now();
    // The world runs only while the game has the mouse (Esc pauses), so nothing happens on the
    // start screen and every simulated tick is in the replay. `&autoplay` (dev) runs it anyway.
    if (!input.locked && !AUTOPLAY) acc = 0;
    while (acc >= TICK_DT) {
      prev = clonePlayer(state.player);
      prevEnemies = state.enemies.map((e) => ({ ...e }));
      const f = input.sample(state.player.weapon, WEAPONS.length);
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
          const def = defOf(world.enemyDefs, enemy);
          const mid = enemy.z + def.height * 0.6;
          const dx = enemy.x - state.player.x;
          const dy = enemy.y - state.player.y;
          const len = Math.hypot(dx, dy) || 1;
          if (e.type === 'kill') {
            // Spectacular: burst into gibs thrown along the blow, throw the corpse after them, and
            // leave a pool where it lands with a smear along the way.
            gore.burst(enemy.x, enemy.y, mid, dx / len, dy / len, GIBS[enemy.type] ?? 14, def.radius);
            throws.set(e.enemy, { at: now, dx: dx / len, dy: dy / len });
            for (let k = 0; k <= 4; k++) {
              const along = (CORPSE_THROW * k) / 4;
              gore.pool(enemy.x + (dx / len) * along, enemy.y + (dy / len) * along, enemy.z, def.radius * (k === 4 ? 0.9 : 0.35));
            }
            if (len < SPLATTER_RANGE) {
              const side = Math.sin(Math.atan2(dy, dx) - state.player.angle); // + left of the view
              screenBlood.splatter(1 - len / SPLATTER_RANGE, -side);
            }
            audio.play('kill', enemy, listener, DEATH_PITCH[enemy.type] ?? 1);
            audio.play('gib', enemy, listener);
            if (isBoss(enemy.type)) {
              // A boss dies hard: burst after burst over a second or so, and a last roar.
              audio.play('bossDeath', enemy, listener);
              say(`${bossName(map.meta.seed ?? map.meta.name, enemy.type)} is dead`, now);
              renderer.flash = 1;
              for (let k = 1; k <= 6; k++) {
                window.setTimeout(() => {
                  const a = k * 2.1;
                  gore.burst(enemy.x, enemy.y, enemy.z + def.height * (0.3 + 0.1 * k), Math.cos(a), Math.sin(a), Math.round((GIBS[enemy.type] ?? 40) / 3), def.radius);
                  audio.play('gib', enemy, listener, 0.8 + k * 0.05);
                }, k * 180);
              }
            }
          } else {
            // Blood sprays out of the far side, away from the blow.
            gore.splash(enemy.x, enemy.y, mid, dx / len, dy / len, e.type === 'melee' ? 10 : 16);
            if (e.type === 'hit') audio.play('hit', enemy, listener);
          }
        }
        if (e.type === 'saw') {
          // In step with the sim: up by the first hit, grinding through the invulnerability.
          chainsword.attack(now, MELEE_TICKS * TICK_DT, MELEE_FIRST_HIT / MELEE_TICKS, MELEE_IFRAMES / MELEE_TICKS);
          weapon.makeRoom(now, MELEE_TICKS * TICK_DT);
          bolter.makeRoom(now, MELEE_TICKS * TICK_DT);
          audio.play('saw');
        }
        if (e.type === 'melee') {
          const enemy = enemyAt(e.enemy);
          audio.play('sawHit', enemy, listener);
          chainsword.bite();
          screenBlood.splatter(0.25);
          // Blood thrown back off the blade, towards the player.
          const [bx, by] = [state.player.x - enemy.x, state.player.y - enemy.y];
          const bl = Math.hypot(bx, by) || 1;
          gore.burst(enemy.x, enemy.y, enemy.z + defOf(world.enemyDefs, enemy).height * 0.55, bx / bl, by / bl, 5, 10);
          joltUntil = now + JOLT_SECONDS;
        }
        if (e.type === 'shielded') {
          audio.play('shielded');
          if (e.from) showDamageFrom(e.from, state.player, damageLayer, true);
        }
        if (e.type === 'windup' || e.type === 'attack') {
          const enemy = enemyAt(e.enemy);
          const def = defOf(world.enemyDefs, enemy);
          const kind = def.attack;
          const id: SoundId = e.type === 'windup'
            ? e.type === 'windup' && e.pattern === 'slam' ? 'windupSlam' : kind === 'melee' ? 'windupMelee' : kind === 'hitscan' ? 'windupHitscan' : 'windup'
            : kind === 'melee' ? 'melee' : kind === 'hitscan' ? 'snipe' : def.shot === 'lob' ? 'lob' : def.shot === 'homing' || enemy.pattern === 'homing' ? 'homing' : 'launch';
          audio.play(id, enemy, listener);
          // A sniper's shot shows: a glowing line from its eye to the player, or to the wall if
          // they broke line of sight in time.
          if (e.type === 'attack' && kind === 'hitscan') sniperBeam(world, state, enemy, gore);
        }
        if (e.type === 'key') [notice, noticeUntil] = [`Picked up the ${KEY_NAMES[e.key]} key`, now + NOTICE_SECONDS];
        if (e.type === 'locked') [notice, noticeUntil] = [`Needs the ${KEY_NAMES[e.key]} key`, now + NOTICE_SECONDS];
        if (e.type === 'secret') [notice, noticeUntil] = ['You found a secret!', now + NOTICE_SECONDS];
        if (e.type === 'health') [notice, noticeUntil] = [`+${e.amount} health`, now + NOTICE_SECONDS];
        if (e.type === 'shot' && e.weapon === WeaponId.Bolter) {
          // A bolt: a sharp crack from alternating barrels, a lighter jolt, a tracer to its burst.
          audio.play('bolt', undefined, undefined, 0.88 + Math.random() * 0.1);
          bolter.fire(now, state.player.shots % 2);
          renderer.flash = Math.max(renderer.flash, 0.55);
          boltTracer(world, state, gore);
        } else if (e.type === 'shot') {
          // Heavy, and never quite the same twice: a little lower or higher each time.
          audio.play('shot', undefined, undefined, 0.92 + Math.random() * 0.1);
          shatter(world, state, gore);
          weapon.fire(now);
          renderer.flash = 1;
          joltUntil = now + JOLT_SECONDS;
          // The coils recharge between shots; the last shot's reload has its own sound.
          if (state.player.reload === 0) window.setTimeout(() => audio.play('charge'), 90);
        }
        if (e.type === 'splash') {
          gore.globBurst(e.x, e.y, e.z);
          audio.play('splash', e, listener, 0.9 + Math.random() * 0.2);
        }
        if (e.type === 'split') {
          gore.sparks(e.x, e.y, e.z);
          audio.play('split', e, listener);
        }
        if (e.type === 'blast') {
          // A bolt bursting: a flash of fire, sparks and chips, and a thump from where it hit.
          gore.blast(e.x, e.y, e.z);
          audio.play('boltBlast', e, listener, 0.9 + Math.random() * 0.2);
        }
        if (e.type === 'switch') {
          switchAt = now;
          switchFrom = e.weapon === WeaponId.Bolter ? WeaponId.Scattergun : WeaponId.Bolter;
          audio.play('switch');
        }
        if (e.type === 'grenade') {
          launcher.fire(now);
          audio.play('grenadeFire');
        }
        if (e.type === 'explode') {
          gore.explosion(e.x, e.y, e.z);
          audio.play('explode', e, listener);
          // The closer, the harder it shakes and flashes.
          const near = Math.max(0, 1 - Math.hypot(e.x - state.player.x, e.y - state.player.y) / 1200);
          renderer.flash = Math.max(renderer.flash, near);
          if (near > 0.2) joltUntil = now + JOLT_SECONDS * (1 + 3 * near);
        }
        if (e.type === 'grenadePickup') {
          audio.play('grenadePickup');
          [notice, noticeUntil] = ['Picked up a grenade', now + NOTICE_SECONDS];
        }
        if (e.type === 'phase') {
          const boss = enemyAt(e.enemy);
          const name = bossName(map.meta.seed ?? map.meta.name, boss.type);
          audio.play('roar', boss, listener);
          say(e.phase === 2 || boss.type === EnemyType.MiniBoss ? `${name} is enraged!` : `${name} grows furious`, now);
          renderer.flash = Math.max(renderer.flash, 0.6);
          joltUntil = now + JOLT_SECONDS * 2;
        }
        if (e.type === 'slam') {
          const boss = enemyAt(e.enemy);
          audio.play('slam', boss, listener);
          joltUntil = now + JOLT_SECONDS * 3;
          // A shockwave of dust and sparks along the ring it reached.
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            gore.impact(boss.x + Math.cos(a) * SLAM_RADIUS * 0.6, boss.y + Math.sin(a) * SLAM_RADIUS * 0.6, boss.z + 4, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.8);
          }
        }
        if (e.type === 'summon' && e.count > 0) {
          audio.play('summon', enemyAt(e.enemy), listener);
          // The pack erupts from the floor in a spray of blood.
          for (const add of state.enemies.slice(-e.count)) gore.splash(add.x, add.y, add.z + 20, 0, 0, 24);
        }
        if (e.type === 'reload') {
          const seconds = WEAPONS[state.player.weapon]!.reloadTicks * TICK_DT;
          if (state.player.weapon === WeaponId.Bolter) bolter.reload(now, seconds);
          else weapon.reload(now, seconds);
        }
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
      eyeZ: (options.bob ? lerp(prev.z + bob(prev), p.z + bob(p), t) : lerp(prev.z, p.z, t)) + PLAYER_EYE_HEIGHT,
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
    // Comfort options: faint flashes, no shake.
    if (!options.flashes) renderer.flash = Math.min(renderer.flash, 0.25);
    canvas.style.transform = options.shake && now < joltUntil ? `translate(${(Math.random() - 0.5) * 10}px, ${(Math.random() - 0.5) * 8}px)` : '';
    timing.sim = smooth(timing.sim, performance.now() - simStart);
    const renderStart = performance.now();
    renderer.render(view, now, [...buildSprites(world, state, prevEnemies, t, view, spawnAngles, throws, now), ...gore.sprites(goreWorld)]);
    timing.render = smooth(timing.render, performance.now() - renderStart);
    timing.frame = smooth(timing.frame, dt * 1000);
    if (!perf.hidden) {
      const s = renderer.stats;
      perf.textContent =
        `frame ${timing.frame.toFixed(1)} ms (${(1000 / Math.max(1, timing.frame)).toFixed(0)} fps)  update ${timing.sim.toFixed(2)} ms  render ${timing.render.toFixed(2)} ms\n` +
        `sectors ${s.sectors}/${s.totalSectors}  triangles ${s.triangles}/${s.totalTriangles}  ranges ${s.ranges}  sprites ${s.sprites}\n` +
        `canvas ${canvas.width}×${canvas.height}  culling ${renderer.culling ? 'on' : 'off'} (F4)`;
    }
    // A switch lowers the old gun for its first half and raises the new one for its second.
    const sw = (now - switchAt) / (WEAPON_SWITCH_TICKS * TICK_DT);
    const lowerOf = (id: number) =>
      sw < 0 || sw >= 1 ? (id === p.weapon ? 0 : 1)
      : id === switchFrom && id !== p.weapon ? (sw < 0.5 ? sw * 2 : 1)
      : id === p.weapon ? (sw < 0.5 ? 1 : 1 - (sw - 0.5) * 2)
      : 1;
    const bobbing = state.player.stepTick / STEP_TICKS;
    weapon.update(now, dt, bobbing, p.mags[WeaponId.Scattergun]! / MAG_SIZE, lowerOf(WeaponId.Scattergun));
    bolter.update(now, dt, bobbing, p.mags[WeaponId.Bolter]! / WEAPONS[WeaponId.Bolter]!.magSize, lowerOf(WeaponId.Bolter));
    chainsword.update(now);
    launcher.update(now);
    if (p.grenades !== shownGrenades) {
      shownGrenades = p.grenades;
      ammoGrenades.innerHTML = `<span class="label">E grenades</span>` + Array.from({ length: GRENADE.max }, (_, i) => `<span class="nade${i < p.grenades ? ' full' : ''}"></span>`).join('');
    }
    screenBlood.update(dt);

    if (p.health !== shownHealth) {
      shownHealth = p.health;
      const f = Math.max(0, p.health) / PLAYER_MAX_HEALTH;
      healthFill.style.width = `${Math.round(Math.min(1, f) * 100)}%`;
      healthValue.textContent = String(Math.max(0, p.health));
      healthBar.classList.toggle('mid', f <= 0.5 && f > 0.25);
      healthBar.classList.toggle('low', f <= 0.25);
    }
    // Ammo: the gun in hand, a pip per round (a thin tick each for a big drum), or the reload's
    // progress while it refills; the weapon slots above, the one in hand lit.
    const gun = WEAPONS[p.weapon]!;
    const mag = p.mags[p.weapon]!;
    const reloadDone = p.reload > 0 ? Math.round((1 - p.reload / gun.reloadTicks) * 20) * 5 : -1;
    const ammoKey = `${p.weapon}|${mag}|${reloadDone}`;
    if (ammoKey !== shownAmmo) {
      shownAmmo = ammoKey;
      const thin = gun.magSize > 12;
      ammoPips.classList.toggle('thin', thin);
      ammoPips.innerHTML = reloadDone >= 0
        ? `<div class="reloading" style="--p: ${reloadDone}%">RELOADING</div>`
        : Array.from({ length: gun.magSize }, (_, i) => `<div class="pip${i < mag ? ' full' : ''}"></div>`).join('');
      ammoCount.textContent = String(mag);
      ammoSize.textContent = `/ ${gun.magSize}`;
      ammoType.textContent = gun.ammo;
      ammoSlots.innerHTML = WEAPONS.map((w, i) => `<span class="${i === p.weapon ? 'on' : ''}">${i + 1} ${w.name}</span>`).join('');
      ammo.classList.toggle('empty', mag === 0);
    }
    hurtFlash.hidden = now >= hurtUntil;
    hurtFlash.classList.toggle('faint', !options.flashes);
    if (now >= bannerUntil) banner.hidden = true;
    // The boss bar: the first boss awake and alive, with its name and health.
    const bossIndex = state.enemies.findIndex((x) => isBoss(x.type) && x.mode !== 'idle' && x.mode !== 'dead');
    const fighting = bossIndex >= 0 ? state.enemies[bossIndex]! : undefined;
    const bossKey = fighting ? `${bossIndex}|${fighting.hp}` : '';
    if (bossKey !== shownBoss) {
      shownBoss = bossKey;
      bossBar.hidden = !fighting;
      if (fighting) {
        const full = defOf(world.enemyDefs, fighting).hp;
        bossFill.style.width = `${Math.max(0, Math.min(100, (100 * fighting.hp) / full))}%`;
        bossLabel.textContent = bossName(map.meta.seed ?? map.meta.name, fighting.type);
      }
    }
    const ending = state.dead ? 'dead' : state.won ? 'won' : '';
    if (end.dataset.state !== ending) {
      end.dataset.state = ending;
      end.hidden = !ending;
      document.body.classList.toggle('ended', !!ending);
      if (ending) {
        const kills = state.enemies.filter((x) => x.mode === 'dead').length;
        const secretsFound = popcount(state.secrets);
        const stats = { kills, enemies: state.enemies.length, secrets: secretsFound, secretTotal: world.secrets, seconds: state.tick * TICK_DT };
        // File the level with the run: a clear and its score, or one more death.
        if (run && ending === 'won') {
          const seconds = state.tick * TICK_DT;
          run = recordLevel(run, {
            level: here.level, type: map.meta.levelType ?? '', kills, enemies: state.enemies.length, secrets: secretsFound, secretTotal: world.secrets,
            seconds, deaths: run.deaths, score: levelScore({ level: here.level, kills, secrets: secretsFound, seconds }, run.difficulty),
          });
        }
        if (run && ending === 'dead') run = recordDeath(run);
        showEnd(endScreen(ending, { ...here, ...(map.meta.levelType ? { levelType: map.meta.levelType } : {}) }, stats, run));
        // Free the mouse for the buttons (E still moves on).
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }

    // Compass: where W will take you, relative to where you're looking.
    compassArrow.style.transform = `rotate(${((view.yaw - (p.heading * Math.PI) / 2) * 180) / Math.PI}deg)`;
    compassLetter.textContent = HEADING_LETTERS[p.heading];

    const want = doorPrompt(world, state);
    const promptHtml = !want ? '' : want.kind === 'use' ? '<span class="keycap">Space</span>' : KEY_ICON(KEY_COLORS[want.key]!);
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
      `${map.meta.seed ? `level ${here.level} ${map.meta.levelType ?? ''} ${here.difficulty}  seed ${map.meta.seed}  gen ${GENERATOR_VERSION}` : `map ${map.meta.name}`}  ${map.meta.theme ?? ''}\n` +
      `${fps.toFixed(0)} fps  tick ${state.tick}  sector ${p.sector}\n` +
      `cell ${p.cx}, ${p.cy}  z ${p.z.toFixed(0)}` +
      (world.secrets ? `\nsecrets ${popcount(state.secrets)}/${world.secrets}` : '');
    // Messages: shown, then fading once their time is up.
    if (notice !== shownNotice) {
      noticeEl.textContent = shownNotice = notice;
      noticeEl.classList.remove('fade');
    }
    noticeEl.classList.toggle('fade', now >= noticeUntil);

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
