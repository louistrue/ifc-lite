/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared constants for section tool components
 */

import type { SectionPlaneAxis, SectionMode } from '@/store';

/** Display info for each axis */
export const AXIS_INFO: Record<SectionPlaneAxis, { label: string; description: string; color: string }> = {
  down:  { label: 'Down',  description: 'Horizontal cut (floor plan)', color: '#03A9F4' },
  front: { label: 'Front', description: 'Vertical cut (front)',        color: '#4CAF50' },
  side:  { label: 'Side',  description: 'Vertical cut (side)',         color: '#FF9800' },
};

/** Display info for each section mode */
export const MODE_INFO: Record<SectionMode, { label: string; description: string }> = {
  axis: { label: 'Axis',  description: 'Cut along a model axis' },
  face: { label: 'Face',  description: 'Cut along a picked surface' },
};

/** Gizmo sensitivity: pixels of screen drag per 1% position change */
export const GIZMO_AXIS_SENSITIVITY = 0.15;

/** Gizmo sensitivity for face mode: pixels of screen drag per 1 world unit */
export const GIZMO_FACE_SENSITIVITY = 0.02;

/** Colors for the gizmo handle per axis */
export const GIZMO_COLORS: Record<SectionPlaneAxis | 'face', string> = {
  down:  '#03A9F4',
  front: '#4CAF50',
  side:  '#FF9800',
  face:  '#E040FB',
};
