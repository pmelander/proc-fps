/** Gameplay dimensions shared by sim (movement) and gen (validation). Doom-like units. */
export const PLAYER_RADIUS = 16;
export const PLAYER_HEIGHT = 72;
/**
 * Camera and hitscan origin. Doom's 41/56 read taller than it was because of its 1.2 vertical pixel
 * stretch; with square pixels the player needs more height. Keep it below PLAYER_HEIGHT minus the
 * near plane and bob, so the camera never pokes through the lowest ceiling validation allows.
 */
export const PLAYER_EYE_HEIGHT = 64;
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
