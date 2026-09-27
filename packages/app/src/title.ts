import { DIFFICULTIES, DIFFICULTY, PLAYER_EYE_HEIGHT, ThingType, isDifficulty, type Difficulty } from '@proc-fps/core';
import { generate } from '@proc-fps/gen';
import { LevelRenderer, WebGL2Backend } from '@proc-fps/render';
import { loadBest, loadRun, runScore } from './run.js';

/**
 * The title screen: the menu over a slowly turning view of a generated level. New run (with a
 * difficulty), Continue (the run in progress, at its next level), the best runs, the seed browser
 * and the controls. Choices go through the URL, like the rest of the game (a run is ?run=…&level=…
 * &diff=…).
 */
const SHOWCASE_SEED = 'title';
const SPIN = 0.12; // radians a second
const DIFFICULTY_KEY = 'proc-fps.difficulty';

export const newRunId = () => Math.random().toString(36).slice(2, 8);

export function runUrl(run: string, level: number, difficulty: Difficulty): string {
  return `./index.html?${new URLSearchParams({ run, level: String(level), ...(difficulty === 'normal' ? {} : { diff: difficulty }) }).toString()}`;
}

function remembered(): Difficulty {
  try {
    const d = localStorage.getItem(DIFFICULTY_KEY);
    return isDifficulty(d) ? d : 'normal';
  } catch {
    return 'normal';
  }
}

export function titleScreen(): void {
  document.body.classList.add('titling');
  const title = document.getElementById('title') as HTMLDivElement;
  title.hidden = false;

  // The menu.
  let difficulty = remembered();
  const saved = loadRun();
  const best = loadBest();
  const fmt = (n: number) => n.toLocaleString('en-US');
  title.innerHTML =
    `<h1>PROC<span>·</span>FPS</h1><p class="tag">An endless descent through procedural hell.</p>` +
    `<div class="menu">` +
    `<div class="diff">${DIFFICULTIES.map((d) => `<button type="button" data-diff="${d}"${d === difficulty ? ' class="on"' : ''}>${DIFFICULTY[d].label}</button>`).join('')}</div>` +
    `<button type="button" class="big" data-action="new">New run</button>` +
    (saved
      ? `<button type="button" class="big alt" data-action="continue">Continue · level ${saved.levels.length + 1} · ${DIFFICULTY[saved.difficulty].label} · ${fmt(runScore(saved))}</button>`
      : '') +
    `<div class="links"><a href="./browse.html">Seed browser</a><button type="button" class="link" data-action="controls">Controls</button></div>` +
    `</div>` +
    `<div class="controls" hidden></div>` +
    (best.length
      ? `<table class="best"><tr><th colspan="4">Best runs</th></tr>${best
          .map((b) => `<tr><td>${fmt(b.score)}</td><td>${b.levels} level${b.levels === 1 ? '' : 's'}</td><td>${b.kills} kills</td><td>${DIFFICULTY[b.difficulty].label}</td></tr>`)
          .join('')}</table>`
      : '');
  const controls = title.querySelector('.controls') as HTMLDivElement;
  controls.innerHTML =
    `<p>WASD steps one square; the mouse looks. The arrow at the top shows where W goes.</p>` +
    `<p>Click to fire. Up close it swings the chainsword (or right-click / V): nothing hurts you while it grinds.</p>` +
    `<p>1 / 2, the wheel or Q switch guns; R reloads. E lobs a grenade (scarce: find them in loot rooms).</p>` +
    `<p>Space opens key doors and secret walls.</p>` +
    `<p>Tab holds the map. Esc pauses. M music, N sound, F3 performance, F8 saves a replay.</p>`;
  title.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-diff], [data-action]');
    if (!el) return;
    if (el.dataset.diff && isDifficulty(el.dataset.diff)) {
      difficulty = el.dataset.diff;
      try {
        localStorage.setItem(DIFFICULTY_KEY, difficulty);
      } catch {
        // Not remembered, that is all.
      }
      title.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('on', b === el));
    }
    if (el.dataset.action === 'new') location.href = runUrl(newRunId(), 1, difficulty);
    if (el.dataset.action === 'continue' && saved) location.href = runUrl(saved.id, saved.levels.length + 1, saved.difficulty);
    if (el.dataset.action === 'controls') controls.hidden = !controls.hidden;
  });

  // The backdrop: a level seen from its start, turning slowly.
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const map = generate(SHOWCASE_SEED, { level: 3, type: 'ascent' });
  const start = map.things.find((t) => t.type === ThingType.PlayerStart)!;
  const backend = WebGL2Backend.create(canvas);
  const renderer = new LevelRenderer(backend);
  renderer.setMap(map);
  const resize = () => {
    const h = renderer.lowResHeight;
    backend.resize(Math.max(1, Math.round((h * canvas.clientWidth) / Math.max(1, canvas.clientHeight))), h);
    renderer.resize();
  };
  addEventListener('resize', resize);
  resize();
  const frame = (ms: number) => {
    const t = ms / 1000;
    renderer.render({ x: start.x, y: start.y, eyeZ: PLAYER_EYE_HEIGHT + 24, yaw: t * SPIN, pitch: -0.04 }, t, []);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
