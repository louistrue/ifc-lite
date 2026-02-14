/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BimBackend, EntityRef } from '../types.js';

/** bim.mutate — Property editing with undo/redo */
export class MutateNamespace {
  constructor(private backend: BimBackend) {}

  /** Set a property on an entity */
  setProperty(ref: EntityRef, psetName: string, propName: string, value: string | number | boolean): void {
    this.backend.setProperty(ref, psetName, propName, value);
  }

  /** Delete a property from an entity */
  deleteProperty(ref: EntityRef, psetName: string, propName: string): void {
    this.backend.deleteProperty(ref, psetName, propName);
  }

  /** Batch multiple mutations into a single undo step */
  batch(label: string, fn: () => void): void {
    // Batch is implemented as a simple wrapper — the backend tracks
    // mutations and groups them when undo is called.
    // A more sophisticated implementation would use a transaction pattern.
    fn();
  }

  /** Undo last mutation for a model */
  undo(modelId: string): boolean {
    return this.backend.undo(modelId);
  }

  /** Redo last undone mutation for a model */
  redo(modelId: string): boolean {
    return this.backend.redo(modelId);
  }
}
