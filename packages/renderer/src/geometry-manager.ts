/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * GeometryManager - Handles loading, adding, removing, and coloring geometry meshes.
 * Extracted from the Renderer class to use composition pattern.
 */

import { WebGPUDevice } from './device.js';
import { RenderPipeline, InstancedRenderPipeline } from './pipeline.js';
import { Scene } from './scene.js';
import { MathUtils } from './math.js';
import { deduplicateMeshes } from '@ifc-lite/geometry';
import type { MeshData } from '@ifc-lite/geometry';
import type { InstancedGeometry } from '@ifc-lite/wasm';
import type { Mesh, InstancedMesh } from './types.js';

export class GeometryManager {
    private device: WebGPUDevice;
    private scene: Scene;
    private modelBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null = null;

    constructor(device: WebGPUDevice, scene: Scene) {
        this.device = device;
        this.scene = scene;
    }

    /**
     * Get model bounds (used by Renderer for section planes, fitToView, etc.)
     */
    getModelBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
        return this.modelBounds;
    }

    /**
     * Set model bounds (used by Renderer when computing bounds from batches)
     */
    setModelBounds(bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): void {
        this.modelBounds = bounds;
    }

    /**
     * Load geometry from GeometryResult or MeshData array
     * This is the main entry point for loading IFC geometry into the renderer
     *
     * @param geometry - Either a GeometryResult from geometry.process() or an array of MeshData
     * @param pipeline - The render pipeline (must be initialized)
     */
    loadGeometry(geometry: import('@ifc-lite/geometry').GeometryResult | import('@ifc-lite/geometry').MeshData[], pipeline: RenderPipeline): void {
        if (!this.device.isInitialized() || !pipeline) {
            throw new Error('Renderer not initialized. Call init() first.');
        }

        const meshes = Array.isArray(geometry) ? geometry : geometry.meshes;

        if (meshes.length === 0) {
            console.warn('[Renderer] loadGeometry called with empty mesh array');
            return;
        }

        // Use batched rendering for optimal performance
        const device = this.device.getDevice();
        this.scene.appendToBatches(meshes, device, pipeline, false);

        // Calculate and store model bounds for fitToView
        this.updateModelBounds(meshes);

        console.log(`[Renderer] Loaded ${meshes.length} meshes`);
    }

    /**
     * Add multiple meshes to the scene (convenience method for streaming)
     *
     * @param meshes - Array of MeshData to add
     * @param pipeline - The render pipeline (must be initialized)
     * @param isStreaming - If true, throttles batch rebuilding for better streaming performance
     */
    addMeshes(meshes: import('@ifc-lite/geometry').MeshData[], pipeline: RenderPipeline, isStreaming: boolean = false): void {
        if (!this.device.isInitialized() || !pipeline) {
            throw new Error('Renderer not initialized. Call init() first.');
        }

        if (meshes.length === 0) return;

        const device = this.device.getDevice();
        this.scene.appendToBatches(meshes, device, pipeline, isStreaming);

        // Update model bounds incrementally
        this.updateModelBounds(meshes);
    }

    /**
     * Update model bounds from mesh data
     */
    private updateModelBounds(meshes: import('@ifc-lite/geometry').MeshData[]): void {
        if (!this.modelBounds) {
            this.modelBounds = {
                min: { x: Infinity, y: Infinity, z: Infinity },
                max: { x: -Infinity, y: -Infinity, z: -Infinity }
            };
        }

        for (const mesh of meshes) {
            const positions = mesh.positions;
            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i];
                const y = positions[i + 1];
                const z = positions[i + 2];
                if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                    this.modelBounds.min.x = Math.min(this.modelBounds.min.x, x);
                    this.modelBounds.min.y = Math.min(this.modelBounds.min.y, y);
                    this.modelBounds.min.z = Math.min(this.modelBounds.min.z, z);
                    this.modelBounds.max.x = Math.max(this.modelBounds.max.x, x);
                    this.modelBounds.max.y = Math.max(this.modelBounds.max.y, y);
                    this.modelBounds.max.z = Math.max(this.modelBounds.max.z, z);
                }
            }
        }
    }

    /**
     * Add mesh to scene with per-mesh GPU resources for unique colors
     */
    addMesh(mesh: Mesh, pipeline: RenderPipeline): void {
        // Create per-mesh uniform buffer and bind group if not already created
        if (!mesh.uniformBuffer && pipeline && this.device.isInitialized()) {
            const device = this.device.getDevice();

            // Create uniform buffer for this mesh
            mesh.uniformBuffer = device.createBuffer({
                size: pipeline.getUniformBufferSize(),
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Create bind group for this mesh
            mesh.bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: mesh.uniformBuffer },
                    },
                ],
            });
        }

        this.scene.addMesh(mesh);
    }

    /**
     * Add instanced geometry to scene
     * Converts InstancedGeometry from geometry package to InstancedMesh for rendering
     */
    addInstancedGeometry(geometry: InstancedGeometry, instancedPipeline: InstancedRenderPipeline): void {
        if (!instancedPipeline || !this.device.isInitialized()) {
            throw new Error('Renderer not initialized. Call init() first.');
        }

        const device = this.device.getDevice();

        // Upload positions and normals interleaved
        const vertexCount = geometry.positions.length / 3;
        const vertexData = new Float32Array(vertexCount * 6);
        for (let i = 0; i < vertexCount; i++) {
            vertexData[i * 6 + 0] = geometry.positions[i * 3 + 0];
            vertexData[i * 6 + 1] = geometry.positions[i * 3 + 1];
            vertexData[i * 6 + 2] = geometry.positions[i * 3 + 2];
            vertexData[i * 6 + 3] = geometry.normals[i * 3 + 0];
            vertexData[i * 6 + 4] = geometry.normals[i * 3 + 1];
            vertexData[i * 6 + 5] = geometry.normals[i * 3 + 2];
        }

        // Create vertex buffer with exact size needed (ensure it matches data size)
        const vertexBufferSize = vertexData.byteLength;
        const vertexBuffer = device.createBuffer({
            size: vertexBufferSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        // Create index buffer
        const indexBuffer = device.createBuffer({
            size: geometry.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(indexBuffer, 0, geometry.indices);

        // Create instance buffer: each instance is 80 bytes (20 floats: 16 for transform + 4 for color)
        const instanceCount = geometry.instance_count;
        const instanceData = new Float32Array(instanceCount * 20);
        const expressIdToInstanceIndex = new Map<number, number>();

        for (let i = 0; i < instanceCount; i++) {
            const instance = geometry.get_instance(i);
            if (!instance) continue;

            const baseIdx = i * 20;

            // Copy transform (16 floats)
            instanceData.set(instance.transform, baseIdx);

            // Copy color (4 floats)
            instanceData[baseIdx + 16] = instance.color[0];
            instanceData[baseIdx + 17] = instance.color[1];
            instanceData[baseIdx + 18] = instance.color[2];
            instanceData[baseIdx + 19] = instance.color[3];

            expressIdToInstanceIndex.set(instance.expressId, i);
        }

        const instanceBuffer = device.createBuffer({
            size: instanceData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(instanceBuffer, 0, instanceData);

        // Create and cache bind group to avoid per-frame allocation
        const bindGroup = instancedPipeline.createInstanceBindGroup(instanceBuffer);

        const instancedMesh: InstancedMesh = {
            geometryId: Number(geometry.geometryId),
            vertexBuffer,
            indexBuffer,
            indexCount: geometry.indices.length,
            instanceBuffer,
            instanceCount: instanceCount,
            expressIdToInstanceIndex,
            bindGroup,
        };

        this.scene.addInstancedMesh(instancedMesh);
    }

    /**
     * Convert MeshData array to instanced meshes for optimized rendering
     * Groups identical geometries and creates GPU instanced draw calls
     * Call this in background after initial streaming completes
     */
    convertToInstanced(meshDataArray: import('@ifc-lite/geometry').MeshData[], instancedPipeline: InstancedRenderPipeline): void {
        if (!instancedPipeline || !this.device.isInitialized()) {
            console.warn('[Renderer] Cannot convert to instanced: renderer not initialized');
            return;
        }

        // Use deduplication function to group identical geometries
        const instancedData = deduplicateMeshes(meshDataArray);

        const device = this.device.getDevice();
        let totalInstances = 0;

        for (const group of instancedData) {
            // Create vertex buffer (interleaved positions + normals)
            const vertexCount = group.positions.length / 3;
            const vertexData = new Float32Array(vertexCount * 6);
            for (let i = 0; i < vertexCount; i++) {
                vertexData[i * 6 + 0] = group.positions[i * 3 + 0];
                vertexData[i * 6 + 1] = group.positions[i * 3 + 1];
                vertexData[i * 6 + 2] = group.positions[i * 3 + 2];
                vertexData[i * 6 + 3] = group.normals[i * 3 + 0];
                vertexData[i * 6 + 4] = group.normals[i * 3 + 1];
                vertexData[i * 6 + 5] = group.normals[i * 3 + 2];
            }

            const vertexBuffer = device.createBuffer({
                size: vertexData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(vertexBuffer, 0, vertexData);

            // Create index buffer
            const indexBuffer = device.createBuffer({
                size: group.indices.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(indexBuffer, 0, group.indices);

            // Create instance buffer: each instance is 80 bytes (20 floats: 16 for transform + 4 for color)
            const instanceCount = group.instances.length;
            const instanceData = new Float32Array(instanceCount * 20);
            const expressIdToInstanceIndex = new Map<number, number>();

            // Identity matrix for now (instances use same geometry, different colors)
            const identityTransform = new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]);

            for (let i = 0; i < instanceCount; i++) {
                const instance = group.instances[i];
                const baseIdx = i * 20;

                // Copy identity transform (16 floats)
                instanceData.set(identityTransform, baseIdx);

                // Copy color (4 floats)
                instanceData[baseIdx + 16] = instance.color[0];
                instanceData[baseIdx + 17] = instance.color[1];
                instanceData[baseIdx + 18] = instance.color[2];
                instanceData[baseIdx + 19] = instance.color[3];

                expressIdToInstanceIndex.set(instance.expressId, i);
            }

            const instanceBuffer = device.createBuffer({
                size: instanceData.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(instanceBuffer, 0, instanceData);

            // Create and cache bind group to avoid per-frame allocation
            const bindGroup = instancedPipeline.createInstanceBindGroup(instanceBuffer);

            // Convert hash string to number for geometryId
            const geometryId = this.hashStringToNumber(group.geometryHash);

            const instancedMesh: InstancedMesh = {
                geometryId,
                vertexBuffer,
                indexBuffer,
                indexCount: group.indices.length,
                instanceBuffer,
                instanceCount: instanceCount,
                expressIdToInstanceIndex,
                bindGroup,
            };

            this.scene.addInstancedMesh(instancedMesh);
            totalInstances += instanceCount;
        }

        // Clear regular meshes after conversion to avoid double rendering
        const regularMeshCount = this.scene.getMeshes().length;
        this.scene.clearRegularMeshes();

        console.log(
            `[Renderer] Converted ${meshDataArray.length} meshes to ${instancedData.length} instanced geometries ` +
            `(${totalInstances} total instances, ${(totalInstances / instancedData.length).toFixed(1)}x deduplication). ` +
            `Cleared ${regularMeshCount} regular meshes.`
        );
    }

    /**
     * Hash string to number for geometryId
     */
    private hashStringToNumber(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Create a GPU Mesh from MeshData (lazy creation for selection highlighting)
     * This is called on-demand when a mesh is selected, avoiding 2x buffer creation during streaming
     */
    createMeshFromData(meshData: MeshData): void {
        if (!this.device.isInitialized()) return;

        const device = this.device.getDevice();
        const vertexCount = meshData.positions.length / 3;
        const interleaved = new Float32Array(vertexCount * 7);

        for (let i = 0; i < vertexCount; i++) {
            const base = i * 7;
            const posBase = i * 3;
            interleaved[base] = meshData.positions[posBase];
            interleaved[base + 1] = meshData.positions[posBase + 1];
            interleaved[base + 2] = meshData.positions[posBase + 2];
            interleaved[base + 3] = meshData.normals[posBase];
            interleaved[base + 4] = meshData.normals[posBase + 1];
            interleaved[base + 5] = meshData.normals[posBase + 2];
            interleaved[base + 6] = meshData.expressId;
        }

        const vertexBuffer = device.createBuffer({
            size: interleaved.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, interleaved);

        const indexBuffer = device.createBuffer({
            size: meshData.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(indexBuffer, 0, meshData.indices);

        // Add to scene with identity transform (positions already in world space)
        this.scene.addMesh({
            expressId: meshData.expressId,
            modelIndex: meshData.modelIndex,  // Preserve modelIndex for multi-model selection
            vertexBuffer,
            indexBuffer,
            indexCount: meshData.indices.length,
            transform: MathUtils.identity(),
            color: meshData.color,
        });
    }

    /**
     * Ensure all meshes have GPU resources (call after adding meshes if pipeline wasn't ready)
     */
    ensureMeshResources(pipeline: RenderPipeline): void {
        if (!pipeline || !this.device.isInitialized()) return;

        const device = this.device.getDevice();
        let created = 0;

        for (const mesh of this.scene.getMeshes()) {
            if (!mesh.uniformBuffer) {
                mesh.uniformBuffer = device.createBuffer({
                    size: pipeline.getUniformBufferSize(),
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });

                mesh.bindGroup = device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(),
                    entries: [
                        {
                            binding: 0,
                            resource: { buffer: mesh.uniformBuffer },
                        },
                    ],
                });
                created++;
            }
        }

        if (created > 0) {
            const totalMeshCount = this.scene.getMeshes().length;
            // Only log every 250 meshes or when creating many at once to reduce noise
            if (totalMeshCount % 250 === 0 || created > 100) {
                console.log(`[Renderer] Created GPU resources for ${created} new meshes (${totalMeshCount} total)`);
            }
        }
    }

    /**
     * Fit camera to view all loaded geometry
     */
    fitToView(camera: import('./camera.js').Camera): void {
        if (!this.modelBounds) {
            console.warn('[Renderer] fitToView called but no geometry loaded');
            return;
        }

        const { min, max } = this.modelBounds;

        // Calculate center and size
        const center = {
            x: (min.x + max.x) / 2,
            y: (min.y + max.y) / 2,
            z: (min.z + max.z) / 2
        };

        const size = Math.max(
            max.x - min.x,
            max.y - min.y,
            max.z - min.z
        );

        // Position camera to see entire model
        const distance = size * 1.5;
        camera.setPosition(
            center.x + distance * 0.5,
            center.y + distance * 0.5,
            center.z + distance
        );
        camera.setTarget(center.x, center.y, center.z);
    }
}
