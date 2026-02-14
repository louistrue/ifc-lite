/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.drawing — 2D architectural drawings
 *
 * Wraps @ifc-lite/drawing-2d for section cuts, floor plans, elevations,
 * and SVG export. Uses dynamic imports to avoid compile-time dependency
 * on @ifc-lite/drawing-2d (which has a deep dep chain through geometry).
 */

export interface SectionCutOptions {
  axis: 'x' | 'y' | 'z';
  position: number;
  depth?: number;
  showHiddenLines?: boolean;
  showHatching?: boolean;
}

export interface FloorPlanOptions {
  elevation: number;
  depth?: number;
  showHiddenLines?: boolean;
  showHatching?: boolean;
}

// Dynamic import helper to avoid compile-time module resolution
async function loadDrawing2D(): Promise<Record<string, unknown>> {
  const name = '@ifc-lite/drawing-2d';
  return import(/* webpackIgnore: true */ name) as Promise<Record<string, unknown>>;
}

/** bim.drawing — 2D architectural drawing generation */
export class DrawingNamespace {
  // Drawing generation requires geometry data (MeshData[]) which is internal
  // to the viewer's store. The SDK exposes a high-level API that the viewer's
  // LocalBackend connects to the real geometry.
  //
  // For now, this namespace provides utility functions.
  // Full drawing generation will be wired when the viewer refactors to SDK.

  /** Get available graphic override presets. */
  async getPresets(): Promise<unknown[]> {
    const mod = await loadDrawing2D();
    return mod.BUILT_IN_PRESETS as unknown[];
  }

  /** Get recommended scale for a drawing size. */
  async getRecommendedScale(drawingSize: number): Promise<unknown> {
    const mod = await loadDrawing2D();
    return (mod.getRecommendedScale as (s: number) => unknown)(drawingSize);
  }

  /** Get available paper sizes. */
  async getPaperSizes(): Promise<unknown[]> {
    const mod = await loadDrawing2D();
    return mod.PAPER_SIZES as unknown[];
  }
}
