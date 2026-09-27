/**
 * Pickups beyond health and grenades (M25), in sim units (ticks at 60/s). The generator places
 * them (gen/src/population.ts); the sim applies them (sim.ts, combat.ts).
 * - Armour soaks up a share of every hurt until it is used up; a vest adds `pickup`, to `max`.
 * - Berserk: for `ticks`, the chainsword hits `melee` times as hard and every hit that lands heals
 *   `leech`; picking it up also heals `heal`.
 * - Overcharge: for `ticks`, the guns hit `damage` times as hard and fire `rate` times as fast.
 */
export const ARMOR = { pickup: 50, max: 100, absorb: 0.5 } as const;
export const BERSERK = { ticks: 1200, melee: 3, leech: 3, heal: 50 } as const;
export const OVERCHARGE = { ticks: 900, damage: 2, rate: 1.5 } as const;
