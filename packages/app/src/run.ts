import { DIFFICULTY, isDifficulty, type Difficulty } from '@proc-fps/core';

/**
 * A run: a sequence of levels at one difficulty, tracked across page loads (each level is its own
 * page). What each cleared level scored is kept in the browser's storage, with the deaths on the
 * level being played; ending a run files it among the best runs. Browser storage only: it can be
 * missing or blocked, and then the game simply forgets (every access is guarded).
 */
export interface LevelRecord {
  level: number;
  /** Level type (compound, ascent, descent). */
  type: string;
  kills: number;
  enemies: number;
  secrets: number;
  secretTotal: number;
  seconds: number;
  /** Deaths before it was cleared. */
  deaths: number;
  score: number;
}

export interface RunRecord {
  id: string;
  difficulty: Difficulty;
  /** Date.now() when it began. */
  started: number;
  levels: LevelRecord[];
  /** Deaths on the level being played now. */
  deaths: number;
}

export interface BestRun {
  id: string;
  difficulty: Difficulty;
  /** Levels cleared. */
  levels: number;
  kills: number;
  score: number;
  /** Date.now() when it ended. */
  ended: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RUN_KEY = 'proc-fps.run';
const BEST_KEY = 'proc-fps.best';
/** Best runs kept. */
export const BEST_KEEP = 8;

/** The browser's storage, or null where it is unavailable (private windows, blocked storage). */
export function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read<T>(store: Store | null, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: Store | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the run just is not remembered.
  }
}

/**
 * A cleared level's score: kills, secrets and the clear itself, a bonus for pace (full under a
 * minute and a half, nothing past six), scaled by difficulty and a little by how deep into the
 * run it is.
 */
export function levelScore(r: Pick<LevelRecord, 'level' | 'kills' | 'secrets' | 'seconds'>, difficulty: Difficulty): number {
  const pace = Math.max(0, Math.min(1, (360 - r.seconds) / 270));
  return Math.round((r.kills * 10 + r.secrets * 250 + 1000 + pace * 750) * DIFFICULTY[difficulty].score * (1 + 0.1 * (r.level - 1)));
}

export const runScore = (run: RunRecord): number => run.levels.reduce((a, l) => a + l.score, 0);
export const runKills = (run: RunRecord): number => run.levels.reduce((a, l) => a + l.kills, 0);

/** The run in progress, if any. */
export function loadRun(store: Store | null = browserStore()): RunRecord | null {
  const run = read<RunRecord>(store, RUN_KEY);
  return run && typeof run.id === 'string' && isDifficulty(run.difficulty) && Array.isArray(run.levels) ? run : null;
}

export function saveRun(run: RunRecord, store: Store | null = browserStore()): void {
  write(store, RUN_KEY, run);
}

export function clearRun(store: Store | null = browserStore()): void {
  try {
    store?.removeItem(RUN_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The run with this id, carried on, or a fresh one (a new id, or none saved). */
export function runFor(id: string, difficulty: Difficulty, store: Store | null = browserStore()): RunRecord {
  const saved = loadRun(store);
  if (saved && saved.id === id) return saved;
  const run: RunRecord = { id, difficulty, started: Date.now(), levels: [], deaths: 0 };
  saveRun(run, store);
  return run;
}

/** Files a cleared level (replacing an earlier clear of the same level) and resets the deaths. */
export function recordLevel(run: RunRecord, record: LevelRecord, store: Store | null = browserStore()): RunRecord {
  const next: RunRecord = { ...run, levels: [...run.levels.filter((l) => l.level !== record.level), record].sort((a, b) => a.level - b.level), deaths: 0 };
  saveRun(next, store);
  return next;
}

export function recordDeath(run: RunRecord, store: Store | null = browserStore()): RunRecord {
  const next = { ...run, deaths: run.deaths + 1 };
  saveRun(next, store);
  return next;
}

export function loadBest(store: Store | null = browserStore()): BestRun[] {
  const best = read<BestRun[]>(store, BEST_KEY);
  return Array.isArray(best) ? best.filter((b) => b && typeof b.score === 'number') : [];
}

/** Ends a run: files it among the best runs and forgets it. Returns its place (0 = best), or -1. */
export function endRun(run: RunRecord, store: Store | null = browserStore()): number {
  const entry: BestRun = { id: run.id, difficulty: run.difficulty, levels: run.levels.length, kills: runKills(run), score: runScore(run), ended: Date.now() };
  const best = [...loadBest(store), entry].sort((a, b) => b.score - a.score).slice(0, BEST_KEEP);
  write(store, BEST_KEY, best);
  clearRun(store);
  return best.indexOf(entry);
}
