import { BaseTex as T, SPECIAL_DAMAGE, type Rng, type TextureId } from '@proc-fps/core';
import type { RoomKind } from './mission.js';

/**
 * Room templates: hand-authored archetypes with procedural parameters. A design assigns
 * every cell of a w × h room to a region (or solid), with region 0 the base floor.
 *
 * Every template keeps the room's outer ring of cells as base floor. Doorways always meet
 * the ring, so all doorways stay connected however the interior is shaped, and every
 * interior region is reachable from the ring and climbable back to it (steps ≤ MAX_STEP)
 * unless it is deliberately out of reach, like a plinth. Templates also avoid regions that
 * touch themselves only at a corner, which the cell-plan emitter rejects.
 */
export type RoomTemplate = 'plain' | 'hall' | 'platform' | 'pit' | 'stairs' | 'arena' | 'catwalk';

export interface RoomRegion {
  /** Floor offset from the room's base floor. */
  rise: number;
  /** Omitted = the room's own textures. */
  floorTex?: TextureId;
  /** Sector special bits (e.g. SPECIAL_DAMAGE for a hazard pit). */
  special?: number;
  /** A slab across the region, relative to the room's base floor (a catwalk). */
  slab?: { bottom: number; top: number };
  wallTex?: TextureId;
  lightDelta: number;
}

export interface RoomDesign {
  template: RoomTemplate;
  regions: RoomRegion[];
  /** Region index per cell, row-major from the room's south-west corner; -1 = solid. */
  cells: Int8Array;
  /** Highest walkable rise, so the room's ceiling leaves headroom above it. */
  maxRise: number;
}

const SOLID = -1;
const HAZARD_PIT_CHANCE = 0.5;
const CATWALK_HAZARD_CHANCE = 0.3;
const STEP = 16;
const BASE: RoomRegion = { rise: 0, lightDelta: 0 };

/** Template weights for ordinary rooms; a template that does not fit the room is skipped. */
const ROOM_WEIGHTS: readonly (readonly [RoomTemplate, number])[] = [
  ['plain', 1],
  ['hall', 2],
  ['platform', 2],
  ['pit', 1.5],
  ['stairs', 2],
  ['catwalk', 3],
];

/** An empty room: base floor everywhere (bridge rooms, where a catwalk and a lift take the space). */
export function plainDesign(w: number, h: number): RoomDesign {
  return { template: 'plain', regions: [BASE], cells: new Int8Array(w * h), maxRise: 0 };
}

