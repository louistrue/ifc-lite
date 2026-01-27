/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * GPU-based Hierarchical-Z (Hi-Z) Occlusion Culling
 *
 * This provides high-performance occlusion culling using GPU compute shaders:
 * 1. Depth prepass: Render occluders (walls, slabs) to depth buffer
 * 2. Depth pyramid generation: Creates a mipmap chain of the depth buffer
 * 3. AABB occlusion testing: Tests element AABBs against the depth pyramid
 *
 * The Hi-Z technique works by:
 * - Rendering a depth prepass (large occluders like walls/floors)
 * - Building a hierarchical depth pyramid (each level = min of 2x2 from previous)
 * - Testing AABBs against appropriate mip level based on screen-space size
 * - Using GPU compute for parallel AABB testing
 *
 * This is much more accurate than simple back-side culling and can
 * dramatically reduce rendered geometry in interior views.
 */

/**
 * Element AABB data for GPU occlusion testing
 */
export interface OcclusionAABB {
  expressId: number;
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Result from occlusion query
 */
export interface OcclusionResult {
  visibleIds: Set<number>;
  totalTested: number;
  visibleCount: number;
  occludedCount: number;
  queryTimeMs: number;
}

/**
 * GPU Hi-Z Occlusion Culler
 */
export class HiZOcclusionCuller {
  private device: GPUDevice;

  // Depth prepass resources
  private depthPrepassTexture: GPUTexture | null = null;
  private depthPrepassView: GPUTextureView | null = null;
  private depthPrepassPipeline: GPURenderPipeline | null = null;
  private depthPrepassBindGroupLayout: GPUBindGroupLayout | null = null;
  private depthPrepassUniformBuffer: GPUBuffer | null = null;

  // Depth pyramid resources
  private depthPyramid: GPUTexture | null = null;
  private depthPyramidViews: GPUTextureView[] = [];
  private pyramidLevels: number = 0;
  private pyramidWidth: number = 0;
  private pyramidHeight: number = 0;

  // Copy depth shader (converts depth24plus to r32float)
  private copyDepthPipeline: GPUComputePipeline | null = null;
  private copyDepthBindGroupLayout: GPUBindGroupLayout | null = null;

  // Compute pipelines
  private depthReducePipeline: GPUComputePipeline | null = null;
  private occlusionTestPipeline: GPUComputePipeline | null = null;

  // Bind group layouts
  private depthReduceBindGroupLayout: GPUBindGroupLayout | null = null;
  private occlusionTestBindGroupLayout: GPUBindGroupLayout | null = null;

  // AABB buffer for batch testing
  private aabbBuffer: GPUBuffer | null = null;
  private resultBuffer: GPUBuffer | null = null;
  private readbackBuffer: GPUBuffer | null = null;
  private maxAABBs: number = 0;

  // Uniform buffers
  private pyramidUniformBuffer: GPUBuffer | null = null;
  private occlusionUniformBuffer: GPUBuffer | null = null;

  // Sampler for depth pyramid reads
  private depthSampler: GPUSampler | null = null;

  // Element data
  private elements: Map<number, OcclusionAABB> = new Map();
  private elementArray: OcclusionAABB[] = [];

  // Performance tracking
  private lastQueryTimeMs: number = 0;

  // Canvas dimensions
  private canvasWidth: number = 0;
  private canvasHeight: number = 0;

  constructor(device: GPUDevice) {
    this.device = device;
    this.initPipelines();
    this.initSampler();
  }

  /**
   * Initialize compute pipelines
   */
  private initPipelines(): void {
    // Depth prepass shader (minimal - just outputs depth)
    const depthPrepassShader = this.device.createShaderModule({
      label: 'Hi-Z Depth Prepass',
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
        }
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) normal: vec3<f32>,
        }

        @vertex
        fn vs_main(input: VertexInput) -> @builtin(position) vec4<f32> {
          return uniforms.viewProj * vec4<f32>(input.position, 1.0);
        }

