/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * WebGPU type definitions for TypeScript
 */

// Extend Navigator interface with WebGPU support
interface Navigator {
  readonly gpu?: GPU;
}

// GPU interface for WebGPU API
interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
  getPreferredCanvasFormat(): GPUTextureFormat;
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
  forceFallbackAdapter?: boolean;
}

interface GPUAdapter {
  readonly features: GPUSupportedFeatures;
  readonly limits: GPUSupportedLimits;
  readonly isFallbackAdapter: boolean;
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  requestAdapterInfo(): Promise<GPUAdapterInfo>;
}

interface GPUSupportedFeatures extends ReadonlySet<string> {}

interface GPUSupportedLimits {
  readonly maxTextureDimension1D: number;
  readonly maxTextureDimension2D: number;
  readonly maxTextureDimension3D: number;
  readonly maxTextureArrayLayers: number;
  readonly maxBindGroups: number;
  readonly maxBindingsPerBindGroup: number;
  readonly maxDynamicUniformBuffersPerPipelineLayout: number;
  readonly maxDynamicStorageBuffersPerPipelineLayout: number;
  readonly maxSampledTexturesPerShaderStage: number;
  readonly maxSamplersPerShaderStage: number;
  readonly maxStorageBuffersPerShaderStage: number;
  readonly maxStorageTexturesPerShaderStage: number;
  readonly maxUniformBuffersPerShaderStage: number;
  readonly maxUniformBufferBindingSize: number;
  readonly maxStorageBufferBindingSize: number;
  readonly minUniformBufferOffsetAlignment: number;
  readonly minStorageBufferOffsetAlignment: number;
  readonly maxVertexBuffers: number;
  readonly maxBufferSize: number;
  readonly maxVertexAttributes: number;
  readonly maxVertexBufferArrayStride: number;
  readonly maxInterStageShaderComponents: number;
  readonly maxColorAttachments: number;
  readonly maxColorAttachmentBytesPerSample: number;
  readonly maxComputeWorkgroupStorageSize: number;
  readonly maxComputeInvocationsPerWorkgroup: number;
  readonly maxComputeWorkgroupSizeX: number;
  readonly maxComputeWorkgroupSizeY: number;
  readonly maxComputeWorkgroupSizeZ: number;
  readonly maxComputeWorkgroupsPerDimension: number;
}

interface GPUDeviceDescriptor {
  requiredFeatures?: Iterable<string>;
  requiredLimits?: Record<string, number>;
  label?: string;
}

interface GPUDevice extends EventTarget {
  readonly features: GPUSupportedFeatures;
  readonly limits: GPUSupportedLimits;
  readonly queue: GPUQueue;
  readonly lost: Promise<GPUDeviceLostInfo>;
  destroy(): void;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createComputePipelineAsync(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>;
  createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  createRenderBundleEncoder(descriptor: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder;
  createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet;
}

interface GPUAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

interface GPUDeviceLostInfo {
  readonly reason: 'unknown' | 'destroyed';
  readonly message: string;
}

type GPUTextureFormat = string;

// Minimal interfaces for other GPU types (as placeholders)
interface GPUQueue {}
interface GPUBuffer {}
interface GPUTexture {}
interface GPUSampler {}
interface GPUBindGroupLayout {}
interface GPUPipelineLayout {}
interface GPUBindGroup {}
interface GPUShaderModule {}
interface GPUComputePipeline {}
interface GPURenderPipeline {}
interface GPUCommandEncoder {}
interface GPURenderBundleEncoder {}
interface GPUQuerySet {}
interface GPUBufferDescriptor {}
interface GPUTextureDescriptor {}
interface GPUSamplerDescriptor {}
interface GPUBindGroupLayoutDescriptor {}
interface GPUPipelineLayoutDescriptor {}
interface GPUBindGroupDescriptor {}
interface GPUShaderModuleDescriptor {}
interface GPUComputePipelineDescriptor {}
interface GPURenderPipelineDescriptor {}
interface GPUCommandEncoderDescriptor {}
interface GPURenderBundleEncoderDescriptor {}
interface GPUQuerySetDescriptor {}

declare const GPUBufferUsage: {
  readonly MAP_READ: number;
  readonly MAP_WRITE: number;
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly INDEX: number;
  readonly VERTEX: number;
  readonly UNIFORM: number;
  readonly STORAGE: number;
  readonly INDIRECT: number;
  readonly QUERY_RESOLVE: number;
};
