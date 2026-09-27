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
// Per mover: how far its geometry sits below where the mesh put it (doors, taken pickups),
// packed four to a vec4 to save uniform slots.
uniform vec4 uMover[${MAX_MOVERS / 4}];
out vec2 vUV;
out float vLight;
flat out int vTex;
out vec3 vWorld;
void main() {
  vec3 pos = aPos;
  vec2 uv = aUV;
  if (aMover > 0.5) {
    int m = int(aMover - 0.5);
    float off = uMover[m / 4][m % 4];
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
 * The atlas alpha marks glowing texels, which pulse here (the exit pad also lights itself);
 * slime flows by scrolling.
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
uniform float uFlash;
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
  float b = vLight * (0.3 + 0.9 * fall) + uFlash * clamp(1.0 - dist / 1100.0, 0.0, 1.0);
  if (vTex == 23) b = max(b, t.a * 0.85); // the exit pad lights itself
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
  if (id == 8 || (id >= 10 && id <= 13)) { // blast doors: one face per tile, x across, y up
    vec2 f = fract(uv * 0.5);
    bool keyed = id >= 10;
    vec3 trim = keyed ? keyColor(id - 10) : uHazard;
    float frame = 1.0 - edge(f, 0.08);
    float ribs = step(0.55, fract(f.x * 7.0)) * 0.1;
    vec3 c = mix(uDoorPlate * (0.8 + 0.25 * fbm(uv, 3.0)) - ribs, uDoorTrim * 0.8, frame);
    // A band across the middle: hazard chevrons on auto doors, the key's colour on key doors.
    float band = step(abs(f.y - 0.5), 0.09);
    float chevron = step(0.5, fract((f.x + abs(f.y - 0.5)) * 6.0));
    c = mix(c, keyed ? trim * 0.85 : mix(vec3(0.06), uHazard, chevron), band);
    // Bolts along the frame.
    vec2 bolt = fract(f * 6.0) - 0.5;
    c += step(length(bolt), 0.12) * frame * 0.18;
    // Status lights along the top: they glow (atlas alpha) and pulse.
    float light = step(abs(f.y - 0.88), 0.025) * step(abs(fract(f.x * 4.0) - 0.5), 0.2) * (1.0 - frame);
    c = mix(c, keyed ? trim : uTechLight, light);
    float glow = light;
    if (keyed) { // a key emblem in the middle of the band
      vec2 q = f - 0.5;
      float ring = abs(length(q - vec2(-0.08, 0.0)) - 0.05) - 0.018;
      float shaft = max(abs(q.y) - 0.014, abs(q.x - 0.05) - 0.09);
      float emblem = step(min(ring, shaft), 0.0);
      c = mix(c, vec3(1.0, 0.97, 0.85), emblem);
      glow = max(glow, emblem * 0.6);
    }
    return vec4(c, glow);
  }
  if (id == 23) { // exit pad: glowing rings and arrows pointing in, inside a hazard-striped border
    vec2 f = fract(uv * 0.5) - 0.5;
    float r = length(f);
    float rings = max(step(abs(r - 0.34), 0.03), max(step(abs(r - 0.2), 0.018), step(r, 0.07)));
    // Four chevrons between the rings, pointing at the centre.
    vec2 a = abs(f);
    vec2 q = a.x > a.y ? a : a.yx;
    float chevron = step(abs(q.x - 0.27 + abs(q.y) * 0.8), 0.022) * step(q.y, 0.07);
    float border = 1.0 - edge(f + 0.5, 0.06);
    float stripe = step(0.5, fract((uv.x + uv.y) * 4.0));
    vec3 steel = uMetal * 0.3 * (0.8 + 0.3 * fbm(uv, 4.0));
    float glow = max(rings, chevron);
    vec3 c = mix(steel, uTechLight, glow);
    c = mix(c, mix(vec3(0.06), uHazard, stripe), border);
    return vec4(c, max(glow, border * stripe * 0.5));
  }
  if (id == 22) { // door frame: a steel jamb with a vertical light strip
    vec2 f = fract(uv * 0.5);
    float strip = step(abs(f.x - 0.5), 0.05) * step(0.1, f.y) * step(f.y, 0.9);
    vec3 c = uMetal * (0.7 + 0.25 * fbm(uv, 5.0));
    c = mix(c * 0.6, c, edge(f, 0.1));
    return vec4(mix(c, uTechLight, strip * 0.9), strip);
  }
  if (id >= 14 && id <= 17) { // key pickups: bright, pulsing
    return vec4(keyColor(id - 14) * (1.1 - 0.4 * fract(uv.y)), 1.0);
  }
  if (id == 18) { // health pickup: white with a red cross
    vec2 c = abs(fract(uv) - 0.5);
    float cross = step(min(c.x, c.y), 0.12) * step(max(c.x, c.y), 0.34);
    return vec4(mix(vec3(0.95), vec3(0.9, 0.08, 0.06), cross), 0.6);
  }
  if (id == 21) { // grate: steel bars over darkness, a frame every cell
    vec2 f = fract(uv * 0.5);
    float bars = step(0.35, fract(uv.x * 4.0));
    float frame = 1.0 - edge(f, 0.06);
    vec3 steel = uMetal * (0.85 + 0.3 * fbm(uv, 4.0));
    return vec4(mix(mix(vec3(0.03), steel, bars), steel * 1.15, frame), 0.0);
  }
  if (id == 20) { // lift: diamond-plate steel inside a yellow chevron border, a glowing seam
    vec2 f = fract(uv * 0.5);
    vec2 d = fract(uv * 6.0) - 0.5;
    float studs = step(abs(d.x) + abs(d.y), 0.18);
    vec3 steel = uMetal * (0.8 + 0.25 * fbm(uv, 4.0)) + studs * 0.12;
    float border = 1.0 - edge(f, 0.12);
    float chevron = step(0.5, fract((f.x + f.y) * 6.0));
    vec3 c = mix(steel, mix(vec3(0.08), uHazard, chevron), border);
    float seam = step(abs(f.y - 0.5), 0.012) * (1.0 - border);
    return vec4(mix(c, uTechLight, seam), seam);
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
uniform float uFlash;
float lightBand(float light, vec3 world, vec3 eye) {
  float d = distance(world, eye);
  float fall = clamp(1.0 - d / 1600.0, 0.0, 1.0);
  float b = light * (0.3 + 0.9 * fall) + uFlash * clamp(1.0 - d / 1100.0, 0.0, 1.0);
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
  if (vTile >= 0) { // baked enemy sprite: alpha 0 empty, 0.5 body, 0.68 glowing marking, 1 eye
    ivec2 origin = ivec2(vTile % 32, vTile / 32) * 64;
    vec4 t = texelFetch(uSpriteAtlas, origin + ivec2(clamp(p, 0.0, 0.999) * 64.0), 0);
    if (t.a < 0.25) discard;
    // Eyes glow whatever the light, brighter through the wind-up: the telegraph.
    vec3 c = t.a > 0.75 ? mix(vec3(0.9, 0.15, 0.05), vec3(1.0, 0.95, 0.5), vCharge) * (0.8 + vCharge) : t.a > 0.6 ? t.rgb : t.rgb * lightBand(vLight, vWorld, uEye);
    outColor = vec4(mix(c, vec3(1.0), vFlash * 0.85), 1.0);
    return;
  }
  if (vShape == 16) { // exit beacon: a shimmering column of light, dithered see-through
    float a = pow(1.0 - abs(p.x - 0.5) * 2.0, 1.5) * (1.0 - p.y * 0.85) * (0.7 + 0.3 * sin(uTime * 4.0 - p.y * 14.0));
    ivec2 q = ivec2(gl_FragCoord.xy) % 4;
    float bayer = (float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0)[q.y * 4 + q.x] + 0.5) / 16.0;
    if (a < bayer) discard;
    outColor = vec4(mix(vec3(0.25, 1.0, 0.45), vec3(0.9, 1.0, 0.9), a), 1.0);
    return;
  }
  if (vShape == 17) { // spark: a white-hot dot cooling to orange at its rim, self-lit
    float r = length(p - 0.5) * 2.0;
    if (r > 1.0) discard;
    outColor = vec4(mix(vec3(1.0, 0.97, 0.8), vec3(1.0, 0.55, 0.12), r), 1.0);
    return;
  }
  if (vShape == 20) { // grenade: a dark ovoid casing with a brass band and a blinking red light
    vec2 q = p - 0.5;
    float d = length(q * vec2(1.25, 1.0)) - 0.42;
    if (d > 0.0) discard;
    vec3 c = mix(vec3(0.16, 0.18, 0.14), vec3(0.3, 0.33, 0.26), p.y);
    if (abs(q.y) < 0.07) c = vec3(0.7, 0.56, 0.25);
    c *= lightBand(vLight, vWorld, uEye);
    if (length(q - vec2(0.0, 0.3)) < 0.08 && fract(uTime * 3.0) < 0.5) c = vec3(1.0, 0.25, 0.1);
    outColor = vec4(c, 1.0);
    return;
  }
  if (vShape == 19) { // warning ring: a pulsing red-orange band at the rim
    float r = length(p - 0.5) * 2.0;
    if (r > 1.0 || r < 0.86) discard;
    float pulse = 0.65 + 0.35 * sin(uTime * 18.0);
    outColor = vec4(mix(vec3(1.0, 0.2, 0.05), vec3(1.0, 0.7, 0.2), pulse), 1.0);
    return;
  }
  if (vShape == 18) { // chip: a jagged grey fragment
    vec2 q = p - 0.5;
    if (max(abs(q.x + q.y * 0.3), abs(q.y - q.x * 0.2)) > 0.42) discard;
    outColor = vec4(vec3(0.42, 0.4, 0.37) * (0.8 + 0.4 * p.y) * lightBand(vLight, vWorld, uEye), 1.0);
    return;
  }
  if (vShape == 14 || vShape == 15) { // gib chunk (14) or blood drop (15)
    vec2 q = p - 0.5;
    float d = vShape == 14 ? length(q * vec2(1.0, 1.35)) - 0.42 + 0.08 * sin(atan(q.y, q.x) * 5.0) : length(q) - 0.45;
    if (d > 0.0) discard;
    vec3 c = vShape == 14 ? mix(vec3(0.42, 0.05, 0.04), vec3(0.75, 0.35, 0.3), step(0.12, p.y - 0.5 - q.x * 0.3)) : vec3(0.55, 0.02, 0.02);
    outColor = vec4(c * lightBand(vLight, vWorld, uEye), 1.0);
    return;
  }
  if (vShape >= 10 && vShape <= 13) { // key: ring, shaft and teeth, glowing in its colour
    float ring = abs(length(p - vec2(0.5, 0.74)) - 0.16) - 0.055;
    float shaft = box(p, vec2(0.5, 0.38), vec2(0.05, 0.26), 0.02);
    float teeth = min(box(p, vec2(0.6, 0.18), vec2(0.07, 0.035), 0.01), box(p, vec2(0.58, 0.3), vec2(0.05, 0.035), 0.01));
    float k = min(ring, min(shaft, teeth));
    if (k > 0.0) discard;
    int id = vShape - 10;
    vec3 kc = id == 0 ? vec3(0.25, 0.45, 1.0) : id == 1 ? vec3(1.0, 0.22, 0.15) : id == 2 ? vec3(1.0, 0.85, 0.2) : vec3(0.25, 0.9, 0.3);
    outColor = vec4(kc * (0.9 + 0.5 * p.y) * (1.0 - 0.4 * smoothstep(-0.03, 0.0, k)), 1.0);
    return;
  }
  if (vShape == 25) { // armour: a steel breastplate with shoulder guards and a bright ridge
    vec2 q = p - vec2(0.5, 0.45);
    float hw = 0.34 - max(0.0, -q.y) * 0.35;
    if (abs(q.x) > hw || q.y < -0.4 || q.y > 0.36 || length(q - vec2(0.0, 0.36)) < 0.13) discard;
    vec3 c = mix(vec3(0.2, 0.28, 0.42), vec3(0.55, 0.68, 0.85), p.y);
    if (abs(q.x) < 0.03) c = vec3(0.8, 0.9, 1.0);
    if (q.y > 0.18 && abs(q.x) > hw - 0.1) c *= 1.25;
    c *= lightBand(vLight, vWorld, uEye);
    outColor = vec4(c, 1.0);
    return;
  }
  if (vShape == 26) { // berserk: a blood-red box with a black cross, throbbing (self-lit)
    vec2 q = p - 0.5;
    if (max(abs(q.x), abs(q.y)) > 0.36) discard;
    float beat = 0.7 + 0.3 * pow(abs(sin(uTime * 3.2)), 8.0);
    vec3 c = vec3(0.85, 0.08, 0.05) * beat;
    if ((abs(q.x) < 0.07 && abs(q.y) < 0.25) || (abs(q.y) < 0.07 && abs(q.x) < 0.25)) c = vec3(0.04, 0.02, 0.02);
    if (max(abs(q.x), abs(q.y)) > 0.31) c = vec3(0.45, 0.04, 0.03);
    outColor = vec4(c, 1.0);
    return;
  }
  if (vShape == 27) { // overcharge: an energy cell, capped, its core pulsing white-blue (self-lit)
    vec2 q = p - 0.5;
    if (abs(q.x) > 0.22 || abs(q.y) > 0.42) discard;
    vec3 c;
    if (abs(q.y) > 0.32) c = vec3(0.35, 0.37, 0.4);
    else {
      float band = 0.5 + 0.5 * sin(q.y * 30.0 - uTime * 10.0);
      c = mix(vec3(0.15, 0.5, 1.0), vec3(0.9, 1.0, 1.0), band * (1.0 - abs(q.x) * 3.0));
    }
    outColor = vec4(c, 1.0);
    return;
  }
  if (vShape == 24) { // barrier: a rounded wall of light, bright at its rim, scanlines rolling up it
    vec2 q = (p - 0.5) * 2.0;
    float edge = length(q * vec2(1.0, 0.8));
    if (edge > 1.0) discard;
    ivec2 pix = ivec2(gl_FragCoord.xy);
    float rim = step(0.8, edge);
    // Every third scene row open, rolling upwards: the body behind shows through the gaps.
    if (rim < 0.5 && (pix.y + int(uTime * 24.0)) % 3 == 0) discard;
    float shimmer = 0.8 + 0.2 * sin(uTime * 9.0 + p.y * 14.0 + p.x * 6.0);
    outColor = vec4(mix(vec3(0.3, 0.75, 1.0), vec3(0.85, 1.0, 1.0), rim) * shimmer, 1.0);
    return;
  }
  if (vShape == 21) { // lob: a dark lumpy glob with a burning green-yellow core
    vec2 q = p - 0.5;
    float wob = 0.05 * sin(atan(q.y, q.x) * 5.0 + uTime * 9.0);
    float r = length(q) * 2.0;
    if (r > 0.9 + wob) discard;
    vec3 c = r < 0.5 ? mix(vec3(1.0, 1.0, 0.55), vec3(0.6, 0.95, 0.1), r * 2.0) : vec3(0.16, 0.2, 0.05) * (1.4 - r);
    outColor = vec4(c, 1.0);
    return;
  }
  if (vShape == 22) { // homing: a magenta core in a pulsing ring
    float r = length(p - 0.5) * 2.0;
    float ring = abs(r - (0.72 + 0.12 * sin(uTime * 12.0)));
    if (r > 1.0 || (r > 0.45 && ring > 0.1)) discard;
    vec3 c = r <= 0.45 ? mix(vec3(1.0, 0.85, 1.0), vec3(1.0, 0.2, 0.8), r / 0.45) : vec3(0.85, 0.2, 1.0);
    outColor = vec4(c, 1.0);
    return;
  }
  if (vShape == 23) { // split: a big hot orb cracked with lines of fire
    vec2 q = p - 0.5;
    float r = length(q) * 2.0;
    if (r > 1.0) discard;
    float a = atan(q.y, q.x) + uTime * 2.0;
    float crack = abs(sin(a * 2.5)) < 0.12 ? 1.0 : 0.0;
    vec3 c = mix(vec3(1.0, 1.0, 0.95), vec3(0.95, 0.5, 0.1), r);
    c = mix(c, vec3(1.0, 0.2, 0.05), crack * step(0.35, r));
    outColor = vec4(c, 1.0);
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

/**
 * Sprite atlas: row = enemy kind, column = direction × SPRITE_FRAMES + frame. The rows are the
 * three first ordinary roles twice (each level's two variants: grunt, grunt, brute, brute, sniper,
 * sniper), then the mini boss, the boss, the charger, the bloater and the warden; see spriteRow.
 */
export const SPRITE_TILE = 64;
export const SPRITE_DIRECTIONS = 8;
export const SPRITE_FRAMES = 4;
export const SPRITE_ROWS = 11;
/** vec4s of body plan per sprite row (see enemyLooks in bestiary.ts). */
export const SPRITE_PLAN_VEC4S = 6;

/**
 * Bakes enemy sprites once per level: each enemy is a small 3D signed-distance model of a mutant
 * (capsules, spheres, rounded boxes; skin, bone, raw flesh, glowing eyes) ray-marched
 * orthographically from 8 directions in 4 frames (walk A, walk B, attack, dead). Each role keeps
 * its silhouette (grunt, brute, sniper, mini boss, boss), and the level's plan (render/bestiary.ts,
 * `uPlan`) breeds it: hunch, bulk, limb heft, head and jaw size, horns, back spikes, eye count,
 * an extra arm pair, a tail, one of four leg types (biped, digitigrade, crawler, slug), glowing
 * markings, and a skin palette and pattern chosen to stand out from the theme.
 * Model space: y up, height 1 = the sprite's height, facing +z, +x on the model's left, so a
 * camera turning counter-clockwise around it moves towards +x. Output alpha: 0 = empty,
 * 0.5 = body, 0.68 = a glowing marking (self-lit in SPRITE_FS), 1 = eye (glows in SPRITE_FS).
 *
 * Written for fast compiles on Direct3D (ANGLE, so Firefox and Chrome on Windows), whose compiler
 * inlines every call and unrolls every loop it can: the shared parts are evaluated once after the
 * silhouette, normals come from one model call in a loop, and loop bounds start at `Z` (a zero the
 * compiler cannot see through) so loops stay loops. Baked one shape row per draw (`uRow`), so no
 * single draw runs long enough to trip the GPU watchdog.
 */
export const SPRITE_BAKE_FS = /* glsl */ `#version 300 es
precision highp float;
// Sprite width / height per shape, so the model fills the same quad the game draws.
uniform float uAspect[${SPRITE_ROWS}];
// Per row, ${SPRITE_PLAN_VEC4S} vec4s (see enemyLooks): 0 (hunch, limb heft, head size, jaw size),
// 1 (horn pairs, horn length, back spikes, eyes), 2 (skin rgb, pattern), 3 (accent rgb, pattern
// scale), 4 (extra arm pair, tail length, bulk, leg type), 5 (marking glow rgb, glows if > 0.5).
uniform vec4 uPlan[${SPRITE_ROWS * SPRITE_PLAN_VEC4S}];
// The shape row this draw bakes.
uniform int uRow;
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

// x = distance, y = material (0 skin, 1 eye, 2 bone: teeth, claws, horns, spikes, 3 raw flesh).
vec2 pick(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

// The plan of the shape being baked.
vec4 P0, P1, P4;
float gAspect;
// Zero, from a uniform: loops counting from it are not unrolled.
int Z;

// Horn pairs on a head (centre hc, radius hr): the first pair sweeps up, the second curls out low.
float horns(vec3 p, vec3 hc, float hr, float scale) {
  float d = 1e9;
  int pairs = int(P1.x + 0.5);
  float len = P1.y * scale;
  for (int k = Z; k < 2; k++) {
    if (k >= pairs) break;
    float fk = float(k);
    for (int s = Z - 1; s <= 1; s += 2) {
      float sx = float(s);
      vec3 root = hc + vec3(sx * hr * (0.55 + 0.3 * fk), hr * (0.55 - 0.5 * fk), -hr * 0.15);
      vec3 mid = root + vec3(sx * len * (0.4 + 0.35 * fk), len * (0.65 - 0.55 * fk), -len * 0.25);
      vec3 tip = mid + vec3(sx * len * 0.08, len * 0.4, len * 0.3);
      d = min(d, min(capsule(p, root, mid, 0.022 * scale), capsule(p, mid, tip, 0.012 * scale)));
    }
  }
  return d;
}

// 1–4 eyes on the face of a head: one big eye, a pair, a pair and a third above, or four.
float eyes(vec3 p, vec3 hc, float hr, float size) {
  int n = int(P1.w + 0.5);
  vec3 f = hc + vec3(0.0, 0.0, hr * 0.8);
  if (n <= 1) return sphere(p, f + vec3(0.0, hr * 0.2, 0.0), hr * 0.36 * size);
  float r = hr * (n >= 4 ? 0.15 : 0.19) * size;
  float d = min(sphere(p, f + vec3(hr * 0.38, hr * 0.3, -hr * 0.08), r), sphere(p, f + vec3(-hr * 0.38, hr * 0.3, -hr * 0.08), r));
  if (n == 3) d = min(d, sphere(p, f + vec3(0.0, hr * 0.62, -hr * 0.2), r));
  if (n >= 4) d = min(d, min(sphere(p, f + vec3(hr * 0.62, 0.0, -hr * 0.25), r * 0.85), sphere(p, f + vec3(-hr * 0.62, 0.0, -hr * 0.25), r * 0.85)));
  return d;
}

// A row of spikes along the back, from a to b, raking backwards.
float spikes(vec3 p, vec3 a, vec3 b, float len) {
  int n = int(P1.z + 0.5);
  float d = 1e9;
  for (int i = Z; i < 6; i++) {
    if (i >= n) break;
    vec3 r = mix(a, b, n == 1 ? 0.5 : float(i) / float(n - 1));
    d = min(d, capsule(p, r, r + vec3(0.0, len * 0.45, -len), 0.015));
  }
  return d;
}

// A tail from the rump, kept inside the sprite quad.
float tail(vec3 p, vec3 root, float swing) {
  float len = min(P4.y, gAspect * 0.5 + root.z - 0.04);
  if (len < 0.04) return 1e9;
  vec3 m = root + vec3(swing * 0.4, -0.08, -len * 0.6);
  vec3 tip = m + vec3(swing, -0.1, -len * 0.4);
  return min(capsule(p, root, m, 0.035), capsule(p, m, tip, 0.02));
}

// Legs from hips at (±hx, hy), thickness r, by the plan's leg type: 0 a biped's bent legs,
// 1 digitigrade (the knee bent back, a long ankle, clawed toes), 2 a crawler's two splayed,
// jointed legs a side, 3 a slug's fleshy foot. Claws and toe tips go to bone.
float legs(vec3 p, float hx, float hy, float r, float swing, inout float bone) {
  int kind = int(P4.w + 0.5);
  if (kind == 3) {
    float d = capsule(p, vec3(0.0, hy, 0.0), vec3(0.0, 0.08, -0.05), r * 2.2);
    return smin(d, rbox(p, vec3(0.0, 0.05, swing * 0.3), vec3(hx + r * 1.6, 0.05, 0.17), 0.05), 0.07);
  }
  // Every leg is three segments (hip, knee, ankle, foot); the type only places the joints, so the
  // compiler sees one leg (see the note on Z).
  float d = 1e9;
  int perSide = kind == 2 ? 2 : 1;
  for (int s = Z - 1; s <= 1; s += 2) {
    float sx = float(s);
    float sw = swing * sx;
    for (int k = Z; k < perSide; k++) {
      vec3 hip = vec3(hx * sx, hy, 0.0);
      vec3 knee;
      vec3 ankle;
      vec3 foot;
      if (kind == 2) {
        float fz = k == 0 ? 0.1 : -0.1;
        float lift = k == 0 ? sw : -sw;
        hip.z = fz * 0.5;
        knee = vec3(sx * (hx + 0.15), hy + 0.05, fz * 1.4 + lift);
        foot = vec3(sx * (hx + 0.23), 0.02, fz * 2.0 + lift);
        ankle = mix(knee, foot, 0.5);
      } else if (kind == 1) {
        knee = vec3(sx * hx * 1.2, hy * 0.62, -0.07 + sw);
        ankle = vec3(sx * hx * 1.2, hy * 0.25, 0.04 + sw);
        foot = vec3(sx * hx * 1.2, 0.02, 0.1 + sw);
      } else {
        knee = vec3(sx * hx * 1.25, hy * 0.55, 0.06 + sw);
        foot = vec3(sx * hx * 1.25, 0.02, sw);
        ankle = mix(knee, foot, 0.5);
      }
      d = min(d, min(capsule(p, hip, knee, r), min(capsule(p, knee, ankle, r * 0.85), capsule(p, ankle, foot, r * 0.7))));
      if (kind != 0) bone = min(bone, sphere(p, foot, r * 0.45));
    }
  }
  return d;
}

// A second, smaller pair of arms below the first, reaching forward like a mantis's; claws to bone.
float extraArms(vec3 p, vec3 shoulder, float swing, bool attack, inout float bone) {
  if (P4.x < 0.5) return 1e9;
  float d = 1e9;
  for (int s = Z - 1; s <= 1; s += 2) {
    float sx = float(s);
    vec3 sh = vec3(shoulder.x * sx, shoulder.y, shoulder.z);
    vec3 el = sh + vec3(0.07 * sx, -0.1, 0.07);
    vec3 h = el + vec3(-0.02 * sx, attack ? 0.1 : -0.06, 0.13 + swing * sx);
    d = min(d, min(capsule(p, sh, el, 0.032), capsule(p, el, h, 0.026)));
    for (int i = Z - 1; i <= 1; i++) bone = min(bone, capsule(p, h, h + vec3(float(i) * 0.015, -0.02, 0.05), 0.008));
  }
  return d;
}

vec2 body(vec3 p, int shape, int frame) {
  float swing = frame == 0 ? 0.08 : frame == 1 ? -0.08 : 0.0; // walk: legs and arms swing opposite
  bool attack = frame == 2;
  float heft = P0.y;
  float headS = P0.z;
  float jaw = P0.w;
  float skin;
  float bone = 1e9;
  float flesh = 1e9;
  // Where the shared parts attach, set by each silhouette.
  vec3 hc, hornC, eyeC, spikeA, spikeB, tailRoot, shoulder2;
  // Hip half-width, height and leg thickness; the boss (z = 0) stands on its own stumps.
  vec3 hips = vec3(0.0);
  float hr, hornScale, eyeSize, spikeLen;
  if (shape == 0) { // grunt: a hunched shambler with lopsided shoulders, claws and a gaping jaw
    hc = vec3(0.0, 0.8, 0.15);
    hr = 0.075 * headS;
    skin = capsule(p, vec3(0.0, 0.44, 0.0), vec3(0.0, 0.72, 0.08), 0.13);
    skin = smin(skin, sphere(p, vec3(0.0, 0.52, 0.05), 0.12), 0.05);
    skin = smin(skin, sphere(p, vec3(0.11, 0.75, -0.02), 0.095), 0.04);
    skin = smin(skin, sphere(p, vec3(-0.12, 0.72, -0.01), 0.07), 0.04);
    skin = smin(skin, sphere(p, hc, hr), 0.03);
    vec3 mouth = hc + vec3(0.0, -0.035 * headS, 0.085 * headS);
    skin = smin(skin, rbox(p, hc + vec3(0.0, -0.055 * headS, 0.03 * headS), vec3(0.058, 0.025, 0.05) * headS * vec3(jaw, 1.0, 1.0), 0.02), 0.02);
    skin = max(skin, -sphere(p, mouth, 0.04 * headS * jaw)); // the open mouth
    flesh = sphere(p, mouth - vec3(0.0, 0.0, 0.035 * headS), 0.03 * headS * jaw);
    for (int i = Z - 2; i <= 2; i++) bone = min(bone, sphere(p, mouth + vec3(float(i) * 0.018 * jaw * headS, 0.02 * headS, -0.02 * headS), 0.011));
    // Arms to the knees, the right one thrown forward to attack, three claws each.
    vec3 rs = vec3(0.14, 0.73, 0.02);
    vec3 ls = vec3(-0.14, 0.71, 0.02);
    vec3 rh = attack ? vec3(0.16, 0.95, 0.24) : rs + (vec3(0.18, 0.32, 0.1 - swing) - rs) * heft;
    vec3 re = attack ? vec3(0.2, 0.82, 0.14) : rs + (vec3(0.21, 0.55, 0.06 - swing * 0.5) - rs) * heft;
    vec3 lh = ls + (vec3(-0.19, 0.3, 0.1 + swing) - ls) * heft;
    vec3 le = ls + (vec3(-0.21, 0.54, 0.05 + swing * 0.5) - ls) * heft;
    skin = min(skin, min(capsule(p, rs, re, 0.045), capsule(p, re, rh, 0.04)));
    skin = min(skin, min(capsule(p, ls, le, 0.045), capsule(p, le, lh, 0.04)));
    for (int i = Z - 1; i <= 1; i++) {
      bone = min(bone, capsule(p, rh, rh + vec3(float(i) * 0.02, -0.06, 0.03), 0.009));
      bone = min(bone, capsule(p, lh, lh + vec3(float(i) * 0.02, -0.06, 0.03), 0.009));
    }
    hips = vec3(0.07, 0.44, 0.05);
    // Ribs showing through.
    for (int i = Z; i < 3; i++) flesh = min(flesh, capsule(p, vec3(-0.09, 0.56 + float(i) * 0.045, 0.14), vec3(0.09, 0.56 + float(i) * 0.045, 0.14), 0.008));
    tailRoot = vec3(0.0, 0.42, -0.1);
    shoulder2 = vec3(0.13, 0.6, 0.05);
    hornC = hc; eyeC = hc; hornScale = 1.0; eyeSize = 1.0;
    spikeA = vec3(0.0, 0.5, -0.1); spikeB = vec3(0.0, 0.74, -0.03); spikeLen = 0.07;
  } else if (shape == 1 || shape == 3) { // brute / mini boss: a hulk with a hump, tusks, huge fists
    hc = vec3(0.0, 0.7, 0.17);
    hr = 0.075 * headS;
    skin = rbox(p, vec3(0.0, 0.52, 0.0), vec3(0.23, 0.19, 0.15), 0.1);
    skin = smin(skin, sphere(p, vec3(0.0, 0.7, -0.07), 0.17), 0.06); // back hump
    skin = smin(skin, sphere(p, hc, hr), 0.04); // head sunk into the chest
    vec3 mouth = hc + vec3(0.0, -0.035 * headS, 0.08 * headS);
    skin = max(skin, -sphere(p, mouth, 0.035 * headS * jaw));
    flesh = sphere(p, mouth - vec3(0.0, 0.0, 0.03 * headS), 0.03 * headS * jaw);
    bone = min(capsule(p, mouth + vec3(0.04, -0.01, -0.02) * headS, mouth + vec3(0.06 * jaw, 0.045, 0.01) * headS, 0.012), capsule(p, mouth + vec3(-0.04, -0.01, -0.02) * headS, mouth + vec3(-0.06 * jaw, 0.045, 0.01) * headS, 0.012)); // tusks
    float reach = attack ? 0.24 : 0.0;
    vec3 rf = vec3(0.3, attack ? 0.6 : 0.1, 0.06 + reach - swing);
    vec3 lf = vec3(-0.3, attack ? 0.6 : 0.1, 0.06 + reach + swing);
    skin = min(skin, min(capsule(p, vec3(0.25, 0.66, 0.0), rf, 0.075 * heft), capsule(p, vec3(-0.25, 0.66, 0.0), lf, 0.075 * heft)));
    skin = min(skin, min(sphere(p, rf, 0.1 * heft), sphere(p, lf, 0.1 * heft)));
    hips = vec3(0.09, 0.36, 0.07);
    flesh = min(flesh, sphere(p, vec3(0.12, 0.5, 0.15), 0.05)); // a raw wound
    if (shape == 3) bone = min(bone, min(capsule(p, vec3(0.24, 0.76, 0.0), vec3(0.34, 0.9, -0.02), 0.03), capsule(p, vec3(-0.24, 0.76, 0.0), vec3(-0.34, 0.9, -0.02), 0.03))); // shoulder spurs
    tailRoot = vec3(0.0, 0.4, -0.14);
    shoulder2 = vec3(0.24, 0.48, 0.08);
    hornC = hc; eyeC = hc; hornScale = 1.2; eyeSize = 0.9;
    spikeA = vec3(0.0, 0.64, -0.2); spikeB = vec3(0.0, 0.82, -0.14); spikeLen = 0.1;
  } else if (shape == 2) { // sniper: a gaunt stalker, long skull, big eyes, a bone rifle
    hc = vec3(0.0, 0.9, 0.03);
    hr = 0.062 * headS;
    skin = capsule(p, vec3(0.0, 0.48, 0.0), vec3(0.0, 0.8, 0.04), 0.08);
    skin = smin(skin, min(sphere(p, vec3(0.1, 0.8, 0.0), 0.06), sphere(p, vec3(-0.1, 0.8, 0.0), 0.06)), 0.04); // bony shoulders
    skin = smin(skin, capsule(p, hc + vec3(0.0, -0.03, 0.01), hc + vec3(0.0, 0.07, -0.1) * headS, hr), 0.03); // long skull
    skin = max(skin, -rbox(p, hc + vec3(0.0, -0.045, 0.06) * headS, vec3(0.03 * jaw, 0.008, 0.03), 0.004)); // a slit mouth
    for (int i = Z; i < 4; i++) flesh = min(flesh, capsule(p, vec3(-0.06, 0.55 + float(i) * 0.05, 0.075), vec3(0.06, 0.55 + float(i) * 0.05, 0.075), 0.007));
    hips = vec3(0.05, 0.47, 0.035);
    bone = capsule(p, vec3(0.07, 0.72, -0.06), vec3(0.06, attack ? 0.82 : 0.7, 0.34), 0.026); // rifle
    skin = min(skin, capsule(p, vec3(0.1, 0.78, 0.0), vec3(0.07, 0.72, 0.16), 0.03 * heft));
    tailRoot = vec3(0.0, 0.45, -0.06);
    shoulder2 = vec3(0.08, 0.66, 0.02);
    hornC = hc; eyeC = hc; hornScale = 0.8; eyeSize = 1.5;
    spikeA = vec3(0.0, 0.55, -0.07); spikeB = vec3(0.0, 0.82, -0.05); spikeLen = 0.05;
  } else { // boss: a lumpy mass with a toothed maw, horns and many eyes
    hc = vec3(0.0, 0.56, 0.0);
    hr = 0.34;
    skin = sphere(p, vec3(0.0, 0.46, 0.0), 0.34);
    skin = smin(skin, sphere(p, vec3(0.16, 0.66, -0.05), 0.16 * headS), 0.08);
    skin = smin(skin, sphere(p, vec3(-0.18, 0.6, -0.02), 0.14 * headS), 0.08);
    skin = max(skin, -rbox(p, vec3(0.0, 0.42, 0.33), vec3(0.16 * jaw, 0.06, 0.08), 0.04)); // the maw
    flesh = rbox(p, vec3(0.0, 0.42, 0.27), vec3(0.14 * jaw, 0.05, 0.03), 0.03);
    for (int i = Z - 4; i <= 4; i++) {
      float x = float(i) * 0.04 * jaw;
      if (abs(x) > 0.15 * jaw) continue;
      bone = min(bone, capsule(p, vec3(x, 0.48, 0.3), vec3(x, 0.44, 0.31), 0.012));
      bone = min(bone, capsule(p, vec3(x + 0.02, 0.36, 0.3), vec3(x + 0.02, 0.4, 0.31), 0.012));
    }
    skin = min(skin, min(capsule(p, vec3(0.16, 0.18, 0.0), vec3(0.18, 0.02, swing), 0.09 * heft), capsule(p, vec3(-0.16, 0.18, 0.0), vec3(-0.18, 0.02, -swing), 0.09 * heft)));
    tailRoot = vec3(0.0, 0.3, -0.3);
    shoulder2 = vec3(0.28, 0.4, 0.15);
    hornC = hc + vec3(0.0, 0.0, attack ? 0.05 : 0.0); eyeC = hc + vec3(0.0, 0.06, -0.05); hornScale = 1.8; eyeSize = 0.5;
    spikeA = vec3(0.0, 0.5, -0.32); spikeB = vec3(0.0, 0.78, -0.12); spikeLen = 0.12;
  }
  skin = min(skin, min(tail(p, tailRoot, swing), extraArms(p, shoulder2, swing, attack, bone)));
  if (hips.z > 0.0) skin = min(skin, legs(p, hips.x, hips.y, hips.z, swing, bone));
  bone = min(bone, min(horns(p, hornC, hr, hornScale), spikes(p, spikeA, spikeB, spikeLen)));
  float eye = eyes(p, eyeC, hr, eyeSize);
  return pick(pick(vec2(skin, 0.0), vec2(eye, 1.0)), pick(vec2(bone, 2.0), vec2(flesh, 3.0)));
}

// Bulk widens the body; hunch leans everything above the hips forward.
vec2 model(vec3 p, int shape, int frame) {
  float bulk = P4.z;
  p.x /= bulk;
  p.z -= P0.x * max(p.y - 0.42, 0.0);
  vec2 r = body(p, shape, frame);
  r.x *= min(1.0, bulk) * 0.9;
  return r;
}

// Dead: the body lies on its back, head towards -z, face up; standing otherwise.
vec3 toModel(vec3 p, int frame) {
  return frame == 3 ? vec3(p.x, 0.5 - p.z, p.y - 0.12) : p;
}

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 tile = px / ${SPRITE_TILE};
  int row = tile.y;
  if (row != uRow) discard;
  // Rows: grunt, grunt, brute, brute, sniper, sniper (two variants each), mini boss, boss, then
  // the charger, bloater and warden, built on the brute, grunt and sniper silhouettes (their plans
  // make them their own: horns and a hunch, a bloated glowing belly, an upright guard); no new
  // silhouettes keeps the bake quick to compile.
  int shape = row < 6 ? row / 2 : row < 8 ? row - 3 : row == 8 ? 1 : row == 9 ? 0 : 2;
  int dir = tile.x / ${SPRITE_FRAMES};
  int frame = tile.x % ${SPRITE_FRAMES};
  vec2 uv = (vec2(px % ${SPRITE_TILE}) + 0.5) / ${SPRITE_TILE}.0;
  gAspect = uAspect[row];
  Z = int(min(gAspect, 0.0));
  int base = row * ${SPRITE_PLAN_VEC4S};
  P0 = uPlan[base];
  P1 = uPlan[base + 1];
  vec4 P2 = uPlan[base + 2];
  vec4 P3 = uPlan[base + 3];
  P4 = uPlan[base + 4];
  vec4 P5 = uPlan[base + 5];
  // Orthographic camera orbiting the model: direction 0 looks at its front.
  float th = float(dir) * 0.7853982;
  vec3 fwd = -vec3(sin(th), 0.0, cos(th));
  vec3 right = vec3(cos(th), 0.0, -sin(th));
  vec3 ro = -fwd * 1.5 + right * (uv.x - 0.5) * gAspect + vec3(0.0, uv.y, 0.0);
  float t = 0.0;
  vec2 hit = vec2(1e9, 0.0);
  vec3 sp = ro;
  int f = frame == 3 ? 0 : frame;
  for (int i = Z; i < 80; i++) {
    sp = toModel(ro + fwd * t, frame);
    hit = model(sp, shape, f);
    if (hit.x < 0.002 || t > 3.0) break;
    t += hit.x;
  }
  if (hit.x >= 0.002) {
    outColor = vec4(0.0);
    return;
  }
  if (hit.y == 1.0) {
    outColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }
  // Shade with the SDF gradient and a light from above and in front.
  vec3 n = vec3(0.0);
  for (int i = Z; i < 4; i++) {
    vec3 k = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += k * model(sp + k * 0.002, shape, f).x;
  }
  n = normalize(n);
  vec3 light = normalize(-fwd + vec3(0.3, 0.9, 0.0));
  float diff = 0.35 + 0.75 * max(dot(n, light), 0.0);
  // Skin in the plan's colours: mottled, banded, spotted or pale-bellied; yellowed bone; wet raw flesh.
  float n1 = noise3(sp * 22.0);
  float n2 = noise3(sp * 6.0 + 3.0);
  vec3 skin = P2.rgb * (0.75 + 0.35 * n1) * (0.88 + 0.2 * n2);
  int pattern = int(P2.w + 0.5);
  float ps = P3.w;
  float m = pattern == 1 ? step(0.62, fract(sp.y * ps + n2 * 1.5))
    : pattern == 2 ? step(0.64, noise3(sp * ps + 7.0))
    : pattern == 3 ? step(0.3, n.z) * step(0.3, sp.y) * step(sp.y, 0.78)
    : smoothstep(0.55, 0.7, noise3(sp * ps)) * 0.7;
  // Glowing markings: the pattern's accent areas light up in the plan's glow colour.
  if (hit.y == 0.0 && P5.w > 0.5 && m > 0.5) {
    outColor = vec4(P5.rgb * (0.85 + 0.3 * n1) * (frame == 3 ? 0.35 : 1.0), 0.68);
    return;
  }
  skin = mix(skin, P3.rgb * (0.8 + 0.3 * n1), m);
  vec3 col = hit.y == 2.0 ? vec3(0.7, 0.66, 0.52) : hit.y == 3.0 ? vec3(0.45, 0.05, 0.05) : skin;
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
