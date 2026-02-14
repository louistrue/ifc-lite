/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Lens } from '@ifc-lite/lens';
import { BUILTIN_LENSES } from '@ifc-lite/lens';

/**
 * bim.lens — Rule-based visualization
 *
 * Lens evaluation runs on the host (viewer) side since it needs access to the
 * full data provider. The SDK exposes lens definitions and presets; the backend
 * handles evaluation and color overlay application.
 */
export class LensNamespace {
  /** Get all built-in lens presets */
  presets(): readonly Lens[] {
    return BUILTIN_LENSES;
  }

  /** Create a new lens definition (does not apply it) */
  create(lens: Omit<Lens, 'id'>): Lens {
    return {
      ...lens,
      id: `lens-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}
