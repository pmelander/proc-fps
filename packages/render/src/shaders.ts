import { MAX_MOVERS, TEX_SCALE } from './mesh.js';
import { PALETTE_SIZE } from './palette.js';

/**
 * GLSL ES 3.00 sources. Level textures are baked per level into an atlas (ATLAS_FS) from the
 * level's theme; sprites are drawn procedurally (SPRITE_FS).
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

/** Atlas layout: texture id → tile (id % ATLAS_COLS, id / ATLAS_COLS), each ATLAS_TILE texels square. */
export const ATLAS_TILE = 64;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 3;

/**
 * Level surfaces sample the texture atlas baked for the level (ATLAS_FS). A tile covers two
 * units of texture space (one 128-unit cell), sampled texel-exact, so the pixels stay chunky.
 * The atlas alpha marks glowing texels, which pulse here; slime flows by scrolling.
 */
export const LEVEL_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in float vLight;
flat in int vTex;
in vec3 vWorld;
uniform vec3 uEye;
uniform float uTime;
uniform sampler2D uAtlas;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUV;
  if (vTex == 7) uv += vec2(uTime * 0.15, uTime * 0.07); // slime flows
  vec2 local = fract(uv * 0.5);
  ivec2 tile = ivec2(vTex % ${ATLAS_COLS}, vTex / ${ATLAS_COLS});
  vec4 t = texelFetch(uAtlas, tile * ${ATLAS_TILE} + ivec2(local * ${ATLAS_TILE}.0), 0);
  vec3 base = t.rgb;
  if (vTex == 4) base *= 0.85 + 0.3 * hash(floor(vUV * 0.5)); // each floor cell its own tone, so the grid reads
  base *= 1.0 + t.a * (0.25 * sin(uTime * 3.5 + hash(floor(vUV * 0.5)) * 6.28)); // glowing texels pulse
  // Doom-style diminishing light: sector light fades with distance, in bands.
  float dist = distance(vWorld, uEye);
  float fall = clamp(1.0 - dist / 1600.0, 0.0, 1.0);
  float b = vLight * (0.3 + 0.9 * fall);
  b = floor(clamp(b, 0.0, 1.0) * 16.0) / 16.0;
  outColor = vec4(base * (0.08 + 1.1 * b), 1.0);
}`;

/**
 * Bakes every texture id into the atlas in one full-screen pass, once per level. Colours come
 * from the level's theme (themes.ts) and the noise is tileable (its lattice wraps at the tile's
 * period), so tiles repeat without seams. Alpha = glow.
 */
export const ATLAS_FS = /* glsl */ `#version 300 es
precision highp float;
uniform float uSeed;
uniform vec3 uStone, uMortar, uMetal, uTechBase, uTechLight, uFloor, uCeiling, uHazard, uSlime, uDoorPlate, uDoorTrim;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p + uSeed, vec2(127.1, 311.7))) * 43758.5453); }
// Value noise whose lattice wraps every \`period\` cells: tileable.
float noise(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = mod(i, period), b = mod(i + 1.0, period);
  return mix(mix(hash(a), hash(vec2(b.x, a.y)), u.x), mix(hash(vec2(a.x, b.y)), hash(b), u.x), u.y);
}
// Tileable fbm over a tile's texture space [0, 2): \`freq\` lattice cells per unit.
float fbm(vec2 uv, float freq) {
  return 0.5 * noise(uv * freq, 2.0 * freq) + 0.25 * noise(uv * freq * 2.0, 4.0 * freq) + 0.125 * noise(uv * freq * 4.0, 8.0 * freq);
}
float edge(vec2 f, float w) { vec2 e = min(f, 1.0 - f); return step(w, min(e.x, e.y)); }
// Key colours by key id: blue, red, yellow, green. Matches KEY_COLORS in app.
vec3 keyColor(int k) {
  return k == 0 ? vec3(0.25, 0.45, 1.0) : k == 1 ? vec3(1.0, 0.22, 0.15) : k == 2 ? vec3(1.0, 0.85, 0.2) : vec3(0.25, 0.9, 0.3);
}

