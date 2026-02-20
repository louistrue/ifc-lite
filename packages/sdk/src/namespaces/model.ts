/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BimBackend, ModelInfo } from '../types.js';

/** bim.model — Model loading and management */
export class ModelNamespace {
  constructor(private backend: BimBackend) {}

  /** List all loaded models */
  list(): ModelInfo[] {
    return this.backend.model.list();
  }

  /** Get the currently active model ID */
  activeId(): string | null {
    return this.backend.model.activeId();
  }

  /** Get the active model info, or null */
  active(): ModelInfo | null {
    const id = this.activeId();
    if (!id) return null;
    return this.list().find(m => m.id === id) ?? null;
  }

  /** Get model info by ID */
  get(modelId: string): ModelInfo | null {
    return this.list().find(m => m.id === modelId) ?? null;
  }
}
