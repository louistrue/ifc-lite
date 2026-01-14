/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Scene graph and mesh management
 */

import type { Mesh, InstancedMesh } from './types.js';

export class Scene {
  private meshes: Mesh[] = [];
  private instancedMeshes: InstancedMesh[] = [];

  /**
   * Add mesh to scene
   */
  addMesh(mesh: Mesh): void {
    this.meshes.push(mesh);
  }

  /**
   * Add instanced mesh to scene
   */
  addInstancedMesh(mesh: InstancedMesh): void {
    this.instancedMeshes.push(mesh);
  }

  /**
   * Get all meshes
   */
  getMeshes(): Mesh[] {
    return this.meshes;
  }

  /**
   * Get all instanced meshes
   */
  getInstancedMeshes(): InstancedMesh[] {
    return this.instancedMeshes;
  }

  /**
   * Clear scene
   */
  clear(): void {
    for (const mesh of this.meshes) {
      mesh.vertexBuffer.destroy();
      mesh.indexBuffer.destroy();
      // Destroy per-mesh uniform buffer if it exists
      if (mesh.uniformBuffer) {
        mesh.uniformBuffer.destroy();
      }
    }
    for (const mesh of this.instancedMeshes) {
      mesh.vertexBuffer.destroy();
      mesh.indexBuffer.destroy();
      mesh.instanceBuffer.destroy();
    }
    this.meshes = [];
    this.instancedMeshes = [];
  }

  /**
   * Calculate bounding box
   */
  getBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
    if (this.meshes.length === 0) return null;

    // For MVP, return a simple bounding box
    // In production, this would compute from actual vertex data
    return {
      min: { x: -10, y: -10, z: -10 },
      max: { x: 10, y: 10, z: 10 },
    };
  }
}
