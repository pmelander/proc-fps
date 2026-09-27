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
  RELOAD_TICKS,
  MELEE_DAMAGE,
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
export { distanceField } from './ai.js';
export * from './lifts.js';
