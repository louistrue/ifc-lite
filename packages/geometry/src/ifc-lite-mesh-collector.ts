/**
 * IFC-Lite Mesh Collector - extracts triangle data from IFC-Lite WASM
 * Replaces mesh-collector.ts - uses native Rust geometry processing (1.9x faster)
 */

import type { IfcAPI } from '@ifc-lite/wasm';
import type { MeshData } from './types.js';

export class IfcLiteMeshCollector {
  private ifcApi: IfcAPI;
  private content: string;

  constructor(ifcApi: IfcAPI, content: string) {
    this.ifcApi = ifcApi;
    this.content = content;
  }

  /**
   * Collect all meshes from IFC-Lite
   * Much faster than web-ifc (~1.9x speedup)
   */
  collectMeshes(): MeshData[] {
    const totalStart = performance.now();

    console.log('[IfcLiteMeshCollector] Parsing meshes...');
    const parseStart = performance.now();
    const collection = this.ifcApi.parseMeshes(this.content);
    const parseTime = performance.now() - parseStart;
    console.log(`[IfcLiteMeshCollector] Parse time: ${parseTime.toFixed(2)}ms, found ${collection.length} meshes`);

    const meshes: MeshData[] = [];
    const conversionStart = performance.now();

    // Convert MeshCollection to MeshData[]
    for (let i = 0; i < collection.length; i++) {
      const mesh = collection.get(i);
      if (!mesh) continue;

      // Get color array [r, g, b, a]
      const colorArray = mesh.color;
      const color: [number, number, number, number] = [
        colorArray[0],
        colorArray[1],
        colorArray[2],
        colorArray[3],
      ];

      meshes.push({
        expressId: mesh.expressId,
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        color,
      });

      // Free the individual mesh to avoid memory leaks
      mesh.free();
    }

    // Store stats before freeing
    const totalVertices = collection.totalVertices;
    const totalTriangles = collection.totalTriangles;

    // Free the collection
    collection.free();

    const conversionTime = performance.now() - conversionStart;
    const totalTime = performance.now() - totalStart;

    console.log('[IfcLiteMeshCollector] Stats:', {
      meshCount: meshes.length,
      totalVertices,
      totalTriangles,
    });

    console.log('[IfcLiteMeshCollector] Performance:', {
      parseTime: `${parseTime.toFixed(2)}ms`,
      conversionTime: `${conversionTime.toFixed(2)}ms`,
      totalTime: `${totalTime.toFixed(2)}ms`,
    });

    return meshes;
  }

  /**
   * Collect meshes incrementally, yielding batches for progressive rendering
   * @param batchSize Number of meshes per batch (default: 100)
   */
  async *collectMeshesStreaming(batchSize: number = 100): AsyncGenerator<MeshData[]> {
    const totalStart = performance.now();

    console.log('[IfcLiteMeshCollector] Parsing meshes for streaming...');
    const parseStart = performance.now();
    const collection = this.ifcApi.parseMeshes(this.content);
    const parseTime = performance.now() - parseStart;
    console.log(`[IfcLiteMeshCollector] Parse time: ${parseTime.toFixed(2)}ms, found ${collection.length} meshes`);

    let batch: MeshData[] = [];
    let processedCount = 0;

    // Process meshes in batches
    for (let i = 0; i < collection.length; i++) {
      const mesh = collection.get(i);
      if (!mesh) continue;

      // Get color array [r, g, b, a]
      const colorArray = mesh.color;
      const color: [number, number, number, number] = [
        colorArray[0],
        colorArray[1],
        colorArray[2],
        colorArray[3],
      ];

      batch.push({
        expressId: mesh.expressId,
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        color,
      });

      // Free the individual mesh
      mesh.free();
      processedCount++;

      // Yield batch when full
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
        // Yield to UI thread
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Yield remaining meshes
    if (batch.length > 0) {
      yield batch;
    }

    // Free the collection
    collection.free();

    const totalTime = performance.now() - totalStart;
    console.log(`[IfcLiteMeshCollector] Streaming complete: ${totalTime.toFixed(2)}ms, total meshes: ${processedCount}`);
  }
}
