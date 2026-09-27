import { THEME_NAMES, mat4Mul, mat4Perspective, viewFromMapCamera, type MapData, type ThemeName } from '@proc-fps/core';
import type { BufferHandle, PipelineHandle, RenderBackend, RenderTargetHandle, TextureHandle } from './backend.js';
import { LEVEL_LAYOUT, MAX_MOVERS, buildLevelMesh, type SectorRange } from './mesh.js';
import { PALETTE_SIZE, paletteRGBA } from './palette.js';
import {
  ATLAS_COLS,
  ATLAS_FS,
  ATLAS_ROWS,
  ATLAS_TILE,
  LEVEL_FS,
  LEVEL_VS,
  POST_FS,
  POST_VS,
  SPRITE_BAKE_FS,
  BLIT_FS,
  SPRITE_DIRECTIONS,
  SPRITE_FRAMES,
  SPRITE_FS,
  SPRITE_ROWS,
  SPRITE_TILE,
  SPRITE_VS,
} from './shaders.js';
import { themeUniforms } from './themes.js';
import { BASELINE_LOOKS, lookUniforms, type EnemyLook } from './bestiary.js';
import { SPRITE_FLOATS_PER_VERTEX, SPRITE_LAYOUT, buildSpriteVertices, type Sprite } from './sprites.js';
import { PortalGraph } from './visibility.js';

/** What the last frame drew (for the perf overlay). */
export interface RenderStats {
  sectors: number;
  totalSectors: number;
  /** Index ranges drawn (visible sectors merged where they are contiguous). */
  ranges: number;
  triangles: number;
  totalTriangles: number;
  sprites: number;
}

export interface Camera {
  /** Map-space position. */
  x: number;
  y: number;
  /** Eye height (world Y). */
  eyeZ: number;
  yaw: number;
  pitch: number;
}

export interface RendererOptions {
  /** Internal render height; width follows the canvas aspect. */
  lowResHeight: number;
  /** Vertical field of view in radians. */
  fovY: number;
  dither: number;
}

const DEFAULTS: RendererOptions = { lowResHeight: 240, fovY: (74 * Math.PI) / 180, dither: 0.03 };

/**
 * Draws a level: scene into a low-res target, then a palette-quantizing
 * post pass upscaled with nearest filtering. Only the sectors the camera can see through open
 * portals are drawn (visibility.ts), their index ranges merged where contiguous.
 */
export class LevelRenderer {
  private readonly opts: RendererOptions;
  private readonly levelPipeline: PipelineHandle;
  private readonly spritePipeline: PipelineHandle;
  private readonly atlasPipeline: PipelineHandle;
  /** The level's textures, baked in setMap. */
  private readonly atlas: RenderTargetHandle;
  /** Enemy sprites, baked by bakeSprites. */
  private readonly spriteAtlas: RenderTargetHandle;
  private readonly spriteBakePipeline: PipelineHandle;
  private readonly spriteBuffer: BufferHandle;
  private readonly postPipeline: PipelineHandle;
  private palette: TextureHandle;
  private target: RenderTargetHandle | null = null;
  private vb: BufferHandle | null = null;
  private ib: BufferHandle | null = null;
  private indexCount = 0;
  sectorRanges: SectorRange[] = [];
  private portals: PortalGraph | null = null;
  /** Reused every frame for the sprite quads (hundreds of gore particles), so nothing is allocated. */
  private spriteScratch = new Float32Array(0);
  /** Portal culling on (the default); off draws every sector, for comparison. */
  culling = true;
  stats: RenderStats = { sectors: 0, totalSectors: 0, ranges: 0, triangles: 0, totalTriangles: 0, sprites: 0 };
  /** Muzzle-flash light, 0–1, set by the app each frame. */
  flash = 0;
  /** Per-mover offsets for this frame (door ids, then key pickups); see `mesh.ts`. */
  readonly movers = new Float32Array(MAX_MOVERS);

  /** The vertical field of view in radians (the player's option). */
  get fovY(): number {
    return this.opts.fovY;
  }
  set fovY(v: number) {
    this.opts.fovY = v;
  }

