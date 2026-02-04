/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for floor plan detection using WASM
 *
 * This hook provides a clean interface for:
 * - Detecting walls/rooms from floor plan images
 * - Generating 3D building meshes from detected floor plans
 */

import { useCallback, useRef, useState } from 'react';
import type {
  FloorPlanPage,
  StoreyConfig,
  DetectedWall,
  DetectedRoom,
  DetectedOpening,
  StoreyMeshData,
  GeneratedBuilding,
} from '@/store/slices/floorPlanSlice';

// ============================================================================
// Types for WASM API (will be generated when WASM is built)
// ============================================================================

/** WASM detected wall structure */
interface WasmDetectedWall {
  id: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  thickness: number;
  wall_type: string;
}

/** WASM detected room structure */
interface WasmDetectedRoom {
  id: string;
  label: string;
  vertices: Array<{ x: number; y: number }>;
  area: number;
}

/** WASM detected opening structure */
interface WasmDetectedOpening {
  id: string;
  opening_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wall_id: string | null;
}

/** WASM floor plan detection result */
interface WasmDetectedFloorPlan {
  walls: WasmDetectedWall[];
  rooms: WasmDetectedRoom[];
  openings?: WasmDetectedOpening[];
}

/** WASM storey config for building generation */
interface WasmStoreyConfig {
  floor_plan_index: number;
  label: string;
  height: number;
  elevation: number;
}

/** WASM generated building result */
interface WasmGeneratedBuilding {
  total_height: number;
  storey_count: number;
}

/** WASM storey mesh data */
interface WasmStoreyMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** WASM FloorPlanAPI interface */
interface FloorPlanAPIInterface {
  detectFloorPlan(rgba: Uint8Array, width: number, height: number, pageIndex: number): WasmDetectedFloorPlan;
  generateBuilding(storeyConfigs: WasmStoreyConfig[]): WasmGeneratedBuilding;
  getStoreyMeshData(building: WasmGeneratedBuilding, storeyIndex: number): WasmStoreyMeshData | null;
}

// ============================================================================
// Hook
// ============================================================================

export interface UseFloorPlanDetectionResult {
  /** Detect walls/rooms from a floor plan image */
  detectFloorPlan: (page: FloorPlanPage) => Promise<{
    walls: DetectedWall[];
    rooms: DetectedRoom[];
    openings: DetectedOpening[];
  } | null>;

  /** Generate 3D building from floor plans */
  generateBuilding: (
    pages: FloorPlanPage[],
    configs: StoreyConfig[]
  ) => Promise<GeneratedBuilding | null>;

  /** Whether WASM is available */
  wasmAvailable: boolean;

  /** Whether detection is in progress */
  detecting: boolean;

  /** Error message if any */
  error: string | null;
}

