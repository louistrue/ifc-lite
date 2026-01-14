/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * WebGPU render pipeline setup
 */

import { WebGPUDevice } from './device.js';
import type { InstancedMesh } from './types.js';

export class RenderPipeline {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline;
    private selectionPipeline: GPURenderPipeline;  // Pipeline for selected meshes (renders on top)
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;
    private uniformBuffer: GPUBuffer;
    private bindGroup: GPUBindGroup;
    private bindGroupLayout: GPUBindGroupLayout;  // Explicit layout shared between pipelines
    private currentWidth: number;
    private currentHeight: number;

    constructor(device: WebGPUDevice, width: number = 1, height: number = 1) {
        this.currentWidth = width;
        this.currentHeight = height;
        this.device = device.getDevice();
        const format = device.getFormat();

        // Create depth texture
        this.depthTexture = this.device.createTexture({
            size: { width, height },
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();

        // Create uniform buffer for camera matrices, PBR material, and section plane
        // Layout: viewProj (64 bytes) + model (64 bytes) + baseColor (16 bytes) + metallicRoughness (8 bytes) +
        //         sectionPlane (16 bytes: vec3 normal + float position) + flags (16 bytes: u32 isSelected + u32 sectionEnabled + padding) = 192 bytes
        // WebGPU requires uniform buffers to be aligned to 16 bytes
        this.uniformBuffer = this.device.createBuffer({
            size: 192, // 12 * 16 bytes = properly aligned
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create explicit bind group layout (shared between main and selection pipelines)
        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        // Create shader module with PBR lighting, section plane clipping, and selection outline
        const shaderModule = this.device.createShaderModule({
            code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          model: mat4x4<f32>,
          baseColor: vec4<f32>,
          metallicRoughness: vec2<f32>, // x = metallic, y = roughness
          _padding1: vec2<f32>,
          sectionPlane: vec4<f32>,      // xyz = plane normal, w = plane distance
          flags: vec4<u32>,             // x = isSelected, y = sectionEnabled, z,w = reserved
        }
        @binding(0) @group(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) normal: vec3<f32>,
        }

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) worldPos: vec3<f32>,
          @location(1) normal: vec3<f32>,
          @location(2) @interpolate(flat) objectId: u32,
        }

        @vertex
        fn vs_main(input: VertexInput, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
          var output: VertexOutput;
          let worldPos = uniforms.model * vec4<f32>(input.position, 1.0);
          output.position = uniforms.viewProj * worldPos;
          output.worldPos = worldPos.xyz;
          output.normal = normalize((uniforms.model * vec4<f32>(input.normal, 0.0)).xyz);
          output.objectId = instanceIndex;
          return output;
        }

        // PBR helper functions
        fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
          return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
        }

        fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
          let a = roughness * roughness;
          let a2 = a * a;
          let NdotH2 = NdotH * NdotH;
          let num = a2;
          let denomBase = (NdotH2 * (a2 - 1.0) + 1.0);
          let denom = 3.14159265 * denomBase * denomBase;
          return num / max(denom, 0.0000001);
        }

        fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
          let r = (roughness + 1.0);
          let k = (r * r) / 8.0;
          let num = NdotV;
          let denom = NdotV * (1.0 - k) + k;
          return num / max(denom, 0.0000001);
        }

        fn geometrySmith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
          let ggx2 = geometrySchlickGGX(NdotV, roughness);
          let ggx1 = geometrySchlickGGX(NdotL, roughness);
          return ggx1 * ggx2;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          // Section plane clipping
          if (uniforms.flags.y == 1u) {
            let planeNormal = uniforms.sectionPlane.xyz;
            let planeDistance = uniforms.sectionPlane.w;
            let distToPlane = dot(input.worldPos, planeNormal) - planeDistance;
            if (distToPlane > 0.0) {
              discard;
            }
          }

          let N = normalize(input.normal);
          let L = normalize(vec3<f32>(0.5, 1.0, 0.3)); // Light direction

          let NdotL = max(dot(N, L), 0.0);

          var baseColor = uniforms.baseColor.rgb;

          // Simple diffuse lighting with ambient
          let ambient = 0.3;
          let diffuse = NdotL * 0.7;

          var color = baseColor * (ambient + diffuse);

          // Selection highlight - add glow/fresnel effect
          if (uniforms.flags.x == 1u) {
            // Calculate view direction for fresnel effect
            let V = normalize(-input.worldPos); // Assuming camera at origin (simplified)
            let NdotV = max(dot(N, V), 0.0);

            // Fresnel-like edge highlight for selection
            let fresnel = pow(1.0 - NdotV, 2.0);
            let highlightColor = vec3<f32>(0.3, 0.6, 1.0); // Blue highlight
            color = mix(color, highlightColor, fresnel * 0.5 + 0.2);
          }

          // Gamma correction (IFC colors are typically in sRGB)
          color = pow(color, vec3<f32>(1.0 / 2.2));