  constructor(private readonly backend: RenderBackend, opts: Partial<RendererOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.levelPipeline = backend.createPipeline({
      label: 'level',
      shader: { glsl: { vertex: LEVEL_VS, fragment: LEVEL_FS } },
      layout: LEVEL_LAYOUT,
      depthTest: true,
      depthWrite: true,
      cullBack: false,
    });
    this.spritePipeline = backend.createPipeline({
      label: 'sprites',
      shader: { glsl: { vertex: SPRITE_VS, fragment: SPRITE_FS } },
      layout: SPRITE_LAYOUT,
      depthTest: true,
      depthWrite: true,
      cullBack: false,
    });
    this.spriteBuffer = backend.createVertexBuffer(new Float32Array(0));
    this.atlasPipeline = backend.createPipeline({
      label: 'atlas-bake',
      shader: { glsl: { vertex: POST_VS, fragment: ATLAS_FS } },
      layout: null,
      depthTest: false,
      depthWrite: false,
      cullBack: false,
    });
    this.atlas = backend.createRenderTarget(ATLAS_TILE * ATLAS_COLS, ATLAS_TILE * ATLAS_ROWS, 'nearest');
    this.spriteBakePipeline = backend.createPipeline({
      label: 'sprite-bake',
      shader: { glsl: { vertex: POST_VS, fragment: SPRITE_BAKE_FS } },
      layout: null,
      depthTest: false,
      depthWrite: false,
      cullBack: false,
    });
    this.spriteAtlas = backend.createRenderTarget(SPRITE_TILE * SPRITE_DIRECTIONS * SPRITE_FRAMES, SPRITE_TILE * SPRITE_ROWS, 'nearest');
    this.postPipeline = backend.createPipeline({
      label: 'palette-post',
      shader: { glsl: { vertex: POST_VS, fragment: POST_FS } },
      layout: null,
      depthTest: false,
      depthWrite: false,
      cullBack: false,
    });
    this.palette = backend.createTexture({ width: PALETTE_SIZE, height: 1, filter: 'nearest', wrap: 'clamp' }, paletteRGBA());
  }

  setMap(map: MapData): void {
    if (this.vb) this.backend.destroy(this.vb);
    if (this.ib) this.backend.destroy(this.ib);
    const mesh = buildLevelMesh(map);
    this.vb = this.backend.createVertexBuffer(mesh.vertices);
    this.ib = this.backend.createIndexBuffer(mesh.indices);
    this.indexCount = mesh.indices.length;
    this.sectorRanges = mesh.sectors;
    this.portals = new PortalGraph(map);
    // Every theme quantizes to its own palette.
    this.backend.destroy(this.palette);
    this.palette = this.backend.createTexture({ width: PALETTE_SIZE, height: 1, filter: 'nearest', wrap: 'clamp' }, paletteRGBA(map.meta.theme));
    this.bakeAtlas(map);
  }

  /**
   * Bakes the enemy sprite atlas: every shape from 8 directions in 4 frames, bred as `looks` says
   * (see enemyLooks; once per level). `aspects` is each shape's quad width / height, so the models
   * fill the quads the game draws.
   */
  bakeSprites(aspects: readonly number[], looks: readonly EnemyLook[] = BASELINE_LOOKS): void {
    this.backend.beginPass({ target: this.spriteAtlas, clearColor: [0, 0, 0, 0] });
    // One shape row per draw: each stays short enough for the GPU watchdog on slow machines.
    const uniforms = lookUniforms(looks, aspects);
    for (let row = 0; row < SPRITE_ROWS; row++) {
      this.backend.draw({ pipeline: this.spriteBakePipeline, first: 0, count: 3, uniforms: { ...uniforms, uRow: { int: row } } });
    }
    this.backend.endPass();
  }

  /** Dev view: draws the baked sprite atlas to the canvas (eyes tinted red). */
  showSpriteAtlas(): void {
    const blit = this.blitPipeline ??= this.backend.createPipeline({
      label: 'blit',
      shader: { glsl: { vertex: POST_VS, fragment: BLIT_FS } },
      layout: null,
      depthTest: false,
      depthWrite: false,
      cullBack: false,
    });
    this.backend.beginPass({ target: null, clearColor: [0, 0, 0, 1] });
    this.backend.draw({ pipeline: blit, first: 0, count: 3, textures: { uTex: this.spriteAtlas.color } });
    this.backend.endPass();
  }
  private blitPipeline: PipelineHandle | undefined;

