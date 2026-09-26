import { mat4Mul, mat4Perspective, viewFromMapCamera, type MapData } from '@proc-fps/core';
import type { BufferHandle, PipelineHandle, RenderBackend, RenderTargetHandle, TextureHandle } from './backend.js';
import { LEVEL_LAYOUT, MAX_MOVERS, buildLevelMesh, type SectorRange } from './mesh.js';
import { PALETTE_SIZE, paletteRGBA } from './palette.js';
import { LEVEL_FS, LEVEL_VS, POST_FS, POST_VS } from './shaders.js';

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
 * post pass upscaled with nearest filtering.
 *
 * TODO(M1+): portal culling — flood visible sectors through two-sided lines
 * clipped to the view frustum and draw only their `sectorRanges`.
 */
export class LevelRenderer {
  private readonly opts: RendererOptions;
  private readonly levelPipeline: PipelineHandle;
  private readonly postPipeline: PipelineHandle;
  private readonly palette: TextureHandle;
  private target: RenderTargetHandle | null = null;
  private vb: BufferHandle | null = null;
  private ib: BufferHandle | null = null;
  private indexCount = 0;
  sectorRanges: SectorRange[] = [];
  /** Per-mover offsets for this frame (door ids, then key pickups); see `mesh.ts`. */
  readonly movers = new Float32Array(MAX_MOVERS);

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
  }

  /** Call after the canvas size changes. */
  resize(): void {
    const h = this.opts.lowResHeight;
    const w = Math.max(1, Math.round((h * this.backend.width) / Math.max(1, this.backend.height)));
    if (this.target && this.target.width === w && this.target.height === h) return;
    if (this.target) this.backend.destroy(this.target);
    this.target = this.backend.createRenderTarget(w, h, 'nearest');
  }

  render(cam: Camera, time: number): void {
    if (!this.target) this.resize();
    const target = this.target!;
    const be = this.backend;
    const proj = mat4Perspective(this.opts.fovY, target.width / target.height, 4, 8192, be.clipDepth);
    const view = viewFromMapCamera(cam.x, cam.y, cam.eyeZ, cam.yaw, cam.pitch);

    be.beginPass({ target, clearColor: [0, 0, 0, 1], clearDepth: true });
    if (this.vb && this.ib) {
      be.draw({
        pipeline: this.levelPipeline,
        vertices: this.vb,
        indices: this.ib,
        first: 0,
        count: this.indexCount,
        uniforms: {
          uViewProj: mat4Mul(proj, view),
          uEye: new Float32Array([cam.x, cam.eyeZ, -cam.y]),
          uTime: time,
          uMover: { floats: this.movers },
        },
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
