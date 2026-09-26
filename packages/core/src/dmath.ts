/**
 * Deterministic math for simulation code.
 *
 * +, -, *, /, Math.sqrt, Math.floor, Math.round, Math.abs are IEEE-754 exact
 * and identical across JS engines. Math.sin/cos/atan2/hypot/pow are NOT
 * specified to the ULP and do differ between V8, SpiderMonkey and JSC — which
 * silently breaks replays recorded in one browser and played in another.
 *
 * Sim code uses these instead. Render code may use Math.* freely.
 */

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/** Taylor series to x^15 on [-π/2, π/2], Horner form. Max error ≈ 7e-10. */
function sinPoly(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

export function dsin(angle: number): number {
  // Reduce to [-π, π]
  let x = angle - Math.round(angle / TWO_PI) * TWO_PI;
  // Fold to [-π/2, π/2] using sin(π - x) = sin(x)
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  return sinPoly(x);
}

export function dcos(angle: number): number {
  return dsin(angle + HALF_PI);
}

/** Wrap an angle to [-π, π). */
export function wrapAngle(angle: number): number {
  return angle - Math.floor((angle + PI) / TWO_PI) * TWO_PI;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const DEG_TO_RAD = PI / 180;
