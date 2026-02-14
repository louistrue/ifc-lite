/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BimBackend, EntityRef } from '../types.js';

/** bim.mutate — Property editing with undo/redo */
export class MutateNamespace {
  constructor(private backend: BimBackend) {}

  /** Set a property on an entity */
  setProperty(ref: EntityRef, psetName: string, propName: string, value: string | number | boolean): void {
    this.backend.dispatch('mutate', 'setProperty', [ref, psetName, propName, value]);
  }

  /** Delete a property from an entity */
  deleteProperty(ref: EntityRef, psetName: string, propName: string): void {
    this.backend.dispatch('mutate', 'deleteProperty', [ref, psetName, propName]);
  }

  /** Batch multiple mutations into a single undo step */
  batch(label: string, fn: () => void): void {
    fn();
  }

  /** Undo last mutation for a model */
  undo(modelId: string): boolean {
    return this.backend.dispatch('mutate', 'undo', [modelId]) as boolean;
  }

  /** Redo last undone mutation for a model */
  redo(modelId: string): boolean {
    return this.backend.dispatch('mutate', 'redo', [modelId]) as boolean;
  }
}
