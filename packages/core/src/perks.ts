import { PLAYER_MAX_HEALTH } from './constants.js';
import { Rng } from './rng.js';

/**
 * Run upgrades (M26): after each cleared level of a run the player picks one of three perks, and
 * keeps it for the rest of the run. Perks stack up to their `max`. They change the player, so the
 * sim applies them (as `Mods`, folded from the perks held: sim/world.ts) and replays record them.
 */
export type PerkId = 'plating' | 'hide' | 'pockets' | 'hands' | 'drums' | 'slugs' | 'bloodlust' | 'overclock' | 'scavenger' | 'undying';

export interface PerkDef {
  name: string;
  /** What it does, for the pick screen. */
  blurb: string;
  /** How many times it can be taken. */
  max: number;
}

export const PERKS: Record<PerkId, PerkDef> = {
  plating: { name: 'Ablative plating', blurb: 'Start every level with 25 more armour.', max: 4 },
  hide: { name: 'Thick hide', blurb: '20 more health, at most and at the start.', max: 3 },
  pockets: { name: 'Deep pockets', blurb: 'Carry one more grenade, and start with one more.', max: 2 },
  hands: { name: 'Quick hands', blurb: 'Reload a quarter faster.', max: 2 },
  drums: { name: 'Drum magazines', blurb: 'Half as many rounds again in every magazine.', max: 1 },
  slugs: { name: 'Heavy slugs', blurb: 'Guns hit 15% harder.', max: 3 },
  bloodlust: { name: 'Bloodlust', blurb: 'Every chainsword hit that lands heals 2.', max: 2 },
  overclock: { name: 'Overclock', blurb: 'Berserk and overcharge last half as long again.', max: 2 },
  scavenger: { name: 'Scavenger', blurb: 'Health packs heal half as much again.', max: 2 },
  undying: { name: 'Undying', blurb: 'Once a level, a killing blow leaves you at 25 instead.', max: 1 },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];
export const isPerk = (x: unknown): x is PerkId => typeof x === 'string' && x in PERKS;

/** What the perks held add up to, as the sim uses it. */
export interface Mods {
  maxHealth: number;
  startArmor: number;
  grenadeMax: number;
  grenadeStart: number;
  /** Reload time, magazine size, gun damage and power-up duration multipliers. */
  reloadScale: number;
  magScale: number;
  damageScale: number;
  powerupScale: number;
  healthPickupScale: number;
  /** Health healed by each chainsword hit that lands. */
  meleeLeech: number;
  undying: boolean;
}

export const NO_MODS: Readonly<Mods> = {
  maxHealth: PLAYER_MAX_HEALTH, startArmor: 0, grenadeMax: 0, grenadeStart: 0,
  reloadScale: 1, magScale: 1, damageScale: 1, powerupScale: 1, healthPickupScale: 1, meleeLeech: 0, undying: false,
};

/** Health an undying player is left with. */
export const UNDYING_HEALTH = 25;

/** The mods for a set of perks (repeats stack, up to each perk's max). */
export function perkMods(perks: readonly PerkId[]): Mods {
  const n = (id: PerkId) => Math.min(PERKS[id].max, perks.filter((p) => p === id).length);
  return {
    maxHealth: PLAYER_MAX_HEALTH + 20 * n('hide'),
    startArmor: 25 * n('plating'),
    grenadeMax: n('pockets'),
    grenadeStart: n('pockets'),
    reloadScale: 0.75 ** n('hands'),
    magScale: 1 + 0.5 * n('drums'),
    damageScale: 1 + 0.15 * n('slugs'),
    powerupScale: 1 + 0.5 * n('overclock'),
    healthPickupScale: 1 + 0.5 * n('scavenger'),
    meleeLeech: 2 * n('bloodlust'),
    undying: n('undying') > 0,
  };
}

/**
 * The three perks offered after clearing a level of a run: deterministic in the run and the level,
 * never one already taken to its max.
 */
export function perkOffer(run: string, level: number, held: readonly PerkId[]): PerkId[] {
  const rng = new Rng(`${run}-${level}`).fork('perks');
  const open = PERK_IDS.filter((id) => held.filter((p) => p === id).length < PERKS[id].max);
  const out: PerkId[] = [];
  while (out.length < 3 && open.length) out.push(open.splice(rng.int(0, open.length - 1), 1)[0]!);
  return out;
}
