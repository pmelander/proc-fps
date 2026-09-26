import type { ClipDepth } from '@proc-fps/core';

/**
 * Thin GPU abstraction. Game-facing render code (LevelRenderer, future sprite
 * and HUD passes) talks only to this interface. WebGL2 is implemented now;
 * a WebGPU backend slots in behind the same surface later.
 *
 * Design rules:
 * - Handles are opaque; backends own the real GPU objects.
 * - No global state leaks: every draw names its pipeline, buffers, uniforms, textures.
 * - Shaders are supplied per backend language (GLSL now, WGSL later) in one desc.
 */

export interface BufferHandle {
  readonly kind: 'buffer';
  readonly id: number;
}
export interface TextureHandle {
  readonly kind: 'texture';
  readonly id: number;
  readonly width: number;
  readonly height: number;
}
export interface RenderTargetHandle {
  readonly kind: 'target';
  readonly id: number;
  readonly color: TextureHandle;
  readonly width: number;
  readonly height: number;
}
export interface PipelineHandle {
  readonly kind: 'pipeline';
  readonly id: number;
}
export type Handle = BufferHandle | TextureHandle | RenderTargetHandle | PipelineHandle;

export interface VertexAttribute {
  /** Must match the shader input name. */
  name: string;
  components: 1 | 2 | 3 | 4;
  /** Byte offset within one vertex. */
  offset: number;
}

export interface VertexLayout {
  /** Bytes per vertex. Attributes are float32. */
  stride: number;
  attributes: readonly VertexAttribute[];
}

export interface ShaderSource {
  glsl?: { vertex: string; fragment: string };
  /** Reserved for the WebGPU backend. */
  wgsl?: string;
}

export interface PipelineDesc {
  label: string;
  shader: ShaderSource;
  /** null = no vertex buffer (e.g. fullscreen triangle from gl_VertexID). */
  layout: VertexLayout | null;
  depthTest: boolean;
  depthWrite: boolean;
  cullBack: boolean;
}

export type TextureFilter = 'nearest' | 'linear';

export interface TextureDesc {
  width: number;
  height: number;
  filter: TextureFilter;
  wrap: 'repeat' | 'clamp';
}

/**
 * Uniform values by name. Numbers are floats; `{ int }` for integer/sampler-free ints.
 * Float32Array length selects vec2/vec3/vec4/mat4.
 * (A WebGPU backend will pack these into a uniform buffer by a declared layout.)
 */
export type UniformValue = number | { int: number } | Float32Array;

export interface DrawCall {
  pipeline: PipelineHandle;
  vertices?: BufferHandle;
  indices?: BufferHandle;
  /** First index (indexed) or first vertex (non-indexed). */
  first: number;
  count: number;
  uniforms?: Readonly<Record<string, UniformValue>>;
  textures?: Readonly<Record<string, TextureHandle>>;
}

export interface PassDesc {
  /** null = the canvas. */
  target: RenderTargetHandle | null;
  clearColor?: readonly [number, number, number, number];
  clearDepth?: boolean;
}

export interface RenderBackend {
  readonly kind: 'webgl2' | 'webgpu';
  /** Projection matrices must be built for this convention. */
  readonly clipDepth: ClipDepth;
  /** Canvas size in device pixels. */
  readonly width: number;
  readonly height: number;

  createVertexBuffer(data: Float32Array): BufferHandle;
  createIndexBuffer(data: Uint32Array): BufferHandle;
  createTexture(desc: TextureDesc, rgba?: Uint8Array): TextureHandle;
  createRenderTarget(width: number, height: number, filter: TextureFilter): RenderTargetHandle;
  createPipeline(desc: PipelineDesc): PipelineHandle;
  destroy(handle: Handle): void;

  /** Resize the canvas backing store (device pixels). */
  resize(width: number, height: number): void;

  beginPass(desc: PassDesc): void;
  draw(call: DrawCall): void;
  endPass(): void;
}
