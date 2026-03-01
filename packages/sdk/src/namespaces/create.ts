/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.create — IFC creation from scratch
 *
 * Provides a fluent API for building IFC files with building elements,
 * geometry, property sets, and quantities.
 *
 * The create namespace does NOT require a backend since it builds
 * standalone IFC content without querying an existing model.
 */

import type { BimBackend } from '../types.js';
import {
  IfcCreator,
  type ProjectParams,
  type StoreyParams,
  type WallParams,
  type SlabParams,
  type ColumnParams,
  type BeamParams,
  type StairParams,
  type RoofParams,
  type PropertySetDef,
  type QuantitySetDef,
  type CreateResult,
} from '@ifc-lite/create';

/** bim.create — Build IFC files from scratch */
export class CreateNamespace {
  private backend: BimBackend | null;

  constructor(backend?: BimBackend) {
    this.backend = backend ?? null;
  }

  /**
   * Create a new IfcCreator instance.
   *
   * ```ts
   * const creator = bim.create.project({ Name: 'My Building' });
   * const storey = creator.addIfcBuildingStorey({ Name: 'Ground Floor', Elevation: 0 });
   * creator.addIfcWall(storey, { Start: [0,0,0], End: [5,0,0], Thickness: 0.2, Height: 3 });
   * const { content } = creator.toIfc();
   * ```
   */
  project(params?: ProjectParams): IfcCreator {
    return new IfcCreator(params);
  }

  /**
   * Quick helper: create a simple building with one storey.
   * Returns { creator, localExpressId } for adding elements.
   */
  building(params?: ProjectParams & { StoreyName?: string; StoreyElevation?: number }): { creator: IfcCreator; localExpressId: number } {
    const creator = new IfcCreator(params);
    const localExpressId = creator.addIfcBuildingStorey({
      Name: params?.StoreyName ?? 'Ground Floor',
      Elevation: params?.StoreyElevation ?? 0,
    });
    return { creator, localExpressId };
  }

  /**
   * Trigger browser download for generated IFC content.
   * Requires a backend (viewer context).
   */
  download(result: CreateResult, filename?: string): void {
    if (!this.backend) {
      throw new Error('bim.create.download requires a backend (viewer context)');
    }
    this.backend.export.download(
      result.content,
      filename ?? 'created.ifc',
      'application/x-step;charset=utf-8;',
    );
  }
}
