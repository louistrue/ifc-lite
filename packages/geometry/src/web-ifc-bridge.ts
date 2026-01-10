/**
 * web-ifc bridge - initializes and manages web-ifc for triangulation
 * Uses single-threaded mode (proven in Spike 2)
 */

import * as WebIFC from 'web-ifc';

export class WebIfcBridge {
    private ifcApi: WebIFC.IfcAPI | null = null;
    private initialized: boolean = false;

    /**
     * Initialize web-ifc with single-threaded mode
     */
    async init(wasmPath: string = '/'): Promise<void> {
        if (this.initialized) return;

        this.ifcApi = new WebIFC.IfcAPI();
        this.ifcApi.SetWasmPath(wasmPath, true);

        // Init without custom handler - web-ifc will auto-detect single-threaded mode
        // (SharedArrayBuffer not available without COOP/COEP headers)
        await this.ifcApi.Init();
        this.initialized = true;
    }

    /**
     * Open IFC model from buffer
     */
    openModel(buffer: Uint8Array): number {
        if (!this.ifcApi) {
            throw new Error('web-ifc not initialized. Call init() first.');
        }
        return this.ifcApi.OpenModel(buffer);
    }

    /**
     * Close model and free resources
     */
    closeModel(modelID: number): void {
        if (this.ifcApi) {
            this.ifcApi.CloseModel(modelID);
        }
    }

    /**
     * Get web-ifc API instance
     */
    getApi(): WebIFC.IfcAPI {
        if (!this.ifcApi) {
            throw new Error('web-ifc not initialized. Call init() first.');
        }
        return this.ifcApi;
    }

    /**
     * Check if initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }
}
