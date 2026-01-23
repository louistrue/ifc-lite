/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
  modelIndex?: number;  // Index of the model this mesh belongs to (for multi-model federation)
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  transform: Mat4;
  color: [number, number, number, number];
  material?: Material;
  // Per-mesh GPU resources for unique colors
  uniformBuffer?: GPUBuffer;
  bindGroup?: GPUBindGroup;
  // Bounding box for frustum culling (optional)
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}

/**
 * Instanced geometry for GPU instancing
 * Groups identical geometries with different transforms
 */
export interface InstancedMesh {
  geometryId: number;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  instanceBuffer: GPUBuffer; // Storage buffer with instance data
  instanceCount: number;
  // Map expressId to instance index for picking
  expressIdToInstanceIndex: Map<number, number>;
  // Cached bind group for instanced rendering (avoids per-frame allocation)
  bindGroup?: GPUBindGroup;
  // Bounding box for frustum culling (optional)
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}

/**
 * Batched mesh - groups multiple meshes with same color into single draw call
 * Reduces draw calls from N meshes to ~100-500 batches
 */
export interface BatchedMesh {
  colorKey: string;  // Color hash for grouping
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  color: [number, number, number, number];
  expressIds: number[];  // For picking - all expressIds in this batch
  bindGroup?: GPUBindGroup;
  uniformBuffer?: GPUBuffer;
  // Bounding box for frustum culling (optional)
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}

// Section plane for clipping
// Semantic axis names: down (Y), front (Z), side (X) for intuitive user experience
export type SectionPlaneAxis = 'down' | 'front' | 'side';
export interface SectionPlane {
  axis: SectionPlaneAxis;
  position: number; // 0-100 percentage of model bounds
  enabled: boolean;
  flipped?: boolean; // If true, show the opposite side of the cut
  min?: number;      // Optional override for min range value
  max?: number;      // Optional override for max range value
}

export interface RenderOptions {
  clearColor?: [number, number, number, number];
  enableDepthTest?: boolean;
  enableFrustumCulling?: boolean;
  spatialIndex?: import('@ifc-lite/spatial').SpatialIndex;
  // Visibility filtering
  hiddenIds?: Set<number>;        // Meshes to hide
  isolatedIds?: Set<number> | null; // Only show these meshes (null = show all)
  selectedId?: number | null;     // Currently selected mesh (for highlighting)
  selectedIds?: Set<number>;      // Multi-selection support
  selectedModelIndex?: number;    // Model index for multi-model selection (must match mesh.modelIndex)
  // Section plane clipping
  sectionPlane?: SectionPlane;
  // Streaming state
  isStreaming?: boolean;          // If true, skip expensive operations like picker
}

/**
 * Options for GPU picking/selection
 * Filters out hidden/invisible elements so users can select what's visible
 */
export interface PickOptions {
  // Skip picking during streaming for performance
  isStreaming?: boolean;
  // Visibility filtering - same as RenderOptions for consistency
  hiddenIds?: Set<number>;        // Hidden elements (can't be picked)
  isolatedIds?: Set<number> | null; // Only these elements can be picked (null = all pickable)
}

/**
 * Result from GPU picking
 * For multi-model support, includes both expressId and modelIndex
 */
export interface PickResult {
  expressId: number;
  modelIndex?: number;  // Index of the model this entity belongs to
}
