/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite bridge - initializes and manages IFC-Lite WASM for geometry processing
 * Replaces web-ifc-bridge.ts with native IFC-Lite implementation (1.9x faster)
 */

import init, { IfcAPI, MeshCollection } from '@ifc-lite/wasm';
export type { MeshCollection };

export class IfcLiteBridge {
  private ifcApi: IfcAPI | null = null;
  private initialized: boolean = false;

  /**
   * Initialize IFC-Lite WASM
   */
  async init(wasmPath: string = '/'): Promise<void> {
    if (this.initialized) return;

    // Initialize WASM module
    const wasmUrl = wasmPath.endsWith('/')
      ? `${wasmPath}ifc_lite_wasm_bg.wasm`
      : `${wasmPath}/ifc_lite_wasm_bg.wasm`;

    await init(wasmUrl);
    this.ifcApi = new IfcAPI();
    this.initialized = true;
  }

  /**
   * Parse IFC content and return mesh collection
   * Returns individual meshes with express IDs and colors
   */
  parseMeshes(content: string): MeshCollection {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    return this.ifcApi.parseMeshes(content);
  }

  /**
   * Get IFC-Lite API instance
   */
  getApi(): IfcAPI {
    if (!this.ifcApi) {
      throw new Error('IFC-Lite not initialized. Call init() first.');
    }
    return this.ifcApi;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get version
   */
  getVersion(): string {
    return this.ifcApi?.version ?? 'unknown';
  }
}
