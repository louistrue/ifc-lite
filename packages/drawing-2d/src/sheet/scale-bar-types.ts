/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Scale Bar Types
 *
 * Configurable scale bar for architectural drawings:
 * - Multiple visual styles
 * - Metric and imperial units
 * - Auto-calculation of optimal length
 */

/** Scale bar style */
export type ScaleBarStyle = 'linear' | 'alternating' | 'single' | 'graphic';

/** Scale bar position relative to drawing viewport */
export type ScaleBarPosition = 'below-viewport' | 'above-viewport' | 'in-title-block' | 'custom';

/** Scale bar unit system */
export type ScaleBarUnits = 'metric' | 'imperial' | 'both';

/** Scale bar configuration */
export interface ScaleBarConfig {
  /** Whether to show scale bar */
  visible: boolean;
  /** Scale bar style */
  style: ScaleBarStyle;
  /** Position */
  position: ScaleBarPosition;
  /** Custom position offset from default (mm) */
  customOffset?: { x: number; y: number };
  /** Unit system */
  units: ScaleBarUnits;
  /** Total length in model units (meters) */
  totalLengthM: number;
  /** Number of primary divisions */
  primaryDivisions: number;
  /** Number of subdivisions per primary division */
  subdivisions: number;
  /** Bar height in mm */
  heightMm: number;
  /** Label font size in mm */
  labelFontSize: number;
  /** Show unit label (e.g., "meters") */
  showUnitLabel: boolean;
  /** Fill color for filled segments */
  fillColor: string;
  /** Stroke color */
  strokeColor: string;
  /** Line weight */
  lineWeight: number;
}

/** Default scale bar configuration */
export const DEFAULT_SCALE_BAR: ScaleBarConfig = {
  visible: true,
  style: 'alternating',
  position: 'below-viewport',
  units: 'metric',
  totalLengthM: 5, // Will be auto-calculated based on scale
  primaryDivisions: 5,
  subdivisions: 2,
  heightMm: 3,
  labelFontSize: 2.5,
  showUnitLabel: true,
  fillColor: '#000000',
  strokeColor: '#000000',
  lineWeight: 0.25,
};

/**
 * Calculate optimal scale bar length based on drawing scale
 * Returns length in model units (meters)
 *
 * @param scaleFactor - Drawing scale factor (e.g., 100 for 1:100)
 * @param maxLengthMm - Maximum length on paper in mm
 */
export function calculateOptimalScaleBarLength(
  scaleFactor: number,
  maxLengthMm: number
): number {
  // Target ~60-80mm on paper for readability
  const targetPaperLengthMm = Math.min(80, maxLengthMm * 0.8);

  // Convert paper length to model units (meters)
  const modelLength = (targetPaperLengthMm * scaleFactor) / 1000;

  // Round to nice numbers for readability
  const niceNumbers = [
    0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000,
  ];

  for (const n of niceNumbers) {
    if (n >= modelLength * 0.5 && n <= modelLength * 1.5) {
      return n;
    }
  }

  // Fall back to rounded value
  return Math.round(modelLength);
}

/**
 * Calculate the number of divisions for a scale bar
 * Returns optimal division count for the given length
 */
export function calculateOptimalDivisions(totalLengthM: number): number {
  if (totalLengthM <= 1) return 5;
  if (totalLengthM <= 5) return 5;
  if (totalLengthM <= 10) return 5;
  if (totalLengthM <= 50) return 5;
  return 5; // Default to 5 divisions
}

/** North arrow style */
export type NorthArrowStyle = 'simple' | 'compass' | 'decorative' | 'none';

/** North arrow configuration */
export interface NorthArrowConfig {
  /** Arrow style */
  style: NorthArrowStyle;
  /** Rotation in degrees (0 = up) */
  rotation: number;
  /** Position in mm from top-left of viewport */
  positionMm: { x: number; y: number };
  /** Size in mm */
  sizeMm: number;
}

/** Default north arrow configuration */
export const DEFAULT_NORTH_ARROW: NorthArrowConfig = {
  style: 'simple',
  rotation: 0,
  positionMm: { x: 30, y: 30 },
  sizeMm: 15,
};