export function designRoom(kind: RoomKind, w: number, h: number, rng: Rng): RoomDesign {
  const iw = w - 2;
  const ih = h - 2;
  const fits: Record<RoomTemplate, boolean> = {
    plain: true,
    hall: iw >= 3 && ih >= 3,
    platform: iw >= 1 && ih >= 1,
    pit: iw >= 1 && ih >= 1,
    stairs: Math.max(iw, ih) >= 3 && Math.min(iw, ih) >= 1,
    arena: iw >= 4 && ih >= 4,
    catwalk: Math.max(iw, ih) >= 5 && Math.min(iw, ih) >= 2,
  };
  let template: RoomTemplate = 'plain';
  if (kind === 'boss' || kind === 'miniboss') template = fits.arena ? 'arena' : fits.hall ? 'hall' : 'plain';
  else if (kind === 'room') {
    const options = ROOM_WEIGHTS.filter(([t]) => fits[t]);
    let r = rng.range(0, options.reduce((s, [, wt]) => s + wt, 0));
    template = options.find(([, wt]) => (r -= wt) < 0)?.[0] ?? 'plain';
  }

  const cells = new Int8Array(w * h);
  const regions: RoomRegion[] = [BASE];
  const set = (ix: number, iy: number, region: number) => (cells[ix + 1 + (iy + 1) * w] = region);
  const fill = (x0: number, y0: number, x1: number, y1: number, region: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, region);
  };
  let maxRise = 0;

  switch (template) {
    case 'hall':
      // Pillars on odd interior cells: never adjacent, even diagonally.
      for (let y = 1; y < ih - 1; y += 2) for (let x = 1; x < iw - 1; x += 2) set(x, y, SOLID);
      break;
    case 'arena':
      // Cover pillars inset one cell from the interior corners.
      for (const [x, y] of [[1, 1], [iw - 2, 1], [1, ih - 2], [iw - 2, ih - 2]] as const) set(x, y, SOLID);
      break;
    case 'platform':
    case 'pit': {
      const pw = rng.int(1, iw);
      const ph = rng.int(1, ih);
      const x0 = rng.int(0, iw - pw);
      const y0 = rng.int(0, ih - ph);
      const plinth = template === 'platform' && pw * ph <= 2 && rng.chance(0.3);
      const rise = template === 'pit' ? -24 : plinth ? 48 : rng.pick([STEP, 24]);
      // Half the pits are hazards (slime or lava in the theme's colour), glowing a little. They
      // stay climbable and the ring around them is safe, so the route never needs to cross one.
      const hazard = template === 'pit' && rng.chance(HAZARD_PIT_CHANCE);
      regions.push(
        template === 'pit'
          ? { rise, floorTex: T.Slime, wallTex: T.Trim, lightDelta: hazard ? 24 : -16, ...(hazard ? { special: SPECIAL_DAMAGE } : {}) }
          : { rise, floorTex: T.Tech, wallTex: T.Trim, lightDelta: 32 },
      );
      if (!plinth) maxRise = Math.max(maxRise, rise);
      fill(x0, y0, x0 + pw, y0 + ph, 1);
      break;
    }
    case 'stairs': {
      // Steps across the interior along its long axis, rising to a dais at one end.
      const alongX = iw >= ih;
      const len = alongX ? iw : ih;
      const steps = rng.int(1, Math.min(3, len - 1));
      const upward = rng.chance(0.5);
      for (let i = 0; i <= steps; i++) regions.push({ rise: STEP * (i + 1), floorTex: T.Tech, wallTex: T.Trim, lightDelta: 8 * (i + 1) });
      maxRise = STEP * (steps + 1);
      for (let t = 0; t < len; t++) {
        const region = 1 + Math.min(t, steps); // columns 0..steps-1 are steps, the rest is the dais
        const pos = upward ? t : len - 1 - t;
        if (alongX) fill(pos, 0, pos + 1, ih, region);
        else fill(0, pos, iw, pos + 1, region);
      }
      break;
    }
    case 'catwalk': {
      // A double-height room: the interior sinks to a pit reached by three steps down from one
      // end, and a grating catwalk crosses it at floor level from ring to ring. Cross on top, or go
      // down and walk underneath (80 units of headroom). Sometimes the pit is a lava hazard.
      const alongX = iw >= ih;
      const len = alongX ? iw : ih;
      const hazard = rng.chance(CATWALK_HAZARD_CHANCE);
      const bottomOfPit = -96;
      const pitRegion = hazard ? { floorTex: T.Slime, special: SPECIAL_DAMAGE, lightDelta: 16 } : { floorTex: T.FloorTile, lightDelta: -24 };
      for (let i = 1; i <= 3; i++) regions.push({ rise: -24 * i, floorTex: T.Tech, wallTex: T.Trim, lightDelta: -8 * i });
      regions.push({ rise: bottomOfPit, wallTex: T.Stone, ...pitRegion }); // region 4: the pit
      regions.push({ rise: bottomOfPit, wallTex: T.Stone, ...pitRegion, slab: { bottom: -16, top: 0 } }); // region 5: under the catwalk
      const down = rng.chance(0.5); // which end the steps are at
      const bridge = rng.int(4, len - 1); // the catwalk's column, past the steps and one pit column
      for (let t = 0; t < len; t++) {
        const region = t < 3 ? 1 + t : t === bridge ? 5 : 4;
        const pos = down ? t : len - 1 - t;
        if (alongX) fill(pos, 0, pos + 1, ih, region);
        else fill(0, pos, iw, pos + 1, region);
      }
      break;
    }
    case 'plain':
      break;
  }
  return { template, regions, cells, maxRise };
}
