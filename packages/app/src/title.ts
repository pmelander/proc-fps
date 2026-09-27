import { DIFFICULTIES, DIFFICULTY, PLAYER_EYE_HEIGHT, ThingType, isDifficulty, type Difficulty } from '@proc-fps/core';
import { GENERATOR_VERSION, generate } from '@proc-fps/gen';
import { LevelRenderer, WebGL2Backend } from '@proc-fps/render';
import { AudioEngine } from './audio/engine.js';
import { loadBest, loadRun, runScore } from './run.js';
import { controlsHtml } from './screens.js';
import { loadOptions } from './options.js';
import { Menu } from './ui/menu.js';
import { OptionsPanel } from './ui/optionspanel.js';
import { installSkin } from './ui/skin.js';

/**
 * The title screen: the logo and a menu over a slowly turning view of a generated level. New run,
 * Continue (the run in progress, at its next level), the difficulty, the best runs, the controls
 * and the seed browser; the mouse or the keys (ui/menu.ts). Choices go through the URL, like the
 * rest of the game (a run is ?run=…&level=…&diff=…).
 */
const SHOWCASE_SEED = 'title';
const SPIN = 0.12; // radians a second
const DIFFICULTY_KEY = 'proc-fps.difficulty';
/** A line on each difficulty, under the menu while it is chosen. */
const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  easy: 'Fewer of them, softer blows, more health lying around.',
  normal: 'The descent as it was meant.',
  hard: 'More of them, harder hits, less to heal with.',
  brutal: 'A horde at every door. Health is scarce.',
};

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
  const map = generate(SHOWCASE_SEED, { level: 3, type: 'ascent' });
  installSkin(map.meta.theme ?? 'base');
  const title = document.getElementById('title') as HTMLDivElement;
  title.hidden = false;

  // Menu sounds, once a click or a key allows audio (no music here).
  const audio = new AudioEngine(SHOWCASE_SEED);
  let options = loadOptions();
  audio.setVolumes(options.music / 10, options.sound / 10);
  const unlock = () => audio.unlock({ music: false });
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });
  const sound = (kind: 'move' | 'choose' | 'adjust' | 'back') => audio.play(kind === 'move' || kind === 'adjust' ? 'menuMove' : kind === 'back' ? 'menuBack' : 'menuChoose');

  let difficulty = remembered();
  const saved = loadRun();
  const best = loadBest();
  const fmt = (n: number) => n.toLocaleString('en-US');
  title.innerHTML =
    `<h1 class="logo">Null Sector</h1>` +
    `<p class="tag">An endless descent through procedural hell</p>` +
    `<div class="stripe"></div>` +
    `<nav class="menu plate main">` +
    `<button type="button" data-item data-action="new">New run</button>` +
    (saved
      ? `<button type="button" data-item data-action="continue">Continue <span class="aside">level ${saved.levels.length + 1} · ${DIFFICULTY[saved.difficulty].label} · ${fmt(runScore(saved))}</span></button>`
      : '') +
    `<button type="button" data-item data-adjust data-action="difficulty">Difficulty <span class="value"><i data-dir="-1">◀</i> <b class="diff"></b> <i data-dir="1">▶</i></span></button>` +
    (best.length ? `<button type="button" data-item data-action="best">Hall of the fallen</button>` : '') +
    `<button type="button" data-item data-action="options">Options</button>` +
    `<button type="button" data-item data-action="controls">Controls</button>` +
    `<button type="button" data-item data-action="browse">Seed browser</button>` +
    `</nav>` +
    `<p class="hint"></p>` +
    `<div class="panel plate" data-panel="best" hidden>` +
    `<table class="list"><tr><th colspan="5">Hall of the fallen</th></tr>${best
      .map((b, i) => `<tr><td>${i + 1}</td><td>${fmt(b.score)}</td><td>${b.levels} level${b.levels === 1 ? '' : 's'}</td><td>${b.kills} kills</td><td>${DIFFICULTY[b.difficulty].label}</td></tr>`)
      .join('')}</table>` +
    `<nav class="menu"><button type="button" data-item data-action="back">Back</button></nav></div>` +
    `<div class="panel plate" data-panel="options" hidden></div>` +
    `<div class="panel plate" data-panel="controls" hidden>${controlsHtml()}<nav class="menu"><button type="button" data-item data-action="back">Back</button></nav></div>` +
    `<footer>W S or arrows to choose · Enter to pick · generator ${GENERATOR_VERSION}</footer>`;

  const main = title.querySelector('.menu.main') as HTMLElement;
  const hint = title.querySelector('.hint') as HTMLElement;
  const diffLabel = title.querySelector('.diff') as HTMLElement;
  const showDifficulty = () => {
    diffLabel.textContent = DIFFICULTY[difficulty].label;
  };
  showDifficulty();
  const hints: Record<string, () => string> = {
    new: () => `A fresh descent on ${DIFFICULTY[difficulty].label}.`,
    continue: () => 'Back into the run in progress, at its next level.',
    difficulty: () => DIFFICULTY_BLURB[difficulty],
    best: () => 'The best runs so far.',
    controls: () => 'How to move, fight and find your way.',
    options: () => 'Mouse, view, sound and comfort.',
    browse: () => 'Preview the levels seeds make.',
  };
  const setDifficulty = (d: Difficulty) => {
    difficulty = d;
    try {
      localStorage.setItem(DIFFICULTY_KEY, difficulty);
    } catch {
      // Not remembered, that is all.
    }
    showDifficulty();
  };

  // A panel (best runs, controls) replaces the menu until it is backed out of.
  let panel: { el: HTMLElement; menu: Menu } | null = null;
  const closePanel = () => {
    if (!panel) return;
    panel.menu.close();
    panel.el.hidden = true;
    panel = null;
    title.classList.remove('sub');
  };
  const openPanel = (name: string) => {
    const el = title.querySelector(`[data-panel="${name}"]`) as HTMLElement;
    title.classList.add('sub');
    if (name === 'options') {
      const apply = (o: typeof options) => {
        options = o;
        audio.setVolumes(o.music / 10, o.sound / 10);
        if (renderer.lowResHeight !== o.resolution) {
          renderer.lowResHeight = o.resolution;
          resize();
        }
      };
      new OptionsPanel(el, options, apply, sound, () => title.classList.remove('sub'));
      return;
    }
    el.hidden = false;
    panel = { el, menu: new Menu(el, { choose: closePanel, back: closePanel, sound }) };
  };

  const menu = new Menu(main, {
    choose: (item) => {
      const action = item.dataset.action;
      if (action === 'new') location.href = runUrl(newRunId(), 1, difficulty);
      if (action === 'continue' && saved) location.href = runUrl(saved.id, saved.levels.length + 1, saved.difficulty);
      if (action === 'best' || action === 'controls' || action === 'options') openPanel(action);
      if (action === 'browse') location.href = './browse.html';
    },
    adjust: (_, dir) => {
      const i = DIFFICULTIES.indexOf(difficulty);
      setDifficulty(DIFFICULTIES[(i + dir + DIFFICULTIES.length) % DIFFICULTIES.length]!);
    },
    sound,
  });
  const showHint = () => {
    hint.textContent = hints[menu.selected?.dataset.action ?? '']?.() ?? '';
  };
  // The hint follows the selection (and the difficulty as it turns).
  const observer = new MutationObserver(showHint);
  observer.observe(main, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true });
  showHint();

  // The backdrop: a level seen from its start, turning slowly.
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const start = map.things.find((t) => t.type === ThingType.PlayerStart)!;
  const backend = WebGL2Backend.create(canvas);
  const renderer = new LevelRenderer(backend);
  renderer.lowResHeight = options.resolution;
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
