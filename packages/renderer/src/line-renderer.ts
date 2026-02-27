/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Line renderer — draws colored 3D line segments in the scene.
 *
 * Used by scripts to visualize paths, connections, and other spatial data.
 * Lines are rendered after all geometry using reverse-Z depth testing so
 * they appear on top of existing meshes (like selection highlighting).
 */

/** A single colored line segment in world space. */
export interface LineSegment {
  start: [number, number, number];
  end: [number, number, number];
  color: [number, number, number, number]; // RGBA 0-1
}

export class LineRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private format: GPUTextureFormat;
  private sampleCount: number;
  private initialized = false;
  private vertexCount = 0;
  private maxVertices = 0;

  constructor(device: GPUDevice, format: GPUTextureFormat, sampleCount: number = 4) {
    this.device = device;
    this.format = format;
    this.sampleCount = sampleCount;
  }

  private init(): void {
    if (this.initialized) return;

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    const shaderModule = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
        }
        @binding(0) @group(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) color: vec4<f32>,
        }

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) color: vec4<f32>,
        }

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.position = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          return input.color;
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 28, // 3 floats position + 4 floats color = 7 * 4
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' as const },
              { shaderLocation: 1, offset: 12, format: 'float32x4' as const },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: 'src-alpha' as const,
                dstFactor: 'one-minus-src-alpha' as const,
                operation: 'add' as const,
              },
              alpha: {
                srcFactor: 'one' as const,
                dstFactor: 'one-minus-src-alpha' as const,
                operation: 'add' as const,
              },
            },
          },
          // Second target for object-ID texture (write zeros — lines aren't pickable)
          {
            format: 'rgba8unorm' as const,
            writeMask: 0,
          },
        ],
      },
      primitive: {
        topology: 'line-list' as const,
        cullMode: 'none' as const,
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'greater-equal' as const, // Reverse-Z, draw on top like selection
      },
      multisample: {
        count: this.sampleCount,
      },
    });

    // Uniform buffer: just viewProj (64 bytes)
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
      ],
    });

    this.initialized = true;
  }

  /**
   * Upload line segments to GPU vertex buffer.
   * Call this when the set of lines changes.
   */
  setLines(lines: LineSegment[]): void {
    this.init();
    if (!this.device) return;

    this.vertexCount = lines.length * 2; // 2 vertices per line segment
    if (this.vertexCount === 0) {
      // Destroy old buffer if no lines
      if (this.vertexBuffer) {
        this.vertexBuffer.destroy();
        this.vertexBuffer = null;
      }
      this.maxVertices = 0;
      return;
    }

    // 7 floats per vertex: x,y,z, r,g,b,a
    const data = new Float32Array(this.vertexCount * 7);
    let offset = 0;

    for (const line of lines) {
      // Start vertex
      data[offset++] = line.start[0];
      data[offset++] = line.start[1];
      data[offset++] = line.start[2];
      data[offset++] = line.color[0];
      data[offset++] = line.color[1];
      data[offset++] = line.color[2];
      data[offset++] = line.color[3];

      // End vertex
      data[offset++] = line.end[0];
      data[offset++] = line.end[1];
      data[offset++] = line.end[2];
      data[offset++] = line.color[0];
      data[offset++] = line.color[1];
      data[offset++] = line.color[2];
      data[offset++] = line.color[3];
    }

    // Recreate buffer if size changed
    if (!this.vertexBuffer || this.vertexCount > this.maxVertices) {
      if (this.vertexBuffer) this.vertexBuffer.destroy();
      this.maxVertices = this.vertexCount;
      this.vertexBuffer = this.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    this.device.queue.writeBuffer(this.vertexBuffer, 0, data);
  }

  /** Clear all lines. */
  clearLines(): void {
    this.vertexCount = 0;
    if (this.vertexBuffer) {
      this.vertexBuffer.destroy();
      this.vertexBuffer = null;
      this.maxVertices = 0;
    }
  }

  /**
   * Draw lines into an existing render pass.
   * Must be called with a valid viewProj matrix.
   */
  draw(pass: GPURenderPassEncoder, viewProj: Float32Array): void {
    if (this.vertexCount === 0 || !this.vertexBuffer) return;
    this.init();
    if (!this.pipeline || !this.uniformBuffer || !this.bindGroup) return;

    // Update viewProj uniform
    this.device.queue.writeBuffer(this.uniformBuffer, 0, viewProj);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount);
  }

  /** Whether there are lines to render. */
  hasLines(): boolean {
    return this.vertexCount > 0;
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.vertexBuffer = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.pipeline = null;
    this.initialized = false;
  }
}
