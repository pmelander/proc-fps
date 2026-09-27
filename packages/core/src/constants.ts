/** Gameplay dimensions shared by sim (movement) and gen (validation). Doom-like units. */
export const PLAYER_RADIUS = 16;
export const PLAYER_HEIGHT = 72;
/**
 * Camera and hitscan origin. Doom's 41/56 read taller than it was because of its 1.2 vertical pixel
 * stretch; with square pixels the player needs more height. Keep it below PLAYER_HEIGHT minus the
 * near plane and bob, so the camera never pokes through the lowest ceiling validation allows.
 */
export const PLAYER_EYE_HEIGHT = 64;
/** Player combat and resources: the sim applies them, the generator balances against them. Ammo is infinite. */
export const PLAYER_MAX_HEALTH = 100;
/** What a health pickup restores (never above the maximum). */
export const HEALTH_PICKUP = 25;
/** Lifts: wait this long with the player aboard, then travel at LIFT_SPEED units per tick. */
export const LIFT_WAIT = 20;
export const LIFT_SPEED = 3;
/** Standing on a damaging floor costs HAZARD_DAMAGE every HAZARD_TICKS. */
export const HAZARD_DAMAGE = 5;
export const HAZARD_TICKS = 30;
/**
 * Player weapon: a shotgun. PELLETS hitscan pellets in a fixed spread around the view direction
 * (fixed, so replays hold), PLAYER_DAMAGE each: devastating up close, a pump between shots.
 * With an enemy right in front, firing is an automatic melee strike instead.
 */
export const FIRE_COOLDOWN = 36;
/**
 * Ammo is infinite, but the scattergun's cell holds MAG_SIZE shots; the last one starts a reload
 * (R reloads early). RELOAD_TICKS is a little over two shots' cooldown: running dry costs you.
 */
export const MAG_SIZE = 8;
export const RELOAD_TICKS = 78;
export const PELLETS = 8;
export const PLAYER_DAMAGE = 12;
export const WEAPON_RANGE = 4096;
/** Pellet offsets from the aim, radians: [yaw, pitch]. */
export const PELLET_SPREAD: readonly (readonly [number, number])[] = [
  [0, 0], [-0.035, 0.012], [0.035, -0.012], [-0.07, 0], [0.07, 0.01], [-0.02, -0.03], [0.022, 0.03], [0, -0.018],
];
export const MELEE_DAMAGE = 60;
export const MELEE_COOLDOWN = 24;
/** Melee reaches an enemy within this distance (map units) and 45° of the aim. */
export const MELEE_REACH = 170;

/** Max floor rise between adjacent cells the player can step up. Drops are unlimited. */
export const MAX_STEP = 24;

/** Fixed simulation rate. Never tie sim behaviour to render frame time. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/**
 * Grid movement. All level geometry is axis-aligned and snapped to CELL_SIZE;
 * the player moves one cell per step. Speed = CELL_SIZE / (STEP_TICKS · TICK_DT)
 * ≈ 550 units/s at 128 / 14 — roughly Doom walking speed.
 * These three are tuned together with enemy step timers and projectile speeds.
 */
export const CELL_SIZE = 128;
export const STEP_TICKS = 14;
/** Extra yaw beyond 45° before the movement heading switches cardinal (radians, ≈ 8°). */
export const HEADING_HYSTERESIS = 0.14;
