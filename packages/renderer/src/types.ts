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

// Section plane for clipping
export interface SectionPlane {
  axis: 'x' | 'y' | 'z';
  position: number; // 0-100 percentage of model bounds
  enabled: boolean;
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
  // Section plane clipping
  sectionPlane?: SectionPlane;
}
