/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared constants for section tool components
 */

// Axis display info for semantic names
export const AXIS_INFO = {
  down: { label: 'Down', description: 'Horizontal cut (floor plan view)', icon: '\u2193' },
  front: { label: 'Front', description: 'Vertical cut (elevation view)', icon: '\u2192' },
  side: { label: 'Side', description: 'Vertical cut (side elevation)', icon: '\u2299' },
} as const;
