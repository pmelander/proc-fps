import { EnemyType, Rng } from '@proc-fps/core';

/**
 * Names for a level's mini boss and boss, bred from its seed (render-only, like their looks):
 * a harsh two-syllable name and an epithet, so the fight has someone to hate.
 */
const FIRST = ['Vor', 'Gor', 'Skar', 'Mal', 'Kra', 'Ur', 'Thal', 'Zeg', 'Mor', 'Bael', 'Xul', 'Grim', 'Drav', 'Oth', 'Nag'];
const SECOND = ['gath', 'rax', 'nok', 'zul', 'thar', 'mog', 'vex', 'dred', 'goth', 'rath', 'ul', 'esh', 'krell'];
const BOSS_EPITHETS = ['the Unburied', 'the Flayed', 'the Hungering', 'of the Maw', 'the Rotting King', 'the Many-Eyed', 'Bone-Crowned', 'the Endless', 'the Swollen', 'the Unmade'];
const MINIBOSS_EPITHETS = ['the Gatekeeper', 'the Warden', 'the Jailer', 'the Butcher', 'Keeper of the Key', 'the Hound', 'the Tithe-Taker'];

export function bossName(seed: string, type: EnemyType): string {
  const r = new Rng(seed).fork('bestiary').fork(type === EnemyType.Boss ? 'boss-name' : 'miniboss-name');
  const name = r.pick(FIRST) + r.pick(SECOND);
  return `${name} ${r.pick(type === EnemyType.Boss ? BOSS_EPITHETS : MINIBOSS_EPITHETS)}`;
}
