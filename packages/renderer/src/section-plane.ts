/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section plane renderer - renders a visible plane at the section cut location
 * Supports both axis-aligned planes and arbitrary face-picked planes with arrow gizmos
 */

export interface SectionPlaneRenderOptions {
  axis: 'down' | 'front' | 'side';  // Semantic axis names: down (Y), front (Z), side (X)
  position: number; // 0-100 percentage
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  viewProj: Float32Array;
  flipped?: boolean; // If true, show the opposite side indicator
  isPreview?: boolean; // If true, render as preview (less opacity)
  min?: number;      // Optional override for min range value
  max?: number;      // Optional override for max range value
}

export interface FacePlaneRenderOptions {
  normal: { x: number; y: number; z: number };
  point: { x: number; y: number; z: number };
  distance: number;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  viewProj: Float32Array;
  isConfirmed: boolean; // Whether the cut is confirmed (changes color + shows arrow)
}

export class SectionPlaneRenderer {
  private device: GPUDevice;
  private bindGroupLayout: GPUBindGroupLayout | null = null;  // Shared layout for both pipelines
  private previewPipeline: GPURenderPipeline | null = null;   // With depth test (respects geometry)
  private cutPipeline: GPURenderPipeline | null = null;       // No depth test (always visible)
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private format: GPUTextureFormat;
  private sampleCount: number;
  private initialized = false;

  // Face plane: larger vertex buffer for arrow gizmo
  private faceVertexBuffer: GPUBuffer | null = null;

  constructor(device: GPUDevice, format: GPUTextureFormat, sampleCount: number = 4) {
    this.device = device;
    this.format = format;
    this.sampleCount = sampleCount;
  }

