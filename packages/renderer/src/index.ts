/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/renderer - WebGPU renderer
 */

export { WebGPUDevice } from './device.js';
export { RenderPipeline, InstancedRenderPipeline } from './pipeline.js';
export { Camera } from './camera.js';
export type { ProjectionMode } from './camera-controls.js';
export { Scene } from './scene.js';
export { Picker } from './picker.js';
export { MathUtils } from './math.js';
export { SectionPlaneRenderer } from './section-plane.js';
export { Section2DOverlayRenderer } from './section-2d-overlay.js';
export type { Section2DOverlayOptions, CutPolygon2D, DrawingLine2D } from './section-2d-overlay.js';
export { Raycaster } from './raycaster.js';
export { SnapDetector, SnapType } from './snap-detector.js';
export { BVH } from './bvh.js';
export { FederationRegistry, federationRegistry } from './federation-registry.js';
export type { ModelRange, GlobalIdLookup } from './federation-registry.js';
export * from './types.js';
export type { Ray, Vec3, Intersection } from './raycaster.js';
export type { SnapTarget, SnapOptions, EdgeLockInput, MagneticSnapResult } from './snap-detector.js';

// Zero-copy GPU upload (new - faster, less memory)
export {
    ZeroCopyGpuUploader,
    createZeroCopyUploader,
    type WasmMemoryHandle,
    type GpuGeometryData,
    type GpuInstancedGeometryData,
    type ZeroCopyMeshMetadata,
    type ZeroCopyUploadResult,
    type ZeroCopyInstancedUploadResult,
} from './zero-copy-uploader.js';

// Extracted manager classes
export { GeometryManager } from './geometry-manager.js';
export { PickingManager } from './picking-manager.js';
export { RaycastEngine } from './raycast-engine.js';

