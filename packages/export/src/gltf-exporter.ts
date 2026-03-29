/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * glTF/GLB exporter
 */

import type { GeometryResult, MeshData } from '@ifc-lite/geometry';

// GLTF 2.0 type definitions (subset needed for export)
interface GLTFAsset {
    version: string;
    generator: string;
    extras?: Record<string, unknown>;
}

interface GLTFScene {
    nodes: number[];
}

interface GLTFNode {
    mesh?: number;
    name?: string;
    extras?: Record<string, unknown>;
}

interface GLTFMesh {
    primitives: GLTFPrimitive[];
    name?: string;
}

interface GLTFMaterial {
    pbrMetallicRoughness: {
        baseColorFactor: [number, number, number, number];
        metallicFactor: number;
        roughnessFactor: number;
    };
    name?: string;
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
}

interface GLTFPrimitive {
    attributes: {
        POSITION: number;
        NORMAL?: number;
    };
    indices?: number;
    material?: number;
    mode?: number;
}

interface GLTFAccessor {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';
    min?: number[];
    max?: number[];
}

interface GLTFBufferView {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
}

interface GLTFBuffer {
    byteLength: number;
    uri?: string;
}

interface GLTFDocument {
    asset: GLTFAsset;
    scene: number;
    scenes: GLTFScene[];
    nodes: GLTFNode[];
    meshes: GLTFMesh[];
    materials?: GLTFMaterial[];
    accessors: GLTFAccessor[];
    bufferViews: GLTFBufferView[];
    buffers: GLTFBuffer[];
}

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

    private buildGLTF(options: GLTFExportOptions): { json: GLTFDocument; buffers: Uint8Array[] } {
        const meshes = this.geometryResult.meshes;

        const gltf: GLTFDocument = {
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

        // Build materials from mesh colors (deduplicate by rounded RGBA key)
        const materialMap = new Map<string, number>();
        const materials: GLTFMaterial[] = [];

        function getOrCreateMaterial(color: [number, number, number, number]): number {
            // Round to 2 decimals to deduplicate near-identical colors
            const r = Math.round(color[0] * 100) / 100;
            const g = Math.round(color[1] * 100) / 100;
            const b = Math.round(color[2] * 100) / 100;
            const a = Math.round(color[3] * 100) / 100;
            const key = `${r},${g},${b},${a}`;
            const existing = materialMap.get(key);
            if (existing !== undefined) return existing;
            const idx = materials.length;
            materials.push({
                pbrMetallicRoughness: {
                    baseColorFactor: [r, g, b, a],
                    metallicFactor: 0,
                    roughnessFactor: 0.7,
                },
                ...(a < 1 ? { alphaMode: 'BLEND' as const } : {}),
            });
            materialMap.set(key, idx);
            return idx;
        }

        // ── Pass 1: collect metadata and calculate total sizes ──────────
        // We avoid intermediate JS arrays (positions: number[]) because
        // Array.push(...typedArray) hits the JS engine argument limit on
        // large models (109K meshes, 16M+ vertices).

        type MeshMeta = {
            meshIndex: number;
            posCount: number;   // float count
            normCount: number;
            idxCount: number;
            posByteOffset: number;
            normByteOffset: number;
            idxByteOffset: number;
            bounds: { min: number[]; max: number[] };
            materialIdx: number | undefined;
        };

        const meshMetas: MeshMeta[] = [];
        let totalPosFloats = 0;
        let totalNormFloats = 0;
        let totalIdxInts = 0;

        for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            const mp = mesh.positions;
            const mn = mesh.normals;
            const mi = mesh.indices;

            if (!mp.length || !mn.length || !mi.length) continue;
            if (mp.length % 3 !== 0 || mn.length % 3 !== 0) continue;

            // Calculate bounds directly from the typed array
            let minX = mp[0], minY = mp[1], minZ = mp[2];
            let maxX = mp[0], maxY = mp[1], maxZ = mp[2];
            for (let j = 3; j < mp.length; j += 3) {
                const x = mp[j], y = mp[j + 1], z = mp[j + 2];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }

            meshMetas.push({
                meshIndex: i,
                posCount: mp.length,
                normCount: mn.length,
                idxCount: mi.length,
                posByteOffset: totalPosFloats * 4,
                normByteOffset: totalNormFloats * 4,
                idxByteOffset: totalIdxInts * 4,
                bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
                materialIdx: mesh.color ? getOrCreateMaterial(mesh.color) : undefined,
            });

            totalPosFloats += mp.length;
            totalNormFloats += mn.length;
            totalIdxInts += mi.length;
        }

        if (totalPosFloats === 0 || totalNormFloats === 0 || totalIdxInts === 0) {
            throw new Error('Cannot export GLB: no valid geometry data found');
        }

        // ── Pass 2: build glTF structure and copy geometry into typed arrays ──

        const positionsArray = new Float32Array(totalPosFloats);
        const normalsArray = new Float32Array(totalNormFloats);
        const indicesArray = new Uint32Array(totalIdxInts);

        let posOffset = 0;
        let normOffset = 0;
        let idxOffset = 0;

        const nodeIndices: number[] = [];

        for (const meta of meshMetas) {
            const mesh = meshes[meta.meshIndex];

            // Copy geometry data directly (no intermediate array)
            positionsArray.set(mesh.positions, posOffset);
            normalsArray.set(mesh.normals, normOffset);
            indicesArray.set(mesh.indices, idxOffset);

            posOffset += meta.posCount;
            normOffset += meta.normCount;
            idxOffset += meta.idxCount;

            // Accessors
            const posAccessorIdx = gltf.accessors.length;
            gltf.accessors.push({
                bufferView: 0,
                byteOffset: meta.posByteOffset,
                componentType: 5126,
                count: meta.posCount / 3,
                type: 'VEC3',
                min: meta.bounds.min,
                max: meta.bounds.max,
            });

            const normAccessorIdx = gltf.accessors.length;
            gltf.accessors.push({
                bufferView: 1,
                byteOffset: meta.normByteOffset,
                componentType: 5126,
                count: meta.normCount / 3,
                type: 'VEC3',
            });

            const idxAccessorIdx = gltf.accessors.length;
            gltf.accessors.push({
                bufferView: 2,
                byteOffset: meta.idxByteOffset,
                componentType: 5125,
                count: meta.idxCount,
                type: 'SCALAR',
            });

            // Mesh with material
            const meshIdx = gltf.meshes.length;
            gltf.meshes.push({
                primitives: [{
                    attributes: {
                        POSITION: posAccessorIdx,
                        NORMAL: normAccessorIdx,
                    },
                    indices: idxAccessorIdx,
                    ...(meta.materialIdx !== undefined ? { material: meta.materialIdx } : {}),
                }],
            });

            // Node
            const nodeIdx = gltf.nodes.length;
            const node: GLTFNode = { mesh: meshIdx };
            if (options.includeMetadata && mesh.expressId) {
                node.extras = { expressId: mesh.expressId };
            }
            gltf.nodes.push(node);
            nodeIndices.push(nodeIdx);
        }

        gltf.scenes[0].nodes = nodeIndices;

        // Attach materials if any were created
        if (materials.length > 0) {
            gltf.materials = materials;
        }

        // Buffer views
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

    private packGLB(gltfJson: GLTFDocument, buffers: Uint8Array[]): Uint8Array {
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
