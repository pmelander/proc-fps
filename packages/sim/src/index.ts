export * from './input.js';
export * from './world.js';
export * from './state.js';
export * from './sim.js';
export * from './replay.js';
// Combat tuning lives in core (shared with the generator); re-exported for sim users.
export {
  AMMO_PICKUP,
  ENEMY_DEFS,
  FIRE_COOLDOWN,
  HEALTH_PICKUP,
  MAX_AMMO,
  PLAYER_DAMAGE,
  PLAYER_MAX_HEALTH,
  START_AMMO,
  WEAPON_RANGE,
  type EnemyDef,
} from '@proc-fps/core';
export * from './combat.js';
export * from './raycast.js';
export { distanceField } from './ai.js';
export * from './lifts.js';
