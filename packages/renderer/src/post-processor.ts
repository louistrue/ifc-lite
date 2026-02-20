/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Post-processing effects for Blender-quality rendering
 * Includes SSAO, tone mapping, and edge enhancement
 */

import { WebGPUDevice } from './device.js';

export interface PostProcessorOptions {
    enableContactShading?: boolean;
    contactRadius?: number;
    contactIntensity?: number;
}

export type PostProcessQuality = 'low' | 'high';

export interface ContactShadingPassOptions {
    targetView: GPUTextureView;
    depthView: GPUTextureView;
    quality: PostProcessQuality;
    radius: number;
    intensity: number;
}

/**
 * Post-processing pipeline
 * Currently implements enhanced tone mapping in shader
 * SSAO and edge enhancement can be added as separate passes
 */
export class PostProcessor {
    private _device: GPUDevice;
    private options: PostProcessorOptions;
    private colorFormat: GPUTextureFormat;
    private uniformBuffer: GPUBuffer;
    private bindGroupLayout: GPUBindGroupLayout;
    private pipeline: GPURenderPipeline;

    constructor(device: WebGPUDevice, options: PostProcessorOptions = {}) {
        this._device = device.getDevice();
        this.colorFormat = device.getFormat();
        this.options = {
            enableContactShading: false,
            contactRadius: 1.0,
            contactIntensity: 0.3,
            ...options,
        };

        this.uniformBuffer = this._device.createBuffer({
            // WGSL uniform layout for Params requires 48 bytes due to 16-byte alignment.
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.bindGroupLayout = this._device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth', viewDimension: '2d', multisampled: true },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        const shader = this._device.createShaderModule({
            code: `
struct Params {
  invSize: vec2<f32>,
  radiusPx: f32,
  intensity: f32,
  quality: u32,
  _pad0: vec3<u32>,
}

@group(0) @binding(0) var depthTex: texture_depth_multisampled_2d;
@group(0) @binding(1) var<uniform> params: Params;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) v: u32) -> VsOut {
  var o: VsOut;
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0)
  );
  o.pos = vec4<f32>(p[v], 0.0, 1.0);
  return o;
}

fn sampleDepthClamped(ip: vec2<i32>, dims: vec2<i32>) -> f32 {
  let c = vec2<i32>(clamp(ip.x, 0, dims.x - 1), clamp(ip.y, 0, dims.y - 1));
  return textureLoad(depthTex, c, 0u);
}

@fragment
fn fs_main(@builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
  let dimsU = textureDimensions(depthTex);
  let dims = vec2<i32>(i32(dimsU.x), i32(dimsU.y));
  let p = vec2<i32>(i32(fragPos.x), i32(fragPos.y));

  let center = sampleDepthClamped(p, dims);
  if (center <= 0.00001) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let r = max(1, i32(params.radiusPx));
  var accum = 0.0;
  var count = 0.0;

  // Reverse-Z: higher depth means closer to camera.
  let d1 = sampleDepthClamped(p + vec2<i32>( r,  0), dims);
  let d2 = sampleDepthClamped(p + vec2<i32>(-r,  0), dims);
  let d3 = sampleDepthClamped(p + vec2<i32>( 0,  r), dims);
  let d4 = sampleDepthClamped(p + vec2<i32>( 0, -r), dims);
  accum += max(0.0, d1 - center);
  accum += max(0.0, d2 - center);
  accum += max(0.0, d3 - center);
  accum += max(0.0, d4 - center);
  count += 4.0;

  if (params.quality == 1u) {
    let d5 = sampleDepthClamped(p + vec2<i32>( r,  r), dims);
    let d6 = sampleDepthClamped(p + vec2<i32>(-r,  r), dims);
    let d7 = sampleDepthClamped(p + vec2<i32>( r, -r), dims);
    let d8 = sampleDepthClamped(p + vec2<i32>(-r, -r), dims);
    accum += max(0.0, d5 - center);
    accum += max(0.0, d6 - center);
    accum += max(0.0, d7 - center);
    accum += max(0.0, d8 - center);
    count += 4.0;
  }

  let occlusion = clamp((accum / max(count, 1.0)) * (120.0 * params.intensity), 0.0, 0.7);
  return vec4<f32>(0.0, 0.0, 0.0, occlusion);
}
`,
        });

        this.pipeline = this._device.createRenderPipeline({
            layout: this._device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
            vertex: {
                module: shader,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shader,
                entryPoint: 'fs_main',
                targets: [{
                    format: this.colorFormat,
                    blend: {
                        color: {
                            srcFactor: 'zero',
                            dstFactor: 'one-minus-src-alpha',
                        },
                        alpha: {
                            srcFactor: 'zero',
                            dstFactor: 'one',
                        },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none',
            },
        });
    }

    /**
     * Apply lightweight contact shading in a fullscreen overlay pass.
     */
    apply(commandEncoder: GPUCommandEncoder, options: ContactShadingPassOptions): void {
        if (!this.options.enableContactShading) {
            return;
        }

        const qualityFlag = options.quality === 'high' ? 1 : 0;
        const radiusPx = options.quality === 'high' ? options.radius : options.radius * 0.5;
        const uniformBuffer = new ArrayBuffer(48);
        const f32 = new Float32Array(uniformBuffer);
        const u32 = new Uint32Array(uniformBuffer);
        f32[0] = 0; // invSize.x (reserved for future use)
        f32[1] = 0; // invSize.y (reserved for future use)
        f32[2] = radiusPx;
        f32[3] = options.intensity;
        u32[4] = qualityFlag;
        u32[5] = 0;
        u32[6] = 0;
        u32[7] = 0;
        this._device.queue.writeBuffer(this.uniformBuffer, 0, uniformBuffer);

        const bindGroup = this._device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: options.depthView },
                { binding: 1, resource: { buffer: this.uniformBuffer } },
            ],
        });

        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: options.targetView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3, 1, 0, 0);
        pass.end();
    }

    /**
     * Update post-processing options
     */
    updateOptions(options: Partial<PostProcessorOptions>): void {
        this.options = { ...this.options, ...options };
    }
}
