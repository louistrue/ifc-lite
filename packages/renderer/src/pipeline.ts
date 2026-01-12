/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * WebGPU render pipeline setup
 */

import { WebGPUDevice } from './device.js';

export class RenderPipeline {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;
    private uniformBuffer: GPUBuffer;
    private bindGroup: GPUBindGroup;
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
                cullMode: 'none', // Disable culling to debug - IFC winding order varies
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });

        // Create bind group using the pipeline's auto-generated layout
        // IMPORTANT: Must use getBindGroupLayout() when pipeline uses layout: 'auto'
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
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

    getDepthTextureView(): GPUTextureView {
        return this.depthTextureView;
    }

    getBindGroup(): GPUBindGroup {
        return this.bindGroup;
    }

    getBindGroupLayout(): GPUBindGroupLayout {
        return this.pipeline.getBindGroupLayout(0);
    }

    getUniformBufferSize(): number {
        return 192; // 48 floats * 4 bytes
    }
}
