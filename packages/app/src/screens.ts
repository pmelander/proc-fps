import { DIFFICULTY } from '@proc-fps/core';
import { runKills, runScore, type BestRun, type RunRecord } from './run.js';

// The end-of-level and run-summary screens: HTML strings, pure, so they can be checked in Node.

/** The end-of-level screen: this level's stats, the run so far, and what next. */
export function endScreen(ending: 'dead' | 'won', here: { level: number; map?: string }, stats: string, run: RunRecord | null): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const cleared = run?.levels.find((l) => l.level === here.level);
  const title = ending === 'dead' ? 'You died' : `Level ${here.level} complete`;
  const score = ending === 'won' && cleared ? `<p class="score">+${fmt(cleared.score)}</p>` : '';
  const runLine = run
    ? `<p class="run">${DIFFICULTY[run.difficulty].label} run · ${run.levels.length} level${run.levels.length === 1 ? '' : 's'} cleared · ${runKills(run)} kills · score ${fmt(runScore(run))}${run.deaths ? ` · ${run.deaths} death${run.deaths === 1 ? '' : 's'} on this level` : ''}</p>`
    : '';
  const next = ending === 'dead'
    ? `<button type="button" data-action="retry">Try level ${here.level} again <kbd>E</kbd></button>`
    : `<button type="button" data-action="next">${here.map ? 'Again' : `Level ${here.level + 1}`} <kbd>E</kbd></button>`;
  const quit = run ? `<button type="button" class="alt" data-action="end">End run</button>` : '';
  return `<p class="title">${title}</p>${stats}${score}${runLine}<div class="buttons">${next}${quit}</div>`;
}

/** The run's final summary: every level cleared, the total, and where it ranks among the best. */
export function summaryScreen(run: RunRecord, rank: number, best: readonly BestRun[]): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const rows = run.levels
    .map((l) => `<tr><td>${l.level}</td><td>${l.type}</td><td>${l.kills}/${l.enemies}</td><td>${l.secrets}/${l.secretTotal}</td><td>${time(l.seconds)}</td><td>${l.deaths}</td><td>${fmt(l.score)}</td></tr>`)
    .join('');
  const table = best
    .map((b, i) => `<tr${i === rank ? ' class="you"' : ''}><td>${i + 1}</td><td>${fmt(b.score)}</td><td>${b.levels} level${b.levels === 1 ? '' : 's'}</td><td>${b.kills} kills</td><td>${DIFFICULTY[b.difficulty].label}</td></tr>`)
    .join('');
  return `<p class="title">Run over</p><p class="score">${fmt(runScore(run))}</p>` +
    `<p class="run">${DIFFICULTY[run.difficulty].label} · ${run.levels.length} level${run.levels.length === 1 ? '' : 's'} cleared · ${runKills(run)} kills${rank === 0 ? ' · a new best run!' : rank > 0 ? ` · best run #${rank + 1}` : ''}</p>` +
    (rows ? `<table><tr><th>level</th><th>type</th><th>kills</th><th>secrets</th><th>time</th><th>deaths</th><th>score</th></tr>${rows}</table>` : '') +
    (table ? `<table class="best"><tr><th colspan="5">Best runs</th></tr>${table}</table>` : '') +
    `<div class="buttons"><button type="button" data-action="new">New run</button><button type="button" class="alt" data-action="title">Title screen</button></div>`;
}
