/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Floor plan processor - wrapper around WASM bindings
 */

import type {
  DetectedFloorPlan,
  DetectionConfig,
  GeneratedBuilding,
  StoreyConfig,
  StoreyMeshData,
  DEFAULT_DETECTION_CONFIG,
} from './types';

// WASM module types - these come from @ifc-lite/wasm
interface FloorPlanAPIWasm {
  new (): FloorPlanAPIWasm;
  setConfig(configJson: string): void;
  getConfig(): string;
  detectFloorPlan(
    rgbaData: Uint8Array,
    width: number,
    height: number,
    pageIndex: number
  ): string;
  getFloorPlan(pageIndex: number): string;
  getFloorPlanCount(): number;
  clear(): void;
  generateBuilding(storeyConfigsJson: string): string;
  generateTestBuilding(): string;
  setScale(pageIndex: number, scale: number): void;
  getStoreyMeshData(buildingJson: string, storeyIndex: number): StoreyMeshData;
}

let wasmModule: {
  FloorPlanAPI: new () => FloorPlanAPIWasm;
  createDefaultStoreyConfig: (floorPlanIndex: number, label: string, height: number) => string;
  createMultiStoreyConfig: (
    indicesJson: string,
    labelsJson: string,
    heightsJson: string
  ) => string;
} | null = null;

/**
 * Initialize the WASM module
 * Must be called before using FloorPlanProcessor
 */
export async function initFloorPlanWasm(): Promise<void> {
  if (wasmModule) return;

  // Dynamic import of the WASM module
  const wasm = await import('@ifc-lite/wasm');
  await wasm.default(); // Initialize WASM

  wasmModule = {
    FloorPlanAPI: wasm.FloorPlanAPI,
    createDefaultStoreyConfig: wasm.createDefaultStoreyConfig,
    createMultiStoreyConfig: wasm.createMultiStoreyConfig,
  };
}

/**
 * Floor plan processor for detecting walls and generating 3D buildings
 */
export class FloorPlanProcessor {
  private api: FloorPlanAPIWasm | null = null;

  /**
   * Initialize the processor
   * Call this before using other methods
   */
  async init(): Promise<void> {
    await initFloorPlanWasm();
    if (!wasmModule) {
      throw new Error('WASM module not initialized');
    }
    this.api = new wasmModule.FloorPlanAPI();
  }

  private ensureInitialized(): FloorPlanAPIWasm {
    if (!this.api) {
      throw new Error('Processor not initialized. Call init() first.');
    }
    return this.api;
  }

  /**
   * Set detection configuration
   */
  setConfig(config: Partial<DetectionConfig>): void {
    const api = this.ensureInitialized();
    const currentConfig = JSON.parse(api.getConfig()) as DetectionConfig;
    const newConfig = { ...currentConfig, ...config };
    api.setConfig(JSON.stringify(newConfig));
  }

  /**
   * Get current detection configuration
   */
  getConfig(): DetectionConfig {
    const api = this.ensureInitialized();
    return JSON.parse(api.getConfig()) as DetectionConfig;
  }

  /**
   * Detect floor plan elements from an RGBA image
   *
   * @param rgbaData RGBA pixel data (4 bytes per pixel)
   * @param width Image width
   * @param height Image height
   * @param pageIndex Page index for multi-page documents
   * @returns Detected floor plan with walls, rooms, and openings
   */
  detectFloorPlan(
    rgbaData: Uint8Array,
    width: number,
    height: number,
    pageIndex: number = 0
  ): DetectedFloorPlan {
    const api = this.ensureInitialized();
    const resultJson = api.detectFloorPlan(rgbaData, width, height, pageIndex);
    return JSON.parse(resultJson) as DetectedFloorPlan;
  }

  /**
   * Detect floor plan from ImageData (convenience method)
   */
  detectFloorPlanFromImageData(imageData: ImageData, pageIndex: number = 0): DetectedFloorPlan {
    return this.detectFloorPlan(
      new Uint8Array(imageData.data),
      imageData.width,
      imageData.height,
      pageIndex
    );
  }

  /**
   * Get a previously detected floor plan
   */
  getFloorPlan(pageIndex: number): DetectedFloorPlan {
    const api = this.ensureInitialized();
    const resultJson = api.getFloorPlan(pageIndex);
    return JSON.parse(resultJson) as DetectedFloorPlan;
  }

  /**
   * Get the number of detected floor plans
   */
  getFloorPlanCount(): number {
    return this.ensureInitialized().getFloorPlanCount();
  }

  /**
   * Set the scale factor for a floor plan (meters per pixel)
   */
  setScale(pageIndex: number, scale: number): void {
    this.ensureInitialized().setScale(pageIndex, scale);
  }

  /**
   * Clear all detected floor plans
   */
  clear(): void {
    this.ensureInitialized().clear();
  }

  /**
   * Generate a 3D building from detected floor plans
   *
   * @param storeyConfigs Configuration for each storey
   * @returns Generated building with mesh data
   */
  generateBuilding(storeyConfigs: StoreyConfig[]): GeneratedBuilding {
    const api = this.ensureInitialized();
    const resultJson = api.generateBuilding(JSON.stringify(storeyConfigs));
    return JSON.parse(resultJson) as GeneratedBuilding;
  }

  /**
   * Generate a test building for validation (no input required)
   */
  generateTestBuilding(): GeneratedBuilding {
    const api = this.ensureInitialized();
    const resultJson = api.generateTestBuilding();
    return JSON.parse(resultJson) as GeneratedBuilding;
  }

  /**
   * Get mesh data for a specific storey as typed arrays
   * Ready for direct GPU upload
   */
  getStoreyMeshData(building: GeneratedBuilding, storeyIndex: number): StoreyMeshData {
    const api = this.ensureInitialized();
    return api.getStoreyMeshData(JSON.stringify(building), storeyIndex);
  }
}

/**
 * Create a default storey configuration
 */
export function createDefaultStoreyConfig(
  floorPlanIndex: number,
  label: string,
  height: number = 3.0
): StoreyConfig[] {
  if (!wasmModule) {
    // Fallback if WASM not initialized
    return [
      {
        id: `storey_${floorPlanIndex}`,
        label,
        height,
        elevation: 0,
        order: floorPlanIndex,
        floor_plan_index: floorPlanIndex,
      },
    ];
  }
  return JSON.parse(
    wasmModule.createDefaultStoreyConfig(floorPlanIndex, label, height)
  ) as StoreyConfig[];
}

/**
 * Create storey configurations for multiple floors
 */
export function createMultiStoreyConfigs(
  floorPlanIndices: number[],
  labels: string[],
  heights: number[]
): StoreyConfig[] {
  if (!wasmModule) {
    // Fallback if WASM not initialized
    let elevation = 0;
    return floorPlanIndices.map((floorPlanIndex, order) => {
      const config: StoreyConfig = {
        id: `storey_${order}`,
        label: labels[order] ?? `Level ${order}`,
        height: heights[order] ?? 3.0,
        elevation,
        order,
        floor_plan_index: floorPlanIndex,
      };
      elevation += config.height;
      return config;
    });
  }
  return JSON.parse(
    wasmModule.createMultiStoreyConfig(
      JSON.stringify(floorPlanIndices),
      JSON.stringify(labels),
      JSON.stringify(heights)
    )
  ) as StoreyConfig[];
}
