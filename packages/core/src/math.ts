/**
 * Render-side math (column-major mat4, WebGL/WebGPU compatible layout).
 * Not for sim code — see dmath.ts.
 */

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

/** Clip-space depth convention of the active backend. */
export type ClipDepth = 'neg-one-to-one' | 'zero-to-one';

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number, depth: ClipDepth): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[11] = -1;
  if (depth === 'neg-one-to-one') {
    m[10] = (far + near) / (near - far);
    m[14] = (2 * far * near) / (near - far);
  } else {
    m[10] = far / (near - far);
    m[14] = (far * near) / (near - far);
  }
  return m;
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  let zx = eye[0] - target[0],
    zy = eye[1] - target[1],
    zz = eye[2] - target[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;
  let xx = up[1] * zz - up[2] * zy,
    xy = up[2] * zx - up[0] * zz,
    xz = up[0] * zy - up[1] * zx;
  len = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Map-space position + yaw/pitch → world-space view matrix. */
export function viewFromMapCamera(x: number, y: number, eyeZ: number, yaw: number, pitch: number): Mat4 {
  const eye: Vec3 = [x, eyeZ, -y];
  const cp = Math.cos(pitch);
  const fwd: Vec3 = [cp * Math.cos(yaw), Math.sin(pitch), -cp * Math.sin(yaw)];
  return mat4LookAt(eye, [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]], [0, 1, 0]);
}
