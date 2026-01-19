/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane renderer - renders a visible plane at the section cut location
 */

export interface SectionPlaneRenderOptions {
  axis: 'up' | 'front' | 'side';  // Semantic axis names: up (Y), front (Z), side (X)
  position: number; // 0-100 percentage
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  viewProj: Float32Array;
  flipped?: boolean; // If true, show the opposite side indicator
  isPreview?: boolean; // If true, render as preview (less opacity)
}

export class SectionPlaneRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private format: GPUTextureFormat;
  private sampleCount: number;
  private initialized = false;

  constructor(device: GPUDevice, format: GPUTextureFormat, sampleCount: number = 4) {
    this.device = device;
    this.format = format;
    this.sampleCount = sampleCount;
  }

  private init(): void {
    if (this.initialized) return;

    // Create shader for section plane rendering
    const shaderModule = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          planeColor: vec4<f32>,
        }
        @binding(0) @group(0) var<uniform> uniforms: Uniforms;

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) uv: vec2<f32>,
        }

        @vertex
        fn vs_main(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> VertexOutput {
          var output: VertexOutput;
          output.position = uniforms.viewProj * vec4<f32>(position, 1.0);
          output.uv = uv;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          // Create beautiful grid pattern
          let gridSize = 0.05;           // Grid cell size
          let lineWidth = 0.008;         // Thin lines
          let majorGridSize = 0.25;      // Major grid every 5 cells
          let majorLineWidth = 0.015;    // Thicker major lines

          // Minor grid
          let gridX = abs(fract(input.uv.x / gridSize + 0.5) - 0.5);
          let gridY = abs(fract(input.uv.y / gridSize + 0.5) - 0.5);
          let isMinorGridLine = min(gridX, gridY) < lineWidth;

          // Major grid (every 5 cells)
          let majorX = abs(fract(input.uv.x / majorGridSize + 0.5) - 0.5);
          let majorY = abs(fract(input.uv.y / majorGridSize + 0.5) - 0.5);
          let isMajorGridLine = min(majorX, majorY) < majorLineWidth;

          // Soft edge fade
          let edgeDist = min(input.uv.x, min(input.uv.y, min(1.0 - input.uv.x, 1.0 - input.uv.y)));
          let edgeFade = smoothstep(0.0, 0.12, edgeDist);

          // Strong border glow
          let borderGlow = 1.0 - smoothstep(0.0, 0.06, edgeDist);

          var color = uniforms.planeColor;

          // Layered rendering: base fill + minor grid + major grid + border
          if (isMajorGridLine) {
            // Major grid lines - white with high visibility
            color = vec4<f32>(1.0, 1.0, 1.0, min(color.a * 3.0, 1.0));
          } else if (isMinorGridLine) {
            // Minor grid lines - brighter color
            color = vec4<f32>(color.rgb * 1.8, color.a * 2.0);
          }

          // Add bright border glow
          color = vec4<f32>(
            mix(color.rgb, vec3<f32>(1.0, 1.0, 1.0), borderGlow * 0.6),
            color.a + borderGlow * 0.5
          );

          // Apply edge fade
          color.a *= edgeFade;

          // Clamp alpha
          color.a = min(color.a, 0.85);

          return color;
        }
      `,
    });

    // Create render pipeline with alpha blending and MSAA support
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 20, // 3 position + 2 uv = 5 floats
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, // Don't write to depth buffer (transparent)
        depthCompare: 'always',   // Always draw the plane (visible through geometry)
      },
      multisample: {
        count: this.sampleCount,
      },
    });

    // Create vertex buffer (6 vertices for 2 triangles)
    this.vertexBuffer = this.device.createBuffer({
      size: 6 * 5 * 4, // 6 vertices * 5 floats * 4 bytes
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 80, // mat4x4 (64) + vec4 (16) = 80 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
      ],
    });

    this.initialized = true;
  }

  /**
   * Draw section plane into an existing render pass (preferred - avoids MSAA mismatch)
   */
  draw(
    pass: GPURenderPassEncoder,
    options: SectionPlaneRenderOptions
  ): void {
    this.init();

    if (!this.pipeline || !this.vertexBuffer || !this.uniformBuffer || !this.bindGroup) {
      return;
    }

    const { axis, position, bounds, viewProj, isPreview } = options;

    // Calculate plane vertices based on axis and bounds
    const vertices = this.calculatePlaneVertices(axis, position, bounds);
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    // Update uniforms
    const uniforms = new Float32Array(20);
    uniforms.set(viewProj, 0);

    // Axis-specific colors for better identification
    // up (Y) = light blue, front (Z) = green, side (X) = orange
    if (axis === 'up') {
      uniforms[16] = 0.012; // R - #03A9F4
      uniforms[17] = 0.663; // G
      uniforms[18] = 0.957; // B
    } else if (axis === 'front') {
      uniforms[16] = 0.298; // R - #4CAF50
      uniforms[17] = 0.686; // G
      uniforms[18] = 0.314; // B
    } else {
      uniforms[16] = 1.0;   // R - #FF9800
      uniforms[17] = 0.596; // G
      uniforms[18] = 0.0;   // B
    }
    // Opacity: preview mode (subtle) vs active cutting (prominent)
    uniforms[19] = isPreview ? 0.2 : 0.5;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    // Draw the section plane
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(6); // 2 triangles
  }

  /**
   * @deprecated Use draw() instead to render into an existing pass
   * Legacy method that creates its own render pass (causes MSAA mismatch)
   */
  render(
    encoder: GPUCommandEncoder,
    textureView: GPUTextureView,
    depthView: GPUTextureView,
    options: SectionPlaneRenderOptions
  ): void {
    this.init();

    if (!this.pipeline || !this.vertexBuffer || !this.uniformBuffer || !this.bindGroup) {
      return;
    }

    const { axis, position, bounds, viewProj, isPreview } = options;

    // Calculate plane vertices based on axis and bounds
    const vertices = this.calculatePlaneVertices(axis, position, bounds);
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    // Update uniforms
    const uniforms = new Float32Array(20);
    uniforms.set(viewProj, 0);

    // Axis-specific colors for better identification
    // up (Y) = light blue, front (Z) = green, side (X) = orange
    if (axis === 'up') {
      uniforms[16] = 0.012; // R - #03A9F4
      uniforms[17] = 0.663; // G
      uniforms[18] = 0.957; // B
    } else if (axis === 'front') {
      uniforms[16] = 0.298; // R - #4CAF50
      uniforms[17] = 0.686; // G
      uniforms[18] = 0.314; // B
    } else {
      uniforms[16] = 1.0;   // R - #FF9800
      uniforms[17] = 0.596; // G
      uniforms[18] = 0.0;   // B
    }
    // Opacity: preview mode (subtle) vs active cutting (prominent)
    uniforms[19] = isPreview ? 0.2 : 0.5;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    // Render the section plane in its own pass (legacy - may cause MSAA issues)
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        loadOp: 'load', // Keep existing content
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(6); // 2 triangles
    pass.end();
  }

  private calculatePlaneVertices(
    axis: 'up' | 'front' | 'side',
    position: number,
    bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
  ): Float32Array {
    const { min, max } = bounds;

    // Add some padding to make the plane slightly larger than the model
    const padding = 0.1;
    const sizeX = (max.x - min.x) * (1 + padding);
    const sizeY = (max.y - min.y) * (1 + padding);
    const sizeZ = (max.z - min.z) * (1 + padding);
    const centerX = (min.x + max.x) / 2;
    const centerY = (min.y + max.y) / 2;
    const centerZ = (min.z + max.z) / 2;

    // Calculate the plane position along the axis
    const t = position / 100;

    let vertices: number[] = [];

    if (axis === 'side') {
      // Side = X axis (YZ plane)
      const x = min.x + t * (max.x - min.x);
      const halfY = sizeY / 2;
      const halfZ = sizeZ / 2;
      // Quad facing X axis (vertices in YZ plane)
      vertices = [
        // Triangle 1
        x, centerY - halfY, centerZ - halfZ, 0, 0,
        x, centerY + halfY, centerZ - halfZ, 1, 0,
        x, centerY + halfY, centerZ + halfZ, 1, 1,
        // Triangle 2
        x, centerY - halfY, centerZ - halfZ, 0, 0,
        x, centerY + halfY, centerZ + halfZ, 1, 1,
        x, centerY - halfY, centerZ + halfZ, 0, 1,
      ];
    } else if (axis === 'up') {
      // Up = Y axis (XZ plane) - horizontal cut
      const y = min.y + t * (max.y - min.y);
      const halfX = sizeX / 2;
      const halfZ = sizeZ / 2;
      // Quad facing Y axis (vertices in XZ plane)
      vertices = [
        // Triangle 1
        centerX - halfX, y, centerZ - halfZ, 0, 0,
        centerX + halfX, y, centerZ - halfZ, 1, 0,
        centerX + halfX, y, centerZ + halfZ, 1, 1,
        // Triangle 2
        centerX - halfX, y, centerZ - halfZ, 0, 0,
        centerX + halfX, y, centerZ + halfZ, 1, 1,
        centerX - halfX, y, centerZ + halfZ, 0, 1,
      ];
    } else {
      // Front = Z axis (XY plane)
      const z = min.z + t * (max.z - min.z);
      const halfX = sizeX / 2;
      const halfY = sizeY / 2;
      // Quad facing Z axis (vertices in XY plane)
      vertices = [
        // Triangle 1
        centerX - halfX, centerY - halfY, z, 0, 0,
        centerX + halfX, centerY - halfY, z, 1, 0,
        centerX + halfX, centerY + halfY, z, 1, 1,
        // Triangle 2
        centerX - halfX, centerY - halfY, z, 0, 0,
        centerX + halfX, centerY + halfY, z, 1, 1,
        centerX - halfX, centerY + halfY, z, 0, 1,
      ];
    }

    return new Float32Array(vertices);
  }
}
