import type { MapData } from './map.js';

/**
 * Difficulty: a run-wide setting. The generator scales how many enemies a level holds and how
 * much health lies around (`enemies`, `health`); the sim scales the damage enemies do (`damage`);
 * the app scales the score (`score`). Normal is the tuned game: its maps are exactly what they were
 * before difficulties existed (the map only records a difficulty other than normal).
 */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'brutal'];

export interface DifficultyDef {
  label: string;
  /** Enemy budget per room, and escorts, times this. */
  enemies: number;
  /** Chances of health lying in an ordinary room, times this. */
  health: number;
  /** Damage enemies do, times this. */
  damage: number;
  /** A level's score, times this. */
  score: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: { label: 'Easy', enemies: 0.7, health: 1.4, damage: 0.7, score: 0.5 },
  normal: { label: 'Normal', enemies: 1, health: 1, damage: 1, score: 1 },
  hard: { label: 'Hard', enemies: 1.3, health: 0.8, damage: 1.2, score: 1.5 },
  brutal: { label: 'Brutal', enemies: 1.6, health: 0.65, damage: 1.4, score: 2 },
};

export const isDifficulty = (s: string | null | undefined): s is Difficulty => (DIFFICULTIES as readonly string[]).includes(s ?? '');

/** The difficulty a map was generated at (normal when it records none). */
export function difficultyOf(map: MapData): Difficulty {
  return isDifficulty(map.meta.difficulty) ? map.meta.difficulty : 'normal';
}
