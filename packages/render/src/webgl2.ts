import type {
  BufferHandle,
  DrawCall,
  Handle,
  PassDesc,
  PipelineDesc,
  PipelineHandle,
  RenderBackend,
  RenderTargetHandle,
  TextureDesc,
  TextureFilter,
  TextureHandle,
  UniformValue,
} from './backend.js';

interface GLPipeline {
  program: WebGLProgram;
  desc: PipelineDesc;
  uniforms: Map<string, WebGLUniformLocation | null>;
}
interface GLTarget {
  fbo: WebGLFramebuffer;
  depth: WebGLRenderbuffer;
  colorId: number;
}

export class WebGL2Backend implements RenderBackend {
  readonly kind = 'webgl2' as const;
  readonly clipDepth = 'neg-one-to-one' as const;

  private readonly gl: WebGL2RenderingContext;
  private nextId = 1;
  private readonly buffers = new Map<number, WebGLBuffer>();
  private readonly textures = new Map<number, WebGLTexture>();
  private readonly targets = new Map<number, GLTarget>();
  private readonly pipelines = new Map<number, GLPipeline>();
  private readonly vaos = new Map<string, WebGLVertexArrayObject>();
  private currentPass: PassDesc | null = null;

  static create(canvas: HTMLCanvasElement): WebGL2Backend {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    return new WebGL2Backend(gl);
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  get width(): number {
    return this.gl.drawingBufferWidth;
  }
  get height(): number {
    return this.gl.drawingBufferHeight;
  }

  resize(width: number, height: number): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
    }
  }

  createVertexBuffer(data: Float32Array): BufferHandle {
    return this.createBuffer(this.gl.ARRAY_BUFFER, data);
  }

  createIndexBuffer(data: Uint32Array): BufferHandle {
    return this.createBuffer(this.gl.ELEMENT_ARRAY_BUFFER, data);
  }

  updateVertexBuffer(handle: BufferHandle, data: Float32Array): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.get(handle.id) ?? null);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private createBuffer(target: number, data: ArrayBufferView): BufferHandle {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindVertexArray(null);
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    gl.bindBuffer(target, null);
    const id = this.nextId++;
    this.buffers.set(id, buf);
    return { kind: 'buffer', id };
  }

  createTexture(desc: TextureDesc, rgba?: Uint8Array): TextureHandle {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, desc.width, desc.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba ?? null);
    this.applySampler(desc.filter, desc.wrap);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const id = this.nextId++;
    this.textures.set(id, tex);
    return { kind: 'texture', id, width: desc.width, height: desc.height };
  }

  createRenderTarget(width: number, height: number, filter: TextureFilter): RenderTargetHandle {
    const gl = this.gl;
    const color = this.createTexture({ width, height, filter, wrap: 'clamp' });
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.get(color.id)!, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
    const id = this.nextId++;
    this.targets.set(id, { fbo, depth, colorId: color.id });
    return { kind: 'target', id, color, width, height };
  }

  createPipeline(desc: PipelineDesc): PipelineHandle {
    const gl = this.gl;
    const src = desc.shader.glsl;
    if (!src) throw new Error(`pipeline ${desc.label}: no GLSL source`);
    const vs = this.compile(gl.VERTEX_SHADER, src.vertex, desc.label);
    const fs = this.compile(gl.FRAGMENT_SHADER, src.fragment, desc.label);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    desc.layout?.attributes.forEach((a, i) => gl.bindAttribLocation(program, i, a.name));
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`pipeline ${desc.label}: link failed\n${gl.getProgramInfoLog(program) ?? ''}`);
    }
    const id = this.nextId++;
    this.pipelines.set(id, { program, desc, uniforms: new Map() });
    return { kind: 'pipeline', id };
  }

  destroy(h: Handle): void {
    const gl = this.gl;
    switch (h.kind) {
      case 'buffer':
        gl.deleteBuffer(this.buffers.get(h.id) ?? null);
        this.buffers.delete(h.id);
        this.dropVaos((k) => k.includes(`:${h.id}:`) || k.endsWith(`:${h.id}`));
        break;
      case 'texture':
        gl.deleteTexture(this.textures.get(h.id) ?? null);
        this.textures.delete(h.id);
        break;
      case 'target': {
        const t = this.targets.get(h.id);
        if (t) {
          gl.deleteFramebuffer(t.fbo);
          gl.deleteRenderbuffer(t.depth);
          this.destroy(h.color);
        }
        this.targets.delete(h.id);
        break;
      }
      case 'pipeline':
        gl.deleteProgram(this.pipelines.get(h.id)?.program ?? null);
        this.pipelines.delete(h.id);
        this.dropVaos((k) => k.startsWith(`${h.id}:`));
        break;
    }
  }

  beginPass(desc: PassDesc): void {
    const gl = this.gl;
    if (this.currentPass) throw new Error('beginPass while a pass is open');
    this.currentPass = desc;
    const t = desc.target ? this.targets.get(desc.target.id) : undefined;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t?.fbo ?? null);
    const w = desc.target?.width ?? gl.drawingBufferWidth;
    const h = desc.target?.height ?? gl.drawingBufferHeight;
    gl.viewport(0, 0, w, h);
    let mask = 0;
    if (desc.clearColor) {
      gl.clearColor(...desc.clearColor);
      mask |= gl.COLOR_BUFFER_BIT;
    }
    if (desc.clearDepth) {
      gl.depthMask(true);
      gl.clearDepth(1);
      mask |= gl.DEPTH_BUFFER_BIT;
    }
    if (mask) gl.clear(mask);
  }

  draw(call: DrawCall): void {
    const gl = this.gl;
    if (!this.currentPass) throw new Error('draw outside a pass');
    const p = this.pipelines.get(call.pipeline.id);
    if (!p) throw new Error('draw with destroyed pipeline');
    gl.useProgram(p.program);

    if (p.desc.depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(p.desc.depthWrite);
    if (p.desc.cullBack) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);

    gl.bindVertexArray(this.vaoFor(call, p));

    let unit = 0;
    for (const [name, tex] of Object.entries(call.textures ?? {})) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(tex.id) ?? null);
      gl.uniform1i(this.uniformLocation(p, name), unit);
      unit++;
    }
    for (const [name, value] of Object.entries(call.uniforms ?? {})) this.setUniform(p, name, value);

    if (call.indices) gl.drawElements(gl.TRIANGLES, call.count, gl.UNSIGNED_INT, call.first * 4);
    else gl.drawArrays(gl.TRIANGLES, call.first, call.count);
    gl.bindVertexArray(null);
  }

  endPass(): void {
    if (!this.currentPass) throw new Error('endPass without beginPass');
    this.currentPass = null;
  }

  // --- internals ---

  private compile(type: number, source: string, label: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
      throw new Error(`pipeline ${label}: ${kind} shader failed\n${gl.getShaderInfoLog(s) ?? ''}`);
    }
    return s;
  }

  private applySampler(filter: TextureFilter, wrap: 'repeat' | 'clamp'): void {
    const gl = this.gl;
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const w = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  }

  private vaoFor(call: DrawCall, p: GLPipeline): WebGLVertexArrayObject {
    const key = `${call.pipeline.id}:${call.vertices?.id ?? 0}:${call.indices?.id ?? 0}`;
    let vao = this.vaos.get(key);
    if (vao) return vao;
    const gl = this.gl;
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const layout = p.desc.layout;
    if (layout && call.vertices) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.get(call.vertices.id) ?? null);
      layout.attributes.forEach((a, i) => {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, a.components, gl.FLOAT, false, layout.stride, a.offset);
      });
    }
    if (call.indices) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.get(call.indices.id) ?? null);
    gl.bindVertexArray(null);
    this.vaos.set(key, vao);
    return vao;
  }

  private dropVaos(match: (key: string) => boolean): void {
    for (const [k, v] of this.vaos) {
      if (match(k)) {
        this.gl.deleteVertexArray(v);
        this.vaos.delete(k);
      }
    }
  }

  private uniformLocation(p: GLPipeline, name: string): WebGLUniformLocation | null {
    let loc = p.uniforms.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(p.program, name);
      p.uniforms.set(name, loc);
    }
    return loc;
  }

  private setUniform(p: GLPipeline, name: string, v: UniformValue): void {
    const gl = this.gl;
    const loc = this.uniformLocation(p, name);
    if (loc === null) return; // optimized out or unused: not an error
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v instanceof Float32Array) {
      switch (v.length) {
        case 2: gl.uniform2fv(loc, v); break;
        case 3: gl.uniform3fv(loc, v); break;
        case 4: gl.uniform4fv(loc, v); break;
        case 16: gl.uniformMatrix4fv(loc, false, v); break;
        default: throw new Error(`uniform ${name}: unsupported Float32Array length ${v.length}`);
      }
    } else if ('floats' in v) gl.uniform1fv(loc, v.floats);
    else if ('vec4s' in v) gl.uniform4fv(loc, v.vec4s);
    else gl.uniform1i(loc, v.int);
  }
}
