/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Paper Size Definitions
 *
 * Comprehensive paper size registry supporting:
 * - ISO A-series (A0-A4)
 * - US ANSI series (Letter, Legal, Tabloid, C-E)
 * - Architectural ARCH series (A-E1)
 */

/** Paper orientation */
export type PaperOrientation = 'portrait' | 'landscape';

/** Paper size category for grouping in UI */
export type PaperSizeCategory = 'ISO' | 'ANSI' | 'ARCH' | 'custom';

/** Complete paper size definition */
export interface PaperSizeDefinition {
  /** Unique identifier (e.g., 'A3_LANDSCAPE') */
  id: string;
  /** Display name */
  name: string;
  /** Category for grouping in UI */
  category: PaperSizeCategory;
  /** Width in millimeters */
  widthMm: number;
  /** Height in millimeters */
  heightMm: number;
  /** Orientation */
  orientation: PaperOrientation;
  /** Default printable margin in mm */
  defaultMarginMm: number;
}

/** All supported paper sizes */
export const PAPER_SIZE_REGISTRY: Record<string, PaperSizeDefinition> = {
  // ISO A-Series
  A0_LANDSCAPE: {
    id: 'A0_LANDSCAPE',
    name: 'A0 Landscape',
    category: 'ISO',
    widthMm: 1189,
    heightMm: 841,
    orientation: 'landscape',
    defaultMarginMm: 20,
  },
  A0_PORTRAIT: {
    id: 'A0_PORTRAIT',
    name: 'A0 Portrait',
    category: 'ISO',
    widthMm: 841,
    heightMm: 1189,
    orientation: 'portrait',
    defaultMarginMm: 20,
  },
  A1_LANDSCAPE: {
    id: 'A1_LANDSCAPE',
    name: 'A1 Landscape',
    category: 'ISO',
    widthMm: 841,
    heightMm: 594,
    orientation: 'landscape',
    defaultMarginMm: 20,
  },
  A1_PORTRAIT: {
    id: 'A1_PORTRAIT',
    name: 'A1 Portrait',
    category: 'ISO',
    widthMm: 594,
    heightMm: 841,
    orientation: 'portrait',
    defaultMarginMm: 20,
  },
  A2_LANDSCAPE: {
    id: 'A2_LANDSCAPE',
    name: 'A2 Landscape',
    category: 'ISO',
    widthMm: 594,
    heightMm: 420,
    orientation: 'landscape',
    defaultMarginMm: 15,
  },
  A2_PORTRAIT: {
    id: 'A2_PORTRAIT',
    name: 'A2 Portrait',
    category: 'ISO',
    widthMm: 420,
    heightMm: 594,
    orientation: 'portrait',
    defaultMarginMm: 15,
  },
  A3_LANDSCAPE: {
    id: 'A3_LANDSCAPE',
    name: 'A3 Landscape',
    category: 'ISO',
    widthMm: 420,
    heightMm: 297,
    orientation: 'landscape',
    defaultMarginMm: 10,
  },
  A3_PORTRAIT: {
    id: 'A3_PORTRAIT',
    name: 'A3 Portrait',
    category: 'ISO',
    widthMm: 297,
    heightMm: 420,
    orientation: 'portrait',
    defaultMarginMm: 10,
  },
  A4_LANDSCAPE: {
    id: 'A4_LANDSCAPE',
    name: 'A4 Landscape',
    category: 'ISO',
    widthMm: 297,
    heightMm: 210,
    orientation: 'landscape',
    defaultMarginMm: 10,
  },
  A4_PORTRAIT: {
    id: 'A4_PORTRAIT',
    name: 'A4 Portrait',
    category: 'ISO',
    widthMm: 210,
    heightMm: 297,
    orientation: 'portrait',
    defaultMarginMm: 10,
  },

  // US ANSI Series
  LETTER_LANDSCAPE: {
    id: 'LETTER_LANDSCAPE',
    name: 'US Letter Landscape',
    category: 'ANSI',
    widthMm: 279.4,
    heightMm: 215.9,
    orientation: 'landscape',
    defaultMarginMm: 10,
  },
  LETTER_PORTRAIT: {
    id: 'LETTER_PORTRAIT',
    name: 'US Letter Portrait',
    category: 'ANSI',
    widthMm: 215.9,
    heightMm: 279.4,
    orientation: 'portrait',
    defaultMarginMm: 10,
  },
  LEGAL_LANDSCAPE: {
    id: 'LEGAL_LANDSCAPE',
    name: 'US Legal Landscape',
    category: 'ANSI',
    widthMm: 355.6,
    heightMm: 215.9,
    orientation: 'landscape',
    defaultMarginMm: 10,
  },
  LEGAL_PORTRAIT: {
    id: 'LEGAL_PORTRAIT',
    name: 'US Legal Portrait',
    category: 'ANSI',
    widthMm: 215.9,
    heightMm: 355.6,
    orientation: 'portrait',
    defaultMarginMm: 10,
  },
  TABLOID_LANDSCAPE: {
    id: 'TABLOID_LANDSCAPE',
    name: 'US Tabloid Landscape',
    category: 'ANSI',
    widthMm: 431.8,
    heightMm: 279.4,
    orientation: 'landscape',
    defaultMarginMm: 15,
  },
  TABLOID_PORTRAIT: {
    id: 'TABLOID_PORTRAIT',
    name: 'US Tabloid Portrait',
    category: 'ANSI',
    widthMm: 279.4,
    heightMm: 431.8,
    orientation: 'portrait',
    defaultMarginMm: 15,
  },
  ANSI_C: {
    id: 'ANSI_C',
    name: 'ANSI C (17x22)',
    category: 'ANSI',
    widthMm: 558.8,
    heightMm: 431.8,
    orientation: 'landscape',
    defaultMarginMm: 15,
  },
  ANSI_D: {
    id: 'ANSI_D',
    name: 'ANSI D (22x34)',
    category: 'ANSI',
    widthMm: 863.6,
    heightMm: 558.8,
    orientation: 'landscape',
    defaultMarginMm: 20,
  },
  ANSI_E: {
    id: 'ANSI_E',
    name: 'ANSI E (34x44)',
    category: 'ANSI',
    widthMm: 1117.6,
    heightMm: 863.6,
    orientation: 'landscape',
    defaultMarginMm: 20,
  },

  // ARCH Series (Architectural)
  ARCH_A: {
    id: 'ARCH_A',
    name: 'ARCH A (9x12)',
    category: 'ARCH',
    widthMm: 304.8,
    heightMm: 228.6,
    orientation: 'landscape',
    defaultMarginMm: 10,
  },
  ARCH_B: {
    id: 'ARCH_B',
    name: 'ARCH B (12x18)',
    category: 'ARCH',
    widthMm: 457.2,
    heightMm: 304.8,
    orientation: 'landscape',
    defaultMarginMm: 15,
  },
  ARCH_C: {
    id: 'ARCH_C',
    name: 'ARCH C (18x24)',
    category: 'ARCH',
    widthMm: 609.6,
    heightMm: 457.2,
    orientation: 'landscape',
    defaultMarginMm: 15,
  },
  ARCH_D: {
    id: 'ARCH_D',
    name: 'ARCH D (24x36)',
    category: 'ARCH',
    widthMm: 914.4,
    heightMm: 609.6,
    orientation: 'landscape',
    defaultMarginMm: 20,
  },
  ARCH_E: {
    id: 'ARCH_E',
    name: 'ARCH E (36x48)',
    category: 'ARCH',
    widthMm: 1219.2,
    heightMm: 914.4,
    orientation: 'landscape',
    defaultMarginMm: 20,
  },
  ARCH_E1: {
    id: 'ARCH_E1',
    name: 'ARCH E1 (30x42)',
    category: 'ARCH',
    widthMm: 1066.8,
    heightMm: 762,
    orientation: 'landscape',
    defaultMarginMm: 20,
  },
};

/** Get paper sizes grouped by category */
export function getPaperSizesByCategory(): Record<PaperSizeCategory, PaperSizeDefinition[]> {
  const result: Record<PaperSizeCategory, PaperSizeDefinition[]> = {
    ISO: [],
    ANSI: [],
    ARCH: [],
    custom: [],
  };
  for (const paper of Object.values(PAPER_SIZE_REGISTRY)) {
    result[paper.category].push(paper);
  }
  return result;
}

/** Get default paper size (A3 Landscape) */
export function getDefaultPaperSize(): PaperSizeDefinition {
  return PAPER_SIZE_REGISTRY.A3_LANDSCAPE;
}
