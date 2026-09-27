/**
 * Level types: the overall shape of a level, and how a run paces them.
 *
 * - compound: one storey, wide, with more rooms and loops. Hordes and flanking; the breather.
 * - ascent: start at the bottom, exit at the top, 3–6 storeys climbed by lifts, atriums and
 *   bridges, with the occasional drop back down as a shortcut.
 * - descent: start at the top, exit at the bottom, taken mostly by one-way drops: ledges high in
 *   a room's wall you jump from and cannot climb back to.
 *
 * Storeys follow each room's progress along the critical path (see `MissionNode.progress`), so the
 * climb or the fall is spread over the whole level and the exit is at the top or the bottom.
 */
export type LevelType = 'compound' | 'ascent' | 'descent';
export const LEVEL_TYPES: readonly LevelType[] = ['compound', 'ascent', 'descent'];

/** A run leans vertical: compound, ascent, descent, ascent, compound, descent, … (a third flat). */
const PACING: readonly LevelType[] = ['compound', 'ascent', 'descent', 'ascent', 'compound', 'descent'];

export function levelTypeFor(level: number): LevelType {
  return PACING[(Math.max(1, Math.floor(level)) - 1) % PACING.length]!;
}

export const isLevelType = (s: string | null | undefined): s is LevelType => (LEVEL_TYPES as readonly string[]).includes(s ?? '');

type Range = readonly [number, number];

/** Per type: the mission's size, room sizes, storeys, and how storeys are joined. */
export interface LevelProfile {
  type: LevelType;
  /** Storey count (1 = flat); fewer when the mission is too short to spread them. */
  storeys: Range;
  /** Ordinary rooms on the short arc from the start to the gate. */
  shortArc: Range;
  /** Ordinary rooms before and after the mini boss on the long arc. */
  approach: Range;
  retreat: Range;
  detours: Range;
  deadEnds: Range;
  /** Side length of ordinary rooms, in cells. */
  roomSize: Range;
  /** Chance a corridor down a storey (into an ordinary room or the mini boss) becomes a one-way drop. */
  dropChance: number;
  /** Chance an eligible room becomes an atrium: a catwalk ring one storey up, a lift down. */
  atriumChance: number;
  /** Chance a remaining lift corridor becomes a bridge: a catwalk into the lower room. */
  bridgeChance: number;
}

export const LEVEL_PROFILES: Record<LevelType, LevelProfile> = {
  compound: {
    type: 'compound', storeys: [1, 1], shortArc: [1, 3], approach: [1, 3], retreat: [1, 2], detours: [1, 3], deadEnds: [1, 3],
    roomSize: [4, 8], dropChance: 0, atriumChance: 0, bridgeChance: 0,
  },
  ascent: {
    type: 'ascent', storeys: [4, 6], shortArc: [1, 3], approach: [1, 3], retreat: [1, 2], detours: [0, 2], deadEnds: [0, 2],
    roomSize: [3, 7], dropChance: 0.35, atriumChance: 0.6, bridgeChance: 0.5,
  },
  descent: {
    type: 'descent', storeys: [4, 6], shortArc: [1, 3], approach: [1, 3], retreat: [1, 2], detours: [0, 2], deadEnds: [0, 2],
    roomSize: [3, 7], dropChance: 0.85, atriumChance: 0.35, bridgeChance: 0.5,
  },
};
