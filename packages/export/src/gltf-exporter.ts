/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * glTF/GLB exporter
 */

import type { GeometryResult } from '@ifc-lite/geometry';

export interface GLTFExportOptions {
    useInstancing?: boolean;
    includeMetadata?: boolean;
}

export class GLTFExporter {
    private geometryResult: GeometryResult;

    constructor(geometryResult: GeometryResult) {
        this.geometryResult = geometryResult;
    }

    /**
     * Export to GLB (binary glTF)
     */
    exportGLB(options: GLTFExportOptions = {}): Uint8Array {
        const gltf = this.buildGLTF(options);
        return this.packGLB(gltf.json, gltf.buffers);
    }

    /**
     * Export to glTF (JSON + separate .bin)
     */
    exportGLTF(options: GLTFExportOptions = {}): { json: string; bin: Uint8Array } {
        const gltf = this.buildGLTF(options);
        return {
            json: JSON.stringify(gltf.json, null, 2),
            bin: this.combineBuffers(gltf.buffers),
        };
    }

    private buildGLTF(options: GLTFExportOptions): { json: any; buffers: Uint8Array[] } {
        const meshes = this.geometryResult.meshes;

        const gltf: any = {
            asset: {
                version: '2.0',
                generator: 'IFC-Lite',
            },
            scene: 0,
            scenes: [{ nodes: [] }],
            nodes: [],
            meshes: [],
            accessors: [],
            bufferViews: [],
            buffers: [{ byteLength: 0 }],
        };

        if (options.includeMetadata) {
            gltf.asset.extras = {
                meshCount: meshes.length,
                vertexCount: this.geometryResult.totalVertices,
                triangleCount: this.geometryResult.totalTriangles,
            };
        }

        // Collect geometry data
        const positions: number[] = [];
        const normals: number[] = [];
        const indices: number[] = [];

        const nodeIndices: number[] = [];

        // Helper function to calculate min/max bounds for positions
        const calculateBounds = (positions: number[]): { min: number[]; max: number[] } => {
            if (positions.length === 0) {
                return { min: [0, 0, 0], max: [0, 0, 0] };
            }
            let minX = positions[0];
            let minY = positions[1];
            let minZ = positions[2];
            let maxX = positions[0];
            let maxY = positions[1];
            let maxZ = positions[2];

            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i];
                const y = positions[i + 1];
                const z = positions[i + 2];
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                minZ = Math.min(minZ, z);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                maxZ = Math.max(maxZ, z);
            }

