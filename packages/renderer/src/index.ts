/**
 * @ifc-lite/renderer - WebGPU renderer
 */

export { WebGPUDevice } from './device.js';
export { RenderPipeline } from './pipeline.js';
export { Camera } from './camera.js';
export { Scene } from './scene.js';
export { Picker } from './picker.js';
export { MathUtils } from './math.js';
export * from './types.js';

import { WebGPUDevice } from './device.js';
import { RenderPipeline } from './pipeline.js';
import { Camera } from './camera.js';
import { Scene } from './scene.js';
import { Picker } from './picker.js';
import type { RenderOptions, Mesh } from './types.js';

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
        this.camera.setAspect(width / height);
    }

    /**
     * Add mesh to scene
     */
    addMesh(mesh: Mesh): void {
        this.scene.addMesh(mesh);
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

        // Update canvas pixel dimensions if needed
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.camera.setAspect(width / height);
        }

        // Skip rendering if canvas is invalid
        if (this.canvas.width === 0 || this.canvas.height === 0) return;

        // Reconfigure context if canvas was resized (required by WebGPU)
        if (this.device.needsReconfigure()) {
            this.device.configureContext();
        }

        const context = this.device.getContext();
        const device = this.device.getDevice();

        const viewProj = this.camera.getViewProjMatrix().m;
        const meshes = this.scene.getMeshes();

        // Resize depth texture if needed
        if (this.pipeline.needsResize(this.canvas.width, this.canvas.height)) {
            this.pipeline.resize(this.canvas.width, this.canvas.height);
        }

        try {
            const encoder = device.createCommandEncoder();
            const clearColor = options.clearColor
                ? (Array.isArray(options.clearColor)
                    ? { r: options.clearColor[0], g: options.clearColor[1], b: options.clearColor[2], a: options.clearColor[3] }
                    : options.clearColor)
                : { r: 0.1, g: 0.1, b: 0.1, a: 1 };

            // Get current texture and create view
            const currentTexture = context.getCurrentTexture();
            const textureView = currentTexture.createView();

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
            pass.setBindGroup(0, this.pipeline.getBindGroup());

            for (const mesh of meshes) {
                const model = mesh.transform.m;
                this.pipeline.updateUniforms(viewProj, model);

                pass.setVertexBuffer(0, mesh.vertexBuffer);
                pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
                pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
            }

            pass.end();
            device.queue.submit([encoder.finish()]);
        } catch (error) {
            // Silently handle WebGPU errors (e.g., device lost, invalid state)
            console.warn('Render error:', error);
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
