/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { RGBAColor } from './types.js';

/** Ghost color for unmatched entities: faint gray at low opacity */
export const GHOST_COLOR: RGBAColor = [0.6, 0.6, 0.6, 0.15];

/**
 * Parse hex color string to RGBA tuple (0–1 range).
 *
 * @param hex - Hex color (e.g. "#E53935" or "E53935")
 * @param alpha - Alpha value in 0–1 range
 */
export function hexToRgba(hex: string, alpha: number): RGBAColor {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b, alpha];
}

/**
 * Convert RGBA tuple to hex color string (ignores alpha).
 *
 * @param rgba - RGBA tuple with values in 0–1 range
 * @returns Hex string like "#e53935"
 */
export function rgbaToHex(rgba: RGBAColor): string {
  const r = Math.round(rgba[0] * 255).toString(16).padStart(2, '0');
  const g = Math.round(rgba[1] * 255).toString(16).padStart(2, '0');
  const b = Math.round(rgba[2] * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Check if a color is a ghost color (alpha < 0.2).
 * Used to exclude ghost entries from UI legends.
 */
export function isGhostColor(rgba: RGBAColor): boolean {
  return rgba[3] < 0.2;
}
