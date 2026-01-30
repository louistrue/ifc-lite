/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drawing Frame Types
 *
 * Professional drawing frame configurations with:
 * - Multiple style presets
 * - Configurable margins and borders
 * - Zone references (A-H, 1-8)
 * - Fold and trim marks
 */

/** Frame style presets */
export type FrameStyle = 'simple' | 'professional' | 'minimal' | 'iso' | 'custom';

/** Frame border configuration */
export interface FrameBorderConfig {
  /** Outer border line weight (mm) */
  outerLineWeight: number;
  /** Inner border line weight (mm) */
  innerLineWeight: number;
  /** Gap between outer and inner border (mm) */
  borderGap: number;
  /** Corner fold marks visible */
  showFoldMarks: boolean;
  /** Trim marks for printing */
  showTrimMarks: boolean;
}

/** Margin configuration (in mm from paper edge to frame) */
export interface FrameMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Extra binding margin on left (for hole punch) */
  bindingMargin: number;
}

/** Complete frame definition */
export interface DrawingFrame {
  /** Frame style ID */
  style: FrameStyle;
  /** Frame margins */
  margins: FrameMargins;
  /** Border configuration */
  border: FrameBorderConfig;
  /** Grid/zone references (A-H horizontal, 1-8 vertical) */
  showZoneReferences: boolean;
  /** Number of horizontal zones */
  horizontalZones: number;
  /** Number of vertical zones */
  verticalZones: number;
  /** Zone reference font size (mm) */
  zoneFontSize: number;
}

/** Default frame configurations by style */
export const FRAME_PRESETS: Record<FrameStyle, Omit<DrawingFrame, 'style'>> = {
  simple: {
    margins: { top: 10, right: 10, bottom: 10, left: 10, bindingMargin: 0 },
    border: {
      outerLineWeight: 0.7,
      innerLineWeight: 0.35,
      borderGap: 0,
      showFoldMarks: false,
      showTrimMarks: false,
    },
    showZoneReferences: false,
    horizontalZones: 0,
    verticalZones: 0,
    zoneFontSize: 3,
  },
  professional: {
    margins: { top: 10, right: 10, bottom: 10, left: 20, bindingMargin: 10 },
    border: {
      outerLineWeight: 0.7,
      innerLineWeight: 0.35,
      borderGap: 5,
      showFoldMarks: true,
      showTrimMarks: true,
    },
    showZoneReferences: true,
    horizontalZones: 8,
    verticalZones: 6,
    zoneFontSize: 3.5,
  },
  minimal: {
    margins: { top: 5, right: 5, bottom: 5, left: 5, bindingMargin: 0 },
    border: {
      outerLineWeight: 0.35,
      innerLineWeight: 0,
      borderGap: 0,
      showFoldMarks: false,
      showTrimMarks: false,
    },
    showZoneReferences: false,
    horizontalZones: 0,
    verticalZones: 0,
    zoneFontSize: 3,
  },
  iso: {
    margins: { top: 10, right: 10, bottom: 10, left: 20, bindingMargin: 10 },
    border: {
      outerLineWeight: 0.7,
      innerLineWeight: 0.35,
      borderGap: 5,
      showFoldMarks: true,
      showTrimMarks: true,
    },
    showZoneReferences: true,
    horizontalZones: 8,
    verticalZones: 4,
    zoneFontSize: 3.5,
  },
  custom: {
    margins: { top: 10, right: 10, bottom: 10, left: 10, bindingMargin: 0 },
    border: {
      outerLineWeight: 0.5,
      innerLineWeight: 0.25,
      borderGap: 3,
      showFoldMarks: false,
      showTrimMarks: false,
    },
    showZoneReferences: false,
    horizontalZones: 0,
    verticalZones: 0,
    zoneFontSize: 3,
  },
};

/** Create a frame with a specific style */
export function createFrame(style: FrameStyle): DrawingFrame {
  return {
    style,
    ...FRAME_PRESETS[style],
  };
}

/** Get default frame (professional style) */
export function getDefaultFrame(): DrawingFrame {
  return createFrame('professional');
}
