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
    objectIdView: GPUTextureView;
    contactQuality: PostProcessQuality;
    radius: number;
    intensity: number;
    separationQuality: PostProcessQuality;
    separationRadius: number;
    separationIntensity: number;
    enableSeparationLines: boolean;
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
                    texture: { sampleType: 'unfilterable-float', viewDimension: '2d', multisampled: true },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        const shader = this._device.createShaderModule({
            code: `
struct Params {
  contactRadiusPx: f32,
  contactIntensity: f32,
  seamRadiusPx: f32,
  seamIntensity: f32,
  flags: vec4<u32>, // x=contactQuality y=seamQuality z=seamsEnabled w=reserved
}

@group(0) @binding(0) var depthTex: texture_depth_multisampled_2d;
@group(0) @binding(1) var idTex: texture_multisampled_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

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

fn decodeId24(encoded: vec4<f32>) -> u32 {
  let r = u32(round(encoded.r * 255.0)) & 255u;
  let g = u32(round(encoded.g * 255.0)) & 255u;
  let b = u32(round(encoded.b * 255.0)) & 255u;
  return (r << 16u) | (g << 8u) | b;
}

fn sampleIdClamped(ip: vec2<i32>, dims: vec2<i32>) -> u32 {
  let c = vec2<i32>(clamp(ip.x, 0, dims.x - 1), clamp(ip.y, 0, dims.y - 1));
  return decodeId24(textureLoad(idTex, c, 0u));
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

  let r = max(1, i32(params.contactRadiusPx));
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

  if (params.flags.x == 1u) {
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

  let contact = clamp((accum / max(count, 1.0)) * (120.0 * params.contactIntensity), 0.0, 0.7);

  var seam = 0.0;
  if (params.flags.z == 1u) {
    let idCenter = sampleIdClamped(p, dims);
    if (idCenter != 0u) {
      let rs = max(1, i32(params.seamRadiusPx));
      let idX1 = sampleIdClamped(p + vec2<i32>( rs, 0), dims);
      let idX0 = sampleIdClamped(p + vec2<i32>(-rs, 0), dims);
      let idY1 = sampleIdClamped(p + vec2<i32>(0,  rs), dims);
      let idY0 = sampleIdClamped(p + vec2<i32>(0, -rs), dims);

      let edge4Count =
        f32(idX1 != idCenter && idX1 != 0u) +
        f32(idX0 != idCenter && idX0 != 0u) +
        f32(idY1 != idCenter && idY1 != 0u) +
        f32(idY0 != idCenter && idY0 != 0u);
      seam = edge4Count * 0.25;

      if (params.flags.y == 1u) {
        let idD1 = sampleIdClamped(p + vec2<i32>( rs,  rs), dims);
        let idD2 = sampleIdClamped(p + vec2<i32>(-rs,  rs), dims);
        let idD3 = sampleIdClamped(p + vec2<i32>( rs, -rs), dims);
        let idD4 = sampleIdClamped(p + vec2<i32>(-rs, -rs), dims);
        let edgeDiagCount =
          f32(idD1 != idCenter && idD1 != 0u) +
          f32(idD2 != idCenter && idD2 != 0u) +
          f32(idD3 != idCenter && idD3 != 0u) +
          f32(idD4 != idCenter && idD4 != 0u);
        let edgeDiag = edgeDiagCount * 0.25;
        seam = max(seam, (seam + edgeDiag) * 0.5);
      }
    }
  }

  let seamDarken = clamp(seam * params.seamIntensity, 0.0, 0.35);
  let overlay = max(contact, seamDarken);
  return vec4<f32>(0.0, 0.0, 0.0, overlay);
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
        if (!this.options.enableContactShading && !options.enableSeparationLines) {
            return;
        }

        const contactQualityFlag = options.contactQuality === 'high' ? 1 : 0;
        const seamQualityFlag = options.separationQuality === 'high' ? 1 : 0;
        const contactRadiusPx = options.contactQuality === 'high' ? options.radius : options.radius * 0.5;
        const seamRadiusPx = options.separationQuality === 'high' ? options.separationRadius : 1.0;
        const uniformBuffer = new ArrayBuffer(48);
        const f32 = new Float32Array(uniformBuffer);
        const u32 = new Uint32Array(uniformBuffer);
        f32[0] = contactRadiusPx;
        f32[1] = options.intensity;
        f32[2] = seamRadiusPx;
        f32[3] = options.separationIntensity;
        u32[4] = contactQualityFlag;
        u32[5] = seamQualityFlag;
        u32[6] = options.enableSeparationLines ? 1 : 0;
        u32[7] = 0;
        this._device.queue.writeBuffer(this.uniformBuffer, 0, uniformBuffer);

        const bindGroup = this._device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: options.depthView },
                { binding: 1, resource: options.objectIdView },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
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