            return {
                min: [minX, minY, minZ],
                max: [maxX, maxY, maxZ],
            };
        };

        for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i] as any;
            const meshPositions = (mesh.positions || []) as Float32Array | number[];
            const meshNormals = (mesh.normals || []) as Float32Array | number[];
            const meshIndices = (mesh.indices || []) as Uint32Array | number[];

            // Skip empty meshes
            if (!meshPositions.length || !meshNormals.length || !meshIndices.length) {
                console.warn(`Skipping empty mesh ${i} (positions: ${meshPositions.length}, normals: ${meshNormals.length}, indices: ${meshIndices.length})`);
                continue;
            }

            // Validate array lengths are multiples of 3 for positions/normals
            if (meshPositions.length % 3 !== 0) {
                console.warn(`Mesh ${i} has invalid position count: ${meshPositions.length} (not divisible by 3)`);
                continue;
            }
            if (meshNormals.length % 3 !== 0) {
                console.warn(`Mesh ${i} has invalid normal count: ${meshNormals.length} (not divisible by 3)`);
                continue;
            }

            // Calculate byte offsets BEFORE adding data (based on current array lengths)
            const positionByteOffset = positions.length * 4; // Each float is 4 bytes
            const normalByteOffset = normals.length * 4;
            const indexByteOffset = indices.length * 4;

            const meshPositionsArray = Array.from(meshPositions);
            const meshNormalsArray = Array.from(meshNormals);
            const meshIndicesArray = Array.from(meshIndices);

            positions.push(...meshPositionsArray);
            normals.push(...meshNormalsArray);

            // Indices stay local (0-based) for each mesh since each mesh has its own
            // accessor pointing to its own section of the bufferView
            indices.push(...meshIndicesArray);

            // Calculate bounds for this mesh's positions
            const bounds = calculateBounds(meshPositionsArray);

            // Accessors - byteOffset is relative to the bufferView start
            const posAccessorIdx = gltf.accessors.length;
            gltf.accessors.push({
                bufferView: 0,
                byteOffset: positionByteOffset,
                componentType: 5126, // FLOAT
                count: meshPositions.length / 3,
                type: 'VEC3',
                min: bounds.min,
                max: bounds.max,
            });

            const normAccessorIdx = gltf.accessors.length;
            gltf.accessors.push({
                bufferView: 1,
                byteOffset: normalByteOffset,
                componentType: 5126,
                count: meshNormals.length / 3,
                type: 'VEC3',
            });

            const idxAccessorIdx = gltf.accessors.length;
            gltf.accessors.push({
                bufferView: 2,
                byteOffset: indexByteOffset,
                componentType: 5125, // UNSIGNED_INT
                count: meshIndices.length,
                type: 'SCALAR',
            });

            // Mesh
            const meshIdx = gltf.meshes.length;
            gltf.meshes.push({
                primitives: [{
                    attributes: {
                        POSITION: posAccessorIdx,
                        NORMAL: normAccessorIdx,
                    },
                    indices: idxAccessorIdx,
                }],
            });

            // Node
            const nodeIdx = gltf.nodes.length;
            const node: any = {
                mesh: meshIdx,
            };

            if (options.includeMetadata && mesh.expressId) {
                node.extras = {
                    expressId: mesh.expressId,
                };
            }

            gltf.nodes.push(node);
            nodeIndices.push(nodeIdx);
        }

        gltf.scenes[0].nodes = nodeIndices;

        // Ensure we have data before creating buffers
        if (positions.length === 0 || normals.length === 0 || indices.length === 0) {
            throw new Error('Cannot export GLB: no valid geometry data found');
        }

        // Buffer views - create typed arrays and get their byte buffers
        const positionsArray = new Float32Array(positions);
        const normalsArray = new Float32Array(normals);
        const indicesArray = new Uint32Array(indices);

        const positionsBytes = positionsArray.buffer;
        const normalsBytes = normalsArray.buffer;
        const indicesBytes = indicesArray.buffer;

        const totalBufferSize = positionsBytes.byteLength + normalsBytes.byteLength + indicesBytes.byteLength;

        // Create bufferViews
        // byteStride is set to the element size (12 bytes for VEC3 FLOAT) for non-interleaved data
        // This satisfies validators that require byteStride when multiple accessors share a bufferView
        gltf.bufferViews.push({
            buffer: 0,
            byteOffset: 0,
            byteLength: positionsBytes.byteLength,
            byteStride: 12, // 3 floats * 4 bytes = 12 bytes per VEC3
            target: 34962, // ARRAY_BUFFER
        });

        gltf.bufferViews.push({
            buffer: 0,
            byteOffset: positionsBytes.byteLength,
            byteLength: normalsBytes.byteLength,
            byteStride: 12, // 3 floats * 4 bytes = 12 bytes per VEC3
            target: 34962,
        });

        gltf.bufferViews.push({
            buffer: 0,
            byteOffset: positionsBytes.byteLength + normalsBytes.byteLength,
            byteLength: indicesBytes.byteLength,
            // No byteStride for indices (ELEMENT_ARRAY_BUFFER)
            target: 34963, // ELEMENT_ARRAY_BUFFER
        });

        gltf.buffers[0].byteLength = totalBufferSize;

        // Validate that all accessors fit within their bufferViews
        for (const accessor of gltf.accessors) {
            const bufferView = gltf.bufferViews[accessor.bufferView];
            if (!bufferView) {
                throw new Error(`Accessor references invalid bufferView ${accessor.bufferView}`);
            }

            // Calculate accessor byte length
            let componentSize = 0;
            if (accessor.componentType === 5126) componentSize = 4; // FLOAT
            else if (accessor.componentType === 5125) componentSize = 4; // UNSIGNED_INT
            else if (accessor.componentType === 5123) componentSize = 2; // UNSIGNED_SHORT
            else if (accessor.componentType === 5120) componentSize = 1; // BYTE
            else throw new Error(`Unsupported component type: ${accessor.componentType}`);

            let componentsPerElement = 1;
            if (accessor.type === 'VEC3') componentsPerElement = 3;
            else if (accessor.type === 'VEC2') componentsPerElement = 2;
            else if (accessor.type === 'SCALAR') componentsPerElement = 1;
            else throw new Error(`Unsupported accessor type: ${accessor.type}`);

            const accessorByteLength = accessor.count * componentsPerElement * componentSize;
            const accessorEnd = (accessor.byteOffset || 0) + accessorByteLength;

            if (accessorEnd > bufferView.byteLength) {
                throw new Error(
                    `Accessor exceeds bufferView bounds: ` +
                    `accessor byteOffset=${accessor.byteOffset || 0}, length=${accessorByteLength}, ` +
                    `bufferView byteLength=${bufferView.byteLength}, end=${accessorEnd}`
                );
            }
        }

        return {
            json: gltf,
            buffers: [
                new Uint8Array(positionsBytes),
                new Uint8Array(normalsBytes),
                new Uint8Array(indicesBytes),
            ],
        };
    }

    private combineBuffers(buffers: Uint8Array[]): Uint8Array {
        const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
            combined.set(buffer, offset);
            offset += buffer.byteLength;
        }
        return combined;
    }

    private packGLB(gltfJson: any, buffers: Uint8Array[]): Uint8Array {
        const jsonString = JSON.stringify(gltfJson);
        const jsonBuffer = new TextEncoder().encode(jsonString);

        const jsonPadding = (4 - (jsonBuffer.byteLength % 4)) % 4;
        const paddedJsonLength = jsonBuffer.byteLength + jsonPadding;

        const bin = this.combineBuffers(buffers);
        const binPadding = (4 - (bin.byteLength % 4)) % 4;
        const paddedBinLength = bin.byteLength + binPadding;

        const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
        const glb = new ArrayBuffer(totalLength);
        const view = new DataView(glb);
        const bytes = new Uint8Array(glb);

        let offset = 0;

        // GLB header
        view.setUint32(offset, 0x46546C67, true); // 'glTF'
        offset += 4;
        view.setUint32(offset, 2, true);
        offset += 4;
        view.setUint32(offset, totalLength, true);
        offset += 4;

        // JSON chunk
        view.setUint32(offset, paddedJsonLength, true);
        offset += 4;
        view.setUint32(offset, 0x4E4F534A, true); // 'JSON'
        offset += 4;
        bytes.set(jsonBuffer, offset);
        offset += jsonBuffer.byteLength;
        for (let i = 0; i < jsonPadding; i++) {
            bytes[offset++] = 0x20;
        }

        // BIN chunk
        view.setUint32(offset, paddedBinLength, true);
        offset += 4;
        view.setUint32(offset, 0x004E4942, true); // 'BIN\0'
        offset += 4;
        bytes.set(bin, offset);

        return new Uint8Array(glb);
    }
}
