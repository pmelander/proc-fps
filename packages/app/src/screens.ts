import { DIFFICULTY, PERKS, type Difficulty, type PerkId } from '@proc-fps/core';
import { runKills, runScore, type BestRun, type RunRecord } from './run.js';

// The pause, end-of-level and run-summary screens: HTML strings, pure, so they can be checked in
// Node. Menus are `.menu` lists of `[data-item]` buttons (ui/menu.ts); numbers to count up on
// arrival carry `data-count` (ui/tally.ts) and already hold their final text.

const fmt = (n: number) => n.toLocaleString('en-US');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The controls, as key caps and what they do. */
export const CONTROLS: readonly [readonly string[], string][] = [
  [['W', 'A', 'S', 'D'], 'Step one square (the arrow up top shows where W goes)'],
  [['Mouse'], 'Look'],
  [['Click'], 'Fire; with an enemy in reach, the chainsword (nothing hurts you while it grinds)'],
  [['Right'], 'Lob a grenade (scarce: find them in loot rooms)'],
  [['1', '2', 'Q'], 'Switch guns (or the wheel)'],
  [['R'], 'Reload'],
  [['E'], 'Open key doors and secret walls (or Space)'],
  [['Tab'], 'Hold for the map'],
  [['Esc'], 'Pause'],
  [['M', 'N'], 'Music, sound'],
  [['F2', 'F3', 'F8'], 'New run, performance, save a replay'],
];

export function controlsHtml(): string {
  return `<div class="controls">${CONTROLS.map(([keys, does]) => `<span class="keys">${keys.map((k) => `<span class="key">${k}</span>`).join('')}</span><span class="does">${does}</span>`).join('')}</div>`;
}

/** What the pause screen says about the level: its number and type, or the seed or test map. */
export interface PauseInfo {
  level: number;
  levelType?: string;
  theme?: string;
  seed?: string;
  map?: string;
  run?: { difficulty: Difficulty; score: number } | null;
  /** The run's perks, in the order picked. */
  perks?: readonly PerkId[];
}

/** Perks held, as a line: "Thick hide ×2 · Undying". */
export function perksLine(perks: readonly PerkId[]): string {
  const counts = new Map<PerkId, number>();
  for (const p of perks) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].map(([id, n]) => `${PERKS[id].name}${n > 1 ? ` ×${n}` : ''}`).join(' · ');
}

/** The pause screen; before the first click of a level it is the level's title card. */
export function pauseScreen(info: PauseInfo, started: boolean): string {
  const what = info.map ? `Test map ${info.map}` : info.run ? `Level ${info.level}` : `Seed ${info.seed ?? ''}`;
  const kind = [info.levelType, info.theme && info.theme !== 'base' ? info.theme : ''].filter(Boolean).join(' · ');
  const runLine = info.run ? `${DIFFICULTY[info.run.difficulty].label} run · score ${fmt(info.run.score)}` : '';
  return (started
    ? `<p class="kicker">${what}${kind ? ` · ${kind}` : ''}</p><h1 class="heading huge">Paused</h1>`
    : `<p class="kicker">${kind || '&nbsp;'}</p><h1 class="heading huge">${what}</h1>`) +
    `<div class="stripe" style="width: 60%"></div>` +
    `<p class="blink">Click to ${started ? 'fight on' : 'fight'}</p>` +
    `<div class="panel plate" data-panel="controls" hidden>${controlsHtml()}<nav class="menu"><button type="button" data-item data-action="back">Back</button></nav></div>` +
    `<div class="panel plate" data-panel="options" hidden></div>` +
    (runLine ? `<p class="run">${runLine}</p>` : '') +
    (info.perks?.length ? `<p class="run">${perksLine(info.perks)}</p>` : '') +
    `<nav class="menu row">` +
    `<button type="button" data-item data-action="resume">${started ? 'Resume' : 'Fight'} <span class="key">Enter</span></button>` +
    `<button type="button" data-item data-action="options">Options</button>` +
    `<button type="button" data-item data-action="controls">Controls</button>` +
    `<button type="button" data-item data-action="title">Quit to title</button>` +
    `<button type="button" data-item data-action="browse">Seed browser</button>` +
    `</nav>`;
}