  private init(): void {
    if (this.initialized) return;

    // Create explicit bind group layout (shared between both pipelines)
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create pipeline layout using the shared bind group layout
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

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
          // Create fine grid pattern
          let gridSize = 0.01;           // Fine grid cells (100 divisions)
          let lineWidth = 0.001;         // Very thin lines
          let majorGridSize = 0.1;       // Major grid every 10 cells
          let majorLineWidth = 0.002;    // Slightly thicker major lines

          // Minor grid
          let gridX = abs(fract(input.uv.x / gridSize + 0.5) - 0.5);
          let gridY = abs(fract(input.uv.y / gridSize + 0.5) - 0.5);
          let isMinorGridLine = min(gridX, gridY) < lineWidth;

          // Major grid (every 10 cells)
          let majorX = abs(fract(input.uv.x / majorGridSize + 0.5) - 0.5);
          let majorY = abs(fract(input.uv.y / majorGridSize + 0.5) - 0.5);
          let isMajorGridLine = min(majorX, majorY) < majorLineWidth;

          // Soft edge fade
          let edgeDist = min(input.uv.x, min(input.uv.y, min(1.0 - input.uv.x, 1.0 - input.uv.y)));
          let edgeFade = smoothstep(0.0, 0.08, edgeDist);

          // Subtle border
          let borderGlow = 1.0 - smoothstep(0.0, 0.03, edgeDist);

          var color = uniforms.planeColor;

          // Layered rendering: base fill + minor grid + major grid + border
          if (isMajorGridLine) {
            // Major grid lines - subtle white
            color = vec4<f32>(1.0, 1.0, 1.0, color.a * 1.5);
          } else if (isMinorGridLine) {
            // Minor grid lines - slightly brighter
            color = vec4<f32>(color.rgb * 1.3, color.a * 1.2);
          }

          // Add subtle border
          color = vec4<f32>(
            mix(color.rgb, vec3<f32>(1.0, 1.0, 1.0), borderGlow * 0.3),
            color.a + borderGlow * 0.2
          );

          // Apply edge fade
          color.a *= edgeFade;

          // Clamp alpha
          color.a = min(color.a, 0.5);

          return color;
        }
      `,
    });

    // Shared pipeline config (now using explicit layout)
    const pipelineBase = {
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 20, // 3 position + 2 uv = 5 floats
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' as const },
              { shaderLocation: 1, offset: 12, format: 'float32x2' as const },
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
        }],
      },
      primitive: {
        topology: 'triangle-list' as const,
        cullMode: 'none' as const,
      },
      multisample: {
        count: this.sampleCount,
      },
    };

    // Preview pipeline: only draw where there's NO geometry (behind/around building)
    this.previewPipeline = this.device.createRenderPipeline({
      ...pipelineBase,
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'greater',  // Only draw where plane is behind geometry (empty space)
      },
    });

    // Cut pipeline: always visible (shows where the cut is)
    this.cutPipeline = this.device.createRenderPipeline({
      ...pipelineBase,
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',  // Always draw on top
      },
    });

    // Create vertex buffer (6 vertices for 2 triangles)
    this.vertexBuffer = this.device.createBuffer({
      size: 6 * 5 * 4, // 6 vertices * 5 floats * 4 bytes
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Face vertex buffer: larger to accommodate plane + arrow gizmo (up to 60 vertices)
    this.faceVertexBuffer = this.device.createBuffer({
      size: 60 * 5 * 4, // 60 vertices * 5 floats * 4 bytes
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 80, // mat4x4 (64) + vec4 (16) = 80 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group using explicit layout (compatible with both pipelines)
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
      ],
    });

    this.initialized = true;
  }

  /**
   * Draw axis-aligned section plane into an existing render pass
   */
  draw(
    pass: GPURenderPassEncoder,
    options: SectionPlaneRenderOptions
  ): void {
    this.init();

    if (!this.previewPipeline || !this.cutPipeline || !this.vertexBuffer || !this.uniformBuffer || !this.bindGroup) {
      return;
    }

    const { axis, position, bounds, viewProj, isPreview, min: minOverride, max: maxOverride } = options;

    // Only draw section plane in preview mode - hide it during active cutting
    if (!isPreview) {
      return;
    }

    // Calculate plane vertices based on axis and bounds
    const vertices = this.calculatePlaneVertices(axis, position, bounds, 0, minOverride, maxOverride);
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    // Update uniforms
    const uniforms = new Float32Array(20);
    uniforms.set(viewProj, 0);

    // Axis-specific colors for better identification
    // down (Y) = light blue, front (Z) = green, side (X) = orange
    if (axis === 'down') {
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
    // Preview mode opacity
    uniforms[19] = 0.25;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    // Draw section plane with preview pipeline (respects depth)
    pass.setPipeline(this.previewPipeline!);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(6); // 2 triangles
  }

  /**
   * Draw face-picked section plane with optional arrow gizmo
   */
  drawFacePlane(
    pass: GPURenderPassEncoder,
    options: FacePlaneRenderOptions
  ): void {
    this.init();

    if (!this.previewPipeline || !this.cutPipeline || !this.faceVertexBuffer || !this.uniformBuffer || !this.bindGroup) {
      return;
    }

    const { normal, point, bounds, viewProj, isConfirmed } = options;

    // Compute tangent frame from normal
    const tangent = this.computeTangent(normal);
    const bitangent = this.cross(normal, tangent);

    // Calculate plane size relative to model bounds
    const bx = bounds.max.x - bounds.min.x;
    const by = bounds.max.y - bounds.min.y;
    const bz = bounds.max.z - bounds.min.z;
    const modelSize = Math.sqrt(bx * bx + by * by + bz * bz);

    // Hover preview: small plane; Confirmed: larger plane
    const planeSize = isConfirmed ? modelSize * 0.5 : modelSize * 0.15;
    const halfSize = planeSize / 2;

    // Build plane quad vertices (6 vertices = 2 triangles)
    const planeVertices = this.buildOrientedQuad(point, tangent, bitangent, halfSize);

    // Write plane vertices
    this.device.queue.writeBuffer(this.faceVertexBuffer, 0, planeVertices);

    // Update uniforms with face section color
    const uniforms = new Float32Array(20);
    uniforms.set(viewProj, 0);

    if (isConfirmed) {
      // Confirmed: magenta/pink color (distinct from axis-aligned colors)
      uniforms[16] = 0.914; // R - #E91E63
      uniforms[17] = 0.118; // G
      uniforms[18] = 0.388; // B
      uniforms[19] = 0.3;   // Higher opacity for confirmed
    } else {
      // Hover preview: cyan/teal color
      uniforms[16] = 0.0;   // R - #00BCD4
      uniforms[17] = 0.737; // G
      uniforms[18] = 0.831; // B
      uniforms[19] = 0.2;   // Low opacity for preview
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    // Draw plane quad with preview pipeline
    pass.setPipeline(this.previewPipeline!);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.faceVertexBuffer);
    pass.draw(6); // Plane quad

    // Draw arrow gizmo for confirmed face sections
    if (isConfirmed) {
      const arrowLength = modelSize * 0.08;
      const arrowRadius = modelSize * 0.012;
      const headLength = arrowLength * 0.35;
      const headRadius = arrowRadius * 2.5;

      const arrowVertices = this.buildArrowGizmo(
        point,
        normal,
        tangent,
        bitangent,
        arrowLength,
        arrowRadius,
        headLength,
        headRadius
      );

      this.device.queue.writeBuffer(this.faceVertexBuffer, 0, arrowVertices);

      // Arrow color: same magenta but more opaque
      uniforms[16] = 0.914; // R
      uniforms[17] = 0.118; // G
      uniforms[18] = 0.388; // B
      uniforms[19] = 0.45;  // Semi-transparent
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

      // Draw arrow with cut pipeline (always visible, on top)
      pass.setPipeline(this.cutPipeline!);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.faceVertexBuffer);
      pass.draw(arrowVertices.length / 5); // Dynamic vertex count
    }
  }

  /**
   * Compute a tangent vector perpendicular to the given normal
   */
  private computeTangent(normal: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    // Choose a reference vector that's not parallel to the normal
    const ref = Math.abs(normal.y) < 0.9
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };

    const tangent = this.cross(normal, ref);
    return this.normalize(tangent);
  }

  /**
   * Build an oriented quad (2 triangles = 6 vertices) at the given point
   */
  private buildOrientedQuad(
    center: { x: number; y: number; z: number },
    tangent: { x: number; y: number; z: number },
    bitangent: { x: number; y: number; z: number },
    halfSize: number
  ): Float32Array {
    // 4 corners of the quad
    const c00 = {
      x: center.x - tangent.x * halfSize - bitangent.x * halfSize,
      y: center.y - tangent.y * halfSize - bitangent.y * halfSize,
      z: center.z - tangent.z * halfSize - bitangent.z * halfSize,
    };
    const c10 = {
      x: center.x + tangent.x * halfSize - bitangent.x * halfSize,
      y: center.y + tangent.y * halfSize - bitangent.y * halfSize,
      z: center.z + tangent.z * halfSize - bitangent.z * halfSize,
    };
    const c11 = {
      x: center.x + tangent.x * halfSize + bitangent.x * halfSize,
      y: center.y + tangent.y * halfSize + bitangent.y * halfSize,
      z: center.z + tangent.z * halfSize + bitangent.z * halfSize,
    };
    const c01 = {
      x: center.x - tangent.x * halfSize + bitangent.x * halfSize,
      y: center.y - tangent.y * halfSize + bitangent.y * halfSize,
      z: center.z - tangent.z * halfSize + bitangent.z * halfSize,
    };

    return new Float32Array([
      // Triangle 1
      c00.x, c00.y, c00.z, 0, 0,
      c10.x, c10.y, c10.z, 1, 0,
      c11.x, c11.y, c11.z, 1, 1,
      // Triangle 2
      c00.x, c00.y, c00.z, 0, 0,
      c11.x, c11.y, c11.z, 1, 1,
      c01.x, c01.y, c01.z, 0, 1,
    ]);
  }

  /**
   * Build a 3D arrow gizmo (shaft + cone head) pointing along the normal
   * Uses cross-shaped shaft for visibility from all angles
   */
  private buildArrowGizmo(
    origin: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number },
    tangent: { x: number; y: number; z: number },
    bitangent: { x: number; y: number; z: number },
    shaftLength: number,
    shaftRadius: number,
    headLength: number,
    headRadius: number
  ): Float32Array {
    const verts: number[] = [];

    // Shaft tip (where the cone base starts)
    const shaftEnd = {
      x: origin.x + normal.x * shaftLength,
      y: origin.y + normal.y * shaftLength,
      z: origin.z + normal.z * shaftLength,
    };

    // Arrow tip
    const tip = {
      x: origin.x + normal.x * (shaftLength + headLength),
      y: origin.y + normal.y * (shaftLength + headLength),
      z: origin.z + normal.z * (shaftLength + headLength),
    };

    // Shaft: cross shape (2 quads perpendicular to each other)
    // Quad 1: along tangent direction
    const addShaftQuad = (dir: { x: number; y: number; z: number }) => {
      const p0 = {
        x: origin.x - dir.x * shaftRadius,
        y: origin.y - dir.y * shaftRadius,
        z: origin.z - dir.z * shaftRadius,
      };
      const p1 = {
        x: origin.x + dir.x * shaftRadius,
        y: origin.y + dir.y * shaftRadius,
        z: origin.z + dir.z * shaftRadius,
      };
      const p2 = {
        x: shaftEnd.x + dir.x * shaftRadius,
        y: shaftEnd.y + dir.y * shaftRadius,
        z: shaftEnd.z + dir.z * shaftRadius,
      };
      const p3 = {
        x: shaftEnd.x - dir.x * shaftRadius,
        y: shaftEnd.y - dir.y * shaftRadius,
        z: shaftEnd.z - dir.z * shaftRadius,
      };
      // UV at 0.5 for solid fill (center of grid cell)
      verts.push(
        p0.x, p0.y, p0.z, 0.5, 0.5,
        p1.x, p1.y, p1.z, 0.5, 0.5,
        p2.x, p2.y, p2.z, 0.5, 0.5,
        p0.x, p0.y, p0.z, 0.5, 0.5,
        p2.x, p2.y, p2.z, 0.5, 0.5,
        p3.x, p3.y, p3.z, 0.5, 0.5,
      );
    };

    addShaftQuad(tangent);
    addShaftQuad(bitangent);

    // Cone head: 8 triangles forming a cone
    const segments = 8;
    for (let i = 0; i < segments; i++) {
      const angle0 = (i / segments) * Math.PI * 2;
      const angle1 = ((i + 1) / segments) * Math.PI * 2;

      const cos0 = Math.cos(angle0);
      const sin0 = Math.sin(angle0);
      const cos1 = Math.cos(angle1);
      const sin1 = Math.sin(angle1);

      // Base points of cone
      const base0 = {
        x: shaftEnd.x + (tangent.x * cos0 + bitangent.x * sin0) * headRadius,
        y: shaftEnd.y + (tangent.y * cos0 + bitangent.y * sin0) * headRadius,
        z: shaftEnd.z + (tangent.z * cos0 + bitangent.z * sin0) * headRadius,
      };
      const base1 = {
        x: shaftEnd.x + (tangent.x * cos1 + bitangent.x * sin1) * headRadius,
        y: shaftEnd.y + (tangent.y * cos1 + bitangent.y * sin1) * headRadius,
        z: shaftEnd.z + (tangent.z * cos1 + bitangent.z * sin1) * headRadius,
      };

      // Cone side triangle (tip -> base0 -> base1)
      verts.push(
        tip.x, tip.y, tip.z, 0.5, 0.5,
        base0.x, base0.y, base0.z, 0.5, 0.5,
        base1.x, base1.y, base1.z, 0.5, 0.5,
      );

      // Cone bottom cap triangle (center -> base1 -> base0)
      verts.push(
        shaftEnd.x, shaftEnd.y, shaftEnd.z, 0.5, 0.5,
        base1.x, base1.y, base1.z, 0.5, 0.5,
        base0.x, base0.y, base0.z, 0.5, 0.5,
      );
    }

    return new Float32Array(verts);
  }

  private calculatePlaneVertices(
    axis: 'down' | 'front' | 'side',
    position: number,
    bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
    inset: number = 0,  // 0 = full size, 0.15 = 15% smaller on each side
    minOverride?: number,
    maxOverride?: number
  ): Float32Array {
    const { min, max } = bounds;

    // Calculate base size with 10% padding for preview
    const basePadding = 0.1;
    const effectiveScale = (1 + basePadding) * (1 - inset * 2);
    const sizeX = (max.x - min.x) * effectiveScale;
    const sizeY = (max.y - min.y) * effectiveScale;
    const sizeZ = (max.z - min.z) * effectiveScale;
    const centerX = (min.x + max.x) / 2;
    const centerY = (min.y + max.y) / 2;
    const centerZ = (min.z + max.z) / 2;

    // Calculate the plane position along the axis
    const t = position / 100;
    const axisIdx = axis === 'side' ? 'x' : axis === 'down' ? 'y' : 'z';
    const axisMin = minOverride ?? min[axisIdx];
    const axisMax = maxOverride ?? max[axisIdx];

    let vertices: number[] = [];

    if (axis === 'side') {
      // Side = X axis (YZ plane)
      const x = axisMin + t * (axisMax - axisMin);
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
    } else if (axis === 'down') {
      // Down = Y axis (XZ plane) - horizontal cut
      const y = axisMin + t * (axisMax - axisMin);
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
      const z = axisMin + t * (axisMax - axisMin);
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

  // Vector math helpers
  private cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  private normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len < 0.0001) return { x: 0, y: 0, z: 1 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }
}
