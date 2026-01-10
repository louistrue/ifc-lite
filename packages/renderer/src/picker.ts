/**
 * GPU-based object picking
 */

import { WebGPUDevice } from './device.js';
import type { Mesh } from './types.js';

export class Picker {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private depthTexture: GPUTexture;
  private depthTextureView: GPUTextureView;
  private colorTexture: GPUTexture;
  private colorTextureView: GPUTextureView;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;

  constructor(device: WebGPUDevice, width: number = 1, height: number = 1) {
    this.device = device.getDevice();

    // Create textures for picking
    this.colorTexture = this.device.createTexture({
      size: { width, height },
      format: 'r32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.colorTextureView = this.colorTexture.createView();

    this.depthTexture = this.device.createTexture({
      size: { width, height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTextureView = this.depthTexture.createView();

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 16 * 4 * 2,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'uniform' },
          },
        ],
      }),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });

    // Create picker shader (outputs object ID as color)
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
          @location(0) @interpolate(flat) objectId: u32,
        }

        @vertex
        fn vs_main(input: VertexInput, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
          var output: VertexOutput;
          let worldPos = uniforms.model * vec4<f32>(input.position, 1.0);
          output.position = uniforms.viewProj * worldPos;
          output.objectId = instanceIndex;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) u32 {
          return input.objectId;
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
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
        targets: [{ format: 'r32uint' }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  /**
   * Pick object at screen coordinates
   */
  async pick(
    x: number,
    y: number,
    width: number,
    height: number,
    meshes: Mesh[],
    viewProj: Float32Array
  ): Promise<number | null> {
    // Resize textures if needed
    if (this.colorTexture.width !== width || this.colorTexture.height !== height) {
      this.colorTexture.destroy();
      this.depthTexture.destroy();

      this.colorTexture = this.device.createTexture({
        size: { width, height },
        format: 'r32uint',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.colorTextureView = this.colorTexture.createView();

      this.depthTexture = this.device.createTexture({
        size: { width, height },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depthTextureView = this.depthTexture.createView();
    }

    // Render picker pass
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.colorTextureView,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (!mesh) continue;
      const model = mesh.transform.m;
      const buffer = new Float32Array(32);
      buffer.set(viewProj, 0);
      buffer.set(model, 16);
      this.device.queue.writeBuffer(this.uniformBuffer, 0, buffer);

      pass.setVertexBuffer(0, mesh.vertexBuffer);
      pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
      pass.drawIndexed(mesh.indexCount, 1, 0, 0, i);
    }

    pass.end();

    // Read pixel at click position
    const buffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    encoder.copyTextureToBuffer(
      {
        texture: this.colorTexture,
        origin: { x: Math.floor(x), y: Math.floor(height - y - 1), z: 0 },
      },
      {
        buffer,
        bytesPerRow: 4,
        rowsPerImage: 1,
      },
      { width: 1, height: 1 }
    );

    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(buffer.getMappedRange());
    const objectId = data[0];
    buffer.unmap();

    return objectId > 0 ? objectId - 1 : null; // Adjust for 0-based indexing
  }

  updateUniforms(viewProj: Float32Array, model: Float32Array): void {
    const buffer = new Float32Array(32);
    buffer.set(viewProj, 0);
    buffer.set(model, 16);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, buffer);
  }
}
