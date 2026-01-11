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

        // Create uniform buffer for camera matrices and PBR material
        // Layout: viewProj (64 bytes) + model (64 bytes) + baseColor (16 bytes) + metallicRoughness (8 bytes) + padding (8 bytes) = 160 bytes
        // WebGPU requires uniform buffers to be aligned to 16 bytes
        this.uniformBuffer = this.device.createBuffer({
            size: 160, // 10 * 16 bytes = properly aligned
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create shader module with PBR lighting
        const shaderModule = this.device.createShaderModule({
            code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          model: mat4x4<f32>,
          baseColor: vec4<f32>,
          metallicRoughness: vec2<f32>, // x = metallic, y = roughness
          // Padding to ensure 16-byte alignment (vec2 needs 8 bytes, but struct must be 16-byte aligned)
          _padding: vec2<f32>,
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
          let N = normalize(input.normal);
          let L = normalize(vec3<f32>(0.5, 1.0, 0.3)); // Light direction
          
          let NdotL = max(dot(N, L), 0.0);
          
          let baseColor = uniforms.baseColor.rgb;
          
          // Simple diffuse lighting with ambient
          let ambient = 0.3;
          let diffuse = NdotL * 0.7;
          
          var color = baseColor * (ambient + diffuse);
          
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
     * Update uniform buffer with camera matrices and PBR material
     */
    updateUniforms(
        viewProj: Float32Array,
        model: Float32Array,
        color?: [number, number, number, number],
        material?: { metallic?: number; roughness?: number }
    ): void {
        // Create buffer with proper alignment: 2 mat4 (16 floats each) + vec4 (4 floats) + vec2 (2 floats) + padding (2 floats) = 40 floats = 160 bytes
        const buffer = new Float32Array(40); // 160 bytes / 4 bytes per float = 40 floats

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

        // Write the buffer (WebGPU will handle the padding)
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
        return 160; // 40 floats * 4 bytes
    }
}