/** A level's end: what the player did there. */
export interface LevelStats {
  kills: number;
  enemies: number;
  secrets: number;
  secretTotal: number;
  seconds: number;
}

/** The end-of-level screen: this level's tally, the run so far, and what next. */
/** The perk pick after a cleared level of a run: the three on offer, and the one chosen, if any. */
export interface PerkPick {
  offer: readonly PerkId[];
  chosen?: PerkId | undefined;
  /** Perks held before this pick. */
  held: readonly PerkId[];
}

function perkCards(pick: PerkPick): string {
  const cards = pick.offer.map((id) => {
    const n = pick.held.filter((p) => p === id).length;
    const state = pick.chosen === undefined ? 'data-item' : pick.chosen === id ? 'class="chosen"' : 'class="passed"';
    return `<button type="button" ${state} data-perk="${id}"><span class="name">${PERKS[id].name}</span><span class="blurb">${PERKS[id].blurb}</span>` +
      `<span class="held">${n ? `held ${n} of ${PERKS[id].max}` : '&nbsp;'}</span></button>`;
  });
  return `<p class="kicker pick">${pick.chosen === undefined ? 'Choose an upgrade' : 'Upgrade taken'}</p><nav class="menu row perks">${cards.join('')}</nav>`;
}

export function endScreen(ending: 'dead' | 'won', here: { level: number; map?: string; levelType?: string }, stats: LevelStats, run: RunRecord | null, pick?: PerkPick): string {
  const cleared = run?.levels.find((l) => l.level === here.level);
  const kicker = here.map ? `Test map ${here.map}` : `Level ${here.level}${here.levelType ? ` · ${here.levelType}` : ''}`;
  const title = ending === 'dead' ? `<h1 class="heading huge dead">You died</h1>` : `<h1 class="heading huge">${here.map ? 'Cleared' : `Level ${here.level} cleared`}</h1>`;
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 100);
  const rows =
    `<tr><th>Kills</th><td data-count="${stats.kills}">${stats.kills}</td><td class="of">/ ${stats.enemies} · ${pct(stats.kills, stats.enemies)}%</td></tr>` +
    (stats.secretTotal ? `<tr><th>Secrets</th><td data-count="${stats.secrets}">${stats.secrets}</td><td class="of">/ ${stats.secretTotal}</td></tr>` : '') +
    `<tr><th>Time</th><td data-count="${Math.floor(stats.seconds)}" data-format="time">${clock(stats.seconds)}</td><td class="of"></td></tr>` +
    (ending === 'won' && cleared ? `<tr class="score"><th>Score</th><td data-count="${cleared.score}" data-format="score">+${fmt(cleared.score)}</td><td class="of"></td></tr>` : '');
  const runLine = run
    ? `<p class="run">${DIFFICULTY[run.difficulty].label} run · ${plural(run.levels.length, 'level')} cleared · ${runKills(run)} kills · score ${fmt(runScore(run))}${run.deaths ? ` · ${plural(run.deaths, 'death')} on this level` : ''}</p>`
    : '';
  // After a clear with an upgrade to pick, the way on opens once it is picked.
  const picking = ending === 'won' && pick !== undefined && pick.offer.length > 0 && pick.chosen === undefined;
  const next = ending === 'dead'
    ? `<button type="button" data-item data-action="retry">Try again <span class="key">E</span></button>`
    : picking
      ? ''
      : `<button type="button" data-item data-action="next">${here.map ? 'Again' : `Level ${here.level + 1}`} <span class="key">E</span></button>`;
  const quit = run
    ? `<button type="button" data-item data-action="end">End run</button>`
    : `<button type="button" data-item data-action="title">Title screen</button>`;
  return `<p class="kicker">${kicker}</p>${title}<div class="stripe" style="width: 70%"></div>` +
    `<div class="plate"><table class="tally">${rows}</table></div>${runLine}` +
    (ending === 'won' && pick?.offer.length ? perkCards(pick) : '') +
    `<nav class="menu row">${next}${quit}</nav>`;
}

