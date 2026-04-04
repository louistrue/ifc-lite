/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * WebGPU render pipeline setup
 */

import { WebGPUDevice } from './device.js';
import { mainShaderSource } from './shaders/main.wgsl.js';
import type { InstancedMesh } from './types.js';

// Mobile GPU detection — depth32float unsupported on many mobile Vulkan drivers
const _isMobileGPU = typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Minimal fallback shader for mobile GPUs that reject the full PBR shader.
// Uses the same uniform layout and vertex format as the main shader.
const FALLBACK_SHADER = `
    struct Uniforms {
      viewProj: mat4x4<f32>,
      model: mat4x4<f32>,
      baseColor: vec4<f32>,
      metallicRoughness: vec2<f32>,
      _pad1: vec2<f32>,
      sectionPlane: vec4<f32>,
      flags: vec4<u32>,
    }
    @binding(0) @group(0) var<uniform> uniforms: Uniforms;

    struct VSOut {
      @builtin(position) position: vec4<f32>,
      @location(0) normal: vec3<f32>,
    }

    @vertex
    fn vs_main(@location(0) pos: vec3<f32>, @location(1) norm: vec3<f32>, @location(2) eid: u32) -> VSOut {
      var o: VSOut;
      let wp = uniforms.model * vec4<f32>(pos, 1.0);
      o.position = uniforms.viewProj * wp;
      o.normal = normalize((uniforms.model * vec4<f32>(norm, 0.0)).xyz);
      return o;
    }

    struct FSOut { @location(0) color: vec4<f32>, }

    @fragment
    fn fs_main(input: VSOut) -> FSOut {
      let N = normalize(input.normal);
      let L = normalize(vec3<f32>(0.5, 1.0, 0.3));
      let diff = max(abs(dot(N, L)), 0.15);
      var color = uniforms.baseColor.rgb * diff;
      color = pow(color, vec3<f32>(1.0 / 2.2));
      var o: FSOut;
      o.color = vec4<f32>(color, uniforms.baseColor.a);
      return o;
    }
`;

export class RenderPipeline {
    private device: GPUDevice;
    private webgpuDevice: WebGPUDevice;
    pipeline!: GPURenderPipeline;
    private selectionPipeline!: GPURenderPipeline;
    private transparentPipeline!: GPURenderPipeline;
    private overlayPipeline!: GPURenderPipeline;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;
    private objectIdTexture!: GPUTexture;
    private objectIdTextureView!: GPUTextureView;
    private depthFormat: GPUTextureFormat = _isMobileGPU ? 'depth24plus' : 'depth32float';
    private colorFormat: GPUTextureFormat;
    private objectIdFormat: GPUTextureFormat = 'rgba8unorm';
    private multisampleTexture: GPUTexture | null = null;
    private multisampleTextureView: GPUTextureView | null = null;
    private sampleCount: number = 4;
    private uniformBuffer: GPUBuffer;
    private bindGroup: GPUBindGroup;
    private bindGroupLayout: GPUBindGroupLayout;
    private currentWidth: number;
    private currentHeight: number;
    /** When true, pipeline uses a single color target (no objectId MRT). */
    private singleTargetMode: boolean = false;
    /** Diagnostic: pipeline creation validation error (if any) */
    _pipelineError: string = '';
    /** True if using the minimal fallback shader */
    _usingFallback: boolean = false;

