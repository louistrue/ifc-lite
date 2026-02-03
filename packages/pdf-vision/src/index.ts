/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/pdf-vision
 *
 * 3D building reconstruction from 2D floor plan images.
 *
 * This package provides tools to:
 * - Load and render PDF floor plans
 * - Detect walls, rooms, and openings using computer vision
 * - Generate 3D building geometry from detected floor plans
 *
 * @example
 * ```typescript
 * import {
 *   PdfProcessor,
 *   FloorPlanProcessor,
 *   createMultiStoreyConfigs
 * } from '@ifc-lite/pdf-vision';
 *
 * // Initialize
 * const pdfProcessor = new PdfProcessor();
 * const floorPlanProcessor = new FloorPlanProcessor();
 * await floorPlanProcessor.init();
 *
 * // Load PDF and detect floor plans
 * const pdfBytes = await fetch('floorplan.pdf').then(r => r.arrayBuffer());
 * await pdfProcessor.loadPdf(new Uint8Array(pdfBytes));
 *
 * // Process each page
 * for (let i = 0; i < pdfProcessor.getPageCount(); i++) {
 *   const { data, width, height } = await pdfProcessor.getPageRgbaData(i);
 *   const floorPlan = floorPlanProcessor.detectFloorPlan(data, width, height, i);
 *   console.log(`Page ${i}: ${floorPlan.walls.length} walls detected`);
 * }
 *
 * // Generate 3D building
 * const storeys = createMultiStoreyConfigs(
 *   [0, 1],
 *   ['Ground Floor', 'First Floor'],
 *   [3.0, 3.0]
 * );
 * const building = floorPlanProcessor.generateBuilding(storeys);
 *
 * // Access mesh data for rendering
 * for (let i = 0; i < building.storeys.length; i++) {
 *   const meshData = floorPlanProcessor.getStoreyMeshData(building, i);
 *   // Upload to GPU...
 * }
 * ```
 */

// Types
export type {
  Point2D,
  DetectedLine,
  WallType,
  DetectedWall,
  OpeningType,
  DetectedOpening,
  DetectedRoom,
  DetectedFloorPlan,
  DetectionConfig,
  StoreyConfig,
  BuildingBounds,
  GeneratedStorey,
  GeneratedBuilding,
  StoreyMeshData,
} from './types';

export { DEFAULT_DETECTION_CONFIG } from './types';

// PDF Processing
export { PdfProcessor, initPdfWorker } from './pdf-processor';
export type { PdfPage, PdfThumbnail } from './pdf-processor';

// Floor Plan Processing
export {
  FloorPlanProcessor,
  initFloorPlanWasm,
  createDefaultStoreyConfig,
  createMultiStoreyConfigs,
} from './floor-plan-processor';
