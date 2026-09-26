import { PALETTE_SIZE } from './palette.js';

/**
 * GLSL ES 3.00 sources. Texture ids map to placeholder procedural patterns
 * until M4 bakes real theme textures into an atlas.
 */

export const LEVEL_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec2 aUV;
in float aLight;
in float aTex;
uniform mat4 uViewProj;
out vec2 vUV;
out float vLight;
flat out int vTex;
out vec3 vWorld;
void main() {
  vUV = aUV;
  vLight = aLight;
  vTex = int(aTex + 0.5);
  vWorld = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const LEVEL_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in float vLight;
flat in int vTex;
in vec3 vWorld;
uniform vec3 uEye;
uniform float uTime;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return 0.5 * noise(p) + 0.25 * noise(p * 2.1) + 0.125 * noise(p * 4.3); }
float edge(vec2 f, float w) { vec2 e = min(f, 1.0 - f); return step(w, min(e.x, e.y)); }

vec3 pattern(int id, vec2 uv) {
  if (id == 1) { // stone blocks
    vec2 b = uv * vec2(2.0, 4.0);
    b.x += mod(floor(b.y), 2.0) * 0.5;
    float m = edge(fract(b), 0.05);
    float n = fbm(uv * 8.0);
    return mix(vec3(0.12), vec3(0.42, 0.38, 0.33) * (0.7 + 0.5 * n) * (0.85 + 0.3 * hash(floor(b))), m);
  }
  if (id == 2) { // metal panels with rivets
    vec2 b = uv * vec2(1.0, 2.0);
    vec2 f = fract(b);
    float m = edge(f, 0.03);
    float rivet = step(length(min(f, 1.0 - f) * vec2(1.0, 0.5) - 0.06), 0.025);
    vec3 base = vec3(0.34, 0.38, 0.44) * (0.75 + 0.35 * fbm(uv * vec2(4.0, 20.0)));
    return mix(vec3(0.08), base, m) + rivet * 0.25;
  }
  if (id == 3) { // tech panel with lit strip
    vec2 f = fract(uv * vec2(2.0, 2.0));
    float m = edge(f, 0.06);
    float strip = step(abs(f.y - 0.5), 0.04) * step(0.2, f.x) * step(f.x, 0.8);
    vec3 c = mix(vec3(0.05), vec3(0.16, 0.18, 0.2) * (0.8 + 0.4 * noise(uv * 30.0)), m);
    return c + strip * vec3(0.2, 0.7, 1.0) * (0.8 + 0.2 * sin(uTime * 3.0 + hash(floor(uv * 2.0)) * 6.28));
  }
  if (id == 4) { // floor tiles: one tile per 128-unit cell so the movement grid reads
    vec2 f = fract(uv * 0.5);
    float m = edge(f, 0.02);
    float tone = 0.8 + 0.3 * hash(floor(uv * 0.5));
    return mix(vec3(0.1), vec3(0.36, 0.3, 0.24) * tone * (0.8 + 0.3 * fbm(uv * 10.0)), m);
  }
  if (id == 5) { // ceiling, cell-aligned
    float m = edge(fract(uv * 0.5), 0.01);
    return mix(vec3(0.12), vec3(0.26) * (0.85 + 0.25 * fbm(uv * 6.0)), m);
  }
  if (id == 6) { // hazard trim
    float s = step(0.5, fract((uv.x + uv.y) * 4.0));
    return mix(vec3(0.08), vec3(0.85, 0.62, 0.1), s) * (0.8 + 0.3 * noise(uv * 25.0));
  }
  if (id == 7) { // slime
    float n = fbm(uv * 3.0 + vec2(uTime * 0.15, uTime * 0.07));
    return vec3(0.1, 0.55, 0.12) * (0.4 + 1.0 * n);
  }
  // Missing texture: loud checker, never silently wrong.
  float c = mod(floor(uv.x * 4.0) + floor(uv.y * 4.0), 2.0);
  return mix(vec3(1.0, 0.0, 1.0), vec3(0.0), c);
}

void main() {
  vec3 base = pattern(vTex, vUV);
  // Doom-style diminishing light: sector light fades with distance, in bands.
  float dist = distance(vWorld, uEye);
  float fall = clamp(1.0 - dist / 1600.0, 0.0, 1.0);
  float b = vLight * (0.3 + 0.9 * fall);
  b = floor(clamp(b, 0.0, 1.0) * 16.0) / 16.0;
  outColor = vec4(base * (0.08 + 1.1 * b), 1.0);
}`;

export const POST_VS = /* glsl */ `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const POST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uPalette;
uniform vec2 uSceneSize;
uniform float uDither;
out vec4 outColor;

const int N = ${PALETTE_SIZE};

float bayer4(ivec2 p) {
  int i = (p.x & 3) + ((p.y & 3) << 2);
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return float(m[i]) / 16.0 - 0.5;
}

void main() {
  vec3 c = texture(uScene, vUV).rgb;
  ivec2 px = ivec2(vUV * uSceneSize);
  c += bayer4(px) * uDither;
  vec3 best = vec3(0.0);
  float bestD = 1e9;
  for (int i = 0; i < N; i++) {
    vec3 p = texelFetch(uPalette, ivec2(i, 0), 0).rgb;
    vec3 d = (c - p) * vec3(0.55, 0.77, 0.33); // ≈ sqrt of luma weights
    float dd = dot(d, d);
    if (dd < bestD) { bestD = dd; best = p; }
  }
  outColor = vec4(best, 1.0);
}`;
