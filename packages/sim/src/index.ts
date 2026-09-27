export * from './input.js';
export * from './world.js';
export * from './state.js';
export * from './sim.js';
export * from './replay.js';
// Combat tuning lives in core (shared with the generator); re-exported for sim users.
export {
  ENEMY_DEFS,
  FIRE_COOLDOWN,
  MAG_SIZE,
  WEAPONS,
  GRENADE,
  WEAPON_SWITCH_TICKS,
  WeaponId,
  falloffAt,
  RELOAD_TICKS,
  MELEE_DAMAGE,
  MELEE_FIRST_HIT,
  MELEE_HITS,
  MELEE_HIT_INTERVAL,
  MELEE_IFRAMES,
  MELEE_TICKS,
  MELEE_REACH,
  PELLETS,
  HEALTH_PICKUP,
  PLAYER_DAMAGE,
  PLAYER_MAX_HEALTH,
  WEAPON_RANGE,
  type EnemyDef,
} from '@proc-fps/core';
export * from './combat.js';
export * from './raycast.js';
export { distanceField, flankSide } from './ai.js';
export { MAX_ADDS, SLAM_RADIUS, SLAM_WINDUP, isBoss, type BossPattern } from './boss.js';
export * from './lifts.js';
export { HOMING, LOB, SPIRAL, SPLIT, WALL, type Emitter, type ShotKind } from './shots.js';