vec4 pattern(int id, vec2 uv) {
  if (id == 1) { // stone blocks
    vec2 b = uv * vec2(2.0, 4.0);
    b.x += mod(floor(b.y), 2.0) * 0.5;
    float m = edge(fract(b), 0.05);
    float n = fbm(uv, 4.0);
    return vec4(mix(uMortar, uStone * (0.7 + 0.5 * n) * (0.85 + 0.3 * hash(mod(floor(b), vec2(4.0, 8.0)))), m), 0.0);
  }
  if (id == 2) { // metal panels with rivets
    vec2 f = fract(uv * vec2(1.0, 2.0));
    float m = edge(f, 0.03);
    float rivet = step(length(min(f, 1.0 - f) * vec2(1.0, 0.5) - 0.06), 0.025);
    vec3 base = uMetal * (0.75 + 0.35 * fbm(uv * vec2(1.0, 5.0), 4.0));
    return vec4(mix(uMortar * 0.7, base, m) + rivet * 0.25, 0.0);
  }
  if (id == 3) { // tech panel with a lit strip (glows)
    vec2 f = fract(uv * 2.0);
    float m = edge(f, 0.06);
    float strip = step(abs(f.y - 0.5), 0.04) * step(0.2, f.x) * step(f.x, 0.8);
    vec3 c = mix(uMortar * 0.4, uTechBase * (0.8 + 0.4 * noise(uv * 15.0, 30.0)), m);
    return vec4(mix(c, uTechLight, strip), strip);
  }
  if (id == 4) { // floor tiles: one tile per cell, so the movement grid reads
    float m = edge(fract(uv * 0.5), 0.02);
    return vec4(mix(uMortar * 0.8, uFloor * (0.8 + 0.3 * fbm(uv, 5.0)), m), 0.0);
  }
  if (id == 5) { // ceiling, cell-aligned
    float m = edge(fract(uv * 0.5), 0.01);
    return vec4(mix(uMortar, uCeiling * (0.85 + 0.25 * fbm(uv, 3.0)), m), 0.0);
  }
  if (id == 6) { // hazard trim
    float s = step(0.5, fract((uv.x + uv.y) * 4.0));
    return vec4(mix(vec3(0.08), uHazard, s) * (0.8 + 0.3 * noise(uv * 12.5, 25.0)), 0.0);
  }
  if (id == 7) { // slime or lava (flows in LEVEL_FS)
    return vec4(uSlime * (0.4 + fbm(uv, 1.5)), 0.3);
  }
  if (id == 8 || (id >= 10 && id <= 13)) { // doors: heavy panel; key doors trimmed in their key's colour
    vec2 f = fract(uv * vec2(1.0, 0.5));
    float frame = 1.0 - edge(f, 0.08);
    float seam = step(abs(f.x - 0.5), 0.015);
    float bolts = step(length(fract(uv * vec2(2.0, 1.0)) - 0.5), 0.08);
    vec3 plate = uDoorPlate * (0.75 + 0.3 * fbm(uv * vec2(1.0, 2.0), 3.0));
    vec3 trim = id >= 10 ? keyColor(id - 10) : uDoorTrim;
    vec3 c = mix(plate, trim, frame);
    c = mix(c, vec3(0.06), seam);
    if (id >= 10) c = mix(c, trim, step(abs(f.y - 0.5), 0.05));
    return vec4(c + bolts * 0.12, 0.0);
  }
  if (id >= 14 && id <= 17) { // key pickups: bright, pulsing
    return vec4(keyColor(id - 14) * (1.1 - 0.4 * fract(uv.y)), 1.0);
  }
  if (id == 18) { // health pickup: white with a red cross
    vec2 c = abs(fract(uv) - 0.5);
    float cross = step(min(c.x, c.y), 0.12) * step(max(c.x, c.y), 0.34);
    return vec4(mix(vec3(0.95), vec3(0.9, 0.08, 0.06), cross), 0.6);
  }
  // Missing texture: loud checker, never silently wrong.
  float c = mod(floor(uv.x * 4.0) + floor(uv.y * 4.0), 2.0);
  return vec4(mix(vec3(1.0, 0.0, 1.0), vec3(0.0), c), 0.0);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int id = px.x / ${ATLAS_TILE} + (px.y / ${ATLAS_TILE}) * ${ATLAS_COLS};
  vec2 uv = (vec2(px % ${ATLAS_TILE}) + 0.5) / ${ATLAS_TILE}.0 * 2.0;
  outColor = pattern(id, uv);
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
in float aTile;
uniform mat4 uViewProj;
out vec2 vUV;
flat out int vShape;
flat out int vTile;
out float vCharge;
out float vFlash;
out float vLight;
out vec3 vWorld;
void main() {
  vUV = aUV;
  vShape = int(aShape + 0.5);
  vTile = int(floor(aTile + 0.5));
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
flat in int vTile;
in float vCharge;
in float vFlash;
in float vLight;
in vec3 vWorld;
uniform vec3 uEye;
uniform float uTime;
uniform sampler2D uSpriteAtlas;
out vec4 outColor;
${LIGHTING}
float circle(vec2 p, vec2 c, float r) { return length(p - c) - r; }
float box(vec2 p, vec2 c, vec2 h, float r) {
  vec2 d = abs(p - c) - h + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
void main() {
  vec2 p = vUV;
  if (vTile >= 0) { // baked enemy sprite: alpha 0 empty, 0.5 body, 1 eye
    ivec2 origin = ivec2(vTile % 32, vTile / 32) * 64;
    vec4 t = texelFetch(uSpriteAtlas, origin + ivec2(clamp(p, 0.0, 0.999) * 64.0), 0);
    if (t.a < 0.25) discard;
    // Eyes glow whatever the light, brighter through the wind-up: the telegraph.
    vec3 c = t.a > 0.75 ? mix(vec3(0.9, 0.15, 0.05), vec3(1.0, 0.95, 0.5), vCharge) * (0.8 + vCharge) : t.rgb * lightBand(vLight, vWorld, uEye);
    outColor = vec4(mix(c, vec3(1.0), vFlash * 0.85), 1.0);
    return;
  }
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

/** Sprite atlas: row = enemy shape (0–4), column = direction × SPRITE_FRAMES + frame. */
export const SPRITE_TILE = 64;
export const SPRITE_DIRECTIONS = 8;
export const SPRITE_FRAMES = 4;
export const SPRITE_ROWS = 5;

/**
 * Bakes enemy sprites once: each enemy is a small 3D signed-distance model (capsules, spheres,
 * rounded boxes) ray-marched orthographically from 8 directions in 4 frames (walk A, walk B,
 * attack, dead). Model space: y up, height 1 = the sprite's height, facing +z, +x on the model's
 * left, so a camera turning counter-clockwise around it moves towards +x. Output alpha:
 * 0 = empty, 0.5 = body, 1 = eye (glows in SPRITE_FS).
 */
export const SPRITE_BAKE_FS = /* glsl */ `#version 300 es
precision highp float;
// Sprite width / height per shape, so the model fills the same quad the game draws.
uniform float uAspect[${SPRITE_ROWS}];
out vec4 outColor;

float sphere(vec3 p, vec3 c, float r) { return length(p - c) - r; }
float capsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float rbox(vec3 p, vec3 c, vec3 h, float r) {
  vec3 q = abs(p - c) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// x = distance, y = material (0 body, 1 eye, 2 accent).
vec2 model(vec3 p, int shape, int frame) {
  float swing = frame == 0 ? 0.08 : frame == 1 ? -0.08 : 0.0; // walk: legs and arms swing opposite
  bool attack = frame == 2;
  float body;
  float eyes = 1e9;
  float accent = 1e9;
  if (shape == 0) { // grunt: a soldier with a thrower arm
    body = capsule(p, vec3(0.0, 0.5, 0.0), vec3(0.0, 0.76, 0.0), 0.12);
    body = smin(body, sphere(p, vec3(0.0, 0.9, 0.01), 0.085), 0.03);
    body = min(body, capsule(p, vec3(0.07, 0.46, 0.0), vec3(0.08, 0.03, swing), 0.045));
    body = min(body, capsule(p, vec3(-0.07, 0.46, 0.0), vec3(-0.08, 0.03, -swing), 0.045));
    body = min(body, capsule(p, vec3(0.16, 0.74, 0.0), attack ? vec3(0.16, 0.9, 0.14) : vec3(0.19, 0.5, -swing), 0.04));
    body = min(body, capsule(p, vec3(-0.16, 0.74, 0.0), vec3(-0.19, 0.5, swing), 0.04));
    eyes = min(sphere(p, vec3(0.035, 0.91, 0.075), 0.016), sphere(p, vec3(-0.035, 0.91, 0.075), 0.016));
  } else if (shape == 1 || shape == 3) { // brute / mini boss: hunched, knuckles near the floor
    body = rbox(p, vec3(0.0, 0.56, -0.02), vec3(0.2, 0.19, 0.13), 0.08);
    body = smin(body, sphere(p, vec3(0.0, 0.8, 0.07), 0.085), 0.04);
    body = min(body, capsule(p, vec3(0.08, 0.38, 0.0), vec3(0.1, 0.03, swing), 0.065));
    body = min(body, capsule(p, vec3(-0.08, 0.38, 0.0), vec3(-0.1, 0.03, -swing), 0.065));
    float reach = attack ? 0.22 : 0.0;
    body = min(body, capsule(p, vec3(0.24, 0.68, 0.0), vec3(0.28, attack ? 0.62 : 0.14, reach - swing), 0.07));
    body = min(body, capsule(p, vec3(-0.24, 0.68, 0.0), vec3(-0.28, attack ? 0.62 : 0.14, reach + swing), 0.07));
    eyes = min(sphere(p, vec3(0.035, 0.81, 0.15), 0.017), sphere(p, vec3(-0.035, 0.81, 0.15), 0.017));
    if (shape == 3) accent = min(sphere(p, vec3(0.24, 0.8, -0.02), 0.07), sphere(p, vec3(-0.24, 0.8, -0.02), 0.07)); // shoulder spikes
  } else if (shape == 2) { // sniper: thin, one big eye, a long rifle
    body = capsule(p, vec3(0.0, 0.48, 0.0), vec3(0.0, 0.8, 0.0), 0.075);
    body = smin(body, sphere(p, vec3(0.0, 0.92, 0.0), 0.07), 0.02);
    body = min(body, capsule(p, vec3(0.045, 0.46, 0.0), vec3(0.05, 0.02, swing), 0.03));
    body = min(body, capsule(p, vec3(-0.045, 0.46, 0.0), vec3(-0.05, 0.02, -swing), 0.03));
    accent = capsule(p, vec3(0.06, 0.72, -0.05), vec3(0.06, attack ? 0.8 : 0.66, 0.3), 0.022); // rifle
    eyes = sphere(p, vec3(0.0, 0.93, 0.06), 0.03);
  } else { // boss: a horned mass with three eyes
    body = sphere(p, vec3(0.0, 0.46, 0.0), 0.36);
    body = min(body, capsule(p, vec3(0.16, 0.2, 0.0), vec3(0.18, 0.02, swing), 0.09));
    body = min(body, capsule(p, vec3(-0.16, 0.2, 0.0), vec3(-0.18, 0.02, -swing), 0.09));
    accent = min(capsule(p, vec3(0.18, 0.72, 0.0), vec3(0.3, 0.98, attack ? 0.1 : -0.05), 0.04), capsule(p, vec3(-0.18, 0.72, 0.0), vec3(-0.3, 0.98, attack ? 0.1 : -0.05), 0.04));
    eyes = min(min(sphere(p, vec3(0.1, 0.58, 0.31), 0.04), sphere(p, vec3(-0.1, 0.58, 0.31), 0.04)), sphere(p, vec3(0.0, 0.68, 0.3), 0.045));
  }
  float d = min(body, min(eyes, accent));
  return vec2(d, d == eyes ? 1.0 : d == accent ? 2.0 : 0.0);
}

// Dead: the body lies on its back, head towards -z, face up; standing otherwise.
vec3 toModel(vec3 p, int frame) {
  return frame == 3 ? vec3(p.x, 0.5 - p.z, p.y - 0.12) : p;
}

vec3 bodyColor(int shape) {
  return shape == 0 ? vec3(0.45, 0.38, 0.2) : shape == 1 ? vec3(0.52, 0.14, 0.11) : shape == 2 ? vec3(0.25, 0.32, 0.46) : shape == 3 ? vec3(0.58, 0.32, 0.09) : vec3(0.38, 0.2, 0.44);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 tile = px / ${SPRITE_TILE};
  int shape = tile.y;
  int dir = tile.x / ${SPRITE_FRAMES};
  int frame = tile.x % ${SPRITE_FRAMES};
  vec2 uv = (vec2(px % ${SPRITE_TILE}) + 0.5) / ${SPRITE_TILE}.0;
  float aspect = uAspect[shape];
  // Orthographic camera orbiting the model: direction 0 looks at its front.
  float th = float(dir) * 0.7853982;
  vec3 fwd = -vec3(sin(th), 0.0, cos(th));
  vec3 right = vec3(cos(th), 0.0, -sin(th));
  vec3 ro = -fwd * 1.5 + right * (uv.x - 0.5) * aspect + vec3(0.0, uv.y, 0.0);
  float t = 0.0;
  vec2 hit = vec2(1e9, 0.0);
  vec3 sp = ro;
  int f = frame == 3 ? 0 : frame;
  for (int i = 0; i < 64; i++) {
    sp = toModel(ro + fwd * t, frame);
    hit = model(sp, shape, f);
    if (hit.x < 0.002 || t > 3.0) break;
    t += hit.x;
  }
  if (hit.x >= 0.002) {
    outColor = vec4(0.0);
    return;
  }
  // Shade with the SDF gradient and a light from above and in front.
  vec2 e = vec2(0.002, 0.0);
  vec3 n = normalize(vec3(
    model(sp + e.xyy, shape, f).x - model(sp - e.xyy, shape, f).x,
    model(sp + e.yxy, shape, f).x - model(sp - e.yxy, shape, f).x,
    model(sp + e.yyx, shape, f).x - model(sp - e.yyx, shape, f).x));
  vec3 light = normalize(-fwd + vec3(0.3, 0.9, 0.0));
  float diff = 0.35 + 0.75 * max(dot(n, light), 0.0);
  if (hit.y == 1.0) {
    outColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }
  vec3 col = hit.y == 2.0 ? vec3(0.62, 0.6, 0.55) : bodyColor(shape);
  if (frame == 3) col *= vec3(0.75, 0.45, 0.4); // dead: bloodied and darker
  outColor = vec4(col * diff, 0.5);
}`;

/** Shows a texture full-screen over a checkerboard (dev views such as sprites.html). */
export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUV);
  float check = mod(floor(gl_FragCoord.x / 8.0) + floor(gl_FragCoord.y / 8.0), 2.0) * 0.08 + 0.1;
  outColor = vec4(mix(vec3(check), t.rgb, step(0.25, t.a)) + step(0.75, t.a) * vec3(0.6, 0.1, 0.0), 1.0);
}`;
