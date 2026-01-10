/**
 * WebGPU type definitions for TypeScript
 */

interface GPUAdapter {
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  readonly features: GPUSupportedFeatures;
  readonly limits: GPUSupportedLimits;
  readonly info: GPUAdapterInfo;
}

interface GPUDeviceDescriptor {
  requiredFeatures?: GPUFeatureName[];
  requiredLimits?: GPULimits;
  label?: string;
}

interface GPULimits {
  maxTextureDimension1D?: number;
  maxTextureDimension2D?: number;
  maxTextureDimension3D?: number;
  maxTextureArrayLayers?: number;
  maxBindGroups?: number;
  maxDynamicUniformBuffersPerPipelineLayout?: number;
  maxDynamicStorageBuffersPerPipelineLayout?: number;
  maxSampledTexturesPerShaderStage?: number;
  maxSamplersPerShaderStage?: number;
  maxStorageBuffersPerShaderStage?: number;
  maxStorageTexturesPerShaderStage?: number;
  maxUniformBuffersPerShaderStage?: number;
  maxUniformBufferBindingSize?: number;
  maxStorageBufferBindingSize?: number;
  minUniformBufferOffsetAlignment?: number;
  minStorageBufferOffsetAlignment?: number;
  maxVertexBuffers?: number;
  maxVertexAttributes?: number;
  maxVertexBufferArrayStride?: number;
  maxInterStageShaderVariables?: number;
  maxInterStageShaderComponents?: number;
  maxColorAttachments?: number;
  maxColorAttachmentBytesPerSample?: number;
  maxComputeWorkgroupStorageSize?: number;
  maxComputeInvocationsPerWorkgroup?: number;
  maxComputeWorkgroupSizeX?: number;
  maxComputeWorkgroupSizeY?: number;
  maxComputeWorkgroupSizeZ?: number;
  maxComputeWorkgroupsPerDimension?: number;
  maxBufferSize?: number;
}

type GPUFeatureName = string;

interface GPUAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

interface GPUDevice extends EventTarget {
  readonly queue: GPUQueue;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
}

interface GPUTextureDescriptor {
  size: [number, number] | [number, number, number] | GPUExtent3D;
  mipLevelCount?: number;
  sampleCount?: number;
  dimension?: GPUTextureDimension;
  format: GPUTextureFormat;
  usage: number;
  label?: string;
}

interface GPUExtent3D {
  width: number;
  height?: number;
  depthOrArrayLayers?: number;
}

type GPUTextureDimension = '1d' | '2d' | '3d';

interface GPURenderPassDepthStencilAttachment {
  view: GPUTextureView;
  depthClearValue?: number;
  depthLoadOp?: GPULoadOp;
  depthStoreOp?: GPUStoreOp;
  depthReadOnly?: boolean;
  stencilClearValue?: number;
  stencilLoadOp?: GPULoadOp;
  stencilStoreOp?: GPUStoreOp;
  stencilReadOnly?: boolean;
}

interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: ArrayBuffer | ArrayBufferView, dataOffset?: number, size?: number): void;
  onSubmittedWorkDone(): Promise<void>;
}

interface GPUShaderModule {
  readonly label?: string;
}

interface GPURenderPipeline {
  readonly label?: string;
}

interface GPUCommandEncoder {
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  finish(): GPUCommandBuffer;
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer | null, offset?: number, size?: number): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  end(): void;
}

interface GPUBuffer {
  readonly size: number;
  readonly usage: number;
  readonly label?: string;
}

interface GPUCommandBuffer {
  readonly label?: string;
}

interface GPUShaderModuleDescriptor {
  code: string;
  label?: string;
}

interface GPURenderPipelineDescriptor {
  layout?: GPUPipelineLayout | 'auto';
  vertex: GPUVertexState;
  fragment?: GPUFragmentState;
  primitive?: GPUPrimitiveState;
  depthStencil?: GPUDepthStencilState;
  label?: string;
}

interface GPUDepthStencilState {
  format: GPUTextureFormat;
  depthWriteEnabled?: boolean;
  depthCompare?: GPUCompareFunction;
  stencilFront?: GPUStencilFaceState;
  stencilBack?: GPUStencilFaceState;
  stencilReadMask?: number;
  stencilWriteMask?: number;
  depthBias?: number;
  depthBiasSlopeScale?: number;
  depthBiasClamp?: number;
}

interface GPUStencilFaceState {
  compare?: GPUCompareFunction;
  failOp?: GPUStencilOperation;
  depthFailOp?: GPUStencilOperation;
  passOp?: GPUStencilOperation;
}

type GPUCompareFunction = 'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always';
type GPUStencilOperation = 'keep' | 'zero' | 'replace' | 'invert' | 'increment-clamp' | 'decrement-clamp' | 'increment-wrap' | 'decrement-wrap';

interface GPUVertexState {
  module: GPUShaderModule;
  entryPoint: string;
  buffers?: GPUVertexBufferLayout[];
}

interface GPUFragmentState {
  module: GPUShaderModule;
  entryPoint: string;
  targets?: GPUColorTargetState[];
}

interface GPUPrimitiveState {
  topology?: GPUPrimitiveTopology;
  stripIndexFormat?: GPUIndexFormat;
  frontFace?: GPUFrontFace;
  cullMode?: GPUCullMode;
}