import { WebGPUDevice } from './device.js';
import { RenderPipeline, InstancedRenderPipeline } from './pipeline.js';
import { Camera } from './camera.js';
import { Scene } from './scene.js';
import { Picker } from './picker.js';
import { FrustumUtils } from '@ifc-lite/spatial';
import type { RenderOptions, PickOptions, PickResult, Mesh } from './types.js';
import { SectionPlaneRenderer } from './section-plane.js';
import { Section2DOverlayRenderer, type CutPolygon2D, type DrawingLine2D } from './section-2d-overlay.js';
import type { InstancedGeometry } from '@ifc-lite/wasm';
import { Raycaster, type Intersection } from './raycaster.js';
import { SnapDetector, type SnapTarget, type SnapOptions, type EdgeLockInput, type MagneticSnapResult } from './snap-detector.js';
import { GeometryManager } from './geometry-manager.js';
import { PickingManager } from './picking-manager.js';
import { RaycastEngine } from './raycast-engine.js';

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
    private section2DOverlayRenderer: Section2DOverlayRenderer | null = null;

    // Composition: delegate to extracted managers
    private geometryManager: GeometryManager;
    private pickingManager: PickingManager;
    private raycastEngine: RaycastEngine;

    // Error rate limiting (log at most once per second)
    private lastRenderErrorTime: number = 0;
    private readonly RENDER_ERROR_THROTTLE_MS = 1000;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.device = new WebGPUDevice();
        this.camera = new Camera();
        this.scene = new Scene();

        // Create composition managers
        this.geometryManager = new GeometryManager(this.device, this.scene);
        this.pickingManager = new PickingManager(this.camera, this.scene, null, this.canvas, this.geometryManager);
        this.raycastEngine = new RaycastEngine(this.camera, this.scene, this.canvas);
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
        this.sectionPlaneRenderer = new SectionPlaneRenderer(
            this.device.getDevice(),
            this.device.getFormat(),
            this.pipeline.getSampleCount()
        );
        this.section2DOverlayRenderer = new Section2DOverlayRenderer(
            this.device.getDevice(),
            this.device.getFormat(),
            this.pipeline.getSampleCount()
        );
        this.camera.setAspect(width / height);

        // Update picking manager with initialized picker
        this.pickingManager.setPicker(this.picker);
    }

    /**
     * Load geometry from GeometryResult or MeshData array
     * This is the main entry point for loading IFC geometry into the renderer
     *
     * @param geometry - Either a GeometryResult from geometry.process() or an array of MeshData
     */
    loadGeometry(geometry: import('@ifc-lite/geometry').GeometryResult | import('@ifc-lite/geometry').MeshData[]): void {
        if (!this.pipeline) {
            throw new Error('Renderer not initialized. Call init() first.');
        }
        this.geometryManager.loadGeometry(geometry, this.pipeline);
    }

    /**
     * Add multiple meshes to the scene (convenience method for streaming)
     *
     * @param meshes - Array of MeshData to add
     * @param isStreaming - If true, throttles batch rebuilding for better streaming performance
     */
    addMeshes(meshes: import('@ifc-lite/geometry').MeshData[], isStreaming: boolean = false): void {
        if (!this.pipeline) {
            throw new Error('Renderer not initialized. Call init() first.');
        }
        this.geometryManager.addMeshes(meshes, this.pipeline, isStreaming);
    }

    /**
     * Fit camera to view all loaded geometry
     */
    fitToView(): void {
        this.geometryManager.fitToView(this.camera);
    }

    /**
     * Add mesh to scene with per-mesh GPU resources for unique colors
     */
    addMesh(mesh: Mesh): void {
        if (!this.pipeline) return;
        this.geometryManager.addMesh(mesh, this.pipeline);
    }

    /**
     * Add instanced geometry to scene
     * Converts InstancedGeometry from geometry package to InstancedMesh for rendering
     */
    addInstancedGeometry(geometry: InstancedGeometry): void {
        if (!this.instancedPipeline) {
            throw new Error('Renderer not initialized. Call init() first.');
        }
        this.geometryManager.addInstancedGeometry(geometry, this.instancedPipeline);
    }

    /**
     * Convert MeshData array to instanced meshes for optimized rendering
     * Groups identical geometries and creates GPU instanced draw calls
     * Call this in background after initial streaming completes
     */
    convertToInstanced(meshDataArray: import('@ifc-lite/geometry').MeshData[]): void {
        if (!this.instancedPipeline) {
            console.warn('[Renderer] Cannot convert to instanced: renderer not initialized');
            return;
        }
        this.geometryManager.convertToInstanced(meshDataArray, this.instancedPipeline);
    }

    /**
     * Ensure all meshes have GPU resources (call after adding meshes if pipeline wasn't ready)
     */
    ensureMeshResources(): void {
        if (!this.pipeline) return;
        this.geometryManager.ensureMeshResources(this.pipeline);
    }

    /**
     * Render frame
     */
    render(options: RenderOptions = {}): void {
        if (!this.device.isInitialized() || !this.pipeline) return;

        // Validate canvas dimensions
        // Align width to 64 pixels for WebGPU texture row alignment (256 bytes / 4 bytes per pixel)
        const rect = this.canvas.getBoundingClientRect();
        const rawWidth = Math.max(1, Math.floor(rect.width));
        const width = Math.max(64, Math.floor(rawWidth / 64) * 64);
        const height = Math.max(1, Math.floor(rect.height));

        // Skip rendering if canvas is too small
        if (width < 64 || height < 10) return;

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

        let meshes = this.scene.getMeshes();

        // Check if visibility filtering is active
        const hasHiddenFilter = options.hiddenIds && options.hiddenIds.size > 0;
        const hasIsolatedFilter = options.isolatedIds !== null && options.isolatedIds !== undefined;
        const hasVisibilityFiltering = hasHiddenFilter || hasIsolatedFilter;

        // PERFORMANCE FIX: Use batch-level visibility filtering instead of creating individual meshes
        // Only create individual meshes for selected elements (for highlighting)
        // Batches are filtered at render time - fully visible batches render normally,
        // partially visible batches are skipped (their visible elements will be in other batches or individual meshes)

        // Ensure all existing meshes have GPU resources
        this.ensureMeshResources();

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
            const selectedModelIndex = options.selectedModelIndex;

            // Calculate section plane parameters and model bounds
            // Always calculate bounds when sectionPlane is provided (for preview and active mode)
            let sectionPlaneData: { normal: [number, number, number]; distance: number; enabled: boolean } | undefined;
            if (options.sectionPlane) {
                // Get model bounds from ALL geometry sources: individual meshes AND batched meshes
                const boundsMin = { x: Infinity, y: Infinity, z: Infinity };
                const boundsMax = { x: -Infinity, y: -Infinity, z: -Infinity };

                // Check individual meshes
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

                // Check batched meshes (most geometry is here!)
                const batchedMeshes = this.scene.getBatchedMeshes();
                for (const batch of batchedMeshes) {
                    if (batch.bounds) {
                        boundsMin.x = Math.min(boundsMin.x, batch.bounds.min[0]);
                        boundsMin.y = Math.min(boundsMin.y, batch.bounds.min[1]);
                        boundsMin.z = Math.min(boundsMin.z, batch.bounds.min[2]);
                        boundsMax.x = Math.max(boundsMax.x, batch.bounds.max[0]);
                        boundsMax.y = Math.max(boundsMax.y, batch.bounds.max[1]);
                        boundsMax.z = Math.max(boundsMax.z, batch.bounds.max[2]);
                    }
                }

                // Fallback if no bounds found
                if (!Number.isFinite(boundsMin.x)) {
                    boundsMin.x = boundsMin.y = boundsMin.z = -100;
                    boundsMax.x = boundsMax.y = boundsMax.z = 100;
                }

                // Store bounds for section plane visual
                this.geometryManager.setModelBounds({ min: boundsMin, max: boundsMax });

                // Only calculate clipping data if section is enabled
                if (options.sectionPlane.enabled) {
                    // Calculate plane normal based on semantic axis
                    // down = Y axis (horizontal cut), front = Z axis, side = X axis
                    let normal: [number, number, number] = [0, 0, 0];
                    if (options.sectionPlane.axis === 'side') normal[0] = 1;        // X axis
                    else if (options.sectionPlane.axis === 'down') normal[1] = 1;   // Y axis (horizontal)
                    else normal[2] = 1;                                              // Z axis (front)

                    // Apply building rotation if present (rotate normal around Y axis)
                    // Building rotation is in X-Y plane (Z is up in IFC, Y is up in WebGL)
                    if (options.buildingRotation !== undefined && options.buildingRotation !== 0) {
                        const cosR = Math.cos(options.buildingRotation);
                        const sinR = Math.sin(options.buildingRotation);
                        // Rotate normal vector around Y axis (vertical)
                        // For X-Z plane rotation: x' = x*cos - z*sin, z' = x*sin + z*cos, y' = y
                        const x = normal[0];
                        const z = normal[2];
                        normal[0] = x * cosR - z * sinR;
                        normal[2] = x * sinR + z * cosR;
                        // Normalize to maintain unit length
                        const len = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
                        if (len > 0.0001) {
                            normal[0] /= len;
                            normal[1] /= len;
                            normal[2] /= len;
                        }
                    }

                    // Get axis-specific range based on semantic axis
                    // Use min/max overrides from sectionPlane if provided (storey-based range)
                    const axisIdx = options.sectionPlane.axis === 'side' ? 'x' : options.sectionPlane.axis === 'down' ? 'y' : 'z';
                    const minVal = options.sectionPlane.min ?? boundsMin[axisIdx];
                    const maxVal = options.sectionPlane.max ?? boundsMax[axisIdx];

                    // Calculate plane distance from position percentage
                    const range = maxVal - minVal;
                    const distance = minVal + (options.sectionPlane.position / 100) * range;

                    sectionPlaneData = { normal, distance, enabled: true };
                }
            }

            for (const mesh of allMeshes) {
                if (mesh.uniformBuffer) {
                    // Extended buffer: 48 floats = 192 bytes
                    const buffer = new Float32Array(48);
                    const flagBuffer = new Uint32Array(buffer.buffer, 176, 4);

                    buffer.set(viewProj, 0);
                    buffer.set(mesh.transform.m, 16);

                    // Check if mesh is selected (single or multi-selection)
                    // For multi-model support: also check modelIndex if provided
                    const expressIdMatch = mesh.expressId === selectedId;
                    const modelIndexMatch = selectedModelIndex === undefined || mesh.modelIndex === selectedModelIndex;
                    const isSelected = (selectedId !== undefined && selectedId !== null && expressIdMatch && modelIndexMatch)
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
            const allBatchedMeshes = this.scene.getBatchedMeshes();

            // PERFORMANCE FIX: Always use batch rendering when we have batches
            // Apply visibility filtering at the BATCH level instead of creating individual meshes
            // This keeps draw calls at ~50-200 instead of 60K+
            if (allBatchedMeshes.length > 0) {
                // Pre-compute visibility for each batch (only when filtering is active)
                // A batch is visible if ANY of its elements are visible
                // A batch is fully visible if ALL of its elements are visible
                const batchVisibility = new Map<string, { visible: boolean; fullyVisible: boolean }>();

                if (hasVisibilityFiltering) {
                    for (const batch of allBatchedMeshes) {
                        let visibleCount = 0;
                        const total = batch.expressIds.length;

                        for (const expressId of batch.expressIds) {
                            const isHidden = options.hiddenIds?.has(expressId) ?? false;
                            const isIsolated = !hasIsolatedFilter || options.isolatedIds!.has(expressId);
                            if (!isHidden && isIsolated) {
                                visibleCount++;
                            }
                        }

                        batchVisibility.set(batch.colorKey, {
                            visible: visibleCount > 0,
                            fullyVisible: visibleCount === total,
                        });
                    }
                }

                // Separate batches into opaque and transparent, filtering by visibility
                // IMPORTANT: Only render FULLY visible batches - partially visible batches
                // need individual mesh rendering to show only the visible elements
                const opaqueBatches: typeof allBatchedMeshes = [];
                const transparentBatches: typeof allBatchedMeshes = [];

                // PERFORMANCE FIX: Track partially visible batches for sub-batch rendering
                // Instead of creating 10,000+ individual meshes, we create cached sub-batches
                const partiallyVisibleBatches: Array<{
                    colorKey: string;
                    visibleIds: Set<number>;
                    color: [number, number, number, number];
                }> = [];

                for (const batch of allBatchedMeshes) {
                    // Check visibility
                    if (hasVisibilityFiltering) {
                        const vis = batchVisibility.get(batch.colorKey);
                        if (!vis || !vis.visible) continue; // Skip completely hidden batches

                        // Handle partially visible batches - create sub-batches instead of individual meshes
                        if (!vis.fullyVisible) {
                            // Collect the visible expressIds from this batch
                            const visibleIds = new Set<number>();
                            for (const expressId of batch.expressIds) {
                                const isHidden = options.hiddenIds?.has(expressId) ?? false;
                                const isIsolated = !hasIsolatedFilter || options.isolatedIds!.has(expressId);
                                if (!isHidden && isIsolated) {
                                    visibleIds.add(expressId);
                                }
                            }
                            if (visibleIds.size > 0) {
                                partiallyVisibleBatches.push({
                                    colorKey: batch.colorKey,
                                    visibleIds,
                                    color: batch.color,
                                });
                            }
                            continue; // Don't add batch to render list
                        }
                    }

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

                // PERFORMANCE FIX: Render partially visible batches as sub-batches (not individual meshes!)
                // This is the key optimization: instead of 10,000+ individual draw calls,
                // we create cached sub-batches with only visible elements and render them as single draw calls
                const allMeshesFromScene = this.scene.getMeshes();
                // Track existing meshes by (expressId:modelIndex) to handle multi-model expressId collisions
                // E.g., door #535 in model 0 vs beam #535 in model 1 need separate tracking
                const existingMeshKeys = new Set(allMeshesFromScene.map(m => `${m.expressId}:${m.modelIndex ?? 'any'}`));

                if (partiallyVisibleBatches.length > 0) {
                    for (const { colorKey, visibleIds, color } of partiallyVisibleBatches) {
                        // Get or create a cached sub-batch for this visibility state
                        const subBatch = this.scene.getOrCreatePartialBatch(
                            colorKey,
                            visibleIds,
                            device,
                            this.pipeline
                        );

                        if (subBatch) {
                            // Use opaque or transparent pipeline based on alpha
                            const isTransparent = color[3] < 0.99;
                            if (isTransparent) {
                                pass.setPipeline(this.pipeline.getTransparentPipeline());
                            } else {
                                pass.setPipeline(this.pipeline.getPipeline());
                            }
                            // Render the sub-batch as a single draw call
                            renderBatch(subBatch);
                        }
                    }
                    // Reset to opaque pipeline for subsequent rendering
                    pass.setPipeline(this.pipeline.getPipeline());
                }

                // Render selected meshes individually for proper highlighting
                // First, check if we have Mesh objects for selected IDs
                // If not, create them lazily from stored MeshData

                // FIX: Filter selected IDs by visibility BEFORE creating GPU resources
                // This ensures highlights don't appear for hidden elements
                const visibleSelectedIds = new Set<number>();
                for (const selId of selectedExpressIds) {
                    // Skip if hidden
                    if (options.hiddenIds?.has(selId)) continue;
                    // Skip if isolation is active and this entity is not isolated
                    if (hasIsolatedFilter && !options.isolatedIds!.has(selId)) continue;
                    visibleSelectedIds.add(selId);
                }

                // Create GPU resources lazily for visible selected meshes that don't have them yet
                // Pass selectedModelIndex to get mesh data from the correct model (for multi-model support)
                // Use composite key to handle expressId collisions between models
                for (const selId of visibleSelectedIds) {
                    const meshKey = `${selId}:${selectedModelIndex ?? 'any'}`;
                    if (!existingMeshKeys.has(meshKey) && this.scene.hasMeshData(selId, selectedModelIndex)) {
                        const meshData = this.scene.getMeshData(selId, selectedModelIndex)!;
                        this.geometryManager.createMeshFromData(meshData);
                        existingMeshKeys.add(meshKey);
                    }
                }

                // Now get selected meshes (only visible ones)
                // For multi-model support: also filter by modelIndex if provided
                const selectedMeshes = this.scene.getMeshes().filter(mesh => {
                    if (!visibleSelectedIds.has(mesh.expressId)) return false;
                    // If selectedModelIndex is provided, also match modelIndex
                    if (selectedModelIndex !== undefined && mesh.modelIndex !== selectedModelIndex) return false;
                    return true;
                });

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
                // Fallback: render individual meshes (only when no batches exist)
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

            // Draw section plane visual BEFORE pass.end() (within same MSAA render pass)
            // Always show plane when sectionPlane options are provided (as preview or active)
            const modelBounds = this.geometryManager.getModelBounds();
            if (options.sectionPlane && this.sectionPlaneRenderer && modelBounds) {
                this.sectionPlaneRenderer.draw(
                    pass,
                    {
                        axis: options.sectionPlane.axis,
                        position: options.sectionPlane.position,
                        bounds: modelBounds,
                        viewProj,
                        isPreview: !options.sectionPlane.enabled, // Preview mode when not enabled
                        min: options.sectionPlane.min,
                        max: options.sectionPlane.max,
                    }
                );

                // Draw 2D section overlay on the section plane (when section is active, not preview)
                if (options.sectionPlane.enabled && this.section2DOverlayRenderer?.hasGeometry()) {
                    this.section2DOverlayRenderer.draw(
                        pass,
                        {
                            axis: options.sectionPlane.axis,
                            position: options.sectionPlane.position,
                            bounds: modelBounds,
                            viewProj,
                            min: options.sectionPlane.min,
                            max: options.sectionPlane.max,
                        }
                    );
                }
            }

            pass.end();

            device.queue.submit([encoder.finish()]);
        } catch (error) {
            // Handle WebGPU errors (e.g., device lost, invalid state)
            // Mark context as invalid so it gets reconfigured next frame
            this.device.invalidateContext();
            // Rate-limit error logging to avoid spam (max once per second)
            const now = performance.now();
            if (now - this.lastRenderErrorTime > this.RENDER_ERROR_THROTTLE_MS) {
                this.lastRenderErrorTime = now;
                console.warn('Render error (context will be reconfigured):', error);
            }
        }
    }

    /**
     * Pick object at screen coordinates
     * Respects visibility filtering so users can only select visible elements
     * Returns PickResult with expressId and modelIndex for multi-model support
     *
     * Note: x, y are CSS pixel coordinates relative to the canvas element.
     * These are scaled internally to match the actual canvas pixel dimensions.
     */
    async pick(x: number, y: number, options?: PickOptions): Promise<PickResult | null> {
        return this.pickingManager.pick(x, y, options);
    }

    /**
     * Raycast into the scene to get precise 3D intersection point
     * This is more accurate than pick() as it returns the exact surface point
     *
     * Note: x, y are CSS pixel coordinates relative to the canvas element.
     * These are scaled internally to match the actual canvas pixel dimensions.
     */
    raycastScene(
        x: number,
        y: number,
        options?: PickOptions & { snapOptions?: Partial<SnapOptions> }
    ): { intersection: Intersection; snap?: SnapTarget } | null {
        return this.raycastEngine.raycastScene(x, y, options);
    }

    /**
     * Raycast with magnetic edge snapping behavior
     * This provides the "stick and slide along edges" experience
     *
     * Note: x, y are CSS pixel coordinates relative to the canvas element.
     * These are scaled internally to match the actual canvas pixel dimensions.
     */
    raycastSceneMagnetic(
        x: number,
        y: number,
        currentEdgeLock: EdgeLockInput,
        options?: PickOptions & { snapOptions?: Partial<SnapOptions> }
    ): MagneticSnapResult & { intersection: Intersection | null } {
        return this.raycastEngine.raycastSceneMagnetic(x, y, currentEdgeLock, options);
    }

    /**
     * Invalidate BVH cache (call when geometry changes)
     */
    invalidateBVHCache(): void {
        this.raycastEngine.invalidateBVHCache();
    }

    /**
     * Get the raycaster instance (for advanced usage)
     */
    getRaycaster(): Raycaster {
        return this.raycastEngine.getRaycaster();
    }

    /**
     * Get the snap detector instance (for advanced usage)
     */
    getSnapDetector(): SnapDetector {
        return this.raycastEngine.getSnapDetector();
    }

    /**
     * Clear all caches (call when geometry changes)
     */
    clearCaches(): void {
        this.raycastEngine.clearCaches();
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
     * Upload 2D section drawing data for 3D overlay rendering
     * Call this when a 2D drawing is generated to display it on the section plane
     * Uses same position calculation as section plane: sectionRange min/max if provided, else modelBounds
     */
    uploadSection2DOverlay(
        polygons: CutPolygon2D[],
        lines: DrawingLine2D[],
        axis: 'down' | 'front' | 'side',
        position: number,  // 0-100 percentage
        sectionRange?: { min?: number; max?: number },  // Same storey-based range as section plane
        flipped: boolean = false
    ): void {
        if (!this.section2DOverlayRenderer) return;

        // Use EXACTLY same calculation as section plane in render() method:
        // minVal = options.sectionPlane.min ?? boundsMin[axisIdx]
        // maxVal = options.sectionPlane.max ?? boundsMax[axisIdx]
        const axisIdx = axis === 'side' ? 'x' : axis === 'down' ? 'y' : 'z';

        const modelBounds = this.geometryManager.getModelBounds();

        // Allow upload if either sectionRange has both values, or modelBounds exists as fallback
        const hasFullRange = sectionRange?.min !== undefined && sectionRange?.max !== undefined;
        if (!hasFullRange && !modelBounds) return;

        const minVal = sectionRange?.min ?? modelBounds!.min[axisIdx];
        const maxVal = sectionRange?.max ?? modelBounds!.max[axisIdx];
        const planePosition = minVal + (position / 100) * (maxVal - minVal);

        this.section2DOverlayRenderer.uploadDrawing(polygons, lines, axis, planePosition, flipped);
    }

    /**
     * Clear the 2D section overlay
     */
    clearSection2DOverlay(): void {
        if (this.section2DOverlayRenderer) {
            this.section2DOverlayRenderer.clearGeometry();
        }
    }

    /**
     * Check if 2D section overlay has geometry to render
     */
    hasSection2DOverlay(): boolean {
        return this.section2DOverlayRenderer?.hasGeometry() ?? false;
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

    /**
     * Capture a screenshot of the current view
     * Waits for GPU work to complete and captures exactly what's displayed
     * @returns PNG data URL or null if capture failed
     */
    async captureScreenshot(): Promise<string | null> {
        if (!this.device.isInitialized()) {
            console.warn('[Renderer] Cannot capture screenshot: not initialized');
            return null;
        }

        try {
            // Wait for any pending GPU work to complete before capturing
            // This ensures we capture the fully rendered frame
            const device = this.device.getDevice();
            await device.queue.onSubmittedWorkDone();

            // Capture exactly what's displayed on the canvas
            const dataUrl = this.canvas.toDataURL('image/png');
            return dataUrl;
        } catch (error) {
            console.error('[Renderer] Screenshot capture failed:', error);
            return null;
        }
    }

    /**
     * Get the canvas element
     */
    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }
}