        @fragment
        fn fs_main() {
          // No output needed - we only care about depth
        }
      `,
    });

    // Create depth prepass bind group layout
    this.depthPrepassBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Hi-Z Depth Prepass Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create depth prepass uniform buffer
    this.depthPrepassUniformBuffer = this.device.createBuffer({
      label: 'Hi-Z Depth Prepass Uniforms',
      size: 64, // mat4x4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create depth prepass pipeline
    this.depthPrepassPipeline = this.device.createRenderPipeline({
      label: 'Hi-Z Depth Prepass Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.depthPrepassBindGroupLayout],
      }),
      vertex: {
        module: depthPrepassShader,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 24, // 6 floats (position + normal)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'greater', // Reverse-Z
      },
    });

    // Depth reduction (Hi-Z pyramid generation) shader
    const depthReduceShader = this.device.createShaderModule({
      label: 'Hi-Z Depth Reduce',
      code: `
        // Uniforms for depth reduction
        struct DepthReduceUniforms {
          srcMipLevel: u32,
          dstWidth: u32,
          dstHeight: u32,
          _padding: u32,
        }

        @group(0) @binding(0) var srcDepth: texture_2d<f32>;
        @group(0) @binding(1) var dstDepth: texture_storage_2d<r32float, write>;
        @group(0) @binding(2) var<uniform> uniforms: DepthReduceUniforms;

        // Reduce 2x2 block to single depth value
        // Using MIN for reverse-Z (0 = far, 1 = near)
        // We want the FARTHEST depth (smallest value in reverse-Z) to be conservative
        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
          let dstCoord = vec2<i32>(gid.xy);

          // Skip if outside destination bounds
          if (u32(dstCoord.x) >= uniforms.dstWidth || u32(dstCoord.y) >= uniforms.dstHeight) {
            return;
          }

          // Source coordinates (2x2 block)
          let srcCoord = dstCoord * 2;

          // Sample 2x2 block from source
          // For reverse-Z, we want MIN (farthest depth) for conservative occlusion
          let d00 = textureLoad(srcDepth, srcCoord + vec2<i32>(0, 0), i32(uniforms.srcMipLevel)).r;
          let d10 = textureLoad(srcDepth, srcCoord + vec2<i32>(1, 0), i32(uniforms.srcMipLevel)).r;
          let d01 = textureLoad(srcDepth, srcCoord + vec2<i32>(0, 1), i32(uniforms.srcMipLevel)).r;
          let d11 = textureLoad(srcDepth, srcCoord + vec2<i32>(1, 1), i32(uniforms.srcMipLevel)).r;

          // Take MIN for reverse-Z (most conservative depth)
          let minDepth = min(min(d00, d10), min(d01, d11));

          textureStore(dstDepth, dstCoord, vec4<f32>(minDepth, 0.0, 0.0, 1.0));
        }
      `,
    });

    // Create bind group layout for depth reduction
    this.depthReduceBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Hi-Z Depth Reduce Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create depth reduce pipeline
    this.depthReducePipeline = this.device.createComputePipeline({
      label: 'Hi-Z Depth Reduce Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.depthReduceBindGroupLayout],
      }),
      compute: {
        module: depthReduceShader,
        entryPoint: 'main',
      },
    });

    // Occlusion test shader
    const occlusionTestShader = this.device.createShaderModule({
      label: 'Hi-Z Occlusion Test',
      code: `
        // Uniforms for occlusion testing
        struct OcclusionUniforms {
          viewProj: mat4x4<f32>,
          pyramidWidth: f32,
          pyramidHeight: f32,
          pyramidLevels: f32,
          aabbCount: u32,
        }

        // AABB data (6 floats per AABB + expressId as u32)
        struct AABB {
          minX: f32,
          minY: f32,
          minZ: f32,
          maxX: f32,
          maxY: f32,
          maxZ: f32,
          expressId: u32,
          _padding: u32,
        }

