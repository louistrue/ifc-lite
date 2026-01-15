/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/renderer - WebGPU renderer
 */

export { WebGPUDevice } from './device.js';
export { RenderPipeline, InstancedRenderPipeline } from './pipeline.js';
export { Camera } from './camera.js';
export { Scene } from './scene.js';
export { Picker } from './picker.js';
export { MathUtils } from './math.js';
export { SectionPlaneRenderer } from './section-plane.js';
export * from './types.js';

import { WebGPUDevice } from './device.js';
import { RenderPipeline, InstancedRenderPipeline } from './pipeline.js';
import { Camera } from './camera.js';
import { Scene } from './scene.js';
import { Picker } from './picker.js';
import { FrustumUtils } from '@ifc-lite/spatial';
import type { RenderOptions, PickOptions, Mesh, InstancedMesh } from './types.js';
import { SectionPlaneRenderer } from './section-plane.js';
import type { MeshData } from '@ifc-lite/geometry';
import { deduplicateMeshes } from '@ifc-lite/geometry';
import type { InstancedGeometry } from '@ifc-lite/wasm';
import { MathUtils } from './math.js';

/**
 * Main renderer class
 */
export class Renderer {
    private device: WebGPUDevice;
    private pipeline: RenderPipeline | null = null;
    private instancedPipeline: InstancedRenderPipeline | null = null;
    private camera: Camera;
    private scene: Scene;
    private picker: Picker | null = null;
    private canvas: HTMLCanvasElement;
    private sectionPlaneRenderer: SectionPlaneRenderer | null = null;
    private modelBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.device = new WebGPUDevice();
        this.camera = new Camera();
        this.scene = new Scene();
    }

    /**
     * Initialize renderer
     */
    async init(): Promise<void> {
        await this.device.init(this.canvas);

        // Get canvas dimensions (use pixel dimensions if set, otherwise use CSS dimensions)
        const rect = this.canvas.getBoundingClientRect();
        const width = this.canvas.width || Math.max(1, Math.floor(rect.width));
        const height = this.canvas.height || Math.max(1, Math.floor(rect.height));

        // Set pixel dimensions if not already set
        if (!this.canvas.width || !this.canvas.height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        this.pipeline = new RenderPipeline(this.device, width, height);
        this.instancedPipeline = new InstancedRenderPipeline(this.device, width, height);
        this.picker = new Picker(this.device, width, height);
        this.sectionPlaneRenderer = new SectionPlaneRenderer(this.device.getDevice(), this.device.getFormat());
        this.camera.setAspect(width / height);
    }

    /**
     * Add mesh to scene with per-mesh GPU resources for unique colors
     */
    addMesh(mesh: Mesh): void {
        // Create per-mesh uniform buffer and bind group if not already created
        if (!mesh.uniformBuffer && this.pipeline && this.device.isInitialized()) {
            const device = this.device.getDevice();

            // Create uniform buffer for this mesh
            mesh.uniformBuffer = device.createBuffer({
                size: this.pipeline.getUniformBufferSize(),
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Create bind group for this mesh
            mesh.bindGroup = device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(),
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
    addInstancedGeometry(geometry: InstancedGeometry): void {
        if (!this.instancedPipeline || !this.device.isInitialized()) {
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
        const bindGroup = this.instancedPipeline.createInstanceBindGroup(instanceBuffer);

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
    convertToInstanced(meshDataArray: import('@ifc-lite/geometry').MeshData[]): void {
        if (!this.instancedPipeline || !this.device.isInitialized()) {
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
            const bindGroup = this.instancedPipeline.createInstanceBindGroup(instanceBuffer);

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
    private createMeshFromData(meshData: MeshData): void {
        if (!this.device.isInitialized()) return;

        const device = this.device.getDevice();
        const vertexCount = meshData.positions.length / 3;
        const interleaved = new Float32Array(vertexCount * 6);

        for (let i = 0; i < vertexCount; i++) {
            const base = i * 6;
            const posBase = i * 3;
            interleaved[base] = meshData.positions[posBase];
            interleaved[base + 1] = meshData.positions[posBase + 1];
            interleaved[base + 2] = meshData.positions[posBase + 2];
            interleaved[base + 3] = meshData.normals[posBase];
            interleaved[base + 4] = meshData.normals[posBase + 1];
            interleaved[base + 5] = meshData.normals[posBase + 2];
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
    ensureMeshResources(): void {
        if (!this.pipeline || !this.device.isInitialized()) return;

        const device = this.device.getDevice();
        let created = 0;

        for (const mesh of this.scene.getMeshes()) {
            if (!mesh.uniformBuffer) {
                mesh.uniformBuffer = device.createBuffer({
                    size: this.pipeline.getUniformBufferSize(),
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });

                mesh.bindGroup = device.createBindGroup({
                    layout: this.pipeline.getBindGroupLayout(),
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
     * Render frame
     */
    render(options: RenderOptions = {}): void {
        if (!this.device.isInitialized() || !this.pipeline) return;

        // Validate canvas dimensions
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        // Skip rendering if canvas is too small
        if (width < 10 || height < 10) return;

        // Update canvas pixel dimensions if needed
        const dimensionsChanged = this.canvas.width !== width || this.canvas.height !== height;
        if (dimensionsChanged) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.camera.setAspect(width / height);
            // Force reconfigure when dimensions change
            this.device.configureContext();
            // Also resize the depth texture immediately
            this.pipeline.resize(width, height);
            if (this.instancedPipeline) {
                this.instancedPipeline.resize(width, height);
            }
        }

        // Skip rendering if canvas is invalid
        if (this.canvas.width === 0 || this.canvas.height === 0) return;

        // Ensure context is valid before rendering (handles HMR, focus changes, etc.)
        if (!this.device.ensureContext()) {
            return; // Skip this frame, context will be ready next frame
        }

        const device = this.device.getDevice();
        const viewProj = this.camera.getViewProjMatrix().m;

        // Ensure all meshes have GPU resources (in case they were added before pipeline was ready)
        this.ensureMeshResources();

        let meshes = this.scene.getMeshes();
        
        // Check if visibility filtering is active
        const hasHiddenFilter = options.hiddenIds && options.hiddenIds.size > 0;
        const hasIsolatedFilter = options.isolatedIds !== null && options.isolatedIds !== undefined;
        const hasVisibilityFiltering = hasHiddenFilter || hasIsolatedFilter;
        
        // When using batched rendering with visibility filtering, we need individual meshes
        // Create them lazily from stored MeshData for visible elements only
        const batchedMeshes = this.scene.getBatchedMeshes();
        if (hasVisibilityFiltering && batchedMeshes.length > 0 && meshes.length === 0) {
            // Collect all expressIds from batched meshes
            const allExpressIds = new Set<number>();
            for (const batch of batchedMeshes) {
                for (const expressId of batch.expressIds) {
                    allExpressIds.add(expressId);
                }
            }
            
            // Filter to get visible expressIds
            const visibleExpressIds: number[] = [];
            for (const expressId of allExpressIds) {
                const isHidden = options.hiddenIds?.has(expressId) ?? false;
                const isIsolated = !hasIsolatedFilter || options.isolatedIds!.has(expressId);
                if (!isHidden && isIsolated) {
                    visibleExpressIds.push(expressId);
                }
            }
            
            // Create individual meshes for visible elements only
            const existingMeshIds = new Set(meshes.map(m => m.expressId));
            for (const expressId of visibleExpressIds) {
                if (!existingMeshIds.has(expressId) && this.scene.hasMeshData(expressId)) {
                    const meshData = this.scene.getMeshData(expressId)!;
                    this.createMeshFromData(meshData);
                }
            }
            
            // Get updated meshes list
            meshes = this.scene.getMeshes();
        }

        // Frustum culling (if enabled and spatial index available)
        if (options.enableFrustumCulling && options.spatialIndex) {
            try {
                const frustum = FrustumUtils.fromViewProjMatrix(viewProj);
                const visibleIds = new Set(options.spatialIndex.queryFrustum(frustum));
                meshes = meshes.filter(mesh => visibleIds.has(mesh.expressId));
            } catch (error) {
                // Fallback: render all meshes if frustum culling fails
                console.warn('Frustum culling failed:', error);
            }
        }

        // Visibility filtering
        if (options.hiddenIds && options.hiddenIds.size > 0) {
            meshes = meshes.filter(mesh => !options.hiddenIds!.has(mesh.expressId));
        }
        if (options.isolatedIds !== null && options.isolatedIds !== undefined) {
            meshes = meshes.filter(mesh => options.isolatedIds!.has(mesh.expressId));
        }

        // Resize depth texture if needed
        if (this.pipeline.needsResize(this.canvas.width, this.canvas.height)) {
            this.pipeline.resize(this.canvas.width, this.canvas.height);
        }
        if (this.instancedPipeline?.needsResize(this.canvas.width, this.canvas.height)) {
            this.instancedPipeline.resize(this.canvas.width, this.canvas.height);
        }

        // Get current texture safely - may return null if context needs reconfiguration
        const currentTexture = this.device.getCurrentTexture();
        if (!currentTexture) {
            return; // Skip this frame, context will be reconfigured next frame
        }

        try {
            const clearColor = options.clearColor
                ? (Array.isArray(options.clearColor)
                    ? { r: options.clearColor[0], g: options.clearColor[1], b: options.clearColor[2], a: options.clearColor[3] }
                    : options.clearColor)
                : { r: 0.1, g: 0.1, b: 0.1, a: 1 };

            const textureView = currentTexture.createView();

            // Separate meshes into opaque and transparent
            const opaqueMeshes: typeof meshes = [];
            const transparentMeshes: typeof meshes = [];

            for (const mesh of meshes) {
                const alpha = mesh.color[3];
                const transparency = mesh.material?.transparency ?? 0.0;
                const isTransparent = alpha < 0.99 || transparency > 0.01;

                if (isTransparent) {
                    transparentMeshes.push(mesh);
                } else {
                    opaqueMeshes.push(mesh);
                }
            }

            // Sort transparent meshes back-to-front for proper blending
            if (transparentMeshes.length > 0) {
                transparentMeshes.sort((a, b) => {
                    return b.expressId - a.expressId; // Back to front (simplified)
                });
            }

            // Write uniform data to each mesh's buffer BEFORE recording commands
            // This ensures each mesh has its own color data
            const allMeshes = [...opaqueMeshes, ...transparentMeshes];
            const selectedId = options.selectedId;
            const selectedIds = options.selectedIds;

            // Calculate section plane parameters if enabled
            let sectionPlaneData: { normal: [number, number, number]; distance: number; enabled: boolean } | undefined;
            if (options.sectionPlane?.enabled) {
                // Calculate plane normal based on axis
                const normal: [number, number, number] = [0, 0, 0];
                if (options.sectionPlane.axis === 'x') normal[0] = 1;
                else if (options.sectionPlane.axis === 'y') normal[1] = 1;
                else normal[2] = 1;

                // Get model bounds for calculating plane position and visual
                const boundsMin = { x: Infinity, y: Infinity, z: Infinity };
                const boundsMax = { x: -Infinity, y: -Infinity, z: -Infinity };

                if (meshes.length > 0) {
                    for (const mesh of meshes) {
                        if (mesh.bounds) {
                            boundsMin.x = Math.min(boundsMin.x, mesh.bounds.min[0]);
                            boundsMin.y = Math.min(boundsMin.y, mesh.bounds.min[1]);
                            boundsMin.z = Math.min(boundsMin.z, mesh.bounds.min[2]);
                            boundsMax.x = Math.max(boundsMax.x, mesh.bounds.max[0]);
                            boundsMax.y = Math.max(boundsMax.y, mesh.bounds.max[1]);
                            boundsMax.z = Math.max(boundsMax.z, mesh.bounds.max[2]);
                        }
                    }
                    if (!Number.isFinite(boundsMin.x)) {
                        boundsMin.x = boundsMin.y = boundsMin.z = -100;
                        boundsMax.x = boundsMax.y = boundsMax.z = 100;
                    }
                } else {
                    boundsMin.x = boundsMin.y = boundsMin.z = -100;
                    boundsMax.x = boundsMax.y = boundsMax.z = 100;
                }

                // Store bounds for section plane visual
                this.modelBounds = { min: boundsMin, max: boundsMax };

                // Get axis-specific range
                const axisIdx = options.sectionPlane.axis === 'x' ? 'x' : options.sectionPlane.axis === 'y' ? 'y' : 'z';
                const minVal = boundsMin[axisIdx];
                const maxVal = boundsMax[axisIdx];

                // Calculate plane distance from position percentage
                const range = maxVal - minVal;
                const distance = minVal + (options.sectionPlane.position / 100) * range;

                sectionPlaneData = { normal, distance, enabled: true };
            }

            for (const mesh of allMeshes) {
                if (mesh.uniformBuffer) {
                    // Extended buffer: 48 floats = 192 bytes
                    const buffer = new Float32Array(48);
                    const flagBuffer = new Uint32Array(buffer.buffer, 176, 4);

                    buffer.set(viewProj, 0);
                    buffer.set(mesh.transform.m, 16);

                    // Check if mesh is selected (single or multi-selection)
                    const isSelected = (selectedId !== undefined && selectedId !== null && mesh.expressId === selectedId)
                        || (selectedIds !== undefined && selectedIds.has(mesh.expressId));

                    // Apply selection highlight effect
                    if (isSelected) {
                        // Use original color, shader will handle highlight
                        buffer.set(mesh.color, 32);
                        buffer[36] = mesh.material?.metallic ?? 0.0;
                        buffer[37] = mesh.material?.roughness ?? 0.6;
                    } else {
                        buffer.set(mesh.color, 32);
                        buffer[36] = mesh.material?.metallic ?? 0.0;
                        buffer[37] = mesh.material?.roughness ?? 0.6;
                    }

                    // Section plane data (offset 40-43)
                    if (sectionPlaneData) {
                        buffer[40] = sectionPlaneData.normal[0];
                        buffer[41] = sectionPlaneData.normal[1];
                        buffer[42] = sectionPlaneData.normal[2];
                        buffer[43] = sectionPlaneData.distance;
                    }

                    // Flags (offset 44-47 as u32)
                    flagBuffer[0] = isSelected ? 1 : 0;
                    flagBuffer[1] = sectionPlaneData?.enabled ? 1 : 0;
                    flagBuffer[2] = 0;
                    flagBuffer[3] = 0;

                    device.queue.writeBuffer(mesh.uniformBuffer, 0, buffer);
                }
            }

            // Now record draw commands
            const encoder = device.createCommandEncoder();
            
            // Set up MSAA rendering if enabled
            const msaaView = this.pipeline.getMultisampleTextureView();
            const useMSAA = msaaView !== null && this.pipeline.getSampleCount() > 1;
            
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        // If MSAA enabled: render to multisample texture, resolve to swap chain
                        // If MSAA disabled: render directly to swap chain
                        view: useMSAA ? msaaView : textureView,
                        resolveTarget: useMSAA ? textureView : undefined,
                        loadOp: 'clear',
                        clearValue: clearColor,
                        storeOp: useMSAA ? 'discard' : 'store',  // Discard MSAA buffer after resolve
                    },
                ],
                depthStencilAttachment: {
                    view: this.pipeline.getDepthTextureView(),
                    depthClearValue: 0.0,  // Reverse-Z: clear to 0.0 (far plane)
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });

            pass.setPipeline(this.pipeline.getPipeline());

            // Check if we have batched meshes (preferred for performance)
            // When visibility filtering is active, we need to render individual meshes instead of batches
            // because batches merge geometry by color and can't be partially rendered
            const allBatchedMeshes = this.scene.getBatchedMeshes();
            
            if (allBatchedMeshes.length > 0 && !hasVisibilityFiltering) {
                // Separate batches into opaque and transparent
                const opaqueBatches: typeof allBatchedMeshes = [];
                const transparentBatches: typeof allBatchedMeshes = [];
                
                for (const batch of allBatchedMeshes) {
                    const alpha = batch.color[3];
                    if (alpha < 0.99) {
                        transparentBatches.push(batch);
                    } else {
                        opaqueBatches.push(batch);
                    }
                }
                
                const selectedExpressIds = new Set<number>();
                if (selectedId !== undefined && selectedId !== null) {
                    selectedExpressIds.add(selectedId);
                }
                if (selectedIds) {
                    for (const id of selectedIds) {
                        selectedExpressIds.add(id);
                    }
                }

                // Helper function to render a batch
                const renderBatch = (batch: typeof allBatchedMeshes[0]) => {
                    if (!batch.bindGroup || !batch.uniformBuffer) return;

                    // Update uniform buffer for this batch
                    const buffer = new Float32Array(48);
                    const flagBuffer = new Uint32Array(buffer.buffer, 176, 4);

                    buffer.set(viewProj, 0);
                    // Identity transform for batched meshes (positions already in world space)
                    buffer.set([
                        1, 0, 0, 0,
                        0, 1, 0, 0,
                        0, 0, 1, 0,
                        0, 0, 0, 1
                    ], 16);

                    buffer.set(batch.color, 32);
                    buffer[36] = 0.0; // metallic
                    buffer[37] = 0.6; // roughness

                    // Section plane data
                    if (sectionPlaneData) {
                        buffer[40] = sectionPlaneData.normal[0];
                        buffer[41] = sectionPlaneData.normal[1];
                        buffer[42] = sectionPlaneData.normal[2];
                        buffer[43] = sectionPlaneData.distance;
                    }

                    // Flags (not selected - batches render normally, selected meshes rendered separately)
                    flagBuffer[0] = 0;
                    flagBuffer[1] = sectionPlaneData?.enabled ? 1 : 0;
                    flagBuffer[2] = 0;
                    flagBuffer[3] = 0;

                    device.queue.writeBuffer(batch.uniformBuffer, 0, buffer);

                    // Single draw call for entire batch!
                    pass.setBindGroup(0, batch.bindGroup);
                    pass.setVertexBuffer(0, batch.vertexBuffer);
                    pass.setIndexBuffer(batch.indexBuffer, 'uint32');
                    pass.drawIndexed(batch.indexCount);
                };

                // Render opaque batches first with opaque pipeline
                pass.setPipeline(this.pipeline.getPipeline());
                for (const batch of opaqueBatches) {
                    renderBatch(batch);
                }

                // Render selected meshes individually for proper highlighting
                // First, check if we have Mesh objects for selected IDs
                // If not, create them lazily from stored MeshData
                const allMeshes = this.scene.getMeshes();
                const existingMeshIds = new Set(allMeshes.map(m => m.expressId));

                // Create GPU resources lazily for selected meshes that don't have them yet
                for (const selectedId of selectedExpressIds) {
                    if (!existingMeshIds.has(selectedId) && this.scene.hasMeshData(selectedId)) {
                        const meshData = this.scene.getMeshData(selectedId)!;
                        this.createMeshFromData(meshData);
                    }
                }

                // Now get selected meshes (includes newly created ones)
                const selectedMeshes = this.scene.getMeshes().filter(mesh =>
                    selectedExpressIds.has(mesh.expressId)
                );

                // Ensure selected meshes have uniform buffers and bind groups
                for (const mesh of selectedMeshes) {
                    if (!mesh.uniformBuffer && this.pipeline) {
                        mesh.uniformBuffer = device.createBuffer({
                            size: this.pipeline.getUniformBufferSize(),
                            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                        });
                        mesh.bindGroup = device.createBindGroup({
                            layout: this.pipeline.getBindGroupLayout(),
                            entries: [
                                {
                                    binding: 0,
                                    resource: { buffer: mesh.uniformBuffer },
                                },
                            ],
                        });
                    }
                }

                // Render selected meshes with highlight
                for (const mesh of selectedMeshes) {
                    if (!mesh.bindGroup || !mesh.uniformBuffer) {
                        continue;
                    }

                    const buffer = new Float32Array(48);
                    const flagBuffer = new Uint32Array(buffer.buffer, 176, 4);

                    buffer.set(viewProj, 0);
                    buffer.set(mesh.transform.m, 16);
                    buffer.set(mesh.color, 32);
                    buffer[36] = mesh.material?.metallic ?? 0.0;
                    buffer[37] = mesh.material?.roughness ?? 0.6;

                    // Section plane data
                    if (sectionPlaneData) {
                        buffer[40] = sectionPlaneData.normal[0];
                        buffer[41] = sectionPlaneData.normal[1];
                        buffer[42] = sectionPlaneData.normal[2];
                        buffer[43] = sectionPlaneData.distance;
                    }

                    // Flags (selected)
                    flagBuffer[0] = 1; // isSelected
                    flagBuffer[1] = sectionPlaneData?.enabled ? 1 : 0;
                    flagBuffer[2] = 0;
                    flagBuffer[3] = 0;

                    device.queue.writeBuffer(mesh.uniformBuffer, 0, buffer);

                    // Use selection pipeline to render on top of batched meshes
                    pass.setPipeline(this.pipeline.getSelectionPipeline());
                    pass.setBindGroup(0, mesh.bindGroup);
                    pass.setVertexBuffer(0, mesh.vertexBuffer);
                    pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
                    pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
                }

                // Render transparent BATCHED meshes with transparent pipeline (after opaque batches and selections)
                if (transparentBatches.length > 0) {
                    pass.setPipeline(this.pipeline.getTransparentPipeline());
                    for (const batch of transparentBatches) {
                        renderBatch(batch);
                    }
                }

                // Render transparent individual meshes with transparent pipeline
                if (transparentMeshes.length > 0) {
                    pass.setPipeline(this.pipeline.getTransparentPipeline());
                    for (const mesh of transparentMeshes) {
                        if (!mesh.bindGroup || !mesh.uniformBuffer) {
                            continue;
                        }

                        const buffer = new Float32Array(48);
                        const flagBuffer = new Uint32Array(buffer.buffer, 176, 4);

                        buffer.set(viewProj, 0);
                        buffer.set(mesh.transform.m, 16);
                        buffer.set(mesh.color, 32);
                        buffer[36] = mesh.material?.metallic ?? 0.0;
                        buffer[37] = mesh.material?.roughness ?? 0.6;

                        // Section plane data
                        if (sectionPlaneData) {
                            buffer[40] = sectionPlaneData.normal[0];
                            buffer[41] = sectionPlaneData.normal[1];
                            buffer[42] = sectionPlaneData.normal[2];
                            buffer[43] = sectionPlaneData.distance;
                        }

                        // Flags (not selected, transparent)
                        flagBuffer[0] = 0;
                        flagBuffer[1] = sectionPlaneData?.enabled ? 1 : 0;
                        flagBuffer[2] = 0;
                        flagBuffer[3] = 0;

                        device.queue.writeBuffer(mesh.uniformBuffer, 0, buffer);

                        pass.setBindGroup(0, mesh.bindGroup);
                        pass.setVertexBuffer(0, mesh.vertexBuffer);
                        pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
                        pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
                    }
                }
            } else {
                // Fallback: render individual meshes (slower but works)
                // Render opaque meshes with per-mesh bind groups
                for (const mesh of opaqueMeshes) {
                    if (mesh.bindGroup) {
                        pass.setBindGroup(0, mesh.bindGroup);
                    } else {
                        pass.setBindGroup(0, this.pipeline.getBindGroup());
                    }
                    pass.setVertexBuffer(0, mesh.vertexBuffer);
                    pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
                    pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
                }

                // Render transparent meshes with transparent pipeline (alpha blending)
                if (transparentMeshes.length > 0) {
                    pass.setPipeline(this.pipeline.getTransparentPipeline());
                    for (const mesh of transparentMeshes) {
                        if (mesh.bindGroup) {
                            pass.setBindGroup(0, mesh.bindGroup);
                        } else {
                            pass.setBindGroup(0, this.pipeline.getBindGroup());
                        }
                        pass.setVertexBuffer(0, mesh.vertexBuffer);
                        pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
                        pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
                    }
                }
            }

            // Render instanced meshes (much more efficient for repeated geometry)
            if (this.instancedPipeline) {
                const instancedMeshes = this.scene.getInstancedMeshes();
                if (instancedMeshes.length > 0) {
                    // Update instanced pipeline uniforms
                    this.instancedPipeline.updateUniforms(viewProj, sectionPlaneData);

                    // Switch to instanced pipeline
                    pass.setPipeline(this.instancedPipeline.getPipeline());

                    for (const instancedMesh of instancedMeshes) {
                        // Use cached bind group (created at mesh upload time)
                        // Falls back to creating one if missing (shouldn't happen in normal flow)
                        const bindGroup = instancedMesh.bindGroup ??
                            this.instancedPipeline.createInstanceBindGroup(instancedMesh.instanceBuffer);
                        pass.setBindGroup(0, bindGroup);
                        pass.setVertexBuffer(0, instancedMesh.vertexBuffer);
                        pass.setIndexBuffer(instancedMesh.indexBuffer, 'uint32');
                        // Draw with instancing: indexCount, instanceCount
                        pass.drawIndexed(instancedMesh.indexCount, instancedMesh.instanceCount, 0, 0, 0);
                    }
                }
            }

            pass.end();

            // Render section plane visual if enabled
            if (sectionPlaneData?.enabled && this.sectionPlaneRenderer && this.modelBounds) {
                this.sectionPlaneRenderer.render(
                    encoder,
                    textureView,
                    this.pipeline.getDepthTextureView(),
                    {
                        axis: options.sectionPlane!.axis,
                        position: options.sectionPlane!.position,
                        bounds: this.modelBounds,
                        viewProj,
                    }
                );
            }

            device.queue.submit([encoder.finish()]);
        } catch (error) {
            // Handle WebGPU errors (e.g., device lost, invalid state)
            // Mark context as invalid so it gets reconfigured next frame
            this.device.invalidateContext();
            // Only log occasional errors to avoid spam
            if (Math.random() < 0.01) {
                console.warn('Render error (context will be reconfigured):', error);
            }
        }
    }

    /**
     * Pick object at screen coordinates
     * Respects visibility filtering so users can only select visible elements
     */
    async pick(x: number, y: number, options?: PickOptions): Promise<number | null> {
        if (!this.picker) {
            return null;
        }

        // Skip picker during streaming for consistent performance
        // Picking during streaming would be slow and incomplete anyway
        if (options?.isStreaming) {
            return null;
        }

        let meshes = this.scene.getMeshes();

        // If we have batched meshes but no regular meshes, create picking meshes from stored MeshData
        // This implements lazy loading for picking - meshes are created on-demand from MeshData
        if (meshes.length === 0) {
            const batchedMeshes = this.scene.getBatchedMeshes();
            if (batchedMeshes.length > 0) {
                // Collect all expressIds from batched meshes
                const expressIds = new Set<number>();
                for (const batch of batchedMeshes) {
                    for (const expressId of batch.expressIds) {
                        expressIds.add(expressId);
                    }
                }

                // Track existing expressIds to avoid duplicates (using Set for O(1) lookup)
                const existingExpressIds = new Set(meshes.map(m => m.expressId));

                // Create picking meshes lazily from stored MeshData
                // Only create meshes for VISIBLE elements (not hidden, and either no isolation or in isolated set)
                for (const expressId of expressIds) {
                    // Skip if already exists
                    if (existingExpressIds.has(expressId)) continue;
                    // Skip if hidden
                    if (options?.hiddenIds?.has(expressId)) continue;
                    // Skip if isolation is active and this entity is not isolated
                    if (options?.isolatedIds !== null && options?.isolatedIds !== undefined && !options.isolatedIds.has(expressId)) continue;

                    if (this.scene.hasMeshData(expressId)) {
                        const meshData = this.scene.getMeshData(expressId);
                        if (meshData) {
                            this.createMeshFromData(meshData);
                            existingExpressIds.add(expressId); // Track newly created mesh
                        }
                    }
                }

                // Get updated meshes list (includes newly created ones)
                meshes = this.scene.getMeshes();
            }
        }

        // Apply visibility filtering to meshes before picking
        // This ensures users can only select elements that are actually visible
        if (options?.hiddenIds && options.hiddenIds.size > 0) {
            meshes = meshes.filter(mesh => !options.hiddenIds!.has(mesh.expressId));
        }
        if (options?.isolatedIds !== null && options?.isolatedIds !== undefined) {
            meshes = meshes.filter(mesh => options.isolatedIds!.has(mesh.expressId));
        }

        const viewProj = this.camera.getViewProjMatrix().m;
        const result = await this.picker.pick(x, y, this.canvas.width, this.canvas.height, meshes, viewProj);
        return result;
    }

    /**
     * Resize canvas
     */
    resize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;
        this.camera.setAspect(width / height);
    }

    getCamera(): Camera {
        return this.camera;
    }

    getScene(): Scene {
        return this.scene;
    }

    /**
     * Get render pipeline (for batching)
     */
    getPipeline(): RenderPipeline | null {
        return this.pipeline;
    }

    /**
     * Check if renderer is fully initialized and ready to use
     */
    isReady(): boolean {
        return this.device.isInitialized() && this.pipeline !== null;
    }

    /**
     * Get the GPU device (returns null if not initialized)
     */
    getGPUDevice(): GPUDevice | null {
        if (!this.device.isInitialized()) {
            return null;
        }
        return this.device.getDevice();
    }
}