interface GPUVertexBufferLayout {
  arrayStride: number;
  stepMode?: GPUVertexStepMode;
  attributes: GPUVertexAttribute[];
}

interface GPUVertexAttribute {
  shaderLocation: number;
  offset: number;
  format: GPUVertexFormat;
}

interface GPUColorTargetState {
  format: GPUTextureFormat;
  blend?: GPUBlendState;
  writeMask?: GPUColorWriteFlags;
}

interface GPURenderPassDescriptor {
  colorAttachments?: GPURenderPassColorAttachment[];
  depthStencilAttachment?: GPURenderPassDepthStencilAttachment;
  occlusionQuerySet?: GPUQuerySet;
  timestampWrites?: GPURenderPassTimestampWrites;
  maxDrawCount?: number;
  label?: string;
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  resolveTarget?: GPUTextureView;
  clearValue?: GPUColor;
  loadOp?: GPULoadOp;
  storeOp?: GPUStoreOp;
}

interface GPUTextureView {
  readonly label?: string;
}

interface GPUColor {
  r?: number;
  g?: number;
  b?: number;
  a?: number;
}

interface GPUCommandEncoderDescriptor {
  label?: string;
}

interface GPUBufferDescriptor {
  size: number;
  usage: number;
  label?: string;
}

type GPUPrimitiveTopology = 'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip';
type GPUIndexFormat = 'uint16' | 'uint32';
type GPUFrontFace = 'ccw' | 'cw';
type GPUCullMode = 'none' | 'front' | 'back';
type GPUVertexStepMode = 'vertex' | 'instance';
type GPUVertexFormat = 'uint8x2' | 'uint8x4' | 'sint8x2' | 'sint8x4' | 'unorm8x2' | 'unorm8x4' | 'snorm8x2' | 'snorm8x4' | 'uint16x2' | 'uint16x4' | 'sint16x2' | 'sint16x4' | 'unorm16x2' | 'unorm16x4' | 'snorm16x2' | 'snorm16x4' | 'float16x2' | 'float16x4' | 'float32' | 'float32x2' | 'float32x3' | 'float32x4' | 'uint32' | 'uint32x2' | 'uint32x3' | 'uint32x4' | 'sint32' | 'sint32x2' | 'sint32x3' | 'sint32x4';
type GPUTextureFormat = string;
type GPULoadOp = 'load' | 'clear';
type GPUStoreOp = 'store' | 'discard';
type GPUColorWriteFlags = number;

interface GPUAdapterDescriptor {
  powerPreference?: 'low-power' | 'high-performance';
  forceFallbackAdapter?: boolean;
}

interface GPUCanvasContext {
  configure(configuration: GPUCanvasConfiguration): void;
  unconfigure(): void;
  getCurrentTexture(): GPUTexture;
}

interface GPUCanvasConfiguration {
  device: GPUDevice;
  format: GPUTextureFormat;
  usage?: GPUTextureUsageFlags;
  viewFormats?: GPUTextureFormat[];
  colorSpace?: PredefinedColorSpace;
  alphaMode?: GPUCanvasAlphaMode;
}

type GPUTextureUsageFlags = number;
type GPUCanvasAlphaMode = 'opaque' | 'premultiplied';

interface GPUTexture {
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
}

interface GPUTextureViewDescriptor {
  format?: GPUTextureFormat;
  dimension?: GPUTextureViewDimension;
  aspect?: GPUTextureAspect;
  baseMipLevel?: number;
  mipLevelCount?: number;
  baseArrayLayer?: number;
  arrayLayerCount?: number;
}

type GPUTextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
type GPUTextureAspect = 'all' | 'stencil-only' | 'depth-only';

interface GPUSupportedFeatures extends Set<string> {}
interface GPUSupportedLimits {
  readonly maxTextureDimension1D: number;
  readonly maxTextureDimension2D: number;
  readonly maxTextureDimension3D: number;
  readonly maxTextureArrayLayers: number;
  readonly maxBindGroups: number;
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
  readonly maxVertexAttributes: number;
  readonly maxVertexBufferArrayStride: number;
  readonly maxInterStageShaderVariables: number;
  readonly maxInterStageShaderComponents: number;
  readonly maxColorAttachments: number;
  readonly maxColorAttachmentBytesPerSample: number;
  readonly maxComputeWorkgroupStorageSize: number;
  readonly maxComputeInvocationsPerWorkgroup: number;
  readonly maxComputeWorkgroupSizeX: number;
  readonly maxComputeWorkgroupSizeY: number;
  readonly maxComputeWorkgroupSizeZ: number;
  readonly maxComputeWorkgroupsPerDimension: number;
  readonly maxBufferSize: number;
}

interface Navigator {
  gpu?: GPU;
}

interface GPU {
  requestAdapter(options?: GPUAdapterDescriptor): Promise<GPUAdapter | null>;
  getPreferredCanvasFormat(): GPUTextureFormat;
}

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

declare const GPUTextureUsage: {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly TEXTURE_BINDING: number;
  readonly STORAGE_BINDING: number;
  readonly RENDER_ATTACHMENT: number;
};