    constructor(device: WebGPUDevice, width: number = 1, height: number = 1, singleTarget: boolean = false) {
        this.currentWidth = width;
        this.currentHeight = height;
        this.webgpuDevice = device;
        this.device = device.getDevice();
        this.colorFormat = device.getFormat();
        this.singleTargetMode = singleTarget;

        const maxSampleCount = (this.device as any).limits?.maxSampleCount ?? 4;
        this.sampleCount = this.singleTargetMode ? 1 : Math.min(4, maxSampleCount);

        // Create depth texture
        const depthUsage = this.depthFormat === 'depth32float'
            ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            : GPUTextureUsage.RENDER_ATTACHMENT;
        this.depthTexture = this.device.createTexture({
            size: { width, height },
            format: this.depthFormat,
            usage: depthUsage,
            sampleCount: this.sampleCount > 1 ? this.sampleCount : 1,
        });
        this.depthTextureView = this.depthTexture.createView();

        // ObjectId texture (only in MRT mode)
        if (!this.singleTargetMode) {
            this.objectIdTexture = this.device.createTexture({
                size: { width, height },
                format: this.objectIdFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                sampleCount: this.sampleCount > 1 ? this.sampleCount : 1,
            });
            this.objectIdTextureView = this.objectIdTexture.createView();
        } else {
            this.objectIdTexture = this.device.createTexture({
                size: { width: 1, height: 1 },
                format: this.objectIdFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.objectIdTextureView = this.objectIdTexture.createView();
        }

        // MSAA texture
        if (this.sampleCount > 1) {
            this.multisampleTexture = this.device.createTexture({
                size: { width, height },
                format: this.colorFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
                sampleCount: this.sampleCount,
            });
            this.multisampleTextureView = this.multisampleTexture.createView();
        }

        // Uniform buffer (192 bytes, 16-byte aligned)
        this.uniformBuffer = this.device.createBuffer({
            size: 192,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            }],
        });

        // --- Shader preparation ---
        let shaderCode = mainShaderSource;
        if (this.singleTargetMode) {
            shaderCode = shaderCode.replace(
                /@location\(1\)\s+objectIdEncoded\s*:\s*vec4<f32>,/, ''
            );
            shaderCode = shaderCode.replace(
                /out\.objectIdEncoded\s*=\s*encodeId24\([^)]*\)\s*;/, ''
            );
        }

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        // Check shader compilation
        if (shaderModule.getCompilationInfo) {
            shaderModule.getCompilationInfo().then((info) => {
                for (const msg of info.messages) {
                    if (msg.type === 'error') {
                        this._pipelineError = `shader: ${msg.message} (L${msg.lineNum})`;
                        console.error('[Shader] Compile error:', msg.message, 'line', msg.lineNum);
                    }
                }
            });
        }

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
        });

        const colorTargets: GPUColorTargetState[] = this.singleTargetMode
            ? [{ format: this.colorFormat }]
            : [{ format: this.colorFormat }, { format: 'rgba8unorm' }];

        // Helper to build pipeline descriptor
        const makeDesc = (mod: GPUShaderModule, label: string): GPURenderPipelineDescriptor => ({
            label,
            layout: pipelineLayout,
            vertex: {
                module: mod, entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 28,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' as const },
                        { shaderLocation: 1, offset: 12, format: 'float32x3' as const },
                        { shaderLocation: 2, offset: 24, format: 'uint32' as const },
                    ],
                }],
            },
            fragment: { module: mod, entryPoint: 'fs_main', targets: colorTargets },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
            multisample: { count: this.sampleCount },
        } as GPURenderPipelineDescriptor);

        // --- Create main pipeline with fallback ---
        this.device.pushErrorScope('validation');
        this.pipeline = this.device.createRenderPipeline(makeDesc(shaderModule, 'ifc-main'));
        this.device.popErrorScope().then((error) => {
            if (!error) {
                console.log('[Pipeline] Main pipeline OK');
                return;
            }
            const msg = error.message || String(error);
            console.error('[Pipeline] Main pipeline FAILED:', msg);
            this._pipelineError = `main: ${msg.slice(0, 100)}`;

            // --- FALLBACK: try minimal shader ---
            console.log('[Pipeline] Trying fallback shader...');
            const fbModule = this.device.createShaderModule({ code: FALLBACK_SHADER });
            this.device.pushErrorScope('validation');
            this.pipeline = this.device.createRenderPipeline(makeDesc(fbModule, 'ifc-fallback'));
            this.device.popErrorScope().then((err2) => {
                if (err2) {
                    this._pipelineError = `BOTH: ${err2.message?.slice(0, 80)}`;
                    console.error('[Pipeline] Fallback ALSO FAILED:', err2.message);
                } else {
                    this._pipelineError = 'using fallback shader';
                    this._usingFallback = true;
                    console.log('[Pipeline] Fallback shader OK');
                }
            });
        });

        // --- Selection pipeline (same shader, depth read-only) ---
        const selectionDesc: GPURenderPipelineDescriptor = {
            ...makeDesc(shaderModule, 'ifc-selection'),
            depthStencil: {
                format: this.depthFormat,
                depthWriteEnabled: false,
                depthCompare: 'greater-equal',
                depthBias: 0,
            },
        };
        this.selectionPipeline = this.device.createRenderPipeline(selectionDesc);

        // --- Transparent pipeline (alpha blending) ---
        const transparentTargets: GPUColorTargetState[] = this.singleTargetMode
            ? [{
                format: this.colorFormat,
                blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                },
            }]
            : [{
                format: this.colorFormat,
                blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                },
            }, { format: 'rgba8unorm' }];

        this.transparentPipeline = this.device.createRenderPipeline({
            label: 'ifc-transparent',
            layout: pipelineLayout,
            vertex: makeDesc(shaderModule, '').vertex,
            fragment: { module: shaderModule, entryPoint: 'fs_main', targets: transparentTargets },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: { format: this.depthFormat, depthWriteEnabled: false, depthCompare: 'greater' },
            multisample: { count: this.sampleCount },
        } as GPURenderPipelineDescriptor);

        // --- Overlay pipeline (depth-equal for lens coloring) ---
        this.overlayPipeline = this.device.createRenderPipeline({
            label: 'ifc-overlay',
            layout: pipelineLayout,
            vertex: makeDesc(shaderModule, '').vertex,
            fragment: { module: shaderModule, entryPoint: 'fs_main', targets: colorTargets },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: { format: this.depthFormat, depthWriteEnabled: false, depthCompare: 'equal' },
            multisample: { count: this.sampleCount },
        } as GPURenderPipelineDescriptor);

        // Bind group
        this.bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });
    }

    getPipeline(): GPURenderPipeline { return this.pipeline; }
    getSelectionPipeline(): GPURenderPipeline { return this.selectionPipeline; }
    getTransparentPipeline(): GPURenderPipeline { return this.transparentPipeline; }
    getOverlayPipeline(): GPURenderPipeline { return this.overlayPipeline; }
    getDepthTextureView(): GPUTextureView { return this.depthTextureView; }
    getObjectIdTextureView(): GPUTextureView { return this.objectIdTextureView; }
    getMultisampleTextureView(): GPUTextureView | null { return this.multisampleTextureView; }
    getUniformBufferSize(): number { return 192; }
    getBindGroupLayout(): GPUBindGroupLayout { return this.bindGroupLayout; }
    getSampleCount(): number { return this.sampleCount; }
    isSingleTarget(): boolean { return this.singleTargetMode; }
    getBindGroup(): GPUBindGroup { return this.bindGroup; }

    destroy(): void {
        this.depthTexture.destroy();
        this.objectIdTexture.destroy();
        this.multisampleTexture?.destroy();
        this.uniformBuffer.destroy();
    }

    needsResize(width: number, height: number): boolean {
        return this.currentWidth !== width || this.currentHeight !== height;
    }

    resize(width: number, height: number): void {
        if (width <= 0 || height <= 0) return;
        this.currentWidth = width;
        this.currentHeight = height;

        const depthUsage = this.depthFormat === 'depth32float'
            ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            : GPUTextureUsage.RENDER_ATTACHMENT;
        this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: { width, height }, format: this.depthFormat,
            usage: depthUsage,
            sampleCount: this.sampleCount > 1 ? this.sampleCount : 1,
        });
        this.depthTextureView = this.depthTexture.createView();

        if (!this.singleTargetMode) {
            this.objectIdTexture.destroy();
            this.objectIdTexture = this.device.createTexture({
                size: { width, height }, format: this.objectIdFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                sampleCount: this.sampleCount > 1 ? this.sampleCount : 1,
            });
            this.objectIdTextureView = this.objectIdTexture.createView();
        }

        if (this.multisampleTexture) {
            this.multisampleTexture.destroy();
        }
        if (this.sampleCount > 1) {
            this.multisampleTexture = this.device.createTexture({
                size: { width, height }, format: this.colorFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
                sampleCount: this.sampleCount,
            });
            this.multisampleTextureView = this.multisampleTexture.createView();
        } else {
            this.multisampleTexture = null;
            this.multisampleTextureView = null;
        }
    }

    /**
     * Write uniform data for a mesh
     */
    writeUniforms(
        viewProj: Float32Array,
        model: Float32Array,
        color: [number, number, number, number],
        metallic: number = 0.0,
        roughness: number = 0.6,
        isSelected: boolean = false,
        sectionPlane?: { normal: [number, number, number]; distance: number; enabled: boolean },
    ): void {
        const buffer = new ArrayBuffer(192);
        const f32 = new Float32Array(buffer);
        const flagBuffer = new Uint32Array(buffer, 176, 4);

        // viewProj: mat4x4 at offset 0
        f32.set(viewProj, 0);

        // model: mat4x4 at offset 16
        f32.set(model, 16);

        // baseColor: vec4 at offset 32
        f32[32] = color[0];
        f32[33] = color[1];
        f32[34] = color[2];
        f32[35] = color[3];

        // metallicRoughness: vec2 at offset 36
        f32[36] = metallic;
        f32[37] = roughness;
        // _padding1: vec2 at offset 38
        f32[38] = 0;
        f32[39] = 0;

        // sectionPlane: vec4 at offset 40
        if (sectionPlane) {
            f32[40] = sectionPlane.normal[0];
            f32[41] = sectionPlane.normal[1];
            f32[42] = sectionPlane.normal[2];
            f32[43] = sectionPlane.distance;
        }

        // flags: vec4<u32> at offset 44
        flagBuffer[0] = isSelected ? 1 : 0;
        flagBuffer[1] = sectionPlane?.enabled ? 1 : 0;
        flagBuffer[2] = 0;
        flagBuffer[3] = 0;

        this.device.queue.writeBuffer(this.uniformBuffer, 0, buffer);
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
    private colorFormat: GPUTextureFormat;
    private depthFormat: GPUTextureFormat = _isMobileGPU ? 'depth24plus' : 'depth32float';
    private objectIdFormat: GPUTextureFormat = 'rgba8unorm';
    private currentHeight: number;

    constructor(device: WebGPUDevice, width: number = 1, height: number = 1) {
        this.currentHeight = height;
        this.device = device.getDevice();
        this.colorFormat = device.getFormat();

        // Create depth texture
        this.depthTexture = this.device.createTexture({
            size: { width, height },
            format: this.depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();

        // Create uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            size: 192,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Instanced shader is more complex - skip for now, keep original
        const instancedShader = this.device.createShaderModule({
            code: `
                struct Uniforms {
                    viewProj: mat4x4<f32>,
                    model: mat4x4<f32>,
                    baseColor: vec4<f32>,
                    metallicRoughness: vec2<f32>,
                    _padding1: vec2<f32>,
                    sectionPlane: vec4<f32>,
                    flags: vec4<u32>,
                }
                @binding(0) @group(0) var<uniform> uniforms: Uniforms;

                struct Instance {
                    transform: mat4x4<f32>,
                    color: vec4<f32>,
                }
                @binding(0) @group(1) var<storage, read> instances: array<Instance>;

                struct VertexOutput {
                    @builtin(position) position: vec4<f32>,
                    @location(0) worldPos: vec3<f32>,
                    @location(1) normal: vec3<f32>,
                    @location(2) @interpolate(flat) instanceColor: vec4<f32>,
                }

                @vertex
                fn vs_main(
                    @location(0) position: vec3<f32>,
                    @location(1) normal: vec3<f32>,
                    @builtin(instance_index) instanceIndex: u32
                ) -> VertexOutput {
                    let instance = instances[instanceIndex];
                    var output: VertexOutput;
                    let worldPos = instance.transform * vec4<f32>(position, 1.0);
                    output.position = uniforms.viewProj * worldPos;
                    output.worldPos = worldPos.xyz;
                    output.normal = normalize((instance.transform * vec4<f32>(normal, 0.0)).xyz);
                    output.instanceColor = instance.color;
                    return output;
                }

                struct FragOutput {
                    @location(0) color: vec4<f32>,
                    @location(1) objectId: vec4<f32>,
                }

                @fragment
                fn fs_main(input: VertexOutput) -> FragOutput {
                    var output: FragOutput;
                    let N = normalize(input.normal);
                    let L = normalize(vec3<f32>(0.5, 1.0, 0.3));
                    let diffuse = max(dot(N, L), 0.2);
                    output.color = vec4<f32>(input.instanceColor.rgb * diffuse, input.instanceColor.a);
                    output.objectId = vec4<f32>(0.0, 0.0, 0.0, 0.0);
                    return output;
                }
            `,
        });

        // Create bind group layout for uniforms
        const uniformBindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            }],
        });

        // Instance storage bind group layout
        const instanceBindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'read-only-storage' },
            }],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [uniformBindGroupLayout, instanceBindGroupLayout],
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: instancedShader,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 24,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },
                        { shaderLocation: 1, offset: 12, format: 'float32x3' },
                    ],
                }],
            },
            fragment: {
                module: instancedShader,
                entryPoint: 'fs_main',
                targets: [
                    { format: this.colorFormat },
                    { format: this.objectIdFormat },
                ],
            },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: {
                format: this.depthFormat,
                depthWriteEnabled: true,
                depthCompare: 'greater',
            },
        });
    }

    getPipeline(): GPURenderPipeline { return this.pipeline; }
    getDepthTextureView(): GPUTextureView { return this.depthTextureView; }

    needsResize(width: number, height: number): boolean {
        return false; // Instanced pipeline doesn't resize independently
    }

    resize(width: number, height: number): void {
        if (this.currentHeight === height && this.depthTexture.width === width) return;
        this.currentHeight = height;
        this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: { width, height }, format: this.depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthTextureView = this.depthTexture.createView();
    }

    createInstanceBindGroup(instanceBuffer: GPUBuffer): GPUBindGroup {
        const layout = this.pipeline.getBindGroupLayout(1);
        return this.device.createBindGroup({
            layout,
            entries: [{ binding: 0, resource: { buffer: instanceBuffer } }],
        });
    }

    updateUniforms(
        viewProj: Float32Array,
        sectionPlaneData?: { normal: [number, number, number]; distance: number; enabled: boolean } | null,
    ): void {
        const buffer = new Float32Array(48);
        buffer.set(viewProj, 0);
        // Identity model matrix
        buffer[16] = 1; buffer[21] = 1; buffer[26] = 1; buffer[31] = 1;
        if (sectionPlaneData) {
            buffer[40] = sectionPlaneData.normal[0];
            buffer[41] = sectionPlaneData.normal[1];
            buffer[42] = sectionPlaneData.normal[2];
            buffer[43] = sectionPlaneData.distance;
        }
        const flags = new Uint32Array(buffer.buffer, 176, 4);
        flags[1] = sectionPlaneData?.enabled ? 1 : 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, buffer);
    }

    destroy(): void {
        this.depthTexture.destroy();
        this.uniformBuffer.destroy();
    }
}