        @group(0) @binding(0) var<uniform> uniforms: OcclusionUniforms;
        @group(0) @binding(1) var depthPyramid: texture_2d<f32>;
        @group(0) @binding(2) var depthSampler: sampler;
        @group(0) @binding(3) var<storage, read> aabbs: array<AABB>;
        @group(0) @binding(4) var<storage, read_write> results: array<u32>;

        // Project point to clip space
        fn projectPoint(p: vec3<f32>) -> vec4<f32> {
          return uniforms.viewProj * vec4<f32>(p, 1.0);
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
          let idx = gid.x;
          if (idx >= uniforms.aabbCount) {
            return;
          }

          let aabb = aabbs[idx];

          // 8 corners of AABB
          let corners = array<vec3<f32>, 8>(
            vec3<f32>(aabb.minX, aabb.minY, aabb.minZ),
            vec3<f32>(aabb.maxX, aabb.minY, aabb.minZ),
            vec3<f32>(aabb.minX, aabb.maxY, aabb.minZ),
            vec3<f32>(aabb.maxX, aabb.maxY, aabb.minZ),
            vec3<f32>(aabb.minX, aabb.minY, aabb.maxZ),
            vec3<f32>(aabb.maxX, aabb.minY, aabb.maxZ),
            vec3<f32>(aabb.minX, aabb.maxY, aabb.maxZ),
            vec3<f32>(aabb.maxX, aabb.maxY, aabb.maxZ),
          );

          var minScreen = vec2<f32>(1.0, 1.0);
          var maxScreen = vec2<f32>(0.0, 0.0);
          var closestDepth = 0.0;  // Reverse-Z: 0 = far, 1 = near
          var allBehind = true;
          var anyInFront = false;

          for (var i = 0u; i < 8u; i++) {
            let clip = projectPoint(corners[i]);

            // Skip if behind near plane
            if (clip.w <= 0.001) {
              continue;
            }

            allBehind = false;

            // Perspective divide
            let ndc = clip.xyz / clip.w;

            // Check if in front of far plane
            if (ndc.z > 0.0) {
              anyInFront = true;
            }

            // Convert to screen space [0, 1]
            let screen = (ndc.xy * vec2<f32>(1.0, -1.0) + 1.0) * 0.5;

            minScreen = min(minScreen, screen);
            maxScreen = max(maxScreen, screen);

            // Track closest depth (highest value in reverse-Z)
            closestDepth = max(closestDepth, ndc.z);
          }

          // If all corners behind camera, mark as not visible
          if (allBehind) {
            results[idx] = 0u;
            return;
          }

          // If AABB spans camera, mark as visible (conservative)
          if (!anyInFront) {
            results[idx] = 1u;
            return;
          }

          // Clamp to screen bounds
          minScreen = clamp(minScreen, vec2<f32>(0.0), vec2<f32>(1.0));
          maxScreen = clamp(maxScreen, vec2<f32>(0.0), vec2<f32>(1.0));

          // Check for zero-size AABB on screen
          if (minScreen.x >= maxScreen.x || minScreen.y >= maxScreen.y) {
            results[idx] = 0u;  // Too small to see
            return;
          }

          // Calculate appropriate mip level based on screen-space size
          let screenWidth = (maxScreen.x - minScreen.x) * uniforms.pyramidWidth;
          let screenHeight = (maxScreen.y - minScreen.y) * uniforms.pyramidHeight;
          let maxDim = max(screenWidth, screenHeight);
          let mipLevel = clamp(log2(max(maxDim, 1.0)), 0.0, uniforms.pyramidLevels - 1.0);
          let mipLevelInt = u32(floor(mipLevel));

          // Sample depth pyramid at AABB corners
          let d00 = textureSampleLevel(depthPyramid, depthSampler, minScreen, f32(mipLevelInt)).r;
          let d10 = textureSampleLevel(depthPyramid, depthSampler, vec2<f32>(maxScreen.x, minScreen.y), f32(mipLevelInt)).r;
          let d01 = textureSampleLevel(depthPyramid, depthSampler, vec2<f32>(minScreen.x, maxScreen.y), f32(mipLevelInt)).r;
          let d11 = textureSampleLevel(depthPyramid, depthSampler, maxScreen, f32(mipLevelInt)).r;

          // Take MIN (farthest) depth from pyramid samples for conservative test
          let pyramidDepth = min(min(d00, d10), min(d01, d11));

          // Occlusion test: if AABB's closest depth is farther than pyramid depth, it's occluded
          // In reverse-Z: higher values = closer, lower values = farther
          // closestDepth < pyramidDepth means the AABB is behind the occluder
          if (closestDepth < pyramidDepth - 0.0001) {
            results[idx] = 0u;  // Occluded
          } else {
            results[idx] = 1u;  // Visible
          }
        }
      `,
    });

    // Create bind group layout for occlusion testing
    this.occlusionTestBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Hi-Z Occlusion Test Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: 'non-filtering' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    // Create occlusion test pipeline
    this.occlusionTestPipeline = this.device.createComputePipeline({
      label: 'Hi-Z Occlusion Test Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.occlusionTestBindGroupLayout],
      }),
      compute: {
        module: occlusionTestShader,
        entryPoint: 'main',
      },
    });

    // Create uniform buffers
    this.pyramidUniformBuffer = this.device.createBuffer({
      label: 'Hi-Z Pyramid Uniforms',
      size: 16, // 4 u32s
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.occlusionUniformBuffer = this.device.createBuffer({
      label: 'Hi-Z Occlusion Uniforms',
      size: 80, // mat4x4 (64) + 4 floats (16)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Initialize sampler for depth pyramid reads
   */
  private initSampler(): void {
    this.depthSampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Resize the depth pyramid and prepass textures (call when viewport changes)
   */
  resizePyramid(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;

    // Calculate power-of-2 dimensions for pyramid
    this.pyramidWidth = Math.pow(2, Math.ceil(Math.log2(width)));
    this.pyramidHeight = Math.pow(2, Math.ceil(Math.log2(height)));
    this.pyramidLevels = Math.floor(Math.log2(Math.max(this.pyramidWidth, this.pyramidHeight))) + 1;

    // Destroy old textures
    this.depthPrepassTexture?.destroy();
    this.depthPyramid?.destroy();

    // Create depth prepass texture (depth32float for sampling)
    this.depthPrepassTexture = this.device.createTexture({
      label: 'Hi-Z Depth Prepass Texture',
      size: { width: this.pyramidWidth, height: this.pyramidHeight },
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthPrepassView = this.depthPrepassTexture.createView();

    // Create pyramid texture with mipmap chain
    this.depthPyramid = this.device.createTexture({
      label: 'Hi-Z Depth Pyramid',
      size: { width: this.pyramidWidth, height: this.pyramidHeight },
      mipLevelCount: this.pyramidLevels,
      format: 'r32float',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST,
    });

    // Create views for each mip level
    this.depthPyramidViews = [];
    for (let i = 0; i < this.pyramidLevels; i++) {
      this.depthPyramidViews.push(
        this.depthPyramid.createView({
          baseMipLevel: i,
          mipLevelCount: 1,
        })
      );
    }

    console.log(
      `[Hi-Z] Resized pyramid to ${this.pyramidWidth}x${this.pyramidHeight} with ${this.pyramidLevels} levels`
    );
  }

  /**
   * Add elements for occlusion testing
   */
  setElements(elements: OcclusionAABB[]): void {
    this.elements.clear();
    this.elementArray = [];
    for (const el of elements) {
      this.elements.set(el.expressId, el);
      this.elementArray.push(el);
    }

    // Reallocate GPU buffers if needed
    this.reallocateBuffers(elements.length);

    // Upload AABB data to GPU
    this.uploadAABBData();
  }

  /**
   * Reallocate GPU buffers for AABB data
   */
  private reallocateBuffers(count: number): void {
    // Pad to multiple of 64 for efficient workgroup dispatch
    const paddedCount = Math.max(64, Math.ceil(count / 64) * 64);

    if (paddedCount > this.maxAABBs) {
      // Destroy old buffers
      this.aabbBuffer?.destroy();
      this.resultBuffer?.destroy();
      this.readbackBuffer?.destroy();

      this.maxAABBs = paddedCount;

      // AABB buffer: 8 floats per AABB (min xyz, max xyz, expressId, padding)
      this.aabbBuffer = this.device.createBuffer({
        label: 'Hi-Z AABB Buffer',
        size: this.maxAABBs * 32, // 8 * 4 bytes per AABB
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      // Result buffer: 1 u32 per AABB (0 = occluded, 1 = visible)
      this.resultBuffer = this.device.createBuffer({
        label: 'Hi-Z Result Buffer',
        size: this.maxAABBs * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      // Readback buffer for CPU access
      this.readbackBuffer = this.device.createBuffer({
        label: 'Hi-Z Readback Buffer',
        size: this.maxAABBs * 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

      console.log(`[Hi-Z] Allocated buffers for ${this.maxAABBs} AABBs`);
    }
  }

  /**
   * Upload AABB data to GPU
   */
  private uploadAABBData(): void {
    if (!this.aabbBuffer || this.elementArray.length === 0) return;

    const aabbData = new Float32Array(this.elementArray.length * 8);
    let idx = 0;
    for (const el of this.elementArray) {
      aabbData[idx++] = el.min[0];
      aabbData[idx++] = el.min[1];
      aabbData[idx++] = el.min[2];
      aabbData[idx++] = el.max[0];
      aabbData[idx++] = el.max[1];
      aabbData[idx++] = el.max[2];
      // Store expressId as float (will be cast to u32 in shader)
      const u32View = new Uint32Array(aabbData.buffer, idx * 4, 2);
      u32View[0] = el.expressId;
      u32View[1] = 0; // padding
      idx += 2;
    }

    this.device.queue.writeBuffer(this.aabbBuffer, 0, aabbData);
  }

  /**
   * Check if pyramid needs resizing
   */
  needsResize(width: number, height: number): boolean {
    const targetW = Math.pow(2, Math.ceil(Math.log2(width)));
    const targetH = Math.pow(2, Math.ceil(Math.log2(height)));
    return targetW !== this.pyramidWidth || targetH !== this.pyramidHeight;
  }

  /**
   * Get the depth prepass pipeline and bind group for rendering occluders
   */
  getDepthPrepassResources(): {
    pipeline: GPURenderPipeline;
    bindGroup: GPUBindGroup;
    depthView: GPUTextureView;
    uniformBuffer: GPUBuffer;
  } | null {
    if (
      !this.depthPrepassPipeline ||
      !this.depthPrepassBindGroupLayout ||
      !this.depthPrepassView ||
      !this.depthPrepassUniformBuffer
    ) {
      return null;
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.depthPrepassBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.depthPrepassUniformBuffer } },
      ],
    });

    return {
      pipeline: this.depthPrepassPipeline,
      bindGroup,
      depthView: this.depthPrepassView,
      uniformBuffer: this.depthPrepassUniformBuffer,
    };
  }

  /**
   * Build the depth pyramid from the prepass depth texture
   * Call this after rendering occluders to the depth prepass
   */
  buildPyramidFromPrepass(encoder: GPUCommandEncoder): void {
    if (
      !this.depthPyramid ||
      !this.depthReducePipeline ||
      !this.depthReduceBindGroupLayout ||
      !this.depthPrepassTexture
    ) {
      return;
    }

    // First, copy depth prepass to pyramid level 0
    // We need to use a compute shader to convert from depth32float to r32float
    // For simplicity, we'll render directly to the pyramid base

    // Actually, we can read directly from depth32float texture in compute shader
    // Copy base level
    const baseView = this.depthPrepassTexture.createView();

    // First pass: copy from depth prepass to pyramid level 0
    // Create a temporary bind group for the first level
    const firstPassBindGroup = this.device.createBindGroup({
      layout: this.depthReduceBindGroupLayout,
      entries: [
        { binding: 0, resource: baseView },
        { binding: 1, resource: this.depthPyramidViews[0] },
        { binding: 2, resource: { buffer: this.pyramidUniformBuffer! } },
      ],
    });

    // Update uniforms for base level copy (src level 0, full resolution)
    const uniformData = new Uint32Array([0, this.pyramidWidth, this.pyramidHeight, 0]);
    this.device.queue.writeBuffer(this.pyramidUniformBuffer!, 0, uniformData);

    // Dispatch copy (level 0 is same size as input)
    const copyPass = encoder.beginComputePass({ label: 'Hi-Z Copy Base' });
    copyPass.setPipeline(this.depthReducePipeline);
    copyPass.setBindGroup(0, firstPassBindGroup);
    copyPass.dispatchWorkgroups(
      Math.ceil(this.pyramidWidth / 8),
      Math.ceil(this.pyramidHeight / 8)
    );
    copyPass.end();

    // Build remaining mip levels
    let srcWidth = this.pyramidWidth;
    let srcHeight = this.pyramidHeight;

    for (let level = 0; level < this.pyramidLevels - 1; level++) {
      const dstWidth = Math.max(1, srcWidth >> 1);
      const dstHeight = Math.max(1, srcHeight >> 1);

      // Update uniforms
      const levelUniformData = new Uint32Array([level, dstWidth, dstHeight, 0]);
      this.device.queue.writeBuffer(this.pyramidUniformBuffer!, 0, levelUniformData);

      // Create bind group for this pass
      const bindGroup = this.device.createBindGroup({
        layout: this.depthReduceBindGroupLayout,
        entries: [
          { binding: 0, resource: this.depthPyramidViews[level] },
          { binding: 1, resource: this.depthPyramidViews[level + 1] },
          { binding: 2, resource: { buffer: this.pyramidUniformBuffer! } },
        ],
      });

      // Dispatch compute
      const pass = encoder.beginComputePass({ label: `Hi-Z Reduce Level ${level}` });
      pass.setPipeline(this.depthReducePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(dstWidth / 8), Math.ceil(dstHeight / 8));
      pass.end();

      srcWidth = dstWidth;
      srcHeight = dstHeight;
    }
  }

  /**
   * Perform occlusion testing against the depth pyramid
   * Call this after buildPyramidFromPrepass
   *
   * @param viewProjMatrix - The view-projection matrix
   * @param encoder - Command encoder to record compute passes
   */
  testOcclusionSync(viewProjMatrix: Float32Array, encoder: GPUCommandEncoder): void {
    if (
      !this.occlusionTestPipeline ||
      !this.occlusionTestBindGroupLayout ||
      !this.depthPyramid ||
      !this.aabbBuffer ||
      !this.resultBuffer ||
      this.elementArray.length === 0
    ) {
      return;
    }

    // Update uniforms
    const uniformData = new Float32Array(20); // mat4 + 4 floats
    uniformData.set(viewProjMatrix, 0);
    uniformData[16] = this.pyramidWidth;
    uniformData[17] = this.pyramidHeight;
    uniformData[18] = this.pyramidLevels;
    const countView = new Uint32Array(uniformData.buffer, 76, 1);
    countView[0] = this.elementArray.length;
    this.device.queue.writeBuffer(this.occlusionUniformBuffer!, 0, uniformData);

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: this.occlusionTestBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.occlusionUniformBuffer! } },
        { binding: 1, resource: this.depthPyramidViews[0] },
        { binding: 2, resource: this.depthSampler! },
        { binding: 3, resource: { buffer: this.aabbBuffer } },
        { binding: 4, resource: { buffer: this.resultBuffer } },
      ],
    });

    // Dispatch occlusion test
    const pass = encoder.beginComputePass({ label: 'Hi-Z Occlusion Test' });
    pass.setPipeline(this.occlusionTestPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.elementArray.length / 64));
    pass.end();

    // Copy results to readback buffer
    encoder.copyBufferToBuffer(
      this.resultBuffer,
      0,
      this.readbackBuffer!,
      0,
      this.elementArray.length * 4
    );
  }

  /**
   * Read back occlusion results (call after GPU submission completes)
   *
   * @returns Promise resolving to occlusion results
   */
  async readOcclusionResults(): Promise<OcclusionResult> {
    const startTime = performance.now();

    if (!this.readbackBuffer || this.elementArray.length === 0) {
      return {
        visibleIds: new Set(this.elements.keys()),
        totalTested: this.elementArray.length,
        visibleCount: this.elementArray.length,
        occludedCount: 0,
        queryTimeMs: 0,
      };
    }

    // Map and read results
    // Note: GPUMapMode.READ = 1
    await this.readbackBuffer.mapAsync(1);
    const resultData = new Uint32Array(
      this.readbackBuffer.getMappedRange().slice(0, this.elementArray.length * 4)
    );

    // Build visible set
    const visibleIds = new Set<number>();
    let visibleCount = 0;

    for (let i = 0; i < this.elementArray.length; i++) {
      if (resultData[i] === 1) {
        visibleIds.add(this.elementArray[i].expressId);
        visibleCount++;
      }
    }

    this.readbackBuffer.unmap();

    const queryTimeMs = performance.now() - startTime;
    this.lastQueryTimeMs = queryTimeMs;

    return {
      visibleIds,
      totalTested: this.elementArray.length,
      visibleCount,
      occludedCount: this.elementArray.length - visibleCount,
      queryTimeMs,
    };
  }

  /**
   * Perform full occlusion query (deprecated - use sync methods instead)
   *
   * @param viewProjMatrix - The view-projection matrix
   * @returns Promise resolving to occlusion results
   */
  async testOcclusion(viewProjMatrix: Float32Array): Promise<OcclusionResult> {
    if (this.elementArray.length === 0) {
      return {
        visibleIds: new Set(this.elements.keys()),
        totalTested: 0,
        visibleCount: 0,
        occludedCount: 0,
        queryTimeMs: 0,
      };
    }

    const encoder = this.device.createCommandEncoder({ label: 'Hi-Z Occlusion' });
    this.testOcclusionSync(viewProjMatrix, encoder);
    this.device.queue.submit([encoder.finish()]);

    return this.readOcclusionResults();
  }

  /**
   * Get statistics about the occlusion culler
   */
  getStats(): {
    pyramidSize: string;
    pyramidLevels: number;
    elementCount: number;
    lastQueryTimeMs: number;
  } {
    return {
      pyramidSize: `${this.pyramidWidth}x${this.pyramidHeight}`,
      pyramidLevels: this.pyramidLevels,
      elementCount: this.elementArray.length,
      lastQueryTimeMs: this.lastQueryTimeMs,
    };
  }

  /**
   * Get the depth pyramid texture (for debugging/visualization)
   */
  getPyramidTexture(): GPUTexture | null {
    return this.depthPyramid;
  }

  /**
   * Get a specific mip level view
   */
  getPyramidView(level: number): GPUTextureView | null {
    if (level >= 0 && level < this.depthPyramidViews.length) {
      return this.depthPyramidViews[level];
    }
    return null;
  }

  /**
   * Get the depth prepass texture view
   */
  getDepthPrepassView(): GPUTextureView | null {
    return this.depthPrepassView;
  }

  /**
   * Check if culler has elements
   */
  hasElements(): boolean {
    return this.elementArray.length > 0;
  }

  /**
   * Clear all elements
   */
  clear(): void {
    this.elements.clear();
    this.elementArray = [];
  }

  /**
   * Destroy GPU resources
   */
  destroy(): void {
    this.depthPrepassTexture?.destroy();
    this.depthPyramid?.destroy();
    this.aabbBuffer?.destroy();
    this.resultBuffer?.destroy();
    this.readbackBuffer?.destroy();
    this.pyramidUniformBuffer?.destroy();
    this.occlusionUniformBuffer?.destroy();
    this.depthPrepassUniformBuffer?.destroy();
  }
}
