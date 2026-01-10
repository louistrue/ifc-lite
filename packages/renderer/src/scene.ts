/**
 * Scene graph and mesh management
 */

import type { Mesh } from './types.js';
import { MathUtils } from './math.js';

export class Scene {
  private meshes: Mesh[] = [];

  /**
   * Add mesh to scene
   */
  addMesh(mesh: Mesh): void {
    this.meshes.push(mesh);
  }

  /**
   * Get all meshes
   */
  getMeshes(): Mesh[] {
    return this.meshes;
  }

  /**
   * Clear scene
   */
  clear(): void {
    for (const mesh of this.meshes) {
      mesh.vertexBuffer.destroy();
      mesh.indexBuffer.destroy();
    }
    this.meshes = [];
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
