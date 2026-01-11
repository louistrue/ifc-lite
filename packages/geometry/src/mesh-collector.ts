/**
 * Mesh collector - extracts triangle data from web-ifc LoadAllGeometry
 */

import * as WebIFC from 'web-ifc';
import type { MeshData } from './types.js';

export class MeshCollector {
    private ifcApi: WebIFC.IfcAPI;
    private modelID: number;

    constructor(ifcApi: WebIFC.IfcAPI, modelID: number) {
        this.ifcApi = ifcApi;
        this.modelID = modelID;
    }

    /**
     * Collect all meshes from web-ifc
     */
    collectMeshes(): MeshData[] {
        const meshes: MeshData[] = [];
        console.log('[MeshCollector] Loading all geometry for model:', this.modelID);
        const geometries = this.ifcApi.LoadAllGeometry(this.modelID);
        const geomCount = geometries.size();
        console.log('[MeshCollector] Found', geomCount, 'flat meshes');

        let noGeometriesCount = 0;
        let failedGetGeometry = 0;
        let noVertexData = 0;
        let successCount = 0;

        for (let i = 0; i < geomCount; i++) {
            const flatMesh = geometries.get(i);
            const expressID = flatMesh.expressID;

            if (!flatMesh.geometries || flatMesh.geometries.size() === 0) {
                noGeometriesCount++;
                continue;
            }

            // Collect geometry from all placed geometries
            const positions: number[] = [];
            const normals: number[] = [];
            const indices: number[] = [];
            let indexOffset = 0;

            for (let j = 0; j < flatMesh.geometries.size(); j++) {
                const placed = flatMesh.geometries.get(j);
                try {
                    const meshGeom = this.ifcApi.GetGeometry(this.modelID, placed.geometryExpressID);
                    // GetVertexDataSize() returns TOTAL FLOATS (not vertex count)
                    // Format: [x,y,z,nx,ny,nz, x,y,z,nx,ny,nz, ...] = 6 floats per vertex
                    const totalFloats = meshGeom.GetVertexDataSize();
                    const indexSize = meshGeom.GetIndexDataSize();
                    const vertexCount = totalFloats / 6; // Actual vertex count

                    // Log first few for debugging
                    if (i < 3 && j < 2) {
                        console.log(`[MeshCollector] Geom ${i}.${j}: totalFloats=${totalFloats}, vertexCount=${vertexCount}, indexSize=${indexSize}`);
                    }

                    if (totalFloats > 0 && indexSize > 0) {
                        // GetVertexData() returns a pointer (number) to WASM heap memory
                        // We need to read from the WASM heap using the pointer
                        const vertexPtr = meshGeom.GetVertexData();
                        const indexPtr = meshGeom.GetIndexData();

                        // Access WASM heap memory
                        // web-ifc exposes the WebAssembly module with HEAPF32/HEAPU32 views
                        const wasmModule = (this.ifcApi as any).wasmModule;

                        if (!wasmModule || !wasmModule.HEAPF32) {
                            if (i < 3) console.warn('[MeshCollector] WASM module not accessible');
                            noVertexData++;
                            continue;
                        }

                        // Calculate byte offsets (pointers are byte offsets)
                        // totalFloats is the total number of floats in the buffer
                        const vertexByteOffset = vertexPtr / 4; // Float32 is 4 bytes
                        const indexByteOffset = indexPtr / 4;   // Uint32 is 4 bytes

                        // Create copies from WASM heap
                        const vertexData = new Float32Array(
                            wasmModule.HEAPF32.buffer,
                            vertexByteOffset * 4,
                            totalFloats
                        ).slice(); // slice() creates a copy

                        const indexData = new Uint32Array(
                            wasmModule.HEAPU32.buffer,
                            indexByteOffset * 4,
                            indexSize
                        ).slice(); // slice() creates a copy

                        if (i < 3 && j < 2) {
                            console.log(`[MeshCollector] vertexData:`, vertexData.length, 'floats, first 6:', Array.from(vertexData.slice(0, 6)));
                            console.log(`[MeshCollector] indexData:`, indexData.length, 'indices, first 3:', Array.from(indexData.slice(0, 3)));
                        }

                        if (vertexData && vertexData.length > 0) {
                            // Get transformation matrix from placed geometry
                            // flatTransformation is a 4x4 matrix in column-major order (16 elements)
                            const transformRaw = placed.flatTransformation;

                            // Convert to number array for easier access
                            // Handle both Array and TypedArray (Float32Array, etc.)
                            let m: number[] | null = null;
                            if (transformRaw) {
                                if (Array.isArray(transformRaw)) {
                                    m = transformRaw;
                                } else if (ArrayBuffer.isView(transformRaw)) {
                                    // Cast to any to work around TypeScript's strict ArrayBufferView typing
                                    const typedArray = transformRaw as any;
                                    if (typedArray.length === 16) {
                                        m = Array.from(typedArray);
                                    }
                                }
                            }

                            // Validate transformation matrix
                            const hasValidTransform = m &&
                                m.length === 16 &&
                                Number.isFinite(m[0]) &&
                                Number.isFinite(m[15]);

                            // Extract positions and normals, applying transformation
                            for (let k = 0; k < vertexCount; k++) {
                                const base = k * 6;
                                if (base + 5 < vertexData.length) {
                                    // Local coordinates
                                    const x = vertexData[base];
                                    const y = vertexData[base + 1];
                                    const z = vertexData[base + 2];
                                    const nx = vertexData[base + 3];
                                    const ny = vertexData[base + 4];
                                    const nz = vertexData[base + 5];

                                    if (hasValidTransform && m) {
                                        // Transform position: worldPos = matrix * localPos
                                        // Column-major matrix: m[0-3] = col0, m[4-7] = col1, m[8-11] = col2, m[12-15] = col3
                                        const transformedX = m[0] * x + m[4] * y + m[8] * z + m[12];
                                        const transformedY = m[1] * x + m[5] * y + m[9] * z + m[13];
                                        const transformedZ = m[2] * x + m[6] * y + m[10] * z + m[14];

                                        // web-ifc outputs Y-up coordinates, matching WebGL convention
                                        positions.push(transformedX, transformedY, transformedZ);

                                        // Transform normal (rotation only, using upper-left 3x3 of matrix)
                                        const tnx = m[0] * nx + m[4] * ny + m[8] * nz;
                                        const tny = m[1] * nx + m[5] * ny + m[9] * nz;
                                        const tnz = m[2] * nx + m[6] * ny + m[10] * nz;

                                        const finalNX = tnx;
                                        const finalNY = tny;
                                        const finalNZ = tnz;

                                        // Renormalize (handles non-uniform scaling)
                                        const len = Math.sqrt(finalNX * finalNX + finalNY * finalNY + finalNZ * finalNZ);
                                        if (len > 1e-10) {
                                            normals.push(finalNX / len, finalNY / len, finalNZ / len);
                                        } else {
                                            // Fallback if normal becomes zero (shouldn't happen)
                                            normals.push(finalNX, finalNY, finalNZ);
                                        }
                                    } else {
                                        // No transformation matrix - use raw coordinates
                                        // web-ifc already outputs Y-up coordinates
                                        positions.push(x, y, z);
                                        normals.push(nx, ny, nz);
                                    }
                                }
                            }

                            // Extract indices with offset
                            if (indexData && indexData.length > 0) {
                                for (let k = 0; k < indexData.length; k++) {
                                    indices.push(indexData[k] + indexOffset);
                                }
                                indexOffset += vertexCount;
                            }
                            successCount++;
                        } else {
                            noVertexData++;
                        }
                    } else {
                        noVertexData++;
                    }
                } catch (e) {
                    failedGetGeometry++;
                    // Only log first few errors to avoid spam
                    if (failedGetGeometry <= 3) {
                        console.warn(`[MeshCollector] Failed to get geometry for expressID ${placed.geometryExpressID}:`, e);
                    }
                }
            }

            if (positions.length > 0) {
                meshes.push({
                    expressId: expressID,
                    positions: new Float32Array(positions),
                    normals: new Float32Array(normals),
                    indices: new Uint32Array(indices),
                    color: [0.8, 0.8, 0.8, 1.0], // Default gray
                });
            }
        }

        console.log('[MeshCollector] Stats:', {
            total: geomCount,
            noGeometries: noGeometriesCount,
            failedGetGeometry,
            noVertexData,
            successfulGeoms: successCount,
            outputMeshes: meshes.length,
        });

        return meshes;
    }
}
