import { MAX_MOVERS, TEX_SCALE } from './mesh.js';
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
in float aMover;
in float aMove;
in float aSlide;
uniform mat4 uViewProj;
// Per mover: how far its geometry sits below where the mesh put it (doors, taken pickups).
uniform float uMover[${MAX_MOVERS}];
out vec2 vUV;
out float vLight;
flat out int vTex;
out vec3 vWorld;
void main() {
  vec3 pos = aPos;
  vec2 uv = aUV;
  if (aMover > 0.5) {
    float off = uMover[int(aMover - 0.5)];
    pos.y -= off * aMove;
    uv.y += off * aSlide * ${TEX_SCALE};
  }
  vUV = uv;
  vLight = aLight;
  vTex = int(aTex + 0.5);
  vWorld = pos;
  gl_Position = uViewProj * vec4(pos, 1.0);
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
// Key colours by key id: blue, red, yellow, green. Matches KEY_COLORS in app.
vec3 keyColor(int k) {
  return k == 0 ? vec3(0.25, 0.45, 1.0) : k == 1 ? vec3(1.0, 0.22, 0.15) : k == 2 ? vec3(1.0, 0.85, 0.2) : vec3(0.25, 0.9, 0.3);
}

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
  if (id == 8 || (id >= 10 && id <= 13)) { // doors: heavy panel; key doors trimmed in their key's colour
    vec2 f = fract(uv * vec2(1.0, 0.5));
    float frame = 1.0 - edge(f, 0.08);
    float seam = step(abs(f.x - 0.5), 0.015);
    float bolts = step(length(fract(uv * vec2(2.0, 1.0)) - 0.5), 0.08);
    vec3 plate = vec3(0.3, 0.29, 0.27) * (0.75 + 0.3 * fbm(uv * vec2(6.0, 12.0)));
    vec3 trim = id >= 10 ? keyColor(id - 10) : vec3(0.45, 0.42, 0.38);
    vec3 c = mix(plate, trim, frame);
    c = mix(c, vec3(0.06), seam);
    if (id >= 10) c = mix(c, trim, step(abs(f.y - 0.5), 0.05));
    return c + bolts * 0.12;
  }
  if (id >= 14 && id <= 17) { // key pickups: bright, slowly pulsing
    return keyColor(id - 14) * (1.1 + 0.25 * sin(uTime * 4.0) - 0.4 * uv.y);
  }
  if (id == 18) { // health pickup: white with a red cross
    vec2 c = abs(uv - 0.5);
    float cross = step(min(c.x, c.y), 0.12) * step(max(c.x, c.y), 0.34);
    return mix(vec3(0.95), vec3(0.9, 0.08, 0.06), cross) * (1.05 + 0.15 * sin(uTime * 3.0));
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

/** Doom-style diminishing light, as in LEVEL_FS: sector light fades with distance, in 16 bands. */
const LIGHTING = /* glsl */ `
float lightBand(float light, vec3 world, vec3 eye) {
  float fall = clamp(1.0 - distance(world, eye) / 1600.0, 0.0, 1.0);
  float b = light * (0.3 + 0.9 * fall);
  return 0.08 + 1.1 * floor(clamp(b, 0.0, 1.0) * 16.0) / 16.0;
}`;

export const SPRITE_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec2 aUV;
in float aShape;
in float aCharge;
in float aFlash;
in float aLight;
uniform mat4 uViewProj;
out vec2 vUV;
flat out int vShape;
out float vCharge;
out float vFlash;
out float vLight;
out vec3 vWorld;
void main() {
  vUV = aUV;
  vShape = int(aShape + 0.5);
  vCharge = aCharge;
  vFlash = aFlash;
  vLight = aLight;
  vWorld = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

/** Procedural silhouettes (signed distance, < 0 inside) until M4 bakes real sprites. */
export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
flat in int vShape;
in float vCharge;
in float vFlash;
in float vLight;
in vec3 vWorld;
uniform vec3 uEye;
uniform float uTime;
out vec4 outColor;
${LIGHTING}
float circle(vec2 p, vec2 c, float r) { return length(p - c) - r; }
float box(vec2 p, vec2 c, vec2 h, float r) {
  vec2 d = abs(p - c) - h + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
void main() {
  vec2 p = vUV;
  if (vShape == 8) { // projectile: a hot, self-lit orb
    float r = length(p - 0.5) * 2.0;
    if (r > 1.0) discard;
    outColor = vec4(mix(vec3(1.0, 0.95, 0.6), vec3(1.0, 0.35, 0.05), r), 1.0);
    return;
  }
  float d;
  float eyes = 1.0;
  vec3 col;
  if (vShape == 9) { // corpse
    d = box(p, vec2(0.5, 0.3), vec2(0.46, 0.26), 0.2);
    col = vec3(0.34, 0.07, 0.05);
  } else if (vShape == 1 || vShape == 3) { // brute / mini boss: wide and hunched
    d = min(box(p, vec2(0.5, 0.42), vec2(0.36, 0.3), 0.14), circle(p, vec2(0.5, 0.74), 0.13));
    d = min(d, min(box(p, vec2(0.2, 0.36), vec2(0.09, 0.24), 0.06), box(p, vec2(0.8, 0.36), vec2(0.09, 0.24), 0.06)));
    d = min(d, min(box(p, vec2(0.38, 0.08), vec2(0.1, 0.08), 0.03), box(p, vec2(0.62, 0.08), vec2(0.1, 0.08), 0.03)));
    if (vShape == 3) d = min(d, min(circle(p, vec2(0.18, 0.7), 0.07), circle(p, vec2(0.82, 0.7), 0.07)));
    col = vShape == 3 ? vec3(0.56, 0.3, 0.08) : vec3(0.5, 0.12, 0.1);
    eyes = min(circle(p, vec2(0.45, 0.76), 0.028), circle(p, vec2(0.55, 0.76), 0.028));
  } else if (vShape == 2) { // sniper: thin, one big eye
    d = min(box(p, vec2(0.5, 0.38), vec2(0.13, 0.3), 0.06), circle(p, vec2(0.5, 0.8), 0.11));
    d = min(d, box(p, vec2(0.5, 0.08), vec2(0.1, 0.08), 0.02));
    col = vec3(0.24, 0.3, 0.44);
    eyes = circle(p, vec2(0.5, 0.81), 0.05);
  } else if (vShape == 4) { // boss: huge, horned, three eyes
    d = min(circle(p, vec2(0.5, 0.44), 0.4), min(box(p, vec2(0.26, 0.88), vec2(0.05, 0.12), 0.03), box(p, vec2(0.74, 0.88), vec2(0.05, 0.12), 0.03)));
    col = vec3(0.36, 0.18, 0.42);
    eyes = min(min(circle(p, vec2(0.38, 0.56), 0.04), circle(p, vec2(0.62, 0.56), 0.04)), circle(p, vec2(0.5, 0.66), 0.05));
  } else { // grunt: humanoid
    d = min(box(p, vec2(0.5, 0.4), vec2(0.22, 0.26), 0.08), circle(p, vec2(0.5, 0.78), 0.14));
    d = min(d, min(box(p, vec2(0.41, 0.09), vec2(0.07, 0.09), 0.02), box(p, vec2(0.59, 0.09), vec2(0.07, 0.09), 0.02)));
    col = vec3(0.42, 0.36, 0.2);
    eyes = min(circle(p, vec2(0.44, 0.8), 0.028), circle(p, vec2(0.56, 0.8), 0.028));
  }
  if (d > 0.0) discard;
  col *= (0.7 + 0.4 * p.y) * (1.0 - 0.45 * smoothstep(-0.035, 0.0, d)); // top light, dark rim
  vec3 lit = col * lightBand(vLight, vWorld, uEye);
  // Eyes glow whatever the light, brighter through the wind-up: the telegraph.
  if (eyes < 0.0) lit = mix(vec3(0.9, 0.15, 0.05), vec3(1.0, 0.95, 0.5), vCharge) * (0.8 + vCharge);
  outColor = vec4(mix(lit, vec3(1.0), vFlash * 0.85), 1.0);
}`;