export function useFloorPlanDetection(): UseFloorPlanDetectionResult {
  const [wasmAvailable, setWasmAvailable] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<FloorPlanAPIInterface | null>(null);

  // Initialize WASM module
  const initWasm = useCallback(async (): Promise<FloorPlanAPIInterface | null> => {
    if (apiRef.current) {
      return apiRef.current;
    }

    try {
      // Dynamic import to avoid issues if WASM isn't built
      const wasm = await import('@ifc-lite/wasm');
      await wasm.default();

      // Check if FloorPlanAPI exists
      const FloorPlanAPI = (wasm as Record<string, unknown>).FloorPlanAPI as
        | (new () => FloorPlanAPIInterface)
        | undefined;

      if (!FloorPlanAPI) {
        console.warn('[FloorPlanDetection] FloorPlanAPI not available in WASM module');
        setWasmAvailable(false);
        return null;
      }

      const api = new FloorPlanAPI();
      apiRef.current = api;
      setWasmAvailable(true);
      return api;
    } catch (err) {
      console.error('[FloorPlanDetection] Failed to load WASM:', err);
      setWasmAvailable(false);
      setError(err instanceof Error ? err.message : 'Failed to load WASM module');
      return null;
    }
  }, []);

  // Detect floor plan
  const detectFloorPlan = useCallback(async (page: FloorPlanPage): Promise<{
    walls: DetectedWall[];
    rooms: DetectedRoom[];
    openings: DetectedOpening[];
  } | null> => {
    if (!page.imageData) {
      setError('No image data available');
      return null;
    }

    setDetecting(true);
    setError(null);

    try {
      const api = await initWasm();
      if (!api) {
        // Fall back to mock detection for testing UI
        console.warn('[FloorPlanDetection] Using mock detection (WASM not available)');
        return createMockDetection();
      }

      const rgba = new Uint8Array(page.imageData.data);
      const result = api.detectFloorPlan(
        rgba,
        page.imageData.width,
        page.imageData.height,
        page.pageIndex
      );

      return {
        walls: result.walls.map((w) => ({
          id: w.id,
          startX: w.start_x,
          startY: w.start_y,
          endX: w.end_x,
          endY: w.end_y,
          thickness: w.thickness,
          wallType: w.wall_type as 'exterior' | 'interior' | 'partition',
        })),
        rooms: result.rooms.map((r) => ({
          id: r.id,
          label: r.label,
          vertices: r.vertices,
          area: r.area,
        })),
        openings: result.openings?.map((o) => ({
          id: o.id,
          openingType: o.opening_type as 'door' | 'window',
          x: o.x,
          y: o.y,
          width: o.width,
          height: o.height,
          wallId: o.wall_id,
        })) ?? [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Detection failed';
      setError(message);
      console.error('[FloorPlanDetection] Detection error:', err);
      return null;
    } finally {
      setDetecting(false);
    }
  }, [initWasm]);

  // Generate building
  const generateBuilding = useCallback(async (
    pages: FloorPlanPage[],
    configs: StoreyConfig[]
  ): Promise<GeneratedBuilding | null> => {
    setDetecting(true);
    setError(null);

    try {
      const api = await initWasm();
      if (!api) {
        // Fall back to mock building for testing UI
        console.warn('[FloorPlanDetection] Using mock building (WASM not available)');
        return createMockBuilding(configs);
      }

      // First, detect all pages
      for (const page of pages) {
        if (page.imageData) {
          const rgba = new Uint8Array(page.imageData.data);
          api.detectFloorPlan(
            rgba,
            page.imageData.width,
            page.imageData.height,
            page.pageIndex
          );
        }
      }

      // Create storey configs
      const wasmConfigs: WasmStoreyConfig[] = configs.map((config) => {
        const page = pages.find((p) => p.id === config.floorPlanId);
        return {
          floor_plan_index: page?.pageIndex ?? 0,
          label: config.name,
          height: config.height,
          elevation: config.elevation,
        };
      });

      // Generate building
      const building = api.generateBuilding(wasmConfigs);

      // Extract mesh data for each storey
      const storeyMeshes = new Map<number, StoreyMeshData>();
      for (let i = 0; i < building.storey_count; i++) {
        const meshData = api.getStoreyMeshData(building, i);
        if (meshData) {
          storeyMeshes.set(i, {
            positions: meshData.positions,
            normals: meshData.normals,
            indices: meshData.indices,
          });
        }
      }

      return {
        totalHeight: building.total_height,
        storeyCount: building.storey_count,
        storeyMeshes,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      console.error('[FloorPlanDetection] Generation error:', err);
      return null;
    } finally {
      setDetecting(false);
    }
  }, [initWasm]);

  return {
    detectFloorPlan,
    generateBuilding,
    wasmAvailable,
    detecting,
    error,
  };
}

// ============================================================================
// Mock data for UI testing when WASM isn't available
// ============================================================================

function createMockDetection(): {
  walls: DetectedWall[];
  rooms: DetectedRoom[];
  openings: DetectedOpening[];
} {
  return {
    walls: [
      { id: 'w1', startX: 0, startY: 0, endX: 100, endY: 0, thickness: 0.2, wallType: 'exterior' },
      { id: 'w2', startX: 100, startY: 0, endX: 100, endY: 100, thickness: 0.2, wallType: 'exterior' },
      { id: 'w3', startX: 100, startY: 100, endX: 0, endY: 100, thickness: 0.2, wallType: 'exterior' },
      { id: 'w4', startX: 0, startY: 100, endX: 0, endY: 0, thickness: 0.2, wallType: 'exterior' },
    ],
    rooms: [
      {
        id: 'r1',
        label: 'Room 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        area: 100,
      },
    ],
    openings: [],
  };
}

function createMockBuilding(configs: StoreyConfig[]): GeneratedBuilding {
  const totalHeight = configs.reduce((sum, c) => sum + c.height, 0);
  const storeyMeshes = new Map<number, StoreyMeshData>();

  // Create empty placeholder meshes
  for (let i = 0; i < configs.length; i++) {
    storeyMeshes.set(i, {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
    });
  }

  return {
    totalHeight,
    storeyCount: configs.length,
    storeyMeshes,
  };
}