/** The run's final summary: every level cleared, the total, and where it ranks among the best. */
export function summaryScreen(run: RunRecord, rank: number, best: readonly BestRun[]): string {
  const rows = run.levels
    .map((l) => `<tr><td>${l.level}</td><td>${l.type}</td><td>${l.kills}/${l.enemies}</td><td>${l.secrets}/${l.secretTotal}</td><td>${clock(l.seconds)}</td><td>${l.deaths}</td><td>${fmt(l.score)}</td></tr>`)
    .join('');
  const table = best
    .map((b, i) => `<tr${i === rank ? ' class="you"' : ''}><td>${i + 1}</td><td>${fmt(b.score)}</td><td>${plural(b.levels, 'level')}</td><td>${b.kills} kills</td><td>${DIFFICULTY[b.difficulty].label}</td></tr>`)
    .join('');
  const place = rank === 0 ? ' · a new best run!' : rank > 0 ? ` · best run #${rank + 1}` : '';
  return `<p class="kicker">${DIFFICULTY[run.difficulty].label} · ${plural(run.levels.length, 'level')} cleared · ${runKills(run)} kills${place}</p>` +
    `<h1 class="heading huge">Run over</h1><div class="stripe" style="width: 70%"></div>` +
    `<p class="total" data-count="${runScore(run)}" data-format="score">${fmt(runScore(run))}</p>` +
    (rows ? `<div class="plate list"><table class="list"><tr><th>level</th><th>type</th><th>kills</th><th>secrets</th><th>time</th><th>deaths</th><th>score</th></tr>${rows}</table></div>` : '') +
    (table ? `<div class="plate list"><table class="list best"><tr><th colspan="5">Hall of the fallen</th></tr>${table}</table></div>` : '') +
    `<nav class="menu row"><button type="button" data-item data-action="new">New run <span class="key">E</span></button><button type="button" data-item data-action="title">Title screen</button></nav>`;
}

/** The stages of loading a level, in order (main.ts yields to the page between them). */
export const LOADING_STAGES = ['Carving the sectors', 'Baking the walls', 'Breeding the mutants', 'Waking the horde'] as const;

/** A line of advice for the loading screen. */
export const TIPS: readonly string[] = [
  'Wardens lower their shields to fire: that is your window.',
  'A charger bellows before it rushes. Step out of its lane.',
  'Shoot a bloater among its friends.',
  'Nothing hurts you while the chainsword grinds. Bosses excepted.',
  'Berserk and overcharge wait where the fighting is.',
  'One step sideways dodges what grunts throw.',
  'Break a sniper’s line of sight before its shot lands.',
  'Grenades are scarce. Save them for crowds and bosses.',
  'Armour soaks up half of every hit.',
  'A glowing ring on the floor means a slam is coming. Get out of it.',
  'Hold Tab for the map.',
  'Secret rooms hide behind walls that open with E.',
];

/** The loading screen: the level's title card, a bar through the loading stages, and a tip. */
export function loadingScreen(info: PauseInfo, stage: number, tip: string): string {
  const what = info.map ? `Test map ${info.map}` : info.run ? `Level ${info.level}` : `Seed ${info.seed ?? ''}`;
  const kind = [info.levelType, info.theme && info.theme !== 'base' ? info.theme : ''].filter(Boolean).join(' · ');
  const n = LOADING_STAGES.length;
  const at = Math.max(0, Math.min(n - 1, stage));
  return `<p class="kicker">${kind || '&nbsp;'}</p><h1 class="heading huge">${what}</h1>` +
    `<div class="stripe" style="width: 60%"></div>` +
    `<div class="loadbar">${Array.from({ length: n }, (_, i) => `<i${i <= at ? ' class="on"' : ''}></i>`).join('')}</div>` +
    `<p class="stage">${LOADING_STAGES[at]}...</p>` +
    `<p class="tip">${tip}</p>`;
}
