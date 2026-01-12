/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Progressive Geometry Loader - Priority-based batch loading
 * Processes LoadAllGeometry results in priority order to show geometry faster
 */

import type { MeshData } from './types.js';

export enum GeometryQuality {
  Fast = 'fast',       // Skip small objects, simplified geometry
  Balanced = 'balanced', // Default - all geometry
  High = 'high'        // Full quality + mesh repair
}

export interface PriorityMesh {
  index: number;
  expressId: number;
  priority: number;
  flatMesh: any; // web-ifc FlatMesh type
}

/**
 * Calculate priority score for a mesh
 * Higher score = load sooner
 */
export function calculateMeshPriority(
  flatMesh: any,
  expressId: number,
  entityIndex?: Map<number, any>
): number {
  let priority = 0;

  // Priority based on geometry count (more geometry = more important)
  const geomCount = flatMesh.geometries ? flatMesh.geometries.size() : 0;
  priority += geomCount * 10;

  // Priority based on entity type (structural elements first)
  if (entityIndex) {
    const entity = entityIndex.get(expressId);
    if (entity) {
      const type = entity.type?.toUpperCase() || '';
      if (type.includes('WALL')) priority += 100;
      if (type.includes('SLAB')) priority += 90;
      if (type.includes('BEAM')) priority += 80;
      if (type.includes('COLUMN')) priority += 85;
      if (type.includes('DOOR')) priority += 40;
      if (type.includes('WINDOW')) priority += 40;
      if (type.includes('FURNITURE')) priority += 20;
      if (type.includes('FASTENER')) priority += 5;
    }
  }

  return priority;
}

/**
 * Progressive mesh loader - processes meshes in priority batches
 */
export class ProgressiveMeshLoader {
  private quality: GeometryQuality;
  private batchSize: number;
  private yieldInterval: number; // ms between yields

  constructor(
    quality: GeometryQuality = GeometryQuality.Balanced,
    batchSize: number = 50,
    yieldInterval: number = 16 // ~60fps
  ) {
    this.quality = quality;
    this.batchSize = batchSize;
    this.yieldInterval = yieldInterval;
  }

  /**
   * Sort meshes by priority and return sorted array
   */
  prioritizeMeshes(
    geometries: any, // web-ifc LoadAllGeometry result
    entityIndex?: Map<number, any>
  ): PriorityMesh[] {
    const geomCount = geometries.size();
    const priorityMeshes: PriorityMesh[] = [];

    for (let i = 0; i < geomCount; i++) {
      const flatMesh = geometries.get(i);
      const expressId = flatMesh.expressID;
      const priority = calculateMeshPriority(flatMesh, expressId, entityIndex);

      priorityMeshes.push({
        index: i,
        expressId,
        priority,
        flatMesh,
      });
    }

    // Sort by priority (highest first)
    priorityMeshes.sort((a, b) => b.priority - a.priority);

    return priorityMeshes;
  }

  /**
   * Check if mesh should be skipped based on quality mode
   */
  shouldSkipMesh(priorityMesh: PriorityMesh, flatMesh: any): boolean {
    if (this.quality === GeometryQuality.Balanced || this.quality === GeometryQuality.High) {
      return false; // Don't skip anything
    }

    // Fast mode: skip low-priority meshes
    if (priorityMesh.priority < 10) {
      return true;
    }

    // Fast mode: skip meshes with very few geometries
    const geomCount = flatMesh.geometries ? flatMesh.geometries.size() : 0;
    if (geomCount === 0) {
      return true;
    }

    return false;
  }

  /**
   * Yield control to main thread
   */
  private async yieldToMainThread(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(), { timeout: this.yieldInterval });
      } else {
        setTimeout(() => resolve(), this.yieldInterval);
      }
    });
  }

  /**
   * Process meshes in batches with yielding
   */
  async *processBatches(
    priorityMeshes: PriorityMesh[],
    processMesh: (priorityMesh: PriorityMesh) => MeshData | null
  ): AsyncGenerator<MeshData[], void, unknown> {
    let batch: MeshData[] = [];
    let lastYieldTime = performance.now();

    for (const priorityMesh of priorityMeshes) {
      // Skip mesh if quality mode requires it
      if (this.shouldSkipMesh(priorityMesh, priorityMesh.flatMesh)) {
        continue;
      }

      const mesh = processMesh(priorityMesh);
      if (mesh) {
        batch.push(mesh);
      }

      // Yield batch if full or time elapsed
      const now = performance.now();
      if (
        batch.length >= this.batchSize ||
        (now - lastYieldTime) >= this.yieldInterval
      ) {
        if (batch.length > 0) {
          yield batch;
          batch = [];
        }
        lastYieldTime = now;
        await this.yieldToMainThread();
      }
    }

    // Yield remaining batch
    if (batch.length > 0) {
      yield batch;
    }
  }
}