  /** Bakes the level's texture set from its theme and seed, once. */
  private bakeAtlas(map: MapData): void {
    const theme = (THEME_NAMES as readonly string[]).includes(map.meta.theme ?? '') ? (map.meta.theme as ThemeName) : 'base';
    this.backend.beginPass({ target: this.atlas, clearColor: [0, 0, 0, 0] });
    this.backend.draw({ pipeline: this.atlasPipeline, first: 0, count: 3, uniforms: themeUniforms(theme, map.meta.seed ?? map.meta.name) });
    this.backend.endPass();
  }

  /** Rows the scene is drawn (and palette-quantized) at; the canvas needs no more than this. */
  get lowResHeight(): number {
    return this.opts.lowResHeight;
  }

  /** Call after the canvas size changes. */
  resize(): void {
    const h = this.opts.lowResHeight;
    const w = Math.max(1, Math.round((h * this.backend.width) / Math.max(1, this.backend.height)));
    if (this.target && this.target.width === w && this.target.height === h) return;
    if (this.target) this.backend.destroy(this.target);
    this.target = this.backend.createRenderTarget(w, h, 'nearest');
  }

  /** Draws the level, then `sprites` (enemies, corpses, projectiles) in the same depth-tested pass. */
  render(cam: Camera, time: number, sprites: readonly Sprite[] = []): void {
    if (!this.target) this.resize();
    const target = this.target!;
    const be = this.backend;
    const proj = mat4Perspective(this.opts.fovY, target.width / target.height, 4, 8192, be.clipDepth);
    const view = viewFromMapCamera(cam.x, cam.y, cam.eyeZ, cam.yaw, cam.pitch);

    be.beginPass({ target, clearColor: [0, 0, 0, 1], clearDepth: true });
    if (this.vb && this.ib) {
      // The visible sectors' index ranges, merged where one follows on from the last.
      const halfFov = Math.atan(Math.tan(this.opts.fovY / 2) * (target.width / target.height)) + 0.05;
      const visible = this.culling && this.portals ? this.portals.visible(cam.x, cam.y, cam.yaw, halfFov) : null;
      const ranges: SectorRange[] = [];
      let sectors = 0;
      let indices = 0;
      this.sectorRanges.forEach((r, s) => {
        if (visible && !visible[s]) return;
        sectors++;
        if (!r.count) return;
        indices += r.count;
        const last = ranges[ranges.length - 1];
        if (last && last.first + last.count === r.first) last.count += r.count;
        else ranges.push({ first: r.first, count: r.count });
      });
      this.stats = { sectors, totalSectors: this.sectorRanges.length, ranges: ranges.length, triangles: indices / 3, totalTriangles: this.indexCount / 3, sprites: sprites.length };
      be.draw({
        pipeline: this.levelPipeline,
        vertices: this.vb,
        indices: this.ib,
        first: 0,
        count: this.indexCount,
        ranges,
        uniforms: {
          uViewProj: mat4Mul(proj, view),
          uEye: new Float32Array([cam.x, cam.eyeZ, -cam.y]),
          uTime: time,
          uMover: { vec4s: this.movers },
          uFlash: this.flash,
        },
        textures: { uAtlas: this.atlas.color },
      });
    }
    if (sprites.length) {
      const need = sprites.length * 6 * SPRITE_FLOATS_PER_VERTEX;
      if (this.spriteScratch.length < need) this.spriteScratch = new Float32Array(Math.ceil(need * 1.5));
      be.updateVertexBuffer(this.spriteBuffer, buildSpriteVertices(sprites, cam.yaw, this.spriteScratch));
      be.draw({
        pipeline: this.spritePipeline,
        vertices: this.spriteBuffer,
        first: 0,
        count: sprites.length * 6,
        uniforms: {
          uViewProj: mat4Mul(proj, view),
          uEye: new Float32Array([cam.x, cam.eyeZ, -cam.y]),
          uTime: time,
          uFlash: this.flash,
        },
        textures: { uSpriteAtlas: this.spriteAtlas.color },
      });
    }
    be.endPass();

    be.beginPass({ target: null });
    be.draw({
      pipeline: this.postPipeline,
      first: 0,
      count: 3,
      textures: { uScene: target.color, uPalette: this.palette },
      uniforms: { uSceneSize: new Float32Array([target.width, target.height]), uDither: this.opts.dither },
    });
    be.endPass();
  }
}
