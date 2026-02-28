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
   * const storey = creator.addStorey({ Name: 'Ground Floor', Elevation: 0 });
   * creator.addWall(storey, { Start: [0,0,0], End: [5,0,0], Thickness: 0.2, Height: 3 });
   * const { content } = creator.toIfc();
   * ```
   */
  project(params?: ProjectParams): IfcCreator {
    return new IfcCreator(params);
  }

  /**
   * Quick helper: create a simple building with one storey.
   * Returns { creator, storeyId } for adding elements.
   */
  building(params?: ProjectParams & { storeyName?: string; storeyElevation?: number }): { creator: IfcCreator; storeyId: number } {
    const creator = new IfcCreator(params);
    const storeyId = creator.addStorey({
      Name: params?.storeyName ?? 'Ground Floor',
      Elevation: params?.storeyElevation ?? 0,
    });
    return { creator, storeyId };
  }

  /**
   * Trigger browser download for generated IFC content.
   * Only works when a backend is available (viewer context).
   */
  download(result: CreateResult, filename?: string): void {
    if (this.backend) {
      this.backend.export.download(
        result.content,
        filename ?? 'created.ifc',
        'application/x-step;charset=utf-8;',
      );
    }
  }
}
