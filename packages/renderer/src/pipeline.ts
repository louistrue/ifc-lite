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

        // Create uniform buffer for camera matrices
        this.uniformBuffer = this.device.createBuffer({
            size: 16 * 4 * 2, // 2 mat4 (viewProj + model)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create shader module
        const shaderModule = this.device.createShaderModule({
            code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          model: mat4x4<f32>,
        }
        @binding(0) @group(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) normal: vec3<f32>,
        }

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) normal: vec3<f32>,
          @location(1) @interpolate(flat) objectId: u32,
        }

        @vertex
        fn vs_main(input: VertexInput, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
          var output: VertexOutput;
          let worldPos = uniforms.model * vec4<f32>(input.position, 1.0);
          output.position = uniforms.viewProj * worldPos;
          output.normal = normalize((uniforms.model * vec4<f32>(input.normal, 0.0)).xyz);
          output.objectId = instanceIndex;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.5));
          let ndotl = max(dot(input.normal, lightDir), 0.3);
          return vec4<f32>(ndotl, ndotl, ndotl, 1.0);
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
     * Update uniform buffer with camera matrices
     */
    updateUniforms(viewProj: Float32Array, model: Float32Array): void {
        const buffer = new Float32Array(32); // 2 mat4
        buffer.set(viewProj, 0);
        buffer.set(model, 16);
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
}
