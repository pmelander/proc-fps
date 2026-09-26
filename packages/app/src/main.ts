import { PLAYER_EYE_HEIGHT, STEP_TICKS, TICK_DT, type MapData } from '@proc-fps/core';
import { GENERATOR_VERSION, generate, validateGenerated } from '@proc-fps/gen';
import { LevelRenderer, WebGL2Backend } from '@proc-fps/render';
import { ReplayRecorder, clonePlayer, createSimState, createWorld, stepSim, type PlayerState } from '@proc-fps/sim';
import test01 from '@proc-fps/core/maps/test01.json';
import { drawAutomap } from './automap.js';
import { InputSampler } from './input.js';

const TEST_MAPS: Record<string, MapData> = { test01: test01 as MapData };
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

function main(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const automap = document.getElementById('automap') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLPreElement;
  const start = document.getElementById('start') as HTMLDivElement;
  const compassArrow = document.getElementById('compass-arrow') as HTMLSpanElement;
  const compassLetter = document.getElementById('compass-letter') as HTMLElement;

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
      acc -= TICK_DT;
    }

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

    if (!automap.hidden) drawAutomap(automap, map, view);
    hud.textContent =
      `${map.meta.seed ? `seed ${map.meta.seed}  gen ${GENERATOR_VERSION}` : `map ${map.meta.name}`}\n` +
      `${fps.toFixed(0)} fps  tick ${state.tick}  sector ${p.sector}\n` +
      `cell ${p.cx}, ${p.cy}  z ${p.z.toFixed(0)}`;

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