          return vec4<f32>(color, uniforms.baseColor.a);
        }
      `,
        });

        // Create explicit pipeline layout (shared between main and selection pipelines)
        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
        });

        // Create render pipeline with explicit layout
        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 24, // 6 floats * 4 bytes
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
                            { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none', // Disable culling to debug - IFC winding order varies
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });

        // Create selection pipeline with less-equal depth compare to render selected meshes on top
        // This allows selected meshes to overdraw at the same depth as batched meshes
        // IMPORTANT: Use explicit layout to share bind groups with main pipeline
        this.selectionPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 24,
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' },
                            { shaderLocation: 1, offset: 12, format: 'float32x3' },
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none',
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less-equal',  // Allow overdraw at same depth
                depthBias: -1,               // Small bias to ensure selection renders in front
                depthBiasSlopeScale: -1,
            },
        });

        // Create bind group using the explicit bind group layout
        this.bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
            ],
        });
    }

    /**
     * Update uniform buffer with camera matrices, PBR material, section plane, and selection state
     */
    updateUniforms(
        viewProj: Float32Array,
        model: Float32Array,
        color?: [number, number, number, number],
        material?: { metallic?: number; roughness?: number },
        sectionPlane?: { normal: [number, number, number]; distance: number; enabled: boolean },
        isSelected?: boolean
    ): void {
        // Create buffer with proper alignment:
        // viewProj (16 floats) + model (16 floats) + baseColor (4 floats) + metallicRoughness (2 floats) + padding (2 floats)
        // + sectionPlane (4 floats) + flags (4 u32) = 48 floats = 192 bytes
        const buffer = new Float32Array(48);
        const flagBuffer = new Uint32Array(buffer.buffer, 176, 4); // flags at byte 176

        // viewProj: mat4x4<f32> at offset 0 (16 floats)
        buffer.set(viewProj, 0);

        // model: mat4x4<f32> at offset 16 (16 floats)
        buffer.set(model, 16);

        // baseColor: vec4<f32> at offset 32 (4 floats)
        if (color) {
            buffer.set(color, 32);
        } else {
            // Default white color
            buffer.set([1.0, 1.0, 1.0, 1.0], 32);
        }

        // metallicRoughness: vec2<f32> at offset 36 (2 floats)
        const metallic = material?.metallic ?? 0.0;
        const roughness = material?.roughness ?? 0.6;
        buffer[36] = metallic;
        buffer[37] = roughness;

        // padding at offset 38-39 (2 floats)

        // sectionPlane: vec4<f32> at offset 40 (4 floats - normal xyz + distance w)
        if (sectionPlane) {
            buffer[40] = sectionPlane.normal[0];
            buffer[41] = sectionPlane.normal[1];
            buffer[42] = sectionPlane.normal[2];
            buffer[43] = sectionPlane.distance;
        }

        // flags: vec4<u32> at offset 44 (4 u32 - using flagBuffer view)
        flagBuffer[0] = isSelected ? 1 : 0;           // isSelected
        flagBuffer[1] = sectionPlane?.enabled ? 1 : 0; // sectionEnabled
        flagBuffer[2] = 0;                             // reserved
        flagBuffer[3] = 0;                             // reserved

        // Write the buffer
        this.device.queue.writeBuffer(this.uniformBuffer, 0, buffer);
    }

    /**
     * Check if resize is needed
     */
    needsResize(width: number, height: number): boolean {
        return this.currentWidth !== width || this.currentHeight !== height;
    }

    /**
     * Resize depth texture
     */
    resize(width: number, height: number): void {
        if (width <= 0 || height <= 0) return;

        this.currentWidth = width;
        this.currentHeight = height;

        this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: { width, height },
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();
    }

    getPipeline(): GPURenderPipeline {
        return this.pipeline;
    }

    getSelectionPipeline(): GPURenderPipeline {
        return this.selectionPipeline;
    }

    getDepthTextureView(): GPUTextureView {
        return this.depthTextureView;
    }

    getBindGroup(): GPUBindGroup {
        return this.bindGroup;
    }

    getBindGroupLayout(): GPUBindGroupLayout {
        return this.bindGroupLayout;
    }

    getUniformBufferSize(): number {
        return 192; // 48 floats * 4 bytes
    }
}

/**
 * Instanced render pipeline for GPU instancing
 * Uses storage buffers for instance transforms and colors
 */
export class InstancedRenderPipeline {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;
    private uniformBuffer: GPUBuffer;
    private currentHeight: number;

    constructor(device: WebGPUDevice, width: number = 1, height: number = 1) {
        this.currentHeight = height;
        this.device = device.getDevice();
        const format = device.getFormat();

        // Create depth texture
        this.depthTexture = this.device.createTexture({
            size: { width, height },
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();

        // Create uniform buffer for camera matrices and section plane
        // Layout: viewProj (64 bytes) + sectionPlane (16 bytes) + flags (16 bytes) = 96 bytes
        this.uniformBuffer = this.device.createBuffer({
            size: 96, // 6 * 16 bytes = properly aligned
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const shaderModule = this.device.createShaderModule({
            code: `
        // Instance data structure: transform (16 floats) + color (4 floats) = 20 floats = 80 bytes
        struct Instance {
          transform: mat4x4<f32>,
          color: vec4<f32>,
        }

        struct Uniforms {
          viewProj: mat4x4<f32>,
          sectionPlane: vec4<f32>,      // xyz = plane normal, w = plane distance
          flags: vec4<u32>,             // x = sectionEnabled, y,z,w = reserved
        }
        @binding(0) @group(0) var<uniform> uniforms: Uniforms;
        @binding(1) @group(0) var<storage, read> instances: array<Instance>;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) normal: vec3<f32>,
        }

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) worldPos: vec3<f32>,
          @location(1) normal: vec3<f32>,
          @location(2) color: vec4<f32>,
          @location(3) @interpolate(flat) instanceId: u32,
        }

        // Z-up to Y-up conversion matrix (IFC uses Z-up, WebGPU/viewer uses Y-up)
        // This swaps Y and Z, negating the new Z to maintain right-handedness
        const zToYUp = mat4x4<f32>(
          vec4<f32>(1.0, 0.0, 0.0, 0.0),
          vec4<f32>(0.0, 0.0, -1.0, 0.0),
          vec4<f32>(0.0, 1.0, 0.0, 0.0),
          vec4<f32>(0.0, 0.0, 0.0, 1.0)
        );

        @vertex
        fn vs_main(input: VertexInput, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
          var output: VertexOutput;
          let inst = instances[instanceIndex];
          
          // Transform to world space (still in Z-up coordinates)
          let worldPosZUp = inst.transform * vec4<f32>(input.position, 1.0);
          let normalZUp = (inst.transform * vec4<f32>(input.normal, 0.0)).xyz;
          
          // Convert from Z-up to Y-up for the viewer
          let worldPos = zToYUp * worldPosZUp;
          let normalYUp = (zToYUp * vec4<f32>(normalZUp, 0.0)).xyz;
          
          output.position = uniforms.viewProj * worldPos;
          output.worldPos = worldPos.xyz;
          output.normal = normalize(normalYUp);
          output.color = inst.color;
          output.instanceId = instanceIndex;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          // Section plane clipping
          if (uniforms.flags.x == 1u) {
            let planeNormal = uniforms.sectionPlane.xyz;
            let planeDistance = uniforms.sectionPlane.w;
            let distToPlane = dot(input.worldPos, planeNormal) - planeDistance;
            if (distToPlane > 0.0) {
              discard;
            }
          }

          let N = normalize(input.normal);
          let L = normalize(vec3<f32>(0.5, 1.0, 0.3)); // Light direction

          let NdotL = max(dot(N, L), 0.0);

          var baseColor = input.color.rgb;

          // Simple diffuse lighting with ambient
          let ambient = 0.3;
          let diffuse = NdotL * 0.7;

          var color = baseColor * (ambient + diffuse);

          // Gamma correction (IFC colors are typically in sRGB)
          color = pow(color, vec3<f32>(1.0 / 2.2));

          return vec4<f32>(color, input.color.a);
        }
      `,
        });

        // Create render pipeline
        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 24, // 6 floats * 4 bytes
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
                            { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none',
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
        // Note: bind groups are created per-instanced-mesh via createInstanceBindGroup()
        // since each mesh has its own instance buffer
    }

    /**
     * Update uniform buffer with camera matrices and section plane
     */
    updateUniforms(viewProj: Float32Array, sectionPlane?: { normal: [number, number, number]; distance: number; enabled: boolean }): void {
        const buffer = new Float32Array(24); // 6 * 4 floats
        const flagBuffer = new Uint32Array(buffer.buffer, 80, 4);

        buffer.set(viewProj, 0);

        if (sectionPlane?.enabled) {
            buffer[16] = sectionPlane.normal[0];
            buffer[17] = sectionPlane.normal[1];
            buffer[18] = sectionPlane.normal[2];
            buffer[19] = sectionPlane.distance;
            flagBuffer[0] = 1;
        } else {
            buffer[16] = 0;
            buffer[17] = 0;
            buffer[18] = 0;
            buffer[19] = 0;
            flagBuffer[0] = 0;
        }

        this.device.queue.writeBuffer(this.uniformBuffer, 0, buffer);
    }

    /**
     * Resize depth texture
     */
    resize(width: number, height: number): void {
        if (this.currentHeight === height && this.depthTexture.width === width) {
            return;
        }

        this.currentHeight = height;
        this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: { width, height },
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();
    }

    /**
     * Check if resize is needed
     */
    needsResize(width: number, height: number): boolean {
        return this.depthTexture.width !== width || this.depthTexture.height !== height;
    }

    /**
     * Get render pipeline
     */
    getPipeline(): GPURenderPipeline {
        return this.pipeline;
    }

    /**
     * Get depth texture view
     */
    getDepthTextureView(): GPUTextureView {
        return this.depthTextureView;
    }

    /**
     * Get bind group layout for instance buffer binding
     */
    getBindGroupLayout(): GPUBindGroupLayout {
        return this.pipeline.getBindGroupLayout(0);
    }

    /**
     * Create bind group with instance buffer
     */
    createInstanceBindGroup(instanceBuffer: GPUBuffer): GPUBindGroup {
        return this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: instanceBuffer },
                },
            ],
        });
    }
}
