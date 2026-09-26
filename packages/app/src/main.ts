import { DoorKind, HEADING_DX, HEADING_DY, PLAYER_EYE_HEIGHT, STEP_TICKS, TICK_DT, type MapData } from '@proc-fps/core';
import { GENERATOR_VERSION, generate, validateGenerated } from '@proc-fps/gen';
import { HIDDEN_OFFSET, LevelRenderer, WebGL2Backend } from '@proc-fps/render';
import {
  ReplayRecorder,
  clonePlayer,
  createSimState,
  createWorld,
  doorAtCell,
  doorOffset,
  stepSim,
  type PlayerState,
  type SimState,
  type World,
} from '@proc-fps/sim';
import test01 from '@proc-fps/core/maps/test01.json';
import test02 from '@proc-fps/core/maps/test02.json';
import { drawAutomap } from './automap.js';
import { InputSampler } from './input.js';

const TEST_MAPS: Record<string, MapData> = { test01: test01 as MapData, test02: test02 as MapData };
/** Key ids 0–3. Matches keyColor() in the level shader. */
const KEY_NAMES = ['blue', 'red', 'yellow', 'green'] as const;
const KEY_COLORS = ['#4073ff', '#ff3826', '#ffd933', '#40e64d'] as const;
const NOTICE_SECONDS = 2.5;
const MAX_FRAME_TIME = 0.25; // avoid spiral of death after tab-out
const BOB_HEIGHT = 2.5;
const HEADING_LETTERS = ['E', 'N', 'W', 'S'] as const;

/** Render-only head bob from step progress. */
function bob(p: PlayerState): number {
  return p.stepTick === 0 ? 0 : Math.sin((Math.PI * p.stepTick) / STEP_TICKS) * BOB_HEIGHT;
}

function loadMap(): MapData {
  const params = new URLSearchParams(location.search);
  const named = params.get('map');
  if (named) {
    const m = TEST_MAPS[named];
    if (!m) throw new Error(`unknown test map "${named}"`);
    return m;
  }
  let seed = params.get('seed');
  if (!seed) {
    seed = Math.random().toString(36).slice(2, 10); // UI-level randomness only; the sim never sees it
    params.set('seed', seed);
    history.replaceState(null, '', `?${params.toString()}`);
  }
  const map = generate(seed);
  const errors = validateGenerated(map);
  if (errors.length) console.warn(`seed ${seed} failed validation:`, errors);
  return map;
}

function newLevel(): void {
  const params = new URLSearchParams();
  params.set('seed', Math.random().toString(36).slice(2, 10));
  location.search = params.toString();
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

function main(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const automap = document.getElementById('automap') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLPreElement;
  const start = document.getElementById('start') as HTMLDivElement;
  const compassArrow = document.getElementById('compass-arrow') as HTMLSpanElement;
  const compassLetter = document.getElementById('compass-letter') as HTMLElement;
  const prompt = document.getElementById('prompt') as HTMLDivElement;
  let notice = '';
  let noticeUntil = 0;
  let shownPrompt = '';

  const map = loadMap();
  const world = createWorld(map);
  const state = createSimState(world);
  let prev: PlayerState = clonePlayer(state.player);
  const recorder = new ReplayRecorder(map);

  const backend = WebGL2Backend.create(canvas);
  const renderer = new LevelRenderer(backend);
  renderer.setMap(map);

  const input = new InputSampler(canvas);
  start.addEventListener('click', () => void canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', () => (start.hidden = input.locked));

  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') automap.hidden = false;
    if (e.code === 'F2') newLevel();
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
    while (acc >= TICK_DT) {
      prev = clonePlayer(state.player);
      const f = input.sample();
      if (input.locked) recorder.record(f);
      stepSim(world, state, f);
      for (const e of state.events) {
        if (e.type === 'key') [notice, noticeUntil] = [`Picked up the ${KEY_NAMES[e.key]} key`, now + NOTICE_SECONDS];
        if (e.type === 'locked') [notice, noticeUntil] = [`Needs the ${KEY_NAMES[e.key]} key`, now + NOTICE_SECONDS];
        if (e.type === 'secret') [notice, noticeUntil] = ['You found a secret!', now + NOTICE_SECONDS];
      }
      acc -= TICK_DT;
    }
    world.doors.forEach((_, i) => (renderer.movers[i] = doorOffset(world, state, i)));
    world.keys.forEach((_, i) => (renderer.movers[world.doors.length + i] = state.taken & (1 << i) ? HIDDEN_OFFSET : 0));

    const t = acc / TICK_DT;
    const p = state.player;
    const view = {
      x: lerp(prev.x, p.x, t),
      y: lerp(prev.y, p.y, t),
      eyeZ: lerp(prev.z + bob(prev), p.z + bob(p), t) + PLAYER_EYE_HEIGHT,
      yaw: lerpAngle(prev.angle, p.angle, t),
      pitch: lerp(prev.pitch, p.pitch, t),
    };
    renderer.render(view, now);

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
    const held = KEY_NAMES.filter((_, k) => state.keys & (1 << k));
    hud.textContent =
      `${map.meta.seed ? `seed ${map.meta.seed}  gen ${GENERATOR_VERSION}` : `map ${map.meta.name}`}\n` +
      `${fps.toFixed(0)} fps  tick ${state.tick}  sector ${p.sector}\n` +
      `cell ${p.cx}, ${p.cy}  z ${p.z.toFixed(0)}` +
      (held.length ? `\nkeys: ${held.join(' ')}` : '') +
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
