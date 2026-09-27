import { describe, expect, it } from 'vitest';
import { BEST_KEEP, endRun, levelScore, loadBest, loadRun, recordDeath, recordLevel, runFor, runScore } from '../src/run.js';

/** An in-memory stand-in for localStorage. */
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('runs', () => {
  it('scores kills, secrets, the clear and pace, scaled by difficulty and depth', () => {
    const base = { level: 1, kills: 20, secrets: 1, seconds: 60 };
    expect(levelScore(base, 'normal')).toBe(20 * 10 + 250 + 1000 + 750);
    expect(levelScore({ ...base, seconds: 400 }, 'normal')).toBe(20 * 10 + 250 + 1000);
    expect(levelScore(base, 'brutal')).toBe(2 * levelScore(base, 'normal'));
    expect(levelScore({ ...base, level: 3 }, 'normal')).toBe(Math.round(levelScore(base, 'normal') * 1.2));
  });

  it('carries a run across levels, and starts a fresh one for a new id', () => {
    const store = memory();
    let run = runFor('abc', 'hard', store);
    run = recordDeath(run, store);
    expect(loadRun(store)!.deaths).toBe(1);
    run = recordLevel(run, { level: 1, type: 'compound', kills: 10, enemies: 12, secrets: 0, secretTotal: 1, seconds: 90, deaths: run.deaths, score: 900 }, store);
    expect(loadRun(store)).toEqual(run);
    expect(run.deaths).toBe(0);
    expect(runFor('abc', 'easy', store)).toEqual(run); // the same run, whatever the URL now says
    expect(runFor('xyz', 'easy', store).levels).toEqual([]);
  });

  it('files ended runs among the best, keeping the top few', () => {
    const store = memory();
    for (let i = 0; i < BEST_KEEP + 3; i++) {
      const run = recordLevel(runFor(`r${i}`, 'normal', store), { level: 1, type: 'ascent', kills: i, enemies: 20, secrets: 0, secretTotal: 0, seconds: 100, deaths: 0, score: 100 * i }, store);
      endRun(run, store);
      expect(loadRun(store)).toBeNull();
    }
    const best = loadBest(store);
    expect(best).toHaveLength(BEST_KEEP);
    expect(best[0]!.score).toBe(100 * (BEST_KEEP + 2));
    expect(best.map((b) => b.score)).toEqual([...best.map((b) => b.score)].sort((a, b) => b - a));
    expect(runScore({ id: 'x', difficulty: 'normal', started: 0, deaths: 0, levels: [] })).toBe(0);
  });

  it('forgets quietly without storage', () => {
    expect(loadRun(null)).toBeNull();
    expect(runFor('abc', 'normal', null).id).toBe('abc');
    expect(loadBest(null)).toEqual([]);
  });
});

describe('run screens', async () => {
  const { endScreen, summaryScreen } = await import('../src/screens.js');
  const STATS = { kills: 30, enemies: 34, secrets: 1, secretTotal: 1, seconds: 100 };
  const run = { id: 'r', difficulty: 'hard' as const, started: 0, deaths: 2, levels: [{ level: 1, type: 'ascent', kills: 30, enemies: 34, secrets: 1, secretTotal: 1, seconds: 100, deaths: 0, score: 4200 }] };

  it('offers the next level after a clear, a retry after a death, and ending the run in a run', () => {
    const won = endScreen('won', { level: 1 }, STATS, run);
    expect(won).toContain('data-action="next"');
    expect(won).toContain('+4,200');
    expect(won).toContain('data-action="end"');
    const dead = endScreen('dead', { level: 2 }, STATS, run);
    expect(dead).toContain('data-action="retry"');
    expect(dead).toContain('2 deaths on this level');
    expect(endScreen('won', { level: 1, map: 'test01' }, STATS, null)).not.toContain('data-action="end"');
  });

  it('sums the run up and marks its place among the best', () => {
    const html = summaryScreen(run, 0, [{ id: 'r', difficulty: 'hard', levels: 1, kills: 30, score: 4200, ended: 0 }]);
    expect(html).toContain('a new best run');
    expect(html).toContain('<tr class="you">');
  });
});

describe('loading screen', async () => {
  const { loadingScreen, LOADING_STAGES } = await import('../src/screens.js');
  it('shows the level, a bar lit up to the stage, the stage and a tip', () => {
    const html = loadingScreen({ level: 3, levelType: 'descent', theme: 'hell', run: { difficulty: 'hard', score: 0 } }, 1, 'A tip.');
    expect(html).toContain('Level 3');
    expect(html).toContain('descent · hell');
    expect(html.match(/class="on"/g)).toHaveLength(2);
    expect(html).toContain(`${LOADING_STAGES[1]}...`);
    expect(html).toContain('A tip.');
  });
});

describe('run perks', async () => {
  const { choosePerk, runPerks, perkPickedAt } = await import('../src/run.js');
  const { endScreen } = await import('../src/screens.js');
  it('keeps one pick per cleared level, saved with the run, and drops junk from storage', () => {
    const store = memory();
    let run = runFor('r1', 'normal', store);
    run = choosePerk(run, 1, 'hide', store);
    run = choosePerk(run, 2, 'slugs', store);
    run = choosePerk(run, 2, 'undying', store); // a second pick for level 2 replaces the first
    expect(runPerks(run)).toEqual(['hide', 'undying']);
    expect(perkPickedAt(run, 2)).toBe('undying');
    expect(runPerks(loadRun(store))).toEqual(['hide', 'undying']);
    store.setItem('proc-fps.run', JSON.stringify({ ...run, perks: [{ level: 3, id: 'nonsense' }, { level: 1, id: 'hide' }] }));
    expect(runPerks(loadRun(store))).toEqual(['hide']);
  });

  it('asks for a pick before the way on opens, then shows the pick taken', () => {
    const stats = { kills: 1, enemies: 1, secrets: 0, secretTotal: 0, seconds: 30 };
    const run = { id: 'r', difficulty: 'normal' as const, started: 0, deaths: 0, levels: [] };
    const asking = endScreen('won', { level: 1 }, stats, run, { offer: ['hide', 'slugs', 'undying'], held: [] });
    expect(asking.match(/data-perk=/g)).toHaveLength(3);
    expect(asking).not.toContain('data-action="next"');
    const taken = endScreen('won', { level: 1 }, stats, run, { offer: ['hide', 'slugs', 'undying'], chosen: 'slugs', held: [] });
    expect(taken).toContain('data-action="next"');
    expect(taken).toContain('class="chosen" data-perk="slugs"');
  });
});
