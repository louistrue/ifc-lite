/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/renderer - WebGPU renderer
 */

export { WebGPUDevice } from './device.js';
export { RenderPipeline } from './pipeline.js';
export { Camera } from './camera.js';
export { Scene } from './scene.js';
export { Picker } from './picker.js';
export { MathUtils } from './math.js';
export { SectionPlaneRenderer } from './section-plane.js';
export * from './types.js';

import { WebGPUDevice } from './device.js';
import { RenderPipeline } from './pipeline.js';
import { Camera } from './camera.js';
import { Scene } from './scene.js';
import { Picker } from './picker.js';
import { FrustumUtils } from '@ifc-lite/spatial';
import type { RenderOptions, Mesh } from './types.js';
import { SectionPlaneRenderer } from './section-plane.js';

/**
 * Main renderer class
 */
export class Renderer {
    private device: WebGPUDevice;
    private pipeline: RenderPipeline | null = null;
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
            console.log(`[Renderer] Created GPU resources for ${created} meshes`);
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
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: textureView,
                        loadOp: 'clear',
                        clearValue: clearColor,
                        storeOp: 'store',
                    },
                ],
                depthStencilAttachment: {
                    view: this.pipeline.getDepthTextureView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });

            pass.setPipeline(this.pipeline.getPipeline());

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

            // Render transparent meshes with per-mesh bind groups
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
     */
    async pick(x: number, y: number): Promise<number | null> {
        if (!this.picker) return null;
        const meshes = this.scene.getMeshes();
        const viewProj = this.camera.getViewProjMatrix().m;
        return this.picker.pick(x, y, this.canvas.width, this.canvas.height, meshes, viewProj);
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
