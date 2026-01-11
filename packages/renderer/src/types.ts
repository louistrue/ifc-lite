/**
 * Renderer types for IFC-Lite
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Mat4 {
  m: Float32Array; // 16 elements, column-major
}

export interface Camera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

export interface Material {
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  transparency?: number;
}

export interface Mesh {
  expressId: number;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  transform: Mat4;
  color: [number, number, number, number];
  material?: Material;
  // Per-mesh GPU resources for unique colors
  uniformBuffer?: GPUBuffer;
  bindGroup?: GPUBindGroup;
}

export interface RenderOptions {
  clearColor?: [number, number, number, number];
  enableDepthTest?: boolean;
}
